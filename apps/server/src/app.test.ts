import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { aptekiplus, readPkpass, zipSync } from "@passforge/core";
import { createApp } from "./app.ts";
import { HttpError } from "./oidc.ts";
import { SessionDead, type Provider } from "./providers.ts";
import { openStore } from "./store.ts";

// Fake upstream: refresh tokens rotate rt0 -> rt1 -> ...; "dead" tokens are rejected like Passport does.
let balance = 10;
const used: string[] = [];
const fake: Provider = {
  id: "aptekiplus",
  name: "Fake",
  async refresh(rt) {
    used.push(rt);
    if (rt === "dead") throw new SessionDead("refresh rejected (401)");
    if (rt === "flaky") throw new Error("refresh failed: HTTP 403 (HTML, maybe QRATOR)");
    return { refreshToken: `rt${used.length}`, accessToken: "at" };
  },
  async fetch() { return { card: "12345678", balance }; },
  pass: (d, loginNeeded) => aptekiplus({ card: (d?.card as string) ?? "12345678", balance: d?.balance as number, loginNeeded }),
};

test("live pass lifecycle", async (t) => {
  const store = openStore(":memory:", randomBytes(32));
  const users: Record<string, string> = { "Bearer alice": "alice", "Bearer bob": "bob" };
  const { server, tick } = createApp(
    { publicUrl: "https://pf.example", corsOrigin: "https://example.github.io", refreshMinutes: 30 },
    { store, providers: { aptekiplus: fake }, verify: async (a) => { if (!users[a ?? ""]) throw new HttpError(401, "no"); return { sub: users[a!] }; } },
  );
  await new Promise<void>((ok) => server.listen(0, ok));
  t.after(() => { server.close(); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = (path: string, init: RequestInit = {}, who = "alice") =>
    fetch(base + path, { ...init, headers: { Authorization: `Bearer ${who}`, "Content-Type": "application/json", ...init.headers } });

  assert.equal((await api("/api/passes", {}, "mallory")).status, 401);
  assert.equal((await api("/api/passes", { method: "POST", body: JSON.stringify({ provider: "aptekiplus", refreshToken: "dead" }) })).status, 400);
  assert.equal(store.byOwner("alice").length, 0, "rejected session leaves no pass behind");

  const { serial } = await (await api("/api/passes", { method: "POST", body: JSON.stringify({ provider: "aptekiplus", refreshToken: "rt0" }) })).json();
  const row = () => store.get(serial)!;
  assert.equal(store.open(row()).refreshToken, "rt2", "rotated token persisted");
  assert.equal((await api(`/api/passes/${serial}/pkpass`, {}, "bob")).status, 404, "other users can't see it");

  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  assert.equal((await api(`/api/passes/${serial}/images`, { method: "PUT", body: zipSync({ "evil.js": png }) as BodyInit })).status, 400);
  assert.equal((await api(`/api/passes/${serial}/images`, { method: "PUT", body: zipSync({ "icon.png": png }) as BodyInit })).status, 200);
  // zip bomb: 20 MB of zeros compresses to a few KB; rejected before inflating
  const bomb = zipSync({ "strip.png": new Uint8Array(20 << 20) }, { level: 9 });
  assert.ok(bomb.length < 100_000);
  assert.equal((await api(`/api/passes/${serial}/images`, { method: "PUT", body: bomb as BodyInit })).status, 413);
  assert.equal((await api(`/api/passes/x`, { method: "POST", body: JSON.stringify({ provider: "constructor", refreshToken: "x" }) })).status, 404);
  assert.equal((await api("/api/passes", { method: "POST", body: JSON.stringify({ provider: "constructor", refreshToken: "x" }) })).status, 400);

  const dl = await readPkpass(new Uint8Array(await (await api(`/api/passes/${serial}/pkpass`)).arrayBuffer()));
  assert.equal(dl.pass.webServiceURL, "https://pf.example");
  assert.equal(dl.pass.storeCard!.headerFields![0].value, "10,00");
  assert.ok(dl.files["icon.png"]);
  const authToken = dl.pass.authenticationToken as string;
  assert.ok(authToken.length >= 16);

  // PassKit endpoint as FossWallet calls it
  const passUrl = `${base}/v1/passes/pass.passforge.aptekiplus/${serial}`;
  const poll = (since?: string, tok = authToken) =>
    fetch(passUrl, { headers: { Authorization: `ApplePass ${tok}`, ...(since && { "If-Modified-Since": since }) } });
  assert.equal((await poll(undefined, "wrong-token-wrong-token")).status, 401);
  assert.equal((await fetch(`${base}/v1/passes/pass.passforge.aptekiplus/%E0%A4%A`)).status, 401, "bad escape is not a 500");
  const first = await poll();
  assert.equal(first.status, 200);
  const lastMod = first.headers.get("last-modified")!;
  assert.equal((await poll(lastMod)).status, 304);

  // unchanged data: no new Last-Modified; changed balance: new pass
  await new Promise((r) => setTimeout(r, 1100));
  store.update(serial, { next_refresh: 0 });
  await tick();
  assert.equal((await poll(lastMod)).status, 304);
  balance = 25;
  store.update(serial, { next_refresh: 0 });
  await tick();
  const changed = await poll(lastMod);
  assert.equal(changed.status, 200);
  assert.equal((await readPkpass(new Uint8Array(await changed.arrayBuffer()))).pass.storeCard!.headerFields![0].value, "25,00");

  // transient upstream error keeps the pass; dead session flips it to "login needed"
  store.update(serial, { secret: { ...store.open(row()), refreshToken: "flaky" }, next_refresh: 0 });
  await tick();
  assert.equal(row().status, "error");
  assert.equal(store.open(row()).refreshToken, "flaky");
  await new Promise((r) => setTimeout(r, 1100));
  store.update(serial, { secret: { ...store.open(row()), refreshToken: "dead" }, next_refresh: 0 });
  await tick();
  assert.equal(row().status, "login_needed");
  const dead = await readPkpass(new Uint8Array(await (await poll(changed.headers.get("last-modified")!)).arrayBuffer()));
  assert.equal(dead.pass.storeCard!.headerFields![0].value, "Нужен вход");

  // re-login keeps the serial, so the pass in FossWallet recovers
  const again = await api("/api/passes", { method: "POST", body: JSON.stringify({ provider: "aptekiplus", refreshToken: "rtX", serial }) });
  assert.equal((await again.json()).serial, serial);
  assert.equal(row().status, "ok");

  assert.equal((await api(`/api/passes/${serial}`, { method: "DELETE" })).status, 200);
  assert.equal((await poll()).status, 401);
});
