// The Live From Anywhere runs itself: every minute this starts each day's
// broadcast a few minutes before 7 am ET, records it, renews the stream before
// LiveKit's 12-hour cap, and stops it after 10 pm. What goes out is the
// program page (/dx/program), which follows the clock. No producer needed.
//
// Where it streams: the day's own house destinations (Admin → Studio on that
// event), plus those of the event named in site_settings
// "dx:destinations-event", so LiveOne and YouTube can be set once for the week.
// State per day is in site_settings "dx:air:<eventId>": {started, egressAt, done}.
import type { Express, RequestHandler } from "express";
import { storage } from "./storage.js";
import { isLiveKitConfigured, isRecordingConfigured, roomName, rooms, startBroadcast, startSegmentRecording, stopEgressById, updateBroadcastTargets, egressIsActive, type BroadcastTarget } from "./livekit.js";
import { ensureRecordingsBucket } from "./recordingStorage.js";
import { dxEventIds } from "./digitalExperience.js";

const LEAD_MS = 3 * 60_000;
/** Before LiveKit's 12-hour stream cap: at 11 hours (6 pm on a 7 am start, a slot boundary, so the change lands on an intro card). */
const RENEW_MS = 11 * 3600_000;

type Air = { started?: string; egressAt?: string; done?: string; error?: string };
const readAir = async (id: number): Promise<Air> => { try { return JSON.parse((await storage.getSetting(`dx:air:${id}`)) ?? "{}") as Air; } catch { return {}; } };
const writeAir = (id: number, a: Air) => storage.setSetting(`dx:air:${id}`, JSON.stringify(a));

export function programUrl(origin: string): string {
  return `${origin}/dx/program`;
}

async function houseTargets(eventId: number): Promise<BroadcastTarget[]> {
  const from = Number(await storage.getSetting("dx:destinations-event")) || 0;
  const ids = Array.from(new Set([eventId, from].filter(Boolean)));
  const out: BroadcastTarget[] = [];
  for (const id of ids) {
    for (const d of await storage.listDestinations(id)) {
      if (!d.enabled || d.signupId || !d.rtmpUrl || !d.streamKey) continue;
      const url = `${d.rtmpUrl.replace(/\/+$/, "")}/${d.streamKey}`;
      if (!out.some((t) => t.url === url)) out.push({ url, label: d.label || d.platform });
    }
  }
  return out;
}

/** Put a day on air now: the room, the stream to its destinations, the recording. */
export async function startDay(id: number, origin: string): Promise<string> {
  const ev = await storage.getEventById(id);
  if (!ev) throw new Error("No such day.");
  const studio = await storage.getOrCreateStudio(id);
  const room = roomName(studio.id);
  // The room has to outlive the gaps when no one's in it, or the stream ends with it.
  await rooms().createRoom({ name: room, emptyTimeout: 20 * 3600, departureTimeout: 20 * 3600 }).catch(() => {});
  const targets = await houseTargets(id);
  let broadcastEgressId = "";
  if (targets.length) broadcastEgressId = await startBroadcast(room, targets, programUrl(origin));
  let recordingEgressId = "";
  if (isRecordingConfigured()) {
    await ensureRecordingsBucket();
    const filepath = `event-${id}/dx-${new Date().toISOString().replace(/[:.]/g, "-")}.mp4`;
    recordingEgressId = await startSegmentRecording(room, filepath, programUrl(origin));
    await storage.createRecording({ eventId: id, studioId: studio.id, signupId: null, email: "", title: ev.name, egressId: recordingEgressId, filepath });
  }
  await storage.updateStudio(studio.id, { broadcastEgressId, recordingEgressId, status: "Live" });
  await writeAir(id, { started: new Date().toISOString(), egressAt: broadcastEgressId ? new Date().toISOString() : "" });
  return `${ev.name}: on air (${targets.map((t) => t.label).join(", ") || "no destinations, recording only"})`;
}

/** Take a day off air: the stream and the recording stop. */
export async function stopDay(id: number): Promise<string> {
  const ev = await storage.getEventById(id);
  const studio = await storage.getOrCreateStudio(id);
  if (studio.broadcastEgressId) await stopEgressById(studio.broadcastEgressId).catch(() => {});
  if (studio.recordingEgressId) await stopEgressById(studio.recordingEgressId).catch(() => {});
  const retiring = await storage.getSetting(`retire_egress:${studio.id}`);
  if (retiring) { await stopEgressById(retiring).catch(() => {}); await storage.setSetting(`retire_egress:${studio.id}`, ""); }
  await storage.updateStudio(studio.id, { broadcastEgressId: "", recordingEgressId: "", status: "Offline" });
  // Stopped before the day itself (a rehearsal): forget it, so the day still starts on its own.
  if (ev && Date.now() < Date.parse(ev.startAtUtc) - LEAD_MS) await writeAir(id, {});
  else { const air = await readAir(id); await writeAir(id, { ...air, started: air.started || new Date().toISOString(), done: new Date().toISOString() }); }
  return `${ev?.name ?? id}: off air`;
}

export { readAir };

