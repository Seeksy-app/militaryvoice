// Put the pre-recorded episodes in the studio's media library.
//
//   npx tsx scripts/upload-recordings.ts           # dry run
//   npx tsx scripts/upload-recordings.ts --apply
//
// They go to R2, not Supabase. Supabase caps a file at 50MB and the bucket
// cannot be raised past it — asking for 2GB comes back "the object exceeded
// the maximum allowed size", because the project's own limit wins. Chunking
// does not help either: the 413 is thrown on the declared size at the start of
// a resumable upload, before any bytes move.
//
// R2 has no such ceiling, already holds the recordings, and is fast on the
// same connection that Supabase was refusing — measured at 60MB in ten
// seconds. /api/assets/:id/file signs a URL and redirects to it, so nothing
// about R2 being private gets in the way of playing one on the stage.
import "dotenv/config";
import { statSync } from "node:fs";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";
import postgres from "postgres";
import { signedRecordingUpload } from "../server/recordingStorage";

const FILES = [
  "Devil Dawg Double Dare Podcast Ep 4 Major Life Changes with Phil Randazzo.mp4",
  "Mission Transition- How Top Military Leaders Reinvent Themselves Without Losing Their Edge..mp4",
  "Episode 314 | Ibogaine Treatment - Veterans with PTSD -  - 2026-09-20 06-45-10_0.mp4",
  "VFW Podcast 73- Sets and Reps.mp4",
];

const API = process.env.MV_API ?? "https://militaryvoice.ai";
const MB = (n: number) => `${(n / 1048576).toFixed(1)}MB`;

async function main() {
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
  const [ev] = await sql`SELECT admin_password FROM events WHERE is_featured = true`;
  const have = await sql`SELECT file_name FROM show_assets WHERE file_name <> ''`;
  await sql.end();
  const already = new Set((have as any[]).map((r) => r.file_name));

  const plan = FILES.map((f) => ({ f, size: statSync(f).size, done: already.has(basename(f)) }))
    .sort((a, b) => a.size - b.size);
  for (const p of plan) console.log(`  ${p.done ? "skip" : "send"}  ${MB(p.size).padStart(9)}  ${basename(p.f)}`);
  const todo = plan.filter((p) => !p.done);
  console.log(`\n${todo.length} to upload, ${MB(todo.reduce((n, p) => n + p.size, 0))} → R2`);
  if (!process.argv.includes("--apply")) { console.log("\nDry run — pass --apply."); return; }

  for (const p of todo) {
    const name = basename(p.f);
    const key = `studio/${Date.now()}-${name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80)}`;
    console.log(`\n${name}`);
    // Room for the big one: a gigabyte at the measured rate is a few minutes,
    // and a signed URL that expires mid-transfer fails at 99%.
    const url = signedRecordingUpload(key, 4 * 3600);
    const put = spawnSync("curl", [
      "--fail-with-body", "--retry", "3", "--retry-all-errors", "--retry-delay", "3",
      "--progress-bar", "-X", "PUT", "-H", "content-type: video/mp4",
      "--upload-file", p.f, url,
    ], { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", maxBuffer: 1 << 24 });
    if (put.status !== 0) { console.log(`    FAILED curl exit ${put.status} ${(put.stdout ?? "").slice(0, 300)}`); continue; }

    const reg = await fetch(`${API}/api/admin/media`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-password": ev.admin_password },
      body: JSON.stringify({
        storageKey: key,
        fileName: name,
        label: name.replace(/\.[^.]+$/, "").replace(/\s*-\s*\d{4}-\d{2}-\d{2}.*$/, "").trim(),
        kind: "Other",
        sizeBytes: p.size,
      }),
    });
    const body = (await reg.json().catch(() => ({}))) as { id?: number; message?: string };
    console.log(reg.ok ? `    in the library as asset #${body.id}` : `    uploaded but register FAILED ${reg.status} ${body.message ?? ""}`);
  }
}

main();
