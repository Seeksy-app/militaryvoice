// Put the pre-recorded episodes in the studio's media library.
//
//   npx tsx scripts/upload-recordings.ts           # dry run
//   npx tsx scripts/upload-recordings.ts --apply
//
// The files go straight from this machine to storage on a signed URL. They do
// not pass through the API: a Vercel function takes a 4.5MB request body and
// the smallest of these is a hundred and seventy megabytes, so routing them
// through the server is not a slow version of this, it is a 413.
//
// Smallest first, deliberately. If the project is going to run out of storage
// it does it on the third file rather than forty minutes into the first, and
// three episodes in the library beat one.
import "dotenv/config";
import { createReadStream, statSync } from "node:fs";
import { basename } from "node:path";
import postgres from "postgres";

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
  const pw = ev?.admin_password;
  if (!pw) throw new Error("No admin password on the featured event.");

  const apply = process.argv.includes("--apply");
  const plan = FILES.map((f) => ({ f, size: statSync(f).size, done: already.has(basename(f)) }))
    .sort((a, b) => a.size - b.size);

  console.log(`${API}\n`);
  for (const p of plan) console.log(`  ${p.done ? "skip (already up)" : "upload"}  ${MB(p.size).padStart(8)}  ${basename(p.f)}`);
  const todo = plan.filter((p) => !p.done);
  console.log(`\n${todo.length} to upload, ${MB(todo.reduce((n, p) => n + p.size, 0))} total`);
  if (!apply) { console.log("\nDry run — pass --apply."); return; }

  for (const p of todo) {
    const name = basename(p.f);
    process.stdout.write(`\n${name}\n  signing… `);
    const signRes = await fetch(`${API}/api/admin/media/upload-url`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-password": pw },
      body: JSON.stringify({ fileName: name }),
    });
    if (!signRes.ok) { console.log(`FAILED ${signRes.status} ${await signRes.text()}`); continue; }
    const { uploadUrl, publicUrl } = (await signRes.json()) as { uploadUrl: string; publicUrl: string };

    process.stdout.write(`ok\n  uploading ${MB(p.size)}… `);
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": "video/mp4", "content-length": String(p.size) },
      body: createReadStream(p.f) as any,
      duplex: "half",
    } as any);
    if (!put.ok) { console.log(`FAILED ${put.status} ${(await put.text()).slice(0, 300)}`); continue; }

    process.stdout.write("ok\n  registering… ");
    const reg = await fetch(`${API}/api/admin/media`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-password": pw },
      body: JSON.stringify({
        uploadedUrl: publicUrl,
        fileName: name,
        label: name.replace(/\.[^.]+$/, "").replace(/\s*-\s*\d{4}-\d{2}-\d{2}.*$/, "").trim(),
        kind: "Other", // ASSET_KINDS has no Episode; the route coerces anything else to this anyway
        sizeBytes: p.size,
      }),
    });
    console.log(reg.ok ? "done" : `FAILED ${reg.status} ${await reg.text()}`);
  }
}

main();
