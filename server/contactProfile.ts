// A person, all in one place, by their email (whether or not they're in Contacts): who they
// are to us (host, guest, listener, sponsor), every email both ways and how each did, their
// bookings, SmartLink, shows and sign-ups, and the team's own tags and notes, as one timeline.
import type { Express, RequestHandler } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schemaIsReady } from "./storage.js";
import { getAdminEmail } from "./session.js";
import { enrollByTrigger } from "./automations.js";
import { bioPages, bioSubscribers, broadcastEvents, contactNotes, contacts, events, hostedEpisodes, hostedShows, inboundEmails, mailLog, podcasterProfiles, reminders, signups } from "../shared/schema.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const now = () => new Date().toISOString();
const clip = (t: string, n: number) => { const s = (t || "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const parseTags = (raw: string | null | undefined): string[] => { try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
const cleanTags = (v: unknown): string[] => (Array.isArray(v) ? v : []).map((t) => String(t).trim().toLowerCase().replace(/\s+/g, " ").slice(0, 30)).filter((t, i, a) => t && a.indexOf(t) === i).slice(0, 20);

function slotTime(ev: { startAtUtc: string; slotMinutes: number } | undefined, slotIndex: number | null, zone?: string | null): string {
  if (!ev || slotIndex == null) return "";
  const start = Date.parse(ev.startAtUtc);
  if (!Number.isFinite(start)) return "";
  const at = new Date(start + slotIndex * ev.slotMinutes * 60000);
  const fmt = (tz: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: tz }).format(at);
  try { return fmt((zone || "").trim() || "America/New_York"); } catch { return fmt("America/New_York"); }
}

type Fate = { delivered: boolean; opened: boolean; clicked: boolean; bounced: boolean };
type Moment = { at: string; kind: "email-out" | "email-in" | "booking" | "cohost" | "signup" | "reminder" | "note" | "joined"; title: string; detail?: string; fate?: Fate; ok?: boolean; label?: string };

export function registerContactProfile(app: Express, requireAdmin: RequestHandler) {
  app.get("/api/admin/contact-profile", requireAdmin, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await schemaIsReady();
    const email = String(req.query.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return res.status(400).json({ message: "Whose profile?" });
    const lower = (c: unknown) => sql`lower(${c})`;
    const [[contact], notes, sent, got, [host], books, cohosts, [page], shows, subs, rems] = await Promise.all([
      db.select().from(contacts).where(eq(lower(contacts.email), email)).limit(1),
      db.select().from(contactNotes).where(eq(contactNotes.email, email)).orderBy(desc(contactNotes.createdAt)),
      db.select().from(mailLog).where(eq(mailLog.toEmail, email)).orderBy(desc(mailLog.sentAt)),
      db.select().from(inboundEmails).where(eq(lower(inboundEmails.fromEmail), email)).orderBy(desc(inboundEmails.receivedAt)),
      db.select().from(podcasterProfiles).where(eq(lower(podcasterProfiles.email), email)).limit(1),
      db.select().from(signups).where(eq(lower(signups.email), email)),
      db.select().from(signups).where(eq(lower(signups.coHostEmail), email)),
      db.select().from(bioPages).where(eq(lower(bioPages.email), email)).limit(1),
      db.select().from(hostedShows).where(eq(lower(hostedShows.email), email)),
      db.select({ at: bioSubscribers.createdAt, handle: bioPages.handle, name: bioPages.displayName }).from(bioSubscribers).innerJoin(bioPages, eq(bioPages.id, bioSubscribers.pageId)).where(eq(lower(bioSubscribers.email), email)),
      db.select({ at: reminders.createdAt, podcast: signups.podcastName }).from(reminders).leftJoin(signups, eq(signups.id, reminders.signupId)).where(eq(lower(reminders.email), email)),
    ]);
    // What happened to each email we sent them.
    const ids = sent.map((m) => m.resendId).filter(Boolean);
    const evs = ids.length ? await db.select({ id: broadcastEvents.resendId, type: broadcastEvents.eventType, at: broadcastEvents.occurredAt }).from(broadcastEvents).where(inArray(broadcastEvents.resendId, ids)) : [];
    const fate = new Map<string, Fate>();
    let lastOpened = "";
    for (const e of evs) {
      const f = fate.get(e.id) ?? { delivered: false, opened: false, clicked: false, bounced: false };
      if (e.type === "delivered") f.delivered = true;
      if (e.type === "opened" || e.type === "clicked") { f.delivered = true; f[e.type] = true; if (e.at > lastOpened) lastOpened = e.at; }
      if (e.type === "bounced") f.bounced = true;
      fate.set(e.id, f);
    }
    const evIds = Array.from(new Set([...books, ...cohosts].map((b) => b.eventId).filter((x): x is number => x != null)));
    const evRows = evIds.length ? await db.select().from(events).where(inArray(events.id, evIds)) : [];
    const evById = new Map(evRows.map((e) => [e.id, e]));
    const epCounts = shows.length ? await db.select({ show: hostedEpisodes.showId, n: sql<number>`count(*)::int` }).from(hostedEpisodes).where(and(inArray(hostedEpisodes.showId, shows.map((s) => s.id)), eq(hostedEpisodes.status, "published"))).groupBy(hostedEpisodes.showId) : [];

    const name = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") || host?.hostName || got.find((g) => g.fromName)?.fromName || books[0]?.hostName || "";
    const bookings = books.map((b) => ({ id: b.id, podcast: b.podcastName, event: evById.get(b.eventId ?? -1)?.name ?? "", when: slotTime(evById.get(b.eventId ?? -1) as never, b.slotIndex, b.timezone), status: b.status, at: b.createdAt, role: "host" as const }));
    const cohosting = cohosts.map((b) => ({ id: b.id, podcast: b.podcastName, event: evById.get(b.eventId ?? -1)?.name ?? "", when: slotTime(evById.get(b.eventId ?? -1) as never, b.slotIndex, b.timezone), status: b.status, at: b.createdAt, role: "cohost" as const }));

    const timeline: Moment[] = [
      ...sent.map((m): Moment => ({ at: m.sentAt, kind: "email-out", title: m.subject, detail: clip(m.bodyText, 180), fate: fate.get(m.resendId), ok: m.ok, label: m.kind })),
      ...got.map((g): Moment => ({ at: g.receivedAt, kind: "email-in", title: g.subject, detail: clip(g.summary || g.bodyText, 180), label: g.status })),
      ...bookings.map((b): Moment => ({ at: b.at, kind: "booking", title: `Booked ${b.podcast}${b.event ? ` at ${b.event}` : ""}`, detail: [b.when, b.status].filter(Boolean).join(" · ") })),
      ...cohosting.map((b): Moment => ({ at: b.at, kind: "cohost", title: `Co-host on ${b.podcast}`, detail: [b.when, b.status].filter(Boolean).join(" · ") })),
      ...subs.map((s): Moment => ({ at: s.at, kind: "signup", title: `Signed up on ${s.name || s.handle}'s SmartLink` })),
      ...rems.map((r): Moment => ({ at: r.at, kind: "reminder", title: `Asked for a reminder${r.podcast ? ` of ${r.podcast}` : ""}` })),
      ...notes.map((n): Moment => ({ at: n.createdAt, kind: "note", title: n.text, detail: n.author })),
      ...(contact ? [{ at: contact.importedAt, kind: "joined" as const, title: `Added to Contacts (${contact.source})` }] : []),
    ].filter((m) => m.at).sort((a, b) => b.at.localeCompare(a.at));

    // Who they are to us, in a word or two.
    const roles = [host || books.length ? "Podcaster" : "", cohosts.length ? "Co-host" : "", subs.length || rems.length ? "Listener" : "", got.some((g) => g.category === "sponsor") ? "Sponsor" : ""].filter(Boolean);
    res.json({
      email, name, roles,
      contact: contact ? { id: contact.id, status: contact.status, stage: contact.lifecycleStage, source: contact.source, since: contact.importedAt, lastEngagedAt: contact.lastEngagedAt } : null,
      tags: parseTags(contact?.tags),
      notes: notes.map((n) => ({ id: n.id, text: n.text, author: n.author, at: n.createdAt })),
      stats: {
        sent: sent.filter((m) => m.ok).length, received: got.length,
        opened: sent.filter((m) => fate.get(m.resendId)?.opened).length, clicked: sent.filter((m) => fate.get(m.resendId)?.clicked).length,
        bounced: sent.filter((m) => fate.get(m.resendId)?.bounced).length, lastEmailedAt: sent[0]?.sentAt ?? "", lastOpenedAt: lastOpened, lastWroteAt: got[0]?.receivedAt ?? "",
        waiting: got.filter((g) => g.status === "new" || g.status === "drafted").length,
      },
      host: host ? { podcast: host.podcastName, hostName: host.hostName, branch: host.branch, serviceStatus: host.serviceStatus } : null,
      smartlink: page ? { handle: page.handle, url: `${ORIGIN}/${page.handle}`, name: page.displayName } : null,
      shows: shows.map((s) => ({ id: s.id, title: s.title, url: `${ORIGIN}/podcast/${s.slug}`, episodes: epCounts.find((c) => c.show === s.id)?.n ?? 0 })),
      bookings: [...bookings, ...cohosting],
      timeline: timeline.slice(0, 300),
    });
  });

  // Tags: saved on their Contacts row (made, as a manual contact, if they haven't one).
  app.put("/api/admin/contact-profile/tags", requireAdmin, async (req, res) => {
    await schemaIsReady();
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return res.status(400).json({ message: "Whose tags?" });
    const tags = JSON.stringify(cleanTags(req.body?.tags));
    const [row] = await db.select({ id: contacts.id, tags: contacts.tags, firstName: contacts.firstName }).from(contacts).where(eq(sql`lower(${contacts.email})`, email)).limit(1);
    if (row) await db.update(contacts).set({ tags }).where(eq(contacts.id, row.id));
    else await db.insert(contacts).values({ email, source: "manual", importedAt: now(), tags });
    // A new tag starts any automation that's on for it.
    const before = new Set(parseTags(row?.tags));
    for (const t of JSON.parse(tags) as string[]) if (!before.has(t)) await enrollByTrigger(`tag:${t}`, email, row?.firstName ?? "");
    res.json({ tags: JSON.parse(tags) });
  });

  // The whole set of tags in use, for suggestions.
  app.get("/api/admin/contact-tags", requireAdmin, async (_req, res) => {
    await schemaIsReady();
    const rows = await db.select({ tags: contacts.tags }).from(contacts).where(sql`${contacts.tags} <> '[]'`);
    const n = new Map<string, number>();
    for (const r of rows) for (const t of parseTags(r.tags)) n.set(t, (n.get(t) ?? 0) + 1);
    res.json(Array.from(n.entries()).sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count })));
  });

  app.post("/api/admin/contact-profile/notes", requireAdmin, async (req, res) => {
    await schemaIsReady();
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const text = String(req.body?.text ?? "").trim().slice(0, 4000);
    if (!/^[^@\s]+@[^@\s]+$/.test(email) || !text) return res.status(400).json({ message: "Write the note first." });
    const [n] = await db.insert(contactNotes).values({ email, text, author: getAdminEmail(req) ?? "", createdAt: now() }).returning();
    res.status(201).json({ id: n.id, text: n.text, author: n.author, at: n.createdAt });
  });

  app.delete("/api/admin/contact-profile/notes/:id", requireAdmin, async (req, res) => {
    await db.delete(contactNotes).where(eq(contactNotes.id, Number(req.params.id)));
    res.json({ ok: true });
  });
}
