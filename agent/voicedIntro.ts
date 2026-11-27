// A show's voiced intro and outro, made for each episode (27 Nov 2026, Andrew approved the shape on Riccoh's
// Warriors' Voice: "Perfect. Save those settings.").
//
// The shape, like a normal show open: the show's own music at full for a few seconds, a short fade, then the
// voice reads the intro with the music still there underneath (about 13 dB below her: audible, never covering
// her), then the music comes back up briefly and fades out. The outro is the show's own fixed outro audio.
//
// The numbers (levels in dB on the show's long music bed, and the voice's loudness) were measured from the
// approved mix, so every episode sounds like the one Andrew passed. The line about the guest and the topic is
// written from the episode's transcript, in the show's pattern, and read by the show's voice.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

export interface VoicedBookends {
  /** ElevenLabs voice and settings. */
  voiceId: string;
  model?: string;
  settings?: { stability?: number; similarity_boost?: number; style?: number; speed?: number };
  /** Show name as spoken, and the host: the short name and the full name. */
  show: string;
  host: string;
  hostFull: string;
  /** Spelled for the voice (e.g. Riccoh → Reeko); the written line keeps the real spelling. */
  say?: Record<string, string>;
  /** This episode's guest, as the card shows it. */
  guestName: string;
  /** Use these words for the intro instead of writing one. */
  introText?: string;
  /** The show's music, long enough to sit under any intro (looped on the beat ahead of time), signed. */
  bedUrl: string;
  /** The show's fixed outro audio (music and voice already mixed), signed. */
  outroAudioUrl?: string;
  /** Loudness the voice is brought to (LUFS), and the music's level in each part (dB on the bed). */
  voiceLufs: number;
  leadDb: number;
  underDb: number;
  swellDb: number;
  /** Seconds: music alone at full, the fade down, and the music after the last word. */
  leadSec: number;
  fadeSec: number;
  tailSec: number;
}

export interface TranscriptLine { speaker: string; text: string; startSec: number; endSec: number }

function sh(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out + err) : reject(new Error(`${bin} exited ${code}: ${err.slice(-800)}`))));
  });
}

export async function durationOf(file: string): Promise<number> {
  const out = await sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(out.trim()) || 0;
}

async function lufsOf(file: string): Promise<number> {
  const out = await sh("ffmpeg", ["-hide_banner", "-i", file, "-af", "ebur128", "-f", "null", "-"]);
  const all = [...out.matchAll(/I:\s+(-?[\d.]+) LUFS/g)];
  const v = Number(all[all.length - 1]?.[1]);
  if (!Number.isFinite(v)) throw new Error("couldn't measure the voice");
  return v;
}

/** The intro's words: the show's pattern, with the guest and the topic written from the episode itself. */
export async function writeIntroLine(v: VoicedBookends, lines: TranscriptLine[]): Promise<string> {
  if (v.introText?.trim()) return v.introText.trim();
  const key = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  // The first twenty minutes say who the guest is and what they came to talk about.
  const text = lines.filter((l) => l.startSec < 20 * 60).map((l) => `${l.speaker}: ${l.text}`).join("\n").slice(0, 40_000);
  if (text.length < 200) throw new Error("not enough transcript to write the intro");
  const client = new Anthropic({ apiKey: key, timeout: 90_000, maxRetries: 1 });
  const res = await client.messages.create({
    model: process.env.INTRO_MODEL || "claude-opus-5",
    max_tokens: 600,
    tool_choice: { type: "tool", name: "intro" },
    tools: [{
      name: "intro",
      description: "The two pieces that go into the show's spoken intro.",
      input_schema: {
        type: "object",
        properties: {
          guest: { type: "string", description: `Who the guest is, as said aloud after "sits down with": their rank or role as the episode states it, then their name exactly as "${v.guestName}". For example "retired Green Beret Lieutenant Colonel Scott Mann". Only what the episode itself says; no guesses.` },
          topic: { type: "string", description: `What they talk about, as said aloud after "to talk about": one line, at most about 30 words, concrete (the story, the book, the mission), plain words, no hype.` },
        },
        required: ["guest", "topic"],
      },
    }],
    messages: [{
      role: "user",
      content: `This is the start of an episode of the podcast "${v.show}", hosted by ${v.hostFull}. The guest is ${v.guestName}.\n\nThe show's intro is read aloud like this: "Welcome to ${v.show}. Today, ${v.host} sits down with <guest>, to talk about <topic>. So here's your host, ${v.hostFull}."\n\nFill in <guest> and <topic> from the transcript.\n\nTranscript:\n${text}`,
    }],
  });
  const t = res.content.find((c) => c.type === "tool_use");
  const out = (t && t.type === "tool_use" ? t.input : {}) as { guest?: string; topic?: string };
  const guest = String(out.guest ?? "").trim().replace(/[.,]+$/, "") || v.guestName;
  const topic = String(out.topic ?? "").trim().replace(/[.]+$/, "");
  if (!topic) throw new Error("the intro came back without a topic");
  return `Welcome to ${v.show}. Today, ${v.host} sits down with ${guest}, to talk about ${topic}. So here's your host, ${v.hostFull}.`;
}

