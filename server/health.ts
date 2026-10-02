// System health: is everything the site depends on answering right now?
//
// Each check asks its service something free (who am I, list one thing,
// account status), never anything that spends credits or sends anything.
// A service with no free question is checked for its key only, and says so.
// Two things can't be asked, only watched: the clip worker on Render and
// Vercel's scheduled jobs. Both leave a heartbeat (beat()) as they work.
//
// /api/admin/health runs the checks for Admin → System health.
// /api/cron/health runs them every five minutes and posts to Slack when
// something goes down (after two misses in a row, so a blip doesn't page
// anyone) and again when it's back.
import type { Express, RequestHandler } from "express";
import { eq, sql } from "drizzle-orm";
import { db, storage } from "./storage.js";
import { discoveryCache } from "../shared/schema.js";
import { egress, isLiveKitConfigured, rooms } from "./livekit.js";
import { signedRecordingUrl } from "./recordingStorage.js";

export type HealthState = "ok" | "down" | "off";
export type HealthCheck = { key: string; name: string; group: string; powers: string; state: HealthState; detail: string; ms: number };

const env = (...names: string[]) => names.map((n) => (process.env[n] ?? "").trim()).find(Boolean) ?? "";
const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Heartbeats: the worker and the crons say they're alive as they go.
// ---------------------------------------------------------------------------
const lastWrite = new Map<string, number>();
/** "Still here." Written at most once a minute per server, so a busy loop doesn't hammer the database. */
export async function beat(key: string): Promise<void> {
  const t = Date.now();
  if (t - (lastWrite.get(key) ?? 0) < 60_000) return;
  lastWrite.set(key, t);
  const payload = JSON.stringify({ at: new Date(t).toISOString() });
  await db.insert(discoveryCache).values({ key: `health:beat:${key}`, payload, createdAt: now() })
    .onConflictDoUpdate({ target: discoveryCache.key, set: { payload, createdAt: now() } }).catch(() => {});
}
async function lastBeat(key: string): Promise<number> {
  const [row] = await db.select().from(discoveryCache).where(eq(discoveryCache.key, `health:beat:${key}`));
  return row ? Date.parse(row.createdAt) : 0;
}
const ago = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------
type Def = { key: string; name: string; group: string; powers: string; run: () => Promise<{ state: HealthState; detail: string }> };

/** A GET that has to answer 2xx (or a status you name) within eight seconds. */
async function ping(url: string, init: RequestInit = {}, okStatus: (s: number) => boolean = (s) => s >= 200 && s < 300): Promise<{ state: HealthState; detail: string }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) });
  if (okStatus(res.status)) return { state: "ok", detail: "Answering" };
  const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 120);
  return { state: "down", detail: `${res.status}${res.status === 401 || res.status === 403 ? " (the key was refused)" : ""}${body ? `: ${body}` : ""}` };
}
const keyOnly = (names: string[], what: string) => async () =>
  env(...names) ? { state: "ok" as const, detail: `Key set (${what})` } : { state: "off" as const, detail: `Not set here (${names[0]})` };

