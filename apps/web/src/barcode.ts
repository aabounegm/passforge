// zxing-wasm, lazy-loaded, with the .wasm served from this site (no CDN) so the app works offline.
import wasmUrl from "zxing-wasm/full/zxing_full.wasm?url";

let mod: Promise<typeof import("zxing-wasm/full")> | undefined;
function zxing() {
  return (mod ??= import("zxing-wasm/full").then((z) => {
    z.prepareZXingModule({ overrides: { locateFile: (p: string, prefix: string) => (p.endsWith(".wasm") ? wasmUrl : prefix + p) } });
    return z;
  }));
}

export interface Decoded { text: string; format: string }

/** Every barcode found in a screenshot/photo (Blob) or a camera frame (ImageData) of the user's own card. */
export async function decode(image: Blob | ImageData): Promise<Decoded[]> {
  const z = await zxing();
  const res = await z.readBarcodes(image, { formats: [], tryHarder: true, maxNumberOfSymbols: 8, textMode: "Plain" });
  return res.filter((r) => r.isValid).map((r) => ({ text: r.text, format: r.format }));
}

// PassKit format -> zxing format. FossWallet v0.52.0 draws all of these natively; unknown ones become QR.
const ZX: Record<string, string> = {
  PKBarcodeFormatQR: "QRCode", PKBarcodeFormatPDF417: "PDF417", PKBarcodeFormatAztec: "Aztec", PKBarcodeFormatCode128: "Code128",
  PKBarcodeFormatCode39: "Code39", PKBarcodeFormatCode93: "Code93", PKBarcodeFormatEAN13: "EAN-13",
};

/** SVG of the barcode as FossWallet would draw it, plus a decode-back check of the rendered image. */
export async function render(pkFormat: string, message: string) {
  const z = await zxing();
  const drawnAs = pkFormat in ZX ? pkFormat : "PKBarcodeFormatQR";
  const out = await z.writeBarcode(message, { format: ZX[drawnAs] as never, scale: 4, withQuietZones: true });
  if (out.error) throw new Error(out.error);
  const back = await z.readBarcodes(out.image!, { formats: [], textMode: "Plain" });
  return { svg: scalable(out.svg, LINEAR.has(drawnAs)), drawnAs, roundTrip: back[0]?.text === message, square: ["PKBarcodeFormatQR", "PKBarcodeFormatAztec"].includes(drawnAs) };
}

const LINEAR = new Set(["PKBarcodeFormatCode128", "PKBarcodeFormatCode39", "PKBarcodeFormatCode93", "PKBarcodeFormatEAN13"]);

/** zxing's SVG has a fixed width/height and no viewBox, so CSS can't scale its drawing. Swap the size for a viewBox;
 * linear codes may stretch to fill (only relative bar widths matter), 2D codes keep their aspect and stay centered. */
function scalable(svg: string, stretch: boolean) {
  return svg.replace(/<svg\b([^>]*)>/, (_, attrs: string) => {
    const w = /\bwidth="([\d.]+)"/.exec(attrs)?.[1], h = /\bheight="([\d.]+)"/.exec(attrs)?.[1];
    if (!w || !h || /viewBox=/.test(attrs)) return `<svg${attrs}>`;
    const rest = attrs.replace(/\s(width|height)="[^"]*"/g, "");
    return `<svg${rest} viewBox="0 0 ${w} ${h}" preserveAspectRatio="${stretch ? "none" : "xMidYMid meet"}" shape-rendering="crispEdges">`;
  });
}
