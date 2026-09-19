// The tightened cut of a segment: ums out, false starts out, dead air shortened.
//
// ⚠️ NOT WIRED IN. The cut list is right and the render is right, and the two
// do not meet: cutting the exact span Scribe reports for a filler does not
// remove that filler. Proven down to a single cut — trim 26.36-26.80 out of a
// segment whose transcript puts "Um," at 26.36, and the output still says
// "Right? Um, I wanted to do more". The right *amount* of time comes out, from
// the wrong places, which is the worst shape this could take because the
// duration looks correct.
//
// Three explanations tested and rejected: a double input-seek in the test
// harness (same result from one file), select's timeline drift (trim/concat is
// absolute and behaves identically), and a container start-time offset (all
// streams start at zero). What is left, and what to measure next, is the
// mapping itself — Scribe times the 16kHz mp3 it is sent, and something
// between that and the video's timeline is shifted. The way to find it is a
// known marker: a file with a click at a measured position, transcribed, and
// the reported time compared with the real one.
//
// Do not enable this until that number is known. Half-removed fillers in a
// podcaster's "refined" episode is worse than no refined episode.
//
// This exists because Scribe hands us the two hardest parts for free. Fillers
// arrive as ordinary words with start and end times, and a false start comes
// back with a trailing hyphen — "honest-", "A-", "ex-" — so the thing that
// would otherwise need a classifier is a field. What is left is arithmetic and
// one ffmpeg pass.
//
// Two rules shape the cutting, both learned from how a naive version sounds:
//
//   1. **Cut on the gaps, not on the words.** Removing exactly the span a word
//      occupies clips the breath either side of it and leaves a click. The cut
//      is widened into the silence around the word, and the silence is where a
//      splice is inaudible.
//   2. **Never cut a beat somebody meant.** A pause before an answer is
//      content. Only silence longer than a person would leave on purpose is
//      shortened, and it is shortened to a real pause rather than removed.

export interface Word {
  text: string;
  start: number;
  end: number;
  type?: string;
}

export interface Span {
  start: number;
  end: number;
  why: "filler" | "false-start" | "silence";
  text: string;
}

/** The seven Deepgram tags plus the ones any transcriber spells out. */
const FILLER = /^(um+|uh+|erm?|ah|hmm+|mm-?hmm|mhmm|uh-huh|uh-uh|nuh-uh)[.,!?…]*$/i;

/** Scribe marks an abandoned word with a trailing hyphen: "honest-", "ex-". */
const FALSE_START = /[A-Za-z0-9]-$/;

export interface RefineOptions {
  /** Silence longer than this is shortened. A held beat is content. */
  maxGapSec?: number;
  /** What a shortened silence becomes. */
  keepGapSec?: number;
  /** Padding either side of a cut word, taken from the surrounding silence. */
  padSec?: number;
  /** Cuts shorter than this are not worth the splice. */
  minCutSec?: number;
}

/**
 * What to remove, and why.
 *
 * Returned rather than applied so the decision can be inspected, counted and
 * shown to the podcaster — "we took out 41 ums" is a claim somebody will want
 * to check, and a list of spans is how they check it.
 */
