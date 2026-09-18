import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const rows = await sql`SELECT id, studio_id, egress_id, status, url, duration_sec, size_bytes, started_at FROM recordings ORDER BY id DESC LIMIT 10`;
console.log(`${rows.length} rows, highest id ${rows[0]?.id}`);
for (const r of rows) console.log(`#${r.id} ${r.egress_id} ${String(r.status).padEnd(9)} ${r.duration_sec}s ${(Number(r.size_bytes)/1e6).toFixed(2)}MB  ${r.started_at}`);
await sql.end();
