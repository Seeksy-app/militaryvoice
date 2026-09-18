import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const rows = await sql`SELECT id, studio_id, status, url, duration_sec, size_bytes, started_at, ended_at FROM recordings ORDER BY id DESC LIMIT 6`;
for (const r of rows) {
  const mb = Number(r.size_bytes) / 1e6;
  const kbps = r.duration_sec > 0 ? (Number(r.size_bytes) * 8) / r.duration_sec / 1000 : 0;
  console.log(`#${r.id} studio=${r.studio_id} ${String(r.status).padEnd(9)} ${String(r.duration_sec).padStart(4)}s ${mb.toFixed(2)}MB ${kbps.toFixed(0)}kbps  ${r.url}`);
}
await sql.end();
