import assert from "node:assert/strict";
import test from "node:test";
import { cookieHeader, parseCurl, setCookies } from "./web.ts";

test("cookie jar: domains, paths, replacement, expiry", () => {
  const id = new URL("https://id.example.ru/auth/realms/r/login");
  let jar = setCookies([], id, ["KC=1; Path=/auth/realms/r/; HttpOnly", "SSO=a; Domain=.example.ru; Path=/", "evil=1; Domain=other.ru"]);
  assert.equal(cookieHeader(jar, new URL("https://id.example.ru/auth/realms/r/x")), "KC=1; SSO=a");
  assert.equal(cookieHeader(jar, new URL("https://shop.example.ru/lk")), "SSO=a", "host-only and path-scoped cookies stay home");
  jar = setCookies(jar, id, ["SSO=b; Domain=example.ru; Path=/", "KC=; Path=/auth/realms/r/; Max-Age=0"]);
  assert.equal(cookieHeader(jar, new URL("https://id.example.ru/auth/realms/r/x")), "SSO=b", "replaced and expired");
});

test("parses Chrome's Copy as cURL (bash)", () => {
  const curl = `curl 'https://magnit.ru/webgate/v3/user/balance' \\
  -H 'accept: */*' \\
  -b $'a=1; b=it\\'s' \\
  -H 'x-device-id: 123' \\
  -H "user-agent: Mozilla \\"5\\""`;
  const r = parseCurl(curl);
  assert.equal(r.url.href, "https://magnit.ru/webgate/v3/user/balance");
  assert.equal(r.cookie, "a=1; b=it's");
  assert.equal(r.headers["x-device-id"], "123");
  assert.equal(r.headers["user-agent"], 'Mozilla "5"');
  assert.throws(() => parseCurl("wget https://x"), /starting with curl/);
});

test("reads Keycloakify kcContext pages", async () => {
  const { kc } = await import("./providers.ts");
  const html = `<script>const kcContext = { "url": { "loginAction": "https:\\/\\/id.example\\/auth?session_code=a&amp;execution=b", "host": "wrong" },
    "pageId": "auth-call", "authCallSettings": { "actionUrl": "https:\\/\\/id.example\\/act", "callNumber": "78000000000",
    "host": "https:\\/\\/id.example\\/api\\/pvs", "stateToken": "eyJ.x.y", "status": "PENDING" } }; kcContext.pageId = "auth-call.ftl";</script>`;
  const k = kc(html);
  assert.equal(k.pageId, "auth-call");
  assert.equal(k.loginAction, "https://id.example/auth?session_code=a&execution=b");
  assert.deepEqual(k.call, { stateToken: "eyJ.x.y", host: "https://id.example/api/pvs", actionUrl: "https://id.example/act", number: "78000000000" });
});
