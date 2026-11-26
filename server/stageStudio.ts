/**
 * Which studio a stage runs in (Military Voices LIVE phase 1, Packet B, 26 Nov).
 *
 * The broadcast paths (the studio-channels cron, kickSegments, /api/host/ingress, the egress health check, the
 * scene-takes default) used to assume the featured event's studio. A LIVE production's stage names its own studio
 * (stages.studio_id, an event studio in `studios`), so two productions can run at once without touching each other.
 * No stage given → exactly today's behaviour: the featured event and its first studio (Radio, the Marathon).
 */
import { asc, eq, gt } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { stages, type EventRow, type StudioRow } from "../shared/schema.js";

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
  const featured = await storage.getFeaturedEvent();
  if (featured.id === studio.eventId) return featured;
  return (await stageStudios()).find((s) => s.studio.id === studio.id)?.event ?? null;
}