export function cutList(words: Word[], opts: RefineOptions = {}): Span[] {
  const maxGap = opts.maxGapSec ?? 0.9;
  const keepGap = opts.keepGapSec ?? 0.35;
  const pad = opts.padSec ?? 0.04;
  const minCut = opts.minCutSec ?? 0.08;

  const w = words.filter((x) => (x.type ?? "word") === "word" && x.text.trim());
  const spans: Span[] = [];

  for (let i = 0; i < w.length; i++) {
    const cur = w[i];
    const bare = cur.text.replace(/^[^A-Za-z0-9]+/, "");
    const isFiller = FILLER.test(bare);
    const isFalse = FALSE_START.test(bare);
    if (!isFiller && !isFalse) continue;

    // Widen into the silence on each side, but never into a neighbouring word
    // — eating the first phoneme of the next word is worse than leaving the um.
    const prevEnd = i > 0 ? w[i - 1].end : 0;
    const nextStart = i < w.length - 1 ? w[i + 1].start : cur.end + pad;
    const start = Math.max(prevEnd, cur.start - pad);
    const end = Math.min(nextStart, cur.end + pad);
    if (end - start < minCut) continue;
    spans.push({ start, end, why: isFiller ? "filler" : "false-start", text: cur.text });
  }

  // Dead air between words, once the above has been taken out of the picture.
  for (let i = 0; i < w.length - 1; i++) {
    const gapStart = w[i].end;
    const gapEnd = w[i + 1].start;
    if (gapEnd - gapStart <= maxGap) continue;
    // Leave a real pause in the middle rather than butting the words together.
    const trimStart = gapStart + keepGap / 2;
    const trimEnd = gapEnd - keepGap / 2;
    if (trimEnd - trimStart < minCut) continue;
    spans.push({ start: trimStart, end: trimEnd, why: "silence", text: "" });
  }

  return merge(spans);
}

/** Overlapping cuts become one, so the keep-ranges never invert. */
function merge(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) {
      last.end = Math.max(last.end, s.end);
      continue;
    }
    out.push({ ...s });
  }
  return out;
}

/** The inverse: what survives. */
export function keepRanges(cuts: Span[], duration: number): { start: number; end: number }[] {
  const keeps: { start: number; end: number }[] = [];
  let at = 0;
  for (const c of cuts) {
    if (c.start > at) keeps.push({ start: at, end: c.start });
    at = Math.max(at, c.end);
  }
  if (at < duration) keeps.push({ start: at, end: duration });
  return keeps.filter((k) => k.end - k.start > 0.02);
}

/**
 * A filter graph that keeps only the surviving ranges.
 *
 * trim/atrim per range, concatenated — not select with a sum of between()
 * terms, which was the obvious version and is wrong. select evaluates `t`
 * against a timeline that earlier drops have already shortened, so every cut
 * shifts the ones after it by the amount removed so far. Measured on a real
 * segment: the first filler survived and everything behind it moved exactly
 * its length earlier, and across seventy ranges the drift left half the
 * fillers in place while still removing the right total duration — which is
 * the worst shape a bug can have, because the output looks correct.
 *
 * trim takes absolute source times and each segment is independent, so there
 * is nothing to accumulate.
 */
export function trimGraph(keeps: { start: number; end: number }[]): string {
  const parts: string[] = [];
  for (const [i, k] of keeps.entries()) {
    const a = k.start.toFixed(3);
    const b = k.end.toFixed(3);
    parts.push(`[0:v]trim=start=${a}:end=${b},setpts=PTS-STARTPTS[v${i}]`);
    parts.push(`[0:a]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS[a${i}]`);
  }
  const ins = keeps.map((_, i) => `[v${i}][a${i}]`).join("");
  parts.push(`${ins}concat=n=${keeps.length}:v=1:a=1[v][a]`);
  return parts.join(";");
}

/** A line a person can read: what came out, and how much shorter it is. */
export function summarise(cuts: Span[], duration: number): string {
  const n = (why: Span["why"]) => cuts.filter((c) => c.why === why).length;
  const removed = cuts.reduce((t, c) => t + (c.end - c.start), 0);
  const pct = duration > 0 ? (removed / duration) * 100 : 0;
  const parts = [
    n("filler") ? `${n("filler")} fillers` : "",
    n("false-start") ? `${n("false-start")} false starts` : "",
    n("silence") ? `${n("silence")} long pauses` : "",
  ].filter(Boolean);
  return `${parts.join(", ") || "nothing to cut"} — ${removed.toFixed(0)}s off ${duration.toFixed(0)}s (${pct.toFixed(1)}%)`;
}
