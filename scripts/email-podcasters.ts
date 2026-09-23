// The "we filled the course" email to every registered podcaster.
//
//   npx tsx scripts/email-podcasters.ts           # print it and the recipients
//   npx tsx scripts/email-podcasters.ts --apply   # send
//
// Sent one at a time through the server's own one-off route rather than the
// broadcast tool, because the broadcast tool attaches an unsubscribe footer
// and resolves an audience segment — right for marketing, wrong for an
// operational note to people who have already committed to a slot. The
// trade-off is no {{First_Name}} merge, so it opens plainly.
import "dotenv/config";
import postgres from "postgres";
import { emailShell, EMAIL_BANNERS } from "../server/email";

const API = process.env.MV_API ?? "https://militaryvoice.ai";
const SITE = "https://militaryvoice.ai";
const SUBJECT = "The course is full — 26.2 miles of storytelling";

const BODY_HTML = `<p>Hi there,</p>
<p>We've done what we set out to do. Every mile of the marathon is spoken for — <strong>26.2 miles of military and veteran storytelling</strong>, going out back to back on National Military Podcast Day, Monday 5 October.</p>
<p>Three things worth doing before the day:</p>
<ol>
  <li><strong>Add your social channels.</strong> They appear on your card in the lineup, so listeners who find you on the day can follow you. <a href="${SITE}/host/dashboard/integrations">Add them here</a>.</li>
  <li><strong>Turn on auto-post promotions.</strong> We'll push your slot out across your channels in the run-up, so you don't have to remember to. <a href="${SITE}/host/dashboard/promotion#section-autopost">Set it up here</a>.</li>
  <li><strong>Log in to the green room and check your audio and video.</strong> Ten minutes now is worth an hour on the day. <a href="${SITE}/studio">Open the studio</a>.</li>
</ol>
<p>See you on the start line,<br>MilitaryVoices.ai</p>`;

const BODY_TEXT = `Hi there,

We've done what we set out to do. Every mile of the marathon is spoken for - 26.2 miles of military and veteran storytelling, going out back to back on National Military Podcast Day, Monday 5 October.

Three things worth doing before the day:

1. Add your social channels. They appear on your card in the lineup, so listeners who find you on the day can follow you.
   ${SITE}/host/dashboard/integrations

2. Turn on auto-post promotions. We'll push your slot out across your channels in the run-up, so you don't have to remember to.
   ${SITE}/host/dashboard/promotion#section-autopost

3. Log in to the green room and check your audio and video. Ten minutes now is worth an hour on the day.
   ${SITE}/studio

See you on the start line,
MilitaryVoices.ai`;

async function main() {
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
  const [ev] = await sql`SELECT id, admin_password FROM events WHERE is_featured = true`;
  const rows = await sql`SELECT DISTINCT lower(email) AS email, host_name FROM signups
    WHERE event_id = ${ev.id} AND status <> 'cancelled' AND email <> 'hello@militaryvoice.ai' ORDER BY 1`;
  await sql.end();

  console.log(`Subject: ${SUBJECT}\n${"-".repeat(66)}\n${BODY_TEXT}\n${"-".repeat(66)}`);
  console.log(`\n${rows.length} recipients:`);
  for (const r of rows as any[]) console.log(`  ${String(r.host_name || "").padEnd(26)} ${r.email}`);

  const test = process.argv.includes("--test");
  if (!process.argv.includes("--apply") && !test) { console.log("\nDry run — pass --test to send one, --apply to send all."); return; }

  const html = emailShell({
    banner: EMAIL_BANNERS.podcasters,
    eyebrow: "The Podcast Marathon · 5 October",
    heading: "The course is full",
    body: BODY_HTML,
    cta: { href: `${SITE}/agenda`, label: "See the full line-up" },
  });

  // A test goes to the owner, not to a podcaster. Sending the real thing to a
  // real recipient to "check it" is a send you cannot take back.
  const targets = test ? [{ email: "andrew@podlogix.co", host_name: "Andrew (test)" }] : (rows as any[]);
  let sent = 0, failed = 0;
  for (const r of targets as any[]) {
    const res = await fetch(`${API}/api/admin/emails/send-one`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-password": ev.admin_password },
      body: JSON.stringify({ to: r.email, subject: SUBJECT, html, text: BODY_TEXT }),
    });
    res.ok ? sent++ : failed++;
    console.log(`${res.ok ? "sent" : `FAILED ${res.status}`} → ${r.email}`);
    await new Promise((x) => setTimeout(x, 250)); // don't hammer the provider
  }
  console.log(`\n${sent} sent, ${failed} failed.`);
}
main();
