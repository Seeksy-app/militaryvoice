import express from "express";
import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import crypto from "node:crypto";
import multer from "multer";
import sharp from "sharp";
import { storage } from "./storage.js";
import { requireHuman, turnstileSiteKey } from "./turnstile.js";
import { answerHelp, isHelpAgentConfigured, type HelpTurn } from "./help.js";
import { KINDS, effectiveSchedule, cardInput, caption as campaignCaption, isKind, type CampaignContext } from "./campaign.js";
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
  type SignupRow,
  updateSponsorSchema,
  upsertSponsorPackageSchema,
  SPONSOR_TIERS,
  type SponsorTier,
  insertEventShowSchema,
  NUDGE_KINDS,
  type NudgeKind,
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
  syncRoomMetadata,
  updateBroadcastTargets,
  rooms,
  createRtmpIngress,
  deleteIngress,
  listIngressForRoom,
  webhooks,
} from "./livekit.js";
import { ensureRecordingsBucket, signedRecordingUrl } from "./recordingStorage.js";
import {
  isYoutubeConfigured,
  consentUrl,
  exchangeCode,
  refreshAccessToken,
  myChannel,
  createBroadcast,
} from "./youtube.js";
import { buildShareCard, CARD_SIZES, type CardSize } from "./shareCard.js";
import {
  sendPrepNudge,
  sendFinalNudge,
  sendOnAirNudge,
  sendBookingAlert,
  sendScheduleReference,
  sendHelpRequestAlert,
  sendListenerStartingSoon,
  sendBroadcastEmail,
  resendApiGet,
} from "./email.js";
import { sendConfirmationEmail, sendLoginCodeEmail, sendReminderConfirmationEmail, sendSponsorInquiryEmail, sendPlatformInterestEmail, buildCalendarLinks } from "./email.js";
import type { DestinationRow, StudioRow, StudioParticipantRow, RunItemRow } from "../shared/schema.js";
import { setSessionCookie, clearSessionCookie, requireHostSession, getSessionEmail, setAdminCookie, clearAdminCookie, getAdminEmail } from "./session.js";
import {
  publishPhoto,
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
  // ---- Search engines -----------------------------------------------------------
  //      Built from the real events rather than kept as a static file, so a new
  //      event is discoverable the moment it's published.
  /**
   * Post the podcaster's own promo card to the accounts they've connected.
   * The image is the one we generate for them, so there is nothing to make
   * and nothing to upload — they pick the accounts and press the button.
   */
  app.post("/api/host/share/publish", requireHostSession, async (req, res) => {
    const email = (req as any).hostEmail as string;
    if (!isUploadPostConfigured()) {
      res.status(400).json({ message: "Posting isn't switched on yet." });
      return;
    }
    const profile = await storage.getProfileByEmail(email);
    if (!profile?.uploadPostUsername) {
      res.status(400).json({ message: "Connect an account first, on the Integrations tab." });
      return;
    }

    // YouTube takes videos, not stills — offering it here would only produce a
    // failure at the far end.
    const PHOTO_PLATFORMS = ["instagram", "tiktok", "x", "linkedin", "facebook", "threads", "pinterest"];
    const platforms = (Array.isArray(req.body?.platforms) ? req.body.platforms.map(String) : []).filter((p: string) =>
      PHOTO_PLATFORMS.includes(p),
    );
    if (platforms.length === 0) {
      res.status(400).json({ message: "Pick at least one account that takes images." });
      return;
    }
    const requested = String(req.body?.size ?? "square");
    const size: CardSize = requested in CARD_SIZES ? (requested as CardSize) : "square";

    const featured = await storage.getFeaturedEvent();
    const signup = (await storage.listSignups(featured.id)).find(
      (x) => x.status !== "cancelled" && x.email.trim().toLowerCase() === email.toLowerCase(),
    );
    if (!signup) {
      res.status(400).json({ message: "Claim a time slot first — there's nothing to announce yet." });
      return;
    }

    const origin = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoice.ai").replace(/\/+$/, "");
    const blockStart = new Date(
      new Date(featured.startAtUtc).getTime() + signup.slotIndex * featured.slotMinutes * 60000,
    );
    const onAir = onAirWindowServer(blockStart, featured.onAirMinutes, featured.bufferMinutes, featured.bufferPosition);
    const tz = signup.timezone || "America/New_York";
    const whenLabel = `${formatDateTimeInZone(onAir.start, tz)} ${zoneAbbrev(onAir.start, tz)}`;

    const caption =
      typeof req.body?.caption === "string" && req.body.caption.trim()
        ? String(req.body.caption)
        : `I'm live on National Military Podcast Day. ${signup.podcastName} — ${whenLabel}. ` +
          `Set a reminder and tune in: ${origin}/s/${signup.id}`;

    try {
      // Upload-Post fetches the image itself, so hand it the generated card's
      // public URL rather than shipping bytes through this request.
      const result = await publishPhoto({
        username: profile.uploadPostUsername,
        platforms,
        photoUrl: `${origin}/og/slot/${signup.id}.jpg?size=${size}`,
        title: caption,
      });
      res.json({ ok: true, platforms, result });
    } catch (err) {
      res.status(502).json({ message: (err as Error).message });
    }
  });

  // ---- Scheduled nudges --------------------------------------------------------
  //      One hourly pass. Idempotent: every send is claimed in the database
  //      first, so a double-fired cron, a retry or a mid-run redeploy cannot
  //      email anyone twice.

  /** Everything a nudge says about one booking. Shared by the sender and the
   *  admin preview so what you review is what actually goes out. */
  async function buildNudgePayload(signup: SignupRow, event: EventRow) {
    const blockStart = new Date(new Date(event.startAtUtc).getTime() + signup.slotIndex * event.slotMinutes * 60000);
    const onAir = onAirWindowServer(blockStart, event.onAirMinutes, event.bufferMinutes, event.bufferPosition);
    const tz = signup.timezone || "America/New_York";
    // A cron run has no request to read a host from.
    const origin = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoice.ai").replace(/\/+$/, "");
    const show = await storage.getEventShow(signup.email, event.id).catch(() => undefined);

    const outstanding: string[] = [];
    if (!(await storage.listAssetsByEmail(signup.email)).length) {
      outstanding.push("Nothing uploaded yet — intro, outro, slides or images.");
    }
    if (!signup.socialAccounts || signup.socialAccounts === "[]") {
      outstanding.push("No social accounts connected, so no follow buttons on your card.");
    }
    if (show?.showFormat === "prerecorded" && !show.recordingUrl) {
      outstanding.push("We still need the file for your recorded episode.");
    }

    return {
      to: signup.email,
      hostName: signup.hostName,
      podcastName: signup.podcastName,
      eventName: event.name,
      onAirLabel: `${formatDateTimeInZone(onAir.start, tz)} ${zoneAbbrev(onAir.start, tz)}`,
      dashboardUrl: `${origin}/host/dashboard`,
      // Their own link: joining through it tags them, so their scene finds them.
      studioUrl: `${origin}/studio?s=${signup.id}`,
      shareUrl: `${origin}/s/${signup.id}`,
      outstanding,
    };
  }

  const NUDGE_LEAD_MS: Record<NudgeKind, number> = {
    prep: 14 * 24 * 3600_000,
    final: 2 * 24 * 3600_000,
    onair: 60 * 60_000,
  };

  /** Work out and send whatever is due. Safe to call as often as you like. */
  async function runNudges(opts: { dryRun?: boolean } = {}) {
    const now = Date.now();
    const events = await storage.listEvents();
    const out: { signupId: number; to: string; kind: NudgeKind; sent: boolean; suppressed: NudgeKind[] }[] = [];

    for (const event of events) {
      const signups = (await storage.listSignups(event.id)).filter((x) => x.status !== "cancelled");
      if (signups.length === 0) continue;
      const shows = await Promise.all(
        signups.map((sg) => storage.getEventShow(sg.email, event.id).catch(() => undefined)),
      );
      const already = await storage.listNudgesForSignups(signups.map((x) => x.id));
      const sentKeys = new Set(already.map((n) => `${n.signupId}:${n.kind}`));

      for (let i = 0; i < signups.length; i++) {
        const signup = signups[i];
        const blockStart = new Date(new Date(event.startAtUtc).getTime() + signup.slotIndex * event.slotMinutes * 60000);
        const onAir = onAirWindowServer(blockStart, event.onAirMinutes, event.bufferMinutes, event.bufferPosition);
        // Nothing to nudge about once they're on.
        if (onAir.start.getTime() <= now) continue;

        const due = NUDGE_KINDS.filter(
          (k) => now >= onAir.start.getTime() - NUDGE_LEAD_MS[k] && !sentKeys.has(`${signup.id}:${k}`),
        );
        if (due.length === 0) continue;

        // Only the most urgent one goes out. Somebody who books three days
        // before their slot should not receive "two weeks to go".
        const kind = due[due.length - 1];
        const suppressed = due.slice(0, -1);

        if (opts.dryRun) {
          out.push({ signupId: signup.id, to: signup.email, kind, sent: false, suppressed });
          continue;
        }

        for (const k of suppressed) await storage.claimNudge(signup.id, k, false);
        // Claim before sending: a missed nudge beats a duplicate.
        if (!(await storage.claimNudge(signup.id, kind, true))) continue;

        const payload = await buildNudgePayload(signup, event);

        const send = kind === "prep" ? sendPrepNudge : kind === "final" ? sendFinalNudge : sendOnAirNudge;
        let sent = false;
        try {
          sent = await send(payload);
          if (!sent) {
            // A definite rejection from Resend — nothing was delivered, so
            // hand the claim back and let the next hour try again. A thrown
            // error is ambiguous (it may have arrived), so that one keeps the
            // claim and stays missed rather than risking a duplicate.
            await storage.releaseNudge(signup.id, kind);
          }
        } catch (err) {
          console.error(`Nudge ${kind} failed for signup ${signup.id}:`, err);
        }
        out.push({ signupId: signup.id, to: signup.email, kind, sent, suppressed });
        if (sent) await storage.incrementCadenceBroadcast(event.id, kind, 1).catch(() => {});
      }
    }
    return out;
  }

  /**
   * Vercel's scheduler calls this. It sends the bearer token from CRON_SECRET
   * when that is set; an admin can also call it by hand. Without a secret set
   * we refuse in production rather than leave a mailer open to the internet.
   */
  /**
   * Send all three nudges to one address, so the copy can be read the way a
   * podcaster will read it. Records nothing, so it can't stop a real nudge
   * going out later, and it only ever mails the address you name.
   */
  // Send one of the outward emails to an address you name, to see the design.
  app.post("/api/admin/emails/preview", requireAdmin, async (req, res) => {
    const to = String(req.body?.to || "").trim();
    const kind = String(req.body?.kind || "welcome");
    if (!to.includes("@")) {
      res.status(400).json({ message: "Give me an address to send to." });
      return;
    }
    let sent = false;
    if (kind === "schedule") {
      sent = await sendScheduleReference(to);
    } else if (kind === "starting") {
      sent = await sendListenerStartingSoon({
        to,
        name: "Jamie",
        podcastName: "The Devil Dawg Podcast",
        hostName: "Riccoh Player",
        timeLabel: "9:30 AM EDT",
        minutesAway: 30,
        watchUrl: `${PUBLIC_ORIGIN}/watch`,
        cardUrl: `${PUBLIC_ORIGIN}/agenda?slot=5`,
        youtubeUrl: "https://www.youtube.com/@MilitaryVoice",
      });
    } else {
      const featured = await storage.getFeaturedEvent();
      const active = (await storage.listSignups(featured.id)).filter((x) => x.status !== "cancelled");
      const signup = active[active.length - 1];
      sent = await sendConfirmationEmail({
        to,
        hostName: signup?.hostName || "Riccoh",
        podcastName: signup?.podcastName || "The Devil Dawg Podcast",
        eventName: featured.name,
        onAirStartLabel: "Mon, Oct 5 · 9:30 AM",
        onAirEndLabel: "9:55 AM",
        timezoneLabel: "US Eastern (EDT)",
        agendaUrl: `${PUBLIC_ORIGIN}/agenda`,
      });
    }
    res.json({ to, kind, sent });
  });

  app.post("/api/admin/nudges/preview", requireAdmin, async (req, res) => {
    const to = String(req.body?.to || "").trim();
    if (!to.includes("@")) {
      res.status(400).json({ message: "Give me an address to send to." });
      return;
    }
    const explicit = Number(req.body?.signupId) || null;
    const featured = await storage.getFeaturedEvent();
    const active = (await storage.listSignups(featured.id)).filter((x) => x.status !== "cancelled");
    const signup = explicit ? active.find((x) => x.id === explicit) : active[active.length - 1];
    if (!signup) {
      res.status(404).json({ message: "No booking to build a preview from." });
      return;
    }

    const base = await buildNudgePayload(signup, featured);
    const payload = { ...base, to };
    const sent: Record<string, boolean> = {};
    for (const [kind, send] of [
      ["prep", sendPrepNudge],
      ["final", sendFinalNudge],
      ["onair", sendOnAirNudge],
    ] as const) {
      try {
        sent[kind] = await send(payload);
      } catch (err) {
        console.error(`Preview ${kind} failed:`, err);
        sent[kind] = false;
      }
    }
    res.json({ to, basedOn: signup.podcastName, sent });
  });

  //      Vercel's scheduler issues GET, so both verbs are accepted — a
  //      POST-only route here would simply never have fired.
  const nudgeHandler: RequestHandler = async (req, res) => {
    const secret = process.env.CRON_SECRET;
    const bearer = (req.header("authorization") || "").replace(/^Bearer /i, "");
    const isCron = !!secret && bearer === secret;
    let isAdmin = false;
    const sessionEmail = getAdminEmail(req);
    if (sessionEmail && (await storage.isAdminEmail(sessionEmail))) isAdmin = true;
    if (!isAdmin) {
      const pw = (req.header("x-admin-password") || "").trim();
      const featured = await storage.getFeaturedEvent();
      if (pw && pw === featured.adminPassword) isAdmin = true;
    }
    if (!isCron && !isAdmin) {
      res.status(401).json({ message: "Not authorised." });
      return;
    }
    const dryRun = req.query.dryRun === "1" || req.body?.dryRun === true;
    const results = await runNudges({ dryRun });
    const posts = dryRun ? [] : await runCampaign();
    const listeners = await runListenerReminders({ dryRun });
    res.json({ dryRun, considered: results.length, results, posts, listeners });
  };
  app.get("/api/cron/nudges", nudgeHandler);
  app.post("/api/cron/nudges", nudgeHandler);

  /** Hourly cron: fire any scheduled broadcasts whose time has come. */
  const scheduledBroadcastHandler: RequestHandler = async (req, res) => {
    const cronSecret = process.env.CRON_SECRET;
    const auth = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (cronSecret && auth !== cronSecret) {
      res.status(401).json({ message: "Not authorised." });
      return;
    }
    const due = await storage.listScheduledBroadcasts();
    const origin = `${req.protocol}://${req.get("host")}`;
    let fired = 0;
    for (const broadcast of due) {
      try {
        const deduped = new Map<string, { email: string; firstName: string }>();
        if (broadcast.segment === "signups" || broadcast.segment === "all") {
          if (broadcast.eventId) {
            for (const r of await storage.listSignupContactsForEvent(broadcast.eventId)) {
              deduped.set(r.email.toLowerCase(), r);
            }
          }
        }
        if (broadcast.segment === "contacts" || broadcast.segment === "all") {
          for (const r of await storage.listActiveContactEmails()) {
            deduped.set(r.email.toLowerCase(), r);
          }
        }
        if (broadcast.segment.startsWith("segment:")) {
          const segId = Number(broadcast.segment.split(":")[1]);
          const segList = await storage.listSegments(broadcast.eventId ?? null);
          const seg = segList.find((s) => s.id === segId);
          if (seg) {
            const filter = JSON.parse(seg.filterJson) as Parameters<typeof storage.resolveSegment>[0];
            for (const r of await storage.resolveSegment(filter)) {
              deduped.set(r.email.toLowerCase(), r);
            }
          }
        }
        if (broadcast.segment.startsWith("engagement:")) {
          const [, bId, engType] = broadcast.segment.split(":");
          const rows = await storage.getEngagementRecipients(Number(bId), engType as any);
          for (const r of rows) deduped.set(r.email.toLowerCase(), r);
        }
        const recipients = Array.from(deduped.values());
        const senderMember = await resolveTeamSender(broadcast.sender ?? "team");
        let sent = 0;
        for (const r of recipients) {
          const resendId = await sendBroadcastEmail({
            to: r.email,
            firstName: r.firstName,
            subject: broadcast.subject,
            bodyText: broadcast.bodyText,
            unsubscribeUrl: `${origin}/unsubscribe?token=scheduled`,
            sender: broadcast.sender ?? "team",
            banner: broadcast.banner ?? "welcome",
            senderMember: senderMember ?? undefined,
          });
          if (resendId) {
            sent++;
            await storage.recordBroadcastSend(broadcast.id, r.email, resendId);
          }
        }
        await storage.markBroadcastSent(broadcast.id, sent);
        fired++;
      } catch (err) {
        console.error(`Scheduled broadcast ${broadcast.id} failed:`, err);
      }
    }
    res.json({ fired, total: due.length });
  };
  app.get("/api/cron/broadcasts", scheduledBroadcastHandler);
  app.post("/api/cron/broadcasts", scheduledBroadcastHandler);

  // ---- A podcaster's own share link -------------------------------------------
  //      /s/:id unfurls with their artwork and their time, then sends the
  //      reader to their card on the agenda. Static tags in index.html can't
  //      vary per podcaster, so this route serves its own HTML.

  /** Everything both share routes need, or null if the slot isn't live. */
  async function shareSubject(id: number) {
    const signup = await storage.getSignupById(id);
    if (!signup || signup.status === "cancelled") return null;
    const event = await storage.getEventById(signup.eventId);
    if (!event) return null;
    const blockStart = new Date(new Date(event.startAtUtc).getTime() + signup.slotIndex * event.slotMinutes * 60000);
    const onAir = onAirWindowServer(blockStart, event.onAirMinutes, event.bufferMinutes, event.bufferPosition);
    const tz = signup.timezone || "America/New_York";
    return {
      signup,
      event,
      whenLabel: `${formatDateTimeInZone(onAir.start, tz)} ${zoneAbbrev(onAir.start, tz)}`,
    };
  }

  app.get("/og/slot/:id.jpg", async (req, res) => {
    const found = await shareSubject(Number(req.params.id));
    if (!found) {
      res.status(404).end();
      return;
    }
    const { signup, whenLabel } = found;
    const origin = `${req.protocol}://${req.get("host")}`;
    const photo = signup.photoUrl
      ? signup.photoUrl.startsWith("http")
        ? signup.photoUrl
        : `${origin}${signup.photoUrl}`
      : undefined;
    const requested = String(req.query.size ?? "wide");
    const size: CardSize = requested in CARD_SIZES ? (requested as CardSize) : "wide";
    const jpg = await buildShareCard(
      { podcastName: signup.podcastName, hostName: signup.hostName, whenLabel, photoUrl: photo },
      size,
    );
    // Scrapers fetch this once and cache hard; so should the CDN.
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
    res.end(jpg);
  });

  // ---- Posting plan: six designed posts we publish from their accounts ------
  const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoice.ai").replace(/\/+$/, "");
  const CAMPAIGN_PLATFORMS = ["instagram", "tiktok", "x", "linkedin", "facebook", "threads"];

  async function campaignContext(signupId: number): Promise<(CampaignContext & { onAirStart: Date }) | null> {
    const found = await shareSubject(signupId);
    if (!found) return null;
    const { signup, event } = found;
    const blockStart = new Date(new Date(event.startAtUtc).getTime() + signup.slotIndex * event.slotMinutes * 60000);
    const onAir = onAirWindowServer(blockStart, event.onAirMinutes, event.bufferMinutes, event.bufferPosition);
    const tz = signup.timezone || "America/New_York";
    const eventDateLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })
      .format(new Date(event.startAtUtc));
    return {
      event,
      signup,
      onAirStart: onAir.start,
      whenLabel: found.whenLabel,
      timeLabel: `${formatTimeInZone(onAir.start, tz)} ${zoneAbbrev(onAir.start, tz)}`,
      eventDateLabel,
      shareUrl: `${PUBLIC_ORIGIN}/s/${signup.id}`,
      aboutUrl: `${PUBLIC_ORIGIN}/event/${event.slug || "marathon"}/about`,
    };
  }

  // The creative itself. Public, because Upload-Post fetches it by URL.
  app.get("/og/campaign/:signupId/:kind.jpg", async (req, res) => {
    const kind = req.params.kind;
    if (!isKind(kind)) {
      res.status(404).end();
      return;
    }
    const ctx = await campaignContext(Number(req.params.signupId));
    if (!ctx) {
      res.status(404).end();
      return;
    }
    const requested = String(req.query.size ?? "square");
    const size: CardSize = requested in CARD_SIZES ? (requested as CardSize) : "square";
    const input = cardInput(kind, ctx);
    if (input.photoUrl && !input.photoUrl.startsWith("http")) input.photoUrl = `${PUBLIC_ORIGIN}${input.photoUrl}`;
    const jpg = await buildShareCard(input, size);
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=600, s-maxage=3600");
    res.end(jpg);
  });

  async function ownSignup(req: Request, res: Response, signupId: number) {
    const email = ((req as any).hostEmail as string).toLowerCase();
    const signup = await storage.getSignupById(signupId);
    if (!signup || signup.status === "cancelled" || signup.email.trim().toLowerCase() !== email) {
      res.status(404).json({ message: "That booking isn't yours, or it no longer exists." });
      return null;
    }
    return signup;
  }

  app.get("/api/host/campaign", requireHostSession, async (req, res) => {
    const signupId = Number(req.query.signupId);
    const signup = await ownSignup(req, res, signupId);
    if (!signup) return;
    const ctx = await campaignContext(signupId);
    if (!ctx) {
      res.status(404).json({ message: "No slot to plan around yet." });
      return;
    }
    const profile = await storage.getProfileByEmail(signup.email);
    const connected = parseSocialAccounts(profile?.socialAccounts)
      .map((a) => a.platform)
      .filter((p) => CAMPAIGN_PLATFORMS.includes(p));
    const rows = await storage.listCampaignPosts(signupId);
    const now = Date.now();
    const schedule = effectiveSchedule(ctx.event, ctx.onAirStart);
    const posts = KINDS.map((def) => {
      const row = rows.find((r) => r.kind === def.kind);
      const when = new Date(row?.status === "planned" || !row ? schedule.get(def.kind)!.toISOString() : row.scheduledFor);
      return {
        kind: def.kind,
        label: def.label,
        blurb: def.blurb,
        scheduledFor: when.toISOString(),
        // Within the hour of now: the cron picks it up on its next pass.
        past: when.getTime() <= now + 3600000,
        selected: Boolean(row),
        status: row?.status ?? null,
        platforms: row ? row.platforms.split(",").filter(Boolean) : [],
        postedAt: row?.postedAt || null,
        error: row?.error || null,
        caption: campaignCaption(def.kind, ctx),
        imageUrl: `/og/campaign/${signupId}/${def.kind}.jpg?size=square`,
      };
    });
    const saved = rows.find((r) => r.platforms)?.platforms.split(",").filter(Boolean) ?? [];
    res.setHeader("Cache-Control", "no-store");
    res.json({
      configured: isUploadPostConfigured() && Boolean(profile?.uploadPostUsername),
      connected,
      platforms: saved,
      posts,
    });
  });

  app.put("/api/host/campaign", requireHostSession, async (req, res) => {
    const signupId = Number(req.body?.signupId);
    const signup = await ownSignup(req, res, signupId);
    if (!signup) return;
    const ctx = await campaignContext(signupId);
    if (!ctx) {
      res.status(404).json({ message: "Claim a time slot first." });
      return;
    }
    const kinds = (Array.isArray(req.body?.kinds) ? req.body.kinds : []).filter(isKind);
    const platforms = (Array.isArray(req.body?.platforms) ? req.body.platforms.map(String) : [])
      .filter((p: string) => CAMPAIGN_PLATFORMS.includes(p));
    if (kinds.length > 0) {
      const profile = await storage.getProfileByEmail(signup.email);
      if (!isUploadPostConfigured() || !profile?.uploadPostUsername) {
        res.status(400).json({ message: "Connect a social account on the Integrations tab first." });
        return;
      }
      if (platforms.length === 0) {
        res.status(400).json({ message: "Pick at least one account to post from." });
        return;
      }
    }
    const schedule = effectiveSchedule(ctx.event, ctx.onAirStart);
    const picks = KINDS.filter((d) => kinds.includes(d.kind)).map((d) => ({
      kind: d.kind,
      platforms,
      scheduledFor: schedule.get(d.kind)!.toISOString(),
    }));
    const rows = await storage.replaceCampaignPlan(signupId, picks);
    res.json({ ok: true, planned: rows.filter((r) => r.status === "planned").length });
  });

  /**
   * Listeners who tapped "Remind me": one email in the hour before the show.
   * The cron runs on the hour, so a 9:30 show is announced at 9:00 and a
   * 9:00 show at 8:00. Claimed before sending; released on a definite
   * rejection so the next pass retries.
   */
  const LISTENER_WINDOW_MS = 65 * 60_000;
  async function runListenerReminders(opts: { dryRun?: boolean } = {}) {
    const now = Date.now();
    const pending = (await storage.listReminders()).filter((r) => !r.remindedAt);
    const out: { id: number; to: string; signupId: number; minutesAway: number; sent: boolean }[] = [];
    if (pending.length === 0) return out;
    const events = await storage.listEvents();
    const signupCache = new Map<number, Awaited<ReturnType<typeof storage.getSignupById>>>();
    for (const r of pending) {
      let signup = signupCache.get(r.signupId);
      if (signup === undefined) {
        signup = await storage.getSignupById(r.signupId);
        signupCache.set(r.signupId, signup);
      }
      if (!signup || signup.status === "cancelled") continue;
      const event = events.find((e) => e.id === signup!.eventId);
      if (!event) continue;
      const blockStart = new Date(new Date(event.startAtUtc).getTime() + signup.slotIndex * event.slotMinutes * 60000);
      const onAir = onAirWindowServer(blockStart, event.onAirMinutes, event.bufferMinutes, event.bufferPosition);
      const ms = onAir.start.getTime() - now;
      // Not yet close, or already on/over: nothing to send this pass.
      if (ms > LISTENER_WINDOW_MS || onAir.end.getTime() < now) continue;
      const minutesAway = Math.max(0, Math.round(ms / 60000));
      if (opts.dryRun) {
        out.push({ id: r.id, to: r.email, signupId: signup.id, minutesAway, sent: false });
        continue;
      }
      if (!(await storage.claimReminder(r.id))) continue;
      const tz = r.timezone || signup.timezone || "America/New_York";
      let sent = false;
      try {
        sent = await sendListenerStartingSoon({
          to: r.email,
          name: r.name,
          podcastName: signup.podcastName,
          hostName: signup.hostName,
          timeLabel: `${formatTimeInZone(onAir.start, tz)} ${zoneAbbrev(onAir.start, tz)}`,
          minutesAway,
          watchUrl: `${PUBLIC_ORIGIN}${event.slug && !event.isFeatured ? `/event/${event.slug}/watch` : "/watch"}`,
          cardUrl: `${PUBLIC_ORIGIN}/agenda?slot=${signup.slotIndex}`,
          youtubeUrl: signup.youtubeUrl || undefined,
        });
        if (!sent) await storage.releaseReminder(r.id);
      } catch (err) {
        console.error(`Listener reminder ${r.id} failed:`, err);
      }
      out.push({ id: r.id, to: r.email, signupId: signup.id, minutesAway, sent });
    }
    return out;
  }

  /** Hourly, from the same cron as the nudges. Claim, post, record. */
  async function runCampaign() {
    const due = await storage.listDueCampaignPosts(new Date().toISOString());
    const out: { id: number; signupId: number; kind: string; ok: boolean; error?: string }[] = [];
    for (const row of due) {
      if (!(await storage.claimCampaignPost(row.id))) continue;
      const ctx = isKind(row.kind) ? await campaignContext(row.signupId) : null;
      const profile = ctx ? await storage.getProfileByEmail(ctx.signup.email) : undefined;
      if (!ctx || !profile?.uploadPostUsername) {
        await storage.finishCampaignPost(row.id, false, "No connected account to post from.");
        out.push({ id: row.id, signupId: row.signupId, kind: row.kind, ok: false, error: "no account" });
        continue;
      }
      // Nothing to promote once they've been on.
      if (ctx.onAirStart.getTime() < Date.now()) {
        await storage.finishCampaignPost(row.id, false, "The slot had already happened.");
        out.push({ id: row.id, signupId: row.signupId, kind: row.kind, ok: false, error: "slot passed" });
        continue;
      }
      try {
        await publishPhoto({
          username: profile.uploadPostUsername,
          platforms: row.platforms.split(",").filter(Boolean),
          photoUrl: `${PUBLIC_ORIGIN}/og/campaign/${row.signupId}/${row.kind}.jpg?size=square`,
          title: campaignCaption(row.kind as any, ctx),
        });
        await storage.finishCampaignPost(row.id, true);
        out.push({ id: row.id, signupId: row.signupId, kind: row.kind, ok: true });
      } catch (err) {
        const msg = (err as Error).message;
        await storage.finishCampaignPost(row.id, false, msg);
        out.push({ id: row.id, signupId: row.signupId, kind: row.kind, ok: false, error: msg });
      }
    }
    return out;
  }

  app.get("/s/:id", async (req, res) => {
    const id = Number(req.params.id);
    const found = await shareSubject(id);
    if (!found) {
      res.redirect(302, "/agenda");
      return;
    }
    const { signup, event, whenLabel } = found;
    const origin = `${req.protocol}://${req.get("host")}`;
    const target = `/agenda?slot=${signup.slotIndex}`;
    const title = `${signup.podcastName} · ${whenLabel}`;
    const desc = `${signup.hostName} is live on ${event.name} for National Military Podcast Day. Tune in, or set a reminder.`;
    const img = `${origin}/og/slot/${id}.jpg`;
    const esc = (v: string) =>
      v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");
    res.end(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="MilitaryVoice.ai" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${origin}/s/${id}" />
<meta property="og:image" content="${img}" />
<meta property="og:image:secure_url" content="${img}" />
<meta property="og:image:type" content="image/jpeg" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${esc(title)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(desc)}" />
<meta name="twitter:image" content="${img}" />
<link rel="canonical" href="${origin}${target}" />
<meta http-equiv="refresh" content="0; url=${target}" />
</head>
<body style="margin:0;background:#000741;color:#fff;font:16px/1.5 system-ui,sans-serif">
<div style="max-width:640px;margin:12vh auto;padding:0 24px;text-align:center">
  <p style="opacity:.75">Taking you to the lineup…</p>
  <p><a href="${target}" style="color:#F0A71F;font-weight:600">${esc(signup.podcastName)} — ${esc(whenLabel)}</a></p>
</div>
<script>location.replace(${JSON.stringify(target)});</script>
</body>
</html>`);
  });

  app.get("/sitemap.xml", async (req, res) => {
    const origin = `${req.protocol}://${req.get("host")}`;
    const staticPaths = ["", "/schedule", "/agenda", "/faq", "/prepare", "/platform", "/events", "/policy", "/terms"];
    let events: { slug: string }[] = [];
    try {
      events = (await storage.listEvents()).filter((e) => e.slug);
    } catch {
      /* a sitemap is worth serving even if the database is having a moment */
    }
    const urls = [
      ...staticPaths.map((p) => ({ loc: `${origin}${p}`, priority: p === "" ? "1.0" : "0.7" })),
      ...events.flatMap((e) => [
        { loc: `${origin}/event/${e.slug}`, priority: "0.9" },
        { loc: `${origin}/event/${e.slug}/agenda`, priority: "0.6" },
        { loc: `${origin}/event/${e.slug}/schedule`, priority: "0.6" },
      ]),
    ];
    const today = new Date().toISOString().slice(0, 10);
    res.type("application/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        urls
          .map((u) => `  <url><loc>${u.loc}</loc><lastmod>${today}</lastmod><priority>${u.priority}</priority></url>`)
          .join("\n") +
        `\n</urlset>\n`,
    );
  });

  app.get("/robots.txt", (req, res) => {
    const origin = `${req.protocol}://${req.get("host")}`;
    // The studio, the dashboards and the watch page are either private or
    // meaningless without a session — no reason to spend crawl budget on them.
    res.type("text/plain").send(
      [
        "User-agent: *",
        "Allow: /",
        "Disallow: /admin",
        "Disallow: /host",
        "Disallow: /studio",
        "Disallow: /watch",
        "Disallow: /api",
        "",
        `Sitemap: ${origin}/sitemap.xml`,
        "",
      ].join("\n"),
    );
  });

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
    // The homepage strip is the live-site event's sponsors (legacy rows count as its).
    const featured = await storage.getFeaturedEvent();
    const rows = await storage.listSponsors(true, [featured.id, 0]);
    const out: PublicSponsor[] = rows.map((r) => ({ id: r.id, name: r.name, url: r.url, logoUrl: r.logoUrl, sortOrder: r.sortOrder, tier: r.tier }));
    res.json(out);
  });

  // ---- Public: "become a sponsor" form ------------------------------------------
  app.post("/api/sponsor-inquiries", async (req, res) => {
    const parsed = insertSponsorInquirySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    if (!(await requireHuman(req, res))) return;
    const created = await storage.createSponsorInquiry(parsed.data);
    // Send before responding: see the note on /api/reminders. Work started
    // after the response is flushed is not guaranteed to run on serverless.
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

    res.status(201).json({ id: created.id });
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

  // ---- Bring your own encoder ---------------------------------------------------
  //      Some podcasters run OBS or StreamYard with three cameras and a
  //      soundboard and won't give that up for a web page. We hand them an
  //      RTMP URL and key instead; their feed arrives in the room as an
  //      ordinary participant and the producer promotes them like anyone else.
  app.get("/api/host/ingress", requireHostSession, async (req, res) => {
    noStore(res);
    if (!isLiveKitConfigured()) {
      res.json({ configured: false });
      return;
    }
    const email = (getSessionEmail(req) ?? "").toLowerCase().trim();
    const row = await storage.getIngressByEmail(email);
    // Their own key, for their own encoder — this one they're meant to see.
    res.json({
      configured: true,
      ingress: row ? { id: row.id, url: row.url, streamKey: row.streamKey, displayName: row.displayName } : null,
    });
  });

  app.post("/api/host/ingress", requireHostSession, async (req, res) => {
    if (!isLiveKitConfigured()) {
      res.status(503).json({ message: "The studio isn't switched on for this event yet." });
      return;
    }
    const email = (getSessionEmail(req) ?? "").toLowerCase().trim();
    const existing = await storage.getIngressByEmail(email);
    if (existing) {
      res.json({ id: existing.id, url: existing.url, streamKey: existing.streamKey, displayName: existing.displayName });
      return;
    }
    const event = await storage.getFeaturedEvent();
    const studio = await storage.getOrCreateStudio(event.id);
    const profile = await storage.getProfileByEmail(email);
    const mySignup = (await storage.listSignups(event.id)).find(
      (sg) => sg.email.toLowerCase().trim() === email && sg.status === "confirmed",
    );
    const displayName = mySignup?.hostName || profile?.hostName || email.split("@")[0];
    const identity = `rtmp-${mySignup?.id ?? email.replace(/[^a-z0-9]/gi, "").slice(0, 20)}`;

    try {
      const cred = await createRtmpIngress({ room: roomName(studio.id), identity, name: displayName });
      const row = await storage.createIngressRow({
        eventId: event.id,
        studioId: studio.id,
        signupId: mySignup?.id ?? null,
        ownerEmail: email,
        ingressId: cred.ingressId,
        participantIdentity: identity,
        displayName,
        url: cred.url,
        streamKey: cred.streamKey,
      });
      res.status(201).json({ id: row.id, url: row.url, streamKey: row.streamKey, displayName: row.displayName });
    } catch (err: any) {
      console.error("Couldn't create an ingress:", err);
      res.status(502).json({ message: err?.message ?? "Couldn't set that up right now." });
    }
  });

  /** Regenerating is delete-then-create: a leaked key should stop working. */
  app.delete("/api/host/ingress", requireHostSession, async (req, res) => {
    const email = (getSessionEmail(req) ?? "").toLowerCase().trim();
    const row = await storage.getIngressByEmail(email);
    if (!row) {
      res.json({ ok: true });
      return;
    }
    await deleteIngress(row.ingressId).catch(() => {});
    await storage.deleteIngressRow(row.id);
    res.json({ ok: true });
  });

  app.get("/api/admin/ingress", requireAdmin, async (req, res) => {
    noStore(res);
    const eventId = Number(req.query.eventId) || (await storage.getFeaturedEvent()).id;
    const rows = await storage.listIngresses(eventId);
    // Whether anything is actually arriving, straight from LiveKit.
    let statuses = new Map<string, string>();
    if (isLiveKitConfigured() && rows.length) {
      try {
        const studio = await storage.getOrCreateStudio(eventId);
        for (const i of await listIngressForRoom(roomName(studio.id))) {
          statuses.set(i.ingressId, i.state?.status !== undefined ? String(i.state.status) : "");
        }
      } catch {
        /* if LiveKit is unreachable we still list what we issued */
      }
    }
    res.json(
      rows.map((r) => ({
        id: r.id,
        signupId: r.signupId,
        ownerEmail: r.ownerEmail,
        displayName: r.displayName,
        url: r.url,
        keyHint: r.streamKey ? `••••${r.streamKey.slice(-4)}` : "",
        status: statuses.get(r.ingressId) ?? "",
      })),
    );
  });

  app.delete("/api/admin/ingress/:id", requireAdmin, async (req, res) => {
    const row = await storage.getIngressRow(Number(req.params.id));
    if (row) {
      await deleteIngress(row.ingressId).catch(() => {});
      await storage.deleteIngressRow(row.id);
    }
    res.json({ ok: true });
  });

  // ---- A podcaster's own YouTube ------------------------------------------------
  //      Connect once, and at their slot we open a broadcast on their channel
  //      rather than asking them to find a stream key.
  function youtubeRedirect(req: Request): string {
    return `${req.protocol}://${req.get("host")}/api/youtube/callback`;
  }

  /** A live access token, refreshed if the cached one has aged out. */
  async function youtubeToken(email: string): Promise<string | null> {
    const acct = await storage.getYoutubeAccount(email);
    if (!acct) return null;
    const stillGood = acct.accessToken && acct.expiresAt && new Date(acct.expiresAt).getTime() > Date.now() + 60_000;
    if (stillGood) return acct.accessToken;
    try {
      const t = await refreshAccessToken(acct.refreshToken);
      await storage.upsertYoutubeAccount(email, {
        refreshToken: acct.refreshToken,
        accessToken: t.access_token,
        expiresAt: new Date(Date.now() + t.expires_in * 1000).toISOString(),
      });
      return t.access_token;
    } catch (err) {
      console.error("YouTube refresh failed for", email, err);
      return null;
    }
  }

  app.get("/api/host/youtube", requireHostSession, async (req, res) => {
    noStore(res);
    const email = (getSessionEmail(req) ?? "").toLowerCase().trim();
    const acct = await storage.getYoutubeAccount(email);
    res.json({
      configured: isYoutubeConfigured(),
      connected: Boolean(acct),
      channelTitle: acct?.channelTitle ?? "",
    });
  });

  app.get("/api/host/youtube/start", requireHostSession, async (req, res) => {
    if (!isYoutubeConfigured()) {
      res.status(503).json({ message: "YouTube connecting isn't switched on yet." });
      return;
    }
    const email = (getSessionEmail(req) ?? "").toLowerCase().trim();
    // The session cookie won't survive Google's redirect chain reliably, so the
    // address rides along in state and is checked against the session on return.
    res.redirect(consentUrl(youtubeRedirect(req), Buffer.from(email).toString("base64url")));
  });

  app.get("/api/youtube/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const email = state ? Buffer.from(state, "base64url").toString("utf8").toLowerCase().trim() : "";
    const sessionEmail = (getSessionEmail(req) ?? "").toLowerCase().trim();

    if (!code || !email || email !== sessionEmail) {
      res.redirect("/host/dashboard?youtube=failed");
      return;
    }
    try {
      const t = await exchangeCode(code, youtubeRedirect(req));
      if (!t.refresh_token) {
        // Google only returns one on first consent; we forced prompt=consent,
        // so this means something is wrong rather than "already connected".
        res.redirect("/host/dashboard?youtube=noRefresh");
        return;
      }
      const channel = await myChannel(t.access_token);
      await storage.upsertYoutubeAccount(email, {
        refreshToken: t.refresh_token,
        accessToken: t.access_token,
        expiresAt: new Date(Date.now() + t.expires_in * 1000).toISOString(),
        channelId: channel.id,
        channelTitle: channel.title,
      });
      res.redirect("/host/dashboard?youtube=connected");
    } catch (err) {
      console.error("YouTube connect failed:", err);
      res.redirect("/host/dashboard?youtube=failed");
    }
  });

  app.delete("/api/host/youtube", requireHostSession, async (req, res) => {
    await storage.deleteYoutubeAccount((getSessionEmail(req) ?? "").toLowerCase().trim());
    res.json({ ok: true });
  });

  /**
   * Open a broadcast on a podcaster's channel and add it to the destinations
   * for their slot. The producer presses this when their segment comes up.
   */
  app.post("/api/admin/youtube/broadcast", requireAdmin, async (req, res) => {
    if (!isYoutubeConfigured()) {
      res.status(503).json({ message: "YouTube connecting isn't switched on yet." });
      return;
    }
    const signupId = Number(req.body?.signupId) || 0;
    const signup = signupId ? await storage.getSignupById(signupId) : undefined;
    if (!signup) {
      res.status(404).json({ message: "No such booking" });
      return;
    }
    const token = await youtubeToken(signup.email.toLowerCase().trim());
    if (!token) {
      res.status(409).json({ message: `${signup.hostName} hasn't connected their YouTube.` });
      return;
    }
    try {
      const event = await storage.getEventById(signup.eventId);
      const b = await createBroadcast(token, {
        title: signup.podcastName || signup.hostName,
        description: `Live from ${event?.name ?? "MilitaryVoice.ai"}.`,
        startAtIso: new Date().toISOString(),
      });
      const created = await storage.createDestination(signup.eventId, signup.email, {
        platform: "youtube",
        label: `${signup.podcastName} · YouTube`,
        rtmpUrl: b.ingestAddress,
        streamKey: b.streamName,
        enabled: true,
        signupId: signup.id,
      });
      res.status(201).json({ ...publicDestination(created), watchUrl: b.watchUrl });
    } catch (err: any) {
      console.error("Couldn't open a YouTube broadcast:", err);
      res.status(502).json({ message: err?.message ?? "YouTube wouldn't open that broadcast." });
    }
  });

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
            : "LIVE — they join from the studio page."
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
  async function studioForSlug(slug?: string, studioId?: number) {
    const event = slug ? await storage.getEventBySlug(slug) : await storage.getFeaturedEvent();
    if (!event) return null;
    // A speaker's link can name the room; without one they land in the event's
    // own studio, which is what every existing link already means.
    if (studioId) {
      const picked = await storage.getStudioById(studioId);
      if (picked && picked.eventId === event.id) return { event, studio: picked };
    }
    return { event, studio: await storage.getOrCreateStudio(event.id) };
  }

  /** The studio an admin request is talking about, defaulting to the event's own. */
  async function adminStudio(req: Request) {
    const eventId = Number(req.query.eventId) || Number(req.body?.eventId) || (await storage.getFeaturedEvent()).id;
    const wanted = Number(req.query.studioId) || Number(req.body?.studioId) || 0;
    if (wanted) {
      const picked = await storage.getStudioById(wanted);
      if (picked) return { eventId: picked.eventId, studio: picked };
    }
    return { eventId, studio: await storage.getOrCreateStudio(eventId) };
  }

  function numParam(v: unknown): number | undefined {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  function withPresence(p: { lastSeenAt: string }) {
    return Date.now() - new Date(p.lastSeenAt).getTime() < PRESENCE_WINDOW_MS;
  }

  /** What a speaker sees: their own state plus whether the room is live. */
  async function speakerState(
    event: EventRow,
    studio: { id: number; name: string; status: string; fallbackPlaying: boolean; maxOnStage: number },
    clientKey: string,
  ) {
    const all = await storage.listStudioParticipants(studio.id);
    const me = all.find((p) => p.clientKey === clientKey) ?? null;

    // Someone waiting wants two things the counts alone can't tell them: who is
    // on air right now, and how long until it's their turn.
    const onStage = all
      .filter((p) => p.state === "On stage" && withPresence(p))
      .map((p) => ({ name: p.displayName }));

    let mySlot: { startsAtUtc: string; endsAtUtc: string; label: string } | null = null;
    const email = (me?.email ?? "").trim().toLowerCase();
    if (email) {
      const mine = (await storage.listSignups(event.id)).find(
        (sgn) => sgn.status !== "cancelled" && sgn.email.trim().toLowerCase() === email,
      );
      if (mine) {
        const blockStart = new Date(new Date(event.startAtUtc).getTime() + mine.slotIndex * event.slotMinutes * 60000);
        const air = onAirWindowServer(blockStart, event.onAirMinutes, event.bufferMinutes, event.bufferPosition);
        mySlot = {
          startsAtUtc: air.start.toISOString(),
          endsAtUtc: air.end.toISOString(),
          label: mine.podcastName,
        };
      }
    }

    return {
      eventName: event.name,
      studio: {
        name: studio.name,
        status: studio.status,
        fallbackPlaying: studio.fallbackPlaying,
        maxOnStage: studio.maxOnStage,
      },
      me,
      onStage,
      mySlot,
      onStageCount: onStage.length,
      greenRoomCount: all.filter((p) => p.state === "Green room" && withPresence(p)).length,
    };
  }

  app.get("/api/studio/state", async (req, res) => {
    noStore(res);
    const found = await studioForSlug(typeof req.query.slug === "string" ? req.query.slug : undefined, numParam(req.query.studioId));
    if (!found) {
      res.status(404).json({ message: "No event" });
      return;
    }
    const clientKey = typeof req.query.clientKey === "string" ? req.query.clientKey : "";
    res.json(await speakerState(found.event, found.studio, clientKey));
  });

  /**
   * A viewer's ticket to the room. No sign-in: this is the public broadcast,
   * and the token can only subscribe — never publish, never see the green
   * room's identities beyond what the stage already shows.
   */
  app.get("/api/watch/token", async (req, res) => {
    noStore(res);
    if (!isLiveKitConfigured()) {
      res.json({ configured: false });
      return;
    }
    const found = await studioForSlug(
      typeof req.query.slug === "string" ? req.query.slug : undefined,
      numParam(req.query.studioId),
    );
    if (!found) {
      res.json({ configured: false });
      return;
    }
    const { event, studio } = found;
    const room = roomName(studio.id);
    res.json({
      configured: true,
      url: publicLiveKitUrl(),
      room,
      eventName: event.name,
      studioName: studio.name,
      status: studio.status,
      token: await studioToken({
        room,
        identity: `viewer-${Math.random().toString(36).slice(2, 12)}`,
        name: "Viewer",
        canPublish: false,
      }),
    });
  });

  app.post("/api/studio/join", async (req, res) => {
    const parsed = studioJoinSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const found = await studioForSlug(typeof req.body?.slug === "string" ? req.body.slug : undefined, numParam(req.body?.studioId));
    if (!found) {
      res.status(404).json({ message: "No event" });
      return;
    }
    // A signed-in podcaster is recognised and gets their show name automatically.
    const hostEmail = getSessionEmail(req);
    const profile = hostEmail ? await storage.getProfileByEmail(hostEmail) : undefined;
    const row = await storage.upsertStudioParticipant(found.studio.id, parsed.data.clientKey, {
      ...(parsed.data.signupId ? { signupId: parsed.data.signupId } : {}),
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
    const found = await studioForSlug(typeof req.body?.slug === "string" ? req.body.slug : undefined, numParam(req.body?.studioId));
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
    const found = await studioForSlug(typeof req.body?.slug === "string" ? req.body.slug : undefined, numParam(req.body?.studioId));
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
        attributes: { state: me.state, participantId: String(me.id), displayTitle: me.displayTitle ?? "" },
      }),
    });
  });

  app.post("/api/studio/leave", async (req, res) => {
    const found = await studioForSlug(typeof req.body?.slug === "string" ? req.body.slug : undefined, numParam(req.body?.studioId));
    const key = typeof req.body?.clientKey === "string" ? req.body.clientKey : "";
    if (found && key) {
      const me = (await storage.listStudioParticipants(found.studio.id)).find((p) => p.clientKey === key);
      if (me) await storage.removeStudioParticipant(me.id);
    }
    res.json({ ok: true });
  });

  // ---- Studio: the control room -------------------------------------------------
  /** Every studio for the event. The first is the event's own; the rest are
   *  side rooms — a rehearsal, a test, a second stage running in parallel. */
  app.get("/api/admin/studios", requireAdmin, async (req, res) => {
    noStore(res);
    if (req.query.all === "1") {
      // Every studio across every event, for the Studios tab.
      const events = await storage.listEvents();
      const rows = await storage.listAllStudios();
      const firstByEvent = new Map<number, number>();
      for (const r of rows) if (!firstByEvent.has(r.eventId)) firstByEvent.set(r.eventId, r.id);
      res.json(
        rows.map((r) => ({
          ...r,
          isPrimary: firstByEvent.get(r.eventId) === r.id,
          eventName: events.find((e) => e.id === r.eventId)?.name ?? "",
        })),
      );
      return;
    }
    const eventId = Number(req.query.eventId) || (await storage.getFeaturedEvent()).id;
    // Make sure the event always has at least its own.
    await storage.getOrCreateStudio(eventId);
    const rows = await storage.listStudios(eventId);
    res.json(rows.map((r, i) => ({ ...r, isPrimary: i === 0 })));
  });

  app.post("/api/admin/studios", requireAdmin, async (req, res) => {
    const eventId = Number(req.body?.eventId) || (await storage.getFeaturedEvent()).id;
    const name = String(req.body?.name ?? "").trim().slice(0, 80);
    res.status(201).json(await storage.createStudio(eventId, name));
  });

  app.delete("/api/admin/studios/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const studio = await storage.getStudioById(id);
    if (!studio) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    const all = await storage.listStudios(studio.eventId);
    if (all[0]?.id === id) {
      res.status(409).json({ message: "That's the event's own studio. It can be renamed, but not removed." });
      return;
    }
    if (studio.broadcastEgressId || studio.recordingEgressId) {
      res.status(409).json({ message: "Stop the broadcast and the recording first." });
      return;
    }
    await storage.deleteStudio(id);
    res.json({ ok: true });
  });

  app.get("/api/admin/studio", requireAdmin, async (req, res) => {
    noStore(res);
    const { studio } = await adminStudio(req);
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
    const { studio } = await adminStudio(req);
    const room = roomName(studio.id);
    const email = getAdminEmail(req) || "console";

    // Watching the room and being in it are different jobs. A producer who
    // wants to appear needs a real participant row, so they show up in the
    // green room and get promoted the same way as everyone else — the stage
    // shouldn't have a special case for the person running it.
    if (req.body?.publish === true) {
      const row = await storage.upsertStudioParticipant(studio.id, `admin:${email}`, {
        displayName: String(req.body?.displayName ?? "").trim() || "Host",
        email,
        role: "Host",
      });
      res.json({
        configured: true,
        url: publicLiveKitUrl(),
        room,
        publishing: true,
        clientKey: `admin:${email}`,
        participantId: row.id,
        token: await studioToken({
          room,
          identity: `p-${row.id}`,
          name: row.displayName || "Host",
          canPublish: true,
          admin: true,
          attributes: { state: row.state, participantId: String(row.id), displayTitle: row.displayTitle ?? "" },
        }),
      });
      return;
    }

    res.json({
      configured: true,
      url: publicLiveKitUrl(),
      room,
      publishing: false,
      token: await studioToken({
        room,
        identity: `producer-${email}`,
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
    const { eventId, studio } = await adminStudio(req);
    const event = await storage.getEventById(eventId);
    const updated = await storage.updateStudio(studio.id, parsed.data);
    if (updated) {
      // The broadcast layout watches the room, not us — this is what makes the
      // standby clip a real cut on air.
      await syncRoomMetadata(roomName(studio.id), studioMeta(event?.name ?? "", updated, event?.startAtUtc ?? ""));
    }
    res.json(updated);
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
      const { studio } = await adminStudio(req);
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
    await syncParticipantState(roomName(row.studioId), `p-${row.id}`, state, { displayTitle: row.displayTitle ?? "" });
    res.json(row);
  });

  // ---- Studio: participant title (lower third) ---------------------------------
  app.patch("/api/admin/studio/participants/:id/title", requireAdmin, async (req, res) => {
    const id = numParam(req.params.id) ?? 0;
    const title = typeof req.body?.displayTitle === "string" ? req.body.displayTitle.trim().slice(0, 120) : "";
    const row = await storage.setParticipantTitle(id, title);
    if (!row) return res.status(404).json({ message: "Not found" });
    await syncParticipantState(roomName(row.studioId), `p-${row.id}`, row.state, { displayTitle: title });
    res.json(row);
  });

  // ---- Studio: going out, and being kept ---------------------------------------
  //      Two egresses run off the same room. The broadcast is one long
  //      composite pushed to every destination at once; the recording is a
  //      short one per podcaster slot. Stopping a slot recording never touches
  //      what's on air.
  /**
   * Upload the standby clip straight into the show-assets bucket. Nobody has a
   * bare .mp4 URL lying around — they have a file, or a YouTube link — so
   * asking for one was never realistic.
   */
  app.post(
    "/api/admin/studio/standby",
    requireAdmin,
    (req, res, next) => {
      assetUpload.single("file")(req, res, (err: any) => {
        if (err) {
          res.status(400).json({
            message:
              err?.code === "LIMIT_FILE_SIZE"
                ? "That clip is over 50MB. A standby reel only needs to be a minute or two — export it smaller."
                : err.message || "Couldn't accept that file.",
          });
          return;
        }
        next();
      });
    },
    async (req, res) => {
      if (!req.file) {
        res.status(400).json({ message: "Attach a video file." });
        return;
      }
      const { studio } = await adminStudio(req);
      const safe = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
      const key = `standby/${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${safe}`;
      let url = "";
      try {
        url = await uploadShowAsset(key, req.file.buffer, req.file.mimetype || "video/mp4");
      } catch (err) {
        console.error("Standby upload failed:", err);
        res.status(502).json({ message: "Upload failed. Try again." });
        return;
      }
      const body = req.body as Record<string, string>;
      const label = String(body?.label ?? "").trim().slice(0, 120);
      // "pre" is the before-the-event card; anything else replaces the standby
      // that plays once the day has started.
      const patch = body?.slot === "pre"
        ? { preVideoUrl: url, preLabel: label || req.file.originalname }
        : { fallbackVideoUrl: url, fallbackLabel: label || req.file.originalname };
      res.status(201).json(await storage.updateStudio(studio.id, patch));
    },
  );

  /**
   * Everything the producer could put on the stage: clips the podcasters
   * uploaded for their own slots, plus anything admin has added. This is the
   * point of asking them to upload ahead of time.
   */
  app.get("/api/admin/media", requireAdmin, async (req, res) => {
    noStore(res);
    const eventId = Number(req.query.eventId) || (await storage.getFeaturedEvent()).id;
    const signups = await storage.listSignups(eventId);
    const byEmail = new Map(signups.map((sg) => [sg.email.toLowerCase().trim(), sg]));
    const assets = await storage.listAllAssets();
    res.json(
      assets
        .filter((a) => a.fileUrl || a.linkUrl)
        .map((a) => {
          const url = a.fileUrl || a.linkUrl;
          const sg = byEmail.get(a.email.toLowerCase().trim());
          return {
            id: a.id,
            label: a.label || a.fileName || a.kind,
            kind: /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url) ? "image" : "video",
            url,
            owner: sg?.podcastName ?? a.email,
            assetKind: a.kind,
          };
        }),
    );
  });

  /**
   * Kill the sound coming off the stage without taking anyone off it. The
   * classic use is a guest whose dog starts barking mid-answer: you want them
   * silent on air in one press, not removed from the show.
   */
  app.post("/api/admin/studio/mute-stage", requireAdmin, async (req, res) => {
    if (!isLiveKitConfigured()) {
      res.status(503).json({ message: "No media layer for this event." });
      return;
    }
    const { studio } = await adminStudio(req);
    const muted = req.body?.muted !== false;
    const onStage = (await storage.listStudioParticipants(studio.id)).filter((p) => p.state === "On stage");
    const room = roomName(studio.id);
    let changed = 0;
    for (const p of onStage) {
      try {
        const info = await rooms().getParticipant(room, `p-${p.id}`);
        for (const t of info.tracks) {
          if (t.type === 0 /* AUDIO */) {
            await rooms().mutePublishedTrack(room, `p-${p.id}`, t.sid, muted);
            changed += 1;
          }
        }
      } catch {
        /* they may have dropped between the list and the call */
      }
    }
    res.json({ ok: true, muted, changed });
  });

  // ---- Scenes ---------------------------------------------------------------
  //      A scene is the stage saved as it stands, so during the show it's one
  //      button rather than three decisions.
  app.get("/api/admin/scenes", requireAdmin, async (req, res) => {
    noStore(res);
    const { studio } = await adminStudio(req);
    res.json(await storage.listScenes(studio.id));
  });

  /** Saves whatever is on the stage right now under a name. */
  app.post("/api/admin/scenes", requireAdmin, async (req, res) => {
    const { studio } = await adminStudio(req);
    const name = String(req.body?.name ?? "").trim().slice(0, 60) || "Scene";
    const existing = await storage.listScenes(studio.id);
    res.status(201).json(
      await storage.createScene({
        studioId: studio.id,
        name,
        sortIndex: existing.length,
        mediaUrl: studio.stageMediaPlaying ? studio.stageMediaUrl : "",
        mediaKind: studio.stageMediaKind,
        mediaLabel: studio.stageMediaLabel,
      }),
    );
  });

  app.delete("/api/admin/scenes/:id", requireAdmin, async (req, res) => {
    await storage.deleteScene(Number(req.params.id));
    res.json({ ok: true });
  });

  /** Auto-generate one scene per run-of-show item. Idempotent: existing scenes
   *  with the same name are skipped, not duplicated. */
  app.post("/api/admin/scenes/generate", requireAdmin, async (req, res) => {
    const { studio } = await adminStudio(req);
    const items = await storage.listRunOfShow(studio.eventId);
    const existing = await storage.listScenes(studio.id);
    const existingNames = new Set(existing.map((s) => s.name));
    let created = 0;
    for (let i = 0; i < items.length; i++) {
      const r = items[i];
      if (existingNames.has(r.title)) continue;
      await storage.createScene({
        studioId: studio.id,
        name: r.title,
        sortIndex: existing.length + created,
        mediaUrl: r.mediaUrl || "",
        mediaKind: r.mediaKind || "video",
        mediaLabel: r.mediaLabel || "",
      });
      created++;
    }
    res.json({ created, total: items.length });
  });

  /** Create a scene from a specific run-of-show item. */
  app.post("/api/admin/scenes/from-agenda", requireAdmin, async (req, res) => {
    const { studio } = await adminStudio(req);
    const runItemId = Number(req.body?.runItemId);
    const item = await storage.getRunItem(runItemId);
    if (!item) return res.status(404).json({ message: "Agenda item not found" });
    const existing = await storage.listScenes(studio.id);
    const scene = await storage.createScene({
      studioId: studio.id,
      name: req.body?.name || item.title,
      sortIndex: existing.length,
      mediaUrl: item.mediaUrl || "",
      mediaKind: item.mediaKind || "video",
      mediaLabel: item.mediaLabel || "",
    });
    res.status(201).json(scene);
  });

  /** One click during the show: put the stage back the way this scene had it. */
  app.post("/api/admin/scenes/:id/apply", requireAdmin, async (req, res) => {
    const scene = await storage.getScene(Number(req.params.id));
    if (!scene) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    const studio = await storage.getStudioById(scene.studioId);
    if (!studio) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    const updated = await storage.updateStudio(studio.id, {
      stageMediaUrl: scene.mediaUrl,
      stageMediaKind: scene.mediaKind,
      stageMediaLabel: scene.mediaLabel,
      // A scene with no media is "back to the cameras".
      stageMediaPlaying: Boolean(scene.mediaUrl),
    });
    if (updated) {
      const ev = await storage.getEventById(studio.eventId);
      await syncRoomMetadata(roomName(studio.id), studioMeta(ev?.name ?? "", updated, ev?.startAtUtc ?? ""));
    }
    res.json(updated);
  });

  /**
   * Take a run-of-show row: put whatever it carries on the stage, or clear the
   * stage if it carries nothing. This is what makes the rundown the scene list
   * — the producer follows it down and each row is one press.
   */
  /**
   * Take an agenda row = a scene: its media on the stage, and the right people
   * on it. A Segment with a booking brings that podcaster on (found by the
   * link they arrived through, or by name) and clears everyone else; the host
   * steps off unless the podcaster asked for an interviewer. Every other kind
   * of row is the host's — intro, handoff, sponsor read.
   */
  async function takeRunRow(studio: StudioRow, row: RunItemRow) {
    const signup = row.signupId ? await storage.getSignupById(row.signupId) : undefined;
    const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const nameMatch = (a: string, b: string) => {
      const x = norm(a), y = norm(b);
      return x.length > 2 && y.length > 2 && (x.includes(y) || y.includes(x));
    };
    const isHost = (p: StudioParticipantRow) => p.role === "Host" || norm(p.displayName) === "host";
    const belongs = (p: StudioParticipantRow) =>
      Boolean(signup) && (p.signupId === signup!.id || nameMatch(p.displayName, signup!.hostName) || nameMatch(p.displayName, signup!.podcastName));
    const guestScene = row.kind === "Segment" && Boolean(signup);

    const moved: { id: number; to: string }[] = [];
    const present = (await storage.listStudioParticipants(studio.id)).filter(withPresence);
    let onStage = 0;
    for (const p of present) {
      let target: "On stage" | "Green room";
      if (isHost(p)) target = guestScene && !signup!.needsInterviewer ? "Green room" : "On stage";
      else target = guestScene && belongs(p) ? "On stage" : "Green room";
      if (target === "On stage") {
        if (onStage >= studio.maxOnStage) target = "Green room";
        else onStage += 1;
      }
      if (p.state !== target) {
        await storage.setParticipantState(p.id, target);
        await syncParticipantState(roomName(studio.id), `p-${p.id}`, target);
        moved.push({ id: p.id, to: target });
      }
    }

    const updated = await storage.updateStudio(studio.id, {
      currentRunItemId: row.id,
      stageMediaUrl: row.mediaUrl,
      stageMediaKind: row.mediaKind || "video",
      stageMediaLabel: row.mediaLabel || row.title,
      stageMediaPlaying: Boolean(row.mediaUrl),
    });
    if (updated) {
      const ev = await storage.getEventById(studio.eventId);
      await syncRoomMetadata(roomName(studio.id), studioMeta(ev?.name ?? "", updated, ev?.startAtUtc ?? ""));
    }
    const missing = guestScene && !present.some((p) => !isHost(p) && belongs(p));
    return { studio: updated, moved, missing: missing ? signup!.podcastName : null };
  }

  app.post("/api/admin/run-of-show/:id/take", requireAdmin, async (req, res) => {
    const items = await storage.listRunOfShow(Number(req.body?.eventId) || (await storage.getFeaturedEvent()).id);
    const row = items.find((r) => r.id === Number(req.params.id));
    if (!row) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    const { studio } = await adminStudio(req);
    res.json(await takeRunRow(studio, row));
  });

  /** The row after the one on now (or the first). What "next scene" presses. */
  app.post("/api/admin/run-of-show/next", requireAdmin, async (req, res) => {
    const items = await storage.listRunOfShow(Number(req.body?.eventId) || (await storage.getFeaturedEvent()).id);
    const { studio } = await adminStudio(req);
    const idx = items.findIndex((r) => r.id === studio.currentRunItemId);
    const row = items[idx + 1];
    if (!row) {
      res.status(409).json({ message: idx === -1 ? "Nothing in the agenda yet." : "That was the last row." });
      return;
    }
    res.json(await takeRunRow(studio, row));
  });

  /** Put something on the stage, or take it off. */
  app.post("/api/admin/studio/media", requireAdmin, async (req, res) => {
    const { studio } = await adminStudio(req);
    const action = String(req.body?.action ?? "");
    const patch =
      action === "stop"
        ? { stageMediaPlaying: false }
        : {
            stageMediaUrl: String(req.body?.url ?? "").trim().slice(0, 600),
            stageMediaKind: req.body?.kind === "image" ? "image" : "video",
            stageMediaLabel: String(req.body?.label ?? "").trim().slice(0, 120),
            stageMediaPlaying: true,
          };
    if (action !== "stop" && !/^https?:\/\//i.test(String(patch.stageMediaUrl ?? ""))) {
      res.status(400).json({ message: "That needs a full https:// link." });
      return;
    }
    const updated = await storage.updateStudio(studio.id, patch);
    if (updated) {
      const ev = await storage.getEventById(studio.eventId);
      await syncRoomMetadata(roomName(studio.id), studioMeta(ev?.name ?? "", updated, ev?.startAtUtc ?? ""));
    }
    res.json(updated);
  });

  app.post("/api/admin/studio/broadcast", requireAdmin, async (req, res) => {
    if (!isLiveKitConfigured()) {
      res.status(503).json({ message: "No media layer configured for this event." });
      return;
    }
    const { eventId, studio } = await adminStudio(req);
    const action = String(req.body?.action ?? "");

    if (action === "stop") {
      if (studio.broadcastEgressId) await stopEgressById(studio.broadcastEgressId);
      for (const d of await storage.listDestinations(eventId)) {
        if (d.live) await storage.updateDestination(d.id, { live: false });
      }
      const off = await storage.updateStudio(studio.id, { broadcastEgressId: "", status: "Offline" });
      const ev0 = await storage.getEventById(eventId);
      if (off) await syncRoomMetadata(roomName(studio.id), studioMeta(ev0?.name ?? "", off, ev0?.startAtUtc ?? ""));
      res.json(off);
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
    // Our own watch page is always a destination — viewers subscribe to the
    // room directly, no egress involved. An egress is only needed to push to
    // somebody else's RTMP, so with no external destinations we simply go Live
    // and the audience watches on our site.
    const rows = (await storage.listDestinations(eventId)).filter((d) => d.enabled && !d.signupId);
    let egressId = "";
    if (rows.length > 0) {
      egressId = await startBroadcast(
        roomName(studio.id),
        rows.map((d) => ({ url: ingestUrl(d), label: d.label || d.platform })),
        templateBaseUrl(req),
      );
      for (const d of rows) await storage.updateDestination(d.id, { live: true });
    }
    const updated = await storage.updateStudio(studio.id, { broadcastEgressId: egressId, status: "Live" });
    const ev = await storage.getEventById(eventId);
    if (updated) await syncRoomMetadata(roomName(studio.id), studioMeta(ev?.name ?? "", updated, ev?.startAtUtc ?? ""));
    res.json(updated);
  });

  /** Add or drop one destination while the broadcast is already running. */
  app.patch("/api/admin/studio/broadcast", requireAdmin, async (req, res) => {
    const { studio } = await adminStudio(req);
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
  /**
   * Where LiveKit's recorder should load the broadcast layout from. Egress runs
   * on LiveKit's machines, so this has to be publicly reachable — on localhost
   * we return nothing and fall back to LiveKit's stock grid.
   */
  function templateBaseUrl(req: Request): string | undefined {
    const host = req.get("host") ?? "";
    if (!host || /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(host)) return undefined;
    return `${req.protocol}://${host}/studio/composite`;
  }

  /** Everything the broadcast layout needs, in one shape. */
  function studioMeta(eventName: string, st: StudioRow, eventStartAtUtc = "") {
    return {
      eventName,
      studioName: st.name,
      status: st.status,
      fallbackPlaying: st.fallbackPlaying,
      fallbackVideoUrl: st.fallbackVideoUrl,
      fallbackLabel: st.fallbackLabel,
      // Both standbys travel together with the start time; the player picks,
      // so the changeover needs no scheduled job and cannot go stale.
      preVideoUrl: st.preVideoUrl,
      preLabel: st.preLabel,
      eventStartAtUtc,
      stageMediaPlaying: st.stageMediaPlaying,
      stageMediaUrl: st.stageMediaUrl,
      stageMediaKind: st.stageMediaKind,
      stageMediaLabel: st.stageMediaLabel,
    };
  }

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
    const { eventId, studio } = await adminStudio(req);
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
    const egressId = await startSegmentRecording(roomName(studio.id), filepath, templateBaseUrl(req));

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

  // ---- Studio: presentations (slide decks) ------------------------------------
  app.get("/api/admin/studio/presentations", requireAdmin, async (req, res) => {
    const studioId = numParam(req.query.studioId);
    if (!studioId) return res.status(400).json({ error: "studioId required" });
    res.json(await storage.listPresentations(studioId));
  });

  app.post(
    "/api/admin/studio/presentations",
    requireAdmin,
    (req, res, next) => {
      assetUpload.array("slides", 50)(req, res, (err: any) => {
        if (err) return res.status(400).json({ error: err.message });
        next();
      });
    },
    async (req: any, res: any) => {
      const studioId = numParam(req.body?.studioId);
      const name = typeof req.body?.name === "string" ? req.body.name.trim() || "Presentation" : "Presentation";
      if (!studioId) return res.status(400).json({ error: "studioId required" });
      const files: Express.Multer.File[] = req.files ?? [];
      const urls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const key = `presentations/${studioId}/${Date.now()}-${i}.${f.originalname.split(".").pop() ?? "jpg"}`;
        const url = await uploadShowAsset(key, f.buffer, f.mimetype || "image/jpeg");
        urls.push(url);
      }
      const pres = await storage.createPresentation(studioId, name, urls);
      res.json({ ...pres, slides: urls.map((url, i) => ({ url, slideIndex: i })) });
    },
  );

  app.delete("/api/admin/studio/presentations/:id", requireAdmin, async (req, res) => {
    await storage.deletePresentation(numParam(req.params.id) ?? 0);
    res.json({ ok: true });
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
        error: ok ? "" : String(info.error ?? "The recorder stopped without saving."),
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
    if (!(await requireHuman(req, res))) return;
    const row = await storage.createPlatformInterest(parsed.data);
    // Send before responding: see the note on /api/reminders. Work started
    // after the response is flushed is not guaranteed to run on serverless.
    try {
      await sendPlatformInterestEmail(parsed.data);
    } catch (err) {
      console.error("Platform interest notification failed:", err);
    }

    res.status(201).json({ ok: true, id: row.id });
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
  app.get("/api/admin/sponsors", requireAdmin, async (req, res) => {
    const featured = await storage.getFeaturedEvent();
    const eventId = Number(req.query.eventId) || featured.id;
    res.json(await storage.listSponsors(false, eventId === featured.id ? [eventId, 0] : [eventId]));
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
      const eventId = Number(body.eventId) || (await storage.getFeaturedEvent()).id;
      const created = await storage.createSponsor({ name, url, logoUrl, eventId });
      // Tier and package arrive as form fields alongside the upload; applying
      // them here keeps createSponsor's signature to what a logo upload needs.
      const tier = SPONSOR_TIERS.includes(body.tier as never) ? (body.tier as SponsorTier) : undefined;
      const packageId = Number(body.packageId) || 0;
      if (tier || packageId) {
        const patched = await storage.updateSponsor(created.id, {
          ...(tier ? { tier } : {}),
          ...(packageId ? { packageId } : {}),
        });
        res.status(201).json(patched ?? created);
        return;
      }
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

  // ---- Sponsorship packages: price and slot count per tier ----------------------
  app.get("/api/admin/sponsor-packages", requireAdmin, async (req, res) => {
    noStore(res);
    const eventId = Number(req.query.eventId) || (await storage.getFeaturedEvent()).id;
    res.json(await storage.listSponsorPackages(eventId));
  });

  app.post("/api/admin/sponsor-packages", requireAdmin, async (req, res) => {
    const parsed = upsertSponsorPackageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const eventId = Number(req.body?.eventId) || (await storage.getFeaturedEvent()).id;
    res.status(201).json(await storage.createSponsorPackage(eventId, parsed.data));
  });

  app.patch("/api/admin/sponsor-packages/:id", requireAdmin, async (req, res) => {
    const parsed = upsertSponsorPackageSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const updated = await storage.updateSponsorPackage(Number(req.params.id), parsed.data);
    if (!updated) {
      res.status(404).json({ message: "Package not found" });
      return;
    }
    res.json(updated);
  });

  app.delete("/api/admin/sponsor-packages/:id", requireAdmin, async (req, res) => {
    await storage.deleteSponsorPackage(Number(req.params.id));
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
  /**
   * The "you're on the schedule" email for one signup. Shared by booking and
   * by the admin resend, so the two can never drift apart. Returns whether
   * Resend accepted it, and never throws.
   */
  async function sendSignupConfirmation(signup: SignupRow, event: EventRow, origin: string): Promise<boolean> {
    try {
      const blockStart = new Date(new Date(event.startAtUtc).getTime() + signup.slotIndex * event.slotMinutes * 60000);
      const tz = signup.timezone || "America/New_York";
      const onAir = onAirWindowServer(blockStart, event.onAirMinutes, event.bufferMinutes, event.bufferPosition);
      const sent = await sendConfirmationEmail({
        to: signup.email,
        hostName: signup.hostName,
        podcastName: signup.podcastName,
        eventName: event.name,
        onAirStartLabel: formatDateTimeInZone(onAir.start, tz),
        onAirEndLabel: formatTimeInZone(onAir.end, tz),
        timezoneLabel: zoneAbbrev(onAir.start, tz),
        agendaUrl: `${origin}/agenda`,
        calendar: calendarLinksFor(signup, event, origin),
      });
      if (sent) await storage.incrementCadenceBroadcast(event.id, "confirmation", 1).catch(() => {});
      return sent;
    } catch (err) {
      console.error("Failed to send signup confirmation email:", err);
      return false;
    }
  }

  /**
   * Tell the organiser a slot went. Never throws and never blocks the booking:
   * a podcaster's confirmation matters more than our own notification.
   */
  async function notifyOrganiserOfBooking(
    signup: SignupRow,
    event: EventRow,
    origin: string,
    taken: number,
    total: number,
  ): Promise<void> {
    const to = (process.env.SIGNUP_NOTIFY_EMAIL || "appletonab@gmail.com").trim();
    if (!to) return;
    // Also notify Riccoh so he knows every time a podcaster signs up.
    const RICCOH_EMAIL = "riccoh.player@drphil.tv";
    try {
      const blockStart = new Date(new Date(event.startAtUtc).getTime() + signup.slotIndex * event.slotMinutes * 60000);
      const onAir = onAirWindowServer(blockStart, event.onAirMinutes, event.bufferMinutes, event.bufferPosition);
      const tz = signup.timezone || "America/New_York";
      await sendBookingAlert({
        to,
        podcastName: signup.podcastName,
        hostName: signup.hostName,
        podcasterEmail: signup.email,
        eventName: event.name,
        onAirLabel: `${formatDateTimeInZone(onAir.start, tz)} ${zoneAbbrev(onAir.start, tz)}`,
        format: signup.showFormat,
        needsInterviewer: signup.needsInterviewer,
        taken,
        total,
        adminUrl: `${origin}/admin`,
      });
      if (to.toLowerCase() !== RICCOH_EMAIL) {
        await sendBookingAlert({
          to: RICCOH_EMAIL,
          podcastName: signup.podcastName,
          hostName: signup.hostName,
          podcasterEmail: signup.email,
          eventName: event.name,
          onAirLabel: `${formatDateTimeInZone(onAir.start, tz)} ${zoneAbbrev(onAir.start, tz)}`,
          format: signup.showFormat,
          needsInterviewer: signup.needsInterviewer,
          taken,
          total,
          adminUrl: `${origin}/admin`,
        });
      }
    } catch (err) {
      console.error("Failed to send the booking alert:", err);
    }
  }

  app.post("/api/signups", requireHostSession, async (req, res) => {
    const email = (req as any).hostEmail as string;
    const profile = await storage.getProfileByEmail(email);
    if (!profile || !profile.hostName || !profile.photoUrl) {
      res.status(400).json({ message: "Set up your podcaster profile before claiming a slot." });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const featured = await storage.getFeaturedEvent();
    const eventId = body.eventId ? Number(body.eventId) : featured.id;

    // The show belongs to the event, so that is where the name, the format
    // and the artwork come from — not the profile.
    const show = await storage.getEventShow(email, eventId);
    if (!show || !show.showName) {
      res.status(400).json({ message: "Set up your show for this event before claiming a slot." });
      return;
    }

    const raw = {
      eventId,
      slotIndex: Number(body.slotIndex),
      podcastName: show.showName,
      hostName: profile.hostName,
      email,
      phone: profile.phone,
      numPeople: profile.numPeople,
      hasVideoIntro: profile.hasVideoIntro,
      hasVideoOutro: profile.hasVideoOutro,
      hasSlides: profile.hasSlides,
      hasImages: profile.hasImages,
      // From the show, not the profile: the interview need belongs to this
      // event, and the flow sets the show up before claiming — reading the
      // profile here wrote a stale false over what they had just chosen.
      needsInterviewer: show.showFormat === "live" && show.interviewNeed === "interview_me",
      socialLinks: profile.socialLinks,
      rssUrl: profile.rssUrl,
      youtubeUrl: profile.youtubeUrl,
      socialAccounts: profile.socialAccounts,
      showFormat: show.showFormat,
      recordingUrl: show.recordingUrl,
      introStyle: show.introStyle,
      branch: profile.branch,
      serviceStatus: profile.serviceStatus,
      recordingMode: profile.recordingMode,
      postEdits: profile.postEdits,
      streamPlatform: profile.streamPlatform,
      streamPlatformOther: profile.streamPlatformOther,
      notes: profile.notes,
      timezone: typeof body.timezone === "string" ? body.timezone : "",
      photoUrl: show.imageUrl || profile.photoUrl,
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
      // Tell them apart. Posting the slot you already hold is a double-submit
      // or a stale tab, not a race — saying "someone else took it" sends
      // someone off hunting for a new time they don't need.
      const mine = existing.email.trim().toLowerCase() === email;
      res.status(409).json({
        message: mine
          ? "You already hold this slot — it's yours. Refresh your dashboard to see it."
          : "That slot was just claimed by someone else. Pick another.",
      });
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
    const origin = `${req.protocol}://${req.get("host")}`;

    // Send before responding: see the note on /api/reminders. Work started
    // after the response is flushed is not guaranteed to run on serverless.
    // Both together, so telling the organiser costs no extra wait.
    const totalSlotCount = Math.floor((event.durationHours * 60) / event.slotMinutes);
    const takenCount = (await storage.listSignups(event.id)).filter((x) => x.status !== "cancelled").length;
    await Promise.allSettled([
      sendSignupConfirmation(created, event, origin),
      notifyOrganiserOfBooking(created, event, origin, takenCount, totalSlotCount),
    ]);

    res.status(201).json(toPublicSignup(created));
  });

  /** Resend a booking confirmation. For "I never got the email", which will
   *  happen regardless of how well delivery works. */
  app.post("/api/admin/signups/:id/resend-confirmation", requireAdmin, async (req, res) => {
    const signup = await storage.getSignupById(Number(req.params.id));
    if (!signup || signup.status === "cancelled") {
      res.status(404).json({ message: "No such booking." });
      return;
    }
    const event = await storage.getEventById(signup.eventId);
    if (!event) {
      res.status(404).json({ message: "That event no longer exists." });
      return;
    }
    const sent = await sendSignupConfirmation(signup, event, `${req.protocol}://${req.get("host")}`);
    res.json({ sent, to: signup.email, podcastName: signup.podcastName });
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
    if (!(await requireHuman(req, res))) return;
    const signup = await storage.getSignupById(parsed.data.signupId);
    if (!signup || signup.status === "cancelled") {
      res.status(404).json({ message: "That slot couldn't be found." });
      return;
    }
    const created = await storage.createReminder(parsed.data);
    // Send before responding. On serverless the function can be frozen the
    // instant the response is flushed, so work started after res.json() is not
    // guaranteed to run — which is exactly why awaited login codes arrived and
    // these never did. Still non-fatal: a mail failure must not fail the action.
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
    try {
      const created = await storage.createEvent(parsed.data);
      res.status(201).json(toPublicEvent(created));
    } catch (err: any) {
      console.error("Couldn't create event:", err);
      const dup = /duplicate key|unique/i.test(String(err?.message ?? ""));
      res.status(dup ? 409 : 500).json({
        message: dup
          ? "That slug is already taken, or the save collided with another. Change the slug or try once more."
          : "The event didn't save. Try once more; if it fails again, tell us.",
      });
    }
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
  // ---- Help chat -----------------------------------------------------------------
  //      One route answers from the knowledge in server/help.ts; the other
  //      hands the visitor to a person by email. Both are public, so: a per-IP
  //      cap on the model route, Turnstile on the email route.
  const helpHits = new Map<string, number[]>();
  function helpRateLimited(req: Request): boolean {
    const ip = (String(req.headers["x-forwarded-for"] || "").split(",")[0] || req.ip || "?").trim();
    const now = Date.now();
    const recent = (helpHits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
    recent.push(now);
    helpHits.set(ip, recent);
    return recent.length > 25;
  }

  app.get("/api/help/config", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ agent: isHelpAgentConfigured() });
  });

  app.post("/api/help/chat", async (req, res) => {
    if (!isHelpAgentConfigured()) {
      res.json({ text: "Our helper is offline at the moment — leave your question and we'll email you back.", handoff: true });
      return;
    }
    if (helpRateLimited(req)) {
      res.status(429).json({ message: "That's a lot of questions at once — give it a few minutes, or ask for a person." });
      return;
    }
    const raw = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const turns: HelpTurn[] = raw
      .slice(-12)
      .map((m: any) => ({ role: m?.role === "assistant" ? "assistant" : "user", content: String(m?.content ?? "").slice(0, 1500).trim() }))
      .filter((m: HelpTurn) => m.content.length > 0);
    if (turns.length === 0 || turns[turns.length - 1].role !== "user") {
      res.status(400).json({ message: "Ask something first." });
      return;
    }
    try {
      const event = await storage.getFeaturedEvent();
      const taken = (await storage.listSignups(event.id)).filter((x) => x.status !== "cancelled").length;
      const total = Math.floor((event.durationHours * 60) / event.slotMinutes);
      const out = await answerHelp(turns, { event, taken, total });
      res.json(out);
    } catch (err) {
      console.error("help chat failed:", (err as Error).message);
      res.json({ text: "I couldn't reach my notes just now. Want me to get a person for you?", handoff: true });
    }
  });

  app.post("/api/help/handoff", async (req, res) => {
    const name = String(req.body?.name ?? "").trim().slice(0, 120);
    const email = String(req.body?.email ?? "").trim().toLowerCase().slice(0, 200);
    const question = String(req.body?.question ?? "").trim().slice(0, 2000);
    const transcript = String(req.body?.transcript ?? "").trim().slice(0, 8000);
    const page = String(req.body?.page ?? "").trim().slice(0, 300);
    if (!email.includes("@") || !question) {
      res.status(400).json({ message: "We need your email and the question." });
      return;
    }
    if (!(await requireHuman(req, res))) return;
    const row = await storage.createHelpRequest({ name, email, question, transcript, page });
    const to = (process.env.SIGNUP_NOTIFY_EMAIL || "appletonab@gmail.com").trim();
    const sent = await sendHelpRequestAlert({ to, name, email, question, transcript, page });
    res.json({ ok: true, id: row.id, sent });
  });

  app.get("/api/admin/help-requests", requireAdmin, async (_req, res) => {
    res.json(await storage.listHelpRequests());
  });

  // Whether the public forms should show the Cloudflare check, and with which
  // key. Served rather than baked into the bundle so the two keys live in one
  // place and a stale client can never disagree with the server.
  app.get("/api/turnstile", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ siteKey: turnstileSiteKey() });
  });

  app.post("/api/host/request-code", async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      res.status(400).json({ message: "Enter a valid email" });
      return;
    }
    if (!(await requireHuman(req, res))) return;
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

  // ---- Host: per-event shows ---------------------------------------------------
  //      A show belongs to an event, not to the person. These read and write
  //      that record; the profile stays about them.

  /** Every event, with what this podcaster has done on each. */
  app.get("/api/host/events", requireHostSession, async (req, res) => {
    const email = (req as any).hostEmail as string;
    const events = await storage.listEvents();
    const shows = await storage.listEventShows(email);
    const out = [];
    for (const event of events) {
      const show = shows.find((s) => s.eventId === event.id) ?? null;
      const signups = (await storage.listSignups(event.id)).filter(
        (s) => s.status !== "cancelled" && s.email.trim().toLowerCase() === email,
      );
      out.push({
        event: toPublicEvent(event),
        show,
        slotIndex: signups[0]?.slotIndex ?? null,
        signupId: signups[0]?.id ?? null,
      });
    }
    res.json(out);
  });

  app.get("/api/host/shows/:eventId", requireHostSession, async (req, res) => {
    const email = (req as any).hostEmail as string;
    const eventId = Number(req.params.eventId);
    const event = await storage.getEventById(eventId);
    if (!event) {
      res.status(404).json({ message: "That event no longer exists." });
      return;
    }
    const show = await storage.getEventShow(email, eventId);
    if (show) {
      res.json(show);
      return;
    }
    // Nothing set up yet — hand back the profile's values as the starting
    // point rather than an empty form.
    const profile = await storage.getProfileByEmail(email);
    res.json({
      eventId,
      showName: profile?.podcastName ?? "",
      showFormat: profile?.showFormat || "live",
      recordingUrl: profile?.recordingUrl ?? "",
      introStyle: profile?.introStyle || "virtual",
      imageUrl: "",
      interviewNeed: "none",
      isNew: true,
    });
  });

  app.put(
    "/api/host/shows/:eventId",
    requireHostSession,
    (req, res, next) => {
      upload.single("image")(req, res, (err) => {
        if (err) {
          res.status(400).json({ message: err.message || "Couldn't process that image." });
          return;
        }
        next();
      });
    },
    async (req, res) => {
      const email = (req as any).hostEmail as string;
      const eventId = Number(req.params.eventId);
      const event = await storage.getEventById(eventId);
      if (!event) {
        res.status(404).json({ message: "That event no longer exists." });
        return;
      }
      const body = req.body as Record<string, string>;
      const parsed = insertEventShowSchema.safeParse({
        showName: body.showName ?? "",
        showFormat: body.showFormat || "live",
        recordingUrl: body.recordingUrl ?? "",
        introStyle: body.introStyle || "virtual",
        interviewNeed: body.interviewNeed || "none",
      });
      if (!parsed.success) {
        res.status(400).json({ message: fromError(parsed.error).toString() });
        return;
      }

      let imageUrl: string | undefined;
      if (req.file) {
        try {
          imageUrl = await enhanceAndSavePhoto(req.file.buffer);
        } catch {
          res.status(400).json({ message: "That image couldn't be processed — try a different file." });
          return;
        }
      } else if (body.clearImage === "true") {
        imageUrl = "";
      }

      const saved = await storage.upsertEventShow(email, eventId, {
        ...parsed.data,
        ...(imageUrl === undefined ? {} : { imageUrl }),
      });
      // A slot already claimed for this event follows the show it belongs to.
      await storage.syncSignupsFromEventShow(email, eventId, saved);
      res.json(saved);
    },
  );

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

  // ---- Admin: CRM contacts ---------------------------------------------------

  /** HMAC token for unsubscribe links — avoids a DB round-trip on click. */
  function unsubscribeToken(email: string): string {
    const secret = process.env.SESSION_SECRET || "mv-unsub-secret";
    return crypto.createHmac("sha256", secret).update(email.toLowerCase()).digest("hex").slice(0, 32);
  }

  function unsubscribeUrl(req: Request, email: string): string {
    const origin = process.env.PUBLIC_ORIGIN || `${req.protocol}://${req.get("host")}`;
    return `${origin}/api/unsubscribe?email=${encodeURIComponent(email)}&token=${unsubscribeToken(email)}`;
  }

  app.get("/api/admin/contacts", requireAdmin, async (_req, res) => {
    const rows = await storage.listContacts();
    res.json(rows);
  });

  app.get("/api/admin/events/:id/signup-contacts", requireAdmin, async (req, res) => {
    const eventId = Number(req.params.id);
    const rows = await storage.listSignupContactsForEvent(eventId);
    res.json(rows);
  });

  app.get("/api/admin/events/:id/signup-by-email", requireAdmin, async (req, res) => {
    const eventId = Number(req.params.id);
    const email = String(req.query.email ?? "");
    if (!email) return res.status(400).json({ error: "email required" });
    const rows = await storage.listSignups(eventId);
    const signup = rows.find((s) => s.email.toLowerCase() === email.toLowerCase());
    if (!signup) return res.status(404).json({ error: "not found" });
    res.json(signup);
  });

  app.post("/api/admin/contacts/import", requireAdmin, async (req, res) => {
    const { csv } = req.body as { csv?: string };
    if (!csv || typeof csv !== "string") return res.status(400).json({ error: "Send { csv: \"...\" }" });

    // RFC 4180-aware CSV parser: handles quoted fields (including commas and newlines inside quotes).
    function parseCsv(text: string): string[][] {
      const rows: string[][] = [];
      let row: string[] = [];
      let field = "";
      let inQuotes = false;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
          if (ch === '"') {
            if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote
            else inQuotes = false;
          } else {
            field += ch;
          }
        } else if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          row.push(field.trim()); field = "";
        } else if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
          if (ch === "\r") i++;
          row.push(field.trim()); field = "";
          if (row.some((c) => c)) rows.push(row);
          row = [];
        } else {
          field += ch;
        }
      }
      row.push(field.trim());
      if (row.some((c) => c)) rows.push(row);
      return rows;
    }

    const rows = parseCsv(csv);
    if (rows.length < 2) return res.status(400).json({ error: "CSV must have a header row and at least one data row." });

    const header = rows[0].map((h) => h.toLowerCase());
    // Accept "email", "email address", or any header that starts with "email address"
    const emailIdx = header.findIndex((h) => h === "email" || h.startsWith("email address") || h.startsWith("email addr"));
    if (emailIdx === -1) return res.status(400).json({ error: "CSV must have an 'email' or 'email address' column." });
    const firstIdx = header.findIndex((h) => h === "first_name" || h === "firstname" || h === "first" || h === "first name");
    const lastIdx = header.findIndex((h) => h === "last_name" || h === "lastname" || h === "last" || h === "last name");

    const parsed: { email: string; firstName: string; lastName: string; source: string }[] = [];
    for (const cols of rows.slice(1)) {
      const email = (cols[emailIdx] || "").toLowerCase().trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
      parsed.push({
        email,
        firstName: firstIdx >= 0 ? (cols[firstIdx] || "").trim() : "",
        lastName: lastIdx >= 0 ? (cols[lastIdx] || "").trim() : "",
        source: "csv",
      });
    }
    if (parsed.length === 0) return res.status(400).json({ error: "No valid email addresses found in the CSV." });
    const result = await storage.upsertContacts(parsed);
    // Log this import batch
    const adminEmail = (req as any).session?.adminEmail ?? "";
    await storage.recordImport(adminEmail, result.inserted, result.updated, parsed.length).catch(() => {});
    res.json({ ...result, total: parsed.length });
  });

  app.get("/api/admin/contacts/imports", requireAdmin, async (req, res) => {
    res.json(await storage.listImports());
  });

  app.get("/api/admin/broadcasts/:id/recipients", requireAdmin, async (req, res) => {
    const broadcastId = Number(req.params.id);
    const engagementType = (req.query.engagement as string) ?? "delivered";
    const valid = ["delivered", "opened", "clicked", "bounced", "unopened"];
    if (!valid.includes(engagementType)) return res.status(400).json({ error: "Invalid engagement type" });
    const rows = await storage.getEngagementRecipients(broadcastId, engagementType as any);
    res.json(rows);
  });

  app.delete("/api/admin/contacts/:id", requireAdmin, async (req, res) => {
    await storage.deleteContact(Number(req.params.id));
    res.json({ ok: true });
  });

  // Public unsubscribe endpoint — no auth needed, token proves intent.
  app.get("/api/unsubscribe", async (req, res) => {
    const { email, token } = req.query as { email?: string; token?: string };
    if (!email || !token || token !== unsubscribeToken(email)) {
      return res.status(400).send("Invalid unsubscribe link.");
    }
    await storage.unsubscribeContact(email);
    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px 20px"><h2>You're unsubscribed.</h2><p>You won't receive any more emails from MilitaryVoice.ai.</p></body></html>`);
  });

  // ---- Admin: CRM broadcasts -------------------------------------------------

  // eventId query param scopes to an event; omit for global list
  app.get("/api/admin/broadcasts", requireAdmin, async (req, res) => {
    const eventId = req.query.eventId ? Number(req.query.eventId) : null;
    res.json(await storage.listBroadcasts(eventId));
  });

  app.post("/api/admin/broadcasts", requireAdmin, async (req, res) => {
    const { subject, bodyText, eventId, segment, sender, banner, scheduledFor } = req.body as { subject?: string; bodyText?: string; eventId?: number | null; segment?: string; sender?: string; banner?: string; scheduledFor?: string | null };
    if (!subject?.trim() || !bodyText?.trim()) return res.status(400).json({ error: "subject and bodyText are required." });
    const row = await storage.createBroadcast({ subject: subject.trim(), bodyText: bodyText.trim(), eventId: eventId ?? null, segment: segment ?? "contacts", sender: sender ?? "team", banner: banner ?? "welcome", scheduledFor: scheduledFor ?? null });
    res.json(row);
  });

  app.put("/api/admin/broadcasts/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const { subject, bodyText, segment, sender, banner, scheduledFor } = req.body as { subject?: string; bodyText?: string; segment?: string; sender?: string; banner?: string; scheduledFor?: string | null };
    const row = await storage.updateBroadcast(id, { subject: subject?.trim(), bodyText: bodyText?.trim(), segment, sender, banner, scheduledFor: scheduledFor ?? null });
    if (!row) return res.status(404).json({ error: "Broadcast not found or already sent." });
    res.json(row);
  });

  app.delete("/api/admin/broadcasts/:id", requireAdmin, async (req, res) => {
    await storage.deleteBroadcast(Number(req.params.id));
    res.json({ ok: true });
  });

  // Resolve a "member:N" sender to the team member row, or null for "team"/"rico"
  async function resolveTeamSender(sender: string) {
    if (!sender.startsWith("member:")) return null;
    const id = Number(sender.split(":")[1]);
    return isNaN(id) ? null : storage.getTeamMember(id);
  }

  app.post("/api/admin/broadcasts/:id/test", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const eventId = req.query.eventId ? Number(req.query.eventId) : null;
    const broadcastList = await storage.listBroadcasts(eventId);
    const broadcast = broadcastList.find((b) => b.id === id);
    if (!broadcast) return res.status(404).json({ error: "Broadcast not found." });

    const adminEmail = (process.env.SIGNUP_NOTIFY_EMAIL || "appletonab@gmail.com").trim();
    const origin = `${req.protocol}://${req.get("host")}`;
    const senderMember = await resolveTeamSender(broadcast.sender ?? "team");
    const ok = await sendBroadcastEmail({
      to: adminEmail,
      firstName: "Friend",
      subject: `[TEST] ${broadcast.subject}`,
      bodyText: broadcast.bodyText,
      unsubscribeUrl: `${origin}/unsubscribe?token=test`,
      sender: broadcast.sender ?? "team",
      banner: broadcast.banner ?? "welcome",
      senderMember: senderMember ?? undefined,
    });
    res.json({ ok, to: adminEmail });
  });

  app.post("/api/admin/broadcasts/:id/send", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const eventId = req.query.eventId ? Number(req.query.eventId) : null;
    const broadcastList = await storage.listBroadcasts(eventId);
    const broadcast = broadcastList.find((b) => b.id === id);

    if (!broadcast) return res.status(404).json({ error: "Broadcast not found." });
    if (broadcast.status === "sent") return res.status(409).json({ error: "Already sent." });

    // Gather recipients based on segment
    const deduped = new Map<string, { email: string; firstName: string }>();
    if (broadcast.segment === "signups" || broadcast.segment === "all") {
      if (!broadcast.eventId) return res.status(400).json({ error: "segment='signups' requires an event-scoped broadcast." });
      for (const r of await storage.listSignupContactsForEvent(broadcast.eventId)) {
        deduped.set(r.email.toLowerCase(), r);
      }
    }
    if (broadcast.segment === "contacts" || broadcast.segment === "all") {
      for (const r of await storage.listActiveContactEmails()) {
        deduped.set(r.email.toLowerCase(), r);
      }
    }
    if (broadcast.segment.startsWith("segment:")) {
      const segId = Number(broadcast.segment.split(":")[1]);
      const segList = await storage.listSegments(eventId);
      const seg = segList.find((s) => s.id === segId);
      if (seg) {
        const filter = JSON.parse(seg.filterJson) as Parameters<typeof storage.resolveSegment>[0];
        for (const r of await storage.resolveSegment(filter)) {
          deduped.set(r.email.toLowerCase(), r);
        }
      }
    }
    // engagement:<broadcastId>:<type> — e.g. "engagement:1:opened"
    if (broadcast.segment.startsWith("engagement:")) {
      const [, bId, engType] = broadcast.segment.split(":");
      const rows = await storage.getEngagementRecipients(Number(bId), engType as any);
      for (const r of rows) deduped.set(r.email.toLowerCase(), r);
    }

    const recipients = Array.from(deduped.values());
    if (recipients.length === 0) return res.status(400).json({ error: "No recipients in the selected segment." });

    const senderMember = await resolveTeamSender(broadcast.sender ?? "team");

    let sent = 0;
    let failed = 0;
    for (const r of recipients) {
      const resendId = await sendBroadcastEmail({
        to: r.email,
        firstName: r.firstName,
        subject: broadcast.subject,
        bodyText: broadcast.bodyText,
        unsubscribeUrl: unsubscribeUrl(req, r.email),
        sender: broadcast.sender ?? "team",
        banner: broadcast.banner ?? "welcome",
        senderMember: senderMember ?? undefined,
      });
      if (resendId) {
        sent++;
        await storage.recordBroadcastSend(id, r.email, resendId);
      } else {
        failed++;
      }
    }
    await storage.markBroadcastSent(id, sent);
    res.json({ sent, failed, total: recipients.length });
  });

  // Broadcast stats (delivered/opened/clicked)
  app.get("/api/admin/broadcasts/:id/stats", requireAdmin, async (req, res) => {
    const stats = await storage.getBroadcastStats(Number(req.params.id));
    res.json(stats);
  });

  // Engaged contacts (opened or clicked) for a broadcast
  app.get("/api/admin/broadcasts/:id/engaged", requireAdmin, async (req, res) => {
    const types = (req.query.types as string ?? "opened,clicked").split(",").map((t) => t.trim()).filter(Boolean);
    const rows = await storage.getBroadcastSendsByEngagement(Number(req.params.id), types);
    res.json(rows);
  });

  // Resend webhook — receives email events in real time
  app.post("/api/webhooks/resend", async (req, res) => {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers["svix-signature"] as string | undefined;
      if (!sig || !sig.includes(secret)) return res.status(401).end();
    }
    const event = req.body as { type?: string; data?: { email_id?: string; url?: string; created_at?: string } };
    const emailId = event?.data?.email_id;
    if (!event?.type || !emailId) return res.status(400).end();
    const eventType = event.type.replace("email.", ""); // "email.opened" → "opened"
    const occurredAt = event.data?.created_at ?? new Date().toISOString();
    await storage.recordBroadcastEvent(emailId, eventType, occurredAt, event.data?.url ?? "");
    if (eventType === "opened" || eventType === "clicked") {
      const email = await storage.getEmailByResendId(emailId);
      if (email) await storage.advanceLifecycle(email, "engaged");
    }
    res.json({ ok: true });
  });

  // Retroactive sync: pull recent emails from Resend API and match to broadcast sends
  app.post("/api/admin/broadcasts/:id/sync-resend", requireAdmin, async (req, res) => {
    const broadcastId = Number(req.params.id);
    const page = await resendApiGet("/emails?limit=100") as { data?: Array<{ id: string; to: string[]; created_at: string; last_event?: string }> } | null;
    if (!page?.data) return res.status(502).json({ error: "Could not reach Resend API" });
    const sends = page.data;
    let matched = 0;
    for (const s of sends) {
      const email = s.to?.[0];
      if (!email) continue;
      // Try recording the send row — if already present it's a no-op via unique constraint
      try {
        await storage.recordBroadcastSend(broadcastId, email, s.id);
        matched++;
      } catch {
        // duplicate — already stored
      }
      // Record the last event if Resend returned one
      if (s.last_event) {
        try { await storage.recordBroadcastEvent(s.id, s.last_event, s.created_at); } catch { /* dup */ }
      }
    }
    res.json({ matched });
  });

  // ---- CRM: Segments ----------------------------------------------------------

  app.get("/api/admin/segments", requireAdmin, async (req, res) => {
    const eventId = req.query.eventId ? Number(req.query.eventId) : null;
    res.json(await storage.listSegments(eventId));
  });

  app.post("/api/admin/segments", requireAdmin, async (req, res) => {
    const { eventId, name, filterJson } = req.body as { eventId?: number; name: string; filterJson: object };
    if (!name?.trim()) return res.status(400).json({ error: "name required" });
    res.json(await storage.createSegment(eventId ?? null, name.trim(), filterJson ?? {}));
  });

  app.delete("/api/admin/segments/:id", requireAdmin, async (req, res) => {
    await storage.deleteSegment(Number(req.params.id));
    res.json({ ok: true });
  });

  // Resolve a segment filter to a list of {email, firstName}
  app.post("/api/admin/segments/resolve", requireAdmin, async (req, res) => {
    const filter = req.body as { broadcastId?: number; eventTypes?: string[]; excludeSignupEventId?: number };
    res.json(await storage.resolveSegment(filter));
  });

  // ---- CRM: Contact lifecycle & history ---------------------------------------

  app.get("/api/admin/contacts/:email/history", requireAdmin, async (req, res) => {
    res.json(await storage.getContactHistory(decodeURIComponent(String(req.params.email))));
  });

  app.patch("/api/admin/contacts/:email/lifecycle", requireAdmin, async (req, res) => {
    const { stage } = req.body as { stage: string };
    await storage.advanceLifecycle(decodeURIComponent(String(req.params.email)), stage);
    res.json({ ok: true });
  });

  // ---- AI: Draft broadcast email ----------------------------------------------

  app.post("/api/admin/ai/draft-email", requireAdmin, async (req, res) => {
    const { prompt, context } = req.body as { prompt: string; context?: string };
    if (!prompt?.trim()) return res.status(400).json({ error: "prompt required" });
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const systemPrompt = `You are an email copywriter for MilitaryVoice.ai — a platform celebrating military and veteran podcasters. Write broadcast emails that are warm, direct, and community-focused. Always return a JSON object with two fields: "subject" (the email subject line, no quotes around it) and "body" (the email body as plain text with blank lines between paragraphs). The body should start with "Hi {{First_Name}}," on the first line. Keep it concise: 3-5 short paragraphs max. Do not include an unsubscribe line or signature — those are added automatically.${context ? `\n\nContext about this broadcast: ${context}` : ""}`;
    const msg = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: `Write a broadcast email for this: ${prompt}` }],
      system: systemPrompt,
    });
    const text = msg.content.find((c) => c.type === "text")?.text ?? "";
    // Extract JSON from the response
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: "Model did not return valid JSON", raw: text });
    try {
      const parsed = JSON.parse(match[0]) as { subject: string; body: string };
      res.json(parsed);
    } catch {
      res.status(500).json({ error: "Could not parse model response", raw: text });
    }
  });

  // ---- Event team management --------------------------------------------------

  app.get("/api/admin/events/:id/team", requireAdmin, async (req, res) => {
    res.json(await storage.listEventTeam(Number(req.params.id)));
  });

  app.post("/api/admin/events/:id/team", requireAdmin, async (req, res) => {
    const { name, title, email, photoUrl } = req.body as { name: string; title: string; email?: string; photoUrl?: string };
    if (!name?.trim() || !title?.trim()) return res.status(400).json({ error: "name and title required" });
    const member = await storage.addTeamMember(Number(req.params.id), { name: name.trim(), title: title.trim(), email: email?.trim() ?? "", photoUrl: photoUrl?.trim() ?? "" });
    res.json(member);
  });

  // Dedicated photo-upload endpoint for team members (POST so adminUpload() works)
  app.post("/api/admin/events/:id/team/:memberId/photo", requireAdmin, (req, res, next) => {
    upload.single("photo")(req, res, (err) => {
      if (err) { res.status(400).json({ message: err.message }); return; }
      next();
    });
  }, async (req, res) => {
    const id = Number(req.params.memberId);
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const filename = `team/${Date.now()}-${id}.jpg`;
    const photoUrl = await uploadPhoto(filename, req.file.buffer);
    const member = await storage.updateTeamMember(id, { photoUrl });
    if (!member) return res.status(404).json({ error: "Team member not found" });
    res.json(member);
  });

  app.put("/api/admin/events/:id/team/:memberId", requireAdmin, (req, res, next) => {
    upload.single("photo")(req, res, (err) => {
      if (err) { res.status(400).json({ message: err.message }); return; }
      next();
    });
  }, async (req, res) => {
    const id = Number(req.params.memberId);
    const { name, title, email } = req.body as { name?: string; title?: string; email?: string };
    let photoUrl: string | undefined;
    if (req.file) {
      const filename = `team/${Date.now()}-${id}.jpg`;
      photoUrl = await uploadPhoto(filename, req.file.buffer);
    }
    const member = await storage.updateTeamMember(id, {
      name: name?.trim(),
      title: title?.trim(),
      email: email?.trim(),
      photoUrl,
    });
    if (!member) return res.status(404).json({ error: "Team member not found" });
    res.json(member);
  });

  app.delete("/api/admin/events/:id/team/:memberId", requireAdmin, async (req, res) => {
    await storage.deleteTeamMember(Number(req.params.memberId));
    res.json({ ok: true });
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
