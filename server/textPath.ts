import opentype from "opentype.js";
import { INTER_BOLD_B64, INTER_REGULAR_B64 } from "./assets/fonts";

// Draw text as vector outlines instead of asking the renderer for a font.
//
// The share cards are composed as SVG and rasterised by sharp/librsvg. On
// Vercel there are no fonts installed at all, so every <text> element came out
// as a row of empty boxes — locally it looked perfect, because macOS has
// Helvetica. Outlines have no such dependency: the glyphs travel in the
// bundle, and the card renders identically everywhere.

export type Weight = "regular" | "bold";

const fonts = new Map<Weight, opentype.Font>();

function font(weight: Weight): opentype.Font {
  const cached = fonts.get(weight);
  if (cached) return cached;
  const bytes = Buffer.from(weight === "bold" ? INTER_BOLD_B64 : INTER_REGULAR_B64, "base64");
  const parsed = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  fonts.set(weight, parsed);
  return parsed;
}

/** Letter-spacing in opentype.js is a fraction of the em, not pixels. */
function opts(size: number, letterSpacing: number) {
  return { letterSpacing: letterSpacing / size, kerning: true };
}

/** Width of the drawn text, in pixels. */
export function textWidth(text: string, size: number, weight: Weight, letterSpacing = 0): number {
  return font(weight).getAdvanceWidth(text, size, opts(size, letterSpacing));
}

/**
 * One <path> for the whole string, positioned like an SVG <text> would be:
 * `y` is the baseline, and `anchor` behaves like text-anchor.
 */
export function textPath(
  text: string,
  o: { x: number; y: number; size: number; weight: Weight; fill: string; letterSpacing?: number; anchor?: "start" | "middle" },
): string {
  const ls = o.letterSpacing ?? 0;
  // The trailing letter-space is real advance but not ink, so measured text
  // centres a touch left without dropping it.
  const w = textWidth(text, o.size, o.weight, ls) - ls;
  const x = o.anchor === "middle" ? o.x - w / 2 : o.x;
  const d = font(o.weight).getPath(text, x, o.y, o.size, opts(o.size, ls)).toPathData(2);
  return `<path d="${d}" fill="${o.fill}"/>`;
}

/**
 * The largest size at or below `max` that fits `maxWidth`, down to `min`.
 * Shrinking a long show name beats putting an ellipsis in the middle of it.
 */
export function fitSize(text: string, weight: Weight, max: number, min: number, maxWidth: number): number {
  for (let s = max; s > min; s -= 1) {
    if (textWidth(text, s, weight) <= maxWidth) return s;
  }
  return min;
}
