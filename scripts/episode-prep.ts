// Getting a recorded episode ready for the day, and cutting its clips.
//
//   npx tsx scripts/episode-prep.ts --ep 6 --step audio        # fetch on the VPS, bring the audio home
//   npx tsx scripts/episode-prep.ts --ep 6 --step transcribe   # words with timings (ElevenLabs Scribe)
//   npx tsx scripts/episode-prep.ts --ep 6 --step plan         # the out-point and the four moments (Claude)
//   npx tsx scripts/episode-prep.ts --ep 6 --step render       # the broadcast cut and the clips (VPS ffmpeg)
//   npx tsx scripts/episode-prep.ts --ep 6 --step publish      # into the library, onto the run of show
//   npx tsx scripts/episode-prep.ts --ep 6 --step all
//
// The heavy files never come home: the VPS pulls each episode from R2 by a
// signed link, renders there (ffmpeg with libass, so captions animate), and
// pushes results back to R2 by another signed link. Only the audio, the
// transcript and the finished clips travel. Secrets stay on this machine.
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import postgres from "postgres";
import Anthropic from "@anthropic-ai/sdk";
import { signedRecordingUrl, signedRecordingUpload } from "../server/recordingStorage";
import { pickMoments } from "../agent/clipper";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : ""; };
const EP = Number(flag("--ep"));
const STEP = flag("--step") || "all";
const HOST = process.env.MV_VPS ?? "root@187.77.217.123";
const API = "https://www.militaryvoice.ai";
const REMOTE = "/root/mv-prep";
const HOME = path.resolve(process.env.PREP_DIR || "/private/tmp/claude-501/-Users-andrewappleton-projects-militaryvoice/eecaf43c-79db-4803-a64b-76693c5cd63b/scratchpad/prep", `ep${EP}`);
const ON_AIR = 25 * 60;

/** Each episode and what we do to it: fade at a break, or speed it to fit. */
const PLANS: Record<number, { mode: "fade" | "speed"; speed?: number }> = {
  10: { mode: "speed", speed: 1.01 }, // WARRIOR Legacy Network 25:05
  9: { mode: "speed", speed: 1.31 },  // Developing The Leader Within 32:32
  7: { mode: "fade" },                // VFW 1:17:18
  6: { mode: "fade" },                // Today with Tally 54:58
  8: { mode: "speed", speed: 1.30 },  // Brave Blocks 34:48 → 26:46, then a fade at a break
  5: { mode: "speed", speed: 1.30 },  // Devil Dawg 34:28 → 26:31, then a fade at a break
};

type Word = { text: string; start: number; end: number; speaker: string };
type Line = { speaker: string; text: string; startSec: number; endSec: number };

