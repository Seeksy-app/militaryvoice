// Rebuild the pre-event standby clip that plays on the watch page.
//
//   npx tsx scripts/build-standby.ts            # writes to /tmp, prints the path
//   npx tsx scripts/build-standby.ts --upload   # also puts it on the studio
//
// Three things it does that the hand-made clip didn't:
//
//   1. **Everybody appears.** One panel fits nine faces legibly at the size a
//      phone renders this; the lineup is bigger than that, so the clip cycles
//      through as many panels as it takes and nobody is left in a "+6 more".
//   2. **It has a bed.** Silence on a standby card reads as a broken stream —
//      people check their own volume before they believe the show hasn't
//      started. See MUSIC below for what this is and what it isn't.
//   3. **It regenerates.** The old clip was a one-off, so every host who
//      joined after it was made was invisible until someone rebuilt it by
//      hand. Run this again and the lineup is current.
//
// Type is drawn as outlines via textPath for the same reason the share cards
// do it: ffmpeg here has no freetype, so drawtext is not available.

import "dotenv/config";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import postgres from "postgres";
import sharp from "sharp";
import { fitSize, textPath, textWidth } from "../server/textPath.js";

const run = promisify(execFile);
const W = 1920;
const H = 1080;
const PER_PANEL = 9;
// Three bars of the bed per panel, so the loop point lands on a downbeat
// instead of halfway through a chord. See scripts/jazz-bed.ts for the tempo.
const BAR_SECONDS = (60 / 92) * 4;
const PANEL_SECONDS = BAR_SECONDS * 3;
const FADE = 1.2;
const NAVY = "#000741";
const GOLD = "#F0A71F";

const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "standby-"));

// ---------------------------------------------------------------------------
// The lineup
// ---------------------------------------------------------------------------
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const [event] = await sql`SELECT * FROM events WHERE is_featured = true LIMIT 1`;
const shows = await sql`
  SELECT podcast_name, host_name, photo_url, slot_index
  FROM signups WHERE event_id = ${event.id} AND status <> 'cancelled'
  ORDER BY slot_index`;
await sql.end();

const dateLabel = new Intl.DateTimeFormat("en-US", {
  month: "long", day: "numeric", timeZone: "America/New_York",
}).format(new Date(event.start_at_utc)).toUpperCase();

console.log(`${shows.length} shows → ${Math.ceil(shows.length / PER_PANEL)} panels`);

