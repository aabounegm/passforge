// Upstream loyalty accounts. All outbound traffic goes through global fetch, so the "fetcher" can be relocated with
// HTTPS_PROXY + NODE_USE_ENV_PROXY=1 (see README), no code change.
import { aptekiplus, magnit, x5, type PassJson } from "@passforge/core";
import { decode } from "turbo-stream";
import { browse, cookieHeader, jarFromHeader, parseCurl, setCookies, UA, type Jar, type Page } from "./web.ts";

/** The upstream says the session is gone (not a network hiccup): the user has to sign in again. */
export class SessionDead extends Error {}
/** Something the user did wrong (bad paste, wrong code): shown to them as is. */
export class UserError extends Error {}

export type Prompt = { kind: "sms"; length: number } | { kind: "call"; number: string };
export interface LoginStep { state: unknown; prompt: Prompt; error?: string }

export interface Provider {
  id: string;
  name: string;
  /** What users can paste: a refresh token, or a "Copy as cURL (bash)" of the balance request. */
  paste: "token" | "curl";
  /** Pasted text -> stored session string (validated; throws UserError). */
  fromPaste(text: string): string;
  /** Reads the card data with the stored session. `save` persists an updated session (rotated token, new cookies)
   * and is called before anything else can fail, so a rotation is never lost. */
  sync(session: string, save: (session: string) => void): Promise<Record<string, unknown>>;
  pass(data: Record<string, unknown> | undefined, loginNeeded: boolean): PassJson;
  /** Phone login run by the server (optional). */
  startLogin?(phone: string): Promise<LoginStep>;
  continueLogin?(state: unknown, code?: string): Promise<LoginStep | { session: string }>;
}

type Json = any; // upstream JSON, checked field by field
type Data = { card?: string; balance?: number; changedAt?: number };
const asOf = (d: Data) => (d.changedAt ? new Date(d.changedAt) : undefined);

async function callJson(url: string, init: RequestInit = {}) {
  const r = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20_000),
    headers: { "User-Agent": UA, Accept: "application/json", "Content-Type": "application/json", ...init.headers },
  });
  const text = await r.text();
  let json: Json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: r.status, json, html: !json && /<html/i.test(text), setCookies: r.headers.getSetCookie() };
}

function pastedRequest(text: string, host: string) {
  let req;
  try { req = parseCurl(text); } catch (e) { throw new UserError((e as Error).message); }
  if (req.url.hostname !== host) throw new UserError(`paste a request to ${host}`);
  if (!req.cookie) throw new UserError("the pasted request has no cookies; copy it while signed in");
  return req;
}

// ---- АптекиПлюс (Laravel Passport; access JWT lives 1800 s; refresh token rotates, old one has a short grace) -----
const AP = "https://aptekiplus.ru/api/v1";

export const aptekiProvider: Provider = {
  id: "aptekiplus",
  name: "АптекиПлюс",
  paste: "token",
  fromPaste(text) {
    const t = text.trim();
    if (!/^\S{20,8192}$/.test(t)) throw new UserError("paste the refreshToken value");
    return t;
  },
  async sync(refreshToken, save) {
    const r = await callJson(`${AP}/auth/user/token/refresh`, { method: "POST", body: JSON.stringify({ refreshToken }) });
    const tok = r.json?.data?.tokens;
    if (r.status !== 200 || !tok?.refreshToken || !tok?.accessToken) {
      // A JSON 4xx is Passport talking ("The refresh token is invalid."); an HTML page is QRATOR or a proxy.
      if (r.status >= 400 && r.status < 500 && r.json) throw new SessionDead(`refresh rejected (${r.status})`);
      throw new Error(`refresh failed: HTTP ${r.status}${r.html ? " (HTML, maybe QRATOR)" : ""}`);
    }
    save(tok.refreshToken);
    const u = await callJson(`${AP}/mindbox/user-data`, { headers: { Authorization: `Bearer ${tok.accessToken}` } });
    const d = u.json?.data;
    if (u.status !== 200 || !d) throw new Error(`user-data failed: HTTP ${u.status}${u.html ? " (HTML, maybe QRATOR)" : ""}`);
    const card = d.discountCards?.find((c: Json) => c.status?.ids?.systemName === "Activated") ?? d.discountCards?.[0];
    const bal = d.balances?.find((b: Json) => b.systemName === "BonusMainInt") ?? d.balances?.[0];
    if (!card?.ids?.number) throw new Error("user-data has no discount card");
    return {
      card: card.ids.number,
      balance: bal?.balance?.available,
      expiring: bal?.nearestExpiration?.total ? { amount: bal.nearestExpiration.total, date: bal.nearestExpiration.date } : undefined,
    };
  },
  pass(data, loginNeeded) {
    const d = (data ?? {}) as Data & { expiring?: { amount: number; date: string } };
    return aptekiplus({ card: d.card as string, balance: d.balance, expiring: d.expiring, asOf: asOf(d), loginNeeded });
  },
};

