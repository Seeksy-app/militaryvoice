// The follow-up: 8:00 AM Eastern is 2:00 AM in Hawaii. Riccoh offers his own
// 10:00 PM instead.
//
//   npx tsx scripts/email-alison-followup.ts --preview
//   npx tsx scripts/email-alison-followup.ts --apply
import "dotenv/config";
import postgres from "postgres";
import { emailShell, EMAIL_BANNERS } from "../server/email";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const BASE = process.env.PUBLIC_BASE_URL || "https://www.militaryvoice.ai";
const TO = "alison@alisonbellphotographer.com";

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });
const [ev] = await sql<{ start_at_utc: string; slot_minutes: number; admin_password: string }[]>`SELECT start_at_utc, slot_minutes, admin_password FROM events WHERE id = 1`;
const [riccoh] = await sql<{ slot_index: number }[]>`SELECT slot_index FROM signups WHERE event_id = 1 AND status <> 'cancelled' AND podcast_name ILIKE '%devil dawg%' LIMIT 1`;
await sql.end();
const when = (slot: number, zone: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone }).format(new Date(Date.parse(ev.start_at_utc) + slot * ev.slot_minutes * 60_000));
const time = `${when(riccoh.slot_index, "America/New_York")} Eastern (${when(riccoh.slot_index, "Pacific/Honolulu")} Hawaii)`;

const SUBJECT = "One more spot — a better hour for Hawaii";
const html = `<p>Alison,</p>
<p>After sending that last email, I realized 8:00 AM Eastern is 2:00 AM your time. That's no way to do a show.</p>
<p>I can give you my own spot instead: <strong>${time}</strong> on Monday, October 5.</p>
<p>Reply with a yes and I'll move you there myself — nothing for you to set up.</p>
<p>Riccoh</p>`;
const text = `Alison,

After sending that last email, I realized 8:00 AM Eastern is 2:00 AM your time. That's no way to do a show.

I can give you my own spot instead: ${time} on Monday, October 5.

Reply with a yes and I'll move you there myself — nothing for you to set up.

Riccoh`;

console.log(`To: ${TO}\nSubject: ${SUBJECT}\n\n${text}\n`);
if (!apply) { console.log("Nothing sent. --apply to send."); process.exit(0); }
const res = await fetch(`${BASE}/api/admin/emails/send-one`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-admin-password": ev.admin_password },
  body: JSON.stringify({ to: TO, subject: SUBJECT, text, sender: "member:1", banner: "podcasters", html: emailShell({ banner: EMAIL_BANNERS.podcasters, eyebrow: "The Podcast Marathon · 5 October", heading: SUBJECT, body: html }) }),
});
console.log(res.ok ? `sent to ${TO}` : `FAILED ${res.status} ${await res.text()}`);
