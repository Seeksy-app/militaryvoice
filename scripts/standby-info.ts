import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const rows = await sql`SELECT id, event_id, pre_video_url, pre_label, fallback_video_url, fallback_label FROM studios ORDER BY id`;
for (const r of rows) console.log(JSON.stringify(r));
await sql.end();
