// Does every account actually report the same period?
//
// The page says "the last 12 months". If one platform is answering with 28
// days and another with a lifetime total, adding them up and printing one
// window over the sum is a false claim, so this looks at what the raw payload
// says rather than trusting the label.
import "dotenv/config";
import { storage } from "../server/storage.js";
import { rawAnalytics, parseSocialAccounts } from "../server/uploadPost.js";

const profiles = (await storage.listAllProfiles()).filter((p) => p.uploadPostUsername.trim() !== "");
for (const p of profiles) {
  const accounts = parseSocialAccounts(p.socialAccounts);
  if (accounts.length === 0) continue;
  const fb = accounts.find((a) => a.platform === "facebook");
  const pageId = fb && /^\d+$/.test(fb.username) ? fb.username : undefined;
  let res: Record<string, unknown>;
  try {
    res = await rawAnalytics(p.uploadPostUsername, accounts.map((a) => a.platform), pageId);
  } catch (e) {
    console.log(`${p.uploadPostUsername}: FAILED ${(e as Error).message}`);
    continue;
  }
  for (const [platform, block] of Object.entries(res)) {
    if (!block || typeof block !== "object") continue;
    // Print only the keys that look like they describe a window.
    const found: string[] = [];
    const walk = (n: unknown, d = 0) => {
      if (d > 3 || !n || typeof n !== "object") return;
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        if (/period|range|since|until|start|end|days|window|date/i.test(k) && typeof v !== "object") {
          found.push(`${k}=${String(v).slice(0, 40)}`);
        }
        if (v && typeof v === "object") walk(v, d + 1);
      }
    };
    walk(block);
    console.log(`${p.uploadPostUsername}/${platform}: ${found.length ? found.join("  ") : "(no window field)"}`);
  }
}
process.exit(0);
