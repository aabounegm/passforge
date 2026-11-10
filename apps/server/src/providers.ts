// Upstream loyalty APIs. All outbound traffic goes through global fetch, so the "fetcher" can be relocated to a
// Russian IP with HTTPS_PROXY + NODE_USE_ENV_PROXY=1 (see README), no code change.
import { aptekiplus, type PassJson } from "@passforge/core";

/** The upstream says the session is gone (not a network hiccup): the user has to sign in again. */
export class SessionDead extends Error {}

export interface Provider {
  id: string;
  name: string;
  /** New tokens; the refresh token may rotate and must be persisted before anything else. */
  refresh(refreshToken: string): Promise<{ refreshToken: string; accessToken: string }>;
  fetch(accessToken: string): Promise<Record<string, unknown>>;
  pass(data: Record<string, unknown> | undefined, loginNeeded: boolean): PassJson;
  /** SMS login (optional until the upstream flow is traced): returns opaque state for verifyLogin. */
  startLogin?(phone: string): Promise<unknown>;
  verifyLogin?(state: unknown, code: string): Promise<{ refreshToken: string }>;
}

type Json = any; // upstream JSON, checked field by field
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

async function call(url: string, init: RequestInit = {}) {
  const r = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20_000),
    headers: { "User-Agent": UA, Accept: "application/json", "Content-Type": "application/json", ...init.headers },
  });
  const text = await r.text();
  let json: Json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: r.status, json, html: !json && /<html/i.test(text) };
}

// ---- АптекиПлюс (Laravel Passport; access JWT lives 1800 s; refresh token rotates, old one has a short grace) -----
const AP = "https://aptekiplus.ru/api/v1";

export const aptekiProvider: Provider = {
  id: "aptekiplus",
  name: "АптекиПлюс",
  async refresh(refreshToken) {
    const r = await call(`${AP}/auth/user/token/refresh`, { method: "POST", body: JSON.stringify({ refreshToken }) });
    const tok = r.json?.data?.tokens;
    if (r.status === 200 && tok?.refreshToken && tok?.accessToken) return { refreshToken: tok.refreshToken, accessToken: tok.accessToken };
    // A JSON 4xx is Passport talking ("The refresh token is invalid."); an HTML page is QRATOR or a proxy.
    if (r.status >= 400 && r.status < 500 && r.json) throw new SessionDead(`refresh rejected (${r.status})`);
    throw new Error(`refresh failed: HTTP ${r.status}${r.html ? " (HTML, maybe QRATOR)" : ""}`);
  },
  async fetch(accessToken) {
    const r = await call(`${AP}/mindbox/user-data`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const d = r.json?.data;
    if (r.status !== 200 || !d) throw new Error(`user-data failed: HTTP ${r.status}${r.html ? " (HTML, maybe QRATOR)" : ""}`);
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
    const d = (data ?? {}) as { card?: string; balance?: number; expiring?: { amount: number; date: string }; changedAt?: number };
    return aptekiplus({ card: d.card as string, balance: d.balance, expiring: d.expiring, asOf: d.changedAt ? new Date(d.changedAt) : undefined, loginNeeded });
  },
  // ponytail: SMS login not wired yet. The site's HTML sits behind QRATOR's JS challenge, so the login requests
  // (/api/v2/auth/user/login, /auth-session, SMS code) need a DevTools capture first. Until then users paste a
  // refresh token from a private-window session.
};

export const PROVIDERS: Record<string, Provider> = { aptekiplus: aptekiProvider };
