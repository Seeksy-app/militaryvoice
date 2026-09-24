// The clipping agent.
//
// Every booked slot is recorded to its own file. This worker turns each of
// those files into a handful of posts: it reads the segment, decides which
// moments are worth anyone's attention, and cuts them into the three shapes
// the networks actually take — landscape, vertical and square — with the words
// as a sidecar .srt.
//
// Two things make it cheap and fast where the tools podcasters pay for today
// are neither:
//
//   1. The transcript already exists. The captioning agent ran speech-to-text
//      on the segment while it was going out, because the audience wanted
//      captions. Those lines are kept, so clipping costs no second pass of
//      audio and no second bill — and it starts the moment the recorder stops
//      rather than after an upload and a queue.
//   2. Nothing here needs credentials of its own. The API hands out a signed
//      download link and takes the finished files back, so the worker holds
//      one token and no database, no storage keys and no cloud account.
//
// It is a plain Node process — Vercel runs functions, and this needs ffmpeg
// and minutes. Anywhere that runs Node works: LiveKit Cloud Agents, Fly,
// Railway, a small VM.
//
// Put the two secrets in your shell first, so neither ends up in scrollback
// or in a file — read -rs does not echo what you paste:
//
//   read -rs AGENT_TOKEN && export AGENT_TOKEN
//   read -rs ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY
//   read -rs ELEVENLABS_API_KEY && export ELEVENLABS_API_KEY
//   API_BASE=https://www.militaryvoice.ai npx tsx agent/clipper.ts
//
// ELEVENLABS_API_KEY is only needed for a recording that has no live
// transcript — an old episode, or anything staged for a test. Order is live
// transcript, then Scribe, then Deepgram, then local whisper.
//
// With no ANTHROPIC_API_KEY it still runs, falling back to picking the
// densest stretches of speech. That is worse, and it says so.

// A .env if there is one, the platform's own environment if there is not.
// Without this the worker reads only the shell it was launched from, so every
// new terminal starts with no keys and no token — and the token is the one
// thing that cannot be read back out of Vercel once it is marked sensitive.
import "dotenv/config";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { textPath, fitSize, textWidth } from "../server/textPath.js";

const API_BASE = (process.env.API_BASE || "http://localhost:3000").replace(/\/+$/, "");
const AGENT_TOKEN = process.env.AGENT_TOKEN || "";
const POLL_MS = Number(process.env.CLIP_POLL_MS || 30_000);
/** How many clips to cut from one segment. Five posts is a week of material. */
const WANTED = Number(process.env.CLIP_COUNT || 4);
const MIN_SEC = 20;
const MAX_SEC = 75;

/**
 * Fail before the first poll, with a sentence that says what to do.
 *
 * "Set" was the only test, and a placeholder is set. Pasting a runbook line
 * with AGENT_TOKEN=… straight into a shell puts a literal ellipsis in the
 * header, and every poll then dies with "Cannot convert argument to a
 * ByteString because the character at index 0 has a value of 8230" — which is
 * a true statement about UTF-8 and tells you nothing about what you did.
 */
function requireToken(): void {
  if (!AGENT_TOKEN) {
    console.error("AGENT_TOKEN is not set. The worker has no way to authenticate.");
    console.error("Find it in Vercel → militaryvoice → Settings → Environment Variables.");
    process.exit(1);
  }
  // HTTP header values are Latin-1. Anything outside it was pasted, not typed.
  const bad = [...AGENT_TOKEN].find((c) => c.charCodeAt(0) > 255);
  if (bad) {
    console.error(
      `AGENT_TOKEN contains "${bad}", which can't go in an HTTP header — ` +
        "it looks like a placeholder was pasted instead of the real token.",
    );
    process.exit(1);
  }
  if (process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.startsWith("sk-ant-")) {
    console.error("ANTHROPIC_API_KEY doesn't look like a key (it should start with sk-ant-).");
    process.exit(1);
  }
}

interface Line {
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
}

interface Job {
  recordingId: number;
  title: string;
  durationSec: number;
  downloadUrl: string;
  show: string;
  host: string;
  transcript: Line[];
}

interface Moment {
  title: string;
  caption: string;
  reason: string;
  startSec: number;
  endSec: number;
}

// ---------------------------------------------------------------------------
// Talking to the API
// ---------------------------------------------------------------------------

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-agent-token": AGENT_TOKEN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/**
 * Straight to storage, not through the API.
 *
 * Posting the file to the function capped every clip at 4.5MB — Vercel's
 * request body limit — and a vertical with burned-in captions is past that.
 * The job would do all its work and fail on the last step. The worker still
 * holds nothing but its token: it asks for a signed URL and uploads to that.
 */
async function uploadFile(file: string, contentType: string): Promise<string> {
  const name = path.basename(file);
  const signed = await api<{ uploadUrl: string; publicUrl: string }>(
    "POST",
    "/api/agent/clip-files/upload-url",
    { name },
  );
  const body = await fs.readFile(file);
  const res = await fetch(signed.uploadUrl, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: new Uint8Array(body),
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  console.log(`   uploaded ${name} (${(body.length / 1048576).toFixed(1)}MB)`);
  return signed.publicUrl;
}

// ---------------------------------------------------------------------------
// ffmpeg
// ---------------------------------------------------------------------------

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve(out || err) : reject(new Error(`${bin} exited ${code}: ${err.slice(-1200)}`)),
    );
  });
}

const ffmpeg = (args: string[]) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

/**
 * A title band drawn as vector outlines, not typeset by the renderer.
 *
 * The same lesson the share cards learned: a server has no fonts installed, so
 * anything that asks for one renders as empty boxes. Outlines travel with the
 * code and look identical everywhere.
 */
