// Exercises the clipper on a real file, end to end apart from the API.
//
//   npx tsx scripts/clipper-test.ts <segment.mp4> [outDir]
//
// Transcribes it, asks the model for the moments, renders all three shapes and
// writes the .srt — the whole job minus the download and the upload, which are
// two fetches. Prints what it picked so the picks can be read, not just counted.

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import "dotenv/config";
import {
  titleBand,
  render,
  srt,
  sane,
  densestStretches,
  transcriptCovers,
  transcribeLocally,
  pickMoments,
} from "../agent/clipper.js";

const source = process.argv[2];
const outDir = process.argv[3] || path.join(os.tmpdir(), "clipper-test");
if (!source) {
  console.error("usage: tsx scripts/clipper-test.ts <segment.mp4> [outDir]");
  process.exit(1);
}

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

await fs.mkdir(outDir, { recursive: true });
const work = await fs.mkdtemp(path.join(os.tmpdir(), "clipwork-"));

// --- the guard that decides whether to re-transcribe ------------------------
check("thin captions are not trusted", !transcriptCovers([], 480));
check(
  "a transcript covering a fifth of the time is trusted",
  transcriptCovers(
    Array.from({ length: 40 }, (_, i) => ({ speaker: "A", text: "words here", startSec: i * 10, endSec: i * 10 + 4 })),
    480,
  ),
);

// --- sanity filter ----------------------------------------------------------
const overlapping = [
  { title: "One", caption: "", reason: "", startSec: 10, endSec: 50 },
  { title: "Two", caption: "", reason: "", startSec: 40, endSec: 80 },
  { title: "Tiny", caption: "", reason: "", startSec: 100, endSec: 105 },
  { title: "", caption: "", reason: "", startSec: 200, endSec: 240 },
  { title: "Good", caption: "", reason: "", startSec: 300, endSec: 340 },
];
const kept = sane(overlapping, 480);
check("overlapping picks are dropped", !kept.some((m) => m.title === "Two"), kept.map((m) => m.title).join(","));
check("too-short picks are dropped", !kept.some((m) => m.title === "Tiny"));
check("untitled picks are dropped", kept.every((m) => m.title));
check("a clip past the end of the file is trimmed", sane([{ title: "X", caption: "", reason: "", startSec: 460, endSec: 900 }], 480)[0]?.endSec === 480);

// --- transcription ----------------------------------------------------------
console.log("\ntranscribing…");
const t0 = Date.now();
const lines = await transcribeLocally(source, work);
console.log(`${lines.length} lines in ${Math.round((Date.now() - t0) / 1000)}s`);
check("transcript has lines", lines.length > 20, `${lines.length}`);
check("lines are in order", lines.every((l, i) => i === 0 || l.startSec >= lines[i - 1].startSec));
check("lines have real text", lines.filter((l) => l.text.length > 3).length > lines.length * 0.8);

// --- the density fallback ---------------------------------------------------
const rough = densestStretches(lines);
check("the no-model fallback still returns picks", rough.length > 0, `${rough.length}`);
check("fallback picks don't overlap", rough.every((m, i) => i === 0 || m.startSec >= rough[i - 1].endSec));

// --- the model --------------------------------------------------------------
const job = {
  recordingId: 0,
  title: "Test segment",
  durationSec: Math.max(...lines.map((l) => l.endSec)),
  downloadUrl: "",
  show: "Always Forward",
  host: "Mario Fields",
  transcript: lines,
};
console.log("\nasking the model…");
const t1 = Date.now();
const moments = await pickMoments(job, lines);
console.log(`${moments.length} moments in ${Math.round((Date.now() - t1) / 1000)}s\n`);
for (const m of moments) {
  console.log(`  ${m.startSec}s–${m.endSec}s (${m.endSec - m.startSec}s)  ${m.title}`);
  if (m.caption) console.log(`      caption: ${m.caption}`);
  if (m.reason) console.log(`      why: ${m.reason}`);
}
check("the model returned moments", moments.length > 0, `${moments.length}`);
check("every moment is a usable length", moments.every((m) => m.endSec - m.startSec >= 20 && m.endSec - m.startSec <= 90));
check("moments don't overlap", moments.every((m, i) => i === 0 || m.startSec >= moments[i - 1].endSec));
check("moments sit inside the file", moments.every((m) => m.endSec <= job.durationSec + 1));
check(
  "each moment has words behind it",
  moments.every((m) => lines.some((l) => l.startSec >= m.startSec && l.endSec <= m.endSec)),
);

// --- rendering --------------------------------------------------------------
const first = moments[0] ?? rough[0];
if (first) {
  console.log("\nrendering…");
  const band = path.join(work, "band.png");
  await fs.writeFile(band, await titleBand(first.title, 1080, 220, "ALWAYS FORWARD"));
  const bandStat = await fs.stat(band);
  check("the title band renders", bandStat.size > 2000, `${bandStat.size} bytes`);

  const shapes: [string, "wide" | "vertical" | "square", [number, number]][] = [
    ["wide", "wide", [1920, 1080]],
    ["vertical", "vertical", [1080, 1920]],
    ["square", "square", [1080, 1080]],
  ];
  for (const [name, shape, [w, h]] of shapes) {
    const out = path.join(outDir, `clip-${name}.mp4`);
    const started = Date.now();
    await render(source, out, first, shape, shape === "wide" ? undefined : { file: band, height: 220 });
    const probe = await import("node:child_process").then(
      (cp) =>
        new Promise<string>((res) => {
          const p = cp.spawn("ffprobe", [
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-show_entries", "format=duration",
            "-of", "csv=p=0",
            out,
          ]);
          let s = "";
          p.stdout.on("data", (d) => (s += d));
          p.on("close", () => res(s));
        }),
    );
    const nums = probe.split(/[,\n]/).map(Number).filter((n) => !Number.isNaN(n));
    const [gotW, gotH, dur] = nums;
    const wantDur = first.endSec - first.startSec;
    check(
      `${name} renders at ${w}x${h}`,
      gotW === w && gotH === h,
      `${gotW}x${gotH} in ${Math.round((Date.now() - started) / 1000)}s`,
    );
    check(`${name} is the right length`, Math.abs(dur - wantDur) < 1.5, `${dur?.toFixed(1)}s vs ${wantDur}s`);

    const hasAudio = await import("node:child_process").then(
      (cp) =>
        new Promise<boolean>((res) => {
          const p = cp.spawn("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", out]);
          let s = "";
          p.stdout.on("data", (d) => (s += d));
          p.on("close", () => res(s.includes("audio")));
        }),
    );
    check(`${name} carries the audio`, hasAudio);
  }

  const subs = path.join(outDir, "clip.srt");
  const within = lines.filter((l) => l.endSec > first.startSec && l.startSec < first.endSec);
  await fs.writeFile(subs, srt(within, first.startSec));
  const srtText = await fs.readFile(subs, "utf8");
  check("subtitles are written", srtText.includes("-->"), `${within.length} cues`);
  check("subtitles start near zero", /^1\n00:00:0/.test(srtText), srtText.split("\n")[1] ?? "");
}

await fs.rm(work, { recursive: true, force: true });
console.log(`\noutput in ${outDir}`);
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
