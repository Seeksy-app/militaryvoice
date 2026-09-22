// Move each uploaded episode's index to the front of the file, by way of the VPS.
//
//   npx tsx scripts/faststart-via-vps.ts            # probe: which files need it
//   npx tsx scripts/faststart-via-vps.ts --apply    # remux and put them back
//
// The episodes came in as MP4s with the "moov" index after half a gigabyte
// of "mdat". A browser has to reach the end of the file before it can show a
// frame or start playing, which on a home connection is a stall of minutes —
// on the rail's still, and worse, on the stage on the day. ffmpeg's
// +faststart rewrites the file with the index first, copying the streams,
// no re-encode. It runs on the VPS on a datacenter link and puts the file
// back under the same key, so nothing that points at it has to change.
import "dotenv/config";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { signedRecordingUrl, signedRecordingUpload } from "../server/recordingStorage";

const apply = process.argv.includes("--apply");
const HOST = process.env.MV_VPS ?? "vps";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });
const files = await sql<{ id: number; storage_key: string; label: string; size_bytes: number }[]>`
  SELECT id, storage_key, label, size_bytes FROM show_assets
  WHERE storage_key LIKE 'studio/%' AND storage_key ILIKE '%.mp4' ORDER BY id`;
await sql.end();

const ssh = (cmd: string) => execFileSync("ssh", ["-o", "BatchMode=yes", HOST, cmd], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 1 << 24 });

for (const f of files) {
  const get = await signedRecordingUrl(f.storage_key, 6 * 3600);
  // The first 64KB says where the index is: ftyp, then either moov or mdat.
  const head = execFileSync("curl", ["-s", "-r", "0-65535", get]);
  let i = 0; let first = "";
  while (i + 8 <= head.length) {
    const size = head.readUInt32BE(i); const typ = head.subarray(i + 4, i + 8).toString("latin1");
    if (typ === "moov" || typ === "mdat") { first = typ; break; }
    if (size < 8) break; i += size;
  }
  const mb = Math.round(f.size_bytes / 1048576);
  if (first === "moov") { console.log(`ok       #${f.id} ${f.label} (${mb} MB) — index already at the front`); continue; }
  console.log(`${apply ? "remuxing" : "needs it"} #${f.id} ${f.label} (${mb} MB) — first atom ${first || "?"}`);
  if (!apply) continue;
  const put = await signedRecordingUpload(f.storage_key, 6 * 3600);
  const out = ssh(
    `set -e; cd /root/mv-upload && rm -f in.mp4 out.mp4 && ` +
    `curl -sS --fail -o in.mp4 ${JSON.stringify(get)} && ` +
    `ffmpeg -v error -y -i in.mp4 -c copy -movflags +faststart out.mp4 && ` +
    `curl -sS --fail --retry 5 --retry-all-errors -o /dev/null -w '%{http_code}' -X PUT -H 'content-type: video/mp4' --upload-file out.mp4 ${JSON.stringify(put)} && ` +
    `echo && ls -l out.mp4 | awk '{print $5}' && rm -f in.mp4 out.mp4`,
  );
  console.log(`  put ${out.trim().split("\n").join(" · ")}`);
}
