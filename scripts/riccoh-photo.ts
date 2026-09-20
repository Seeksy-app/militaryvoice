// One photo of Riccoh on both ceremony cards.
//
//   npx tsx scripts/riccoh-photo.ts           # dry run
//   npx tsx scripts/riccoh-photo.ts --apply
//
// The opening carried /riccoh-host.jpg and the closing carried his podcast
// logo, so the day opened on his face and closed on a cartoon bulldog. Both
// now point at the same headshot.
import "dotenv/config";
import postgres from "postgres";

const PHOTO = "/riccoh.jpeg";

async function main() {
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
  const rows = await sql`SELECT id, slot_index, podcast_name, photo_url FROM signups
    WHERE status <> 'cancelled' AND (podcast_name ILIKE '%ceremon%' OR podcast_name ILIKE '%awards%')
    ORDER BY slot_index`;
  for (const r of rows as any[]) {
    console.log(`#${r.id} ${String(r.podcast_name).padEnd(30)}`);
    console.log(`     was ${r.photo_url || "(none)"}`);
    console.log(`     now ${PHOTO}`);
  }
  if (!process.argv.includes("--apply")) { console.log("\nDry run — pass --apply."); await sql.end(); return; }
  for (const r of rows as any[]) await sql`UPDATE signups SET photo_url = ${PHOTO} WHERE id = ${r.id}`;
  console.log(`\nSet on ${rows.length} card(s).`);
  await sql.end();
}
main();
