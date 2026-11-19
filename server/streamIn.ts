import type { Express, RequestHandler, Response } from "express";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { requireHostSession, getSessionEmail } from "./session.js";
import { createRtmpIngress, deleteIngress, listIngressForRoom, isLiveKitConfigured, isRecordingConfigured, runningEgressIds, startRoomRecording, stopEgressById } from "./livekit.js";
import { sendImportReadyEmail } from "./email.js";
import { cleanupRadioFeeds } from "./radioStreamIn.js";
import { ensureRecordingsBucket } from "./recordingStorage.js";
import { seal, unseal } from "./secretBox.js";
import { slackNote } from "./slack.js";
import { recordings, streamKeys, streamSessions, type StreamKeyRow } from "../shared/schema.js";

/**
 * Stream in. A podcaster who produces their show in StreamYard, Restream,
 * OBS, Riverside, or anything with a "custom RTMP" destination gets one
 * stream key here. Whenever they go live to it, the stream is recorded into
 * their Library like any studio recording (the egress_ended webhook finishes
 * it and queues its clips); when they stop, the recording stops.
 *
 * The media is LiveKit's: an RTMP ingress into a room of its own, and a room
 * composite recording to our storage. Both are metered by LiveKit, so each
 * podcaster has a monthly hours cap, and every failure ends in words they can
 * act on (a full Build plan looks like "can't start", not a silent miss).
 */

export const DEFAULT_CAP_HOURS = 10;
/** An encoder that drops and comes back inside this stays one recording. */
const GRACE_MS = 3 * 60_000;
/** LiveKit ends a file at 3 hours; a new one starts at 2, and the old one stops a pass later. */
const ROLL_MS = 2 * 3600_000;
const now = () => new Date().toISOString();
const noStore = (res: Response) => void res.set("Cache-Control", "no-store");