// ---------------------------------------------------------------------------
// Artwork
// ---------------------------------------------------------------------------
async function circle(url: string, size: number): Promise<Buffer | null> {
  try {
    const src = /^https?:/.test(url)
      ? Buffer.from(await (await fetch(url)).arrayBuffer())
      : await fs.readFile(path.join("client/public", url.replace(/^\//, "")));
    const mask = Buffer.from(
      `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
    );
    return await sharp(src)
      .resize(size, size, { fit: "cover", position: "attention" })
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * Break a show name over at most two lines that fit the cell.
 *
 * One line and an ellipsis turned half the lineup into "Devil Dawg Double
 * Dar…", which is worse than useless on a card whose whole job is telling
 * people who is on. Two lines fit every name in the current lineup outright.
 */
function wrapName(v: string, maxWidth: number, size: number): string[] {
  const words = (v ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let cur = words[0];
  for (const w of words.slice(1)) {
    const next = `${cur} ${w}`;
    if (textWidth(next, size, "bold") <= maxWidth) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  lines.push(cur);
  if (lines.length <= 2) return lines;
  // Three-plus lines means the type is too big for the cell; fold the tail
  // into the second line and let the caller's smaller size absorb it.
  return [lines[0], lines.slice(1).join(" ")];
}

const bg = await sharp("client/public/hero-3.jpg")
  .resize(W, H, { fit: "cover", position: "attention" })
  .modulate({ brightness: 0.42, saturation: 0.75 })
  .blur(6)
  .toBuffer();

const logo = await sharp("client/public/nmpd-logo.jpg").resize(150, 150).png().toBuffer();
const logoMask = Buffer.from(`<svg width="150" height="150"><circle cx="75" cy="75" r="75" fill="#fff"/></svg>`);
const logoRound = await sharp(logo).composite([{ input: logoMask, blend: "dest-in" }]).png().toBuffer();

async function buildPanel(group: typeof shows, index: number, total: number): Promise<string> {
  // Every vertical position is fixed rather than centred on the row count, so
  // a panel holding four faces and one holding nine put the title, the rule
  // and the grid in exactly the same place — otherwise the cross-dissolve
  // between them reads as the whole card jumping.
  const AV = 168;
  const cols = Math.min(group.length, 5);
  const gapX = 74;
  const gapY = 78;
  const cellW = AV + gapX;
  const gridW = cols * cellW - gapX;
  const ROW1 = 586;

  const layers: sharp.OverlayOptions[] = [{ input: logoRound, top: 48, left: Math.round(W / 2 - 75) }];
  const svg: string[] = [];

  svg.push(textPath(`TUNE IN ${dateLabel}`, { x: W / 2, y: 296, size: 94, weight: "bold", fill: "#ffffff", anchor: "middle" }));
  svg.push(textPath("26.2 MILES OF STORIES · MILITARYVOICE.AI", {
    x: W / 2, y: 352, size: 25, weight: "bold", fill: GOLD, anchor: "middle", letterSpacing: 4,
  }));
  svg.push(textPath("ON THE LINEUP", {
    x: W / 2, y: 430, size: 21, weight: "bold", fill: "#ffffffaa", anchor: "middle", letterSpacing: 7,
  }));
  svg.push(`<rect x="${W / 2 - 34}" y="446" width="68" height="3" fill="${GOLD}"/>`);

  for (let i = 0; i < group.length; i++) {
    const s = group[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    // A short final row centres itself under the full one above it.
    const inRow = Math.min(cols, group.length - row * cols);
    const rowW = inRow * cellW - gapX;
    const cx = Math.round(W / 2 - rowW / 2 + col * cellW + AV / 2);
    const cy = Math.round(ROW1 + row * (AV + gapY));

    const av = s.photo_url ? await circle(String(s.photo_url), AV) : null;
    if (av) layers.push({ input: av, top: cy - AV / 2, left: cx - AV / 2 });
    svg.push(
      `<circle cx="${cx}" cy="${cy}" r="${AV / 2 + 5}" fill="${av ? "none" : "#ffffff14"}" stroke="${GOLD}" stroke-width="4" opacity="0.9"/>`,
    );

    // The name is the whole point of showing the face, so it wraps to a second
    // line rather than being cut off at the cell edge.
    const boxW = cellW - 6;
    const name = String(s.podcast_name).trim();
    const size = fitSize(name, "bold", 24, 16, boxW * 2);
    const lines = wrapName(name, boxW, size);
    lines.forEach((line, li) => {
      svg.push(textPath(line, {
        x: cx, y: cy + AV / 2 + 36 + li * (size + 4), size, weight: "bold", fill: "#ffffff", anchor: "middle",
      }));
    });
  }

  // "Panel 2 of 3" as dots, so a viewer knows more faces are coming rather
  // than assuming the lineup is nine shows long.
  if (total > 1) {
    for (let d = 0; d < total; d++) {
      const x = W / 2 - (total - 1) * 11 + d * 22;
      svg.push(`<circle cx="${x}" cy="${H - 52}" r="5" fill="${d === index ? GOLD : "#ffffff45"}"/>`);
    }
  }

  const overlay = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
       <rect width="${W}" height="${H}" fill="${NAVY}" opacity="0.55"/>
       ${svg.join("\n")}
     </svg>`,
  );

  const file = path.join(outDir, `panel-${index}.png`);
  await sharp(bg).composite([{ input: overlay }, ...layers]).png().toFile(file);
  return file;
}

const groups: (typeof shows)[] = [];
for (let i = 0; i < shows.length; i += PER_PANEL) groups.push(shows.slice(i, i + PER_PANEL));
const panels: string[] = [];
for (let i = 0; i < groups.length; i++) panels.push(await buildPanel(groups[i], i, groups.length));
console.log(`panels: ${panels.map((p) => path.basename(p)).join(", ")}`);

// ---------------------------------------------------------------------------
// MUSIC
//
// This is a synthesised bed, not a track: three sine partials a fifth and an
// octave apart, slow tremolo, quiet. It exists so the card is not silent,
// because silence on a standby frame makes people check their own volume and
// then leave. It is deliberately plain, and it is not a substitute for a
// licensed cue — drop one in with --music <file> and it is used instead.
// ---------------------------------------------------------------------------
const musicArg = process.argv.indexOf("--music");
const musicFile = musicArg > -1 ? process.argv[musicArg + 1] : "";

const totalSeconds = panels.length * PANEL_SECONDS;

// Stacked sine waves with a tremolo on them is a hum, not music, which is
// what the first version of this was. The bed is now generated as actual
// audio — a ii–V–I–vi turnaround with a walking bass and brushes — by
// scripts/jazz-bed.ts. Still a stand-in for a licensed cue, which --music
// takes instead and should carry on the day.
let audio: string[];
if (musicFile) {
  audio = ["-stream_loop", "-1", "-i", musicFile];
} else {
  const { renderJazz } = await import("./jazz-bed.js");
  const bedPath = path.join(outDir, "bed.wav");
  await fs.writeFile(bedPath, renderJazz(panels.length * PANEL_SECONDS + 1));
  audio = ["-i", bedPath];
}

// Each panel holds, then cross-dissolves into the next; the last dissolves
// back to the first so the loop has no seam.
const inputs: string[] = [];
for (const p of panels) inputs.push("-loop", "1", "-t", String(PANEL_SECONDS + FADE), "-i", p);

let filter = "";
const n = panels.length;
for (let i = 0; i < n; i++) filter += `[${i}:v]scale=${W}:${H},setsar=1,fps=30[v${i}];`;
if (n === 1) {
  filter += `[v0]null[vout];`;
} else {
  let prev = "v0";
  for (let i = 1; i < n; i++) {
    const out = i === n - 1 ? "vout" : `x${i}`;
    filter += `[${prev}][v${i}]xfade=transition=fade:duration=${FADE}:offset=${i * PANEL_SECONDS - FADE}[${out}];`;
    prev = out;
  }
}

const out = path.join(outDir, "tunein.mp4");
const args = [
  "-y",
  ...inputs,
  ...audio,
  "-filter_complex", filter.replace(/;$/, ""),
  "-map", "[vout]",
  "-map", `${n}:a`,
  "-t", String(totalSeconds),
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "21",
  "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
  // Normalise whatever the bed is — generated or supplied — so a licensed cue
  // dropped in with --music does not arrive twice as loud as the stand-in.
  "-af", `loudnorm=I=-23:TP=-3:LRA=9,afade=t=in:st=0:d=1.2,afade=t=out:st=${Math.max(0, totalSeconds - 1.5)}:d=1.5`,
  "-movflags", "+faststart",
  out,
];

await run("ffmpeg", args, { maxBuffer: 1 << 26 });
const { size } = await fs.stat(out);
console.log(`\n${out}  (${(size / 1e6).toFixed(1)} MB, ${totalSeconds}s, ${panels.length} panels)`);

// --upload puts it on the studio that already carries a pre-event card.
//
// Only the row is written, and that is enough: a LiveKit room exists only
// while somebody is in it, so before the event there is no room metadata to
// push — /api/watch/token seeds it from this row on every request.
if (process.argv.includes("--upload")) {
  const { uploadShowAsset } = await import("../server/photoStorage.js");
  const crypto = await import("node:crypto");

  const key = `standby/${Date.now()}-${crypto.randomBytes(6).toString("hex")}-tunein-lineup.mp4`;
  const url = await uploadShowAsset(key, await fs.readFile(out), "video/mp4");

  const db = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
  const [target] = await db`
    SELECT id FROM studios WHERE event_id = ${event.id} AND pre_video_url <> '' ORDER BY id LIMIT 1`;
  if (!target) throw new Error("No studio with a pre-event card to replace.");
  await db`UPDATE studios SET pre_video_url = ${url}, pre_label = ${"Tune in October 5"} WHERE id = ${target.id}`;

  // Record what went into it. The clip is a rendered file, so it cannot know
  // that a nineteenth host signed up an hour later — and a standby card that
  // silently leaves people out is exactly the failure the last one had, where
  // six hosts sat behind "+6 more" for weeks. Admin compares this against the
  // live lineup and says when it has gone stale.
  const stamp = JSON.stringify({
    shows: shows.length,
    builtAt: new Date().toISOString(),
    music: musicFile ? path.basename(musicFile) : "generated bed",
    url,
  });
  await db`
    INSERT INTO site_settings (key, value) VALUES ('standbyBuild', ${stamp})
    ON CONFLICT (key) DO UPDATE SET value = ${stamp}`;
  await db.end();
  console.log(`uploaded → studio #${target.id}  (${shows.length} shows, ${musicFile ? path.basename(musicFile) : "generated bed"})\n${url}`);
}
process.exit(0);
