import crypto from "node:crypto";
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { beat } from "./health.js";
import { slackNote } from "./slack.js";
import { capSeconds, keyHash, ownBoxAlive, ownUrl, showName, usedSeconds } from "./streamIn.js";
import { streamKeys, streamSessions, type StreamKeyRow } from "../shared/schema.js";

/**
 * Engine #2 for Stream in: our own ingest box (MediaMTX plus a small agent,
 * see ingest/). The box takes the RTMP stream, records it without
 * re-encoding, uploads the finished MP4 to our storage and tells us here. The
 * podcaster's page, key, monthly hours and the Library recording are the same
 * as with LiveKit; only the media path differs.
 *
 * The box is the only caller, with INGEST_TOKEN as a bearer. Without that
 * variable set every route here answers 503, so nothing is exposed.
 */

const token = () => (process.env.INGEST_TOKEN ?? "").trim();
const now = () => new Date().toISOString();

export const bearer: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const want = token();
  if (!want) return void res.status(503).json({ message: "Ingest isn't switched on." });
  const got = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return void res.status(401).json({ message: "Not authorised." });
  next();
};

async function keyRow(raw: unknown): Promise<StreamKeyRow | undefined> {
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(key)) return undefined;
  const [row] = await db.select().from(streamKeys).where(and(eq(streamKeys.keyHash, keyHash(key)), eq(streamKeys.engine, "own"))).limit(1);
  return row;
}

/** Whether this key may stream now; when its hours are used up it pauses, with words for the podcaster. */
async function mayStream(c: StreamKeyRow): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (c.status === "paused") return { ok: false, reason: "paused" };
  const cap = await capSeconds(c.ownerEmail);
  if ((await usedSeconds(c.ownerEmail)) >= cap) {
    await db.update(streamKeys).set({ status: "paused", pausedWhy: `You've used this month's ${Math.round(cap / 3600)} streaming hours. They come back on the 1st.` }).where(eq(streamKeys.id, c.id));
    return { ok: false, reason: "hours used" };
  }
  return { ok: true };
}

