// Render the lineup poster locally at every size, so the layout can be judged
// without a deploy round trip.
import "dotenv/config";
import fs from "node:fs/promises";
import postgres from "postgres";
import { buildLineupCard, CARD_SIZES, type CardSize } from "../server/shareCard.js";

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const [event] = await sql`SELECT * FROM events WHERE is_featured = true LIMIT 1`;
const rows = await sql`
  SELECT podcast_name, photo_url FROM signups
  WHERE event_id = ${event.id} AND status <> 'cancelled' ORDER BY slot_index`;
await sql.end();

const origin = "https://www.militaryvoice.ai";
const shows = rows.map((r: any) => ({
  podcastName: String(r.podcast_name),
  photoUrl: r.photo_url ? (String(r.photo_url).startsWith("http") ? String(r.photo_url) : origin + r.photo_url) : undefined,
}));
const dateLabel = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "America/New_York" }).format(new Date(event.start_at_utc));

const out = process.argv[2] ?? ".";
for (const size of Object.keys(CARD_SIZES) as CardSize[]) {
  const buf = await buildLineupCard({ shows, dateLabel }, size);
  await fs.writeFile(`${out}/lineup-${size}.jpg`, buf);
  console.log(`${out}/lineup-${size}.jpg  (${shows.length} shows)`);
}
process.exit(0);
