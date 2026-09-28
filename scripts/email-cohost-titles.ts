// Riccoh asks Amy and Jane what title they want beside their name on the
// homepage as co-hosts. Amy also hears that studio instructions follow, and
// that she can bring someone on with her.
//
//   npx tsx scripts/email-cohost-titles.ts            # preview
//   npx tsx scripts/email-cohost-titles.ts --apply
import "dotenv/config";
import postgres from "postgres";
import { emailShell, EMAIL_BANNERS } from "../server/email";

const apply = process.argv.includes("--apply");
const BASE = process.env.PUBLIC_BASE_URL || "https://www.militaryvoice.ai";

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });
const [ev] = await sql<{ admin_password: string }[]>`SELECT admin_password FROM events WHERE id = 1`;
await sql.end();

const SUBJECT = "Your title as co-host";

const AMY = {
  to: "amyusd@gmail.com",
  text: `Amy,

You're on the homepage now as one of my co-hosts for The Podcast Marathon, with your photo. Right now it says "U.S. Navy, Retired" under your name.

You have the desk from 4:30 PM Eastern through the finish. Those are hours I can't be on, so it's yours to run, and it's marked that way on the run of show.

What title would you like there? Reply with the exact words and I'll put them in.

Two more things:

1. We'll send you instructions on how to get into the studio, the green room and everything else before the day.
2. If there's anyone you'd like to bring on with you, tell us who and we'll set them up.

See it here: https://www.militaryvoice.ai/

Riccoh`,
  html: `<p>Amy,</p>
<p>You're on the homepage now as one of my co-hosts for The Podcast Marathon, with your photo. Right now it says <strong>"U.S. Navy, Retired"</strong> under your name.</p>
<p>You have the desk from <strong>4:30 PM Eastern through the finish</strong>. Those are hours I can't be on, so it's yours to run, and it's marked that way on the run of show.</p>
<p>What title would you like there? Reply with the exact words and I'll put them in.</p>
<p>Two more things:</p>
<ol>
<li>We'll send you instructions on how to get into the studio, the green room and everything else before the day.</li>
<li>If there's anyone you'd like to bring on with you, tell us who and we'll set them up.</li>
</ol>
<p>See it here: <a href="https://www.militaryvoice.ai/">militaryvoice.ai</a></p>
<p>Riccoh</p>`,
};

const JANE = {
  to: "talk.veteran@gmail.com",
  text: `Jane,

You're on the homepage now as one of my co-hosts for The Podcast Marathon, with your photo. Right now it says "U.S. Army, Retired" under your name.

What title would you like there? Reply with the exact words and I'll put them in.

See it here: https://www.militaryvoice.ai/

Riccoh`,
  html: `<p>Jane,</p>
<p>You're on the homepage now as one of my co-hosts for The Podcast Marathon, with your photo. Right now it says <strong>"U.S. Army, Retired"</strong> under your name.</p>
<p>What title would you like there? Reply with the exact words and I'll put them in.</p>
<p>See it here: <a href="https://www.militaryvoice.ai/">militaryvoice.ai</a></p>
<p>Riccoh</p>`,
};