const DEFS: Def[] = [
  // The platform
  { key: "db", name: "Database", group: "The platform", powers: "Everything: accounts, shows, the lineup", run: async () => { await db.execute(sql`select 1`); return { state: "ok", detail: "Answering" }; } },
  {
    key: "livekit", name: "LiveKit", group: "The platform", powers: "Studio, green room, Rooms, going live",
    run: async () => {
      if (!isLiveKitConfigured()) return { state: "off", detail: "Not set up (LIVEKIT_URL)" };
      const list = await rooms().listRooms();
      return { state: "ok", detail: `${list.length} room${list.length === 1 ? "" : "s"} open` };
    },
  },
  {
    key: "egress", name: "LiveKit egress (broadcast and recording)", group: "The platform", powers: "Going live to YouTube and the destinations, recording the show",
    // LiveKit's own list of what's running, checked against what the studio believes is running.
    run: async () => {
      if (!isLiveKitConfigured()) return { state: "off", detail: "Not set up (LIVEKIT_URL)" };
      const all = await egress().listEgress({ active: true });
      const running = new Set(all.filter((e) => /^(0|1)$|STARTING|ACTIVE/i.test(String(e.status))).map((e) => e.egressId));
      const ev = await storage.getFeaturedEvent();
      const lost: string[] = [];
      let live = 0, recording = 0;
      for (const st of await storage.listStudios(ev.id)) {
        if (st.broadcastEgressId) { if (running.has(st.broadcastEgressId)) live++; else lost.push(`${st.name || "Studio"}'s broadcast`); }
        if (st.recordingEgressId) { if (running.has(st.recordingEgressId)) recording++; else lost.push(`${st.name || "Studio"}'s recording`); }
      }
      if (lost.length) return { state: "down", detail: `The studio thinks it's running but LiveKit has stopped: ${lost.join(", ")}` };
      return { state: "ok", detail: live || recording ? `${live ? "Broadcasting" : ""}${live && recording ? " and " : ""}${recording ? "recording" : ""} now · ${running.size} running` : running.size ? `${running.size} running` : "Ready (nothing on air)" };
    },
  },
  {
    key: "r2", name: "Recording storage (Cloudflare R2)", group: "The platform", powers: "Recordings, episodes, uploads, the Library",
    // A file that isn't there answers 404 when the key is good, 403 when it isn't.
    run: async () => {
      if (!env("R2_ACCESS_KEY_ID")) return { state: "off", detail: "Not set up (R2_ACCESS_KEY_ID)" };
      const r = await ping(await signedRecordingUrl("health/ping.txt", 120), { method: "GET" }, (s) => s === 404 || s === 200);
      return r.state === "ok" ? { state: "ok", detail: "Answering, key accepted" } : r;
    },
  },
  {
    key: "supabase", name: "Photo storage (Supabase)", group: "The platform", powers: "Headshots, show art, magazine pictures",
    run: async () => {
      const url = env("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
      const key = env("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY");
      if (!url || !key) return { state: "off", detail: "Not set up (SUPABASE_URL)" };
      return ping(`${url}/storage/v1/bucket`, { headers: { Authorization: `Bearer ${key}`, apikey: key } });
    },
  },
  {
    key: "worker", name: "Clip worker (Render)", group: "The platform", powers: "Clips, MP3s, imports, transcripts, magazine segments",
    run: async () => {
      const t = await lastBeat("worker");
      if (!t) return { state: "down", detail: "Hasn't checked in yet" };
      // It asks for work every few seconds; three quiet minutes means it's stopped.
      return Date.now() - t < 3 * 60_000 ? { state: "ok", detail: `Asking for work (${ago(Date.now() - t)})` } : { state: "down", detail: `Last asked for work ${ago(Date.now() - t)}` };
    },
  },
  {
    key: "cron", name: "Scheduled jobs (Vercel cron)", group: "The platform", powers: "Reminders, nudges, channel go-live, Listen Notes, reach",
    run: async () => {
      const t = await lastBeat("cron");
      if (!t) return { state: "down", detail: "No run seen yet" };
      return Date.now() - t < 5 * 60_000 ? { state: "ok", detail: `Last ran ${ago(Date.now() - t)}` } : { state: "down", detail: `Last ran ${ago(Date.now() - t)}` };
    },
  },
  // Mail and messages
  {
    key: "resend", name: "Email (Resend)", group: "Mail and messages", powers: "Every email we send, and hello@ coming in",
    run: async () => (env("RESEND_API_KEY") ? ping("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}` } }) : { state: "off", detail: "Not set up (RESEND_API_KEY)" }),
  },
  { key: "slack", name: "Slack alerts", group: "Mail and messages", powers: "Inbox alerts, and these health alerts", run: async () => (/^https:\/\/hooks\.slack\.com\//.test(env("SLACK_INBOX_WEBHOOK_URL")) ? { state: "ok", detail: "Webhook set" } : { state: "off", detail: "Not set up (SLACK_INBOX_WEBHOOK_URL)" }) },
  { key: "push", name: "App notifications (Web Push)", group: "Mail and messages", powers: "Phone and desktop notifications", run: keyOnly(["VAPID_PRIVATE_KEY"], "VAPID") },
  // SI
  {
    key: "anthropic", name: "Claude (Anthropic)", group: "SI", powers: "Alex, magazine drafts, inbox replies, SI search",
    run: async () => (env("ANTHROPIC_API_KEY") ? ping("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" } }) : { state: "off", detail: "Not set up (ANTHROPIC_API_KEY)" }),
  },
  { key: "fal", name: "fal", group: "SI", powers: "Photo cut-outs on SmartLinks", run: keyOnly(["FAL_KEY"], "no free status call") },
  {
    key: "elevenlabs", name: "ElevenLabs", group: "SI", powers: "Voice in clips and reads",
    run: async () => {
      const k = env("ELEVENLABS_API_KEY", "ELEVEN_LABS_API_KEY");
      if (!k) return { state: "off", detail: "Runs on the clip worker; no key here" };
      const res = await fetch("https://api.elevenlabs.io/v1/user", { headers: { "xi-api-key": k }, signal: AbortSignal.timeout(8_000) });
      if (res.ok) return { state: "ok", detail: "Answering" };
      const body = await res.text().catch(() => "");
      // A key limited to voice work can't read the account; being told so means the key itself was accepted.
      if (/missing the permission/i.test(body)) return { state: "ok", detail: "Key accepted (limited to voice work)" };
      return { state: "down", detail: `${res.status}${res.status === 401 ? " (the key was refused)" : ""}` };
    },
  },
  // Social, podcasts and data
  {
    key: "uploadpost", name: "Upload-Post", group: "Social and podcasts", powers: "Connected accounts, posting, the social calendar",
    run: async () => (env("UPLOAD_POST_API_KEY") ? ping("https://api.upload-post.com/api/uploadposts/users", { headers: { Authorization: `Apikey ${env("UPLOAD_POST_API_KEY")}` } }) : { state: "off", detail: "Not set up (UPLOAD_POST_API_KEY)" }),
  },
  { key: "google", name: "YouTube (Google sign-in)", group: "Social and podcasts", powers: "Connect YouTube, going live to a channel", run: keyOnly(["GOOGLE_CLIENT_ID"], "OAuth app") },
  { key: "zoom", name: "Zoom", group: "Social and podcasts", powers: "Zoom recordings into the Library", run: keyOnly(["ZOOM_CLIENT_ID"], "OAuth app") },
  { key: "listennotes", name: "Listen Notes", group: "Social and podcasts", powers: "Podcast search, Listen Notes listing", run: keyOnly(["LISTEN_API_KEY"], "requests are counted, so not spent on a check") },
  {
    key: "podchaser", name: "Podchaser", group: "Social and podcasts", powers: "Hosts & guests search",
    run: async () => {
      const k = env("PODCHASER_API_KEY", "PODCHASER_CLIENT_ID", "PODCHASER_KEY");
      return k ? ping("https://developers.podchaser.com/api/rest/v1/usage", { headers: { "x-api-key": k } }) : { state: "off", detail: "Not set up (PODCHASER_API_KEY)" };
    },
  },
  {
    key: "influencers", name: "Influencers Club", group: "Social and podcasts", powers: "Discovery creator search and profiles",
    run: async () => {
      const k = env("INFLUENCER_CLUB_API_KEY");
      if (!k) return { state: "off", detail: "Not set up (INFLUENCER_CLUB_API_KEY)" };
      const res = await fetch("https://api-dashboard.influencers.club/public/v1/account/credits", { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(8_000) });
      if (res.ok) return { state: "ok", detail: "Answering" };
      const body = await res.text().catch(() => "");
      // Their API answers a bad key in JSON; an HTML page means the address, not the key (they have no free status call).
      if (body.trimStart().startsWith("<")) return { state: "ok", detail: "Reachable, key set (no free status call)" };
      return { state: "down", detail: `${res.status}${res.status === 401 || res.status === 403 ? " (the key was refused)" : ""}: ${body.slice(0, 100)}` };
    },
  },
  { key: "parallel", name: "Parallel", group: "Social and podcasts", powers: "Sponsor finder research", run: keyOnly(["PARALLEL_API_KEY", "PARALLEL_AI_API_KEY", "PARALLELAI_API_KEY", "PARALLEL_KEY", "PARALLEL_WEB_API_KEY"], "no free status call") },
  // Money and safety
  {
    key: "stripe", name: "Stripe", group: "Payments and safety", powers: "Pōstify plans and tokens",
    run: async () => (env("STRIPE_SECRET_KEY") ? ping("https://api.stripe.com/v1/balance", { headers: { Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}` } }) : { state: "off", detail: "Not set up (STRIPE_SECRET_KEY)" }),
  },
  { key: "turnstile", name: "Cloudflare Turnstile", group: "Payments and safety", powers: "The \"are you human\" check on public forms", run: keyOnly(["TURNSTILE_SECRET_KEY"], "site key pair") },
];

/** Checks that need the main routes' helpers (e.g. a channel's YouTube sign-in) are added from there. */
const EXTRA: Def[] = [];
export function addHealthCheck(d: Def): void {
  if (!EXTRA.some((x) => x.key === d.key)) EXTRA.push(d);
}

export async function runHealth(): Promise<{ checkedAt: string; checks: HealthCheck[]; ok: number; down: number; off: number }> {
  const all = [...DEFS.slice(0, DEFS.findIndex((d) => d.key === "uploadpost")), ...EXTRA, ...DEFS.slice(DEFS.findIndex((d) => d.key === "uploadpost"))];
  const checks = await Promise.all(all.map(async (d): Promise<HealthCheck> => {
    const t = Date.now();
    try {
      const r = await Promise.race([d.run(), new Promise<{ state: HealthState; detail: string }>((resolve) => setTimeout(() => resolve({ state: "down", detail: "No answer in 10 seconds" }), 10_000))]);
      return { key: d.key, name: d.name, group: d.group, powers: d.powers, ...r, ms: Date.now() - t };
    } catch (err) {
      return { key: d.key, name: d.name, group: d.group, powers: d.powers, state: "down", detail: ((err as Error).message || "Error").slice(0, 160), ms: Date.now() - t };
    }
  }));
  return { checkedAt: now(), checks, ok: checks.filter((c) => c.state === "ok").length, down: checks.filter((c) => c.state === "down").length, off: checks.filter((c) => c.state === "off").length };
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------
type Memory = Record<string, { state: HealthState; misses: number; alerted: boolean }>;

async function slack(text: string): Promise<void> {
  const url = env("SLACK_INBOX_WEBHOOK_URL");
  if (!/^https:\/\/hooks\.slack\.com\//.test(url)) return;
  await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(8_000) }).catch(() => {});
}

/** Run the checks, remember them, and tell Slack what changed. */
export async function healthAlerts(): Promise<{ down: string[]; alerted: string[]; recovered: string[] }> {
  const r = await runHealth();
  const [row] = await db.select().from(discoveryCache).where(eq(discoveryCache.key, "health:memory"));
  const mem: Memory = (() => { try { return row ? JSON.parse(row.payload) : {}; } catch { return {}; } })();
  const alerted: string[] = [];
  const recovered: string[] = [];
  for (const c of r.checks) {
    const prev = mem[c.key] ?? { state: "ok", misses: 0, alerted: false };
    if (c.state === "down") {
      const misses = prev.misses + 1;
      // Two misses in a row (ten minutes) before anyone is told: a single slow answer isn't an outage.
      if (misses >= 2 && !prev.alerted) { alerted.push(c.key); await slack(`:red_circle: *${c.name} is down.* ${c.detail}\nIt powers: ${c.powers}.\n<${(env("PUBLIC_ORIGIN") || "https://www.militaryvoices.ai").replace(/\/+$/, "")}/admin/health|Open System health>`); }
      mem[c.key] = { state: "down", misses, alerted: prev.alerted || misses >= 2 };
    } else {
      if (prev.alerted) { recovered.push(c.key); await slack(`:large_green_circle: *${c.name} is back.* ${c.detail}`); }
      mem[c.key] = { state: c.state, misses: 0, alerted: false };
    }
  }
  const payload = JSON.stringify(mem);
  await db.insert(discoveryCache).values({ key: "health:memory", payload, createdAt: now() }).onConflictDoUpdate({ target: discoveryCache.key, set: { payload, createdAt: now() } });
  return { down: r.checks.filter((c) => c.state === "down").map((c) => c.key), alerted, recovered };
}

export function registerHealth(app: Express, requireAdmin: RequestHandler): void {
  app.get("/api/admin/health", requireAdmin, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await runHealth());
  });
  app.get("/api/cron/health", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") !== secret) return res.status(401).json({ message: "Not authorised." });
    await beat("cron");
    res.json(await healthAlerts());
  });
}
