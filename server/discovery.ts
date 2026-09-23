// Discovery: find military and veteran creators, guests and speakers.
//
// Three kinds of people come here for the same thing asked three ways: a
// brand looking for creators to sponsor, a podcaster looking for guests, an
// event looking for speakers. One engine answers all three: our own lineup
// first (verified, free, the people we know), then Influencers Club's index
// of creators across the networks.
//
// Influencers Club charges per answer, so every paid answer is cached and
// shared: a search page for a day (their picture links expire after a day),
// a creator's analytics for a month, a contact for good. Revealing a contact
// is the expensive, personal step, so each member gets an allowance a month.
import crypto from "node:crypto";
import { buildProfile } from "./creatorProfile.js";
import type { Express, Request, Response } from "express";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db, storage } from "./storage.js";
import { uploadPhoto } from "./photoStorage.js";
import { waitUntil } from "@vercel/functions";
import sharp from "sharp";
import { getAdminEmail, getSessionEmail, requireHostSession } from "./session.js";
import {
  discoveryMembers,
  discoveryCache,
  discoveryLists,
  discoveryListItems,
  discoveryReveals,
  discoveryVisits,
  discoveryIntros,
  discoveryLookups,
  podcasterProfiles,
  socialMetrics,
} from "../shared/schema.js";

const BASE = "https://api-dashboard.influencers.club/public/v1";
export const PLATFORMS = ["instagram", "youtube", "tiktok", "twitter", "twitch"] as const;
type Platform = (typeof PLATFORMS)[number];
const FREE_REVEALS_PER_MONTH = 10;
const PAGE_SIZE = 10;
/** Featured in the hero's demo ahead of our lineup, as platform:handle. Read from cache only. */
const SHOWCASE: string[] = ["instagram:dr.brittiniewick_dpt"];
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Influencers Club
// ---------------------------------------------------------------------------

function key(): string {
  const k = (process.env.INFLUENCER_CLUB_API_KEY || "").trim();
  if (!k) throw new HttpError(503, "Discovery isn't connected yet.");
  return k;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function ic(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const msg = json?.detail || json?.message || json?.error || text.slice(0, 200);
    // Out of credits, or a brief it couldn't read: both are the user's to know.
    if (res.status === 402) throw new HttpError(402, "Discovery is out of search credits for the moment.");
    if (res.status === 400) {
      console.warn("discovery 400:", path, text.slice(0, 500));
      throw new HttpError(400, typeof msg === "string" ? msg : `That search couldn't be run. ${JSON.stringify(json).slice(0, 240)}`);
    }
    if (res.status >= 500) throw new HttpError(502, "The creator index couldn't build this one right now. Try again in a few minutes, or open another creator.");
    throw new HttpError(502, `Couldn't reach the creator index (${res.status}).`);
  }
  return json;
}

/** Admin-only: a raw call, to read real response shapes. */
export async function probeIc(path: string, body: unknown): Promise<unknown> {
  if (path === "/accounts/credits/") return credits();
  if (!["/discovery/", "/creators/enrich/handle/analytics/", "/discovery/creators/similar/", "/creators/enrich/handle/raw/", "/creators/enrich/email/"].includes(path)) throw new HttpError(400, "Not a probe path.");
  return ic(path, body);
}

/** What's left on the account. Free to ask. */
export async function credits(): Promise<unknown> {
  const res = await fetch(`${BASE}/accounts/credits/`, { headers: { authorization: `Bearer ${key()}` } });
  return res.json().catch(() => ({ status: res.status }));
}

