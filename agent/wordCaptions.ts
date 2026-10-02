// Word-by-word captions, drawn here instead of by Creatomate.
//
// The look is Creatomate's "highlight" effect, which is what the clips have
// been going out with: a few words at a time in white Montserrat ExtraBold
// with a dark outline, and a gold box behind the word being said.
//
// It becomes one extra ffmpeg input rather than an overlay per word. Every
// state of the captions (a group of words, with one of them lit) is a PNG the
// full width of the frame, and a concat list says how long each is on screen.
// A 60-second clip is ~150 words, and a filter graph with 150 overlays in it
// takes longer to parse than to encode; one overlay fed a picture that changes
// costs nothing.

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { textPath, textWidth } from "../server/textPath.js";

export interface TimedWord { text: string; start: number; end: number }

const FILLER = /^(um+|uh+|erm*|ah+|hmm+|mm+|uh-huh)[,.!?]*$/i;

type Shape = "wide" | "vertical" | "square";

/** A clip's own caption look, set in Pōstify's editor: size as a multiple of the usual, and where the middle of the captions sits (a fraction of the height; null = the usual place). */
export interface CaptionStyle { scale: number; pos: number | null }

/**
 * Creatomate's placement, so a clip made here sits where one made there did, unless the clip has
 * its own style. `top` is the title band's height: captions never go under it.
 */
export function captionLayout(shape: Shape, W: number, H: number, style?: CaptionStyle | null, top = 0) {
  const vmin = Math.min(W, H) / 100;
  const scale = Math.min(1.8, Math.max(0.6, style?.scale || 1));
  const size = Math.round((shape === "wide" ? 5.4 : 6.6) * vmin * scale);
  const centre = H * (style?.pos != null ? Math.min(0.95, Math.max(0.05, style.pos)) : shape === "wide" ? 0.84 : shape === "square" ? 0.86 : 0.82);
  const lead = Math.round(size * 1.24);
  const h = Math.ceil((lead * 2 + size * 0.5) / 2) * 2;
  const y = Math.round(centre - h / 2);
  return { size, boxW: Math.round(W * 0.86), lead, h, y: Math.max(top + Math.round(H * 0.015), Math.min(H - h - Math.round(H * 0.02), y)) };
}

/** Wrap words into lines no wider than the box. */
function lines(words: string[], size: number, boxW: number): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  for (const w of words) {
    const next = [...cur, w];
    if (cur.length && textWidth(next.join(" "), size, "heavy") > boxW) {
      out.push(cur);
      cur = [w];
    } else cur = next;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Words into the groups that are on screen together: at most two lines and
 * about 30 characters, and a new group at the end of a sentence or at a pause,
 * so a caption never carries the tail of one thought into the next.
 */
export function groupWords(words: TimedWord[], size: number, boxW: number, maxChars = 30): TimedWord[][] {
  const groups: TimedWord[][] = [];
  let cur: TimedWord[] = [];
  for (const w of words) {
    if (cur.length) {
      const last = cur[cur.length - 1];
      const text = [...cur, w].map((x) => x.text).join(" ");
      const tooLong = text.length > maxChars || lines([...cur, w].map((x) => x.text), size, boxW).length > 2;
      if (tooLong || w.start - last.end > 0.6 || /[.!?]$/.test(last.text)) {
        groups.push(cur);
        cur = [];
      }
    }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);
  return groups;
}

/** One state: the group's words, with `lit` in the gold box (-1 for none). */
async function statePng(group: string[], lit: number, W: number, L: ReturnType<typeof captionLayout>): Promise<Buffer> {
  const { size, boxW, lead, h } = L;
  const rows = lines(group, size, boxW);
  const space = textWidth(" ", size, "heavy");
  const top = (h - rows.length * lead) / 2;
  const stroke = Math.max(3, Math.round(size * 0.17));
  const padX = Math.round(size * 0.16);
  let box = "";
  let ink = "";
  let n = 0;
  rows.forEach((row, r) => {
    const widths = row.map((w) => textWidth(w, size, "heavy"));
    const rowW = widths.reduce((a, b) => a + b, 0) + space * (row.length - 1);
    let x = (W - rowW) / 2;
    const base = top + r * lead + size * 0.93;
    row.forEach((word, i) => {
      if (n === lit) {
        box = `<rect x="${(x - padX).toFixed(1)}" y="${(base - size * 0.86).toFixed(1)}" width="${(widths[i] + padX * 2).toFixed(1)}" height="${(size * 1.08).toFixed(1)}" rx="${Math.round(size * 0.12)}" fill="#F0A71F"/>`;
      }
      const p = textPath(word, { x, y: base, size, weight: "heavy", fill: "#ffffff" });
      const d = p.match(/d="([^"]*)"/)?.[1] ?? "";
      // Outline first, fill over it: the stroke sits behind the letterform.
      ink += `<path d="${d}" fill="none" stroke="#000000" stroke-width="${stroke}" stroke-linejoin="round"/>${p}`;
      x += widths[i] + space;
      n++;
    });
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}">${box}${ink}</svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 2 }).toBuffer();
}

/**
 * The captions as one ffmpeg input: writes the PNGs and a concat list into
 * `dir` and returns the list, where to overlay it, and how tall it is. Times
 * are seconds from the start of the clip.
 */
export async function captionTrack(words: TimedWord[], shape: Shape, W: number, H: number, duration: number, dir: string, style?: CaptionStyle | null, top = 0): Promise<{ list: string; y: number } | null> {
  // Not on screen: false starts ("a-", "honest-") and fillers. They're in the
  // sound; written out they read as mistakes in the caption.
  const clean = words.filter((w) => w.text.trim() && w.end > 0 && w.start < duration && !/-$/.test(w.text.trim()) && !FILLER.test(w.text.trim()));
  if (!clean.length) return null;
  const L = captionLayout(shape, W, H, style, top);
  await fs.mkdir(dir, { recursive: true });
  const blank = path.join(dir, "blank.png");
  await fs.writeFile(blank, await sharp({ create: { width: W, height: L.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer());

  const groups = groupWords(clean, L.size, L.boxW);
  const entries: { file: string; dur: number }[] = [];
  let at = 0;
  const hold = (file: string, until: number) => {
    const dur = Math.min(until, duration) - at;
    if (dur <= 0.01) return;
    entries.push({ file, dur });
    at += dur;
  };
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    const next = groups[g + 1]?.[0]?.start ?? duration;
    // On from its first word; off when the next group starts, or half a
    // second after its last word if the speaker stops for longer than that.
    const from = Math.max(at, group[0].start);
    const until = Math.max(from, Math.min(next, group[group.length - 1].end + 0.5));
    hold(blank, from);
    for (let k = 0; k < group.length; k++) {
      const file = path.join(dir, `g${g}-${k}.png`);
      await fs.writeFile(file, await statePng(group.map((w) => w.text), k, W, L));
      hold(file, k === group.length - 1 ? until : Math.max(at, group[k + 1].start));
    }
  }
  hold(blank, duration);
  if (!entries.length) return null;

  // The concat demuxer ignores the last entry's duration unless the file is
  // listed once more after it.
  const quote = (f: string) => `'${f.replace(/'/g, "'\\''")}'`;
  const body = ["ffconcat version 1.0", ...entries.flatMap((e) => [`file ${quote(e.file)}`, `duration ${e.dur.toFixed(3)}`]), `file ${quote(entries[entries.length - 1].file)}`].join("\n");
  const list = path.join(dir, "captions.ffconcat");
  await fs.writeFile(list, body);
  return { list, y: L.y };
}
