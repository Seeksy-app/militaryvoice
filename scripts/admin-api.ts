// Call an admin endpoint on production without handling the credential.
//
//   npx tsx scripts/admin-api.ts GET  /api/admin/audience
//   npx tsx scripts/admin-api.ts POST /api/admin/audience/refresh '{"handle":"x"}'
//
// The credential comes from scripts/adminAuth.mjs (ADMIN_SCRIPT_KEY, or the old shared password until that key
// exists). Neither is ever printed, so it is never in a shell variable, a file, or this session's scrollback.
import "dotenv/config";
import { adminAuth } from "./adminAuth.mjs";

const [method = "GET", path = "/api/admin/audience", body] = process.argv.slice(2);
const BASE = process.env.ADMIN_API_BASE || "https://www.militaryvoices.ai";

const res = await fetch(`${BASE}${path}`, {
  method,
  headers: {
    ...adminAuth,
    ...(body ? { "content-type": "application/json" } : {}),
  },
  body,
});
const text = await res.text();
console.error(`${method} ${path} → ${res.status}`);
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text.slice(0, 4000));
}
process.exit(res.ok ? 0 : 1);
