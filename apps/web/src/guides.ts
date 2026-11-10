// Extraction guides for cards that already have an official (signed, self-updating) pass.
import { t } from "./i18n.ts";
import { h } from "./ui.ts";

/** Runs on cards.premiumbonus.su (same origin as its API, so no CORS). Shows the card's wallet_link and a profile
 * editor. Serialized into a bookmarklet, so it must not reference anything outside itself. */
async function premiumBonusTool() {
  const slug = location.pathname.split("/").filter(Boolean)[0];
  const token = slug && localStorage.getItem(slug + "_token");
  if (location.hostname !== "cards.premiumbonus.su" || !token) {
    alert("passforge: open cards.premiumbonus.su/<brand>/login and sign in first.\nСначала войдите на cards.premiumbonus.su/<бренд>/login.");
    return;
  }
  const api = (method: string, name: string, body?: unknown) =>
    fetch(`/api/landing/${name}/${slug}`, {
      method,
      headers: { Authorization: token, Accept: "application/json", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => ({ ok: r.ok, status: r.status, json: await r.json().catch(() => null) }));
  const find = (o: unknown, k: string): unknown =>
    o && typeof o === "object"
      ? k in o ? (o as Record<string, unknown>)[k] : Object.values(o).map((v) => find(v, k)).find((v) => v !== undefined)
      : undefined;
  const el = (tag: string, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): any => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  };

  const card = await api("GET", "page-card");
  const link = find(card.json, "wallet_link");
  document.getElementById("passforge-tool")?.remove();
  const box = el("div", { id: "passforge-tool" });
  box.style.cssText = "position:fixed;inset:12px;z-index:2147483647;overflow:auto;background:#fff;color:#111;font:15px/1.4 system-ui,sans-serif;padding:16px;border:2px solid #333;border-radius:12px;max-width:520px;margin:auto";
  const close = el("button", { textContent: "✕", onclick: () => box.remove() });
  close.style.cssText = "float:right";
  box.append(close, el("h3", { textContent: "passforge · " + slug }));
  if (typeof link === "string") {
    box.append(
      el("p", {}, "Wallet pass / Карта для кошелька:"),
      el("p", {}, el("a", { href: link, textContent: "⬇ Download .pkpass / Скачать" })),
      el("p", { textContent: "Each download creates a NEW pass (new serial). Import it once; it updates by itself. / Каждое скачивание создаёт новую карту. Импортируйте один раз — она обновляется сама." }),
      el("input", { value: link, readOnly: true, style: "width:100%", onfocus: (e: Event) => (e.target as HTMLInputElement).select() }),
    );
  } else {
    box.append(el("p", { textContent: `wallet_link not found (HTTP ${card.status}).` }));
  }

  // Profile editor: the API accepts these fields even when the brand's form hides them.
  const f = (label: string, input: HTMLElement) => el("label", { style: "display:block;margin:6px 0" }, label + " ", input);
  const name = el("input", { name: "name" }), surname = el("input", { name: "surname" });
  const birth = el("input", { type: "date" });
  const gender = el("select", {}, el("option", { value: "", textContent: "—" }), el("option", { value: "male", textContent: "male / муж." }), el("option", { value: "female", textContent: "female / жен." }));
  const email = el("input", { type: "email" });
  const out = el("pre", { style: "white-space:pre-wrap" });
  const save = el("button", {
    textContent: "Save profile / Сохранить",
    onclick: async () => {
      const body: Record<string, string> = {};
      if (name.value) body.name = name.value;
      if (surname.value) body.surname = surname.value;
      if (birth.value) { const [y, m, d] = birth.value.split("-"); body.birthDate = `${y}-${d}-${m}`; } // server reads YYYY-DD-MM
      if (gender.value) body.gender = gender.value;
      if (email.value) body.email = email.value;
      const r = await api("POST", "save-profile", body);
      out.textContent = `HTTP ${r.status}\n` + JSON.stringify(r.json, null, 1).slice(0, 600);
    },
  });
  box.append(el("h4", { textContent: "Profile / Профиль (only filled fields are sent)" }),
    f("Name / Имя", name), f("Surname / Фамилия", surname), f("Birth date / Дата рождения", birth),
    f("Gender / Пол", gender), f("E-mail", email), save, out);
  document.body.append(box);
}

const toolSource = `(${premiumBonusTool.toString()})()`;
export const bookmarklet = "javascript:" + encodeURIComponent(toolSource);

export function farshGuide() {
  const copy = h("button", { onclick: () => navigator.clipboard.writeText(toolSource).then(() => (copy.textContent = t("copied"))) }, t("copyConsole"));
  return h("section", {},
    h("h2", {}, "#FARШ · PremiumBonus"),
    h("p", {}, t("farshIntro")),
    h("ol", {},
      h("li", {}, t("farshStep1"), " ", h("a", { href: "https://cards.premiumbonus.su/FARSH_volga/login", target: "_blank", rel: "noopener" }, "cards.premiumbonus.su/FARSH_volga/login")),
      h("li", {}, t("farshStep2"), " ", h("a", { href: bookmarklet, class: "bookmarklet", onclick: (e: Event) => { e.preventDefault(); alert(t("dragMe")); } }, "passforge · PremiumBonus")),
      h("li", {}, t("farshStep3"), " ", copy),
      h("li", {}, t("farshStep4"))),
    h("p", { class: "muted" }, t("farshProfile")));
}

export function aeroflotGuide() {
  const input = h("input", { placeholder: "https://passbook.aeroflot.ru/api/client/gpay/pass/…", class: "wide mono" });
  const out = h("p", {});
  const go = () => {
    const id = /\b([0-9a-f]{32})\b/i.exec(input.value)?.[1];
    out.replaceChildren(id
      ? h("a", { href: `https://passbook.aeroflot.ru/api/client/pass/${id.toLowerCase()}`, class: "button" }, t("downloadOfficial"))
      : t("aeroflotBadLink"));
  };
  input.addEventListener("input", go);
  return h("section", {},
    h("h2", {}, "Аэрофлот Бонус"),
    h("p", {}, t("aeroflotIntro")),
    h("ol", {}, h("li", {}, t("aeroflotStep1")), h("li", {}, t("aeroflotStep2")), h("li", {}, t("aeroflotStep3"))),
    input, out,
    h("p", { class: "muted" }, t("aeroflotNote")));
}
