// Event planners' own events (6 Oct): the third path in. A planner creates an
// event from their dashboard; it starts as a private draft, they send it to us,
// and once we approve it it's public (its page, its booking) and they run the
// studio for it as its studio host. Everything here is scoped to events whose
// ownerEmail is the signed-in person — nothing else on the platform is theirs.
import type { Express, RequestHandler, Request } from "express";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { slackNote } from "./slack.js";
import { events, signups } from "../shared/schema.js";
import { orgIdsOf, organizerOrgFor } from "./orgs.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const now = () => new Date().toISOString();
const meOf = (req: Request) => String((req as unknown as { hostEmail?: string }).hostEmail ?? "").trim().toLowerCase();
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "event";

/** The fields a planner sets, cleaned. Times are ISO; lengths have sensible bounds. */
function details(b: Record<string, unknown>) {
  const str = (k: string, n: number) => (typeof b[k] === "string" ? String(b[k]).trim().slice(0, n) : undefined);
  const int = (k: string, lo: number, hi: number) => (Number.isFinite(Number(b[k])) ? Math.min(hi, Math.max(lo, Math.round(Number(b[k])))) : undefined);
  const start = str("startAtUtc", 40);
  return {
    ...(str("name", 120) !== undefined ? { name: str("name", 120)! } : {}),
    ...(str("tagline", 200) !== undefined ? { tagline: str("tagline", 200)! } : {}),
    ...(str("description", 2000) !== undefined ? { description: str("description", 2000)! } : {}),
    ...(str("occasion", 120) !== undefined ? { occasion: str("occasion", 120)! } : {}),
    ...(start && Number.isFinite(Date.parse(start)) ? { startAtUtc: new Date(start).toISOString() } : {}),
    ...(int("durationHours", 1, 48) !== undefined ? { durationHours: int("durationHours", 1, 48)! } : {}),
    ...(int("slotMinutes", 10, 240) !== undefined ? { slotMinutes: int("slotMinutes", 10, 240)! } : {}),
    ...(int("onAirMinutes", 5, 240) !== undefined ? { onAirMinutes: int("onAirMinutes", 5, 240)! } : {}),
    ...(int("bufferMinutes", 0, 60) !== undefined ? { bufferMinutes: int("bufferMinutes", 0, 60)! } : {}),
    // In person: where, and the nearest airport (three letters) for fares.
    ...(str("venueName", 160) !== undefined ? { venueName: str("venueName", 160)! } : {}),
    ...(str("venueAddress", 300) !== undefined ? { venueAddress: str("venueAddress", 300)! } : {}),
    ...(typeof b.airport === "string" ? { airport: /^[A-Za-z]{3}$/.test(b.airport.trim()) ? b.airport.trim().toUpperCase() : "" } : {}),
  };
}

const view = (e: typeof events.$inferSelect, booked: number) => ({
  id: e.id, slug: e.slug, name: e.name, tagline: e.tagline, description: e.description, occasion: e.occasion,
  venueName: e.venueName, venueAddress: e.venueAddress, airport: e.airport,
  startAtUtc: e.startAtUtc, durationHours: e.durationHours, slotMinutes: e.slotMinutes, onAirMinutes: e.onAirMinutes, bufferMinutes: e.bufferMinutes,
  review: e.review || "draft", visible: e.visible, booked, orgId: e.orgId,
  slots: Math.floor((e.durationHours * 60) / Math.max(1, e.slotMinutes)),
  pageUrl: `${ORIGIN}/event/${e.slug}`,
  bookUrl: `${ORIGIN}/event/${e.slug}/schedule`,
});

