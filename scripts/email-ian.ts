// Reply to Ian's help-chat question about the social connection error.
//
//   npx tsx scripts/email-ian.ts           # print it
//   npx tsx scripts/email-ian.ts --apply   # send
//
// Deliberately vague about the cause. "Our social-linking vendor is at 25 of
// 25 profiles on the professional plan" is true, is our problem, and tells a
// podcaster nothing he can act on — it just makes the platform he has trusted
// with his show sound rickety a fortnight out.
import "dotenv/config";
import postgres from "postgres";
import { emailShell, EMAIL_BANNERS } from "../server/email";

const API = process.env.MV_API ?? "https://militaryvoice.ai";
const TO = "ian@coldwarconversations.com";
const SUBJECT = "Fixed — you can connect your accounts now";

const html = emailShell({
  banner: EMAIL_BANNERS.conversation,
  eyebrow: "The Podcast Marathon · 5 October",
  heading: "Fixed — give it another go",
  body: `<p>Hi Ian,</p>
<p>Thanks for flagging that error. It wasn't anything you did and it wasn't your account — it was a limit on our side that stopped the connection page from opening. That's sorted now, and we've tested it on your account specifically.</p>
<p>Head back to <strong>Integrations</strong> in your dashboard and hit connect again. It should take you straight through to the platform picker.</p>
<p>If it still gives you trouble, just reply with your handles and we'll add them to your card by hand — it's optional either way, and it has no bearing on your slot. <strong>Cold War Conversations is confirmed at Mile 11, 12:30 PM ET on Monday, 5 October.</strong></p>
<p>Sorry for the run-around,<br>MilitaryVoices.ai</p>`,
  cta: { href: "https://militaryvoice.ai/host/dashboard/integrations", label: "Connect your accounts" },
});

const text = `Hi Ian,

Thanks for flagging that error. It wasn't anything you did and it wasn't your account - it was a limit on our side that stopped the connection page from opening. That's sorted now, and we've tested it on your account specifically.

Head back to Integrations in your dashboard and hit connect again. It should take you straight through to the platform picker.

If it still gives you trouble, just reply with your handles and we'll add them to your card by hand - it's optional either way, and it has no bearing on your slot. Cold War Conversations is confirmed at Mile 11, 12:30 PM ET on Monday, 5 October.

Sorry for the run-around,
MilitaryVoices.ai

Connect your accounts: https://militaryvoice.ai/host/dashboard/integrations`;

async function main() {
  console.log(`To:      ${TO}\nSubject: ${SUBJECT}\n${"-".repeat(64)}\n${text}\n${"-".repeat(64)}`);
  if (!process.argv.includes("--apply")) { console.log("Dry run — pass --apply to send."); return; }
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
  const [ev] = await sql`SELECT admin_password FROM events WHERE is_featured = true`;
  await sql.end();
  const res = await fetch(`${API}/api/admin/emails/send-one`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-password": ev.admin_password },
    body: JSON.stringify({ to: TO, subject: SUBJECT, html, text, replyTo: "hello@militaryvoice.ai" }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  console.log(res.ok ? `sent → ${TO}  (${body.id})` : `FAILED ${res.status} ${body.message ?? ""}`);
}

main();
