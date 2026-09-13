import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import multer from "multer";
import sharp from "sharp";
import { storage } from "./storage.js";
import { uploadPhoto, uploadShowAsset, deleteShowAsset } from "./photoStorage.js";
import {
  insertSignupSchema,
  insertReminderSchema,
  insertEventSchema,
  updateEventSchema,
  insertProfileSchema,
  runItemInputSchema,
  platformInterestSchema,
  studioJoinSchema,
  studioHeartbeatSchema,
  studioUpdateSchema,
  destinationInputSchema,
  PRESENCE_WINDOW_MS,
  ASSET_KINDS,
  type GeneratedRunItem,
  type ShowAssetRow,
  insertSponsorInquirySchema,
  type PublicEvent,
  type PublicSignup,
  type PublicPodcaster,
  type PublicSponsor,
  type PublicSettings,
  type EventRow,
  updateSponsorSchema,
} from "../shared/schema.js";
import { fromError } from "zod-validation-error";
import {
  isLiveKitConfigured,
  isRecordingConfigured,
  publicLiveKitUrl,
  roomName,
  startBroadcast,
  startSegmentRecording,
  stopEgressById,
  studioToken,
  syncParticipantState,
  updateBroadcastTargets,
  webhooks,
} from "./livekit.js";
import { ensureRecordingsBucket, signedRecordingUrl } from "./recordingStorage.js";
import { sendConfirmationEmail, sendLoginCodeEmail, sendReminderConfirmationEmail, sendSponsorInquiryEmail, sendPlatformInterestEmail, buildCalendarLinks } from "./email.js";
import type { DestinationRow } from "../shared/schema.js";
import { setSessionCookie, clearSessionCookie, requireHostSession, getSessionEmail, setAdminCookie, clearAdminCookie, getAdminEmail } from "./session.js";
import {
  isUploadPostConfigured,
  ensureUploadPostProfile,
  createConnectUrl,
  fetchConnectedAccounts,
  enrichWithFollowers,
  parseSocialAccounts,
  publishVideo,
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

// Public read endpoints are safe to serve from Vercel's CDN for a few seconds:
// the homepage fires several in parallel and a cold instance costs ~2s each.
// Writers invalidate client-side; a 10s window is invisible to visitors.
/** Live studio state — never cache, at any layer. */
function noStore(res: Response): void {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Vercel-CDN-Cache-Control", "no-store");
  res.setHeader("CDN-Cache-Control", "no-store");
}

function publicCache(res: Response, seconds = 15): void {
  // Split the two caches deliberately:
  //  - Browsers must revalidate every time, so a visitor never sees a stale
  //    lineup (or, worse, a day-old copy from stale-while-revalidate).
  //  - Vercel's edge holds it for `seconds` and refreshes in the background,
  //    which is what actually keeps cold starts off the critical path.
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  res.setHeader("Vercel-CDN-Cache-Control", `max-age=${seconds}, stale-while-revalidate=600`);
  res.setHeader("CDN-Cache-Control", `max-age=${seconds}`);
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
    showFormat: s.showFormat,
    branch: s.branch,
    serviceStatus: s.serviceStatus,
    status: s.status,
  };
}

function slotWindow(event: EventRow, slotIndex: number): { start: Date; end: Date } {
  const start = new Date(new Date(event.startAtUtc).getTime() + slotIndex * event.slotMinutes * 60000);
  return { start, end: new Date(start.getTime() + event.slotMinutes * 60000) };
}

function calendarLinksFor(signup: { id: number; podcastName: string; hostName: string; slotIndex: number }, event: EventRow, origin: string) {
  const { start, end } = slotWindow(event, signup.slotIndex);
  return buildCalendarLinks({
    title: `${signup.podcastName} — ${event.name.trim()}`,
    details: `${signup.hostName} is live on the MilitaryVoice.ai ${event.name.trim()}. Agenda: ${origin}/agenda`,
    start,
    end,
    icsUrl: `${origin}/api/signups/${signup.id}/calendar.ics`,
    location: `${origin}/agenda`,
  });
}


export interface LatestEpisode {
  title: string;
  audioUrl: string;
  pubDate: string;
  durationLabel: string;
}

function decodeXmlEntities(v: string): string {
  return v
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** iTunes duration is either seconds ("3007") or "HH:MM:SS" — normalise both. */
function formatDuration(raw: string): string {
  if (!raw) return "";
  if (raw.includes(":")) return raw;
  const total = Number(raw);
  if (!Number.isFinite(total) || total <= 0) return "";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = Math.floor(total % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

/** Pull the newest <item> that carries a playable enclosure. */
function parseLatestEpisode(xml: string): LatestEpisode | null {
  const items = xml.split(/<item[\s>]/i).slice(1);
  for (const raw of items) {
    const item = raw.split(/<\/item>/i)[0];
    const enclosure = item.match(/<enclosure\b[^>]*\burl\s*=\s*["']([^"']+)["'][^>]*>/i);
    const audioUrl = enclosure?.[1];
    if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) continue;
    const title = item.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "Latest episode";
    const pubDate = item.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "";
    const duration = item.match(/<itunes:duration[^>]*>([\s\S]*?)<\/itunes:duration>/i)?.[1] ?? "";
    return {
      title: decodeXmlEntities(title).slice(0, 200),
      audioUrl,
      pubDate: decodeXmlEntities(pubDate),
      durationLabel: formatDuration(decodeXmlEntities(duration)),
    };
  }
  return null;
}


/**
 * Podcasters routinely paste the Apple Podcasts page instead of their feed.
 * Apple's public lookup API turns that into the real RSS URL; anything else is
 * used as-is.
 */
async function resolveFeedUrl(raw: string): Promise<string | null> {
  const appleId = raw.match(/podcasts\.apple\.com\/.*\/id(\d+)/i)?.[1];
  if (!appleId) return raw;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`https://itunes.apple.com/lookup?id=${appleId}&entity=podcast`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: { feedUrl?: string }[] };
    const feed = data.results?.[0]?.feedUrl;
    return feed && /^https?:\/\//i.test(feed) ? feed : null;
  } catch (err) {
    console.error("Apple Podcasts lookup failed:", err);
    return null;
  }
}

/** "America/New_York" → "EDT" for the date in question. Falls back to the id. */
function zoneAbbrev(date: Date, timeZone: string): string {
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
        .formatToParts(date)
        .find((p) => p.type === "timeZoneName")?.value ?? timeZone
    );
  } catch {
    return timeZone;
  }
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
  // Preferred: a signed admin session from the email-code sign-in.
  const sessionEmail = getAdminEmail(req);
  if (sessionEmail && (await storage.isAdminEmail(sessionEmail))) {
    (req as any).adminEmail = sessionEmail;
    next();
    return;
  }
  // Fallback: the legacy shared password (kept so existing links keep working).
  const password = (req.header("x-admin-password") || (req.query.password as string) || "").trim();
  const event = await storage.getFeaturedEvent();
  if (password && password === event.adminPassword) {
    next();
    return;
  }
  res.status(401).json({ message: "Sign in to the admin dashboard." });
}