/** The first moment of this month, UTC: hours reset then. */
function monthStart(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/** Hours a podcaster may stream in a month: their own setting, else the platform's, else the default. */
export async function capSeconds(email: string): Promise<number> {
  const own = Number(await storage.getSetting(`streamin:cap:${email}`));
  const all = Number(await storage.getSetting("streamin:cap-hours"));
  const hours = Number.isFinite(own) && own > 0 ? own : Number.isFinite(all) && all > 0 ? all : DEFAULT_CAP_HOURS;
  return Math.round(hours * 3600);
}

/** Seconds streamed this month: finished go-lives plus whatever is running now. */
export async function usedSeconds(email: string): Promise<number> {
  const rows = await db.select().from(streamSessions).where(and(eq(streamSessions.ownerEmail, email), gte(streamSessions.startedAt, monthStart())));
  const t = Date.now();
  return rows.reduce((n, r) => n + (r.endedAt ? r.seconds : Math.max(0, Math.round((t - Date.parse(r.startedAt)) / 1000))), 0);
}

const normEmail = (e: string) => e.toLowerCase().trim();

async function keyFor(email: string): Promise<StreamKeyRow | undefined> {
  const [row] = await db.select().from(streamKeys).where(eq(streamKeys.ownerEmail, email)).limit(1);
  return row;
}

/** Make (or remake) the LiveKit ingress behind a key row. */
async function issue(row: StreamKeyRow, name: string): Promise<StreamKeyRow> {
  const room = `stream-${row.id}`;
  const cred = await createRtmpIngress({ room, identity: `feed-${row.id}`, name: name || "Live stream" });
  const [out] = await db
    .update(streamKeys)
    .set({ room, ingressId: cred.ingressId, url: cred.url, streamKey: seal(cred.streamKey), status: "idle", pausedWhy: "", problem: "", rotatedAt: now() })
    .where(eq(streamKeys.id, row.id))
    .returning();
  return out;
}

async function showName(email: string): Promise<string> {
  const p = await storage.getProfileByEmail(email).catch(() => undefined);
  return (p?.podcastName || p?.hostName || "").trim();
}

/** Words for a LiveKit failure: a full plan or a busy recorder is ours to fix, not theirs. */
function plain(err: unknown): string {
  const m = String((err as Error)?.message ?? err ?? "").toLowerCase();
  if (/limit|quota|concurren|exceed|too many|insufficient|resource/.test(m)) return "Our live recorder is full right now, so this stream wasn't saved. We've been told. Try going live again in a few minutes.";
  return "We couldn't start recording this stream. It still reached our servers but wasn't saved. Try going live again in a minute.";
}

async function closeSession(c: StreamKeyRow): Promise<void> {
  const open = await db.select().from(streamSessions).where(and(eq(streamSessions.keyId, c.id), eq(streamSessions.endedAt, ""))).orderBy(desc(streamSessions.id));
  for (const s of open) {
    const seconds = Math.max(0, Math.round((Date.now() - Date.parse(s.startedAt)) / 1000));
    await db.update(streamSessions).set({ endedAt: now(), seconds }).where(eq(streamSessions.id, s.id));
  }
}

async function startRecording(c: StreamKeyRow, continued?: string): Promise<StreamKeyRow> {
  if (!continued) {
    // Claim the key before any slow call: LiveKit retries a webhook that is slow to answer, and a second ingress_started must find it taken.
    const [claimed] = await db.update(streamKeys).set({ egressId: "pending", liveSince: now() }).where(and(eq(streamKeys.id, c.id), eq(streamKeys.egressId, ""))).returning();
    if (!claimed) return c;
    try {
      return await startClaimed(c, continued);
    } catch (err) {
      await db.update(streamKeys).set({ egressId: "", liveSince: "" }).where(and(eq(streamKeys.id, c.id), eq(streamKeys.egressId, "pending")));
      throw err;
    }
  }
  return startClaimed(c, continued);
}

async function startClaimed(c: StreamKeyRow, continued?: string): Promise<StreamKeyRow> {
  await ensureRecordingsBucket();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filepath = `streams/${c.id}-${stamp}.mp4`;
  const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date());
  const name = await showName(c.ownerEmail);
  const title = continued ? `${continued.replace(/ \(continued\)$/, "")} (continued)` : `${name || "Live stream"} · ${when}`;
  const egressId = await startRoomRecording(c.room, filepath);
  // A Library recording like any other; the event and studio are only bookkeeping.
  const event = await storage.getFeaturedEvent();
  const studio = await storage.getOrCreateStudio(event.id);
  const rec = await storage.createRecording({ eventId: event.id, studioId: studio.id, signupId: null, email: c.ownerEmail, title, egressId, filepath });
  await db.insert(streamSessions).values({ keyId: c.id, ownerEmail: c.ownerEmail, recordingId: rec.id, egressId, startedAt: now() });
  // A fresh start only lands if the claim is still ours: a stop or a new key in the meantime released it, and then this recording must not run on.
  const [out] = await db
    .update(streamKeys)
    .set({ egressId, recordingId: rec.id, status: "live", liveSince: continued ? c.liveSince : now(), lostAt: "", problem: "" })
    .where(continued ? eq(streamKeys.id, c.id) : and(eq(streamKeys.id, c.id), eq(streamKeys.egressId, "pending")))
    .returning();
  if (!out) {
    await stopEgressById(egressId).catch(() => {});
    await db.update(streamSessions).set({ endedAt: now(), seconds: 0 }).where(eq(streamSessions.egressId, egressId));
    return c;
  }
  return out;
}

async function stopRecording(c: StreamKeyRow): Promise<StreamKeyRow> {
  if (c.egressId) await stopEgressById(c.egressId).catch(() => {});
  await closeSession(c);
  const [out] = await db.update(streamKeys).set({ egressId: "", liveSince: "", lostAt: "", status: c.status === "paused" ? "paused" : "idle" }).where(eq(streamKeys.id, c.id)).returning();
  return out;
}

