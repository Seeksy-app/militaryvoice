// Put American Warriors on the lineup at midnight, so Andrew sees the
// dashboard the way a podcaster does.
//
//   npx tsx scripts/aw-eyes.ts            # what would change
//   npx tsx scripts/aw-eyes.ts --apply    # book it
//   npx tsx scripts/aw-eyes.ts --undo     # cancel it again
//
// The day is thirty-two half-hour slots from 7 AM; slot 34 is midnight, two
// past the end. The public agenda, the watch page and the run of show only
// draw slots inside the day, so nothing a visitor sees changes. What does:
// the admin overview counts one more booking than there are slots, and
// andrew@smartloads.io receives every podcaster email — which is the point.
import "dotenv/config";
import postgres from "postgres";

const apply = process.argv.includes("--apply");
const undo = process.argv.includes("--undo");
const EMAIL = "andrew@smartloads.io";
const SLOT = 34; // 7:00 AM + 34 × 30 min = 12:00 AM the next day
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });

const rows = await sql<{ id: number; slot_index: number; status: string; podcast_name: string }[]>`
  SELECT id, slot_index, status, podcast_name FROM signups
  WHERE event_id = 1 AND lower(email) = ${EMAIL} AND podcast_name = 'American Warriors'
  ORDER BY id DESC`;
const row = rows[0];
if (!row) { console.log("No American Warriors signup to reuse."); process.exit(1); }
console.log(`American Warriors · signup #${row.id} · slot ${row.slot_index} · ${row.status}`);

if (undo) {
  if (!apply) console.log(`\nWould cancel #${row.id}. Add --apply to do it.`);
  else { await sql`UPDATE signups SET status = 'cancelled' WHERE id = ${row.id}`; console.log(`\nCancelled. Gone from the dashboard.`); }
} else if (!apply) {
  console.log(`\nWould set #${row.id} to slot ${SLOT} (midnight), status confirmed. Add --apply to do it.`);
} else {
  await sql`UPDATE signups SET slot_index = ${SLOT}, status = 'confirmed' WHERE id = ${row.id}`;
  console.log(`\nBooked at midnight. Sign in at /host/dashboard as ${EMAIL} to see what podcasters see.`);
}
await sql.end();
