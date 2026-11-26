// Call an admin endpoint on production without handling the credential.
//
//   npx tsx scripts/admin-api.ts GET  /api/admin/audience
//   npx tsx scripts/admin-api.ts POST /api/admin/audience/refresh '{"handle":"x"}'
//
// It sends ADMIN_SCRIPT_KEY (from .env) as x-admin-script-key. Until that key exists it falls back to the
// featured event's old shared password, read straight from the database. Neither is ever printed, so it is
// never in a shell variable, a file, or this session's scrollback.
import "dotenv/config";
import postgres from "postgres";

const [method = "GET", path = "/api/admin/audience", body] = process.argv.slice(2);
const BASE = process.env.ADMIN_API_BASE || "https://www.militaryvoice.ai";

const scriptKey = process.env.ADMIN_SCRIPT_KEY ?? "";
let auth: Record<string, string>;
if (scriptKey.length >= 32) {
  auth = { "x-admin-script-key": scriptKey };
} else {
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
  const [row] = await sql`SELECT admin_password AS p FROM events WHERE is_featured = true LIMIT 1`;
  await sql.end();
  const password = String(row?.p ?? "");
  if (!password) throw new Error("No ADMIN_SCRIPT_KEY in .env and no admin password on the featured event.");
  auth = { "x-admin-password": password };
}

const res = await fetch(`${BASE}${path}`, {
  method,
  headers: {
    ...auth,
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
