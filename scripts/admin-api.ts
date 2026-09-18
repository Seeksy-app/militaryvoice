// Call an admin endpoint on production without handling the credential.
//
//   npx tsx scripts/admin-api.ts GET  /api/admin/audience
//   npx tsx scripts/admin-api.ts POST /api/admin/audience/refresh '{"handle":"x"}'
//
// requireAdmin accepts the featured event's shared password in an
// x-admin-password header. This reads it straight from the database into the
// request and never prints it, so it is never in a shell variable, a file, or
// this session's scrollback.
import "dotenv/config";
import postgres from "postgres";

const [method = "GET", path = "/api/admin/audience", body] = process.argv.slice(2);
const BASE = process.env.ADMIN_API_BASE || "https://www.militaryvoice.ai";

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const [row] = await sql`SELECT admin_password AS p FROM events WHERE is_featured = true LIMIT 1`;
await sql.end();
const password = String(row?.p ?? "");
if (!password) throw new Error("No admin password on the featured event.");

const res = await fetch(`${BASE}${path}`, {
  method,
  headers: {
    "x-admin-password": password,
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