// ---- Пятёрочка / X5 Клуб (x5club.ru, a React Router app; X5 ID = Keycloak realm ssox5id) -------------------------
// Login: phone -> X5 picks a free call to its number or an SMS code -> optional marketing consent (always declined)
// and passkey offer (always skipped) -> back to x5club.ru with its session cookies. The site session lasts 7 days;
// after that x5club.ru re-authenticates silently via X5 ID's own cookies (kept in the same jar).
const X5_LK = "https://x5club.ru/lk";
const X5_DATA = "https://x5club.ru/lk.data?_routes=routes%2F_auth%2Croutes%2F_auth.lk";

/** Fields of the window.kcContext object Keycloakify pages embed (a JS literal, read with regexes). */
export function kc(html: string) {
  const str = (key: string, src = html) => {
    const m = new RegExp(`"${key}"\\s*:\\s*"?((?:[^"\\\\,}]|\\\\.)*)"?`).exec(src);
    return m ? JSON.parse(`"${m[1].trim()}"`).replace(/&amp;/g, "&") as string : undefined;
  };
  const callAt = html.indexOf('"authCallSettings"');
  const callBlock = callAt < 0 ? "" : html.slice(callAt, html.indexOf("}", callAt) + 1);
  return {
    pageId: str("pageId")?.replace(/\.ftl$/, ""), loginAction: str("loginAction"), message: str("summary"),
    call: { stateToken: str("stateToken", callBlock), host: str("host", callBlock), actionUrl: str("actionUrl", callBlock), number: str("callNumber", callBlock) },
  };
}

interface X5State { jar: Jar; page: string; phone: string; loginAction: string; call?: { stateToken: string; host: string; actionUrl: string; number: string } }

function x5Step(phone: string, p: Page, error?: string): LoginStep {
  const k = kc(p.text);
  if (k.pageId === "auth-call" && k.call.stateToken && k.call.actionUrl && k.call.host && k.call.number) {
    const state: X5State = { jar: p.jar, page: k.pageId, phone, loginAction: k.loginAction ?? "", call: k.call as X5State["call"] };
    return { state, prompt: { kind: "call", number: "+" + k.call.number }, error };
  }
  if (k.pageId === "sms-check" && k.loginAction) {
    return { state: { jar: p.jar, page: k.pageId, phone, loginAction: k.loginAction } satisfies X5State, prompt: { kind: "sms", length: 4 }, error };
  }
  throw new UserError(k.message ?? `X5 showed an unexpected step (${k.pageId ?? `HTTP ${p.status}`}); try again later`);
}

/** After verification: decline marketing, skip passkeys, land on x5club.ru with a session. */
async function x5Finish(p: Page): Promise<{ session: string }> {
  for (let i = 0; i < 6; i++) {
    if (p.url.hostname === "x5club.ru") return { session: JSON.stringify(p.jar) };
    const k = kc(p.text);
    if (!k.loginAction) break;
    if (k.pageId === "marketing-agreement-update") p = await browse(p.jar, k.loginAction, { method: "POST", form: {} });
    else if (k.pageId === "webauthn-register") {
      p = await browse(p.jar, k.loginAction, {
        method: "POST", form: { clientDataJSON: "", attestationObject: "", publicKeyCredentialId: "", authenticatorLabel: "", transports: "", error: "" },
      });
    } else throw new UserError(k.message ?? `X5 showed an unexpected step (${k.pageId}); try again later`);
  }
  throw new Error(`X5 login didn't return to x5club.ru (ended on ${p.url.hostname}, HTTP ${p.status})`);
}

async function x5Data(jar: Jar) {
  const r = await fetch(X5_DATA, { headers: { "User-Agent": UA, Cookie: cookieHeader(jar, new URL(X5_DATA)) }, signal: AbortSignal.timeout(25_000) });
  const text = await r.text();
  return { r, text, jar: setCookies(jar, new URL(X5_DATA), r.headers.getSetCookie()), loggedOut: text.startsWith('[["SingleFetchRedirect"') };
}