/** The words as the voice should say them (names spelled for pronunciation). */
export function spoken(v: VoicedBookends, line: string): string {
  let s = line;
  for (const [from, to] of Object.entries(v.say ?? {})) s = s.split(from).join(to);
  return s;
}

export async function speak(v: VoicedBookends, words: string, out: string): Promise<void> {
  const key = (process.env.ELEVENLABS_API_KEY || "").trim();
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set.");
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(v.voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ text: words, model_id: v.model || "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.2, ...(v.settings ?? {}) } }),
  });
  if (!r.ok) throw new Error(`the voice didn't come back (${r.status})`);
  await fs.writeFile(out, Buffer.from(await r.arrayBuffer()));
}

/**
 * The intro's sound: music at full, the fade, the voice over the music underneath, the swell and the fade out.
 * Returns the finished length in seconds.
 */
export async function mixIntro(v: VoicedBookends, voiceFile: string, out: string, dir: string): Promise<number> {
  const vDur = await durationOf(voiceFile);
  const start = v.leadSec + v.fadeSec;
  const ve = start + vDur;
  const end = ve + v.tailSec;
  // The voice at the approved loudness: measured, then one fixed gain (no riding).
  const norm = path.join(dir, "intro-voice-48k.wav");
  await sh("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", voiceFile, "-ac", "2", "-ar", "48000", norm]);
  const gain = v.voiceLufs - (await lufsOf(norm));
  const db = (x: number) => Math.pow(10, x / 20);
  const L = db(v.leadDb), U = db(v.underDb), S = db(v.swellDb);
  const lin = (t0: number, t1: number, a: number, b: number) => `${a}+(${b}-${a})*(t-${t0.toFixed(3)})/${(t1 - t0).toFixed(3)}`;
  const swellAt = ve + 0.75, fadeAt = end - 1.6;
  const env = [
    `if(lt(t,${v.leadSec.toFixed(3)}),${L}`,
    `if(lt(t,${start.toFixed(3)}),${lin(v.leadSec, start, L, U)}`,
    `if(lt(t,${(ve - 0.05).toFixed(3)}),${U}`,
    `if(lt(t,${swellAt.toFixed(3)}),${lin(ve - 0.05, swellAt, U, S)}`,
    `if(lt(t,${fadeAt.toFixed(3)}),${S}`,
    `max(0,${lin(fadeAt, end, S, 0)})`,
  ];
  const expr = env.join(",") + ")".repeat(env.length - 1);
  const ms = Math.round(start * 1000);
  await sh("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
    "-i", v.bedUrl, "-i", norm,
    "-filter_complex",
    `[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${end.toFixed(3)},asetpts=PTS-STARTPTS,volume='${expr}':eval=frame[m];` +
    `[1:a]aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${gain.toFixed(2)}dB,adelay=${ms}|${ms}[v];` +
    `[m][v]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89:level=false[a]`,
    "-map", "[a]", "-t", end.toFixed(3), "-ar", "48000", out]);
  return end;
}

/** The card as video, with this sound under it, faded in from black (intro) or out to black (outro). */
export async function cardVideo(png: string, audio: string, out: string, fade: "in" | "out"): Promise<void> {
  const d = await durationOf(audio);
  const vf = fade === "in" ? "fade=t=in:st=0:d=0.5" : `fade=t=out:st=${Math.max(0, d - 1).toFixed(3)}:d=1.0`;
  await sh("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-framerate", "30", "-i", png, "-i", audio,
    "-t", d.toFixed(3), "-vf", `scale=1280:720,format=yuv420p,${vf}`,
    "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-shortest", out]);
}
