// Point the 7am ceremony at Riccoh's headshot.
import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const [row] = await sql`
  UPDATE signups SET photo_url = '/riccoh-host.jpg'
  WHERE podcast_name = 'Welcoming Ceremonies' RETURNING id, podcast_name, host_name, photo_url`;
console.log(row ? `#${row.id} ${row.podcast_name} / ${row.host_name} → ${row.photo_url}` : "no ceremony slot found");
await sql.end();