/** From the LiveKit webhook: a stream came in on a key (record it, within the hours) or stopped (stop). */
export async function onStreamInWebhook(event: { event?: string; ingressInfo?: { roomName?: string } }): Promise<void> {
  const room = event.ingressInfo?.roomName ?? "";
  if (!room.startsWith("stream-") || (event.event !== "ingress_started" && event.event !== "ingress_ended")) return;
  await schemaIsReady();
  const [c] = await db.select().from(streamKeys).where(eq(streamKeys.room, room)).limit(1);
  if (!c) return;
  if (event.event === "ingress_ended") {
    // Not stopped yet: a dropped connection that comes straight back stays one recording. The minute cron stops it after the grace period.
    if (c.egressId && !c.lostAt) await db.update(streamKeys).set({ lostAt: now() }).where(eq(streamKeys.id, c.id));
    return;
  }
  if (c.egressId) {
    // A reconnect on a recording that is already running.
    if (c.lostAt) await db.update(streamKeys).set({ lostAt: "" }).where(eq(streamKeys.id, c.id));
    return;
  }
  const cap = await capSeconds(c.ownerEmail);
  if ((await usedSeconds(c.ownerEmail)) >= cap) {
    // Out of hours: end the stream itself, or LiveKit keeps transcoding it at our cost.
    await deleteIngress(c.ingressId).catch(() => {});
    await db.update(streamKeys).set({ status: "paused", ingressId: "", pausedWhy: `You've used this month's ${Math.round(cap / 3600)} streaming hours. They come back on the 1st.` }).where(eq(streamKeys.id, c.id));
    return;
  }
  try {
    await startRecording(c);
  } catch (err) {
    console.error("Stream-in recording didn't start:", (err as Error).message);
    await db.update(streamKeys).set({ problem: plain(err) }).where(eq(streamKeys.id, c.id));
    void slackNote(`Stream in: couldn't start recording for a podcaster's stream (${(err as Error).message}). Check the LiveKit plan limits.`).catch(() => {});
  }
}

/** A paused key (hours used) comes back by itself once there are hours again, with a fresh key. */
async function maybeResume(c: StreamKeyRow): Promise<StreamKeyRow> {
  if (c.status !== "paused") return c;
  if ((await usedSeconds(c.ownerEmail)) >= (await capSeconds(c.ownerEmail))) return c;
  return issue(c, await showName(c.ownerEmail));
}

async function view(c: StreamKeyRow | undefined) {
  const email = c?.ownerEmail ?? "";
  let live = false;
  let linkError = "";
  if (c && c.ingressId && isLiveKitConfigured()) {
    try {
      const [i] = await listIngressForRoom(c.room);
      const s = Number(i?.state?.status);
      live = s === 1 || s === 2; // buffering or publishing
      linkError = i?.state?.error ? String(i.state.error) : "";
    } catch {
      /* if LiveKit can't be reached we still show what we issued */
    }
  }
  const cap = email ? await capSeconds(email) : 0;
  const used = email ? await usedSeconds(email) : 0;
  return {
    key: c
      ? {
          url: c.url,
          streamKey: unseal(c.streamKey),
          status: c.status as "idle" | "live" | "paused",
          arriving: live, // the encoder is connected, whether or not it is recording yet
          liveSince: c.liveSince,
          pausedWhy: c.pausedWhy,
          problem: c.problem || (linkError ? "Your stream is reaching us but something is wrong with it. Check your software is sending video and sound, then stop and start it again." : ""),
        }
      : null,
    usage: { usedMin: Math.round(used / 60), capMin: Math.round(cap / 60) },
  };
}

/**
 * The minute pass. Stops a recording whose stream has been gone past the
 * grace period or whose hours ran out, starts a fresh file before LiveKit's
 * 3-hour cap, tidies a recorder that died, and tells each podcaster (once)
 * that a finished stream is in their Library.
 */
