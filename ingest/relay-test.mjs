// A rehearsal of the watch relay (25 Nov 2026) with a real MediaMTX, the agent, a fake site and an ffmpeg test
// stream: the watch page's HLS plays, the stream is forwarded, the recording is unchanged, and nobody can read a
// stream key's own path. Plain RTMP and HLS on local ports (19350, 18443), no TLS, no network.
//   MEDIAMTX=/path/to/mediamtx node ingest/relay-test.mjs
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
const REPO = path.resolve(new URL("..", import.meta.url).pathname);
const MTX = process.env.MEDIAMTX || "mediamtx";
const D = await fs.mkdtemp(path.join((await import("node:os")).tmpdir(), "mvrelay-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = path.join(D, "run"); await fs.rm(tmp, { recursive: true, force: true }); await fs.mkdir(tmp, { recursive: true });
const K1 = "mvkRELAYTESTKEYONE0000000000001", K2 = "mvkRELAYTESTKEYTWO0000000000002", W = "0123456789abcdef01234567";
const calls = [];
const site = http.createServer(async (req, res) => {
  let b = ""; for await (const c of req) b += c;
  const body = JSON.parse(b || "{}"); const route = req.url.replace("/api/ingest/", "");
  calls.push({ route, key: body.key === K1 ? "K1" : body.key === K2 ? "K2" : "", live: body.live?.length });
  let out = {};
  if (route === "started") out = body.key === K1 ? { sessionId: 7, startedAt: new Date().toISOString(), watchId: W, forward: [`rtmp://127.0.0.1:19350/live/${K2}`] } : { sessionId: 8, startedAt: new Date().toISOString() };
  if (route === "finish") out = { ok: true, recordingId: 99 };
  if (route === "heartbeat") out = { kick: [] };
  res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(out));
});
await new Promise((r) => site.listen(18099, "127.0.0.1", r));
let y = await fs.readFile(path.join(REPO, "ingest/mediamtx.yml"), "utf8");
y = y.replace("rtmpAddress: :1935", "rtmpAddress: :19350").replace("rtmpEncryption: optional", "rtmpEncryption: \"no\"").replace(/^rtmps.*$/gm, "").replace(/^rtmpServer.*$/gm, "")
  .replace("hlsAddress: :8443", "hlsAddress: :18443").replace("hlsEncryption: yes", "hlsEncryption: no").replace(/^hlsServer.*$/gm, "")
  .replace("apiAddress: 127.0.0.1:9997", "apiAddress: 127.0.0.1:19997").replaceAll("127.0.0.1:8088", "127.0.0.1:18088").replace("/var/lib/mvingest/rec", `${tmp}/rec`);
await fs.writeFile(path.join(tmp, "m.yml"), y);
const mtx = spawn(MTX, [path.join(tmp, "m.yml")], { stdio: ["ignore", "pipe", "pipe"] });
let mlog = ""; mtx.stdout.on("data", (d) => (mlog += d)); mtx.stderr.on("data", (d) => (mlog += d));
const env = { ...process.env, API_BASE: "http://127.0.0.1:18099", INGEST_TOKEN: "t", REC_DIR: `${tmp}/rec`, STATE_DIR: `${tmp}/state`, DONE_DIR: `${tmp}/done`, WORK_DIR: `${tmp}/work`, LOCAL_STORE: `${tmp}/store`, STORE: "local", AGENT_PORT: "18088", GRACE_MS: "3000", SETTLE_MS: "500", HEARTBEAT_MS: "60000", MTX_API: "http://127.0.0.1:19997", RTMP_LOCAL: "rtmp://127.0.0.1:19350" };
const agent = spawn("node", [path.join(REPO, "ingest/agent.mjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
let alog = ""; agent.stdout.on("data", (d) => (alog += d)); agent.stderr.on("data", (d) => (alog += d));
await sleep(1500);
const enc = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "30", "-c:v", "libx264", "-preset", "veryfast", "-g", "60", "-pix_fmt", "yuv420p", "-c:a", "aac", "-f", "flv", `rtmp://127.0.0.1:19350/live/${K1}`], { stdio: ["ignore", "ignore", "pipe"] });
let elog = ""; enc.stderr.on("data", (d) => (elog += d));
await sleep(12000);
const get = async (u) => { try { const r = await fetch(u); return { status: r.status, body: r.ok ? await r.text() : "" }; } catch (e) { return { status: 0, body: e.message }; } };
const res = {};
res.watchPlaylist = await get(`http://127.0.0.1:18443/w/${W}/index.m3u8`);
const variant = res.watchPlaylist.body.split("\n").find((l) => l && !l.startsWith("#"));
if (variant) { res.variant = await get(`http://127.0.0.1:18443/w/${W}/${variant}`); }
await sleep(4000);
if (variant) res.variant2 = await get(`http://127.0.0.1:18443/w/${W}/${variant}`);
res.keyHls = (await get(`http://127.0.0.1:18443/live/${K1}/index.m3u8`)).status;
res.otherWatch = (await get(`http://127.0.0.1:18443/w/ffffffffffffffffffffffff/index.m3u8`)).status;
const paths = await (await fetch("http://127.0.0.1:19997/v3/paths/list")).json().catch(() => ({}));
res.paths = (paths.items ?? []).map((p) => `${p.name.replace(K1, "K1").replace(K2, "K2")} ready=${p.ready} readers=${p.readers?.length}`);
// A stranger reading the key over RTMP must be refused.
const peek = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-rw_timeout", "5000000", "-i", `rtmp://127.0.0.1:19350/live/${K1}`, "-t", "1", "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
res.strangerRead = await new Promise((r) => peek.on("close", (c) => r(c)));
await new Promise((r) => enc.on("close", r));
await sleep(9000);
console.log(JSON.stringify({ ...res, watchPlaylist: { status: res.watchPlaylist.status, body: res.watchPlaylist.body.slice(0, 300) }, variant: res.variant && { status: res.variant.status, segs: (res.variant.body.match(/#EXTINF/g) ?? []).length, seq: /MEDIA-SEQUENCE:(\d+)/.exec(res.variant.body)?.[1] }, variant2: res.variant2 && { status: res.variant2.status, seq: /MEDIA-SEQUENCE:(\d+)/.exec(res.variant2.body)?.[1] }, calls }, null, 1));
console.log("--- agent\n" + alog.replaceAll(K1, "K1").replaceAll(K2, "K2").slice(-2500));
console.log("--- mediamtx (errors/auth)\n" + mlog.replaceAll(K1, "K1").replaceAll(K2, "K2").split("\n").filter((l) => /ERR|WAR|auth|w\/0123/.test(l)).slice(-25).join("\n"));
console.log("--- encoder\n" + elog.slice(-300));
const store = await fs.readdir(`${tmp}/store`, { recursive: true }).catch(() => []);
console.log("--- stored", store);
const ok = res.watchPlaylist.status === 200 && res.keyHls === 401 && res.strangerRead !== 0 && res.paths.some((p) => p.startsWith("live/K2 ready=true")) && store.filter((f) => f.endsWith(".mp4")).length === 2;
console.log(ok ? "PASS" : "FAIL");
agent.kill(); mtx.kill(); site.close();
await fs.rm(D, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
