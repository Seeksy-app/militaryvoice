// Put the ceremonies on the first and last slots of the day.
//
//   npx tsx scripts/ceremony-slots.ts           # dry run
//   npx tsx scripts/ceremony-slots.ts --apply
//
// Replaces scripts/opening-ceremony.ts, which only knew about the 7:00 AM
// slot. Both ceremonies use a house address rather than Riccoh's, deliberately:
// his own show holds 8:00 AM under riccoh.player@drphil.tv, and a second
// signup on the same address would put him in the lineup twice, count him
// twice in every recipient list, and give his dashboard two shows to keep
// straight. These slots are the event's own bookends that he fronts — so they
// carry his name and his picture and belong to the house.
import "dotenv/config";
import postgres from "postgres";

const HOUSE_EMAIL = "hello@militaryvoice.ai";
const PHOTO = "/riccoh-host.jpg";

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const [event] = await sql`SELECT * FROM events WHERE is_featured = true`;
const slots = Math.round((event.duration_hours * 60) / event.slot_minutes);

const [riccoh] = await sql`
  SELECT host_name FROM signups
  WHERE event_id = ${event.id} AND lower(email) LIKE '%riccoh%' AND status <> 'cancelled' LIMIT 1`;
const hostName = riccoh?.host_name ?? "Riccoh Player";

const when = (i: number) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  }).format(new Date(new Date(event.start_at_utc).getTime() + i * event.slot_minutes * 60000));

const PLAN = [
  { slot: 0, name: "Welcoming Ceremonies" },
  { slot: slots - 1, name: "Closing Ceremonies" },
];

console.log(`${event.name}: ${slots} slots of ${event.slot_minutes} min\n`);

const todo: { slot: number; name: string; existingId?: number }[] = [];
for (const p of PLAN) {
  const [held] = await sql`
    SELECT id, podcast_name, email FROM signups
    WHERE event_id = ${event.id} AND slot_index = ${p.slot} AND status <> 'cancelled'`;
  const mine = !held || held.email === HOUSE_EMAIL;
  console.log(`slot ${String(p.slot).padStart(2)} · ${when(p.slot)}`);
  console.log(`  currently: ${held ? `${held.podcast_name} (${held.email})` : "free"}`);
  if (!mine) {
    // Somebody real booked it. Never overwrite a podcaster's slot to make room
    // for a ceremony — say so and let a person decide.
    console.log(`  SKIPPED — a podcaster holds this slot. Move them first.\n`);
    continue;
  }
  console.log(`  becomes:   ${p.name} / ${hostName} · ${HOUSE_EMAIL}\n`);
  todo.push({ ...p, existingId: held?.id });
}

if (!process.argv.includes("--apply")) {
  console.log("Dry run — pass --apply.");
  await sql.end();
  process.exit(0);
}

for (const t of todo) {
  if (t.existingId) {
    await sql`
      UPDATE signups
      SET podcast_name = ${t.name}, host_name = ${hostName}, photo_url = ${PHOTO},
          email = ${HOUSE_EMAIL}, show_format = 'live'
      WHERE id = ${t.existingId}`;
    console.log(`Updated signup #${t.existingId} → ${t.name}`);
  } else {
    const [row] = await sql`
      INSERT INTO signups (event_id, slot_index, podcast_name, host_name, email, photo_url,
                           num_people, status, show_format, intro_style, timezone, created_at)
      VALUES (${event.id}, ${t.slot}, ${t.name}, ${hostName}, ${HOUSE_EMAIL},
              ${PHOTO}, 1, 'confirmed', 'live', 'virtual', 'America/New_York',
              ${new Date().toISOString()})
      RETURNING id`;
    console.log(`Created signup #${row.id} → ${t.name}`);
  }
}
await sql.end();
