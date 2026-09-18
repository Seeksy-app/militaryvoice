import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const [one] = await sql`SELECT * FROM recordings ORDER BY id DESC LIMIT 1`;
if (!one) console.log("no recordings at all");
else {
  console.log("columns:", Object.keys(one).join(", "));
  const rows = await sql`SELECT * FROM recordings ORDER BY id DESC LIMIT 4`;
  for (const r of rows) console.log(JSON.stringify(r).slice(0, 400));
}
const st = await sql`SELECT id, name, recording_egress_id, status FROM studios ORDER BY id`;
console.log("\nstudios:");
for (const s of st) console.log(`  #${s.id} ${s.name} status=${s.status} rec_egress=${s.recording_egress_id || "-"}`);
await sql.end();
