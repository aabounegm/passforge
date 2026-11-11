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

/** Live-pass state from the update server: a balance, or "login needed" once its session with the shop ended. */
export interface Live { balance?: number; loginNeeded?: boolean; asOf?: Date }

/** Header field with the balance (changeMessage -> FossWallet notifies on change) and back fields for a live pass. */
function liveFields(shop: string, label: string, l: Live | undefined, fmt: (n: number) => string) {
  const header: Field[] = [], back: Field[] = [];
  if (l?.loginNeeded) {
    header.push({ key: "balance", label, value: "Нужен вход", changeMessage: `${shop}: %@` });
    back.push({ key: "login", label: "Нужен вход", value: `Сессия ${shop} истекла. Войдите снова в passforge, чтобы баланс обновлялся.` });
  } else if (l?.balance !== undefined) header.push({ key: "balance", label, value: fmt(l.balance), changeMessage: `${label}: %@` });
  if (l?.asOf) back.push({ key: "asof", label: "Баланс на", value: l.asOf.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) });
  return { header, back };
}
const points = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

// ---- Пятёрочка / X5 Клуб -------------------------------------------------------------------------------------------
/** Register barcode (as on plastic card backs and the Google Wallet card): EAN-13 "26" + last 10 digits. */
export const x5Barcode = (card: string) => ean13("26" + card.slice(-10));

export function x5(card: string, opts: { nativeEan13?: boolean; live?: Live } = {}): PassJson {
  if (!/^7789\d{12}$/.test(card)) throw new Error("X5 card numbers have 16 digits and start with 7789");
  const live = liveFields("X5 Клуб", "Баллы", opts.live, points);
  return {
    passTypeIdentifier: passType("x5club"),
    serialNumber: card,
    organizationName: "Пятёрочка",
    description: "Карта лояльности «X5 Клуб»",
    backgroundColor: "rgb(230, 24, 1)",
    foregroundColor: WHITE,
    labelColor: "rgb(255, 214, 214)",
    storeCard: {
      headerFields: live.header,
      secondaryFields: [{ key: "number", label: "Номер карты", value: pretty(card) }],
      backFields: [...live.back, { key: "where", label: "Где действует", value: "Пятёрочка, Перекрёсток" }, sayNumber(pretty(card))],
    },
    barcodes: [eanBarcode(x5Barcode(card), opts.nativeEan13)],
  };
}

// ---- Магнит --------------------------------------------------------------------------------------------------------
/** QR payload "E" + 16 digits (plastic cards). The app's virtual cards append "T" + 6 digits; keep a decoded payload
 * as-is rather than rebuilding it. */
export const magnitCardFromQr = (payload: string) => /^E(\d{16})(T\d{6})?$/.exec(payload)?.[1];

export function magnit(card: string, payload = "E" + card, liveState?: Live): PassJson {
  if (!/^\d{16}$/.test(card)) throw new Error("Magnit card numbers have 16 digits");
  if (magnitCardFromQr(payload) !== card) throw new Error("QR payload doesn't match the card number");
  const live = liveFields("Магнит", "Баллы", liveState, points);
  return {
    passTypeIdentifier: passType("magnit"),
    serialNumber: card,
    organizationName: "Магнит",
    description: "Карта «Магнит Плюс»",
    backgroundColor: "rgb(227, 6, 19)",
    foregroundColor: WHITE,
    labelColor: "rgb(255, 210, 210)",
    storeCard: {
      headerFields: live.header,
      secondaryFields: [{ key: "number", label: "Номер карты", value: pretty(card) }],
      backFields: [...live.back, sayNumber(pretty(card))],
    },
    barcodes: [{ format: "PKBarcodeFormatQR", message: payload, messageEncoding: "iso-8859-1", altText: pretty(card) }],
  };
}

// ---- АптекиПлюс ----------------------------------------------------------------------------------------------------
export const aptekiBarcode = (card: string) => ean13("2054" + card);

export interface AptekiData extends Live {
  card: string; // 8 digits
  expiring?: { amount: number; date: string }; // date as YYYY-MM-DD...
}

const rub = (x: number) => x.toFixed(2).replace(".", ",");

export function aptekiplus(d: AptekiData, opts: { nativeEan13?: boolean } = {}): PassJson {
  if (!/^\d{8}$/.test(d.card)) throw new Error("АптекиПлюс card numbers have 8 digits");
  const live = liveFields("АптекиПлюс", "Бонусы", d, rub);
  const secondary: Field[] = [{ key: "number", label: "Номер карты", value: d.card }];
  if (d.expiring?.amount && !d.loginNeeded) {
    const [y, m, day] = d.expiring.date.slice(0, 10).split("-");
    secondary.push({ key: "expiry", label: `Сгорят ${day}.${m}.${y}`, value: rub(d.expiring.amount) });
  }
  const back = [...live.back, sayNumber(d.card)];
  return {
    passTypeIdentifier: passType("aptekiplus"),
    serialNumber: d.card,
    organizationName: "АптекиПлюс",
    description: "Бонусная карта АптекиПлюс",
    backgroundColor: "rgb(37, 73, 117)",
    foregroundColor: WHITE,
    labelColor: "rgb(160, 200, 240)",
    storeCard: { headerFields: live.header, secondaryFields: secondary, backFields: back },
    barcodes: [eanBarcode(aptekiBarcode(d.card), opts.nativeEan13)],
  };
}

// ---- Спортмастер, O'STIN (club cards from the «Кошелёк» app) ------------------------------------------------------
// The shops' own apps and websites show only an encrypted QR that expires (Спортмастер: 15 min; O'STIN: every
// refresh). The «Кошелёк» app issues a plain EAN-13 club card number for the same account instead.
export const eanValid = (s: string) => /^\d{13}$/.test(s) && ean13(s.slice(0, 12)) === s;
const by3 = (n: string) => n.replace(/(\d{3})(?=\d)/g, "$1 ");

function clubCard(
  id: string, shop: string, description: string, colors: Pick<PassJson, "backgroundColor" | "foregroundColor" | "labelColor">,
  card: string, nativeEan13?: boolean,
): PassJson {
  if (!eanValid(card)) throw new Error(`${shop} card numbers are EAN-13: 13 digits with a valid check digit`);
  return {
    passTypeIdentifier: passType(id),
    serialNumber: card,
    organizationName: shop,
    description,
    ...colors,
    storeCard: {
      secondaryFields: [{ key: "number", label: "Номер карты", value: by3(card) }],
      backFields: [
        { key: "source", label: "Откуда номер", value: "Виртуальная клубная карта из приложения «Кошелёк»" },
        sayNumber(by3(card)),
      ],
    },
    barcodes: [eanBarcode(card, nativeEan13)],
  };
}

export const sportmaster = (card: string, opts: { nativeEan13?: boolean } = {}) =>
  clubCard("sportmaster", "Спортмастер", "Клубная карта «Спортмастер»",
    { backgroundColor: "rgb(21, 81, 229)", foregroundColor: WHITE, labelColor: "rgb(200, 215, 255)" }, card, opts.nativeEan13);

export const ostin = (card: string, opts: { nativeEan13?: boolean } = {}) =>
  clubCard("ostin", "O'STIN", "Клубная карта O'STIN",
    { backgroundColor: "rgb(244, 241, 236)", foregroundColor: "rgb(17, 17, 17)", labelColor: "rgb(110, 105, 100)" }, card, opts.nativeEan13);

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
