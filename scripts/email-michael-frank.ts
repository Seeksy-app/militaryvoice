// Michael introduces himself to Frank, from his own address, threaded under
// Frank's reply to the sponsor email.
//
//   npx tsx scripts/email-michael-frank.ts             # preview
//   npx tsx scripts/email-michael-frank.ts --apply     # send
import "dotenv/config";
import postgres from "postgres";
import { emailShell, EMAIL_BANNERS } from "../server/email";

const apply = process.argv.includes("--apply");
const API = process.env.API_BASE || "https://www.militaryvoice.ai";
const TO = "frankzaccari@gmail.com";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });
const [ev] = await sql<{ admin_password: string }[]>`SELECT admin_password FROM events WHERE id = 1`;
const [inb] = await sql<{ id: number; message_id: string; subject: string }[]>`SELECT id, message_id, subject FROM inbound_emails WHERE from_email = ${TO} ORDER BY id DESC LIMIT 1`;

const SUBJECT = inb?.subject?.startsWith("Re:") ? inb.subject : "Re: Your segment can have a sponsor — and you earn from it";
const text = `Frank,

No problem at all — the segment is yours either way, sponsor or not.

I'm Michael, the producer for The Podcast Marathon on October 5. I'll be the one in the green room bringing you to the stage and making sure your segment goes out clean. I'm excited to work with you.

Feel free to send me any questions between now and the day — this address comes straight to me.

Michael
Producer · The Podcast Marathon
michael@militaryvoice.ai`;
const html = `<p>Frank,</p>
<p>No problem at all — the segment is yours either way, sponsor or not.</p>
<p>I'm Michael, the producer for <strong>The Podcast Marathon</strong> on October 5. I'll be the one in the green room bringing you to the stage and making sure your segment goes out clean. I'm excited to work with you.</p>
<p>Feel free to send me any questions between now and the day — this address comes straight to me.</p>
<p>Michael<br><span style="color:#5b6478">Producer · The Podcast Marathon<br>michael@militaryvoice.ai</span></p>`;

console.log(`To: ${TO}\nFrom: Michael <michael@militaryvoice.ai>\nSubject: ${SUBJECT}\nIn-Reply-To: ${inb?.message_id || "(none)"}\n\n${text}\n`);
if (!apply) { await sql.end(); console.log("Nothing sent. --apply to send."); process.exit(0); }
const res = await fetch(`${API}/api/admin/emails/send-one`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-admin-password": ev.admin_password },
  body: JSON.stringify({
    to: TO, subject: SUBJECT, text, sender: "team", banner: "podcasters",
    from: "Michael <michael@militaryvoice.ai>", replyTo: "michael@militaryvoice.ai", inReplyTo: inb?.message_id || undefined,
    html: emailShell({ banner: EMAIL_BANNERS.podcasters, eyebrow: "The Podcast Marathon · 5 October", heading: "Hello from your producer", body: html }),
  }),
});
const body = await res.json().catch(() => ({}));
console.log(res.ok ? `sent to ${TO} (${body.id})` : `FAILED ${res.status} ${body.message ?? ""}`);
if (res.ok && inb) await sql`UPDATE inbound_emails SET status = 'sent', replied_at = ${new Date().toISOString()}, reply_from = 'michael', reply_resend_id = ${body.id ?? ""}, reply_text = ${text} WHERE id = ${inb.id}`;
await sql.end();
