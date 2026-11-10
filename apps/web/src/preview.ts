// Rough mock of FossWallet's store-card layout (1 CSS px ≈ 1 dp), rendered from the generated .pkpass itself,
// so it doubles as an integrity check (manifest hashes, barcode decodes back to the payload).
import { readPkpass, type Field } from "@passforge/core";
import { render } from "./barcode.ts";
import { t } from "./i18n.ts";
import { h } from "./ui.ts";

const pick = (files: Record<string, Uint8Array>, base: string) =>
  ["@3x", "@2x", ""].map((s) => files[`${base}${s}.png`]).find(Boolean);
const url = (png?: Uint8Array) => png && URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));

const field = (f: Field, cls: string) =>
  h("div", { class: cls }, h("div", { class: "fw-label" }, f.label ?? ""), h("div", { class: "fw-value" }, String(f.value)));

export async function preview(pkpass: Uint8Array): Promise<HTMLElement> {
  const { pass, files } = await readPkpass(pkpass);
  const sc = pass.storeCard ?? {};
  const b = pass.barcodes[0];
  const bc = await render(b.format, b.message);
  const strip = url(pick(files, "strip"));
  const card = h("div", { class: "fw-card", style: `background:${pass.backgroundColor};color:${pass.foregroundColor};--label:${pass.labelColor}` },
    h("div", { class: "fw-header" },
      h("img", { class: "fw-logo", src: url(pick(files, "logo")), alt: "" }),
      pass.logoText ? h("span", { class: "fw-logotext" }, pass.logoText) : null,
      h("div", { class: "fw-headerfields" }, ...(sc.headerFields ?? []).map((f) => field(f, "fw-hfield")))),
    strip ? h("div", { class: "fw-strip", style: `background-image:url(${strip})` },
      ...(sc.primaryFields ?? []).map((f) => field(f, "fw-primary"))) : null,
    h("div", { class: "fw-row" }, ...[...(sc.secondaryFields ?? []), ...(sc.auxiliaryFields ?? [])].map((f) => field(f, "fw-field"))),
    h("div", { class: "fw-barcode" + (bc.square ? " square" : "") },
      h("div", { class: "fw-code", innerHTML: bc.svg }),
      b.altText ? h("div", { class: "fw-alt" }, b.altText) : null));
  const back = (sc.backFields ?? []).map((f) => h("div", {}, h("b", {}, f.label ?? ""), " ", String(f.value)));
  return h("div", { class: "preview" },
    card,
    h("p", { class: bc.roundTrip ? "ok" : "warn" }, bc.roundTrip ? t("checkOk") : t("checkFail"), " ", h("code", {}, JSON.stringify(b.message))),
    bc.drawnAs !== b.format ? h("p", { class: "warn" }, t("drawnAsQr")) : null,
    h("details", {}, h("summary", {}, t("back")), ...back,
      h("p", { class: "muted" }, Object.keys(files).sort().join(", "))));
}
