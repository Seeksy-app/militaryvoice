// Read-only: what Resend has actually told us about the sends we've made.
import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });

const b = await sql`SELECT id, subject, status, segment, source, recipient_count, sent_at, created_at
                    FROM broadcasts ORDER BY id`;
console.log("BROADCASTS");
for (const r of b) {
  console.log(` #${r.id} [${r.status}] src=${r.source} seg=${r.segment} n=${r.recipient_count ?? "-"} sent=${r.sent_at ?? "-"}  ${r.subject}`);
}

console.log("\nEVENT TYPES RECORDED");
const t = await sql`SELECT event_type, count(*) AS n FROM broadcast_events GROUP BY event_type ORDER BY n DESC`;
console.log(t.length ? t.map((r) => `  ${r.event_type}: ${r.n}`).join("\n") : "  (none)");

console.log("\nSENDS PER BROADCAST");
const s = await sql`SELECT broadcast_id, count(*) AS n, count(nullif(resend_id,'')) AS with_id
                    FROM broadcast_sends GROUP BY broadcast_id ORDER BY broadcast_id`;
console.log(s.map((r) => `  #${r.broadcast_id}: ${r.n} sends, ${r.with_id} with a resend id`).join("\n") || "  (none)");

console.log("\nCLICK URLS");
const u = await sql`SELECT url, count(*) AS n FROM broadcast_events WHERE event_type='clicked' GROUP BY url ORDER BY n DESC LIMIT 20`;
console.log(u.length ? u.map((r) => `  ${r.n}x ${r.url}`).join("\n") : "  (no click events at all)");

await sql.end();
