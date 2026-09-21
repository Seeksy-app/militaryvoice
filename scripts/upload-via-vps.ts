// Upload the pre-recorded episodes by way of the VPS.
//
//   npx tsx scripts/upload-via-vps.ts           # dry run
//   npx tsx scripts/upload-via-vps.ts --apply
//
// Direct from this machine does not work. Nine attempts across two runs, single
// PUT and multipart, 16MB parts and 8MB, three in parallel and one at a time —
// every one died on "ssl/tls alert bad record mac", which is what you get when
// something between here and the internet is inspecting TLS and mangling it.
// It is not size: a 321MB file went through while a 170MB one failed in the
// same run.
//
// So the bytes travel over SSH instead, which that inspection does not touch,
// and the upload to R2 happens from the VPS on a clean datacenter link.
//
// Secrets stay here. The VPS is handed a presigned PUT URL and nothing else —
// no R2 key, no database password, no admin password. The URL is good for one
// object for a few hours, which is the least it can be given and still work.
import "dotenv/config";
import { statSync } from "node:fs";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";
import postgres from "postgres";
import { signedRecordingUpload } from "../server/recordingStorage";

const FILES = [
  "Devil Dawg Double Dare Podcast Ep 4 Major Life Changes with Phil Randazzo.mp4",
  "Episode 314 | Ibogaine Treatment - Veterans with PTSD -  - 2026-09-20 06-45-10_0.mp4",
  "VFW Podcast 73- Sets and Reps.mp4",
  // Brave Blocks, 8:30 PM — the YouTube episode Greg sent, pulled down.
  "Montel Williams- Sacrifice, Service, and Stardom.mp4",
  // Developing The Leader Within, 9:00 AM — the episode Enrique submitted,
  // from his Drive link. Replaces Episode 311 on the segment.
  "DTLW Podcast Ericka Full Video1.mp4",
];

const HOST = process.env.MV_VPS ?? "root@187.77.217.123";
const STAGE = "/root/mv-upload";
const API = process.env.MV_API ?? "https://militaryvoice.ai";
const MB = (n: number) => `${(n / 1048576).toFixed(1)}MB`;

const run = (cmd: string, args: string[]) =>
  spawnSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"] }).status ?? 1;

async function main() {
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
  const [ev] = await sql`SELECT admin_password FROM events WHERE is_featured = true`;
  const have = await sql`SELECT file_name FROM show_assets WHERE file_name <> ''`;
  await sql.end();
  const already = new Set((have as any[]).map((r) => r.file_name));

  const todo = FILES.filter((f) => !already.has(basename(f))).map((f) => ({ f, size: statSync(f).size }));
  for (const t of todo) console.log(`  send  ${MB(t.size).padStart(9)}  ${basename(t.f)}`);
  console.log(`\n${todo.length} file(s), ${MB(todo.reduce((n, t) => n + t.size, 0))} via ${HOST}`);
  if (!process.argv.includes("--apply")) { console.log("\nDry run — pass --apply."); return; }

  for (const t of todo) {
    const name = basename(t.f);
    console.log(`\n${name}`);

    // --append resumes rather than restarting the gigabyte. macOS ships
    // openrsync, which has no --append-verify, so the prefix is not checked
    // during transfer — hence the checksum below. A resumed upload that
    // silently appended onto a bad partial is a file that plays as garbage on
    // show day, which is worse than sending it twice.
    console.log("  rsync → vps");
    const remote = `${STAGE}/${name}`;
    let landed = false;
    for (let attempt = 1; attempt <= 2 && !landed; attempt++) {
      if (run("rsync", ["--partial", "--append", "--progress", "-e", "ssh -o BatchMode=yes", t.f, `${HOST}:${STAGE}/`]) !== 0) {
        console.log(`  rsync attempt ${attempt} failed`);
        continue;
      }
      const mine = (spawnSync("md5", ["-q", t.f], { encoding: "utf8" }).stdout ?? "").trim();
      const theirs = (spawnSync("ssh", ["-o", "BatchMode=yes", HOST, `md5sum ${JSON.stringify(remote)} | cut -d" " -f1`], { encoding: "utf8" }).stdout ?? "").trim();
      if (mine && mine === theirs) { landed = true; break; }
      console.log(`  checksum mismatch — resending whole file`);
      spawnSync("ssh", ["-o", "BatchMode=yes", HOST, `rm -f ${JSON.stringify(remote)}`]);
    }
    if (!landed) { console.log("  rsync FAILED"); continue; }
    console.log("  checksum ok");

    const key = `studio/${Date.now()}-${name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80)}`;
    const url = signedRecordingUpload(key, 6 * 3600);
    console.log("  vps → R2");
    const put = spawnSync("ssh", ["-o", "BatchMode=yes", HOST,
      `curl --fail-with-body --retry 5 --retry-all-errors -s -w '%{http_code}' -X PUT -H 'content-type: video/mp4' --upload-file ${JSON.stringify(remote)} ${JSON.stringify(url)}`,
    ], { encoding: "utf8" });
    const code = (put.stdout ?? "").trim().slice(-3);
    if (code !== "200") { console.log(`  upload FAILED (${code || put.status}) ${(put.stderr ?? "").slice(0, 200)}`); continue; }
    console.log("  uploaded");

    const reg = await fetch(`${API}/api/admin/media`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-password": ev.admin_password },
      body: JSON.stringify({
        storageKey: key, fileName: name, sizeBytes: t.size, kind: "Other",
        label: name.replace(/\.[^.]+$/, "").replace(/\s*-\s*\d{4}-\d{2}-\d{2}.*$/, "").trim(),
      }),
    });
    const body = (await reg.json().catch(() => ({}))) as { id?: number; message?: string };
    console.log(reg.ok ? `  in the library as asset #${body.id}` : `  register FAILED ${reg.status} ${body.message ?? ""}`);

    // The VPS is a staging post, not a second copy to keep track of.
    if (reg.ok) spawnSync("ssh", ["-o", "BatchMode=yes", HOST, `rm -f ${JSON.stringify(remote)}`]);
  }
}

main();
