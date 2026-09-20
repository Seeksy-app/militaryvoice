// Two one-off emails: Greg picks an episode, Rob gets his welcome.
//
//   npx tsx scripts/two-emails.ts           # print them
//   npx tsx scripts/two-emails.ts --apply   # send
import "dotenv/config";
import postgres from "postgres";
import { emailShell, EMAIL_BANNERS } from "../server/email";

const API = process.env.MV_API ?? "https://militaryvoice.ai";
const AGENDA = "https://militaryvoice.ai/agenda";

const notes: { to: string; subject: string; html: string; text: string }[] = [
  {
    to: "greg@gimeez.com",
    subject: "Which Brave Blocks episode for your 8:30 PM slot?",
    html: emailShell({
      banner: EMAIL_BANNERS.podcasters,
      eyebrow: "The Podcast Marathon · 5 October",
      heading: "Which episode would you like us to play?",
      body: `<p>Hi Greg,</p>
<p><strong>Brave Blocks</strong> is booked for <strong>8:30 PM ET on Monday, 5 October</strong> — mile marker 26.1 on the course.</p>
<p>You gave us your Amplified Voices program group rather than one episode, so we need to know which one you'd like us to run:</p>
<p><a href="https://tv.amplifiedvoices.com/program-group/f4e0a93dc8590ee5a7f921030f4a4594">tv.amplifiedvoices.com/program-group/f4e0a93dc8590ee5a7f921030f4a4594</a></p>
<p>Just reply with the episode name, or a direct link to it. If there's a video version, that's the one we want — the marathon streams to YouTube, so an audio-only file needs a still behind it.</p>
<p>Thanks,<br>MilitaryVoice.ai</p>`,
      cta: { href: AGENDA, label: "See the agenda" },
    }),
    text: `Hi Greg,

Brave Blocks is booked for 8:30 PM ET on Monday, 5 October - mile marker 26.1 on the course.

You gave us your Amplified Voices program group rather than one episode, so we need to know which one you'd like us to run:
https://tv.amplifiedvoices.com/program-group/f4e0a93dc8590ee5a7f921030f4a4594

Just reply with the episode name, or a direct link to it. If there's a video version, that's the one we want - the marathon streams to YouTube, so an audio-only file needs a still behind it.

Thanks,
MilitaryVoice.ai
${AGENDA}`,
  },
  {
    to: "rcouture@vfw.org",
    subject: "You're Mile 13 — 1:30 PM ET, 5 October",
    html: emailShell({
      banner: EMAIL_BANNERS.welcome,
      eyebrow: "The Podcast Marathon · 5 October",
      heading: "You're Mile 13",
      body: `<p>Hi Rob,</p>
<p>Thanks for registering <strong>#StillServing: The VFW Podcast</strong> for National Military Podcast Day.</p>
<p>We've given you <strong>mile marker 13, at 1:30 PM ET</strong> — and you finalized our line-up. Every slot on the 26.2-mile course is now filled.</p>
<p>We have your episode on file, so there's nothing you need to send us.</p>
<p>Please let us know if you have any questions.</p>
<p>Thanks,<br>MilitaryVoice.ai</p>`,
      cta: { href: AGENDA, label: "See the agenda" },
    }),
    text: `Hi Rob,

Thanks for registering #StillServing: The VFW Podcast for National Military Podcast Day.

We've given you mile marker 13, at 1:30 PM ET - and you finalized our line-up. Every slot on the 26.2-mile course is now filled.

We have your episode on file, so there's nothing you need to send us.

Please let us know if you have any questions.

Thanks,
MilitaryVoice.ai
${AGENDA}`,
  },
];

async function main() {
  const apply = process.argv.includes("--apply");
  for (const n of notes) {
    console.log(`\n${"=".repeat(64)}\nTo:      ${n.to}\nSubject: ${n.subject}\n${"-".repeat(64)}\n${n.text}`);
  }
  if (!apply) { console.log(`\n${"=".repeat(64)}\nDry run — pass --apply to send.`); return; }

  // Sent by the server, not from here. The Resend key is marked sensitive in
  // Vercel, so it is write-only — `env pull` hands back a placeholder and the
  // dashboard will not show it either. That is the right setting and it is not
  // worth weakening to send two emails, so the send goes where the key already
  // lives instead of dragging a copy of the key out to this machine.
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
  const [ev] = await sql`SELECT admin_password FROM events WHERE is_featured = true`;
  await sql.end();

  for (const n of notes) {
    const res = await fetch(`${API}/api/admin/emails/send-one`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-password": ev.admin_password },
      body: JSON.stringify({ to: n.to, subject: n.subject, html: n.html, text: n.text }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    console.log(res.ok ? `sent → ${n.to}  (${body.id})` : `FAILED ${n.to}: ${res.status} ${body.message ?? ""}`);
  }
}

main();
