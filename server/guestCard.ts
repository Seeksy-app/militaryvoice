import sharp from "sharp";
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
