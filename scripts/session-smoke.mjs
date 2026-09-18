// "Keep me signed in" has to actually change how long the session lasts, and
// the default has to be the short one.
//
//   node scripts/session-smoke.mjs
//
// Drives the real sign-in: asks for a code, reads it out of the database
// (never the inbox), and checks the cookie that comes back.
import postgres from "postgres";
import "dotenv/config";

const BASE = process.env.API_BASE || "http://localhost:3000";
const EMAIL = "session-smoke@example.com";
const sql = postgres(process.env.POSTGRES_URL, { ssl: "require" });

let bad = 0;
const check = (name, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

async function signIn(remember) {
  await fetch(`${BASE}/api/host/request-code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL }),
  });
  const [row] = await sql`
    select token from login_tokens where email = ${EMAIL} and used_at is null
    order by id desc limit 1`;
  if (!row) throw new Error("no code was issued");
  const res = await fetch(`${BASE}/api/host/verify-code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, code: row.token, remember }),
  });
  return { ok: res.ok, cookie: res.headers.get("set-cookie") ?? "" };
}

// --- not remembered: a browser-session cookie -------------------------------
const plain = await signIn(false);
check("signs in without the box ticked", plain.ok);
check("no Max-Age, so it dies with the browser", !/max-age/i.test(plain.cookie), plain.cookie.split(";").slice(1).join(";").trim());

const exp = (c) => {
  const token = decodeURIComponent(/mv_host_session=([^;]+)/.exec(c)?.[1] ?? "");
  const body = token.split(".")[0];
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8")).exp;
};
const plainHours = (exp(plain.cookie) - Date.now()) / 3600e3;
check("the signature expires in ~12 hours", plainHours > 11.5 && plainHours < 12.5, `${plainHours.toFixed(1)}h`);

// --- remembered: thirty days ------------------------------------------------
const kept = await signIn(true);
check("signs in with the box ticked", kept.ok);
const maxAge = Number(/max-age=(\d+)/i.exec(kept.cookie)?.[1] ?? 0);
check("Max-Age is 30 days", maxAge === 30 * 24 * 3600, `${(maxAge / 86400).toFixed(0)} days`);
const keptDays = (exp(kept.cookie) - Date.now()) / 86400e3;
check("the signature agrees", keptDays > 29.5 && keptDays < 30.5, `${keptDays.toFixed(1)} days`);

// --- a used code is dead ----------------------------------------------------
const [used] = await sql`select token from login_tokens where email = ${EMAIL} order by id desc limit 1`;
const replay = await fetch(`${BASE}/api/host/verify-code`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, code: used.token, remember: true }),
});
check("a code can't be used twice", replay.status === 401, String(replay.status));

await sql`delete from login_tokens where email = ${EMAIL}`;
check("test rows cleaned up", true);

console.log(bad === 0 ? "\nall checks passed" : `\n${bad} check(s) failed`);
await sql.end();
process.exit(bad ? 1 : 0);