export function registerRoutes(app: Express): void {
  // ---- Public: events list (for "Choose Your Event") -------------------------
  app.get("/api/events", async (_req, res) => {
    publicCache(res, 60);
    const rows = await storage.listEvents();
    res.json(rows.map(toPublicEvent));
  });

  // ---- Public: event config (featured by default, or ?slug=) -----------------
  app.get("/api/event", async (req, res) => {
    publicCache(res, 60);
    const slug = typeof req.query.slug === "string" ? req.query.slug : undefined;
    const event = slug ? await storage.getEventBySlug(slug) : await storage.getFeaturedEvent();
    if (!event) {
      res.status(404).json({ message: "Event not found" });
      return;
    }
    res.json(toPublicEvent(event));
  });

  // ---- Public: schedule (privacy-safe signup fields only) -------------------
  // ---- Public: latest episode from a podcaster's RSS feed --------------------
  //      Keyed by signup id so we only ever fetch a feed URL a podcaster gave
  //      us, never an arbitrary URL from the query string.
  const feedCache = new Map<number, { at: number; body: LatestEpisode | null }>();
  const FEED_TTL_MS = 10 * 60 * 1000;

  app.get("/api/signups/:id/latest-episode", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ message: "Bad id" });
      return;
    }
    const cached = feedCache.get(id);
    if (cached && Date.now() - cached.at < FEED_TTL_MS) {
      publicCache(res, 300);
      res.json(cached.body);
      return;
    }
    const signup = await storage.getSignupById(id);
    const feedUrl = signup?.rssUrl?.trim();
    if (!signup || signup.status === "cancelled" || !feedUrl || !/^https?:\/\//i.test(feedUrl)) {
      publicCache(res, 300);
      res.json(null);
      return;
    }
    let episode: LatestEpisode | null = null;
    try {
      const resolved = await resolveFeedUrl(feedUrl);
      if (!resolved) {
        feedCache.set(id, { at: Date.now(), body: null });
        publicCache(res, 300);
        res.json(null);
        return;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const feedRes = await fetch(resolved, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "MilitaryVoice.ai/1.0 (+https://www.militaryvoice.ai)" },
      });
      clearTimeout(timer);
      if (feedRes.ok) {
        // Only read the head of the feed — the newest item is at the top and
        // some shows publish megabytes of back catalogue.
        const xml = (await feedRes.text()).slice(0, 400_000);
        episode = parseLatestEpisode(xml);
      }
    } catch (err) {
      console.error("RSS fetch failed for signup", id, err);
    }
    feedCache.set(id, { at: Date.now(), body: episode });
    publicCache(res, 300);
    res.json(episode);
  });

  // ---- Public: podcasters with a finished profile (for the homepage spotlight).
  //      No contact info leaves the server.
  app.get("/api/podcasters", async (_req, res) => {
    publicCache(res);
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

  // ---- Admin auth: one-time email code, no shared password ---------------------
  app.get("/api/admin/me", async (req, res) => {
    const email = getAdminEmail(req);
    if (!email || !(await storage.isAdminEmail(email))) {
      res.status(401).json({ message: "Not signed in" });
      return;
    }
    const admins = await storage.listAdmins();
    const me = admins.find((a) => a.email === email);
    res.json({ email, name: me?.name ?? "", isOwner: !!me?.isOwner });
  });

  app.post("/api/admin/request-code", async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      res.status(400).json({ message: "Enter a valid email" });
      return;
    }
    // Always answer the same way so this can't be used to probe who's an admin.
    if (await storage.isAdminEmail(email)) {
      const code = crypto.randomInt(100000, 1000000).toString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await storage.supersedeLoginTokens(`admin:${email}`);
      await storage.createLoginToken(`admin:${email}`, code, expiresAt);
      if (!process.env.RESEND_API_KEY && process.env.NODE_ENV !== "production") {
        console.log(`[dev] ADMIN login code for ${email}: ${code}`);
      }
      await sendLoginCodeEmail({ to: email, code });
    } else {
      console.warn(`Admin sign-in attempted for non-admin email: ${email}`);
    }
    res.json({ ok: true, message: "If that email is on the admin list, a code is on its way." });
  });

  app.post("/api/admin/verify-code", async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code = String(req.body?.code || "").trim();
    if (!email || !code) {
      res.status(400).json({ message: "Enter your email and the code" });
      return;
    }
    const row = await storage.getLoginToken(`admin:${email}`, code);
    if (!row || row.usedAt || new Date(row.expiresAt).getTime() < Date.now() || !(await storage.isAdminEmail(email))) {
      res.status(401).json({ message: "That code is invalid or expired. Request a new one." });
      return;
    }
    await storage.markLoginTokenUsed(row.id);
    setAdminCookie(res, email);
    res.json({ ok: true, email });
  });

  app.post("/api/admin/logout", (_req, res) => {
    clearAdminCookie(res);
    res.json({ ok: true });
  });

  // ---- Admin: team members ------------------------------------------------------
  app.get("/api/admin/team", requireAdmin, async (_req, res) => {
    res.json(await storage.listAdmins());
  });

  app.post("/api/admin/team", requireAdmin, async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const name = String(req.body?.name || "").trim();
    if (!email || !email.includes("@")) {
      res.status(400).json({ message: "Enter a valid email" });
      return;
    }
    const created = await storage.addAdmin(email, name);
    res.status(201).json(created);
  });

  app.delete("/api/admin/team/:id", requireAdmin, async (req, res) => {
    const result = await storage.removeAdmin(Number(req.params.id));
    if (!result.removed) {
      res.status(400).json({ message: result.reason ?? "Couldn't remove that teammate." });
      return;
    }
    res.json({ ok: true });
  });

  // ---- Public: sponsor logos ("Friends of the Podcastathon") -------------------
  app.get("/api/sponsors", async (_req, res) => {
    publicCache(res, 60);
    // Master switch: off by default until there's something worth showing.
    if ((await storage.getSetting("sponsorsVisible")) !== "true") {
      res.json([]);
      return;
    }
    const rows = await storage.listSponsors(true);
    const out: PublicSponsor[] = rows.map((r) => ({ id: r.id, name: r.name, url: r.url, logoUrl: r.logoUrl, sortOrder: r.sortOrder }));
    res.json(out);
  });

  // ---- Public: "become a sponsor" form ------------------------------------------
  app.post("/api/sponsor-inquiries", async (req, res) => {
    const parsed = insertSponsorInquirySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const created = await storage.createSponsorInquiry(parsed.data);
    res.status(201).json({ id: created.id });

    (async () => {
      try {
        const admins = await storage.listAdmins();
        await sendSponsorInquiryEmail({
          to: admins.map((a) => a.email),
          name: parsed.data.name,
          company: parsed.data.company ?? "",
          email: parsed.data.email,
          phone: parsed.data.phone ?? "",
          message: parsed.data.message ?? "",
        });
      } catch (err) {
        console.error("Failed to send sponsor inquiry email:", err);
      }
    })();
  });

  app.get("/api/admin/sponsor-inquiries", requireAdmin, async (_req, res) => {
    res.json(await storage.listSponsorInquiries());
  });

  app.patch("/api/admin/sponsor-inquiries/:id", requireAdmin, async (req, res) => {
    await storage.setSponsorInquiryHandled(Number(req.params.id), !!req.body?.handled);
    res.json({ ok: true });
  });

  // ---- Show-day material ----------------------------------------------------
  //      Uploads go to their own Supabase bucket; anything too big for a
  //      request body can be handed over as a link instead.
  const assetUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  app.get("/api/host/assets", requireHostSession, async (req, res) => {
    const email = (req as any).hostEmail as string;
    res.json(await storage.listAssetsByEmail(email));
  });

  app.post(
    "/api/host/assets",
    requireHostSession,
    (req, res, next) => {
      assetUpload.single("file")(req, res, (err: any) => {
        if (err) {
          const tooBig = err?.code === "LIMIT_FILE_SIZE";
          res.status(400).json({
            message: tooBig
              ? "That file is over 50MB. Upload a smaller version, or paste a link to it instead."
              : err.message || "Couldn't accept that file.",
          });
          return;
        }
        next();
      });
    },
    async (req, res) => {
      const email = (req as any).hostEmail as string;
      const body = req.body as Record<string, string>;
      const kind = (ASSET_KINDS as readonly string[]).includes(body.kind) ? body.kind : "Other";
      const label = (body.label ?? "").trim().slice(0, 120);
      const linkUrl = (body.linkUrl ?? "").trim();

      if (!req.file && !linkUrl) {
        res.status(400).json({ message: "Attach a file or paste a link." });
        return;
      }
      if (linkUrl && !/^https?:\/\//i.test(linkUrl)) {
        res.status(400).json({ message: "That link needs to start with http:// or https://" });
        return;
      }

      let fileUrl = "";
      let fileName = "";
      let sizeBytes = 0;
      if (req.file) {
        const safe = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
        const key = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${safe}`;
        try {
          fileUrl = await uploadShowAsset(key, req.file.buffer, req.file.mimetype || "application/octet-stream");
        } catch (err) {
          console.error("Show asset upload failed:", err);
          res.status(502).json({ message: "Upload failed. Try again, or paste a link instead." });
          return;
        }
        fileName = req.file.originalname;
        sizeBytes = req.file.size;
      }

      const created = await storage.createAsset({ email, kind, label, fileUrl, linkUrl, fileName, sizeBytes });
      res.status(201).json(created);
    },
  );

  // ---- A podcaster's own destinations -------------------------------------------
  //      Their slot can go out to their own channel as well as ours. They add
  //      the key; the control room attaches it when their slot comes up.
  app.get("/api/host/destinations", requireHostSession, async (req, res) => {
    noStore(res);
    const email = (getSessionEmail(req) ?? "").toLowerCase().trim();
    const eventId = (await storage.getFeaturedEvent()).id;
    const mine = (await storage.listDestinations(eventId)).filter((d) => d.ownerEmail === email);
    res.json(
      mine.map((d) => ({
        id: d.id,
        platform: d.platform,
        label: d.label,
        rtmpUrl: d.rtmpUrl,
        keyHint: d.streamKey ? `••••${d.streamKey.slice(-4)}` : "",
        enabled: d.enabled,
        live: d.live,
      })),
    );
  });

  app.post("/api/host/destinations", requireHostSession, async (req, res) => {
    const parsed = destinationInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const email = (getSessionEmail(req) ?? "").toLowerCase().trim();
    const event = await storage.getFeaturedEvent();
    // Tie it to the slot they actually hold, so the control room knows when to
    // switch it on.
    const mySignup = (await storage.listSignups(event.id)).find(
      (sg) => sg.email.toLowerCase().trim() === email && sg.status === "confirmed",
    );
    const row = await storage.createDestination(event.id, email, {
      ...parsed.data,
      signupId: mySignup?.id,
    });
    res.status(201).json({ id: row.id, platform: row.platform, label: row.label, rtmpUrl: row.rtmpUrl, keyHint: `••••${row.streamKey.slice(-4)}`, enabled: row.enabled, live: row.live });
  });

  app.delete("/api/host/destinations/:id", requireHostSession, async (req, res) => {
    const email = (getSessionEmail(req) ?? "").toLowerCase().trim();
    const d = await storage.getDestination(Number(req.params.id));
    if (!d || d.ownerEmail !== email) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    if (d.live) {
      res.status(409).json({ message: "That's carrying your slot right now. Ask the producer to drop it first." });
      return;
    }
    await storage.deleteDestination(d.id);
    res.json({ ok: true });
  });

  // ---- A podcaster's own recordings ---------------------------------------------
  //      Their session lands here on its own once the studio stops recording.
  app.get("/api/host/recordings", requireHostSession, async (req, res) => {
    noStore(res);
    const email = getSessionEmail(req) ?? "";
    res.json(await storage.listRecordingsByEmail(email));
  });

  /** A short-lived signed link, made on demand — the bucket itself is private. */
  app.get("/api/host/recordings/:id/download", requireHostSession, async (req, res) => {
    const email = (getSessionEmail(req) ?? "").toLowerCase().trim();
    const row = await storage.getRecording(Number(req.params.id));
    if (!row || row.email !== email || row.status !== "Ready" || !row.url) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    res.json({ url: await signedRecordingUrl(row.url) });
  });

  /** Send a finished session to the podcaster's own connected accounts. */
  app.post("/api/host/recordings/:id/publish", requireHostSession, async (req, res) => {
    if (!isUploadPostConfigured()) {
      res.status(503).json({ message: "Posting to socials isn't switched on yet." });
      return;
    }
    const email = (getSessionEmail(req) ?? "").toLowerCase().trim();
    const row = await storage.getRecording(Number(req.params.id));
    if (!row || row.email !== email || row.status !== "Ready" || !row.url) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    const profile = await storage.getProfileByEmail(email);
    const username = profile?.uploadPostUsername;
    if (!username) {
      res.status(400).json({ message: "Connect your social accounts first." });
      return;
    }
    const platforms = (Array.isArray(req.body?.platforms) ? req.body.platforms : [])
      .map((p: unknown) => String(p).toLowerCase().trim())
      .filter(Boolean);
    if (platforms.length === 0) {
      res.status(400).json({ message: "Pick at least one account to post to." });
      return;
    }
    try {
      // Six hours: long enough for Upload-Post to fetch a large file, short
      // enough that the link is useless afterwards.
      const videoUrl = await signedRecordingUrl(row.url, 21_600);
      await publishVideo({
        username,
        platforms,
        videoUrl,
        title: String(req.body?.title ?? row.title ?? "").trim() || row.title || "My session",
        description: String(req.body?.description ?? "").trim() || undefined,
      });
      res.json({ ok: true });
    } catch (err: any) {
      console.error("Publishing a recording failed:", err);
      res.status(502).json({ message: err?.message ?? "Couldn't post that right now." });
    }
  });

  app.get("/api/admin/recordings/:id/download", requireAdmin, async (req, res) => {
    const row = await storage.getRecording(Number(req.params.id));
    if (!row || row.status !== "Ready" || !row.url) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    res.json({ url: await signedRecordingUrl(row.url) });
  });

  app.delete("/api/host/assets/:id", requireHostSession, async (req, res) => {
    const email = (req as any).hostEmail as string;
    const id = Number(req.params.id);
    const mine = (await storage.listAssetsByEmail(email)).find((a) => a.id === id);
    if (!mine) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    await storage.deleteAsset(id, email);
    if (mine.fileUrl) {
      try {
        await deleteShowAsset(mine.fileUrl);
      } catch (err) {
        console.error("Couldn't remove the stored file:", err);
      }
    }
    res.json({ ok: true });
  });

  app.get("/api/admin/assets", requireAdmin, async (_req, res) => {
    res.json(await storage.listAllAssets());
  });

  // ---- Run of show ------------------------------------------------------------
  app.get("/api/admin/run-of-show", requireAdmin, async (req, res) => {
    const eventId = Number(req.query.eventId) || (await storage.getFeaturedEvent()).id;
    res.json(await storage.listRunOfShow(eventId));
  });

  /** Build the plan from the schedule: pre-show, then each slot with a sponsor
   *  break and an intro ahead of it. Merged in, so hand edits survive. */
  app.post("/api/admin/run-of-show/generate", requireAdmin, async (req, res) => {
    const eventId = Number(req.body?.eventId) || (await storage.getFeaturedEvent()).id;
    const event = await storage.getEventById(eventId);
    if (!event) {
      res.status(404).json({ message: "Event not found" });
      return;
    }
    const preRollMinutes = Number(req.body?.preRollMinutes) > 0 ? Number(req.body.preRollMinutes) : 15;
    const sponsorMinutes = Number(req.body?.sponsorMinutes) >= 0 ? Number(req.body.sponsorMinutes) : 2;
    const host = (req.body?.hostName as string) || "Riccoh Player";

    const signups = (await storage.listSignups(eventId)).filter((s) => s.status !== "cancelled");
    const bySlot = new Map(signups.map((s) => [s.slotIndex, s]));
    const eventStart = new Date(event.startAtUtc);
    const items: GeneratedRunItem[] = [];

    items.push({
      sourceKey: "preshow",
      kind: "Pre-show",
      title: "Stream live — pre-show",
      notes: "Go live early. Bumper loop, holding slate, sound check.",
      startAtUtc: new Date(eventStart.getTime() - preRollMinutes * 60000).toISOString(),
      durationMinutes: preRollMinutes,
      signupId: null,
    });
    items.push({
      sourceKey: "preshow-sponsor",
      kind: "Sponsor",
      title: "Sponsor reel & event info",
      notes: "Run sponsor spots and the welcome card until the top of the hour.",
      startAtUtc: new Date(eventStart.getTime() - preRollMinutes * 60000).toISOString(),
      durationMinutes: preRollMinutes,
      signupId: null,
    });

    const total = Math.floor((event.durationHours * 60) / event.slotMinutes);
    for (let i = 0; i < total; i++) {
      const blockStart = new Date(eventStart.getTime() + i * event.slotMinutes * 60000);
      const onAir = onAirWindowServer(blockStart, event.onAirMinutes, event.bufferMinutes, event.bufferPosition);
      const signup = bySlot.get(i);
      const who = signup ? `${signup.podcastName} — ${signup.hostName}` : "Open slot";

      items.push({
        sourceKey: `intro-${i}`,
        kind: "Intro",
        title: i === 0 ? `Welcome & introduction — ${host}` : `Intro to ${who}`,
        notes: i === 0 ? "Open the event, then hand to the first show." : `${host} introduces the next show.`,
        startAtUtc: blockStart.toISOString(),
        durationMinutes: 0,
        signupId: signup?.id ?? null,
      });
      items.push({
        sourceKey: `segment-${i}`,
        kind: "Segment",
        title: who,
        notes: signup
          ? signup.showFormat === "prerecorded"
            ? `PRE-RECORDED — roll the episode.${signup.introStyle === "virtual" ? " Live virtual intro first." : ""}`
            : "Live from their own studio."
          : "Nobody booked. Fill with sponsor reel or a house segment.",
        startAtUtc: onAir.start.toISOString(),
        durationMinutes: event.onAirMinutes,
        signupId: signup?.id ?? null,
      });
      if (event.bufferMinutes > 0) {
        items.push({
          sourceKey: `handoff-${i}`,
          kind: "Handoff",
          title: `Sponsor read & handoff`,
          notes: `${sponsorMinutes}-minute sponsor read, then reset for the next show.`,
          startAtUtc: onAir.end.toISOString(),
          durationMinutes: event.bufferMinutes,
          signupId: null,
        });
      }
    }

    res.json(await storage.mergeRunOfShow(eventId, items));
  });

  app.post("/api/admin/run-of-show", requireAdmin, async (req, res) => {
    const eventId = Number(req.body?.eventId) || (await storage.getFeaturedEvent()).id;
    const parsed = runItemInputSchema.safeParse(req.body?.item);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const existing = await storage.listRunOfShow(eventId);
    res.status(201).json(await storage.createRunItem(eventId, parsed.data, existing.length));
  });

  app.patch("/api/admin/run-of-show/:id", requireAdmin, async (req, res) => {
    const parsed = runItemInputSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const patch: any = { ...parsed.data };
    if (typeof req.body?.sortIndex === "number") patch.sortIndex = req.body.sortIndex;
    // Rewording a row pins it; `resetToGenerated` hands it back to the generator.
    if (req.body?.resetToGenerated === true) patch.edited = false;
    else if (["kind", "title", "notes", "durationMinutes"].some((k) => k in parsed.data)) patch.edited = true;
    const row = await storage.updateRunItem(Number(req.params.id), patch);
    if (!row) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    res.json(row);
  });

  app.delete("/api/admin/run-of-show/:id", requireAdmin, async (req, res) => {
    await storage.deleteRunItem(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- Studio -----------------------------------------------------------------
  //      Show control only: who's waiting, who's on stage, and the emergency
  //      clip. The video layer plugs in behind this.
  async function studioForSlug(slug?: string) {
    const event = slug ? await storage.getEventBySlug(slug) : await storage.getFeaturedEvent();
    if (!event) return null;
    return { event, studio: await storage.getOrCreateStudio(event.id) };
  }

  function withPresence(p: { lastSeenAt: string }) {
    return Date.now() - new Date(p.lastSeenAt).getTime() < PRESENCE_WINDOW_MS;
  }

  /** What a speaker sees: their own state plus whether the room is live. */
  async function speakerState(
    event: { name: string },
    studio: { id: number; name: string; status: string; fallbackPlaying: boolean; maxOnStage: number },
    clientKey: string,
  ) {
    const all = await storage.listStudioParticipants(studio.id);
    return {
      eventName: event.name,
      studio: {
        name: studio.name,
        status: studio.status,
        fallbackPlaying: studio.fallbackPlaying,
        maxOnStage: studio.maxOnStage,
      },
      me: all.find((p) => p.clientKey === clientKey) ?? null,
      onStageCount: all.filter((p) => p.state === "On stage" && withPresence(p)).length,
      greenRoomCount: all.filter((p) => p.state === "Green room" && withPresence(p)).length,
    };
  }

  app.get("/api/studio/state", async (req, res) => {
    noStore(res);
    const found = await studioForSlug(typeof req.query.slug === "string" ? req.query.slug : undefined);
    if (!found) {
      res.status(404).json({ message: "No event" });
      return;
    }
    const clientKey = typeof req.query.clientKey === "string" ? req.query.clientKey : "";
    res.json(await speakerState(found.event, found.studio, clientKey));
  });

  app.post("/api/studio/join", async (req, res) => {
    const parsed = studioJoinSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const found = await studioForSlug(typeof req.body?.slug === "string" ? req.body.slug : undefined);
    if (!found) {
      res.status(404).json({ message: "No event" });
      return;
    }
    // A signed-in podcaster is recognised and gets their show name automatically.
    const hostEmail = getSessionEmail(req);
    const profile = hostEmail ? await storage.getProfileByEmail(hostEmail) : undefined;
    const row = await storage.upsertStudioParticipant(found.studio.id, parsed.data.clientKey, {
      displayName: parsed.data.displayName || profile?.hostName || "",
      email: hostEmail || parsed.data.email,
      role: "Speaker",
    });
    res.status(201).json(row);
  });

  app.post("/api/studio/heartbeat", async (req, res) => {
    noStore(res);
    const parsed = studioHeartbeatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const found = await studioForSlug(typeof req.body?.slug === "string" ? req.body.slug : undefined);
    if (!found) {
      res.status(404).json({ message: "No event" });
      return;
    }
    const all = await storage.listStudioParticipants(found.studio.id);
    if (!all.some((p) => p.clientKey === parsed.data.clientKey)) {
      res.status(404).json({ message: "Join first" });
      return;
    }
    await storage.upsertStudioParticipant(found.studio.id, parsed.data.clientKey, {
      camReady: parsed.data.camReady,
      micReady: parsed.data.micReady,
    });
    // Same shape as /state: one round trip per beat keeps the studio quiet on
    // the database while still moving people between rooms promptly.
    res.json(await speakerState(found.event, found.studio, parsed.data.clientKey));
  });

  // A LiveKit token for one speaker. Everyone who has joined publishes, green
  // room included, so the producer can check their camera and mic before they
  // are on air; what actually reaches the broadcast is decided by the composite.
  app.post("/api/studio/token", async (req, res) => {
    noStore(res);
    if (!isLiveKitConfigured()) {
      res.json({ configured: false });
      return;
    }
    const found = await studioForSlug(typeof req.body?.slug === "string" ? req.body.slug : undefined);
    const key = typeof req.body?.clientKey === "string" ? req.body.clientKey : "";
    if (!found || !key) {
      res.status(404).json({ message: "No event" });
      return;
    }
    const me = (await storage.listStudioParticipants(found.studio.id)).find((p) => p.clientKey === key);
    if (!me) {
      res.status(404).json({ message: "Join first" });
      return;
    }
    const room = roomName(found.studio.id);
    res.json({
      configured: true,
      url: publicLiveKitUrl(),
      room,
      identity: `p-${me.id}`,
      token: await studioToken({
        room,
        identity: `p-${me.id}`,
        name: me.displayName || "Speaker",
        canPublish: true,
        attributes: { state: me.state, participantId: String(me.id) },
      }),
    });
  });

  app.post("/api/studio/leave", async (req, res) => {
    const found = await studioForSlug(typeof req.body?.slug === "string" ? req.body.slug : undefined);
    const key = typeof req.body?.clientKey === "string" ? req.body.clientKey : "";
    if (found && key) {
      const me = (await storage.listStudioParticipants(found.studio.id)).find((p) => p.clientKey === key);
      if (me) await storage.removeStudioParticipant(me.id);
    }
    res.json({ ok: true });
  });

  // ---- Studio: the control room -------------------------------------------------
  app.get("/api/admin/studio", requireAdmin, async (req, res) => {
    noStore(res);
    const eventId = Number(req.query.eventId) || (await storage.getFeaturedEvent()).id;
    const studio = await storage.getOrCreateStudio(eventId);
    const participants = await storage.listStudioParticipants(studio.id);
    res.json({
      studio,
      participants: participants.map((p) => ({ ...p, present: withPresence(p) })),
    });
  });

  // The producer watches but never publishes, and holds roomAdmin so they can
  // move people around from the console.
  app.post("/api/admin/studio/token", requireAdmin, async (req, res) => {
    noStore(res);
    if (!isLiveKitConfigured()) {
      res.json({ configured: false });
      return;
    }
    const eventId = Number(req.body?.eventId) || (await storage.getFeaturedEvent()).id;
    const studio = await storage.getOrCreateStudio(eventId);
    const room = roomName(studio.id);
    res.json({
      configured: true,
      url: publicLiveKitUrl(),
      room,
      token: await studioToken({
        room,
        identity: `producer-${getAdminEmail(req) || "console"}`,
        name: "Control room",
        canPublish: false,
        admin: true,
      }),
    });
  });

  app.patch("/api/admin/studio", requireAdmin, async (req, res) => {
    const parsed = studioUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const eventId = Number(req.body?.eventId) || (await storage.getFeaturedEvent()).id;
    const studio = await storage.getOrCreateStudio(eventId);
    res.json(await storage.updateStudio(studio.id, parsed.data));
  });

  app.patch("/api/admin/studio/participants/:id", requireAdmin, async (req, res) => {
    const state = String(req.body?.state ?? "");
    if (!["Green room", "On stage", "Off stage"].includes(state)) {
      res.status(400).json({ message: "Unknown state" });
      return;
    }
    const id = Number(req.params.id);
    if (state === "On stage") {
      // Never exceed the stage size the producer set.
      const eventId = Number(req.body?.eventId) || (await storage.getFeaturedEvent()).id;
      const studio = await storage.getOrCreateStudio(eventId);
      const all = await storage.listStudioParticipants(studio.id);
      const onStage = all.filter((p) => p.state === "On stage" && p.id !== id);
      if (onStage.length >= studio.maxOnStage) {
        res.status(409).json({ message: `The stage is full at ${studio.maxOnStage}. Take someone off first.` });
        return;
      }
    }
    const row = await storage.setParticipantState(id, state);
    if (!row) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    await syncParticipantState(roomName(row.studioId), `p-${row.id}`, state);
    res.json(row);
  });

  // ---- Studio: going out, and being kept ---------------------------------------
  //      Two egresses run off the same room. The broadcast is one long
  //      composite pushed to every destination at once; the recording is a
  //      short one per podcaster slot. Stopping a slot recording never touches
  //      what's on air.
  app.post("/api/admin/studio/broadcast", requireAdmin, async (req, res) => {
    if (!isLiveKitConfigured()) {
      res.status(503).json({ message: "No media layer configured for this event." });
      return;
    }
    const eventId = Number(req.body?.eventId) || (await storage.getFeaturedEvent()).id;
    const studio = await storage.getOrCreateStudio(eventId);
    const action = String(req.body?.action ?? "");

    if (action === "stop") {
      if (studio.broadcastEgressId) await stopEgressById(studio.broadcastEgressId);
      for (const d of await storage.listDestinations(eventId)) {
        if (d.live) await storage.updateDestination(d.id, { live: false });
      }
      res.json(await storage.updateStudio(studio.id, { broadcastEgressId: "" }));
      return;
    }
    if (action !== "start") {
      res.status(400).json({ message: "Unknown action" });
      return;
    }
    if (studio.broadcastEgressId) {
      res.status(409).json({ message: "Already going out. Stop it first." });
      return;
    }
    // House destinations only at the start; a podcaster's own is attached when
    // their slot comes up.
    const rows = (await storage.listDestinations(eventId)).filter((d) => d.enabled && !d.signupId);
    if (rows.length === 0) {
      res.status(400).json({ message: "Add at least one destination before going out." });
      return;
    }
    const egressId = await startBroadcast(
      roomName(studio.id),
      rows.map((d) => ({ url: ingestUrl(d), label: d.label || d.platform })),
    );
    for (const d of rows) await storage.updateDestination(d.id, { live: true });
    res.json(await storage.updateStudio(studio.id, { broadcastEgressId: egressId }));
  });

  /** Add or drop one destination while the broadcast is already running. */
  app.patch("/api/admin/studio/broadcast", requireAdmin, async (req, res) => {
    const eventId = Number(req.body?.eventId) || (await storage.getFeaturedEvent()).id;
    const studio = await storage.getOrCreateStudio(eventId);
    if (!studio.broadcastEgressId) {
      res.status(409).json({ message: "Nothing is going out yet." });
      return;
    }
    const clean = (v: unknown) =>
      (Array.isArray(v) ? v : []).map((u) => String(u).trim()).filter((u) => /^rtmps?:\/\//i.test(u));
    await updateBroadcastTargets(studio.broadcastEgressId, clean(req.body?.add), clean(req.body?.remove));
    res.json({ ok: true });
  });

  // ---- Destinations -------------------------------------------------------------
  //      A destination with no signupId is the house's own and carries the whole
  //      event. One tied to a signup belongs to that podcaster and is attached
  //      to the running broadcast for their slot only — which is how the event
  //      borrows each speaker's audience and then hands it back.
  function ingestUrl(d: { rtmpUrl: string; streamKey: string }): string {
    return `${d.rtmpUrl.replace(/\/+$/, "")}/${d.streamKey}`;
  }

  /** Stream keys are credentials: a browser only ever sees the last four. */
  function publicDestination(d: DestinationRow) {
    return {
      id: d.id,
      signupId: d.signupId,
      platform: d.platform,
      label: d.label,
      rtmpUrl: d.rtmpUrl,
      keyHint: d.streamKey ? `••••${d.streamKey.slice(-4)}` : "",
      enabled: d.enabled,
      live: d.live,
      ownerEmail: d.ownerEmail,
    };
  }

  app.get("/api/admin/destinations", requireAdmin, async (req, res) => {
    noStore(res);
    const eventId = Number(req.query.eventId) || (await storage.getFeaturedEvent()).id;
    res.json((await storage.listDestinations(eventId)).map(publicDestination));
  });

  app.post("/api/admin/destinations", requireAdmin, async (req, res) => {
    const parsed = destinationInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const eventId = Number(req.body?.eventId) || (await storage.getFeaturedEvent()).id;
    res.status(201).json(publicDestination(await storage.createDestination(eventId, "", parsed.data)));
  });

  app.patch("/api/admin/destinations/:id", requireAdmin, async (req, res) => {
    const existing = await storage.getDestination(Number(req.params.id));
    if (!existing) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    const patch: Record<string, unknown> = {};
    if (typeof req.body?.enabled === "boolean") patch.enabled = req.body.enabled;
    if (typeof req.body?.label === "string") patch.label = req.body.label.trim().slice(0, 80);
    // An empty key means "leave it alone" — the browser never had the real one.
    if (typeof req.body?.streamKey === "string" && req.body.streamKey.trim()) {
      patch.streamKey = req.body.streamKey.trim();
    }
    if (typeof req.body?.rtmpUrl === "string" && req.body.rtmpUrl.trim()) {
      patch.rtmpUrl = req.body.rtmpUrl.trim();
    }

    const updated = await storage.updateDestination(existing.id, patch);
    if (!updated) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    res.json(publicDestination(updated));
  });

  /**
   * Attach or drop one destination on the broadcast that's already running.
   * Kept separate from editing on purpose: "enabled" means we're willing to
   * use it, "live" means it is carrying the show right now, and on show day
   * those must not be the same switch.
   */
  app.post("/api/admin/destinations/:id/live", requireAdmin, async (req, res) => {
    const d = await storage.getDestination(Number(req.params.id));
    if (!d) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    const studio = await storage.getOrCreateStudio(d.eventId);
    if (!studio.broadcastEgressId) {
      res.status(409).json({ message: "Nothing is going out yet." });
      return;
    }
    const want = req.body?.live !== false;
    if (want === d.live) {
      res.json(publicDestination(d));
      return;
    }
    try {
      await updateBroadcastTargets(
        studio.broadcastEgressId,
        want ? [ingestUrl(d)] : [],
        want ? [] : [ingestUrl(d)],
      );
    } catch (err: any) {
      res.status(502).json({ message: err?.message ?? "The broadcast wouldn't take that change." });
      return;
    }
    res.json(publicDestination((await storage.updateDestination(d.id, { live: want }))!));
  });

  app.delete("/api/admin/destinations/:id", requireAdmin, async (req, res) => {
    const existing = await storage.getDestination(Number(req.params.id));
    if (existing?.live) {
      const studio = await storage.getOrCreateStudio(existing.eventId);
      if (studio.broadcastEgressId) {
        await updateBroadcastTargets(studio.broadcastEgressId, [], [ingestUrl(existing)]).catch(() => {});
      }
    }
    await storage.deleteDestination(Number(req.params.id));
    res.json({ ok: true });
  });

  app.post("/api/admin/studio/record", requireAdmin, async (req, res) => {
    if (!isRecordingConfigured()) {
      res.status(503).json({ message: "Recording storage isn't set up yet." });
      return;
    }
    const eventId = Number(req.body?.eventId) || (await storage.getFeaturedEvent()).id;
    const studio = await storage.getOrCreateStudio(eventId);
    const action = String(req.body?.action ?? "");

    if (action === "stop") {
      if (studio.recordingEgressId) await stopEgressById(studio.recordingEgressId);
      res.json(await storage.updateStudio(studio.id, { recordingEgressId: "", recordingSignupId: null }));
      return;
    }
    if (action !== "start") {
      res.status(400).json({ message: "Unknown action" });
      return;
    }
    if (studio.recordingEgressId) {
      res.status(409).json({ message: "Already recording this slot." });
      return;
    }
    const signupId = Number(req.body?.signupId) || 0;
    const signup = signupId ? await storage.getSignupById(signupId) : undefined;
    await ensureRecordingsBucket();

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filepath = `event-${eventId}/${signup ? `slot-${signup.slotIndex}-` : ""}${stamp}.mp4`;
    const egressId = await startSegmentRecording(roomName(studio.id), filepath);

    await storage.createRecording({
      eventId,
      studioId: studio.id,
      signupId: signup?.id ?? null,
      email: (signup?.email ?? "").toLowerCase().trim(),
      title: signup?.podcastName || studio.name,
      egressId,
      filepath,
    });
    res.json(await storage.updateStudio(studio.id, { recordingEgressId: egressId, recordingSignupId: signup?.id ?? null }));
  });

  app.get("/api/admin/recordings", requireAdmin, async (req, res) => {
    noStore(res);
    const eventId = Number(req.query.eventId) || undefined;
    res.json(await storage.listRecordings(eventId));
  });

  // ---- LiveKit webhook ----------------------------------------------------------
  //      LiveKit signs this with the same API key pair, and sends it as
  //      application/webhook+json — which express.json() leaves alone, so the
  //      raw body is still here to verify against.
  app.post("/api/livekit/webhook", express.raw({ type: "*/*" }), async (req, res) => {
    let event;
    try {
      const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? "");
      event = await webhooks().receive(raw, req.get("Authorization"));
    } catch {
      res.status(401).json({ message: "Bad signature" });
      return;
    }
    // Always 200 once it's verified: LiveKit retries, and a retry storm on a
    // bug of ours would be worse than a missed row.
    res.json({ ok: true });

    if (event.event !== "egress_ended" || !event.egressInfo) return;
    const info = event.egressInfo;
    const file = info.fileResults?.[0];
    // EGRESS_COMPLETE is 3. Trust the status, not the file list: LiveKit
    // sometimes reports a completed egress with fileResults empty even though
    // the upload succeeded, so we fall back to the path we asked it to write.
    const ok = Number(info.status) === 3;
    try {
      await storage.finishRecording(info.egressId, {
        status: ok ? "Ready" : "Failed",
        url: ok && file?.filename ? String(file.filename) : "",
        // LiveKit reports duration in nanoseconds.
        durationSec: file?.duration ? Math.round(Number(file.duration) / 1_000_000_000) : 0,
        sizeBytes: file?.size ? String(file.size) : "0",
      });
    } catch (err) {
      console.error("Couldn't record the end of egress", info.egressId, err);
    }
  });

  app.delete("/api/admin/studio/participants/:id", requireAdmin, async (req, res) => {
    await storage.removeStudioParticipant(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- Public: interest in the platform itself --------------------------------
  app.post("/api/platform-interest", async (req, res) => {
    const parsed = platformInterestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const row = await storage.createPlatformInterest(parsed.data);
    res.status(201).json({ ok: true, id: row.id });

    // Tell the team, but never let a flaky mailer fail the submission.
    (async () => {
      try {
        await sendPlatformInterestEmail(parsed.data);
      } catch (err) {
        console.error("Platform interest notification failed:", err);
      }
    })();
  });

  app.get("/api/admin/platform-interest", requireAdmin, async (_req, res) => {
    res.json(await storage.listPlatformInterest());
  });

  // ---- Public: site settings ----------------------------------------------------
  app.get("/api/settings", async (_req, res) => {
    publicCache(res, 60);
    const out: PublicSettings = { sponsorsVisible: (await storage.getSetting("sponsorsVisible")) === "true" };
    res.json(out);
  });

  app.get("/api/admin/settings", requireAdmin, async (_req, res) => {
    const out: PublicSettings = { sponsorsVisible: (await storage.getSetting("sponsorsVisible")) === "true" };
    res.json(out);
  });

  app.patch("/api/admin/settings", requireAdmin, async (req, res) => {
    if (typeof req.body?.sponsorsVisible === "boolean") {
      await storage.setSetting("sponsorsVisible", req.body.sponsorsVisible ? "true" : "false");
    }
    const out: PublicSettings = { sponsorsVisible: (await storage.getSetting("sponsorsVisible")) === "true" };
    res.json(out);
  });

  // ---- Admin: sponsors CRUD ------------------------------------------------------
  app.get("/api/admin/sponsors", requireAdmin, async (_req, res) => {
    res.json(await storage.listSponsors(false));
  });

  app.post("/api/admin/sponsors", requireAdmin, (req, res, next) => {
    upload.single("logo")(req, res, (err) => {
      if (err) {
        res.status(400).json({ message: err.message || "Couldn't read that logo." });
        return;
      }
      next();
    });
  }, async (req, res) => {
    const body = req.body as Record<string, string>;
    const name = String(body.name ?? "").trim();
    if (!name) {
      res.status(400).json({ message: "Give the sponsor a name." });
      return;
    }
    if (!req.file) {
      res.status(400).json({ message: "Upload a logo (PNG or SVG with a transparent background works best)." });
      return;
    }
    const parsedUrl = updateSponsorSchema.shape.url.safeParse(body.url ?? "");
    const url = parsedUrl.success ? parsedUrl.data ?? "" : "";
    try {
      const ext = (req.file.mimetype.split("/")[1] || "png").replace("svg+xml", "svg").replace("jpeg", "jpg");
      const filename = `sponsors/${Date.now()}-${crypto.randomBytes(5).toString("hex")}.${ext}`;
      const logoUrl = await uploadPhoto(filename, req.file.buffer, req.file.mimetype);
      const created = await storage.createSponsor({ name, url, logoUrl });
      res.status(201).json(created);
    } catch (err) {
      console.error("Sponsor logo upload failed:", err);
      res.status(500).json({ message: "Couldn't store that logo. Try again." });
    }
  });

  app.patch("/api/admin/sponsors/:id", requireAdmin, async (req, res) => {
    const parsed = updateSponsorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const updated = await storage.updateSponsor(Number(req.params.id), parsed.data);
    if (!updated) {
      res.status(404).json({ message: "Sponsor not found" });
      return;
    }
    res.json(updated);
  });

  app.delete("/api/admin/sponsors/:id", requireAdmin, async (req, res) => {
    await storage.deleteSponsor(Number(req.params.id));
    res.json({ ok: true });
  });

  app.get("/api/signups", async (req, res) => {
    publicCache(res);
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
      showFormat: profile.showFormat,
      recordingUrl: profile.recordingUrl,
      introStyle: profile.introStyle,
      branch: profile.branch,
      serviceStatus: profile.serviceStatus,
      recordingMode: profile.recordingMode,
      postEdits: profile.postEdits,
      streamPlatform: profile.streamPlatform,
      streamPlatformOther: profile.streamPlatformOther,
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

    // One active slot per podcaster per event. The dashboard swaps by
    // releasing first; anything else gets a clear message.
    const mineActive = (await storage.listSignups(parsed.data.eventId)).filter(
      (s) => s.status !== "cancelled" && s.email.trim().toLowerCase() === email,
    );
    if (mineActive.length > 0) {
      res.status(409).json({ message: "You already hold a slot on this event. Release it from your dashboard to pick a different time." });
      return;
    }

    const created = await storage.createSignup(parsed.data);
    res.status(201).json(toPublicSignup(created));

    // Send the confirmation email in the background — never block or fail the
    // signup response on email delivery.
    (async () => {
      try {
        const blockStart = new Date(new Date(event.startAtUtc).getTime() + created.slotIndex * event.slotMinutes * 60000);
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
          onAirStartLabel: formatDateTimeInZone(onAir.start, tz),
          onAirEndLabel: formatTimeInZone(onAir.end, tz),
          timezoneLabel: zoneAbbrev(onAir.start, tz),
          agendaUrl,
          calendar: calendarLinksFor(created, event, `${protocol}://${host}`),
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

    // Confirmation with add-to-calendar links, in the background.
    (async () => {
      try {
        const event = (await storage.getEventById(signup.eventId)) ?? (await storage.getFeaturedEvent());
        const tz = parsed.data.timezone || "America/New_York";
        const { start } = slotWindow(event, signup.slotIndex);
        const onAir = onAirWindowServer(start, event.onAirMinutes, event.bufferMinutes, event.bufferPosition);
        const origin = `${req.protocol}://${req.get("host")}`;
        await sendReminderConfirmationEmail({
          to: parsed.data.email,
          name: parsed.data.name,
          podcastName: signup.podcastName,
          hostName: signup.hostName,
          eventName: event.name,
          whenLabel: formatDateTimeInZone(onAir.start, tz),
          timezoneLabel: zoneAbbrev(onAir.start, tz),
          agendaUrl: `${origin}/agenda`,
          calendar: calendarLinksFor(signup, event, origin),
          wantsText: !!parsed.data.phone,
        });
      } catch (err) {
        console.error("Failed to send reminder confirmation email:", err);
      }
    })();
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
    await storage.supersedeLoginTokens(email);
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
    if (!row) {
      res.status(401).json({ message: "We don't recognise that code. Check the newest email — an older code stops working once you ask for another." });
      return;
    }
    if (row.usedAt) {
      res.status(401).json({ message: "That code has already been used. Ask for a new one." });
      return;
    }
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      res.status(401).json({ message: "That code has expired — they last 15 minutes. Ask for a new one." });
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
      showFormat: body.showFormat === "prerecorded" ? "prerecorded" : "live",
      recordingUrl: body.recordingUrl ?? "",
      introStyle: body.introStyle === "straight" ? "straight" : "virtual",
      branch: body.branch ?? "",
      serviceStatus: body.serviceStatus ?? "",
      recordingMode: body.recordingMode ?? "",
      postEdits: body.postEdits ?? "",
      streamPlatform: body.streamPlatform ?? "",
      streamPlatformOther: body.streamPlatformOther ?? "",
      guests: body.guests ?? "",
      interviewQuestions: body.interviewQuestions ?? "",
      promoNotes: body.promoNotes ?? "",
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
    // Keep any slots they already hold in step with the profile.
    await storage.syncSignupsFromProfile(email, updated);
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
    // First-time podcasters can connect socials from the setup form before
    // saving; a stub profile row (email only) gives us a stable id to key the
    // Upload-Post profile on. It stays hidden from public lists until finished.
    const profile = (await storage.getProfileByEmail(email)) ?? (await storage.upsertProfile(email, {}));
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
      const accounts = await enrichWithFollowers(
        profile.uploadPostUsername,
        await fetchConnectedAccounts(profile.uploadPostUsername),
      );
      const json = JSON.stringify(accounts);
      await storage.upsertProfile(email, { socialAccounts: json });
      await storage.updateSignupSocialAccountsByEmail(email, json);
      res.json({ configured: true, accounts });
    } catch (err: any) {
      console.error("Upload-Post refresh failed:", err);
      res.status(502).json({ message: "Couldn't read your connected accounts right now." });
    }
  });

  // ---- Host: release (cancel) one of their own slots ---------------------------
  app.delete("/api/host/signups/:id", requireHostSession, async (req, res) => {
    const email = (req as any).hostEmail as string;
    const id = Number(req.params.id);
    const row = await storage.getSignupById(id);
    if (!row || row.email.trim().toLowerCase() !== email) {
      res.status(404).json({ message: "That slot isn't yours to release." });
      return;
    }
    if (row.status === "cancelled") {
      res.json({ ok: true });
      return;
    }
    await storage.cancelSignup(id);
    res.json({ ok: true });
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
      .map((r) => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, createdAt: r.createdAt, signupId: r.signupId }));
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
    const lines = ["name,email,phone,created_at"];
    for (const r of reminderRows) {
      if (!mySignupIds.has(r.signupId)) continue;
      lines.push([r.name, r.email, r.phone, r.createdAt].map(escape).join(","));
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=my-militaryvoice-contacts.csv");
    res.send(lines.join("\n"));
  });
}
