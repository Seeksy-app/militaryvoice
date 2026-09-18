import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
// His own face rather than the Devil Dawg artwork: the ceremony is him
// opening the day, not one of his shows.
const [row] = await sql`
  UPDATE signups SET photo_url = '/riccoh-player.jpg'
  WHERE podcast_name = 'Welcoming Ceremonies' RETURNING id, podcast_name, host_name, photo_url`;
console.log(row ? `#${row.id} ${row.podcast_name} / ${row.host_name} → ${row.photo_url}` : "no ceremony slot found");
await sql.end();
