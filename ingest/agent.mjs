// MilitaryVoices ingest agent: the small program that runs beside MediaMTX on
// our own ingest box (see ingest/README.md).
//
//   MediaMTX  ->  this agent (127.0.0.1:8088)  ->  the site's /api/ingest/*
//
// It checks every stream key with the site before a publish is allowed, keeps
// one "session" per key (a dropped encoder that comes back within the grace
// period stays one recording), and when a session ends it joins MediaMTX's
// segments into one MP4, uploads it to our storage and tells the site, which
// puts it in the podcaster's Library. Nothing here keeps a key anywhere but
// memory, state files on this box (root-only) and MediaMTX's own paths.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

const env = (k, d = "") => (process.env[k] ?? d).trim();
export const cfg = {
  apiBase: env("API_BASE", "https://www.militaryvoices.ai").replace(/\/+$/, ""),
  token: env("INGEST_TOKEN"),
  recDir: env("REC_DIR", "/var/lib/mvingest/rec"),
  stateDir: env("STATE_DIR", "/var/lib/mvingest/state"),
  doneDir: env("DONE_DIR", "/var/lib/mvingest/done"),
  workDir: env("WORK_DIR", "/var/lib/mvingest/work"),
  mtxApi: env("MTX_API", "http://127.0.0.1:9997"),
  port: Number(env("AGENT_PORT", "8088")),
  graceMs: Number(env("GRACE_MS", "180000")),
  settleMs: Number(env("SETTLE_MS", "8000")),
  heartbeatMs: Number(env("HEARTBEAT_MS", "30000")),
  store: env("STORE", "r2"), // "r2", or "local" for tests
  localStore: env("LOCAL_STORE", "/var/lib/mvingest/store"),
  r2: { accountId: env("R2_ACCOUNT_ID"), accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY"), bucket: env("R2_BUCKET", "militaryvoice-recordings") },
  keepDoneDays: Number(env("KEEP_DONE_DAYS", "3")),
  rtmpLocal: env("RTMP_LOCAL", "rtmp://127.0.0.1:1935"),
  version: "2",
};

const KEY_RE = /^[A-Za-z0-9_-]{20,80}$/;
const log = (...a) => console.log(new Date().toISOString(), ...a.map((x) => (typeof x === "string" ? x.replace(/live\/[A-Za-z0-9_-]{20,80}/g, "live/<key>") : x)));
const keyOfPath = (p) => (/^live\/([A-Za-z0-9_-]{20,80})$/.exec(String(p ?? "")) ?? [])[1] ?? "";
const WATCH_RE = /^w\/[a-f0-9]{24}$/;
const LOCAL_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
/** Proves a read of live/<key> or a publish to w/<id> is our own relay: made fresh each start, never leaves this box. */
const relaySecret = crypto.randomBytes(18).toString("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A short, key-free name for a key's files on disk and in state. */
const tag = (key) => key.slice(-8);

// ---- the site -------------------------------------------------------------
async function api(route, body, { retries = 0 } = {}) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(`${cfg.apiBase}/api/ingest/${route}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${cfg.token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
      const json = await res.json().catch(() => ({}));
      if (res.status < 500) return { status: res.status, json };
      last = new Error(`site answered ${res.status}`);
    } catch (e) {
      last = e;
    }
    if (i < retries) await sleep(Math.min(30_000, 1000 * 2 ** i));
  }
  throw last;
}

// ---- sessions (one per key) ------------------------------------------------
/** @type {Map<string, {key:string, sessionId:number, startedAt:string, live:boolean, timer:any, finalizing:boolean, uploaded:null|{objectKey:string,sizeBytes:number,durationSec:number}, watchId?:string, forward?:string[], relay?:any}>} */
const sessions = new Map();
const lastOk = new Map(); // key -> ms a publish was last allowed: lets a stream start if the site is briefly unreachable

const stateFile = (key) => path.join(cfg.stateDir, `${tag(key)}.json`);
async function save(s) {
  // The forward list holds other sites' stream keys: memory only, asked for again after a restart.
  const { timer, relay, forward, ...rest } = s;
  await fs.writeFile(stateFile(s.key), JSON.stringify(rest), { mode: 0o600 });
}
const segDir = (key) => path.join(cfg.recDir, "live", key);

function armGrace(s) {
  clearTimeout(s.timer);
  s.timer = setTimeout(() => void finalize(s), cfg.graceMs);
}

async function started(key) {
  try {
    return await api("started", { key }, { retries: 3 });
  } catch (e) {
    log("started call failed", e.message);
    return { status: 0, json: {} };
  }
}

/** What the site said to do besides recording (the watch relay). Absent: the site hasn't switched it on. */
function takeRelay(s, json) {
  if (typeof json.watchId === "string") s.watchId = /^[a-f0-9]{24}$/.test(json.watchId) ? json.watchId : "";
  if (Array.isArray(json.forward)) s.forward = json.forward.filter((u) => typeof u === "string" && /^rtmps?:\/\//.test(u));
}

async function onReady(key) {
  let s = sessions.get(key);
  if (s) {
    // A reconnect inside the grace period: the same session carries on, and so does its watch page.
    clearTimeout(s.timer);
    s.live = true;
    takeRelay(s, (await started(key)).json);
    await save(s);
    startRelay(s);
    return;
  }
  const r = await started(key);
  s = { key, sessionId: Number(r.json.sessionId) || 0, startedAt: r.json.startedAt || new Date().toISOString(), live: true, timer: null, finalizing: false, uploaded: null };
  takeRelay(s, r.json);
  sessions.set(key, s);
  await save(s);
  log("live", tag(key), "session", s.sessionId, s.watchId ? `watch + ${s.forward?.length ?? 0} out` : "record only");
  startRelay(s);
}

async function onNotReady(key) {
  const s = sessions.get(key);
  if (!s) return;
  s.live = false;
  stopRelay(s);
  await save(s);
  armGrace(s);
  log("stream gone", tag(key), `grace ${Math.round(cfg.graceMs / 1000)}s`);
}

// ---- the watch relay -------------------------------------------------------
// One ffmpeg per live stream copies it, untouched (-c copy, no re-encoding), to
// w/<watch id> on this box, which MediaMTX serves as HLS for the watch page, and
// to each forward target (their YouTube and other keys). A target that fails is
// dropped without stopping the others (onfail=ignore). The recording never
// depends on this: it is MediaMTX's own, on live/<key>.
const teeSafe = (u) => !/[|\[\]\\']/.test(u);

function relayArgs(s) {
  const outs = [`[f=flv:onfail=ignore]${cfg.rtmpLocal}/w/${s.watchId}?relay=${relaySecret}`];
  for (const u of s.forward ?? []) if (teeSafe(u)) outs.push(`[f=flv:onfail=ignore]${u}`);
  return ["-hide_banner", "-loglevel", "error", "-rw_timeout", "15000000", "-i", `${cfg.rtmpLocal}/live/${s.key}?relay=${relaySecret}`, "-map", "0:v?", "-map", "0:a?", "-c", "copy", "-f", "tee", outs.join("|")];
}

function startRelay(s) {
  if (!s.watchId || !s.live || s.relay) return;
  const p = spawn("ffmpeg", relayArgs(s), { stdio: ["ignore", "ignore", "pipe"] });
  s.relay = p;
  let err = "";
  p.stderr.on("data", (d) => (err = (err + d).slice(-400)));
  p.on("error", (e) => log("relay failed to start", tag(s.key), e.message));
  p.on("close", (code) => {
    if (s.relay === p) s.relay = null;
    if (!s.live) return;
    // The stream is still in but the relay stopped: start it again in a moment.
    log("relay stopped", tag(s.key), code, err.replace(/live\/[A-Za-z0-9_-]{20,80}/g, "live/<key>").replace(/\/\/[^\s]+/g, "//…").trim().slice(-160));
    setTimeout(() => startRelay(s), 3000);
  });
}

function stopRelay(s) {
  const p = s.relay;
  s.relay = null;
  if (p && p.exitCode === null) p.kill("SIGTERM");
}

// ---- finishing -------------------------------------------------------------
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-300)}`))));
  });
}

