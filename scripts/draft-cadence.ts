// Fill the two gaps in the cadence.
//
//   npx tsx scripts/draft-cadence.ts --apply
//
// Only one gap is real. "Two weeks out" does not exist, which leaves a long
// silence between somebody claiming a slot and the ten-days-out checklist —
// and the materials we need from them are exactly what that silence is for.
//
// cadence:confirmation is deliberately NOT touched. Its body is empty because
// it is not a template: incrementCadenceBroadcast writes that row purely to
// count sends of the transactional confirmation, whose wording lives in
// server/email.ts because it carries the slot time and calendar links. Turning
// it into a draft would put a Send button on a counter.
//
// Drafts only. Nothing is sent by this script.
import "dotenv/config";
import postgres from "postgres";

const MATERIALS = `Hi {{First_Name}},

Two weeks out. This is the easy one — everything here is optional, and sending it now means we can build your segment properly instead of improvising it on the day.

**What's useful to us:**

- **Your show artwork.** Goes on your card in the lineup, on the countdown before you, and on the clips afterwards.
- **A short clip or trailer.** Thirty seconds is plenty. We can roll it going into your segment.
- **Guest names.** If you're bringing someone, tell us who and how they'd like to be introduced. They get their own green room link.
- **Anything you want said.** A launch, a cause, a book. Riccoh will read it out rather than you having to work it into the conversation.

All of it goes in the same place, and "nothing to send" is a perfectly good answer — the checklist takes that as an answer too.

[Send your materials](https://www.militaryvoice.ai/host/dashboard/events)

If you'd rather just turn up and talk, that works. Plenty do.`;

const WANT = [
  { source: "cadence:materials", subject: "Two weeks out — anything you'd like us to play?", body: MATERIALS, banner: "podcasters", sender: "rico" },
];

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const [event] = await sql`SELECT id FROM events WHERE is_featured = true LIMIT 1`;
const existing = await sql`SELECT id, source, status, body_text FROM broadcasts WHERE source LIKE 'cadence:%'`;
const apply = process.argv.includes("--apply");
const now = new Date().toISOString();

for (const w of WANT) {
  const found = existing.find((r) => r.source === w.source);
  if (found && String(found.body_text).trim() && found.status === "sent") {
    console.log(`${w.source}: already written and sent — left alone.`);
    continue;
  }
  if (found) {
    console.log(`${w.source}: #${found.id} exists${String(found.body_text).trim() ? "" : " with an EMPTY body"} → rewriting`);
    if (apply) {
      await sql`UPDATE broadcasts SET subject = ${w.subject}, body_text = ${w.body}, banner = ${w.banner}, sender = ${w.sender}, status = 'draft' WHERE id = ${found.id}`;
    }
  } else {
    console.log(`${w.source}: missing → creating`);
    if (apply) {
      await sql`
        INSERT INTO broadcasts (event_id, subject, body_text, status, segment, sender, banner, source, created_at)
        VALUES (${event.id}, ${w.subject}, ${w.body}, 'draft', 'signups', ${w.sender}, ${w.banner}, ${w.source}, ${now})`;
    }
  }
}
await sql.end();
console.log(apply ? "\nWritten as drafts. Nothing sent." : "\nDry run — pass --apply.");
