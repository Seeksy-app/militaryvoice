// The contract between the API and the studio agents.
//
//   AGENT_TOKEN=… npx tsx (or node) scripts/agent-smoke.mjs [studioId]
//
// The dev server must be running with the same AGENT_TOKEN. Nothing here
// touches a real recording: it makes one, drives it through the queue, and
// deletes it again.
import postgres from "postgres";
import "dotenv/config";

const BASE = process.env.API_BASE || "http://localhost:3000";
const TOKEN = process.env.AGENT_TOKEN || "";
const STUDIO = Number(process.argv[2] || 4);
if (!TOKEN) {
  console.error("Set AGENT_TOKEN to the same value the dev server has.");
  process.exit(1);
}

const sql = postgres(process.env.POSTGRES_URL, { ssl: "require" });

let bad = 0;
const check = (name, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

async function agent(method, path, body, token = TOKEN) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { "x-agent-token": token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text.slice(0, 160);
  }
  return { status: res.status, json };
}

// --- the door is shut to everyone else --------------------------------------
check("no token is refused", (await agent("POST", "/api/agent/clip-jobs/claim", undefined, "")).status === 401);
check("a wrong token is refused", (await agent("POST", "/api/agent/clip-jobs/claim", undefined, `${TOKEN}x`)).status === 401);

// --- transcript -------------------------------------------------------------
const base = Date.now();
const lines = [
  { speaker: "Host", text: "smoke test line one", startMs: base, endMs: base + 3000 },
  { speaker: "Guest", text: "smoke test line two", startMs: base + 4000, endMs: base + 9000 },
];
const t = await agent("POST", "/api/agent/transcript", { studioId: STUDIO, lines });
check("transcript accepted", t.status === 200 && t.json.written === 2, JSON.stringify(t.json));

const bad1 = await agent("POST", "/api/agent/transcript", { studioId: STUDIO, lines: [{ text: "", startMs: 0, endMs: 1 }] });
check("an empty line is refused", bad1.status === 400);
const bad2 = await agent("POST", "/api/agent/transcript", { studioId: 999999, lines });
check("an unknown studio is refused", bad2.status === 404);

// --- a recording to clip ----------------------------------------------------
const startedAt = new Date(base).toISOString();
const endedAt = new Date(base + 600_000).toISOString();
const [rec] = await sql`
  insert into recordings (event_id, studio_id, signup_id, email, title, egress_id, status, url,
                          duration_sec, size_bytes, error, started_at, ended_at, clip_status, clip_error, clip_claimed_at)
  values (2, ${STUDIO}, null, 'smoke@example.com', 'Agent smoke', ${"EG_SMOKE_" + base}, 'Ready',
          'event-1/2026-09-15T19-03-25-444Z.mp4', 600, '0', '', ${startedAt}, ${endedAt}, 'queued', '', '')
  returning *`;

const claim = await agent("POST", "/api/agent/clip-jobs/claim");
const job = claim.json.job;
check("a queued recording is handed out", job?.recordingId === rec.id, `got ${job?.recordingId}, made ${rec.id}`);
check("the job carries a signed download link", /^https?:\/\//.test(job?.downloadUrl ?? ""), (job?.downloadUrl ?? "").slice(0, 48));
check(
  "the job carries the live transcript, offset from the start of the file",
  job?.transcript?.length === 2 && job.transcript[0].startSec === 0 && job.transcript[1].startSec === 4,
  JSON.stringify(job?.transcript?.map((l) => [l.startSec, l.endSec])),
);

const [afterClaim] = await sql`select clip_status, clip_claimed_at from recordings where id = ${rec.id}`;
check("claiming marks it running", afterClaim.clip_status === "running", afterClaim.clip_status);
check("claiming stamps the time", Boolean(afterClaim.clip_claimed_at), afterClaim.clip_claimed_at);

const second = await agent("POST", "/api/agent/clip-jobs/claim");
check("a claimed job is not handed out twice", second.json.job?.recordingId !== rec.id, String(second.json.job?.recordingId));

// --- results ----------------------------------------------------------------
const done = await agent("POST", `/api/agent/clip-jobs/${rec.id}/done`, {
  clips: [
    { title: "One", caption: "cap", reason: "why", startSec: 10, endSec: 45, transcript: "words", url: "https://x/1.mp4" },
    { title: "Two", caption: "", reason: "", startSec: 90, endSec: 130, transcript: "", verticalUrl: "https://x/2.mp4" },
    { title: "Backwards", caption: "", reason: "", startSec: 300, endSec: 200, transcript: "" },
  ],
});
check("clips saved, the backwards one dropped", done.json.saved === 2, JSON.stringify(done.json));

const [afterDone] = await sql`select clip_status from recordings where id = ${rec.id}`;
check("the job is marked done", afterDone.clip_status === "done", afterDone.clip_status);

const saved = await sql`select title, start_sec, end_sec from clips where recording_id = ${rec.id} order by start_sec`;
check("clips are stored in time order", saved.map((c) => c.title).join(",") === "One,Two", saved.map((c) => c.title).join(","));

// A re-run replaces rather than doubles.
await agent("POST", `/api/agent/clip-jobs/${rec.id}/done`, {
  clips: [{ title: "Only", caption: "", reason: "", startSec: 5, endSec: 40, transcript: "" }],
});
const again = await sql`select count(*)::int as n from clips where recording_id = ${rec.id}`;
check("a re-run replaces the clips", again[0].n === 1, `${again[0].n}`);

const titleless = await agent("POST", `/api/agent/clip-jobs/${rec.id}/done`, {
  clips: [{ title: "", startSec: 1, endSec: 30 }],
});
check("a clip with no title is refused", titleless.status === 400, String(titleless.status));

const failed = await agent("POST", `/api/agent/clip-jobs/${rec.id}/failed`, { error: "smoke" });
const [afterFail] = await sql`select clip_status, clip_error from recordings where id = ${rec.id}`;
check("a failure is recorded", failed.status === 200 && afterFail.clip_status === "failed" && afterFail.clip_error === "smoke");

// --- a worker that died -----------------------------------------------------
await sql`update recordings set clip_status = 'running', clip_claimed_at = ${new Date(Date.now() - 2 * 3600e3).toISOString()} where id = ${rec.id}`;
const reclaim = await agent("POST", "/api/agent/clip-jobs/claim");
check("a job stuck running for an hour is reclaimed", reclaim.json.job?.recordingId === rec.id, String(reclaim.json.job?.recordingId));

// --- clean up ---------------------------------------------------------------
await sql`delete from clips where recording_id = ${rec.id}`;
await sql`delete from recordings where id = ${rec.id}`;
await sql`delete from transcript_lines where studio_id = ${STUDIO} and text like 'smoke test%'`;
const leftover = await sql`select count(*)::int as n from transcript_lines where text like 'smoke test%'`;
check("nothing left behind", leftover[0].n === 0, `${leftover[0].n} transcript lines`);

console.log(bad === 0 ? "\nall checks passed" : `\n${bad} check(s) failed`);
await sql.end();
process.exit(bad ? 1 : 0);
