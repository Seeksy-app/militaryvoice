// Fourteen days out: the co-host ask.
//
// One ask, on its own. MilCrunch Formation was in here too and went to its
// own email — two offers in one message means the reader picks the easier one
// to ignore, and a co-host is the thing we actually need an answer on.
//
//   npx tsx scripts/email-cohost.ts            # who it would go to
//   npx tsx scripts/email-cohost.ts --preview  # read it
//   npx tsx scripts/email-cohost.ts --test     # one copy to Andrew
//   npx tsx scripts/email-cohost.ts --apply    # send it
//
// The countdown is computed, not typed. "14 days away" written into the copy
// is wrong the moment it sends a day late, and an email that opens with a
// number the reader can check against their own calendar is the wrong place
// to be approximately right.
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

const [ev] = await sql<{ start_at_utc: string; admin_password: string }[]>`
  SELECT start_at_utc, admin_password FROM events WHERE id = 1`;

// Whole days, counted from today in the event's own zone rather than UTC —
// otherwise the number flips at 8pm Eastern rather than midnight.
const dayIn = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const daysOut = Math.round(
  (Date.parse(`${dayIn(new Date(ev.start_at_utc))}T12:00:00Z`) - Date.parse(`${dayIn(new Date())}T12:00:00Z`)) / 86400_000,
);
const countdown =
  daysOut > 1 ? `${daysOut} days away` : daysOut === 1 ? "tomorrow" : daysOut === 0 ? "today" : "behind us";

interface Row { email: string; host_name: string; podcast_name: string }

const rows = await sql<Row[]>`
  SELECT DISTINCT ON (s.email) s.email, s.host_name, s.podcast_name
  FROM signups s
  WHERE s.event_id = 1 AND s.status <> 'cancelled' AND s.email <> ''
  ORDER BY s.email, s.slot_index`;

const SUBJECT = `National Military Podcast Day is ${countdown}`;

function body(r: Row): string {
  const first = (r.host_name || "").trim().split(/\s+/)[0] || "there";
  return `<p>${first},</p>

<p>The National Military Podcast Day Marathon is <strong>${countdown}</strong>.
Twenty-six point two miles of military and veteran podcasts, back to back, and
you're one of them.</p>

<p><strong>Would you like to co-host?</strong></p>

<p>Not just your own segment — time on the main stage between shows.
Introducing what's coming up, talking about the day, keeping the thing moving.
As much or as little of the day as suits you.</p>

<p>If that sounds like you, reply and tell me, and we'll work out where you'd
fit.</p>

<p>Fourteen days. See you at the start line.</p>

<p>Riccoh</p>`;
}

function textOf(r: Row): string {
  const first = (r.host_name || "").trim().split(/\s+/)[0] || "there";
  return `${first},

The National Military Podcast Day Marathon is ${countdown}. Twenty-six point two miles of military and veteran podcasts, back to back, and you're one of them.

Would you like to co-host?

Not just your own segment — time on the main stage between shows. Introducing what's coming up, talking about the day, keeping the thing moving. As much or as little of the day as suits you.

If that sounds like you, reply and tell me, and we'll work out where you'd fit.

Fourteen days. See you at the start line.

Riccoh`;
}

function htmlFor(r: Row): string {
  return emailShell({
    banner: EMAIL_BANNERS.podcasters,
    eyebrow: "The Podcast Marathon · 5 October",
    heading: `${countdown[0].toUpperCase()}${countdown.slice(1)}`,
    body: body(r),
  });
}

console.log(`${rows.length} podcasters · event is ${countdown}\n`);
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
