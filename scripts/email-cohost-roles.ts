// Two more asks of a co-host volunteer: interview Daniel, be Annette's guest.
//
//   npx tsx scripts/email-cohost-roles.ts a@b.com             # dry run
//   npx tsx scripts/email-cohost-roles.ts a@b.com --preview   # read it
//   npx tsx scripts/email-cohost-roles.ts a@b.com --test      # one copy to Andrew
//   npx tsx scripts/email-cohost-roles.ts a@b.com --apply     # send it
//
// Two podcasters answered "Do you need someone to interview you?" in ways
// that need a person: Daniel asked to be interviewed, Annette asked for a
// guest. A co-host who has already said yes to the main stage is the natural
// person to ask for both. From Riccoh, because it is a favour between hosts.
import "dotenv/config";
import postgres from "postgres";
import { emailShell, EMAIL_BANNERS } from "../server/email";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const test = args.includes("--test");
const preview = args.includes("--preview");
const to = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
const BASE = process.env.PUBLIC_BASE_URL || "https://www.militaryvoice.ai";
const API = process.env.API_BASE || BASE;
if (!to) { console.log("Give me the address."); process.exit(1); }

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });
interface Row { email: string; host_name: string; podcast_name: string; slot_index: number }
const [r] = await sql<Row[]>`SELECT email, host_name, podcast_name, slot_index FROM signups
  WHERE event_id = 1 AND status <> 'cancelled' AND lower(email) = ${to} ORDER BY slot_index LIMIT 1`;
if (!r) { console.log(`${to} is not on the lineup.`); await sql.end(); process.exit(1); }
const [ev] = await sql<{ start_at_utc: string; slot_minutes: number; admin_password: string }[]>`
  SELECT start_at_utc, slot_minutes, admin_password FROM events WHERE id = 1`;
const at = (slot: number) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
  .format(new Date(Date.parse(ev.start_at_utc) + slot * ev.slot_minutes * 60_000));
// The two who asked, read from the same answers the admin sees.
const asks = await sql<{ host_name: string; podcast_name: string; slot_index: number; interview_need: string }[]>`
  SELECT s.host_name, s.podcast_name, s.slot_index, es.interview_need FROM signups s
  JOIN event_shows es ON es.email = s.email AND es.event_id = 1
  WHERE s.event_id = 1 AND s.status <> 'cancelled' AND es.interview_need IN ('interview_me', 'find_guest')
    AND lower(s.email) <> ${to} ORDER BY s.slot_index`;
const daniel = asks.find((a) => /flint/i.test(a.host_name));
const annette = asks.find((a) => /whittenberger/i.test(a.host_name));
await sql.end();
if (!daniel || !annette) { console.log("Could not find Daniel's or Annette's ask on the lineup."); process.exit(1); }

const first = (r.host_name || "").trim().split(/\s+/)[0] || "there";
// Typed at signup in lower case; printed with capitals.
const nice = (name: string) => name.replace(/-\s*the podcast$/i, "").trim().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const SUBJECT = "Two more ways in, if you want them";
const LINK = `${BASE}/host/dashboard`;

const html = `<p>${first},</p>

<p>Thank you again for saying yes to co-hosting. Two more asks, because you're
the right person for both. Say yes to either, both, or neither.</p>

<p><strong>1. Interview Daniel.</strong> Daniel Tobias Flint (<em>${daniel.podcast_name}</em>,
${at(daniel.slot_index)}) asked for someone to interview him during his slot. Twenty-five
minutes, your questions.</p>

<p><strong>2. Be Annette's guest.</strong> Annette Whittenberger (<em>${nice(annette.podcast_name)}</em>,
${at(annette.slot_index)}) asked us to find her a guest. She'd interview you — your story, your
show, twenty-five minutes. Your own slot is ${at(r.slot_index)}, so it doesn't clash.</p>

<p><strong>And your co-host hours</strong> — if you haven't picked yet, they're on your
dashboard under <em>Co-host Available Slots</em>. Take one or several.</p>

<p style="margin:22px 0"><a href="${LINK}" style="background:#053877;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700;display:inline-block">Open my dashboard</a></p>

<p>Reply with a yes to whichever you want and I'll set it up with them.</p>

<p>Riccoh</p>`;

const text = `${first},

Thank you again for saying yes to co-hosting. Two more asks, because you're the right person for both. Say yes to either, both, or neither.

1. Interview Daniel. Daniel Tobias Flint (${daniel.podcast_name}, ${at(daniel.slot_index)}) asked for someone to interview him during his slot. Twenty-five minutes, your questions.

2. Be Annette's guest. Annette Whittenberger (${nice(annette.podcast_name)}, ${at(annette.slot_index)}) asked us to find her a guest. She'd interview you — your story, your show, twenty-five minutes. Your own slot is ${at(r.slot_index)}, so it doesn't clash.

And your co-host hours — if you haven't picked yet, they're on your dashboard under "Co-host Available Slots". Take one or several.

${LINK}

Reply with a yes to whichever you want and I'll set it up with them.

Riccoh`;

console.log(`To: ${r.email} · ${r.host_name} · ${r.podcast_name} (${at(r.slot_index)})`);
if (preview) { console.log(`\nFrom: Riccoh\nSubject: ${SUBJECT}\n\n${text}`); }
if (!test && !apply) { console.log(`\nNothing sent. --preview to read it, --test for one copy, --apply to send.`); process.exit(0); }

const dest = test ? "andrew@podlogix.co" : r.email;
const res = await fetch(`${API}/api/admin/emails/send-one`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-admin-password": ev.admin_password },
  body: JSON.stringify({
    to: dest, subject: SUBJECT, text, sender: "member:1", banner: "podcasters",
    html: emailShell({ banner: EMAIL_BANNERS.podcasters, eyebrow: "The Podcast Marathon · 5 October", heading: SUBJECT, body: html }),
  }),
});
console.log(res.ok ? `sent to ${dest}` : `FAILED ${res.status} ${await res.text()}`);
