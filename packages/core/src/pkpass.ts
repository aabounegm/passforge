// Unsigned .pkpass: pass.json + images + manifest.json (SHA-1 of every other file), zipped.
// FossWallet doesn't check signatures, so there is no `signature` file. Works in browsers and Node 24 (WebCrypto).
import { strToU8, strFromU8, unzipSync, zipSync } from "fflate";

export type Files = Record<string, Uint8Array>;

export interface Field {
  key: string;
  label?: string;
  value: string | number;
  changeMessage?: string; // must contain %@; FossWallet notifies when the value changes on update
  textAlignment?: string;
}

export interface Barcode {
  format: string;
  message: string;
  messageEncoding: string;
  altText?: string;
}

export interface PassJson {
  passTypeIdentifier: string;
  serialNumber: string;
  organizationName: string;
  description: string;
  backgroundColor?: string;
  foregroundColor?: string;
  labelColor?: string;
  logoText?: string;
  storeCard?: {
    headerFields?: Field[];
    primaryFields?: Field[];
    secondaryFields?: Field[];
    auxiliaryFields?: Field[];
    backFields?: Field[];
  };
  barcodes: Barcode[];
  webServiceURL?: string;
  authenticationToken?: string;
  [key: string]: unknown;
}

export const IMAGE_NAMES = /^(icon|logo|strip|thumbnail|background|footer)(@[23]x)?\.png$/;

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const sha1 = async (data: Uint8Array) => hex(await crypto.subtle.digest("SHA-1", data as BufferSource));

/** Adds pass.json defaults + legacy `barcode` key, writes the manifest and zips. */
export async function buildPkpass(pass: PassJson, images: Files): Promise<Uint8Array> {
  const full = { formatVersion: 1, teamIdentifier: "PASSFORGE", ...pass, barcode: pass.barcodes[0] };
  const files: Files = { "pass.json": strToU8(JSON.stringify(full, null, 2)), ...images };
  const manifest: Record<string, string> = {};
  for (const [name, data] of Object.entries(files)) manifest[name] = await sha1(data);
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
  return zipSync(files, { level: 6 });
}

/** Unzips a pkpass and checks the manifest (names and hashes). Throws on a broken file. */
export async function readPkpass(zip: Uint8Array): Promise<{ pass: PassJson; files: Files }> {
  const files = unzipSync(zip);
  const manifest = JSON.parse(strFromU8(files["manifest.json"] ?? strToU8("null")));
  if (!manifest) throw new Error("manifest.json missing");
  const listed = Object.keys(manifest).sort().join();
  const present = Object.keys(files).filter((n) => n !== "manifest.json" && n !== "signature").sort().join();
  if (listed !== present) throw new Error("manifest/file mismatch");
  for (const [name, hash] of Object.entries(manifest)) {
    if ((await sha1(files[name])) !== hash) throw new Error(`manifest hash mismatch: ${name}`);
  }
  return { pass: JSON.parse(strFromU8(files["pass.json"])), files };
}

export { zipSync, unzipSync };
