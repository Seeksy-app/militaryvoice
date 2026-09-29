import type { Express, Request, RequestHandler } from "express";
import crypto from "node:crypto";
import multer from "multer";
import sharp from "sharp";
import { and, eq, inArray } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { requireHostSession, getSessionEmail } from "./session.js";
import { uploadPhoto } from "./photoStorage.js";
import { sendGuestInviteEmail } from "./email.js";
import { showGuests, type ShowGuestRow } from "../shared/schema.js";

/**
 * Guests on a podcaster's slot. The podcaster (or the crew, for them) adds each
 * one: their name and title as read and shown on air, a few lines to introduce
 * them, a photo, and an email to send their link to. Each guest has their own
 * link into the green room; it needs no account, and it ties them to the
 * booking so they come on stage with their host.
 */

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const now = () => new Date().toISOString();
const photos = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
const str = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const MAX_GUESTS = 12;

/** Their link into the green room. */
/** The public side of each show's guests (for the agenda): no emails, no links. */
export async function publicGuestsFor(signupIds: number[]): Promise<Map<number, { name: string; title: string; photoUrl: string; intro: string }[]>> {
  const out = new Map<number, { name: string; title: string; photoUrl: string; intro: string }[]>();
  if (!signupIds.length) return out;
  await schemaIsReady();
  const rows = await db.select().from(showGuests).where(inArray(showGuests.signupId, signupIds)).orderBy(showGuests.id);
  for (const g of rows) {
    if (!g.name.trim()) continue;
    out.set(g.signupId, [...(out.get(g.signupId) ?? []), { name: g.name, title: g.title, photoUrl: g.photoUrl, intro: g.intro }]);
  }
  return out;
}

export const guestLink = (g: Pick<ShowGuestRow, "signupId" | "token">) => `${ORIGIN}/studio?s=${g.signupId}&g=${g.token}`;

/** A guest by the token in their link (only while the booking stands). */
export async function guestByToken(token: string): Promise<ShowGuestRow | null> {
  if (!/^[\w-]{16,64}$/.test(token)) return null;
  await schemaIsReady();
  const [g] = await db.select().from(showGuests).where(eq(showGuests.token, token)).limit(1);
  if (!g) return null;
  const sg = await storage.getSignupById(g.signupId);
  return sg && sg.status !== "cancelled" ? g : null;
}

/** They came into the green room through their link. */
export async function markGuestJoined(id: number): Promise<void> {
  await db.update(showGuests).set({ joinedAt: now() }).where(and(eq(showGuests.id, id), eq(showGuests.joinedAt, "")));
}

/** What the podcaster (and the crew) see of a guest: everything, with their link. */
const view = (g: ShowGuestRow) => ({ id: g.id, signupId: g.signupId, name: g.name, title: g.title, intro: g.intro, photoUrl: g.photoUrl, email: g.email, link: guestLink(g), invitedAt: g.invitedAt, joinedAt: g.joinedAt });

