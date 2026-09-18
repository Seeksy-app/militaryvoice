// The email shell draws the wave, the wordmark and the per-email label itself.
// The artwork had all three baked in, so every email showed them twice and the
// label landed on top of the wordmark. This paints the baked text out with the
// same navy the artwork already fades from, leaving the photograph.
import sharp from "sharp";
import path from "node:path";

const [, , src, out] = process.argv;
const img = sharp(src);
const { width: W, height: H } = await img.metadata();

// Sample the flat navy at the far left, where the artwork is already solid.
const { data } = await sharp(src).extract({ left: 4, top: 4, width: 40, height: H - 8 }).stats();
const [r, g, b] = (await sharp(src).extract({ left: 4, top: 4, width: 40, height: H - 8 }).resize(1, 1).raw().toBuffer());
const navy = `rgb(${r},${g},${b})`;
console.log("left edge navy:", navy);

// Opaque across the text, fading out before the face begins.
const cover = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0"    stop-color="${navy}" stop-opacity="1"/>
    <stop offset="0.60" stop-color="${navy}" stop-opacity="1"/>
    <stop offset="0.80" stop-color="${navy}" stop-opacity="0"/>
  </linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
</svg>`);

await sharp(src).composite([{ input: cover, blend: "over" }]).jpeg({ quality: 86 }).toFile(out);
console.log("wrote", path.basename(out));
