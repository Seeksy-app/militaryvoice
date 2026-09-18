// Who actually received broadcast #10, checked against who holds a slot.
//
// Not the segment's arithmetic — the send log. broadcast_sends has one row
// per address we handed to Resend, so this is what was really sent, not what
// was supposed to be.
import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });

const sends = await sql`SELECT lower(email) AS e FROM broadcast_sends WHERE broadcast_id = 10`;
const signups = await sql`SELECT lower(email) AS e, podcast_name FROM signups WHERE event_id = 1 AND status <> 'cancelled'`;
await sql.end();

const sent = new Set(sends.map((r: any) => r.e));
console.log(`rows in the send log for #10 : ${sends.length}`);
console.log(`distinct addresses           : ${sent.size}`);
console.log(`podcasters holding a slot    : ${signups.length}`);

const wrongly = signups.filter((s: any) => sent.has(s.e));
if (wrongly.length === 0) {
  console.log(`\nNone of the ${signups.length} slot-holders received it. Correct.`);
} else {
  console.log(`\n!! ${wrongly.length} slot-holder(s) DID receive it:`);
  for (const w of wrongly) console.log(`   ${w.e}  (${w.podcast_name})`);
}
