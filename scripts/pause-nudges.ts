// Stop a nudge going out, without stopping the others.
//
//   npx tsx scripts/pause-nudges.ts prep              # who would be held
//   npx tsx scripts/pause-nudges.ts prep --apply      # hold them
//   npx tsx scripts/pause-nudges.ts prep --release --apply   # let them go again
//
// The prep nudge fires two weeks before each person's own slot, not two weeks
// before the event — so a sixteen-hour day of slots becomes a sixteen-hour day
// of emails, arriving one an hour. Once that is under way it cannot be recalled
// one message at a time.
//
// This uses the sender's own suppression rather than fighting it: a nudge row
// with emailed = false is claimed, and a claimed nudge is never sent. The same
// mechanism the sender uses when somebody books three days out and should not
// get "two weeks to go". Releasing deletes the row, and the next hourly run
// picks them up as though nothing happened.
//
// It does not touch the cron, so the final and on-air nudges still fire.
import "dotenv/config";
import postgres from "postgres";

const args = process.argv.slice(2);
const kind = args.find((a) => !a.startsWith("--")) ?? "prep";
const apply = args.includes("--apply");
const release = args.includes("--release");

if (!["prep", "final", "onair", "confirmation"].includes(kind)) {
  console.error(`Unknown nudge kind "${kind}".`);
  process.exit(1);
}

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });

const [ev] = await sql<{ id: number }[]>`SELECT id FROM events WHERE is_featured = true`;

if (release) {
  // Only the ones we held. A nudge that genuinely went out has emailed = true
  // and must stay claimed, or releasing would send it a second time.
  const held = await sql`SELECT n.id, s.email, s.podcast_name FROM nudges n
    JOIN signups s ON s.id = n.signup_id
    WHERE n.kind = ${kind} AND n.emailed = false AND s.event_id = ${ev.id}`;
  console.log(`${held.length} held ${kind} nudges would be released\n`);
  for (const h of held as any[]) console.log(`   ${h.email.padEnd(34)} ${h.podcast_name}`);
  if (!apply) {
    console.log("\nDry run. Add --apply to release them.");
  } else {
    await sql`DELETE FROM nudges WHERE kind = ${kind} AND emailed = false
      AND signup_id IN (SELECT id FROM signups WHERE event_id = ${ev.id})`;
    console.log(`\nReleased. The next hourly run will send them.`);
  }
  await sql.end();
  process.exit(0);
}

const pending = await sql<{ id: number; email: string; podcast_name: string }[]>`
  SELECT s.id, s.email, s.podcast_name FROM signups s
  WHERE s.event_id = ${ev.id} AND s.status <> 'cancelled'
    AND NOT EXISTS (SELECT 1 FROM nudges n WHERE n.signup_id = s.id AND n.kind = ${kind})
  ORDER BY s.slot_index`;

console.log(`${pending.length} podcasters have not had the ${kind} nudge\n`);
for (const p of pending) console.log(`   ${p.email.padEnd(34)} ${p.podcast_name.slice(0, 38)}`);

if (!apply) {
  console.log(`\nDry run. Add --apply to hold them.`);
  await sql.end();
  process.exit(0);
}

const now = new Date().toISOString();
let held = 0;
for (const p of pending) {
  // emailed = false is the whole trick: claimed, so never sent, and a delete
  // puts it back on the board.
  const r = await sql`INSERT INTO nudges (signup_id, kind, emailed, sent_at)
    VALUES (${p.id}, ${kind}, false, ${now})
    ON CONFLICT (signup_id, kind) DO NOTHING RETURNING id`;
  if (r.length) held++;
}

console.log(`\n${held} held. The ${kind} nudge will not go out.`);
console.log(`Final and on-air nudges are untouched.`);
console.log(`Release with:  npx tsx scripts/pause-nudges.ts ${kind} --release --apply`);
await sql.end();
