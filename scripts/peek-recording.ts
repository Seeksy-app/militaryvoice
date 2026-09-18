// Pull one recording and look at what is actually in it.
//
//   npx tsx scripts/peek-recording.ts 10 /tmp/out
import "dotenv/config";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import postgres from "postgres";
import { signedRecordingUrl } from "../server/recordingStorage.js";

const run = promisify(execFile);
const id = Number(process.argv[2] ?? 10);
const outDir = process.argv[3] ?? ".";

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const [row] = await sql`SELECT id, url, duration_sec, size_bytes FROM recordings WHERE id = ${id}`;
await sql.end();
if (!row?.url) throw new Error(`recording ${id} has no file`);

const url = await signedRecordingUrl(row.url, 3600);
const mp4 = `${outDir}/rec-${id}.mp4`;
const res = await fetch(url);
if (!res.ok) throw new Error(`download failed: ${res.status}`);
await fs.writeFile(mp4, Buffer.from(await res.arrayBuffer()));
console.log(`downloaded ${mp4}`);

const { stdout } = await run("ffprobe", [
  "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate",
  "-show_entries", "format=duration", "-of", "default=nw=1", mp4,
]);
console.log(stdout.trim());

// Frames across the clip, so we can see what was on screen and when.
const dur = Math.max(1, Math.floor(Number(row.duration_sec) || 60));
for (const pct of [0.15, 0.5, 0.85]) {
  const t = Math.floor(dur * pct);
  await run("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", mp4, "-frames:v", "1", "-vf", "scale=640:-1", `${outDir}/rec-${id}-${t}s.jpg`]);
  console.log(`frame at ${t}s → ${outDir}/rec-${id}-${t}s.jpg`);
}