export async function runStreamInPass(): Promise<{ stopped: number; rolled: number; mailed: number }> {
  await schemaIsReady();
  const out = { stopped: 0, rolled: 0, mailed: 0 };
  await cleanupRadioFeeds().catch((err) => console.error("Radio feed cleanup failed:", (err as Error).message));
  let running: Set<string>;
  try {
    running = await runningEgressIds();
  } catch {
    return out; // LiveKit unreachable is not evidence that anything stopped
  }
  for (const c of await db.select().from(streamKeys)) {
    const retiring = await storage.getSetting(`streamin:retire:${c.id}`);
    if (retiring && retiring !== c.egressId) {
      await stopEgressById(retiring).catch(() => {});
      await storage.setSetting(`streamin:retire:${c.id}`, "");
    }
    if (!c.egressId) continue;
    if (c.egressId === "pending") {
      // A start in flight; one that never finished (the function died) is let go after two minutes.
      if (!c.liveSince || Date.now() - Date.parse(c.liveSince) > 2 * 60_000) await db.update(streamKeys).set({ egressId: "", liveSince: "" }).where(and(eq(streamKeys.id, c.id), eq(streamKeys.egressId, "pending")));
      continue;
    }
    if (!running.has(c.egressId)) {
      // The recorder is gone (a failure, or a hand stop): close the books; the reconcile pass settles the file.
      await closeSession(c);
      await db.update(streamKeys).set({ egressId: "", liveSince: "", lostAt: "", status: c.status === "paused" ? "paused" : "idle" }).where(eq(streamKeys.id, c.id));
      out.stopped++;
      continue;
    }
    if (c.lostAt && Date.now() - Date.parse(c.lostAt) >= GRACE_MS) {
      await stopRecording(c);
      out.stopped++;
      continue;
    }
    const cap = await capSeconds(c.ownerEmail);
    if ((await usedSeconds(c.ownerEmail)) >= cap) {
      await stopRecording(c);
      if (c.ingressId) await deleteIngress(c.ingressId).catch(() => {});
      await db.update(streamKeys).set({ status: "paused", ingressId: "", pausedWhy: `You've used this month's ${Math.round(cap / 3600)} streaming hours, so your stream was stopped. They come back on the 1st.` }).where(eq(streamKeys.id, c.id));
      out.stopped++;
      continue;
    }
    const [open] = await db.select().from(streamSessions).where(and(eq(streamSessions.keyId, c.id), eq(streamSessions.endedAt, ""))).orderBy(desc(streamSessions.id)).limit(1);
    if (open && !retiring && !c.lostAt && Date.now() - Date.parse(open.startedAt) >= ROLL_MS) {
      try {
        const [prev] = c.recordingId ? await db.select().from(recordings).where(eq(recordings.id, c.recordingId)).limit(1) : [];
        await closeSession(c); // the old file runs on a few minutes, overlapping; those minutes are not counted twice
        await startRecording({ ...c, egressId: "" }, prev?.title || "Live stream");
        await storage.setSetting(`streamin:retire:${c.id}`, c.egressId);
        out.rolled++;
      } catch (err) {
        console.error("Stream-in roll failed:", (err as Error).message);
      }
    }
  }

  // Finished streams: tell the podcaster once that they're in the Library.
  const since = new Date(Date.now() - 3 * 24 * 3600_000).toISOString();
  for (const s of await db.select().from(streamSessions).where(gte(streamSessions.startedAt, since))) {
    if (!s.recordingId || (s.endedAt === "" && running.has(s.egressId))) continue;
    if (await storage.getSetting(`streamin:mailed:${s.recordingId}`)) continue;
    const [rec] = await db.select().from(recordings).where(eq(recordings.id, s.recordingId)).limit(1);
    if (!rec || rec.status === "Recording") continue;
    await storage.setSetting(`streamin:mailed:${s.recordingId}`, now());
    if (rec.status === "Ready") {
      // A test of a few seconds isn't worth an email; it is in the Library all the same.
      if (rec.durationSec >= 60) {
        await sendImportReadyEmail({ to: rec.email, recordingId: rec.id, title: rec.title, startedAt: rec.startedAt, durationSec: rec.durationSec, provider: "stream" }).then(() => { out.mailed++; }).catch((err) => console.error("Stream-in email failed:", (err as Error).message));
      }
    } else {
      void slackNote(`Stream in: a recording didn't save (${rec.error || "no reason given"}). Podcaster's stream, recording ${rec.id}.`).catch(() => {});
    }
  }
  return out;
}