const sh = (cmd: string, opts: { quiet?: boolean } = {}) => {
  const r = spawnSync("ssh", ["-o", "BatchMode=yes", HOST, cmd], { encoding: "utf8", stdio: opts.quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"], maxBuffer: 64 * 1048576 });
  if (r.status !== 0) throw new Error(`ssh failed: ${cmd.slice(0, 120)}\n${r.stderr ?? ""}`);
  return r.stdout ?? "";
};
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

async function main() {
  if (!EP || !PLANS[EP]) throw new Error("Which episode? --ep 5|6|7|8|9|10");
  await fs.mkdir(HOME, { recursive: true });
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });
  const [asset] = await sql`SELECT id, storage_key, label, file_name, duration_seconds FROM show_assets WHERE id = ${EP}`;
  // Once published, the segment rolls the cut rather than this file; the
  // published note remembers which cut, so later steps still find the slot.
  let cutId = 0;
  try { cutId = Number(JSON.parse(await fs.readFile(path.join(HOME, "published.json"), "utf8")).cutAssetId) || 0; } catch { /* not published yet */ }
  const [item] = await sql`SELECT r.id, r.signup_id, r.title, r.notes, s.podcast_name, s.host_name, s.slot_index FROM run_of_show r JOIN signups s ON s.id = r.signup_id WHERE r.kind = 'Segment' AND (r.media_url = ${`${API}/api/studio/media/${EP}`} OR r.media_url = ${`${API}/api/studio/media/${cutId}`})`;
  if (!asset || !item) throw new Error("That file isn't on a segment.");
  const plan = PLANS[EP];
  const show = String(item.podcast_name).trim() || String(item.host_name);
  console.log(`\n${show} — ${item.host_name}  ·  file runs ${mmss(asset.duration_seconds)}  ·  plan: ${plan.mode}${plan.speed ? ` ×${plan.speed}` : ""}`);
  const steps = STEP === "all" ? ["audio", "transcribe", "plan", "render", "publish"] : STEP === "render" ? ["cut", "clips", "fetch"] : STEP === "clips" ? ["clips", "fetch"] : [STEP];
  // publish-clips: the clip files alone, after a re-render; the cut stays as published.

  // ---- audio: the VPS fetches the episode; the audio comes home small ----
  if (steps.includes("audio")) {
    const url = await signedRecordingUrl(asset.storage_key, 6 * 3600);
    sh(`mkdir -p ${REMOTE} && cd ${REMOTE} && ([ -s ep${EP}.mp4 ] || curl -sL --fail -o ep${EP}.mp4 ${JSON.stringify(url)}) && ([ -s ep${EP}.mp3 ] || ffmpeg -v error -y -i ep${EP}.mp4 -ac 1 -ar 16000 -b:a 48k -vn ep${EP}.mp3) && ls -la ep${EP}.mp4 ep${EP}.mp3`);
    const r = spawnSync("scp", ["-o", "BatchMode=yes", `${HOST}:${REMOTE}/ep${EP}.mp3`, path.join(HOME, "audio.mp3")], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("scp failed");
    console.log("  audio home");
  }

  // ---- transcribe: words with timings ----
  const wordsFile = path.join(HOME, "words.json");
  if (steps.includes("transcribe")) {
    const key = (process.env.ELEVENLABS_API_KEY || "").trim();
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(await fs.readFile(path.join(HOME, "audio.mp3")))], { type: "audio/mpeg" }), "audio.mp3");
    form.append("model_id", "scribe_v1");
    form.append("diarize", "true");
    form.append("timestamps_granularity", "word");
    console.log("  Scribe…");
    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body: form });
    if (!res.ok) throw new Error(`Scribe ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { words?: { text: string; start: number; end: number; type: string; speaker_id?: string }[] };
    const words: Word[] = (body.words ?? []).filter((w) => w.type === "word").map((w) => ({ text: w.text, start: w.start, end: w.end, speaker: w.speaker_id ?? "" }));
    await fs.writeFile(wordsFile, JSON.stringify(words));
    console.log(`  ${words.length} words, ${mmss(words[words.length - 1]?.end ?? 0)}`);
  }

  // ---- plan: the out-point and the moments ----
  const planFile = path.join(HOME, "plan.json");
  if (steps.includes("plan")) {
    const words: Word[] = JSON.parse(await fs.readFile(wordsFile, "utf8"));
    const lines = toLines(words);
    const S = plan.mode === "speed" ? plan.speed! : 1;
    const fits = asset.duration_seconds / S <= ON_AIR;
    let outSec = 0; let outReason = "";
    if (!fits) {
      // The window in the file's own time where the cut has to land: it must
      // play out by 24:50 on air, and it should not come before 22:30.
      const w0 = (22 * 60 + 30) * S, w1 = (24 * 60 + 50) * S;
      const cands = lines.filter((l) => l.endSec >= w0 && l.endSec <= w1);
      const client = new Anthropic();
      const msg = await client.messages.create({
        model: "claude-sonnet-5", max_tokens: 300,
        messages: [{ role: "user", content: `A recorded podcast episode has to fade out for broadcast. Below are the transcript lines in the window where the fade can land, each with the second it ENDS. Pick the line whose end is the most natural place to fade: the end of a complete thought or story, ideally followed by a pause, and never mid-answer. Prefer later in the window if the thought is complete. Reply with JSON only: {"endSec": <number>, "reason": "<one sentence>"}\n\n${cands.map((l) => `[ends ${l.endSec.toFixed(1)}] ${l.speaker}: ${l.text}`).join("\n")}` }],
      });
      const text = msg.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
      const braces = text.match(/\{[\s\S]*\}/);
      if (!braces) throw new Error(`No out-point in the answer: ${text.slice(0, 200)}`);
      const j = JSON.parse(braces[0]);
      outSec = Number(j.endSec) + 0.6; outReason = String(j.reason ?? "");
      console.log(`  fade at ${mmss(outSec)} in the file (${mmss(outSec / S)} on air): ${outReason}`);
    } else {
      console.log(`  fits: ${mmss(asset.duration_seconds / S)} on air, no fade needed`);
    }
    const moments = await pickMoments({ recordingId: 0, title: show, durationSec: asset.duration_seconds, downloadUrl: "", show, host: String(item.host_name), transcript: lines } as any, lines as any);
    for (const m of moments) console.log(`  clip ${mmss(m.startSec)}–${mmss(m.endSec)}  "${m.title}"`);
    await fs.writeFile(planFile, JSON.stringify({ mode: plan.mode, speed: S, outSec, outReason, moments }, null, 2));
  }

  // ---- render: on the VPS ----
  if (steps.includes("cut")) {
    const p = JSON.parse(await fs.readFile(planFile, "utf8")) as { speed: number; outSec: number; moments: { title: string; caption: string; startSec: number; endSec: number }[] };
    const S = p.speed;
    // The broadcast cut.
    const outAir = p.outSec ? Math.min(ON_AIR, p.outSec / S) : 0;
    const fadeV = outAir ? `,fade=t=out:st=${(outAir - 2.5).toFixed(2)}:d=2.5` : "";
    const fadeA = outAir ? `,afade=t=out:st=${(outAir - 2.5).toFixed(2)}:d=2.5` : "";
    const vf = `[0:v]${S !== 1 ? `setpts=PTS/${S}` : "null"}${fadeV}[v]`;
    const af = `[0:a]${S !== 1 ? `atempo=${S}` : "anull"}${fadeA}[a]`;
    const cut = `ep${EP}-broadcast.mp4`;
    console.log(`  rendering the broadcast cut${outAir ? ` (fade at ${mmss(outAir)})` : ""}${S !== 1 ? ` at ×${S}` : ""}…`);
    sh(`cd ${REMOTE} && ffmpeg -v error -y -i ep${EP}.mp4 -filter_complex "${vf};${af}" -map "[v]" -map "[a]" ${outAir ? `-t ${outAir.toFixed(2)}` : ""} -c:v libx264 -preset veryfast -crf 21 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart ${cut} && ffprobe -v error -show_entries format=duration -of csv=p=0 ${cut}`);
  }
  if (steps.includes("clips")) {
    const p = JSON.parse(await fs.readFile(planFile, "utf8")) as { moments: { title: string; caption: string; startSec: number; endSec: number }[] };
    const words: Word[] = JSON.parse(await fs.readFile(wordsFile, "utf8"));
    await renderClips(p, words);
  }
  if (steps.includes("fetch")) {
    // The clips come home for a look; the cut stays where it is.
    spawnSync("bash", ["-lc", `scp -o BatchMode=yes "${HOST}:${REMOTE}/ep${EP}-clip*.mp4" "${HOME}/"`], { stdio: "inherit" });
  }

  // ---- publish: the cut onto the run of show, everything into the library ----
  if (steps.includes("publish") || steps.includes("publish-clips")) {
    const clipsOnly = !steps.includes("publish");
    const p = JSON.parse(await fs.readFile(planFile, "utf8")) as { speed: number; outSec: number; moments: { title: string; caption: string; startSec: number; endSec: number }[] };
    const [ev] = await sql`SELECT admin_password FROM events WHERE id = 1`;
    const register = async (remoteName: string, label: string, fileName: string) => {
      const key = `studio/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80)}`;
      const url = signedRecordingUpload(key, 6 * 3600);
      const dur = Math.round(Number(sh(`cd ${REMOTE} && ffprobe -v error -show_entries format=duration -of csv=p=0 ${remoteName}`, { quiet: true }).trim()) || 0);
      const size = Number(sh(`stat -c %s ${REMOTE}/${remoteName}`, { quiet: true }).trim());
      const code = sh(`cd ${REMOTE} && curl --fail-with-body --retry 5 --retry-all-errors -s -o /dev/null -w '%{http_code}' -X PUT -H 'content-type: video/mp4' --upload-file ${remoteName} ${JSON.stringify(url)}`, { quiet: true }).trim().slice(-3);
      if (code !== "200") throw new Error(`upload ${remoteName} → ${code}`);
      const reg = await fetch(`${API}/api/admin/media`, { method: "POST", headers: { "content-type": "application/json", "x-admin-password": ev.admin_password }, body: JSON.stringify({ storageKey: key, fileName, sizeBytes: size, kind: "Other", label, durationSeconds: dur }) });
      const body = (await reg.json()) as { id?: number; message?: string };
      if (!reg.ok || !body.id) throw new Error(`register ${label}: ${body.message}`);
      console.log(`  library #${body.id}  ${label}  ${mmss(dur)}`);
      return { id: body.id, dur };
    };
    const now = new Date().toISOString();
    let cutAssetId = cutId;
    if (!clipsOnly) {
      const cutLabel = `${asset.label} (broadcast cut${p.speed !== 1 ? `, ×${p.speed}` : ""}${p.outSec ? `, fades at ${mmss(Math.min(ON_AIR, p.outSec / p.speed))}` : ""})`;
      const cut = await register(`ep${EP}-broadcast.mp4`, cutLabel, `${asset.file_name.replace(/\.mp4$/i, "")} - broadcast cut.mp4`);
      cutAssetId = cut.id;
      const note = `Broadcast cut rolls on air (${mmss(cut.dur)}). Full episode for the replay: library #${EP}.`;
      await sql`UPDATE run_of_show SET media_url = ${`${API}/api/studio/media/${cut.id}`}, media_label = ${cutLabel}, notes = ${[String(item.notes || "").trim(), note].filter(Boolean).join("\n")} WHERE id = ${item.id}`;
      await sql`UPDATE scenes SET media_url = ${`${API}/api/studio/media/${cut.id}`}, media_label = ${cutLabel} WHERE run_item_id = ${item.id} AND media_url = ${`${API}/api/studio/media/${EP}`}`;
      console.log("  run of show and scene now roll the cut");
    }
    // A re-render replaces the clips in the library rather than adding to them.
    await sql`DELETE FROM show_assets WHERE email = 'hello@militaryvoice.ai' AND label LIKE ${`Clip · ${show} · %`}`;
    const clipIds: Record<string, number> = {};
    for (let i = 0; i < p.moments.length; i++) {
      const m = p.moments[i];
      for (const shape of ["vertical", "square", "wide"] as const) {
        const r = await register(`ep${EP}-clip${i + 1}-${shape}.mp4`, `Clip · ${show} · ${m.title} (${shape})`, `${show} - clip ${i + 1} - ${shape}.mp4`);
        clipIds[`clip${i + 1}-${shape}`] = r.id;
      }
    }
    await fs.writeFile(path.join(HOME, "published.json"), JSON.stringify({ cutAssetId, clipIds, at: now }));
    await attachClips(p.moments, clipIds);
  }
  if (steps.includes("attach")) {
    const p = JSON.parse(await fs.readFile(planFile, "utf8")) as { moments: { title: string; caption: string; reason?: string; startSec: number; endSec: number }[] };
    const pub = JSON.parse(await fs.readFile(path.join(HOME, "published.json"), "utf8")) as { clipIds: Record<string, number> };
    await attachClips(p.moments, pub.clipIds);
  }
  await sql.end();

  /**
   * The clips belong to the podcaster: a row each in their Recordings & clips,
   * the three shapes on it. The files stay where they are, marked as clips so
   * the studio's media picker leaves them out. They are posts, not scenes.
   */
  async function attachClips(moments: { title: string; caption: string; reason?: string; startSec: number; endSec: number }[], clipIds: Record<string, number>) {
    const [sg] = await sql`SELECT id, email, event_id FROM signups WHERE id = ${item.signup_id}`;
    const media = (id?: number) => (id ? `${API}/api/studio/media/${id}` : "");
    await sql`UPDATE show_assets SET kind = 'Clip' WHERE id = ANY(${Object.values(clipIds)})`;
    await sql`DELETE FROM clips WHERE signup_id = ${sg.id} AND recording_id = 0`;
    const now = new Date().toISOString();
    for (let i = 0; i < moments.length; i++) {
      const m = moments[i];
      await sql`INSERT INTO clips (recording_id, event_id, signup_id, email, title, caption, reason, start_sec, end_sec, url, vertical_url, square_url, created_at)
        VALUES (0, ${sg.event_id}, ${sg.id}, ${String(sg.email).trim().toLowerCase()}, ${m.title}, ${m.caption ?? ""}, ${m.reason ?? ""}, ${Math.floor(m.startSec)}, ${Math.ceil(m.endSec)},
                ${media(clipIds[`clip${i + 1}-wide`])}, ${media(clipIds[`clip${i + 1}-vertical`])}, ${media(clipIds[`clip${i + 1}-square`])}, ${now})`;
    }
    console.log(`  ${moments.length} clips on ${sg.email}'s dashboard`);
  }
}

