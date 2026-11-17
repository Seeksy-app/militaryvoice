// Encores of a Radio day's live shows, cut from the day's recording without downloading it.
//
// The day recording is one 2.5GB file per two hours or so. ffmpeg reads just the part it needs straight from R2 (a signed
// link, ranged reads), so nothing big lands on a disk: this is the streaming replacement for downloading the file. Each live
// booking becomes a 720p mp4 at replays/radio-<day>/<signupId>-<slug>.mp4 and joins the open-time rotation (site setting
// dx:replays), then plays as "an encore of" like the Marathon replays do.
//
//   npx tsx --env-file=.env scripts/radio-encores.ts <eventId>           (cut what is not cut yet)
//   npx tsx --env-file=.env scripts/radio-encores.ts <eventId> --dry     (show the windows, cut nothing)
//
// The program page paints a red LIVE badge top left; an encore must not say LIVE, so it is covered with the frame's own navy.
// A show is cut from when it went on air to when it ended (the host pressing End, or leaving, ends it early), and only when one
// recording covers all of it. A show the recording missed is listed and skipped.
import "dotenv/config";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, rmSync, openSync, readSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db, storage } from "../server/storage.js";
import { sql } from "drizzle-orm";
import { bookingTimes } from "../server/booth.js";
import { signedRecordingUrl, startMultipart, signedPartUrl, completeMultipart, abortMultipart } from "../server/recordingStorage.js";

const eventId = Number(process.argv[2]);
const DRY = process.argv.includes("--dry");
if (!eventId) { console.error("Usage: radio-encores.ts <eventId> [--dry]"); process.exit(1); }
const rows = (r: any) => r.rows ?? r;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

async function uploadBig(file: string, key: string): Promise<void> {
  const PART = 32 * 1024 * 1024;
  const size = statSync(file).size;
  const uploadId = await startMultipart(key, "video/mp4");
  const parts: { partNumber: number; etag: string }[] = [];
  const fd = openSync(file, "r");
  try {
    for (let n = 1, off = 0; off < size; n++, off += PART) {
      const len = Math.min(PART, size - off);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, off);
      // A dropped connection on one part (EPIPE, 17 Nov) is retried, not the whole file.
      let etag = "";
      for (let attempt = 1; ; attempt++) {
        try {
          const r = await fetch(signedPartUrl(key, uploadId, n), { method: "PUT", body: buf });
          if (!r.ok) throw new Error(`part ${n}: ${r.status}`);
          etag = (r.headers.get("etag") ?? "").replace(/"/g, "");
          break;
        } catch (err) {
          if (attempt >= 4) throw err;
          console.log(`  part ${n} failed (${(err as Error).message}), trying again`);
          await new Promise((res) => setTimeout(res, 3000 * attempt));
        }
      }
      parts.push({ partNumber: n, etag });
    }
    await completeMultipart(key, uploadId, parts);
  } catch (err) {
    await abortMultipart(key, uploadId).catch(() => {});
    throw err;
  } finally { closeSync(fd); }
}

const ev = await storage.getEventById(eventId);
if (!ev) throw new Error("No such event.");
const recs: { id: number; url: string; startMs: number; durMs: number }[] = rows(await db.execute(sql`select id, url, started_at, duration_sec from recordings where event_id=${eventId} and status='Ready' and url<>''`))
  .map((r: any) => ({ id: r.id, url: r.url, startMs: Date.parse(r.started_at), durMs: r.duration_sec * 1000 }));
const day = new Date(ev.startAtUtc).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).toLowerCase().replace(/\s+/g, "");
const replays: any[] = JSON.parse((await storage.getSetting("dx:replays")) || "[]");
const dir = mkdtempSync(path.join(tmpdir(), "encore-"));
let added = 0;

for (const s of (await storage.listSignups(eventId)).filter((x) => x.status !== "cancelled" && x.showFormat !== "prerecorded").sort((a, b) => a.slotIndex - b.slotIndex)) {
  const t = bookingTimes(ev, s);
  const endedRaw = await storage.getSetting(`dx:ended:${s.id}`);
  const ended = endedRaw ? Date.parse(endedRaw) : 0;
  const from = t.onAirStart, to = ended && ended < t.onAirEnd ? ended : t.onAirEnd;
  const label = `${s.podcastName} (${s.hostName})`;
  const key = `replays/radio-${day}/${s.id}-${slug(s.podcastName)}.mp4`;
  if (replays.some((r) => r.key === key)) { console.log("have   ", label); continue; }
  const rec = recs.find((r) => from >= r.startMs && to <= r.startMs + r.durMs);
  if (!rec) { console.log("MISSED ", label, "- no recording covers", new Date(from).toISOString(), "to", new Date(to).toISOString()); continue; }
  const ss = (from - rec.startMs) / 1000, dur = (to - from) / 1000;
  console.log(DRY ? "would cut" : "cutting ", label, `| recording ${rec.id} from ${Math.round(ss)}s for ${Math.round(dur)}s`);
  if (DRY) continue;
  const out = path.join(dir, `${s.id}.mp4`);
  const src = await signedRecordingUrl(rec.url, 3 * 3600);
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(ss), "-i", src, "-t", String(dur), "-vf", "scale=-2:720,drawbox=x=16:y=10:w=110:h=52:color=0x00053b:t=fill", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-movflags", "+faststart", out], { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) { console.log("  ffmpeg failed for", label); continue; }
  const probed = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString().trim());
  if (!(probed > 60)) { console.log("  too short, skipped:", probed); continue; }
  await uploadBig(out, key);
  rmSync(out, { force: true });
  replays.unshift({ key, show: s.podcastName, host: s.hostName, photo: (s as any).photoUrl ?? "", durationSec: Math.round(probed) });
  await storage.setSetting("dx:replays", JSON.stringify(replays));
  added++;
  console.log("  done", label, Math.round(probed) + "s ->", key);
}
rmSync(dir, { recursive: true, force: true });
console.log(`added ${added}; dx:replays now ${replays.length}`);
process.exit(0);
