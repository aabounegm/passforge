// Validates Authentik access tokens (issuer, audience, signature via JWKS) and requires group membership.
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface User { sub: string; name?: string }
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function oidcVerifier(cfg: { issuer: string; audience: string; group: string }) {
  let meta: Promise<{ jwks: ReturnType<typeof createRemoteJWKSet>; userinfo?: string }> | undefined;
  const discover = () =>
    (meta ??= fetch(cfg.issuer.replace(/\/?$/, "/") + ".well-known/openid-configuration")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`OIDC discovery: HTTP ${r.status}`))))
      .then((d) => ({ jwks: createRemoteJWKSet(new URL(d.jwks_uri)), userinfo: d.userinfo_endpoint }))
      .catch((e) => { meta = undefined; throw e; }));
  const groupCache = new Map<string, { groups: string[]; exp: number }>();

  /** Authentik puts `groups` in tokens when the "profile" scope mapping is attached; otherwise ask userinfo. */
  async function groupsOf(token: string, p: JWTPayload): Promise<string[]> {
    if (Array.isArray(p.groups)) return p.groups as string[];
    const hit = groupCache.get(token);
    if (hit && hit.exp > Date.now()) return hit.groups;
    const { userinfo } = await discover();
    if (!userinfo) return [];
    const r = await fetch(userinfo, { headers: { Authorization: `Bearer ${token}` } });
    const groups = r.ok ? ((await r.json()).groups ?? []) : [];
    if (groupCache.size > 1000) groupCache.clear();
    groupCache.set(token, { groups, exp: (p.exp ?? 0) * 1000 });
    return groups;
  }

  return async function verify(authorization: string | undefined): Promise<User> {
    const token = /^Bearer (\S+)$/.exec(authorization ?? "")?.[1];
    if (!token) throw new HttpError(401, "sign in first");
    const { jwks } = await discover();
    const { payload } = await jwtVerify(token, jwks, { issuer: cfg.issuer, audience: cfg.audience }).catch(() => {
      throw new HttpError(401, "invalid or expired token");
    });
    if (!payload.sub) throw new HttpError(401, "token has no subject");
    if (!(await groupsOf(token, payload)).includes(cfg.group)) throw new HttpError(403, "your account isn't in the passforge group");
    return { sub: payload.sub, name: (payload.preferred_username ?? payload.name) as string | undefined };
  };
}
