import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const [b] = await sql`SELECT subject, sender, banner, segment, body_text FROM broadcasts WHERE id = 1`;
console.log("sender:", b.sender, "| banner:", b.banner, "| segment:", b.segment);
console.log("---");
console.log(b.body_text);
await sql.end();
