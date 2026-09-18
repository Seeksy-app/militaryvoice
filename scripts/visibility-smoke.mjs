// Hiding an event has to hide it everywhere, including from a direct link.
//
//   node scripts/visibility-smoke.mjs [eventId]
//
// Flips one event off, checks every public path that can reach an event, and
// puts it back. Reads the admin password from the database so it is never
// typed or printed.
import postgres from "postgres";
import "dotenv/config";

const BASE = process.env.API_BASE || "http://localhost:3000";
const ID = Number(process.argv[2] || 1);

const sql = postgres(process.env.POSTGRES_URL, { ssl: "require" });
const [{ admin_password: PW }] = await sql`select admin_password from events where is_featured = true`;
const [event] = await sql`select id, slug, name, visible, is_featured from events where id = ${ID}`;
if (!event) {
  console.error(`No event ${ID}`);
  process.exit(1);
}
// Hiding the featured event blanks the public site for as long as the test
// holds it that way, and an edge cache can outlive the test. Never on the
// front door — this script writes to whatever database it is pointed at, and
// that is routinely the live one.
if (event.is_featured) {
  console.error(
    `"${event.name}" is the live-site event. Hiding it would take the public site down for the length of this run.\n` +
      `Point this at another event, or make a different one featured first.`,
  );
  await sql.end();
  process.exit(1);
}
console.log(`Testing "${event.name}" (/${event.slug})\n`);

let bad = 0;
const check = (name, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const get = async (path) => {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  return { status: res.status, text };
};
const setVisible = (v) =>
  fetch(`${BASE}/api/admin/events/${ID}`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-admin-password": PW },
    body: JSON.stringify({ visible: v }),
  });

const listed = async () => JSON.parse((await get("/api/events")).text).some((e) => e.id === ID);

// --- visible ----------------------------------------------------------------
await setVisible(true);
check("listed while public", await listed());
check("its own config resolves", (await get(`/api/event?slug=${event.slug}`)).status === 200);
check("in the sitemap", (await get("/sitemap.xml")).text.includes(`/event/${event.slug}`));

// --- hidden -----------------------------------------------------------------
const off = await setVisible(false);
check("the toggle saves", off.ok, String(off.status));

check("gone from the events list", !(await listed()));
const cfg = await get(`/api/event?slug=${event.slug}`);
check("a direct link 404s, not just unlisted", cfg.status === 404, String(cfg.status));
check("out of the sitemap", !(await get("/sitemap.xml")).text.includes(`/event/${event.slug}`));

const watch = await get(`/api/watch/token?slug=${event.slug}`);
const watchJson = JSON.parse(watch.text);
check("the watch page can't be reached either", watchJson.configured === false, JSON.stringify(watchJson).slice(0, 80));

// A podcaster shouldn't be looking at a switched-off event either — that is
// the case the switch exists for. Uses a real host session cookie, minted the
// same way the server signs one.
const hostCookie = await (async () => {
  const crypto = await import("node:crypto");
  const [p] = await sql`select email from podcaster_profiles limit 1`;
  if (!p) return null;
  const payload = { email: p.email, exp: Date.now() + 3600e3 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto
    .createHmac("sha256", process.env.SESSION_SECRET || "dev-only-insecure-secret-change-me")
    .update(body)
    .digest("base64url");
  return `mv_host_session=${body}.${mac}`;
})();

if (hostCookie) {
  const rows = await fetch(`${BASE}/api/host/events`, { headers: { cookie: hostCookie } }).then((r) => r.json());
  check("gone from the podcaster's event list", !rows.some((r) => r.event.id === ID), `${rows.length} shown`);
} else {
  console.log("SKIP  podcaster's event list — no profile to sign in as");
}

// Admin must still see it, or an event could be hidden with no way back.
const adminSee = await fetch(`${BASE}/api/admin/events`, { headers: { "x-admin-password": PW } });
const adminRows = await adminSee.json();
check("admin still sees it", adminRows.some((e) => e.id === ID));
check("admin can tell it is hidden", adminRows.find((e) => e.id === ID)?.visible === false);

// --- back -------------------------------------------------------------------
await setVisible(event.visible !== false);
check("put back as we found it", (await listed()) === (event.visible !== false));

console.log(bad === 0 ? "\nall checks passed" : `\n${bad} check(s) failed`);
await sql.end();
process.exit(bad ? 1 : 0);
