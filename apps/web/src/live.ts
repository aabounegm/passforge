// Live cards: only when the update server is configured and the user is signed in via Authentik.
import { zipSync } from "@passforge/core";
import { aptekiArt } from "./art.ts";
import { accessToken, api, liveEnabled, signIn, signOut, userName } from "./auth.ts";
import { t } from "./i18n.ts";
import { errText, h, saveFile } from "./ui.ts";

interface LivePass { serial: string; provider: string; card?: string; status: string; updatedAt: string; balance?: number; lastError?: string }
interface Provider { id: string; name: string; sms: boolean }

const ART: Record<string, () => Promise<Record<string, Uint8Array>>> = { aptekiplus: aptekiArt };

async function download(serial: string) {
  saveFile(await (await api(`/api/passes/${serial}/pkpass`)).blob(), `${serial}.pkpass`);
}

/** Creates or re-logs a live pass, uploads its artwork (rendered here, the server has no canvas), downloads it. */
async function finish(provider: string, serial: string) {
  await api(`/api/passes/${serial}/images`, { method: "PUT", headers: { "Content-Type": "application/zip" }, body: zipSync(await ART[provider]()) as BodyInit });
  await download(serial);
}

function loginForm(p: Provider, onDone: () => void, serial?: string) {
  const status = h("p", { class: "muted" });
  const run = (fn: () => Promise<void>) => async (e: Event) => {
    e.preventDefault();
    status.textContent = "…";
    try { await fn(); status.textContent = t("liveDone"); onDone(); } catch (err) { status.textContent = errText(err); }
  };
  const post = (path: string, body: unknown) =>
    api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

  const token = h("input", { class: "wide mono", placeholder: "refreshToken", autocomplete: "off" });
  const tokenForm = h("form", { onsubmit: run(async () => {
    const r = await post("/api/passes", { provider: p.id, refreshToken: token.value.trim(), serial });
    token.value = "";
    await finish(p.id, r.serial);
  }) }, h("p", {}, t(`tokenHelp_${p.id}` as never)), token, h("button", {}, t("liveConnect")));

  if (!p.sms) return h("div", {}, tokenForm, status);
  const phone = h("input", { type: "tel", placeholder: "+7 900 000-00-00", autocomplete: "tel" });
  const code = h("input", { inputmode: "numeric", placeholder: "SMS", autocomplete: "one-time-code", hidden: true });
  const smsForm = h("form", { onsubmit: async (e: Event) => {
    if (!code.hidden) return run(async () => {
      const r = await post(`/api/login/${p.id}/verify`, { code: code.value, serial });
      await finish(p.id, r.serial);
    })(e);
    e.preventDefault();
    try { await post(`/api/login/${p.id}/start`, { phone: phone.value }); code.hidden = false; code.focus(); status.textContent = t("smsSent"); }
    catch (err) { status.textContent = errText(err); }
  } }, phone, code, h("button", {}, t("liveConnect")));
  return h("div", {}, smsForm, h("details", {}, h("summary", {}, t("orToken")), tokenForm), status);
}

export async function liveView(): Promise<HTMLElement> {
  const root = h("section", {}, h("h2", {}, t("liveTitle")), h("p", {}, t("liveIntro")));
  if (!liveEnabled) return root.appendChild(h("p", { class: "muted" }, t("liveOff"))), root;
  if (!accessToken()) return root.appendChild(h("button", { onclick: signIn }, t("signIn"))), root;
  root.append(h("p", {}, t("signedInAs"), " ", h("b", {}, userName() ?? ""), " ", h("button", { onclick: signOut }, t("signOut"))));
  const refresh = () => liveView().then((v) => root.replaceWith(v));
  try {
    const [passes, providers] = await Promise.all([
      api("/api/passes").then((r) => r.json() as Promise<LivePass[]>),
      api("/api/providers").then((r) => r.json() as Promise<Provider[]>),
    ]);
    const name = (id: string) => providers.find((p) => p.id === id)?.name ?? id;
    root.append(h("h3", {}, t("livePasses")), passes.length ? h("ul", { class: "live" }, ...passes.map((p) => {
      const relogin = h("div", { hidden: true }, loginForm(providers.find((x) => x.id === p.provider)!, refresh, p.serial));
      return h("li", {},
        h("b", {}, name(p.provider)), " ", p.card ?? "", " · ",
        h("span", { class: p.status === "ok" ? "ok" : "warn" }, t(`status_${p.status}` as never)),
        p.balance !== undefined ? ` · ${p.balance}` : "", " · ", new Date(p.updatedAt).toLocaleString(),
        p.lastError ? h("div", { class: "muted" }, p.lastError) : null,
        h("div", {},
          h("button", { onclick: () => download(p.serial).catch((e) => alert(errText(e))) }, t("download")),
          h("button", { onclick: () => (relogin.hidden = !relogin.hidden) }, t("relogin")),
          h("button", { onclick: async () => { if (confirm(t("confirmDelete"))) { await api(`/api/passes/${p.serial}`, { method: "DELETE" }); refresh(); } } }, t("delete"))),
        relogin);
    })) : h("p", { class: "muted" }, t("liveNone")));
    for (const p of providers) root.append(h("h3", {}, t("liveAdd"), " ", p.name), loginForm(p, refresh));
  } catch (e) {
    root.append(h("p", { class: "warn" }, errText(e)));
  }
  return root;
}
