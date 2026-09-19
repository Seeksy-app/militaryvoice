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
//   read -rs DEEPGRAM_API_KEY && export DEEPGRAM_API_KEY
//   API_BASE=https://www.militaryvoice.ai npx tsx agent/clipper.ts
//
// DEEPGRAM_API_KEY is only needed for a recording that has no live transcript
// — an old episode, or anything staged for a test.
//
// With no ANTHROPIC_API_KEY it still runs, falling back to picking the
// densest stretches of speech. That is worse, and it says so.

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { textPath, fitSize } from "../server/textPath.js";

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

async function uploadFile(file: string, contentType: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([await fs.readFile(file)], { type: contentType }), path.basename(file));
  form.append("name", path.basename(file));
  const res = await fetch(`${API_BASE}/api/agent/clip-files`, {
    method: "POST",
    headers: { "x-agent-token": AGENT_TOKEN },
    body: form,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { url: string }).url;
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

/** Cut one moment into one shape. */
export async function render(
  source: string,
  out: string,
  m: Moment,
  shape: "wide" | "vertical" | "square",
  band?: { file: string; height: number },
): Promise<void> {
  const dur = (m.endSec - m.startSec).toFixed(2);
  const size = shape === "wide" ? [1920, 1080] : shape === "vertical" ? [1080, 1920] : [1080, 1080];
  const [W, H] = size;

  // The picture is letterboxed onto a blurred copy of itself rather than
  // cropped. A centre crop is how a vertical clip loses the guest: two people
  // side by side, and one of them is simply gone. Letterboxing keeps the frame
  // the producer actually cut, and the blur stops the bars reading as a fault.
  const videoH = band ? H - band.height : H;
  const chain = [
    `[0:v]scale=${W}:${videoH}:force_original_aspect_ratio=increase,crop=${W}:${videoH},boxblur=28:2,setsar=1[bg]`,
    `[0:v]scale=${W}:${videoH}:force_original_aspect_ratio=decrease,setsar=1[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2[stage]`,
  ];

  const args = ["-ss", String(m.startSec), "-t", dur, "-i", source];
  if (band) {
    args.push("-i", band.file);
    chain.push(`[stage]pad=${W}:${H}:0:${band.height}:color=#000741[padded]`);
    chain.push(`[padded][1:v]overlay=0:0[v]`);
  } else {
    chain.push(`[stage]null[v]`);
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
  const wav = path.join(dir, "dg.wav");
  await ffmpeg(["-i", file, "-ac", "1", "-ar", "16000", "-vn", wav]);

  const q = new URLSearchParams({ model: "nova-3", smart_format: "true", utterances: "true", diarize: "true" });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${q}`, {
    method: "POST",
    headers: { authorization: `Token ${key}`, "content-type": "audio/wav" },
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

async function handle(job: Job): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `clip-${job.recordingId}-`));
  try {
    console.log(`[${job.recordingId}] ${job.show} — ${Math.round(job.durationSec)}s`);

    const source = path.join(dir, "segment.mp4");
    const res = await fetch(job.downloadUrl);
    if (!res.ok || !res.body) throw new Error(`couldn't download the recording: ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(source));

    let lines = job.transcript;
    if (transcriptCovers(lines, job.durationSec)) {
      console.log(`[${job.recordingId}] using the live transcript (${lines.length} lines)`);
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

    const moments = await pickMoments(job, lines);
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

      await render(source, wide, m, "wide");
      await render(source, vertical, m, "vertical", { file: bandFile, height: 220 });
      await render(source, square, m, "square", { file: bandFile, height: 220 });
      await fs.writeFile(subs, srt(within, m.startSec));

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
    }

    await api("POST", `/api/agent/clip-jobs/${job.recordingId}/done`, { clips: out });
    console.log(`[${job.recordingId}] done — ${out.length} clips`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------

async function tick(): Promise<boolean> {
  const { job } = await api<{ job: Job | null }>("POST", "/api/agent/clip-jobs/claim");
  if (!job) return false;
  try {
    await handle(job);
  } catch (err) {
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