/** One pass over the week. Returns what it did, for the cron's log. */
export async function runDxBroadcast(origin: string): Promise<string[]> {
  const did: string[] = [];
  if (!isLiveKitConfigured()) return did;
  const now = Date.now();
  for (const id of await dxEventIds()) {
    const ev = await storage.getEventById(id);
    if (!ev) continue;
    const start = Date.parse(ev.startAtUtc);
    const end = start + ev.durationHours * 3600_000;
    if (now < start - LEAD_MS || now > end + 30 * 60_000) continue;
    const air = await readAir(id);
    const studio = await storage.getOrCreateStudio(id);
    const room = roomName(studio.id);
    try {
      // Start: once, a few minutes ahead, so the first intro is already on air at 7.
      if (!air.started && now < end) {
        did.push(await startDay(id, origin));
        continue;
      }
      // Renew the stream before the cap: a new egress takes the outputs over.
      if (air.started && !air.done && studio.broadcastEgressId && air.egressAt && now - Date.parse(air.egressAt) > RENEW_MS && now < end) {
        const old = studio.broadcastEgressId;
        const targets = await houseTargets(id);
        await updateBroadcastTargets(old, [], targets.map((t) => t.url)).catch(() => {});
        const neu = await startBroadcast(room, targets, programUrl(origin));
        for (let i = 0; i < 30 && !(await egressIsActive(neu).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 1000));
        await stopEgressById(old).catch(() => {});
        await storage.updateStudio(studio.id, { broadcastEgressId: neu });
        await writeAir(id, { ...air, egressAt: new Date().toISOString() });
        did.push(`${ev.name}: stream renewed`);
        continue;
      }
      // Stop: a minute after 10 pm, once the last outro has played.
      if (air.started && !air.done && now > end + 60_000) did.push(await stopDay(id));
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      console.error(`[dx] ${ev.name}:`, msg);
      await writeAir(id, { ...air, error: `${new Date().toISOString()} ${msg}`.slice(0, 300) });
      did.push(`${ev.name}: error ${msg}`);
    }
  }
  return did;
}

export function registerDxBroadcast(app: Express, origin: string, requireAdmin?: RequestHandler): void {
  if (requireAdmin) {
    /** The day at a glance for Admin → Studio: on air or not, where it streams, the lineup and who's in their booth. */
    app.get("/api/admin/dx/:eventId", requireAdmin, async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const id = Number(req.params.eventId);
      if (!(await dxEventIds()).includes(id)) return res.status(404).json({ message: "Not a Live From Anywhere day." });
      const ev = (await storage.getEventById(id))!;
      const studio = await storage.getOrCreateStudio(id);
      const room = roomName(studio.id);
      const inRoom = new Map<string, number>();
      try {
        for (const p of await rooms().listParticipants(room)) {
          const sid = p.attributes?.signupId;
          if (sid) inRoom.set(sid, (inRoom.get(sid) ?? 0) + 1);
        }
      } catch { /* no room yet */ }
      const start = Date.parse(ev.startAtUtc), slot = ev.slotMinutes * 60_000;
      const list = (await storage.listSignups(id)).filter((s) => s.status !== "cancelled").sort((a, b) => a.slotIndex - b.slotIndex);
      res.json({
        eventId: id,
        name: ev.name,
        startAtUtc: ev.startAtUtc,
        endAtUtc: new Date(start + ev.durationHours * 3600_000).toISOString(),
        onAir: studio.status === "Live",
        air: await readAir(id),
        destinationsEventId: Number(await storage.getSetting("dx:destinations-event")) || id,
        streams: (await houseTargets(id)).map((t) => t.label),
        bookings: list.map((s) => ({ id: s.id, show: s.podcastName, host: s.hostName, email: s.email, photo: s.photoUrl, startAtUtc: new Date(start + s.slotIndex * slot).toISOString(), endAtUtc: new Date(start + (s.slotIndex + (s.slotSpan || 1)) * slot).toISOString(), inBooth: inRoom.get(String(s.id)) ?? 0 })),
      });
    });
    /** Put the day on air now, or take it off: for a rehearsal, or if something needs a restart. */
    app.post("/api/admin/dx/:eventId/air", requireAdmin, async (req, res) => {
      const id = Number(req.params.eventId);
      if (!(await dxEventIds()).includes(id)) return res.status(404).json({ message: "Not a Live From Anywhere day." });
      if (!isLiveKitConfigured()) return res.status(503).json({ message: "The studio isn't switched on." });
      try {
        const studio = await storage.getOrCreateStudio(id);
        if (req.body?.action === "stop") return res.json({ did: await stopDay(id) });
        if (studio.status === "Live") return res.status(409).json({ message: "Already on air." });
        res.json({ did: await startDay(id, origin) });
      } catch (err) {
        res.status(502).json({ message: (err as Error).message || "Couldn't do that." });
      }
    });
  }
  app.get("/api/cron/dx-broadcast", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") !== secret) return res.status(401).json({ message: "Not authorised." });
    res.json({ did: await runDxBroadcast(origin) });
  });
}
