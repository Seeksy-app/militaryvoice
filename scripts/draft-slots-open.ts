// Draft the "we still have slots open" follow-up.
//
// Creates it as a DRAFT only. Nothing is sent by this script — it appears in
// admin under Templates with a Send button, and the count next to that button
// is the live one, so whoever presses it sees who it is about to reach.
//
// It is written to the "not-signed-up" segment on purpose: everyone on the
// list who hasn't taken a slot. Asking somebody to sign up after they already
// have is the fastest way to look like nobody is paying attention.
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const [event] = await sql`SELECT * FROM events WHERE is_featured = true LIMIT 1`;
const [{ n: taken }] = await sql`
  SELECT count(*)::int AS n FROM signups WHERE event_id = ${event.id} AND status <> 'cancelled'`;
const total = Math.floor((event.duration_hours * 60) / event.slot_minutes);
const open = total - taken;

const dateLong = new Intl.DateTimeFormat("en-US", {
  weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York",
}).format(new Date(event.start_at_utc));

const body = `Hi {{First_Name}},

Touching base on the Mil/Vet Podcast Marathon. It's ${dateLong} — National Military Podcast Day — and we still have ${open} of the ${total} slots open.

${taken} shows are already on the board. Combat vets, military spouses, Gold Star families, hosts who've been at this for years and one who recorded her first episode last month. Nobody gets cut and nobody gets a worse slot for having a smaller audience.

If you've been meaning to grab a time and haven't, this is the part where I say it plainly: I'd like you on the schedule.

What it costs you: thirty minutes, live, doing what you already do every week.

What you don't need: a studio, a producer, a crew, or an audience. We run the whole broadcast. You show up.

What you get: your show in front of every other host's listeners, clips cut for you afterwards, and your name on the day.

Pick a time here: https://www.militaryvoice.ai/#podcasters

The good hours go first — that's just how it works.`;

const now = new Date().toISOString();
const [row] = await sql`
  INSERT INTO broadcasts (event_id, subject, body_text, status, segment, sender, banner, source, created_at)
  VALUES (${event.id}, ${`${open} slots left on October 5th, {{First_Name}}`}, ${body},
          'draft', 'not-signed-up', 'member:1', 'podcasters', 'manual', ${now})
  RETURNING id, subject, segment`;
await sql.end();

console.log(`Draft #${row.id} created — "${row.subject}" → ${row.segment}`);
console.log(`(${open} of ${total} slots open, ${taken} taken)`);
console.log("Nothing sent. It's in admin → event → Templates.");
