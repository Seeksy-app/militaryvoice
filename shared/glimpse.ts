// Glimpse (Elorian) visual review of a clip: what the shared code agrees on.
//
// A pilot, off unless an admin switches it on. Glimpse watches a clip's
// excerpt and says what it sees (cuts, where the speaker sits, what's in the
// way, text on screen, whether a 9:16 crop holds), with times. A person reads
// that next to the clip and says whether it helped. Nothing here changes the
// clips a podcaster gets. Our transcript stays the authority on what was said.
//
// The fields below are ours, not Elorian's: the model is asked for this JSON
// and whatever comes back is checked here before it's kept.

export const GLIMPSE_MODEL = "elorian-1-agent";
/** The output cap on this account (GET /v1/limits, 17 Oct 2026). Thinking comes out of it too. */
export const GLIMPSE_MAX_TOKENS = 4096;
/** At most this many clips per review, and this long each (their limit is 376 frames: 75s at 5fps). */
export const GLIMPSE_MAX_CLIPS = 6;
export const GLIMPSE_MAX_SEC = 75;

// Prices in micro-dollars per token ($0.60 / $0.06 / $3.00 per million).
const IN = 0.6, CACHED = 0.06, OUT = 3;
/**
 * Held against the day's cap while a clip is out: the most one can cost.
 * 75s at 5fps is 375 frames at ~98 tokens, ~37k in; plus a transcript and
 * 4,096 out. Comes to about 4¢; 6¢ leaves room.
 */
export const GLIMPSE_RESERVE_MICRO = 60_000;
/** The day's ceiling unless an admin sets another: $1. */
export const GLIMPSE_DEFAULT_CAP_MICRO = 1_000_000;

export type GlimpseUsage = { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };

/** Whether one more clip fits under the day's cap, counting what's out now. */
export function glimpseFits(spend: { reserved: number; actual: number }, capMicro: number): boolean {
  return spend.reserved + spend.actual + GLIMPSE_RESERVE_MICRO <= capMicro;
}

/** What a run cost, from the usage it reported. */
export function glimpseCostMicro(u: GlimpseUsage | null | undefined): number {
  if (!u) return 0;
  const cached = Math.max(0, Number(u.prompt_tokens_details?.cached_tokens) || 0);
  const fresh = Math.max(0, (Number(u.prompt_tokens) || 0) - cached);
  return Math.round(fresh * IN + cached * CACHED + Math.max(0, Number(u.completion_tokens) || 0) * OUT);
}

export type Span = { from: number; to: number; note: string };
export type GlimpseObservations = {
  /** Camera cuts. */
  shots: { at: number; note: string }[];
  /** Where the person speaking is in the frame, and for how long. */
  subject: Span[];
  /** Anything in the way: a mic in front of a face, a hand, a logo, a cut-off head. */
  obstructions: Span[];
  /** Text that can be read on screen. */
  onScreenText: { at: number; text: string }[];
  /** Whether a 9:16 vertical crop holds the speaker: yes, partly or no. */
  crop916: { verdict: "yes" | "partly" | "no"; note: string; problems: Span[] };
  /** What it wasn't sure of. */
  uncertainty: string;
};

export type GlimpseState = {
  status: "queued" | "running" | "done" | "failed" | "skipped";
  recordingId: number;
  /** Where the excerpt sits in the episode; every time below is episode time, in seconds. */
  sourceStart: number;
  sourceEnd: number;
  requestedBy: string;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  model?: string;
  requestId?: string;
  observations?: GlimpseObservations;
  /** Things the check threw out or doubted: an out-of-range time, a missing part. */
  warnings?: string[];
  usage?: { prompt: number; cached: number; completion: number; costMicro: number };
  error?: string;
  /** A person's call: was it useful? */
  review?: { useful: boolean; note: string; by: string; at: string };
};

