// The MilitaryVoices Digital Bureau: a live channel, Monday to Friday,
// 7 am to 10 pm Eastern, in 30- or 60-minute segments. A beta week, free.
//
// Each day is an ordinary event underneath (site_settings "dx:events" lists
// their ids), so the studio, run of show, reminders, Admin → Podcasters and
// the confirmation email with its calendar buttons all work as they did for
// the Marathon. What's its own is the way in: /digital-bureau, one page,
// pick a time and book it there, signed in with an emailed code. An hour is
// one booking holding two slots (signups.slot_span = 2).
import type { Express, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, storage } from "./storage.js";
import { insertSignupSchema, signups, type EventRow, type SignupRow } from "../shared/schema.js";

type Deps = {
  requireHostSession: RequestHandler;
  upload: { single: (field: string) => RequestHandler };
  savePhoto: (buf: Buffer) => Promise<{ url: string; originalUrl: string }>;
  sendConfirmation: (signup: SignupRow, event: EventRow, origin: string) => Promise<boolean>;
  notifyOrganiser: (signup: SignupRow, event: EventRow, origin: string, taken: number, total: number) => Promise<void>;
  calendarFor: (signup: SignupRow, event: EventRow, origin: string) => unknown;
};

export async function dxEventIds(): Promise<number[]> {
  try { return (JSON.parse((await storage.getSetting("dx:events")) ?? "[]") as number[]).filter(Number.isInteger); } catch { return []; }
}

const active = (s: SignupRow) => s.status !== "cancelled";
/** Every slot index a booking holds. */
const held = (s: SignupRow) => Array.from({ length: Math.max(1, s.slotSpan || 1) }, (_, k) => s.slotIndex + k);
const slotsIn = (ev: EventRow) => Math.floor((ev.durationHours * 60) / ev.slotMinutes);
const slotStartMs = (ev: EventRow, i: number) => Date.parse(ev.startAtUtc) + i * ev.slotMinutes * 60_000;

