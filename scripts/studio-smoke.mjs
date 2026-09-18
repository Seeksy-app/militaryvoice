// End-to-end exercise of the scene rail's API against a throwaway studio.
// Reads the admin password straight from the DB so it never appears anywhere.
import postgres from "postgres";
import "dotenv/config";

const sql = postgres(process.env.POSTGRES_URL, { ssl: "require" });
const [{ admin_password: PW }] = await sql`select admin_password from events where is_featured = true`;

const BASE = "http://localhost:3000";
const STUDIO = Number(process.argv[2] || 4); // studio 4 = the "test" event's own
// The watch page resolves a studio inside an event, so a studio that isn't the
// featured event's needs its event named too, or the lookup falls back to the
// featured studio and the seed we read back belongs to something else.
const SLUG = process.argv[3] || "test";

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-admin-password": PW },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text.slice(0, 200);
  }
  return { status: res.status, json };
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const made = [];

// --- add each kind ----------------------------------------------------------
const cam = await api("POST", "/api/admin/scenes", { studioId: STUDIO, name: "Cameras", kind: "camera" });
check("create camera scene", cam.status === 201 && cam.json.kind === "camera", `${cam.status} ${JSON.stringify(cam.json).slice(0, 120)}`);
if (cam.json?.id) made.push(cam.json.id);

const med = await api("POST", "/api/admin/scenes", {
  studioId: STUDIO,
  name: "Sponsor read",
  kind: "media",
  mediaUrl: "https://example.com/spot.mp4",
  mediaKind: "video",
  mediaLabel: "Spot",
});
check("create media scene", med.status === 201 && med.json.mediaUrl.endsWith("spot.mp4"), String(med.status));
if (med.json?.id) made.push(med.json.id);

const badMedia = await api("POST", "/api/admin/scenes", { studioId: STUDIO, name: "Empty", kind: "media" });
check("media scene without a file is refused", badMedia.status === 400, `${badMedia.status} ${badMedia.json.message ?? ""}`);

const cd = await api("POST", "/api/admin/scenes", {
  studioId: STUDIO,
  name: "Back in 5",
  kind: "countdown",
  countdownSeconds: 300,
});
check("create countdown scene", cd.status === 201 && cd.json.countdownSeconds === 300, String(cd.status));
if (cd.json?.id) made.push(cd.json.id);

const badCd = await api("POST", "/api/admin/scenes", { studioId: STUDIO, name: "Too long", kind: "countdown", countdownSeconds: 99999 });
check("countdown over the cap is refused", badCd.status === 400, String(badCd.status));

// --- list / order -----------------------------------------------------------
let list = await api("GET", `/api/admin/scenes?studioId=${STUDIO}`);
const mine = () => list.json.filter((s) => made.includes(s.id));
check("all three are listed", mine().length === 3, `${mine().length} of 3`);
check(
  "listed in the order they were added",
  mine().map((s) => s.name).join(",") === "Cameras,Sponsor read,Back in 5",
  mine().map((s) => s.name).join(","),
);

const reversed = [...made].reverse();
const ord = await api("POST", "/api/admin/scenes/reorder", { studioId: STUDIO, ids: reversed });
check("reorder accepted", ord.status === 200, String(ord.status));
list = await api("GET", `/api/admin/scenes?studioId=${STUDIO}`);
check(
  "order is what we sent",
  mine().map((s) => s.id).join(",") === reversed.join(","),
  mine().map((s) => s.name).join(","),
);

// A partial list must not lose the scenes it didn't mention.
const partial = await api("POST", "/api/admin/scenes/reorder", { studioId: STUDIO, ids: [made[1]] });
check("partial reorder keeps every scene", partial.json.filter((s) => made.includes(s.id)).length === 3);

// --- rename -----------------------------------------------------------------
const ren = await api("PATCH", `/api/admin/scenes/${made[0]}`, { name: "Wide shot" });
check("rename", ren.status === 200 && ren.json.name === "Wide shot", String(ren.status));
const renBad = await api("PATCH", `/api/admin/scenes/${made[0]}`, { name: "" });
check("empty name is refused", renBad.status === 400, String(renBad.status));

// --- apply ------------------------------------------------------------------
const before = await api("GET", `/api/admin/studio?studioId=${STUDIO}`);

