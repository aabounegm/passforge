// OIDC Authorization Code + PKCE against Authentik (public client), straight from the static page.
// Tokens live in sessionStorage; when the access token expires the user signs in again (silent if the
// Authentik session is still alive).
const ISSUER = import.meta.env.VITE_OIDC_ISSUER as string | undefined;
const CLIENT_ID = import.meta.env.VITE_OIDC_CLIENT_ID as string | undefined;
export const SERVER = (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/$/, "");
export const liveEnabled = Boolean(ISSUER && CLIENT_ID && SERVER);

const KEY = "passforge.auth";
const redirectUri = () => location.origin + import.meta.env.BASE_URL;
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

let discovery: Promise<{ authorization_endpoint: string; token_endpoint: string; end_session_endpoint?: string }> | undefined;
const config = () =>
  (discovery ??= fetch(ISSUER!.replace(/\/?$/, "/") + ".well-known/openid-configuration").then((r) => {
    if (!r.ok) throw new Error(`OIDC discovery failed: ${r.status}`);
    return r.json();
  }));

export async function signIn() {
  const verifier = random(), state = random();
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  sessionStorage.setItem(KEY + ".pending", JSON.stringify({ verifier, state, hash: location.hash }));
  const u = new URL((await config()).authorization_endpoint);
  u.search = new URLSearchParams({
    response_type: "code", client_id: CLIENT_ID!, redirect_uri: redirectUri(), scope: "openid profile",
    state, code_challenge: challenge, code_challenge_method: "S256",
  }).toString();
  location.assign(u);
}

/** Call once on load: finishes a sign-in redirect if there is one. */
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  const pending = JSON.parse(sessionStorage.getItem(KEY + ".pending") ?? "null");
  if (!liveEnabled || !pending || !(q.has("code") || q.has("error"))) return;
  sessionStorage.removeItem(KEY + ".pending");
  history.replaceState(null, "", redirectUri() + pending.hash);
  if (q.get("state") !== pending.state || !q.get("code")) throw new Error(q.get("error_description") ?? q.get("error") ?? "Sign-in failed");
  const r = await fetch((await config()).token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: q.get("code")!, redirect_uri: redirectUri(), client_id: CLIENT_ID!, code_verifier: pending.verifier }),
  });
  const tok = await r.json();
  if (!r.ok) throw new Error(tok.error_description ?? tok.error ?? `token endpoint: ${r.status}`);
  sessionStorage.setItem(KEY, JSON.stringify({ access: tok.access_token, idToken: tok.id_token, exp: Date.now() + (tok.expires_in - 30) * 1000 }));
}

export function accessToken(): string | undefined {
  const s = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
  return s && s.exp > Date.now() ? s.access : undefined;
}

/** Display name from the (unverified, display-only) token payload. */
export function userName() {
  const tok = accessToken();
  if (!tok) return undefined;
  const bin = atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"));
  const c = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
  return (c.name || c.preferred_username || c.email || c.sub) as string;
}

export async function signOut() {
  const s = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
  sessionStorage.removeItem(KEY);
  const end = (await config()).end_session_endpoint;
  if (end && s?.idToken) location.assign(`${end}?${new URLSearchParams({ id_token_hint: s.idToken, post_logout_redirect_uri: redirectUri() })}`);
  else location.reload();
}

/** fetch() to the update server with the user's access token. */
export async function api(path: string, init: RequestInit = {}) {
  const tok = accessToken();
  if (!tok) throw new Error("signed out");
  const r = await fetch(SERVER + path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${tok}` } });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error ?? `${r.status} ${r.statusText}`);
  }
  return r;
}
