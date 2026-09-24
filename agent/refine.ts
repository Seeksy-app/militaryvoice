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

// ---------------------------------------------------------------------------
// Snapping cuts to the sound
// ---------------------------------------------------------------------------
// What was wrong, measured (24 Sep 2026, a real segment, 79 words after a
// pause): Scribe's word boundaries are not where the sound is. Starts come
// back a median 0.11s late, ends anywhere from on time to half a second off,
// and not by a constant — so no offset fixes it. It is not the mp3 (a
// lossless copy gets identical times). A cut made at the reported span starts
// after the "um" has begun, leaves its first half, and takes the right amount
// of time from the wrong place.
//
// So the transcript only says *which* sound to remove and roughly where. The
// cut itself is placed on the audio: find the burst of voice that is the
// filler, and cut from the quiet before it to the quiet after it. A filler
// whose burst can't be found is left in — cutting blind is how you clip the
// next word.

/** Loudness per 10ms frame, from 16kHz mono PCM (signed 16-bit, little-endian). */
export function envelope(pcm: Buffer, sampleRate = 16000, frameSec = 0.01): number[] {
  const F = Math.round(sampleRate * frameSec);
  const n = Math.floor(pcm.length / 2);
  const out: number[] = [];
  for (let i = 0; i + F <= n; i += F) {
    let sum = 0;
    for (let k = 0; k < F; k++) {
      const v = pcm.readInt16LE((i + k) * 2);
      sum += v * v;
    }
    out.push(Math.sqrt(sum / F));
  }
  return out;
}

const FRAME = 0.01;
const pctile = (xs: number[], p: number) => {
  const q = [...xs].sort((a, b) => a - b);
  return q[Math.min(q.length - 1, Math.max(0, Math.floor(p * (q.length - 1))))] ?? 0;
};

/** Voiced runs in [a, b) frames: at least 40ms above the line, gaps under 40ms bridged. */
function runs(env: number[], a: number, b: number, line: number): { on: number; off: number; energy: number }[] {
  const out: { on: number; off: number; energy: number }[] = [];
  let cur: { on: number; off: number; energy: number } | null = null;
  let quiet = 0;
  for (let k = Math.max(0, a); k < Math.min(env.length, b); k++) {
    if (env[k] > line) {
      if (!cur) cur = { on: k, off: k + 1, energy: 0 };
      cur.off = k + 1;
      cur.energy += env[k];
      quiet = 0;
    } else if (cur) {
      quiet++;
      if (quiet > 4) {
        if (cur.off - cur.on >= 4) out.push(cur);
        cur = null;
        quiet = 0;
      }
    }
  }
  if (cur && cur.off - cur.on >= 4) out.push(cur);
  return out;
}

/** The quietest frame in [a, b). */
function valley(env: number[], a: number, b: number): number {
  let best = Math.max(0, a);
  for (let k = Math.max(0, a); k < Math.min(env.length, b); k++) if (env[k] < env[best]) best = k;
  return best;
}

/**
 * Move each cut onto the sound. Fillers and false starts are re-found in the
 * audio; long silences are measured from the audio rather than the gap
 * between reported words. Cuts that can't be placed are dropped.
 */
export function snapToAudio(cuts: Span[], env: number[], opts: RefineOptions = {}): Span[] {
  const maxGap = opts.maxGapSec ?? 0.9;
  const keepGap = opts.keepGapSec ?? 0.35;
  const f = (t: number) => Math.round(t / FRAME);
  const out: Span[] = [];
  for (const c of cuts) {
    // The room's own level around this spot: the quiet 20% and the loud 5%.
    const w0 = f(c.start - 1.5), w1 = f(c.end + 1.5);
    const local = env.slice(Math.max(0, w0), Math.min(env.length, w1));
    if (local.length < 20) continue;
    const floor = pctile(local, 0.2);
    const loud = pctile(local, 0.95);
    const line = floor + 0.2 * (loud - floor);

    if (c.why === "silence") {
      // The longest stretch under the line between the two words, measured.
      let bestA = -1, bestB = -1, runA = -1;
      for (let k = f(c.start - 0.35); k <= f(c.end + 0.35); k++) {
        const low = (env[k] ?? 0) <= line;
        if (low && runA < 0) runA = k;
        if ((!low || k === f(c.end + 0.35)) && runA >= 0) {
          if (k - runA > bestB - bestA) { bestA = runA; bestB = k; }
          runA = -1;
        }
      }
      const gap = (bestB - bestA) * FRAME;
      if (bestA < 0 || gap <= maxGap) continue;
      const s = bestA * FRAME + keepGap / 2;
      const e = bestB * FRAME - keepGap / 2;
      if (e - s >= 0.08) out.push({ ...c, start: s, end: e });
      continue;
    }

    // A filler or false start: the burst nearest where Scribe put it, allowing
    // for Scribe running late.
    const want = [c.start - 0.12, c.end - 0.05];
    const candidates = runs(env, f(c.start - 0.35), f(c.end + 0.15), line)
      .map((r) => ({ ...r, overlap: Math.min(r.off * FRAME, want[1]) - Math.max(r.on * FRAME, want[0]) }))
      .filter((r) => r.overlap > 0.02 && (r.off - r.on) * FRAME <= 1.2);
    if (!candidates.length) continue;
    const burst = candidates.sort((a, b) => b.overlap - a.overlap)[0];
    // Out through the quiet either side — a splice in silence is inaudible.
    const s = valley(env, burst.on - 12, burst.on + 1);
    const e = valley(env, burst.off - 1, burst.off + 12) + 1;
    if ((e - s) * FRAME >= 0.08) out.push({ ...c, start: s * FRAME, end: e * FRAME });
  }
  return merge(out);
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
