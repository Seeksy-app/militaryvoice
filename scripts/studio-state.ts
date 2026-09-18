import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const [one] = await sql`SELECT * FROM studios LIMIT 1`;
console.log("columns:", Object.keys(one).join(", "));
const rows = await sql`SELECT * FROM studios ORDER BY id`;
for (const r of rows) console.log(`#${r.id} ev=${r.event_id} status=${r.status} egress=${r.broadcast_egress_id || "-"}  ${r.name}`);
await sql.end();
