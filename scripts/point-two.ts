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
// The closing stretch is one leg, not two: 9:00 open for a late booking, the
// Flag Carry at 9:30, Riccoh closing at 10:00. The second bonus this script
// invented comes back out.
//
// The last half hour is a thank-you to the podcasters and the sponsors. It is
// there because the day cannot simply stop at 10:30: the schedule is a whole
// number of hours and the slots are half an hour, so 7:00 to 10:30 is fifteen
// and a half, and duration_hours is an integer column. The choice was an empty
// "this could be you" card sitting after the goodbye or something worth
// watching in it, and the credits after the finish are the better answer.
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
  const rows = await sql`
    SELECT id, slot_index, podcast_name FROM signups
    WHERE event_id = ${event.id} AND status <> 'cancelled' AND slot_index >= 27
    ORDER BY slot_index`;
  const find = (re: RegExp) => rows.find((r: any) => re.test(r.podcast_name ?? ""));
  const flag = find(/flag carry/i);
  const spare = find(/^bonus session/i);
  const closing = rows.find((r: any) => /ceremon/i.test(r.podcast_name ?? ""));

  // 9:00 open · 9:30 Flag Carry · 10:00 closing · done at 10:30.
  const FLAG_AT = 29;
  const CLOSE_AT = 30;
  const THANKS_AT = 31;
  const THANKS = "Thank You — Our Podcasters & Sponsors";

  console.log(`${event.name}\n`);
  console.log(spare ? `delete  #${spare.id} slot ${spare.slot_index} · ${spare.podcast_name}` : `delete  nothing`);
  console.log(flag ? `move    #${flag.id} ${flag.slot_index} → ${FLAG_AT} · ${when(FLAG_AT)} · The Flag Carry` : `move    no Flag Carry row`);
  console.log(closing ? `move    #${closing.id} ${closing.slot_index} → ${CLOSE_AT} · ${when(CLOSE_AT)} · ${closing.podcast_name}` : `move    no closing row`);
  const thanks = find(/^thank you/i);
  console.log(thanks
    ? `keep    #${thanks.id} slot ${thanks.slot_index} · ${thanks.podcast_name}`
    : `create  slot ${THANKS_AT} · ${when(THANKS_AT)} · ${THANKS}`);
  console.log(`leaves  slot 28 · ${when(28)} open for a late booking`);

  if (!process.argv.includes("--apply")) {
    console.log("\nDry run — pass --apply.");
    await sql.end();
    return;
  }

  // Order matters: the spare comes out before anything slides into its slot.
  if (spare) { await sql`DELETE FROM signups WHERE id = ${spare.id}`; console.log(`\nDeleted #${spare.id}`); }
  if (flag) { await sql`UPDATE signups SET slot_index = ${FLAG_AT} WHERE id = ${flag.id}`; console.log(`Moved #${flag.id} → ${FLAG_AT}`); }
  if (closing) { await sql`UPDATE signups SET slot_index = ${CLOSE_AT} WHERE id = ${closing.id}`; console.log(`Moved #${closing.id} → ${CLOSE_AT}`); }
  if (!thanks) {
    const [row] = await sql`
      INSERT INTO signups (event_id, slot_index, podcast_name, host_name, email, photo_url,
                           num_people, status, show_format, intro_style, timezone, created_at)
      VALUES (${event.id}, ${THANKS_AT}, ${THANKS}, '', 'hello@militaryvoice.ai', '',
              1, 'confirmed', 'live', 'virtual', 'America/New_York', ${new Date().toISOString()})
      RETURNING id`;
    console.log(`Created #${row.id} → ${THANKS}`);
  }
  await sql.end();
}

main();
