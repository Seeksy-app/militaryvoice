import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const rows = await sql`SELECT id, subject, body_text FROM broadcasts ORDER BY id`;
for (const r of rows) {
  const lines = String(r.body_text).split("\n");
  const bullets = lines.filter((l) => /^\s*[-•]\s+/.test(l)).length;
  console.log(`#${r.id} bullets=${bullets}  ${String(r.subject).slice(0, 44)}`);
}
const [one] = await sql`SELECT body_text FROM broadcasts WHERE id = 2`;
console.log("\n--- #2 stored body ---");
console.log(JSON.stringify(String(one.body_text)).slice(0, 900));
await sql.end();