async function segmentsFor(s) {
  const dir = segDir(s.key);
  let names = [];
  try { names = (await fs.readdir(dir)).filter((n) => n.endsWith(".mp4")).sort(); } catch { return []; }
  const since = Date.parse(s.startedAt) - 5000;
  const out = [];
  for (const n of names) {
    const f = path.join(dir, n);
    const st = await fs.stat(f);
    if (st.size > 0 && st.mtimeMs >= since) out.push(f);
  }
  return out;
}

async function upload(file, objectKey) {
  if (cfg.store === "local") {
    const dest = path.join(cfg.localStore, objectKey);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(file, dest);
    return;
  }
  const { S3Client } = await import("@aws-sdk/client-s3");
  const { Upload } = await import("@aws-sdk/lib-storage");
  const { createReadStream } = await import("node:fs");
  const c = new S3Client({ region: "auto", endpoint: `https://${cfg.r2.accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId: cfg.r2.accessKeyId, secretAccessKey: cfg.r2.secretAccessKey } });
  await new Upload({ client: c, params: { Bucket: cfg.r2.bucket, Key: objectKey, Body: createReadStream(file), ContentType: "video/mp4" }, partSize: 64 * 1024 * 1024, queueSize: 3 }).done();
}

/** The site's finish call, which must come back ok: anything else is retried later rather than lost. */
async function finish(body) {
  const r = await api("finish", body, { retries: 8 });
  if (r.status !== 200) throw new Error(`finish answered ${r.status}`);
  return r.json;
}

async function finalize(s) {
  if (s.finalizing) return;
  s.finalizing = true;
  try {
    if (!s.sessionId) {
      // The site was unreachable when the stream began: ask again, it returns the open session if there is one.
      const r = await api("started", { key: s.key }, { retries: 2 });
      s.sessionId = Number(r.json.sessionId) || 0;
      if (!s.sessionId) throw new Error("no session on the site yet");
      await save(s);
    }
    // Let MediaMTX close its last segment, then take everything this session wrote.
    await sleep(cfg.settleMs);
    if (!s.uploaded) {
      const segs = await segmentsFor(s);
      if (!segs.length) {
        await finish({ key: s.key, sessionId: s.sessionId, failed: true, reason: "no segments were recorded" });
        return await end(s, []);
      }
      await fs.mkdir(cfg.workDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const list = path.join(cfg.workDir, `${tag(s.key)}-${stamp}.txt`);
      const out = path.join(cfg.workDir, `${tag(s.key)}-${stamp}.mp4`);
      await fs.writeFile(list, segs.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
      await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out]);
      const durationSec = Math.round(Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out])).trim()) || 0);
      const size = (await fs.stat(out)).size;
      const objectKey = `streams/own-${s.sessionId}-${stamp}.mp4`;
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) {
        try { await upload(out, objectKey); ok = true; } catch (e) { log("upload failed", e.message); await sleep(5000 * (i + 1)); }
      }
      await fs.rm(list, { force: true });
      if (!ok) {
        await finish({ key: s.key, sessionId: s.sessionId, failed: true, reason: "upload to storage failed; the segments are still on the box" });
        s.finalizing = false;
        return; // segments stay on disk for a person to recover
      }
      await fs.rm(out, { force: true });
      s.uploaded = { objectKey, sizeBytes: size, durationSec };
      s.segments = segs;
      await save(s);
    }
    // Tell the site (retried until it answers; the state file keeps this across a restart).
    await finish({ key: s.key, sessionId: s.sessionId, objectKey: s.uploaded.objectKey, sizeBytes: s.uploaded.sizeBytes, durationSec: s.uploaded.durationSec });
    log("finished", tag(s.key), s.uploaded.objectKey, `${s.uploaded.durationSec}s`);
    await end(s, s.segments ?? []);
  } catch (e) {
    log("finalize failed", e.message, "(will retry in 5 minutes)");
    s.finalizing = false;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => void finalize(s), 5 * 60_000);
  }
}

/** Done: keep the raw segments a few days as a safety net, drop the session. */
async function end(s, segs) {
  const dest = path.join(cfg.doneDir, `${tag(s.key)}-${s.sessionId}`);
  await fs.mkdir(dest, { recursive: true });
  for (const f of segs) await fs.rename(f, path.join(dest, path.basename(f))).catch(() => {});
  await fs.rm(stateFile(s.key), { force: true });
  sessions.delete(s.key);
}

async function sweepDone() {
  const cutoff = Date.now() - cfg.keepDoneDays * 86_400_000;
  try {
    for (const d of await fs.readdir(cfg.doneDir)) {
      const p = path.join(cfg.doneDir, d);
      if ((await fs.stat(p)).mtimeMs < cutoff) await fs.rm(p, { recursive: true, force: true });
    }
  } catch { /* nothing yet */ }
}

// ---- heartbeat: alive, and who to drop ---------------------------------------
async function mtx(route, method = "GET") {
  const res = await fetch(`${cfg.mtxApi}${route}`, { method, signal: AbortSignal.timeout(5000) });
  return res.ok ? res.json().catch(() => ({})) : {};
}

async function kick(key) {
  try {
    const list = await mtx("/v3/rtmpconns/list");
    for (const it of list.items ?? []) if (it.path === `live/${key}`) await mtx(`/v3/rtmpconns/kick/${it.id}`, "POST");
    log("kicked", tag(key));
  } catch (e) {
    log("kick failed", e.message);
  }
}

async function heartbeat() {
  let disk = 0;
  try { const st = await fs.statfs(cfg.recDir); disk = Math.round((Number(st.bavail) * Number(st.bsize)) / 1e9); } catch { /* not there yet */ }
  const live = [...sessions.values()].filter((s) => s.live).map((s) => s.key);
  const backlog = [...sessions.values()].filter((s) => !s.live).length;
  try {
    const r = await api("heartbeat", { live, version: cfg.version, diskFreeGb: disk, backlog });
    for (const key of r.json.kick ?? []) if (KEY_RE.test(key)) await kick(key);
  } catch (e) {
    log("heartbeat failed", e.message);
  }
}

// ---- the local server MediaMTX talks to --------------------------------------
const readBody = (req) => new Promise((resolve) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => resolve(b)); });
const parseForm = (b) => Object.fromEntries(new URLSearchParams(b));

export function server() {
  return http.createServer(async (req, res) => {
    const send = (code, body = "") => { res.writeHead(code); res.end(body); };
    try {
      const raw = await readBody(req);
      if (req.url === "/auth") {
        let q = {};
        try { q = JSON.parse(raw || "{}"); } catch { return send(400); }
        const ours = LOCAL_IPS.has(String(q.ip ?? "")) && new URLSearchParams(String(q.query ?? "")).get("relay") === relaySecret;
        // The watch relay: our ffmpeg reads live/<key> and publishes w/<id>, from this machine, with this run's secret.
        if (ours && ((q.action === "read" && keyOfPath(q.path)) || (q.action === "publish" && WATCH_RE.test(String(q.path ?? ""))))) return send(200);
        // Watching: anyone may read w/<id> (the id is the secret, and it changes every show). Nothing else is readable.
        if (q.action === "read") return send(WATCH_RE.test(String(q.path ?? "")) ? 200 : 401);
        const key = q.action === "publish" ? keyOfPath(q.path) : "";
        if (!key) return send(401);
        try {
          const r = await api("authorize", { key });
          if (r.status === 200) { lastOk.set(key, Date.now()); return send(200); }
          return send(401);
        } catch {
          // The site can't be reached: a key that was fine in the last day may still start a stream.
          return send(Date.now() - (lastOk.get(key) ?? 0) < 86_400_000 ? 200 : 503);
        }
      }
      const f = parseForm(raw);
      const key = keyOfPath(f.path);
      if (req.method !== "POST" || !key) return send(404);
      if (req.url === "/event/ready") await onReady(key);
      else if (req.url === "/event/notready") await onNotReady(key);
      else if (req.url === "/event/segment") log("segment", tag(key), path.basename(f.file ?? ""));
      else return send(404);
      send(200, "ok");
    } catch (e) {
      log("request failed", e.message);
      send(500);
    }
  });
}

export async function start() {
  if (!cfg.token) throw new Error("INGEST_TOKEN is not set");
  for (const d of [cfg.recDir, cfg.stateDir, cfg.doneDir, cfg.workDir]) await fs.mkdir(d, { recursive: true });
  // After a restart: sessions that were open come back and finish after the grace period.
  for (const n of await fs.readdir(cfg.stateDir).catch(() => [])) {
    try {
      const s = JSON.parse(await fs.readFile(path.join(cfg.stateDir, n), "utf8"));
      Object.assign(s, { live: false, timer: null, finalizing: false });
      sessions.set(s.key, s);
      armGrace(s);
      log("resumed session", tag(s.key));
    } catch { /* a damaged state file is ignored */ }
  }
  server().listen(cfg.port, "127.0.0.1", () => log("agent listening", cfg.port));
  setInterval(() => void heartbeat(), cfg.heartbeatMs);
  setInterval(() => void sweepDone(), 6 * 3600_000);
  void heartbeat();
}

if (import.meta.url === `file://${process.argv[1]}`) start().catch((e) => { console.error(e.message); process.exit(1); });