/** Read the first present value from a list of dotted paths. */
function pick(obj: any, ...paths: string[]): any {
  for (const p of paths) {
    let cur = obj;
    for (const k of p.split(".")) {
      if (cur == null) break;
      cur = cur[k];
    }
    if (cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return undefined;
}
const num = (v: any): number | null => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

async function cached<T>(k: string, maxAgeMs: number, make: () => Promise<T>): Promise<T> {
  const [row] = await db.select().from(discoveryCache).where(eq(discoveryCache.key, k));
  if (row && Date.now() - Date.parse(row.createdAt) < maxAgeMs) return JSON.parse(row.payload) as T;
  const fresh = await make();
  const payload = JSON.stringify(fresh);
  const createdAt = new Date().toISOString();
  await db
    .insert(discoveryCache)
    .values({ key: k, payload, createdAt })
    .onConflictDoUpdate({ target: discoveryCache.key, set: { payload, createdAt } });
  return fresh;
}
const hash = (v: unknown) => crypto.createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 20);

/**
 * The account as the platform shows it, with its latest posts — Influencers
 * Club's "raw" read, 0.03 credits. Shared by the profile and by Enrich, and
 * kept a week so a creator looked up twice is paid for once. Posts are trimmed
 * before they're stored: a YouTube answer carries fifty full descriptions.
 */
export async function rawAccount(platform: string, handle: string): Promise<any | null> {
  return cached(`raw:${platform}:${handle.toLowerCase()}`, 7 * DAY, async () => {
    const r = await ic("/creators/enrich/handle/raw/", { handle, platform });
    const acct = r?.result?.[platform] ?? null;
    if (!acct) return null;
    const cut = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : v);
    acct.post_data = (Array.isArray(acct.post_data) ? acct.post_data : []).slice(0, 15).map((p: any) => ({
      ...p,
      caption: cut(p?.caption, 600),
      description: cut(p?.description, 300),
      localized: undefined,
      media: Array.isArray(p?.media) ? p.media.slice(0, 2) : p?.media,
    }));
    return acct;
  });
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface CreatorCard {
  platform: string;
  handle: string;
  name: string;
  picture: string;
  followers: number | null;
  engagement: number | null;
  branch: string;
  /** On our lineup: verified by us, with their show. */
  verified?: { show: string; host: string; serviceStatus: string; slotLabel: string } | null;
  signupId?: number;
  quality?: number | null;
  /** Their link, only on the server, for keeping the picture. */
  rawPicture?: string;
  /** Their other networks, where we know them. */
  channels?: string[];
  /** The platform's own blue check (not our gold one). */
  platformVerified?: boolean;
  /** The platform's category for the account, e.g. "Shopping & Retail". */
  category?: string;
  /** The list columns, from an analytics read we already hold. */
  extra?: RowExtra | null;
}

/** What a results row can show beyond the search answer: read from cache, never bought here. */
export interface RowExtra {
  growth: { monthsAgo: number; pct: number }[];
  growth6m: number | null;
  country: { name: string; code: string; pct: number } | null;
  niches: { name: string; pct: number }[];
  collabs: string[];
  collabCount: number;
}

function rowExtra(platform: string, raw: any): RowExtra | null {
  const a = raw?.[platform] ?? raw;
  if (!a) return null;
  const aud = a.audience?.audience_followers?.data ?? a.audience?.audience_likers?.data ?? a.audience?.audience_commenters?.data ?? {};
  const growth = Object.entries(a.creator_follower_growth ?? {})
    .map(([k, v]) => ({ monthsAgo: Number(String(k).match(/\d+/)?.[0] ?? 0), pct: num(v) }))
    .filter((x): x is { monthsAgo: number; pct: number } => !!x.monthsAgo && x.pct != null)
    .sort((x, y) => y.monthsAgo - x.monthsAgo)
    .map((x) => ({ ...x, pct: Math.round(x.pct * 100) / 100 }));
  const c0 = (Array.isArray(aud.audience_geo?.countries) ? aud.audience_geo.countries : []).slice().sort((x: any, y: any) => (num(y?.weight) ?? 0) - (num(x?.weight) ?? 0))[0];
  const niches = (Array.isArray(aud.audience_interests) ? aud.audience_interests : [])
    .map((i: any) => ({ name: String(i?.name ?? ""), pct: Math.round((num(i?.weight) ?? 0) * 1000) / 10 }))
    .filter((i: { name: string; pct: number }) => i.name && i.pct > 0)
    .sort((x: { pct: number }, y: { pct: number }) => y.pct - x.pct)
    .slice(0, 3);
  const sponsors = (Array.isArray(a.past_sponsors) ? a.past_sponsors : []).map((x: any) => String(x?.handle ?? x?.brand ?? "")).filter(Boolean);
  return {
    growth,
    growth6m: growth.find((g) => g.monthsAgo === 6)?.pct ?? null,
    country: c0 ? { name: String(c0.name ?? ""), code: String(c0.code ?? ""), pct: Math.round((num(c0.weight) ?? 0) * 1000) / 10 } : null,
    niches,
    collabs: sponsors.slice(0, 3),
    collabCount: sponsors.length,
  };
}

/** Their other networks, read off the links in their bio. */
const CHANNEL_HOSTS: [string, RegExp][] = [
  ["youtube", /(^|\.)(youtube\.com|youtu\.be)$/i],
  ["tiktok", /(^|\.)tiktok\.com$/i],
  ["x", /(^|\.)(x\.com|twitter\.com)$/i],
  ["instagram", /(^|\.)instagram\.com$/i],
  ["facebook", /(^|\.)(facebook\.com|fb\.com)$/i],
  ["linkedin", /(^|\.)linkedin\.com$/i],
  ["twitch", /(^|\.)twitch\.tv$/i],
];
function channelsFromLinks(links: unknown, own: string): string[] {
  const out = new Set<string>();
  for (const l of Array.isArray(links) ? links : []) {
    let host = "";
    try { host = new URL(String(l).startsWith("http") ? String(l) : `https://${l}`).hostname; } catch { continue; }
    for (const [name, re] of CHANNEL_HOSTS) if (re.test(host) && name !== own) out.add(name);
  }
  return Array.from(out);
}

/**
 * The cheap columns, for every row of a page: other channels, the platform's
 * blue check and its category, from the raw read (0.03 credits a creator,
 * kept a week — a repeat search costs nothing). The search itself returns
 * only a name, a picture, followers and engagement; growth, audience country
 * and niches need the full read and stay with it.
 */
async function withBasics<T extends CreatorCard>(rows: T[]): Promise<T[]> {
  return Promise.all(
    rows.map(async (r) => {
      if (!r.platform || !r.handle || r.verified) return r;
      try {
        const acct = await rawAccount(r.platform, r.handle);
        if (!acct) return r;
        const channels = Array.from(new Set([...(r.channels ?? []), ...channelsFromLinks(acct.links_in_bio, r.platform)]));
        return { ...r, channels, platformVerified: Boolean(acct.is_verified), category: String(acct.category ?? "") || undefined };
      } catch {
        return r;
      }
    }),
  );
}

/** Fill the list columns for whichever rows we already hold analytics for. */
async function withExtras<T extends { platform: string; handle: string }>(rows: T[]): Promise<(T & { extra: RowExtra | null })[]> {
  const keys = Array.from(new Set(rows.filter((r) => r.platform && r.handle).map((r) => `analytics:${r.platform}:${r.handle.toLowerCase()}`)));
  const found = keys.length ? await db.select().from(discoveryCache).where(inArray(discoveryCache.key, keys)) : [];
  const by = new Map(found.map((f) => [f.key, f.payload]));
  return rows.map((r) => {
    const hit = by.get(`analytics:${r.platform}:${r.handle.toLowerCase()}`);
    let extra: RowExtra | null = null;
    if (hit) {
      try {
        extra = rowExtra(r.platform, JSON.parse(hit).raw);
      } catch {
        /* an odd cache row: the columns just stay empty */
      }
    }
    return { ...r, extra };
  });
}

const BRANCHES: [string, RegExp][] = [
  ["Marine Corps", /\b(usmc|marine corps|marines?|semper fi|devil ?dog)\b/i],
  ["Army", /\b(army|soldier|airborne|ranger|green beret|hooah)\b/i],
  ["Navy", /\b(navy|usn|sailor|seal|corpsman)\b/i],
  ["Air Force", /\b(air force|usaf|airman)\b/i],
  ["Coast Guard", /\b(coast guard|uscg)\b/i],
  ["Space Force", /\b(space force|ussf|guardian)\b/i],
  ["Military spouse", /\b(mil ?spouse|military (wife|spouse|husband)|milso)\b/i],
];
function branchOf(text: string): string {
  for (const [b, re] of BRANCHES) if (re.test(text)) return b;
  return "";
}

/** Their picture links expire; ours go through a proxy that the browser caches. */
const img = (u: string) => (u ? `/api/discover/img?u=${encodeURIComponent(u)}` : "");
/**
 * A creator's picture, kept by us. Their link expires after a day and the
 * same creator gets a new link each time, so we key by platform and handle:
 * the first time we see a picture it's saved to our storage and every later
 * view is our copy. Refreshed after two months.
 */
const pic = (platform: string, handle: string, u: string) =>
  handle ? `/api/discover/pic/${platform}/${encodeURIComponent(handle.toLowerCase())}${u ? `?u=${encodeURIComponent(u)}` : ""}` : img(u);
const PIC_HOSTS = /(^|\.)(cdninstagram\.com|fbcdn\.net|ytimg\.com|ggpht\.com|googleusercontent\.com|tiktokcdn(-us)?\.com|ibyteimg\.com|twimg\.com|jtvnw\.net|influencers\.club|amazonaws\.com|cloudfront\.net|imgix\.net|influencersclub\.workers\.dev|onsocial\.ai)$/i;
async function savePicture(platform: string, handle: string, u: string): Promise<string | null> {
  const k = `pic:${platform}:${handle.toLowerCase()}`;
  const [row] = await db.select().from(discoveryCache).where(eq(discoveryCache.key, k));
  if (row && Date.now() - Date.parse(row.createdAt) < 60 * DAY) return JSON.parse(row.payload).url as string;
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return row ? (JSON.parse(row.payload).url as string) : null;
  }
  if (url.protocol !== "https:" || !PIC_HOSTS.test(url.hostname)) return row ? (JSON.parse(row.payload).url as string) : null;
  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/")) throw new Error(`picture ${r.status}`);
    const small = await sharp(Buffer.from(await r.arrayBuffer())).rotate().resize(320, 320, { fit: "cover" }).jpeg({ quality: 84 }).toBuffer();
    const saved = await uploadPhoto(`discovery/${platform}-${handle.toLowerCase().replace(/[^a-z0-9._-]/g, "_")}-${Date.now()}.jpg`, small);
    const createdAt = new Date().toISOString();
    await db.insert(discoveryCache).values({ key: k, payload: JSON.stringify({ url: saved }), createdAt }).onConflictDoUpdate({ target: discoveryCache.key, set: { payload: JSON.stringify({ url: saved }), createdAt } });
    return saved;
  } catch {
    return row ? (JSON.parse(row.payload).url as string) : null;
  }
}
/** Keep every picture in a fresh answer, after the answer has gone back. */
function keepPictures(cards: { platform: string; handle: string; rawPicture?: string }[]) {
  const work = (async () => {
    for (const c of cards) if (c.handle && c.rawPicture) await savePicture(c.platform, c.handle, c.rawPicture).catch(() => null);
  })();
  try {
    waitUntil(work);
  } catch {
    /* not on Vercel: it simply runs */
  }
}

function toCard(platform: string, a: any): CreatorCard {
  const p = a?.profile ?? a ?? {};
  const name = String(pick(p, "full_name", "fullname", "name") ?? "");
  const handle = String(pick(p, "username", "handle", "custom_url") ?? a?.user_id ?? "").replace(/^@/, "");
  const bio = String(pick(p, "biography", "bio", "description") ?? "");
  let eng = num(pick(p, "engagement_percent", "engagement_rate"));
  if (eng != null && eng > 0 && eng < 1 && !pick(p, "engagement_percent")) eng = eng * 100;
  const raw = String(pick(p, "picture", "profile_picture", "avatar") ?? "");
  return {
    platform,
    handle,
    name: name || handle,
    picture: pic(platform, handle, raw),
    rawPicture: raw,
    followers: num(pick(p, "followers", "subscribers", "number_of_followers")),
    engagement: eng,
    branch: branchOf(`${name} ${handle} ${bio}`),
  };
}

