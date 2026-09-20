// The headshot request: one link each, and the email that carries it.
//
//   npx tsx scripts/headshot-email.ts              # who needs one, and their link
//   npx tsx scripts/headshot-email.ts --preview    # the email, as they'll read it
//   npx tsx scripts/headshot-email.ts --test       # send one to you
//   npx tsx scripts/headshot-email.ts --apply      # send to everyone who needs it
//
// Nothing is sent without --test or --apply, and --apply prints the list and
// waits for nothing, so read the dry run first.
//
// Who gets skipped: anybody whose stored photo is already print resolution.
// Asking somebody for a thing they have already given you is how a request
// stops being read.
import "dotenv/config";
import postgres from "postgres";
import { emailShell, EMAIL_BANNERS } from "../server/email";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const test = args.includes("--test");
const preview = args.includes("--preview");
const BASE = process.env.PUBLIC_BASE_URL || "https://www.militaryvoice.ai";
// The Resend key is write-only in Vercel, so a one-off send goes through the
// server rather than from here. Same route email-podcasters.ts uses.
const API = process.env.API_BASE || BASE;

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });

interface Row {
  email: string;
  hostName: string;
  podcastName: string;
  token: string;
  printable: boolean;
}

const [ev] = await sql<{ admin_password: string }[]>`SELECT admin_password FROM events WHERE id = 1`;

// The links come from the server, not from here. Minting them locally means
// holding SESSION_SECRET, and the one on a laptop is not the one on Vercel —
// so every link looked right and every one was dead.
const linkRes = await fetch(`${API}/api/admin/headshot-links`, {
  headers: { "x-admin-password": ev.admin_password },
});
if (!linkRes.ok) {
  console.error(`Couldn't get the links: ${linkRes.status} ${await linkRes.text()}`);
  await sql.end();
  process.exit(1);
}
const rows = (await linkRes.json()) as Row[];
const needed = rows.filter((r) => !r.printable);

/**
 * Short, and it says what the photo is for.
 *
 * It does not mention advertising. What the magazine funds is our side of it;
 * to a podcaster this is a page about their show, and putting a revenue model
 * in front of the ask makes it read like a pitch instead of a favour.
 *
 * "Please upload a photo" gets a screenshot of a logo. "We are printing you
 * nine inches across" gets a photograph, because it tells somebody what would
 * go wrong if they sent the wrong thing.
 */
function body(r: Row): string {
  const first = (r.hostName || "").trim().split(/\s+/)[0] || "there";
  return `<p>${first},</p>

<p>We're putting together a printed keepsake magazine for the Podcast Marathon —
one page per show, yours included. It's the kind of thing people keep on a
shelf, and something you can share with your fans.</p>

<p><strong>We need a better photo of you.</strong> The one we have is 720 pixels
wide. That looks fine on the site and prints about the size of a postage stamp.
On the page you get, you're nine inches across.</p>

<p>No sign-in — the button opens straight to it. Three things that help:</p>

<ul>
  <li>The biggest file you have. Straight off the camera or phone is perfect.</li>
  <li>A photograph of <strong>you</strong>, not your show artwork — we already pulled that from your feed.</li>
  <li>Don't crop it. We'll do that, and the designer wants the shoulders and the room.</li>
</ul>

<p>Takes about a minute, and it's the last thing we need from you before print.</p>`;
}

function textOf(r: Row): string {
  const first = (r.hostName || "").trim().split(/\s+/)[0] || "there";
  return `${first},

We're putting together a printed keepsake magazine for the Podcast Marathon — one page per show, yours included. It's the kind of thing people keep on a shelf, and something you can share with your fans.

We need a better photo of you. The one we have is 720 pixels wide, which prints about the size of a postage stamp. On your page you're nine inches across.

Send it here (no sign-in): ${BASE}/headshot/${r.token}

- The biggest file you have, straight off the camera or phone.
- A photograph of you, not your show artwork — we already pulled that from your feed.
- Don't crop it. We'll do that.

Takes about a minute.`;
}

function htmlFor(r: Row): string {
  return emailShell({
    banner: EMAIL_BANNERS.podcasters,
    eyebrow: "The Podcast Marathon · print edition",
    heading: "One photo, for your page",
    body: body(r),
    cta: { href: `${BASE}/headshot/${r.token}`, label: "Send us your photo" },
  });
}

const SUBJECT = "One photo, for your page in the magazine";

console.log(`${rows.length} podcasters · ${needed.length} still need a print-quality photo\n`);
for (const r of needed) {
  console.log(`  ${r.email.padEnd(34)} ${r.podcastName.slice(0, 34)}`);
  console.log(`     ${BASE}/headshot/${r.token}`);
}

if (preview) {
  console.log("\n──────── as the first person on the list will read it ────────\n");
  console.log(`Subject: ${SUBJECT}\n`);
  console.log(textOf(needed[0] ?? rows[0]));
}

if (!test && !apply) {
  console.log("\nNothing sent. --preview to read it, --test to send one to yourself, --apply to send them all.");
  await sql.end();
  process.exit(0);
}

// A test goes to the owner, never to a podcaster. Sending the real thing to a
// real recipient to "check it" is a send you cannot take back.
const to = test ? [{ ...(needed[0] ?? rows[0]), email: "andrew@podlogix.co" }] : needed;
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
  await new Promise((x) => setTimeout(x, 250)); // don't hammer the provider
}
console.log(`\n${sent} sent, ${failed} failed.`);
await sql.end();
