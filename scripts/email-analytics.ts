// "Your audience, measured": each lineup podcaster's own analytics, the top of
// it as a picture, and the way to the rest in their dashboard.
//
//   npx tsx scripts/email-analytics.ts --shots <dir>          # upload pictures, list who gets one
//   npx tsx scripts/email-analytics.ts --shots <dir> --preview # write the emails as HTML to <dir>/preview
//   npx tsx scripts/email-analytics.ts --shots <dir> --test    # one to Andrew, never a podcaster
//   npx tsx scripts/email-analytics.ts --shots <dir> --apply   # everyone with a picture
//
// The pictures are real screenshots of the "Decision signals" block from each
// podcaster's own profile (the public Share view), taken beforehand into
// <dir>/<signupId>.png. Nobody without one is sent anything.
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { emailShell, EMAIL_BANNERS } from "../server/email";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const test = args.includes("--test");
const preview = args.includes("--preview");
const dir = args[args.indexOf("--shots") + 1];
// --only <signupId> limits the run to one podcaster; --to <email> sends a test
// there instead of to the owner.
const only = args.includes("--only") ? Number(args[args.indexOf("--only") + 1]) : null;
const testTo = args.includes("--to") ? args[args.indexOf("--to") + 1] : "andrew@podlogix.co";
if (!dir || dir.startsWith("--")) throw new Error("--shots <dir> is required");
const BASE = "https://www.militaryvoices.ai";
const API = process.env.API_BASE || BASE;

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });
const [ev] = await sql<{ admin_password: string }[]>`SELECT admin_password FROM events WHERE id = 1`;
const signups = await sql<{ id: number; email: string; host_name: string; podcast_name: string }[]>`
  SELECT id, email, host_name, podcast_name FROM signups WHERE event_id = 1 AND status <> 'cancelled'`;
await sql.end();

interface Row { signupId: number; email: string; first: string; show: string; image: string }
const rows: Row[] = [];
for (const s of signups) {
  if (only != null && s.id !== only) continue;
  const file = path.join(dir, `${s.id}.jpg`);
  const buf = await fs.readFile(file).catch(() => null);
  if (!buf) continue;
  // Through the site's signed upload (a direct upload from this machine dies
  // on its network), under a name that changes with the picture so a re-run
  // never shows yesterday's numbers from a cache.
  const stamp = buf.length.toString(36);
  const signed = (await (await fetch(`${API}/api/admin/media/upload-url`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-password": ev.admin_password },
    body: JSON.stringify({ fileName: `analytics-${s.id}-${stamp}.jpg`, contentType: "image/jpeg", size: buf.length }),
  })).json()) as { uploadUrl: string; publicUrl: string };
  execFileSync("curl", ["-s", "-f", "-X", "PUT", signed.uploadUrl, "-H", "content-type: image/jpeg", "--data-binary", `@${file}`]);
  const image = signed.publicUrl;
  rows.push({ signupId: s.id, email: s.email.trim(), first: s.host_name.trim().split(/\s+/)[0] || "there", show: s.podcast_name.trim(), image });
}

const SUBJECT = "Your audience, measured";
const LINK = `${BASE}/host/dashboard/analytics`;

function body(r: Row): string {
  return `<p>${r.first},</p>

<p>As part of being on The Podcast Marathon, we've pulled together data on your audience that can help you grow your show and land sponsors. Here's the top of it:</p>

<p style="margin:18px 0"><a href="${LINK}"><img src="${r.image}" alt="Your decision signals: engagement, reach, audience quality and more" width="536" style="width:100%;max-width:536px;height:auto;border:1px solid #e3e8f0;border-radius:12px;display:block"></a></p>

<p>The rest is in your dashboard under <strong>Your analytics</strong>: how much of your audience is real, who's watching and where, how you're growing, and the brands you've worked with. There's a Share button too, so you can send it straight to a sponsor.</p>

<p>Riccoh</p>`;
}
function textOf(r: Row): string {
  return `${r.first},

As part of being on The Podcast Marathon, we've pulled together data on your audience that can help you grow your show and land sponsors.

See it in your dashboard, under Your analytics: ${LINK}

How much of your audience is real, who's watching and where, how you're growing, and the brands you've worked with. There's a Share button too, so you can send it straight to a sponsor.

Riccoh`;
}
const htmlFor = (r: Row) =>
  emailShell({ banner: EMAIL_BANNERS.podcasters, eyebrow: "The Podcast Marathon · 5 October", heading: "Your audience, measured", body: body(r), cta: { href: LINK, label: "See your analytics" } });

console.log(`${rows.length} podcasters have a picture:\n`);
for (const r of rows) console.log(`  ${r.email.padEnd(36)} ${r.show.slice(0, 40)}`);

if (preview) {
  const out = path.join(dir, "preview");
  await fs.mkdir(out, { recursive: true });
  for (const r of rows) await fs.writeFile(path.join(out, `${r.signupId}.html`), htmlFor(r));
  console.log(`\nPreviews written to ${out}`);
}

if (!test && !apply) {
  console.log("\nNothing sent. --test sends one to Andrew; --apply sends them all.");
  process.exit(0);
}

// A test goes to the owner, never to a podcaster.
const targets = test ? [{ ...rows[0], email: testTo }] : rows;
for (const r of targets) {
  const res = await fetch(`${API}/api/admin/emails/send-one`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-password": ev.admin_password },
    body: JSON.stringify({ to: r.email, subject: SUBJECT, html: htmlFor(r), text: textOf(r) }),
  });
  console.log(res.ok ? `  sent  ${r.email}` : `  FAILED ${r.email}: ${res.status} ${await res.text()}`);
}