// ---------------------------------------------------------------------------
// Our own creators: verified, free, first
// ---------------------------------------------------------------------------

async function verifiedCreators(): Promise<(CreatorCard & { match: string })[]> {
  const ev = await storage.getFeaturedEvent();
  const signups = (await storage.listSignups(ev.id)).filter((s) => s.status !== "cancelled" && s.email !== "hello@militaryvoice.ai" && s.email !== "andrew@smartloads.io");
  const emails = signups.map((s) => s.email.trim().toLowerCase());
  const profiles = emails.length ? await db.select().from(podcasterProfiles).where(inArray(podcasterProfiles.email, emails)) : [];
  const when = (slot: number) =>
    new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(Date.parse(ev.startAtUtc) + slot * ev.slotMinutes * 60_000)) + " ET";
  const enrichedRows = signups.length ? await db.select().from(discoveryCache).where(inArray(discoveryCache.key, signups.map((s) => `verified:${s.id}`))) : [];
  const enrichedBySignup = new Map(enrichedRows.map((r) => [Number(r.key.split(":")[1]), JSON.parse(r.payload) as { platform: string; handle: string; reach: number; engagement: number | null; quality: number | null }]));
  return signups
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map((s) => {
      const prof = profiles.find((p) => p.email.trim().toLowerCase() === s.email.trim().toLowerCase());
      let accounts: { platform: string; username: string; followers?: number; url?: string }[] = [];
      try {
        accounts = JSON.parse(s.socialAccounts || prof?.socialAccounts || "[]");
      } catch {
        /* none */
      }
      const enriched = enrichedBySignup.get(s.id);
      const best = enriched ? { platform: enriched.platform, username: enriched.handle } : [...accounts].sort((x, y) => (y.followers ?? 0) - (x.followers ?? 0))[0];
      const total = enriched?.reach ?? accounts.reduce((n, a) => n + (a.followers ?? 0), 0);
      const branch = prof?.branch && !["none", "not applicable", "n/a", ""].includes(prof.branch.trim().toLowerCase()) ? prof.branch : "";
      return {
        platform: best?.platform ?? "",
        handle: best?.username ?? "",
        name: s.hostName.trim(),
        picture: s.photoUrl,
        followers: total || null,
        engagement: enriched?.engagement ?? null,
        quality: enriched?.quality ?? null,
        signupId: s.id,
        branch,
        verified: { show: s.podcastName.trim(), host: s.hostName.trim(), serviceStatus: prof?.serviceStatus ?? "", slotLabel: when(s.slotIndex) },
        channels: Array.from(new Set(accounts.map((a) => String(a.platform ?? "").toLowerCase()).filter((p) => p && p !== (best?.platform ?? "")))),
        match: `${s.podcastName} ${s.hostName} ${branch} ${prof?.serviceStatus ?? ""} podcast podcaster guest speaker veteran military`.toLowerCase(),
      };
    });
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

async function memberFor(email: string) {
  const [m] = await db.select().from(discoveryMembers).where(eq(discoveryMembers.email, email));
  if (m) return m;
  // Everyone already on MilitaryVoices has Discovery: their account gets it the
  // first time they come, as a podcaster, with nothing to fill in.
  const profile = email ? await storage.getProfileByEmail(email) : undefined;
  if (!profile) return undefined;
  const [row] = await db
    .insert(discoveryMembers)
    .values({ email, role: "podcaster", orgName: profile.podcastName?.trim() || "", source: "existing-account", createdAt: new Date().toISOString() })
    .onConflictDoNothing()
    .returning();
  return row ?? (await db.select().from(discoveryMembers).where(eq(discoveryMembers.email, email)))[0];
}
async function requireMember(req: Request): Promise<{ email: string; member: NonNullable<Awaited<ReturnType<typeof memberFor>>> }> {
  // Admins always have Discovery: by their admin session, or the admin key.
  const adminEmail = getAdminEmail(req);
  const adminKey = String(req.get("x-admin-password") ?? "");
  if (adminEmail || (adminKey && adminKey === (await storage.getFeaturedEvent()).adminPassword)) {
    const e = (adminEmail || "admin@militaryvoice.ai").toLowerCase();
    return { email: e, member: (await memberFor(e)) ?? { id: 0, email: e, role: "admin", orgName: "MilitaryVoices", source: "admin", createdAt: "" } };
  }
  const email = (getSessionEmail(req) ?? "").trim().toLowerCase();
  if (!email) throw new HttpError(401, "Create your free account to search.");
  const member = await memberFor(email);
  if (!member) throw new HttpError(403, "Add Discovery to your account to search.");
  return { email, member };
}
async function revealsThisMonth(email: string): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const rows = await db
    .select({ id: discoveryReveals.id })
    .from(discoveryReveals)
    .where(and(eq(discoveryReveals.email, email), gte(discoveryReveals.createdAt, start.toISOString())));
  return rows.length;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function send(res: Response, fn: () => Promise<unknown>) {
  fn()
    .then((body) => res.json(body))
    .catch((err: any) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error("discovery:", err);
      res.status(status).json({ message: err?.message ?? "Something went wrong." });
    });
}
const asPlatform = (v: unknown): Platform => (PLATFORMS.includes(String(v) as Platform) ? (String(v) as Platform) : "instagram");

// ---------------------------------------------------------------------------
// Search filters: the ones a brand manager actually reaches for, whitelisted
// into Influencers Club's shape. Anything unknown is dropped, not forwarded.
// ---------------------------------------------------------------------------