export async function titleBand(text: string, width: number, height: number, sub: string): Promise<Buffer> {
  const pad = Math.round(width * 0.06);
  const size = fitSize(text, "bold", Math.round(height * 0.3), Math.round(height * 0.14), width - pad * 2);
  const subSize = Math.round(size * 0.42);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="#000741"/>
    ${textPath(text, { x: width / 2, y: height * 0.52, size, weight: "bold", fill: "#ffffff", anchor: "middle" })}
    ${sub ? textPath(sub, { x: width / 2, y: height * 0.8, size: subSize, weight: "regular", fill: "#F0A71F", anchor: "middle", letterSpacing: subSize * 0.08 }) : ""}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** h264 will not encode an odd dimension, and stacking halves one twice. */
const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/**
 * Where the actual picture is inside the frame.
 *
 * Recorders letterbox. This source is a 1920x1080 file whose content is
 * 1920x758 with 270px of black on top — and scaling *that* into a vertical
 * canvas means carefully blurring a black bar and placing a postage stamp in
 * the middle of it. Everything downstream works off the real rectangle.
 *
 * Sampled a few seconds in, because the first frames of a cut are often a
 * transition and can read as smaller than the shot.
 */
export async function contentRect(
  source: string,
  atSec: number,
  within?: { w: number; h: number; x: number; y: number },
): Promise<{ w: number; h: number; x: number; y: number } | null> {
  try {
    const pre = within ? `crop=${within.w}:${within.h}:${within.x}:${within.y},` : "";
    const out = await run("ffmpeg", [
      "-hide_banner", "-ss", String(atSec + 2), "-t", "3", "-i", source,
      "-vf", `${pre}cropdetect=24:2:0`, "-f", "null", "-",
    ]);
    const found = [...out.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].pop();
    if (!found) return null;
    const [, w, h, x, y] = found.map(Number);
    return w > 0 && h > 0 ? { w, h, x, y } : null;
  } catch {
    return null;
  }
}

/** Wrap honestly — no line wider than the box. */
export function wrapCaption(text: string, size: number, boxW: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next, size, "bold") <= boxW || !cur) cur = next;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * One spoken line becomes as many captions as it needs.
 *
 * Every transcript line used to be exactly one caption, and a line too long
 * for two display lines was shrunk until it fitted — then, if it still did
 * not, truncated with an ellipsis. That silently dropped the end of what
 * somebody said off the bottom of their own clip. Speech is not optional
 * content.
 *
 * So a long line is split into successive captions of two display lines each,
 * and the line's duration is shared out by character count — which tracks how
 * long each part took to say closely enough that the words stay under the
 * voice.
 */
export function splitCaptions(caps: Line[], W: number, H: number): Line[] {
  const size = Math.round(H * 0.042);
  const boxW = Math.round(W * 0.86);
  const out: Line[] = [];
  for (const c of caps) {
    const wrapped = wrapCaption(c.text, size, boxW);
    if (wrapped.length <= 2) {
      out.push(c);
      continue;
    }
    const chunks: string[] = [];
    for (let i = 0; i < wrapped.length; i += 2) chunks.push(wrapped.slice(i, i + 2).join(" "));
    const total = chunks.reduce((n, t) => n + t.length, 0) || 1;
    let at = c.startSec;
    const span = Math.max(0.1, c.endSec - c.startSec);
    chunks.forEach((text, i) => {
      const share = i === chunks.length - 1 ? c.endSec - at : span * (text.length / total);
      out.push({ speaker: c.speaker, text, startSec: at, endSec: at + share });
      at += share;
    });
  }
  return out;
}

/**
 * One caption, drawn as vector outlines on transparency.
 *
 * This ffmpeg has 489 filters and none of them is `subtitles` — the build
 * carries no libass — so burning words in with an .ass file is not available
 * here and would not be guaranteed on whatever host this runs on next either.
 * The title band already solved the same problem the same way: outlines travel
 * with the code, need no font installed, and look identical everywhere.
 *
 * White with a heavy dark stroke rather than a box. A box is easier and reads
 * as a caption; a stroke reads as the video, which is the difference between
 * these and something that looks captioned after the fact.
 */
export async function captionPng(text: string, W: number, H: number): Promise<{ buf: Buffer; h: number }> {
  const boxW = Math.round(W * 0.86);
  const wrapAt = (size: number): string[] => wrapCaption(text, size, boxW);

  // Two lines at most — three covers a face, which is the thing the clip is
  // of. The way that used to be enforced was to glue the overflow lines
  // together: `lines.splice(1, 2, lines[1] + " " + lines[2])`. Nothing
  // re-measured the result, so a caption that wrapped to three lines produced
  // a second line far wider than the box and it ran straight off both edges of
  // the frame. Shrinking until it genuinely fits is the honest version.
  const ideal = Math.round(H * 0.042);
  const floor = Math.round(H * 0.026);
  let size = ideal;
  let lines = wrapAt(size);
  while (lines.length > 2 && size > floor) {
    size = Math.round(size * 0.93);
    lines = wrapAt(size);
  }
  // Still too long at the smallest readable size: a caption line this long is
  // a transcript bug, not a design problem. Keep two lines and say so.
  if (lines.length > 2) lines = [lines[0], `${lines[1]} …`];
  const lead = Math.round(size * 1.22);

  const h = lead * lines.length + Math.round(size * 0.5);
  const stroke = Math.max(3, Math.round(size * 0.16));
  const body = lines
    .map((line, i) => {
      const y = Math.round(size * 0.95) + i * lead;
      const path = textPath(line, { x: W / 2, y, size, weight: "bold", fill: "#ffffff", anchor: "middle" });
      const d = path.match(/d="([^"]*)"/)?.[1] ?? "";
      // Stroke first, fill over it, so the outline sits behind the letterform
      // instead of eating into it.
      return `<path d="${d}" fill="none" stroke="#000000" stroke-width="${stroke}" stroke-linejoin="round" opacity="0.85"/>${path}`;
    })
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}">${body}</svg>`;
  return { buf: await sharp(Buffer.from(svg)).png().toBuffer(), h };
}

