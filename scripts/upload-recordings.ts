// Put the pre-recorded episodes in the studio's media library.
//
//   npx tsx scripts/upload-recordings.ts           # dry run
//   npx tsx scripts/upload-recordings.ts --apply
//
// They go to R2, not Supabase. Supabase caps a file at 50MB and the bucket
// cannot be raised past it — asking for 2GB comes back "the object exceeded
// the maximum allowed size", because the project's own limit wins. Chunking
// does not get round that either: the 413 lands on the declared size when a
// resumable upload is created, before any bytes move.
//
// Multipart, because one long request does not survive this connection. A 60MB
// probe to R2 finished in ten seconds and passed; every real file — 170MB and
// up — was reset mid-send with curl 55/56. The limit is on how long a single
// upload stays open, not on the destination, so each part is its own short
// request and a dropped one costs 16MB and a retry instead of the whole file.
//
// /api/assets/:id/file signs a URL and redirects to it, so a private bucket
// costs nothing at playback.
import "dotenv/config";
import { createReadStream, statSync } from "node:fs";
import { basename } from "node:path";
import postgres from "postgres";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const FILES = [
  "Devil Dawg Double Dare Podcast Ep 4 Major Life Changes with Phil Randazzo.mp4",
  "Mission Transition- How Top Military Leaders Reinvent Themselves Without Losing Their Edge..mp4",
  "Episode 314 | Ibogaine Treatment - Veterans with PTSD -  - 2026-09-20 06-45-10_0.mp4",
  "VFW Podcast 73- Sets and Reps.mp4",
];

const API = process.env.MV_API ?? "https://militaryvoice.ai";
const MB = (n: number) => `${(n / 1048576).toFixed(1)}MB`;

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

async function put(file: string, key: string, size: number): Promise<void> {
  let shown = -1;
  const up = new Upload({
    client: s3,
    params: { Bucket: process.env.R2_BUCKET!, Key: key, Body: createReadStream(file), ContentType: "video/mp4" },
    partSize: 16 * 1024 * 1024, // A few seconds a part at the measured rate.
    queueSize: 3,
    leavePartsOnError: false,
  });
  up.on("httpUploadProgress", (p) => {
    const pct = Math.floor(((p.loaded ?? 0) / size) * 100);
    if (pct !== shown && pct % 5 === 0) {
      shown = pct;
      process.stdout.write(`\r    ${String(pct).padStart(3)}%  ${MB(p.loaded ?? 0)} / ${MB(size)}   `);
    }
  });
  await up.done();
  process.stdout.write(`\r    100%  ${MB(size)}                         \n`);
}

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
  console.log(`\n${todo.length} to upload, ${MB(todo.reduce((n, p) => n + p.size, 0))} → R2 in 16MB parts`);
  if (!process.argv.includes("--apply")) { console.log("\nDry run — pass --apply."); return; }

  for (const p of todo) {
    const name = basename(p.f);
    const key = `studio/${Date.now()}-${name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80)}`;
    console.log(`\n${name}`);
    try {
      await put(p.f, key, p.size);
    } catch (err: any) {
      console.log(`\n    FAILED: ${String(err?.message ?? err).slice(0, 200)}`);
      continue;
    }
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
