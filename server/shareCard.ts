import sharp, { type OverlayOptions } from "sharp";

// The 1200x630 card a podcaster's share link unfurls with. Their artwork and
// their on-air time, not the generic event card — a link that says "Rucksack
// Radio, 8:00 AM" earns a click in a way "24 Hour Podcastathon" does not.

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

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

/** Escape for embedding in SVG text. */
function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Trim to fit the card without wrapping — the card has one line for each. */
function fit(v: string, max: number): string {
  const s = v.trim();
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Shrink a long show name rather than cutting it. "Devil Dawg Double Dare
 * Podcast" is the name — an ellipsis in the middle of it is worse than a
 * smaller line, and only the truly enormous still get trimmed.
 */
function hostSize(v: string): number {
  const n = v.trim().length;
  if (n <= 28) return 32;
  if (n <= 40) return 27;
  return 23;
}

function titleSize(v: string): number {
  const n = v.trim().length;
  if (n <= 17) return 62;
  if (n <= 23) return 52;
  if (n <= 30) return 44;
  return 38;
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

export async function buildShareCard(
  input: { podcastName: string; hostName: string; whenLabel: string; photoUrl?: string },
  size: CardSize = "wide",
): Promise<Buffer> {
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

  const layers: OverlayOptions[] = [];
  let text: Buffer;

  if (vertical) {
    const cx = W / 2;
    const s1 = Math.round(26 * k * 1.25);
    const s2 = Math.round(titleSize(input.podcastName) * k * 1.25);
    const s3 = Math.round(hostSize(input.hostName) * k * 1.2);
    const pillW = Math.min(W - 120, Math.round((40 + input.whenLabel.length * 19) * k * 1.25));

    // Centre whatever there actually is, in the space above the footer line.
    // Reserving avatar height when there's no photo leaves the top half empty.
    const pillH = Math.round(78 * k);
    const gapA = Math.round(H * 0.06);
    const textH = s1 + s2 + s3 + 100 + pillH;
    const contentH = (avatar ? AV + gapA : 0) + textH;
    const footerZone = Math.round(H * 0.16);
    const blockTop = Math.max(Math.round(H * 0.06), Math.round((H - footerZone - contentH) / 2));
    const avTop = blockTop;
    const y = blockTop + (avatar ? AV + gapA : 0) + s1;

    text = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <text x="${cx}" y="${y}" font-family="${FONT}" font-size="${s1}" font-weight="700" fill="#F0A71F" text-anchor="middle" letter-spacing="2">LIVE ON NATIONAL MILITARY PODCAST DAY</text>
      <text x="${cx}" y="${y + s2 + 24}" font-family="${FONT}" font-size="${s2}" font-weight="700" fill="#ffffff" text-anchor="middle">${esc(fit(input.podcastName, 30))}</text>
      <text x="${cx}" y="${y + s2 + s3 + 60}" font-family="${FONT}" font-size="${s3}" font-weight="400" fill="#c8d8ee" text-anchor="middle">with ${esc(fit(input.hostName, 40))}</text>
      <rect x="${cx - pillW / 2}" y="${y + s2 + s3 + 100}" width="${pillW}" height="${pillH}" rx="${Math.round(pillH / 2)}" fill="#F0A71F"/>
      <text x="${cx}" y="${y + s2 + s3 + 100 + Math.round(52 * k)}" font-family="${FONT}" font-size="${Math.round(30 * k * 1.2)}" font-weight="700" fill="#1a1200" text-anchor="middle">${esc(fit(input.whenLabel, 28))}</text>
      <text x="${cx}" y="${H - Math.round(H * 0.07)}" font-family="${FONT}" font-size="${Math.round(26 * k * 1.15)}" font-weight="600" fill="#9fb6d6" text-anchor="middle">24 Hour Podcastathon · militaryvoice.ai</text>
    </svg>`);

    if (avatar) {
      layers.push(
        {
          input: Buffer.from(
            `<svg width="${AV + 20}" height="${AV + 20}"><circle cx="${(AV + 20) / 2}" cy="${(AV + 20) / 2}" r="${AV / 2 + 6}" fill="none" stroke="#F0A71F" stroke-width="6" opacity="0.85"/></svg>`,
          ),
          top: avTop - 10,
          left: Math.round(cx - (AV + 20) / 2),
        },
        { input: avatar, top: avTop, left: Math.round(cx - AV / 2) },
      );
    }
  } else {
    const textLeft = avatar ? 380 : 80;
    text = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <text x="${textLeft}" y="176" font-family="${FONT}" font-size="26" font-weight="700" fill="#F0A71F" letter-spacing="2.2">LIVE ON NATIONAL MILITARY PODCAST DAY</text>
      <text x="${textLeft}" y="266" font-family="${FONT}" font-size="${titleSize(input.podcastName)}" font-weight="700" fill="#ffffff">${esc(fit(input.podcastName, 38))}</text>
      <text x="${textLeft}" y="322" font-family="${FONT}" font-size="${hostSize(input.hostName)}" font-weight="400" fill="#c8d8ee">with ${esc(fit(input.hostName, 52))}</text>
      <rect x="${textLeft}" y="376" width="${Math.min(560, 40 + input.whenLabel.length * 19)}" height="64" rx="32" fill="#F0A71F"/>
      <text x="${textLeft + 30}" y="418" font-family="${FONT}" font-size="29" font-weight="700" fill="#1a1200">${esc(fit(input.whenLabel, 28))}</text>
      <text x="${textLeft}" y="520" font-family="${FONT}" font-size="25" font-weight="600" fill="#9fb6d6">24 Hour Podcastathon · militaryvoice.ai</text>
    </svg>`);

    if (avatar) {
      layers.push(
        {
          input: Buffer.from(
            `<svg width="${AV + 20}" height="${AV + 20}"><circle cx="${(AV + 20) / 2}" cy="${(AV + 20) / 2}" r="${AV / 2 + 6}" fill="none" stroke="#F0A71F" stroke-width="6" opacity="0.85"/></svg>`,
          ),
          top: (H - AV) / 2 - 10,
          left: 70,
        },
        { input: avatar, top: (H - AV) / 2, left: 80 },
      );
    }
  }

  layers.push({ input: text, top: 0, left: 0 });
  return sharp(ground).composite(layers).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}
