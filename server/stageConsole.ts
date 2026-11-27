/**
 * The Producer Console for a LIVE stage studio (Military Voices LIVE phase 2, Packet B, 27 Nov 2026).
 *
 * 1. syncStageScenes: the scene rail follows the approved run of show. Packet A writes the stage studio's event
 *    `run_of_show` rows on approval (sourceKey `live-session-<id>` and `live-script-<id>`) and then calls this, so
 *    the rail shows that version, in order, each script's media on its card. Nothing else on the rail is touched.
 * 2. stageTimeUp: at a session's zero the console asks "Are they done?". It never cuts on the clock.
 * 3. consoleText: the names the console puts on screen (the brand line under a name, Alex's card) come from the
 *    production, behind the `live:console` setting. Off, or any studio without a stage (Radio, the Marathon), keeps
 *    the Marathon's words.
 */
import { and, asc, eq } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { productionMembers, productions, stages, type RunItemRow, type SceneRow, type StudioRow } from "../shared/schema.js";
import { ALEX_NAME } from "../shared/live.js";

const LIVE_KEY = /^live-(session|script)-\d+$/;
export const isLiveRow = (r: Pick<RunItemRow, "sourceKey">): boolean => LIVE_KEY.test(r.sourceKey);

export type StageOf = { stageId: number; productionId: number };

const stageCache = new Map<number, { v: StageOf | null; at: number }>();
/** The stage a studio runs, or null (Radio, the Marathon, rooms, My Studio). Cached 30 s: the auto-tick asks every 5 s. */
export async function stageOfStudio(studioId: number): Promise<StageOf | null> {
  if (!studioId) return null;
  const c = stageCache.get(studioId);
  if (c && Date.now() - c.at < 30_000) return c.v;
  await schemaIsReady();
  const [s] = await db.select().from(stages).where(eq(stages.studioId, studioId)).orderBy(asc(stages.id)).limit(1);
  const v = s ? { stageId: s.id, productionId: s.productionId } : null;
  stageCache.set(studioId, { v, at: Date.now() });
  return v;
}

/* ── 1. The rail follows the approved run of show ── */

/**
 * One scene per live row of the studio event's run of show, in the rows' order: new rows get a scene, existing ones
 * take the row's title, media and start time, and scenes whose row has gone are removed. The scene on air is never
 * removed. Scenes not made from a live row (a countdown, a standby card someone added) stay where they are, after
 * the live ones. Returns what changed. Safe to call any number of times.
 */
type SceneFields = Pick<SceneRow, "name" | "kind" | "mediaUrl" | "mediaKind" | "mediaLabel" | "startAtUtc">;
/** The plan, before anything is written: each entry is an existing scene id or a row that needs a new scene. */
export type ScenePlan = {
  order: ({ sceneId: number } | { newFor: number })[];
  create: { runItemId: number; fields: SceneFields }[];
  update: { sceneId: number; fields: SceneFields }[];
  remove: number[];
};

function sceneFieldsFor(r: RunItemRow): SceneFields {
  return {
    name: r.title || "Session",
    kind: r.mediaUrl ? "media" : "camera",
    mediaUrl: r.mediaUrl || "",
    mediaKind: r.mediaKind || "video",
    mediaLabel: r.mediaLabel || "",
    startAtUtc: r.startAtUtc || "",
  };
}

/** Pure: what syncStageScenes will do with these rows and scenes. */
export function planStageScenes(eventRows: RunItemRow[], scenes: SceneRow[], currentSceneId: number): ScenePlan {
  const rows = eventRows.filter(isLiveRow);
  const rowIds = new Set(rows.map((r) => r.id));
  const runIds = new Set(eventRows.map((r) => r.id));
  // A scene follows the live rows when its row is a live row, or a row that's since gone; any other scene is the producer's own.
  const liveScenes = scenes.filter((s) => s.runItemId && (rowIds.has(s.runItemId) || !runIds.has(s.runItemId)));
  const others = scenes.filter((s) => !liveScenes.includes(s));
  const plan: ScenePlan = { order: [], create: [], update: [], remove: [] };
  for (const r of rows) {
    const fields = sceneFieldsFor(r);
    const have = liveScenes.find((s) => s.runItemId === r.id);
    if (!have) {
      plan.create.push({ runItemId: r.id, fields });
      plan.order.push({ newFor: r.id });
      continue;
    }
    plan.order.push({ sceneId: have.id });
    // The scene on air keeps what it has until it's off air; the next sync brings it up to date.
    const differs = (Object.keys(fields) as (keyof SceneFields)[]).some((k) => have[k] !== fields[k]);
    if (differs && have.id !== currentSceneId) plan.update.push({ sceneId: have.id, fields });
  }
  for (const s of liveScenes) {
    if (rowIds.has(s.runItemId)) continue;
    if (s.id === currentSceneId) plan.order.push({ sceneId: s.id });
    else plan.remove.push(s.id);
  }
  for (const s of others) plan.order.push({ sceneId: s.id });
  return plan;
}

