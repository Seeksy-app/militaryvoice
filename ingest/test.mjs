// A local rehearsal of the agent with no MediaMTX and no network: a fake site,
// two real MP4 segments made by ffmpeg, a dropped-and-back stream (one
// session), and the finish call. Run: node ingest/test.mjs
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mvingest-"));
const KEY = "mvkTESTKEYTESTKEYTESTKEYTESTKEY12";
const calls = [];

// The fake site.
const site = http.createServer(async (req, res) => {
  let b = ""; for await (const c of req) b += c;
  const body = JSON.parse(b || "{}");
  const route = req.url.replace("/api/ingest/", "");
  calls.push({ route, auth: req.headers.authorization, body });
  const out = route === "authorize" ? {} : route === "started" ? { sessionId: 7, startedAt: new Date().toISOString() } : route === "finish" ? { ok: true, recordingId: 99 } : { kick: [] };
  res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(out));
});
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const apiBase = `http://127.0.0.1:${site.address().port}`;

const env = { ...process.env, API_BASE: apiBase, INGEST_TOKEN: "test-token", REC_DIR: `${tmp}/rec`, STATE_DIR: `${tmp}/state`, DONE_DIR: `${tmp}/done`, WORK_DIR: `${tmp}/work`, LOCAL_STORE: `${tmp}/store`, STORE: "local", AGENT_PORT: "18088", GRACE_MS: "2500", SETTLE_MS: "300", HEARTBEAT_MS: "60000", MTX_API: "http://127.0.0.1:1" };
const agent = spawn("node", [new URL("./agent.mjs", import.meta.url).pathname], { env, stdio: ["ignore", "inherit", "inherit"] });
await sleep(800);

const post = (url, form) => fetch(`http://127.0.0.1:18088${url}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
const ok = (name, cond) => { console.log(cond ? "PASS" : "FAIL", name); if (!cond) process.exitCode = 1; };

// 1. auth: a publish with the key is allowed, a read is refused, a junk path is refused.
const auth = (q) => fetch("http://127.0.0.1:18088/auth", { method: "POST", body: JSON.stringify(q) }).then((r) => r.status);
ok("publish allowed", (await auth({ action: "publish", path: `live/${KEY}`, ip: "1.2.3.4" })) === 200);
ok("read refused", (await auth({ action: "read", path: `live/${KEY}` })) === 401);
ok("junk path refused", (await auth({ action: "publish", path: "live/short" })) === 401);

// 2. a stream: segment one, drop, reconnect inside the grace, segment two, end.
const dir = `${tmp}/rec/live/${KEY}`;
await fs.mkdir(dir, { recursive: true });
const seg = (name, hz) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15", "-f", "lavfi", "-i", `sine=frequency=${hz}`, "-t", "2", "-c:v", "libx264", "-c:a", "aac", "-movflags", "+frag_keyframe+empty_moov", `${dir}/${name}.mp4`]);
await post("/event/ready", { path: `live/${KEY}` });
seg("2026-01-01_00-00-00-000000", 440);
await post("/event/notready", { path: `live/${KEY}` });
await sleep(800);
await post("/event/ready", { path: `live/${KEY}` }); // back inside the grace
seg("2026-01-01_00-00-05-000000", 660);
await post("/event/notready", { path: `live/${KEY}` });
await sleep(6000); // grace 2.5 s + settle 0.3 s + ffmpeg

const started = calls.filter((c) => c.route === "started").length;
const fin = calls.find((c) => c.route === "finish");
ok("one session for a reconnect (started called once)", started === 1);
ok("finish was called once with the bearer", calls.filter((c) => c.route === "finish").length === 1 && fin?.auth === "Bearer test-token");
ok("finish names an object under streams/", /^streams\/own-7-.*\.mp4$/.test(fin?.body.objectKey ?? ""));
ok("duration about 4 s (two 2 s segments)", Math.abs((fin?.body.durationSec ?? 0) - 4) <= 1);
const stored = fin ? path.join(tmp, "store", fin.body.objectKey) : "";
ok("the joined file reached the store", !!stored && (await fs.stat(stored).catch(() => null))?.size > 1000);
const dur = stored ? Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", stored]).toString()) : 0;
ok("the stored file really plays for ~4 s", Math.abs(dur - 4) < 1);
ok("raw segments kept in done/", (await fs.readdir(`${tmp}/done`).catch(() => [])).length === 1);
ok("no key in the agent's file names", !(await fs.readdir(`${tmp}/state`).catch(() => [])).some((n) => n.includes(KEY)));

agent.kill();
site.close();
await fs.rm(tmp, { recursive: true, force: true });
