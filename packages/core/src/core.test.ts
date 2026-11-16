import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import {
  aptekiBarcode, aptekiplus, buildPkpass, ean13, luhnValid, magnit, magnitCardFromQr, milesSmiles, parseTkQr,
  ostin, readPkpass, sportmaster, tkQr, x5, x5Barcode,
} from "./index.ts";

// Obviously fake sample data (Luhn-valid where real cards are).
export const SAMPLES = { x5: "7789000000000002", magnit: "7000000000000005", apteki: "12345678" };

test("check digits", () => {
  assert.equal(ean13("400638133393"), "4006381333931"); // textbook EAN-13
  assert.equal(x5Barcode(SAMPLES.x5), ean13("260000000002"));
  assert.equal(aptekiBarcode(SAMPLES.apteki), ean13("205412345678"));
  assert.ok(luhnValid(SAMPLES.x5) && luhnValid(SAMPLES.magnit) && !luhnValid("7789000000000001"));
});

test("pkpass round trip with manifest", async () => {
  const icon = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const zip = await buildPkpass(x5(SAMPLES.x5), { "icon.png": icon });
  const { pass, files } = await readPkpass(zip);
  assert.equal(pass.formatVersion, 1);
  assert.deepEqual(pass.barcode, pass.barcodes[0]);
  assert.equal(pass.barcodes[0].format, "PKBarcodeFormatEAN13");
  assert.deepEqual(files["icon.png"], icon);
  assert.deepEqual(Object.keys(JSON.parse(strFromU8(unzipSync(zip)["manifest.json"]))).sort(), ["icon.png", "pass.json"]);

  const tampered = unzipSync(zip);
  tampered["icon.png"] = new Uint8Array([0]);
  const { zipSync } = await import("fflate");
  await assert.rejects(readPkpass(zipSync(tampered)), /hash mismatch/);
});

test("magnit payloads", () => {
  assert.equal(magnit(SAMPLES.magnit).barcodes[0].message, "E" + SAMPLES.magnit);
  assert.equal(magnitCardFromQr(`E${SAMPLES.magnit}T123456`), SAMPLES.magnit);
  assert.throws(() => magnit(SAMPLES.magnit, "E7000000000000013"));
});

test("aptekiplus fields", () => {
  const p = aptekiplus({ card: SAMPLES.apteki, balance: 12.5, expiring: { amount: 3, date: "2026-12-31T00:00:00+03:00" } });
  assert.equal(p.storeCard!.headerFields![0].value, "12,50");
  assert.equal(p.storeCard!.secondaryFields![1].label, "Сгорят 31.12.2026");
  const dead = aptekiplus({ card: SAMPLES.apteki, loginNeeded: true });
  assert.equal(dead.storeCard!.headerFields![0].value, "Нужен вход");
  assert.match(dead.storeCard!.headerFields![0].changeMessage!, /%@/);
});

test("live x5 and magnit passes", () => {
  const x = x5(SAMPLES.x5, { live: { balance: 2134 } });
  assert.equal(x.storeCard!.headerFields![0].label, "Баллы");
  assert.match(String(x.storeCard!.headerFields![0].value), /^2\s134$/);
  assert.match(x.storeCard!.headerFields![0].changeMessage!, /%@/);
  const m = magnit(SAMPLES.magnit, undefined, { loginNeeded: true });
  assert.equal(m.storeCard!.headerFields![0].value, "Нужен вход");
  assert.equal(m.barcodes[0].message, "E" + SAMPLES.magnit);
  assert.deepEqual(x5(SAMPLES.x5).storeCard!.headerFields, [], "static passes have no balance");
});

test("miles&smiles record is fixed-width and embedded as-is", () => {
  const qr = tkQr({ id: "TK123456789", first: "Jane", last: "Doe", tier: "CCN" });
  assert.equal(qr.length, 69);
  assert.deepEqual(parseTkQr(qr), { id: "TK123456789", first: "JANE", last: "DOE", tier: "CCN" });
  const p = milesSmiles(qr);
  assert.equal(p.barcodes[0].message, qr);
  assert.equal(p.storeCard!.headerFields![0].value, "Classic");
  assert.equal(parseTkQr(qr.trimEnd() + " "), undefined);
});

test("sportmaster and o'stin club cards", () => {
  const p = sportmaster("4006381333931");
  assert.equal(p.barcodes[0].message, "4006381333931");
  assert.equal(p.barcodes[0].format, "PKBarcodeFormatEAN13");
  assert.equal(p.storeCard!.secondaryFields![0].value, "400 638 133 393 1");
  assert.throws(() => ostin("4006381333932"), /check digit/);
  assert.throws(() => sportmaster("400638133393"));
});
