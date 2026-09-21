// Theresa carries the colours; Riccoh closes.
//
//   npx tsx scripts/theresa-flag.ts           # dry run
//   npx tsx scripts/theresa-flag.ts --apply
//
//   9:30  The Flag Carry — Theresa Carpenter     (was Stories of Service)
//  10:00  — open —                                (Riccoh's flag slot stood down)
//  10:30  Closing Ceremonies & Awards — Riccoh   (had no host at all)
//
// The point of this is the numbering. A marathon ends at 26.2, and three
// shows past the twenty-sixth mile produced a "Mile 26.3" card on a live page.
// The Flag Carry is not a mile, so moving Theresa onto it puts the course back
// inside its own distance instead of inventing road that does not exist.
//
// Riccoh's row is cancelled, not deleted. It is a real booking — his own show,
// renamed twice today — and a cancelled row can be brought back.
import "dotenv/config";
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
  const [ev] = await sql`SELECT id, start_at_utc, slot_minutes FROM events WHERE is_featured = true`;
  const w = (i: number) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
    .format(new Date(new Date(ev.start_at_utc).getTime() + i * ev.slot_minutes * 60000));

  const [theresa] = await sql`SELECT id, slot_index FROM signups WHERE event_id=${ev.id} AND status<>'cancelled' AND lower(email)='tdonnellypao@gmail.com'`;
  const [riccohFlag] = await sql`SELECT id, slot_index, host_name, photo_url FROM signups WHERE event_id=${ev.id} AND status<>'cancelled' AND podcast_name ILIKE '%flag carry%'`;
  const [closing] = await sql`SELECT id, slot_index, host_name FROM signups WHERE event_id=${ev.id} AND status<>'cancelled' AND podcast_name ILIKE '%closing%'`;

  if (!theresa || !riccohFlag || !closing) { console.log("Schedule has moved — one of the three rows is missing."); await sql.end(); return; }

  console.log(`rename   #${theresa.id}  ${w(theresa.slot_index)}  → "The Flag Carry" / Theresa Carpenter`);
  console.log(`stand down #${riccohFlag.id}  ${w(riccohFlag.slot_index)}  Riccoh's flag slot → cancelled, ${w(riccohFlag.slot_index)} opens`);
  console.log(`host     #${closing.id}  ${w(closing.slot_index)}  Closing & Awards → Riccoh Player${closing.host_name ? ` (was "${closing.host_name}")` : " (had none)"}`);

  if (!process.argv.includes("--apply")) { console.log("\nDry run — pass --apply."); await sql.end(); return; }

  await sql`UPDATE signups SET podcast_name = 'The Flag Carry', host_name = 'Theresa Carpenter' WHERE id = ${theresa.id}`;
  await sql`UPDATE signups SET status = 'cancelled' WHERE id = ${riccohFlag.id}`;
  await sql`UPDATE signups SET host_name = ${riccohFlag.host_name}, photo_url = ${riccohFlag.photo_url ?? ""} WHERE id = ${closing.id}`;
  console.log(`\nDone. Run scripts/refresh-studio.ts --apply so the run of show follows.`);
  await sql.end();
}
main();
