// The studio's player bot (Studio v3): sounds and background music that EVERYONE hears,
// the people in the studio as well as the recording and the stream.
//
// It runs on the ingest box beside agent.mjs, as its own service (mv-player), so a fault here
// can never touch Stream in. Every POLL_MS it asks the site which studios have a real person in
// them (GET /api/ingest/players, bearer INGEST_TOKEN, the box's one secret) and joins each one
// as "player-<id>" with one mono audio track. It leaves LEAVE_MS after the last person goes, so
// it is only in a room (and only costs a LiveKit participant) while people are.
//
// What it plays comes from the room itself:
//   - the room metadata (the site is its only writer): sound {id, at} plays once per `at`;
//     music {id, at} | null loops until it changes; lookRev says "read the look again";
//   - the look (Podcasting's, GET /api/room/:id/look?k=): sounds[] and music[] with their files,
//     soundVolume and musicVolume (0..1).
// Music dips (DUCK_DB) while anyone's mic carries speech, and comes back up gently.
//
//   node ingest/player.mjs           (API_BASE, INGEST_TOKEN from /etc/mvingest/agent.env)
//   node ingest/player.mjs --selftest  (mixes a test tone and a ducked bed to /tmp, no network)

import { spawn } from "node:child_process";
import fs from "node:fs";
import {
  AudioFrame, AudioSource, AudioStream, LocalAudioTrack, Room, RoomEvent, TrackKind, TrackPublishOptions, TrackSource,
} from "@livekit/rtc-node";

const API = (process.env.API_BASE || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const TOKEN = (process.env.INGEST_TOKEN || "").trim();
const POLL_MS = Number(process.env.PLAYER_POLL_MS || 10_000);
const LEAVE_MS = Number(process.env.PLAYER_LEAVE_MS || 20_000);
const RATE = 48_000;
const FRAME = 480; // 10 ms
const DUCK_DB = Number(process.env.PLAYER_DUCK_DB || 12);
const DUCK = Math.pow(10, -DUCK_DB / 20);
const VOICE_RMS = 0.012; // about -38 dBFS: a quiet mic speaking, above room noise
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------------------------------------------------------------------------------------------
// Files: decoded once to 48 kHz mono 16-bit with ffmpeg and kept in memory (small LRU).
// ---------------------------------------------------------------------------------------------
const cache = new Map(); // url -> Promise<Int16Array>
const MAX_CACHE = 24;
function decode(url) {
  if (cache.has(url)) { const p = cache.get(url); cache.delete(url); cache.set(url, p); return p; }
  const p = new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-v", "error", "-nostdin", "-i", url, "-t", "900", "-ac", "1", "-ar", String(RATE), "-f", "s16le", "pipe:1"]);
    const chunks = [];
    let err = "";
    ff.stdout.on("data", (c) => chunks.push(c));
    ff.stderr.on("data", (c) => { err += c; });
    ff.on("close", (code) => {
      const buf = Buffer.concat(chunks);
      if (code !== 0 || buf.length < 2) return reject(new Error(`decode failed (${code}): ${err.slice(0, 160)}`));
      resolve(new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2)));
    });
  });
  p.catch(() => cache.delete(url));
  cache.set(url, p);
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return p;
}

const abs = (u) => (u && u.startsWith("/") ? `${API}${u}` : u || "");
const urlOf = (item) => abs(item?.asset?.url ?? item?.url);
const vol = (v, d) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : d);

