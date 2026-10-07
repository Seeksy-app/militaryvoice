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
import { createWriteStream, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { textPath, fitSize, textWidth } from "../server/textPath.js";
import { cutList, snapToAudio, keepRanges, selectGraph, envelope, type Word } from "./refine.js";
import { captionTrack, type CaptionStyle, type TimedWord } from "./wordCaptions.js";

const API_BASE = (process.env.API_BASE || "http://localhost:3000").replace(/\/+$/, "");
const AGENT_TOKEN = process.env.AGENT_TOKEN || "";
const POLL_MS = Number(process.env.CLIP_POLL_MS || 5_000);
/** Jobs at once: a long episode no longer holds up a one-minute one behind it. */
const LANES = Math.max(1, Number(process.env.CLIP_WORKERS || 2));
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
  /** Only (re)make the clean episode; the clips are already done. */
  cleanOnly?: boolean;
  /** "Edit episode": the source is downloadUrl; cut to trimStart–trimEnd (0 = the end), with an intro and outro. */
  /** A hosted podcast episode: the Library video (downloadUrl) as its MP3. recordingId is the episode's id. */
  episodeAudio?: { episodeId: number; copy?: boolean; mime?: string };
  /** The magazine: one show's segment, cut from the day's recording (downloadUrl) from startSec for durationSec, as an MP3. */
  segmentCut?: { id: number; startSec: number; durationSec: number };
  /** Ask my show: transcribe this episode (downloadUrl) so the AI can answer from it. recordingId is the transcript's id. */
  transcriptJob?: { id: number };
  /** A still from an episode's video, for its picture. */
  episodeStill?: { episodeId: number };
  /** A SmartLink's living photo (downloadUrl) made small enough for phones. */
  livingSqueeze?: { pageId: number; kind?: "living" | "intro" };
  episodeEdit?: { trimStart: number; trimEnd: number; cuts?: [number, number][]; introUrl?: string; outroUrl?: string; introTransition?: "fade" | "black" | "cut"; outroTransition?: "fade" | "black" | "cut"; music?: { url: string; from: number; to: number; level: "under" | "full" }[] };
  /** Bring a recording in from elsewhere (Zoom): fetch downloadUrl with these headers, store it, report. */
  importFrom?: { headers: Record<string, string> };
  /** Clips to make from this episode (Pro: 6). Absent = CLIP_COUNT. */
  clipCount?: number;
  /** What the podcaster picked: which shapes, and the caption style. Absent = all three, animated. */
  options?: { formats: Shape[]; captions: "animated" | "classic"; more?: { count: number; avoid: [number, number][] } };
  /** A track to play under the clips (a signed link to the MP3). */
  music?: { url: string; name: string };
  /** "Add music" to finished clips: mix the track into each clip's files (from before any music). */
  musicMix?: { url: string; name: string; silent: boolean; clips: { id: number; url: string; verticalUrl: string; squareUrl: string }[] };
  /** "Suggest edits": listen to the episode (this version of it) and recommend the trim and any cuts. */
  suggestEdits?: { source: "clean" | "original" };
  /** "Edit text": remake one clip's three shapes with a new title and subtitle. */
  clipEdit?: { clipId: number; title: string; subtitle: string; startSec: number; endSec: number; shapes?: Shape[]; style?: CaptionStyle | null };
}

type Shape = "vertical" | "square" | "wide";

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
  // Streamed from disk (curl -T), never read into memory: three shapes of two
  // clips at once, held whole, ran the 2GB worker out of memory (27 Sep 2026).
  const size = (await fs.stat(file)).size;
  await run("curl", ["-s", "-f", "--retry", "4", "--retry-all-errors", "--retry-delay", "3", "-X", "PUT", "-T", file, signed.uploadUrl, "-H", `content-type: ${contentType}`]);
  console.log(`   uploaded ${name} (${(size / 1048576).toFixed(1)}MB)`);
  return signed.publicUrl;
}

// ---------------------------------------------------------------------------
// ffmpeg
// ---------------------------------------------------------------------------

// At most this many ffmpeg processes at once, whatever the lanes and clips in
// flight: each decodes video and holds hundreds of MB, and eight together
// (two jobs × two clips × frame grabs) ran the 2GB worker out of memory.
// One on the 2GB worker: two caption renders at once (each holds every
// caption image) still ran it out of memory on 27 Sep. So the default follows
// the machine: one per ~2GB of the container's limit, and never more than its
// CPUs, since encoding is CPU-bound (2 CPU / 8GB: two, not four).
const FFMPEG_SLOTS = Math.max(1, Number(process.env.FFMPEG_SLOTS || Math.min(Math.floor(memoryLimit() / 1.9e9), cpuLimit())));

/** The container's CPUs (cgroup quota), not the host's. */
function cpuLimit(): number {
  try {
    const [quota, period] = readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim().split(/\s+/);
    if (quota !== "max" && Number(period) > 0) return Math.max(1, Math.round(Number(quota) / Number(period)));
  } catch { /* cgroup v1 or not Linux */ }
  return os.availableParallelism?.() ?? os.cpus().length;
}

/** The container's memory limit (cgroup), not the host's, which os.totalmem() reports. */
function memoryLimit(): number {
  for (const f of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try {
      const n = Number(readFileSync(f, "utf8").trim());
      if (n > 0 && n < os.totalmem()) return n;
    } catch { /* not this cgroup version */ }
  }
  return os.totalmem();
}
let ffmpegBusy = 0;
const ffmpegWaiting: (() => void)[] = [];
async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (ffmpegBusy >= FFMPEG_SLOTS) await new Promise<void>((r) => ffmpegWaiting.push(r));
  ffmpegBusy++;
  try {
    return await work();
  } finally {
    ffmpegBusy--;
    ffmpegWaiting.shift()?.();
  }
}

function run(bin: string, args: string[]): Promise<string> {
  return bin === "ffmpeg" ? slot(() => runNow(bin, args)) : runNow(bin, args);
}

function runNow(bin: string, args: string[]): Promise<string> {
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
  // Montserrat, placed where Creatomate put it (title centred at 40% of the
  // band, show line at 80%), so a clip made here matches one made there.
  const vmin = width / 100;
  const boxW = width * 0.92;
  let size = fitSize(text, "heavy", Math.round(vmin * 6.2), Math.round(vmin * 3.4), boxW);
  // Too long for one line even small: two lines, as large as fits.
  let rows = [text];
  if (textWidth(text, size, "heavy") > boxW) {
    rows = wrapTitle(text, Math.round(vmin * 4.4), boxW);
    size = Math.min(...rows.map((r) => fitSize(r, "heavy", Math.round(vmin * 4.4), Math.round(vmin * 2.6), boxW)));
  }
  const lead = size * 1.12;
  const titleSvg = rows
    .map((r, i) => textPath(r, { x: width / 2, y: height * 0.4 + size * 0.36 + (i - (rows.length - 1) / 2) * lead, size, weight: "heavy", fill: "#ffffff", anchor: "middle" }))
    .join("");
  // The show line shrinks to fit, then shortens: an episode title ("Devil Dawg
  // Double Dare Ep 5 with Genius Network Founder, Joe Polish") ran off both
  // edges at a fixed size.
  const subText = sub.length > 52 ? `${sub.slice(0, 50).trimEnd()}…` : sub;
  const subSize = fitSize(subText, "strong", Math.round(vmin * 3), Math.round(vmin * 2), boxW / 1.1);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="#000741"/>
    ${titleSvg}
    ${subText ? textPath(subText, { x: width / 2, y: height * 0.8 + subSize * 0.36, size: subSize, weight: "strong", fill: "#F0A71F", anchor: "middle", letterSpacing: subSize * 0.08 }) : ""}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** A title into two lines of about equal width. */
function wrapTitle(text: string, size: number, boxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  let best = [text];
  let bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    const w = Math.max(textWidth(a, size, "heavy"), textWidth(b, size, "heavy"));
    if (w < bestW) { bestW = w; best = [a, b]; }
  }
  return best;
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

// ---------------------------------------------------------------------------
// Speaker focus
// ---------------------------------------------------------------------------
// One camera on a room — a round table, a stage — makes a vertical clip a
// strip of tiny people. Two panels side by side are handled by stacking; this
// is for everything else. The model looks at a frame from the middle of the
// moment with what is being said, and points at the person saying it. The
// vertical and square cuts then frame them instead of the room.

type Box = { w: number; h: number; x: number; y: number };

export async function speakerFocus(source: string, m: Moment, words: string, whole: Box | null, dir: string, atSec?: number): Promise<Box | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !whole) return null;
  try {
    const at = atSec ?? m.startSec + (m.endSec - m.startSec) / 2;
    const frame = path.join(dir, `focus-${Math.round(at * 10)}.jpg`);
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(at), "-i", source, "-frames:v", "1",
      // 768 wide: enough to see who's talking, a third of the image tokens of 1280.
      "-vf", `crop=${even(whole.w)}:${even(whole.h)}:${whole.x}:${whole.y},scale=768:-2`, frame]);
    const img = (await fs.readFile(frame)).toString("base64");
    const client = new Anthropic({ apiKey: key, timeout: 45_000, maxRetries: 1 }) // a stalled look must not hold the job for half an hour;
    // Pointing at who's speaking is a small look, asked ~10 times a clip:
    // Sonnet does it well at a fraction of Opus's price. Opus stays on
    // choosing the moments, which is the product.
    const res = await client.messages.create({
      model: process.env.FOCUS_MODEL || "claude-sonnet-5",
      max_tokens: 1000,
      tools: [{
        name: "speaker_box",
        description: "Where the person speaking in this moment is, as fractions of the image (0 to 1).",
        input_schema: {
          type: "object" as const,
          properties: {
            found: { type: "boolean", description: "False if you can't tell who is speaking or nobody is visible." },
            x: { type: "number", description: "Left edge of a box around the speaker's head and shoulders, 0-1." },
            y: { type: "number", description: "Top edge, 0-1." },
            w: { type: "number", description: "Width, 0-1." },
            h: { type: "number", description: "Height, 0-1." },
          },
          required: ["found"],
        },
      }],
      tool_choice: { type: "tool", name: "speaker_box" },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: img } },
          { type: "text", text: `This frame is from the middle of a clip. What is being said in the clip:\n\n"${words.slice(0, 1500)}"\n\nDraw a box around the head and shoulders of the person most likely speaking — look for an open mouth, who others are facing, a microphone. If it's one person on camera, box them. If you genuinely can't tell, say found: false.` },
        ],
      }],
    });
    const use = res.content.find((c) => c.type === "tool_use");
    const b = use && use.type === "tool_use" ? (use.input as { found?: boolean; x?: number; y?: number; w?: number; h?: number }) : null;
    if (!b?.found || ![b.x, b.y, b.w, b.h].every((v) => typeof v === "number" && v >= 0 && v <= 1) || (b.w ?? 0) < 0.02 || (b.h ?? 0) < 0.02) return null;
    // Back to source pixels.
    return { x: Math.round(whole.x + b.x! * whole.w), y: Math.round(whole.y + b.y! * whole.h), w: Math.round(b.w! * whole.w), h: Math.round(b.h! * whole.h) };
  } catch (err) {
    console.warn(`speaker focus skipped: ${(err as Error).message}`);
    return null;
  }
}

/**
 * The camera cuts inside a moment, as offsets from its start. A produced show
 * switches angles every few seconds, and one crop for the whole moment frames
 * an empty chair the moment the camera moves. Shots under a second and a half
 * fold into the one before — a flash cut isn't worth reframing for.
 */
