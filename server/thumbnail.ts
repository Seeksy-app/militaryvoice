import sharp from "sharp";
import { fitSize, textPath, textWidth } from "./textPath.js";

// A video post's thumbnail in our clip style: the clip's navy title band across
// the top (white Montserrat title, gold show name), a still from the video under
// it. 1280x720, what YouTube asks for; LinkedIn, Facebook and X take the same
// picture. A whole episode opens on a black frame and LinkedIn shows the first
// frame, so without this Frank's talk went up as a black box (Andrew, 23 Nov:
// "Please ensure each video post has a thumbnail… Especially when we do
// post-production for Frank, we need to have that custom thumbnail").
//
// Type is drawn as outlines (textPath): the runtime has no fonts.

export const THUMB = { w: 1280, h: 720 } as const;
const BAND = 0.27; // of the height: the same weight as a clip's band
const NAVY = "#000741";
const GOLD = "#F0A71F";

export interface ThumbInput {
  title: string;
  /** The show's name, the gold line. Optional. */
  show?: string;
  /** A still from the video (any size; filled and cropped to the space under the band). */
  frame?: Buffer;
  /** With no frame: the show's cover art, centred on navy. */
  cover?: Buffer;
  /** Their show logo (else their cover art), small in the picture's top-right corner, as it sits while they're live.
      plate: what reads behind it ("light" for dark ink, "dark" for light ink, "none" for an opaque picture). */
  logo?: { buf: Buffer; plate: "light" | "dark" | "none" };
}

export async function renderThumbnail(i: ThumbInput): Promise<Buffer> {
  const { w, h } = THUMB;
  const bandH = Math.round(h * BAND);
  const below = h - bandH;

  const band = titleBand(i.title.trim(), w, bandH, (i.show ?? "").trim());
  const layers: { input: Buffer; top: number; left: number }[] = [];
  if (i.frame) {
    layers.push({ input: await sharp(i.frame).rotate().resize(w, below, { fit: "cover", position: "centre" }).toBuffer(), top: bandH, left: 0 });
  } else if (i.cover) {
    const s = below - 60;
    layers.push({ input: await sharp(i.cover).rotate().resize(s, s, { fit: "cover" }).toBuffer(), top: bandH + 30, left: Math.round((w - s) / 2) });
  }
  layers.push({ input: Buffer.from(band), top: 0, left: 0 });
  if (i.frame && i.logo) {
    const chip = await cornerChip(i.logo).catch(() => null);
    if (chip) layers.push({ input: chip.buf, top: bandH + 22, left: w - chip.w - 24 });
  }
  return sharp({ create: { width: w, height: h, channels: 3, background: NAVY } })
    .composite(layers)
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
}

/** The logo on its plate: at most 150×84 of logo, 10px of plate round it, rounded corners. */
async function cornerChip(logo: { buf: Buffer; plate: "light" | "dark" | "none" }): Promise<{ buf: Buffer; w: number }> {
  const img = await sharp(logo.buf, { density: 300 }).rotate().resize(150, 84, { fit: "inside", withoutEnlargement: false }).png().toBuffer();
  const m = await sharp(img).metadata();
  const lw = m.width ?? 150, lh = m.height ?? 84;
  const pad = logo.plate === "none" ? 0 : 10;
  const cw = lw + pad * 2, ch = lh + pad * 2;
  const fill = logo.plate === "light" ? "rgba(255,255,255,0.94)" : logo.plate === "dark" ? "rgba(0,7,65,0.88)" : "none";
  const plate = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}"><rect width="${cw}" height="${ch}" rx="10" fill="${fill}"/></svg>`);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}"><rect width="${cw}" height="${ch}" rx="10" fill="#fff"/></svg>`);
  const buf = await sharp(plate)
    .composite([{ input: img, top: pad, left: pad }, { input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
  return { buf, w: cw };
}

/** The band as SVG: one line of title as large as fits, two when it won't, the show line under it. */
function titleBand(title: string, w: number, h: number, show: string): string {
  const boxW = w * 0.9;
  let size = fitSize(title, "heavy", 64, 40, boxW);
  let rows = [title];
  if (textWidth(title, size, "heavy") > boxW) {
    rows = wrap(title, 48, boxW);
    size = Math.min(...rows.map((r) => fitSize(r, "heavy", 48, 30, boxW)));
  }
  // Two lines at most; anything that still won't fit (a long unbroken word) ends in an ellipsis rather than off the edge.
  rows = rows.slice(0, 2).map((r) => clip(r, size, boxW));
  const lead = size * 1.1;
  const titleY = show ? h * 0.44 : h * 0.55;
  const titleSvg = rows
    .map((r, n) => textPath(r, { x: w / 2, y: titleY + size * 0.36 + (n - (rows.length - 1) / 2) * lead, size, weight: "heavy", fill: "#ffffff", anchor: "middle" }))
    .join("");
  const sub = show.length > 52 ? `${show.slice(0, 50).trimEnd()}…` : show;
  const subSize = sub ? fitSize(sub.toUpperCase(), "strong", 24, 16, boxW) : 0;
  const subSvg = sub
    ? textPath(sub.toUpperCase(), { x: w / 2, y: h * 0.84 + subSize * 0.36, size: subSize, weight: "strong", fill: GOLD, anchor: "middle", letterSpacing: subSize * 0.08 })
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${NAVY}"/>${titleSvg}${subSvg}</svg>`;
}

/** The row as it is when it fits, else cut back to the last whole character that leaves room for "…". */
function clip(row: string, size: number, boxW: number): string {
  if (textWidth(row, size, "heavy") <= boxW) return row;
  let n = row.length;
  while (n > 1 && textWidth(`${row.slice(0, n).trimEnd()}…`, size, "heavy") > boxW) n--;
  return `${row.slice(0, n).trimEnd()}…`;
}

/** Two lines of about equal width. */
function wrap(text: string, size: number, boxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  let best = [text];
  let bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    const m = Math.max(textWidth(a, size, "heavy"), textWidth(b, size, "heavy"));
    if (m < bestW && m <= boxW * 1.4) { bestW = m; best = [a, b]; }
  }
  return best;
}
