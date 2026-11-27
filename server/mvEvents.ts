// Track R, Packet R-A (26 Nov 2026): retire the featured-event default. Andrew: the Marathon "is not the template for
// Military Voices. It's just one thing that we do." The Marathon, Radio and each LIVE production are MV events of
// their own. This module is step 1, and nothing changes yet:
//  - events.category (mv | member | personal) and events.program (marathon | radio | live | ""), filled in here;
//  - eventFor(req, area): the event a request names; with no name and its area switch off, today's featured event,
//    counted per area so we can see which paths still lean on the default;
//  - GET /api/admin/mv-events, the list behind UI/UX's MV events picker.
// The packet calls the first column "kind", but events.kind already belongs to members' own events ("me" | "lineup"),
// so it is "category" here.
import type { Express, Request, RequestHandler } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schemaIsReady, storage } from "./storage.js";
import { eventFallbacks, events, stages, studios, type EventRow } from "../shared/schema.js";
import { isRadioTest } from "../shared/radio.js";

export const EVENT_AREAS = [
  // Podcasting (R-A)
  "run-of-show", "sponsors", "signups", "emails", "destinations", "studios", "social", "finance", "host", "public", "chat",
  "discovery", "inbox", "survey", "sms", "alex", "magazine", "analytics", "captures",
  // Engineering (R-C)
  "cron", "health", "ingress", "scenes",
] as const;
export type EventArea = (typeof EVENT_AREAS)[number];
export type EventCategory = "mv" | "member" | "personal";
export type EventProgram = "marathon" | "radio" | "live" | "";

const now = () => new Date().toISOString();
const PERSONAL = "Personal studio";

/** What kind of event this is: the stored value, or worked out the same way the backfill does for one made since. */
export function categoryOf(e: Pick<EventRow, "category" | "occasion" | "ownerEmail">): EventCategory {
  if (e.category === "mv" || e.category === "member" || e.category === "personal") return e.category;
  if (e.occasion === PERSONAL) return "personal";
  return e.ownerEmail.trim() ? "member" : "mv";
}

async function radioIds(): Promise<number[]> {
  try { return (JSON.parse((await storage.getSetting("dx:events")) ?? "[]") as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0); } catch { return []; }
}

/**
 * Fill category and program where they're still blank. Idempotent, and it only ever writes blanks, so a value set by
 * hand or by code is never overwritten. Program: the featured event is the Marathon (only while no event is marked
 * marathon yet, so moving the featured flag later doesn't make a second one), the dx:events days are Radio, and the
 * event of any LIVE stage's studio is LIVE. Runs once per server, before the first eventFor or MV events answer.
 */
let filled: Promise<void> | null = null;
export function fillEventColumns(): Promise<void> {
  if (!filled) filled = (async () => {
    await schemaIsReady();
    await db.execute(sql`UPDATE events SET category = CASE WHEN occasion = ${PERSONAL} THEN 'personal' WHEN btrim(owner_email) <> '' THEN 'member' ELSE 'mv' END WHERE category = ''`);
    await db.execute(sql`UPDATE events SET program = 'marathon' WHERE is_featured = true AND program = '' AND category = 'mv' AND NOT EXISTS (SELECT 1 FROM events WHERE program = 'marathon')`);
    const radio = await radioIds();
    if (radio.length) await db.update(events).set({ program: "radio" }).where(and(inArray(events.id, radio), eq(events.program, ""), eq(events.category, "mv")));
    await db.execute(sql`UPDATE events SET program = 'live' WHERE program = '' AND category = 'mv' AND id IN (SELECT st.event_id FROM stages s JOIN studios st ON st.id = s.studio_id WHERE s.studio_id > 0)`);
  })().catch((err) => { filled = null; throw err; });
  return filled;
}

/* ── The per-area switch (events:explicit:<area>, off by default), read at most every 30 seconds per server ── */
const switchCache = new Map<string, { on: boolean; at: number }>();
export async function explicitOn(area: EventArea): Promise<boolean> {
  const c = switchCache.get(area);
  if (c && Date.now() - c.at < 30_000) return c.on;
  const on = (await storage.getSetting(`events:explicit:${area}`).catch(() => null)) === "on";
  switchCache.set(area, { on, at: Date.now() });
  return on;
}