/**
 * The geometry of one moment: the picture, and each speaker's panel inside it.
 *
 * Splitting the overall content rect down the middle was the obvious move and
 * it is wrong. On this source the whole rect is 1920x758 but each speaker's
 * tile is only 960x540 — the extra 218px is the show's logo sitting in the
 * corner. Halving the tall rect therefore stacked two panels each carrying a
 * band of black, which is exactly the dead space the stacking was meant to
 * remove.
 *
 * So each half is measured on its own. Slower by two ffmpeg calls per moment
 * and worth it: this is the difference between two faces filling the frame and
 * two faces with a black stripe between them.
 */
export async function frameGeometry(source: string, atSec: number) {
  const whole = await contentRect(source, atSec);
  if (!whole) return { whole: null, left: null, right: null, stack: false };

  // Wider than 2:1 is a side-by-side two-shot. One camera does not produce
  // that; two panels beside each other always do.
  const stack = whole.w / whole.h >= 2;
  if (!stack) return { whole, left: null, right: null, stack };

  const mid = Math.floor(whole.w / 2);
  const [l, r] = await Promise.all([
    contentRect(source, atSec, { w: mid, h: whole.h, x: whole.x, y: whole.y }),
    contentRect(source, atSec, { w: whole.w - mid, h: whole.h, x: whole.x + mid, y: whole.y }),
  ]);
  // A half that reads as empty falls back to its share of the whole, which is
  // the old behaviour and still better than failing the render.
  const left = l ? { ...l, x: l.x + whole.x, y: l.y + whole.y } : { w: mid, h: whole.h, x: whole.x, y: whole.y };
  const right = r
    ? { ...r, x: r.x + whole.x + mid, y: r.y + whole.y }
    : { w: whole.w - mid, h: whole.h, x: whole.x + mid, y: whole.y };
  return { whole, left, right, stack };
}

/** Cut one moment into one shape. */
export async function render(
  source: string,
  out: string,
  m: Moment,
  shape: "wide" | "vertical" | "square",
  band?: { file: string; height: number },
  geo?: Awaited<ReturnType<typeof frameGeometry>>,
  captions?: { text: string; startSec: number; endSec: number }[],
  dir?: string,
): Promise<void> {
  const dur = (m.endSec - m.startSec).toFixed(2);
  const size = shape === "wide" ? [1920, 1080] : shape === "vertical" ? [1080, 1920] : [1080, 1080];
  const [W, H] = size;
  const videoH = even(band ? H - band.height : H);

  // Everything starts from the real picture, not the file's frame. See
  // contentRect: recorders letterbox, and blurring a black bar to fill a
  // vertical canvas is how you get a postage stamp floating in grey.
  const r = geo?.whole ?? null;
  const cut = r ? `crop=${even(r.w)}:${even(r.h)}:${r.x}:${r.y},` : "";

  const chain: string[] = [];
  if (shape === "wide") {
    // A wide shot in a wide frame keeps its letterbox — cropping a two-shot to
    // 16:9 is how one of the two people disappears. The blur is of real
    // picture now rather than of the black bar it used to be given.
    chain.push(
      `[0:v]${cut}scale=${W}:${videoH}:force_original_aspect_ratio=increase,crop=${W}:${videoH},boxblur=28:2,setsar=1[bg]`,
      `[0:v]${cut}scale=${W}:${videoH}:force_original_aspect_ratio=decrease,setsar=1[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2[stage]`,
    );
  } else if (geo?.stack && geo.left && geo.right) {
    // Two panels stacked, each cropped to the speaker's own tile rather than
    // to half the overall rect — see frameGeometry for why that distinction
    // is the whole ballgame. Each fills 1080 wide and half the remaining
    // height, so two faces end up roughly four times the size letterboxing
    // gave them.
    const panel = even(videoH / 2);
    const box = (b: { w: number; h: number; x: number; y: number }) =>
      `crop=${even(b.w)}:${even(b.h)}:${b.x}:${b.y},scale=${W}:${panel}:force_original_aspect_ratio=increase,crop=${W}:${panel},setsar=1`;
    chain.length = 0;
    chain.push(
      `[0:v]split=2[l][rr]`,
      `[l]${box(geo.left)}[top]`,
      `[rr]${box(geo.right)}[bot]`,
      `[top][bot]vstack=inputs=2[stage]`,
    );
  } else {
    // One camera: fill the frame and let the sides go. A single speaker sits
    // in the middle of their own shot, so the edges are wall.
    chain.push(
      `[0:v]${cut}scale=${W}:${videoH}:force_original_aspect_ratio=increase,crop=${W}:${videoH},setsar=1[stage]`,
    );
  }

  const args = ["-ss", String(m.startSec), "-t", dur, "-i", source];
  let last = "[stage]";
  if (band) {
    args.push("-i", band.file);
    chain.push(`[stage]pad=${W}:${H}:0:${band.height}:color=#000741[padded]`);
    chain.push(`[padded][1:v]overlay=0:0[banded]`);
    last = "[banded]";
  }

  // Burned in, not a sidecar. Most of these are watched with the sound off,
  // and a clip nobody can read is a clip nobody finishes. Sized against a
  // fixed PlayRes so the same style lands identically at 1080x1920 and
  // 1920x1080 instead of being tiny in one of them.
  // Each caption is its own overlay, switched on for the seconds it belongs
  // to. Forty is the cap: a filter graph of a few dozen overlays is nothing,
  // a few hundred is a parser that takes longer than the encode.
  const caps = splitCaptions((captions ?? []).filter((c) => c.text.trim()), W, H).slice(0, 40);
  if (caps.length && dir) {
    let prev = last;
    for (let i = 0; i < caps.length; i++) {
      const c = caps[i];
      const { buf, h: ch } = await captionPng(c.text, W, H);
      const f = path.join(dir, `cap-${shape}-${i}.png`);
      await fs.writeFile(f, buf);
      args.push("-i", f);
      const idx = args.filter((a) => a === "-i").length - 1;
      const from = Math.max(0, c.startSec - m.startSec).toFixed(2);
      const to = Math.max(0, c.endSec - m.startSec).toFixed(2);
      const y = H - Math.round(H * 0.055) - ch;
      const label = i === caps.length - 1 ? "[v]" : `[c${i}]`;
      chain.push(`${prev}[${idx}:v]overlay=(W-w)/2:${y}:enable='between(t,${from},${to})'${label}`);
      prev = `[c${i}]`;
    }
  } else {
    chain.push(`${last}null[v]`);
  }

  args.push(
    "-filter_complex",
    chain.join(";"),
    "-map",
    "[v]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "21",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    out,
  );
  await ffmpeg(args);
}

