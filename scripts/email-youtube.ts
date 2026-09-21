// "Your show on your own YouTube, too" — how to connect, and the choice.
//
//   npx tsx scripts/email-youtube.ts            # who it would go to
//   npx tsx scripts/email-youtube.ts --preview  # read it
//   npx tsx scripts/email-youtube.ts --test     # one copy to Andrew
//   npx tsx scripts/email-youtube.ts --apply    # send it
//
// From the team, not Riccoh: it is instructions, not an ask between hosts.
import "dotenv/config";
import postgres from "postgres";
import { emailShell, EMAIL_BANNERS } from "../server/email";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const test = args.includes("--test");
const preview = args.includes("--preview");
const BASE = process.env.PUBLIC_BASE_URL || "https://www.militaryvoice.ai";
const API = process.env.API_BASE || BASE;

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });
interface Row { email: string; host_name: string; podcast_name: string; slot_index: number }
const [ev] = await sql<{ start_at_utc: string; slot_minutes: number; duration_hours: number; admin_password: string }[]>`
  SELECT start_at_utc, slot_minutes, duration_hours, admin_password FROM events WHERE id = 1`;
const total = Math.floor((ev.duration_hours * 60) / ev.slot_minutes);
const rows = await sql<Row[]>`
  SELECT DISTINCT ON (s.email) s.email, s.host_name, s.podcast_name, s.slot_index FROM signups s
  WHERE s.event_id = 1 AND s.status <> 'cancelled' AND s.email <> '' AND s.slot_index < ${total}
  ORDER BY s.email, s.slot_index`;
const at = (i: number) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
  .format(new Date(Date.parse(ev.start_at_utc) + i * ev.slot_minutes * 60_000));

const SUBJECT = "Your slot on your own YouTube, too";
const LINK = `${BASE}/host/dashboard/integrations`;

