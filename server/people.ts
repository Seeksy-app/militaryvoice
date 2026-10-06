// People: everyone the platform has a relationship with, one row per email.
//
// The CRM used to know only two kinds of person — an event's bookings and the
// imported contact list — so a member who made an account and never booked
// (Daniel, 5 Oct) wasn't in it anywhere. This reads every place a person can
// come from (an account, a booking on any event, Discovery, a plan, an import,
// a sponsor lead, an event's team, a listener's reminder) and folds them into
// one person with roles. It's derived, not copied: nothing to keep in sync.
//
// The same list, narrowed to one event, is that event's CRM.
import type { Express, RequestHandler } from "express";
import { inArray, sql } from "drizzle-orm";
import { db, schemaIsReady, storage } from "./storage.js";
import { PLANS } from "../shared/tokens.js";
import { BUILT_IN_AUDIENCES, matchesFilter, type AudienceFilter, type SavedAudience } from "../shared/crm.js";
import {
  bioPages, contacts, discoveryMembers, eventTeam, events, hostedShows, inboundEmails, mailLog,
  podcasterProfiles, postifySubscriptions, pathOf, reminders, signups, sponsorInquiries, sponsorLeads,
} from "../shared/schema.js";

export type Role = "Member" | "Podcaster" | "Co-host" | "Discovery" | "Sponsor" | "Team" | "Listener" | "Imported";
export type Person = {
  email: string;
  name: string;
  roles: Role[];
  /** Growth (free), Scale or Pro — members only. */
  plan: string;
  /** podcaster | creator | planner — members only. */
  path: string;
  shows: string[];
  events: { id: number; name: string }[];
  smartlink: string;
  hosted: boolean;
  unsubscribed: boolean;
  stage: string;
  tags: string[];
  joinedAt: string;
  lastActivityAt: string;
};

/** The audiences people can be filtered into, and campaigns sent to (shared with the page). */
export const AUDIENCES = BUILT_IN_AUDIENCES;

