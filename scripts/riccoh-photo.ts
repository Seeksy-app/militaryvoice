// Crop the ceremony portrait for the places it actually appears.
//
// The cards are circles, so the crop has to survive a circular mask: a circle
// inscribed in a square touches the top edge at its midpoint, which on a
// headshot is the crown. The first attempt solved that by insetting the photo
// and filling the gap with a blurred copy of itself — which read, correctly,
// as a blurry halo round his head.
//
// The real fix is framing, not fill. The portrait is 2316 wide by 3088 tall,
// and a square taken at full width from the very top puts the crown about 9%
// down and the shoulders on the bottom edge. Everything the mask cuts is
// plaster wall.
import sharp from "sharp";

const SRC = "media/riccoh-headshot-source.jpeg";
const OUT = "client/public/riccoh-host.jpg";
const SIZE = 800;

const upright = await sharp(SRC).rotate().toBuffer();
const meta = await sharp(upright).metadata();
const side = Math.min(meta.width!, meta.height!);
console.log(`source: ${meta.width}x${meta.height} → square ${side} from the top`);

await sharp(upright)
  .extract({ left: Math.round((meta.width! - side) / 2), top: 0, width: side, height: side })
  .resize(SIZE, SIZE)
  .jpeg({ quality: 88, mozjpeg: true })
  .toFile(OUT);

const out = await sharp(OUT).metadata();
console.log(`wrote ${OUT}: ${out.width}x${out.height}`);