export function registerStreamIn(app: Express): void {
  const cron: RequestHandler = async (req, res) => {
    if (process.env.CRON_SECRET && (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") !== process.env.CRON_SECRET) {
      res.status(401).json({ message: "Not authorised." });
      return;
    }
    if (!isLiveKitConfigured()) {
      res.json({ skipped: "no media layer" });
      return;
    }
    try {
      res.json(await runStreamInPass());
    } catch (err) {
      console.error("Stream-in pass failed:", (err as Error).message);
      res.status(500).json({ message: "Stream-in pass failed." });
    }
  };
  app.get("/api/cron/stream-in", cron);
  app.post("/api/cron/stream-in", cron);

  const ready = (res: Response) => {
    if (!isLiveKitConfigured() || !isRecordingConfigured()) {
      res.status(503).json({ message: "Live streaming in isn't switched on yet." });
      return false;
    }
    return true;
  };

  app.get("/api/host/stream-in", requireHostSession, async (req, res) => {
    noStore(res);
    await schemaIsReady();
    const email = normEmail(getSessionEmail(req) ?? "");
    const configured = isLiveKitConfigured() && isRecordingConfigured();
    if (!configured) return res.json({ configured: false, key: null, usage: { usedMin: 0, capMin: 0 } });
    const row = await keyFor(email);
    res.json({ configured: true, ...(await view(row ? await maybeResume(row).catch(() => row) : undefined)) });
  });

  /** Get my stream key (the same one every time once it exists). */
  app.post("/api/host/stream-in", requireHostSession, async (req, res) => {
    if (!ready(res)) return;
    await schemaIsReady();
    const email = normEmail(getSessionEmail(req) ?? "");
    const existing = await keyFor(email);
    if (existing) return res.json({ configured: true, ...(await view(await maybeResume(existing).catch(() => existing))) });
    const [row] = await db.insert(streamKeys).values({ ownerEmail: email, createdAt: now() }).onConflictDoNothing().returning();
    if (!row) return res.json({ configured: true, ...(await view(await keyFor(email))) });
    try {
      res.status(201).json({ configured: true, ...(await view(await issue(row, await showName(email)))) });
    } catch (err) {
      await db.delete(streamKeys).where(eq(streamKeys.id, row.id));
      console.error("Couldn't make a stream-in key:", (err as Error).message);
      void slackNote(`Stream in: couldn't make a stream key (${(err as Error).message}). Check the LiveKit plan limits.`).catch(() => {});
      res.status(502).json({ message: "Couldn't make your stream key right now. Try again in a moment." });
    }
  });

  /** A leaked or old key stops working and a new one takes its place. */
  app.post("/api/host/stream-in/new-key", requireHostSession, async (req, res) => {
    if (!ready(res)) return;
    await schemaIsReady();
    const email = normEmail(getSessionEmail(req) ?? "");
    const row = await keyFor(email);
    if (!row) return res.status(404).json({ message: "You don't have a stream key yet." });
    try {
      const stopped = row.egressId ? await stopRecording(row) : row;
      if (stopped.ingressId) await deleteIngress(stopped.ingressId).catch(() => {});
      res.json({ configured: true, ...(await view(await issue(stopped, await showName(email)))) });
    } catch (err) {
      console.error("Couldn't renew a stream-in key:", (err as Error).message);
      res.status(502).json({ message: "Couldn't make a new key right now. Your old one is still working. Try again in a moment." });
    }
  });

  /** Turn it off: the key stops working. Recordings stay in the Library. */
  app.delete("/api/host/stream-in", requireHostSession, async (req, res) => {
    await schemaIsReady();
    const row = await keyFor(normEmail(getSessionEmail(req) ?? ""));
    if (row) {
      if (row.egressId) await stopRecording(row);
      if (row.ingressId) await deleteIngress(row.ingressId).catch(() => {});
      await db.delete(streamKeys).where(eq(streamKeys.id, row.id));
    }
    res.json({ ok: true });
  });
}
