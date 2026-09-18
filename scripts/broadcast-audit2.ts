import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });

const rows = await sql`
  SELECT e.event_type, count(DISTINCT e.resend_id) AS n
  FROM broadcast_events e
  JOIN broadcast_sends s ON s.resend_id = e.resend_id
  WHERE s.broadcast_id = 1
  GROUP BY e.event_type ORDER BY n DESC`;
console.log("Broadcast #1, events matched to its own sends:");
console.log(rows.map((r) => `  ${r.event_type}: ${r.n}`).join("\n") || "  (none matched)");

const orphan = await sql`
  SELECT e.event_type, count(*) AS n
  FROM broadcast_events e
  LEFT JOIN broadcast_sends s ON s.resend_id = e.resend_id
  WHERE s.id IS NULL GROUP BY e.event_type ORDER BY n DESC`;
console.log("\nEvents with no matching send row (transactional mail, etc.):");
console.log(orphan.map((r) => `  ${r.event_type}: ${r.n}`).join("\n") || "  (none)");

const sample = await sql`
  SELECT s.email, s.resend_id,
         (SELECT string_agg(DISTINCT e.event_type, ',') FROM broadcast_events e WHERE e.resend_id = s.resend_id) AS events
  FROM broadcast_sends s WHERE s.broadcast_id = 1 ORDER BY s.id LIMIT 8`;
console.log("\nSample sends from broadcast #1:");
for (const r of sample) console.log(`  ${String(r.email).padEnd(34)} ${r.resend_id ? "id ok" : "NO ID"}  events=${r.events ?? "none"}`);

await sql.end();
