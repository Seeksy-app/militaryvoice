// "It's not too late" — the recruitment email to everyone still on the fence.
//
// Rewrites draft #10 with today's numbers. The count is baked in at draft
// time because the renderer only substitutes {{First_Name}}, so if this sits
// unsent for a week the figure goes stale — re-run this before sending.
//
//   npx tsx scripts/draft-not-too-late.ts --apply
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const [event] = await sql`SELECT * FROM events WHERE is_featured = true LIMIT 1`;
const [{ n: taken }] = await sql`
  SELECT count(*)::int AS n FROM signups WHERE event_id = ${event.id} AND status <> 'cancelled'`;
const total = Math.floor((event.duration_hours * 60) / event.slot_minutes);
const open = total - taken;
const start = new Date(event.start_at_utc);
const dateLong = new Intl.DateTimeFormat("en-US", {
  weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York",
}).format(start);
const days = Math.max(0, Math.ceil((start.getTime() - Date.now()) / 86_400_000));

// Short enough to read on a phone without scrolling, and no slot count.
//
// The count is deliberately gone. Not only because the number goes stale
// between drafting and sending — thirty of forty-eight is also not scarce,
// and "only a few left" would be a straightforward lie that anyone can check
// against the agenda. The urgency here is the two things that are true: the
// date is fixed and coming, and the good hours really do go first.
const subject = `Don't leave it too late, {{First_Name}}`;
const body = `Hi {{First_Name}},

${dateLong} is ${days} days out, and the board is filling up.

Thirty minutes, live, doing what you already do every week. No studio, no producer, no crew — we run the whole broadcast. You show up and talk.

We cut the clips for you afterwards, and it goes out on your own YouTube at the same time if you want it.

The prime hours go first. If you'd rather pick a good time than take what's left, do it this week.

[Grab a slot](https://www.militaryvoice.ai/#podcasters)

Two minutes, and it costs you nothing.`;

console.log(`${open} of ${total} open · ${taken} taken · ${days} days out (counts are not in the email)`);
console.log(`subject: ${subject}`);

if (process.argv.includes("--apply")) {
  const [row] = await sql`
    UPDATE broadcasts
    SET subject = ${subject}, body_text = ${body}, segment = 'not-signed-up',
        sender = 'member:1', banner = 'podcasters', status = 'draft'
    WHERE id = 10 RETURNING id, subject`;
  console.log(row ? `\nDraft #${row.id} updated. Nothing sent.` : "\n#10 not found.");
} else {
  console.log("\nDry run — pass --apply.");
}
await sql.end();