type Focus = { frame: [number, number]; panels: { cx: number; cy: number; faceW: number; faceH: number }[]; speakers: Record<string, number>; timeline: { start: number; end: number; panel: number }[]; stacked: boolean };

/**
 * The clips, framed on the people. The focus script on the VPS finds the
 * faces and who talks from where; its JSON comes home beside the clip, and
 * an edited copy there wins on the next render. That is the post edit.
 *
 * Vertical: two people stacked, both always in shot. One person: a tall
 * crop on them. Square: the active speaker, cut to as they talk. Wide: as shot.
 */
async function renderClips(p: { moments: { title: string; caption: string; startSec: number; endSec: number }[] }, words: Word[]) {
  spawnSync("scp", ["-o", "BatchMode=yes", path.join(HOME, "words.json"), `${HOST}:${REMOTE}/ep${EP}-words.json`], { stdio: "ignore" });
  for (let i = 0; i < p.moments.length; i++) {
    const m = p.moments[i];
    const focusName = `ep${EP}-clip${i + 1}-focus.json`;
    const localFocus = path.join(HOME, focusName);
    let focus: Focus;
    try {
      focus = JSON.parse(await fs.readFile(localFocus, "utf8"));
      spawnSync("scp", ["-o", "BatchMode=yes", localFocus, `${HOST}:${REMOTE}/${focusName}`], { stdio: "ignore" });
      console.log(`  clip ${i + 1}: using the focus on file`);
    } catch {
      const out = sh(`cd ${REMOTE} && python3 focus.py ep${EP}.mp4 ${m.startSec} ${m.endSec} ep${EP}-words.json ${focusName}`, { quiet: true });
      spawnSync("scp", ["-o", "BatchMode=yes", `${HOST}:${REMOTE}/${focusName}`, localFocus], { stdio: "ignore" });
      focus = JSON.parse(await fs.readFile(localFocus, "utf8"));
      console.log(`  clip ${i + 1}: ${out.trim()}`);
    }
    const [FW, FH] = focus.frame;
    const clampX = (cx: number, w: number) => Math.round(Math.min(Math.max(0, cx - w / 2), FW - w));
    const clampY = (cy: number, h: number) => Math.round(Math.min(Math.max(0, cy - h * 0.42), FH - h));
    // Tight on the person: head and shoulders, not the show's own frame
    // around them. The crop's height is a multiple of the face, so a small
    // face in a wide two-up gets pulled in rather than shown from across the room.
    const box = (pn: { cx: number; cy: number; faceH: number }, aspect: number, faces: number) => {
      let h = Math.min(FH, Math.round(pn.faceH * faces)); let w = Math.round(h * aspect);
      if (w > FW) { w = FW; h = Math.round(w / aspect); }
      return { w, h, x: clampX(pn.cx, w), y: clampY(pn.cy, h) };
    };
    const inRange = words.filter((w) => w.start >= m.startSec && w.end <= m.endSec + 0.3);
    for (const shape of ["vertical", "square", "wide"] as const) {
      const [W, H] = shape === "wide" ? [1920, 1080] : shape === "vertical" ? [1080, 1920] : [1080, 1080];
      const stacked = shape === "vertical" && focus.stacked && focus.panels.length >= 2;
      const ass = karaokeAss(inRange, m.startSec, m.title, W, H, shape, stacked);
      const assName = `ep${EP}-clip${i + 1}-${shape}.ass`;
      await fs.writeFile(path.join(HOME, assName), ass);
      spawnSync("scp", ["-o", "BatchMode=yes", path.join(HOME, assName), `${HOST}:${REMOTE}/${assName}`], { stdio: "ignore" });
      let graph: string;
      if (shape === "wide") {
        graph = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,subtitles=${assName}:fontsdir=/usr/share/fonts[v]`;
      } else if (stacked) {
        const [a, b] = focus.panels;
        const A = box(a, 1080 / 960, 2.9), B = box(b, 1080 / 960, 2.9);
        graph = `[0:v]split[a][b];[a]crop=${A.w}:${A.h}:${A.x}:${A.y},scale=1080:960[t];[b]crop=${B.w}:${B.h}:${B.x}:${B.y},scale=1080:960[u];[t][u]vstack,subtitles=${assName}:fontsdir=/usr/share/fonts[v]`;
      } else {
        // A crop that follows the speaker: one segment per cut, joined.
        const segs = focus.timeline.length ? focus.timeline : [{ start: 0, end: m.endSec - m.startSec, panel: 0 }];
        const parts = segs.map((sg, k) => { const pn = focus.panels[Math.min(sg.panel, focus.panels.length - 1)]; const c = box(pn, W / H, shape === "square" ? 3.1 : 5.2); return `[s${k}]trim=start=${sg.start}:end=${sg.end},setpts=PTS-STARTPTS,crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${W}:${H}[v${k}]`; });
        graph = `[0:v]split=${segs.length}${segs.map((_, k) => `[s${k}]`).join("")};${parts.join(";")};${segs.map((_, k) => `[v${k}]`).join("")}concat=n=${segs.length}:v=1:a=0[vc];[vc]subtitles=${assName}:fontsdir=/usr/share/fonts[v]`;
      }
      const out = `ep${EP}-clip${i + 1}-${shape}.mp4`;
      sh(`cd ${REMOTE} && ffmpeg -v error -y -ss ${m.startSec} -to ${m.endSec} -i ep${EP}.mp4 -filter_complex "${graph}" -map "[v]" -map 0:a -c:v libx264 -preset veryfast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart ${out}`);
      console.log(`  clip ${i + 1} ${shape}${stacked ? " (stacked)" : shape === "square" ? ` (${focus.timeline.length} cuts)` : ""}`);
    }
  }
}

/** Words into spoken lines: a new line at a pause over 0.8s, a speaker change, or twelve words. */
function toLines(words: Word[]): Line[] {
  const out: Line[] = [];
  let cur: Word[] = [];
  const flush = () => { if (cur.length) { out.push({ speaker: cur[0].speaker, text: cur.map((w) => w.text).join(" ").replace(/\s+([,.?!])/g, "$1"), startSec: cur[0].start, endSec: cur[cur.length - 1].end }); cur = []; } };
  for (const w of words) {
    const last = cur[cur.length - 1];
    if (last && (w.start - last.end > 0.8 || w.speaker !== last.speaker || cur.length >= 12 || /[.?!]$/.test(last.text))) flush();
    cur.push(w);
  }
  flush();
  return out;
}

/**
 * Captions that light up word by word: three words to a line, the spoken
 * word turning gold as it is said (ASS karaoke, \\k in centiseconds), the
 * title across the top for the tall and square shapes.
 */
function karaokeAss(words: Word[], offset: number, title: string, W: number, H: number, shape: "vertical" | "square" | "wide", stacked = false): string {
  const size = shape === "wide" ? 64 : shape === "vertical" ? 78 : 66;
  const marginV = shape === "wide" ? 90 : shape === "vertical" ? (stacked ? 900 : 300) : 110;
  const esc = (t: string) => t.replace(/[{}\\]/g, "").replace(/\n/g, " ");
  const ts = (s: number) => { const cs = Math.max(0, Math.round(s * 100)); const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), sec = Math.floor((cs % 6000) / 100), c = cs % 100; return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(c).padStart(2, "0")}`; };
  const groups: Word[][] = [];
  for (let i = 0; i < words.length; i += 3) groups.push(words.slice(i, i + 3));
  const lines: string[] = [];
  groups.forEach((g, gi) => {
    const start = g[0].start - offset;
    const next = groups[gi + 1]?.[0].start;
    const end = (next != null ? Math.min(next, g[g.length - 1].end + 1.2) : g[g.length - 1].end + 1.2) - offset;
    let t = g[0].start;
    const parts = g.map((w) => { const lead = Math.max(0, Math.round((w.start - t) * 100)); const dur = Math.max(8, Math.round((w.end - w.start) * 100)); t = w.end; return `${lead ? `{\\k${lead}}` : ""}{\\k${dur}}${esc(w.text.toUpperCase())}`; });
    lines.push(`Dialogue: 0,${ts(start)},${ts(end)},Words,,0,0,0,,${parts.join(" ")}`);
  });
  const titleLine = shape !== "wide" && title ? `Dialogue: 0,${ts(0)},${ts(9999)},Title,,0,0,0,,${esc(title)}` : "";
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Words,DejaVu Sans,${size},&H001FA7F0,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,4,2,2,60,60,${marginV},1
Style: Title,DejaVu Sans,${shape === "vertical" ? 54 : 46},&H00FFFFFF,&H00FFFFFF,&H002B1004,&H00000000,-1,0,0,0,100,100,0,0,3,0,0,8,60,60,${shape === "vertical" ? 60 : 40},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${titleLine}
${lines.join("\n")}
`;
}

main().catch((e) => { console.error(e); process.exit(1); });
