// Conversation starters: the hidden listener (Andrew, 26 Nov: "Yes, run it", on the Alex VPS, capped at $1 an hour).
//
// Runs on the Alex VPS as the docker container mv-listener (agent/vps/update.sh), from the clipper's image. Every 15s
// it asks /api/agent/starters/rooms which My Studio rooms want it: Tips > Conversation starters on, the studio allowed
// (setting starters:studios, "13" for now) and someone real in the room. It joins each one hidden (no tile, never
// filmed, can't publish audio or video), and while two or more people are there it streams their mixed voices to
// Deepgram for words. When nobody has spoken for the host's quiet spell (after 2 minutes of real talk, never on a break,
// card, intro, outro or music), it asks /api/agent/starters/suggest for 2–3 questions and sends them on the room's
// "mv-starter" topic to the owner only. Guests and viewers never get them.
//
// It keeps the last 4 minutes of words in memory and nothing else, and nothing on disk. It holds only the agent token:
// the room pass, a 10-minute Deepgram token and the questions all come from the API.
//
//   API_BASE=https://www.militaryvoices.ai AGENT_TOKEN=… node --import tsx agent/starters.ts
import { Room, RoomEvent, AudioStream, TrackKind, dispose, type RemoteTrack, type RemoteParticipant } from "@livekit/rtc-node";
import WebSocket from "ws";

const API_BASE = (process.env.API_BASE || "http://localhost:3000").replace(/\/+$/, "");
const AGENT_TOKEN = (process.env.AGENT_TOKEN || "").trim();
const POLL_MS = 15_000;
const MISSES_TO_LEAVE = 3;
const RATE = 16_000;
const TICK_MS = 100;
const BLOCK = (RATE * TICK_MS) / 1000;
const WARMUP_MS = 2 * 60_000;
const COOLDOWN_MS = 90_000;
const MAX_CARDS_HOUR = 20;
const KEEP_MS = 4 * 60_000;
const TOPIC = "mv-starter";

const enc = new TextEncoder();
const dec = new TextDecoder();
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-agent-token": AGENT_TOKEN },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

type RoomPass = { studioId: number; room: string; url: string; token: string; people: number; wait: number; cap: "month" | "hour" | null };
type Line = { at: number; text: string };

const real = (id: string) => /^(owner|guest)-/.test(id);
const owners = (room: Room) => [...room.remoteParticipants.values()].map((p) => p.identity).filter((x) => x.startsWith("owner-"));
/** People, not tabs: every owner tab is the one host. */
const peopleIn = (room: Room) => {
  const ids = [...room.remoteParticipants.values()].map((p) => p.identity).filter(real);
  return (ids.some((x) => x.startsWith("owner-")) ? 1 : 0) + ids.filter((x) => x.startsWith("guest-")).length;
};

class Session {
  readonly id: number;
  private room = new Room();
  private wait: number;
  private cap: RoomPass["cap"];
  private ws: WebSocket | null = null;
  private wsWanted = false;
  private wsBusy = false;
  private bufs = new Map<string, Int16Array[]>();
  private tick: NodeJS.Timeout | null = null;
  private lines: Line[] = [];
  private shown: string[] = [];
  private firstSpeech = 0;
  private lastSpeech = 0;
  private lastCard = 0;
  private cardTimes: number[] = [];
  private asking = false;
  private dismissedInRow = 0;
  private streamedMs = 0;
  private used = 0;
  private dismissed = 0;
  /** Polls in a row that left this room out. One missed poll (a LiveKit list hiccup) is not "everyone left". */
  missed = 0;
  private state = "";
  private closed = false;
  private meta: { playing?: unknown; music?: unknown; sound?: { at?: number } | null } = {};

  constructor(pass: RoomPass) {
    this.id = pass.studioId;
    this.wait = pass.wait;
    this.cap = pass.cap;
  }