/** The ask. Plain about what not to do: no reading people, no judging what they say. */
export function glimpsePrompt(durationSec: number, transcript: string): string {
  return [
    `This is a ${Math.round(durationSec)}-second excerpt from a podcast video. We will crop it to vertical (9:16) for social media, and we want to know what is visible, so a person can check the framing.`,
    "",
    "Describe only what can be seen. Do not judge anyone's emotions, mental state, intent, identity, or credibility, and do not comment on whether what they say is true. Do not quote speech; the transcript below is ours and is correct.",
    "",
    "Answer with JSON only, no other text, in exactly this shape. All times are seconds from the start of this excerpt.",
    `{"shots":[{"at":0,"note":"what the new shot shows"}],`,
    ` "subject":[{"from":0,"to":12,"note":"where the person speaking is in the frame, e.g. left third, centred, two people side by side"}],`,
    ` "obstructions":[{"from":3,"to":5,"note":"anything covering a face or the speaker: a microphone, a hand, a graphic, a head cut off by the frame"}],`,
    ` "onScreenText":[{"at":2,"text":"text exactly as it appears on screen"}],`,
    ` "crop916":{"verdict":"yes|partly|no","note":"whether a centred or tracked 9:16 crop keeps the speaker's face in frame","problems":[{"from":0,"to":4,"note":"why"}]},`,
    ` "uncertainty":"anything you could not see clearly or are not sure of"}`,
    "",
    "Use empty lists where there is nothing to report. Times are approximate; say so in uncertainty if they may be off.",
    "",
    "Transcript of the excerpt (for orientation only):",
    transcript.slice(0, 4000) || "(none)",
  ].join("\n");
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : NaN);
const str = (v: unknown, n = 300) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/**
 * The model's answer, checked and moved onto the episode's clock.
 * Excerpt time t becomes sourceStart + t. A time outside the excerpt (with a
 * second's grace) is dropped and noted, never clamped into place.
 */
export function parseGlimpse(text: string, sourceStart: number, durationSec: number): { ok: true; observations: GlimpseObservations; warnings: string[] } | { ok: false; error: string } {
  const body = String(text ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const a = body.indexOf("{"), z = body.lastIndexOf("}");
  if (a < 0 || z <= a) return { ok: false, error: "The answer had no JSON in it." };
  let raw: any;
  try { raw = JSON.parse(body.slice(a, z + 1)); } catch { return { ok: false, error: "The answer's JSON didn't parse." }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "The answer wasn't a JSON object." };

  const warnings: string[] = [];
  const inRange = (t: number) => t >= -1 && t <= durationSec + 1;
  const at = (t: number) => Math.round((sourceStart + Math.min(Math.max(t, 0), durationSec)) * 10) / 10;
  const list = (k: string): any[] => {
    if (raw[k] === undefined) { warnings.push(`No "${k}" in the answer.`); return []; }
    if (!Array.isArray(raw[k])) { warnings.push(`"${k}" wasn't a list.`); return []; }
    return raw[k].slice(0, 40);
  };
  const point = (k: string, field: "note" | "text") => list(k).flatMap((x) => {
    const t = num(x?.at);
    if (!Number.isFinite(t) || !inRange(t)) { warnings.push(`Dropped a ${k} item at ${String(x?.at)}s: outside the excerpt.`); return []; }
    return [{ at: at(t), [field]: str(x?.[field]) } as any];
  });
  const spans = (items: any[], k: string): Span[] => items.flatMap((x) => {
    const f = num(x?.from), t = num(x?.to);
    if (!Number.isFinite(f) || !Number.isFinite(t) || t < f || !inRange(f) || !inRange(t)) { warnings.push(`Dropped a ${k} item ${String(x?.from)}–${String(x?.to)}s: outside the excerpt or backwards.`); return []; }
    return [{ from: at(f), to: at(t), note: str(x?.note) }];
  });

  const c = raw.crop916 && typeof raw.crop916 === "object" ? raw.crop916 : null;
  if (!c) warnings.push(`No "crop916" in the answer.`);
  const verdict = ["yes", "partly", "no"].includes(String(c?.verdict).toLowerCase()) ? (String(c.verdict).toLowerCase() as "yes" | "partly" | "no") : "partly";
  if (c && verdict !== String(c.verdict).toLowerCase()) warnings.push(`Unclear crop verdict "${str(c.verdict, 40)}"; shown as "partly".`);

  return {
    ok: true,
    warnings,
    observations: {
      shots: point("shots", "note"),
      subject: spans(list("subject"), "subject"),
      obstructions: spans(list("obstructions"), "obstructions"),
      onScreenText: point("onScreenText", "text"),
      crop916: { verdict, note: str(c?.note), problems: spans(Array.isArray(c?.problems) ? c.problems.slice(0, 40) : [], "crop problem") },
      uncertainty: str(raw.uncertainty, 600),
    },
  };
}

/**
 * Elorian errors that mean stop, not try the next clip: the key is wrong or
 * gone, or the money is. Matched loosely: a code or a status.
 */
export function glimpseStops(status: number, code: string): boolean {
  return status === 401 || status === 402 || status === 403 || /credits_exhausted|insufficient|budget|invalid_api_key|unauthori[sz]ed|permission/i.test(code);
}