// ---------------------------------------------------------------------------
// The transcript
// ---------------------------------------------------------------------------

/** Does the live transcript actually cover this segment, or did captions drop out? */
export function transcriptCovers(lines: Line[], durationSec: number): boolean {
  if (lines.length < 5) return false;
  const spoken = lines.reduce((n, l) => n + Math.max(0, l.endSec - l.startSec), 0);
  // A conversation is speech more often than not. Under a fifth means the
  // captioner was down for most of it and the picks would be built on a gap.
  return spoken > durationSec * 0.2;
}

/**
 * Transcribe with ElevenLabs Scribe.
 *
 * Preferred over Deepgram for a finished file, on evidence rather than
 * reputation: run over 90 seconds of a real two-person episode it kept every
 * filler with a timestamp, diarised both speakers, timed all 381 tokens, and
 * came back in 2.5 seconds. Deepgram does the first three too.
 *
 * What decided it is the fourth thing. Scribe marks false starts with a
 * trailing hyphen — "honest-", "A-", "ex-" — nine of them in that ninety
 * seconds, each with a start and end. Deepgram tags seven filler tokens and
 * nothing else, so cutting false starts there means an LLM pass over the
 * transcript guessing at what got abandoned. Here it is a field.
 *
 * Deepgram keeps the live captions: that is a streaming job with an official
 * LiveKit plugin already wired, and a different problem from reading a file.
 */
