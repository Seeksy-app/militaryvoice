import express from "express";
import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import crypto from "node:crypto";
import multer from "multer";
import sharp from "sharp";
import { storage } from "./storage.js";
import { requireHuman, turnstileSiteKey } from "./turnstile.js";
import { answerHelp, isHelpAgentConfigured, type HelpTurn } from "./help.js";
import { KINDS, effectiveSchedule, cardInput, caption as campaignCaption, isKind, type CampaignContext } from "./campaign.js";
import { uploadPhoto, uploadShowAsset, signedAssetUpload, deleteShowAsset } from "./photoStorage.js";
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
  clipResultSchema,
  transcriptBatchSchema,
  lowerThirdInputSchema,
  sceneInputSchema,
  scenePatchSchema,
  NUDGE_KINDS,
  type NudgeKind,
  COHOST_BLOCK_MINUTES,
} from "../shared/schema.js";
import { isLiveOnlySlot, LIVE_ONLY_LABEL } from "../shared/slots.js";
import { showClock } from "../shared/showClock.js";
import { isConfigured as isInfluencersConfigured, credits, enrichHandle } from "./influencers.js";
import { deriveSocialAccounts } from "../shared/socialLinks.js";
import { buildAudienceSnapshot, readAudienceSnapshot, saveAudienceSnapshot, AUDIENCE_WINDOW_DAYS } from "./audience.js";
import { fromError } from "zod-validation-error";
import { z } from "zod";
import {
  isLiveKitConfigured,
  isRecordingConfigured,
  publicLiveKitUrl,
  roomName,
  startBroadcast,
  startSegmentRecording,
  stopEgressById,
  runningEgressIds,
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
import { ensureRecordingsBucket, signedRecordingUrl, signedRecordingUpload, deleteRecordingObject, putRecordingObject } from "./recordingStorage.js";
import {
  isYoutubeConfigured,
  consentUrl,
  exchangeCode,
  refreshAccessToken,
  myChannel,
  createBroadcast,
} from "./youtube.js";
import { buildShareCard, buildLineupCard, CARD_SIZES, type CardSize } from "./shareCard.js";
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
import { renderBroadcastEmail, renderConfirmationEmail, renderNudge } from "./email.js";
import { alexAnswer, type AlexTurn } from "./alex.js";
import { emailShell, EMAIL_BANNERS } from "./email.js";
import { draftReply, matchBroadcast, isKnownSender, looksAutomatic, composeAck, firstNameFor, stripQuoted, alexSignatureHtml } from "./inbox.js";
import { adminChat, type ChatTurn } from "./adminChat.js";
import { waitUntil } from "@vercel/functions";
import { sendConfirmationEmail, sendLoginCodeEmail, sendReminderConfirmationEmail, sendSponsorInquiryEmail, sendSponsorThanksEmail, sendPlatformInterestEmail, sendOneOffEmail, buildCalendarLinks } from "./email.js";
import type { DestinationRow, SceneRow, StudioRow, StudioParticipantRow, RunItemRow, BroadcastRow } from "../shared/schema.js";
import { stageMetaFromStudio } from "../shared/stageMeta.js";
import { setSessionCookie, clearSessionCookie, requireHostSession, getSessionEmail, getSession, setAdminCookie, clearAdminCookie, getAdminEmail } from "./session.js";
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
/**
 * Two copies: the square one the site uses, and the one print will need.
 *
 * This used to keep only a 720x720 centre crop and throw the upload away —
 * which is 2.4 inches at 300dpi, so a printed page could never show anybody
 * larger than a postage stamp, and the original was already gone by the time
 * anyone noticed. The web copy is unchanged; the original is kept beside it,
 * uncropped, bounded at 2400px so a phone photo does not cost 12MB of storage.
 *
 * Uncropped matters as much as the resolution. "attention" crops to a face,
 * which is right for a circular avatar and wrong for a magazine page where the
 * designer wants the shoulders and the room.
 */
// ---- Headshot links ---------------------------------------------------------
// Signed with SESSION_SECRET rather than stored, so there is no table to keep
// and no row to leak. Rotating the secret invalidates every outstanding link
// at once, which is the only revocation this needs.

function headshotSecret(): string {
  return process.env.SESSION_SECRET ?? "";
}

/** The token that stands in for one podcaster's email. */
export function headshotToken(email: string): string {
  const body = Buffer.from(email.trim().toLowerCase()).toString("base64url");
  const sig = crypto.createHmac("sha256", headshotSecret()).update(body).digest("base64url").slice(0, 24);
  return `${body}.${sig}`;
}

function emailFromToken(token: string): string | null {
  if (!headshotSecret()) return null;
  const [body, sig] = String(token ?? "").split(".");
  if (!body || !sig) return null;
  const want = crypto.createHmac("sha256", headshotSecret()).update(body).digest("base64url").slice(0, 24);
  // Fixed-length compare: both are 24 base64url characters by construction.
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    return Buffer.from(body, "base64url").toString("utf8").toLowerCase();
  } catch {
    return null;
  }
}

async function enhanceAndSavePhoto(buffer: Buffer): Promise<{ url: string; originalUrl: string }> {
  const stem = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const upright = await sharp(buffer).rotate().toBuffer();

  const web = await sharp(upright)
    .resize(720, 720, { fit: "cover", position: "attention" })
    .normalize() // auto-level contrast
    .sharpen()
    .jpeg({ quality: 88 })
    .toBuffer();

  const url = await uploadPhoto(`${stem}.jpg`, web);

  let originalUrl = "";
  try {
    const full = await sharp(upright)
      .resize(2400, 2400, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 92 })
      .toBuffer();
    originalUrl = await uploadPhoto(`${stem}-print.jpg`, full);
  } catch (err) {
    // The web copy is what the site needs; losing the print copy should not
    // fail somebody's signup. It is recoverable by re-uploading.
    console.warn("Could not keep a print-resolution copy:", (err as Error).message);
  }
  return { url, originalUrl };
}

function toPublicEvent(event: EventRow): PublicEvent {
  const { adminPassword, ...rest } = event;
  return rest;
}

/**
 * Resolve an event for a member of the public.
 *
 * Hiding an event has to mean hiding it, not leaving it on an unlisted URL:
 * every public path goes through here, so switching one off takes its landing
 * page, its agenda, its schedule and its watch page with it. Admin paths use
 * `getEventBySlug`/`getEventById` directly and still see everything.
 */
async function publicEvent(slug?: string): Promise<EventRow | undefined> {
  // A named event either exists publicly or it doesn't.
  if (slug) {
    const named = await storage.getEventBySlug(slug);
    return named?.visible ? named : undefined;
  }
  const featured = await storage.getFeaturedEvent();
  if (featured?.visible) return featured;
  // The front door, with the featured event hidden. This used to return
  // nothing, which took the homepage, the agenda and the watch page down
  // together — and that is far worse than showing a different event. Whatever
  // else is public stands in until somebody fixes the flag.
  const [standIn] = (await storage.listEvents()).filter((e) => e.visible);
  return standIn;
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

/**
 * Attach the second person on a show, where there is one.
 *
 * A co-host is stored as an address; the card needs a name and a face, and
 * those live on the profile. One lookup per co-hosted show, which is a
 * handful, not one per row.
 */
async function withCoHosts(rows: PublicSignup[], all: { coHostEmail: string; id: number }[]): Promise<PublicSignup[]> {
  const byId = new Map(all.map((s) => [s.id, s.coHostEmail?.trim().toLowerCase() ?? ""]));
  return Promise.all(rows.map(async (r) => {
    const email = byId.get(r.id);
    if (!email) return r;
    const prof = await storage.getProfileByEmail(email);
    return prof
      ? {
          ...r,
          coHost: {
            hostName: prof.hostName,
            photoUrl: prof.photoUrl,
            podcastName: prof.podcastName,
            socialLinks: prof.socialLinks,
            rssUrl: prof.rssUrl,
            youtubeUrl: prof.youtubeUrl,
            socialAccounts: prof.socialAccounts ?? "",
          },
        }
      : r;
  }));
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

/**
 * Who a broadcast actually goes to.
 *
 * This used to live in two places — the scheduled-send sweeper and the
 * send-now route — which is how `not-signed-up` would have ended up working in
 * one and silently missing from the other. One reader, both callers.
 */
/** The address the event's own ceremony slots are booked under. */
const HOUSE_EMAIL = "hello@militaryvoice.ai";

/**
 * When a booking is on air, written for the person who booked it.
 *
 * In their own time zone where they gave us one, and always with the zone
 * named — "2:00 PM" means two different hours to a host in San Diego and one
 * in Norfolk, and a slot time that is wrong by three hours is worse than no
 * slot time at all.
 */
async function slotTimeLabel(
  ev: { startAtUtc: string; slotMinutes: number },
  slotIndex: number,
  timezone?: string | null,
): Promise<string> {
  const start = Date.parse(ev.startAtUtc);
  if (!Number.isFinite(start)) return "";
  const at = new Date(start + slotIndex * ev.slotMinutes * 60000);
  const zone = (timezone || "").trim() || "America/New_York";
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long", month: "long", day: "numeric",
      hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: zone,
    }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long", month: "long", day: "numeric",
      hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: "America/New_York",
    }).format(at);
  }
}

/** One booking's air time, by the address that holds it. */
async function slotLabelForEmail(eventId: number | null | undefined, email: string): Promise<string> {
  if (!eventId) return "";
  const ev = await storage.getEventById(eventId);
  if (!ev) return "";
  const key = email.trim().toLowerCase();
  const booking = (await storage.listSignups(eventId)).find(
    (x) => x.status !== "cancelled" && x.email.trim().toLowerCase() === key,
  );
  return booking ? slotTimeLabel(ev, booking.slotIndex, booking.timezone) : "";
}

async function resolveBroadcastRecipients(
  broadcast: BroadcastRow,
): Promise<{ email: string; firstName: string; slotLabel?: string }[]> {
  const deduped = new Map<string, { email: string; firstName: string; slotLabel?: string }>();
  const seg = broadcast.segment;

  if (seg === "signups" || seg === "all") {
    if (broadcast.eventId) {
      // Straight from the bookings rather than the contact list, because the
      // slot index and the host's time zone only exist here.
      const ev = await storage.getEventById(broadcast.eventId);
      const rows = await storage.listSignups(broadcast.eventId);
      for (const r of await storage.listSignupContactsForEvent(broadcast.eventId)) {
        const key = r.email.toLowerCase();
        const booking = rows.find((x) => x.status !== "cancelled" && x.email.trim().toLowerCase() === key);
        const slotLabel = ev && booking ? await slotTimeLabel(ev, booking.slotIndex, booking.timezone) : "";
        deduped.set(key, { ...r, slotLabel });
      }
    }
  }
  if (seg === "contacts" || seg === "all") {
    for (const r of await storage.listActiveContactEmails()) deduped.set(r.email.toLowerCase(), r);
  }

  // Everyone on the list who hasn't taken a slot yet. The whole point of this
  // one is that it must never reach someone who already signed up — being
  // asked to join after you already have reads as nobody paying attention —
  // so the exclusion is applied last, after every other rule has added.
  if (seg === "not-signed-up") {
    for (const r of await storage.listActiveContactEmails()) deduped.set(r.email.toLowerCase(), r);
    if (broadcast.eventId) {
      for (const r of await storage.listSignupContactsForEvent(broadcast.eventId)) {
        deduped.delete(r.email.toLowerCase());
      }
    }
  }

  // The shows we cannot count.
  //
  // A sponsor's first question is who they are reaching, and a podcaster who
  // never pasted a link is simply absent from that number — not because their
  // audience is small, but because we have nothing to look up. This segment is
  // the chase list, and it empties itself: the moment a link comes in and gets
  // enriched, they drop out of it, so the same email can be sent again later
  // without landing on anyone who already did what it asked.
  if (seg === "no-audience-link" && broadcast.eventId) {
    const counted = new Set(
      (await storage.listSocialMetrics())
        .filter((m) => !m.error && m.followers > 0)
        .map((m) => m.email.trim().toLowerCase()),
    );
    const signups = await storage.listSignups(broadcast.eventId);
    const connected = new Set(
      signups
        .filter((sg) => String(sg.socialAccounts ?? "").trim().length > 2)
        .map((sg) => sg.email.trim().toLowerCase()),
    );
    for (const r of await storage.listSignupContactsForEvent(broadcast.eventId)) {
      const key = r.email.toLowerCase();
      // The ceremony slots are ours, not a podcaster's — never write to them.
      if (key === HOUSE_EMAIL) continue;
      if (counted.has(key) || connected.has(key)) continue;
      deduped.set(key, r);
    }
  }

  if (seg.startsWith("segment:")) {
    const segId = Number(seg.split(":")[1]);
    const segList = await storage.listSegments(broadcast.eventId ?? null);
    const found = segList.find((x) => x.id === segId);
    if (found) {
      const filter = JSON.parse(found.filterJson) as Parameters<typeof storage.resolveSegment>[0];
      for (const r of await storage.resolveSegment(filter)) deduped.set(r.email.toLowerCase(), r);
    }
  }
  if (seg.startsWith("engagement:")) {
    const [, bId, engType] = seg.split(":");
    for (const r of await storage.getEngagementRecipients(Number(bId), engType as any)) {
      deduped.set(r.email.toLowerCase(), r);
    }
  }
  return Array.from(deduped.values());
}

/** "The Podcast Marathon · Oct 5, 2026" — the banner line on broadcast emails,
 *  read from the event so it can never contradict the schedule. */
async function broadcastBannerTitle(): Promise<string> {
  try {
    const ev = await storage.getFeaturedEvent();
    const when = new Intl.DateTimeFormat("en-US", {
      month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York",
    }).format(new Date(ev.startAtUtc));
    return `${ev.name} · ${when}`;
  } catch {
    return "The Podcast Marathon";
  }
}

