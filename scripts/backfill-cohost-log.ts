// Put this morning's co-host email into the activity log after the fact.
//
//   npx tsx scripts/backfill-cohost-log.ts           # what would be filed
//   npx tsx scripts/backfill-cohost-log.ts --apply   # file it
//
// The one-off sender started logging its sends at 11:12 today; the co-host
// ask went out at 09:45 through the same door and left nothing behind. This
// files it the way the sender now would: one campaign row, one send row per
// recipient. There are no Resend ids to attach, so the row shows "sent" and
// never an open — that is the honest state of what we know about it.
//
// Refuses to run twice: same subject, same day, source one-off.
import "dotenv/config";
import postgres from "postgres";

const apply = process.argv.includes("--apply");
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });

const SUBJECT = "National Military Podcast Day is 14 days away";
const SENT_AT = "2026-09-21T13:45:00.000Z"; // 09:45 ET
const BODY = `Hi {{First_Name}},

The National Military Podcast Day Marathon is 14 days away. Twenty-six point two miles of military and veteran podcasts, back to back, and you're one of them.

**Would you like to co-host?**

Not just your own segment — time on the main stage between shows. Introducing what's coming up, talking about the day, keeping the thing moving. As much or as little of the day as suits you.

If that sounds like you, reply and tell me, and we'll work out where you'd fit.

Fourteen days. See you at the start line.

Riccoh`;

const rows = await sql<{ email: string }[]>`
  SELECT DISTINCT ON (s.email) s.email FROM signups s
  WHERE s.event_id = 1 AND s.status <> 'cancelled' AND s.email <> ''
  ORDER BY s.email, s.slot_index`;

const dup = await sql`SELECT id FROM broadcasts
  WHERE source = 'one-off' AND subject = ${SUBJECT} AND left(sent_at, 10) = ${SENT_AT.slice(0, 10)}`;

console.log(`"${SUBJECT}" · ${rows.length} recipients · sent ${SENT_AT}`);
if (dup.length) {
  console.log(`Already filed as broadcast #${dup[0].id}. Nothing to do.`);
} else if (!apply) {
  console.log(`\nDry run. --apply to file it.`);
} else {
  const [b] = await sql`INSERT INTO broadcasts
      (event_id, subject, body_text, segment, sender, banner, status, source, recipient_count, sent_at, created_at)
    VALUES (1, ${SUBJECT}, ${BODY}, 'one-off', 'member:1', 'podcasters', 'sent', 'one-off', ${rows.length}, ${SENT_AT}, ${SENT_AT})
    RETURNING id`;
  for (const r of rows) {
    await sql`INSERT INTO broadcast_sends (broadcast_id, email, resend_id, sent_at)
      VALUES (${b.id}, ${r.email}, '', ${SENT_AT})`;
  }
  console.log(`\nFiled as broadcast #${b.id} with ${rows.length} sends.`);
}
await sql.end();
