// Members' own events (6 Oct; reworked 24 Nov, Andrew: "if someone creates an event and they're a user, then
// they're approved"). Creating one publishes it: its page and /events, with a counted link to share. "Just me"
// (one host, one time) or "A lineup" (podcasters book slots, run from the studio). Free sign-up with up to five
// questions of their own; paid tickets are coming, not built. Admin keeps Take down (the event's Public switch).
// Everything here is scoped to events whose ownerEmail is the signed-in person — nothing else on the platform is theirs.
import type { Express, RequestHandler, Request } from "express";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { slackNote } from "./slack.js";
import { events, signups, siteSettings, eventRegistrations, eventClicks } from "../shared/schema.js";
import { eventDay, eventTime, zoneShort, readQuestions } from "../shared/eventTime.js";
import { sendOneOffEmail } from "./email.js";
import { creditExempt } from "./creditsAlert.js";
import { orgIdsOf, organizerOrgFor } from "./orgs.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const now = () => new Date().toISOString();
const meOf = (req: Request) => String((req as unknown as { hostEmail?: string }).hostEmail ?? "").trim().toLowerCase();
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "event";

/**
 * The planner hears back when we decide (Andrew via PM, 24 Nov: "Yes, add it"): approved and live, or sent
 * back with the one thing to change. Andrew's approved text; only the names, the link and the reason are filled
 * in. Plain text from hello@, logged in Mail. Andrew's own and test accounts (the credits exempt list) get none.
 */
