import type { Express, Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import multer from "multer";
import sharp from "sharp";
import { storage } from "./storage.js";
import { uploadPhoto } from "./photoStorage.js";
import {
  insertSignupSchema,
  insertReminderSchema,
  insertEventSchema,
  updateEventSchema,
  insertProfileSchema,
  type PublicEvent,
  type PublicSignup,
  type PublicPodcaster,
  type EventRow,
} from "../shared/schema.js";
import { fromError } from "zod-validation-error";
import { sendConfirmationEmail, sendLoginCodeEmail } from "./email.js";
import { setSessionCookie, clearSessionCookie, requireHostSession } from "./session.js";
import {
  isUploadPostConfigured,
  ensureUploadPostProfile,
  createConnectUrl,
  fetchConnectedAccounts,
  parseSocialAccounts,
} from "./uploadPost.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB raw upload cap, before enhancement/compression
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Please upload an image file."));
      return;
    }
    cb(null, true);
  },
});

// "Enhance" a submitted photo: normalize exposure/contrast, sharpen slightly,
// crop to a consistent square, re-encode as a reasonably sized JPEG, and store
// it in Supabase Storage so it survives across serverless invocations.
async function enhanceAndSavePhoto(buffer: Buffer): Promise<string> {
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.jpg`;
  const processed = await sharp(buffer)
    .rotate() // respect EXIF orientation
    .resize(720, 720, { fit: "cover", position: "attention" })
    .normalize() // auto-level contrast
    .sharpen()
    .jpeg({ quality: 88 })
    .toBuffer();
  return uploadPhoto(filename, processed);
}

function toPublicEvent(event: EventRow): PublicEvent {
  const { adminPassword, ...rest } = event;
  return rest;
}

function toPublicSignup(s: Awaited<ReturnType<typeof storage.listSignups>>[number]): PublicSignup {
  return {
    id: s.id,
    eventId: s.eventId,
    slotIndex: s.slotIndex,
    podcastName: s.podcastName,
    hostName: s.hostName,
    photoUrl: s.photoUrl,
    numPeople: s.numPeople,
    hasVideoIntro: s.hasVideoIntro,
    hasVideoOutro: s.hasVideoOutro,
    hasSlides: s.hasSlides,
    hasImages: s.hasImages,
    needsInterviewer: s.needsInterviewer,
    socialLinks: s.socialLinks,
    rssUrl: s.rssUrl,
    youtubeUrl: s.youtubeUrl,
    socialAccounts: s.socialAccounts,
    status: s.status,
  };
}

// ICS timestamp format: YYYYMMDDTHHMMSSZ
function toIcsUtcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function formatTimeInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(date);
}

function formatDateTimeInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/** Mirrors client/src/lib/schedule.ts onAirWindow() for use in the server (emails, ICS). */
function onAirWindowServer(
  blockStart: Date,
  onAirMinutes: number,
  bufferMinutes: number,
  bufferPosition: string
): { start: Date; end: Date } {
  if (bufferPosition === "before") {
    const start = new Date(blockStart.getTime() + bufferMinutes * 60000);
    return { start, end: new Date(start.getTime() + onAirMinutes * 60000) };
  }
  return { start: blockStart, end: new Date(blockStart.getTime() + onAirMinutes * 60000) };
}

function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const password = (req.header("x-admin-password") || (req.query.password as string) || "").trim();
  const event = await storage.getFeaturedEvent();
  if (!password || password !== event.adminPassword) {
    res.status(401).json({ message: "Invalid admin password" });
    return;
  }
  next();
}

export function registerRoutes(app: Express): void {
  // ---- Public: events list (for "Choose Your Event") -------------------------
  app.get("/api/events", async (_req, res) => {
    const rows = await storage.listEvents();
    res.json(rows.map(toPublicEvent));
  });

  // ---- Public: event config (featured by default, or ?slug=) -----------------
  app.get("/api/event", async (req, res) => {
    const slug = typeof req.query.slug === "string" ? req.query.slug : undefined;
    const event = slug ? await storage.getEventBySlug(slug) : await storage.getFeaturedEvent();
    if (!event) {
      res.status(404).json({ message: "Event not found" });
      return;
    }
    res.json(toPublicEvent(event));
  });

  // ---- Public: schedule (privacy-safe signup fields only) -------------------
  // ---- Public: podcasters with a finished profile (for the homepage spotlight).
  //      No contact info leaves the server.
  app.get("/api/podcasters", async (_req, res) => {
    const rows = await storage.listCompleteProfiles();
    const out: PublicPodcaster[] = rows.map((p) => ({
      id: p.id,
      podcastName: p.podcastName,
      hostName: p.hostName,
      photoUrl: p.photoUrl,
      numPeople: p.numPeople,
      socialLinks: p.socialLinks,
      rssUrl: p.rssUrl,
      youtubeUrl: p.youtubeUrl,
      socialAccounts: p.socialAccounts,
    }));
    res.json(out);
  });

  app.get("/api/signups", async (req, res) => {
    let eventId = req.query.eventId ? Number(req.query.eventId) : undefined;
    if (!eventId) {
      const featured = await storage.getFeaturedEvent();
      eventId = featured.id;
    }
    const rows = await storage.listSignups(eventId);
    res.json(rows.filter((r) => r.status !== "cancelled").map(toPublicSignup));
  });

  // ---- Host (podcaster, logged in): claim a slot. Reuses their saved profile
  //      (name, photo, etc.) instead of asking for it again — a plain JSON
  //      body with just eventId + slotIndex is all that's needed here now.
  app.post("/api/signups", requireHostSession, async (req, res) => {
    const email = (req as any).hostEmail as string;
    const profile = await storage.getProfileByEmail(email);
    if (!profile || !profile.podcastName || !profile.hostName || !profile.photoUrl) {
      res.status(400).json({ message: "Set up your podcaster profile before claiming a slot." });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const featured = await storage.getFeaturedEvent();
    const eventId = body.eventId ? Number(body.eventId) : featured.id;
    const raw = {
      eventId,
      slotIndex: Number(body.slotIndex),
      podcastName: profile.podcastName,
      hostName: profile.hostName,
      email,
      phone: profile.phone,
      numPeople: profile.numPeople,
      hasVideoIntro: profile.hasVideoIntro,
      hasVideoOutro: profile.hasVideoOutro,
      hasSlides: profile.hasSlides,
      hasImages: profile.hasImages,
      needsInterviewer: profile.needsInterviewer,
      socialLinks: profile.socialLinks,
      rssUrl: profile.rssUrl,
      youtubeUrl: profile.youtubeUrl,
      socialAccounts: profile.socialAccounts,
      notes: profile.notes,
      timezone: typeof body.timezone === "string" ? body.timezone : "",
      photoUrl: profile.photoUrl,
    };

    const parsed = insertSignupSchema.safeParse(raw);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }

    const event = await storage.getEventById(parsed.data.eventId);
    if (!event) {
      res.status(400).json({ message: "That event no longer exists." });
      return;
    }
    const totalSlots = Math.floor((event.durationHours * 60) / event.slotMinutes);
    if (parsed.data.slotIndex >= totalSlots) {
      res.status(400).json({ message: "That slot doesn't exist on the current schedule." });
      return;
    }

    const existing = await storage.getSignupBySlot(parsed.data.eventId, parsed.data.slotIndex);
    if (existing && existing.status !== "cancelled") {
      res.status(409).json({ message: "That slot was just claimed by someone else. Pick another." });
      return;
    }

    const created = await storage.createSignup(parsed.data);
    res.status(201).json(toPublicSignup(created));

    // Send the confirmation email in the background — never block or fail the
    // signup response on email delivery.
    (async () => {
      try {
        const blockStart = new Date(new Date(event.startAtUtc).getTime() + created.slotIndex * event.slotMinutes * 60000);
        const blockEnd = new Date(blockStart.getTime() + event.slotMinutes * 60000);
        const tz = created.timezone || "America/New_York";
        const onAir = onAirWindowServer(blockStart, event.onAirMinutes, event.bufferMinutes, event.bufferPosition);
        const protocol = req.protocol;
        const host = req.get("host");
        const agendaUrl = `${protocol}://${host}/agenda`;
        await sendConfirmationEmail({
          to: created.email,
          hostName: created.hostName,
          podcastName: created.podcastName,
          eventName: event.name,
          blockStartLabel: formatDateTimeInZone(blockStart, tz),
          blockEndLabel: formatTimeInZone(blockEnd, tz),
          onAirStartLabel: formatDateTimeInZone(onAir.start, tz),
          onAirEndLabel: formatTimeInZone(onAir.end, tz),
          bufferMinutes: event.bufferMinutes,
          bufferPosition: (event.bufferPosition as "before" | "after") ?? "after",
          timezoneLabel: tz,
          agendaUrl,
        });
      } catch (err) {
        console.error("Failed to send signup confirmation email:", err);
      }
    })();
  });

  // ---- Public: download a personal calendar reminder for a slot --------------
  app.get("/api/signups/:id/calendar.ics", async (req, res) => {
    const id = Number(req.params.id);
    const signup = await storage.getSignupById(id);
    if (!signup || signup.status === "cancelled") {
      res.status(404).json({ message: "Signup not found" });
      return;
    }
    const event = (await storage.getEventById(signup.eventId)) ?? (await storage.getFeaturedEvent());
    const start = new Date(new Date(event.startAtUtc).getTime() + signup.slotIndex * event.slotMinutes * 60000);
    const end = new Date(start.getTime() + event.slotMinutes * 60000);
    const tz = signup.timezone || "America/New_York";
    const onAir = onAirWindowServer(start, event.onAirMinutes, event.bufferMinutes, event.bufferPosition);
    const bufferNote =
      event.bufferMinutes > 0
        ? ` (on air ${formatTimeInZone(onAir.start, tz)}–${formatTimeInZone(onAir.end, tz)} ${tz}, with a ${event.bufferMinutes}-minute buffer ${event.bufferPosition} for sponsor/transition)`
        : "";

    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//MilitaryVoice.ai//Podcast Marathon//EN",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:militaryvoice-signup-${signup.id}@militaryvoice.ai`,
      `DTSTAMP:${toIcsUtcStamp(new Date())}`,
      `DTSTART:${toIcsUtcStamp(start)}`,
      `DTEND:${toIcsUtcStamp(end)}`,
      `SUMMARY:${icsEscape(`${signup.podcastName} — MilitaryVoice.ai Podcast Marathon`)}`,
      `DESCRIPTION:${icsEscape(`${signup.hostName} is live on the MilitaryVoice.ai 24-Hour Podcast Marathon. Tune in!${bufferNote}`)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="militaryvoice-${signup.id}.ics"`);
    res.send(ics);
  });

  // ---- Public: a fan asks to be emailed a reminder before a slot goes live ---
  app.post("/api/reminders", async (req, res) => {
    const parsed = insertReminderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const signup = await storage.getSignupById(parsed.data.signupId);
    if (!signup || signup.status === "cancelled") {
      res.status(404).json({ message: "That slot couldn't be found." });
      return;
    }
    const created = await storage.createReminder(parsed.data);
    res.status(201).json({ id: created.id });
  });

  // ---- Admin: auth check ------------------------------------------------------
  app.post("/api/admin/login", async (req, res) => {
    const password = (req.body?.password || "").trim();
    const event = await storage.getFeaturedEvent();
    if (!password || password !== event.adminPassword) {
      res.status(401).json({ message: "Incorrect password" });
      return;
    }
    res.json({ ok: true });
  });

  // ---- Admin: all events (for the events management screen) ------------------
  app.get("/api/admin/events", requireAdmin, async (_req, res) => {
    const rows = await storage.listEvents();
    res.json(rows.map(toPublicEvent));
  });

  app.post("/api/admin/events", requireAdmin, async (req, res) => {
    const parsed = insertEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const created = await storage.createEvent(parsed.data);
    res.status(201).json(toPublicEvent(created));
  });

  app.put("/api/admin/events/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const parsed = updateEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const updated = await storage.updateEvent(id, parsed.data);
    if (!updated) {
      res.status(404).json({ message: "Event not found" });
      return;
    }
    res.json(toPublicEvent(updated));
  });

  // ---- Admin: full event settings (alias for the currently featured event) ---
  // Note: adminPassword is intentionally stripped from the response even though
  // this route requires auth — it should never round-trip back to the browser.
  app.get("/api/admin/event", requireAdmin, async (_req, res) => {
    const event = await storage.getFeaturedEvent();
    res.json(toPublicEvent(event));
  });

  app.put("/api/admin/event", requireAdmin, async (req, res) => {
    const parsed = updateEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const featured = await storage.getFeaturedEvent();
    const updated = await storage.updateEvent(featured.id, parsed.data);
    res.json(toPublicEvent(updated!));
  });

  // ---- Admin: full signups list (with contact info) ---------------------------
  app.get("/api/admin/signups", requireAdmin, async (req, res) => {
    const eventId = req.query.eventId ? Number(req.query.eventId) : undefined;
    const rows = await storage.listSignups(eventId);
    res.json(rows);
  });

  app.patch("/api/admin/signups/:id/cancel", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const updated = await storage.cancelSignup(id);
    if (!updated) {
      res.status(404).json({ message: "Signup not found" });
      return;
    }
    res.json(updated);
  });

  app.delete("/api/admin/signups/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    await storage.deleteSignup(id);
    res.json({ ok: true });
  });

  // ---- Admin: fans who asked to be emailed a reminder --------------------------
  app.get("/api/admin/reminders", requireAdmin, async (_req, res) => {
    const [reminderRows, signupRows] = await Promise.all([storage.listReminders(), storage.listSignups()]);
    const signupsById = new Map(signupRows.map((s) => [s.id, s]));
    const enriched = reminderRows.map((r) => {
      const signup = signupsById.get(r.signupId);
      return {
        id: r.id,
        email: r.email,
        createdAt: r.createdAt,
        signupId: r.signupId,
        podcastName: signup?.podcastName ?? "(deleted signup)",
        hostName: signup?.hostName ?? "",
      };
    });
    res.json(enriched);
  });

  // ---- Admin: CSV export (query-string auth so it works as a plain link) ------
  app.get("/api/admin/export.csv", requireAdmin, async (_req, res) => {
    const rows = await storage.listSignups();
    const header = [
      "slot_index",
      "podcast_name",
      "host_name",
      "email",
      "phone",
      "num_people",
      "video_intro",
      "video_outro",
      "slides",
      "images",
      "needs_interviewer",
      "social_links",
      "notes",
      "status",
      "created_at",
    ];
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.slotIndex,
          r.podcastName,
          r.hostName,
          r.email,
          r.phone,
          r.numPeople,
          r.hasVideoIntro,
          r.hasVideoOutro,
          r.hasSlides,
          r.hasImages,
          r.needsInterviewer,
          r.socialLinks,
          r.notes,
          r.status,
          r.createdAt,
        ]
          .map(escape)
          .join(",")
      );
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=militaryvoice-signups.csv");
    res.send(lines.join("\n"));
  });

  // ---- Host: request a typed sign-in code -------------------------------------
  app.post("/api/host/request-code", async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      res.status(400).json({ message: "Enter a valid email" });
      return;
    }
    const code = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await storage.createLoginToken(email, code, expiresAt);
    if (!process.env.RESEND_API_KEY && process.env.NODE_ENV !== "production") {
      // Local dev without Resend: surface the code in the terminal so sign-in still works.
      console.log(`[dev] login code for ${email}: ${code}`);
    }
    await sendLoginCodeEmail({ to: email, code });
    res.json({ ok: true, message: "We sent a 6-digit code to that email." });
  });

  // ---- Host: verify a typed sign-in code, start session -----------------------
  app.post("/api/host/verify-code", async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code = String(req.body?.code || "").trim();
    if (!email || !code) {
      res.status(400).json({ message: "Enter your email and the code" });
      return;
    }
    const row = await storage.getLoginToken(email, code);
    if (!row || row.usedAt || new Date(row.expiresAt).getTime() < Date.now()) {
      res.status(401).json({ message: "That code is invalid or expired. Request a new one." });
      return;
    }
    await storage.markLoginTokenUsed(row.id);
    setSessionCookie(res, email);
    res.json({ ok: true, email });
  });

  // ---- Host: sign out ----------------------------------------------------------
  app.post("/api/host/logout", (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // ---- Host: fetch their podcaster profile (null if not set up yet) --------
  app.get("/api/host/profile", requireHostSession, async (req, res) => {
    const email = (req as any).hostEmail as string;
    const profile = await storage.getProfileByEmail(email);
    res.json(profile ?? null);
  });

  // ---- Host: create/update their podcaster profile (multipart: fields + optional photo) --
  app.put("/api/host/profile", requireHostSession, (req, res, next) => {
    upload.single("photo")(req, res, (err) => {
      if (err) {
        res.status(400).json({ message: err.message || "Couldn't process that photo." });
        return;
      }
      next();
    });
  }, async (req, res) => {
    const email = (req as any).hostEmail as string;
    const body = req.body as Record<string, string>;
    const raw = {
      podcastName: body.podcastName ?? "",
      hostName: body.hostName ?? "",
      phone: body.phone ?? "",
      numPeople: Number(body.numPeople) || 1,
      hasVideoIntro: body.hasVideoIntro === "true",
      hasVideoOutro: body.hasVideoOutro === "true",
      hasSlides: body.hasSlides === "true",
      hasImages: body.hasImages === "true",
      needsInterviewer: body.needsInterviewer === "true",
      socialLinks: body.socialLinks ?? "",
      rssUrl: body.rssUrl ?? "",
      youtubeUrl: body.youtubeUrl ?? "",
      notes: body.notes ?? "",
    };

    const parsed = insertProfileSchema.safeParse(raw);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }

    const existing = await storage.getProfileByEmail(email);

    let photoUrl: string | undefined;
    if (req.file) {
      try {
        photoUrl = await enhanceAndSavePhoto(req.file.buffer);
      } catch (err) {
        res.status(400).json({ message: "That photo couldn't be processed — try a different file." });
        return;
      }
    } else if (!existing?.photoUrl) {
      res.status(400).json({ message: "A photo is required — give us the best one you've got." });
      return;
    }

    const updated = await storage.upsertProfile(email, {
      ...parsed.data,
      ...(photoUrl ? { photoUrl } : {}),
    });
    res.json(updated);
  });

  // ---- Host: social accounts via Upload-Post -----------------------------------
  //      GET    → is the feature on, and what's connected right now
  //      POST /connect → a hosted URL where they link accounts, then bounce back
  //      POST /refresh → re-read what they linked and cache it on profile + signups
  app.get("/api/host/social", requireHostSession, async (req, res) => {
    const email = (req as any).hostEmail as string;
    const profile = await storage.getProfileByEmail(email);
    res.json({
      configured: isUploadPostConfigured(),
      accounts: parseSocialAccounts(profile?.socialAccounts),
      lastSyncedAt: profile?.updatedAt ?? null,
    });
  });

  function uploadPostUsernameFor(profileId: number): string {
    return `mv-${profileId}`;
  }

  app.post("/api/host/social/connect", requireHostSession, async (req, res) => {
    if (!isUploadPostConfigured()) {
      res.status(503).json({ message: "Social account linking isn't switched on yet." });
      return;
    }
    const email = (req as any).hostEmail as string;
    const profile = await storage.getProfileByEmail(email);
    if (!profile) {
      res.status(400).json({ message: "Set up your podcaster profile first." });
      return;
    }
    try {
      const username = profile.uploadPostUsername || uploadPostUsernameFor(profile.id);
      await ensureUploadPostProfile(username);
      if (!profile.uploadPostUsername) {
        await storage.upsertProfile(email, { uploadPostUsername: username });
      }
      const origin = `${req.protocol}://${req.get("host")}`;
      const url = await createConnectUrl({
        username,
        redirectUrl: `${origin}/host/dashboard?social=connected`,
        logoUrl: `${origin}/favicon.png`,
      });
      res.json({ url });
    } catch (err: any) {
      console.error("Upload-Post connect failed:", err);
      res.status(502).json({ message: "Couldn't start the social connection right now. Try again in a minute." });
    }
  });

  app.post("/api/host/social/refresh", requireHostSession, async (req, res) => {
    if (!isUploadPostConfigured()) {
      res.status(503).json({ message: "Social account linking isn't switched on yet." });
      return;
    }
    const email = (req as any).hostEmail as string;
    const profile = await storage.getProfileByEmail(email);
    if (!profile?.uploadPostUsername) {
      res.json({ configured: true, accounts: [] });
      return;
    }
    try {
      const accounts = await fetchConnectedAccounts(profile.uploadPostUsername);
      const json = JSON.stringify(accounts);
      await storage.upsertProfile(email, { socialAccounts: json });
      await storage.updateSignupSocialAccountsByEmail(email, json);
      res.json({ configured: true, accounts });
    } catch (err: any) {
      console.error("Upload-Post refresh failed:", err);
      res.status(502).json({ message: "Couldn't read your connected accounts right now." });
    }
  });

  // ---- Host: dashboard data (their slot(s), fans who want a reminder, and the
  //      open schedule so they can pick and claim a new slot) ------------------
  app.get("/api/host/dashboard", requireHostSession, async (req, res) => {
    const email = (req as any).hostEmail as string;
    const event = await storage.getFeaturedEvent();
    const [signupRows, reminderRows] = await Promise.all([
      storage.listSignups(event.id),
      storage.listReminders(),
    ]);
    const active = signupRows.filter((s) => s.status !== "cancelled");
    const mySignups = active.filter((s) => s.email.trim().toLowerCase() === email);
    const mySignupIds = new Set(mySignups.map((s) => s.id));
    const contacts = reminderRows
      .filter((r) => mySignupIds.has(r.signupId))
      .map((r) => ({ id: r.id, email: r.email, createdAt: r.createdAt, signupId: r.signupId }));
    res.json({
      email,
      event: toPublicEvent(event),
      signups: active.map(toPublicSignup),
      mySignups: mySignups.map((s) => ({
        id: s.id,
        slotIndex: s.slotIndex,
        podcastName: s.podcastName,
        hostName: s.hostName,
        numPeople: s.numPeople,
        status: s.status,
        createdAt: s.createdAt,
      })),
      contacts,
    });
  });

  // ---- Host: CSV export of their own contacts ---------------------------------
  app.get("/api/host/export.csv", requireHostSession, async (req, res) => {
    const email = (req as any).hostEmail as string;
    const [signupRows, reminderRows] = await Promise.all([storage.listSignups(), storage.listReminders()]);
    const mySignupIds = new Set(
      signupRows.filter((s) => s.email.trim().toLowerCase() === email).map((s) => s.id),
    );
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ["email,created_at"];
    for (const r of reminderRows) {
      if (!mySignupIds.has(r.signupId)) continue;
      lines.push([r.email, r.createdAt].map(escape).join(","));
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=my-militaryvoice-contacts.csv");
    res.send(lines.join("\n"));
  });
}
