// Put the .2 on the course, and take off the one I put in the wrong place.
//
//   npx tsx scripts/point-two.ts           # dry run
//   npx tsx scripts/point-two.ts --apply
//
// The last 385 yards of a marathon is the only part not run on the road: the
// 1908 course was extended so it would finish in front of the royal box, which
// put the final stretch inside the stadium, on the track, in front of the whole
// seated crowd. So the .2 is the segment with the audience, and it belongs at
// the end of the day rather than mid-afternoon.
//
// The first version of this created the Flag Carry as a new house slot, which
// was wrong twice over. It added a twenty-eighth booking to a course that was
// already a mile long, and it gave the segment Riccoh's name and face one card
// away from the closing ceremonies, which also carry his name and face — so the
// agenda ended on three Riccohs in a row. Devil Dawg Double Dare is his own
// show, and turning that slot into the Flag Carry is the fix for both: the
// count comes back to twenty-six miles, and the finish reads as one person
// carrying the colours in and then closing the day.
import "dotenv/config";
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
  const [event] = await sql`SELECT * FROM events WHERE is_featured = true`;

  const when = (i: number) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
    }).format(new Date(new Date(event.start_at_utc).getTime() + i * event.slot_minutes * 60000));

  // The house slot this script created on its first run. Identified by address
  // rather than by name so it can never match a podcaster's booking.
  const [stray] = await sql`
    SELECT id, slot_index, podcast_name FROM signups
    WHERE event_id = ${event.id} AND status <> 'cancelled'
      AND email = 'hello@militaryvoice.ai' AND podcast_name = 'The Flag Carry'`;

  const [devilDawg] = await sql`
    SELECT id, slot_index, podcast_name, host_name, email FROM signups
    WHERE event_id = ${event.id} AND status <> 'cancelled'
      AND podcast_name ILIKE '%devil dawg%'`;

  console.log(`${event.name}\n`);
  console.log(stray
    ? `remove   #${stray.id} slot ${stray.slot_index} · ${when(stray.slot_index)} · ${stray.podcast_name} (house)`
    : `remove   nothing — no house Flag Carry slot`);
  console.log(devilDawg
    ? `rename   #${devilDawg.id} slot ${devilDawg.slot_index} · ${when(devilDawg.slot_index)} · ${devilDawg.podcast_name}\n         → The Flag Carry / ${devilDawg.host_name} <${devilDawg.email}>`
    : `rename   nothing — Devil Dawg not found`);

  if (!process.argv.includes("--apply")) {
    console.log("\nDry run — pass --apply.");
    await sql.end();
    return;
  }

  if (stray) {
    await sql`DELETE FROM signups WHERE id = ${stray.id}`;
    console.log(`\nDeleted #${stray.id}`);
  }
  if (devilDawg) {
    await sql`UPDATE signups SET podcast_name = 'The Flag Carry' WHERE id = ${devilDawg.id}`;
    console.log(`Renamed #${devilDawg.id} → The Flag Carry`);
  }
  await sql.end();
}

main();