export function registerIngest(app: Express, requireAdmin: RequestHandler): void {
  /** The box asks before it lets anyone publish. */
  app.post("/api/ingest/authorize", bearer, async (req, res) => {
    await schemaIsReady();
    const c = await keyRow(req.body?.key);
    if (!c) return res.status(403).json({ ok: false, reason: "unknown key" });
    const r = await mayStream(c);
    res.status(r.ok ? 200 : 403).json(r);
  });

  /** A stream is live on the box: start the session (once; a reconnect finds it already open). */
  app.post("/api/ingest/started", bearer, async (req, res) => {
    await schemaIsReady();
    const c = await keyRow(req.body?.key);
    if (!c) return res.status(404).json({ message: "Unknown key." });
    const [claimed] = await db.update(streamKeys).set({ egressId: "own", status: "live", liveSince: now(), lostAt: "", problem: "" }).where(and(eq(streamKeys.id, c.id), eq(streamKeys.egressId, ""))).returning();
    if (claimed) {
      const [s] = await db.insert(streamSessions).values({ keyId: c.id, ownerEmail: c.ownerEmail, egressId: "own", startedAt: now() }).returning();
      return res.status(201).json({ sessionId: s.id, startedAt: s.startedAt });
    }
    const [open] = await db.select().from(streamSessions).where(and(eq(streamSessions.keyId, c.id), eq(streamSessions.endedAt, ""))).limit(1);
    res.json({ sessionId: open?.id ?? 0, startedAt: open?.startedAt ?? now() });
  });

  /**
   * The box has the finished file in our storage (or could not save it).
   * Idempotent: the box retries until it hears ok.
   */
  app.post("/api/ingest/finish", bearer, async (req, res) => {
    await schemaIsReady();
    const c = await keyRow(req.body?.key);
    const sessionId = Number(req.body?.sessionId);
    if (!c || !sessionId) return res.status(404).json({ message: "Unknown key or session." });
    const [s] = await db.select().from(streamSessions).where(and(eq(streamSessions.id, sessionId), eq(streamSessions.keyId, c.id))).limit(1);
    if (!s) return res.status(404).json({ message: "Unknown session." });
    if (s.endedAt && (s.recordingId || req.body?.failed)) return res.json({ ok: true, recordingId: s.recordingId }); // already done

    const durationSec = Math.max(0, Math.round(Number(req.body?.durationSec) || Math.round((Date.now() - Date.parse(s.startedAt)) / 1000)));
    const release = () => db.update(streamKeys).set({ egressId: "", liveSince: "", lostAt: "", status: c.status === "paused" ? "paused" : "idle" }).where(eq(streamKeys.id, c.id));

    if (req.body?.failed) {
      await db.update(streamSessions).set({ endedAt: now(), seconds: durationSec }).where(eq(streamSessions.id, s.id));
      await release();
      await db.update(streamKeys).set({ problem: "We couldn't save your last stream. We've been told, and we'll look into it." }).where(eq(streamKeys.id, c.id));
      void slackNote(`Ingest box: couldn't save a stream (${String(req.body?.reason ?? "no reason").slice(0, 200)}). Session ${s.id}.`).catch(() => {});
      return res.json({ ok: true });
    }

    const objectKey = String(req.body?.objectKey ?? "");
    if (!/^streams\/[A-Za-z0-9._/-]{3,200}\.mp4$/.test(objectKey)) return res.status(400).json({ message: "Bad object key." });
    const sizeBytes = String(Math.max(0, Math.round(Number(req.body?.sizeBytes) || 0)));
    const egressId = `OWN_${s.id}`;
    const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date(s.startedAt));
    const title = `${(await showName(c.ownerEmail)) || "Live stream"} · ${when}`;
    // A Library recording like any other; the event and studio are only bookkeeping.
    const event = await storage.getFeaturedEvent();
    const studio = await storage.getOrCreateStudio(event.id);
    const rec = await storage.createRecording({ eventId: event.id, studioId: studio.id, signupId: null, email: c.ownerEmail, title, egressId, filepath: objectKey });
    await storage.finishRecording(egressId, { status: "Ready", url: objectKey, durationSec, sizeBytes, error: "" });
    // A finished recording is a clip job, picked up by the worker (as with every other recording).
    if ((process.env.AGENT_TOKEN ?? "").trim()) await storage.setClipStatus(rec.id, "queued", "");
    await db.update(streamSessions).set({ recordingId: rec.id, endedAt: now(), seconds: durationSec }).where(eq(streamSessions.id, s.id));
    await release();
    res.json({ ok: true, recordingId: rec.id });
  });

  /**
   * Every 30 seconds the box says it is alive and which keys are publishing;
   * we answer with the keys it must drop (retired, paused, or out of hours).
   * This is also what the System health light watches.
   */
  app.post("/api/ingest/heartbeat", bearer, async (req, res) => {
    await schemaIsReady();
    await storage.setSetting("ingest:box", JSON.stringify({ at: now(), version: String(req.body?.version ?? "").slice(0, 40), diskFreeGb: Number(req.body?.diskFreeGb) || 0, backlog: Number(req.body?.backlog) || 0 }));
    await beat("ingest");
    const live: unknown[] = Array.isArray(req.body?.live) ? req.body.live.slice(0, 200) : [];
    const kick: string[] = [];
    for (const raw of live) {
      const c = await keyRow(raw);
      if (!c || !(await mayStream(c)).ok) kick.push(String(raw));
    }
    res.json({ kick });
  });

  // ---- Admin: which engine new keys use, and whether the box is answering ------
  app.get("/api/admin/stream-in", requireAdmin, async (_req, res) => {
    res.set("Cache-Control", "no-store");
    await schemaIsReady();
    const keys = await db.select().from(streamKeys);
    let box: unknown = null;
    try { box = JSON.parse((await storage.getSetting("ingest:box")) ?? "null"); } catch { box = null; }
    res.json({
      engine: (await storage.getSetting("streamin:engine")) === "own" ? "own" : "livekit",
      configured: !!token(),
      boxAlive: await ownBoxAlive(),
      box,
      url: await ownUrl(),
      keys: keys.length,
      ownKeys: keys.filter((k) => k.engine === "own").length,
      liveNow: keys.filter((k) => k.status === "live").length,
      // Who holds a key, masked to the first letter and the domain (admin only), so an unexpected key can be placed.
      owners: keys.map((k) => ({ who: String(k.ownerEmail ?? "").replace(/^(.).*@/, "$1***@"), engine: k.engine, status: k.status, since: k.createdAt })),
    });
  });

  /** "own" only takes effect while the box is answering; otherwise new keys still go to LiveKit. */
  app.post("/api/admin/stream-in/engine", requireAdmin, async (req, res) => {
    const engine = req.body?.engine === "own" ? "own" : "livekit";
    if (engine === "own" && !token()) return res.status(409).json({ message: "INGEST_TOKEN isn't set yet, so the box can't connect." });
    await storage.setSetting("streamin:engine", engine);
    res.json({ engine });
  });
}
