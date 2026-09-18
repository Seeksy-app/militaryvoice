// Draft the "we need you posting" email to the hosts who are already on the
// board. Draft only — nothing is sent by this script.
//
// It goes to `signups`, not the whole list: these are people who have already
// said yes, and the ask is different from recruitment. Getting that wrong —
// sending a "come and join us" to someone holding a slot — is the fastest way
// to look like nobody is paying attention.
import "dotenv/config";
import postgres from "postgres";
import { POSTS_BEFORE_PER_SHOW, POSTS_AFTER_PER_SHOW, plannedPosts } from "../shared/promo.js";

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const [event] = await sql`SELECT * FROM events WHERE is_featured = true LIMIT 1`;
const [{ n: shows }] = await sql`
  SELECT count(*)::int AS n FROM signups WHERE event_id = ${event.id} AND status <> 'cancelled'`;

const start = new Date(event.start_at_utc);
const dateLong = new Intl.DateTimeFormat("en-US", {
  weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York",
}).format(start);
const daysOut = Math.max(0, Math.ceil((start.getTime() - Date.now()) / 86_400_000));
const total = plannedPosts(shows);

const body = `Hi {{First_Name}},

${daysOut} days. Time to get moving.

You're on the board for ${dateLong} and your slot is locked. Here's the part that decides whether anyone is listening when you go on: the promotion, and it only works if we all do it.

What we're asking of every host:

${POSTS_BEFORE_PER_SHOW} posts before the day. Your slot, your time, your show. We've made the images for you — your share card is in your dashboard under Promotion, with your artwork and your on-air time already on it. Nothing to design.

${POSTS_AFTER_PER_SHOW} posts after the day. We cut clips from your slot automatically — vertical, square and wide, captions included — and they land in the same place. Your best moments, ready to post, without you opening an editor.

That's 8 posts each. Across ${shows} shows that's ${total.toLocaleString()} posts pointing at the same day, and it is the single biggest thing standing between this being a great broadcast and a great broadcast nobody watched.

Three things to do this week:

1. Grab your share card — dashboard, Promotion tab. Post it once this week.
2. Connect your social accounts if you haven't. That's how your clips reach you afterwards, and it puts follow buttons on your card in the public lineup.
3. Connect your YouTube if you want your slot going out on your own channel too. Optional, takes a minute, and it doubles your reach on the day for free.

Your dashboard: https://www.militaryvoice.ai/host/dashboard

If anything's in the way, reply to this and tell me. I'd rather fix it now than find out on the day.

Let's fill the room.`;

const now = new Date().toISOString();
const [row] = await sql`
  INSERT INTO broadcasts (event_id, subject, body_text, status, segment, sender, banner, source, created_at)
  VALUES (${event.id}, ${`${daysOut} days out — we need you posting, {{First_Name}}`}, ${body},
          'draft', 'signups', 'member:1', 'podcasters', 'manual', ${now})
  RETURNING id, subject, segment`;
await sql.end();

console.log(`Draft #${row.id} — "${row.subject}" → ${row.segment}`);
console.log(`${shows} shows · ${total} planned posts · ${daysOut} days out`);
console.log("Nothing sent. It's in admin → event → Templates.");