// Enrique: the hours still open beside Riccoh, before Amy takes the desk at
// 4:30. His own show is 9:00, so that hour is out. Reply with times, or pick
// them on the dashboard.
const ENRIQUE = {
  to: "triadleadershipsolutions@gmail.com",
  subject: "Your hours at the desk",
  text: `Enrique,

Thank you for saying yes to this. Here's what it is.

For part of The Podcast Marathon on Monday, October 5, I can't be on. During those hours you're not a co-host, you're the host: you run the desk on your own, bring each show on, do the handoffs and keep the day moving. When I'm back we're side by side.

These hours are open, all Eastern:

7:00 to 8:00 AM
8:00 to 9:00 AM
10:00 to 11:00 AM
11:00 AM to 12:00 PM
12:00 to 1:00 PM
1:00 to 2:00 PM
2:00 to 3:00 PM
3:00 to 4:00 PM

Your own show is at 9:00, so that hour is already yours. Amy Forsythe has the desk from 4:30 through the finish.

Reply with the hours you want and I'll mark them off for you. Or pick them yourself: sign in to your dashboard and open "Co-host Available Slots".

https://www.militaryvoice.ai/host/dashboard

Riccoh`,
  html: `<p>Enrique,</p>
<p>Thank you for saying yes to this. Here's what it is.</p>
<p>For part of The Podcast Marathon on Monday, October 5, I can't be on. During those hours you're not a co-host, <strong>you're the host</strong>: you run the desk on your own, bring each show on, do the handoffs and keep the day moving. When I'm back we're side by side.</p>
<p>These hours are open, all Eastern:</p>
<ul>
<li>7:00 to 8:00 AM</li>
<li>8:00 to 9:00 AM</li>
<li>10:00 to 11:00 AM</li>
<li>11:00 AM to 12:00 PM</li>
<li>12:00 to 1:00 PM</li>
<li>1:00 to 2:00 PM</li>
<li>2:00 to 3:00 PM</li>
<li>3:00 to 4:00 PM</li>
</ul>
<p>Your own show is at 9:00, so that hour is already yours. Amy Forsythe has the desk from 4:30 through the finish.</p>
<p><strong>Reply with the hours you want and I'll mark them off for you.</strong> Or pick them yourself: sign in to your dashboard and open "Co-host Available Slots".</p>
<p><a href="https://www.militaryvoice.ai/host/dashboard">militaryvoice.ai/host/dashboard</a></p>
<p>Riccoh</p>`,
};

// Brittinie: on at 4:30 with a recorded episode, and we don't have it yet.
const BRIT = {
  to: "brittiniewick@gmail.com",
  subject: "Your recorded episode for 4:30",
  text: `Brittinie,

Welcome to the lineup. Women Serve Too is on at 4:30 PM Eastern on Monday, October 5, as a recorded episode.

We need the episode to roll it. Two ways to get it to us:

1. Reply to this email with a link: YouTube, Google Drive, Dropbox or WeTransfer all work.
2. Or sign in to your dashboard, open Event settings, choose "Play a recorded episode" and paste the link there.

https://www.militaryvoice.ai/host/dashboard

It needs to be 25 minutes or under so it fits your slot. The sooner we have it, the sooner we can check it plays clean.

Riccoh`,
  html: `<p>Brittinie,</p>
<p>Welcome to the lineup. <strong>Women Serve Too</strong> is on at <strong>4:30 PM Eastern on Monday, October 5</strong>, as a recorded episode.</p>
<p>We need the episode to roll it. Two ways to get it to us:</p>
<ol>
<li>Reply to this email with a link: YouTube, Google Drive, Dropbox or WeTransfer all work.</li>
<li>Or sign in to your dashboard, open Event settings, choose "Play a recorded episode" and paste the link there.<br /><a href="https://www.militaryvoice.ai/host/dashboard">militaryvoice.ai/host/dashboard</a></li>
</ol>
<p>It needs to be 25 minutes or under so it fits your slot. The sooner we have it, the sooner we can check it plays clean.</p>
<p>Riccoh</p>`,
};

for (const m of [{ ...AMY, subject: SUBJECT }, { ...JANE, subject: SUBJECT }, ENRIQUE, BRIT]) {
  console.log(`To: ${m.to}\nSubject: ${m.subject}\n\n${m.text}\n\n----\n`);
  if (!apply) continue;
  const res = await fetch(`${BASE}/api/admin/emails/send-one`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-password": ev.admin_password },
    body: JSON.stringify({ to: m.to, subject: m.subject, text: m.text, sender: "member:1", banner: "podcasters", html: emailShell({ banner: EMAIL_BANNERS.podcasters, eyebrow: "The Podcast Marathon · 5 October", heading: m.subject, body: m.html }) }),
  });
  console.log(res.ok ? `sent to ${m.to}` : `FAILED ${res.status} ${await res.text()}`);
}
if (!apply) console.log("Nothing sent. --apply to send.");