function body(r: Row): string {
  const first = (r.host_name || "").trim().split(/\s+/)[0] || "there";
  return `<p>${first},</p>

<p>Your slot airs on MilitaryVoice.ai on 5 October. If you'd like it on
<strong>your own YouTube channel as well</strong> — live, to your audience, at
the same time — it's one button. No stream key to find.</p>

<ol style="padding-left:20px;margin:0 0 18px">
  <li style="margin:0 0 8px">Sign in to your dashboard and open <strong>Integrations</strong>.</li>
  <li style="margin:0 0 8px">Press <strong>Connect YouTube</strong> and allow it. Use the Google account that owns your channel.
    <br><img src="${BASE}/email/connect-youtube.png" alt="The Going out live card on the Integrations page, with the Connect YouTube button" width="560" style="display:block;width:100%;max-width:560px;height:auto;margin:10px 0 4px;border:1px solid #e5e7eb;border-radius:10px"></li>
  <li style="margin:0 0 8px">Answer one question: <strong>just my segment</strong> (${at(r.slot_index)} ET), or <strong>the entire show</strong> — all sixteen hours on your channel too.</li>
</ol>

<p style="margin:22px 0"><a href="${LINK}" style="background:#053877;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700;display:inline-block">Connect my YouTube</a></p>

<p><strong>One screen will look alarming.</strong> Google shows
"Google hasn't verified this app" when you connect. That's us — our
verification with Google is in review and hasn't come back yet. Three
presses get you through it:</p>

<p style="margin:0 0 4px"><strong>1.</strong> Press <strong>Advanced</strong>.</p>
<img src="${BASE}/email/google-1.png" alt="Google's warning screen: press Advanced" width="560" style="display:block;width:100%;max-width:560px;height:auto;margin:0 0 14px;border:1px solid #e5e7eb;border-radius:10px">
<p style="margin:0 0 4px"><strong>2.</strong> Press <strong>Go to Military Voice (unsafe)</strong>. It isn't — that word is Google's default until the review is done.</p>
<img src="${BASE}/email/google-2.png" alt="Press Go to Military Voice" width="560" style="display:block;width:100%;max-width:560px;height:auto;margin:0 0 14px;border:1px solid #e5e7eb;border-radius:10px">
<p style="margin:0 0 4px"><strong>3.</strong> Press <strong>Continue</strong>.</p>
<img src="${BASE}/email/google-3.png" alt="Press Continue on the permission screen" width="560" style="display:block;width:100%;max-width:560px;height:auto;margin:0 0 18px;border:1px solid #e5e7eb;border-radius:10px">

<p>The permission only lets us open a live broadcast on your channel at your
booked time; we can't post, edit or read anything else.</p>

<p>Two more things. Your channel needs live streaming switched on — YouTube
asks for a verified phone number and takes up to 24 hours the first time, so
do it this week, not on the day. And YouTube is the only place we can send to
directly; Facebook, LinkedIn and X don't allow it without a third-party tool —
reply if you want one of those and we'll set it up with you.</p>

<p>Optional, of course. Your slot goes out on MilitaryVoice.ai either way.</p>

<p>The MilitaryVoice.ai team</p>`;
}
function textOf(r: Row): string {
  const first = (r.host_name || "").trim().split(/\s+/)[0] || "there";
  return `${first},

Your slot airs on MilitaryVoice.ai on 5 October. If you'd like it on your own YouTube channel as well — live, to your audience, at the same time — it's one button. No stream key to find.

1. Sign in to your dashboard and open Integrations.
2. Press Connect YouTube and allow it. Use the Google account that owns your channel.
3. Answer one question: just my segment (${at(r.slot_index)} ET), or the entire show — all sixteen hours on your channel too.

${LINK}

One screen will look alarming. Google shows "Google hasn't verified this app" when you connect. That's us — our verification with Google is in review and hasn't come back yet. Three presses get you through it: Advanced, then "Go to Military Voice (unsafe)" — it isn't, that word is Google's default until the review is done — then Continue. The permission only lets us open a live broadcast on your channel at your booked time; we can't post, edit or read anything else.

Two more things. Your channel needs live streaming switched on — YouTube asks for a verified phone number and takes up to 24 hours the first time, so do it this week, not on the day. And YouTube is the only place we can send to directly; Facebook, LinkedIn and X don't allow it without a third-party tool — reply if you want one of those and we'll set it up with you.

Optional, of course. Your slot goes out on MilitaryVoice.ai either way.

The MilitaryVoice.ai team`;
}
const htmlFor = (r: Row) => emailShell({ banner: EMAIL_BANNERS.podcasters, eyebrow: "The Podcast Marathon · 5 October", heading: SUBJECT, body: body(r) });

console.log(`${rows.length} podcasters\n`);
for (const r of rows) console.log(`   ${r.email.padEnd(34)} ${r.podcast_name.slice(0, 38)}`);
if (preview) { console.log("\n──────── as the first person will read it ────────\n"); console.log(`From: MilitaryVoice.ai\nSubject: ${SUBJECT}\n\n${textOf(rows[0])}`); }
// --html <path>: the rendered email, to look at in a browser.
const htmlAt = args[args.indexOf("--html") + 1];
if (args.includes("--html") && htmlAt) { (await import("node:fs")).writeFileSync(htmlAt, htmlFor(rows[0])); console.log(`\nHTML written to ${htmlAt}`); }
if (!test && !apply) { console.log(`\nNothing sent. --preview to read it, --test for one copy, --apply to send all ${rows.length}.`); await sql.end(); process.exit(0); }
const to = test ? [{ ...rows[0], email: "andrew@podlogix.co" }] : rows;
let sent = 0, failed = 0;
for (const r of to) {
  const res = await fetch(`${API}/api/admin/emails/send-one`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-password": ev.admin_password },
    body: JSON.stringify({ to: r.email, subject: SUBJECT, html: htmlFor(r), text: textOf(r), sender: "team", banner: "podcasters" }),
  });
  res.ok ? sent++ : failed++;
  console.log(`  ${res.ok ? "sent  " : `FAILED ${res.status}`} ${r.email}`);
  await new Promise((x) => setTimeout(x, 250));
}
console.log(`\n${sent} sent, ${failed} failed.`);
await sql.end();