export function plannerDecisionEmail(d: { approve: boolean; first: string; event: string; slug: string; reason?: string }): { subject: string; text: string } {
  const hi = `Hi ${d.first || "there"},`;
  if (d.approve) {
    return {
      subject: `Your event is live: ${d.event}`,
      text: [hi, "", `${d.event} is approved and live. Share its page so people can book a slot: ${ORIGIN}/event/${d.slug}`, "", "You'll see who's booked, and open your studio, under My events.", "", "The MilitaryVoices.ai team"].join("\n"),
    };
  }
  return {
    subject: `Your event needs a change: ${d.event}`,
    text: [hi, "", `Thanks for sending ${d.event}. Before it goes live, please change one thing:`, "", (d.reason ?? "").trim(), "", "Make the change under My events and send it back to us. We'll look again within a working day.", "", "The MilitaryVoices.ai team"].join("\n"),
  };
}
/** When they last sent it to us: one email per decision on each sending, however many times the button is pressed. */
const submittedKey = (id: number) => `planner-submitted:${id}`;
async function tellPlanner(e: typeof events.$inferSelect, approve: boolean, reason: string): Promise<"sent" | "skipped"> {
  const to = e.ownerEmail.trim().toLowerCase();
  if (!to || creditExempt(to)) return "skipped";
  const sentAt = (await storage.getSetting(submittedKey(e.id))) || "before-24-nov";
  const claimed = await db.insert(siteSettings).values({ key: `planner-mail:${e.id}:${approve ? "live" : "change"}:${sentAt}`, value: now() }).onConflictDoNothing().returning({ key: siteSettings.key });
  if (!claimed.length) return "skipped";
  const name = ((await storage.getProfileByEmail(to).catch(() => undefined))?.hostName ?? "").trim().split(/\s+/)[0] ?? "";
  const first = /^[A-Za-z][A-Za-z'’-]{1,}$/.test(name) ? name : "";
  const mail = plannerDecisionEmail({ approve, first, event: e.name, slug: e.slug, reason });
  if (process.env.PLANNER_MAIL_DRY === "1") { console.log(`[planner mail dry run] to ${to}: ${mail.subject}\n${mail.text}`); return "sent"; }
  const id = await sendOneOffEmail({ to, subject: mail.subject, html: "", text: mail.text, kind: approve ? "planner-live" : "planner-change", recipientName: first });
  return id ? "sent" : "skipped";
}

/**
 * Made and live: we hear about it in Slack, and the planner gets the "Your event is live" email (68f725d3) when it's
 * a lineup, whose approved text asks people to book a slot. A "Just me" event has no slots to book, so its email
 * waits for Andrew's go on its own wording (24 Nov) rather than saying the wrong thing.
 */
async function announce(e: typeof events.$inferSelect, me: string) {
  await slackNote(`:calendar: ${me} published an event: "${e.name}" (${new Date(e.startAtUtc).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}).`, { label: "See it", url: `${ORIGIN}/event/${e.slug}` }).catch(() => {});
  if (e.kind === "me") return;
  await storage.setSetting(submittedKey(e.id), now());
  await tellPlanner(e, true, "").catch((err) => console.error("Planner email failed:", (err as Error).message));
}

/** Off until Andrew's go on the exact text (24 Nov); Admin flips the setting. */
export const SIGNUP_MAIL_KEY = "event-signup-mail";
export function signupEmail(d: { first: string; event: string; day: string; time: string; zone: string; online: boolean; venue: string; address: string; joinUrl: string; pageUrl: string }): { subject: string; text: string } {
  const where = d.online ? (d.joinUrl ? `Online. Join here: ${d.joinUrl}` : "Online.") : [d.venue, d.address].filter(Boolean).join(", ");
  return {
    subject: `You're signed up: ${d.event}`,
    text: [`Hi ${d.first || "there"},`, "", `You're signed up for ${d.event}.`, "", `When: ${d.day} at ${d.time} ${d.zone}`, `Where: ${where}`, "", `Event page: ${d.pageUrl}`, "", "See you there,", "The MilitaryVoices.ai team"].join("\n"),
  };
}
async function confirmSignup(e: typeof events.$inferSelect, name: string, email: string) {
  if ((await storage.getSetting(SIGNUP_MAIL_KEY)) !== "on") return;
  const tz = e.timezone || "America/New_York";
  const first = name.split(/\s+/)[0] ?? "";
  const mail = signupEmail({
    first: /^[A-Za-z][A-Za-z'’-]{0,}$/.test(first) ? first : "", event: e.name,
    day: eventDay(e.startAtUtc, tz), time: eventTime(e.startAtUtc, tz), zone: zoneShort(tz, new Date(e.startAtUtc)),
    online: e.mode !== "person", venue: e.venueName, address: e.venueAddress, joinUrl: e.joinUrl, pageUrl: `${ORIGIN}/event/${e.slug}`,
  });
  if (process.env.PLANNER_MAIL_DRY === "1") { console.log(`[sign-up mail dry run] to ${email}: ${mail.subject}\n${mail.text}`); return; }
  await sendOneOffEmail({ to: email, subject: mail.subject, html: "", text: mail.text, kind: "event-signup", from: "The MilitaryVoices.ai team <hello@militaryvoices.ai>", recipientName: first });
}

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
    // 24 Nov: kind, where, its zone and end, who signs up, their questions, where online people join.
    ...(b.kind === "me" || b.kind === "lineup" ? { kind: b.kind } : {}),
    ...(b.mode === "online" || b.mode === "person" ? { mode: b.mode } : {}),
    ...(typeof b.timezone === "string" && validZone(b.timezone) ? { timezone: b.timezone } : {}),
    ...(str("endAtUtc", 40) && Number.isFinite(Date.parse(str("endAtUtc", 40)!)) ? { endAtUtc: new Date(str("endAtUtc", 40)!).toISOString() } : {}),
    // "paid" isn't built: anything else is free or nothing.
    ...(b.signupMode === "none" || b.signupMode === "free" ? { signupMode: b.signupMode } : {}),
    ...(b.questions !== undefined ? { questions: JSON.stringify(readQuestions(b.questions)) } : {}),
    ...(typeof b.joinUrl === "string" ? { joinUrl: /^https?:\/\/\S+$/i.test(b.joinUrl.trim()) ? b.joinUrl.trim().slice(0, 500) : "" } : {}),
  };
}
const validZone = (tz: string) => { try { return !!tz && tz.length < 64 && !!new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { return false; } };
/** A member's event's length from its start and end, for everything older that reads durationHours. */
function lengthOf(startIso: string, endIso: string) {
  const mins = Math.max(15, Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60000));
  return { durationHours: Math.min(48, Math.max(1, Math.ceil(mins / 60))), minutes: mins };
}

