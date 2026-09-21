// Point each pre-recorded segment at its episode.
//
//   npx tsx scripts/attach-media.ts           # dry run
//   npx tsx scripts/attach-media.ts --apply
//
// Both the scene and the agenda row get the file. The scene is what the
// producer takes and what rolls it; the row carries it because mergeRunOfShow
// leaves mediaUrl alone, so a regenerate keeps the episode attached instead of
// quietly emptying the slot the next time the schedule changes.
//
// The URL is the public studio-media route, not /api/assets/:id/file. The
// stage plays from the watch page and from the headless browser doing the
// egress composite, and neither of those is signed in.
import "dotenv/config";
import postgres from "postgres";

// The canonical host, not the apex. militaryvoice.ai 308s to www, and on show
// day the egress browser should chase one redirect to R2, not two.
const SITE = process.env.MV_SITE ?? "https://www.militaryvoice.ai";

// Matched on the episode titles, which were confirmed against each podcaster's
// own YouTube listing rather than guessed from the filenames.
// `asset` is the library id; `file` finds it by file name instead, for an
// episode uploaded a minute ago whose id nobody has looked up yet.
const PAIRS: { asset?: number; file?: RegExp; match: RegExp }[] = [
  { asset: 4, match: /developing the leader within/i },
  { asset: 5, match: /flag carry/i },
  { asset: 6, match: /today with tally/i },
  { asset: 7, match: /stillserving/i },
  { file: /montel williams/i, match: /brave blocks/i },
];

async function main() {
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
  const [ev] = await sql`SELECT id, start_at_utc, slot_minutes FROM events WHERE is_featured = true`;
  const when = (i: number) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
    .format(new Date(new Date(ev.start_at_utc).getTime() + i * ev.slot_minutes * 60000));

  const plan: { sceneId: number; rowId: number; url: string; label: string; where: string }[] = [];
  for (const p of PAIRS) {
    const [asset] = p.asset
      ? await sql`SELECT id, label FROM show_assets WHERE id = ${p.asset}`
      : await sql`SELECT id, label FROM show_assets WHERE email = 'hello@militaryvoice.ai' AND file_name ~* ${p.file!.source} ORDER BY id DESC LIMIT 1`;
    if (!asset) { console.log(`asset ${p.asset ?? p.file} missing — skipped`); continue; }
    const [sg] = await sql`SELECT id, slot_index, podcast_name FROM signups
      WHERE event_id = ${ev.id} AND status <> 'cancelled' AND podcast_name ~* ${p.match.source}`;
    if (!sg) { console.log(`no segment matching ${p.match} — skipped`); continue; }
    const [row] = await sql`SELECT id, title FROM run_of_show
      WHERE event_id = ${ev.id} AND signup_id = ${sg.id} AND kind = 'Segment'`;
    if (!row) { console.log(`no agenda row for ${sg.podcast_name} — skipped`); continue; }
    const [scene] = await sql`SELECT id, name FROM scenes WHERE run_item_id = ${row.id}`;
    if (!scene) { console.log(`no scene for ${row.title} — skipped`); continue; }
    plan.push({
      sceneId: scene.id, rowId: row.id,
      url: `${SITE}/api/studio/media/${asset.id}`,
      label: asset.label,
      where: `${when(sg.slot_index).padStart(8)}  ${sg.podcast_name}`,
    });
  }

  for (const x of plan) {
    console.log(`${x.where}`);
    console.log(`    scene #${x.sceneId} + row #${x.rowId} → ${x.label}`);
    console.log(`    ${x.url}`);
  }
  if (!process.argv.includes("--apply")) { console.log("\nDry run — pass --apply."); await sql.end(); return; }

  for (const x of plan) {
    await sql`UPDATE scenes SET kind = 'media', media_url = ${x.url}, media_kind = 'video', media_label = ${x.label} WHERE id = ${x.sceneId}`;
    await sql`UPDATE run_of_show SET media_url = ${x.url}, media_kind = 'video', media_label = ${x.label} WHERE id = ${x.rowId}`;
  }
  console.log(`\nAttached ${plan.length} episode(s).`);
  await sql.end();
}

main();