function readFilters(raw: any): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object") return f;
  const text = (v: unknown, n = 60) => String(v ?? "").trim().slice(0, n);
  const words = (v: unknown) => (Array.isArray(v) ? v : String(v ?? "").split(","))
    .map((w) => text(w, 40))
    .filter((w) => w.length > 1)
    .slice(0, 10);
  const pct = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
  };
  if (text(raw.location)) f.location = [text(raw.location)];
  if (raw.gender === "male" || raw.gender === "female") f.gender = raw.gender;
  const eng = Number(raw.engagementMin);
  if (Number.isFinite(eng) && eng > 0 && eng <= 50) f.engagement_percent = { min: eng };
  if (raw.lastPost === "90" || raw.lastPost === "365") f.last_post = raw.lastPost;
  if (raw.verifiedOnly === true) f.is_verified = true;
  if (raw.brandDeals === true) f.has_done_brand_deals = true;
  if (raw.excludePrivate === true) f.exclude_private_profile = true;
  if (raw.hasPodcast === true) f.creator_has = { has_podcast: true };
  if (words(raw.keywordsInBio).length) f.keywords_in_bio = words(raw.keywordsInBio);
  if (words(raw.excludeKeywords).length) f.exclude_keywords_in_bio = words(raw.excludeKeywords);
  if (words(raw.hashtags).length) f.hashtags = words(raw.hashtags).map((h) => h.replace(/^#/, ""));
  const audience: Record<string, unknown> = {};
  if (text(raw.audienceCountry)) audience.location = [{ name: text(raw.audienceCountry), type: "country", min_pct: pct(raw.audienceCountryMin) ?? 30 }];
  if (raw.audienceGender === "male" || raw.audienceGender === "female") audience.gender = { type: raw.audienceGender, min_pct: pct(raw.audienceGenderMin) ?? 50 };
  if (["normal", "good", "high", "best"].includes(raw.credibility)) audience.credibility = raw.credibility;
  if (Object.keys(audience).length) f.audience = audience;
  return f;
}

// ---------------------------------------------------------------------------
// Enrich
// ---------------------------------------------------------------------------

const ENRICH_BATCH = 10;
const ENRICH_PER_MONTH = 200;
const platformName = (p: string) => ({ instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", twitter: "X", twitch: "Twitch" })[p] ?? p;

/** What someone typed or pasted, read as a lookup. Links name their own platform. */
export function parseLookup(raw: string, fallback: Platform): { kind: "email"; email: string } | { kind: "handle"; platform: Platform; handle: string } | null {
  const v = raw.trim().replace(/^["'<(]+|[">)'.,;]+$/g, "");
  if (!v) return null;
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) return { kind: "email", email: v.toLowerCase() };
  let platform: Platform = fallback;
  let handle = v;
  const m = v.match(/^(?:https?:\/\/)?(?:www\.|m\.)?(instagram\.com|youtube\.com|youtu\.be|tiktok\.com|x\.com|twitter\.com|twitch\.tv)\/(.*)$/i);
  if (m) {
    const host = m[1].toLowerCase();
    const path = m[2].split(/[?#]/)[0].split("/").filter(Boolean);
    platform = host.startsWith("instagram") ? "instagram" : host.startsWith("youtu") ? "youtube" : host.startsWith("tiktok") ? "tiktok" : host.startsWith("twitch") ? "twitch" : "twitter";
    handle = platform === "youtube" ? (path.find((x) => x.startsWith("@")) ?? (["c", "user", "channel"].includes(path[0]) ? path[1] : path[0]) ?? "") : (path[0] ?? "");
  }
  handle = handle.replace(/^@/, "").trim();
  return /^[A-Za-z0-9._-]{1,80}$/.test(handle) && !["p", "reel", "watch", "explore"].includes(handle.toLowerCase()) ? { kind: "handle", platform, handle } : null;
}

async function isFresh(k: string, maxAgeMs: number): Promise<boolean> {
  const [row] = await db.select({ createdAt: discoveryCache.createdAt }).from(discoveryCache).where(eq(discoveryCache.key, k));
  return !!row && Date.now() - Date.parse(row.createdAt) < maxAgeMs;
}

async function lookupsThisMonth(email: string): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const rows = await db.select({ id: discoveryLookups.id }).from(discoveryLookups).where(and(eq(discoveryLookups.email, email), gte(discoveryLookups.createdAt, start.toISOString())));
  return rows.length;
}

export function registerDiscoveryRoutes(app: Express): void {
  /** Who's asking: signed in or not, and whether Discovery is on their account. */
  app.get("/api/discover/me", (req, res) =>
    send(res, async () => {
      res.set("Cache-Control", "no-store");
      const adminEmail = (getAdminEmail(req) ?? "").toLowerCase();
      const email = ((getSessionEmail(req) ?? "") || adminEmail).trim().toLowerCase();
      if (!email) return { signedIn: false };
      const member = (await memberFor(email)) ?? (adminEmail ? { role: "admin", orgName: "MilitaryVoices", createdAt: "" } : undefined);
      const profile = await storage.getProfileByEmail(email);
      return {
        signedIn: true,
        email,
        isPodcaster: !!profile,
        member: member ? { role: member.role, orgName: member.orgName, since: member.createdAt } : null,
        reveals: member ? { used: await revealsThisMonth(email), allowance: FREE_REVEALS_PER_MONTH } : null,
        lookups: member && member.role !== "admin" ? { used: await lookupsThisMonth(email), allowance: ENRICH_PER_MONTH } : null,
        // Signed in to the admin too: they can spend credits on filling a page.
        isAdmin: !!adminEmail,
      };
    }),
  );

  /** Add Discovery to the signed-in account. Free. */
  app.post("/api/discover/join", requireHostSession, (req, res) =>
    send(res, async () => {
      const email = (getSessionEmail(req) ?? "").trim().toLowerCase();
      const role = ["brand", "podcaster", "event", "agency", "other"].includes(String(req.body?.role)) ? String(req.body.role) : "other";
      const orgName = String(req.body?.orgName ?? "").trim().slice(0, 120);
      const source = String(req.body?.source ?? "").replace(/[^a-z0-9-]/gi, "").slice(0, 40);
      await db
        .insert(discoveryMembers)
        .values({ email, role, orgName, source, createdAt: new Date().toISOString() })
        .onConflictDoUpdate({ target: discoveryMembers.email, set: { role, orgName } });
      return { ok: true };
    }),
  );

  /** A visit, by where it came from. One per page load; nothing personal kept. */
  app.post("/api/discover/visit", (req, res) =>
    send(res, async () => {
      const source = String(req.body?.source ?? "").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "direct";
      await db.insert(discoveryVisits).values({ source, createdAt: new Date().toISOString() });
      return { ok: true };
    }),
  );

  /** For the admin: visits and new accounts by source, members by role. */
  app.get("/api/admin/discover/stats", (req, res) =>
    send(res, async () => {
      if (!getAdminEmail(req) && String(req.get("x-admin-password") ?? "") !== (await storage.getFeaturedEvent()).adminPassword) throw new HttpError(401, "Admins only.");
      const visits = await db.select().from(discoveryVisits);
      const members = await db.select().from(discoveryMembers);
      const bySource: Record<string, { visits: number; joins: number }> = {};
      for (const v of visits) (bySource[v.source] ??= { visits: 0, joins: 0 }).visits++;
      for (const m of members) (bySource[m.source || "direct"] ??= { visits: 0, joins: 0 }).joins++;
      const byRole: Record<string, number> = {};
      for (const m of members) byRole[m.role] = (byRole[m.role] ?? 0) + 1;
      return { visits: visits.length, members: members.length, bySource, byRole, recent: members.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10).map((m) => ({ email: m.email, role: m.role, orgName: m.orgName, source: m.source, createdAt: m.createdAt })) };
    }),
  );

  /**
   * Fill in the lineup: for each podcaster, the strongest handle we know
   * (their audience figures, or Influencers Club's look-up by their email),
   * then that handle's analytics, cached where the profile drawer reads it.
   * Admin-only; spends credits once per podcaster.
   */
  app.post("/api/admin/discover/enrich-verified", (req, res) =>
    send(res, async () => {
      if (!getAdminEmail(req) && String(req.get("x-admin-password") ?? "") !== (await storage.getFeaturedEvent()).adminPassword) throw new HttpError(401, "Admins only.");
      const ev = await storage.getFeaturedEvent();
      const only = Number(req.body?.signupId) || 0;
      const signups = (await storage.listSignups(ev.id)).filter((s) => s.status !== "cancelled" && s.email !== "hello@militaryvoice.ai" && s.email !== "andrew@smartloads.io" && (!only || s.id === only));
      const metrics = await db.select().from(socialMetrics);
      const out: { signupId: number; host: string; platform?: string; handle?: string; reach?: number; quality?: number | null; error?: string }[] = [];
      for (const s of signups) {
        const email = s.email.trim().toLowerCase();
        try {
          const mine = metrics.filter((m) => m.email.trim().toLowerCase() === email && (m.followers ?? 0) > 0);
          const reach = mine.reduce((n, m) => n + (m.followers ?? 0), 0);
          let pick0 = mine.filter((m) => (PLATFORMS as readonly string[]).includes(m.platform === "x" ? "twitter" : m.platform)).sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0))[0];
          let platform = pick0 ? (pick0.platform === "x" ? "twitter" : pick0.platform) : "";
          let handle = pick0?.handle ?? "";
          let followers = pick0?.followers ?? 0;
          // An admin who found the account by hand says so, and that wins.
          if (only && req.body?.handle) {
            platform = asPlatform(req.body.platform);
            handle = String(req.body.handle).replace(/^@/, "").trim();
            const acct = await rawAccount(platform, handle).catch(() => null);
            followers = num(acct?.follower_count ?? acct?.subscriber_count) ?? 0;
          }
          if (!handle) {
            // Accounts they connected themselves: trustworthy, and free.
            const prof = await storage.getProfileByEmail(email);
            let connected: { platform: string; username: string; followers?: number }[] = [];
            try {
              connected = JSON.parse(s.socialAccounts || prof?.socialAccounts || "[]");
            } catch {
              /* none */
            }
            const c0 = connected
              .map((c) => ({ ...c, platform: c.platform === "x" ? "twitter" : c.platform }))
              .filter((c) => (PLATFORMS as readonly string[]).includes(c.platform) && c.username)
              .sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0))[0];
            if (c0) {
              platform = c0.platform;
              handle = c0.username;
              followers = c0.followers ?? 0;
            }
          }
          if (!handle) {
            // Nothing on file: ask the index who owns this email (0.05 credits).
            const r = await ic("/creators/enrich/email/", { email }).catch(() => null);
            const res0 = r?.result ?? {};
            // An email can belong to someone else's account (a manager, a
            // partner). Keep the match only when the handle plainly belongs to
            // this person or their show.
            const tokens = `${s.hostName} ${s.podcastName}`.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((t) => t.length >= 4 && !["podcast", "show", "with", "the", "radio", "network"].includes(t));
            const owns = res0?.username && tokens.some((t) => String(res0.username).toLowerCase().includes(t));
            if (owns && (PLATFORMS as readonly string[]).includes(String(res0.platform))) {
              platform = String(res0.platform);
              handle = String(res0.username);
              followers = num(pick(res0, "followers", "follower_count")) ?? 0;
            }
          }
          if (!handle) {
            out.push({ signupId: s.id, host: s.hostName, error: "no social account found" });
            continue;
          }
          const a = await cached(`analytics:${platform}:${handle.toLowerCase()}`, 30 * DAY, async () => normalizeAnalytics(platform, handle, await ic("/creators/enrich/handle/analytics/", { handle, platform, include_lookalikes: false })));
          const engagement = followers && a.likesMedian != null ? Math.round((((a.likesMedian ?? 0) + (a.commentsMedian ?? 0)) / followers) * 10000) / 100 : null;
          const payload = { platform, handle, reach: Math.max(reach, followers), engagement, quality: a.audience?.credibility ?? null };
          const createdAt = new Date().toISOString();
          await db.insert(discoveryCache).values({ key: `verified:${s.id}`, payload: JSON.stringify(payload), createdAt }).onConflictDoUpdate({ target: discoveryCache.key, set: { payload: JSON.stringify(payload), createdAt } });
          out.push({ signupId: s.id, host: s.hostName, platform, handle, reach: payload.reach, quality: payload.quality });
        } catch (err: any) {
          out.push({ signupId: s.id, host: s.hostName, error: String(err?.message ?? err).slice(0, 120) });
        }
      }
      return out;
    }),
  );

  /** Ask us to put you in touch with a verified creator. We make the introduction. */
  app.post("/api/discover/intro", (req, res) =>
    send(res, async () => {
      const { email } = await requireMember(req);
      const signupId = Number(req.body?.signupId);
      const kind = ["email", "phone", "intro"].includes(String(req.body?.kind)) ? String(req.body.kind) : "intro";
      if (!signupId) throw new HttpError(400, "Which creator?");
      await db.insert(discoveryIntros).values({ requester: email, signupId, kind, note: String(req.body?.note ?? "").slice(0, 500), createdAt: new Date().toISOString() });
      return { ok: true };
    }),
  );
  app.get("/api/admin/discover/intros", (req, res) =>
    send(res, async () => {
      if (!getAdminEmail(req) && String(req.get("x-admin-password") ?? "") !== (await storage.getFeaturedEvent()).adminPassword) throw new HttpError(401, "Admins only.");
      const rows = await db.select().from(discoveryIntros).orderBy(desc(discoveryIntros.createdAt));
      const ev = await storage.getFeaturedEvent();
      const signups = await storage.listSignups(ev.id);
      return rows.map((r) => ({ ...r, host: signups.find((s) => s.id === r.signupId)?.hostName ?? "", show: signups.find((s) => s.id === r.signupId)?.podcastName ?? "" }));
    }),
  );

  /** Our own lineup: verified MilitaryVoices creators. Public and free. */
  app.get("/api/discover/verified", (_req, res) =>
    send(res, async () => {
      res.set("Cache-Control", "public, max-age=300");
      return withExtras((await verifiedCreators()).map(({ match: _m, ...c }) => c));
    }),
  );

  /** The search: our verified creators that match, then the index. */
  app.post("/api/discover/search", (req, res) =>
    send(res, async () => {
      await requireMember(req);
      const platform = asPlatform(req.body?.platform);
      const q = String(req.body?.q ?? "").trim().slice(0, 200);
      // One branch or several ("Army,Navy"): a search for any of them.
      const branches = String(req.body?.branch ?? "").split(",").map((b) => b.trim()).filter(Boolean).slice(0, 7);
      const branch = branches.join(" ");
      const page = Math.max(0, Math.min(40, Number(req.body?.page) || 0));
      const minF = num(req.body?.minFollowers);
      const maxF = num(req.body?.maxFollowers);
      const sortBy = ["relevancy", "engagement_rate", "number_of_followers", "growth_rate"].includes(String(req.body?.sort)) ? String(req.body.sort) : "relevancy";

      // The brief, in plain English. The community is always part of it:
      // this is a military and veteran index, not a general one.
      const military = /\b(military|veteran|vet|army|navy|marine|usmc|air force|coast guard|space force|spouse|milspouse|service ?member|soldier|sailor|airman)\b/i.test(`${q} ${branch}`);
      const brief = [
        branches.length ? branches.map((b) => (b === "Military spouse" ? "military spouse" : `${b} veteran`)).join(" or ") : "",
        q,
        military ? "" : "in the US military and veteran community",
      ]
        .filter(Boolean)
        .join(" ")
        .trim() || "US military veterans and military spouses";
      const filters: Record<string, unknown> = readFilters(req.body?.filters);
      if (minF != null || maxF != null) filters.number_of_followers = { ...(minF != null ? { min: minF } : {}), ...(maxF != null ? { max: maxF } : {}) };
      // Keywords mode: the words themselves, matched in the bio, any of them.
      // No AI brief, so nothing is reinterpreted; the branch chip adds its word.
      const mode = req.body?.mode === "keywords" ? "keywords" : "ai";
      if (mode === "keywords") {
        const words = q.split(/,|\bor\b|\n/i).map((w) => w.trim()).filter((w) => w.length > 1).slice(0, 10);
        for (const b of branches) words.push(b === "Military spouse" ? "military spouse" : b.toLowerCase());
        if (!words.length) throw new HttpError(400, "Type a word or two to find in creators' bios.");
        filters.keywords_in_bio = Array.from(new Set([...(Array.isArray(filters.keywords_in_bio) ? (filters.keywords_in_bio as string[]) : []), ...words]));
      }
      const body = { platform, ...(mode === "ai" ? { nlp_search: brief } : {}), paging: { limit: PAGE_SIZE, page }, sort: { sort_by: sortBy, sort_order: "desc" }, filters };

      // A week: the same search by anyone this week costs nothing. Pictures
      // are kept by us, so an old answer never shows a broken face.
      const found = await cached(`search:${hash(body)}`, 7 * DAY, async () => {
        const r = await ic("/discovery/", body);
        const accounts = (r?.accounts ?? []).map((a: any) => toCard(platform, a));
        keepPictures(accounts);
        return { total: num(r?.total) ?? 0, accounts, understood: r?.nlp_search ?? null, applied: r?.applied_filters ?? null };
      });
      found.accounts = await withExtras(await withBasics(found.accounts.map(({ rawPicture: _r, ...c }: CreatorCard) => c)));

      // Ours first, on the first page, when the words match.
      let verified: CreatorCard[] = [];
      if (page === 0) {
        // Every meaningful word has to match, so "veteran fitness coaches" doesn't
        // pull in every veteran podcaster on the lineup. Plurals fold to singular.
        const stop = new Set(["the", "and", "with", "for", "who", "that", "creators", "creator", "followers", "veteran", "veterans", "military", "vets", "about", "talk"]);
        const words = `${q}`.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w)).map((w) => w.replace(/s$/, ""));
        verified = (await verifiedCreators())
          .filter((c) => (!branches.length || branches.some((b) => c.branch.toLowerCase() === b.toLowerCase())) && words.every((w) => c.match.includes(w)))
          .slice(0, 8)
          .map(({ match: _m, ...c }) => c);
        verified = await withExtras(verified);
      }
      if (mode === "keywords") verified = [];
      return { brief: mode === "keywords" ? `bio mentions ${(filters.keywords_in_bio as string[]).join(" or ")}` : brief, mode, platform, page, pageSize: PAGE_SIZE, total: found.total, results: found.accounts, verified, understood: found.understood };
    }),
  );

  /** A creator's analytics: growth, engagement, income, hashtags, past sponsors. */
  app.get("/api/discover/creator", (req, res) =>
    send(res, async () => {
      await requireMember(req);
      const platform = asPlatform(req.query.platform);
      const handle = String(req.query.handle ?? "").replace(/^@/, "").trim().slice(0, 100);
      if (!handle) throw new HttpError(400, "Which creator?");
      const [fullOrErr, account] = await Promise.all([
        cached(`analytics:${platform}:${handle.toLowerCase()}`, 30 * DAY, async () => {
          const r = await ic("/creators/enrich/handle/analytics/", { handle, platform, include_lookalikes: false });
          return normalizeAnalytics(platform, handle, r);
        }).catch((e: unknown) => e as Error),
        // The account and its latest posts: cheap, and it fills the recent-posts section.
        rawAccount(platform, handle).catch(() => null),
      ]);
      // The full read can fail on the index's side (big accounts time out there).
      // Show what the account read gives — who they are, their posts, how often
      // they post — and say the audience is still to come, rather than a dead end.
      if (fullOrErr instanceof Error) {
        if (!account) throw fullOrErr;
        return { partial: fullOrErr.message, fetchedAt: new Date().toISOString(), profile: buildProfile(platform, handle, {}, account, new Date().toISOString()) };
      }
      const full = fullOrErr;
      // The raw answers stay in the cache for correcting the readers; admins can see them.
      const { raw, ...rest } = full;
      const profile = buildProfile(platform, handle, raw, account, full.fetchedAt);
      return req.query.raw === "1" && (await storage.isAdminEmail(String(getSessionEmail(req) ?? ""))) ? { ...full, profile, account } : { ...rest, profile };
    }),
  );

  /** Creators like this one. */
  app.get("/api/discover/similar", (req, res) =>
    send(res, async () => {
      await requireMember(req);
      const platform = asPlatform(req.query.platform);
      const handle = String(req.query.handle ?? "").replace(/^@/, "").trim().slice(0, 100);
      if (!handle) throw new HttpError(400, "Which creator?");
      const list = await cached(`similar:${platform}:${handle.toLowerCase()}`, 30 * DAY, async () => {
        const r = await ic("/discovery/creators/similar/", { platform, filter_key: "username", filter_value: handle, paging: { limit: 12, page: 0 } });
        const cards = (r?.accounts ?? []).map((a: any) => toCard(platform, a));
        keepPictures(cards);
        return cards;
      });
      return list.map(({ rawPicture: _r, ...c }: CreatorCard) => c);
    }),
  );

  /** A creator's email and phone. Counted against the member's monthly allowance. */
  app.post("/api/discover/reveal", (req, res) =>
    send(res, async () => {
      const { email } = await requireMember(req);
      const platform = asPlatform(req.body?.platform);
      const handle = String(req.body?.handle ?? "").replace(/^@/, "").trim().slice(0, 100);
      if (!handle) throw new HttpError(400, "Which creator?");
      // Already revealed by this member: free to see again.
      const [again] = await db
        .select({ id: discoveryReveals.id })
        .from(discoveryReveals)
        .where(and(eq(discoveryReveals.email, email), eq(discoveryReveals.platform, platform), eq(discoveryReveals.handle, handle.toLowerCase())));
      if (!again) {
        const used = await revealsThisMonth(email);
        if (used >= FREE_REVEALS_PER_MONTH) throw new HttpError(429, `You've used your ${FREE_REVEALS_PER_MONTH} free contacts this month. They reset on the 1st.`);
      }
      const contact = await cached(`contact:${platform}:${handle.toLowerCase()}`, 3650 * DAY, async () => {
        const r = await ic("/creators/enrich/handle/profile/", { handle, platform, email_required: "preferred" });
        const res0 = r?.result ?? r ?? {};
        return {
          email: pick(res0, "email", "emails.0", `${platform}.email`) ?? null,
          phone: pick(res0, "contact_phone_number", `${platform}.contact_phone_number`) ?? null,
          location: pick(res0, "location", "country") ?? null,
          website: pick(res0, "website", `${platform}.external_url`, `${platform}.website`) ?? null,
        };
      });
      if (!again) await db.insert(discoveryReveals).values({ email, platform, handle: handle.toLowerCase(), createdAt: new Date().toISOString() });
      return { ...contact, reveals: { used: await revealsThisMonth(email), allowance: FREE_REVEALS_PER_MONTH } };
    }),
  );

  // ---- Saved lists ---------------------------------------------------------
  app.get("/api/discover/lists", (req, res) =>
    send(res, async () => {
      const { email } = await requireMember(req);
      const lists = await db.select().from(discoveryLists).where(eq(discoveryLists.email, email)).orderBy(desc(discoveryLists.createdAt));
      const items = lists.length ? await db.select().from(discoveryListItems).where(inArray(discoveryListItems.listId, lists.map((l) => l.id))) : [];
      return lists.map((l) => ({
        ...l,
        items: items.filter((i) => i.listId === l.id).map((i) => ({ ...i, snapshot: JSON.parse(i.snapshot || "{}") })),
      }));
    }),
  );
  app.post("/api/discover/lists", (req, res) =>
    send(res, async () => {
      const { email } = await requireMember(req);
      const name = String(req.body?.name ?? "").trim().slice(0, 80) || "My list";
      const [row] = await db.insert(discoveryLists).values({ email, name, createdAt: new Date().toISOString() }).returning();
      return row;
    }),
  );
  app.delete("/api/discover/lists/:id", (req, res) =>
    send(res, async () => {
      const { email } = await requireMember(req);
      const id = Number(req.params.id);
      const [l] = await db.select().from(discoveryLists).where(and(eq(discoveryLists.id, id), eq(discoveryLists.email, email)));
      if (!l) throw new HttpError(404, "No such list.");
      await db.delete(discoveryListItems).where(eq(discoveryListItems.listId, id));
      await db.delete(discoveryLists).where(eq(discoveryLists.id, id));
      return { ok: true };
    }),
  );
  app.post("/api/discover/lists/:id/items", (req, res) =>
    send(res, async () => {
      const { email } = await requireMember(req);
      const id = Number(req.params.id);
      const [l] = await db.select().from(discoveryLists).where(and(eq(discoveryLists.id, id), eq(discoveryLists.email, email)));
      if (!l) throw new HttpError(404, "No such list.");
      const card = req.body?.card as CreatorCard | undefined;
      if (!card?.handle && !card?.signupId) throw new HttpError(400, "Which creator?");
      // One of ours with no social handle is saved by their booking.
      const platform = card.handle ? String(card.platform || "instagram") : "militaryvoice";
      const handle = card.handle ? String(card.handle).toLowerCase() : `signup-${card.signupId}`;
      const existing = await db.select().from(discoveryListItems).where(and(eq(discoveryListItems.listId, id), eq(discoveryListItems.platform, platform), eq(discoveryListItems.handle, handle)));
      if (existing.length) return existing[0];
      const [row] = await db
        .insert(discoveryListItems)
        .values({ listId: id, platform, handle, snapshot: JSON.stringify(card).slice(0, 4000), note: "", createdAt: new Date().toISOString() })
        .returning();
      return row;
    }),
  );
  app.delete("/api/discover/lists/:id/items/:itemId", (req, res) =>
    send(res, async () => {
      const { email } = await requireMember(req);
      const [l] = await db.select().from(discoveryLists).where(and(eq(discoveryLists.id, Number(req.params.id)), eq(discoveryLists.email, email)));
      if (!l) throw new HttpError(404, "No such list.");
      await db.delete(discoveryListItems).where(and(eq(discoveryListItems.id, Number(req.params.itemId)), eq(discoveryListItems.listId, l.id)));
      return { ok: true };
    }),
  );

  // ---- Enrich: a handle, a profile link, an email, or a whole list of them --------
  //      The client sends ten at a time and draws a progress bar between
  //      batches, so a 500-row sheet never rides on one long request. Answers we
  //      already hold are free and don't count; only a fresh read is paid for.
  app.post("/api/discover/enrich", (req, res) =>
    send(res, async () => {
      const { email: who, member } = await requireMember(req);
      const items = (Array.isArray(req.body?.items) ? req.body.items : []).map((x: unknown) => String(x ?? "")).slice(0, ENRICH_BATCH);
      const fallback = asPlatform(req.body?.platform);
      const unlimited = member.role === "admin";
      let used = unlimited ? 0 : await lookupsThisMonth(who);
      const lineup = await verifiedCreators().catch(() => []);

      const rows: Record<string, unknown>[] = [];
      // Side by side. The allowance is checked and counted in the same tick
      // as each paid read is decided, so parallel rows can't overspend it.
      await Promise.all(
        items.map(async (input: string, i: number) => {
          const want = parseLookup(input, fallback);
          if (!want) return void (rows[i] = { input, status: "invalid", message: "Not a handle, profile link or email." });
          const subject = want.kind === "email" ? want.email : `${want.platform}:${want.handle.toLowerCase()}`;
          const free = await isFresh(want.kind === "email" ? `email:${want.email}` : `raw:${subject}`, want.kind === "email" ? 365 * DAY : 7 * DAY);
          if (!free && !unlimited) {
            if (used >= ENRICH_PER_MONTH) return void (rows[i] = { input, status: "limit", message: `You've used this month's ${ENRICH_PER_MONTH} look-ups.` });
            used++;
          }
          try {
            let platform = want.kind === "handle" ? want.platform : "";
            let handle = want.kind === "handle" ? want.handle : "";
            if (want.kind === "email") {
              const found = await cached(`email:${want.email}`, 365 * DAY, async () => {
                const r = await ic("/creators/enrich/email/", { email: want.email }).catch((e: any) => {
                  if (e instanceof HttpError && e.status === 400) return null; // "No creator found": nothing charged
                  throw e;
                });
                const x = r?.result ?? null;
                return x?.username ? { platform: String(x.platform ?? ""), handle: String(x.username).replace(/^@/, "") } : null;
              });
              if (!found || !(PLATFORMS as readonly string[]).includes(found.platform)) return void (rows[i] = { input, kind: "email", status: "not_found", message: "No creator account found for this email.", free });
              platform = found.platform;
              handle = found.handle;
            }
            const acct = await rawAccount(platform, handle).catch((e: any) => {
              if (e instanceof HttpError && e.status === 400) return null;
              throw e;
            });
            if (!free && !unlimited) await db.insert(discoveryLookups).values({ email: who, kind: want.kind, subject, createdAt: new Date().toISOString() });
            if (!acct || acct.exists === false || String(acct.exists) === "False") return void (rows[i] = { input, kind: want.kind, status: "not_found", message: `No ${platformName(platform)} account @${handle}.`, free });
            const prof = buildProfile(platform, handle, {}, acct, new Date().toISOString());
            const realHandle = String(acct.username ?? acct.custom_url ?? handle).replace(/^@/, "");
            const rawPicture = String(acct.profile_picture_hd ?? acct.profile_picture ?? "");
            const ours = lineup.find((c) => c.platform === platform && c.handle.toLowerCase() === realHandle.toLowerCase());
            const card: CreatorCard = {
              platform,
              handle: realHandle,
              name: prof.identity.name || realHandle,
              picture: pic(platform, realHandle, rawPicture),
              rawPicture,
              followers: prof.identity.followers,
              engagement: prof.signals.engagementRate,
              branch: branchOf(`${prof.identity.name} ${realHandle} ${prof.identity.bio}`),
              ...(ours ? { verified: ours.verified, signupId: ours.signupId } : {}),
            };
            keepPictures([card]);
            const { rawPicture: _drop, ...clean } = card;
            rows[i] = {
              input,
              kind: want.kind,
              status: "found",
              free,
              card: clean,
              extra: {
                bio: prof.identity.bio.slice(0, 280),
                posts: prof.identity.posts,
                lastPostAt: prof.signals.lastPostAt,
                postsPerWeek: prof.signals.postsPerWeek,
                verifiedAccount: prof.identity.verified,
                category: prof.identity.category,
                country: prof.identity.country,
              },
            };
          } catch (e: any) {
            rows[i] = { input, status: "error", message: e?.message ?? "Couldn't read this one." };
          }
        }),
      );
      return { rows, lookups: unlimited ? null : { used, allowance: ENRICH_PER_MONTH } };
    }),
  );

  // ---- The hero's demo: a trimmed profile for creators we've already paid for ---
  //      Public (the hero plays before anyone signs in), so it only ever reads
  //      the cache — never buys — and carries headline numbers, not the profile.
  //      SHOWCASE adds featured accounts beyond our own lineup, first in line.
  app.get("/api/discover/showcase", (_req, res) =>
    send(res, async () => {
      res.set("Cache-Control", "public, max-age=300, s-maxage=300");
      // Only the featured accounts, in order; our own lineup cards lend them their photo and show.
      const lineup = (await verifiedCreators()).filter((c) => c.platform && c.handle);
      const wanted = SHOWCASE.map((k) => {
        const [platform, handle] = k.split(":");
        return { platform, handle, card: lineup.find((c) => c.platform === platform && c.handle.toLowerCase() === handle.toLowerCase()) ?? null };
      });
      const keys = wanted.flatMap((w) => [`analytics:${w.platform}:${w.handle.toLowerCase()}`, `raw:${w.platform}:${w.handle.toLowerCase()}`]);
      const rows = keys.length ? await db.select().from(discoveryCache).where(inArray(discoveryCache.key, keys)) : [];
      const byKey = new Map(rows.map((r) => [r.key, r.payload]));
      const out = [];
      for (const w of wanted) {
        const a = byKey.get(`analytics:${w.platform}:${w.handle.toLowerCase()}`);
        if (!a) continue;
        const full = JSON.parse(a);
        const acct = byKey.get(`raw:${w.platform}:${w.handle.toLowerCase()}`);
        const p = buildProfile(w.platform, w.handle, full.raw, acct ? JSON.parse(acct) : null, full.fetchedAt);
        const aud = p.audiences.followers ?? p.audiences.likers ?? p.audiences.commenters ?? null;
        if (!aud) continue;
        out.push({
          platform: w.platform,
          handle: w.handle,
          name: w.card?.name ?? p.identity.name,
          picture: w.card?.picture || (acct ? pic(w.platform, w.handle, String(JSON.parse(acct).profile_picture_hd ?? JSON.parse(acct).profile_picture ?? "")) : p.identity.picture),
          show: w.card?.verified?.show ?? "",
          verified: !!w.card,
          branch: w.card?.branch ?? "",
          followers: w.card?.followers ?? p.identity.followers,
          engagement: w.card?.engagement ?? p.signals.engagementRate,
          realReach: p.signals.realReach,
          realPct: p.signals.realPct,
          credibility: aud.credibility,
          credibilityClass: aud.credibilityClass,
          types: aud.types,
          topCountry: p.signals.topCountry,
          femalePct: p.signals.femalePct,
          postsPerWeek: p.signals.postsPerWeek,
          interests: aud.interests.slice(0, 3).map((i) => ({ name: i.name, pct: i.pct })),
          // The whole profile, for the demo panel to render as the real thing.
          profile: p,
        });
        if (out.length >= 14) break;
      }
      // Featured first, then the ones with a full audience reading, so the demo has something to show.
      return out
        .map((x, k) => ({ x, k, rank: SHOWCASE.includes(`${x.platform}:${x.handle}`) ? 0 : x.credibility != null ? 1 : 2 }))
        .sort((a, b) => a.rank - b.rank || a.k - b.k)
        .slice(0, 10)
        .map(({ x }) => x);
    }),
  );

  // ---- Admin: buy the analytics for a page of results, to fill the list columns ----
  //      0.8 credits a creator the first time, nothing after. Admin only: it spends.
  app.post("/api/admin/discover/fill", (req, res) =>
    send(res, async () => {
      const adminKey = String(req.get("x-admin-password") ?? "");
      if (!getAdminEmail(req) && !(adminKey && adminKey === (await storage.getFeaturedEvent()).adminPassword)) throw new HttpError(403, "Only an admin can spend credits on this.");
      const rows = (Array.isArray(req.body?.rows) ? req.body.rows : []).slice(0, 12)
        .map((r: any) => ({ platform: asPlatform(r?.platform), handle: String(r?.handle ?? "").replace(/^@/, "").trim().slice(0, 100) }))
        .filter((r: { handle: string }) => r.handle);
      let bought = 0;
      await Promise.all(rows.map(async (r: { platform: string; handle: string }) => {
        const k = `analytics:${r.platform}:${r.handle.toLowerCase()}`;
        if (await isFresh(k, 30 * DAY)) return;
        await cached(k, 30 * DAY, async () => normalizeAnalytics(r.platform, r.handle, await ic("/creators/enrich/handle/analytics/", { handle: r.handle, platform: r.platform, include_lookalikes: false }))).then(() => { bought++; }).catch(() => null);
      }));
      return { rows: await withExtras(rows), bought, credits: Math.round(bought * 0.8 * 100) / 100 };
    }),
  );

  app.get("/api/discover/pic/:platform/:handle", async (req, res) => {
    const platform = asPlatform(req.params.platform);
    const handle = String(req.params.handle ?? "").toLowerCase().slice(0, 100);
    const saved = await savePicture(platform, handle, String(req.query.u ?? "")).catch(() => null);
    if (!saved) return res.status(404).end();
    res.set("Cache-Control", "public, max-age=86400, s-maxage=2592000");
    res.redirect(302, saved);
  });

  /**
   * Creator pictures, through us: their links expire in a day and some CDNs
   * refuse to be shown on another site. Only image hosts we expect.
   */
  app.get("/api/discover/img", async (req, res) => {
    const u = String(req.query.u ?? "");
    let url: URL;
    try {
      url = new URL(u);
    } catch {
      return res.status(400).end();
    }
    const okHost = /(^|\.)(cdninstagram\.com|fbcdn\.net|ytimg\.com|ggpht\.com|googleusercontent\.com|tiktokcdn(-us)?\.com|tiktokcdn\.com|ibyteimg\.com|twimg\.com|jtvnw\.net|influencers\.club|amazonaws\.com|cloudfront\.net|imgix\.net|influencersclub\.workers\.dev|onsocial\.ai)$/i.test(url.hostname);
    if (url.protocol !== "https:" || !okHost) return res.status(404).end();
    try {
      const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
      const type = r.headers.get("content-type") ?? "";
      if (!r.ok || !type.startsWith("image/")) return res.status(404).end();
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 3_000_000) return res.status(413).end();
      res.set("Content-Type", type);
      res.set("Cache-Control", "public, max-age=86400, s-maxage=604800");
      res.send(buf);
    } catch {
      res.status(404).end();
    }
  });
}