export async function syncStageScenes(studioId: number): Promise<{ created: number; updated: number; removed: number; total: number }> {
  const studio = await storage.getStudioById(studioId);
  if (!studio) throw new Error(`No studio ${studioId}`);
  if (!(await stageOfStudio(studio.id))) throw new Error(`Studio ${studioId} runs no stage`);
  const eventRows = await storage.listRunOfShow(studio.eventId);
  const plan = planStageScenes(eventRows, await storage.listScenes(studio.id), studio.currentSceneId ?? 0);
  const made = new Map<number, number>();
  for (const c of plan.create) made.set(c.runItemId, (await storage.createScene({ studioId: studio.id, runItemId: c.runItemId, sortIndex: 0, ...c.fields })).id);
  for (const u of plan.update) await storage.updateScene(u.sceneId, u.fields);
  for (const id of plan.remove) await storage.deleteScene(id);
  await storage.reorderScenes(studio.id, plan.order.map((o) => ("sceneId" in o ? o.sceneId : made.get(o.newFor)!)));
  return { created: plan.create.length, updated: plan.update.length, removed: plan.remove.length, total: eventRows.filter(isLiveRow).length };
}

/* ── 2. Zero asks; it never cuts ── */

/**
 * When the scene on air reaches zero: its live row's start plus its minutes, else the next scene's start. Before
 * zero, or with no times to go on, null. At or past zero, what the console asks.
 */
export async function stageTimeUp(studio: StudioRow, cur: SceneRow, next: SceneRow | undefined, now = Date.now()): Promise<{ why: string; at: string } | null> {
  const row = cur.runItemId ? await storage.getRunItem(cur.runItemId) : undefined;
  return timeUp(studio, cur, row, next, now);
}

/** Pure: the decision itself. A clip still playing ends by itself (its scene's own switch), so it never asks. */
export function timeUp(
  studio: Pick<StudioRow, "doneSceneId" | "stageMediaPlaying">,
  cur: Pick<SceneRow, "id" | "name" | "startAtUtc" | "mediaUrl">,
  row: Pick<RunItemRow, "title" | "startAtUtc" | "durationMinutes"> | undefined,
  next: Pick<SceneRow, "startAtUtc"> | undefined,
  now: number,
): { why: string; at: string } | null {
  if (studio.doneSceneId === cur.id) return null;
  if (cur.mediaUrl && studio.stageMediaPlaying) return null;
  const start = Date.parse(row?.startAtUtc || cur.startAtUtc || "");
  let end = Number.isFinite(start) && (row?.durationMinutes ?? 0) > 0 ? start + row!.durationMinutes * 60_000 : NaN;
  if (!Number.isFinite(end) && next?.startAtUtc) end = Date.parse(next.startAtUtc);
  if (!Number.isFinite(end) || now < end) return null;
  const title = (row?.title || cur.name || "This session").trim();
  return { why: `${title} is at time. Are they done?`, at: new Date(end).toISOString() };
}

/* ── 3. The words on screen ── */

const MARATHON_TEXT = { brand: "The Podcast Marathon", aiName: "Alex", aiPhoto: "/alex.jpg" } as const;
export type ConsoleText = { brand: string; aiName: string; aiPhoto: string };

let switchAt = 0;
let switchOn = false;
/** `live:console` = "on": stage studios take their words from the production. Cached 30 s per server. */
export async function liveConsoleOn(): Promise<boolean> {
  if (Date.now() - switchAt < 30_000) return switchOn;
  switchOn = (await storage.getSetting("live:console").catch(() => null)) === "on";
  switchAt = Date.now();
  return switchOn;
}

/** The brand line and Alex's card for a studio's console. Marathon words unless it's a stage studio and the switch is on. */
export async function consoleText(studioId: number): Promise<ConsoleText> {
  const stage = await stageOfStudio(studioId).catch(() => null);
  if (!stage || !(await liveConsoleOn())) return { ...MARATHON_TEXT };
  const [p] = await db.select().from(productions).where(eq(productions.id, stage.productionId)).limit(1);
  const [alex] = await db
    .select()
    .from(productionMembers)
    .where(and(eq(productionMembers.productionId, stage.productionId), eq(productionMembers.role, "alex")))
    .limit(1);
  return {
    brand: p?.name?.trim() || "Military Voices LIVE",
    aiName: (alex && alex.status !== "removed" && alex.name.trim()) || ALEX_NAME,
    aiPhoto: MARATHON_TEXT.aiPhoto,
  };
}