export async function transcribeWithScribe(file: string, dir: string): Promise<Line[]> {
  const key = (process.env.ELEVENLABS_API_KEY || "").trim();
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set.");

  // Compressed, not raw. Twenty minutes of 16kHz mono wav is ~38MB and the
  // upload was taking minutes on a domestic connection — far longer than the
  // recognition itself, which ran 90 seconds of audio in 2.1. Mono mp3 at 48k
  // is about a fifth the size and speech recognition cannot tell the
  // difference; the models are trained on worse.
  const audio = path.join(dir, "scribe.mp3");
  await ffmpeg(["-i", file, "-ac", "1", "-ar", "16000", "-b:a", "48k", "-vn", audio]);

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(await fs.readFile(audio))], { type: "audio/mpeg" }), "audio.mp3");
  form.append("model_id", "scribe_v1");
  form.append("diarize", "true");
  form.append("timestamps_granularity", "word");

  const mb = ((await fs.stat(audio)).size / 1048576).toFixed(1);
  console.log(`   uploading ${mb}MB to Scribe…`);
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const body = (await res.json()) as {
    words?: { text: string; start: number; end: number; type: string; speaker_id?: string }[];
  };

  // Scribe answers per word; the picker and the .srt both want spoken lines.
  // Broken on a speaker change, on sentence-ending punctuation, or on a pause
  // long enough to be a new thought — which is what a caption line is.
  const lines: Line[] = [];
  let cur: Line | null = null;
  for (const w of body.words ?? []) {
    if (w.type !== "word") continue;
    const speaker = w.speaker_id ?? "";
    const gap = cur ? w.start - cur.endSec : 0;
    if (!cur || speaker !== cur.speaker || gap > 0.8 || cur.text.length > 180) {
      if (cur) lines.push(cur);
      cur = { speaker, text: w.text, startSec: w.start, endSec: w.end };
    } else {
      cur.text += ` ${w.text}`;
      cur.endSec = w.end;
    }
    if (/[.!?]$/.test(w.text) && cur.text.length > 40) {
      lines.push(cur);
      cur = null;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Transcribe with Deepgram, which is what the live captions already use.
 *
 * The clipper was written to lean on the transcript the captions agent leaves
 * behind, and to fall back to whisper.cpp when there isn't one. But there is
 * never one for a file that didn't go out live — an old episode, a staged
 * test — and whisper means a 150MB model on the host before anything runs.
 * The same key that captions the show can read a file in one request.
 *
 * utterances=true is the point: it returns speech segments with start and end
 * times, which is exactly the shape the clip picker needs. A word-level
 * transcript would have to be re-grouped into sentences here, badly.
 */
async function transcribeWithDeepgram(file: string, dir: string): Promise<Line[]> {
  const key = (process.env.DEEPGRAM_API_KEY || "").trim();
  if (!key) throw new Error("DEEPGRAM_API_KEY is not set.");

  // Mono 16k is all speech recognition uses, and it makes a 400MB video into
  // a few megabytes of upload.
  const wav = path.join(dir, "dg.mp3");
  await ffmpeg(["-i", file, "-ac", "1", "-ar", "16000", "-b:a", "48k", "-vn", wav]);

  const q = new URLSearchParams({ model: "nova-3", smart_format: "true", utterances: "true", diarize: "true" });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${q}`, {
    method: "POST",
    headers: { authorization: `Token ${key}`, "content-type": "audio/mpeg" },
    body: await fs.readFile(wav),
  });
  if (!res.ok) throw new Error(`Deepgram ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const body = (await res.json()) as {
    results?: { utterances?: { start: number; end: number; transcript: string; speaker?: number }[] };
  };
  const utterances = body.results?.utterances ?? [];
  return utterances
    .filter((u) => u.transcript?.trim())
    .map((u) => ({
      speaker: typeof u.speaker === "number" ? `Speaker ${u.speaker + 1}` : "",
      text: u.transcript.trim(),
      startSec: u.start,
      endSec: u.end,
    }));
}

/** Last resort: transcribe the file here. Needs whisper-cli on the host. */
export async function transcribeLocally(file: string, dir: string): Promise<Line[]> {
  const wav = path.join(dir, "audio.wav");
  await ffmpeg(["-i", file, "-ac", "1", "-ar", "16000", "-vn", wav]);
  const base = path.join(dir, "whisper");
  // whisper.cpp's -m takes a path to a .bin, not a model name: the old default
  // of "base.en" could never resolve, so this branch has only ever failed.
  const model = process.env.WHISPER_MODEL;
  if (!model) {
    throw new Error(
      "No live transcript, and WHISPER_MODEL is not set. Point it at a whisper.cpp model file " +
        "(e.g. ggml-base.en.bin) to transcribe here instead.",
    );
  }
  await run("whisper-cli", ["-m", model, "-f", wav, "-ocsv", "-of", base]);
  const csv = await fs.readFile(`${base}.csv`, "utf8");
  return csv
    .split("\n")
    .slice(1)
    .map((row) => {
      const m = row.match(/^(\d+),(\d+),"?(.*?)"?$/);
      if (!m) return null;
      return { speaker: "", text: m[3].trim(), startSec: Number(m[1]) / 1000, endSec: Number(m[2]) / 1000 };
    })
    .filter((l): l is Line => Boolean(l && l.text));
}

function transcriptText(lines: Line[]): string {
  return lines
    .map((l) => `[${Math.floor(l.startSec)}] ${l.speaker ? `${l.speaker}: ` : ""}${l.text}`)
    .join("\n")
    .slice(0, 180_000);
}

export function srt(lines: Line[], offset: number): string {
  const stamp = (s: number) => {
    const ms = Math.max(0, Math.round(s * 1000));
    const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
    const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
    const sec = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
    return `${h}:${m}:${sec},${String(ms % 1000).padStart(3, "0")}`;
  };
  return lines
    .map((l, i) => `${i + 1}\n${stamp(l.startSec - offset)} --> ${stamp(l.endSec - offset)}\n${l.text}\n`)
    .join("\n");
}

/**
 * The same words as an ASS file, for burning in.
 *
 * SRT plus ffmpeg's force_style was the obvious route and it does not survive
 * contact with the filter parser: the commas inside a style string are read as
 * filter separators, so the graph fails to build. Escaping them is possible
 * and miserable. An ASS file carries its own style block instead, which means
 * no escaping, and — the part that actually matters — PlayResX/Y let the type
 * be sized against the canvas. Fontsize 78 is 78 units of a 1920-tall frame
 * here, not a number libass has to guess a scale for.
 *
 * Two lines at a time, because three lines of burned-in caption covers a face.
 */
export function assSubtitles(lines: Line[], offset: number, W: number, H: number): string {
  const stamp = (s: number) => {
    const cs = Math.max(0, Math.round(s * 100));
    const h = Math.floor(cs / 360000);
    const m = Math.floor((cs % 360000) / 6000);
    const sec = Math.floor((cs % 6000) / 100);
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
  };
  // Sized off the frame so a vertical and a wide clip read the same.
  const font = Math.round(H * 0.041);
  const margin = Math.round(W * 0.07);
  // Sat above the lower edge, and higher still on a stacked vertical so it
  // does not land across the bottom speaker's mouth.
  const marginV = H > W ? Math.round(H * 0.06) : Math.round(H * 0.05);

  const head = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // White on a heavy black outline: legible over a bright shirt and over a
    // dark wall without a box, which is the short-form house style everywhere.
    `Style: Cap,Helvetica,${font},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,${Math.round(font * 0.14)},0,2,${margin},${margin},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const events = lines
    .map((l) => {
      const text = l.text.replace(/[\r\n]+/g, " ").replace(/\{/g, "(").replace(/\}/g, ")").trim();
      if (!text) return "";
      return `Dialogue: 0,${stamp(l.startSec - offset)},${stamp(l.endSec - offset)},Cap,,0,0,0,,${text}`;
    })
    .filter(Boolean)
    .join("\n");

  return `${head}\n${events}\n`;
}

// ---------------------------------------------------------------------------
// Choosing the moments
// ---------------------------------------------------------------------------

const PICK_TOOL = {
  name: "pick_moments",
  description: "Return the moments from this segment that are worth posting on their own.",
  input_schema: {
    type: "object" as const,
    properties: {
      moments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Six words at most. What happens, not a label." },
            caption: { type: "string", description: "One or two sentences to post with it, in the host's register." },
            reason: { type: "string", description: "Why this stands alone, in one sentence, for the host to judge." },
            startSec: { type: "number" },
            endSec: { type: "number" },
          },
          required: ["title", "caption", "reason", "startSec", "endSec"],
        },
      },
    },
    required: ["moments"],
  },
};

export async function pickMoments(job: Job, lines: Line[]): Promise<Moment[]> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return densestStretches(lines);

  const client = new Anthropic({ apiKey: key });
  const prompt = `You are cutting clips from one segment of a 24-hour podcastathon for the military and veteran community.

Show: ${job.show}${job.host ? `\nHost: ${job.host}` : ""}
Segment length: ${Math.round(job.durationSec)} seconds.

Below is the transcript, each line prefixed with its offset in seconds from the start of the recording.

Pick the ${WANTED} strongest moments to post on their own. What makes a moment strong here:

- It is a story, a turn, or a claim someone would repeat — not an introduction, not a sign-off, not housekeeping.
- It stands up with no setup. Someone who has never heard of this show understands it cold.
- It starts on the first word of the thought and ends on the last. Do not start mid-sentence.
- Between ${MIN_SEC} and ${MAX_SEC} seconds.
- Moments do not overlap.

This community's stories carry real weight. Do not pick a moment because it sounds dramatic out of context, and do not write a caption that makes someone's service or loss into bait. Write the caption the way the host would say it.

If the segment genuinely has fewer than ${WANTED} moments that stand alone, return fewer. Returning two good ones is better than four with filler.

Transcript:
${transcriptText(lines)}`;

  const res = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    tools: [PICK_TOOL],
    tool_choice: { type: "tool", name: "pick_moments" },
    messages: [{ role: "user", content: prompt }],
  });

  const use = res.content.find((c) => c.type === "tool_use");
  if (!use || use.type !== "tool_use") return densestStretches(lines);
  const moments = ((use.input as { moments?: Moment[] }).moments ?? []).map((m) => ({
    title: String(m.title ?? "").slice(0, 120),
    caption: String(m.caption ?? "").slice(0, 400),
    reason: String(m.reason ?? "").slice(0, 400),
    startSec: Math.max(0, Math.floor(Number(m.startSec))),
    endSec: Math.ceil(Number(m.endSec)),
  }));
  return sane(moments, job.durationSec);
}

/**
 * Without a model: the stretches where the most is being said.
 *
 * Word density is a poor proxy for "worth watching" and this is not pretending
 * otherwise — it exists so a missing API key degrades the clips rather than
 * dropping the whole job on the floor.
 */
export function densestStretches(lines: Line[]): Moment[] {
  if (lines.length === 0) return [];
  const WINDOW = 45;
  const end = Math.max(...lines.map((l) => l.endSec));
  const scored: Moment[] = [];
  for (let t = 0; t + WINDOW <= end; t += 15) {
    const inWindow = lines.filter((l) => l.startSec >= t && l.endSec <= t + WINDOW);
    const words = inWindow.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
    if (words < 40) continue;
    scored.push({
      title: inWindow[0]?.text.split(/\s+/).slice(0, 7).join(" ") || "Clip",
      caption: "",
      reason: "Picked by speech density — no model was configured, so this is a rough cut.",
      startSec: Math.floor(t),
      endSec: Math.ceil(t + WINDOW),
    });
    // @ts-expect-error carried only for the sort below
    scored[scored.length - 1]._words = words;
  }
  return scored
    .sort((a, b) => ((b as never as { _words: number })._words ?? 0) - ((a as never as { _words: number })._words ?? 0))
    .filter((m, i, all) => all.slice(0, i).every((o) => m.startSec >= o.endSec || m.endSec <= o.startSec))
    .slice(0, WANTED)
    .sort((a, b) => a.startSec - b.startSec);
}

/** Refuse anything that would cut badly, rather than rendering it and finding out. */
export function sane(moments: Moment[], durationSec: number): Moment[] {
  const kept: Moment[] = [];
  for (const m of moments.sort((a, b) => a.startSec - b.startSec)) {
    const start = Math.max(0, m.startSec);
    const end = Math.min(durationSec || m.endSec, m.endSec);
    const len = end - start;
    if (!Number.isFinite(len) || len < MIN_SEC || len > MAX_SEC + 15) continue;
    if (kept.some((k) => start < k.endSec && end > k.startSec)) continue;
    if (!m.title.trim()) continue;
    kept.push({ ...m, startSec: start, endSec: end });
  }
  return kept.slice(0, WANTED);
}

// ---------------------------------------------------------------------------
// One job
// ---------------------------------------------------------------------------

/**
 * Tell the site where this job has got to. The podcaster's processing screen
 * reads it, and each report also keeps the claim fresh. Never fatal: a job that
 * can't report still finishes.
 */
/**
 * Render one moment's three shapes with Creatomate (through our API, which
 * holds the key): our framing, our title band, its word-by-word captions. The
 * finished files come back here and go up to our own storage like any render,
 * so nothing depends on Creatomate keeping them. Returns null when Creatomate
 * isn't set up or fails, and the caller renders with ffmpeg instead.
 */
async function renderWithCreatomate(
  job: Job,
  m: Moment,
  source: string,
  geo: Awaited<ReturnType<typeof frameGeometry>>,
  files: { wide: string; vertical: string; square: string },
): Promise<boolean> {
  if ((process.env.CLIP_RENDERER || "").toLowerCase() === "ffmpeg") return false;
  try {
    const probe = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", source]);
    const [srcW, srcH] = probe.trim().split(",").map(Number);
    const { renders } = await api<{ renders: { shape: "wide" | "vertical" | "square"; id: string }[] }>("POST", "/api/agent/clip-renders", {
      videoUrl: job.downloadUrl,
      start: m.startSec,
      length: m.endSec - m.startSec,
      title: m.title,
      show: job.show,
      geo: { srcW, srcH, ...geo },
    });
    const pending = new Map(renders.map((r) => [r.id, r.shape]));
    const deadline = Date.now() + 15 * 60_000;
    while (pending.size && Date.now() < deadline) {
      await new Promise((z) => setTimeout(z, 5000));
      for (const [id, shape] of [...pending]) {
        const s = await api<{ status: string; url: string; error: string }>("GET", `/api/agent/clip-renders/${id}`);
        if (s.status === "failed") throw new Error(`Creatomate ${shape}: ${s.error || "failed"}`);
        if (s.status === "succeeded" && s.url) {
          const got = await fetch(s.url);
          if (!got.ok) throw new Error(`couldn't fetch the ${shape} render: ${got.status}`);
          await fs.writeFile(files[shape], new Uint8Array(await got.arrayBuffer()));
          pending.delete(id);
        }
      }
    }
    if (pending.size) throw new Error("Creatomate took longer than 15 minutes");
    return true;
  } catch (err) {
    console.warn(`[${job.recordingId}] Creatomate didn't render this one (${(err as Error).message}) — using ffmpeg`);
    return false;
  }
}