export function registerRoutes(app: Express): void {
  // ---- Public: events list (for "Choose Your Event") -------------------------
  app.get("/api/events", async (_req, res) => {
    publicCache(res, 60);
    const rows = (await storage.listEvents()).filter((e) => e.visible);
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
        let sent: string | null = null;
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
        out.push({ signupId: signup.id, to: signup.email, kind, sent: !!sent, suppressed });
        if (sent) await storage.recordCadenceSend(event.id, kind, signup.email, sent).catch(() => {});
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
  /** Send one hand-written email. Admin only, one recipient, no templating. */
  app.post("/api/admin/emails/send-one", requireAdmin, async (req, res) => {
    const to = String(req.body?.to ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      return res.status(400).json({ message: "Need one valid email address." });
    }
    const subject = String(req.body?.subject ?? "").trim().slice(0, 200);
    const html = String(req.body?.html ?? "");
    const text = String(req.body?.text ?? "");
    if (!subject || (!html && !text)) {
      return res.status(400).json({ message: "Need a subject and a body." });
    }
    if (html.length > 200_000 || text.length > 100_000) {
      return res.status(413).json({ message: "That email is too long to send." });
    }
    // A named sender on our own domain — a producer writing as himself.
    // Only our domain: Resend refuses anything else, and so should we.
    const fromRaw = String(req.body?.from ?? "").trim();
    const fromAddr = (fromRaw.match(/<([^>]+)>/)?.[1] ?? fromRaw).trim().toLowerCase();
    if (fromRaw && !/@militaryvoice\.(ai|io)$/.test(fromAddr)) return res.status(400).json({ message: "The sender has to be on our domain." });
    const headers: Record<string, string> = {};
    if (req.body?.inReplyTo) { headers["In-Reply-To"] = String(req.body.inReplyTo); headers["References"] = String(req.body.inReplyTo); }
    const id = await sendOneOffEmail({ to, subject, html, text, replyTo: String(req.body?.replyTo ?? "") || undefined, from: fromRaw || undefined, headers });
    if (!id) return res.status(502).json({ message: "The mail provider didn't accept it." });
    console.log(`One-off email sent to ${to}: ${subject}`);
    // Filed under a campaign row so the activity log and each contact's
    // history show it. Never fails the send — that has already happened.
    try {
      const featured = await storage.getFeaturedEvent();
      await storage.recordOneOffSend({
        eventId: featured?.id ?? null,
        subject,
        bodyText: text || html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        sender: String(req.body?.sender ?? "team"),
        banner: String(req.body?.banner ?? "podcasters"),
        email: to,
        resendId: id,
      });
    } catch (err) {
      console.error("One-off email sent but not logged:", err);
    }
    res.json({ id, to });
  });

  /**
   * A house file, through the server.
   *
   * A browser cannot PUT to the bucket — it has no CORS policy — so a small
   * file (a screenshot, a still) comes here as a data URL and is put from
   * the server. Register it afterwards with /api/admin/media.
   */
  app.post("/api/admin/house-upload", requireAdmin, async (req, res) => {
    const name = String(req.body?.fileName ?? "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
    const dataUrl = String(req.body?.dataUrl ?? "");
    const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
    if (!m) return res.status(400).json({ message: "Send a data URL." });
    const body = Buffer.from(m[2], "base64");
    if (body.length > 8 * 1024 * 1024) return res.status(413).json({ message: "Too big for this door — use the upload URL." });
    const key = `studio/house/${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${name}`;
    try {
      await putRecordingObject(key, body, m[1]);
      res.json({ storageKey: key, sizeBytes: body.length });
    } catch (err) {
      console.error("House upload failed:", err);
      res.status(502).json({ message: (err as Error).message });
    }
  });

  /** Everyone who has had email from us, for the activity log's by-contact view. */
  app.get("/api/admin/emails/recipients", requireAdmin, async (req, res) => {
    const eventId = Number(req.query.eventId) || (await storage.getFeaturedEvent())?.id;
    noStore(res);
    res.json(eventId ? await storage.listEmailRecipients(eventId) : []);
  });

  app.post("/api/admin/emails/preview", requireAdmin, async (req, res) => {
    const to = String(req.body?.to || "").trim();
    const kind = String(req.body?.kind || "welcome");
    if (!to.includes("@")) {
      res.status(400).json({ message: "Give me an address to send to." });
      return;
    }
    let sent: boolean | string | null = false;
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
    res.json({ to, kind, sent: !!sent });
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
        sent[kind] = !!(await send(payload));
      } catch (err) {
        console.error(`Preview ${kind} failed:`, err);
        sent[kind] = false;
      }
    }
    res.json({ to, basedOn: signup.podcastName, sent });
  });

  /**
   * One email as it arrives, for the eye icon on the activity log.
   *
   * Campaigns render from their stored body. The automatic ones have no body
   * to store — their wording lives in code and carries per-person detail — so
   * they are rendered for the most recent booking, the same stand-in the
   * "send me a preview" buttons use.
   */
  app.get("/api/admin/email-preview", requireAdmin, async (req, res) => {
    const broadcastId = Number(req.query.broadcastId) || 0;
    let cadence = String(req.query.cadence || "");
    let b: BroadcastRow | undefined;
    if (broadcastId) {
      b = await storage.getBroadcast(broadcastId);
      if (!b) return res.status(404).json({ message: "No such email." });
      if (b.source.startsWith("cadence:") && !b.bodyText.trim()) cadence = b.source.slice("cadence:".length);
    }
    noStore(res);
    if (cadence) {
      const featured = await storage.getFeaturedEvent();
      const active = (await storage.listSignups(featured.id)).filter((x) => x.status !== "cancelled");
      const signup = active[active.length - 1];
      if (!signup) return res.status(404).json({ message: "No booking to build a preview from." });
      if (cadence === "confirmation") {
        const r = renderConfirmationEmail({
          to: signup.email,
          hostName: signup.hostName,
          podcastName: signup.podcastName,
          eventName: featured.name,
          onAirStartLabel: "Mon, Oct 5 · 9:30 AM",
          onAirEndLabel: "9:55 AM",
          timezoneLabel: "US Eastern (EDT)",
          agendaUrl: `${PUBLIC_ORIGIN}/agenda`,
        });
        return res.type("html").send(r.html);
      }
      if (cadence === "prep" || cadence === "final" || cadence === "onair") {
        const r = renderNudge(cadence, { ...(await buildNudgePayload(signup, featured)), to: signup.email });
        return res.type("html").send(r.html);
      }
      return res.status(404).json({ message: "Nothing stored to preview for that email." });
    }
    if (!b) return res.status(400).json({ message: "Say which email." });
    const senderMember = await resolveTeamSender(b.sender ?? "team");
    const rendered = renderBroadcastEmail({
      to: "preview@militaryvoice.ai",
      firstName: "Sam",
      subject: b.subject,
      bodyText: b.bodyText,
      unsubscribeUrl: "#",
      sender: b.sender,
      banner: b.banner,
      senderMember,
      bannerTitle: await broadcastBannerTitle(),
    });
    res.type("html").send(rendered.html);
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
        const recipients = await resolveBroadcastRecipients(broadcast);
        const senderMember = await resolveTeamSender(broadcast.sender ?? "team");
        let sent = 0;
        for (const r of recipients) {
          const resendId = await sendBroadcastEmail({
            to: r.email,
            firstName: r.firstName,
            slotLabel: r.slotLabel,
            subject: broadcast.subject,
            bodyText: broadcast.bodyText,
            unsubscribeUrl: `${origin}/unsubscribe?token=scheduled`,
            sender: broadcast.sender ?? "team",
            banner: broadcast.banner ?? "welcome",
            senderMember: senderMember ?? undefined,
            bannerTitle: await broadcastBannerTitle(),
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

  /**
   * Hourly cron: send the "remind me later" follow-ups whose three days are up.
   *
   * It re-sends the same broadcast to the one person who asked for it, which
   * is what they actually said yes to — a differently-worded second attempt
   * would be a new email they never agreed to receive. The follow-up itself
   * carries no further "remind me later" link: once is a courtesy, twice is a
   * loop somebody can sit in forever without us ever noticing.
   */
  const followUpHandler: RequestHandler = async (req, res) => {
    const cronSecret = process.env.CRON_SECRET;
    const auth = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (cronSecret && auth !== cronSecret) {
      res.status(401).json({ message: "Not authorised." });
      return;
    }
    const due = await storage.listDueFollowUps(new Date().toISOString());
    const origin = `${req.protocol}://${req.get("host")}`;
    let sent = 0;
    for (const f of due) {
      // Claimed first: a send that then fails loses one follow-up rather than
      // repeating it every hour until somebody notices.
      if (!(await storage.claimFollowUp(f.id))) continue;
      try {
        const broadcast = (await storage.listBroadcasts(null)).find((b) => b.id === f.broadcastId);
        if (!broadcast) continue;
        const senderMember = await resolveTeamSender(broadcast.sender ?? "team");
        const resendId = await sendBroadcastEmail({
          to: f.email,
          firstName: "",
          slotLabel: await slotLabelForEmail(broadcast.eventId, f.email),
          subject: broadcast.subject,
          bodyText: broadcast.bodyText,
          unsubscribeUrl: `${origin}/unsubscribe?token=followup`,
          sender: broadcast.sender ?? "team",
          banner: broadcast.banner ?? "welcome",
          senderMember: senderMember ?? undefined,
          bannerTitle: await broadcastBannerTitle(),
        });
        if (resendId) {
          sent++;
          await storage.recordBroadcastSend(broadcast.id, f.email, resendId);
        }
      } catch (err) {
        console.error(`Follow-up ${f.id} failed:`, err);
      }
    }
    res.json({ sent, due: due.length });
  };
  app.get("/api/cron/follow-ups", followUpHandler);
  app.post("/api/cron/follow-ups", followUpHandler);

  /**
   * Keep the sponsor pages' audience figures current on their own.
   *
   * They were a stored snapshot refreshed only when an admin remembered to
   * press a button, which meant the number on a live sponsor page drifted
   * further from the truth every time a host joined or connected an account.
   * Once a day is the right cadence: the upstream call costs one request per
   * podcaster, and these are 30-day rolling figures that do not move hourly.
   */
  const audienceRefreshHandler: RequestHandler = async (_req, res) => {
    try {
      const featured = await storage.getFeaturedEvent();
      const snap = await buildAudienceSnapshot(featured?.id);
      // A run that comes back with nothing — the provider down, the key
      // rotated — must not wipe a good snapshot off the flyers.
      if (snap.followers <= 0) {
        res.json({ skipped: "no figures returned; keeping the previous snapshot" });
        return;
      }
      await saveAudienceSnapshot(snap);
      res.json({ followers: snap.followers, channels: snap.channels, shows: snap.shows });
    } catch (err) {
      console.error("Audience refresh failed:", err);
      res.status(502).json({ message: (err as Error).message });
    }
  };
  /**
   * Clear egress flags whose egress has died.
   *
   * A studio keeps an egress id and a status so the console knows whether it
   * is on. Nothing clears them when an egress ends without telling us — a
   * crashed worker, a room that emptied, a laptop closed mid-session — so the
   * flags outlive the thing they describe. A producer then walks into a room
   * that says RECORDING, cannot stop it because there is nothing to stop, and
   * has no way to tell whether they are on air. The watch page reads the same
   * status to decide whether to show a LIVE badge.
   *
   * Runs on the same sweep as the nudges, and never touches an egress LiveKit
   * still reports as running.
   */
  const reconcileEgressHandler: RequestHandler = async (_req, res) => {
    if (!isLiveKitConfigured()) {
      res.json({ skipped: "no media layer" });
      return;
    }
    let running: Set<string>;
    try {
      running = await runningEgressIds();
    } catch (err) {
      // Unreachable LiveKit is not evidence that anything stopped.
      res.status(502).json({ message: (err as Error).message });
      return;
    }
    let cleared = 0;
    for (const st of await storage.listAllStudios()) {
      const deadBroadcast = !!st.broadcastEgressId && !running.has(st.broadcastEgressId);
      const deadRecording = !!st.recordingEgressId && !running.has(st.recordingEgressId);
      const falselyLive = st.status === "Live" && (!st.broadcastEgressId || deadBroadcast);
      if (!deadBroadcast && !deadRecording && !falselyLive) continue;
      await storage.updateStudio(st.id, {
        ...(deadBroadcast ? { broadcastEgressId: "" } : {}),
        ...(deadRecording ? { recordingEgressId: "" } : {}),
        ...(falselyLive ? { status: "Offline" } : {}),
      });
      cleared++;
    }
    for (const r of await storage.listUnfinishedRecordings()) {
      if (running.has(r.egressId)) continue;
      await storage.finishRecording(r.egressId, {
        status: "Failed",
        error: "Egress ended without a completion callback; reconciled from LiveKit.",
      });
      cleared++;
    }
    res.json({ cleared, running: running.size });
  };
  app.get("/api/cron/reconcile", reconcileEgressHandler);
  app.post("/api/cron/reconcile", reconcileEgressHandler);

  app.get("/api/cron/reach", audienceRefreshHandler);
  app.post("/api/cron/reach", audienceRefreshHandler);

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

  /**
   * The whole board on one image, and one show framed as a spotlight.
   *
   * These are what the host posts. /og/slot already renders a card for a
   * podcaster's own share link; a spotlight is the same card addressed to a
   * listener rather than a follower — "come and watch this one" instead of
   * "this is my slot" — so it is the same renderer with different words, not a
   * second design to keep in sync.
   */
  app.get("/og/lineup.jpg", async (req, res) => {
    const ev = await publicEvent(typeof req.query.slug === "string" ? req.query.slug : undefined);
    if (!ev) {
      noStore(res);
      res.status(404).end();
      return;
    }
    const origin = `${req.protocol}://${req.get("host")}`;
    // Only the day itself: a booking parked past the end (the organisers'
    // own eyes-on account) is not on the lineup card.
    const lineupSlots = Math.floor((ev.durationHours * 60) / ev.slotMinutes);
    const signups = (await storage.listSignups(ev.id))
      .filter((sg) => sg.status !== "cancelled" && sg.slotIndex < lineupSlots)
      .sort((a, b) => a.slotIndex - b.slotIndex);
    const requested = String(req.query.size ?? "square");
    const size: CardSize = requested in CARD_SIZES ? (requested as CardSize) : "square";
    const dateLabel = new Intl.DateTimeFormat("en-US", {
      month: "long", day: "numeric", timeZone: "America/New_York",
    }).format(new Date(ev.startAtUtc));

    const jpg = await buildLineupCard(
      {
        dateLabel,
        shows: signups.map((sg) => ({
          podcastName: sg.podcastName,
          photoUrl: sg.photoUrl
            ? sg.photoUrl.startsWith("http") ? sg.photoUrl : `${origin}${sg.photoUrl}`
            : undefined,
        })),
      },
      size,
    );
    res.setHeader("Content-Type", "image/jpeg");
    // Short, because the lineup grows: a host who signs up today should be on
    // the poster within the hour, not whenever the CDN feels like it.
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=900");
    res.end(jpg);
  });

  app.get("/og/spotlight/:id.jpg", async (req, res) => {
    const found = await shareSubject(Number(req.params.id));
    if (!found) {
      res.status(404).end();
      return;
    }
    const { signup, whenLabel } = found;
    const origin = `${req.protocol}://${req.get("host")}`;
    const photo = signup.photoUrl
      ? signup.photoUrl.startsWith("http") ? signup.photoUrl : `${origin}${signup.photoUrl}`
      : undefined;
    const requested = String(req.query.size ?? "square");
    const size: CardSize = requested in CARD_SIZES ? (requested as CardSize) : "square";
    const jpg = await buildShareCard(
      {
        podcastName: signup.podcastName,
        hostName: signup.hostName,
        whenLabel,
        photoUrl: photo,
        eyebrow: "IN THE SPOTLIGHT",
        subline: signup.hostName ? `Hosted by ${signup.hostName}` : undefined,
        footer: "Free to watch · register at militaryvoice.ai",
      },
      size,
    );
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
      events = (await storage.listEvents()).filter((e) => e.slug && e.visible);
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
    const slug = typeof req.query.slug === "string" ? req.query.slug : undefined;
    const event = await publicEvent(slug);
    if (!event) {
      // Deliberately uncached. This used to set a 60-second edge cache before
      // it knew the answer, so a few seconds of bad state froze a 404 across
      // the whole edge for a minute — the homepage stayed empty long after
      // the database was correct again.
      noStore(res);
      res.status(404).json({ message: "Event not found" });
      return;
    }
    publicCache(res, 60);
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
    // A profile whose only booking is parked past the end of the day — the
    // organisers' own eyes-on account — is not a podcaster on the lineup.
    const featured = await storage.getFeaturedEvent();
    const dayLength = Math.floor((featured.durationHours * 60) / featured.slotMinutes);
    const parked = new Set<string>();
    const onDay = new Set<string>();
    for (const sg of await storage.listSignups(featured.id)) {
      if (sg.status === "cancelled") continue;
      (sg.slotIndex < dayLength ? onDay : parked).add(sg.email.trim().toLowerCase());
    }
    const rows = (await storage.listCompleteProfiles()).filter((p) => {
      const e = p.email.trim().toLowerCase();
      return !(parked.has(e) && !onDay.has(e));
    });
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

  // ---- Public: sponsor logos ("Friends of the Marathon") ----------------------
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
  /**
   * The packages, for the public pitch.
   *
   * Active ones only, and the sold count is deliberately not here: how many
   * are left is a negotiating position, not a fact a prospect needs before
   * they have spoken to anyone.
   */
  app.get("/api/sponsor-packages", async (req, res) => {
    const featured = await storage.getFeaturedEvent();
    const eventId = Number(req.query.eventId) || featured.id;
    const rows = await storage.listSponsorPackages(eventId);
    publicCache(res, 300);
    res.json(
      rows
        .filter((p) => p.active)
        .map((p) => ({ id: p.id, name: p.name, price: p.price, tier: p.tier, description: p.description })),
    );
  });

  app.post("/api/sponsor-inquiries", async (req, res) => {
    const parsed = insertSponsorInquirySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    if (!(await requireHuman(req, res))) return;
    // The name is copied in, not looked up later: the package can be renamed
    // or retired, and the enquiry has to keep saying what was on the page when
    // they read it. An id that no longer resolves is not a record of anything.
    let packageName = "";
    let checkoutUrl = "";
    if (parsed.data.packageId) {
      const featured = await storage.getFeaturedEvent();
      const pack = (await storage.listSponsorPackages(featured.id)).find((p) => p.id === parsed.data.packageId);
      if (pack) {
        packageName = `${pack.name}${pack.price ? ` · $${pack.price.toLocaleString()}` : ""}`;
        checkoutUrl = pack.checkoutUrl ?? "";
      }
    }
    const created = await storage.createSponsorInquiry({ ...parsed.data, packageName });
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
        message: packageName
          ? `Interested in: ${packageName}\n\n${parsed.data.message ?? ""}`.trim()
          : parsed.data.message ?? "",
      });
    } catch (err) {
      console.error("Failed to send sponsor inquiry email:", err);
    }

    // Their own copy, with the way to pay in it. Before the response for the
    // same reason as the alert above: work started after the response is
    // flushed is not guaranteed to run on serverless.
    try {
      await sendSponsorThanksEmail({ to: parsed.data.email, name: parsed.data.name, packageName, checkoutUrl });
    } catch (err) {
      console.error("Failed to send the sponsor thank-you:", err);
    }

    // The link comes back on the response too, so the dialog can show it at
    // once. Somebody who has just decided should not have to go and find an
    // email to act on it.
    res.status(201).json({ id: created.id, checkoutUrl, packageName });
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

  /**
   * A URL the browser uploads to directly, for anything too big for a request
   * body — which a pre-recorded episode always is. The bytes never touch this
   * function; it only hands out the signed URL and, afterwards, records where
   * the file landed.
   */
  /**
   * The fallback door for a podcaster's file.
   *
   * The direct PUT to storage has never worked from a browser — the bucket
   * has no CORS policy — so until it is opened, intros, outros and images
   * come through here. Capped well under what a function body will carry; a
   * pre-recorded episode is too big for this and still needs the bucket.
   */
  app.post(
    "/api/host/assets/upload",
    requireHostSession,
    express.raw({ type: "*/*", limit: "80mb" }),
    async (req, res) => {
      const name = String(req.query.fileName ?? "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ message: "No file arrived." });
      const key = `show-assets/${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${name}`;
      try {
        await putRecordingObject(key, body, String(req.get("content-type") || "application/octet-stream").split(";")[0]);
        res.json({ storageKey: key, sizeBytes: body.length });
      } catch (err) {
        console.error("Proxied asset upload failed:", err);
        res.status(502).json({ message: "Storage refused the file. Try again in a moment." });
      }
    },
  );

  app.post("/api/host/assets/upload-url", requireHostSession, async (req, res) => {
    const name = String(req.body?.fileName ?? "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
    const key = `show-assets/${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${name}`;
    try {
      // R2, not Supabase. Supabase caps objects at 48MB across the whole
      // project — the bucket asks for more and is refused — and a
      // pre-recorded episode is several times that. Recordings have always
      // gone to R2 for exactly this reason.
      res.json({ uploadUrl: signedRecordingUpload(key), storageKey: key });
    } catch (err) {
      console.error("Could not sign an asset upload:", err);
      res.status(502).json({ message: "Couldn't start the upload. Try again in a moment." });
    }
  });

  /**
   * A permanent link to a file that only has temporary ones.
   *
   * R2 is private and its signatures expire, so the URL stored on the row
   * cannot be a signed one — it would work for two hours and then rot. This
   * redirects to a freshly signed link each time, which means every existing
   * consumer keeps treating fileUrl as an ordinary href.
   */
  /**
   * Show media, for anyone watching.
   *
   * /api/assets/:id/file is admin-or-owner, which is right for a podcaster's
   * own files and wrong for the thing being broadcast: the stage plays from
   * the public watch page and from a headless browser doing the egress
   * composite, and neither carries a cookie. An episode that 403s at 9am
   * because nobody was signed in is not a security win.
   *
   * Narrow on purpose. House-owned only, studio/ prefix only, redirect only —
   * so it can reach the four pre-recorded episodes and nothing a podcaster
   * uploaded to their own profile.
   */
  app.get("/api/studio/media/:id", async (req, res) => {
    const asset = await storage.getAsset(Number(req.params.id));
    if (!asset?.storageKey || asset.email !== HOUSE_EMAIL || !asset.storageKey.startsWith("studio/")) {
      res.status(404).json({ message: "No such file." });
      return;
    }
    try {
      res.redirect(302, await signedRecordingUrl(asset.storageKey, 6 * 3600));
    } catch (err) {
      console.error("Could not sign studio media:", err);
      res.status(502).json({ message: "Couldn't open that file." });
    }
  });

  app.get("/api/assets/:id/file", async (req, res) => {
    const asset = await storage.getAsset(Number(req.params.id));
    if (!asset?.storageKey) {
      res.status(404).json({ message: "No such file." });
      return;
    }
    // The old Supabase bucket was public, so this is stricter than what it
    // replaces: the podcaster it belongs to, or somebody on the crew.
    const sessionEmail = (getSessionEmail(req) ?? "").trim().toLowerCase();
    const adminEmail = getAdminEmail(req);
    const allowed =
      (sessionEmail && sessionEmail === asset.email.trim().toLowerCase()) ||
      (adminEmail && (await storage.isAdminEmail(adminEmail)));
    if (!allowed) {
      res.status(403).json({ message: "Sign in to open this file." });
      return;
    }
    try {
      noStore(res);
      res.redirect(302, await signedRecordingUrl(asset.storageKey, 3600));
    } catch (err) {
      console.error("Could not sign an asset for download:", err);
      res.status(502).json({ message: "Couldn't open that file." });
    }
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
      // Set when the browser uploaded straight to storage and is now telling
      // us where it put it. Only our own bucket is accepted — this field
      // writes a URL we will later play on air, so it cannot be an arbitrary
      // address somebody posts here.
      const uploadedUrl = (body.uploadedUrl ?? "").trim();
      const fromOurBucket =
        uploadedUrl &&
        /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/show-assets\//i.test(uploadedUrl);

      if (uploadedUrl && !fromOurBucket) {
        res.status(400).json({ message: "That upload didn't come from us. Try again." });
        return;
      }
      if (!req.file && !linkUrl && !fromOurBucket) {
        res.status(400).json({ message: "Choose a file first." });
        return;
      }
      if (linkUrl && !/^https?:\/\//i.test(linkUrl)) {
        res.status(400).json({ message: "That link needs to start with http:// or https://" });
        return;
      }

      // The browser uploaded straight to R2 and is telling us the key. Only
      // our own prefix is accepted: this value decides what the studio plays
      // on air, so it cannot be an arbitrary path somebody posts here.
      const storageKey = String(body.storageKey ?? "").trim();
      const fromR2 = /^show-assets\/[A-Za-z0-9._\-]+$/.test(storageKey);
      if (storageKey && !fromR2) {
        res.status(400).json({ message: "That upload didn't come from us. Try again." });
        return;
      }
      if (!req.file && !linkUrl && !fromOurBucket && !fromR2) {
        res.status(400).json({ message: "Choose a file first." });
        return;
      }

      let fileUrl = fromOurBucket ? uploadedUrl : "";
      let fileName = fromOurBucket || fromR2 ? String(body.fileName ?? "").slice(0, 200) : "";
      let sizeBytes = fromOurBucket || fromR2 ? Number(body.sizeBytes) || 0 : 0;
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

      const created = await storage.createAsset({
        email, kind, label, fileUrl, storageKey: fromR2 ? storageKey : "", linkUrl, fileName, sizeBytes,
      });
      // The link needs the row's own id, so it is set the moment there is one.
      if (fromR2) {
        const href = `/api/assets/${created.id}/file`;
        await storage.setAssetFileUrl(created.id, href);
        created.fileUrl = href;
      }
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
      scope: acct?.scope ?? "segment",
    });
  });

  /**
   * Their segment, or the whole show, on their channel.
   *
   * "Segment" needs nothing now: the producer opens a broadcast on their
   * channel when their slot comes up. "Show" is a destination on the house
   * broadcast, so it is opened here — a broadcast scheduled for the event's
   * start, bound to a stream, and its ingest filed as a whole-day destination
   * that the day's egress picks up with the others. Switching back removes
   * that destination; the scheduled broadcast on their channel simply never
   * starts.
   */
  app.patch("/api/host/youtube", requireHostSession, async (req, res) => {
    const email = (getSessionEmail(req) ?? "").toLowerCase().trim();
    const scope = req.body?.scope === "show" ? "show" : req.body?.scope === "segment" ? "segment" : null;
    if (!scope) return res.status(400).json({ message: "Segment or show." });
    const acct = await storage.getYoutubeAccount(email);
    if (!acct) return res.status(409).json({ message: "Connect YouTube first." });
    const event = await storage.getFeaturedEvent();
    const mine = (await storage.listDestinations(event.id)).filter(
      (d) => d.platform === "youtube" && !d.signupId && d.ownerEmail.toLowerCase() === email,
    );
    if (scope === "show" && mine.length === 0) {
      const token = await youtubeToken(email);
      if (!token) return res.status(409).json({ message: "YouTube isn't answering for your channel — reconnect it and try again." });
      try {
        const b = await createBroadcast(token, {
          title: event.name,
          description: `${event.tagline || event.name} — live from MilitaryVoice.ai, the whole day.`,
          startAtIso: event.startAtUtc,
        });
        await storage.createDestination(event.id, email, {
          platform: "youtube",
          label: `${acct.channelTitle || email} · whole show`,
          rtmpUrl: b.ingestAddress,
          streamKey: b.streamName,
          enabled: true,
        });
      } catch (err: any) {
        console.error("Couldn't open a whole-show broadcast:", err);
        return res.status(502).json({ message: err?.message ?? "YouTube wouldn't open the broadcast. Is live streaming enabled on your channel?" });
      }
    }
    if (scope === "segment") for (const d of mine) await storage.deleteDestination(d.id);
    await storage.upsertYoutubeAccount(email, { refreshToken: acct.refreshToken, scope });
    res.json({ ok: true, scope });
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
      // A Google login with no channel behind it is not a connection. Frank
      // signed in with the account that has no YouTube channel, we saved it
      // as connected, and nothing could ever stream to him. Send them back to
      // choose the account — usually a brand account — that owns the channel.
      if (!channel.id) {
        res.redirect("/host/dashboard?youtube=noChannel");
        return;
      }
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
    // Two stores, two ways out. deleteShowAsset parses a Supabase URL, and an
    // R2-backed asset's fileUrl is our own redirect — so without the key
    // branch the row would vanish and the object would sit in the bucket for
    // good, paid for and unreachable.
    try {
      if (mine.storageKey) await deleteRecordingObject(mine.storageKey);
      else if (mine.fileUrl) await deleteShowAsset(mine.fileUrl);
    } catch (err) {
      console.error("Couldn't remove the stored file:", err);
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
  /**
   * The studio a public link is asking for.
   *
   * A named studio decides its own event. This used to resolve the event first
   * — the featured one when no slug was given — and then accept the studio
   * only if it happened to belong to that event. Every other studio fell
   * through to the marathon's, so pressing "Watch page" from a test event
   * showed the live marathon instead: a different show, to a real audience,
   * with none of your test on it.
   *
   * A hidden event stays hidden. Crew can still preview their own — they are
   * the only people who could have the link — but it is never substituted for
   * something else, which is the failure worth preventing.
   */
  async function studioForSlug(slug?: string, studioId?: number, req?: Request) {
    if (studioId) {
      const picked = await storage.getStudioById(studioId);
      if (picked) {
        const owner = await storage.getEventById(picked.eventId);
        if (owner) {
          if (owner.visible) return { event: owner, studio: picked };
          const adminEmail = req ? getAdminEmail(req) : "";
          if (adminEmail && (await storage.isAdminEmail(adminEmail))) return { event: owner, studio: picked };
          return null;
        }
      }
      return null;
    }
    const event = await publicEvent(slug);
    if (!event) return null;
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
  async function speakerState(event: EventRow, studio: StudioRow, clientKey: string, req?: Request) {
    // Same rule the join endpoint enforces, answered early so the page can
    // explain rather than let someone fill in a form that will be refused.
    let mayJoin = false;
    let crew = false;
    if (req) {
      crew = await isCrew(req, event.id);
      if (crew) mayJoin = true;
      else {
        const host = getSessionEmail(req);
        mayJoin =
          Boolean(host) &&
          (await storage.listSignups(event.id)).some(
            (sg) => sg.status !== "cancelled" && sg.email.trim().toLowerCase() === host!.trim().toLowerCase(),
          );
      }
    }
    const all = await storage.listStudioParticipants(studio.id);
    const me = all.find((p) => p.clientKey === clientKey) ?? null;

    // Someone waiting wants two things the counts alone can't tell them: who is
    // on air right now, and how long until it's their turn.
    const onStage = all
      .filter((p) => p.state === "On stage" && withPresence(p))
      .map((p) => ({ name: p.displayName }));

    let mySlot: { startsAtUtc: string; endsAtUtc: string; label: string } | null = null;
    let myPhotoUrl = "";
    // The signed-in account first, the participant row second.
    //
    // This used to read only the participant's email, which is filled in when
    // they join — so a host who had signed in, held a 3am slot and was
    // standing in the green room was told "no slot on this event", because
    // the row they were being matched on had no address in it yet.
    const sessionEmail = (req ? getSessionEmail(req) : "") ?? "";
    const adminEmail = (req ? getAdminEmail(req) : "") ?? "";
    const email = (sessionEmail || me?.email || "").trim().toLowerCase();
    if (email) {
      const mine = (await storage.listSignups(event.id)).find(
        (sgn) => sgn.status !== "cancelled" && sgn.email.trim().toLowerCase() === email,
      );
      // Their own artwork, so a camera that's off shows who they are rather
      // than a black rectangle.
      myPhotoUrl = mine?.photoUrl || (await storage.getProfileByEmail(email))?.photoUrl || "";
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

    // Crew hold no slot and have no podcaster profile, so there is no artwork
    // to fall back to — but they are usually on the event team, which does
    // carry a photo. Without this a producer's camera being off is a black
    // rectangle with no clue whose it is.
    const team = await storage.listEventTeam(event.id);
    const teamMe = team.find((m) => {
      const e = m.email.trim().toLowerCase();
      return e && (e === email || e === adminEmail.trim().toLowerCase());
    });
    if (!myPhotoUrl && teamMe) myPhotoUrl = teamMe.photoUrl || "";
    // Who is producing the day, for the small card under the pills. The
    // team carries hosts too; the card is for whoever is running it.
    const producers = team
      .filter((m) => /produc|director|crew|stage/i.test(m.title))
      .map((m) => ({ name: m.name, title: m.title, photoUrl: m.photoUrl }));

    return {
      /** The crew member's own name from the team card, so the green room does not ask a producer to type it. */
      myName: teamMe?.name ?? "",
      producers,
      eventName: event.name,
      studio: {
        name: studio.name,
        status: studio.status,
        fallbackPlaying: studio.fallbackPlaying,
        maxOnStage: studio.maxOnStage,
      },
      // The same shape the watch page renders from, so the green room can show
      // the programme itself rather than a description of it. Read-only here.
      meta: studioMeta(event.name, studio, event),
      /** Whether this visitor may enter — decided here, said before the door. */
      mayJoin,
      me,
      onStage,
      mySlot,
      myPhotoUrl,
      /** Which sign-in the slot was looked up under, so a mismatch is visible. */
      myEmail: email,
      /** True when they got in as crew rather than as someone on the lineup. */
      isCrew: crew,
      onStageCount: onStage.length,
      greenRoomCount: all.filter((p) => p.state === "Green room" && withPresence(p)).length,
    };
  }

  app.get("/api/studio/state", async (req, res) => {
    noStore(res);
    const found = await studioForSlug(typeof req.query.slug === "string" ? req.query.slug : undefined, numParam(req.query.studioId), req);
    if (!found) {
      res.status(404).json({ message: "No event" });
      return;
    }
    const clientKey = typeof req.query.clientKey === "string" ? req.query.clientKey : "";
    res.json(await speakerState(found.event, found.studio, clientKey, req));
  });

  /**
   * A viewer's ticket to the room. No sign-in: this is the public broadcast,
   * and the token can only subscribe — never publish, never see the green
   * room's identities beyond what the stage already shows.
   */
  /**
   * The running order, for the people in it.
   *
   * Read-only on purpose: a podcaster should be able to see where the show is
   * up to and what's next without being able to change it. Only a producer
   * edits scenes, and that stays behind the admin routes.
   */
  app.get("/api/studio/scenes", async (req, res) => {
    noStore(res);
    const found = await studioForSlug(
      typeof req.query.slug === "string" ? req.query.slug : undefined,
      numParam(req.query.studioId),
      req,
    );
    if (!found) {
      res.json({ scenes: [], currentSceneId: 0 });
      return;
    }
    // The same rows the producer's rail renders, so the green room shows the
    // running order itself rather than a summary of it. Read-only by route:
    // there is no write side here at all.
    //
    // The run items and signups travel with them because the rail resolves a
    // scene to its podcaster through those two, and that is what puts a face
    // on the card. Without them the green room drew the same list as a column
    // of identical camera glyphs — the same rail in name only.
    // A scene the producer took in some earlier session is not on air now.
    // Reporting it anyway put an ON AIR badge on a 1:30pm segment while the
    // header two inches above said OFF AIR, sent the green room's rail into
    // the middle of the running order, and had the countdown cards counting
    // down to a pair from the middle of the afternoon. Off air there is no
    // current scene, and the day starts at the top where it actually starts.
    //
    // Only the green room reads this. The producer's own console takes the
    // studio row directly and still sees the last scene it took.
    const live = found.studio.status === "Live";
    const allScenes = await storage.listScenes(found.studio.id);
    res.json({
      currentSceneId: live ? found.studio.currentSceneId : 0,
      // The clock travels with the running order so the green room, the
      // producer and Alex are all reading one number rather than three
      // arrived at separately. Off air there is nothing to be late for.
      clock: live
        ? showClock(
            allScenes.map((sc) => ({ id: sc.id, name: sc.name, startAtUtc: sc.startAtUtc })),
            found.studio.currentSceneId,
            found.studio.currentSceneTakenAtUtc,
          )
        : null,
      scenes: allScenes,
      runItems: await storage.listRunOfShow(found.studio.eventId),
      signups: (await storage.listSignups(found.studio.eventId)).filter((x) => x.status !== "cancelled"),
    });
  });

  app.get("/api/watch/token", async (req, res) => {
    noStore(res);
    if (!isLiveKitConfigured()) {
      res.json({ configured: false });
      return;
    }
    const found = await studioForSlug(
      typeof req.query.slug === "string" ? req.query.slug : undefined,
      numParam(req.query.studioId),
      req,
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
      // The same shape the room carries. Room metadata only survives while the
      // room exists, and before the event nobody is in it — so a viewer would
      // join an empty room and get nothing. Seed them from the record instead
      // and let live metadata overwrite it once the studio is actually up.
      meta: studioMeta(event.name, studio, event),
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
    const found = await studioForSlug(typeof req.body?.slug === "string" ? req.body.slug : undefined, numParam(req.body?.studioId), req);
    if (!found) {
      res.status(404).json({ message: "No event" });
      return;
    }
    // A signed-in podcaster is recognised and gets their show name automatically.
    const hostEmail = getSessionEmail(req);
    const profile = hostEmail ? await storage.getProfileByEmail(hostEmail) : undefined;

    /**
     * Who is allowed in.
     *
     * The green room carries live microphones and every other speaker's face,
     * and it used to take anyone who typed a name. Two ways in now: a
     * podcaster who actually holds a slot on this event, or the crew. The
     * check is here rather than in the browser because the browser is not
     * where a stranger would be.
     */
    const adminEmail = getAdminEmail(req);
    const isCrew = Boolean(adminEmail && (await storage.isAdminEmail(adminEmail)));
    const onTheAgenda =
      Boolean(hostEmail) &&
      (await storage.listSignups(found.event.id)).some(
        (sg) => sg.status !== "cancelled" && sg.email.trim().toLowerCase() === hostEmail!.trim().toLowerCase(),
      );
    if (!isCrew && !onTheAgenda) {
      res.status(403).json({
        message: hostEmail
          ? "The green room is for podcasters on this event's lineup. Take a time on the agenda and it opens for you."
          : "Sign in as a podcaster to enter the green room.",
      });
      return;
    }

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
    const found = await studioForSlug(typeof req.body?.slug === "string" ? req.body.slug : undefined, numParam(req.body?.studioId), req);
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
    //
    // `req` matters. Everything in speakerState that depends on who is asking
    // — their slot, their artwork, whether they are crew — is read from the
    // session on the request, and this call was omitting it. The heartbeat
    // and the poll therefore returned different answers every few seconds,
    // which showed up as the avatar flickering on and off and the slot
    // appearing and vanishing.
    res.json(await speakerState(found.event, found.studio, parsed.data.clientKey, req));
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
    const found = await studioForSlug(typeof req.body?.slug === "string" ? req.body.slug : undefined, numParam(req.body?.studioId), req);
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

  /**
   * Change the name that shows under your own picture.
   *
   * It is the name the room sees and the name the lower third carries, and
   * until now it could only be set once, on the way in — so anybody who typed
   * it in a hurry, or was auto-filled with the wrong one, was stuck with it in
   * front of an audience. Scoped to the caller's own clientKey: you can rename
   * yourself and nobody else.
   */
  app.post("/api/studio/rename", async (req, res) => {
    const found = await studioForSlug(typeof req.body?.slug === "string" ? req.body.slug : undefined, numParam(req.body?.studioId), req);
    if (!found) {
      res.status(404).json({ message: "No event" });
      return;
    }
    const clientKey = typeof req.body?.clientKey === "string" ? req.body.clientKey : "";
    const displayName = String(req.body?.displayName ?? "").trim().slice(0, 60);
    if (!clientKey || !displayName) {
      res.status(400).json({ message: "A name is required." });
      return;
    }
    const all = await storage.listStudioParticipants(found.studio.id);
    if (!all.some((p) => p.clientKey === clientKey)) {
      res.status(404).json({ message: "You're not in this room." });
      return;
    }
    await storage.upsertStudioParticipant(found.studio.id, clientKey, { displayName });
    res.json(await speakerState(found.event, found.studio, clientKey, req));
  });

  app.post("/api/studio/leave", async (req, res) => {
    const found = await studioForSlug(typeof req.body?.slug === "string" ? req.body.slug : undefined, numParam(req.body?.studioId), req);
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

  /** The corner logo. An image, not a clip — stored like a sponsor mark. */
  app.post(
    "/api/admin/studio/logo",
    requireAdmin,
    (req, res, next) => {
      upload.single("logo")(req, res, (err: any) => {
        if (err) {
          res.status(400).json({ message: err.message || "Couldn't read that image." });
          return;
        }
        next();
      });
    },
    async (req, res) => {
      if (!req.file) {
        res.status(400).json({ message: "Attach an image. A PNG or SVG with a transparent background sits best over video." });
        return;
      }
      const { studio } = await adminStudio(req);
      const ext = (req.file.mimetype.split("/")[1] || "png").replace("svg+xml", "svg").replace("jpeg", "jpg");
      let url = "";
      try {
        url = await uploadPhoto(`studio-logos/${Date.now()}-${crypto.randomBytes(5).toString("hex")}.${ext}`, req.file.buffer, req.file.mimetype);
      } catch (err) {
        console.error("Studio logo upload failed:", err);
        res.status(502).json({ message: "Couldn't store that image. Try again." });
        return;
      }
      // Uploading one means wanting it on screen; hiding it is one switch away.
      const updated = await storage.updateStudio(studio.id, { logoUrl: url, logoVisible: true });
      if (updated) {
        const ev = await storage.getEventById(studio.eventId);
        await syncRoomMetadata(roomName(studio.id), studioMeta(ev?.name ?? "", updated, ev));
      }
      res.status(201).json(updated);
    },
  );

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
      await syncRoomMetadata(roomName(studio.id), studioMeta(event?.name ?? "", updated, event));
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
      const updated = await storage.updateStudio(studio.id, patch);
      // Viewers read the room's metadata, not the database. Every other studio
      // endpoint pushes after it writes; this one didn't, so an uploaded clip
      // sat in the row while the stage kept showing the idle card.
      if (updated) {
        const ev = await storage.getEventById(studio.eventId);
        await syncRoomMetadata(roomName(studio.id), studioMeta(ev?.name ?? "", updated, ev));
      }
      res.status(201).json(updated);
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
   * Put something in the media library from the studio itself.
   *
   * Everything in here used to arrive from a podcaster's own dashboard, which
   * is right for their intro and useless for a background or a sponsor card
   * the producer wants at 3am. Same two-step upload as the host side: the
   * browser PUTs straight to storage and only tells us where it landed, so a
   * 400MB reel is not trying to squeeze through a request body.
   */
  app.post("/api/admin/media/upload-url", requireAdmin, async (req, res) => {
    const name = String(req.body?.fileName ?? "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
    const key = `studio/${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${name}`;
    try {
      res.json(await signedAssetUpload(key));
    } catch (err) {
      console.error("Could not sign a studio upload:", err);
      res.status(502).json({ message: "Couldn't start the upload. Try again in a moment." });
    }
  });

  app.post("/api/admin/media", requireAdmin, async (req, res) => {
    // Two homes, because they have different ceilings. Supabase holds the
    // small stuff and caps a file at 50MB — a limit the bucket cannot be
    // raised above, since the project's own limit wins and refuses the change.
    // A pre-recorded episode is hundreds of megabytes, so those go to R2, the
    // same bucket the recordings use, and are served through
    // /api/assets/:id/file which signs a URL on the way past.
    const uploadedUrl = String(req.body?.uploadedUrl ?? "").trim();
    const storageKey = String(req.body?.storageKey ?? "").trim();
    if (!uploadedUrl && !storageKey) {
      res.status(400).json({ message: "Need an uploaded file." });
      return;
    }
    if (storageKey && !/^studio\/[A-Za-z0-9._\/-]{1,200}$/.test(storageKey)) {
      res.status(400).json({ message: "That storage key isn't one of ours." });
      return;
    }
    if (uploadedUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/show-assets\//i.test(uploadedUrl)) {
      res.status(400).json({ message: "That upload didn't come from us. Try again." });
      return;
    }
    const fileName = String(req.body?.fileName ?? "").slice(0, 200);
    const label = String(req.body?.label ?? "").trim().slice(0, 120) || fileName.replace(/\.[^.]+$/, "");
    const kind = (ASSET_KINDS as readonly string[]).includes(String(req.body?.kind)) ? String(req.body.kind) : "Other";
    const created = await storage.createAsset({
      email: HOUSE_EMAIL,
      kind,
      label,
      fileUrl: uploadedUrl,
      storageKey,
      linkUrl: "",
      fileName,
      sizeBytes: Number(req.body?.sizeBytes) || 0,
    });
    res.status(201).json(created);
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
  // ---- Saved lower thirds ---------------------------------------------------
  //      The cards a producer re-uses all day. Scenes carry their own name bar
  //      for everything on the run of show; this is for the sponsor read and
  //      the "back in five" that come up nine times and should not be retyped.
  app.get("/api/admin/lower-thirds", requireAdmin, async (req, res) => {
    noStore(res);
    const { studio } = await adminStudio(req);
    res.json(await storage.listLowerThirds(studio.id));
  });

  app.post("/api/admin/lower-thirds", requireAdmin, async (req, res) => {
    const parsed = lowerThirdInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const { studio } = await adminStudio(req);
    res.status(201).json(await storage.createLowerThird({ studioId: studio.id, ...parsed.data }));
  });

  app.patch("/api/admin/lower-thirds/:id", requireAdmin, async (req, res) => {
    const parsed = lowerThirdInputSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const row = await storage.updateLowerThird(Number(req.params.id), parsed.data);
    if (!row) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    res.json(row);
  });

  app.delete("/api/admin/lower-thirds/:id", requireAdmin, async (req, res) => {
    await storage.deleteLowerThird(Number(req.params.id));
    res.json({ ok: true });
  });

  app.get("/api/admin/scenes", requireAdmin, async (req, res) => {
    noStore(res);
    const { studio } = await adminStudio(req);
    res.json(await storage.listScenes(studio.id));
  });

  /**
   * Add a scene. With `capture: true` it snapshots whatever is on the stage
   * right now; otherwise it takes the card as described — a camera scene, a
   * piece of media, or a countdown.
   */
  app.post("/api/admin/scenes", requireAdmin, async (req, res) => {
    const { studio } = await adminStudio(req);
    const existing = await storage.listScenes(studio.id);

    if (req.body?.capture) {
      const name = String(req.body?.name ?? "").trim().slice(0, 60) || "Scene";
      const playing = studio.stageMediaPlaying && Boolean(studio.stageMediaUrl);
      res.status(201).json(
        await storage.createScene({
          studioId: studio.id,
          name,
          kind: playing ? "media" : "camera",
          sortIndex: existing.length,
          mediaUrl: playing ? studio.stageMediaUrl : "",
          mediaKind: studio.stageMediaKind,
          mediaLabel: studio.stageMediaLabel,
        }),
      );
      return;
    }

    const parsed = sceneInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const v = parsed.data;
    if (v.kind === "media" && !v.mediaUrl) {
      res.status(400).json({ message: "A media scene needs a file or a link." });
      return;
    }
    res.status(201).json(
      await storage.createScene({ studioId: studio.id, sortIndex: existing.length, ...v }),
    );
  });

  app.patch("/api/admin/scenes/:id", requireAdmin, async (req, res) => {
    const scene = await storage.getScene(Number(req.params.id));
    if (!scene) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    const parsed = scenePatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    res.json(await storage.updateScene(scene.id, parsed.data));
  });

  /** Drag-and-drop, or the up/down buttons: the rail sends the order it wants. */
  app.post("/api/admin/scenes/reorder", requireAdmin, async (req, res) => {
    const { studio } = await adminStudio(req);
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isFinite);
    res.json(await storage.reorderScenes(studio.id, ids));
  });

  app.delete("/api/admin/scenes/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const scene = await storage.getScene(id);
    await storage.deleteScene(id);
    // Otherwise the studio goes on pointing at a scene that no longer exists,
    // and the rail has nothing to mark as on air.
    if (scene) {
      const studio = await storage.getStudioById(scene.studioId);
      if (studio?.currentSceneId === id) await storage.updateStudio(studio.id, { currentSceneId: 0 });
    }
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
        kind: r.mediaUrl ? "media" : "camera",
        mediaUrl: r.mediaUrl || "",
        mediaKind: r.mediaKind || "video",
        mediaLabel: r.mediaLabel || "",
        // The times come with them. That is what lets the rail stand in for
        // the rundown rather than sit beside it.
        startAtUtc: r.startAtUtc || "",
        runItemId: r.id,
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
      kind: item.mediaUrl ? "media" : "camera",
      mediaUrl: item.mediaUrl || "",
      mediaKind: item.mediaKind || "video",
      mediaLabel: item.mediaLabel || "",
      startAtUtc: item.startAtUtc || "",
      runItemId: item.id,
    });
    res.status(201).json(scene);
  });

  /**
   * The lower third a scene carries, as a studio patch.
   *
   * Taking a scene sets the banner to the scene's, and a scene with no banner
   * takes the banner off. That is the point of binding them: the name bar is
   * part of the look, so it changes when the look does, and a producer never
   * has to remember to pull down the last one. The ad-lib box writes the same
   * two fields directly, and is overwritten by the next take — which is what
   * an ad-lib should be.
   */
  function bannerFor(scene: SceneRow) {
    return {
      bannerTitle: scene.bannerTitle ?? "",
      bannerSubtitle: scene.bannerSubtitle ?? "",
      bannerVisible: Boolean(scene.bannerTitle),
    };
  }

  /**
   * Crew: an admin, someone on the event's team, or an address on the
   * studio_crew_emails setting. Crew get into the green room without a slot
   * and can take scenes from it — the organisers' own eyes-on account, for
   * one — without being handed the whole console.
   */
  async function isCrew(req: Request, eventId: number): Promise<boolean> {
    const adminEmail = getAdminEmail(req);
    if (adminEmail && (await storage.isAdminEmail(adminEmail))) return true;
    const host = (getSessionEmail(req) ?? "").trim().toLowerCase();
    if (!host) return false;
    const listed = ((await storage.getSetting("studio_crew_emails")) ?? "").split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (listed.includes(host)) return true;
    return (await storage.listEventTeam(eventId)).some((m) => m.email.trim().toLowerCase() === host);
  }

  /** One click during the show: put the stage back the way this scene had it. */
  async function applyScene(sceneId: number): Promise<{ status: number; body: unknown }> {
    const scene = await storage.getScene(sceneId);
    if (!scene) return { status: 404, body: { message: "Not found" } };
    const studio = await storage.getStudioById(scene.studioId);
    if (!studio) return { status: 404, body: { message: "Not found" } };
    // A scene with a picture of its own and nothing to roll shows the
    // picture: the producer put it there to be seen, and a card that showed
    // a dog on the rail and nothing on the stage was a promise not kept.
    const mediaUrl = scene.mediaUrl || scene.thumbUrl || "";
    const mediaKind = scene.mediaUrl ? scene.mediaKind : "image";
    // A scene built from an agenda row still does everything taking that row
    // did — the right podcaster on stage, everyone else off. That is what lets
    // the rail replace the rundown instead of sitting beside it.
    if (scene.runItemId) {
      const row = await storage.getRunItem(scene.runItemId);
      if (row) {
        const taken = await takeRunRow(studio, row);
        const who = row.signupId ? await storage.getSignupById(row.signupId) : undefined;
        const withScene = await storage.updateStudio(studio.id, {
          currentSceneId: scene.id,
          stageCardName: who?.hostName ?? "",
          stageCardShow: who?.podcastName?.trim() ?? "",
          stageCardPhoto: who?.photoUrl ?? "",
            currentSceneTakenAtUtc: new Date().toISOString(),
          countdownEndsAtUtc: "",
          countdownLabel: "",
          // A scene carrying a file rolls it, agenda row or not. This branch
          // returns before the patch below, so a pre-recorded segment used to
          // move everybody into place and then sit on the cameras with the
          // episode still in the library.
          stageMediaUrl: mediaUrl,
          stageMediaKind: mediaKind,
          stageMediaLabel: scene.mediaUrl ? scene.mediaLabel : "",
          stageMediaPlaying: Boolean(mediaUrl),
          ...bannerFor(scene),
        });
        if (withScene) {
          const ev = await storage.getEventById(studio.eventId);
          await syncRoomMetadata(roomName(studio.id), studioMeta(ev?.name ?? "", withScene, ev));
        }
        return { status: 200, body: { ...withScene, moved: taken.moved, missing: taken.missing } };
      }
    }

    const patch =
      scene.kind === "countdown"
        ? {
            ...bannerFor(scene),
            stageMediaPlaying: false,
            stageCardName: "",
            stageCardShow: "",
            stageCardPhoto: "",
            currentSceneId: scene.id,
            currentSceneTakenAtUtc: new Date().toISOString(),
            // Stored as the moment it hits zero, so every viewer counts down
            // against their own clock and nothing has to be ticked at them.
            countdownEndsAtUtc: new Date(Date.now() + scene.countdownSeconds * 1000).toISOString(),
            countdownLabel: scene.name,
          }
        : {
            ...bannerFor(scene),
            stageMediaUrl: mediaUrl,
            stageMediaKind: mediaKind,
            stageMediaLabel: scene.mediaUrl ? scene.mediaLabel : "",
            // A scene with no media and no picture is "back to the cameras".
            stageMediaPlaying: Boolean(mediaUrl),
            stageCardName: "",
            stageCardShow: "",
            stageCardPhoto: "",
            currentSceneId: scene.id,
            currentSceneTakenAtUtc: new Date().toISOString(),
            countdownEndsAtUtc: "",
            countdownLabel: "",
          };
    const updated = await storage.updateStudio(studio.id, patch);
    if (updated) {
      const ev = await storage.getEventById(studio.eventId);
      await syncRoomMetadata(roomName(studio.id), studioMeta(ev?.name ?? "", updated, ev));
    }
    return { status: 200, body: updated };
  }

  app.post("/api/admin/scenes/:id/apply", requireAdmin, async (req, res) => {
    const r = await applyScene(Number(req.params.id));
    res.status(r.status).json(r.body);
  });

  /** Crew in the green room take scenes with the same call, checked against the crew list. */
  app.post("/api/host/scenes/:id/apply", requireHostSession, async (req, res) => {
    const scene = await storage.getScene(Number(req.params.id));
    const studio = scene ? await storage.getStudioById(scene.studioId) : null;
    if (!scene || !studio) return res.status(404).json({ message: "Not found" });
    if (!(await isCrew(req, studio.eventId))) return res.status(403).json({ message: "Only the crew can take scenes." });
    const r = await applyScene(scene.id);
    res.status(r.status).json(r.body);
  });

  /** Stop a running countdown early — the clock comes off, the stage stays. */
  app.post("/api/admin/studio/countdown/clear", requireAdmin, async (req, res) => {
    const { studio } = await adminStudio(req);
    const updated = await storage.updateStudio(studio.id, { countdownEndsAtUtc: "", countdownLabel: "" });
    if (updated) {
      const ev = await storage.getEventById(studio.eventId);
      await syncRoomMetadata(roomName(studio.id), studioMeta(ev?.name ?? "", updated, ev));
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
      await syncRoomMetadata(roomName(studio.id), studioMeta(ev?.name ?? "", updated, ev));
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
      await syncRoomMetadata(roomName(studio.id), studioMeta(ev?.name ?? "", updated, ev));
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
      // Whatever was on the stage stops with the broadcast.
      //
      // A countdown counts against the viewer's own clock from a timestamp in
      // the room metadata, so ending the stream left it running — the show was
      // over and the watch page was still ticking towards a break that was
      // never coming. Same for a clip playing out. The scene itself is kept,
      // so the rail is where the producer left it when they come back.
      const off = await storage.updateStudio(studio.id, {
        broadcastEgressId: "",
        status: "Offline",
        countdownEndsAtUtc: "",
        countdownLabel: "",
        stageMediaPlaying: false,
      });
      const ev0 = await storage.getEventById(eventId);
      if (off) await syncRoomMetadata(roomName(studio.id), studioMeta(ev0?.name ?? "", off, ev0));
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
    if (updated) await syncRoomMetadata(roomName(studio.id), studioMeta(ev?.name ?? "", updated, ev));
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
  function studioMeta(
    eventName: string,
    st: StudioRow,
    ev?: { startAtUtc: string; durationHours: number } | null,
  ) {
    const startMs = ev?.startAtUtc ? Date.parse(ev.startAtUtc) : NaN;
    return {
      eventName,
      // The stage and its graphics come from one place, shared with the
      // console's own monitor — see shared/stageMeta.ts for why.
      ...stageMetaFromStudio(st),
      // The event's own window travels with the metadata so the page can be
      // honest about the clock without another request: which standby to play,
      // and whether "Live" is even possible yet.
      eventStartAtUtc: ev?.startAtUtc ?? "",
      eventEndAtUtc: Number.isFinite(startMs)
        ? new Date(startMs + (ev?.durationHours ?? 24) * 3600000).toISOString()
        : "",
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

  // ---- Audience figures --------------------------------------------------------
  //      What the connected accounts reach, for the sponsorship pages. Pulled
  //      only when somebody asks — every successful result costs a credit.

  /** Every connected account we could enrich, from the Upload-Post snapshot. */
  /**
   * Every handle we could enrich, connected or not.
   *
   * Upload-Post only knows about the five podcasters who went through its
   * connect flow. The other thirteen pasted a profile link at signup, and
   * those links carry a real platform and a real handle — which is exactly
   * what influencers.club takes. `source` says which is which, because a
   * derived handle is a guess from a typed URL and a connected one is not.
   */
  async function connectedHandles(): Promise<
    { email: string; platform: string; handle: string; consented: boolean; source: "connected" | "link" }[]
  > {
    const profiles = await storage.listCompleteProfiles();
    const signups = await storage.listSignups((await storage.getFeaturedEvent()).id);
    const linksByEmail = new Map<string, { socialLinks: string; youtubeUrl: string }>();
    for (const sg of signups) {
      if (sg.status === "cancelled") continue;
      linksByEmail.set(sg.email.trim().toLowerCase(), {
        socialLinks: sg.socialLinks ?? "",
        youtubeUrl: sg.youtubeUrl ?? "",
      });
    }

    const out: { email: string; platform: string; handle: string; consented: boolean; source: "connected" | "link" }[] = [];
    for (const p of profiles) {
      const connected = parseSocialAccounts(p.socialAccounts);
      const seen = new Set<string>();
      for (const a of connected) {
        const handle = String((a as { username?: string }).username ?? "").trim();
        // Facebook hands back a numeric page id, which is not a handle and
        // enriches to nothing. Skip rather than spend a credit finding out.
        if (!handle || /^\d+$/.test(handle)) continue;
        seen.add(String(a.platform));
        out.push({ email: p.email, platform: String(a.platform), handle, consented: p.shareAudienceStats, source: "connected" });
      }

      const typed = linksByEmail.get(p.email.trim().toLowerCase())
        ?? { socialLinks: p.socialLinks ?? "", youtubeUrl: p.youtubeUrl ?? "" };
      for (const a of deriveSocialAccounts([], typed.socialLinks, typed.youtubeUrl)) {
        if (seen.has(a.platform) || !a.username || /^\d+$/.test(a.username)) continue;
        seen.add(a.platform);
        out.push({ email: p.email, platform: a.platform, handle: a.username, consented: p.shareAudienceStats, source: "link" });
      }
    }
    return out;
  }

  app.get("/api/admin/audience", requireAdmin, async (_req, res) => {
    noStore(res);
    const rows = await storage.listSocialMetrics();
    let balance: unknown = null;
    if (isInfluencersConfigured()) balance = await credits().catch((e) => ({ error: (e as Error).message }));
    res.json({
      configured: isInfluencersConfigured(),
      handles: await connectedHandles(),
      metrics: rows.map((r) => ({ ...r, raw: r.raw ? "stored" : "" })),
      credits: balance,
    });
  });

  /**
   * Read the figures. `handle` does one account — spend a single credit and
   * look at the shape before committing to the rest.
   */
  app.post("/api/admin/audience/refresh", requireAdmin, async (req, res) => {
    if (!isInfluencersConfigured()) {
      res.status(503).json({ message: "No influencers.club key on this deployment." });
      return;
    }
    const only = String(req.body?.handle ?? "").trim().toLowerCase();
    const all = await connectedHandles();
    // Already answered for, unless this is a deliberate single-handle retry.
    const held = new Set(
      (await storage.listSocialMetrics())
        .filter((m) => !m.error && m.followers > 0)
        .map((m) => `${m.email.toLowerCase()}|${m.platform}`),
    );
    const wanted = all.filter((h) =>
      only ? h.handle.toLowerCase() === only : !held.has(`${h.email.toLowerCase()}|${h.platform}`),
    );
    if (wanted.length === 0) {
      res.status(400).json({ message: only ? "No connected account with that handle." : "No connected accounts to read." });
      return;
    }

    const now = new Date().toISOString();
    const done: { handle: string; platform: string; followers: number; error: string }[] = [];
    for (const h of wanted) {
      try {
        const m = await enrichHandle(h.platform, h.handle);
        // One request answers for every network they could match this creator
        // to, and we have already paid for all of it — so all of it is stored,
        // not just the platform whose handle we happened to have.
        const rows = m.platforms.length
          ? m.platforms
          : [{ platform: h.platform, handle: h.handle, followers: m.followers, engagementRate: m.engagementRate, avgViews: m.avgViews, avgLikes: m.avgLikes, credibility: m.credibility, audience: m.audience, raw: m.raw }];
        for (const r of rows) {
          await storage.upsertSocialMetric({
            email: h.email,
            platform: r.platform,
            handle: r.handle || h.handle,
            followers: r.followers,
            engagementRate: r.engagementRate,
            avgViews: r.avgViews,
            avgLikes: r.avgLikes,
            credibility: r.credibility,
            audience: r.audience ? JSON.stringify(r.audience).slice(0, 20000) : "",
            // Kept so the readers can be corrected without spending again.
            raw: JSON.stringify(r.raw).slice(0, 60000),
            error: "",
            fetchedAt: now,
          });
        }
        done.push({ handle: h.handle, platform: rows.map((r) => `${r.platform}:${r.followers}`).join(" "), followers: m.followers, error: "" });
      } catch (err) {
        const message = (err as Error).message.slice(0, 400);
        await storage.upsertSocialMetric({
          email: h.email, platform: h.platform, handle: h.handle,
          followers: 0, engagementRate: "", avgViews: 0, avgLikes: 0, credibility: "",
          audience: "", raw: "", error: message, fetchedAt: now,
        });
        done.push({ handle: h.handle, platform: h.platform, followers: 0, error: message });
      }
    }
    res.json({ read: done.length, results: done });
  });

  /** One stored response in full, to learn the provider's real field names. */
  app.get("/api/admin/audience/raw/:id", requireAdmin, async (req, res) => {
    noStore(res);
    const row = (await storage.listSocialMetrics()).find((r) => r.id === Number(req.params.id));
    if (!row) {
      res.status(404).json({ message: "No such row." });
      return;
    }
    res.type("application/json").send(row.raw || "{}");
  });

  /**
   * The public figure for the sponsorship pages.
   *
   * Only podcasters who opted in are counted, and the shape says plainly that
   * a combined following is not deduplicated reach — a sponsor's marketing
   * team discounts a sum, and rightly.
   */
  app.get("/api/audience-summary", async (_req, res) => {
    publicCache(res, 300);
    const rows = (await storage.listSocialMetrics()).filter((r) => !r.error && r.followers > 0);
    const profiles = await storage.listCompleteProfiles();
    const consenting = new Set(profiles.filter((p) => p.shareAudienceStats).map((p) => p.email));
    const counted = rows.filter((r) => consenting.has(r.email));
    const byPlatform: Record<string, number> = {};
    for (const r of counted) byPlatform[r.platform] = (byPlatform[r.platform] ?? 0) + r.followers;
    const dates = counted.map((r) => r.fetchedAt).filter(Boolean).sort();
    res.json({
      shows: new Set(counted.map((r) => r.email)).size,
      accounts: counted.length,
      combinedFollowing: counted.reduce((n, r) => n + r.followers, 0),
      byPlatform,
      /** Said out loud so the page can't imply otherwise. */
      deduplicated: false,
      asOf: dates[dates.length - 1] ?? "",
    });
  });

  // ---- The studio agent ----------------------------------------------------------
  //      A long-lived worker that lives outside this function: it joins rooms
  //      to caption them, and cuts clips out of each recording once the
  //      recorder is done. It authenticates with one shared token, held only
  //      by that worker — never in a browser, so these routes are not part of
  //      the admin surface and never touch an admin session.
  function agentToken(): string {
    return (process.env.AGENT_TOKEN || "").trim();
  }

  function requireAgent(req: Request, res: Response, next: NextFunction) {
    const want = agentToken();
    if (!want) {
      res.status(503).json({ message: "No agent token configured on this deployment." });
      return;
    }
    const got = (req.header("x-agent-token") || "").trim();
    // Both sides are already secrets of the same length in practice; compare
    // in constant time anyway so a mismatch leaks nothing about the prefix.
    const a = Buffer.from(got);
    const b = Buffer.from(want);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.status(401).json({ message: "Bad agent token." });
      return;
    }
    next();
  }

  /** Captions as they happen. The agent batches, so one call carries many lines. */
  app.post("/api/agent/transcript", requireAgent, async (req, res) => {
    const parsed = transcriptBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const studio = await storage.getStudioById(parsed.data.studioId);
    if (!studio) {
      res.status(404).json({ message: "No such studio." });
      return;
    }
    const written = await storage.appendTranscript(studio.id, studio.eventId, parsed.data.lines);
    res.json({ written });
  });

  /**
   * Take the next recording that needs clipping.
   *
   * Everything the worker needs comes back in one response — a link to the
   * file and the transcript we already captured live — so it never needs
   * database or storage credentials of its own.
   */
  app.post("/api/agent/clip-jobs/claim", requireAgent, async (_req, res) => {
    const rec = await storage.claimClipJob();
    if (!rec) {
      res.json({ job: null });
      return;
    }
    let downloadUrl = "";
    try {
      // Normally a storage path that gets signed. An absolute URL is passed
      // straight through, which is what lets a clip job be pointed at a file
      // that never came from an egress — an old episode, or a test run before
      // anybody has actually been on air.
      downloadUrl = !rec.url
        ? ""
        : /^https?:\/\//i.test(rec.url)
          ? rec.url
          : await signedRecordingUrl(rec.url, 7200);
    } catch (err) {
      console.error("Couldn't sign a recording for the clipper:", err);
    }
    if (!downloadUrl) {
      await storage.setClipStatus(rec.id, "failed", "The recording couldn't be signed for download.");
      res.json({ job: null });
      return;
    }

    // The transcript is already ours: the captioning agent wrote it while the
    // segment was going out. Offsets are relative to the start of the file, so
    // the worker can cut straight from them.
    const startMs = Date.parse(rec.startedAt);
    const endMs = rec.endedAt ? Date.parse(rec.endedAt) : startMs + rec.durationSec * 1000;
    const lines = Number.isFinite(startMs)
      ? (await storage.transcriptBetween(rec.studioId, startMs, endMs)).map((l) => ({
          speaker: l.speaker,
          text: l.text,
          startSec: Math.max(0, (Number(l.startMs) - startMs) / 1000),
          endSec: Math.max(0, (Number(l.endMs) - startMs) / 1000),
        }))
      : [];

    const signup = rec.signupId ? await storage.getSignupById(rec.signupId) : undefined;
    res.json({
      job: {
        recordingId: rec.id,
        title: rec.title,
        durationSec: rec.durationSec,
        downloadUrl,
        show: signup?.podcastName ?? rec.title,
        host: signup?.hostName ?? "",
        transcript: lines,
      },
    });
  });

  /**
   * A URL the worker PUTs a finished clip straight to.
   *
   * Clips used to be POSTed through this function, which caps request bodies
   * at 4.5MB. A 72-second vertical with a stacked layout and burned-in
   * captions is bigger than that, so the whole job — download, transcribe,
   * pick, nine renders — completed and then threw the work away on the last
   * step with FUNCTION_PAYLOAD_TOO_LARGE.
   *
   * The worker still holds only its token: it asks for a signed URL and the
   * bytes go to storage without passing through us.
   */
  app.post("/api/agent/clip-files/upload-url", requireAgent, async (req, res) => {
    const safe = String(req.body?.name ?? "clip.mp4").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-90);
    const key = `clips/${Date.now()}-${crypto.randomBytes(5).toString("hex")}-${safe}`;
    try {
      res.json(await signedAssetUpload(key));
    } catch (err) {
      console.error("Could not sign a clip upload:", err);
      res.status(502).json({ message: "Couldn't start the upload." });
    }
  });

  /** One rendered clip, uploaded straight into the asset bucket. */
  app.post(
    "/api/agent/clip-files",
    requireAgent,
    (req, res, next) => {
      assetUpload.single("file")(req, res, (err: any) => {
        if (err) {
          res.status(400).json({ message: err.message || "Couldn't accept that file." });
          return;
        }
        next();
      });
    },
    async (req, res) => {
      if (!req.file) {
        res.status(400).json({ message: "Attach a file." });
        return;
      }
      const safe = String(req.body?.name ?? req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_").slice(-90);
      const key = `clips/${Date.now()}-${crypto.randomBytes(5).toString("hex")}-${safe}`;
      try {
        const url = await uploadShowAsset(key, req.file.buffer, req.file.mimetype || "video/mp4");
        res.status(201).json({ url });
      } catch (err) {
        console.error("Clip upload failed:", err);
        res.status(502).json({ message: "Upload failed." });
      }
    },
  );

  /** The worker is done: here are the clips, in order. */
  app.post("/api/agent/clip-jobs/:id/done", requireAgent, async (req, res) => {
    const rec = await storage.getRecording(Number(req.params.id));
    if (!rec) {
      res.status(404).json({ message: "No such recording." });
      return;
    }
    const parsed = z.array(clipResultSchema).max(20).safeParse(req.body?.clips ?? []);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    const rows = parsed.data
      .filter((c) => c.endSec > c.startSec)
      .map((c) => ({
        eventId: rec.eventId,
        signupId: rec.signupId ?? null,
        email: rec.email,
        title: c.title,
        caption: c.caption,
        reason: c.reason,
        startSec: c.startSec,
        endSec: c.endSec,
        transcript: c.transcript,
        url: c.url,
        verticalUrl: c.verticalUrl,
        squareUrl: c.squareUrl,
        subtitlesUrl: c.subtitlesUrl,
      }));
    const saved = await storage.replaceClips(rec.id, rows);
    await storage.setClipStatus(rec.id, "done", "");
    res.json({ saved: saved.length });
  });

  app.post("/api/agent/clip-jobs/:id/failed", requireAgent, async (req, res) => {
    const rec = await storage.getRecording(Number(req.params.id));
    if (!rec) {
      res.status(404).json({ message: "No such recording." });
      return;
    }
    // A worker that is being shut down hands the job back rather than failing
    // it. Ctrl-C used to leave the recording marked running with nobody on it,
    // and the only way back was the stale-claim timeout — so stopping the
    // worker to change something cost an hour before it could try again.
    if (req.body?.requeue) {
      await storage.setClipStatus(rec.id, "queued", "");
      res.json({ ok: true, requeued: true });
      return;
    }
    await storage.setClipStatus(rec.id, "failed", String(req.body?.error ?? "").slice(0, 500));
    res.json({ ok: true });
  });

  /** A podcaster's own clips, newest first. */
  app.get("/api/host/clips", requireHostSession, async (req, res) => {
    noStore(res);
    const email = (req as any).hostEmail as string;
    res.json(await storage.listClipsByEmail(email));
  });

  app.get("/api/admin/recordings/:id/clips", requireAdmin, async (req, res) => {
    noStore(res);
    res.json(await storage.listClips(Number(req.params.id)));
  });

  /** Re-run the clipper on a recording — after a failure, or for a second opinion. */
  /**
   * Every recording with its clips, in one call.
   *
   * There was no way to see a clip in the admin at all — the per-recording
   * endpoint existed and nothing rendered it, so checking what the clipper
   * produced meant calling the API by hand. On the day that is forty-eight
   * segments finishing with nobody able to tell a good pick from a bad one.
   */
  app.get("/api/admin/clips", requireAdmin, async (req, res) => {
    noStore(res);
    const featured = await storage.getFeaturedEvent();
    const eventId = Number(req.query.eventId) || featured.id;
    const recordings = (await storage.listRecordings(eventId)).filter(
      (r) => r.clipStatus !== "none" || r.status === "Ready",
    );
    const withClips = await Promise.all(
      recordings.map(async (r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        durationSec: r.durationSec,
        sizeBytes: r.sizeBytes,
        startedAt: r.startedAt,
        signupId: r.signupId,
        email: r.email,
        clipStatus: r.clipStatus,
        clipError: r.clipError,
        clipClaimedAt: r.clipClaimedAt,
        clips: await storage.listClips(r.id),
      })),
    );
    res.json(withClips);
  });

  app.post("/api/admin/recordings/:id/reclip", requireAdmin, async (req, res) => {
    const rec = await storage.getRecording(Number(req.params.id));
    if (!rec || rec.status !== "Ready") {
      res.status(404).json({ message: "That recording isn't finished." });
      return;
    }
    await storage.setClipStatus(rec.id, "queued", "");
    res.json({ ok: true });
  });

  /** Forwarded mail is somebody else's text going into an HTML email of ours. */
  const esc = (v: string) =>
    v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // ---- Resend inbound ------------------------------------------------------------
  //      Mail to hello@ is received by Resend, which POSTs a metadata-only
  //      event and keeps the body behind an API call. Nothing read those, so
  //      every reply a podcaster sent went into Resend and stopped there —
  //      including the ones our own emails asked for ("reply with the episode
  //      name", "reply with your handles").
  //
  //      This forwards them to a person. Reply-to is set to whoever wrote in,
  //      so hitting reply in the forwarded copy goes back to them and not to
  //      ourselves, which is the whole point of a forward.
  /**
   * Which domains this app is allowed to forward mail for.
   *
   * A list rather than a single name because the event carries whatever the
   * sender typed — several recipients, display names, capitals — and because
   * one Resend account serves more than one of these projects.
   */
  const OUR_DOMAINS = (process.env.INBOUND_DOMAINS || "militaryvoice.ai,militaryvoice.io")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  function addressedToUs(to: string): boolean {
    const addresses = String(to ?? "")
      .split(/[,;]/)
      .map((part) => {
        // "Name <a@b.com>" and a bare "a@b.com" both have to work.
        const m = part.match(/<([^>]+)>/);
        return (m ? m[1] : part).trim().toLowerCase();
      })
      .filter((a) => a.includes("@"));
    // A subdomain counts: mail to anything.militaryvoice.ai is still ours.
    // So does the account's own Resend receiving address (<id>.resend.app):
    // once the domain's mail moved to Google, hello@ reaches us by being
    // forwarded there, and a forward can carry that address as the To.
    return addresses.some((a) => {
      const domain = a.slice(a.lastIndexOf("@") + 1);
      return domain.endsWith(".resend.app") || OUR_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
    });
  }

  app.post("/api/webhooks/resend-inbound", async (req, res) => {
    // Its own secret. Svix issues one per endpoint, so the variable the
    // tracking webhook uses will not verify this one.
    const secret = process.env.RESEND_INBOUND_SECRET ?? "";
    const id = req.get("svix-id") ?? "";
    const ts = req.get("svix-timestamp") ?? "";
    const sigHeader = req.get("svix-signature") ?? "";
    const raw = (req as any).rawBody as Buffer | undefined;

    if (!secret || !id || !ts || !sigHeader || !raw) {
      res.status(401).json({ message: "Unsigned." });
      return;
    }
    // Five minutes, so a captured POST cannot be replayed at us tomorrow.
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
      res.status(401).json({ message: "Stale." });
      return;
    }
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${raw.toString("utf8")}`).digest("base64");
    // Header is a space-separated list of "v1,<sig>" — more than one while a
    // secret is being rotated.
    const offered = sigHeader.split(" ").map((p) => p.split(",")[1]).filter(Boolean);
    const ok = offered.some((sig) => {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });
    if (!ok) {
      res.status(401).json({ message: "Bad signature." });
      return;
    }

    // Acknowledge before doing any work: Resend retries, and a retry storm on
    // a bug of ours is worse than one missed forward. The work is handed to
    // waitUntil so Vercel does not freeze the function the moment it answers.
    res.json({ ok: true });

    const work = (async () => {
    try {
      const evt = JSON.parse(raw.toString("utf8")) as any;
      if (evt?.type !== "email.received") return;
      const d = evt.data ?? {};
      const emailId = d.email_id ?? d.id ?? "";
      const from = Array.isArray(d.from) ? d.from.join(", ") : String(d.from ?? "unknown");
      const to = Array.isArray(d.to) ? d.to.join(", ") : String(d.to ?? "");
      const subject = String(d.subject ?? "(no subject)");

      // The body lives behind a second call. If that shape ever changes we
      // still forward what the event carried, because a forward with only a
      // subject line beats silence.
      let body = "";
      // The sender's own HTML, when that is all they sent. Wrapping it in
      // <pre> and escaping it — what happened before — forwarded a wall of
      // markup; a reply from a podcaster's mail client usually has no text
      // part at all.
      let bodyHtml = "";
      let messageId = "";
      if (emailId && process.env.RESEND_API_KEY) {
        try {
          const r = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
          });
          if (r.ok) {
            const full = (await r.json()) as any;
            messageId = String(full.message_id ?? full.headers?.["message-id"] ?? full.headers?.["Message-ID"] ?? "");
            bodyHtml = String(full.html ?? "");
            body = String(full.text ?? "") || bodyHtml
              .replace(/<style[\s\S]*?<\/style>/gi, "")
              .replace(/<br\s*\/?>/gi, "\n")
              .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
              .replace(/<[^>]+>/g, "")
              .replace(/&nbsp;/g, " ")
              .replace(/\n{3,}/g, "\n\n")
              .trim();
          } else {
            body = `(Couldn't fetch the body: HTTP ${r.status}. Open it in Resend — id ${emailId}.)`;
          }
        } catch (err) {
          body = `(Couldn't fetch the body. Open it in Resend — id ${emailId}.)`;
        }
      }

      // Only mail that was actually addressed to us.
      //
      // Resend raises email.received for the whole account, not per domain, so
      // this endpoint was handed every inbound message the account took —
      // including another project's load board at loads@inbound.smartloads.io
      // — and forwarded all of it. The webhook is not wrong to receive them;
      // it was wrong to assume anything that arrived was ours.
      if (!addressedToUs(to)) {
        console.log(`Inbound mail for ${to} is not ours — not forwarding.`);
        return;
      }

      const header = `From: ${from}\nTo: ${to}\nSubject: ${subject}\n\n`;
      await sendOneOffEmail({
        to: process.env.FORWARD_INBOX || "andrew@podlogix.co",
        subject: `Fwd: ${subject}`,
        text: header + body,
        html:
          `<p style="color:#555;font-size:13px">From: ${esc(from)}<br>To: ${esc(to)}<br>Subject: ${esc(subject)}</p><hr>` +
          // Scripts stripped; everything else is theirs to render as sent.
          (bodyHtml
            ? bodyHtml.replace(/<script[\s\S]*?<\/script>/gi, "")
            : `<pre style="white-space:pre-wrap;font-family:inherit">${esc(body)}</pre>`),
        replyTo: Array.isArray(d.from) ? d.from[0] : String(d.from ?? ""),
      });
      console.log(`Forwarded inbound mail from ${from}: ${subject}`);

      // Filed, then drafted. The forward above is the safety net; this is
      // what puts the reply in the activity log with an answer ready.
      try {
        if (await storage.findInboundByResendId(String(emailId))) return;
        const fromRaw = Array.isArray(d.from) ? String(d.from[0] ?? "") : String(d.from ?? "");
        const fm = fromRaw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
        const fromEmail = (fm ? fm[2] : fromRaw).trim().toLowerCase();
        const fromName = (fm ? fm[1] : "").trim();
        const row = await storage.createInbound({
          resendId: String(emailId),
          messageId,
          fromEmail,
          fromName,
          toAddr: to,
          subject,
          bodyText: body,
          receivedAt: String(d.created_at ?? new Date().toISOString()),
          broadcastId: await matchBroadcast(subject),
          category: "",
          summary: "",
          draftFrom: "team",
          draftSubject: "",
          draftText: "",
          status: "new",
          repliedAt: null,
          replyResendId: "",
          replyFrom: "",
          replyText: "",
          ackAt: null,
          ackResendId: "",
          ackText: "",
        });
        await draftLater(row.id, { ack: true });
      } catch (err) {
        console.error("Inbound filing failed:", err);
      }
    } catch (err) {
      console.error("Inbound forward failed:", err);
    }
    })();
    try { waitUntil(work); } catch { /* not on Vercel */ }
  });

  /**
   * Draft after the response has gone. On Vercel a function is frozen once it
   * answers, so anything left running is lost — the first filed reply sat at
   * "new" with no draft for that reason. waitUntil keeps the function alive
   * for the promise; off Vercel it just runs.
   */
  function draftLater(rowId: number, opts: { ack?: boolean } = {}) {
    const job = (async () => {
      const row = await storage.getInbound(rowId);
      if (!row) return;
      let draft;
      try {
        draft = await draftReply(row);
        await storage.updateInbound(row.id, { category: draft.category, summary: draft.summary, draftFrom: draft.from, draftSubject: draft.subject, draftText: draft.reply, status: "drafted" });
      } catch (err) {
        console.error("Inbound draft failed:", err);
      }
      if (!opts.ack) return;
      // The automatic acknowledgement: every podcaster or sponsor who writes
      // in hears back at once — thanks, the answer when we have one, and a
      // person if that did not cover it. Never to a machine, never twice in a
      // day to the same thread, and never to a mail filed by hand.
      try {
        if (looksAutomatic(row) || !(await isKnownSender(row.fromEmail))) return;
        // Once per conversation, not once per day: three questions in an
        // afternoon are three answers, but a second mail in the same thread
        // an hour later is someone adding a line, not asking again.
        const thread = (v: string) => v.replace(/^\s*((re|fwd?|aw)\s*:\s*)+/i, "").trim().toLowerCase();
        const recent = (await storage.listInboundByEmail(row.fromEmail)).some(
          (r) => r.id !== row.id && r.ackAt && Date.now() - Date.parse(r.ackAt) < 24 * 3600_000 && thread(r.subject) === thread(row.subject),
        );
        if (recent) return;
        const { subject, text, html: body } = composeAck(row, draft?.ack ?? "", await firstNameFor(row));
        const html = emailShell({ banner: EMAIL_BANNERS.podcasters, eyebrow: "The Podcast Marathon · 5 October", heading: "We got your email", body });
        const headers: Record<string, string> = {};
        if (row.messageId) { headers["In-Reply-To"] = row.messageId; headers["References"] = row.messageId; }
        const id = await sendOneOffEmail({ to: row.fromEmail, subject, html, text, headers });
        if (!id) return;
        const now = new Date().toISOString();
        await storage.updateInbound(row.id, { ackAt: now, ackResendId: id, ackText: text });
        const featured = await storage.getFeaturedEvent();
        await storage.recordOneOffSend({ eventId: featured?.id ?? null, subject, bodyText: text, sender: "team", banner: "podcasters", email: row.fromEmail, resendId: id });
        console.log(`Auto-acknowledged ${row.fromEmail}: ${subject}`);
      } catch (err) {
        console.error("Inbound ack failed:", err);
      }
    })();
    try { waitUntil(job); } catch { /* not on Vercel */ }
    return job;
  }

  /** Who on the lineup has connected what — for the overview tiles. */
  app.get("/api/admin/connections", requireAdmin, async (req, res) => {
    noStore(res);
    const featured = await storage.getFeaturedEvent();
    const eventId = Number(req.query.eventId) || featured.id;
    const ev = (await storage.getEventById(eventId)) ?? featured;
    const dayLength = Math.floor((ev.durationHours * 60) / ev.slotMinutes);
    const lineup = new Set(
      (await storage.listSignups(eventId)).filter((x) => x.status !== "cancelled" && x.slotIndex < dayLength).map((x) => x.email.trim().toLowerCase()),
    );
    const youtube = new Set((await storage.listYoutubeAccounts()).map((a) => a.email.trim().toLowerCase()));
    const social = new Set(
      (await storage.listAllProfiles())
        .filter((p) => p.socialAccounts && p.socialAccounts.trim() !== "" && p.socialAccounts.trim() !== "[]")
        .map((p) => p.email.trim().toLowerCase()),
    );
    res.json({
      lineup: lineup.size,
      youtube: Array.from(lineup).filter((e) => youtube.has(e)).length,
      social: Array.from(lineup).filter((e) => social.has(e)).length,
    });
  });

  // ---- Inbox: replies that came in, with a draft answer each ----------------
  app.get("/api/admin/inbound", requireAdmin, async (_req, res) => {
    noStore(res);
    res.json((await storage.listInbound()).map((r) => ({ ...r, saidText: stripQuoted(r.bodyText) })));
  });

  /** File a reply by hand — one that arrived before the inbox existed. */
  app.post("/api/admin/inbound", requireAdmin, async (req, res) => {
    const fromEmail = String(req.body?.fromEmail ?? "").trim().toLowerCase();
    const subject = String(req.body?.subject ?? "").trim();
    const bodyText = String(req.body?.bodyText ?? "").trim();
    if (!fromEmail.includes("@") || !bodyText) return res.status(400).json({ message: "Need a sender and the text." });
    const row = await storage.createInbound({
      resendId: "", messageId: "", fromEmail, fromName: String(req.body?.fromName ?? "").trim(), toAddr: "hello@militaryvoice.ai",
      subject, bodyText, receivedAt: String(req.body?.receivedAt ?? new Date().toISOString()), broadcastId: await matchBroadcast(subject),
      category: "", summary: "", draftFrom: "team", draftSubject: "", draftText: "", status: "new", repliedAt: null, replyResendId: "", replyFrom: "", replyText: "",
      ackAt: null, ackResendId: "", ackText: "",
    });
    res.json(row);
    draftLater(row.id);
  });

  app.post("/api/admin/inbound/:id/redraft", requireAdmin, async (req, res) => {
    const row = await storage.getInbound(Number(req.params.id));
    if (!row) return res.status(404).json({ message: "No such reply." });
    try {
      const draft = await draftReply(row);
      await storage.updateInbound(row.id, { category: draft.category, summary: draft.summary, draftFrom: draft.from, draftSubject: draft.subject, draftText: draft.reply, status: row.status === "new" ? "drafted" : row.status });
      res.json(await storage.getInbound(row.id));
    } catch (err) {
      res.status(502).json({ message: (err as Error).message });
    }
  });

  app.post("/api/admin/inbound/:id/ignore", requireAdmin, async (req, res) => {
    const row = await storage.getInbound(Number(req.params.id));
    if (!row) return res.status(404).json({ message: "No such reply." });
    await storage.updateInbound(row.id, { status: row.status === "ignored" ? "drafted" : "ignored" });
    res.json(await storage.getInbound(row.id));
  });

  /**
   * Send the answer. From Riccoh or from the team, as the person chose;
   * threaded under their message; filed as a one-off send so it shows in the
   * activity log and in the contact's history like everything else we send.
   */
  app.post("/api/admin/inbound/:id/reply", requireAdmin, async (req, res) => {
    const row = await storage.getInbound(Number(req.params.id));
    if (!row) return res.status(404).json({ message: "No such reply." });
    const text = String(req.body?.text ?? "").trim();
    const from = req.body?.from === "riccoh" ? "riccoh" : "team";
    const subject = String(req.body?.subject ?? row.draftSubject ?? "").trim() || (row.subject.startsWith("Re:") ? row.subject : `Re: ${row.subject}`);
    if (!text) return res.status(400).json({ message: "Nothing to send." });
    const paragraphs = text.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("\n");
    const html = emailShell({ banner: EMAIL_BANNERS.podcasters, eyebrow: "The Podcast Marathon · 5 October", heading: subject.replace(/^re:\s*/i, ""), body: paragraphs });
    const headers: Record<string, string> = {};
    if (row.messageId) { headers["In-Reply-To"] = row.messageId; headers["References"] = row.messageId; }
    const id = await sendOneOffEmail({ to: row.fromEmail, subject, html, text, headers });
    if (!id) return res.status(502).json({ message: "The mail provider didn't accept it." });
    const now = new Date().toISOString();
    await storage.updateInbound(row.id, { status: "sent", repliedAt: now, replyResendId: id, replyFrom: from, replyText: text });
    try {
      const featured = await storage.getFeaturedEvent();
      await storage.recordOneOffSend({ eventId: featured?.id ?? null, subject, bodyText: text, sender: from === "riccoh" ? "member:1" : "team", banner: "podcasters", email: row.fromEmail, resendId: id });
    } catch (err) {
      console.error("Reply sent but not logged:", err);
    }
    res.json(await storage.getInbound(row.id));
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
      const finished = await storage.finishRecording(info.egressId, {
        status: ok ? "Ready" : "Failed",
        url: ok && file?.filename ? String(file.filename) : "",
        // LiveKit reports duration in nanoseconds.
        durationSec: file?.duration ? Math.round(Number(file.duration) / 1_000_000_000) : 0,
        sizeBytes: file?.size ? String(file.size) : "0",
        error: ok ? "" : String(info.error ?? "The recorder stopped without saving."),
      });
      // A finished segment is a clip job. Queued rather than done here: the
      // work needs ffmpeg and minutes, neither of which a serverless function
      // has, so the worker picks it up.
      if (ok && finished?.id && agentToken()) {
        await storage.setClipStatus(finished.id, "queued", "");
      }
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

  // --------------------------------------------------------- audience reach
  // What the lineup's own channels reach, for the sponsor pages. Public reads
  // a stored snapshot; only an admin pays for the upstream calls that make one.
  app.get("/api/audience/summary", async (_req, res) => {
    const snap = await readAudienceSnapshot();
    if (!snap) {
      noStore(res);
      res.json(null);
      return;
    }
    publicCache(res, 600);
    res.json(snap);
  });

  // "reach", not "audience": /api/admin/audience was already taken by the
  // influencers.club panel further up this file, and Express answers with the
  // first route that matches. Registering these second meant the sponsor-page
  // Refresh button was quietly calling influencers.club and spending a credit
  // per handle, while its GET returned a shape the panel could not read.
  app.post("/api/admin/reach/refresh", requireAdmin, async (req, res) => {
    try {
      const eventId = Number(req.body?.eventId) || (await storage.getFeaturedEvent())?.id;
      const snap = await buildAudienceSnapshot(eventId);
      await saveAudienceSnapshot(snap);
      res.json(snap);
    } catch (err) {
      res.status(502).json({ message: (err as Error).message });
    }
  });

  /**
   * Whether the rendered standby clip still matches the lineup.
   *
   * The poster and the watch-page listing rebuild themselves from the
   * database; the clip is a file, so it cannot. Nothing else in the product
   * would tell you it had gone stale — you would find out by watching your own
   * pre-show and counting faces.
   */
  app.get("/api/admin/standby-build", requireAdmin, async (req, res) => {
    noStore(res);
    const eventId = Number(req.query.eventId) || (await storage.getFeaturedEvent())?.id;
    const lineup = eventId
      ? (await storage.listSignups(eventId)).filter((s) => s.status !== "cancelled").length
      : 0;
    let build: { shows?: number; builtAt?: string; music?: string; url?: string } | null = null;
    try {
      const raw = await storage.getSetting("standbyBuild");
      build = raw ? JSON.parse(raw) : null;
    } catch {
      build = null;
    }
    res.json({ lineup, build, stale: !!build && typeof build.shows === "number" && build.shows !== lineup });
  });

  app.get("/api/admin/reach", requireAdmin, async (_req, res) => {
    noStore(res);
    res.json({ snapshot: await readAudienceSnapshot(), windowDays: AUDIENCE_WINDOW_DAYS });
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
    // .partial() makes every key optional but does NOT stop .default() filling
    // the ones you left out — so a PATCH of {checkoutUrl} came back carrying
    // price: 0 and wrote it. Sending one field quietly reset the rest of the
    // row, which on a sponsorship package means a $10,000 tier advertising
    // itself as free. Only keys the caller actually sent are applied.
    const sent = Object.fromEntries(
      Object.entries(parsed.data).filter(([k]) => Object.prototype.hasOwnProperty.call(req.body ?? {}, k)),
    );
    if (Object.keys(sent).length === 0) {
      res.status(400).json({ message: "Nothing to update." });
      return;
    }
    const updated = await storage.updateSponsorPackage(Number(req.params.id), sent);
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
    // A booking parked past the end of the day — the organisers' own, for
    // seeing the dashboard as a podcaster — is not on the public lineup.
    const ev = await storage.getEventById(eventId);
    const totalSlots = ev ? Math.floor((ev.durationHours * 60) / ev.slotMinutes) : Infinity;
    const live = rows.filter((r) => r.status !== "cancelled" && r.slotIndex < totalSlots);
    res.json(await withCoHosts(live.map(toPublicSignup), live));
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
      const id = await sendConfirmationEmail({
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
      if (id) await storage.recordCadenceSend(event.id, "confirmation", signup.email, id).catch(() => {});
      return !!id;
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

    // Closed beats every other reason a slot might look takeable. "Full" is
    // arithmetic and undoes itself the moment somebody cancels — which is
    // exactly the case this exists for, because by then the running order has
    // been printed, mailed and rehearsed against, and a freed slot is a hole
    // in the schedule rather than an opening. Checked on the server because
    // the picker can be a stale tab.
    if (event.closed) {
      res.status(409).json({
        message: "The lineup for this event is closed — no more slots are being taken.",
      });
      return;
    }
    const totalSlots = Math.floor((event.durationHours * 60) / event.slotMinutes);
    if (parsed.data.slotIndex >= totalSlots) {
      res.status(400).json({ message: "That slot doesn't exist on the current schedule." });
      return;
    }

    // Daytime is live-only. Checked here rather than trusted from the picker,
    // which can be stale by the time the click lands. Slots already held by a
    // pre-recorded show keep them — this only governs new claims.
    if (
      parsed.data.showFormat !== "live" &&
      isLiveOnlySlot(event.startAtUtc, event.slotMinutes, parsed.data.slotIndex)
    ) {
      res.status(400).json({
        message: `Slots between ${LIVE_ONLY_LABEL} have to be broadcast live. Pick an evening or overnight time, or switch your show to "Go live".`,
      });
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
      `DESCRIPTION:${icsEscape(`${signup.hostName} is live on the MilitaryVoice.ai Podcast Marathon. Tune in!${bufferNote}`)}`,
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

    // Tell the podcaster. A contact is the one result the share card
    // produces, and it used to land silently in a table at the bottom of a
    // page. At most one note an hour per show: the fifth fan in ten minutes
    // is good news, not five emails.
    try {
      const hourAgo = Date.now() - 3600_000;
      const recent = (await storage.listReminders()).filter(
        (r) => r.signupId === signup.id && r.id !== created.id && Date.parse(r.createdAt) > hourAgo,
      );
      if (!recent.length && signup.email.includes("@")) {
        const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        const total = (await storage.listReminders()).filter((r) => r.signupId === signup.id).length;
        const who = parsed.data.name?.trim() || parsed.data.email;
        const origin = `${req.protocol}://${req.get("host")}`;
        const first = (signup.hostName || "").trim().split(/\s+/)[0] || "there";
        await sendOneOffEmail({
          to: signup.email,
          subject: `${who} asked to be reminded about ${signup.podcastName}`,
          text: `${first},\n\n${who} just asked us to remind them when ${signup.podcastName} is on. That's ${total} ${total === 1 ? "person" : "people"} so far. They get the reminder from us; the list is yours, under Contacts on your dashboard.\n\n${origin}/host/dashboard/contacts`,
          html: emailShell({
            banner: EMAIL_BANNERS.podcasters,
            eyebrow: "The Podcast Marathon · 5 October",
            heading: "Somebody wants a reminder",
            body: `<p>${escapeHtml(first)},</p>
<p><strong>${escapeHtml(who)}</strong> just asked us to remind them when <strong>${escapeHtml(signup.podcastName)}</strong> is on. That's ${total} ${total === 1 ? "person" : "people"} so far.</p>
<p>They get the reminder from us; the list is yours, under <strong>Contacts</strong> on your dashboard.</p>`,
            cta: { href: `${origin}/host/dashboard/contacts`, label: "See your contacts" },
          }),
        });
      }
    } catch (err) {
      console.error("Failed to tell the podcaster about a reminder:", err);
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
    // Hiding the site's own front door would 404 the homepage, the agenda and
    // the watch page for everyone. Refused here rather than in the browser, so
    // it holds however the call arrives.
    if (parsed.data.visible === false) {
      const current = await storage.getEventById(id);
      if (current?.isFeatured) {
        res.status(409).json({
          message:
            "This is the live-site event — hiding it would take the homepage down with it. Make another event the live-site event first, then hide this one.",
        });
        return;
      }
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
    // Whether their slot also goes out on their own channel is a show-day fact
    // the producer needs, and it lived only in each host's own dashboard —
    // there was no way to see who had done it and who hadn't.
    const channels = new Map(
      (await storage.listYoutubeAccounts()).map((a) => [a.email.trim().toLowerCase(), a]),
    );
    res.json(
      rows.map((r) => {
        const yt = channels.get(r.email.trim().toLowerCase());
        return { ...r, youtubeConnected: !!yt, youtubeChannelTitle: yt?.channelTitle ?? "" };
      }),
    );
  });

  /**
   * Move a set of bookings to new slots, all or nothing.
   *
   * There was no way to reschedule at all — only cancel and delete — so
   * reshaping a day meant deleting real bookings and making them again, which
   * loses everything attached to them and re-fires confirmations at people who
   * did nothing wrong.
   */
  app.post("/api/admin/events/:id/reschedule", requireAdmin, async (req, res) => {
    const eventId = Number(req.params.id);
    const parsed = z
      .object({
        moves: z
          .array(z.object({ id: z.number().int().positive(), slotIndex: z.number().int().min(0) }))
          .min(1)
          .max(200),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: fromError(parsed.error).toString() });
      return;
    }
    // Two bookings sent to one slot is a caller bug, and finding out after the
    // write means an unpickable running order.
    const targets = parsed.data.moves.map((m) => m.slotIndex);
    if (new Set(targets).size !== targets.length) {
      res.status(400).json({ message: "Two bookings were sent to the same slot." });
      return;
    }
    try {
      res.json({ moved: await storage.moveSignupSlots(eventId, parsed.data.moves) });
    } catch (err) {
      console.error("Reschedule failed:", err);
      res.status(502).json({ message: "Couldn't apply the new running order — nothing was changed." });
    }
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
    setSessionCookie(res, email, req.body?.remember === true);
    res.json({ ok: true, email });
  });

  // ---- Host: sign out ----------------------------------------------------------
  app.post("/api/host/logout", (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // ---- Host: how long this sign-in lasts ------------------------------------
  app.get("/api/host/session", (req, res) => {
    noStore(res);
    const sess = getSession(req);
    if (!sess) {
      res.status(401).json({ message: "Please sign in again." });
      return;
    }
    res.json({ email: sess.email, expiresAt: new Date(sess.exp).toISOString(), remember: sess.remember, signedInAt: sess.iat ? new Date(sess.iat).toISOString() : null });
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
      // Both of these were added to the schema without being read here, so
      // every save 400'd on a missing required field — silently, because the
      // callers didn't surface the error. A checklist item that would not
      // cross off was the visible half of it.
      shareAudienceStats: body.shareAudienceStats === "true",
      mediaAnswered: body.mediaAnswered === "true",
      detailsAnswered: body.detailsAnswered === "true",
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
    let photoOriginalUrl: string | undefined;
    if (req.file) {
      try {
        const saved = await enhanceAndSavePhoto(req.file.buffer);
        photoUrl = saved.url;
        photoOriginalUrl = saved.originalUrl;
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
      ...(photoOriginalUrl ? { photoOriginalUrl } : {}),
    });
    // Keep any slots they already hold in step with the profile.
    await storage.syncSignupsFromProfile(email, updated);
    res.json(updated);
  });

  // ---- The headshot link -------------------------------------------------------
  //      A page a podcaster can reach from an email without signing in, whose
  //      only job is to take one good photograph of them.
  //
  //      Sign-in is the reason these requests fail. Asking thirty busy people
  //      to remember which address they used, wait for a code, find the right
  //      screen and then upload is four chances to give up before the thing we
  //      actually need. The link is the screen.
  //
  //      It carries no session and grants nothing: the token names one email
  //      and the only thing it can do is replace that person's photo. Rotating
  //      SESSION_SECRET invalidates every one of them at once.

  /** A 25MB cap rather than 10: a print headshot off a real camera is bigger. */
  const headshotUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith("image/")) {
        cb(new Error("Please upload an image file."));
        return;
      }
      cb(null, true);
    },
  });

  /**
   * The links themselves, minted by the server that validates them.
   *
   * A script cannot make these. It would have to hold SESSION_SECRET, and the
   * one on a laptop is not the one on Vercel — so every link it produced
   * looked right, and every one of them was dead on arrival.
   */
  app.get("/api/admin/headshot-links", requireAdmin, async (_req, res) => {
    noStore(res);
    const signups = (await storage.listSignups(1)).filter((x) => x.status !== "cancelled");
    const seen = new Set<string>();
    const out: { email: string; hostName: string; podcastName: string; token: string; printable: boolean }[] = [];
    for (const s of signups) {
      const email = s.email.trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      const profile = await storage.getProfileByEmail(email);
      out.push({
        email,
        hostName: profile?.hostName || s.hostName || "",
        podcastName: s.podcastName || "",
        token: headshotToken(email),
        printable: Boolean(profile?.photoOriginalUrl),
      });
    }
    res.json(out);
  });

  /**
   * Does Adobe answer us?
   *
   * Checked on the server because that is where the secret is. The alternative
   * is pulling it onto a laptop to try it, which defeats the point of it being
   * a secret at all — and Vercel deliberately will not let you.
   *
   * PDF Services takes the client id and secret straight to its own /token,
   * with no scopes, and hands back a bearer token. Nothing here creates a job
   * or spends a transaction from the free tier's 500.
   */
  /**
   * Which automatic nudges are held, and how many people are waiting.
   *
   * A nudge row with emailed = false is claimed and will never send. Without
   * this the cadence screen shows "Scheduled" against something that cannot
   * fire — which is exactly the state the prep nudge is in right now, and the
   * screen had no way to say so.
   */
  app.get("/api/admin/nudges/held", requireAdmin, async (_req, res) => {
    noStore(res);
    const featured = await storage.getFeaturedEvent();
    const active = (await storage.listSignups(featured.id)).filter((x) => x.status !== "cancelled");
    const all = await storage.listNudgesForSignups(active.map((x) => x.id));
    const held: Record<string, number> = {};
    const sent: Record<string, number> = {};
    for (const n of all) {
      const bucket = n.emailed ? sent : held;
      bucket[n.kind] = (bucket[n.kind] ?? 0) + 1;
    }
    res.json({ held, sent, total: active.length });
  });

  app.get("/api/admin/adobe/check", requireAdmin, async (_req, res) => {
    noStore(res);
    const id = process.env.ADOBE_CLIENT_ID ?? "";
    const secret = process.env.ADOBE_CLIENT_SECRET ?? "";
    if (!id || !secret) {
      res.json({ ok: false, reason: `missing ${!id ? "ADOBE_CLIENT_ID" : ""}${!id && !secret ? " and " : ""}${!secret ? "ADOBE_CLIENT_SECRET" : ""}` });
      return;
    }
    try {
      const r = await fetch("https://pdf-services.adobe.io/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: id, client_secret: secret }),
      });
      const text = await r.text();
      if (!r.ok) {
        // The shape of what we hold, never the value. "invalid client_id" has
        // two very different causes — a credential Adobe does not recognise,
        // and a value that arrived here mangled — and the length tells them
        // apart without anyone pasting a secret anywhere to find out.
        res.json({
          ok: false,
          status: r.status,
          reason: text.slice(0, 300),
          idLength: id.length,
          idTail: id.slice(-4),
          idLooksHex: /^[0-9a-f]+$/i.test(id),
          secretLength: secret.length,
          secretPrefix: secret.slice(0, 4),
        });
        return;
      }
      const body = JSON.parse(text) as { access_token?: string; expires_in?: number };
      res.json({
        ok: Boolean(body.access_token),
        expiresInMinutes: body.expires_in ? Math.round(body.expires_in / 60) : null,
        // Never the token itself — only that one arrived and how long it lasts.
        idTail: id.slice(-4),
      });
    } catch (err) {
      res.json({ ok: false, reason: (err as Error).message });
    }
  });

  /** Who the link is for, so the page can greet them by name. */
  app.get("/api/headshot/:token", async (req, res) => {
    noStore(res);
    const email = emailFromToken(req.params.token);
    if (!email) {
      res.status(404).json({ message: "That link isn't valid. Ask us for a new one." });
      return;
    }
    const profile = await storage.getProfileByEmail(email);
    const [signup] = (await storage.listSignups(1)).filter(
      (x) => x.status !== "cancelled" && x.email.trim().toLowerCase() === email,
    );
    res.json({
      hostName: profile?.hostName ?? signup?.hostName ?? "",
      podcastName: signup?.podcastName ?? profile?.podcastName ?? "",
      currentPhotoUrl: profile?.photoUrl ?? signup?.photoUrl ?? "",
      // Whether what we hold could already be printed, so somebody who has
      // already done this is told so rather than asked twice.
      alreadyPrintable: Boolean(profile?.photoOriginalUrl),
    });
  });

  app.post("/api/headshot/:token", headshotUpload.single("photo"), async (req, res) => {
    const email = emailFromToken(String(req.params.token ?? ""));
    if (!email) {
      res.status(404).json({ message: "That link isn't valid. Ask us for a new one." });
      return;
    }
    if (!req.file) {
      res.status(400).json({ message: "Pick a photo first." });
      return;
    }
    try {
      const saved = await enhanceAndSavePhoto(req.file.buffer);
      if (!saved.originalUrl) {
        // The print copy is the entire point of this page. Losing it quietly
        // here would mean somebody does the work and we still cannot print.
        res.status(500).json({ message: "We couldn't keep a print copy of that. Try again, or send it to us directly." });
        return;
      }
      const updated = await storage.upsertProfile(email, {
        photoUrl: saved.url,
        photoOriginalUrl: saved.originalUrl,
      } as never);
      await storage.syncSignupsFromProfile(email, updated);
      res.json({ ok: true, photoUrl: saved.url });
    } catch (err) {
      console.error("Headshot upload failed:", err);
      res.status(400).json({ message: "That photo couldn't be processed — try a different file." });
    }
  });

  // ---- Host: per-event shows ---------------------------------------------------
  //      A show belongs to an event, not to the person. These read and write
  //      that record; the profile stays about them.

  /** Every event, with what this podcaster has done on each. */
  // ---- Host: Pro interest -----------------------------------------------------

  /**
   * "I'd use this" on the Pro page. The same interest list the public
   * platform form feeds, so one place holds who wants what; a second press
   * for the same feature is a no-op rather than a second email to us.
   */
  app.post("/api/host/pro-interest", requireHostSession, async (req, res) => {
    const email = ((req as any).hostEmail as string).toLowerCase().trim();
    const feature = String(req.body?.feature ?? "").trim();
    if (!["campaigns", "crm", "studio"].includes(feature)) return res.status(400).json({ message: "Which feature?" });
    const profile = await storage.getProfileByEmail(email);
    const notes = `Pro interest: ${feature}`;
    const already = (await storage.listPlatformInterest()).some((r) => r.email.toLowerCase() === email && r.notes === notes);
    if (already) return res.json({ ok: true, already: true });
    const v = {
      intent: "beta",
      name: profile?.hostName || email,
      email,
      organization: profile?.podcastName || "",
      eventTiming: "",
      notes,
    };
    await storage.createPlatformInterest(v);
    try {
      await sendPlatformInterestEmail(v as any);
    } catch (err) {
      console.error("Pro interest notification failed:", err);
    }
    res.json({ ok: true });
  });

  // ---- Host: Alex, by text ----------------------------------------------------

  /**
   * The green room's chat with Alex. Streams plain text as it is written,
   * so the first words are on screen before the sentence is finished.
   */
  app.post("/api/host/alex/chat", requireHostSession, async (req, res) => {
    const email = (req as any).hostEmail as string;
    const raw = Array.isArray(req.body?.messages) ? (req.body.messages as unknown[]) : [];
    const turns: AlexTurn[] = raw
      .map((m: any) => ({ role: m?.role === "assistant" ? "assistant" as const : "user" as const, content: String(m?.content ?? "").slice(0, 2000) }))
      .filter((m) => m.content.trim() !== "");
    if (!turns.length || turns[turns.length - 1].role !== "user") {
      return res.status(400).json({ message: "Say something first." });
    }
    noStore(res);
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders?.();
    try {
      for await (const piece of alexAnswer(turns, email)) res.write(piece);
    } catch (err) {
      console.error("Alex chat failed:", err);
      if (!res.headersSent) return res.status(502).json({ message: "Alex is not answering right now." });
      res.write("\n\n(Sorry — I lost my train of thought. Ask me again.)");
    }
    res.end();
  });

  // ---- Host: co-hosting -------------------------------------------------------

  /**
   * The broadcast day in hours, and who has each one.
   *
   * Names are shown to other podcasters — first name and show — because
   * "taken" on its own invites the question "by whom", and the answer is
   * public the moment they are on air together.
   */
  async function cohostBoard(eventId: number, viewerEmail: string) {
    const event = await storage.getEventById(eventId);
    if (!event) return null;
    const claims = await storage.listCohostSlots(eventId);
    const active = (await storage.listSignups(eventId)).filter((s) => s.status !== "cancelled");
    const byEmail = new Map(active.map((s) => [s.email.trim().toLowerCase(), { hostName: s.hostName, podcastName: s.podcastName }]));
    // A co-host placed by the organisers may be registered without a slot —
    // the lineup was full — so their name comes from the profile instead.
    for (const c of claims) {
      if (byEmail.has(c.email)) continue;
      const prof = await storage.getProfileByEmail(c.email);
      if (prof) byEmail.set(c.email, { hostName: prof.hostName, podcastName: prof.podcastName.trim() });
    }
    const me = viewerEmail.trim().toLowerCase();
    const start = Date.parse(event.startAtUtc);
    const blockMs = COHOST_BLOCK_MINUTES * 60_000;
    const blocks = Math.max(1, Math.round((event.durationHours * 60) / COHOST_BLOCK_MINUTES));
    // Which hours the viewer's own show falls in — they cannot co-host those.
    const mySlots = active.filter((s) => s.email.trim().toLowerCase() === me).map((s) => s.slotIndex);
    const yourShowBlocks = new Set(mySlots.map((i) => Math.floor((i * event.slotMinutes) / COHOST_BLOCK_MINUTES)));
    return {
      blockMinutes: COHOST_BLOCK_MINUTES,
      blocks: Array.from({ length: blocks }, (_, i) => {
        const claim = claims.find((c) => c.blockIndex === i);
        const who = claim ? byEmail.get(claim.email) : undefined;
        return {
          index: i,
          startAtUtc: new Date(start + i * blockMs).toISOString(),
          endAtUtc: new Date(start + (i + 1) * blockMs).toISOString(),
          mine: !!claim && claim.email === me,
          yourShow: yourShowBlocks.has(i),
          takenBy: claim && !(claim.email === me)
            ? { firstName: (who?.hostName ?? "").trim().split(/\s+/)[0] || "Someone", podcastName: who?.podcastName ?? "" }
            : null,
        };
      }),
    };
  }

  app.get("/api/host/cohost-slots/:eventId", requireHostSession, async (req, res) => {
    const board = await cohostBoard(Number(req.params.eventId), (req as any).hostEmail as string);
    if (!board) return res.status(404).json({ message: "No such event." });
    noStore(res);
    res.json(board);
  });

  app.post("/api/host/cohost-slots/:eventId", requireHostSession, async (req, res) => {
    const eventId = Number(req.params.eventId);
    const email = (req as any).hostEmail as string;
    const blockIndex = Number(req.body?.blockIndex);
    const board = await cohostBoard(eventId, email);
    if (!board) return res.status(404).json({ message: "No such event." });
    const block = board.blocks[blockIndex];
    if (!block) return res.status(400).json({ message: "That hour is not on the schedule." });
    if (block.yourShow) return res.status(400).json({ message: "Your own show is on in that hour." });
    if (block.takenBy) return res.status(409).json({ message: `${block.takenBy.firstName} already has that hour.` });
    const row = await storage.claimCohostSlot(eventId, blockIndex, email);
    if (!row) return res.status(409).json({ message: "Somebody took that hour a moment ago." });
    res.json(await cohostBoard(eventId, email));
  });

  app.delete("/api/host/cohost-slots/:eventId/:blockIndex", requireHostSession, async (req, res) => {
    const eventId = Number(req.params.eventId);
    const email = (req as any).hostEmail as string;
    await storage.releaseCohostSlot(eventId, Number(req.params.blockIndex), email);
    res.json(await cohostBoard(eventId, email));
  });

  /**
   * Set a podcaster's recording or format on their behalf.
   *
   * Replies come to the inbox as links — "the link to the show is …" — and
   * until now the only way to file one was for the podcaster to log in and
   * paste it themselves, or for somebody to write SQL. Only the two fields a
   * reply ever carries.
   */
  app.patch("/api/admin/shows/:eventId/:email", requireAdmin, async (req, res) => {
    const eventId = Number(req.params.eventId);
    const email = decodeURIComponent(String(req.params.email)).trim().toLowerCase();
    const body = req.body as { recordingUrl?: string; showFormat?: string };
    const patch: { recordingUrl?: string; showFormat?: string } = {};
    if (typeof body.recordingUrl === "string") {
      const url = body.recordingUrl.trim();
      if (url && !/^https?:\/\//i.test(url)) return res.status(400).json({ message: "The recording needs to be a link." });
      patch.recordingUrl = url;
    }
    if (body.showFormat === "live" || body.showFormat === "prerecorded") patch.showFormat = body.showFormat;
    if (!Object.keys(patch).length) return res.status(400).json({ message: "Nothing to change." });
    const active = (await storage.listSignups(eventId)).some((s) => s.status !== "cancelled" && s.email.trim().toLowerCase() === email);
    if (!active) return res.status(404).json({ message: "No booking for that address on this event." });
    const show = await storage.upsertEventShow(email, eventId, patch);
    // The booking's own copy too, or the agenda badge and the run of show
    // keep the old answer.
    await storage.updateSignupFormatByEmail(eventId, email, patch);
    res.json(show);
  });

  /**
   * Place a co-host in an hour, or take one out.
   *
   * Some co-hosts are arranged by the organisers rather than self-served —
   * a registered podcaster with no slot, paired with Riccoh for the opening.
   * Same table, same one-per-hour rule; only the hand on the button differs.
   */
  app.post("/api/admin/cohost-slots", requireAdmin, async (req, res) => {
    const eventId = Number(req.body?.eventId) || (await storage.getFeaturedEvent())?.id;
    const blockIndex = Number(req.body?.blockIndex);
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!eventId || !Number.isInteger(blockIndex) || blockIndex < 0 || !email.includes("@")) {
      return res.status(400).json({ message: "Need an event, an hour and an address." });
    }
    const row = await storage.claimCohostSlot(eventId, blockIndex, email);
    if (!row) return res.status(409).json({ message: "Somebody already has that hour." });
    res.json(row);
  });
  app.delete("/api/admin/cohost-slots/:eventId/:blockIndex", requireAdmin, async (req, res) => {
    const email = String(req.query.email ?? "").trim().toLowerCase();
    const ok = await storage.releaseCohostSlot(Number(req.params.eventId), Number(req.params.blockIndex), email);
    res.json({ ok });
  });

  /** Who has signed up to co-host, hour by hour, for the run of show. */
  app.get("/api/admin/cohost-slots", requireAdmin, async (req, res) => {
    const eventId = Number(req.query.eventId) || (await storage.getFeaturedEvent())?.id;
    if (!eventId) return res.json([]);
    const event = await storage.getEventById(eventId);
    const claims = await storage.listCohostSlots(eventId);
    const active = (await storage.listSignups(eventId)).filter((s) => s.status !== "cancelled");
    const byEmail = new Map(active.map((s) => [s.email.trim().toLowerCase(), { hostName: s.hostName, podcastName: s.podcastName }]));
    for (const c of claims) {
      if (byEmail.has(c.email)) continue;
      const prof = await storage.getProfileByEmail(c.email);
      if (prof) byEmail.set(c.email, { hostName: prof.hostName, podcastName: prof.podcastName.trim() });
    }
    noStore(res);
    res.json(claims.map((c) => {
      const s = byEmail.get(c.email);
      return {
        blockIndex: c.blockIndex,
        startAtUtc: event ? new Date(Date.parse(event.startAtUtc) + c.blockIndex * COHOST_BLOCK_MINUTES * 60_000).toISOString() : "",
        email: c.email,
        hostName: s?.hostName ?? "",
        podcastName: s?.podcastName ?? "",
        claimedAt: c.claimedAt,
      };
    }));
  });

  app.get("/api/host/events", requireHostSession, async (req, res) => {
    const email = (req as any).hostEmail as string;
    // Switching an event off hides it from podcasters too, not just the
    // public — a test event in somebody's dashboard is the thing the switch
    // exists to stop.
    const events = (await storage.listEvents()).filter((e) => e.visible);
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
          imageUrl = (await enhanceAndSavePhoto(req.file.buffer)).url;
        } catch {
          res.status(400).json({ message: "That image couldn't be processed — try a different file." });
          return;
        }
      } else if (body.clearImage === "true") {
        imageUrl = "";
      }

      // The signup follows the show, so switching to a recorded episode here
      // would quietly turn a daytime slot into a file roll. Blocked while they
      // hold one — a slot that was already recorded keeps what it has.
      if (parsed.data.showFormat !== "live") {
        const held = (await storage.listSignups(eventId)).find(
          (sg) => sg.status !== "cancelled" && sg.email.trim().toLowerCase() === email,
        );
        if (held && held.showFormat === "live" && isLiveOnlySlot(event.startAtUtc, event.slotMinutes, held.slotIndex)) {
          const when = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true,
          }).format(new Date(new Date(event.startAtUtc).getTime() + held.slotIndex * event.slotMinutes * 60000));
          res.status(400).json({
            message: `Your ${when} ET slot is inside the ${LIVE_ONLY_LABEL} window, which is live only. Move to an evening or overnight time first, then switch to a recorded episode.`,
          });
          return;
        }
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
      signups: await withCoHosts(active.map(toPublicSignup), active),
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

  /**
   * "Remind me later", signed per recipient.
   *
   * Same shape as unsubscribe and for the same reason: the click has to work
   * from an email client with no session, and the signature is what stops the
   * link being edited into somebody else's address.
   */
  function followUpToken(email: string, broadcastId: number): string {
    const secret = process.env.SESSION_SECRET || "mv-unsub-secret";
    return crypto
      .createHmac("sha256", secret)
      .update(`later:${email.toLowerCase()}:${broadcastId}`)
      .digest("hex")
      .slice(0, 32);
  }

  function followUpUrl(req: Request, email: string, broadcastId: number): string {
    const origin = process.env.PUBLIC_ORIGIN || `${req.protocol}://${req.get("host")}`;
    return `${origin}/api/remind-later?email=${encodeURIComponent(email)}&b=${broadcastId}&token=${followUpToken(email, broadcastId)}`;
  }

  /** Three days, which is long enough to stop feeling like the same email. */
  const FOLLOW_UP_DAYS = 3;

  app.get("/api/remind-later", async (req, res) => {
    const { email, b, token } = req.query as { email?: string; b?: string; token?: string };
    const broadcastId = Number(b);
    if (!email || !Number.isFinite(broadcastId) || token !== followUpToken(email, broadcastId)) {
      return res.status(400).send("Invalid link.");
    }
    const due = new Date(Date.now() + FOLLOW_UP_DAYS * 86400000);
    await storage.queueFollowUp(email, broadcastId, due.toISOString());
    const when = new Intl.DateTimeFormat("en-US", {
      weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York",
    }).format(due);
    // A second click lands here too and says the same thing, because the
    // honest answer to "did that work?" is the same either way.
    res.send(
      `<html><body style="font-family:system-ui,sans-serif;text-align:center;padding:64px 20px;color:#0b1220">` +
        `<h2 style="margin:0 0 10px">Got it — we'll ask again on ${when}.</h2>` +
        `<p style="color:#6b7280;margin:0">Nothing else to do. If you'd rather deal with it now, ` +
        `<a href="${process.env.PUBLIC_ORIGIN || "https://www.militaryvoice.ai"}/host/dashboard/profile" style="color:#053877">open your profile</a>.</p>` +
        `</body></html>`,
    );
  });

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
    const { subject, bodyText, eventId, segment, sender, banner, scheduledFor, source } = req.body as { subject?: string; bodyText?: string; eventId?: number | null; segment?: string; sender?: string; banner?: string; scheduledFor?: string | null; source?: string };
    if (!subject?.trim() || !bodyText?.trim()) return res.status(400).json({ error: "subject and bodyText are required." });
    const row = await storage.createBroadcast({ subject: subject.trim(), bodyText: bodyText.trim(), eventId: eventId ?? null, segment: segment ?? "contacts", sender: sender ?? "team", banner: banner ?? "welcome", scheduledFor: scheduledFor ?? null, source });
    res.json(row);
  });

  app.put("/api/admin/broadcasts/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const { subject, bodyText, segment, sender, banner, scheduledFor, source } = req.body as { subject?: string; bodyText?: string; segment?: string; sender?: string; banner?: string; scheduledFor?: string | null; source?: string };
    const row = await storage.updateBroadcast(id, { subject: subject?.trim(), bodyText: bodyText?.trim(), segment, sender, banner, scheduledFor: scheduledFor ?? null, source });
    if (!row) return res.status(404).json({ error: "Broadcast not found or already sent." });
    res.json(row);
  });

  /**
   * Copy one into a fresh draft.
   *
   * A sent broadcast is frozen — that's correct, its stats have to keep
   * meaning what they said. But "send that one again" is the most ordinary
   * thing to want, and without this the only route to it was retyping the
   * whole email. The copy is always a plain draft, never a cadence step: a
   * cadence slot holds exactly one template, and silently making a second
   * would leave two emails fighting over the same trigger.
   */
  app.post("/api/admin/broadcasts/:id/duplicate", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const eventId = req.query.eventId ? Number(req.query.eventId) : null;
    const source = (await storage.listBroadcasts(eventId)).find((b) => b.id === id);
    if (!source) return res.status(404).json({ error: "Broadcast not found." });
    const row = await storage.createBroadcast({
      subject: `${source.subject} (copy)`,
      bodyText: source.bodyText,
      eventId: source.eventId,
      segment: source.segment,
      sender: source.sender,
      banner: source.banner,
      scheduledFor: null,
      source: "manual",
    });
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

    // "Send test to me" should reach whoever pressed it. Their signed-in
    // address comes first; an explicit list wins over both, and the notify
    // address is only the last resort.
    const asked = String(req.body?.to ?? "")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.includes("@"))
      .slice(0, 5);
    const signedInAs = (req as any).adminEmail as string | undefined;
    const recipients = asked.length
      ? asked
      : [signedInAs || process.env.SIGNUP_NOTIFY_EMAIL || "appletonab@gmail.com"];

    const origin = `${req.protocol}://${req.get("host")}`;
    const senderMember = await resolveTeamSender(broadcast.sender ?? "team");
    const bannerTitle = await broadcastBannerTitle();
    const firstBooking = broadcast.eventId
      ? (await storage.listSignups(broadcast.eventId)).find((x) => x.status !== "cancelled")
      : undefined;
    const evForSample = broadcast.eventId ? await storage.getEventById(broadcast.eventId) : null;
    const sampleSlotLabel =
      evForSample && firstBooking
        ? await slotTimeLabel(evForSample, firstBooking.slotIndex, firstBooking.timezone)
        : "";
    const results = await Promise.all(
      recipients.map(async (to) => ({
        to,
        ok: await sendBroadcastEmail({
          to,
          firstName: "Friend",
          // The tester's own booking if they have one, otherwise the first on
          // the board. A test whose merge field reads "your slot time" proves
          // only that the fallback works, which is not the thing being tested.
          slotLabel: (await slotLabelForEmail(broadcast.eventId, to)) || sampleSlotLabel,
          subject: `[TEST] ${broadcast.subject}`,
          bodyText: broadcast.bodyText,
          unsubscribeUrl: `${origin}/unsubscribe?token=test`,
          // Signed for the tester's own address, so the remind-me link in a
          // test is the real one and can actually be clicked. A preview that
          // silently drops the control you are testing is not a preview.
          remindUrl: followUpUrl(req, to, id),
          sender: broadcast.sender ?? "team",
          banner: broadcast.banner ?? "welcome",
          senderMember: senderMember ?? undefined,
          bannerTitle,
        }),
      })),
    );
    res.json({ ok: results.every((r) => r.ok), to: recipients.join(", "), results });
  });

  app.post("/api/admin/broadcasts/:id/send", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const eventId = req.query.eventId ? Number(req.query.eventId) : null;
    const broadcastList = await storage.listBroadcasts(eventId);
    const broadcast = broadcastList.find((b) => b.id === id);

    if (!broadcast) return res.status(404).json({ error: "Broadcast not found." });
    if (broadcast.status === "sent") return res.status(409).json({ error: "Already sent." });

    if ((broadcast.segment === "signups" || broadcast.segment === "all") && !broadcast.eventId) {
      return res.status(400).json({ error: "segment='signups' requires an event-scoped broadcast." });
    }
    const recipients = await resolveBroadcastRecipients(broadcast);
    if (recipients.length === 0) return res.status(400).json({ error: "No recipients in the selected segment." });

    const senderMember = await resolveTeamSender(broadcast.sender ?? "team");

    let sent = 0;
    let failed = 0;
    for (const r of recipients) {
      const resendId = await sendBroadcastEmail({
        to: r.email,
        firstName: r.firstName,
        slotLabel: r.slotLabel,
        subject: broadcast.subject,
        bodyText: broadcast.bodyText,
        unsubscribeUrl: unsubscribeUrl(req, r.email),
        remindUrl: followUpUrl(req, r.email, id),
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

  /**
   * The email exactly as it will arrive, rendered but not sent.
   *
   * Returns the real HTML from the real renderer, so what the composer shows
   * and what lands in an inbox cannot disagree. Sent as a full document
   * because it is displayed in an iframe — the shell carries its own styles.
   */
  app.post("/api/admin/broadcasts/preview", requireAdmin, async (req, res) => {
    const { subject, bodyText, sender, banner, firstName } = req.body as {
      subject?: string; bodyText?: string; sender?: string; banner?: string; firstName?: string;
    };
    const senderMember = await resolveTeamSender(sender ?? "team");
    const rendered = renderBroadcastEmail({
      to: "preview@militaryvoice.ai",
      firstName: (firstName ?? "Sam").trim() || "Sam",
      subject: subject ?? "",
      bodyText: bodyText ?? "",
      unsubscribeUrl: "#",
      sender,
      banner,
      senderMember,
      bannerTitle: await broadcastBannerTitle(),
    });
    res.type("html").send(rendered.html);
  });

  /**
   * Who is actually in a segment, by name and address.
   *
   * "Send to 84" is a number you have to take on trust. This is the list
   * behind it, so whoever presses send can look at who it reaches first — and
   * for `not-signed-up` in particular, can confirm it really has excluded the
   * people holding slots rather than believing the arithmetic.
   */
  app.get("/api/admin/segment-preview", requireAdmin, async (req, res) => {
    const segment = String(req.query.segment ?? "contacts");
    const eventId = req.query.eventId ? Number(req.query.eventId) : null;
    const people = await resolveBroadcastRecipients({
      segment,
      eventId,
      // The resolver only reads these two fields; the rest is shape.
    } as BroadcastRow);
    res.json({
      segment,
      count: people.length,
      people: people
        .slice(0, 500)
        .map((p) => ({ email: p.email, firstName: p.firstName }))
        .sort((a, b) => a.email.localeCompare(b.email)),
    });
  });

  // Resend webhook — receives email events in real time
  /**
   * Verify a Svix-signed webhook.
   *
   * The signature header is "v1,<base64 hmac>" — several of them while a
   * secret is rotating — and the secret is the HMAC *key*, never something
   * that appears in the header. The tracking webhook checked
   * `sig.includes(secret)`, which cannot ever be true, so every delivery,
   * open and click Resend sent us was answered 401 and retried into nothing.
   *
   * Written once here because it was written twice before: the inbound
   * endpoint had it right and this one had it wrong, and nothing made them
   * disagree out loud.
   */
  /**
   * Why a signed delivery was refused, or null when it checks out.
   *
   * The reason goes back in the 401 body, which Resend shows beside each
   * failed attempt — so "every open since yesterday was 401" can be read off
   * their dashboard as "no raw body" rather than guessed at from here.
   */
  function svixFailure(req: Request, secret: string): string | null {
    if (!secret) return null; // unset means "not checking", as before
    const id = req.get("svix-id") ?? "";
    const ts = req.get("svix-timestamp") ?? "";
    const sigHeader = req.get("svix-signature") ?? "";
    const raw = (req as any).rawBody as Buffer | undefined;
    if (!id || !ts || !sigHeader) return "missing svix headers";
    if (!raw || raw.length === 0) return "no raw body to verify";
    // Five minutes, so a captured POST cannot be replayed at us tomorrow.
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return "timestamp outside five minutes";
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${raw.toString("utf8")}`).digest("base64");
    const ok = sigHeader
      .split(" ")
      .map((p) => p.split(",")[1])
      .filter(Boolean)
      .some((sig) => {
        const a = Buffer.from(sig);
        const b = Buffer.from(expected);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
      });
    return ok ? null : "signature does not match";
  }
  function svixVerified(req: Request, secret: string): boolean {
    return svixFailure(req, secret) === null;
  }

  app.post("/api/webhooks/resend", async (req, res) => {
    const refused = svixFailure(req, process.env.RESEND_WEBHOOK_SECRET ?? "");
    if (refused) return res.status(401).json({ reason: refused });
    const event = req.body as {
      type?: string;
      data?: { email_id?: string; url?: string; created_at?: string; click?: { link?: string; timestamp?: string } };
    };
    const emailId = event?.data?.email_id;
    if (!event?.type || !emailId) return res.status(400).end();
    const eventType = event.type.replace("email.", ""); // "email.opened" → "opened"
    const occurredAt = event.data?.created_at ?? new Date().toISOString();
    // Resend puts the clicked link at data.click.link, not data.url — reading
    // only the latter is why every click we have recorded has a blank URL and
    // we cannot say which link people actually followed.
    const url = event.data?.click?.link ?? event.data?.url ?? "";
    await storage.recordBroadcastEvent(emailId, eventType, occurredAt, url);
    if (eventType === "opened" || eventType === "clicked") {
      const email = await storage.getEmailByResendId(emailId);
      if (email) await storage.advanceLifecycle(email, "engaged");
    }
    res.json({ ok: true });
  });

  /**
   * Fill in the sends Resend knows about and we do not.
   *
   * Three kinds of email left no send row: the automatic ones before today,
   * the hand-written ones before this morning, and the co-host ask filed
   * after the fact with no ids. Resend still holds every one of them, with the
   * address, the subject and the last thing that happened to it. Matching on
   * subject and address gives each its id — and the webhook events already
   * stored against that id, which we could not attach to anything, start
   * counting.
   *
   * Paid for by whoever presses the button: up to ten pages of a hundred,
   * stopping at `days` back.
   */
  async function syncResend(opts: { onlyBroadcastId?: number; days?: number }) {
    type Item = { id: string; to?: string[]; subject?: string; created_at: string; last_event?: string };
    const since = Date.now() - (opts.days ?? 14) * 86400_000;
    const featured = await storage.getFeaturedEvent();
    const known = await storage.listSendResendIds();
    const sent = await storage.listSentBroadcasts();

    // The automatic emails are recognised by their subject line, since their
    // rows carry a label rather than the subject that went out.
    const cadenceOf = (subject: string) =>
      subject.startsWith("You're on the schedule:") ? "confirmation"
      : /: your slot is /.test(subject) ? "prep"
      : subject.startsWith("Two days:") ? "final"
      : subject.startsWith("You're on soon:") ? "onair"
      : null;
    const findFor = (subject: string, at: number): BroadcastRow | undefined => {
      const kind = cadenceOf(subject);
      if (kind) return sent.find((b) => b.source === `cadence:${kind}` && b.eventId === featured.id);
      // Same subject, nearest send time: a subject reused a week later is a
      // different campaign.
      return sent
        .filter((b) => b.subject === subject && b.sentAt && Math.abs(Date.parse(b.sentAt) - at) < 3 * 86400_000)
        .sort((x, y) => Math.abs(Date.parse(x.sentAt!) - at) - Math.abs(Date.parse(y.sentAt!) - at))[0];
    };
    // What a last event implies: a clicked email was opened and delivered.
    // Stats count distinct ids per type, so a copy the webhook already stored
    // does not count twice.
    const implied: Record<string, string[]> = {
      delivered: ["delivered"], opened: ["opened", "delivered"], clicked: ["clicked", "opened", "delivered"],
      bounced: ["bounced"], complained: ["complained", "delivered"],
    };

    let scanned = 0, matched = 0, unmatched = 0, skipped = 0, failed = 0;
    let after: string | undefined;
    for (let page = 0; page < 10; page++) {
      const res = (await resendApiGet(`/emails?limit=100${after ? `&after=${after}` : ""}`)) as { data?: Item[]; has_more?: boolean } | null;
      if (!res?.data?.length) break;
      let stop = false;
      for (const m of res.data) {
        scanned++;
        const at = Date.parse(m.created_at);
        if (at < since) { stop = true; break; }
        if (known.has(m.id)) continue;
        const to = m.to?.[0];
        if (!to) continue;
        const b = findFor(m.subject ?? "", at);
        if (!b || (opts.onlyBroadcastId && b.id !== opts.onlyBroadcastId)) { unmatched++; continue; }
        // One bad row must not stop the other nine hundred.
        try {
          if (!(await storage.attachSend(b.id, to, m.id, new Date(at).toISOString()))) { skipped++; continue; }
          for (const type of implied[m.last_event ?? ""] ?? []) {
            await storage.recordBroadcastEvent(m.id, type, new Date(at).toISOString());
          }
          known.add(m.id);
          matched++;
        } catch (err) {
          failed++;
          console.error(`sync-resend: could not file ${m.id} (${to}, "${m.subject}"):`, (err as Error).message);
        }
      }
      if (stop || !res.has_more) break;
      after = res.data[res.data.length - 1].id;
    }
    return { scanned, matched, unmatched, skipped, failed };
  }

  app.post("/api/admin/emails/sync-resend", requireAdmin, async (req, res) => {
    try {
      res.json(await syncResend({ days: Number(req.body?.days) || 14 }));
    } catch (err) {
      res.status(502).json({ message: (err as Error).message });
    }
  });

  app.post("/api/admin/broadcasts/:id/sync-resend", requireAdmin, async (req, res) => {
    try {
      res.json(await syncResend({ onlyBroadcastId: Number(req.params.id) }));
    } catch (err) {
      res.status(502).json({ message: (err as Error).message });
    }
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

  /**
   * The crew invite. Someone added to the team with an email gets told what
   * they are on the crew for and how to get in: the podcaster sign-in works
   * for any address, and the crew list lets them into the green room and
   * lets them take scenes there. Sent when they are added, and again from
   * the card whenever a person asks for it.
   */
  async function sendCrewInvite(eventId: number, member: { id: number; name: string; title: string; email: string }): Promise<string | null> {
    const to = member.email.trim().toLowerCase();
    if (!to.includes("@")) return null;
    const ev = await storage.getEventById(eventId);
    const eventName = ev?.name?.trim() || "The Podcast Marathon";
    const studio = (await storage.listStudios(eventId))[0];
    const first = member.name.trim().split(/\s+/)[0] || "there";
    const day = ev ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" }).format(new Date(ev.startAtUtc)) : "";
    const start = ev ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(ev.startAtUtc)) : "";
    const green = `${PUBLIC_ORIGIN}/studio${studio ? `?studioId=${studio.id}` : ""}`;
    const subject = `You're on the crew: ${eventName}`;
    const text = `${first},

You're on the crew for ${eventName} as ${member.title}${day ? ` — ${day}, first show ${start} Eastern` : ""}.

How to get in:

1. Go to ${PUBLIC_ORIGIN}/host/dashboard and sign in with this address (${to}). We email you a 6-digit code; no password.
2. Open the green room: ${green}. As crew you're let in without a slot, and you can take scenes from the rail on the right.
3. The day's running order is at ${PUBLIC_ORIGIN}/agenda.

Reply to this email with any question and a person will answer.

The ${eventName} team`;
    const html = `<p>${esc(first)},</p>
<p>You're on the crew for <strong>${esc(eventName)}</strong> as <strong>${esc(member.title)}</strong>${day ? ` — ${esc(day)}, first show ${esc(start)} Eastern` : ""}.</p>
<p><strong>How to get in</strong></p>
<ol>
  <li>Go to <a href="${PUBLIC_ORIGIN}/host/dashboard">${PUBLIC_ORIGIN.replace(/^https?:\/\//, "")}/host/dashboard</a> and sign in with this address (${esc(to)}). We email you a 6-digit code; no password.</li>
  <li>Open the <a href="${green}">green room</a>. As crew you're let in without a slot, and you can take scenes from the rail on the right.</li>
  <li>The day's running order is on the <a href="${PUBLIC_ORIGIN}/agenda">agenda</a>.</li>
</ol>
<p style="margin:22px 0"><a href="${green}" style="background:#053877;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700;display:inline-block">Open the green room</a></p>
<p>Reply to this email with any question and a person will answer.</p>
<p>The ${esc(eventName)} team</p>`;
    const id = await sendOneOffEmail({ to, subject, text, html: emailShell({ banner: EMAIL_BANNERS.podcasters, eyebrow: `${eventName} · crew`, heading: subject, body: html }) });
    if (id) {
      try { await storage.recordOneOffSend({ eventId, subject, bodyText: text, sender: "team", banner: "podcasters", email: to, resendId: id }); } catch (err) { console.error("Crew invite sent but not logged:", err); }
    }
    return id;
  }

  // ---- Chat with Alex: say it, she drafts it, you send it ---------------------
  app.post("/api/admin/chat", requireAdmin, async (req, res) => {
    const eventId = Number(req.body?.eventId) || (await storage.getFeaturedEvent()).id;
    const turns = (Array.isArray(req.body?.messages) ? req.body.messages : []) as ChatTurn[];
    const clean = turns.filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string").map((t) => ({ role: t.role, content: t.content.slice(0, 4000) }));
    if (clean.length === 0 || clean[clean.length - 1].role !== "user") return res.status(400).json({ message: "Say something first." });
    try {
      res.json(await adminChat(eventId, clean));
    } catch (err) {
      res.status(502).json({ message: (err as Error).message });
    }
  });

  /** The draft from the chat, sent. Alex signs as herself; the others as themselves. */
  app.post("/api/admin/chat/send", requireAdmin, async (req, res) => {
    const to = String(req.body?.to ?? "").trim().toLowerCase();
    const subject = String(req.body?.subject ?? "").trim().slice(0, 200);
    const text = String(req.body?.text ?? "").trim();
    const from = ["alex", "riccoh", "michael", "team"].includes(String(req.body?.from)) ? String(req.body.from) : "alex";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) || !subject || !text) return res.status(400).json({ message: "Need a recipient, a subject and the words." });
    const paragraphs = text.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
    const body = from === "alex" ? paragraphs.replace(/<p>Alex<\/p>\s*$/, "") + alexSignatureHtml() : paragraphs;
    const html = emailShell({ banner: EMAIL_BANNERS.podcasters, eyebrow: "The Podcast Marathon · 5 October", heading: subject.replace(/^re:\s*/i, ""), body });
    const named = from === "michael" ? { from: "Michael <michael@militaryvoice.ai>", replyTo: "michael@militaryvoice.ai" } : {};
    // Threads under their latest message to us, when there is one.
    const latest = (await storage.listInboundByEmail(to))[0];
    const headers: Record<string, string> = {};
    if (latest?.messageId) { headers["In-Reply-To"] = latest.messageId; headers["References"] = latest.messageId; }
    const id = await sendOneOffEmail({ to, subject, html, text, headers, ...named });
    if (!id) return res.status(502).json({ message: "The mail provider didn't accept it." });
    const featured = await storage.getFeaturedEvent();
    const team = await storage.listEventTeam(featured.id);
    const sender = from === "riccoh" ? "member:1" : from === "michael" ? `member:${team.find((m) => /michael/i.test(m.name))?.id ?? 3}` : from === "alex" ? "alex" : "team";
    try { await storage.recordOneOffSend({ eventId: featured.id, subject, bodyText: text, sender, banner: "podcasters", email: to, resendId: id }); } catch (err) { console.error("Chat send not logged:", err); }
    // If they were waiting on a person, they are not any more.
    if (latest && (latest.status === "new" || latest.status === "drafted")) {
      await storage.updateInbound(latest.id, { status: "sent", repliedAt: new Date().toISOString(), replyResendId: id, replyFrom: from, replyText: text });
    }
    res.json({ ok: true, id });
  });

  // ---- Sponsor leads: the people Riccoh is going to write to ----------------
  const LEAD_FIELDS = ["name", "company", "title", "linkedin", "email", "phone", "notes", "owner"] as const;
  const LEAD_STATUSES = new Set(["new", "contacted", "in_talks", "sponsor", "passed"]);
  app.get("/api/admin/sponsor-leads", requireAdmin, async (req, res) => {
    noStore(res);
    const eventId = Number(req.query.eventId) || (await storage.getFeaturedEvent()).id;
    res.json(await storage.listSponsorLeads(eventId));
  });
  app.post("/api/admin/sponsor-leads", requireAdmin, async (req, res) => {
    const eventId = Number(req.body?.eventId) || (await storage.getFeaturedEvent()).id;
    const row: Record<string, string> = {};
    for (const f of LEAD_FIELDS) row[f] = String(req.body?.[f] ?? "").trim().slice(0, f === "notes" ? 2000 : 300);
    if (!row.name && !row.email && !row.linkedin) return res.status(400).json({ message: "A lead needs a name, an email or a LinkedIn link." });
    const status = LEAD_STATUSES.has(String(req.body?.status)) ? String(req.body.status) : "new";
    res.json(await storage.createSponsorLead({ eventId, name: row.name, company: row.company, title: row.title, linkedin: row.linkedin, email: row.email, phone: row.phone, notes: row.notes, owner: row.owner || "Riccoh", status }));
  });
  app.patch("/api/admin/sponsor-leads/:id", requireAdmin, async (req, res) => {
    const patch: Record<string, string> = {};
    for (const f of LEAD_FIELDS) if (req.body?.[f] != null) patch[f] = String(req.body[f]).trim().slice(0, f === "notes" ? 2000 : 300);
    if (req.body?.status != null && LEAD_STATUSES.has(String(req.body.status))) patch.status = String(req.body.status);
    const updated = await storage.updateSponsorLead(Number(req.params.id), patch);
    if (!updated) return res.status(404).json({ message: "No such lead." });
    res.json(updated);
  });
  app.delete("/api/admin/sponsor-leads/:id", requireAdmin, async (req, res) => {
    await storage.deleteSponsorLead(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- View as: an admin steps into one of their own other seats -------------
  //      The owner is also a producer and a podcaster on this event, under
  //      other addresses. Rather than three browsers, the admin picks a seat
  //      and gets that seat's host session; the admin cookie is separate and
  //      stays, so the way back is a link. Admin only, and only to seats we
  //      hold a record for: the crew list and the team.
  async function viewAsSeats(): Promise<{ email: string; label: string; kind: "crew" | "team" }[]> {
    const ev = await storage.getFeaturedEvent();
    const out = new Map<string, { email: string; label: string; kind: "crew" | "team" }>();
    // Crew seats only. A host on the team is a real person's account, not
    // one of the admin's own seats.
    for (const m of await storage.listEventTeam(ev.id)) {
      const e = m.email.trim().toLowerCase();
      if (e.includes("@") && /produc|director|crew|stage/i.test(m.title)) out.set(e, { email: e, label: `${m.name} · ${m.title}`, kind: "team" });
    }
    const listed = ((await storage.getSetting("studio_crew_emails")) ?? "").split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));
    const signups = await storage.listSignups(ev.id);
    for (const e of listed) {
      if (out.has(e)) continue;
      const sg = signups.find((x) => x.email.trim().toLowerCase() === e && x.status !== "cancelled");
      out.set(e, { email: e, label: sg ? `${sg.podcastName.trim()} · Podcaster` : `${e} · Crew`, kind: "crew" });
    }
    return Array.from(out.values());
  }

  app.get("/api/admin/view-as", requireAdmin, async (_req, res) => {
    noStore(res);
    res.json(await viewAsSeats());
  });

  app.post("/api/admin/view-as", requireAdmin, async (req, res) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const seat = (await viewAsSeats()).find((x) => x.email === email);
    if (!seat) return res.status(400).json({ message: "That isn't one of your seats." });
    setSessionCookie(res, email, false);
    console.log(`Admin ${getAdminEmail(req)} viewing as ${email}`);
    res.json({ ok: true, to: "/host/dashboard" });
  });

  // ---- Crew: the dashboard for someone on the team rather than the lineup ----
  app.get("/api/host/crew", requireHostSession, async (req, res) => {
    noStore(res);
    const email = ((req as any).hostEmail as string).trim().toLowerCase();
    // Every event they are crew on — a producer can be on more than one —
    // and the one they are looking at, asked for or the featured one.
    const all = (await storage.listEvents()).filter((e) => e.visible !== false);
    const mine: typeof all = [];
    for (const e of all) if (await isCrew(req, e.id)) mine.push(e);
    if (mine.length === 0) return res.json({ isCrew: false, member: null, event: null, events: [], studioId: null });
    const featured = await storage.getFeaturedEvent();
    const asked = Number(req.query.eventId) || 0;
    const ev = mine.find((e) => e.id === asked) ?? mine.find((e) => e.id === featured.id) ?? mine[0];
    const member = (await storage.listEventTeam(ev.id)).find((m) => m.email.trim().toLowerCase() === email) ?? null;
    const studio = (await storage.listStudios(ev.id))[0];
    res.json({
      isCrew: true,
      member: member ? { id: member.id, name: member.name, title: member.title, photoUrl: member.photoUrl, email: member.email } : null,
      event: { id: ev.id, name: ev.name, startAtUtc: ev.startAtUtc, slotMinutes: ev.slotMinutes, durationHours: ev.durationHours, slug: ev.slug },
      events: mine.map((e) => ({ id: e.id, name: e.name, startAtUtc: e.startAtUtc })),
      studioId: studio?.id ?? null,
    });
  });

  /** A crew member's own row on the team, made on first save if the list let them in without one. */
  async function crewMemberFor(req: Request, eventId: number, email: string) {
    if (!(await isCrew(req, eventId))) return null;
    const found = (await storage.listEventTeam(eventId)).find((m) => m.email.trim().toLowerCase() === email);
    return found ?? (await storage.addTeamMember(eventId, { name: email.split("@")[0], title: "Crew", email, photoUrl: "" }));
  }

  app.put("/api/host/crew", requireHostSession, async (req, res) => {
    const email = ((req as any).hostEmail as string).trim().toLowerCase();
    const ev = (Number(req.body?.eventId) ? await storage.getEventById(Number(req.body.eventId)) : null) ?? (await storage.getFeaturedEvent());
    const member = await crewMemberFor(req, ev.id, email);
    if (!member) return res.status(403).json({ message: "Only the crew can do that." });
    const photoUrl = String(req.body?.photoUrl ?? "").trim().slice(0, 600);
    if (photoUrl) {
      // A picture by link — a Google profile image, say. https only, and
      // it has to be an image when fetched, so a pasted page URL is refused.
      if (!/^https:\/\//.test(photoUrl)) return res.status(400).json({ message: "The link has to start with https://" });
      try {
        const head = await fetch(photoUrl, { method: "GET", headers: { Range: "bytes=0-0" } });
        const type = head.headers.get("content-type") ?? "";
        if (!head.ok || !type.startsWith("image/")) return res.status(400).json({ message: "That link isn't an image." });
      } catch {
        return res.status(400).json({ message: "Couldn't reach that link." });
      }
      res.json(await storage.updateTeamMember(member.id, { photoUrl }));
      return;
    }
    const name = String(req.body?.name ?? "").trim().slice(0, 80);
    const title = String(req.body?.title ?? "").trim().slice(0, 80);
    if (!name) return res.status(400).json({ message: "Give us a name." });
    const updated = await storage.updateTeamMember(member.id, { name, title: title || member.title });
    res.json(updated);
  });

  app.post("/api/host/crew/photo", requireHostSession, (req, res, next) => {
    upload.single("photo")(req, res, (err) => {
      if (err) { res.status(400).json({ message: err.message }); return; }
      next();
    });
  }, async (req, res) => {
    const email = ((req as any).hostEmail as string).trim().toLowerCase();
    const ev = (Number(req.query.eventId) ? await storage.getEventById(Number(req.query.eventId)) : null) ?? (await storage.getFeaturedEvent());
    const member = await crewMemberFor(req, ev.id, email);
    if (!member) return res.status(403).json({ message: "Only the crew can do that." });
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const photoUrl = await uploadPhoto(`team/${Date.now()}-${member.id}.jpg`, req.file.buffer);
    res.json(await storage.updateTeamMember(member.id, { photoUrl }));
  });

  app.post("/api/admin/events/:id/team/:memberId/invite", requireAdmin, async (req, res) => {
    const member = (await storage.listEventTeam(Number(req.params.id))).find((m) => m.id === Number(req.params.memberId));
    if (!member) return res.status(404).json({ message: "Team member not found" });
    if (!member.email.trim()) return res.status(400).json({ message: "Add an email to the card first." });
    const id = await sendCrewInvite(Number(req.params.id), member);
    if (!id) return res.status(502).json({ message: "The mail provider didn't accept it." });
    res.json({ ok: true, id });
  });

  app.post("/api/admin/events/:id/team", requireAdmin, async (req, res) => {
    const { name, title, email, photoUrl } = req.body as { name: string; title: string; email?: string; photoUrl?: string };
    if (!name?.trim() || !title?.trim()) return res.status(400).json({ error: "name and title required" });
    const member = await storage.addTeamMember(Number(req.params.id), { name: name.trim(), title: title.trim(), email: email?.trim() ?? "", photoUrl: photoUrl?.trim() ?? "" });
    // Added with an address: they hear how to get in, straight away.
    if (member.email.trim()) sendCrewInvite(Number(req.params.id), member).catch((err) => console.error("Crew invite failed:", err));
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
