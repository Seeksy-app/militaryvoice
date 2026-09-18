// Crop the photo library to the email header's shape.
//
// The header is a plain <img>, so the file's own proportions are what people
// see — a hero cropped by the browser gets whatever the middle happens to be.
// 1280x512 is 2.5:1 at twice the 640px card, so it stays sharp on a phone.
//
//   npx tsx scripts/email-banners.ts
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const W = 1280;
const H = 512;
const OUT = "client/public/email";

/** Source file → banner key. The key is what a broadcast stores. */
const BANNERS: [string, string][] = [
  ["client/public/listeners-bg.jpg", "welcome"],
  ["client/public/podcasters-bg.jpg", "podcasters"],
  ["client/public/hero-3.jpg", "studio"],
  ["client/public/hero-1.jpg", "conversation"],
  ["client/public/hero-11.jpg", "desk"],
  ["client/public/hero-12.jpg", "mic"],
  ["client/public/hero-6.jpg", "headphones"],
  ["client/public/hero-9.jpg", "board"],
  ["client/public/agenda-bg.jpg", "schedule"],
  ["client/public/podcasters-bg.jpg", "lineup"],
];

await fs.mkdir(OUT, { recursive: true });
for (const [src, key] of BANNERS) {
  try {
    await sharp(src)
      // "attention" picks the busiest region, which on a photo of people is
      // reliably the people rather than the ceiling.
      .resize(W, H, { fit: "cover", position: "attention" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(path.join(OUT, `${key}.jpg`));
    console.log(`${key}.jpg  ← ${path.basename(src)}`);
  } catch (err) {
    console.warn(`skipped ${key}: ${(err as Error).message}`);
  }
}