export async function shotsIn(source: string, m: Moment): Promise<{ from: number; to: number }[]> {
  const len = m.endSec - m.startSec;
  let cuts: number[] = [];
  try {
    const out = await run("ffmpeg", ["-hide_banner", "-ss", String(m.startSec), "-t", String(len), "-i", source, "-vf", "scale=320:-2,select='gt(scene,0.32)',showinfo", "-an", "-f", "null", "-"]);
    cuts = [...out.matchAll(/pts_time:([\d.]+)/g)].map((x) => Number(x[1])).filter((t) => t > 0.5 && t < len - 0.5);
  } catch {
    cuts = [];
  }
  const edges = [0, ...cuts, len];
  const shots: { from: number; to: number }[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const from = edges[i], to = edges[i + 1];
    if (shots.length && to - from < 1.5) shots[shots.length - 1].to = to;
    else shots.push({ from, to });
  }
  // A first shot under 1.5s merges forward instead.
  if (shots.length > 1 && shots[0].to - shots[0].from < 1.5) { shots[1].from = 0; shots.shift(); }
  return shots.slice(0, 12);
}

const focusOf = (g: unknown): Box | null => ((g as { focus?: Box | null } | undefined)?.focus ?? null);
const shotsOf = (g: unknown) => (g as { focusShots?: { from: number; to: number; focus: Box | null }[] | null } | undefined)?.focusShots ?? null;

/** Grow a speaker box to a panel's shape, with room around them, kept inside the picture. */
export function frameAround(focus: Box, within: Box, aspect: number): Box {
  let w = Math.max(focus.w * 1.9, focus.h * 1.9 * aspect);
  let h = w / aspect;
  if (w > within.w) { w = within.w; h = w / aspect; }
  if (h > within.h) { h = within.h; w = h * aspect; }
  const cx = focus.x + focus.w / 2;
  const cy = focus.y + focus.h * 0.62; // head a little above centre
  const x = Math.min(Math.max(within.x, cx - w / 2), within.x + within.w - w);
  const y = Math.min(Math.max(within.y, cy - h / 2), within.y + within.h - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** No speaker found in a shot: the picture's full height, centred (Creatomate's rule). */
function wholeHeight(r: Box, aspect: number): Box {
  const w = Math.min(r.w, r.h * aspect);
  return { x: Math.round(r.x + (r.w - w) / 2), y: r.y, w: Math.round(w), h: r.h };
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
  // Animated captions: word timings from the start of the clip. Drawn here
  // the way Creatomate drew them, with its framing (it follows a camera that
  // cuts, and puts a picture it can't frame whole over a blur of itself).
  words?: TimedWord[],
  // The clip's own caption size and place (Pōstify's editor); none = the usual.
  style?: CaptionStyle | null,
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
  const shotInputs: string[] = [];
  if (shape === "wide") {
    // A wide shot in a wide frame keeps its letterbox — cropping a two-shot to
    // 16:9 is how one of the two people disappears. The blur is of real
    // picture now rather than of the black bar it used to be given.
    chain.push(
      `[0:v]${cut}scale=${W}:${videoH}:force_original_aspect_ratio=increase,crop=${W}:${videoH},scale=${even(W / 8)}:${even(videoH / 8)},boxblur=4:2,scale=${W}:${videoH},setsar=1[bg]`,
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
  } else if (words && shotsOf(geo)?.length && r) {
    // A show that cuts between cameras: reframe on the speaker at every cut.
    // Each shot is its own input (a seek into the same file), cropped and
    // joined end to end. One split of one input would have to hold every
    // frame of the later shots in memory until the earlier ones were done.
    const aspect = W / videoH;
    const shots = shotsOf(geo)!;
    shots.forEach((sh, k) => {
      const f = sh.focus ? frameAround(sh.focus, r, aspect) : wholeHeight(r, aspect);
      shotInputs.push("-ss", String(m.startSec + sh.from), "-t", (sh.to - sh.from).toFixed(3), "-i", source);
      chain.push(`[${k + 1}:v]crop=${even(f.w)}:${even(f.h)}:${f.x}:${f.y},scale=${W}:${videoH},setsar=1,fps=30,format=yuv420p[s${k}]`);
    });
    chain.push(`${shots.map((_, k) => `[s${k}]`).join("")}concat=n=${shots.length}:v=1:a=0[stage]`);
  } else if (words && !focusOf(geo)) {
    // The whole picture over a blurred copy of itself, as Creatomate did it: a
    // room of people keeps all its people.
    chain.push(
      `[0:v]${cut}scale=${W}:${videoH}:force_original_aspect_ratio=increase,crop=${W}:${videoH},scale=${even(W / 8)}:${even(videoH / 8)},boxblur=4:2,scale=${W}:${videoH},setsar=1[bg]`,
      `[0:v]${cut}scale=${W}:${videoH}:force_original_aspect_ratio=decrease,setsar=1[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2[stage]`,
    );
  } else if (focusOf(geo) && r) {
    // One camera on a room: frame the speaker, not the whole table.
    const f = frameAround(focusOf(geo)!, r, W / videoH);
    chain.push(`[0:v]crop=${even(f.w)}:${even(f.h)}:${f.x}:${f.y},scale=${W}:${videoH},setsar=1[stage]`);
  } else {
    // One camera: fill the frame and let the sides go. A single speaker sits
    // in the middle of their own shot, so the edges are wall.
    chain.push(
      `[0:v]${cut}scale=${W}:${videoH}:force_original_aspect_ratio=increase,crop=${W}:${videoH},setsar=1[stage]`,
    );
  }

  const args = ["-ss", String(m.startSec), "-t", dur, "-i", source, ...shotInputs];
  const inputs = () => args.filter((a) => a === "-i").length;
  let last = "[stage]";
  if (band) {
    const idx = inputs();
    args.push("-i", band.file);
    chain.push(`[stage]pad=${W}:${H}:0:${band.height}:color=#000741[padded]`);
    chain.push(`[padded][${idx}:v]overlay=0:0[banded]`);
    last = "[banded]";
  }

  const track = words && dir ? await captionTrack(words, shape, W, H, m.endSec - m.startSec, path.join(dir, `words-${shape}`), style, band?.height ?? 0) : null;
  if (words) {
    if (track) {
      const idx = inputs();
      args.push("-f", "concat", "-safe", "0", "-i", track.list);
      chain.push(`[${idx}:v]format=rgba[words]`, `${last}[words]overlay=0:${track.y}:eof_action=pass:format=auto[v]`);
    } else {
      chain.push(`${last}null[v]`);
    }
  }

  // Burned in, not a sidecar. Most of these are watched with the sound off,
  // and a clip nobody can read is a clip nobody finishes. Sized against a
  // fixed PlayRes so the same style lands identically at 1080x1920 and
  // 1920x1080 instead of being tiny in one of them.
  // Each caption is its own overlay, switched on for the seconds it belongs
  // to. Forty is the cap: a filter graph of a few dozen overlays is nothing,
  // a few hundred is a parser that takes longer than the encode.
  const caps = words ? [] : splitCaptions((captions ?? []).filter((c) => c.text.trim()), W, H).slice(0, 40);
  if (words) {
    // Drawn above.
  } else if (caps.length && dir) {
    let prev = last;
    for (let i = 0; i < caps.length; i++) {
      const c = caps[i];
      const { buf, h: ch } = await captionPng(c.text, W, H);
      const f = path.join(dir, `cap-${shape}-${i}.png`);
      await fs.writeFile(f, buf);
      args.push("-i", f);
      const idx = inputs() - 1;
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
/** Word timings from the last Scribe read of each file. */
const scribeWordsFor = new Map<string, Word[]>();

/**
 * Each word of one moment, timed from the start of the clip, for the animated
 * captions. From the Scribe read of the whole file when the job made one;
 * otherwise Scribe on just this moment's sound (a few seconds, a cent or two);
 * and if that can't be had, the transcript lines' words spread over each
 * line's time by length — close, not exact.
 */
export async function momentWords(source: string, m: Moment, within: Line[], dir: string): Promise<TimedWord[]> {
  const len = m.endSec - m.startSec;
  const inMoment = (ws: Word[], offset: number) =>
    ws.filter((w) => (w.type ?? "word") === "word" && w.end - offset > 0 && w.start - offset < len)
      .map((w) => ({ text: w.text, start: Math.max(0, w.start - offset), end: Math.min(len, w.end - offset) }));
  const whole = scribeWordsFor.get(source);
  if (whole?.length) return inMoment(whole, m.startSec);
  if ((process.env.ELEVENLABS_API_KEY || "").trim()) {
    try {
      const sub = path.join(dir, `words-${Math.round(m.startSec)}`);
      await fs.mkdir(sub, { recursive: true });
      const audio = path.join(sub, "moment.m4a");
      await run("ffmpeg", ["-y", "-v", "error", "-ss", String(m.startSec), "-t", len.toFixed(2), "-i", source, "-vn", "-c:a", "aac", "-b:a", "96k", audio]);
      await transcribeWithScribe(audio, sub);
      const got = inMoment(scribeWordsFor.get(audio) ?? [], 0);
      scribeWordsFor.delete(audio);
      if (got.length) return got;
    } catch (err) {
      console.warn(`   word timings from Scribe failed (${(err as Error).message}); spreading the transcript instead`);
    }
  }
  return within.flatMap((l) => {
    const ws = l.text.split(/\s+/).filter(Boolean);
    const total = ws.reduce((n, w) => n + w.length + 1, 0) || 1;
    let at = l.startSec - m.startSec;
    const span = Math.max(0.1, l.endSec - l.startSec);
    return ws.map((w) => {
      const d = span * ((w.length + 1) / total);
      const out = { text: w, start: at, end: at + d };
      at += d;
      return out;
    });
  }).filter((w) => w.end > 0 && w.start < len).map((w) => ({ ...w, start: Math.max(0, w.start), end: Math.min(len, w.end) }));
}

/** Word timings for a file: from the Scribe read the job already made, or a fresh one. */
export async function wordsFor(file: string, dir: string): Promise<Word[]> {
  if (!scribeWordsFor.has(file)) await transcribeWithScribe(file, dir);
  return scribeWordsFor.get(file) ?? [];
}

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
  // Kept per word for cleaning the episode, which cuts inside lines.
  scribeWordsFor.set(file, (body.words ?? []).map((w) => ({ text: w.text, start: w.start, end: w.end, type: w.type })));

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
  // How many: the plan's (Pro makes 6), else CLIP_COUNT.
  const more = job.options?.more;
  const n = more ? Math.min(8, more.count) : job.clipCount && job.clipCount > 0 ? Math.min(12, job.clipCount) : WANTED;
  const avoid = more?.avoid ?? [];
  const clear = (m: Moment) => !avoid.some(([a, b]) => m.startSec < b && m.endSec > a);
  if (!key) {
    console.warn("   ANTHROPIC_API_KEY isn't set on this worker: rough cuts by speech density, with first-words titles");
    return densestStretches(lines, n, "no-key");
  }

  const client = new Anthropic({ apiKey: key, timeout: 5 * 60_000, maxRetries: 1 });
  const prompt = `You are cutting clips from one segment of a 24-hour podcastathon for the military and veteran community.

Show: ${job.show}${job.host ? `\nHost: ${job.host}` : ""}
Segment length: ${Math.round(job.durationSec)} seconds.

Below is the transcript, each line prefixed with its offset in seconds from the start of the recording.

Pick the ${n} strongest moments to post on their own. What makes a moment strong here:

- It is a story, a turn, or a claim someone would repeat — not an introduction, not a sign-off, not housekeeping.
- It stands up with no setup. Someone who has never heard of this show understands it cold.
- It starts on the first word of the thought and ends on the last. Do not start mid-sentence.
- Between ${MIN_SEC} and ${MAX_SEC} seconds.
- Moments do not overlap.

This community's stories carry real weight. Do not pick a moment because it sounds dramatic out of context, and do not write a caption that makes someone's service or loss into bait. Write the caption the way the host would say it.

If the segment genuinely has fewer than ${n} moments that stand alone, return fewer. Returning two good ones is better than four with filler.${avoid.length ? `

These moments already have clips. Pick different ones that do not overlap them:
${avoid.map(([a, b]) => `- ${Math.round(a)}s to ${Math.round(b)}s`).join("\n")}` : ""}

Transcript:
${transcriptText(lines)}`;

  // Room to think over a long transcript. At 4,000 the thinking on a
  // half-hour episode used the budget up and the list came back cut off —
  // empty — so a whole episode got no clips. Twice before giving up.
  // A third try without thinking: when the thinking has used the budget twice, a
  // plain answer beats falling back to rough cuts with first-words titles.
  let raw: unknown = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const plain = attempt === 3;
    const res = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: plain ? 8000 : 16000,
      ...(plain ? {} : { thinking: { type: "adaptive" as const } }),
      tools: [PICK_TOOL],
      tool_choice: plain ? { type: "tool", name: "pick_moments" } : { type: "auto" },
      messages: [{ role: "user", content: plain ? prompt : `${prompt}

Answer with the pick_moments tool.` }],
    }).catch((err: Error) => { console.warn(`   the pick failed (${err.message})${attempt < 3 ? " — asking again" : ""}`); return null; });
    if (!res) continue;
    const use = res.content.find((c) => c.type === "tool_use");
    if (!use || use.type !== "tool_use") {
      console.warn(`   no pick came back (stop: ${res.stop_reason})${attempt < 3 ? " — asking again" : ""}`);
      continue;
    }
    // The list sometimes comes back as a JSON string rather than an array.
    raw = (use.input as { moments?: unknown }).moments ?? [];
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch { raw = []; }
    }
    if (!Array.isArray(raw)) raw = [];
    if ((raw as unknown[]).length) break;
    console.warn(`   the pick came back empty (stop: ${res.stop_reason})${attempt < 3 ? " — asking again" : ""}`);
  }
  if (!(raw as unknown[]).length) return more ? [] : await titled(client, job, lines, densestStretches(lines, n, "no-answer"));
  const moments = (raw as Moment[]).map((m) => ({
    title: String(m.title ?? "").slice(0, 120),
    caption: String(m.caption ?? "").slice(0, 400),
    reason: String(m.reason ?? "").slice(0, 400),
    startSec: Math.max(0, Math.floor(Number(m.startSec))),
    endSec: Math.ceil(Number(m.endSec)),
  }));
  return sane(moments.filter(clear), job.durationSec, n);
}

