import "dotenv/config";
import postgres from "postgres";
const KEY = process.env.UPLOAD_POST_API_KEY;
const BASE = "https://api.upload-post.com/api";
const sql = postgres(process.env.POSTGRES_URL, { ssl: "require" });

async function call(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `ApiKey ${KEY}` } });
  const t = await res.text();
  try { return { status: res.status, json: JSON.parse(t) }; } catch { return { status: res.status, text: t.slice(0, 400) }; }
}

const rows = await sql`select email, upload_post_username, social_accounts from podcaster_profiles where upload_post_username <> '' limit 3`;
console.log("profiles with an upload-post username:", rows.length);
for (const r of rows) {
  const accts = JSON.parse(r.social_accounts || "[]");
  const platforms = [...new Set(accts.map((a) => a.platform))].join(",");
  if (!platforms) continue;
  console.log(`\n=== ${r.upload_post_username} (${r.email}) — ${platforms}`);
  const out = await call(`/analytics/${encodeURIComponent(r.upload_post_username)}?platforms=${platforms}`);
  console.log(JSON.stringify(out.json ?? out.text, null, 2).slice(0, 3000));
}
await sql.end();
