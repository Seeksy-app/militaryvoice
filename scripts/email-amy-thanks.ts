// Riccoh thanks Amy for her title and her offer to find co-hosts.
//   npx tsx scripts/email-amy-thanks.ts [--apply]
import "dotenv/config";
import postgres from "postgres";
import { emailShell, EMAIL_BANNERS } from "../server/email";
const apply = process.argv.includes("--apply");
const BASE = process.env.PUBLIC_BASE_URL || "https://www.militaryvoice.ai";
const TO = "amyusd@gmail.com";
const SUBJECT = "Re: Your title as co-host";
const text = `Amy,

Thank you. "Author and Veteran Advocate" is on the homepage now, right beside your photo.

And thank you for asking around for co-hosts for your hours. Send names whenever you have them and we'll set each one up.

Safe travels in Tampa.

Riccoh`;
const html = `<p>Amy,</p>
<p>Thank you. <strong>"Author and Veteran Advocate"</strong> is on the homepage now, right beside your photo: <a href="https://www.militaryvoice.ai/">militaryvoice.ai</a></p>
<p>And thank you for asking around for co-hosts for your hours. Send names whenever you have them and we'll set each one up.</p>
<p>Safe travels in Tampa.</p>
<p>Riccoh</p>`;
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });
const [ev] = await sql<{ admin_password: string }[]>`SELECT admin_password FROM events WHERE id = 1`;
await sql.end();
console.log(`To: ${TO}\nSubject: ${SUBJECT}\n\n${text}\n`);
if (!apply) { console.log("Nothing sent. --apply to send."); process.exit(0); }
const res = await fetch(`${BASE}/api/admin/emails/send-one`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-admin-password": ev.admin_password },
  body: JSON.stringify({ to: TO, subject: SUBJECT, text, sender: "member:1", banner: "podcasters", html: emailShell({ banner: EMAIL_BANNERS.podcasters, eyebrow: "The Podcast Marathon · 5 October", heading: "Thank you, Amy", body: html }) }),
});
console.log(res.ok ? `sent to ${TO}` : `FAILED ${res.status} ${await res.text()}`);