/**
 * Without a model: the stretches where the most is being said.
 *
 * Word density is a poor proxy for "worth watching" and this is not pretending
 * otherwise — it exists so a missing API key degrades the clips rather than
 * dropping the whole job on the floor.
 */
/**
 * Real headlines for rough cuts. When the picker never answered, the stretches are chosen by
 * speech density, and their first words make a poor title ("A Chevelle? An Evella. Or Impala. It")
 * that ends up burned into the video. One quick call titles them all from what's said in each;
 * if that fails too, the first-words title stays.
 */
async function titled(client: Anthropic, job: Job, lines: Line[], moments: Moment[]): Promise<Moment[]> {
  if (!moments.length) return moments;
  const said = moments.map((m, i) => `Clip ${i + 1}:\n${lines.filter((l) => l.startSec >= m.startSec && l.endSec <= m.endSec).map((l) => l.text).join(" ").slice(0, 2500)}`).join("\n\n");
  try {
    const res = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 800,
      system: "You title short video clips from military and veteran podcasts. Each title is 4 to 7 words, says what happens or the claim made, reads cleanly on a phone, and would make someone stop scrolling without being bait. Never turn someone's service, injury or loss into a hook. No quotation marks, no emoji, no hashtags, no trailing punctuation. Use only what is said.",
      tools: [{ name: "titles", description: "One title per clip, in order.", input_schema: { type: "object" as const, properties: { titles: { type: "array", items: { type: "string" } } }, required: ["titles"] } }],
      tool_choice: { type: "tool", name: "titles" },
      messages: [{ role: "user", content: `${job.show ? `Show: ${job.show}\n` : ""}${said}\n\nTitle each clip.` }],
    });
    const use = res.content.find((c) => c.type === "tool_use");
    const titles = use && use.type === "tool_use" ? ((use.input as { titles?: unknown }).titles as unknown[] | undefined) ?? [] : [];
    const out = moments.map((m, i) => {
      const t = String(titles[i] ?? "").replace(/^["'“]|["'”]$/g, "").replace(/[.!?,;:]+$/, "").trim();
      return t && t.split(/\s+/).length <= 10 ? { ...m, title: t.slice(0, 90) } : m;
    });
    console.log(`   titled ${out.filter((m, i) => m.title !== moments[i].title).length} of ${moments.length} rough cuts`);
    return out;
  } catch (err) {
    console.warn(`   couldn't title the rough cuts (${(err as Error).message}); keeping their first words`);
    return moments;
  }
}

/** A title from what was said: seven words, no fillers or false starts, a capital, no trailing comma. */
export function roughTitle(text: string): string {
  const words = text.split(/\s+/).filter((w) => w && !/-$/.test(w) && !/^(um+|uh+|erm*|ah+|hmm+|mm+|so|and|but|like)[,.!?]*$/i.test(w)).slice(0, 7);
  const t = words.join(" ").replace(/[,;:]+$/, "");
  return t ? t[0].toUpperCase() + t.slice(1) : "Clip";
}

export function densestStretches(lines: Line[], n = WANTED, why: "no-key" | "no-answer" = "no-key"): Moment[] {
  if (lines.length === 0) return [];
  const WINDOW = 45;
  const end = Math.max(...lines.map((l) => l.endSec));
  const scored: Moment[] = [];
  for (let t = 0; t + WINDOW <= end; t += 15) {
    const inWindow = lines.filter((l) => l.startSec >= t && l.endSec <= t + WINDOW);
    const words = inWindow.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
    if (words < 40) continue;
    scored.push({
      // The first words said, without the ums and false starts ("Uh, there's…").
      title: roughTitle(inWindow.map((l) => l.text).join(" ")),
      caption: "",
      reason: why === "no-key" ? "Picked by speech density: this worker has no AI key, so this is a rough cut." : "Picked by speech density: the AI didn't answer, so this is a rough cut.",
      startSec: Math.floor(t),
      endSec: Math.ceil(t + WINDOW),
    });
    // @ts-expect-error carried only for the sort below
    scored[scored.length - 1]._words = words;
  }
  return scored
    .sort((a, b) => ((b as never as { _words: number })._words ?? 0) - ((a as never as { _words: number })._words ?? 0))
    .filter((m, i, all) => all.slice(0, i).every((o) => m.startSec >= o.endSec || m.endSec <= o.startSec))
    .slice(0, n)
    .sort((a, b) => a.startSec - b.startSec);
}

/** Refuse anything that would cut badly, rather than rendering it and finding out. */
export function sane(moments: Moment[], durationSec: number, n = WANTED): Moment[] {
  const kept: Moment[] = [];
  for (const m of moments.sort((a, b) => a.startSec - b.startSec)) {
    const start = Math.max(0, m.startSec);
    const end = Math.min(durationSec || m.endSec, m.endSec);
    let len = end - start;
    let stop = end;
    // Too long is trimmed, not thrown away: a good moment that runs over is
    // still a better clip than none, and asked for one the model tends long.
    if (Number.isFinite(len) && len > MAX_SEC + 15) {
      console.warn(`   "${m.title}" ran ${Math.round(len)}s — trimmed to ${MAX_SEC}s`);
      stop = start + MAX_SEC;
      len = MAX_SEC;
    }
    if (!Number.isFinite(len) || len < MIN_SEC) { console.warn(`   dropped "${m.title}": ${Math.round(len)}s`); continue; }
    if (kept.some((k) => start < k.endSec && stop > k.startSec)) { console.warn(`   dropped "${m.title}": overlaps`); continue; }
    if (!m.title.trim()) continue;
    kept.push({ ...m, startSec: start, endSec: stop });
  }
  return kept.slice(0, n);
}

// ---------------------------------------------------------------------------
// One job
// ---------------------------------------------------------------------------

/** PUT a big file with curl (streams from disk; Node would hold it all in memory). */
async function uploadBig(file: string, contentType: string): Promise<string> {
  const signed = await api<{ uploadUrl: string; storageKey: string }>("POST", "/api/agent/clean-files/upload-url", { name: path.basename(file) });
  // -T streams the file; --data-binary @file read the whole episode into memory first.
  await run("curl", ["-s", "-f", "--retry", "5", "--retry-all-errors", "--retry-delay", "3", "-X", "PUT", "-T", file, signed.uploadUrl, "-H", `content-type: ${contentType}`]);
  return signed.storageKey;
}

/**
 * The whole episode with the ums, false starts and dead air taken out — the
 * podcast (MP3) and the video (720p MP4). Cuts come from the word timings and
 * are placed on the audio itself (see agent/refine.ts: the timings alone run
 * late). Runs after the clips and never fails the job: a podcaster who gets
 * their clips and no clean episode has lost nothing they had.
 */