function progress(id: number, p: Record<string, unknown>): void {
  api("POST", `/api/agent/clip-jobs/${id}/progress`, p).catch(() => {});
}

async function handle(job: Job): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `clip-${job.recordingId}-`));
  try {
    console.log(`[${job.recordingId}] ${job.show} — ${Math.round(job.durationSec)}s`);

    // Narrated, because it is the longest silent stretch in the job. Eighty
    // megabytes over a domestic connection is minutes, and a log that says
    // nothing between "here is the job" and "here is the transcript" reads as
    // a hang — which is how three separate runs got killed at exactly the
    // point where they were working correctly.
    const source = path.join(dir, "segment.mp4");
    const res = await fetch(job.downloadUrl);
    if (!res.ok || !res.body) throw new Error(`couldn't download the recording: ${res.status}`);
    const total = Number(res.headers.get("content-length") || 0);
    const started = Date.now();
    let got = 0;
    let shown = 0;
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        got += chunk.length;
        const mb = got / 1048576;
        if (mb - shown >= 10) {
          shown = mb;
          const rate = mb / ((Date.now() - started) / 1000);
          const of = total ? ` of ${(total / 1048576).toFixed(0)}MB` : "";
          console.log(`[${job.recordingId}]   downloaded ${mb.toFixed(0)}MB${of} · ${rate.toFixed(1)}MB/s`);
          if (total) progress(job.recordingId, { stage: "download", pct: (got / total) * 100 });
        }
        cb(null, chunk);
      },
    });
    console.log(`[${job.recordingId}] downloading ${total ? (total / 1048576).toFixed(0) + "MB" : "the recording"}…`);
    progress(job.recordingId, { stage: "download", pct: 0, detail: total ? `${(total / 1048576).toFixed(0)}MB` : "" });
    await pipeline(Readable.fromWeb(res.body as never), meter, createWriteStream(source));
    console.log(`[${job.recordingId}] downloaded in ${Math.round((Date.now() - started) / 1000)}s`);

    let lines = job.transcript;
    const live = transcriptCovers(lines, job.durationSec);
    progress(job.recordingId, { stage: "transcript", pct: live ? 100 : 10, transcriptSource: live ? "live" : "reading it now" });
    if (live) {
      console.log(`[${job.recordingId}] using the live transcript (${lines.length} lines)`);
    } else if (process.env.ELEVENLABS_API_KEY) {
      console.log(`[${job.recordingId}] no live transcript — reading it with Scribe`);
      lines = await transcribeWithScribe(source, dir).catch(async (err) => {
        console.warn(`[${job.recordingId}] Scribe failed: ${err.message} — falling back`);
        if (process.env.DEEPGRAM_API_KEY) return transcribeWithDeepgram(source, dir).catch(() => job.transcript);
        return transcribeLocally(source, dir).catch(() => job.transcript);
      });
    } else if (process.env.DEEPGRAM_API_KEY) {
      console.log(`[${job.recordingId}] no live transcript — reading it with Deepgram`);
      lines = await transcribeWithDeepgram(source, dir).catch(async (err) => {
        console.warn(`[${job.recordingId}] Deepgram failed: ${err.message} — trying whisper`);
        return transcribeLocally(source, dir).catch(() => job.transcript);
      });
    } else {
      console.log(`[${job.recordingId}] no live transcript and no Deepgram key — transcribing here`);
      lines = await transcribeLocally(source, dir).catch((err) => {
        console.warn(`[${job.recordingId}] local transcription failed: ${err.message}`);
        return job.transcript;
      });
    }
    if (lines.length === 0) throw new Error("no transcript, so nothing to choose from");
    console.log(`[${job.recordingId}] ${lines.length} lines of transcript`);
    const words = lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
    progress(job.recordingId, { stage: "moments", pct: 0, words, transcriptSource: live ? "live" : "transcribed after" });

    // The longest remaining silence in the job: one Opus call over the whole
    // transcript. Three separate runs have been killed during a quiet stretch
    // that was the worker working, so every stage that takes real time says so
    // before it starts rather than after it finishes.
    console.log(`[${job.recordingId}] choosing moments…`);
    const moments = await pickMoments(job, lines);
    console.log(`[${job.recordingId}] picked ${moments.length}`);
    progress(job.recordingId, { stage: "render", pct: 0, moments: moments.map((m) => ({ title: m.title, startSec: m.startSec, endSec: m.endSec })), finished: 0 });
    if (moments.length === 0) {
      console.log(`[${job.recordingId}] nothing stood alone — no clips`);
      await api("POST", `/api/agent/clip-jobs/${job.recordingId}/done`, { clips: [] });
      return;
    }

    const out: Record<string, unknown>[] = [];
    for (const [i, m] of moments.entries()) {
      const stem = `${job.recordingId}-${i + 1}`;
      const within = lines.filter((l) => l.endSec > m.startSec && l.startSec < m.endSec);

      const bandFile = path.join(dir, `${stem}-band.png`);
      await fs.writeFile(bandFile, await titleBand(m.title, 1080, 220, job.show.toUpperCase()));

      const wide = path.join(dir, `${stem}-wide.mp4`);
      const vertical = path.join(dir, `${stem}-vertical.mp4`);
      const square = path.join(dir, `${stem}-square.mp4`);
      const subs = path.join(dir, `${stem}.srt`);

      // Written before the renders, not after: they burn it in now, so a
      // sidecar that does not exist yet is three clips with no words on them.
      await fs.writeFile(subs, srt(within, m.startSec));

      // Measured per moment rather than once per file. A layout can change
      // mid-episode — a solo intro becoming a two-shot — and one cropdetect
      // call is cheaper than getting the framing wrong for the rest of it.
      console.log(`[${job.recordingId}] rendering ${i + 1}/${moments.length} — ${m.title}`);
      const geo = await frameGeometry(source, m.startSec);

      // The same words go into all three, drawn per shape because the type is
      // sized against the canvas it lands on.
      const capDir = path.join(dir, stem);
      await fs.mkdir(capDir, { recursive: true });
      const step = (k: number, shape: string) =>
        progress(job.recordingId, { stage: "render", pct: ((i * 4 + k) / (moments.length * 4)) * 100, detail: `Clip ${i + 1} of ${moments.length} · ${shape}` });
      step(0, "all three shapes");
      const viaCreatomate = await renderWithCreatomate(job, m, source, geo, { wide, vertical, square });
      if (!viaCreatomate) {
        step(0, "wide");
        await render(source, wide, m, "wide", undefined, geo, within, capDir);
        step(1, "vertical");
        await render(source, vertical, m, "vertical", { file: bandFile, height: 220 }, geo, within, capDir);
        step(2, "square");
        await render(source, square, m, "square", { file: bandFile, height: 220 }, geo, within, capDir);
      }
      step(3, "uploading");

      out.push({
        title: m.title,
        caption: m.caption,
        reason: m.reason,
        startSec: m.startSec,
        endSec: m.endSec,
        transcript: within.map((l) => l.text).join(" ").slice(0, 8000),
        url: await uploadFile(wide, "video/mp4"),
        verticalUrl: await uploadFile(vertical, "video/mp4"),
        squareUrl: await uploadFile(square, "video/mp4"),
        subtitlesUrl: await uploadFile(subs, "text/plain"),
      });
      console.log(`[${job.recordingId}] ${i + 1}/${moments.length} — ${m.title}`);
      progress(job.recordingId, { stage: "render", pct: ((i + 1) / moments.length) * 100, finished: i + 1, detail: `${i + 1} of ${moments.length} ready` });
    }
    progress(job.recordingId, { stage: "upload", pct: 100 });

    await api("POST", `/api/agent/clip-jobs/${job.recordingId}/done`, { clips: out });
    console.log(`[${job.recordingId}] done — ${out.length} clips`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------

/**
 * The job this process is holding, so a shutdown can hand it back.
 *
 * Without this, Ctrl-C leaves the recording marked running with nobody on it,
 * and the only route back is the stale-claim timeout. Stopping the worker to
 * change something therefore cost ten minutes before it could try again —
 * which it did, three times in one afternoon, each time looking like the
 * queue was broken rather than like the last worker had been killed.
 */
let holding: number | null = null;

async function release(): Promise<void> {
  if (holding === null) return;
  const id = holding;
  holding = null;
  console.log(`\nhanding #${id} back to the queue…`);
  await api("POST", `/api/agent/clip-jobs/${id}/failed`, { requeue: true }).catch((err) =>
    console.error(`could not release #${id}: ${(err as Error).message} — it will be reclaimed in 10 minutes`),
  );
}

// SIGHUP included: closing a terminal window sends that, not SIGINT, and a
// worker killed by a closed window stranded its job exactly as a Ctrl-C used
// to — which is the more likely way to lose one, since nobody thinks of
// closing a window as killing something.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => {
    void release().finally(() => process.exit(0));
  });
}

async function tick(): Promise<boolean> {
  const { job } = await api<{ job: Job | null }>("POST", "/api/agent/clip-jobs/claim");
  if (!job) return false;
  holding = job.recordingId;
  try {
    await handle(job);
    holding = null;
  } catch (err) {
    holding = null;
    const message = (err as Error).message ?? String(err);
    console.error(`[${job.recordingId}] failed: ${message}`);
    await api("POST", `/api/agent/clip-jobs/${job.recordingId}/failed`, { error: message }).catch(() => {});
  }
  return true;
}

async function main(): Promise<void> {
  requireToken();
  console.log(`Clipper watching ${API_BASE}, every ${Math.round(POLL_MS / 1000)}s`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("No ANTHROPIC_API_KEY — falling back to speech density, which picks worse moments.");
  }
  for (;;) {
    try {
      // Keep going while there is a queue; a marathon ends with 48 of these
      // waiting and nobody wants the last one thirty minutes after the rest.
      while (await tick());
    } catch (err) {
      console.error("poll failed:", (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

// Importing this file to test a piece of it must not start the loop.
const invokedDirectly = process.argv[1] && /clipper\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) void main();