  async start(pass: RoomPass) {
    const room = this.room;
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, p: RemoteParticipant) => {
      // Their voices only: never the player bot's music or clips.
      if (track.kind !== TrackKind.KIND_AUDIO || !real(p.identity)) return;
      void this.read(track, `${p.identity}:${track.sid}`);
    });
    room.on(RoomEvent.DataReceived, (payload: Uint8Array, p?: RemoteParticipant, _k?: unknown, topic?: string) => {
      if (topic !== TOPIC || !p?.identity.startsWith("owner-")) return;
      let m: { kind?: string; action?: string } = {};
      try { m = JSON.parse(dec.decode(payload)); } catch { return; }
      if (m.kind !== "starter-ack") return;
      if (m.action === "used") { this.used++; this.dismissedInRow = 0; }
      else if (m.action === "dismissed") { this.dismissed++; this.dismissedInRow++; }
    });
    room.on(RoomEvent.RoomMetadataChanged, (md: string) => this.readMeta(md));
    room.on(RoomEvent.Disconnected, () => { log(`studio ${this.id}: disconnected`); void this.stop(); });
    await room.connect(pass.url, pass.token, { autoSubscribe: true, dynacast: false });
    this.readMeta(room.metadata ?? "");
    log(`studio ${this.id}: listening (hidden), ${peopleIn(room)} in the room`);
    this.tick = setInterval(() => this.step(), TICK_MS);
  }

  update(pass: RoomPass) {
    this.wait = pass.wait;
    this.cap = pass.cap;
  }

  private readMeta(md: string) {
    try { this.meta = JSON.parse(md || "{}"); } catch { this.meta = {}; }
  }

  private async read(track: RemoteTrack, key: string) {
    const q: Int16Array[] = [];
    this.bufs.set(key, q);
    const reader = new AudioStream(track, { sampleRate: RATE, numChannels: 1 }).getReader();
    try {
      for (;;) {
        const { done, value: f } = await reader.read();
        if (done || this.closed) break;
        q.push(f.data);
        // Never more than a second behind: drop the oldest.
        let n = q.reduce((s, x) => s + x.length, 0);
        while (n > RATE && q.length > 1) n -= q.shift()!.length;
      }
    } catch { /* the track went away */ }
    reader.releaseLock();
    this.bufs.delete(key);
  }

  /** One 100ms step: mix, send, and see whether it's a lull. */
  private step() {
    const now = Date.now();
    const people = peopleIn(this.room);
    const pause = this.pauseReason(people);
    this.say(pause);
    const listen = !pause;
    if (listen && !this.wsWanted) this.wsWanted = true;
    if (!listen && this.wsWanted) { this.wsWanted = false; this.closeWs(); }
    if (this.wsWanted && !this.ws && !this.wsBusy) void this.openWs();

    // Mix every voice into one 16 kHz stream (one Deepgram connection, however many people).
    const mix = new Int32Array(BLOCK);
    for (const q of this.bufs.values()) {
      let i = 0;
      while (i < BLOCK && q.length) {
        const head = q[0];
        const take = Math.min(BLOCK - i, head.length);
        for (let k = 0; k < take; k++) mix[i + k] += head[k];
        i += take;
        if (take === head.length) q.shift(); else q[0] = head.subarray(take);
      }
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      const out = new Int16Array(BLOCK);
      for (let k = 0; k < BLOCK; k++) out[k] = Math.max(-32768, Math.min(32767, mix[k]));
      this.ws.send(Buffer.from(out.buffer));
      this.streamedMs += TICK_MS;
    }

    // A lull: talk under way, nobody's spoken for the host's quiet spell, something said since the last card.
    if (!listen || this.asking || !this.firstSpeech) return;
    const cooldown = this.dismissedInRow >= 2 ? COOLDOWN_MS * 2 : COOLDOWN_MS;
    this.cardTimes = this.cardTimes.filter((t) => now - t < 3600_000);
    if (now - this.firstSpeech < WARMUP_MS) return;
    if (now - this.lastSpeech < this.wait * 1000) return;
    if (this.lastSpeech <= this.lastCard || now - this.lastCard < cooldown) return;
    if (this.cardTimes.length >= MAX_CARDS_HOUR) return;
    if (this.words() < 60) return;
    void this.ask();
  }

  private pauseReason(people: number): string {
    if (this.cap) return "cap";
    if (people < 2) return "alone";
    const m = this.meta;
    if (m.playing || m.music || (m.sound?.at && Date.now() - Number(m.sound.at) < 10_000)) return "break";
    return "";
  }

  /** starters-state to the owner when it changes: paused alone, on a break, or capped. */
  private say(reason: string) {
    if (reason === this.state) return;
    this.state = reason;
    const to = owners(this.room);
    if (!to.length) return;
    const msg = reason ? { kind: "starters-state", on: true, reason } : { kind: "starters-state", on: true };
    void this.room.localParticipant?.publishData(enc.encode(JSON.stringify(msg)), { reliable: true, topic: TOPIC, destination_identities: to }).catch(() => {});
  }

  private words() {
    return this.lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
  }

  private async ask() {
    this.asking = true;
    const at = Date.now();
    try {
      const transcript = this.lines.map((l) => l.text).join(" ");
      const r = await api<{ lines?: string[]; basis?: string; id?: string; cap?: "month" | "hour"; off?: boolean }>("POST", "/api/agent/starters/suggest", { studioId: this.id, transcript, shown: this.shown });
      if (r.cap) { this.cap = r.cap; return; }
      if (r.off || !r.lines?.length) { this.lastCard = at; return; }
      // Someone started talking again while we were asking: let it go.
      if (this.lastSpeech > at) { this.lastCard = at; return; }
      const to = owners(this.room);
      if (!to.length) return;
      // A hidden sender reaches the browser with no participant attached, so the card says who to answer (the ack).
      const card = { kind: "starter", id: r.id ?? Math.random().toString(16).slice(2, 10), lines: r.lines, basis: r.basis, at: new Date().toISOString(), from: this.room.localParticipant?.identity ?? `listener-${this.id}` };
      await this.room.localParticipant!.publishData(enc.encode(JSON.stringify(card)), { reliable: true, topic: TOPIC, destination_identities: to });
      this.lastCard = Date.now();
      this.cardTimes.push(this.lastCard);
      this.shown.push(...r.lines);
      this.shown = this.shown.slice(-30);
      log(`studio ${this.id}: card sent (${r.lines.length} lines, ${Date.now() - at}ms)`);
    } catch (err) {
      this.lastCard = at;
      log(`studio ${this.id}: suggest failed: ${(err as Error).message}`);
    } finally {
      this.asking = false;
    }
  }

  private async openWs() {
    this.wsBusy = true;
    try {
      // The box's own Deepgram key if it has one (agent/vps: DEEPGRAM_API_KEY in /etc/mv-listener.env), else a
      // 10-minute token from the API (needs a Deepgram key that may mint them).
      const own = (process.env.DEEPGRAM_API_KEY || "").trim();
      const auth = own ? `Token ${own}` : `Bearer ${(await api<{ token: string }>("POST", "/api/agent/starters/stt-token")).token}`;
      if (!this.wsWanted || this.closed) return;
      const q = new URLSearchParams({ model: "nova-3", language: "en-US", encoding: "linear16", sample_rate: String(RATE), channels: "1", interim_results: "true", smart_format: "true", vad_events: "true", endpointing: "300" });
      const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${q}`, { headers: { Authorization: auth } });
      ws.on("message", (raw) => {
        let m: { type?: string; is_final?: boolean; channel?: { alternatives?: { transcript?: string }[] } } = {};
        try { m = JSON.parse(String(raw)); } catch { return; }
        const now = Date.now();
        if (m.type === "SpeechStarted") { this.heard(now); return; }
        if (m.type !== "Results") return;
        const text = (m.channel?.alternatives?.[0]?.transcript ?? "").trim();
        if (!text) return;
        this.heard(now);
        if (m.is_final) {
          this.lines.push({ at: now, text });
          this.lines = this.lines.filter((l) => now - l.at < KEEP_MS);
        }
      });
      ws.on("close", () => { if (this.ws === ws) this.ws = null; });
      ws.on("error", (e) => log(`studio ${this.id}: deepgram: ${(e as Error).message}`));
      await new Promise<void>((ok, bad) => { ws.once("open", () => ok()); ws.once("error", bad); });
      this.ws = ws;
      log(`studio ${this.id}: words on`);
    } catch (err) {
      log(`studio ${this.id}: couldn't start words: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 10_000));
    } finally {
      this.wsBusy = false;
    }
  }

  private heard(now: number) {
    if (!this.firstSpeech) this.firstSpeech = now;
    this.lastSpeech = now;
  }

  private closeWs() {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    try { ws.send(JSON.stringify({ type: "CloseStream" })); } catch { /* closing anyway */ }
    setTimeout(() => { try { ws.close(); } catch { /* gone */ } }, 1000);
  }

  /** Seconds heard and cards used since last time; the answer says whether a cap is now hit. */
  async report() {
    const seconds = Math.round(this.streamedMs / 1000);
    const used = this.used;
    const dismissed = this.dismissed;
    if (!seconds && !used && !dismissed) return;
    this.streamedMs -= seconds * 1000;
    this.used = 0;
    this.dismissed = 0;
    try {
      const r = await api<{ cap: RoomPass["cap"] }>("POST", "/api/agent/starters/usage", { studioId: this.id, seconds, used, dismissed });
      if (r.cap) this.cap = r.cap;
    } catch (err) {
      log(`studio ${this.id}: usage not sent: ${(err as Error).message}`);
    }
  }

  get done() { return this.closed; }

  async stop() {
    if (this.closed) return;
    this.closed = true;
    if (this.tick) clearInterval(this.tick);
    this.wsWanted = false;
    this.closeWs();
    await this.report();
    // The words go with it.
    this.lines = [];
    this.shown = [];
    this.bufs.clear();
    await this.room.disconnect().catch(() => {});
    log(`studio ${this.id}: stopped`);
  }
}

