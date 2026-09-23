// Frank: the dashboard would not load. Fixed; Michael says so, with the way in.
//   npx tsx scripts/email-michael-frank-2.ts --apply
import "dotenv/config";
import postgres from "postgres";
import { emailShell, EMAIL_BANNERS } from "../server/email";
const apply = process.argv.includes("--apply");
const API = process.env.API_BASE || "https://www.militaryvoice.ai";
const TO = "frankzaccari@gmail.com";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });
const [ev] = await sql<{ admin_password: string }[]>`SELECT admin_password FROM events WHERE id = 1`;
const [inb] = await sql<{ id: number; message_id: string; subject: string }[]>`SELECT id, message_id, subject FROM inbound_emails WHERE from_email = ${TO} AND body_text ILIKE '%will not load%' ORDER BY id DESC LIMIT 1`;
const SUBJECT = "Re: Your segment can have a sponsor — and you earn from it";
const text = `Frank,

Sorry about that — that one was on us. A change we made this morning broke the sign-in screen, and it's fixed now.

Give it another go:

1. Go to https://www.militaryvoice.ai/host/dashboard and sign in with this address. We email you a 6-digit code; no password.
2. Click Integrations, then Connect YouTube.
3. Google will show a screen that says the app isn't verified yet. That's expected — we're in Google's review queue. Click Advanced, then "Go to MilitaryVoices.ai", and you're through.

If it gives you any trouble at all, reply here and I'll sort it with you.

Michael
Producer · The Podcast Marathon
michael@militaryvoice.ai`;
const html = `<p>Frank,</p>
<p>Sorry about that — that one was on us. A change we made this morning broke the sign-in screen, and it's fixed now.</p>
<p>Give it another go:</p>
<ol>
  <li>Go to <a href="https://www.militaryvoice.ai/host/dashboard">militaryvoice.ai/host/dashboard</a> and sign in with this address. We email you a 6-digit code; no password.</li>
  <li>Click <strong>Integrations</strong>, then <strong>Connect YouTube</strong>.</li>
  <li>Google will show a screen that says the app isn't verified yet. That's expected — we're in Google's review queue. Click <strong>Advanced</strong>, then <strong>Go to MilitaryVoices.ai</strong>, and you're through.</li>
</ol>
<p>If it gives you any trouble at all, reply here and I'll sort it with you.</p>
<p>Michael<br><span style="color:#5b6478">Producer · The Podcast Marathon<br>michael@militaryvoice.ai</span></p>`;
console.log(`To: ${TO}\nIn-Reply-To: ${inb?.message_id || "(none)"}\n\n${text}\n`);
if (!apply) { await sql.end(); console.log("Nothing sent. --apply to send."); process.exit(0); }
const res = await fetch(`${API}/api/admin/emails/send-one`, {
  method: "POST", headers: { "content-type": "application/json", "x-admin-password": ev.admin_password },
  body: JSON.stringify({ to: TO, subject: SUBJECT, text, sender: "member:3", banner: "podcasters", from: "Michael <michael@militaryvoice.ai>", replyTo: "michael@militaryvoice.ai", inReplyTo: inb?.message_id || undefined,
    html: emailShell({ banner: EMAIL_BANNERS.podcasters, eyebrow: "The Podcast Marathon · 5 October", heading: "Fixed — try the dashboard again", body: html }) }),
});
const body = await res.json().catch(() => ({}));
console.log(res.ok ? `sent to ${TO} (${body.id})` : `FAILED ${res.status} ${body.message ?? ""}`);
if (res.ok && inb) await sql`UPDATE inbound_emails SET status = 'sent', replied_at = ${new Date().toISOString()}, reply_from = 'michael', reply_resend_id = ${body.id ?? ""}, reply_text = ${text} WHERE id = ${inb.id}`;
await sql.end();