async function cleanEpisode(job: Job, source: string, dir: string, keepVideo?: string): Promise<{ start: number; end: number }[] | null> {
  if ((process.env.CLEAN_EPISODE ?? "1") === "0") return null;
  const report = (b: Record<string, unknown>) => api("POST", `/api/agent/clip-jobs/${job.recordingId}/clean`, b).catch(() => {});
  try {
    await report({ status: "running" });
    console.log(`[${job.recordingId}] cleaning the episode…`);
    const words = await wordsFor(source, dir);
    if (!words.length) throw new Error("no word timings to clean with");
    const pcmFile = path.join(dir, "clean.pcm");
    await ffmpeg(["-i", source, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", pcmFile]);
    const env = envelope(await fs.readFile(pcmFile));
    await fs.rm(pcmFile, { force: true });
    const duration = env.length * 0.01;
    const cuts = snapToAudio(cutList(words), env);
    const keeps = keepRanges(cuts, duration);
    const removed = cuts.reduce((t, c) => t + (c.end - c.start), 0);
    const count = (why: string) => cuts.filter((c) => c.why === why).length;
    console.log(`[${job.recordingId}]   ${count("filler")} fillers, ${count("false-start")} false starts, ${count("silence")} pauses — ${Math.round(removed)}s off`);
    if (keeps.length < 2) {
      await report({ status: "done", fillers: 0, falseStarts: 0, pauses: 0, removedSec: 0, durationSec: duration });
      return null;
    }

    // Audio: one pass, only the sound.
    const audioGraph = path.join(dir, "clean-audio.txt");
    await fs.writeFile(audioGraph, keeps.map((k, i) => `[0:a]atrim=start=${k.start.toFixed(3)}:end=${k.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`).join(";") + ";" + keeps.map((_, i) => `[a${i}]`).join("") + `concat=n=${keeps.length}:v=0:a=1[a]`);
    const mp3 = path.join(dir, `${job.recordingId}-clean.mp3`);
    await ffmpeg(["-i", source, "-filter_complex_script", audioGraph, "-map", "[a]", "-c:a", "libmp3lame", "-b:a", "192k", mp3]);
    const audioKey = await uploadBig(mp3, "audio/mpeg");
    await fs.rm(mp3, { force: true });
    console.log(`[${job.recordingId}]   clean audio uploaded`);
    await report({ status: "running", audioKey, fillers: count("filler"), falseStarts: count("false-start"), pauses: count("silence"), removedSec: Math.round(removed), durationSec: Math.round(duration) });

    // Video, 720p — the heavy part, and optional.
    let videoKey: string | undefined;
    const hasVideo = /Video:/.test(await run("ffprobe", ["-hide_banner", "-i", source]).catch((e: Error) => e.message));
    if ((process.env.CLEAN_VIDEO ?? "1") !== "0" && hasVideo && duration <= 2 * 3600) {
      const graph = path.join(dir, "clean-video.txt");
      // One pass over the episode (selectGraph), not a branch per cut: the
      // trim-per-cut graph ran a 61-minute episode at 100% CPU for over an hour.
      await fs.writeFile(graph, selectGraph(keeps));
      const mp4 = path.join(dir, `${job.recordingId}-clean.mp4`);
      await ffmpeg(["-i", source, "-filter_complex_script", graph, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", process.env.CLEAN_PRESET || "superfast", "-crf", "23", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", mp4]);
      videoKey = await uploadBig(mp4, "video/mp4");
      if (keepVideo) await fs.copyFile(mp4, keepVideo);
      await fs.rm(mp4, { force: true });
      console.log(`[${job.recordingId}]   clean video uploaded`);
    }
    // The kept stretches, so times in the original (chapters, clips) can be
    // placed exactly in the clean one.
    const kept = keeps.map((k) => [Math.round(k.start * 100) / 100, Math.round(k.end * 100) / 100]);
    await report({ status: "done", audioKey, videoKey, fillers: count("filler"), falseStarts: count("false-start"), pauses: count("silence"), removedSec: Math.round(removed), durationSec: Math.round(duration), keeps: kept });
    console.log(`[${job.recordingId}] clean episode done`);
    return keeps;
  } catch (err) {
    console.warn(`[${job.recordingId}] clean episode failed: ${(err as Error).message}`);
    await report({ status: "failed", error: (err as Error).message });
    return null;
  }
}

/** Times in the original, placed in the cleaned video (a time inside a cut lands where the cut closed). */
function intoClean(t: number, keeps: { start: number; end: number }[]): number {
  let before = 0;
  for (const k of keeps) {
    if (t < k.start) return before;
    if (t <= k.end) return before + (t - k.start);
    before += k.end - k.start;
  }
  return before;
}

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
  shapes: Shape[] = ["vertical", "square", "wide"],
): Promise<Set<Shape>> {
  // The shapes Creatomate made. Whatever it didn't, the caller makes with ffmpeg:
  // a slow wide mustn't throw away a vertical and a square that are already done.
  const made = new Set<Shape>();
  if ((process.env.CLIP_RENDERER || "").toLowerCase() === "ffmpeg") return made;
  try {
    const probe = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", source]);
    const [srcW, srcH] = probe.trim().split(",").map(Number);
    // Hand Creatomate just this moment, not the episode. Given the whole file
    // (611MB for an hour) it fetched all of it for each of the three shapes,
    // and one clip took seven minutes. Cut here (a few seconds), upload
    // ~20MB, and the moment starts at 0 in it; shot times are already
    // relative to the moment.
    const cut = path.join(path.dirname(files.wide), `source-${Math.round(m.startSec)}.mp4`);
    await run("ffmpeg", ["-y", "-v", "error", "-ss", String(m.startSec), "-i", source, "-t", String(m.endSec - m.startSec), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", cut]);
    const signed = await api<{ uploadUrl: string; readUrl: string }>("POST", "/api/agent/clean-files/upload-url", { name: `clip-source-${job.recordingId}-${Math.round(m.startSec)}.mp4` });
    await run("curl", ["-s", "-f", "--retry", "5", "--retry-all-errors", "--retry-delay", "3", "-X", "PUT", "-T", cut, signed.uploadUrl, "-H", "content-type: video/mp4"]);
    const { renders } = await api<{ renders: { shape: "wide" | "vertical" | "square"; id: string }[] }>("POST", "/api/agent/clip-renders", {
      videoUrl: signed.readUrl || job.downloadUrl,
      start: signed.readUrl ? 0 : m.startSec,
      length: m.endSec - m.startSec,
      shapes,
      title: m.title,
      show: job.show,
      geo: { srcW, srcH, ...geo },
    });
    const pending = new Map(renders.map((r) => [r.id, r.shape]));
    const sent = Date.now();
    const deadline = sent + 15 * 60_000;
    // Once one shape is back, the others get three more minutes: a straggler
    // (it's been the wide) is quicker to make here than to wait out.
    let firstBack = 0;
    while (pending.size && Date.now() < deadline && !(firstBack && Date.now() - firstBack > 3 * 60_000)) {
      await new Promise((z) => setTimeout(z, 5000));
      for (const [id, shape] of Array.from(pending)) {
        const s = await api<{ status: string; url: string; error: string }>("GET", `/api/agent/clip-renders/${id}`);
        if (s.status === "failed") {
          console.warn(`[${job.recordingId}] Creatomate ${shape} failed (${s.error || "no reason"}) — making it here`);
          pending.delete(id);
          continue;
        }
        if (s.status === "succeeded" && s.url) {
          const got = await fetch(s.url);
          if (!got.ok || !got.body) throw new Error(`couldn't fetch the ${shape} render: ${got.status}`);
          // Straight to disk, not through memory.
          await pipeline(Readable.fromWeb(got.body as never), createWriteStream(files[shape]));
          pending.delete(id);
          made.add(shape);
          firstBack ||= Date.now();
          console.log(`[${job.recordingId}] Creatomate ${shape} back in ${Math.round((Date.now() - sent) / 1000)}s`);
        }
      }
    }
    if (pending.size) console.warn(`[${job.recordingId}] Creatomate still on ${Array.from(pending.values()).join(", ")} — making ${pending.size === 1 ? "it" : "them"} here`);
    return made;
  } catch (err) {
    console.warn(`[${job.recordingId}] Creatomate didn't render this one (${(err as Error).message}) — using ffmpeg`);
    return made;
  }
}

/** When each held job last reported progress, for the watchdog in tick(). */
const lastProgress = new Map<number, number>();

function progress(id: number, p: Record<string, unknown>): void {
  lastProgress.set(id, Date.now());
  api("POST", `/api/agent/clip-jobs/${id}/progress`, p).catch(() => {});
}

/**
 * A job that has said nothing for this long is frozen, not slow: on 5 Oct both
 * lanes sat at "clip 2 of 4" for forty minutes while the heartbeat kept them
 * looking alive, and the queue behind them never moved. Whole episodes finish
 * in under ten minutes.
 */
const STALL_MS = 25 * 60_000;

/** A clean-episode-only job: fetch the recording and make the clean episode. */
async function handleClean(job: Job): Promise<void> {
  // The clips are done: a shutdown or a failure here must never requeue or
  // fail them. The clean episode reports its own outcome.
  holding.delete(job.recordingId);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `clean-${job.recordingId}-`));
  try {
    console.log(`[${job.recordingId}] clean episode only — ${job.show}`);
    const source = path.join(dir, "segment.mp4");
    const res = await fetch(job.downloadUrl);
    if (!res.ok || !res.body) throw new Error(`couldn't download the recording: ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(source));
    await cleanEpisode(job, source, dir);
  } catch (err) {
    console.warn(`[${job.recordingId}] clean episode failed: ${(err as Error).message}`);
    await api("POST", `/api/agent/clip-jobs/${job.recordingId}/clean`, { status: "failed", error: (err as Error).message }).catch(() => {});
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Where to point the camera in each shape. Measured per moment rather than
 * once per file: a layout can change mid-episode — a solo intro becoming a
 * two-shot — and one cropdetect call is cheaper than getting it wrong.
 */
/**
 * How closely to follow the speaker. "shots": per camera cut and every ~8s
 * (Creatomate can reframe mid-clip). "one": a single look from the middle
 * (our own renderer frames one speaker). "none": only a wide shape was asked
 * for, which shows the whole picture — no looks at all.
 */
type FocusMode = "shots" | "one" | "none";

async function framingFor(job: Job, source: string, m: Moment, within: Line[], dir: string, mode: FocusMode = "shots") {
  const measured = await frameGeometry(source, m.startSec);
  let focus: Box | null = null;
  let focusShots: { from: number; to: number; focus: Box | null }[] | null = null;
  if (mode === "one" && !measured.stack && process.env.ANTHROPIC_API_KEY) {
    focus = await speakerFocus(source, m, within.map((l) => l.text).join(" "), measured.whole, dir);
    return { ...measured, focus, focusShots };
  }
  if (mode === "shots" && !measured.stack && process.env.ANTHROPIC_API_KEY) {
    // One camera, or a produced show cutting between cameras: find who's
    // speaking in each shot.
    // Cuts, and inside a long shot a look every eight seconds — a camera
    // that zooms or pans moves the speaker without any cut to find.
    const shots = (await shotsIn(source, m)).flatMap((sh) => {
      const n = Math.max(1, Math.round((sh.to - sh.from) / 8));
      const step = (sh.to - sh.from) / n;
      return Array.from({ length: n }, (_, i) => ({ from: sh.from + i * step, to: i === n - 1 ? sh.to : sh.from + (i + 1) * step }));
    }).slice(0, 12);
    const said = (from: number, to: number) =>
      within.filter((l) => l.endSec > m.startSec + from && l.startSec < m.startSec + to).map((l) => l.text).join(" ") || within.map((l) => l.text).join(" ");
    // Asked together, four at a time, not one after another: a dozen looks in series was minutes a clip.
    focusShots = new Array(shots.length);
    let nextShot = 0;
    await Promise.all(Array.from({ length: Math.min(4, shots.length) }, async () => {
      for (let k = nextShot++; k < shots.length; k = nextShot++) {
        const sh = shots[k];
        focusShots![k] = { ...sh, focus: await speakerFocus(source, m, said(sh.from, sh.to), measured.whole, dir, m.startSec + (sh.from + sh.to) / 2) };
      }
    }));
    // Neighbours that frame the same person in the same place are one
    // shot: no reframe where nothing moved.
    const same = (a: Box | null, b: Box | null) =>
      !!a && !!b && Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) < measured.whole!.w * 0.08 && Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) < measured.whole!.h * 0.1 && Math.abs(a.w - b.w) < a.w * 0.35;
    focusShots = focusShots.reduce<typeof focusShots>((acc, sh) => {
      const last = acc[acc.length - 1];
      if (last && same(last.focus, sh.focus)) last.to = sh.to;
      else acc.push({ ...sh });
      return acc;
    }, []);
    if (focusShots.length === 1) { focus = focusShots[0].focus; focusShots = null; }
    console.log(`[${job.recordingId}]   speaker focus: ${shots.length} shot(s), ${[focus, ...(focusShots ?? []).map((x) => x.focus)].filter(Boolean).length} framed`);
  }
  // ffmpeg frames a single speaker; only Creatomate follows a camera that cuts.
  return { ...measured, focus, focusShots };
}

/**
 * "Edit text": the same moment, the same framing, a new title and subtitle.
 * Only the moment is fetched (ffmpeg reads just that range of the file), and
 * it goes through Creatomate only — if that fails the clip stays as it was
 * rather than coming back plainer. Never throws: a failed edit must not
 * touch the recording's own status.
 */
/**
 * Who draws animated captions. Our own renderer since 27 Sep 2026: the same
 * look as Creatomate, in about a minute a clip rather than eight (and a wide
 * that Creatomate often never returned). CLIP_RENDERER=creatomate goes back.
 */
function usesCreatomate(): boolean {
  return (process.env.CLIP_RENDERER || "local").toLowerCase() === "creatomate";
}

async function handleEdit(job: Job): Promise<void> {
  const e = job.clipEdit!;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `edit-${e.clipId}-`));
  const tag = `[clip ${e.clipId}]`;
  try {
    console.log(`${tag} new text — "${e.title}" / "${e.subtitle}"`);
    const len = e.endSec - e.startSec;
    const cut = path.join(dir, "moment.mp4");
    await run("ffmpeg", ["-y", "-v", "error", "-ss", String(e.startSec), "-i", job.downloadUrl, "-t", String(len), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", cut]);
    const m: Moment = { title: e.title, caption: "", reason: "", startSec: 0, endSec: len };
    const shapes: Shape[] = e.shapes?.length ? e.shapes : ["vertical", "square", "wide"];
    const tall = shapes.includes("vertical") || shapes.includes("square");
    const geo = await framingFor(job, cut, m, [], dir, tall ? "shots" : "none");
    const files = { wide: path.join(dir, "wide.mp4"), vertical: path.join(dir, "vertical.mp4"), square: path.join(dir, "square.mp4") };
    // A caption size or place of its own is drawn here (Creatomate's layout is fixed).
    if (usesCreatomate() && !e.style) {
      if ((await renderWithCreatomate({ ...job, show: e.subtitle }, m, cut, geo, files, shapes)).size < shapes.length) throw new Error("Creatomate couldn't make it just now");
    } else {
      const band = path.join(dir, "band.png");
      await fs.writeFile(band, await titleBand(e.title, 1080, 220, e.subtitle.toUpperCase()));
      const words = await momentWords(cut, m, [], dir);
      await Promise.all(shapes.map((x) => render(cut, files[x], m, x, x === "wide" ? undefined : { file: band, height: 220 }, geo, [], path.join(dir, "caps"), words, e.style)));
    }
    await api("POST", `/api/agent/clip-edits/${e.clipId}/done`, {
      url: shapes.includes("wide") ? await uploadFile(files.wide, "video/mp4") : "",
      verticalUrl: shapes.includes("vertical") ? await uploadFile(files.vertical, "video/mp4") : "",
      squareUrl: shapes.includes("square") ? await uploadFile(files.square, "video/mp4") : "",
    });
    console.log(`${tag} updated`);
  } catch (err) {
    console.warn(`${tag} edit failed: ${(err as Error).message}`);
    await api("POST", `/api/agent/clip-edits/${e.clipId}/failed`, { error: (err as Error).message }).catch(() => {});
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * "Edit episode": intro + the episode (trimmed) + outro, one 720p file, filed
 * in the Library as a new recording. Each part is scaled into 1280×720 (never
 * cropped), set to 30fps and stereo 48k so they join cleanly; a part with no
 * sound gets silence of its own length. Never throws.
 */
const SUGGEST_TOOL = {
  name: "suggest_edits",
  description: "Recommend how to edit this episode: where the show really starts and ends, and any sections to cut from the middle.",
  input_schema: {
    type: "object" as const,
    properties: {
      start: { type: ["number", "null"], description: "Seconds: where the show really begins (after tech checks, countdowns, \"are we recording?\"). null if it already starts cleanly." },
      startReason: { type: "string" },
      end: { type: ["number", "null"], description: "Seconds: where the show really ends (after the sign-off, before goodbyes off-mic and fumbling to stop the recording). null if it already ends cleanly." },
      endReason: { type: "string" },
      cuts: {
        type: "array",
        description: "Sections to remove from the middle, in order. Only real problems. Empty if there are none.",
        items: {
          type: "object",
          properties: {
            from: { type: "number", description: "Seconds, on the first word to cut." },
            to: { type: "number", description: "Seconds, just before the first word to keep." },
            reason: { type: "string", description: "One short sentence, the way an editor would say it to the host." },
          },
          required: ["from", "to", "reason"],
        },
      },
    },
    required: ["start", "end", "cuts"],
  },
};

/**
 * "Suggest edits": transcribe this version of the episode, then have Claude
 * read it like an editor would. The host decides; nothing is cut here.
 */
async function handleSuggest(job: Job): Promise<void> {
  const tag = `[${job.recordingId}] suggest`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `suggest-${job.recordingId}-`));
  try {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("The AI isn't set up on the worker.");
    // A transcript kept from the first run covers the original: no download, no transcribing.
    let lines = job.transcript ?? [];
    let dur = job.durationSec;
    if (!transcriptCovers(lines, job.durationSec)) {
      const file = path.join(dir, "episode.mp4");
      const res = await fetch(job.downloadUrl);
      if (!res.ok || !res.body) throw new Error(`Couldn't fetch the episode (${res.status}).`);
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
      lines = await transcribeWithScribe(file, dir).catch(async (err) => {
        console.warn(`${tag}: Scribe failed: ${err.message} — falling back`);
        if (process.env.DEEPGRAM_API_KEY) return transcribeWithDeepgram(file, dir);
        return transcribeLocally(file, dir);
      });
      dur = Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).catch(() => "0")).trim()) || job.durationSec;
    } else {
      console.log(`${tag}: using the kept transcript (${lines.length} lines)`);
    }
    if (!lines.length) {
      await api("POST", `/api/agent/suggest-edits/${job.recordingId}/done`, { items: [] });
      return;
    }
    const client = new Anthropic({ apiKey: key, timeout: 5 * 60_000, maxRetries: 1 });
    const prompt = `You are the editor for a military and veteran podcast${job.show ? `, "${job.show}"` : ""}${job.host ? `, hosted by ${job.host}` : ""}. The host has asked what should come out of this episode before it's published.

Length: ${Math.round(dur)} seconds. Below is the transcript, each line prefixed with its offset in seconds.

Recommend:
- start: where the show really begins. Cut the tech check, the countdown, "can you hear me", "are we live", small talk before the welcome. If it opens cleanly, null.
- end: where the show really ends: just after the last sign-off line. Cut goodbyes after that, "stop the recording", fumbling. If it ends cleanly, null.
- cuts: sections from the middle that a careful editor would remove: a restart or retake ("let me say that again"), a tech problem (frozen audio, "you cut out"), a phone or a dog interrupting, off-the-record talk someone asked to leave out, housekeeping between host and guest. Not ums or short pauses: those are already handled. Not anything that is simply slow or off-topic but still a real part of the conversation: the host's voice and their guest's stories stay.

Be conservative: every cut must be something the host would thank you for. Put cut edges on word boundaries: from = the start of the first word to remove, to = the start of the first word to keep. Fewer, certain suggestions beat many doubtful ones. None at all is a fine answer.

Transcript:
${transcriptText(lines)}`;
    const out = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      tools: [SUGGEST_TOOL],
      tool_choice: { type: "tool", name: "suggest_edits" },
      messages: [{ role: "user", content: prompt }],
    });
    const use = out.content.find((c) => c.type === "tool_use");
    const r = (use && use.type === "tool_use" ? use.input : {}) as { start?: number | null; startReason?: string; end?: number | null; endReason?: string; cuts?: unknown };
    let cuts = r.cuts as { from: number; to: number; reason: string }[] | string | undefined;
    if (typeof cuts === "string") { try { cuts = JSON.parse(cuts); } catch { cuts = []; } }
    const items: { kind: "start" | "end" | "cut"; from: number; to: number; reason: string }[] = [];
    if (typeof r.start === "number" && r.start > 0.5 && r.start < dur / 2) items.push({ kind: "start", from: 0, to: r.start, reason: r.startReason || "Before the show begins." });
    if (typeof r.end === "number" && r.end > dur / 2 && dur - r.end > 0.5) items.push({ kind: "end", from: r.end, to: dur, reason: r.endReason || "After the show ends." });
    for (const c of Array.isArray(cuts) ? cuts : []) {
      const from = Number(c.from), to = Number(c.to);
      if (Number.isFinite(from) && Number.isFinite(to) && to - from >= 0.5 && from >= 0 && to <= dur) items.push({ kind: "cut", from, to, reason: String(c.reason ?? "") });
    }
    console.log(`${tag}: ${items.length} suggestion${items.length === 1 ? "" : "s"}`);
    await api("POST", `/api/agent/suggest-edits/${job.recordingId}/done`, { items });
  } catch (err) {
    console.warn(`${tag} failed: ${(err as Error).message}`);
    await api("POST", `/api/agent/suggest-edits/${job.recordingId}/failed`, { error: (err as Error).message }).catch(() => {});
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function handleEpisodeEdit(job: Job): Promise<void> {
  const e = job.episodeEdit!;
  const tag = `[${job.recordingId}] edit`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `epedit-${job.recordingId}-`));
  try {
    console.log(`${tag}: trim ${e.trimStart}–${e.trimEnd || "end"}${e.introUrl ? `, intro (${e.introTransition ?? "fade"})` : ""}${e.outroUrl ? `, outro (${e.outroTransition ?? "fade"})` : ""}`);
    const probe = async (u: string) => {
      const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", u]);
      const j = JSON.parse(out) as { format?: { duration?: string }; streams?: { codec_type: string }[] };
      return { dur: Number(j.format?.duration) || 0, audio: (j.streams ?? []).some((x) => x.codec_type === "audio") };
    };
    const parts: { url: string; ss?: number; t?: number }[] = [];
    if (e.introUrl) parts.push({ url: e.introUrl });
    // The episode as the pieces that are kept: the trim, less any sections cut from the middle.
    const cuts = (e.cuts ?? []).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
    if (!cuts.length) {
      parts.push({ url: job.downloadUrl, ss: e.trimStart || undefined, t: e.trimEnd ? e.trimEnd - e.trimStart : undefined });
    } else {
      const to = e.trimEnd || (await probe(job.downloadUrl)).dur;
      let at = e.trimStart || 0;
      for (const [a, b] of cuts) {
        if (a - at >= 0.2) parts.push({ url: job.downloadUrl, ss: at || undefined, t: a - at });
        at = Math.max(at, b);
      }
      if (to - at >= 0.2) parts.push({ url: job.downloadUrl, ss: at || undefined, t: to - at });
      console.log(`${tag}: ${cuts.length} cut${cuts.length === 1 ? "" : "s"} from the middle, ${parts.length - (e.introUrl ? 1 : 0)} pieces kept`);
    }
    if (e.outroUrl) parts.push({ url: e.outroUrl });
    // The kept pieces, as [from, to] in the episode's own seconds: where each music range lands after the cuts.
    const epEnd = e.trimEnd || (await probe(job.downloadUrl)).dur;
    const kept = parts.filter((p) => p.url === job.downloadUrl).map((p) => [p.ss ?? 0, p.t !== undefined ? (p.ss ?? 0) + p.t : epEnd] as [number, number]);
    const toOut = (t: number) => { let acc = 0; for (const [a, b] of kept) { if (t <= a) return acc; if (t < b) return acc + (t - a); acc += b - a; } return acc; };

    const args: string[] = ["-y", "-v", "error"];
    const graph: string[] = [];
    let silentAt = parts.length;
    const durs: number[] = [];
    for (const [i, p] of parts.entries()) {
      const info = await probe(p.url);
      const dur = p.t ?? Math.max(0, info.dur - (p.ss ?? 0));
      durs.push(dur);
      if (p.ss) args.push("-ss", String(p.ss));
      if (p.t) args.push("-t", String(p.t));
      args.push("-i", p.url);
      graph.push(`[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p,settb=AVTB[v${i}]`);
      if (info.audio) {
        graph.push(`[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
      } else {
        // Silence as long as this part, so the join stays in step.
        graph.push(`[${silentAt}:a]atrim=duration=${dur.toFixed(3)},aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
        (p as { silent?: number }).silent = silentAt++;
      }
    }
    for (const p of parts) if ((p as { silent?: number }).silent !== undefined) args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
    // The episode's kept pieces join straight; the intro and outro join it
    // with their transition (a crossfade, or a dip through black) unless it's a cut.
    const first = e.introUrl ? 1 : 0;
    const lastEp = parts.length - (e.outroUrl ? 1 : 0);
    const ep = parts.slice(first, lastEp).map((_, k) => first + k);
    graph.push(`${ep.map((i) => `[v${i}][a${i}]`).join("")}concat=n=${ep.length}:v=1:a=1[mv][ma]`);
    let cur = "m";
    let total = ep.reduce((n, i) => n + durs[i], 0);
    const join = (a: string, b: string, aDur: number, bDur: number, how: "fade" | "black" | "cut" | undefined, out: string) => {
      const T = how === "cut" ? 0 : Math.min(0.75, aDur / 2, bDur / 2);
      if (T < 0.1) {
        graph.push(`[${a}v][${a}a][${b}v][${b}a]concat=n=2:v=1:a=1[${out}v][${out}a]`);
        return aDur + bDur;
      }
      graph.push(`[${a}v][${b}v]xfade=transition=${how === "black" ? "fadeblack" : "fade"}:duration=${T.toFixed(3)}:offset=${(aDur - T).toFixed(3)}[${out}v]`);
      graph.push(`[${a}a][${b}a]acrossfade=d=${T.toFixed(3)}[${out}a]`);
      return aDur + bDur - T;
    };
    // Labels as <name>v / <name>a, so each join can take any two.
    const lbl = (i: number) => { graph.push(`[v${i}]null[p${i}v]`, `[a${i}]anull[p${i}a]`); return `p${i}`; };
    graph.push(`[mv]null[mainv]`, `[ma]anull[maina]`);
    cur = "main";
    if (e.introUrl) { total = join(lbl(0), cur, durs[0], total, e.introTransition, "j1"); cur = "j1"; }
    const bodyLen = ep.reduce((n, i) => n + durs[i], 0);
    // Where the episode itself starts in the finished video: after the intro, less the crossfade.
    const bodyAt = e.introUrl ? total - bodyLen : 0;
    if (e.outroUrl) { const o = parts.length - 1; total = join(cur, lbl(o), total, durs[o], e.outroTransition, "j2"); cur = "j2"; }
    // Music under parts of the episode: each track looped to its stretch, faded in and out,
    // quiet under the voices (or fuller for a stretch with no talking), laid in at its place.
    const music = (e.music ?? []).map((m) => ({ ...m, start: bodyAt + toOut(m.from), end: bodyAt + toOut(m.to) })).filter((m) => m.end - m.start >= 1);
    if (music.length) {
      let at = silentAt;
      const labels: string[] = [];
      for (const [k, m] of music.entries()) {
        args.push("-stream_loop", "-1", "-i", m.url);
        const len = m.end - m.start;
        const fade = Math.min(2, len / 3);
        graph.push(`[${at}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${len.toFixed(3)},asetpts=PTS-STARTPTS,volume=${m.level === "full" ? "0.6" : "0.12"},afade=t=in:d=${fade.toFixed(2)},afade=t=out:st=${(len - fade).toFixed(3)}:d=${fade.toFixed(2)},adelay=${Math.round(m.start * 1000)}:all=1[mu${k}]`);
        labels.push(`[mu${k}]`);
        at++;
      }
      graph.push(`[${cur}a]${labels.join("")}amix=inputs=${labels.length + 1}:duration=first:normalize=0[a]`, `[${cur}v]format=yuv420p[v]`);
      console.log(`${tag}: music under ${music.length} part${music.length === 1 ? "" : "s"}`);
    } else {
      // The crossfades can hand back 4:4:4 video, which Safari won't play at all and other browsers
      // stutter on: always finish in the ordinary 4:2:0.
      graph.push(`[${cur}v]format=yuv420p[v]`, `[${cur}a]anull[a]`);
    }
    const script = path.join(dir, "graph.txt");
    await fs.writeFile(script, graph.join(";"));
    const out = path.join(dir, `${job.recordingId}-edited.mp4`);
    await run("ffmpeg", [...args, "-filter_complex_script", script, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", process.env.CLEAN_PRESET || "superfast", "-crf", "23", "-pix_fmt", "yuv420p", "-profile:v", "high", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out]);
    const videoKey = await uploadBig(out, "video/mp4");
    await api("POST", `/api/agent/episode-edits/${job.recordingId}/done`, { videoKey, durationSec: Math.round(total) });
    console.log(`${tag}: done`);
  } catch (err) {
    console.warn(`${tag} failed: ${(err as Error).message}`);
    await api("POST", `/api/agent/episode-edits/${job.recordingId}/failed`, { error: (err as Error).message }).catch(() => {});
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * An import (a Zoom cloud recording): download it (Zoom redirects to its own
 * storage; the auth header only goes to zoom.us), measure it, put it in our
 * storage, and file it. Never throws — a failed import marks that recording.
 */
async function handleImport(job: Job): Promise<void> {
  const tag = `[${job.recordingId}] import`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `import-${job.recordingId}-`));
  try {
    console.log(`${tag}: ${job.title}`);
    const file = path.join(dir, "recording.mp4");
    const res = await fetch(job.downloadUrl, { headers: job.importFrom?.headers ?? {}, redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`the download was refused (${res.status})`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
    const sizeBytes = (await fs.stat(file)).size;
    // A link can point at anything; only a real video goes in the Library.
    const streams = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", file]).catch(() => "");
    if (!/video/.test(streams)) throw new Error("that address isn't a video file (a Zoom link may need its download token)");
    const durationSec = Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).catch(() => "0")).trim()) || job.durationSec;
    const key = await uploadBig(file, "video/mp4");
    await api("POST", `/api/agent/imports/${job.recordingId}/done`, { key, durationSec: Math.round(durationSec), sizeBytes });
    console.log(`${tag}: in the Library (${Math.round(sizeBytes / 1048576)}MB)`);
  } catch (err) {
    console.warn(`${tag} failed: ${(err as Error).message}`);
    await api("POST", `/api/agent/imports/${job.recordingId}/failed`, { error: (err as Error).message }).catch(() => {});
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Music under a finished clip. Over talking it ducks out of the way (a
 * sidechain on the voice); a clip with nothing said gets it at full level.
 * The track loops if the clip runs longer, and fades out at the end.
 */
async function mixMusic(file: string, music: string, speech: boolean): Promise<void> {
  const probe = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file]);
  const j = JSON.parse(probe) as { format?: { duration?: string }; streams?: { codec_type: string }[] };
  const dur = Number(j.format?.duration) || 0;
  const hasAudio = (j.streams ?? []).some((x) => x.codec_type === "audio");
  const fade = Math.max(0, dur - 1.5).toFixed(2);
  const out = file.replace(/\.mp4$/, "-music.mp4");
  const graph = speech && hasAudio
    ? `[1:a]volume=0.5,afade=t=out:st=${fade}:d=1.5[m];[0:a]asplit=2[v1][v2];[m][v1]sidechaincompress=threshold=0.015:ratio=10:attack=15:release=450[duck];[v2][duck]amix=inputs=2:duration=first:normalize=0[a]`
    : hasAudio
      ? `[1:a]volume=0.9,afade=t=out:st=${fade}:d=1.5[m];[0:a][m]amix=inputs=2:duration=first:normalize=0[a]`
      : `[1:a]volume=0.9,afade=t=out:st=${fade}:d=1.5,atrim=0:${dur.toFixed(2)}[a]`;
  await run("ffmpeg", ["-y", "-v", "error", "-i", file, "-stream_loop", "-1", "-i", music, "-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", dur.toFixed(2), "-movflags", "+faststart", out]);
  await fs.rename(out, file);
}

/**
 * Is anyone talking? The loudness of the voice band across the file: speech
 * sits well above -45 dB; a silent screen share or room tone sits far below.
 */
async function hasSpeech(file: string): Promise<boolean> {
  const out = await run("ffmpeg", ["-v", "info", "-i", file, "-map", "0:a:0?", "-af", "highpass=f=200,lowpass=f=3500,volumedetect", "-f", "null", "-"]).catch((e: Error) => e.message);
  const mean = Number(String(out).match(/mean_volume:\s*(-?[\d.]+) dB/)?.[1]);
  return Number.isFinite(mean) && mean > -45;
}

/**
 * Nothing said in it (a product demo over music, a silent screen share):
 * clips by the clock instead of by the words. One clip if it's a minute or
 * less; otherwise evenly spaced 30-second pieces.
 */
function silentMoments(job: Job): Moment[] {
  const dur = Math.max(1, Math.floor(job.durationSec));
  const title = (job.title || job.show || "Clip").slice(0, 60);
  if (dur <= 60) return [{ title, caption: "", reason: "the whole recording", startSec: 0, endSec: dur }];
  const n = Math.max(1, Math.min(job.clipCount ?? Number(process.env.CLIP_COUNT || 4), Math.floor(dur / 30)));
  const gap = (dur - n * 30) / n;
  return Array.from({ length: n }, (_, i) => {
    const start = Math.floor(gap / 2 + i * (30 + gap));
    return { title: n > 1 ? `${title} · part ${i + 1}` : title, caption: "", reason: "a slice of the recording", startSec: start, endSec: Math.min(dur, start + 30) };
  });
}

/** "Add music": each finished clip, every shape, with the track mixed in; the new files replace them. */
async function handleMusic(job: Job): Promise<void> {
  const mm = job.musicMix!;
  const tag = `[${job.recordingId}] music`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `music-${job.recordingId}-`));
  try {
    console.log(`${tag}: ${mm.name} under ${mm.clips.length} clips`);
    const music = path.join(dir, "music.mp3");
    const got = await fetch(mm.url);
    if (!got.ok) throw new Error(`couldn't fetch the music: ${got.status}`);
    await fs.writeFile(music, new Uint8Array(await got.arrayBuffer()));
    const out: { id: number; url: string; verticalUrl: string; squareUrl: string }[] = [];
    for (const c of mm.clips) {
      const next = { id: c.id, url: "", verticalUrl: "", squareUrl: "" };
      for (const k of ["url", "verticalUrl", "squareUrl"] as const) {
        if (!c[k]) continue;
        const file = path.join(dir, `${c.id}-${k}.mp4`);
        const res = await fetch(c[k]);
        if (!res.ok || !res.body) throw new Error(`couldn't fetch clip ${c.id}: ${res.status}`);
        await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
        await mixMusic(file, music, !mm.silent);
        next[k] = await uploadFile(file, "video/mp4");
      }
      out.push(next);
    }
    await api("POST", `/api/agent/music-jobs/${job.recordingId}/done`, { clips: out });
    console.log(`${tag}: done`);
  } catch (err) {
    console.warn(`${tag} failed: ${(err as Error).message}`);
    await api("POST", `/api/agent/music-jobs/${job.recordingId}/failed`, { error: (err as Error).message }).catch(() => {});
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * A podcast episode from a Library video: the sound only, as a 128k stereo
 * MP3 at podcast loudness (-16 LUFS, what Apple and Spotify play at), then
 * into storage for the feed. Never throws.
 */
async function handleEpisodeAudio(job: Job): Promise<void> {
  const id = job.episodeAudio!.episodeId;
  const tag = `[episode ${id}] audio`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `epaudio-${id}-`));
  try {
    console.log(`${tag}: ${job.title}${job.episodeAudio!.copy ? " (copying from the old host)" : ""}`);
    if (job.episodeAudio!.copy) {
      // A moved show's episode: the file as it is, from the old host into our storage.
      const mime = job.episodeAudio!.mime || "audio/mpeg";
      const file = path.join(dir, `episode-${id}.${/mp4|m4a|aac/.test(mime) ? "m4a" : "mp3"}`);
      await run("curl", ["-s", "-f", "-L", "--retry", "3", "--max-time", "1800", "-A", "MilitaryVoices.ai host transfer", "-o", file, job.downloadUrl]);
      const sizeBytes = (await fs.stat(file)).size;
      if (sizeBytes < 1024) throw new Error("the old host sent an empty file");
      const audioKey = await uploadBig(file, mime);
      await api("POST", `/api/agent/episode-audio/${id}/done`, { audioKey, sizeBytes, copy: true });
      console.log(`${tag}: copied (${Math.round(sizeBytes / 1048576)}MB)`);
      return;
    }
    const out = path.join(dir, `episode-${id}.mp3`);
    await ffmpeg(["-i", job.downloadUrl, "-vn", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", "-id3v2_version", "3", out]);
    const sizeBytes = (await fs.stat(out)).size;
    const durationSec = Math.round(Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).catch(() => "0")).trim()) || job.durationSec);
    const audioKey = await uploadBig(out, "audio/mpeg");
    await api("POST", `/api/agent/episode-audio/${id}/done`, { audioKey, sizeBytes, durationSec });
    console.log(`${tag}: done (${Math.round(sizeBytes / 1048576)}MB)`);
  } catch (err) {
    console.warn(`${tag} failed: ${(err as Error).message}`);
    await api("POST", `/api/agent/episode-audio/${id}/failed`, { error: (err as Error).message }).catch(() => {});
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * An episode's picture: a still from its video, a little way in (past any
 * intro), the most typical frame of a few seconds there so it isn't mid-blink
 * or a black cut. The server crops it square around the people. Never throws.
 */