type Counts = { booked: number; registered?: number; clicks?: Record<string, number> };
const view = (e: typeof events.$inferSelect, c: number | Counts) => {
  const { booked, registered = 0, clicks = {} } = typeof c === "number" ? { booked: c } as Counts : c;
  return {
  id: e.id, slug: e.slug, name: e.name, tagline: e.tagline, description: e.description, occasion: e.occasion,
  kind: e.kind, mode: e.mode, timezone: e.timezone, endAtUtc: e.endAtUtc, signupMode: e.signupMode, questions: readQuestions(e.questions), joinUrl: e.joinUrl,
  registered, clicks, shareUrl: `${ORIGIN}/go/event/${e.id}`,
  venueName: e.venueName, venueAddress: e.venueAddress, airport: e.airport,
  startAtUtc: e.startAtUtc, durationHours: e.durationHours, slotMinutes: e.slotMinutes, onAirMinutes: e.onAirMinutes, bufferMinutes: e.bufferMinutes,
  review: e.review || "draft", visible: e.visible, booked, orgId: e.orgId,
  slots: Math.floor((e.durationHours * 60) / Math.max(1, e.slotMinutes)),
  pageUrl: `${ORIGIN}/event/${e.slug}`,
  bookUrl: `${ORIGIN}/event/${e.slug}/schedule`,
  };
};

