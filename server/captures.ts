import type { Express, Request, RequestHandler } from "express";
import { eq, desc } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { createRtmpIngress, deleteIngress, listIngressForRoom, isLiveKitConfigured, isRecordingConfigured, startRoomRecording, stopEgressById } from "./livekit.js";
import { ensureRecordingsBucket } from "./recordingStorage.js";
import { captures, type CaptureRow } from "../shared/schema.js";

/**
 * Record an outside show. Riccoh is a guest on someone's Riverside show: we
 * give that show's host an RTMP address and key (Riverside → Live stream →
 * Custom RTMP). The stream comes into a LiveKit room of its own, away from the
 * event studio; when it arrives we start recording, when it stops we stop, and
 * the finished file lands in the owner's Library like any studio recording
 * (the egress_ended webhook finishes it and queues its clips).
 */

const now = () => new Date().toISOString();

async function startRecording(c: CaptureRow): Promise<CaptureRow> {
  if (c.egressId) return c;
  await ensureRecordingsBucket();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filepath = `captures/${c.id}-${stamp}.mp4`;
  const egressId = await startRoomRecording(c.room, filepath);
  // A Library recording like any other; the event and studio are only bookkeeping.
  const event = await storage.getFeaturedEvent();
  const studio = await storage.getOrCreateStudio(event.id);
  const rec = await storage.createRecording({ eventId: event.id, studioId: studio.id, signupId: null, email: c.ownerEmail.toLowerCase().trim(), title: c.title, egressId, filepath });
  const [out] = await db.update(captures).set({ egressId, recordingId: rec.id, status: "recording" }).where(eq(captures.id, c.id)).returning();
  return out;
}

async function stopRecording(c: CaptureRow): Promise<CaptureRow> {
  if (c.egressId) await stopEgressById(c.egressId).catch(() => {});
  const [out] = await db.update(captures).set({ egressId: "", status: c.recordingId ? "done" : "waiting" }).where(eq(captures.id, c.id)).returning();
  return out;
}

/** From the LiveKit webhook: the outside stream started (record it) or ended (stop). */
export async function onCaptureWebhook(event: { event?: string; ingressInfo?: { roomName?: string } }): Promise<void> {
  const room = event.ingressInfo?.roomName ?? "";
  if (!room.startsWith("capture-") || (event.event !== "ingress_started" && event.event !== "ingress_ended")) return;
  await schemaIsReady();
  const [c] = await db.select().from(captures).where(eq(captures.room, room)).limit(1);
  if (!c) return;
  if (event.event === "ingress_started") await startRecording(c);
  else await stopRecording(c);
}

export function registerCaptures(app: Express, requireAdmin: RequestHandler, adminEmail: (req: Request) => string) {
  const view = (c: CaptureRow, live = "") => ({ id: c.id, title: c.title, ownerEmail: c.ownerEmail, url: c.url, streamKey: c.streamKey, status: c.status, recordingId: c.recordingId, createdAt: c.createdAt, live });

  app.get("/api/admin/captures", requireAdmin, async (_req, res) => {
    await schemaIsReady();
    const rows = await db.select().from(captures).orderBy(desc(captures.id)).limit(30);
    // Whether a stream is arriving right now, straight from LiveKit.
    const out = await Promise.all(rows.map(async (c) => {
      let live = "";
      if (isLiveKitConfigured() && c.ingressId && c.status !== "done") {
        try { const [i] = await listIngressForRoom(c.room); live = i?.state?.status !== undefined ? String(i.state.status) : ""; } catch { live = ""; }
      }
      return view(c, live);
    }));
    res.json({ captures: out, ready: isRecordingConfigured() });
  });

  app.post("/api/admin/captures", requireAdmin, async (req, res) => {
    if (!isLiveKitConfigured() || !isRecordingConfigured()) return res.status(503).json({ message: "The studio or its recording storage isn't switched on." });
    await schemaIsReady();
    const title = String(req.body?.title ?? "").trim().slice(0, 160);
    const ownerEmail = String(req.body?.ownerEmail ?? "").trim().toLowerCase().slice(0, 200);
    if (!title) return res.status(400).json({ message: "Name the show first." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) return res.status(400).json({ message: "Whose Library should it go to? Add their email." });
    const [row] = await db.insert(captures).values({ title, ownerEmail, createdBy: adminEmail(req), createdAt: now() }).returning();
    const room = `capture-${row.id}`;
    try {
      const cred = await createRtmpIngress({ room, identity: `feed-${row.id}`, name: title });
      const [out] = await db.update(captures).set({ room, ingressId: cred.ingressId, url: cred.url, streamKey: cred.streamKey }).where(eq(captures.id, row.id)).returning();
      res.status(201).json({ capture: view(out) });
    } catch (err) {
      await db.delete(captures).where(eq(captures.id, row.id));
      console.error("Couldn't make a capture key:", (err as Error).message);
      res.status(502).json({ message: "Couldn't make a stream key right now. Try again in a moment." });
    }
  });

  // By hand, if the automatic start or stop didn't happen.
  app.post("/api/admin/captures/:id/record", requireAdmin, async (req, res) => {
    const [c] = await db.select().from(captures).where(eq(captures.id, Number(req.params.id))).limit(1);
    if (!c) return res.status(404).json({ message: "No such capture." });
    try {
      const out = req.body?.action === "stop" ? await stopRecording(c) : await startRecording(c);
      res.json({ capture: view(out) });
    } catch (err) {
      res.status(502).json({ message: (err as Error).message || "Couldn't do that." });
    }
  });

  // Done with the key: it stops working (the recording stays in the Library).
  app.delete("/api/admin/captures/:id", requireAdmin, async (req, res) => {
    const [c] = await db.select().from(captures).where(eq(captures.id, Number(req.params.id))).limit(1);
    if (!c) return res.json({ ok: true });
    if (c.egressId) await stopEgressById(c.egressId).catch(() => {});
    if (c.ingressId) await deleteIngress(c.ingressId).catch(() => {});
    await db.delete(captures).where(eq(captures.id, c.id));
    res.json({ ok: true });
  });
}
