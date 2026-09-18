import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const evs = await sql`SELECT * FROM events ORDER BY id`;
for (const e of evs) {
  const [{ n: taken }] = await sql`SELECT count(*)::int AS n FROM signups WHERE event_id = ${e.id} AND status <> 'cancelled'`;
  const total = Math.floor((e.duration_hours * 60) / e.slot_minutes);
  console.log(`#${e.id} ${e.name} — ${total} slots, ${taken} taken, ${total - taken} open  (visible=${e.visible}, featured=${e.is_featured ?? "?"})`);
}
const [{ n: contacts }] = await sql`SELECT count(*)::int AS n FROM contacts WHERE status = 'active'`;
const [{ n: nosl }] = await sql`
  SELECT count(*)::int AS n FROM contacts c WHERE c.status='active'
  AND lower(c.email) NOT IN (SELECT lower(email) FROM signups WHERE status <> 'cancelled')`;
console.log(`\nactive contacts: ${contacts} · of those with no slot anywhere: ${nosl}`);
await sql.end();