/* ── The fallback counter: one row per area per UTC day, flushed at most every 30 seconds per server ── */
const pending = new Map<string, { n: number; path: string }>();
const lastFlush = new Map<string, number>();
function countFallback(area: EventArea, path: string): void {
  const p = pending.get(area) ?? { n: 0, path };
  p.n += 1; p.path = path;
  pending.set(area, p);
  if (Date.now() - (lastFlush.get(area) ?? 0) < 30_000) return;
  lastFlush.set(area, Date.now());
  pending.delete(area);
  const day = now().slice(0, 10), at = now(), lastPath = p.path.slice(0, 200);
  void db.insert(eventFallbacks).values({ area, day, count: p.n, lastPath, lastAt: at })
    .onConflictDoUpdate({ target: [eventFallbacks.area, eventFallbacks.day], set: { count: sql`${eventFallbacks.count} + ${p.n}`, lastPath, lastAt: at } })
    .catch(() => { const back = pending.get(area); pending.set(area, { n: (back?.n ?? 0) + p.n, path: p.path }); });
}

export type FallbackSummary = { area: EventArea; today: number; last24h: number; last7d: number; lastPath: string; lastAt: string; explicit: boolean };
/** Every area, with how often it fell back to the featured event (today, roughly the last 24 hours, the last 7 days). */
export async function fallbackSummary(): Promise<FallbackSummary[]> {
  await schemaIsReady();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const rows = await db.select().from(eventFallbacks).where(sql`${eventFallbacks.day} >= ${since}`);
  const today = now().slice(0, 10), yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const dayAgo = Date.now() - 86_400_000;
  return Promise.all(EVENT_AREAS.map(async (area) => {
    const mine = rows.filter((r) => r.area === area);
    const latest = mine.slice().sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1))[0];
    // The last 24 hours: today's count, plus yesterday's when its last fallback was within the window.
    const y = mine.find((r) => r.day === yesterday);
    return {
      area,
      today: mine.find((r) => r.day === today)?.count ?? 0,
      last24h: (mine.find((r) => r.day === today)?.count ?? 0) + (y && Date.parse(y.lastAt) > dayAgo ? y.count : 0),
      last7d: mine.reduce((s, r) => s + r.count, 0),
      lastPath: latest?.lastPath ?? "",
      lastAt: latest?.lastAt ?? "",
      explicit: await explicitOn(area),
    };
  }));
}

export class EventPickError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const named = (v: unknown) => { const n = Number(Array.isArray(v) ? v[0] : v); return Number.isInteger(n) && n > 0 ? n : 0; };

/**
 * The event a request is about, in this order: ?eventId= or body.eventId; ?stageId= (that LIVE stage's studio's event);
 * the caller's own event (pass `own` when the route knows one: a host's sign-up, a guest's studio). With none of those,
 * the area switch decides: off returns today's featured event and counts one fallback for the area; on answers 400
 * "Pick an event" (404 for public pages, which always name theirs).
 * Event admins and studio hosts (req.studioHostEvents) only ever get one of their own events: 403 otherwise.
 * Throws EventPickError; eventPickStatus(err) maps it for a route's catch.
 */
export async function eventFor(req: Request, area: EventArea, own?: () => Promise<number | null | undefined>): Promise<EventRow> {
  await fillEventColumns().catch(() => {});
  const scoped: number[] | undefined = (req as any).studioHost || (req as any).eventAdmin ? (req as any).studioHostEvents : undefined;
  const allow = (e: EventRow) => {
    if (scoped && !scoped.includes(e.id)) throw new EventPickError(403, "That's outside your event.");
    return e;
  };
  let id = named(req.query?.eventId) || named((req.body as Record<string, unknown> | undefined)?.eventId);
  if (!id) {
    const stageId = named(req.query?.stageId);
    if (stageId) {
      const [row] = await db.select({ eventId: studios.eventId }).from(stages).innerJoin(studios, eq(studios.id, stages.studioId)).where(eq(stages.id, stageId)).limit(1);
      if (!row) throw new EventPickError(404, "We couldn't find that stage's studio.");
      id = row.eventId;
    }
  }
  if (!id && own) id = Number((await own()) ?? 0) || 0;
  if (id) {
    const e = await storage.getEventById(id);
    if (!e) throw new EventPickError(404, "We couldn't find that event.");
    return allow(e);
  }
  if (await explicitOn(area)) throw area === "public" ? new EventPickError(404, "We couldn't find that event.") : new EventPickError(400, "Pick an event.");
  countFallback(area, `${req.method} ${req.path}`);
  return allow(await storage.getFeaturedEvent());
}
/** For a route's catch: the status and message to send, or null when it isn't ours. */
export function eventPickStatus(err: unknown): { status: number; message: string } | null {
  return err instanceof EventPickError ? { status: err.status, message: err.message } : null;
}