export function registerGuests(app: Express, requireAdmin: RequestHandler) {
  /** The booking, if this request may manage its guests: its podcaster, its co-host, or the crew. */
  const bookingFor = async (req: Request, signupId: number, admin: boolean) => {
    const sg = Number.isFinite(signupId) && signupId > 0 ? await storage.getSignupById(signupId) : undefined;
    if (!sg || sg.status === "cancelled") return null;
    if (admin) return sg;
    const me = (getSessionEmail(req) ?? "").trim().toLowerCase();
    return me && (sg.email.trim().toLowerCase() === me || (sg.coHostEmail ?? "").trim().toLowerCase() === me) ? sg : null;
  };
  const guestFor = async (req: Request, id: number, admin: boolean) => {
    await schemaIsReady();
    const [g] = await db.select().from(showGuests).where(eq(showGuests.id, id)).limit(1);
    return g && (await bookingFor(req, g.signupId, admin)) ? g : null;
  };

  for (const [base, guard, admin] of [["/api/host/guests", requireHostSession, false], ["/api/admin/guests", requireAdmin, true]] as const) {
    app.get(base, guard, async (req, res) => {
      await schemaIsReady();
      const sg = await bookingFor(req, Number(req.query.signupId), admin);
      if (!sg) return res.status(404).json({ message: "No such booking." });
      const rows = await db.select().from(showGuests).where(eq(showGuests.signupId, sg.id)).orderBy(showGuests.id);
      res.json({ guests: rows.map(view) });
    });

    app.post(base, guard, async (req, res) => {
      await schemaIsReady();
      const sg = await bookingFor(req, Number(req.body?.signupId), admin);
      if (!sg) return res.status(404).json({ message: "No such booking." });
      const have = await db.select({ id: showGuests.id }).from(showGuests).where(eq(showGuests.signupId, sg.id));
      if (have.length >= MAX_GUESTS) return res.status(400).json({ message: `Up to ${MAX_GUESTS} guests on a slot.` });
      const name = str(req.body?.name, 80);
      if (!name) return res.status(400).json({ message: "Add their name." });
      const email = str(req.body?.email, 200).toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "That email doesn't look right." });
      const [g] = await db.insert(showGuests).values({
        signupId: sg.id, eventId: sg.eventId, ownerEmail: admin ? sg.email : (getSessionEmail(req) ?? sg.email),
        name, title: str(req.body?.title, 120), intro: str(req.body?.intro, 1200), email,
        token: crypto.randomBytes(18).toString("base64url"), createdAt: now(),
      }).returning();
      res.status(201).json({ guest: view(g) });
    });

    app.patch(`${base}/:id`, guard, async (req, res) => {
      const g = await guestFor(req, Number(req.params.id), admin);
      if (!g) return res.status(404).json({ message: "No such guest." });
      const b = req.body ?? {};
      const email = typeof b.email === "string" ? str(b.email, 200).toLowerCase() : undefined;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "That email doesn't look right." });
      const patch = {
        ...(typeof b.name === "string" && str(b.name, 80) ? { name: str(b.name, 80) } : {}),
        ...(typeof b.title === "string" ? { title: str(b.title, 120) } : {}),
        ...(typeof b.intro === "string" ? { intro: str(b.intro, 1200) } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(b.photoUrl === "" ? { photoUrl: "" } : {}),
        updatedAt: now(),
      };
      const [out] = await db.update(showGuests).set(patch).where(eq(showGuests.id, g.id)).returning();
      res.json({ guest: view(out) });
    });

    app.delete(`${base}/:id`, guard, async (req, res) => {
      const g = await guestFor(req, Number(req.params.id), admin);
      if (!g) return res.status(404).json({ message: "No such guest." });
      await db.delete(showGuests).where(eq(showGuests.id, g.id));
      res.json({ ok: true });
    });

    // Their photo: a square headshot, for the run of show and the crew.
    app.post(`${base}/:id/photo`, guard, photos.single("file"), async (req, res) => {
      const g = await guestFor(req, Number(req.params.id), admin);
      if (!g) return res.status(404).json({ message: "No such guest." });
      if (!req.file) return res.status(400).json({ message: "Choose a photo." });
      try {
        const img = await sharp(req.file.buffer).rotate().resize(800, 800, { fit: "cover", position: "attention" }).jpeg({ quality: 86 }).toBuffer();
        const url = await uploadPhoto(`guests/${g.id}-${Date.now()}.jpg`, img, "image/jpeg");
        const [out] = await db.update(showGuests).set({ photoUrl: url, updatedAt: now() }).where(eq(showGuests.id, g.id)).returning();
        res.json({ guest: view(out) });
      } catch {
        res.status(400).json({ message: "Couldn't read that photo. Try a JPG or PNG." });
      }
    });

    // Email the guest their link (they asked us to: the button says so).
    app.post(`${base}/:id/invite`, guard, async (req, res) => {
      const g = await guestFor(req, Number(req.params.id), admin);
      if (!g) return res.status(404).json({ message: "No such guest." });
      if (!g.email) return res.status(400).json({ message: "Add their email first." });
      const sg = await storage.getSignupById(g.signupId);
      const ev = sg ? await storage.getEventById(sg.eventId) : undefined;
      if (!sg || !ev) return res.status(404).json({ message: "No such booking." });
      const start = new Date(new Date(ev.startAtUtc).getTime() + sg.slotIndex * ev.slotMinutes * 60_000);
      const tz = sg.timezone || "America/New_York";
      let whenLabel = "";
      try {
        const when = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(start);
        const zone = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(start).find((p) => p.type === "timeZoneName")?.value ?? "";
        whenLabel = `${when} ${zone}`.trim();
      } catch { whenLabel = ""; }
      const ok = await sendGuestInviteEmail({ to: g.email, guestName: g.name, hostName: sg.hostName, show: sg.podcastName, eventName: ev.name, whenLabel, link: guestLink(g), replyTo: sg.email });
      if (!ok) return res.status(502).json({ message: "The email didn't go. Try again in a moment, or copy their link." });
      const [out] = await db.update(showGuests).set({ invitedAt: now() }).where(eq(showGuests.id, g.id)).returning();
      res.json({ guest: view(out) });
    });
  }

  // The guest's own look at who invited them, for the green room's welcome (their link is their key).
  app.get("/api/public/guest/:token", async (req, res) => {
    const g = await guestByToken(String(req.params.token));
    if (!g) return res.status(404).json({ message: "That guest link isn't working. Ask your host for a new one." });
    const sg = await storage.getSignupById(g.signupId);
    const ev = sg ? await storage.getEventById(sg.eventId) : undefined;
    const host = sg ? await storage.getProfileByEmail(sg.email).catch(() => undefined) : undefined;
    // Their host's event's studio: the page talks to that one, whichever event it would pick by itself.
    const studio = ev ? await storage.getOrCreateStudio(ev.id) : undefined;
    res.json({ name: g.name, title: g.title, photoUrl: g.photoUrl, host: { name: sg?.hostName ?? "", photoUrl: host?.photoUrl ?? "" }, show: sg?.podcastName ?? "", eventName: ev?.name ?? "", eventSlug: ev?.slug ?? "", studioId: studio?.id ?? null });
  });
}
