// Generator definitions: form fields, how to read the user's own barcode, and how to build the pass.
import {
  aptekiplus, ean13, luhnValid, magnit, magnitCardFromQr, milesSmiles, parseTkQr, tkQr, x5,
  type Files, type PassJson,
} from "@passforge/core";
import { aptekiArt, magnitArt, milesSmilesArt, x5Art } from "./art.ts";
import type { Decoded } from "./barcode.ts";
import type { Key } from "./i18n.ts";

export type Values = Record<string, string>;
export interface Input { name: string; label: Key; placeholder: string; mono?: boolean; long?: boolean }
export interface CardDef {
  id: string;
  name: string;
  intro: Key;
  inputs: Input[];
  ean?: boolean; // offers the native EAN-13 switch
  /** Values found in the decoded barcodes, and/or a note key. */
  fromScan(found: Decoded[]): { values?: Values; note?: Key; noteArg?: string };
  warn?(v: Values): Key | undefined;
  build(v: Values, nativeEan13: boolean): Promise<{ pass: PassJson; images: Files }>;
}

const digits = (s = "") => s.replace(/\D/g, "");
const eanOk = (s: string) => /^\d{13}$/.test(s) && ean13(s.slice(0, 12)) === s;

export const CARDS: CardDef[] = [
  {
    id: "x5club",
    name: "Пятёрочка · X5 Клуб",
    intro: "x5Intro",
    ean: true,
    inputs: [{ name: "card", label: "cardNumber", placeholder: "7789 0000 0000 0002", mono: true }],
    fromScan(found) {
      // The app's PDF417 ("<card>QR<10 digits>") and QR ("OFQR.<card>;…") both carry the full number.
      const card = found.map((d) => /7789\d{12}/.exec(d.text)?.[0]).find(Boolean);
      if (card) return { values: { card } };
      const ean = found.find((d) => /^26\d{11}$/.test(d.text) && eanOk(d.text));
      return ean ? { note: "x5EanOnly", noteArg: ean.text.slice(2, 12) } : { note: "nothingFound" };
    },
    warn: (v) => (luhnValid(digits(v.card)) ? undefined : "luhnWarn"),
    async build(v, native) {
      return { pass: x5(digits(v.card), { nativeEan13: native }), images: await x5Art() };
    },
  },
  {
    id: "magnit",
    name: "Магнит · Магнит Плюс",
    intro: "magnitIntro",
    inputs: [
      { name: "card", label: "cardNumber", placeholder: "7000 0000 0000 0005", mono: true },
      { name: "qr", label: "qrPayload", placeholder: "E7000000000000005", mono: true },
    ],
    fromScan(found) {
      const qr = found.map((d) => d.text).find((s) => magnitCardFromQr(s));
      if (!qr) return { note: "nothingFound" };
      return { values: { card: magnitCardFromQr(qr)!, qr }, note: qr.includes("T") ? "magnitSuffix" : undefined };
    },
    warn: (v) => (luhnValid(digits(v.card)) ? undefined : "luhnWarn"),
    async build(v) {
      const card = digits(v.card);
      return { pass: magnit(card, v.qr.trim() || undefined), images: await magnitArt() };
    },
  },
  {
    id: "aptekiplus",
    name: "АптекиПлюс",
    intro: "aptekiIntro",
    ean: true,
    inputs: [{ name: "card", label: "cardNumber", placeholder: "12345678", mono: true }],
    fromScan(found) {
      const ean = found.find((d) => /^2054\d{9}$/.test(d.text) && eanOk(d.text));
      return ean ? { values: { card: ean.text.slice(4, 12) } } : { note: "nothingFound" };
    },
    async build(v, native) {
      return { pass: aptekiplus({ card: digits(v.card) }, { nativeEan13: native }), images: await aptekiArt() };
    },
  },
  {
    id: "milesandsmiles",
    name: "Turkish Airlines · Miles&Smiles",
    intro: "tkIntro",
    inputs: [
      { name: "id", label: "memberId", placeholder: "TK123456789", mono: true },
      { name: "first", label: "firstName", placeholder: "JANE" },
      { name: "last", label: "lastName", placeholder: "DOE" },
      { name: "tier", label: "tierCode", placeholder: "CCN", mono: true },
      { name: "qr", label: "qrExact", placeholder: "FFPC001TK123456789      JANE …", mono: true, long: true },
    ],
    fromScan(found) {
      const qr = found.map((d) => d.text).find((s) => parseTkQr(s));
      return qr ? { values: { ...parseTkQr(qr)!, qr } } : { note: "nothingFound" };
    },
    async build(v) {
      // Prefer the decoded QR byte-for-byte; rebuild the fixed-width record only when there is none.
      const qr = v.qr || tkQr({ id: v.id.trim().toUpperCase(), first: v.first.trim(), last: v.last.trim(), tier: (v.tier.trim() || "CCN").toUpperCase() });
      const pass = milesSmiles(qr);
      return { pass, images: await milesSmilesArt(parseTkQr(qr)!.tier) };
    },
  },
];
