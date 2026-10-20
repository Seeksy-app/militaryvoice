// The Digital Experience runs itself: every minute this starts each day's
// broadcast a few minutes before 7 am ET, records it, renews the stream before
// LiveKit's 12-hour cap, and stops it after 10 pm. What goes out is the
// program page (/dx/program), which follows the clock. No producer needed.
//
// Where it streams: the day's own house destinations (Admin → Studio on that
// event), plus those of the event named in site_settings
// "dx:destinations-event", so LiveOne and YouTube can be set once for the week.
// State per day is in site_settings "dx:air:<eventId>": {started, egressAt, done}.
import type { Express } from "express";
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
        did.push(`${ev.name}: on air (${targets.map((t) => t.label).join(", ") || "no destinations, recording only"})`);
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
      if (air.started && !air.done && now > end + 60_000) {
        if (studio.broadcastEgressId) await stopEgressById(studio.broadcastEgressId).catch(() => {});
        if (studio.recordingEgressId) await stopEgressById(studio.recordingEgressId).catch(() => {});
        const retiring = await storage.getSetting(`retire_egress:${studio.id}`);
        if (retiring) { await stopEgressById(retiring).catch(() => {}); await storage.setSetting(`retire_egress:${studio.id}`, ""); }
        await storage.updateStudio(studio.id, { broadcastEgressId: "", recordingEgressId: "", status: "Offline" });
        await writeAir(id, { ...air, done: new Date().toISOString() });
        did.push(`${ev.name}: off air`);
      }
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      console.error(`[dx] ${ev.name}:`, msg);
      await writeAir(id, { ...air, error: `${new Date().toISOString()} ${msg}`.slice(0, 300) });
      did.push(`${ev.name}: error ${msg}`);
    }
  }
  return did;
}

export function registerDxBroadcast(app: Express, origin: string): void {
  app.get("/api/cron/dx-broadcast", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") !== secret) return res.status(401).json({ message: "Not authorised." });
    res.json({ did: await runDxBroadcast(origin) });
  });
}
