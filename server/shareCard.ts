import sharp, { type OverlayOptions } from "sharp";
import { fitSize, textPath, textWidth } from "./textPath.js";

// The card a podcaster's share link unfurls with, and the image we post to
// their accounts. Their artwork and their on-air time, not the generic event
// card — a link that says "Rucksack Radio, 8:00 AM" earns a click in a way
// "24 Hour Podcastathon" does not.
//
// All type is drawn as outlines (see textPath) because the runtime has no
// fonts. That also means we know exactly how wide every line is, so the pill
// fits its label and a long show name shrinks instead of being cut.

/**
 * The shapes each network actually wants. "wide" is the link-preview card;
 * the other two are for posting the image itself, where a 1200x630 would be
 * letterboxed into near-invisibility in a phone feed.
 */
export const CARD_SIZES = {
  wide: { w: 1200, h: 630 },
  square: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
} as const;
export type CardSize = keyof typeof CARD_SIZES;

const DEFAULT_EYEBROW = "LIVE ON NATIONAL MILITARY PODCAST DAY";
const DEFAULT_FOOTER = "24 Hour Podcastathon · militaryvoice.ai";

/** Trim to fit the card without wrapping — the card has one line for each. */
function fit(v: string, max: number): string {
  const s = v.trim();
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

async function circularAvatar(url: string, size: number): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const src = Buffer.from(await res.arrayBuffer());
    const mask = Buffer.from(
      `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
    );
    return await sharp(src)
      .resize(size, size, { fit: "cover", position: "attention" })
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
  } catch {
    // A missing or broken photo must not cost us the whole card.
    return null;
  }
}

function ring(av: number): Buffer {
  const s = av + 20;
  return Buffer.from(
    `<svg width="${s}" height="${s}"><circle cx="${s / 2}" cy="${s / 2}" r="${av / 2 + 6}" fill="none" stroke="#F0A71F" stroke-width="6" opacity="0.85"/></svg>`,
  );
}

export interface CardInput {
  podcastName: string;
  hostName: string;
  whenLabel: string;
  photoUrl?: string;
  /** Campaign cards swap the lines; the share card keeps the defaults. */
  eyebrow?: string;
  subline?: string;
  footer?: string;
}

export async function buildShareCard(input: CardInput, size: CardSize = "wide"): Promise<Buffer> {
  const EYEBROW = (input.eyebrow ?? DEFAULT_EYEBROW).toUpperCase();
  const FOOTER = input.footer ?? DEFAULT_FOOTER;
  const { w: W, h: H } = CARD_SIZES[size];
  // Wide is a link preview and reads left-to-right. Square and story are the
  // image itself in a phone feed, where a centred stack reads far better.
  const vertical = size !== "wide";
  const k = W / 1200; // scale the wide design's type to the target width

  const ground = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#000741"/>
        <stop offset="60%" stop-color="#053877"/>
        <stop offset="100%" stop-color="#06498f"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <circle cx="${W * 0.9}" cy="${H * 0.15}" r="${W * 0.18}" fill="#ffffff" opacity="0.04"/>
    <circle cx="${W * 0.95}" cy="${H * 0.88}" r="${W * 0.15}" fill="#F0A71F" opacity="0.06"/>
  </svg>`);

  const AV = Math.round(vertical ? W * 0.34 : 260);
  const avatar = input.photoUrl ? await circularAvatar(input.photoUrl, AV) : null;

  // Generous: fitSize shrinks the type to the box before this ever cuts.
  const name = fit(input.podcastName, vertical ? 46 : 48);
  const host = input.subline ?? `with ${fit(input.hostName, vertical ? 42 : 54)}`;
  const when = fit(input.whenLabel, 30);

  const layers: OverlayOptions[] = [];
  const parts: string[] = [];

  if (vertical) {
    const cx = W / 2;
    const box = W - Math.round(W * 0.12) * 2;

    const ls1 = 2.4 * k;
    const s1 = fitSize(EYEBROW, "bold", Math.round(30 * k), Math.round(20 * k), box - ls1 * EYEBROW.length);
    const s2 = fitSize(name, "bold", Math.round(74 * k), Math.round(34 * k), box);
    const s3 = Math.round(34 * k);
    const s4 = Math.round(36 * k);
    const s5 = Math.round(27 * k);

    const pillPadX = Math.round(38 * k);
    const pillH = Math.round(s4 * 2.2);
    const pillW = Math.min(W - 100, Math.round(textWidth(when, s4, "bold") + pillPadX * 2));

    // Centre whatever there actually is, in the space above the footer line.
    // Reserving avatar height when there is no photo left the top half empty.
    const gapA = Math.round(H * 0.055);
    const lead2 = Math.round(s2 * 1.35);
    const lead3 = Math.round(s3 * 1.7);
    const lead4 = Math.round(s3 * 1.1);
    const textH = s1 + lead2 + lead3 + lead4 + pillH;
    const contentH = (avatar ? AV + gapA : 0) + textH;
    const footerZone = Math.round(H * 0.1);
    const top = Math.max(Math.round(H * 0.06), Math.round((H - footerZone - contentH) / 2));

    const yEyebrow = top + (avatar ? AV + gapA : 0) + s1;
    const yName = yEyebrow + lead2;
    const yHost = yName + lead3;
    const pillTop = yHost + lead4;

    parts.push(
      textPath(EYEBROW, { x: cx, y: yEyebrow, size: s1, weight: "bold", fill: "#F0A71F", letterSpacing: ls1, anchor: "middle" }),
      textPath(name, { x: cx, y: yName, size: s2, weight: "bold", fill: "#ffffff", anchor: "middle" }),
      textPath(host, { x: cx, y: yHost, size: s3, weight: "regular", fill: "#c8d8ee", anchor: "middle" }),
      `<rect x="${cx - pillW / 2}" y="${pillTop}" width="${pillW}" height="${pillH}" rx="${Math.round(pillH / 2)}" fill="#F0A71F"/>`,
      textPath(when, { x: cx, y: pillTop + Math.round(pillH / 2 + s4 * 0.35), size: s4, weight: "bold", fill: "#1a1200", anchor: "middle" }),
      textPath(FOOTER, { x: cx, y: H - Math.round(H * 0.06), size: s5, weight: "bold", fill: "#9fb6d6", anchor: "middle" }),
    );

    if (avatar) {
      layers.push(
        { input: ring(AV), top: top - 10, left: Math.round(cx - (AV + 20) / 2) },
        { input: avatar, top, left: Math.round(cx - AV / 2) },
      );
    }
  } else {
    const x = avatar ? 380 : 80;
    const box = W - x - 80;

    const s2 = fitSize(name, "bold", 62, 30, box);
    const pillPadX = 30;
    const pillH = 64;
    const pillW = Math.min(box, Math.round(textWidth(when, 29, "bold") + pillPadX * 2));

    parts.push(
      textPath(EYEBROW, { x, y: 176, size: 26, weight: "bold", fill: "#F0A71F", letterSpacing: 2.2 }),
      textPath(name, { x, y: 266, size: s2, weight: "bold", fill: "#ffffff" }),
      textPath(host, { x, y: 322, size: 27, weight: "regular", fill: "#c8d8ee" }),
      `<rect x="${x}" y="376" width="${pillW}" height="${pillH}" rx="32" fill="#F0A71F"/>`,
      textPath(when, { x: x + pillPadX, y: 418, size: 29, weight: "bold", fill: "#1a1200" }),
      textPath(FOOTER, { x, y: 520, size: 25, weight: "bold", fill: "#9fb6d6" }),
    );

    if (avatar) {
      layers.push(
        { input: ring(AV), top: (H - AV) / 2 - 10, left: 70 },
        { input: avatar, top: (H - AV) / 2, left: 80 },
      );
    }
  }

  layers.push({
    input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`),
    top: 0,
    left: 0,
  });
  return sharp(ground).composite(layers).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}