// ---------------------------------------------------------------------------------------------
// The mixer: pure, so --selftest can run it without a room.
// ---------------------------------------------------------------------------------------------
export function createMixer() {
  const state = {
    music: null, // { pcm, pos, gain }
    sounds: [], // { pcm, pos, gain }
    duck: 1, // current music multiplier
    voiceUntil: 0, // ms timestamp: speech heard recently
  };
  return {
    state,
    setMusic(pcm, gain, loop = true) { state.music = pcm ? { pcm, pos: 0, gain, loop } : null; },
    setMusicGain(gain) { if (state.music) state.music.gain = gain; },
    addSound(pcm, gain) { state.sounds.push({ pcm, pos: 0, gain }); },
    voice(now = Date.now()) { state.voiceUntil = now + 250; },
    busy() { return Boolean(state.music) || state.sounds.length > 0; },
    /** Next 10 ms, as Int16. */
    frame(now = Date.now()) {
      const out = new Int16Array(FRAME);
      const target = now < state.voiceUntil ? DUCK : 1;
      // Down in about 30 ms, back up over about 400 ms (per-sample one-pole).
      const k = target < state.duck ? 1 - Math.exp(-1 / (0.03 * RATE)) : 1 - Math.exp(-1 / (0.4 * RATE));
      const m = state.music;
      for (let i = 0; i < FRAME; i++) {
        state.duck += (target - state.duck) * k;
        let s = 0;
        if (m && m.pos < m.pcm.length) { s += (m.pcm[m.pos] / 32768) * m.gain * state.duck; m.pos += 1; if (m.loop && m.pos >= m.pcm.length) m.pos = 0; }
        for (const x of state.sounds) if (x.pos < x.pcm.length) s += (x.pcm[x.pos++] / 32768) * x.gain;
        // Soft limit so a loud pad over music never clips.
        s = Math.tanh(s * 1.2) / Math.tanh(1.2);
        out[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
      }
      state.sounds = state.sounds.filter((x) => x.pos < x.pcm.length);
      if (m && m.pos >= m.pcm.length) state.music = null; // a bed with Loop off ends on its own
      return out;
    },
  };
}

function rms(int16) {
  let sum = 0;
  for (let i = 0; i < int16.length; i++) { const v = int16[i] / 32768; sum += v * v; }
  return Math.sqrt(sum / Math.max(1, int16.length));
}

// ---------------------------------------------------------------------------------------------
// One studio.
// ---------------------------------------------------------------------------------------------
class Studio {
  constructor(info) {
    this.info = info;
    this.room = new Room();
    this.mixer = createMixer();
    this.source = new AudioSource(RATE, 1, 200);
    this.look = null;
    this.lookRev = -1;
    this.soundAt = 0;
    this.musicKey = "";
    this.alive = true;
    this.emptySince = 0;
    this.streams = new Set();
  }

  async start() {
    const { room } = this;
    room.on(RoomEvent.RoomMetadataChanged, () => void this.apply());
    room.on(RoomEvent.TrackSubscribed, (track, _pub, p) => {
      if (track.kind !== TrackKind.KIND_AUDIO || p.identity.startsWith("player-")) return;
      void this.listen(track);
    });
    room.on(RoomEvent.Disconnected, () => { this.alive = false; });
    await room.connect(this.info.url, this.info.token, { autoSubscribe: true, dynacast: false });
    const track = LocalAudioTrack.createAudioTrack("studio-sound", this.source);
    const opts = new TrackPublishOptions();
    opts.source = TrackSource.SOURCE_MICROPHONE;
    await room.localParticipant.publishTrack(track, opts);
    log(`joined ${this.info.room}`);
    await this.apply();
    void this.pump();
  }

  /** Speech on any mic ducks the music. */
  async listen(track) {
    const stream = new AudioStream(track, RATE, 1);
    this.streams.add(stream);
    try {
      for await (const f of stream) {
        if (!this.alive) break;
        if (rms(f.data) > VOICE_RMS) this.mixer.voice();
      }
    } catch { /* track went away */ }
    this.streams.delete(stream);
  }

  /** Feed the track. captureFrame waits when its queue is full, which paces the loop. */
  async pump() {
    const silence = new Int16Array(FRAME);
    while (this.alive) {
      const data = this.mixer.busy() ? this.mixer.frame() : silence;
      try { await this.source.captureFrame(new AudioFrame(data, RATE, 1, FRAME)); } catch (err) {
        if (this.alive) log(`${this.info.room} capture:`, err.message);
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }

  async readLook() {
    if (!this.info.lookKey) return null;
    try {
      const r = await fetch(`${API}/api/room/${this.info.studioId}/look?k=${encodeURIComponent(this.info.lookKey)}`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return null;
      return (await r.json()).look ?? null;
    } catch { return null; }
  }

  async apply() {
    let live = {};
    try { live = JSON.parse(this.room.metadata || "{}"); } catch { live = {}; }
    const rev = Number(live.lookRev ?? 0);
    if (!this.look || rev !== this.lookRev) { this.look = (await this.readLook()) ?? this.look; this.lookRev = rev; }
    const look = this.look ?? {};
    // Contract v3: one volume for all pads and one for music, 0..1, and musicLoop.
    const soundGain = vol(look.soundVolume, 0.8);
    const musicGain = vol(look.musicVolume, 0.25);
    const musicLoop = look.musicLoop !== false;

    // A pad press plays once; an old press (before we joined, or replayed metadata) never does.
    const s = live.sound;
    if (s?.id && Number(s.at) > this.soundAt) {
      const fresh = Date.now() - Number(s.at) < 8000;
      this.soundAt = Number(s.at);
      const item = (look.sounds ?? []).find((x) => x.id === s.id);
      const url = urlOf(item);
      if (fresh && url) {
        decode(url).then((pcm) => this.mixer.addSound(pcm, soundGain)).catch((e) => log(`${this.info.room} sound:`, e.message));
      }
    }

    const m = live.music;
    const key = m?.id ? `${m.id}@${m.at}` : "";
    if (key !== this.musicKey) {
      this.musicKey = key;
      const item = m?.id ? (look.music ?? []).find((x) => x.id === m.id) : null;
      const url = urlOf(item);
      if (!url) this.mixer.setMusic(null, 0);
      else decode(url).then((pcm) => { if (this.musicKey === key) this.mixer.setMusic(pcm, musicGain, musicLoop); }).catch((e) => log(`${this.info.room} music:`, e.message));
    } else if (m?.id) {
      this.mixer.setMusicGain(musicGain); // the slider moved while it plays
    }
  }

  /** Anyone real still here? (owner-… or guest-…) */
  occupied() {
    for (const p of this.room.remoteParticipants.values()) if (/^(owner|guest)-/.test(p.identity)) return true;
    return false;
  }

  async stop(why) {
    this.alive = false;
    for (const s of this.streams) { try { s.close?.(); } catch { /* gone */ } }
    try { await this.room.disconnect(); } catch { /* gone */ }
    log(`left ${this.info.room} (${why})`);
  }
}

// ---------------------------------------------------------------------------------------------
// The loop.
// ---------------------------------------------------------------------------------------------
const studios = new Map(); // room -> Studio

async function tick() {
  let list = [];
  try {
    const r = await fetch(`${API}/api/ingest/players`, { headers: { authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) { log("players:", r.status); return; }
    list = (await r.json()).rooms ?? [];
  } catch (err) { log("players:", err.message); return; }

  for (const info of list) {
    const have = studios.get(info.room);
    if (have?.alive) { have.info.token = info.token; continue; }
    const s = new Studio(info);
    studios.set(info.room, s);
    s.start().catch((err) => { log(`${info.room} join:`, err.message); s.alive = false; });
  }
  const now = Date.now();
  for (const [name, s] of studios) {
    if (!s.alive) { studios.delete(name); continue; }
    if (s.occupied()) { s.emptySince = 0; continue; }
    if (!s.emptySince) s.emptySince = now;
    if (now - s.emptySince >= LEAVE_MS) { studios.delete(name); void s.stop("studio empty"); }
  }
}

function selftest() {
  const tone = (hz, sec, amp) => { const a = new Int16Array(RATE * sec); for (let i = 0; i < a.length; i++) a[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / RATE) * amp * 32767); return a; };
  const mx = createMixer();
  mx.setMusic(tone(220, 1, 0.5), 0.5);
  const frames = [];
  let t = 0;
  for (let i = 0; i < 450; i++) { // 4.5 s
    if (i === 100) mx.addSound(tone(880, 0.5, 0.8), 1);
    if (i >= 150 && i < 220) mx.voice(t);
    frames.push(mx.frame(t));
    t += 10;
  }
  const peak = (from, to) => frames.slice(from, to).reduce((m, f) => Math.max(m, ...Array.from(f, Math.abs)), 0) / 32767;
  const before = peak(50, 90), ducked = peak(190, 215), back = peak(420, 450), withPad = peak(100, 140);
  const pcm = new Int16Array(frames.length * FRAME); frames.forEach((f, i) => pcm.set(f, i * FRAME));
  fs.writeFileSync("/tmp/player-selftest.s16le", Buffer.from(pcm.buffer));
  const ok = ducked < before * 0.35 && back > before * 0.9 && withPad > before && withPad <= 1.001;
  console.log(JSON.stringify({ before: +before.toFixed(3), ducked: +ducked.toFixed(3), back: +back.toFixed(3), withPad: +withPad.toFixed(3), ok }));
  process.exit(ok ? 0 : 1);
}

if (process.argv.includes("--selftest")) selftest();
else {
  if (!TOKEN) { console.error("INGEST_TOKEN missing"); process.exit(1); }
  log(`player bot up, polling ${API} every ${POLL_MS / 1000}s`);
  const shutdown = async () => { for (const s of studios.values()) await s.stop("shutdown"); process.exit(0); };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  void tick();
  setInterval(() => void tick(), POLL_MS);
}
