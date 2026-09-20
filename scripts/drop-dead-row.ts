// Remove agenda rows that outlived their booking.
//
//   npx tsx scripts/drop-dead-row.ts           # dry run
//   npx tsx scripts/drop-dead-row.ts --apply
//
// mergeRunOfShow never deletes a hand-edited row, which is the right default —
// somebody rewrote it on purpose and a regenerate should not throw that away.
// The gap is a row that was edited and then had its reason to exist removed:
// Marine OCS Blog cancelled, the slot it sat in stopped existing when the day
// was condensed, and the row stayed behind at 3am on the 6th because the edit
// flag protected it. That is the whole of the "Oct 6th hours" still showing in
// the studio.
//
// Narrow on purpose: only rows that start after the event ends AND point at a
// booking that is cancelled or gone. An edited row that is still on the
// schedule is left exactly where it is.
import "dotenv/config";
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
  const [ev] = await sql`SELECT id, start_at_utc, duration_hours FROM events WHERE is_featured = true`;
  const endsAt = new Date(new Date(ev.start_at_utc).getTime() + ev.duration_hours * 3600e3).toISOString();
  const d = (s: string) => new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  }).format(new Date(s));

  const dead = await sql`
    SELECT r.id, r.title, r.start_at_utc, r.signup_id
    FROM run_of_show r
    WHERE r.event_id = ${ev.id}
      AND r.start_at_utc <> '' AND r.start_at_utc >= ${endsAt}
      AND (r.signup_id IS NULL
           OR NOT EXISTS (SELECT 1 FROM signups s WHERE s.id = r.signup_id AND s.status <> 'cancelled'))
    ORDER BY r.start_at_utc`;

  if (!dead.length) { console.log("Nothing past the end of the day. The studio matches the schedule."); await sql.end(); return; }

  for (const x of dead as any[]) {
    const scenes = await sql`SELECT id, name FROM scenes WHERE run_item_id = ${x.id}`;
    console.log(`  agenda row #${x.id}  ${d(x.start_at_utc)}  ${x.title}`);
    for (const s of scenes as any[]) console.log(`    + scene #${s.id} "${s.name}"`);
  }

  if (!process.argv.includes("--apply")) { console.log("\nDry run — pass --apply."); await sql.end(); return; }

  const ids = (dead as any[]).map((x) => x.id);
  const scn = await sql`DELETE FROM scenes WHERE run_item_id IN ${sql(ids)} RETURNING id`;
  const rws = await sql`DELETE FROM run_of_show WHERE id IN ${sql(ids)} RETURNING id`;
  console.log(`\nRemoved ${rws.length} agenda row(s) and ${scn.length} scene(s).`);
  await sql.end();
}

main();