export function registerOrganizer(app: Express, requireHostSession: RequestHandler, requireAdmin: RequestHandler) {
  // Theirs: made by them, or run by an organization they're on the team of.
  const whose = async (req: Request) => {
    const orgIds = await orgIdsOf(meOf(req));
    // Not the personal studio every member has: that is a studio, not an event they run.
    const notStudio = ne(events.occasion, "Personal studio");
    return orgIds.length ? and(notStudio, or(eq(events.ownerEmail, meOf(req)), inArray(events.orgId, orgIds))) : and(notStudio, eq(events.ownerEmail, meOf(req)));
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
    const ids = rows.map((e) => e.id);
    const regs = ids.length ? await db.select({ eventId: eventRegistrations.eventId, n: sql<number>`count(*)::int` }).from(eventRegistrations).where(inArray(eventRegistrations.eventId, ids)).groupBy(eventRegistrations.eventId) : [];
    const clicks = ids.length ? await db.select({ eventId: eventClicks.eventId, src: eventClicks.src, n: sql<number>`count(*)::int` }).from(eventClicks).where(inArray(eventClicks.eventId, ids)).groupBy(eventClicks.eventId, eventClicks.src) : [];
    for (const e of rows) {
      const n = (await db.select({ id: signups.id, status: signups.status }).from(signups).where(eq(signups.eventId, e.id))).filter((s) => s.status !== "cancelled").length;
      const byNet: Record<string, number> = {};
      for (const c of clicks) if (c.eventId === e.id) byNet[c.src || "link"] = Number(c.n);
      out.push(view(e, { booked: n, registered: Number(regs.find((r) => r.eventId === e.id)?.n ?? 0), clicks: byNet }));
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
    const count = (await db.select({ id: events.id }).from(events).where(and(eq(events.ownerEmail, me), ne(events.occasion, "Personal studio")))).length;
    if (count >= 10) return res.status(429).json({ message: "That's ten events. Finish or remove one first, or write to hello@militaryvoices.ai." });
    // It belongs to their organizer account (made now, the first time).
    const org = await organizerOrgFor(me, typeof req.body?.orgName === "string" ? req.body.orgName.slice(0, 120) : undefined);
    let slug = slugify(d.name);
    for (let i = 2; (await storage.getEventBySlug(slug)); i++) slug = `${slugify(d.name)}-${i}`;
    // Its length comes from its end; "Just me" is one slot the whole time.
    const kind = d.kind ?? "lineup";
    const len = d.endAtUtc ? lengthOf(d.startAtUtc, d.endAtUtc) : null;
    if (len && Date.parse(d.endAtUtc!) <= Date.parse(d.startAtUtc)) return res.status(400).json({ message: "It has to end after it starts." });
    const slotMinutes = kind === "me" ? Math.min(240, Math.max(10, len?.minutes ?? 60)) : d.slotMinutes ?? 30;
    // Live the moment it's made (Andrew, 24 Nov): no draft, no approval.
    const [row] = await db.insert(events).values({
      slug, name: d.name, tagline: d.tagline ?? "", description: d.description ?? "", occasion: d.occasion ?? "",
      startAtUtc: d.startAtUtc, durationHours: len?.durationHours ?? d.durationHours ?? 4, slotMinutes,
      onAirMinutes: kind === "me" ? slotMinutes : d.onAirMinutes ?? 25, bufferMinutes: kind === "me" ? 0 : d.bufferMinutes ?? 5, bufferPosition: "after",
      kind, mode: d.mode ?? "online", timezone: d.timezone ?? "America/New_York", endAtUtc: d.endAtUtc ?? "",
      signupMode: d.signupMode ?? "free", questions: d.questions ?? "[]", joinUrl: d.joinUrl ?? "",
      venueName: d.mode === "person" ? d.venueName ?? "" : "", venueAddress: d.mode === "person" ? d.venueAddress ?? "" : "", airport: d.airport ?? "",
      visible: true, isFeatured: false, closed: false, ownerEmail: me, review: "approved", orgId: org.id,
      // Never used for a planner's event (their studio access comes from ownership), but the column has no empty default.
      adminPassword: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
      createdAt: now(),
    }).returning();
    await announce(row, me);
    res.status(201).json(view(row, 0));
  });

  app.put("/api/host/my-events/:id", requireHostSession, async (req, res) => {
    const e = await mine(req, Number(req.params.id));
    if (!e) return res.status(404).json({ message: "That isn't one of your events." });
    const d = details(req.body ?? {});
    const start = d.startAtUtc ?? e.startAtUtc, end = d.endAtUtc ?? e.endAtUtc;
    if (end && Date.parse(end) <= Date.parse(start)) return res.status(400).json({ message: "It has to end after it starts." });
    const kind = d.kind ?? e.kind;
    const len = end ? lengthOf(start, end) : null;
    const fit = len ? { durationHours: len.durationHours, ...(kind === "me" ? { slotMinutes: Math.min(240, Math.max(10, len.minutes)), onAirMinutes: Math.min(240, Math.max(10, len.minutes)), bufferMinutes: 0 } : {}) } : {};
    const place = d.mode === "online" ? { venueName: "", venueAddress: "" } : {};
    const [row] = await db.update(events).set({ ...d, ...fit, ...place }).where(eq(events.id, e.id)).returning();
    res.json(view(row, 0));
  });

  /** A draft or waiting event from before 24 Nov: publishing it is theirs to do now, no approval. */
  app.post("/api/host/my-events/:id/submit", requireHostSession, async (req, res) => {
    const e = await mine(req, Number(req.params.id));
    if (!e) return res.status(404).json({ message: "That isn't one of your events." });
    if (e.review === "approved") return res.json(view(e, 0));
    const [row] = await db.update(events).set({ review: "approved", visible: true }).where(eq(events.id, e.id)).returning();
    await announce(row, meOf(req));
    res.json(view(row, 0));
  });

  app.delete("/api/host/my-events/:id", requireHostSession, async (req, res) => {
    const e = await mine(req, Number(req.params.id));
    if (!e) return res.status(404).json({ message: "That isn't one of your events." });
    // Theirs to remove while nobody's in it; once people have booked or signed up, we take it down with them.
    const booked = (await db.select({ status: signups.status }).from(signups).where(eq(signups.eventId, e.id))).some((s) => s.status !== "cancelled");
    const [reg] = await db.select({ id: eventRegistrations.id }).from(eventRegistrations).where(eq(eventRegistrations.eventId, e.id)).limit(1);
    if (booked || reg) return res.status(409).json({ message: "People are signed up for it. Write to hello@militaryvoices.ai to take it down." });
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

  /** Who signed up to attend, with their answers. */
  app.get("/api/host/my-events/:id/registrations", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const e = await mine(req, Number(req.params.id));
    if (!e) return res.status(404).json({ message: "That isn't one of your events." });
    const rows = await db.select().from(eventRegistrations).where(eq(eventRegistrations.eventId, e.id)).orderBy(desc(eventRegistrations.id));
    res.json(rows.map((r) => ({ id: r.id, name: r.name, email: r.email, src: r.src, at: r.createdAt, answers: (() => { try { return JSON.parse(r.answers || "[]") as { q: string; a: string }[]; } catch { return []; } })() })));
  });

  // ---- Public: the counted share link, and signing up ----------------------
  /** /go/event/42?src=linkedin: count it, then on to the event page (the source rides along for the sign-up). */
  app.get("/go/event/:id", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const [e] = await db.select({ id: events.id, slug: events.slug, visible: events.visible }).from(events).where(eq(events.id, Number(req.params.id) || 0)).limit(1);
    if (!e || !e.visible) return res.redirect(302, "/events");
    const src = String(req.query.src ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24) || "link";
    if (!/bot|crawl|spider|preview|facebookexternalhit|slackbot|linkedinbot|twitterbot/i.test(String(req.get("user-agent") ?? ""))) {
      db.insert(eventClicks).values({ eventId: e.id, src, createdAt: now() }).catch(() => {});
    }
    res.redirect(302, `/event/${e.slug}?src=${encodeURIComponent(src)}`);
  });

  /** Sign up to attend a member's event: name, email, their answers. One per person; a second is a no-op. */
  app.post("/api/event/:slug/register", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const e = await storage.getEventBySlug(String(req.params.slug));
    if (!e || !e.visible || !e.kind) return res.status(404).json({ message: "We couldn't find that event." });
    if (e.signupMode !== "free") return res.status(400).json({ message: "This event doesn't take sign-ups." });
    if (Date.parse(e.endAtUtc || e.startAtUtc) + (e.endAtUtc ? 0 : e.durationHours * 3600000) < Date.now()) return res.status(400).json({ message: "This event is over." });
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (typeof b.website === "string" && b.website) return res.json({ ok: true }); // the hidden field only bots fill
    const name = String(b.name ?? "").trim().slice(0, 120);
    const email = String(b.email ?? "").trim().toLowerCase().slice(0, 200);
    if (!name) return res.status(400).json({ message: "Add your name." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ message: "That email doesn't look right." });
    const qs = readQuestions(e.questions);
    const given = Array.isArray(b.answers) ? b.answers.map((a) => String(a ?? "").trim().slice(0, 500)) : [];
    const answers = qs.map((q, i) => ({ q: q.q, a: q.type === "choice" ? (q.options.includes(given[i]) ? given[i] : "") : given[i] ?? "" }));
    const src = String(b.src ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24);
    const added = await db.insert(eventRegistrations).values({ eventId: e.id, name, email, answers: JSON.stringify(answers), src, createdAt: now() }).onConflictDoNothing().returning({ id: eventRegistrations.id });
    // One email per sign-up, and only while the switch is on (off until Andrew approves the exact text).
    if (added.length) void confirmSignup(e, name, email).catch((err) => console.error("Sign-up email failed:", (err as Error).message));
    // Who signed up sees where to join an online event; nobody else does.
    res.json({ ok: true, joinUrl: e.mode === "online" ? e.joinUrl : "" });
  });

  // ---- Our side: the events waiting for approval ---------------------------
  app.get("/api/admin/planner-events", requireAdmin, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if ((req as { studioHost?: unknown }).studioHost) return res.status(403).json({ message: "Admins only." });
    await schemaIsReady();
    const rows = (await db.select().from(events).orderBy(desc(events.id))).filter((e) => e.ownerEmail && e.occasion !== "Personal studio");
    res.json(rows.map((e) => ({ ...view(e, 0), ownerEmail: e.ownerEmail })));
  });
  app.post("/api/admin/planner-events/:id/approve", requireAdmin, async (req, res) => {
    if ((req as { studioHost?: unknown }).studioHost) return res.status(403).json({ message: "Admins only." });
    const approve = req.body?.approve !== false;
    // Sending it back says what to change: the planner reads it in the email.
    const reason = String(req.body?.reason ?? "").trim().slice(0, 1000);
    if (!approve && !reason) return res.status(400).json({ message: "Say what they need to change." });
    const [before] = await db.select().from(events).where(eq(events.id, Number(req.params.id)));
    if (!before) return res.status(404).json({ message: "No such event." });
    const [row] = await db.update(events).set(approve ? { review: "approved", visible: true } : { review: "draft", visible: false }).where(eq(events.id, before.id)).returning();
    // Only a decision on one waiting for us is news to the planner; a second click finds it decided already.
    const mail = before.review === "pending" ? await tellPlanner(row, approve, reason).catch((err) => { console.error("Planner email failed:", (err as Error).message); return "skipped" as const; }) : "skipped";
    res.json({ ...view(row, 0), ownerEmail: row.ownerEmail, mail });
  });
}
