// Build the audience snapshot and print it.
//
// Read-only by default. `--save` writes the result to the one site_settings
// row the sponsor pages read — the same single key/value write the admin
// Refresh button performs, and nothing else.
import "dotenv/config";
import { buildAudienceSnapshot, saveAudienceSnapshot } from "../server/audience.js";
import { storage } from "../server/storage.js";

const featured = await storage.getFeaturedEvent();
const snap = await buildAudienceSnapshot(featured?.id);
console.log(JSON.stringify(snap, null, 2));

if (process.argv.includes("--save")) {
  await saveAudienceSnapshot(snap);
  console.log("\nSaved. /api/audience/summary now serves this.");
}
process.exit(0);
