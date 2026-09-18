import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const [e] = await sql`SELECT * FROM events WHERE is_featured = true`;
const taken = await sql`SELECT slot_index, podcast_name, host_name, email FROM signups WHERE event_id = ${e.id} AND status <> 'cancelled' ORDER BY slot_index`;
const byIndex = new Map(taken.map((t: any) => [t.slot_index, t]));
const fmt = (d: Date) => new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(d);
console.log(`event starts ${e.start_at_utc} · ${e.slot_minutes}m slots · onAir=${e.on_air_minutes} buffer=${e.buffer_minutes}/${e.buffer_position}`);
for (let i = 0; i < 6; i++) {
  const start = new Date(new Date(e.start_at_utc).getTime() + i * e.slot_minutes * 60000);
  const t = byIndex.get(i);
  console.log(`  slot ${i}: ${fmt(start)}  ${t ? `TAKEN — ${t.podcast_name} (${t.host_name})` : "free"}`);
}
const ric = await sql`SELECT id, slot_index, podcast_name, host_name, email, photo_url FROM signups WHERE event_id = ${e.id} AND lower(email) LIKE '%riccoh%'`;
console.log("\nRiccoh's signups:");
for (const r of ric) console.log(`  #${r.id} slot ${r.slot_index} ${r.podcast_name} / ${r.host_name} photo=${r.photo_url ? "yes" : "NO"}`);
await sql.end();
