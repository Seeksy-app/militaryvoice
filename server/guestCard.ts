import sharp, { type OverlayOptions } from "sharp";
import { fitSize, textPath, textWidth } from "./textPath.js";

// The guest card a show puts at the start and end of an episode: the host on
// one side, this episode's guest on the other, names under their circles, the
// show's web address and name along the foot. Same card every month; only the
// guest's photo and name change.
//
// Drawn the way the share cards are: SVG over a sharp composite, type as
// outlines (the runtime has no fonts). 1280x720, the size YouTube wants for a
// thumbnail, so the same picture serves as the thumbnail.

export const GUEST_CARD = { w: 1280, h: 720 } as const;

export interface GuestCardInput {
  hostName: string;
  hostPhoto: Buffer;
  guestName: string;
  guestPhoto: Buffer;
  /** Foot, left: the show's web address. */
  footerLeft?: string;
  /** Foot, right: the show's name, in two weights ("LIFE" bold, the rest softer). */
  footerRight?: { strong: string; soft: string };
  /** Top-left tag line, optional (an episode number, for example). */
  tag?: string;
}

const NAVY_DEEP = "#071a46";
const NAVY = "#0c2a66";
const GLOW = "#2f6fe0";
const DOTS = "#3f86ff";

async function circle(src: Buffer, size: number): Promise<Buffer> {
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
  return sharp(src)
    .rotate() // honour the phone's orientation
    .resize(size, size, { fit: "cover", position: "attention" })
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

/** Upper-case, trimmed, one line: a long name shrinks to fit its column. */
function nameLine(name: string, cx: number, y: number, maxW: number): string {
  const t = name.trim().toUpperCase();
  const size = fitSize(t, "bold", 36, 20, maxW);
  return textPath(t, { x: cx, y, size, weight: "bold", fill: "#ffffff", anchor: "middle", letterSpacing: 1 });
}

function dotted(cx: number, y: number, w: number): string {
  return `<line x1="${cx - w / 2}" y1="${y}" x2="${cx + w / 2}" y2="${y}" stroke="${DOTS}" stroke-width="3" stroke-dasharray="1 7" stroke-linecap="round"/>`;
}

/**
 * A show's own card, on its own background, with its logo in the corner (27 Nov 2026: Riccoh's Warriors' Voice,
 * "card A": black with a soft silver wave, Andrew's pick). Same layout as the card Andrew approved: two photos in
 * silver rings, names in white with a silver double rule, the web address bottom-left, the logo bottom-right.
 */
export interface StyledCardInput {
  background: Buffer;
  logo?: Buffer;
  hostName: string;
  hostPhoto: Buffer;
  guestName: string;
  guestPhoto: Buffer;
  footerLeft?: string;
}

async function ringed(src: Buffer, r: number, ring: number): Promise<Buffer> {
  const d = 2 * r, D = 2 * (r + ring);
  // Head and shoulders: a wide photo keeps its middle, a tall one its top (the "attention" crop can land on a
  // bright background instead of the face, as it did on a guest's landscape headshot).
  const upright = await sharp(src).rotate().toBuffer();
  const m = await sharp(upright).metadata();
  const tall = (m.height ?? 1) > (m.width ?? 1) * 1.1;
  const mask = Buffer.from(`<svg width="${d}" height="${d}"><circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="#fff"/></svg>`);
  const photo = await sharp(upright).resize(d, d, { fit: "cover", position: tall ? "north" : "centre" }).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  const rim = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${D}" height="${D}"><circle cx="${D / 2}" cy="${D / 2}" r="${r + ring / 2}" fill="none" stroke="#cdcdd2" stroke-width="${ring}"/></svg>`);
  return sharp({ create: { width: D, height: D, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: photo, left: ring, top: ring }, { input: rim, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

export async function renderStyledCard(i: StyledCardInput): Promise<Buffer> {
  const { w, h } = GUEST_CARD;
  const R = 190, ring = 5, cy = 285;
  const lx = 330, rx = 950;
  const nameY = cy + R + 34 + 32;
  const ruleY = cy + R + 100;
  const name = (n: string, cx: number) => {
    const t = n.trim().toUpperCase();
    return textPath(t, { x: cx, y: nameY, size: fitSize(t, "bold", 40, 22, 480), weight: "bold", fill: "#ececee", anchor: "middle" });
  };
  const rule = (cx: number) => `<line x1="${cx - 120}" y1="${ruleY}" x2="${cx + 120}" y2="${ruleY}" stroke="#96969c" stroke-width="2"/><line x1="${cx - 120}" y1="${ruleY + 6}" x2="${cx + 120}" y2="${ruleY + 6}" stroke="#96969c" stroke-width="2"/>`;
  const foot = i.footerLeft ? textPath(i.footerLeft.toUpperCase(), { x: 44, y: h - 38, size: 22, weight: "bold", fill: "#bebec4" }) : "";
  const shadow = (cx: number) => `<circle cx="${cx}" cy="${cy + 14}" r="${R}" fill="#000" fill-opacity="0.65" filter="url(#s)"/>`;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="22"/></filter></defs>
  ${shadow(lx)}${shadow(rx)}
  ${name(i.hostName, lx)}${rule(lx)}${name(i.guestName, rx)}${rule(rx)}${foot}
</svg>`);
  const [host, guest] = await Promise.all([ringed(i.hostPhoto, R, ring), ringed(i.guestPhoto, R, ring)]);
  const layers: OverlayOptions[] = [
    { input: svg, left: 0, top: 0 },
    { input: host, left: lx - R - ring, top: cy - R - ring },
    { input: guest, left: rx - R - ring, top: cy - R - ring },
  ];
  if (i.logo) {
    const m = await sharp(i.logo).metadata();
    layers.push({ input: i.logo, left: w - (m.width ?? 146) - 40, top: h - (m.height ?? 176) - 26 });
  }
  return sharp(i.background).resize(w, h, { fit: "cover" }).composite(layers).png().toBuffer();
}

export async function renderGuestCard(i: GuestCardInput): Promise<Buffer> {
  const { w, h } = GUEST_CARD;
  const d = 420; // circle diameter
  const cy = 280; // circle centre
  const lx = Math.round(w * 0.25), rx = Math.round(w * 0.75);
  const colW = 500;
  const nameY = cy + d / 2 + 62;
  const lineY = nameY + 28;
  const footY = h - 36;

  const footL = i.footerLeft ? textPath(i.footerLeft.toUpperCase(), { x: 44, y: footY, size: 24, weight: "bold", fill: "#ffffff", letterSpacing: 1 }) : "";
  let footR = "";
  if (i.footerRight) {
    const strong = i.footerRight.strong.toUpperCase(), soft = i.footerRight.soft.toUpperCase();
    const sw = textWidth(strong + " ", 24, "bold", 1), ow = textWidth(soft, 24, "bold", 1);
    const x0 = w - 44 - sw - ow;
    footR = textPath(strong, { x: x0, y: footY, size: 24, weight: "bold", fill: "#ffffff", letterSpacing: 1 })
      + textPath(soft, { x: x0 + sw, y: footY, size: 24, weight: "bold", fill: "#8fa6d6", letterSpacing: 1 });
  }
  const tag = i.tag ? textPath(i.tag.toUpperCase(), { x: 44, y: 62, size: 22, weight: "bold", fill: "#8fa6d6", letterSpacing: 3 }) : "";

  const base = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${NAVY_DEEP}"/><stop offset="0.6" stop-color="${NAVY}"/><stop offset="1" stop-color="${NAVY_DEEP}"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${GLOW}" stop-opacity="0.55"/><stop offset="1" stop-color="${GLOW}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <ellipse cx="${w / 2}" cy="${cy}" rx="230" ry="200" fill="url(#glow)"/>
  ${tag}
  ${nameLine(i.hostName, lx, nameY, colW)}
  ${dotted(lx, lineY, 360)}
  ${nameLine(i.guestName, rx, nameY, colW)}
  ${dotted(rx, lineY, 360)}
  ${footL}${footR}
</svg>`);

  const [host, guest] = await Promise.all([circle(i.hostPhoto, d), circle(i.guestPhoto, d)]);
  return sharp(base)
    .composite([
      { input: host, left: lx - d / 2, top: cy - d / 2 },
      { input: guest, left: rx - d / 2, top: cy - d / 2 },
    ])
    .png()
    .toBuffer();
}
