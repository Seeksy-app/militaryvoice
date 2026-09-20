// Make the studio match the schedule.
//
//   npx tsx scripts/refresh-studio.ts           # dry run
//   npx tsx scripts/refresh-studio.ts --apply
//
// The run of show is generated once and then drifts. This one still runs to
// 6:55am on the 6th — the shape of the old 24-hour day — so the studio has an
// evening and a whole extra morning that no longer exist, 38 rows reading
// "Open slot" against slots that have been booked for weeks, and no row at all
// for the Flag Carry, #StillServing, 4Years A Slave or the Thank You.
//
// Two passes, in this order and not the other:
//
//   1. Regenerate the run of show. mergeRunOfShow matches on sourceKey, always
//      refreshes timing and the linked podcaster, only rewrites wording nobody
//      has hand-edited, and deletes the rows that no longer belong.
//   2. Reconcile the scenes against it. Scenes bind to a run item by id and
//      copy its title once, so step 1 both orphans some scenes and leaves the
//      rest captioned with the old schedule. Doing this first would just tidy
//      the stale names into place.
import "dotenv/config";
import postgres from "postgres";

const API = process.env.MV_API ?? "https://militaryvoice.ai";

async function main() {
  const apply = process.argv.includes("--apply");
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
  const [ev] = await sql`SELECT id, admin_password, start_at_utc, duration_hours FROM events WHERE is_featured = true`;
  const endsAt = new Date(new Date(ev.start_at_utc).getTime() + ev.duration_hours * 3600e3).toISOString();

  const before = await sql`SELECT count(*)::int c FROM run_of_show WHERE event_id=${ev.id}`;
  const late = await sql`SELECT count(*)::int c FROM run_of_show
    WHERE event_id=${ev.id} AND start_at_utc <> '' AND start_at_utc >= ${endsAt}`;
  console.log(`run of show: ${before[0].c} rows, ${late[0].c} of them starting after the event ends`);

  if (!apply) {
    const drift = await sql`SELECT count(*)::int c FROM scenes s JOIN run_of_show r ON r.id=s.run_item_id WHERE s.name <> r.title`;
    console.log(`scenes: ${(await sql`SELECT count(*)::int c FROM scenes`)[0].c}, ${drift[0].c} captioned from a stale row`);
    console.log("\nDry run — pass --apply.");
    await sql.end();
    return;
  }

  process.stdout.write("\nregenerating the run of show… ");
  const res = await fetch(`${API}/api/admin/run-of-show/generate`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-password": ev.admin_password },
    body: JSON.stringify({ eventId: ev.id }),
  });
  if (!res.ok) { console.log(`FAILED ${res.status} ${(await res.text()).slice(0, 300)}`); await sql.end(); return; }
  const rows = (await res.json()) as unknown[];
  console.log(`ok — ${rows.length} rows`);

  // Scenes pointing at a row that no longer exists cut to nothing. They go.
  const orphans = await sql`DELETE FROM scenes s WHERE s.run_item_id <> 0
    AND NOT EXISTS (SELECT 1 FROM run_of_show r WHERE r.id = s.run_item_id) RETURNING s.id`;
  console.log(`removed ${orphans.length} scene${orphans.length === 1 ? "" : "s"} whose agenda row is gone`);

  const stale = await sql`SELECT s.id, r.title FROM scenes s JOIN run_of_show r ON r.id = s.run_item_id WHERE s.name <> r.title`;
  for (const x of stale as any[]) await sql`UPDATE scenes SET name = ${x.title} WHERE id = ${x.id}`;
  console.log(`re-captioned ${stale.length} scene${stale.length === 1 ? "" : "s"}`);

  const after = await sql`SELECT count(*)::int c FROM run_of_show WHERE event_id=${ev.id}`;
  const stillLate = await sql`SELECT count(*)::int c FROM run_of_show
    WHERE event_id=${ev.id} AND start_at_utc <> '' AND start_at_utc >= ${endsAt}`;
  console.log(`\nrun of show now ${after[0].c} rows, ${stillLate[0].c} after the event ends`);
  await sql.end();
}

main();