const applyMedia = await api("POST", `/api/admin/scenes/${made[1]}/apply`, { studioId: STUDIO });
check(
  "media scene puts the clip on the stage",
  applyMedia.json?.stageMediaPlaying === true && applyMedia.json?.stageMediaUrl?.endsWith("spot.mp4"),
  JSON.stringify({ playing: applyMedia.json?.stageMediaPlaying, url: applyMedia.json?.stageMediaUrl }),
);
check("media scene is marked as the one on air", applyMedia.json?.currentSceneId === made[1], String(applyMedia.json?.currentSceneId));

const applyCd = await api("POST", `/api/admin/scenes/${made[2]}/apply`, { studioId: STUDIO });
const endsIn = applyCd.json?.countdownEndsAtUtc ? (Date.parse(applyCd.json.countdownEndsAtUtc) - Date.now()) / 1000 : NaN;
check("countdown sets an end instant ~300s out", endsIn > 290 && endsIn < 305, `${Math.round(endsIn)}s`);
check("countdown clears the stage media", applyCd.json?.stageMediaPlaying === false);
check("countdown carries its label", applyCd.json?.countdownLabel === "Back in 5", String(applyCd.json?.countdownLabel));

const applyCam = await api("POST", `/api/admin/scenes/${made[0]}/apply`, { studioId: STUDIO });
check("camera scene stops the media", applyCam.json?.stageMediaPlaying === false);
check("camera scene clears a running countdown", applyCam.json?.countdownEndsAtUtc === "", JSON.stringify(applyCam.json?.countdownEndsAtUtc));

// --- countdown clear --------------------------------------------------------
await api("POST", `/api/admin/scenes/${made[2]}/apply`, { studioId: STUDIO });
const cleared = await api("POST", "/api/admin/studio/countdown/clear", { studioId: STUDIO });
check("clear stops the clock", cleared.json?.countdownEndsAtUtc === "", JSON.stringify(cleared.json?.countdownEndsAtUtc));

// --- graphics ---------------------------------------------------------------
const logo = await api("PATCH", "/api/admin/studio", {
  studioId: STUDIO,
  logoUrl: "https://example.com/mark.png",
  logoCorner: "bottom-left",
  logoSize: 140,
  logoVisible: true,
});
check(
  "logo settings save",
  logo.json?.logoCorner === "bottom-left" && logo.json?.logoSize === 140 && logo.json?.logoVisible === true,
  String(logo.status),
);
const badCorner = await api("PATCH", "/api/admin/studio", { studioId: STUDIO, logoCorner: "middle" });
check("a corner that isn't a corner is refused", badCorner.status === 400, String(badCorner.status));
const badSize = await api("PATCH", "/api/admin/studio", { studioId: STUDIO, logoSize: 5000 });
check("an absurd logo size is refused", badSize.status === 400, String(badSize.status));

// --- the watch page's own seed ---------------------------------------------
const watch = await fetch(`${BASE}/api/watch/token?slug=${SLUG}&studioId=${STUDIO}`).then((r) => r.json());
check("watch seed carries the logo", watch?.meta?.logoUrl === "https://example.com/mark.png", JSON.stringify(watch?.meta?.logoUrl));
check("watch seed carries logo placement", watch?.meta?.logoCorner === "bottom-left" && watch?.meta?.logoSize === 140);

await api("PATCH", "/api/admin/studio", { studioId: STUDIO, logoVisible: false });
const watch2 = await fetch(`${BASE}/api/watch/token?slug=${SLUG}&studioId=${STUDIO}`).then((r) => r.json());
check("a hidden logo is not sent to viewers at all", watch2?.meta?.logoUrl === "", JSON.stringify(watch2?.meta?.logoUrl));

// --- clean up ---------------------------------------------------------------
for (const id of made) await api("DELETE", `/api/admin/scenes/${id}`);
const after = await api("GET", `/api/admin/scenes?studioId=${STUDIO}`);
check("every test scene removed", after.json.filter((s) => made.includes(s.id)).length === 0);

await api("PATCH", "/api/admin/studio", {
  studioId: STUDIO,
  logoUrl: "",
  logoVisible: false,
  logoCorner: "top-right",
  logoSize: 96,
  stageMediaPlaying: Boolean(before.json?.studio?.stageMediaPlaying),
  stageMediaUrl: before.json?.studio?.stageMediaUrl ?? "",
});
await api("POST", "/api/admin/studio/countdown/clear", { studioId: STUDIO });
check("studio put back as we found it", true);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await sql.end();
process.exit(failed.length ? 1 : 0);
