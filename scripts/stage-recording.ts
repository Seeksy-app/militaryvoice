// Put a video into the clip pipeline as if it had just been on air.
//
//   npx tsx scripts/stage-recording.ts ./episode.mp4 --title "Test episode"
//   npx tsx scripts/stage-recording.ts ./episode.mp4 --signup 43
//
// The clipper normally wakes up when an egress finishes, which means you
// cannot try it without booking a slot, going live and talking for half an
// hour. This makes the same row by hand: the file goes into storage, a
// recording is written as Ready, and the clip job is queued. From the worker's
// side nothing is different — it claims the job, downloads the file and cuts.
//
// The upload uses the show-asset bucket rather than the recordings bucket for
// one reason: recordings are written by LiveKit straight into R2 and read back
// through a signed path, and signing a path we invented is more machinery than
// a test needs. The claim route passes an absolute URL straight through.
//
// Afterwards, run the worker against it:
//
//   AGENT_TOKEN=… ANTHROPIC_API_KEY=… API_BASE=https://www.militaryvoice.ai \
//     WHISPER_MODEL=/path/to/ggml-base.en.bin npx tsx agent/clipper.ts
import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const run = promisify(execFile);
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

if (!file) {
  console.error("Usage: npx tsx scripts/stage-recording.ts <video> [--title \"…\"] [--signup N] [--studio N]");
  process.exit(1);
}

// Checked before anything else, because the two ways this goes wrong are
// pasting the runbook's placeholder path verbatim and running from the wrong
// directory — and node's raw ENOENT stack explains neither.
if (/\/full\/path\/to\/|your-episode|<.*>/.test(file)) {
  console.error(`"${file}" is the example path, not a real one.`);
  console.error("Tip: type the command, then drag the video into the Terminal window — it pastes the real path.");
  process.exit(1);
}
const bytes = await fs
  .stat(file)
  .then((st) => st.size)
  .catch(() => {
    console.error(`Can't find ${file}`);
    console.error(`Working directory is ${process.cwd()} — run this from the militaryvoice folder.`);
    process.exit(1);
  });

/** ffprobe, because the clipper trusts durationSec when it decides what to cut. */
const { stdout } = await run("ffprobe", [
  "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file,
]);
const durationSec = Math.round(Number(stdout.trim()) || 0);
if (!durationSec) throw new Error("ffprobe could not read a duration from that file.");

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) throw new Error("Supabase is not configured in this .env.");
const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

const key = `staged/${Date.now()}-${path.basename(file).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
console.log(`uploading ${(bytes / 1_048_576).toFixed(1)}MB · ${durationSec}s → show-assets/${key}`);
const { error } = await supabase.storage
  .from("show-assets")
  .upload(key, await fs.readFile(file), { contentType: "video/mp4", upsert: true });
if (error) throw error;
const url = supabase.storage.from("show-assets").getPublicUrl(key).data.publicUrl;

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const [event] = await sql`SELECT id FROM events WHERE is_featured = true`;
const signupId = flag("signup") ? Number(flag("signup")) : null;
const signup = signupId ? (await sql`SELECT email, podcast_name FROM signups WHERE id = ${signupId}`)[0] : null;
const studioId = Number(flag("studio")) || (await sql`SELECT id FROM studios WHERE event_id = ${event.id} ORDER BY id LIMIT 1`)[0].id;

const now = new Date();
const [rec] = await sql`
  INSERT INTO recordings (event_id, studio_id, signup_id, email, title, egress_id, status, url,
                          duration_sec, size_bytes, started_at, ended_at, clip_status)
  VALUES (${event.id}, ${studioId}, ${signupId}, ${signup?.email ?? ""},
          ${flag("title") || signup?.podcast_name || path.basename(file)},
          ${`STAGED_${Date.now()}`}, 'Ready', ${url}, ${durationSec}, ${String(bytes)},
          ${new Date(now.getTime() - durationSec * 1000).toISOString()}, ${now.toISOString()}, 'queued')
  RETURNING id`;
await sql.end();

console.log(`\nrecording #${rec.id} is Ready and queued for clipping.`);
console.log(`  ${url}`);
console.log(`\nNow run the worker (it will claim this job):`);
console.log(`  AGENT_TOKEN=… ANTHROPIC_API_KEY=… API_BASE=https://www.militaryvoice.ai \\`);
console.log(`    WHISPER_MODEL=/path/to/ggml-base.en.bin npx tsx agent/clipper.ts`);
