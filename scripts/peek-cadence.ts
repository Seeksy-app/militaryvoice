import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const rows = await sql`SELECT id, source, subject, banner, sender, body_text FROM broadcasts WHERE source LIKE 'cadence:%' ORDER BY id`;
for (const r of rows) {
  console.log(`\n${"=".repeat(70)}\n${r.source}  (#${r.id})  banner=${r.banner} sender=${r.sender}\nSUBJECT: ${r.subject}\n${"-".repeat(70)}`);
  console.log(r.body_text);
}
await sql.end();
