// "Pick your co-host hour" — to the people who said yes.
//
//   npx tsx scripts/email-cohost-slots.ts a@b.com c@d.com            # who, and a dry run
//   npx tsx scripts/email-cohost-slots.ts a@b.com --preview          # read it
//   npx tsx scripts/email-cohost-slots.ts a@b.com --test             # one copy to Andrew
//   npx tsx scripts/email-cohost-slots.ts a@b.com c@d.com --apply    # send it
//
// Addresses are given on the command line, deliberately: this goes to the
// podcasters who replied to the co-host ask, and that list lives in Riccoh's
// inbox, not in a column. Each address must be on the lineup.
import "dotenv/config";
import postgres from "postgres";
import { emailShell, EMAIL_BANNERS } from "../server/email";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const test = args.includes("--test");
const preview = args.includes("--preview");
const wanted = args.filter((a) => !a.startsWith("--")).map((a) => a.trim().toLowerCase());
const BASE = process.env.PUBLIC_BASE_URL || "https://www.militaryvoice.ai";
const API = process.env.API_BASE || BASE;

if (!wanted.length) {
  console.log("Give me at least one address — the people who said yes to co-hosting.");
  process.exit(1);
}

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });

interface Row { email: string; host_name: string; podcast_name: string }
const rows = await sql<Row[]>`
  SELECT DISTINCT ON (s.email) s.email, s.host_name, s.podcast_name
  FROM signups s
  WHERE s.event_id = 1 AND s.status <> 'cancelled' AND lower(s.email) = ANY(${wanted})
  ORDER BY s.email, s.slot_index`;
const missing = wanted.filter((w) => !rows.some((r) => r.email.toLowerCase() === w));
if (missing.length) console.log(`Not on the lineup, skipped: ${missing.join(", ")}\n`);

const SUBJECT = "Pick your co-host hour";
const LINK = `${BASE}/host/dashboard`;

function body(r: Row): string {
  const first = (r.host_name || "").trim().split(/\s+/)[0] || "there";
  return `<p>${first},</p>

<p>Thank you for putting your hand up. Here's how co-hosting works.</p>

<p>The marathon runs seven in the morning to eleven at night, thirty-two shows
back to back. Between every show there are five minutes on the main stage —
introducing what's next, talking about the day, keeping it moving. Alex, our
producer, runs those minutes. A co-host takes an hour of them with her.</p>

<p><strong>Pick your hour</strong> from your dashboard — there's a new section
called <em>Co-host Available Slots</em>. One person per hour, first come first
served, and you can't take the hour your own show is on.</p>

<p style="margin:22px 0"><a href="${LINK}" style="background:#053877;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700;display:inline-block">Open my dashboard</a></p>

<p>A few days before the day, you'll get a short script for your hour — who's
coming up and when. Use it or go your own way.</p>

<p>Riccoh</p>`;
}

function textOf(r: Row): string {
  const first = (r.host_name || "").trim().split(/\s+/)[0] || "there";
  return `${first},

Thank you for putting your hand up. Here's how co-hosting works.

The marathon runs seven in the morning to eleven at night, thirty-two shows back to back. Between every show there are five minutes on the main stage — introducing what's next, talking about the day, keeping it moving. Alex, our producer, runs those minutes. A co-host takes an hour of them with her.

Pick your hour from your dashboard — there's a new section called "Co-host Available Slots". One person per hour, first come first served, and you can't take the hour your own show is on.

${LINK}

A few days before the day, you'll get a short script for your hour — who's coming up and when. Use it or go your own way.

Riccoh`;
}

const htmlFor = (r: Row) => emailShell({
  banner: EMAIL_BANNERS.podcasters,
  eyebrow: "The Podcast Marathon · 5 October",
  heading: "Pick your co-host hour",
  body: body(r),
});

if (!rows.length) {
  console.log("Nobody to send to.");
  await sql.end();
  process.exit(1);
}
console.log(`${rows.length} co-host${rows.length === 1 ? "" : "s"}\n`);
for (const r of rows) console.log(`   ${r.email.padEnd(34)} ${r.host_name} · ${r.podcast_name.slice(0, 32)}`);

if (preview) {
  console.log("\n──────── as the first person will read it ────────\n");
  console.log(`From: Riccoh\nSubject: ${SUBJECT}\n`);
  console.log(textOf(rows[0]));
}
if (!test && !apply) {
  console.log(`\nNothing sent. --preview to read it, --test for one copy, --apply to send.`);
  await sql.end();
  process.exit(0);
}

const [ev] = await sql<{ admin_password: string }[]>`SELECT admin_password FROM events WHERE id = 1`;
const to = test ? [{ ...rows[0], email: "andrew@podlogix.co" }] : rows;
let sent = 0, failed = 0;
for (const r of to) {
  const res = await fetch(`${API}/api/admin/emails/send-one`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-password": ev.admin_password },
    body: JSON.stringify({ to: r.email, subject: SUBJECT, html: htmlFor(r), text: textOf(r), sender: "member:1", banner: "podcasters" }),
  });
  res.ok ? sent++ : failed++;
  console.log(`  ${res.ok ? "sent  " : `FAILED ${res.status}`} ${r.email}`);
  await new Promise((x) => setTimeout(x, 250));
}
console.log(`\n${sent} sent, ${failed} failed.`);
await sql.end();
