import { createApp } from "./app.ts";
import { oidcVerifier } from "./oidc.ts";
import { PROVIDERS } from "./providers.ts";
import { openStore } from "./store.ts";

const env = (k: string, fallback?: string) => {
  const v = process.env[k] ?? fallback;
  if (v === undefined) throw new Error(`missing env ${k} (see .env.example)`);
  return v;
};

const store = openStore(env("DATA_DIR", "./data"), Buffer.from(env("ENCRYPTION_KEY"), "base64"));
const { server, tick } = createApp(
  {
    publicUrl: env("PUBLIC_URL").replace(/\/$/, ""),
    corsOrigin: env("CORS_ORIGIN"),
    refreshMinutes: Number(env("REFRESH_MINUTES", "30")),
  },
  {
    store,
    providers: PROVIDERS,
    verify: oidcVerifier({ issuer: env("OIDC_ISSUER"), audience: env("OIDC_CLIENT_ID"), group: env("OIDC_GROUP", "passforge") }),
  },
);

const port = Number(env("PORT", "8080"));
server.listen(port, () => console.log(`passforge server on :${port}`));
const timer = setInterval(() => tick().catch((e) => console.error("tick:", e.message)), 60_000);
tick().catch((e) => console.error("tick:", e.message));

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    clearInterval(timer);
    server.close(() => { store.close(); process.exit(0); });
  });
}
