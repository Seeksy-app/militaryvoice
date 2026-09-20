// Close the lineup, or open it again.
//
//   npx tsx scripts/close-lineup.ts                 # what it would do
//   npx tsx scripts/close-lineup.ts --apply         # close it
//   npx tsx scripts/close-lineup.ts --open --apply  # take it back
//
// "Full" and "closed" are different claims. Full is arithmetic — every slot
// has a name against it — and it undoes itself the moment one person cancels,
// which is exactly the wrong behaviour two weeks out: the running order has
// been printed, mailed and rehearsed against, and a freed slot is a hole in
// the schedule rather than an opening for somebody new.
//
// So closing is a decision, stored as one, and only an admin reverses it.
import "dotenv/config";
import postgres from "postgres";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const closing = !args.includes("--open");
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

// The ALTER below is a no-op on the second run, and postgres-js prints that
// NOTICE as an eight-line object above the output somebody is here to read.
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });

// The column may not exist yet if this runs before the deploy that adds it.
// schemaSync does the same thing on boot; doing it here means the order of the
// two does not matter.
await sql.unsafe(`ALTER TABLE events ADD COLUMN IF NOT EXISTS closed boolean NOT NULL DEFAULT false`);

const slug = flag("event");
const [ev] = slug
  ? await sql`SELECT id, name, slug, closed, duration_hours, slot_minutes FROM events WHERE slug = ${slug}`
  : await sql`SELECT id, name, slug, closed, duration_hours, slot_minutes FROM events WHERE is_featured = true`;

if (!ev) {
  console.error(slug ? `No event with slug "${slug}".` : "No featured event.");
  await sql.end();
  process.exit(1);
}

const total = Math.floor((ev.duration_hours * 60) / ev.slot_minutes);
const [{ count: taken }] = await sql`
  SELECT count(*)::int AS count FROM signups WHERE event_id = ${ev.id} AND status <> 'cancelled'`;

console.log(`${ev.name}  (#${ev.id}, /${ev.slug})`);
console.log(`  ${taken} of ${total} slots taken`);
console.log(`  lineup is currently ${ev.closed ? "CLOSED" : "open"}`);

// Nothing to do is worth saying out loud rather than writing the same value
// back and reporting success.
if (ev.closed === closing) {
  console.log(`\nAlready ${closing ? "closed" : "open"} — nothing to change.`);
  await sql.end();
  process.exit(0);
}

console.log(`\nWould set closed = ${closing}.`);
console.log(
  closing
    ? "  · /api/signups refuses every new claim, including a slot a cancellation frees"
    : "  · slots can be claimed again, and anything a cancellation freed goes back on the board",
);

if (!apply) {
  console.log("\nDry run. Add --apply to do it.");
  await sql.end();
  process.exit(0);
}

await sql`UPDATE events SET closed = ${closing} WHERE id = ${ev.id}`;
const [after] = await sql`SELECT closed FROM events WHERE id = ${ev.id}`;
console.log(`\nDone — lineup is ${after.closed ? "CLOSED" : "open"}.`);
await sql.end();
