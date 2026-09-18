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

const subject = `It's not too late — ${open} slots left, {{First_Name}}`;
const body = `Hi {{First_Name}},

It's not too late.

${dateLong} is ${days} days away and we still have **${open} of the ${total} slots** open on the 24-Hour Mil/Vet Podcastathon. ${taken} shows are already on the board.

If you've been meaning to grab a time and haven't got round to it, this is the part where I say it plainly: I'd like you on the schedule.

**What it costs you:** thirty minutes, live, doing what you already do every week.

**What you don't need:** a studio, a producer, a crew, or an audience. We run the whole broadcast. You show up and talk.

**What you get:**

- Your show in front of every other host's listeners
- Clips cut from your segment automatically — vertical, square and wide, captions included
- Your slot going out on your own YouTube channel at the same time, if you want it
- Your name on the day

[Pick a time](https://www.militaryvoice.ai/#podcasters)

Takes about two minutes. The good hours go first — that's just how it works.

And if it's genuinely not for you this year, reply and tell me. I'd rather know than keep asking.`;

console.log(`${open} of ${total} open · ${taken} taken · ${days} days out`);
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
