// The sponsor rev-share offer, from Riccoh.
//
//   npx tsx scripts/email-sponsor-share.ts            # who it would go to
//   npx tsx scripts/email-sponsor-share.ts --preview  # read it
//   npx tsx scripts/email-sponsor-share.ts --test     # one copy to Andrew
//   npx tsx scripts/email-sponsor-share.ts --apply    # send it
//
// A campaign, not a cadence step: one send, with a deadline, and no reason to
// ever repeat it.
//
// Why it is from Riccoh and not "the team": he is asking thirty-one people to
// do sales work on his behalf, and that is a thing a person asks, not a brand.
//
// Why the percentages differ by tier: paying only on the $250 slot would make
// a podcaster with a $2,500 contact route them into the cheap tier, because
// that is where their cut is. Ten percent of Supporting pays more than half a
// show slot, so the incentive points up the card rather than down it.
import "dotenv/config";
import postgres from "postgres";
import { emailShell, EMAIL_BANNERS } from "../server/email";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const test = args.includes("--test");
const preview = args.includes("--preview");
const BASE = process.env.PUBLIC_BASE_URL || "https://www.militaryvoice.ai";
const API = process.env.API_BASE || BASE;
const DEADLINE = "Tuesday 30 September";

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });

interface Row { email: string; host_name: string; podcast_name: string }

const rows = await sql<Row[]>`
  SELECT DISTINCT ON (s.email) s.email, s.host_name, s.podcast_name
  FROM signups s
  WHERE s.event_id = 1 AND s.status <> 'cancelled' AND s.email <> ''
  ORDER BY s.email, s.slot_index`;

const SUBJECT = "Your segment can have a sponsor — and half of it is yours";

function body(r: Row): string {
  const first = (r.host_name || "").trim().split(/\s+/)[0] || "there";
  return `<p>${first},</p>

<p>Riccoh here. Quick one, and there's money in it for you.</p>

<p>We're putting a sponsor on each segment of the marathon — named on air,
on the agenda, and on the "coming up next" card that runs before your show.
It's <strong>$250</strong> a segment.</p>

<p><strong>If you bring the sponsor, you keep half.</strong> $125, for making an
introduction. You don't have to sell anything or negotiate anything — send me
a name and I'll take it from there.</p>

<p>And if the person you introduce wants something bigger than one segment,
you get ten percent of whatever they take:</p>

<table style="margin:0 0 20px;border-collapse:collapse;font-size:15px;color:#374151">
  <tr><td style="padding:6px 18px 6px 0"><strong>Your segment</strong> · $250</td><td style="padding:6px 0"><strong>you keep $125</strong></td></tr>
  <tr><td style="padding:6px 18px 6px 0">Supporting sponsor · $2,500</td><td style="padding:6px 0"><strong>you keep $250</strong></td></tr>
  <tr><td style="padding:6px 18px 6px 0">Live stream sponsor · $5,000</td><td style="padding:6px 0"><strong>you keep $500</strong></td></tr>
  <tr><td style="padding:6px 18px 6px 0">Partner sponsor · $10,000</td><td style="padding:6px 0"><strong>you keep $1,000</strong></td></tr>
</table>

<p>You'll notice the bigger ones pay you more than your own segment does. That's
deliberate — if you know somebody who should be doing more than $250, I don't
want you talking them down to fit the cheap slot.</p>

<p>Who to think of: anyone who already advertises with you, the veteran-owned
business you actually rate, a company that's been trying to reach this audience
and hasn't worked out how. It doesn't have to be big.</p>

<p><strong>Reply to this email with a name and I'll do the rest.</strong> I need
them by <strong>${DEADLINE}</strong> so their artwork makes the graphics and the
run of show.</p>

<p>Paid out in one go the week after the event.</p>

<p>Riccoh</p>`;
}

function textOf(r: Row): string {
  const first = (r.host_name || "").trim().split(/\s+/)[0] || "there";
  return `${first},

Riccoh here. Quick one, and there's money in it for you.

We're putting a sponsor on each segment of the marathon — named on air, on the agenda, and on the "coming up next" card before your show. It's $250 a segment.

If you bring the sponsor, you keep half. $125, for making an introduction. You don't have to sell or negotiate anything — send me a name and I'll take it from there.

If the person you introduce wants something bigger, you get ten percent:

  Your segment          $250     you keep $125
  Supporting sponsor    $2,500   you keep $250
  Live stream sponsor   $5,000   you keep $500
  Partner sponsor       $10,000  you keep $1,000

The bigger ones pay you more than your own segment does. That's deliberate — if you know somebody who should be doing more than $250, I don't want you talking them down to fit the cheap slot.

Who to think of: anyone who already advertises with you, the veteran-owned business you actually rate, a company that's been trying to reach this audience and hasn't worked out how. It doesn't have to be big.

Reply to this email with a name and I'll do the rest. I need them by ${DEADLINE} so their artwork makes the graphics and the run of show.

Paid out in one go the week after the event.

Riccoh`;
}

function htmlFor(r: Row): string {
  return emailShell({
    banner: EMAIL_BANNERS.podcasters,
    eyebrow: "The Podcast Marathon · 5 October",
    heading: "Bring a sponsor, keep half",
    body: body(r),
  });
}

console.log(`${rows.length} podcasters\n`);
for (const r of rows) console.log(`   ${r.email.padEnd(34)} ${r.podcast_name.slice(0, 38)}`);

if (preview) {
  console.log("\n──────── as the first person on the list will read it ────────\n");
  console.log(`From: Riccoh\nSubject: ${SUBJECT}\n`);
  console.log(textOf(rows[0]));
}

if (!test && !apply) {
  console.log(`\nNothing sent. --preview to read it, --test for one copy, --apply to send all ${rows.length}.`);
  await sql.end();
  process.exit(0);
}

const [ev] = await sql<{ admin_password: string }[]>`SELECT admin_password FROM events WHERE id = 1`;
// A test goes to the owner, never to a podcaster.
const to = test ? [{ ...rows[0], email: "andrew@podlogix.co" }] : rows;
console.log(`\nSending ${to.length}…`);
let sent = 0;
let failed = 0;
for (const r of to) {
  const res = await fetch(`${API}/api/admin/emails/send-one`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-password": ev.admin_password },
    body: JSON.stringify({ to: r.email, subject: SUBJECT, html: htmlFor(r), text: textOf(r) }),
  });
  res.ok ? sent++ : failed++;
  console.log(`  ${res.ok ? "sent  " : `FAILED ${res.status}`} ${r.email}`);
  await new Promise((x) => setTimeout(x, 250));
}
console.log(`\n${sent} sent, ${failed} failed.`);
await sql.end();