// Audiences the team makes from filters ("Members on Growth who joined this month").
const SAVED_KEY = "crm_audiences";
export async function savedAudiences(): Promise<SavedAudience[]> {
  try { const v = JSON.parse((await storage.getSetting(SAVED_KEY)) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
const saveAudiences = (list: SavedAudience[]) => storage.setSetting(SAVED_KEY, JSON.stringify(list));

const norm = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();
const valid = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const HOUSE = new Set(["hello@militaryvoice.ai", "hello@militaryvoices.ai"]);

/** Everyone, or everyone connected to one event. Newest activity first. */
export async function listPeople(eventId: number | null): Promise<Person[]> {
  await schemaIsReady();
  const map = new Map<string, Person>();
  const get = (email: string, name = ""): Person | null => {
    const e = norm(email);
    if (!valid(e) || HOUSE.has(e)) return null;
    let p = map.get(e);
    if (!p) {
      p = { email: e, name: "", roles: [], plan: "", path: "", shows: [], events: [], smartlink: "", hosted: false, unsubscribed: false, stage: "", tags: [], joinedAt: "", lastActivityAt: "" };
      map.set(e, p);
    }
    if (!p.name && name.trim()) p.name = name.trim();
    return p;
  };
  const role = (p: Person | null, r: Role) => { if (p && !p.roles.includes(r)) p.roles.push(r); };
  const joined = (p: Person | null, at: string) => { if (p && at && (!p.joinedAt || at < p.joinedAt)) p.joinedAt = at; };

  const evRows = await db.select({ id: events.id, name: events.name }).from(events);
  const evName = new Map(evRows.map((e) => [e.id, e.name]));
  const addEvent = (p: Person | null, id: number) => { if (p && !p.events.some((x) => x.id === id)) p.events.push({ id, name: evName.get(id) ?? `Event ${id}` }); };

  // Bookings (every event, or this one): the host, and the co-host on it.
  const books = (await db.select().from(signups)).filter((s) => s.status !== "cancelled" && (eventId == null || s.eventId === eventId));
  for (const s of books) {
    const p = get(s.email, s.hostName);
    role(p, "Podcaster"); addEvent(p, s.eventId); joined(p, s.createdAt);
    if (p && s.podcastName && !p.shows.includes(s.podcastName)) p.shows.push(s.podcastName);
    if (s.coHostEmail) { const c = get(s.coHostEmail); role(c, "Co-host"); addEvent(c, s.eventId); }
  }
  // An event's own crew and sponsors.
  for (const t of await db.select().from(eventTeam)) {
    if (eventId != null && t.eventId !== eventId) continue;
    const p = get(t.email, t.name); role(p, "Team"); addEvent(p, t.eventId);
  }
  for (const l of await db.select().from(sponsorLeads)) {
    if (eventId != null && l.eventId !== eventId) continue;
    if (!l.email) continue;
    const p = get(l.email, l.name); role(p, "Sponsor");
  }
  // Sponsors who came to us (the sponsor form), on the platform's CRM.
  if (eventId == null) {
    for (const q of await db.select({ email: sponsorInquiries.email, name: sponsorInquiries.name, createdAt: sponsorInquiries.createdAt }).from(sponsorInquiries)) {
      const p = get(q.email, q.name); role(p, "Sponsor"); joined(p, q.createdAt);
    }
  }
  // Listeners who asked to be reminded of a show.
  const thisEvent = new Set(books.map((s) => s.id));
  for (const r of await db.select({ email: reminders.email, name: reminders.name, signupId: reminders.signupId, createdAt: reminders.createdAt }).from(reminders)) {
    if (eventId != null && !thisEvent.has(r.signupId)) continue;
    const p = get(r.email, r.name); role(p, "Listener"); joined(p, r.createdAt);
  }

  // Platform-wide sources: in an event's CRM they only add detail to people already there.
  const platform = eventId == null;
  const only = (e: string) => platform || map.has(norm(e));
  for (const pr of await db.select({ email: podcasterProfiles.email, name: podcasterProfiles.hostName, show: podcasterProfiles.podcastName, interests: podcasterProfiles.interests, createdAt: podcasterProfiles.createdAt }).from(podcasterProfiles)) {
    if (!only(pr.email)) continue;
    const p = get(pr.email, pr.name); role(p, "Member"); joined(p, pr.createdAt);
    if (p) p.path = pathOf(pr.interests);
    if (p && pr.show && !p.shows.includes(pr.show)) p.shows.push(pr.show);
  }
  for (const d of await db.select({ email: discoveryMembers.email, createdAt: discoveryMembers.createdAt }).from(discoveryMembers)) {
    if (!only(d.email)) continue;
    const p = get(d.email); role(p, "Discovery"); joined(p, d.createdAt);
  }
  for (const c of await db.select().from(contacts)) {
    if (!only(c.email)) continue;
    const p = get(c.email, [c.firstName, c.lastName].filter(Boolean).join(" "));
    if (!p) continue;
    if (c.source === "csv" || c.source === "import" || c.source === "manual") role(p, "Imported");
    p.unsubscribed = c.status === "unsubscribed";
    p.stage = c.lifecycleStage ?? "";
    try { p.tags = JSON.parse(c.tags || "[]"); } catch { p.tags = []; }
    joined(p, c.importedAt);
    if (c.lastEngagedAt && c.lastEngagedAt > p.lastActivityAt) p.lastActivityAt = c.lastEngagedAt;
  }

  const emails = Array.from(map.keys());
  if (emails.length) {
    // Plans: a paid subscription that's live (comp plans included), else Growth for members.
    for (const s of await db.select().from(postifySubscriptions).where(inArray(postifySubscriptions.email, emails))) {
      if (!["active", "trialing", "past_due"].includes(s.status)) continue;
      const p = map.get(norm(s.email));
      if (p) p.plan = s.plan === "pro" ? PLANS.pro.name : PLANS.creator.name;
    }
    for (const b of await db.select({ email: bioPages.email, handle: bioPages.handle, published: bioPages.published }).from(bioPages).where(inArray(bioPages.email, emails))) {
      const p = map.get(norm(b.email));
      if (p && b.published && b.handle) p.smartlink = b.handle;
    }
    for (const h of await db.select({ owner: hostedShows.ownerEmail, email: hostedShows.email }).from(hostedShows)) {
      const p = map.get(norm(h.owner || h.email));
      if (p) p.hosted = true;
    }
    // Last time we wrote to them, or they wrote to us.
    const out = await db.select({ email: mailLog.toEmail, at: sql<string>`max(${mailLog.sentAt})` }).from(mailLog).where(inArray(mailLog.toEmail, emails)).groupBy(mailLog.toEmail);
    const inn = await db.select({ email: sql<string>`lower(${inboundEmails.fromEmail})`, at: sql<string>`max(${inboundEmails.receivedAt})` }).from(inboundEmails).groupBy(sql`lower(${inboundEmails.fromEmail})`);
    for (const r of [...out, ...inn]) {
      const p = map.get(norm(r.email));
      if (p && r.at && r.at > p.lastActivityAt) p.lastActivityAt = r.at;
    }
  }
  for (const p of Array.from(map.values())) {
    if (p.roles.includes("Member") && !p.plan) p.plan = "Growth";
    if (!p.lastActivityAt) p.lastActivityAt = p.joinedAt;
  }
  return Array.from(map.values()).sort((a, b) => (b.lastActivityAt || "").localeCompare(a.lastActivityAt || ""));
}

/** Who an audience reaches (unsubscribed people never), for a campaign. */
export async function audienceRecipients(key: string, eventId: number | null): Promise<{ email: string; firstName: string }[]> {
  const people = await listPeople(eventId);
  // Hand-picked: "pick:a@x.com|b@y.com" — still only people we know, and never the unsubscribed.
  if (key.startsWith("pick:")) {
    const want = new Set(key.slice(5).split("|").map(norm));
    return people.filter((p) => want.has(p.email) && !p.unsubscribed).map(first);
  }
  if (key.startsWith("saved:")) {
    const a = (await savedAudiences()).find((x) => x.id === key.slice(6));
    return a ? people.filter((p) => !p.unsubscribed && matchesFilter(p, a.filter)).map(first) : [];
  }
  const a = AUDIENCES.find((x) => x.key === key);
  if (!a) return [];
  return people.filter((p) => !p.unsubscribed && a.test(p)).map(first);
}
const first = (p: Person) => ({ email: p.email, firstName: p.name.replace(/^(dr|mr|mrs|ms|sgt)\.?\s+/i, "").split(/\s+/)[0] || "" });

export function registerPeople(app: Express, requireAdmin: RequestHandler) {
  /** The People list, with every audience's count, for the platform or one event (?eventId). */
  app.get("/api/admin/people", requireAdmin, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if ((req as { studioHost?: unknown }).studioHost) return res.status(403).json({ message: "Admins only." });
    const eventId = Number(req.query.eventId) || null;
    const people = await listPeople(eventId);
    const scope = eventId ? "event" : "platform";
    const audiences = AUDIENCES.filter((a) => a.scope === "both" || a.scope === scope).map((a) => ({
      key: a.key, label: a.label, count: people.filter((p) => a.test(p)).length, reachable: people.filter((p) => a.test(p) && !p.unsubscribed).length,
    }));
    const saved = await savedAudiences();
    for (const a of saved) {
      const inIt = people.filter((p) => matchesFilter(p, a.filter));
      audiences.push({ key: `saved:${a.id}`, label: a.name, count: inIt.length, reachable: inIt.filter((p) => !p.unsubscribed).length });
    }
    res.json({ people, audiences, saved });
  });

  /** Save the filter on screen as an audience of its own; it shows in the list and as a campaign audience. */
  app.post("/api/admin/people/audiences", requireAdmin, async (req, res) => {
    if ((req as { studioHost?: unknown }).studioHost) return res.status(403).json({ message: "Admins only." });
    const name = String(req.body?.name ?? "").trim().slice(0, 60);
    if (!name) return res.status(400).json({ message: "Give it a name." });
    const f = (req.body?.filter ?? {}) as AudienceFilter;
    const strs = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 60)).slice(0, 30) : undefined);
    const filter: AudienceFilter = {
      base: typeof f.base === "string" ? f.base.slice(0, 40) : undefined,
      roles: strs(f.roles), plans: strs(f.plans), paths: strs(f.paths), tags: strs(f.tags),
      eventIds: Array.isArray(f.eventIds) ? f.eventIds.map(Number).filter(Number.isFinite).slice(0, 30) : undefined,
      joinedDays: Number(f.joinedDays) > 0 ? Math.round(Number(f.joinedDays)) : undefined,
      quietDays: Number(f.quietDays) > 0 ? Math.round(Number(f.quietDays)) : undefined,
      smartlink: f.smartlink === "yes" || f.smartlink === "no" ? f.smartlink : undefined,
    };
    const list = await savedAudiences();
    if (list.length >= 50) return res.status(400).json({ message: "That's 50 saved audiences. Remove one first." });
    const a: SavedAudience = { id: Math.random().toString(36).slice(2, 10), name, filter, createdAt: new Date().toISOString() };
    await saveAudiences([...list, a]);
    res.status(201).json(a);
  });
  app.delete("/api/admin/people/audiences/:id", requireAdmin, async (req, res) => {
    if ((req as { studioHost?: unknown }).studioHost) return res.status(403).json({ message: "Admins only." });
    await saveAudiences((await savedAudiences()).filter((a) => a.id !== req.params.id));
    res.json({ ok: true });
  });
}
