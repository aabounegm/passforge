// pass.json builders per card (pure; shared by the web generator and the update server).
// Pass contents stay in each card's own language. Images are made separately (apps/web/src/art.ts).
import type { Barcode, Field, PassJson } from "./pkpass.ts";

export const ean13 = (d12: string) => {
  if (!/^\d{12}$/.test(d12)) throw new Error("EAN-13 needs 12 digits");
  const s = [...d12].reduce((a, c, i) => a + Number(c) * (i % 2 ? 3 : 1), 0);
  return d12 + ((10 - (s % 10)) % 10);
};

export const luhnValid = (n: string) =>
  /^\d+$/.test(n) &&
  [...n].reverse().reduce((a, c, i) => {
    const d = Number(c) * (i % 2 ? 2 : 1);
    return a + (d > 9 ? d - 9 : d);
  }, 0) % 10 === 0;

export const pretty = (n: string) => n.replace(/(.{4})(?=.)/g, "$1 ");
export const passType = (card: string) => `pass.passforge.${card}`;
const WHITE = "rgb(255, 255, 255)";

/** EAN-13 digits as a pass barcode. ponytail: FossWallet v0.51.0 draws PKBarcodeFormatEAN13 as QR, so by default
 * the same digits go out as Code128 (scanners read the same number). Pass native=true once a FossWallet release
 * includes PRs #757/#779/#791. */
export const eanBarcode = (digits: string, native = false): Barcode => ({
  format: native ? "PKBarcodeFormatEAN13" : "PKBarcodeFormatCode128",
  message: digits,
  messageEncoding: "iso-8859-1",
  altText: digits,
});

const sayNumber = (n: string): Field => ({ key: "tip", label: "Если не сканируется", value: `Назовите кассиру номер карты: ${n}` });

// ---- Пятёрочка / X5 Клуб -------------------------------------------------------------------------------------------
/** Register barcode (as on plastic card backs and the Google Wallet card): EAN-13 "26" + last 10 digits. */
export const x5Barcode = (card: string) => ean13("26" + card.slice(-10));

export function x5(card: string, opts: { nativeEan13?: boolean } = {}): PassJson {
  if (!/^7789\d{12}$/.test(card)) throw new Error("X5 card numbers have 16 digits and start with 7789");
  return {
    passTypeIdentifier: passType("x5club"),
    serialNumber: card,
    organizationName: "Пятёрочка",
    description: "Карта лояльности «X5 Клуб»",
    backgroundColor: "rgb(230, 24, 1)",
    foregroundColor: WHITE,
    labelColor: "rgb(255, 214, 214)",
    storeCard: {
      secondaryFields: [{ key: "number", label: "Номер карты", value: pretty(card) }],
      backFields: [{ key: "where", label: "Где действует", value: "Пятёрочка, Перекрёсток" }, sayNumber(pretty(card))],
    },
    barcodes: [eanBarcode(x5Barcode(card), opts.nativeEan13)],
  };
}

// ---- Магнит --------------------------------------------------------------------------------------------------------
/** QR payload "E" + 16 digits (plastic cards). The app's virtual cards append "T" + 6 digits; keep a decoded payload
 * as-is rather than rebuilding it. */
export const magnitCardFromQr = (payload: string) => /^E(\d{16})(T\d{6})?$/.exec(payload)?.[1];

export function magnit(card: string, payload = "E" + card): PassJson {
  if (!/^\d{16}$/.test(card)) throw new Error("Magnit card numbers have 16 digits");
  if (magnitCardFromQr(payload) !== card) throw new Error("QR payload doesn't match the card number");
  return {
    passTypeIdentifier: passType("magnit"),
    serialNumber: card,
    organizationName: "Магнит",
    description: "Карта «Магнит Плюс»",
    backgroundColor: "rgb(227, 6, 19)",
    foregroundColor: WHITE,
    labelColor: "rgb(255, 210, 210)",
    storeCard: {
      secondaryFields: [{ key: "number", label: "Номер карты", value: pretty(card) }],
      backFields: [sayNumber(pretty(card))],
    },
    barcodes: [{ format: "PKBarcodeFormatQR", message: payload, messageEncoding: "iso-8859-1", altText: pretty(card) }],
  };
}

// ---- АптекиПлюс ----------------------------------------------------------------------------------------------------
export const aptekiBarcode = (card: string) => ean13("2054" + card);