export function registerDigitalExperience(app: Express, d: Deps): void {
  /** The week: each day's slots, open or whose. Public; no contact details. */
  app.get("/api/dx", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const days = [];
    for (const id of await dxEventIds()) {
      const ev = await storage.getEventById(id);
      if (!ev) continue;
      const list = (await storage.listSignups(ev.id)).filter(active);
      const owner = new Map<number, { id: number; show: string; host: string; photo: string; first: boolean; span: number }>();
      for (const s of list) held(s).forEach((i, k) => owner.set(i, { id: s.id, show: s.podcastName, host: s.hostName, photo: s.photoUrl, first: k === 0, span: s.slotSpan || 1 }));
      days.push({
        eventId: ev.id,
        name: ev.name,
        startAtUtc: ev.startAtUtc,
        slotMinutes: ev.slotMinutes,
        onAirMinutes: ev.onAirMinutes,
        bufferMinutes: ev.bufferMinutes,
        closed: ev.closed,
        slots: Array.from({ length: slotsIn(ev) }, (_, i) => {
          const o = owner.get(i);
          return { index: i, startAtUtc: new Date(slotStartMs(ev, i)).toISOString(), past: slotStartMs(ev, i) <= Date.now(), taken: o ?? null };
        }),
      });
    }
    res.json({ days });
  });

  /** What this person already has, to show on the page and in their account. */
  app.get("/api/dx/mine", d.requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const email = String((req as any).hostEmail).trim().toLowerCase();
    const profile = await storage.getProfileByEmail(email);
    const origin = `${req.protocol}://${req.get("host")}`;
    const bookings = [];
    for (const id of await dxEventIds()) {
      const ev = await storage.getEventById(id);
      if (!ev) continue;
      for (const s of (await storage.listSignups(ev.id)).filter((x) => active(x) && x.email.trim().toLowerCase() === email)) {
        bookings.push({ id: s.id, eventId: ev.id, day: ev.name, slotIndex: s.slotIndex, span: s.slotSpan || 1, show: s.podcastName, host: s.hostName, photo: s.photoUrl, about: s.notes, startAtUtc: new Date(slotStartMs(ev, s.slotIndex)).toISOString(), endAtUtc: new Date(slotStartMs(ev, s.slotIndex + (s.slotSpan || 1))).toISOString(), calendar: d.calendarFor(s, ev, origin) });
      }
    }
    const lastShow = profile?.podcastName || "";
    res.json({ email, profile: profile ? { hostName: profile.hostName, phone: profile.phone, photoUrl: profile.photoUrl, podcastName: lastShow, link: profile.rssUrl || profile.youtubeUrl || "" } : null, bookings });
  });

  /** Fine-tune a booking from their account: what they'll do, and the show's name. */
  app.patch("/api/dx/booking/:id", d.requireHostSession, async (req, res) => {
    const email = String((req as any).hostEmail).trim().toLowerCase();
    const s = await storage.getSignupById(Number(req.params.id));
    if (!s || s.status === "cancelled" || !(await dxEventIds()).includes(s.eventId) || s.email.trim().toLowerCase() !== email) return res.status(404).json({ message: "That booking isn't yours." });
    const about = typeof req.body?.about === "string" ? req.body.about.trim().slice(0, 600) : undefined;
    const show = typeof req.body?.show === "string" ? req.body.show.trim().slice(0, 120) : undefined;
    if (about === "") return res.status(400).json({ message: "Add what you'll do: your topic or episode title." });
    if (show === "") return res.status(400).json({ message: "Add the name of your show or segment." });
    if (about !== undefined) await db.update(signups).set({ notes: about }).where(eq(signups.id, s.id));
    if (show !== undefined) await storage.setSignupPodcastName(s.id, show);
    res.json({ ok: true });
  });

  /**
   * Book a time. Signed in (an emailed code), so it lands in their account.
   * Multipart: the fields, and a photo when they don't have one on file yet.
   */
  app.post("/api/dx/book", d.requireHostSession, (req, res, next) => {
    d.upload.single("photo")(req, res, (err?: unknown) => (err ? res.status(400).json({ message: (err as Error).message || "Couldn't take that photo." }) : next()));
  }, async (req, res) => {
    const email = String((req as any).hostEmail).trim().toLowerCase();
    const b = req.body as Record<string, string>;
    const eventId = Number(b.eventId);
    const slotIndex = Number(b.slotIndex);
    const span = Number(b.span) === 2 ? 2 : 1;
    const hostName = String(b.hostName ?? "").trim().slice(0, 120);
    const showName = String(b.showName ?? "").trim().slice(0, 120);
    const phone = String(b.phone ?? "").trim().slice(0, 40);
    const link = String(b.link ?? "").trim().slice(0, 500);
    const about = String(b.about ?? "").trim().slice(0, 600);
    if (!(await dxEventIds()).includes(eventId)) return res.status(404).json({ message: "That day isn't part of the Digital Bureau." });
    const ev = await storage.getEventById(eventId);
    if (!ev) return res.status(404).json({ message: "That day isn't part of the Digital Bureau." });
    if (!hostName) return res.status(400).json({ message: "Add your name." });
    if (!showName) return res.status(400).json({ message: "Add the name of your show or segment." });
    if (!about) return res.status(400).json({ message: "Add what you'll do: your topic or episode title." });
    if (link && !/^https?:\/\/\S+$/i.test(link)) return res.status(400).json({ message: "The link should start with https://" });
    if (ev.closed) return res.status(409).json({ message: "That day's schedule is closed." });
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex + span > slotsIn(ev)) return res.status(400).json({ message: span === 2 ? "An hour doesn't fit there: the day ends at 10 pm." : "That time isn't on the schedule." });
    if (slotStartMs(ev, slotIndex) <= Date.now()) return res.status(400).json({ message: "That time has already passed." });

    // Taken, by anyone: every slot a booking holds, so an hour blocks both halves.
    const list = (await storage.listSignups(ev.id)).filter(active);
    const want = Array.from({ length: span }, (_, k) => slotIndex + k);
    const clash = list.find((s) => held(s).some((i) => want.includes(i)));
    if (clash) {
      const mine = clash.email.trim().toLowerCase() === email;
      return res.status(409).json({ message: mine ? "You already have this time. It's in your account." : span === 2 ? "Part of that hour was just taken. Pick another time, or take 30 minutes." : "Someone just took that time. Pick another." });
    }
    // One booking a day each, so the week has room for everyone; another day is fine.
    if (list.some((s) => s.email.trim().toLowerCase() === email)) return res.status(409).json({ message: "You already have a time that day. Pick another day, or cancel that one first." });

    // Their photo goes on the station's on-air graphics: one on file, or the one they just added.
    let profile = await storage.getProfileByEmail(email);
    let photoUrl = profile?.photoUrl || "";
    if ((req as any).file) {
      try {
        const saved = await d.savePhoto((req as any).file.buffer);
        photoUrl = saved.url;
        profile = await storage.upsertProfile(email, { photoUrl: saved.url, photoOriginalUrl: saved.originalUrl } as any);
      } catch {
        return res.status(400).json({ message: "That photo couldn't be used. Try a different one (a JPG or PNG)." });
      }
    }
    if (!photoUrl) return res.status(400).json({ message: "Add a photo of yourself: it shows on screen while you're on." });
    const youtube = /youtube\.com|youtu\.be/i.test(link);
    profile = await storage.upsertProfile(email, {
      hostName,
      ...(phone ? { phone } : {}),
      ...(!profile?.podcastName ? { podcastName: showName } : {}),
      ...(link && youtube && !profile?.youtubeUrl ? { youtubeUrl: link } : {}),
      ...(link && !youtube && !profile?.rssUrl ? { rssUrl: link } : {}),
    } as any);
    await storage.upsertEventShow(email, ev.id, { showName, showFormat: "live", interviewNeed: "none" });

    const parsed = insertSignupSchema.safeParse({
      eventId: ev.id,
      slotIndex,
      slotSpan: span,
      podcastName: showName,
      hostName,
      email,
      phone: phone || profile.phone,
      numPeople: profile.numPeople || 1,
      hasVideoIntro: false,
      hasVideoOutro: false,
      hasSlides: false,
      hasImages: false,
      needsInterviewer: false,
      socialLinks: profile.socialLinks,
      rssUrl: profile.rssUrl,
      youtubeUrl: profile.youtubeUrl,
      socialAccounts: profile.socialAccounts,
      showFormat: "live",
      branch: profile.branch,
      serviceStatus: profile.serviceStatus,
      notes: about,
      timezone: String(b.timezone ?? "").slice(0, 60),
      photoUrl,
    });
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Something in the form isn't right." });
    const created = await storage.createSignup(parsed.data);
    const origin = `${req.protocol}://${req.get("host")}`;
    const all = (await storage.listSignups(ev.id)).filter(active);
    await Promise.allSettled([
      d.sendConfirmation(created, ev, origin),
      d.notifyOrganiser(created, ev, origin, all.reduce((n, s) => n + (s.slotSpan || 1), 0), slotsIn(ev)),
    ]);
    res.status(201).json({ id: created.id, show: created.podcastName, host: created.hostName, photo: created.photoUrl, day: ev.name, startAtUtc: new Date(slotStartMs(ev, slotIndex)).toISOString(), endAtUtc: new Date(slotStartMs(ev, slotIndex + span)).toISOString(), calendar: d.calendarFor(created, ev, origin) });
  });
}
