import type { Express, Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import multer from "multer";
import sharp from "sharp";
import { storage } from "./storage";
import { uploadPhoto } from "./photoStorage";
import {
  insertSignupSchema,
  insertReminderSchema,
  updateEventSchema,
  type PublicEvent,
  type PublicSignup,
} from "../shared/schema";
import { fromError } from "zod-validation-error";
import { sendConfirmationEmail } from "./email";

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

function toPublicEvent(event: Awaited<ReturnType<typeof storage.getEvent>>): PublicEvent {
  const { adminPassword, ...rest } = event;
  return rest;
}

function toPublicSignup(s: Awaited<ReturnType<typeof storage.listSignups>>[number]): PublicSignup {
  return {
    id: s.id,
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
  const event = await storage.getEvent();
  if (!password || password !== event.adminPassword) {
    res.status(401).json({ message: "Invalid admin password" });
    return;
  }
  next();
}

export function registerRoutes(app: Express): void {
  // ---- Public: event config -------------------------------------------------
  app.get("/api/event", async (_req, res) => {
    const event = await storage.getEvent();
    res.json(toPublicEvent(event));
  });

  // ---- Public: schedule (privacy-safe signup fields only) -------------------
  app.get("/api/signups", async (_req, res) => {
    const rows = await storage.listSignups();
    res.json(rows.filter((r) => r.status !== "cancelled").map(toPublicSignup));
  });

  // ---- Public: claim a slot (multipart form: fields + a required photo) ------
  app.post("/api/signups", (req, res, next) => {
    upload.single("photo")(req, res, (err) => {
      if (err) {
        res.status(400).json({ message: err.message || "Couldn't process that photo." });
        return;
      }
      next();
    });
  }, async (req, res) => {
    if (!req.file) {
      res.status(400).json({ message: "A photo is required — give us the best one you've got." });
      return;
    }

    const body = req.body as Record<string, string>;
    const raw = {
      slotIndex: Number(body.slotIndex),
      podcastName: body.podcastName ?? "",
      hostName: body.hostName ?? "",
      email: body.email ?? "",
      phone: body.phone ?? "",
      numPeople: Number(body.numPeople),
      hasVideoIntro: body.hasVideoIntro === "true",
      hasVideoOutro: body.hasVideoOutro === "true",
      hasSlides: body.hasSlides === "true",
      hasImages: body.hasImages === "true",
      needsInterviewer: body.needsInterviewer === "true",
      socialLinks: body.socialLinks ?? "",
      notes: body.notes ?? "",
      timezone: body.timezone ?? "",
      photoUrl: "pending", // placeholder so the schema's min-length check passes before we save the file
    };

    const parsed = insertSignupSchema.safeParse(raw);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }

    const event = await storage.getEvent();
    const totalSlots = Math.floor((event.durationHours * 60) / event.slotMinutes);
    if (parsed.data.slotIndex >= totalSlots) {
      res.status(400).json({ message: "That slot doesn't exist on the current schedule." });
      return;
    }

    const existing = await storage.getSignupBySlot(parsed.data.slotIndex);
    if (existing && existing.status !== "cancelled") {
      res.status(409).json({ message: "That slot was just claimed by someone else. Pick another." });
      return;
    }

    let photoUrl: string;
    try {
      photoUrl = await enhanceAndSavePhoto(req.file.buffer);
    } catch (err) {
      res.status(400).json({ message: "That photo couldn't be processed — try a different file." });
      return;
    }

    const created = await storage.createSignup({ ...parsed.data, photoUrl });
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
        const agendaUrl = `${protocol}://${host}/#/agenda`;
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
    const event = await storage.getEvent();
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
    const event = await storage.getEvent();
    if (!password || password !== event.adminPassword) {
      res.status(401).json({ message: "Incorrect password" });
      return;
    }
    res.json({ ok: true });
  });

  // ---- Admin: full event settings ---------------------------------------------
  // Note: adminPassword is intentionally stripped from the response even though
  // this route requires auth — it should never round-trip back to the browser.
  app.get("/api/admin/event", requireAdmin, async (_req, res) => {
    const event = await storage.getEvent();
    res.json(toPublicEvent(event));
  });

  app.put("/api/admin/event", requireAdmin, async (req, res) => {
    const parsed = updateEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const updated = await storage.updateEvent(parsed.data);
    res.json(toPublicEvent(updated));
  });

  // ---- Admin: full signups list (with contact info) ---------------------------
  app.get("/api/admin/signups", requireAdmin, async (_req, res) => {
    const rows = await storage.listSignups();
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

}
