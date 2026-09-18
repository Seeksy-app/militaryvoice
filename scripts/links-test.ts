// What the parser makes of the links people actually typed.
import "dotenv/config";
import postgres from "postgres";
import { deriveSocialAccounts, detectSocialLink } from "../shared/socialLinks.js";

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const rows = await sql`
  SELECT podcast_name, social_links, youtube_url, social_accounts
  FROM signups WHERE event_id = 1 AND status <> 'cancelled' ORDER BY slot_index`;
await sql.end();

let gained = 0;
for (const r of rows) {
  let connected: any[] = [];
  try { connected = JSON.parse(String(r.social_accounts || "[]")); } catch { /* noop */ }
  const derived = deriveSocialAccounts(connected, String(r.social_links || ""), String(r.youtube_url || ""));
  const added = derived.slice(connected.length);
  if (added.length) gained += added.length;
  const name = String(r.podcast_name).slice(0, 30).padEnd(32);
  const before = connected.length ? connected.map((a: any) => a.platform).join(",") : "—";
  const after = added.length ? added.map((a) => `${a.platform}:${a.username}`).join(" ") : "—";
  console.log(`${name} connected=${before.padEnd(34)} gained: ${after}`);
}
console.log(`\n${gained} follow buttons recovered from pasted links.`);

console.log("\nEdge cases:");
for (const t of [
  "Instagram.com/ @formeractionguys",
  "https://www.youtube.com/watch?v=HLm7vet",
  "https://www.youtube.com/playlist?list=PL123",
  "https://youtube.com/@thissobervet?si=ENxyz",
  "www.oscarmikeradio.com",
  "@riccoh_player",
  "https://www.linkedin.com/company/talking-with-heroes-podcast/?viewAsMember=true",
  "https://www.instagram.com/th3drillpad?stkn=MW9ia2NrcXA2dnprZA==",
]) {
  const d = detectSocialLink(t);
  console.log(`  ${t.slice(0, 56).padEnd(58)} → ${d ? `${d.platform} @${d.username}  ${d.url}` : "(plain website / unplaceable)"}`);
}
