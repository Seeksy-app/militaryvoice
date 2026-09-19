// Deepgram vs ElevenLabs Scribe, on our own audio.
//
//   npx tsx scripts/stt-compare.ts "episode.mp4" 560 90
//
// Benchmarks are run on read-aloud corpora by the vendor selling the thing.
// This runs both over a slice of a real two-person conversation with crosstalk
// and names in it, and reports the four things that actually decide it for us:
// do the fillers survive, are there word timings, is there diarisation, and
// how long did it take. Accuracy you judge by reading them side by side.
import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";

const run = promisify(execFile);
const [file, startArg = "560", lenArg = "90"] = process.argv.slice(2);
if (!file) throw new Error('Usage: npx tsx scripts/stt-compare.ts "<video>" [startSec] [lenSec]');

const wav = "/tmp/stt-probe.wav";
await run("ffmpeg", ["-v", "error", "-y", "-ss", startArg, "-t", lenArg, "-i", file, "-ac", "1", "-ar", "16000", "-vn", wav]);
const audio = await fs.readFile(wav);
console.log(`${lenArg}s from ${startArg}s · ${(audio.length / 1048576).toFixed(1)}MB wav\n`);

/** The seven Deepgram tags, plus the ones nobody tags that we care about. */
const FILLERS = /\b(uh|um|mhmm|mm-mm|uh-uh|uh-huh|nuh-uh|er|ah)\b/gi;
const HEDGES = /\b(you know|i mean|sort of|kind of|like)\b/gi;

function report(name: string, ms: number, text: string, words: any[], speakers: Set<string>) {
  const f = text.match(FILLERS) ?? [];
  const h = text.match(HEDGES) ?? [];
  const timed = words.filter((w) => typeof w?.start === "number" || typeof w?.startTime === "number").length;
  console.log(`── ${name} ────────────────────────────────`);
  console.log(`   ${(ms / 1000).toFixed(1)}s · ${text.split(/\s+/).filter(Boolean).length} words`);
  console.log(`   fillers kept : ${f.length}${f.length ? `  (${[...new Set(f.map((x) => x.toLowerCase()))].join(", ")})` : "  — none survived"}`);
  console.log(`   hedges       : ${h.length}`);
  console.log(`   word timings : ${timed ? `yes (${timed}/${words.length})` : "NO"}`);
  console.log(`   speakers     : ${speakers.size ? [...speakers].join(", ") : "none"}`);
  console.log(`   ${text.slice(0, 340).replace(/\s+/g, " ")}…\n`);
}

// ---- Deepgram ----
const dgKey = (process.env.DEEPGRAM_API_KEY || "").trim();
if (!dgKey) console.log("── Deepgram ── skipped: DEEPGRAM_API_KEY not in .env\n");
else {
  const q = new URLSearchParams({ model: "nova-3", smart_format: "true", filler_words: "true", diarize: "true", punctuate: "true" });
  const t = Date.now();
  const res = await fetch(`https://api.deepgram.com/v1/listen?${q}`, {
    method: "POST",
    headers: { authorization: `Token ${dgKey}`, "content-type": "audio/wav" },
    body: audio,
  });
  const ms = Date.now() - t;
  if (!res.ok) console.log(`── Deepgram ── FAILED ${res.status}: ${(await res.text()).slice(0, 200)}\n`);
  else {
    const j: any = await res.json();
    const alt = j?.results?.channels?.[0]?.alternatives?.[0] ?? {};
    const words = alt.words ?? [];
    report("Deepgram nova-3", ms, alt.transcript ?? "", words, new Set(words.map((w: any) => String(w.speaker)).filter((x: string) => x !== "undefined")));
    await fs.writeFile("/tmp/stt-deepgram.json", JSON.stringify(j, null, 1));
  }
}

// ---- ElevenLabs Scribe ----
const elKey = (process.env.ELEVENLABS_API_KEY || "").trim();
if (!elKey) console.log("── ElevenLabs ── skipped: ELEVENLABS_API_KEY not in .env\n");
else {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "probe.wav");
  form.append("model_id", "scribe_v1");
  form.append("diarize", "true");
  form.append("timestamps_granularity", "word");
  const t = Date.now();
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": elKey },
    body: form,
  });
  const ms = Date.now() - t;
  if (!res.ok) console.log(`── ElevenLabs ── FAILED ${res.status}: ${(await res.text()).slice(0, 300)}\n`);
  else {
    const j: any = await res.json();
    const words = j?.words ?? [];
    report("ElevenLabs scribe_v1", ms, j?.text ?? "", words, new Set(words.map((w: any) => String(w.speaker_id)).filter((x: string) => x !== "undefined")));
    await fs.writeFile("/tmp/stt-elevenlabs.json", JSON.stringify(j, null, 1));
    // The response shape is not something to take on faith.
    console.log(`   top-level keys: ${Object.keys(j).join(", ")}`);
    if (words[0]) console.log(`   word keys     : ${Object.keys(words[0]).join(", ")}\n`);
  }
}
console.log("Raw responses in /tmp/stt-deepgram.json and /tmp/stt-elevenlabs.json");
