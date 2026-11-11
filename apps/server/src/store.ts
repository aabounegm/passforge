// SQLite (node:sqlite) with everything personal (pass auth token, upstream refresh token, card data) in one
// AES-256-GCM blob per pass, bound to its serial as associated data.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface Secret {
  authToken: string; // PassKit `authenticationToken`
  session?: string; // upstream session (refresh token or cookie jar JSON); absent once it died
  data?: Record<string, unknown>; // last fetched card data (number, balance, ...)
}

export interface Row {
  serial: string;
  owner: string; // OIDC `sub`
  provider: string;
  status: "ok" | "login_needed" | "error";
  last_error: string | null;
  updated_at: number; // ms; the pass's Last-Modified
  checked_at: number; // ms; last upstream attempt
  next_refresh: number; // ms
  images: Uint8Array | null; // zip of PNGs, rendered by the web app
  secret: Uint8Array;
}

export function openStore(dir: string, key: Buffer) {
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes (base64)");
  if (dir !== ":memory:") mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(dir === ":memory:" ? dir : join(dir, "passforge.sqlite"));
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS passes (
      serial TEXT PRIMARY KEY, owner TEXT NOT NULL, provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ok', last_error TEXT,
      updated_at INTEGER NOT NULL, checked_at INTEGER NOT NULL DEFAULT 0, next_refresh INTEGER NOT NULL DEFAULT 0,
      images BLOB, secret BLOB NOT NULL);
    CREATE INDEX IF NOT EXISTS passes_owner ON passes(owner);`);

  const seal = (serial: string, s: Secret) => {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv).setAAD(Buffer.from(serial));
    const body = Buffer.concat([c.update(JSON.stringify(s)), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), body]);
  };
  const open = (row: Row): Secret => {
    const b = Buffer.from(row.secret);
    const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12)).setAAD(Buffer.from(row.serial));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString());
  };

  return {
    open,
    get: (serial: string) => db.prepare("SELECT * FROM passes WHERE serial = ?").get(serial) as Row | undefined,
    byOwner: (owner: string) => db.prepare("SELECT * FROM passes WHERE owner = ? ORDER BY serial").all(owner) as unknown as Row[],
    due: (now: number) =>
      (db.prepare("SELECT serial FROM passes WHERE next_refresh <= ? AND status != 'login_needed'").all(now) as { serial: string }[]).map((r) => r.serial),
    insert(serial: string, owner: string, provider: string, s: Secret) {
      db.prepare("INSERT INTO passes (serial, owner, provider, updated_at, secret) VALUES (?, ?, ?, ?, ?)").run(serial, owner, provider, Date.now(), seal(serial, s));
    },
    /** One UPDATE statement, so a rotated refresh token is persisted atomically. */
    update(serial: string, f: { secret?: Secret; status?: Row["status"]; last_error?: string | null; updated_at?: number; checked_at?: number; next_refresh?: number; images?: Uint8Array }) {
      const cols = Object.entries({ ...f, secret: f.secret && seal(serial, f.secret) }).filter(([, v]) => v !== undefined);
      db.prepare(`UPDATE passes SET ${cols.map(([k]) => `${k} = ?`).join(", ")} WHERE serial = ?`).run(...(cols.map(([, v]) => v) as never[]), serial);
    },
    remove: (serial: string) => db.prepare("DELETE FROM passes WHERE serial = ?").run(serial),
    close: () => db.close(),
  };
}

export type Store = ReturnType<typeof openStore>;
