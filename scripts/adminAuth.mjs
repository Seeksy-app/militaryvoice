// The admin credential for scripts, as request headers: `headers: { ...adminAuth }`.
//
// ADMIN_SCRIPT_KEY (from .env, 32+ characters) goes out as x-admin-script-key. Until that key exists, it falls back
// to the featured event's old shared password, read straight from the database, so nothing breaks before the
// switch. Once ADMIN_SCRIPT_KEY is set in Vercel, the server refuses the shared password, and this file is the
// only place a script gets its credential. Neither value is ever printed.
import "dotenv/config";
import postgres from "postgres";

async function load() {
  const key = (process.env.ADMIN_SCRIPT_KEY ?? "").trim();
  if (key.length >= 32) return { "x-admin-script-key": key };
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("No ADMIN_SCRIPT_KEY in .env, and no database URL for the old password.");
  const sql = postgres(url, { ssl: "require", max: 1 });
  try {
    const [row] = await sql`SELECT admin_password AS p FROM events WHERE is_featured = true LIMIT 1`;
    const password = String(row?.p ?? "");
    if (!password) throw new Error("No ADMIN_SCRIPT_KEY in .env and no admin password on the featured event.");
    return { "x-admin-password": password };
  } finally {
    await sql.end();
  }
}

/** @type {Record<string, string>} */
export const adminAuth = await load();
