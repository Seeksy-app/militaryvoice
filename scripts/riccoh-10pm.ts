// Riccoh's own podcast back at 10pm. The 10:30 card keeps its name.
//
//   npx tsx scripts/riccoh-10pm.ts           # dry run
//   npx tsx scripts/riccoh-10pm.ts --apply
//
// His 10pm row still exists — cancelled, and still carrying "The Flag Carry",
// the name it was given when he held that segment. Theresa has the colours
// now, so the row goes back to being his show. Reviving beats inserting: the
// booking keeps its id, its media and its history.
import "dotenv/config";
import postgres from "postgres";

const SHOW = "Devil Dawg Double Dare Podcast";

async function main() {
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
  const [ev] = await sql`SELECT id, start_at_utc, slot_minutes FROM events WHERE is_featured = true`;
  const w = (i: number) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
    .format(new Date(new Date(ev.start_at_utc).getTime() + i * ev.slot_minutes * 60000));

  const [his] = await sql`SELECT id, slot_index, podcast_name, status, recording_url FROM signups
    WHERE event_id = ${ev.id} AND id = 46`;
  const [awards] = await sql`SELECT id, slot_index, podcast_name FROM signups
    WHERE event_id = ${ev.id} AND status <> 'cancelled' AND podcast_name ILIKE '%awards%'`;
  const [clash] = await sql`SELECT id, podcast_name FROM signups
    WHERE event_id = ${ev.id} AND status <> 'cancelled' AND slot_index = ${his?.slot_index ?? -1}`;

  if (!his) { console.log("Riccoh's row is gone."); await sql.end(); return; }
  if (clash) { console.log(`${w(his.slot_index)} is taken by ${clash.podcast_name}. Nothing done.`); await sql.end(); return; }

  console.log(`revive  #${his.id}  ${w(his.slot_index)}  [${his.status}] "${his.podcast_name}"`);
  console.log(`        → "${SHOW}" · Riccoh Player · pre-recorded · confirmed`);
  console.log(`        episode on file: ${his.recording_url ? "yes" : "no"}`);
  console.log(awards ? `keep    #${awards.id}  ${w(awards.slot_index)}  "${awards.podcast_name}" unchanged` : "");

  if (!process.argv.includes("--apply")) { console.log("\nDry run — pass --apply."); await sql.end(); return; }
  await sql`UPDATE signups SET status = 'confirmed', podcast_name = ${SHOW} WHERE id = ${his.id}`;
  console.log(`\nDone. Run scripts/refresh-studio.ts --apply so the run of show follows.`);
  await sql.end();
}
main();
