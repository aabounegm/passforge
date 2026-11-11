// Canvas image processing + per-card artwork recipes (ported from the prototype's make.py files).
import type { Files } from "@passforge/core";

type Src = HTMLImageElement | HTMLCanvasElement;
const BRANDS = import.meta.env.BASE_URL + "brands/";

const load = (path: string) =>
  new Promise<HTMLImageElement>((ok, fail) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = () => fail(new Error("can't load " + path));
    im.src = BRANDS + path;
  });

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  return [c, ctx] as const;
}

/** Copy of a region (defaults to the whole image). */
function crop(src: Src, x = 0, y = 0, w = src.width - x, h = src.height - y) {
  const [c, ctx] = canvas(w, h);
  ctx.drawImage(src, x, y, w, h, 0, 0, w, h);
  return c;
}

/** Same shape (alpha), single colour, for x >= fromX. E.g. a red wordmark turned white for a red card. */
function recolor(src: Src, color: string, fromX = 0) {
  const c = crop(src);
  const part = crop(src, fromX);
  const pctx = part.getContext("2d")!;
  pctx.globalCompositeOperation = "source-in";
  pctx.fillStyle = color;
  pctx.fillRect(0, 0, part.width, part.height);
  const ctx = c.getContext("2d")!;
  ctx.clearRect(fromX, 0, part.width, part.height);
  ctx.drawImage(part, fromX, 0);
  return c;
}

/** Crop to the bounding box of non-transparent pixels. */
function trim(src: Src) {
  const c = crop(src);
  const { data, width, height } = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3]) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
  return x1 < 0 ? c : crop(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

/** Resize with repeated halving (one-step canvas downscales alias badly). */
function resize(src: Src, w: number, h: number): HTMLCanvasElement {
  let cur: Src = src;
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const [c, ctx] = canvas(cur.width / 2, cur.height / 2);
    ctx.drawImage(cur, 0, 0, c.width, c.height);
    cur = c;
  }
  const [c, ctx] = canvas(w, h);
  ctx.drawImage(cur, 0, 0, c.width, c.height);
  return c;
}

/** `src` fit into w×h (keeps aspect), centered on a w×h canvas, at `scale` of the box, over `bg`. */
function centered(src: Src, w: number, h: number, scale: number, bg?: string) {
  const [c, ctx] = canvas(w, h);
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  const s = Math.min((w * scale) / src.width, (h * scale) / src.height);
  ctx.drawImage(resize(src, src.width * s, src.height * s), (w - src.width * s) / 2, (h - src.height * s) / 2);
  return c;
}

const png = (c: HTMLCanvasElement) =>
  new Promise<Uint8Array>((ok) => c.toBlob(async (b) => ok(new Uint8Array(await b!.arrayBuffer())), "image/png"));

/** @1x/@2x/@3x pass images. icon: square, 29pt; logo: fit into 160×50pt; strip: fit into 330×150pt
 * (FossWallet shows strips 150dp tall, full width, center-cropped, ≈2.2–2.5:1, so keep artwork off the edges).
 * Never upscales: densities the source can't fill are skipped (@1x is always written). */
export async function densities(logo: Src, icon: Src, strip?: Src): Promise<Files> {
  const files: Files = {};
  for (const k of [1, 2, 3]) {
    const sfx = k === 1 ? "" : `@${k}x`;
    const put = async (name: string, src: Src, w: number, h: number, square = false) => {
      const s = square ? w / Math.max(src.width, src.height) : Math.min(w / src.width, h / src.height);
      if (s > 1 && k > 1) return;
      const side = Math.max(src.width, src.height);
      files[`${name}${sfx}.png`] = await png(square ? resize(centered(src, side, side, 1), w, w)
        : resize(src, src.width * s, src.height * s));
    };
    await put("icon", icon, 29 * k, 29 * k, true);
    await put("logo", logo, 160 * k, 50 * k);
    if (strip) await put("strip", strip, 330 * k, 150 * k);
  }
  return files;
}

