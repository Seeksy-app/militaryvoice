import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const rows = await sql`
  SELECT podcast_name, social_links, youtube_url, rss_url,
         length(social_accounts) AS acct_len
  FROM signups WHERE event_id = 1 AND status <> 'cancelled' ORDER BY slot_index`;
for (const r of rows) {
  console.log(`${String(r.podcast_name).slice(0,34).padEnd(36)} connected=${r.acct_len > 2 ? "yes" : "NO "}  links=${JSON.stringify(r.social_links).slice(0,70)}  yt=${JSON.stringify(r.youtube_url).slice(0,40)}`);
}
await sql.end();
