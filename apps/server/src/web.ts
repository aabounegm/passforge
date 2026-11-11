// Browser-like plumbing for shops whose accounts are websites: a cookie jar (stored encrypted with each pass),
// a fetch that follows redirects through it, and a parser for Chrome's "Copy as cURL (bash)".
// ponytail: no public-suffix list or Secure/SameSite handling; we only ever talk to a few fixed shop hosts over HTTPS.

export interface Cookie { name: string; value: string; domain: string; hostOnly: boolean; path: string; expires?: number }
export type Jar = Cookie[];

export const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

const domainMatch = (host: string, c: Cookie) => (c.hostOnly ? host === c.domain : host === c.domain || host.endsWith("." + c.domain));

/** Applies Set-Cookie headers from a response for `url`. Returns a new jar (expired cookies dropped). */
export function setCookies(jar: Jar, url: URL, headers: string[]): Jar {
  let next = jar.filter((c) => c.expires === undefined || c.expires > Date.now());
  outer: for (const h of headers) {
    const [pair, ...attrs] = h.split(";");
    const eq = pair.indexOf("=");
    if (eq < 1) continue;
    const c: Cookie = { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), domain: url.hostname, hostOnly: true, path: "/" };
    for (const a of attrs) {
      const i = a.indexOf("=");
      const key = (i < 0 ? a : a.slice(0, i)).trim().toLowerCase(), val = i < 0 ? "" : a.slice(i + 1).trim();
      if (key === "domain" && val) {
        const d = val.replace(/^\./, "").toLowerCase();
        if (url.hostname !== d && !url.hostname.endsWith("." + d)) continue outer; // a cookie for someone else: ignore
        Object.assign(c, { domain: d, hostOnly: false });
      } else if (key === "path" && val.startsWith("/")) c.path = val;
      else if (key === "max-age") c.expires = Date.now() + Number(val) * 1000; // wins over Expires
      else if (key === "expires" && c.expires === undefined && !attrs.some((x) => /^\s*max-age=/i.test(x))) {
        const t = Date.parse(val);
        if (!Number.isNaN(t)) c.expires = t;
      }
    }
    next = next.filter((x) => !(x.name === c.name && x.domain === c.domain && x.path === c.path));
    if (c.expires === undefined || c.expires > Date.now()) next.push(c);
  }
  return next;
}

export const cookieHeader = (jar: Jar, url: URL) =>
  jar.filter((c) => domainMatch(url.hostname, c) && url.pathname.startsWith(c.path) && (c.expires === undefined || c.expires > Date.now()))
    .map((c) => `${c.name}=${c.value}`).join("; ");

/** Cookies pasted from a request's Cookie header, scoped to that host. */
export const jarFromHeader = (header: string, host: string): Jar =>
  header.split(";").map((p) => p.trim()).filter((p) => p.includes("=")).map((p) => {
    const i = p.indexOf("=");
    return { name: p.slice(0, i), value: p.slice(i + 1), domain: host, hostOnly: true, path: "/" };
  });

export interface Page { jar: Jar; url: URL; status: number; text: string; headers: Headers }

/** fetch() through the jar, following redirects like a browser (POST -> GET on 301/302/303). */
export async function browse(jar: Jar, url: string | URL, init: { method?: string; form?: Record<string, string>; headers?: Record<string, string> } = {}): Promise<Page> {
  let u = new URL(url), method = init.method ?? "GET";
  let body: string | undefined = init.form && new URLSearchParams(init.form).toString();
  for (let hop = 0; hop < 12; hop++) {
    const cookie = cookieHeader(jar, u);
    const r = await fetch(u, {
      method, body, redirect: "manual", signal: AbortSignal.timeout(25_000),
      headers: {
        "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8", "Accept-Language": "ru-RU,ru;q=0.9",
        ...(body && { "Content-Type": "application/x-www-form-urlencoded" }), ...(cookie && { Cookie: cookie }), ...init.headers,
      },
    });
    jar = setCookies(jar, u, r.headers.getSetCookie());
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) {
      u = new URL(loc, u);
      if (r.status !== 307 && r.status !== 308) { method = "GET"; body = undefined; }
      await r.body?.cancel();
      continue;
    }
    return { jar, url: u, status: r.status, text: await r.text(), headers: r.headers };
  }
  throw new Error("too many redirects");
}

/** Bash-style word splitting for "Copy as cURL (bash)": '…', $'…', "…", backslashes and line continuations. */
function shellWords(s: string): string[] {
  const out: string[] = [];
  let cur = "", word = false, i = 0;
  const ESC: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"' };
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && (s[i + 1] === "\n" || s.startsWith("\r\n", i + 1))) { i += s[i + 1] === "\n" ? 2 : 3; continue; }
    if (/\s/.test(ch)) { if (word) out.push(cur); cur = ""; word = false; i++; continue; }
    word = true;
    if (ch === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) throw new Error("unterminated quote");
      cur += s.slice(i + 1, j); i = j + 1;
    } else if (ch === "$" && s[i + 1] === "'") {
      i += 2;
      while (i < s.length && s[i] !== "'") {
        if (s[i] !== "\\") { cur += s[i++]; continue; }
        const n = s[i + 1];
        if (n === "x") { cur += String.fromCharCode(parseInt(s.slice(i + 2, i + 4), 16)); i += 4; }
        else if (n === "u") { cur += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16)); i += 6; }
        else { cur += ESC[n] ?? n; i += 2; }
      }
      i++;
    } else if (ch === '"') {
      i++;
      while (i < s.length && s[i] !== '"') { if (s[i] === "\\" && i + 1 < s.length) { cur += s[i + 1]; i += 2; } else cur += s[i++]; }
      i++;
    } else if (ch === "\\") { cur += s[i + 1] ?? ""; i += 2; }
    else cur += s[i++];
  }
  if (word) out.push(cur);
  return out;
}

const ARG_OPTIONS = new Set(["-X", "--request", "--data", "--data-raw", "--data-binary", "--data-urlencode", "-d", "-o", "--output", "-u", "--user", "-e", "--referer"]);

/** URL, headers (lower-cased names) and cookies of a pasted "Copy as cURL (bash)" command. */
export function parseCurl(text: string): { url: URL; headers: Record<string, string>; cookie: string } {
  const w = shellWords(text.trim());
  if (w[0] !== "curl") throw new Error("paste the whole \"Copy as cURL (bash)\" text, starting with curl");
  const headers: Record<string, string> = {};
  let url: string | undefined, cookie = "";
  for (let i = 1; i < w.length; i++) {
    const a = w[i];
    if (a === "-H" || a === "--header") {
      const h = w[++i] ?? "", c = h.indexOf(":");
      if (c > 0) headers[h.slice(0, c).trim().toLowerCase()] = h.slice(c + 1).trim();
    } else if (a === "-b" || a === "--cookie") cookie = w[++i] ?? "";
    else if (a === "-A" || a === "--user-agent") headers["user-agent"] = w[++i] ?? "";
    else if (ARG_OPTIONS.has(a)) i++;
    else if (!a.startsWith("-") && !url) url = a;
  }
  if (!url) throw new Error("no URL in the pasted command");
  return { url: new URL(url), headers, cookie: cookie || headers.cookie || "" };
}