/**
 * A living photo, made smaller for phones: 720p, no sound, H.264 that starts
 * playing as it loads. Kling's own is 1440p and about 13 MB for five seconds.
 */
async function handleLivingSqueeze(job: Job): Promise<void> {
  const id = job.livingSqueeze!.pageId;
  // A talking intro keeps its sound; a living photo has none.
  const intro = job.livingSqueeze!.kind === "intro";
  const tag = `[page ${id}] ${intro ? "talking intro" : "living photo"}`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `living-${id}-`));
  try {
    const out = path.join(dir, "living.mp4");
    await ffmpeg(["-i", job.downloadUrl, "-vf", "scale='min(720,iw)':-2", "-c:v", "libx264", "-preset", "medium", "-crf", "26", "-pix_fmt", "yuv420p", ...(intro ? ["-c:a", "aac", "-b:a", "96k"] : ["-an"]), "-movflags", "+faststart", out]);
    const mp4 = await fs.readFile(out);
    await api("POST", `/api/agent/living-squeeze/${id}/done${intro ? "?kind=intro" : ""}`, { mp4: mp4.toString("base64") });
    console.log(`${tag}: done (${Math.round(mp4.length / 1024)} KB)`);
  } catch (err) {
    console.warn(`${tag} failed: ${(err as Error).message}`);
    await api("POST", `/api/agent/living-squeeze/${id}/failed${intro ? "?kind=intro" : ""}`, {}).catch(() => {});
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function handleEpisodeStill(job: Job): Promise<void> {
  const id = job.episodeStill!.episodeId;
  const tag = `[episode ${id}] still`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `epstill-${id}-`));
  try {
    const out = path.join(dir, "still.jpg");
    const dur = job.durationSec > 0 ? job.durationSec : 600;
    let jpeg: Buffer | null = null;
    for (const at of [Math.min(Math.max(dur * 0.12, 8), 180), dur * 0.35, dur * 0.6]) {
      await fs.rm(out, { force: true }).catch(() => {});
      await ffmpeg(["-ss", String(Math.floor(at)), "-i", job.downloadUrl, "-vf", "thumbnail=90,scale='min(1920,iw)':-2", "-frames:v", "1", "-q:v", "2", out]).catch(() => {});
      const buf = await fs.readFile(out).catch(() => null);
      // A near-empty JPEG is a black or blank frame: try further in.
      if (buf && buf.length > 25_000) { jpeg = buf; break; }
    }
    if (!jpeg) throw new Error("no usable frame (audio only, or all dark)");
    await api("POST", `/api/agent/episode-still/${id}/done`, { jpeg: jpeg.toString("base64") });
    console.log(`${tag}: done`);
  } catch (err) {
    console.warn(`${tag} failed: ${(err as Error).message}`);
    await api("POST", `/api/agent/episode-still/${id}/failed`, {}).catch(() => {});
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Ask my show: an episode's words, for the AI to answer listeners from. Never throws. */
async function handleTranscript(job: Job): Promise<void> {
  const id = job.transcriptJob!.id;
  const tag = `[transcript ${id}]`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `tr-${id}-`));
  try {
    console.log(`${tag} ${job.title}`);
    const file = path.join(dir, "episode");
    await run("curl", ["-s", "-f", "-L", "--retry", "3", "--max-time", "1800", "-A", "MilitaryVoices.ai", "-o", file, job.downloadUrl]);
    const lines = await transcribeWithScribe(file, dir).catch(async (err) => {
      console.warn(`${tag} Scribe failed: ${err.message} — falling back`);
      if (process.env.DEEPGRAM_API_KEY) return transcribeWithDeepgram(file, dir);
      return transcribeLocally(file, dir);
    });
    await api("POST", `/api/agent/transcripts/${id}/done`, { lines });
    console.log(`${tag} done (${lines.length} lines)`);
  } catch (err) {
    console.warn(`${tag} failed: ${(err as Error).message}`);
    await api("POST", `/api/agent/transcripts/${id}/failed`, { error: (err as Error).message }).catch(() => {});
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * One show's segment from the day's broadcast recording: seek to its slot and keep its
 * minutes, sound only, at podcast loudness. The input seek reads only what's needed of a
 * sixteen-hour file. Never throws.
 */
async function handleSegmentCut(job: Job): Promise<void> {
  const c = job.segmentCut!;
  const tag = `[segment ${c.id}] ${job.title}`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `segment-${c.id}-`));
  try {
    console.log(`${tag}: ${Math.round(c.durationSec / 60)} min from ${Math.round(c.startSec / 60)} min in`);
    const out = path.join(dir, `segment-${c.id}.mp3`);
    await ffmpeg(["-ss", String(c.startSec), "-i", job.downloadUrl, "-t", String(c.durationSec), "-vn", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", "-id3v2_version", "3", out]);
    const durationSec = Math.round(Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).catch(() => "0")).trim()) || c.durationSec);
    if (durationSec < 30) throw new Error("the recording had almost nothing at that time");
    const audioKey = await uploadBig(out, "audio/mpeg");
    await api("POST", `/api/agent/segment-cuts/${c.id}/done`, { audioKey, durationSec });
    console.log(`${tag}: done (${Math.round(durationSec / 60)} min)`);
  } catch (err) {
    console.warn(`${tag} failed: ${(err as Error).message}`);
    await api("POST", `/api/agent/segment-cuts/${c.id}/failed`, { error: (err as Error).message }).catch(() => {});
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Bigger than 1080p (a 4K camera file) is cut down to 1080p before anything
 * else touches it. On 5 Oct one 4K episode held the whole queue for hours:
 * every render and the clean episode ran at four times the pixels for clips
 * that end up 1080 tall anyway. Never fatal: if the copy fails, the original
 * carries on as before.
 */
async function fitTo1080(source: string, job: Job): Promise<void> {
  const probe = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", source]).catch(() => "");
  const [w, h] = probe.trim().split(",").map(Number);
  if (!(w > 0 && h > 0) || Math.min(w, h) <= 1080) return;
  const portrait = h > w;
  console.log(`[${job.recordingId}] ${w}×${h} — making a 1080p copy first`);
  progress(job.recordingId, { stage: "download", pct: 100, detail: "making a 1080p copy of a 4K file" });
  const out = `${source}.1080.mp4`;
  const started = Date.now();
  try {
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", source, "-vf", portrait ? "scale=1080:-2" : "scale=-2:1080", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "copy", "-movflags", "+faststart", out]);
    await fs.rename(out, source);
    console.log(`[${job.recordingId}] 1080p copy made in ${Math.round((Date.now() - started) / 1000)}s`);
  } catch (err) {
    console.warn(`[${job.recordingId}] couldn't make a 1080p copy (${(err as Error).message}) — carrying on with the original`);
    await fs.rm(out, { force: true }).catch(() => {});
  }
}

async function handle(job: Job): Promise<void> {
  if (job.segmentCut) return handleSegmentCut(job);
  if (job.transcriptJob) return handleTranscript(job);
  if (job.episodeAudio) return handleEpisodeAudio(job);
  if (job.episodeStill) return handleEpisodeStill(job);
  if (job.livingSqueeze) return handleLivingSqueeze(job);
  if (job.musicMix) return handleMusic(job);
  if (job.importFrom) return handleImport(job);
  if (job.episodeEdit) return handleEpisodeEdit(job);
  if (job.suggestEdits) return handleSuggest(job);
  if (job.clipEdit) return handleEdit(job);
  if (job.cleanOnly) return handleClean(job);
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
    await fitTo1080(source, job);
    // Saved with no length (the browser's check timed out on the upload): the
    // moment picker was being told the episode was 0 seconds long.
    if (!(job.durationSec > 0)) {
      const d = Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", source]).catch(() => "")).trim());
      if (d > 0) {
        job.durationSec = d;
        console.log(`[${job.recordingId}] it's ${Math.round(d)}s long (saved without a length)`);
        await api("POST", `/api/agent/clip-jobs/${job.recordingId}/duration`, { durationSec: d }).catch(() => {});
      }
    }

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
    // An empty transcript on a recording that has speech in it is a failed
    // transcription, not a silent recording (7 Oct: Frank's segment came back
    // empty, read as silent, and got four evenly spaced slices with a centre
    // crop). Try every engine we have before believing it, and if none can
    // read it, stop with an error rather than make bad clips.
    if (!live && lines.length === 0 && (await hasSpeech(source))) {
      console.warn(`[${job.recordingId}] the transcript came back empty but there's speech: trying the other engines`);
      const engines: [string, () => Promise<Line[]>][] = [
        ...(process.env.ELEVENLABS_API_KEY ? [["Scribe", () => transcribeWithScribe(source, dir)] as [string, () => Promise<Line[]>]] : []),
        ...(process.env.DEEPGRAM_API_KEY ? [["Deepgram", () => transcribeWithDeepgram(source, dir)] as [string, () => Promise<Line[]>]] : []),
        ["whisper", () => transcribeLocally(source, dir)],
      ];
      const why: string[] = [];
      for (const [name, go] of engines) {
        try {
          lines = await go();
          if (lines.length) { console.log(`[${job.recordingId}] ${name} read it (${lines.length} lines)`); break; }
          why.push(`${name}: no words`);
        } catch (err) {
          console.warn(`[${job.recordingId}] ${name} failed: ${(err as Error).message}`);
          why.push(`${name}: ${(err as Error).message.replace(/\s+/g, " ").slice(0, 140)}`);
        }
      }
      if (!lines.length) throw new Error(`Couldn't transcribe the speech, so no clips were made. ${why.join(" | ")}`.slice(0, 600));
    }
    // Keep what we transcribed, so Generate more and Suggest edits needn't transcribe it again.
    if (!live && lines.length) {
      api("POST", `/api/agent/clip-jobs/${job.recordingId}/transcript`, { lines }).catch((err) => console.warn(`[${job.recordingId}] couldn't keep the transcript: ${(err as Error).message}`));
    }
    // Nothing said (a demo over music, a silent screen share): clips by the clock; music can go on after.
    const silent = lines.length === 0;
    let musicFile = "";
    if (job.music) {
      musicFile = path.join(dir, "music.mp3");
      const got = await fetch(job.music.url);
      if (!got.ok) throw new Error(`couldn't fetch the music: ${got.status}`);
      await fs.writeFile(musicFile, new Uint8Array(await got.arrayBuffer()));
      console.log(`[${job.recordingId}] music: ${job.music.name}`);
    }
    console.log(`[${job.recordingId}] ${silent ? "no talking — clips by the clock, with music" : `${lines.length} lines of transcript`}`);
    const words = lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
    progress(job.recordingId, { stage: "moments", pct: 0, words, transcriptSource: live ? "live" : "transcribed after" });

    // The longest remaining silence in the job: one Opus call over the whole
    // transcript. Three separate runs have been killed during a quiet stretch
    // that was the worker working, so every stage that takes real time says so
    // before it starts rather than after it finishes.
    // Two minutes or less: the whole video is the clip, cleaned first (ums,
    // false starts and long pauses out), captioned, in all three shapes.
    const short = !silent && !job.options?.more && job.durationSec > 0 && job.durationSec <= Number(process.env.SHORT_VIDEO_SEC || 120);
    let cleanedAlready = false;
    let wholeEnd = Math.floor(job.durationSec);
    if (short) {
      console.log(`[${job.recordingId}] short video — cleaning it, then one clip of the whole thing`);
      const cleanFile = path.join(dir, "whole-clean.mp4");
      const keeps = await cleanEpisode(job, source, dir, cleanFile);
      cleanedAlready = true;
      if (keeps && (await fs.stat(cleanFile).then(() => true, () => false))) {
        await fs.copyFile(cleanFile, source);
        lines = lines.map((l) => ({ ...l, startSec: intoClean(l.startSec, keeps), endSec: intoClean(l.endSec, keeps) })).filter((l) => l.endSec > l.startSec);
        const d = Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", source]).catch(() => "")).trim());
        if (d > 0) wholeEnd = Math.floor(d * 100) / 100;
      }
    }
    console.log(`[${job.recordingId}] choosing moments…`);
    const moments = silent
      ? silentMoments(job)
      : short
        ? [{ title: (job.title || job.show || "Clip").slice(0, 60), caption: "", reason: "the whole video, cleaned", startSec: 0, endSec: wholeEnd }]
        : await pickMoments(job, lines);
    console.log(`[${job.recordingId}] picked ${moments.length}`);
    progress(job.recordingId, { stage: "render", pct: 0, moments: moments.map((m) => ({ title: m.title, startSec: m.startSec, endSec: m.endSec })), finished: 0 });
    if (moments.length === 0) {
      console.log(`[${job.recordingId}] nothing stood alone — no clips`);
      await api("POST", `/api/agent/clip-jobs/${job.recordingId}/done`, { clips: [] });
      return;
    }

    // Two clips at a time: most of a clip is waiting on Creatomate, not this machine.
    const out: Record<string, unknown>[] = new Array(moments.length);
    let finishedN = 0;
    const cutOne = async (i: number, m: Moment) => {
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
      const opts = job.options ?? { formats: ["vertical", "square", "wide"] as Shape[], captions: "animated" as const };
      const want = new Set(opts.formats);
      const tall = want.has("vertical") || want.has("square");
      // No talking: no one to follow, so the frame holds still.
      const geo = await framingFor(job, source, m, within, dir, !tall || silent ? "none" : opts.captions === "animated" ? "shots" : "one");

      // The same words go into all three, drawn per shape because the type is
      // sized against the canvas it lands on.
      const capDir = path.join(dir, stem);
      await fs.mkdir(capDir, { recursive: true });
      const step = (k: number, shape: string) =>
        progress(job.recordingId, { stage: "render", pct: ((i * 4 + k) / (moments.length * 4)) * 100, detail: `Clip ${i + 1} of ${moments.length} · ${shape}` });
      step(0, "all three shapes");
      // Only the shapes they asked for; Classic captions are ours, no Creatomate.
      const animated = !silent && opts.captions === "animated";
      const ours = !usesCreatomate();
      const made = animated && !ours ? await renderWithCreatomate(job, m, source, geo, { wide, vertical, square }, [...want]) : new Set<Shape>();
      // Whatever Creatomate didn't make, we make here, with the same
      // word-by-word captions (a straggling wide used to come back Classic).
      const todo = (["wide", "vertical", "square"] as const).filter((x) => want.has(x) && !made.has(x));
      const words = animated && todo.length ? await momentWords(source, m, within, dir) : undefined;
      const t0 = Date.now();
      // All at once: the ffmpeg slots decide how many actually run.
      await Promise.all(todo.map(async (x) => {
        const file = { wide, vertical, square }[x];
        const band = x === "wide" ? undefined : { file: bandFile, height: 220 };
        try {
          await render(source, file, m, x, band, geo, within, capDir, words);
        } catch (err) {
          if (!words) throw err;
          // A clip with Classic captions beats no clip.
          console.warn(`[${job.recordingId}] animated ${x} failed (${(err as Error).message.slice(0, 300)}); making it with Classic captions`);
          await render(source, file, m, x, band, geo, within, capDir);
        }
      }));
      if (todo.length) console.log(`[${job.recordingId}] rendered ${todo.join(", ")} here in ${Math.round((Date.now() - t0) / 1000)}s`);
      if (musicFile) {
        for (const [shape, file] of [["wide", wide], ["vertical", vertical], ["square", square]] as const) {
          if (want.has(shape)) await mixMusic(file, musicFile, !silent);
        }
      }
      step(3, "uploading");

      out[i] = ({
        title: m.title,
        caption: m.caption,
        reason: m.reason,
        startSec: m.startSec,
        endSec: m.endSec,
        transcript: within.map((l) => l.text).join(" ").slice(0, 8000),
        url: want.has("wide") ? await uploadFile(wide, "video/mp4") : "",
        verticalUrl: want.has("vertical") ? await uploadFile(vertical, "video/mp4") : "",
        squareUrl: want.has("square") ? await uploadFile(square, "video/mp4") : "",
        subtitlesUrl: await uploadFile(subs, "text/plain"),
      });
      console.log(`[${job.recordingId}] ${i + 1}/${moments.length} — ${m.title}`);
      // On the podcaster's screen now, not when the last clip is done.
      await api("POST", `/api/agent/clip-jobs/${job.recordingId}/clip`, { clip: out[i] }).catch((err) => console.warn(`[${job.recordingId}] couldn't send clip ${i + 1} early (${(err as Error).message}); it goes with the rest`));
      finishedN++;
      progress(job.recordingId, { stage: "render", pct: (finishedN / moments.length) * 100, finished: finishedN, detail: `${finishedN} of ${moments.length} ready` });
    };
    let nextClip = 0;
    await Promise.all(Array.from({ length: Math.min(Number(process.env.CLIP_PARALLEL || 2), moments.length) }, async () => {
      for (let i = nextClip++; i < moments.length; i = nextClip++) await cutOne(i, moments[i]);
    }));
    progress(job.recordingId, { stage: "upload", pct: 100 });

    // Each clip went up as it finished; these fill in any that didn't make it then.
    await api("POST", `/api/agent/clip-jobs/${job.recordingId}/done`, { clips: out.filter(Boolean), streamed: true });
    console.log(`[${job.recordingId}] done — ${out.length} clips`);

    // The clips are out; the clean episode follows. It's no longer this
    // job's claim — a shutdown now mustn't requeue clips that are finished.
    holding.delete(job.recordingId);
    // A clean episode is cutting ums and dead air out of talk; with no talk there's nothing to cut.
    // "Generate more" is clips only: the clean episode is already made.
    if (!silent && !job.options?.more && !cleanedAlready) await cleanEpisode(job, source, dir);
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
const holding = new Set<number>();
/** Episode edits in hand: a redeploy mid-edit hands those back too. */
const editing = new Set<number>();

async function release(): Promise<void> {
  const ids = [...holding];
  const edits = [...editing];
  holding.clear();
  editing.clear();
  await Promise.all([
    ...ids.map(async (id) => {
      console.log(`\nhanding #${id} back to the queue…`);
      await api("POST", `/api/agent/clip-jobs/${id}/failed`, { requeue: true }).catch((err) =>
        console.error(`could not release #${id}: ${(err as Error).message} — it will be reclaimed in 10 minutes`),
      );
    }),
    ...edits.map(async (id) => {
      console.log(`\nhanding #${id}'s edit back to the queue…`);
      await api("POST", `/api/agent/episode-edits/${id}/failed`, { requeue: true }).catch((err) =>
        console.error(`could not release #${id}'s edit: ${(err as Error).message} — it will be reclaimed in 30 minutes`),
      );
    }),
  ]);
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
  const { job } = await api<{ job: Job | null }>("POST", "/api/agent/clip-jobs/claim", { can: ["edit", "episode-edit", "segment-cut", "episode-audio", "episode-copy", "episode-still", "living-squeeze", "transcript", "import", "music", "suggest"] });
  if (!job) return false;
  // An edit is one clip, not the recording: a shutdown mid-edit leaves it to
  // the 15-minute reclaim rather than requeuing the whole episode.
  const clipJob = !(job.clipEdit || job.episodeEdit || job.segmentCut || job.episodeAudio || job.episodeStill || job.transcriptJob || job.importFrom || job.musicMix || job.suggestEdits);
  if (clipJob) holding.add(job.recordingId);
  if (job.episodeEdit) editing.add(job.recordingId);
  // "Still on it", every minute: a long quiet stretch (waiting on Creatomate)
  // must not look like a dead worker, or another lane claims the same job.
  if (clipJob) lastProgress.set(job.recordingId, Date.now());
  const beat = clipJob ? setInterval(() => {
    // Frozen: hand every held job back and exit, and Render starts a fresh worker.
    if (Date.now() - (lastProgress.get(job.recordingId) ?? Date.now()) > STALL_MS) {
      console.error(`[${job.recordingId}] no progress for ${Math.round(STALL_MS / 60_000)} minutes — handing jobs back and restarting`);
      void release().finally(() => process.exit(1));
      return;
    }
    api("POST", `/api/agent/clip-jobs/${job.recordingId}/heartbeat`).catch(() => {});
  }, 60_000) : undefined;
  try {
    await handle(job);
    clearInterval(beat);
    holding.delete(job.recordingId);
    editing.delete(job.recordingId);
    lastProgress.delete(job.recordingId);
  } catch (err) {
    lastProgress.delete(job.recordingId);
    clearInterval(beat);
    holding.delete(job.recordingId);
    editing.delete(job.recordingId);
    const message = (err as Error).message ?? String(err);
    console.error(`[${job.recordingId}] failed: ${message}`);
    await api("POST", `/api/agent/clip-jobs/${job.recordingId}/failed`, { error: message }).catch(() => {});
  }
  return true;
}

async function main(): Promise<void> {
  requireToken();
  // Leftovers from a worker that was killed mid-job fill the disk, and a full
  // disk stalls every render after it.
  for (const f of await fs.readdir(os.tmpdir()).catch(() => [] as string[])) {
    if (/^(clip|clean|edit|suggest|epedit|import|music|epaudio|living|epstill|tr|segment)-/.test(f)) await fs.rm(path.join(os.tmpdir(), f), { recursive: true, force: true }).catch(() => {});
  }
  console.log(`Clipper watching ${API_BASE}, every ${Math.round(POLL_MS / 1000)}s`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("No ANTHROPIC_API_KEY — falling back to speech density, which picks worse moments.");
  }
  console.log(`${LANES} jobs at a time, ${FFMPEG_SLOTS} ffmpeg at a time (${cpuLimit()} CPU, ${(memoryLimit() / 1e9).toFixed(1)}GB)`);
  // Each lane claims its own jobs (claims are atomic on the server), so a long
  // episode in one lane doesn't hold up a short one behind it.
  const lane = async (n: number) => {
    await new Promise((r) => setTimeout(r, n * 1500));
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
  };
  await Promise.all(Array.from({ length: LANES }, (_, i) => lane(i)));
}

// Importing this file to test a piece of it must not start the loop.
const invokedDirectly = process.argv[1] && /clipper\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) void main();
