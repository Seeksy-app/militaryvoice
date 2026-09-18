// Does the payload tell us how many posts produced those impressions?
//
// Without a post count there is no measured impressions-per-post, and any
// projection is followers multiplied by a number somebody made up. With one,
// the projection is arithmetic on things we actually observed.
import "dotenv/config";
import { storage } from "../server/storage.js";
import { rawAnalytics, parseSocialAccounts } from "../server/uploadPost.js";

const profiles = (await storage.listAllProfiles()).filter((p) => p.uploadPostUsername.trim() !== "");
for (const p of profiles) {
  const accounts = parseSocialAccounts(p.socialAccounts);
  if (!accounts.length) continue;
  const fb = accounts.find((a) => a.platform === "facebook");
  const pageId = fb && /^\d+$/.test(fb.username) ? fb.username : undefined;
  let res: Record<string, unknown>;
  try { res = await rawAnalytics(p.uploadPostUsername, accounts.map((a) => a.platform), pageId); }
  catch { continue; }

  for (const [platform, block] of Object.entries(res)) {
    if (!block || typeof block !== "object") continue;
    const hits: string[] = [];
    const walk = (n: unknown, d = 0) => {
      if (d > 4 || !n || typeof n !== "object") return;
      if (Array.isArray(n)) {
        // An array of post-shaped objects is itself the post count.
        if (n.length && typeof n[0] === "object" && n[0] !== null) {
          const k = Object.keys(n[0] as object).join(",");
          if (/impress|like|view|permalink|media|caption|id/i.test(k)) hits.push(`array[${n.length}] of {${k.slice(0, 60)}}`);
        }
        n.slice(0, 3).forEach((v) => walk(v, d + 1));
        return;
      }
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        if (/post_count|posts_count|total_posts|media_count|video_count|num_posts|tweet_count/i.test(k) && typeof v !== "object") {
          hits.push(`${k}=${v}`);
        }
        walk(v, d + 1);
      }
    };
    walk(block);
    if (hits.length) console.log(`${p.uploadPostUsername}/${platform}: ${[...new Set(hits)].join(" | ")}`);
  }
}
process.exit(0);