export const x5Provider: Provider = {
  id: "x5club",
  name: "Пятёрочка · X5 Клуб",
  paste: "curl",
  fromPaste(text) {
    const req = pastedRequest(text, "x5club.ru");
    return JSON.stringify(jarFromHeader(req.cookie, "x5club.ru"));
  },
  async sync(session, save) {
    let jar: Jar = JSON.parse(session);
    let res = await x5Data(jar);
    if (res.loggedOut) {
      // Site session over: let x5club.ru try a silent re-login through X5 ID's cookies, like a browser would.
      const p = await browse(res.jar, X5_LK);
      if (p.url.hostname !== "x5club.ru") throw new SessionDead("X5 session ended");
      res = await x5Data(p.jar);
      if (res.loggedOut) throw new SessionDead("X5 session ended");
    }
    if (JSON.stringify(res.jar) !== JSON.stringify(jar)) save(JSON.stringify((jar = res.jar)));
    if (res.r.status !== 200) throw new Error(`lk.data: HTTP ${res.r.status}`);
    const { value, done } = await decode(new Response(res.text).body!);
    await done;
    const lk = (value as Json)?.["routes/_auth.lk"]?.data;
    const [cards, balance] = await Promise.all([lk?.cardsResponse, lk?.balancePromise]);
    const card = cards?.data?.find((c: Json) => c.cardStatus === "A" && c.category === "loyalty") ?? cards?.data?.[0];
    if (!card?.cardNo || typeof balance?.data?.balance !== "number") throw new Error("lk.data has no card or balance");
    return { card: String(card.cardNo), balance: balance.data.balance };
  },
  pass(data, loginNeeded) {
    const d = (data ?? {}) as Data;
    return x5(d.card as string, { live: { balance: d.balance, loginNeeded, asOf: asOf(d) } });
  },
  async startLogin(phone) {
    const digits = phone.replace(/\D/g, "").replace(/^8(?=\d{10}$)/, "7").replace(/^(?=\d{10}$)/, "7");
    if (!/^7\d{10}$/.test(digits)) throw new UserError("enter a Russian mobile number");
    const start = await browse([], X5_LK);
    const k = kc(start.text);
    if (k.pageId !== "start-page" || !k.loginAction) throw new Error(`X5 login page not found (${start.url.hostname}, HTTP ${start.status})`);
    const p = await browse(start.jar, k.loginAction, { method: "POST", form: { mobile_phone: digits, rememberMe: "on" } });
    return x5Step(digits, p);
  },
  async continueLogin(raw, code) {
    const s = raw as X5State;
    if (s.page === "auth-call" && s.call) {
      const r = await callJson(`${s.call.host}/public/v1/call/authentication/status`, {
        headers: { Authorization: `Bearer ${s.call.stateToken}`, Cookie: cookieHeader(s.jar, new URL(s.call.host)) },
      });
      const status = r.json?.status;
      if (status === "PENDING") return { state: s, prompt: { kind: "call", number: "+" + s.call.number } };
      if (status !== "SUCCESS") throw new UserError("the call wasn't confirmed; start again");
      return x5Finish(await browse(s.jar, s.call.actionUrl, { method: "POST", form: {} }));
    }
    if (!/^\d{4}$/.test(code ?? "")) throw new UserError("enter the 4-digit code from the SMS");
    const form: Record<string, string> = { mobile_phone: s.phone, rememberMe: "on" };
    [...code!].forEach((d, i) => (form[`code${i + 1}`] = d));
    const p = await browse(s.jar, s.loginAction, { method: "POST", form });
    if (kc(p.text).pageId === "sms-check") return x5Step(s.phone, p, kc(p.text).message ?? "wrong code");
    return x5Finish(p);
  },
};

// ---- Магнит (magnit.ru webgate; login needs a captcha on magnit.ru, so users paste a signed-in request) ------------
// Kept from the paste: cookies + the browser's x-device/x-app headers (the session is tied to the device id).
// Group-IB anti-fraud headers (x-gib-*) are deliberately dropped; the API answers without them.
const MAGNIT = "https://magnit.ru";

interface MagnitSession { jar: Jar; headers: Record<string, string> }

export const magnitProvider: Provider = {
  id: "magnit",
  name: "Магнит",
  paste: "curl",
  fromPaste(text) {
    const req = pastedRequest(text, "magnit.ru");
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => (k.startsWith("x-") && !k.startsWith("x-gib-")) || k === "user-agent"));
    if (!headers["x-device-id"]) throw new UserError("copy a webgate request (it has an x-device-id header)");
    return JSON.stringify({ jar: jarFromHeader(req.cookie, "magnit.ru"), headers } satisfies MagnitSession);
  },
  async sync(session, save) {
    const s: MagnitSession = JSON.parse(session);
    const get = async (path: string) => {
      const url = new URL(path, MAGNIT);
      const r = await callJson(url.href, { headers: { ...s.headers, Cookie: cookieHeader(s.jar, url) } });
      const jar = setCookies(s.jar, url, r.setCookies);
      if (JSON.stringify(jar) !== JSON.stringify(s.jar)) { s.jar = jar; save(JSON.stringify(s)); }
      if (r.status === 401 && r.json) throw new SessionDead(`Magnit: ${r.json.code ?? "unauthorized"}`);
      if (r.status !== 200 || !r.json) throw new Error(`${path}: HTTP ${r.status}${r.html ? " (HTML)" : ""}`);
      return r.json;
    };
    const totp = await get("/webgate/v1/user/totp"); // its `identifier` is the card number; the code itself is ignored
    const bal = await get("/webgate/v3/user/balance");
    if (!/^\d{16}$/.test(String(totp.identifier)) || typeof bal.totalPointBalance !== "number") throw new Error("unexpected Magnit response");
    return { card: String(totp.identifier), balance: bal.totalPointBalance };
  },
  pass(data, loginNeeded) {
    const d = (data ?? {}) as Data;
    return magnit(d.card as string, undefined, { balance: d.balance, loginNeeded, asOf: asOf(d) });
  },
};

// ponytail: АптекиПлюс is left out: QRATOR challenges its API from both the VPS and the homelab (see README). Add it
// back if the fetcher runs on a network the API accepts (HTTPS_PROXY), or let the AVAILABLE list come from config then.
export const PROVIDERS: Record<string, Provider> = { x5club: x5Provider, magnit: magnitProvider };
