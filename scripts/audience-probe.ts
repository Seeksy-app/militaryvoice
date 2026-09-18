// Build the audience snapshot and print it WITHOUT saving. Read-only against
// the database; the only writes this could ever cause are the admin refresh
// route's, which this deliberately does not call.
import "dotenv/config";
import { buildAudienceSnapshot } from "../server/audience.js";
import { storage } from "../server/storage.js";

const featured = await storage.getFeaturedEvent();
const snap = await buildAudienceSnapshot(featured?.id);
console.log(JSON.stringify(snap, null, 2));
process.exit(0);
