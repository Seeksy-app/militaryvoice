// Crop the ceremony portrait for the places it actually appears.
//
// The cards are circles, so a 3:4 portrait loses the top of the head and the
// shoulders to the mask. "attention" finds the face and crops square around
// it, which is the one thing a headshot must survive.
import sharp from "sharp";

const SRC = "Riccoh.jpeg";
const OUT = "client/public/riccoh-host.jpg";

const meta = await sharp(SRC).metadata();
console.log(`source: ${meta.width}x${meta.height}`);

const SIZE = 800;
const INSET = 0.88; // how much of the square the photo itself fills

// A circle inscribed in a square touches the edges at their midpoints — which
// on a headshot is the top of the head. Cropping flush to the square looks
// fine as a square and decapitates him as a circle, so the photo is inset and
// the gap filled with a blurred copy of itself rather than a flat colour the
// textured wall behind him would fight with.
const base = sharp(SRC).rotate();
const bg = await base.clone().resize(SIZE, SIZE, { fit: "cover", position: "attention" }).blur(28).modulate({ brightness: 1.04 }).toBuffer();
const fg = await base
  .clone()
  .resize(Math.round(SIZE * INSET), Math.round(SIZE * INSET), { fit: "cover", position: "attention" })
  .toBuffer();

await sharp(bg)
  .composite([{ input: fg, gravity: "south" }])
  .jpeg({ quality: 88, mozjpeg: true })
  .toFile(OUT);

const out = await sharp(OUT).metadata();
console.log(`wrote ${OUT}: ${out.width}x${out.height}`);