// ---------------------------------------------------------------------------
// Analytics, read defensively: the per-platform shapes are only partly
// documented, so each figure is read from its likely keys and the raw
// answer is kept in the cache for correcting the readers later.
// ---------------------------------------------------------------------------

function normalizeAnalytics(platform: string, handle: string, r: any) {
  const res0 = r?.result ?? r ?? {};
  const p = res0[platform] ?? res0;
  const weighted = (arr: any, n: number, nameKey = "name") =>
    (Array.isArray(arr) ? arr : [])
      .map((x: any) => ({ name: String(x?.[nameKey] ?? x?.code ?? ""), pct: Math.round((num(x?.weight) ?? 0) * 1000) / 10 }))
      .filter((x: { name: string; pct: number }) => x.name && x.pct > 0)
      .slice(0, n);
  // Follower growth: "12_months_ago: -3.4" and so on, oldest first.
  const g = pick(p, "creator_follower_growth") ?? {};
  const growth = Object.entries(g)
    .map(([k, v]) => ({ monthsAgo: Number(String(k).match(/\d+/)?.[0] ?? 0), pct: num(v) }))
    .filter((x) => x.monthsAgo && x.pct != null)
    .sort((a, b) => b.monthsAgo - a.monthsAgo) as { monthsAgo: number; pct: number }[];
  const aud = pick(p, "audience.audience_followers.data") ?? {};
  const types = Object.fromEntries((Array.isArray(aud.audience_types) ? aud.audience_types : []).map((t: any) => [String(t?.code), Math.round((num(t?.weight) ?? 0) * 1000) / 10]));
  const genders = Object.fromEntries((Array.isArray(aud.audience_genders) ? aud.audience_genders : []).map((t: any) => [String(t?.code).toLowerCase(), Math.round((num(t?.weight) ?? 0) * 1000) / 10]));
  const hashtags = (Array.isArray(p.hashtags_count) ? p.hashtags_count.map((h: any) => String(h?.name ?? "")) : Array.isArray(p.hashtags) ? p.hashtags.map(String) : [])
    .filter((h: string) => h && h.length > 1)
    .slice(0, 16);
  const unique = (xs: any[]) => Array.from(new Set(xs.map((x) => String(x)).filter(Boolean)));
  return {
    platform,
    handle,
    incomeMin: num(pick(p, "income.min")),
    incomeMax: num(pick(p, "income.max")),
    likesMedian: num(pick(p, "likes_median")),
    commentsMedian: num(pick(p, "comments_median")),
    reelsPercent: num(pick(p, "reels_percentage_last_12_posts")),
    reelsMedianViews: num(pick(p, "reels.median_view_count", "reels.avg_view_count")),
    growth,
    hashtags,
    brandsMentioned: unique(Array.isArray(p.brands_found) ? p.brands_found : []).slice(0, 12),
    collaborators: unique((Array.isArray(p.tagged) ? p.tagged : []).map((t: any) => t?.username).filter((u: string) => u && u.toLowerCase() !== handle.toLowerCase())).slice(0, 10),
    pastSponsors: (Array.isArray(p.past_sponsors) ? p.past_sponsors : []).map((s: any) => ({ brand: String(s?.brand_handle ?? s?.brand ?? s?.username ?? ""), posts: num(s?.post_count ?? s?.posts), lastSeen: String(s?.last_seen ?? "") })).filter((s: any) => s.brand).slice(0, 12),
    promotesAffiliates: pick(p, "promotes_affiliate_links") ?? null,
    hasMerch: pick(p, "has_merch") ?? null,
    audience: {
      credibility: num(aud.audience_credibility) != null ? Math.round((num(aud.audience_credibility) as number) * 100) : null,
      credibilityClass: String(aud.credibility_class ?? ""),
      realPct: types.real ?? null,
      suspiciousPct: types.suspicious ?? null,
      massFollowersPct: types.mass_followers ?? null,
      influencersPct: types.influencers ?? null,
      femalePct: genders.female ?? null,
      malePct: genders.male ?? null,
      ages: weighted(aud.audience_ages, 6, "code"),
      countries: weighted(aud.audience_geo?.countries, 5),
      states: weighted(aud.audience_geo?.states, 5),
      cities: weighted(aud.audience_geo?.cities, 5),
      languages: weighted(aud.audience_languages, 3),
      interests: weighted(aud.audience_interests, 8),
      brandAffinity: weighted(aud.audience_brand_affinity, 10),
    },
    fetchedAt: new Date().toISOString(),
    raw: res0,
  };
}
