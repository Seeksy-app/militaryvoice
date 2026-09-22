// The time moved under Alison without a proper heads-up, and she asked for a
// cancel or a way to reschedule. From Riccoh: two spots on offer, times only.
//
//   npx tsx scripts/email-alison-reschedule.ts             # dry run
//   npx tsx scripts/email-alison-reschedule.ts --preview   # read it
//   npx tsx scripts/email-alison-reschedule.ts --test      # one copy to Andrew
//   npx tsx scripts/email-alison-reschedule.ts --apply     # send it
import "dotenv/config";
import postgres from "postgres";
import { emailShell, EMAIL_BANNERS } from "../server/email";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const test = args.includes("--test");
const preview = args.includes("--preview");
const BASE = process.env.PUBLIC_BASE_URL || "https://www.militaryvoice.ai";
const API = process.env.API_BASE || BASE;
const TO = "alison@alisonbellphotographer.com";

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });
const [ev] = await sql<{ start_at_utc: string; slot_minutes: number; admin_password: string }[]>`
  SELECT start_at_utc, slot_minutes, admin_password FROM events WHERE id = 1`;
const [alison] = await sql<{ slot_index: number }[]>`SELECT slot_index FROM signups WHERE event_id = 1 AND lower(email) = ${TO} ORDER BY id DESC LIMIT 1`;
const [zach] = await sql<{ slot_index: number }[]>`SELECT slot_index FROM signups WHERE event_id = 1 AND status <> 'cancelled' AND podcast_name ILIKE '%warrior legacy%' LIMIT 1`;
const [riccoh] = await sql<{ slot_index: number }[]>`SELECT slot_index FROM signups WHERE event_id = 1 AND status <> 'cancelled' AND podcast_name ILIKE '%devil dawg%' LIMIT 1`;
await sql.end();
if (!alison || !zach || !riccoh) { console.log("Could not find the three slots."); process.exit(1); }

const when = (slot: number, zone: string) =>
  new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone })
    .format(new Date(Date.parse(ev.start_at_utc) + slot * ev.slot_minutes * 60_000));
const both = (slot: number) => `${when(slot, "America/New_York")} Eastern (${when(slot, "Pacific/Honolulu")} Hawaii)`;
const current = both(alison.slot_index);
const early = both(zach.slot_index);

const SUBJECT = "Sorry about the time change — one other spot for you";

const html = `<p>Alison,</p>

<p>You're right, and I'm sorry. The schedule moved and your time changed to ${current}
without a proper heads-up first. That's on us.</p>

<p>I don't want to lose <em>Get Booked</em> from the day. The one spot I can give you on
Monday, October 5 is <strong>${early}</strong>. That's all we have.</p>

<p>Reply with a yes and I'll move you there myself — nothing for you to set up. If it
doesn't work, say so and I'll take you off the lineup, no hard feelings.</p>

<p>Riccoh</p>`;

const text = `Alison,

You're right, and I'm sorry. The schedule moved and your time changed to ${current} without a proper heads-up first. That's on us.

I don't want to lose Get Booked from the day. The one spot I can give you on Monday, October 5 is ${early}. That's all we have.

Reply with a yes and I'll move you there myself — nothing for you to set up. If it doesn't work, say so and I'll take you off the lineup, no hard feelings.

Riccoh`;

console.log(`To: ${TO}`);
if (preview) console.log(`\nFrom: Riccoh\nSubject: ${SUBJECT}\n\n${text}`);
if (!test && !apply) { console.log(`\nNothing sent. --preview to read it, --test for one copy, --apply to send.`); process.exit(0); }

const dest = test ? "andrew@podlogix.co" : TO;
const res = await fetch(`${API}/api/admin/emails/send-one`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-admin-password": ev.admin_password },
  body: JSON.stringify({
    to: dest, subject: SUBJECT, text, sender: "member:1", banner: "podcasters",
    html: emailShell({ banner: EMAIL_BANNERS.podcasters, eyebrow: "The Podcast Marathon · 5 October", heading: SUBJECT, body: html }),
  }),
});
console.log(res.ok ? `sent to ${dest}` : `FAILED ${res.status} ${await res.text()}`);