export function registerOrganizer(app: Express, requireHostSession: RequestHandler, requireAdmin: RequestHandler) {
  // Theirs: made by them, or run by an organization they're on the team of.
  const whose = async (req: Request) => {
    const orgIds = await orgIdsOf(meOf(req));
    return orgIds.length ? or(eq(events.ownerEmail, meOf(req)), inArray(events.orgId, orgIds)) : eq(events.ownerEmail, meOf(req));
  };
  const mine = async (req: Request, id: number) => {
    const [e] = await db.select().from(events).where(and(eq(events.id, id), await whose(req))).limit(1);
    return e;
  };

  app.get("/api/host/my-events", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await schemaIsReady();
    const rows = await db.select().from(events).where(await whose(req)).orderBy(desc(events.id));
    const out = [];
    for (const e of rows) {
      const n = (await db.select({ id: signups.id, status: signups.status }).from(signups).where(eq(signups.eventId, e.id))).filter((s) => s.status !== "cancelled").length;
      out.push(view(e, n));
    }
    res.json(out);
  });

  app.post("/api/host/my-events", requireHostSession, async (req, res) => {
    await schemaIsReady();
    const me = meOf(req);
    const d = details(req.body ?? {});
    if (!d.name) return res.status(400).json({ message: "Give your event a name." });
    if (!d.startAtUtc) return res.status(400).json({ message: "Pick when it starts." });
    // A planner can have a few drafts going, not hundreds.
    const count = (await db.select({ id: events.id }).from(events).where(eq(events.ownerEmail, me))).length;
    if (count >= 10) return res.status(429).json({ message: "That's ten events. Finish or remove one first, or write to hello@militaryvoices.ai." });
    // It belongs to their organizer account (made now, the first time).
    const org = await organizerOrgFor(me, typeof req.body?.orgName === "string" ? req.body.orgName.slice(0, 120) : undefined);
    let slug = slugify(d.name);
    for (let i = 2; (await storage.getEventBySlug(slug)); i++) slug = `${slugify(d.name)}-${i}`;
    const [row] = await db.insert(events).values({
      slug, name: d.name, tagline: d.tagline ?? "", description: d.description ?? "", occasion: d.occasion ?? "",
      startAtUtc: d.startAtUtc, durationHours: d.durationHours ?? 4, slotMinutes: d.slotMinutes ?? 30,
      onAirMinutes: d.onAirMinutes ?? 25, bufferMinutes: d.bufferMinutes ?? 5, bufferPosition: "after",
      visible: false, isFeatured: false, closed: false, ownerEmail: me, review: "draft", orgId: org.id,
      // Never used for a planner's event (their studio access comes from ownership), but the column has no empty default.
      adminPassword: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
      createdAt: now(),
    }).returning();
    res.status(201).json(view(row, 0));
  });

  app.put("/api/host/my-events/:id", requireHostSession, async (req, res) => {
    const e = await mine(req, Number(req.params.id));
    if (!e) return res.status(404).json({ message: "That isn't one of your events." });
    const [row] = await db.update(events).set(details(req.body ?? {})).where(eq(events.id, e.id)).returning();
    res.json(view(row, 0));
  });

  /** Send it to us to approve. We get a Slack note; approving makes it public. */
  app.post("/api/host/my-events/:id/submit", requireHostSession, async (req, res) => {
    const e = await mine(req, Number(req.params.id));
    if (!e) return res.status(404).json({ message: "That isn't one of your events." });
    if (e.review === "approved") return res.json(view(e, 0));
    const [row] = await db.update(events).set({ review: "pending" }).where(eq(events.id, e.id)).returning();
    await slackNote(`:calendar: ${meOf(req)} sent an event for approval: "${e.name}" (${new Date(e.startAtUtc).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}).`, { label: "Review it", url: `${ORIGIN}/admin` }).catch(() => {});
    res.json(view(row, 0));
  });

  app.delete("/api/host/my-events/:id", requireHostSession, async (req, res) => {
    const e = await mine(req, Number(req.params.id));
    if (!e) return res.status(404).json({ message: "That isn't one of your events." });
    if (e.review === "approved") return res.status(409).json({ message: "It's live. Write to hello@militaryvoices.ai to take it down." });
    await db.delete(events).where(eq(events.id, e.id));
    res.json({ ok: true });
  });

  /** Who has booked a slot on it. */
  app.get("/api/host/my-events/:id/lineup", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const e = await mine(req, Number(req.params.id));
    if (!e) return res.status(404).json({ message: "That isn't one of your events." });
    const rows = (await db.select().from(signups).where(eq(signups.eventId, e.id))).filter((s) => s.status !== "cancelled").sort((a, b) => a.slotIndex - b.slotIndex);
    const start = Date.parse(e.startAtUtc);
    res.json(rows.map((s) => ({ id: s.id, hostName: s.hostName, podcastName: s.podcastName, email: s.email, at: new Date(start + s.slotIndex * e.slotMinutes * 60000).toISOString() })));
  });

  // ---- Our side: the events waiting for approval ---------------------------
  app.get("/api/admin/planner-events", requireAdmin, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if ((req as { studioHost?: unknown }).studioHost) return res.status(403).json({ message: "Admins only." });
    await schemaIsReady();
    const rows = (await db.select().from(events).orderBy(desc(events.id))).filter((e) => e.ownerEmail);
    res.json(rows.map((e) => ({ ...view(e, 0), ownerEmail: e.ownerEmail })));
  });
  app.post("/api/admin/planner-events/:id/approve", requireAdmin, async (req, res) => {
    if ((req as { studioHost?: unknown }).studioHost) return res.status(403).json({ message: "Admins only." });
    const approve = req.body?.approve !== false;
    const [row] = await db.update(events).set(approve ? { review: "approved", visible: true } : { review: "draft", visible: false }).where(eq(events.id, Number(req.params.id))).returning();
    if (!row) return res.status(404).json({ message: "No such event." });
    res.json({ ...view(row, 0), ownerEmail: row.ownerEmail });
  });
}
