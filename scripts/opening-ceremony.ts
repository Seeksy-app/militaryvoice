// Put the opening ceremony on the 7:00 AM slot.
//
//   npx tsx scripts/opening-ceremony.ts --apply
//
// It uses a house address rather than Riccoh's, deliberately. His own show
// holds 8:00 AM under riccoh.player@drphil.tv, and a second signup on the same
// address would put him in the lineup twice, count him twice in every
// recipient list, and give his dashboard two shows to keep straight. This slot
// is the event's own opening that he fronts — so it carries his name and his
// picture, and belongs to the house.
import "dotenv/config";
import postgres from "postgres";

const HOUSE_EMAIL = "hello@militaryvoice.ai";
const SLOT = 0; // 7:00 AM ET, the first slot of the day

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const [event] = await sql`SELECT * FROM events WHERE is_featured = true`;
const [riccoh] = await sql`
  SELECT photo_url, host_name FROM signups
  WHERE event_id = ${event.id} AND lower(email) LIKE '%riccoh%' AND status <> 'cancelled' LIMIT 1`;
if (!riccoh?.photo_url) throw new Error("No photo on Riccoh's signup to reuse.");

const existing = await sql`
  SELECT id, podcast_name, email FROM signups
  WHERE event_id = ${event.id} AND slot_index = ${SLOT} AND status <> 'cancelled'`;

const start = new Date(new Date(event.start_at_utc).getTime() + SLOT * event.slot_minutes * 60000);
console.log(
  `slot ${SLOT} = ${new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(start)}`,
);
console.log(existing.length ? `  currently: ${existing[0].podcast_name} (${existing[0].email})` : "  currently: free");
console.log(`  becomes:   Welcoming Ceremonies / ${riccoh.host_name} · ${HOUSE_EMAIL}`);

if (!process.argv.includes("--apply")) {
  console.log("\nDry run — pass --apply.");
  await sql.end();
  process.exit(0);
}

if (existing.length) {
  await sql`
    UPDATE signups
    SET podcast_name = 'Welcoming Ceremonies', host_name = ${riccoh.host_name},
        photo_url = ${riccoh.photo_url}, email = ${HOUSE_EMAIL}, show_format = 'live'
    WHERE id = ${existing[0].id}`;
  console.log(`\nUpdated signup #${existing[0].id}.`);
} else {
  const [row] = await sql`
    INSERT INTO signups (event_id, slot_index, podcast_name, host_name, email, photo_url,
                         num_people, status, show_format, intro_style, timezone, created_at)
    VALUES (${event.id}, ${SLOT}, 'Welcoming Ceremonies', ${riccoh.host_name}, ${HOUSE_EMAIL},
            ${riccoh.photo_url}, 1, 'confirmed', 'live', 'virtual', 'America/New_York',
            ${new Date().toISOString()})
    RETURNING id`;
  console.log(`\nCreated signup #${row.id}.`);
}
await sql.end();