export interface AptekiData {
  card: string; // 8 digits
  balance?: number; // available bonuses
  expiring?: { amount: number; date: string }; // date as YYYY-MM-DD...
  asOf?: Date;
  loginNeeded?: boolean; // live pass whose upstream session died
}

const rub = (x: number) => x.toFixed(2).replace(".", ",");

export function aptekiplus(d: AptekiData, opts: { nativeEan13?: boolean } = {}): PassJson {
  if (!/^\d{8}$/.test(d.card)) throw new Error("АптекиПлюс card numbers have 8 digits");
  const header: Field[] = [];
  if (d.loginNeeded) header.push({ key: "balance", label: "Бонусы", value: "Нужен вход", changeMessage: "АптекиПлюс: %@" });
  else if (d.balance !== undefined)
    header.push({ key: "balance", label: "Бонусы", value: rub(d.balance), changeMessage: "Бонусы: %@" });
  const secondary: Field[] = [{ key: "number", label: "Номер карты", value: d.card }];
  if (d.expiring?.amount && !d.loginNeeded) {
    const [y, m, day] = d.expiring.date.slice(0, 10).split("-");
    secondary.push({ key: "expiry", label: `Сгорят ${day}.${m}.${y}`, value: rub(d.expiring.amount) });
  }
  const back: Field[] = [];
  if (d.loginNeeded)
    back.push({ key: "login", label: "Нужен вход", value: "Сессия АптекиПлюс истекла. Войдите снова в passforge, чтобы баланс обновлялся." });
  if (d.asOf)
    back.push({ key: "asof", label: "Баланс на", value: d.asOf.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) });
  back.push(sayNumber(d.card));
  return {
    passTypeIdentifier: passType("aptekiplus"),
    serialNumber: d.card,
    organizationName: "АптекиПлюс",
    description: "Бонусная карта АптекиПлюс",
    backgroundColor: "rgb(37, 73, 117)",
    foregroundColor: WHITE,
    labelColor: "rgb(160, 200, 240)",
    storeCard: { headerFields: header, secondaryFields: secondary, backFields: back },
    barcodes: [eanBarcode(aptekiBarcode(d.card), opts.nativeEan13)],
  };
}

// ---- Turkish Airlines Miles&Smiles ---------------------------------------------------------------------------------
// Digital-card QR: fixed-width 69-char record "FFPC001" + id(17) + first(19) + last(19) + tier(3) + "^001".
export const TK_TIERS: Record<string, string> = { CCN: "Classic" }; // other tier codes are unknown so far

export interface TkMember { id: string; first: string; last: string; tier: string }

export function parseTkQr(qr: string): TkMember | undefined {
  const m = /^FFPC001(.{17})(.{19})(.{19})(.{3})\^001$/.exec(qr);
  if (!m || !/^TK\d{9}$/.test(m[1].trim())) return undefined;
  return { id: m[1].trim(), first: m[2].trim(), last: m[3].trim(), tier: m[4] };
}

export const tkQr = (m: TkMember) =>
  "FFPC001" + m.id.padEnd(17) + m.first.toUpperCase().padEnd(19) + m.last.toUpperCase().padEnd(19) + m.tier.padEnd(3) + "^001";

/** Embeds `qr` byte-for-byte (decode the user's own QR rather than rebuilding it). */
export function milesSmiles(qr: string): PassJson {
  const m = parseTkQr(qr);
  if (!m) throw new Error("Not a Miles&Smiles digital-card QR");
  return {
    passTypeIdentifier: passType("milesandsmiles"),
    serialNumber: m.id,
    organizationName: "Turkish Airlines",
    description: "Miles&Smiles membership card",
    backgroundColor: "rgb(166, 47, 49)",
    foregroundColor: WHITE,
    labelColor: "rgb(255, 200, 195)",
    storeCard: {
      headerFields: [{ key: "tier", label: "TIER", value: TK_TIERS[m.tier] ?? m.tier }],
      secondaryFields: [{ key: "name", label: "NAME", value: `${m.first} ${m.last}` }],
      backFields: [
        { key: "number", label: "Member number", value: m.id },
        { key: "program", label: "Programme", value: "Miles&Smiles · Star Alliance" },
        { key: "note", label: "About this pass", value: "Built from the app's digital card QR. Tier and miles don't update automatically." },
      ],
    },
    barcodes: [{ format: "PKBarcodeFormatQR", message: qr, messageEncoding: "iso-8859-1", altText: "TK " + m.id.slice(2) }],
  };
}
