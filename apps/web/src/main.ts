import { buildPkpass } from "@passforge/core";
import "./style.css";
import { handleRedirect } from "./auth.ts";
import { decode } from "./barcode.ts";
import { CARDS, type CardDef, type Values } from "./cards.ts";
import { aeroflotGuide, farshGuide } from "./guides.ts";
import { lang, setLang, t } from "./i18n.ts";
import { liveView } from "./live.ts";
import { preview } from "./preview.ts";
import { errText, h, saveFile } from "./ui.ts";

const app = document.getElementById("app")!;
const GUIDES: Record<string, () => HTMLElement> = { farsh: farshGuide, aeroflot: aeroflotGuide };

function home() {
  return h("div", {},
    h("p", { class: "lead" }, t("tagline")),
    h("h2", {}, t("generate")),
    h("ul", { class: "tiles" }, ...CARDS.map((c) => h("li", {}, h("a", { href: `#/card/${c.id}` }, c.name)))),
    h("h2", {}, t("official")),
    h("ul", { class: "tiles" },
      h("li", {}, h("a", { href: "#/guide/farsh" }, "#FARШ (PremiumBonus)")),
      h("li", {}, h("a", { href: "#/guide/aeroflot" }, "Аэрофлот Бонус"))),
    h("h2", {}, t("liveTitle")),
    h("p", {}, h("a", { href: "#/live" }, t("liveLink"))),
    h("p", { class: "muted" }, t("privacy")));
}

function generator(card: CardDef) {
  const inputs = Object.fromEntries(card.inputs.map((i) =>
    [i.name, h(i.long ? "textarea" : "input" as "input", { name: i.name, placeholder: i.placeholder, class: i.mono ? "mono wide" : "wide", spellcheck: false, autocomplete: "off" })]));
  const native = h("input", { type: "checkbox" });
  const note = h("p", { class: "note" });
  const out = h("div", {});
  const values = (): Values => Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));

  const scan = h("input", { type: "file", accept: "image/*", onchange: async () => {
    const file = scan.files?.[0];
    if (!file) return;
    note.textContent = t("reading");
    try {
      const found = await decode(file);
      const r = card.fromScan(found);
      for (const [k, v] of Object.entries(r.values ?? {})) if (inputs[k]) inputs[k].value = v;
      note.textContent = [r.values ? t("scanned") : "", r.note ? t(r.note, r.noteArg) : ""].filter(Boolean).join(" ");
    } catch (e) { note.textContent = errText(e); }
  } });

  const create = async (e: Event) => {
    e.preventDefault();
    out.replaceChildren(t("building"));
    try {
      const v = values();
      const { pass, images } = await card.build(v, native.checked);
      const zip = await buildPkpass(pass, images);
      const warn = card.warn?.(v);
      out.replaceChildren(
        warn ? h("p", { class: "warn" }, t(warn)) : "",
        h("button", { class: "primary", onclick: () => saveFile(zip, `${card.id}.pkpass`) }, t("download")),
        await preview(zip));
    } catch (err) { out.replaceChildren(h("p", { class: "warn" }, errText(err))); }
  };

  return h("section", {},
    h("p", {}, h("a", { href: "#/" }, "← passforge")),
    h("h2", {}, card.name),
    h("p", {}, t(card.intro)),
    h("form", { onsubmit: create },
      h("label", { class: "scan" }, t("scanLabel"), " ", scan),
      note,
      ...card.inputs.map((i) => h("label", {}, t(i.label), inputs[i.name])),
      card.ean ? h("label", { class: "check" }, native, " ", t("nativeEan")) : null,
      h("button", { class: "primary" }, t("create"))),
    out);
}

async function route() {
  const [, kind, id] = location.hash.split("/");
  const card = kind === "card" && CARDS.find((c) => c.id === id);
  const view = card ? generator(card) : kind === "guide" && GUIDES[id] ? GUIDES[id]() : kind === "live" ? await liveView() : home();
  app.replaceChildren(view);
  window.scrollTo(0, 0);
}

function header() {
  document.documentElement.lang = lang();
  document.getElementById("top")!.replaceChildren(
    h("a", { href: "#/", class: "brand" }, "passforge"),
    h("button", { class: "lang", onclick: () => { setLang(lang() === "ru" ? "en" : "ru"); header(); route(); } }, lang() === "ru" ? "English" : "Русский"));
}

header();
window.addEventListener("hashchange", route);
handleRedirect().catch((e) => alert(errText(e))).finally(route);
