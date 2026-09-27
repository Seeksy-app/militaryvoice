import opentype from "opentype.js";
import { INTER_BOLD_B64, INTER_REGULAR_B64 } from "./assets/fonts.js";
import { MONTSERRAT_700_B64, MONTSERRAT_800_B64 } from "./assets/montserrat.js";

// Draw text as vector outlines instead of asking the renderer for a font.
//
// The share cards are composed as SVG and rasterised by sharp/librsvg. On
// Vercel there are no fonts installed at all, so every <text> element came out
// as a row of empty boxes — locally it looked perfect, because macOS has
// Helvetica. Outlines have no such dependency: the glyphs travel in the
// bundle, and the card renders identically everywhere.

/** Inter regular and bold; Montserrat 700 ("strong") and 800 ("heavy") for clips. */
export type Weight = "regular" | "bold" | "strong" | "heavy";

const SOURCES: Record<Weight, string> = { regular: INTER_REGULAR_B64, bold: INTER_BOLD_B64, strong: MONTSERRAT_700_B64, heavy: MONTSERRAT_800_B64 };

const fonts = new Map<Weight, opentype.Font>();

function font(weight: Weight): opentype.Font {
  const cached = fonts.get(weight);
  if (cached) return cached;
  const bytes = Buffer.from(SOURCES[weight], "base64");
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
  const d = pathData(font(o.weight).getPath(text, x, o.y, o.size, opts(o.size, ls)).commands);
  return `<path d="${d}" fill="${o.fill}"/>`;
}

/**
 * SVG path data from the outline's commands, written here. opentype.js's own
 * toPathData(2) sometimes prints NaN for a coordinate that is a perfectly good
 * number (about 1 glyph in 60 in Montserrat, depending on where it lands), and
 * librsvg stops drawing the word at the NaN: "families" came out as "f".
 */
function pathData(commands: opentype.PathCommand[]): string {
  const n = (v: number) => (Math.round(v * 100) / 100).toString();
  return commands
    .map((c) => {
      switch (c.type) {
        case "M": case "L": return `${c.type}${n(c.x)} ${n(c.y)}`;
        case "Q": return `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`;
        case "C": return `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`;
        default: return "Z";
      }
    })
    .join("");
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