const sessions = new Map<number, Session>();

async function poll() {
  let list: RoomPass[];
  let off = new Set<number>();
  try {
    const got = await api<{ rooms: RoomPass[]; off?: number[] }>("GET", "/api/agent/starters/rooms");
    list = got.rooms;
    off = new Set(got.off ?? []);
  } catch (err) {
    // A failed poll is never read as "everyone left".
    log(`poll failed: ${(err as Error).message}`);
    return;
  }
  const want = new Map(list.map((r) => [r.studioId, r]));
  for (const [id, s] of sessions) {
    if (s.done) { sessions.delete(id); continue; }
    if (want.has(id)) { s.missed = 0; continue; }
    // Switched off by the host: leave now, never 45 seconds later.
    if (off.has(id)) { sessions.delete(id); await s.stop(); continue; }
    // Leave only after 3 polls in a row (45s) without the room; 26 Nov's studio 13 test dropped out on single misses.
    if (++s.missed >= MISSES_TO_LEAVE) { sessions.delete(id); await s.stop(); }
  }
  for (const pass of list) {
    const cur = sessions.get(pass.studioId);
    if (cur) { cur.update(pass); continue; }
    const s = new Session(pass);
    sessions.set(pass.studioId, s);
    try { await s.start(pass); } catch (err) { log(`studio ${pass.studioId}: couldn't join: ${(err as Error).message}`); sessions.delete(pass.studioId); await s.stop(); }
  }
}

async function main() {
  if (!AGENT_TOKEN) { console.error("No AGENT_TOKEN."); process.exit(1); }
  log(`Conversation starters listener watching ${API_BASE}, every ${POLL_MS / 1000}s`);
  await api("POST", "/api/agent/worker-note", { text: `${process.env.WORKER_NAME || "local"}: starters listener started` }).catch(() => {});
  let stopping = false;
  const quit = async () => {
    if (stopping) return;
    stopping = true;
    log("stopping");
    await Promise.all([...sessions.values()].map((s) => s.stop()));
    await dispose().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void quit());
  process.on("SIGINT", () => void quit());
  setInterval(() => { for (const s of sessions.values()) void s.report(); }, 60_000);
  for (;;) {
    await poll();
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

void main();
