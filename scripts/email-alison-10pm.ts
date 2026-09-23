// Riccoh confirms Alison at 10:00 PM Eastern (4:00 PM Hawaii), recorded.
//   npx tsx scripts/email-alison-10pm.ts [--apply]
import "dotenv/config";
import postgres from "postgres";
import { emailShell, EMAIL_BANNERS } from "../server/email";
const apply = process.argv.includes("--apply");
const BASE = process.env.PUBLIC_BASE_URL || "https://www.militaryvoice.ai";
const TO = "alison@alisonbellphotographer.com";
const SUBJECT = "Re: One more spot — a better hour for Hawaii";
const text = `Alison,

It's yours. Get Booked is on at 10:00 PM Eastern, 4:00 PM your time, on Monday, October 5, as a recorded episode. You don't need to be anywhere during the afternoon activities; we roll it for you.

One thing we need: the episode. Reply to this email with a link (YouTube, Google Drive, Dropbox or WeTransfer all work), or sign in to your dashboard and paste it under Event settings:

https://www.militaryvoice.ai/host/dashboard

Your slot is 25 minutes on air, so an episode of 25 minutes or less fits as it is. If it runs longer, send it anyway and we'll fit it.

You're the last show on the course before the closing ceremonies. Thank you for making it work.

Riccoh`;
const html = `<p>Alison,</p>
<p>It's yours. <strong>Get Booked is on at 10:00 PM Eastern, 4:00 PM your time, on Monday, October 5</strong>, as a recorded episode. You don't need to be anywhere during the afternoon activities; we roll it for you.</p>
<p>One thing we need: the episode. Reply to this email with a link (YouTube, Google Drive, Dropbox or WeTransfer all work), or sign in to your dashboard and paste it under Event settings: <a href="https://www.militaryvoice.ai/host/dashboard">militaryvoice.ai/host/dashboard</a></p>
<p>Your slot is 25 minutes on air, so an episode of 25 minutes or less fits as it is. If it runs longer, send it anyway and we'll fit it.</p>
<p>You're the last show on the course before the closing ceremonies. Thank you for making it work.</p>
<p>Riccoh</p>`;
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });
const [ev] = await sql<{ admin_password: string }[]>`SELECT admin_password FROM events WHERE id = 1`;
await sql.end();
console.log(`To: ${TO}\nSubject: ${SUBJECT}\n\n${text}\n`);
if (!apply) { console.log("Nothing sent. --apply to send."); process.exit(0); }
const res = await fetch(`${BASE}/api/admin/emails/send-one`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-admin-password": ev.admin_password },
  body: JSON.stringify({ to: TO, subject: SUBJECT, text, sender: "member:1", banner: "podcasters", html: emailShell({ banner: EMAIL_BANNERS.podcasters, eyebrow: "The Podcast Marathon · 5 October", heading: "10:00 PM Eastern is yours", body: html }) }),
});
console.log(res.ok ? `sent to ${TO}` : `FAILED ${res.status} ${await res.text()}`);
