// Theresa into 9:30, and the end of the day resequenced around her.
//
//   npx tsx scripts/add-theresa.ts           # dry run
//   npx tsx scripts/add-theresa.ts --apply
//
//   9:30  Stories of Service — Theresa Carpenter   (was the Flag Carry)
//  10:00  The Flag Carry — Riccoh                  (was Closing Ceremonies)
//  10:30  Closing Ceremonies & Awards, 15 min      (was Awards alone) → ends 10:45
//
// Order matters and it runs backwards: the day is full, so nothing can move
// into a slot until the thing already in it has moved out. Closing merges into
// Awards first, which frees 10:00 for the Flag Carry, which frees 9:30 for
// Theresa. Done the other way round, the first write overwrites a booking.
import "dotenv/config";
import postgres from "postgres";

const EMAIL = "tdonnellypao@gmail.com";

async function main() {
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
  const [ev] = await sql`SELECT id, start_at_utc, slot_minutes FROM events WHERE is_featured = true`;
  const when = (i: number) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
    .format(new Date(new Date(ev.start_at_utc).getTime() + i * ev.slot_minutes * 60000));

  const [p] = await sql`SELECT * FROM podcaster_profiles WHERE email = ${EMAIL}`;
  const [flag] = await sql`SELECT id, slot_index FROM signups WHERE event_id=${ev.id} AND status<>'cancelled' AND podcast_name ILIKE '%flag carry%'`;
  const [closing] = await sql`SELECT id, slot_index FROM signups WHERE event_id=${ev.id} AND status<>'cancelled' AND podcast_name = 'Closing Ceremonies'`;
  const [awards] = await sql`SELECT id, slot_index FROM signups WHERE event_id=${ev.id} AND status<>'cancelled' AND podcast_name ILIKE '%awards%'`;
  const [already] = await sql`SELECT id, slot_index FROM signups WHERE event_id=${ev.id} AND status<>'cancelled' AND lower(email)=${EMAIL}`;

  if (!p) { console.log("No profile for Theresa."); await sql.end(); return; }
  if (already) { console.log(`Theresa already booked at slot ${already.slot_index} (${when(already.slot_index)}).`); await sql.end(); return; }
  if (!flag || !closing || !awards) { console.log("Couldn't find Flag Carry / Closing / Awards — schedule has moved."); await sql.end(); return; }

  console.log(`merge    #${closing.id} Closing (${when(closing.slot_index)}) into #${awards.id} (${when(awards.slot_index)})`);
  console.log(`         → "Closing Ceremonies & Awards", 15 min, ends 10:45 PM`);
  console.log(`move     #${flag.id} The Flag Carry  ${when(flag.slot_index)} → ${when(closing.slot_index)}`);
  console.log(`book     ${p.host_name} — ${p.podcast_name}  at ${when(flag.slot_index)}`);
  console.log(`         ${p.branch} ${p.service_status} · ${p.show_format} · photo ${p.photo_url ? "yes" : "MISSING"}`);

  if (!process.argv.includes("--apply")) { console.log("\nDry run — pass --apply."); await sql.end(); return; }

  const freed = flag.slot_index, mid = closing.slot_index;
  await sql`UPDATE signups SET podcast_name = 'Closing Ceremonies & Awards' WHERE id = ${awards.id}`;
  await sql`DELETE FROM signups WHERE id = ${closing.id}`;
  await sql`UPDATE signups SET slot_index = ${mid} WHERE id = ${flag.id}`;
  const [row] = await sql`
    INSERT INTO signups (event_id, slot_index, podcast_name, host_name, email, phone, num_people, status,
                         show_format, intro_style, timezone, photo_url, youtube_url, branch, service_status, created_at)
    VALUES (${ev.id}, ${freed}, ${p.podcast_name}, ${p.host_name}, ${p.email}, ${p.phone ?? ""}, 1, 'confirmed',
            ${p.show_format || "live"}, 'straight', 'America/New_York', ${p.photo_url ?? ""}, ${p.youtube_url ?? ""},
            ${p.branch ?? ""}, ${p.service_status ?? ""}, ${new Date().toISOString()})
    RETURNING id`;
  console.log(`\nTheresa booked as signup #${row.id} at ${when(freed)}.`);
  console.log(`Run scripts/refresh-studio.ts --apply so the run of show and scenes follow.`);
  await sql.end();
}
main();
