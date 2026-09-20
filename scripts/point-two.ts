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
//
// That house row is not deleted, it is moved: the closing stretch wants two
// legs to make the point-two, and the row already exists, so it slides into the
// 9:30 slot as the second. Deleting it and inserting another would be the same
// schedule by a longer route.
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
  // The house row this script created on its first run, identified by address
  // so it can never match a podcaster's booking.
  const [stray] = await sql`
    SELECT id, slot_index FROM signups
    WHERE event_id = ${event.id} AND status <> 'cancelled'
      AND email = 'hello@militaryvoice.ai' AND podcast_name = 'The Flag Carry'`;

  const [devilDawg] = await sql`
    SELECT id, slot_index, podcast_name, host_name, email FROM signups
    WHERE event_id = ${event.id} AND status <> 'cancelled'
      AND podcast_name ILIKE '%devil dawg%'`;

  // Where the second leg goes: the first free slot after the Flag Carry.
  const slots = Math.round((event.duration_hours * 60) / event.slot_minutes);
  const taken = new Set(
    (await sql`SELECT slot_index FROM signups WHERE event_id = ${event.id} AND status <> 'cancelled'`)
      .map((r: any) => r.slot_index),
  );
  const from = devilDawg ? devilDawg.slot_index : 0;
  let legTwo = -1;
  for (let i = from + 1; i < slots; i++) {
    if (!taken.has(i) || (stray && stray.slot_index === i)) { legTwo = i; break; }
  }

  console.log(`${event.name}\n`);
  console.log(devilDawg
    ? `rename  #${devilDawg.id} slot ${devilDawg.slot_index} · ${when(devilDawg.slot_index)} · ${devilDawg.podcast_name}\n        → The Flag Carry / ${devilDawg.host_name} <${devilDawg.email}>   [B1]`
    : `rename  nothing — Devil Dawg not found`);
  console.log(stray && legTwo >= 0
    ? `move    #${stray.id} slot ${stray.slot_index} → ${legTwo} · ${when(legTwo)}\n        → Bonus Session — TBD   [B2]`
    : `move    nothing — no house row to reuse, or no free slot after the Flag Carry`);

  if (!process.argv.includes("--apply")) {
    console.log("\nDry run — pass --apply.");
    await sql.end();
    return;
  }

  if (devilDawg) {
    await sql`UPDATE signups SET podcast_name = 'The Flag Carry' WHERE id = ${devilDawg.id}`;
    console.log(`\nRenamed #${devilDawg.id} → The Flag Carry`);
  }
  if (stray && legTwo >= 0) {
    await sql`UPDATE signups SET slot_index = ${legTwo}, podcast_name = 'Bonus Session — TBD',
                 host_name = '', photo_url = '' WHERE id = ${stray.id}`;
    console.log(`Moved #${stray.id} → slot ${legTwo}, Bonus Session — TBD`);
  }
  await sql.end();
}

main();
