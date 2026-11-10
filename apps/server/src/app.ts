// HTTP API: PassKit web service for FossWallet + JSON API for the static web app + the refresh scheduler.
// Never log tokens, OTPs or phone numbers: only method, path, status and our own error summaries.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { buildPkpass, IMAGE_NAMES, passType, unzipSync, zipSync, type Files } from "@passforge/core";
import { HttpError, type User } from "./oidc.ts";
import { SessionDead, type Provider } from "./providers.ts";
import type { Row, Secret, Store } from "./store.ts";

export interface Config { publicUrl: string; corsOrigin: string; refreshMinutes: number }
export interface Deps { store: Store; providers: Record<string, Provider>; verify: (authorization?: string) => Promise<User> }

const MB = 1 << 20;
const token = (bytes: number) => randomBytes(bytes).toString("base64url");
const sameSecret = (a: string, b: string) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

async function readBody(req: http.IncomingMessage, limit: number) {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    if ((n += c.length) > limit) throw new HttpError(413, "request too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
const readJson = async (req: http.IncomingMessage) => {
  try { return JSON.parse((await readBody(req, 64 * 1024)).toString() || "{}"); } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "invalid JSON");
  }
};

export function createApp(cfg: Config, { store, providers, verify }: Deps) {
  const locks = new Map<string, Promise<void>>();
  const pendingSms = new Map<string, { state: unknown; exp: number }>();

  /** Refresh upstream session + data for one pass. Serialized per pass, so a rotating refresh token is never used twice. */
  function refreshPass(serial: string): Promise<void> {
    const run = (locks.get(serial) ?? Promise.resolve()).then(() => doRefresh(serial));
    const tail = run.catch(() => {}).finally(() => { if (locks.get(serial) === tail) locks.delete(serial); });
    locks.set(serial, tail);
    return run;
  }

  async function doRefresh(serial: string) {
    const row = store.get(serial);
    if (!row) return;
    const p = providers[row.provider];
    const s = store.open(row);
    const now = Date.now();
    const next = now + cfg.refreshMinutes * 60_000;
    if (!s.refreshToken) return store.update(serial, { status: "login_needed", checked_at: now, next_refresh: next });
    try {
      const tok = await p.refresh(s.refreshToken);
      s.refreshToken = tok.refreshToken;
      store.update(serial, { secret: s, checked_at: now }); // persist the rotated token before anything else
      const fresh = await p.fetch(tok.accessToken);
      const { changedAt, ...old } = s.data ?? {};
      const changed = JSON.stringify(fresh) !== JSON.stringify(old) || row.status === "login_needed";
      s.data = { ...fresh, changedAt: changed ? now : changedAt };
      store.update(serial, { secret: s, status: "ok", last_error: null, next_refresh: next, ...(changed && { updated_at: now }) });
    } catch (e) {
      if (e instanceof SessionDead) {
        delete s.refreshToken;
        store.update(serial, { secret: s, status: "login_needed", last_error: e.message, updated_at: now, next_refresh: next });
      } else {
        store.update(serial, { status: "error", last_error: String((e as Error).message).slice(0, 200), next_refresh: next });
      }
      console.warn(`refresh ${row.provider}: ${(e as Error).message}`);
    }
  }

  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    try { for (const serial of store.due(Date.now())) await refreshPass(serial); } finally { ticking = false; }
  }

  async function pkpass(row: Row, s: Secret) {
    const images: Files = row.images ? unzipSync(row.images) : {};
    return buildPkpass({
      ...providers[row.provider].pass(s.data, row.status === "login_needed"),
      serialNumber: row.serial,
      webServiceURL: cfg.publicUrl,
      authenticationToken: s.authToken,
    }, images);
  }

  function owned(user: User, serial: string) {
    const row = store.get(serial);
    if (!row || row.owner !== user.sub) throw new HttpError(404, "no such pass");
    return row;
  }

  /** New live pass, or a new upstream session for an existing one (keeps serial + auth token, so the pass recovers). */
  async function connect(user: User, providerId: string, refreshToken: unknown, serial?: unknown) {
    if (!providers[providerId]) throw new HttpError(400, "unknown provider");
    if (typeof refreshToken !== "string" || !refreshToken || refreshToken.length > 8192) throw new HttpError(400, "refreshToken missing");
    let created = false;
    if (typeof serial === "string" && serial) {
      const row = owned(user, serial);
      if (row.provider !== providerId) throw new HttpError(400, "provider mismatch");
      store.update(serial, { secret: { ...store.open(row), refreshToken } });
    } else {
      serial = randomBytes(16).toString("hex");
      store.insert(serial as string, user.sub, providerId, { authToken: token(32), refreshToken });
      created = true;
    }
    await refreshPass(serial as string);
    const row = store.get(serial as string)!;
    if (row.status !== "ok") {
      if (created) store.remove(serial as string);
      throw row.status === "login_needed"
        ? new HttpError(400, "the shop rejected this session; sign in again")
        : new HttpError(502, `couldn't reach the shop: ${row.last_error}`);
    }
    return { serial, status: row.status };
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname;
    const send = (status: number, body?: unknown, headers: http.OutgoingHttpHeaders = {}) => {
      const raw = body instanceof Uint8Array || body === undefined ? body : JSON.stringify(body);
      res.writeHead(status, { ...(typeof raw === "string" && { "Content-Type": "application/json" }), ...headers });
      res.end(raw);
    };

    if (path === "/healthz") return send(200, { ok: true });

    // ---- PassKit web service (FossWallet) ----
    let m = /^\/v1\/passes\/([^/]+)\/([^/]+)$/.exec(path);
    if (m && req.method === "GET") {
      const row = store.get(decodeURIComponent(m[2]));
      const given = /^ApplePass (\S+)$/.exec(req.headers.authorization ?? "")?.[1];
      const s = row && store.open(row);
      if (!row || !s || !given || passType(row.provider) !== decodeURIComponent(m[1]) || !sameSecret(given, s.authToken)) return send(401);
      const lastModified = Math.floor(row.updated_at / 1000) * 1000;
      const since = Date.parse(req.headers["if-modified-since"] ?? "");
      if (since >= lastModified) return send(304);
      return send(200, await pkpass(row, s), { "Content-Type": "application/vnd.apple.pkpass", "Last-Modified": new Date(lastModified).toUTCString() });
    }
    // We never answer 204, so FossWallet never needs to register; accept registrations and logs anyway.
    if (/^\/v1\/devices\/[^/]+\/registrations\/[^/]+\/[^/]+$/.test(path) && (req.method === "POST" || req.method === "DELETE")) return send(200);
    if (path === "/v1/log" && req.method === "POST") return send(200);

    // ---- JSON API for the web app (Authentik users in the configured group) ----
    if (!path.startsWith("/api/")) return send(404, { error: "not found" });
    res.setHeader("Access-Control-Allow-Origin", cfg.corsOrigin);
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      return send(204, undefined, { "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600" });
    }
    const user = await verify(req.headers.authorization);
    const route = `${req.method} ${path.replace(/^\/api\/passes\/[0-9a-f]{32}/, "/api/passes/:serial").replace(/^\/api\/login\/[a-z0-9]+/, "/api/login/:provider")}`;
    const serial = /^\/api\/passes\/([0-9a-f]{32})/.exec(path)?.[1] ?? "";
    const provider = /^\/api\/login\/([a-z0-9]+)/.exec(path)?.[1] ?? "";

    switch (route) {
      case "GET /api/providers":
        return send(200, Object.values(providers).map((p) => ({ id: p.id, name: p.name, sms: Boolean(p.startLogin) })));
      case "GET /api/passes":
        return send(200, store.byOwner(user.sub).map((row) => {
          const d = store.open(row).data ?? {};
          return { serial: row.serial, provider: row.provider, card: d.card, balance: d.balance, status: row.status, lastError: row.last_error, updatedAt: new Date(row.checked_at || row.updated_at).toISOString() };
        }));
      case "POST /api/passes": {
        const b = await readJson(req);
        return send(200, await connect(user, b.provider, b.refreshToken, b.serial));
      }
      case "POST /api/login/:provider/start": {
        const p = providers[provider];
        if (!p?.startLogin) throw new HttpError(501, "SMS login isn't available for this shop yet");
        const { phone } = await readJson(req);
        if (typeof phone !== "string" || !/^\+?[\d\s()-]{10,20}$/.test(phone)) throw new HttpError(400, "invalid phone number");
        pendingSms.set(`${user.sub}:${provider}`, { state: await p.startLogin(phone.replace(/[^\d+]/g, "")), exp: Date.now() + 10 * 60_000 });
        return send(200, { ok: true });
      }
      case "POST /api/login/:provider/verify": {
        const p = providers[provider];
        const pending = pendingSms.get(`${user.sub}:${provider}`);
        if (!p?.verifyLogin || !pending || pending.exp < Date.now()) throw new HttpError(400, "start the login again");
        const { code, serial: s } = await readJson(req);
        const { refreshToken } = await p.verifyLogin(pending.state, String(code ?? ""));
        pendingSms.delete(`${user.sub}:${provider}`);
        return send(200, await connect(user, provider, refreshToken, s));
      }
      case "PUT /api/passes/:serial/images": {
        owned(user, serial);
        let files: Files;
        try { files = unzipSync(await readBody(req, 3 * MB)); } catch (e) { throw e instanceof HttpError ? e : new HttpError(400, "send a zip of PNGs"); }
        for (const [name, data] of Object.entries(files)) {
          if (!IMAGE_NAMES.test(name) || data[0] !== 0x89 || data[1] !== 0x50) throw new HttpError(400, `not an allowed pass image: ${name}`);
        }
        store.update(serial, { images: zipSync(files), updated_at: Date.now() });
        return send(200, { ok: true });
      }
      case "GET /api/passes/:serial/pkpass": {
        const row = owned(user, serial);
        return send(200, await pkpass(row, store.open(row)), { "Content-Type": "application/vnd.apple.pkpass", "Content-Disposition": `attachment; filename="${row.provider}.pkpass"` });
      }
      case "DELETE /api/passes/:serial":
        owned(user, serial);
        store.remove(serial);
        return send(200, { ok: true });
    }
    return send(404, { error: "not found" });
  }

  const server = http.createServer((req, res) => {
    const t0 = Date.now();
    handle(req, res)
      .catch((e) => {
        const status = e instanceof HttpError ? e.status : 500;
        if (status === 500) console.error(`${req.method} ${req.url?.split("?")[0]}: ${(e as Error).message}`);
        if (!res.headersSent) {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: status === 500 ? "internal error" : (e as Error).message }));
        }
      })
      .finally(() => console.log(`${req.method} ${req.url?.split("?")[0]} ${res.statusCode} ${Date.now() - t0}ms`));
  });
  return { server, tick, refreshPass };
}
