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
import { db, schemaIsReady } from "./storage.js";
import {
  bioPages, contacts, discoveryMembers, eventTeam, events, hostedShows, inboundEmails, mailLog,
  podcasterProfiles, postifySubscriptions, reminders, signups, sponsorLeads,
} from "../shared/schema.js";
import { PLANS } from "../shared/tokens.js";

export type Role = "Member" | "Podcaster" | "Co-host" | "Discovery" | "Sponsor" | "Team" | "Listener" | "Imported";
export type Person = {
  email: string;
  name: string;
  roles: Role[];
  /** Growth (free), Scale or Pro — members only. */
  plan: string;
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

/** The audiences people can be filtered into, and campaigns sent to. */
export const AUDIENCES: { key: string; label: string; scope: "platform" | "event" | "both"; test: (p: Person) => boolean }[] = [
  { key: "everyone", label: "Everyone", scope: "both", test: () => true },
  { key: "members", label: "Members (have an account)", scope: "both", test: (p) => p.roles.includes("Member") },
  { key: "podcasters", label: "Podcasters", scope: "both", test: (p) => p.roles.includes("Podcaster") || p.roles.includes("Co-host") },
  { key: "pro", label: "On Pro", scope: "platform", test: (p) => p.plan === PLANS.pro.name },
  { key: "scale", label: "On Scale", scope: "platform", test: (p) => p.plan === PLANS.creator.name },
  { key: "growth", label: "On Growth (free)", scope: "platform", test: (p) => p.plan === "Growth" },
  { key: "discovery", label: "Discovery users", scope: "platform", test: (p) => p.roles.includes("Discovery") },
  { key: "sponsors", label: "Sponsors", scope: "both", test: (p) => p.roles.includes("Sponsor") },
  { key: "team", label: "Event team", scope: "both", test: (p) => p.roles.includes("Team") },
  { key: "listeners", label: "Listeners", scope: "both", test: (p) => p.roles.includes("Listener") },
  { key: "imported", label: "Imported contacts", scope: "platform", test: (p) => p.roles.includes("Imported") },
  { key: "no-smartlink", label: "Members without a SmartLink", scope: "platform", test: (p) => p.roles.includes("Member") && !p.smartlink },
];

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
      p = { email: e, name: "", roles: [], plan: "", shows: [], events: [], smartlink: "", hosted: false, unsubscribed: false, stage: "", tags: [], joinedAt: "", lastActivityAt: "" };
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
  // Listeners who asked to be reminded of a show.
  const thisEvent = new Set(books.map((s) => s.id));
  for (const r of await db.select({ email: reminders.email, name: reminders.name, signupId: reminders.signupId, createdAt: reminders.createdAt }).from(reminders)) {
    if (eventId != null && !thisEvent.has(r.signupId)) continue;
    const p = get(r.email, r.name); role(p, "Listener"); joined(p, r.createdAt);
  }

  // Platform-wide sources: in an event's CRM they only add detail to people already there.
  const platform = eventId == null;
  const only = (e: string) => platform || map.has(norm(e));
  for (const pr of await db.select({ email: podcasterProfiles.email, name: podcasterProfiles.hostName, show: podcasterProfiles.podcastName, createdAt: podcasterProfiles.createdAt }).from(podcasterProfiles)) {
    if (!only(pr.email)) continue;
    const p = get(pr.email, pr.name); role(p, "Member"); joined(p, pr.createdAt);
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
    res.json({ people, audiences });
  });
}
