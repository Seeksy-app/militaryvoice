// The show logo's picture work, kept apart from the routes so it can be tested without a database
// (script/show-logo.test.ts). See server/showLogo.ts.
import sharp from "sharp";

/** What sits behind the logo in the live corner: "light" behind dark ink, "dark" behind light ink, "none" when opaque. */
export type Plate = "light" | "dark" | "none";

/**
 * A raster logo is trimmed of its empty margin (a logo in a big transparent box would sit tiny in the corner) and
 * kept at most 1000px on its long side, as PNG so a clear background stays clear. SVG goes as it is.
 */
export async function prepareShowLogo(buf: Buffer, mime: string): Promise<{ buf: Buffer; mime: string; ext: string; plate: Plate }> {
  if (mime === "image/svg+xml") return { buf, mime, ext: "svg", plate: await plateOf(buf).catch(() => "light" as Plate) };
  let img = sharp(buf, { failOn: "none" }).rotate();
  try { img = sharp(await img.trim({ threshold: 10 }).toBuffer()); } catch { img = sharp(buf, { failOn: "none" }).rotate(); }
  const out = await img.resize({ width: 1000, height: 1000, fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
  return { buf: out, mime: "image/png", ext: "png", plate: await plateOf(out).catch(() => "light" as Plate) };
}

/** Opaque all over: it brings its own background. Otherwise the plate is the opposite of how light the logo's ink is. */
export async function plateOf(buf: Buffer): Promise<Plate> {
  const { data, info } = await sharp(buf, { failOn: "none" }).resize(64, 64, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let clear = 0, ink = 0, lum = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const a = data[i + 3] / 255;
    if (a < 0.9) clear++;
    if (a < 0.15) continue;
    ink += a;
    lum += a * (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
  }
  const px = data.length / info.channels;
  if (clear / px < 0.03) return "none";
  return ink && lum / ink > 0.62 ? "dark" : "light";
}