/* ── GET /api/admin/mv-events ── */
export type MvEventStudio = { id: number; name: string };
export type MvEventEntry = {
  /** The event's id; for Radio, the first day's (each day is in days). */
  id: number;
  name: string;
  program: EventProgram;
  slug: string;
  startAt: string;
  endAt: string;
  /** "live" (on now) | "upcoming" | "past"; hidden events say so in visible. */
  status: "live" | "upcoming" | "past";
  visible: boolean;
  featured: boolean;
  studios: MvEventStudio[];
  /** Radio only: one entry per day underneath it. */
  days?: { id: number; name: string; startAt: string; endAt: string; status: MvEventEntry["status"]; studios: MvEventStudio[] }[];
};
const endOf = (e: EventRow) => e.endAtUtc || new Date(Date.parse(e.startAtUtc) + (e.durationHours || 0) * 3_600_000).toISOString();
const statusOf = (start: string, end: string): MvEventEntry["status"] => {
  const t = Date.now(), s = Date.parse(start), f = Date.parse(end);
  return Number.isFinite(s) && t < s ? "upcoming" : Number.isFinite(f) && t > f ? "past" : "live";
};

export async function listMvEvents(only?: number[]): Promise<MvEventEntry[]> {
  await fillEventColumns();
  const all = (await storage.listEvents()).filter((e) => categoryOf(e) === "mv" && (!only || only.includes(e.id)));
  const st = all.length ? await db.select({ id: studios.id, name: studios.name, eventId: studios.eventId }).from(studios).where(inArray(studios.eventId, all.map((e) => e.id))).orderBy(studios.id) : [];
  const studiosOf = (id: number) => st.filter((s) => s.eventId === id).map((s) => ({ id: s.id, name: s.name }));
  const radio = new Set(await radioIds());
  const out: MvEventEntry[] = [];
  const onRadio = all.filter((e) => e.program === "radio" || radio.has(e.id));
  // A rehearsal day ("Radio test (3-minute segment)", Sun 15 Nov) is no Radio day: it stays out of the range, the day
  // count and the list (PM, 26 Nov). Matched by name only, so a real short day never vanishes.
  const days = onRadio.filter((e) => !isRadioTest(e.name)).sort((a, b) => a.startAtUtc.localeCompare(b.startAtUtc));
  for (const e of all) {
    if (onRadio.includes(e)) continue;
    const end = endOf(e);
    out.push({ id: e.id, name: e.name, program: (e.program || "") as EventProgram, slug: e.slug, startAt: e.startAtUtc, endAt: end, status: statusOf(e.startAtUtc, end), visible: e.visible, featured: e.isFeatured, studios: studiosOf(e.id) });
  }
  if (days.length) {
    const d = days.map((e) => { const end = endOf(e); return { id: e.id, name: e.name, startAt: e.startAtUtc, endAt: end, status: statusOf(e.startAtUtc, end), studios: studiosOf(e.id) }; });
    const startAt = d[0].startAt, endAt = d.map((x) => x.endAt).sort().slice(-1)[0];
    out.push({ id: d[0].id, name: "Radio", program: "radio", slug: "radio", startAt, endAt, status: statusOf(startAt, endAt), visible: days.some((e) => e.visible), featured: days.some((e) => e.isFeatured), studios: d.flatMap((x) => x.studios), days: d });
  }
  // On now first, then upcoming soonest first, then past newest first.
  const rank = { live: 0, upcoming: 1, past: 2 } as const;
  return out.sort((a, b) => rank[a.status] - rank[b.status] || (a.status === "past" ? b.startAt.localeCompare(a.startAt) : a.startAt.localeCompare(b.startAt)));
}

/** How many events landed in each category and program (the backfill check; platform admins only). */
export async function columnCounts(): Promise<{ category: Record<string, number>; program: Record<string, number> }> {
  await fillEventColumns();
  const all = await storage.listEvents();
  const tally = (f: (e: EventRow) => string) => all.reduce<Record<string, number>>((m, e) => { const k = f(e) || "(none)"; m[k] = (m[k] ?? 0) + 1; return m; }, {});
  return { category: tally((e) => e.category), program: tally((e) => e.program) };
}

export function registerMvEvents(app: Express, requireAdmin: RequestHandler): void {
  /** MV events for the admin picker: { events, fallbacks }. Event admins and studio hosts see only their own events. */
  app.get("/api/admin/mv-events", requireAdmin, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const only: number[] | undefined = (req as any).studioHost || (req as any).eventAdmin ? (req as any).studioHostEvents : undefined;
      res.json({ events: await listMvEvents(only), fallbacks: only ? [] : await fallbackSummary(), ...(only ? {} : { counts: await columnCounts() }) });
    } catch (err) {
      console.error("mv-events:", err);
      res.status(500).json({ message: "The MV events list didn't load. Try once more." });
    }
  });
}
