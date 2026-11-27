/**
 * Which studio a stage runs in (Military Voices LIVE phase 1, Packet B, 26 Nov).
 *
 * The broadcast paths (the studio-channels cron, kickSegments, /api/host/ingress, the egress health check, the
 * scene-takes default) used to assume the featured event's studio. A LIVE production's stage names its own studio
 * (stages.studio_id, an event studio in `studios`), so two productions can run at once without touching each other.
 * No stage given → exactly today's behaviour: the featured event and its first studio (Radio, the Marathon).
 *
 * Track R, Packet R-C (26 Nov): the featured event is legacy. With events:explicit:<area> on, the cron, kickSegments
 * and the egress health check walk the MV events themselves (mvEventStudios), never the featured singleton, so
 * several productions run at once without sharing state. Off (the default), everything here behaves as before.
 */
import { asc, eq, gt } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { stages, type EventRow, type StudioRow } from "../shared/schema.js";
import { categoryOf, explicitOn, listMvEvents } from "./mvEvents.js";

export type StageStudio = { event: EventRow; studio: StudioRow; stageId: number | null };

/**
 * No stageId: the featured event's studio, as before. A stageId: that stage's studio and the studio's event, or null
 * when the stage doesn't exist or has no studio yet (callers answer 404; they never fall back to the featured studio,
 * which would put one production's feed into another's room).
 */
export async function studioForStage(stageId?: number | null): Promise<StageStudio | null> {
  const id = Number(stageId) || 0;
  if (id <= 0) {
    const event = await storage.getFeaturedEvent();
    return { event, studio: await storage.getOrCreateStudio(event.id), stageId: null };
  }
  await schemaIsReady();
  const [stage] = await db.select().from(stages).where(eq(stages.id, id)).limit(1);
  if (!stage?.studioId) return null;
  const studio = await storage.getStudioById(stage.studioId);
  if (!studio) return null;
  const event = await storage.getEventById(studio.eventId);
  return event ? { event, studio, stageId: id } : null;
}

/** Every studio a stage runs in, each once, oldest stage first. Empty until LIVE gives a stage a studio. */
export async function stageStudios(): Promise<StageStudio[]> {
  await schemaIsReady();
  const rows = await db.select().from(stages).where(gt(stages.studioId, 0)).orderBy(asc(stages.id));
  const out: StageStudio[] = [];
  for (const r of rows) {
    if (out.some((x) => x.studio.id === r.studioId)) continue;
    const studio = await storage.getStudioById(r.studioId);
    const event = studio ? await storage.getEventById(studio.eventId) : undefined;
    if (studio && event) out.push({ event, studio, stageId: r.id });
  }
  return out;
}

/**
 * The event whose line-up drives a studio's channels: the featured event for its own studios (as before), else the
 * studio's event when a stage runs in it. Null for any other studio, which keeps today's "featured only" rule.
 */
export async function eventForStudio(studio: StudioRow): Promise<EventRow | null> {
  if (await explicitOn("cron")) {
    // Explicit: the studio's own event, when it's an MV event Radio doesn't run itself (Radio has its own dx cron).
    const ev = await storage.getEventById(studio.eventId);
    return ev && categoryOf(ev) === "mv" && !(await isRadioEvent(ev)) ? ev : null;
  }
  const featured = await storage.getFeaturedEvent();
  if (featured.id === studio.eventId) return featured;
  return (await stageStudios()).find((s) => s.studio.id === studio.id)?.event ?? null;
}

async function radioEventIds(): Promise<Set<number>> {
  const entries = await listMvEvents();
  return new Set(entries.filter((e) => e.program === "radio").flatMap((e) => (e.days ?? []).map((d) => d.id).concat(e.id)));
}
async function isRadioEvent(ev: EventRow): Promise<boolean> {
  return ev.program === "radio" || (await radioEventIds()).has(ev.id);
}

/**
 * The explicit path (R-C): one studio per MV event, never the featured singleton. A LIVE stage's own studio wins for
 * its event; any other MV event gets its oldest studio (the one its rundown belongs to, as getOrCreateStudio picks).
 * - radio: false (the cron) leaves Radio's days out, because Radio's own dx:events cron runs them;
 * - liveOnly: only events on now (the health check), so a past event's stale egress id never shows red.
 * Member events and personal studios are never in it.
 */
export async function mvEventStudios(opts: { radio: boolean; liveOnly: boolean }): Promise<StageStudio[]> {
  const entries = await listMvEvents();
  const flat = entries.flatMap((e) => (e.days ? e.days.map((d) => ({ ...d, program: e.program })) : [{ id: e.id, status: e.status, studios: e.studios, program: e.program }]));
  const radio = new Set(entries.filter((e) => e.program === "radio").flatMap((e) => (e.days ?? []).map((d) => d.id).concat(e.id)));
  const out: StageStudio[] = [];
  for (const s of await stageStudios()) if (!out.some((x) => x.event.id === s.event.id) && categoryOf(s.event) === "mv") out.push(s);
  for (const e of flat) {
    if (out.some((x) => x.event.id === e.id) || !e.studios.length) continue;
    if (!opts.radio && (e.program === "radio" || radio.has(e.id))) continue;
    if (opts.liveOnly && e.status !== "live") continue;
    const studio = await storage.getStudioById(e.studios[0].id);
    const event = studio ? await storage.getEventById(e.id) : undefined;
    if (studio && event) out.push({ event, studio, stageId: null });
  }
  if (opts.liveOnly) return out.filter((s) => flat.find((e) => e.id === s.event.id)?.status === "live" || s.stageId !== null);
  return out;
}