// ---- recipes (pixel offsets are for the committed 960px-wide logo renders) -----------------------------------------
async function x5ArtRaw() {
  const src = await load("x5club/logo.png");
  // The emblem (x<209) already has a white ring and white "5"; only the red wordmark (x>=244) turns white.
  const emblem = trim(crop(src, 0, 0, 209));
  return densities(recolor(src, "white", 244), centered(emblem, 256, 256, 1), await load("x5club/card_art.png"));
}

async function magnitArtRaw() {
  const logo = recolor(await load("magnit/logo.png"), "white");
  const emblem = crop(logo, 0, 0, 179); // the "М" mark
  return densities(logo, centered(emblem, 256, 256, 0.8, "rgb(227, 6, 19)"), await load("magnit/card_art.png"));
}

/** The committed strip is the Classic card; other tiers have other colours, so they get no strip. */
async function milesSmilesArtRaw(tier: string) {
  const src = await load("milesandsmiles/logo.png");
  const emblem = trim(crop(src, 0, 0, 263));
  const strip = tier === "CCN" ? await load("milesandsmiles/card_art.png") : undefined;
  return densities(recolor(src, "white", 321), centered(emblem, 256, 256, 1), strip);
}

async function aptekiArtRaw() {
  // Strip: the website card's diagonal gradient, cyan (bottom-left) -> blue (top-right), with the white wordmark.
  // Isolines run parallel to the top-left/bottom-right diagonal, like the prototype's mask x/W + (H-y)/H.
  const W = 990, H = 450, k = 2 / (1 / W ** 2 + 1 / H ** 2);
  const [strip, ctx] = canvas(W, H);
  const g = ctx.createLinearGradient(0, H, k / W, H - k / H);
  g.addColorStop(0, "rgb(43, 202, 248)");
  g.addColorStop(1, "rgb(15, 104, 214)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(centered(recolor(await load("aptekiplus/wordmark.png"), "white"), W, H, 0.92), 0, 0);
  // The wordmark is ~10:1, a sliver in FossWallet's header, so the header uses the app icon.
  const icon = await load("aptekiplus/icon.png");
  return densities(icon, icon, strip);
}

async function sportmasterArtRaw() {
  // Commons wordmark (red-blue on transparent) as a white silhouette on the brand blue; the emblem is the site's own
  // vector logo symbol, so the icon and strip are SVGs rendered at any size.
  const logo = recolor(trim(await load("sportmaster/logo.png")), "white");
  return densities(logo, await load("sportmaster/icon.svg"), await load("sportmaster/card_art.svg"));
}

async function ostinArtRaw() {
  // Dark wordmark on the light card colour, as on the «Кошелёк» card. Icon: the "O°" of the wordmark.
  const logo = trim(await load("ostin/logo.png"));
  const mark = trim(crop(logo, 0, 0, Math.round(logo.width * 0.3)));
  return densities(logo, centered(mark, 256, 256, 0.7, "rgb(244, 241, 236)"), await load("ostin/card_art.svg"));
}

// Artwork doesn't depend on the card number, so render each variant once per page load.
const cache = new Map<string, Promise<Files>>();
const once = (key: string, make: () => Promise<Files>) => {
  if (!cache.has(key)) cache.set(key, make().catch((e) => { cache.delete(key); throw e; }));
  return cache.get(key)!;
};
export const x5Art = () => once("x5", x5ArtRaw);
export const magnitArt = () => once("magnit", magnitArtRaw);
export const aptekiArt = () => once("apteki", aptekiArtRaw);
export const milesSmilesArt = (tier: string) => once("tk:" + (tier === "CCN" ? "CCN" : "other"), () => milesSmilesArtRaw(tier));
export const sportmasterArt = () => once("sportmaster", sportmasterArtRaw);
export const ostinArt = () => once("ostin", ostinArtRaw);
