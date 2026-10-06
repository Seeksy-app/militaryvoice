// The scene-take log: every scene that went on air, when, and what moved it
// on (6 Oct AAR — the Marathon had no record, so the on-demand chapters were
// rebuilt overnight by matching audio). It also fills the run of show's
// actual times as the show runs, which the magazine cuts and the AAR read.
import type { Express, RequestHandler } from "express";
import { asc, desc, eq } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { sceneTakes } from "../shared/schema.js";

export async function logSceneTake(sceneId: number, how: string): Promise<void> {
  await schemaIsReady();
  const scene = await storage.getScene(sceneId);
  const studio = scene ? await storage.getStudioById(scene.studioId) : null;
  if (!scene || !studio) return;
  const at = new Date().toISOString();
  const row = scene.runItemId ? await storage.getRunItem(scene.runItemId) : undefined;
  // Whatever was on air before this: a segment gets its minutes.
  const [prev] = await db.select().from(sceneTakes).where(eq(sceneTakes.studioId, studio.id)).orderBy(desc(sceneTakes.id)).limit(1);
  if (prev?.runItemId && prev.kind === "Segment" && prev.runItemId !== scene.runItemId) {
    const pr = await storage.getRunItem(prev.runItemId);
    if (pr && pr.actualStartAtUtc && !pr.actualMinutes) {
      await storage.updateRunItem(pr.id, { actualMinutes: Math.max(1, Math.round((Date.parse(at) - Date.parse(pr.actualStartAtUtc)) / 60_000)) });
    }
  }
  await db.insert(sceneTakes).values({ studioId: studio.id, eventId: studio.eventId, sceneId, sceneName: scene.name, runItemId: scene.runItemId, kind: row?.kind ?? "", how, takenAt: at });
  // A segment's first time on air is its actual start.
  if (row?.kind === "Segment" && !row.actualStartAtUtc) await storage.updateRunItem(row.id, { actualStartAtUtc: at });
}

export function registerSceneLog(app: Express, requireAdmin: RequestHandler) {
  /**
   * The log for an event, oldest first. `?format=chapters` gives YouTube-style
   * chapter lines measured from `from` (an ISO time: when the recording or
   * stream started; default the first take).
   */
  app.get("/api/admin/scene-takes", requireAdmin, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await schemaIsReady();
    const eventId = Number(req.query.eventId) || (await storage.getFeaturedEvent()).id;
    const rows = await db.select().from(sceneTakes).where(eq(sceneTakes.eventId, eventId)).orderBy(asc(sceneTakes.id));
    if (req.query.format !== "chapters") return res.json(rows);
    const from = Date.parse(String(req.query.from ?? "")) || (rows[0] ? Date.parse(rows[0].takenAt) : Date.now());
    const hms = (s: number) => {
      const t = Math.max(0, Math.round(s));
      const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
      return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    };
    // A chapter per show: the segment, named by the scene (one line each, in order).
    const lines = rows
      .filter((r) => r.kind === "Segment" || r.kind === "" || /ceremon/i.test(r.sceneName))
      .filter((r, i, all) => i === 0 || all[i - 1].sceneId !== r.sceneId)
      .map((r) => `${hms((Date.parse(r.takenAt) - from) / 1000)}  ${r.sceneName}`);
    res.type("text/plain").send(lines.join("\n"));
  });
}
