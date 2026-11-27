import { resolveFeed } from "./podcastIntake.js";
import type { Express, Request } from "express";
import crypto from "node:crypto";
import multer from "multer";
import sharp from "sharp";
import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db, storage, schemaIsReady, inTransaction } from "./storage.js";
import { withCredits } from "./roomKit.js";
import { recordingShow, showFor } from "./hostShows.js";
import { fillFooter } from "../shared/footer.js";
import { hostedSpots, type HostedSpotRow } from "../shared/schema.js";
import { requireHostSession, getSessionEmail } from "./session.js";
import { putRecordingObject, signedRecordingUrl } from "./recordingStorage.js";
import { uploadPhoto } from "./photoStorage.js";
import { sendPodcastOwnerCodeEmail } from "./email.js";
import { isUploadPostConfigured, publishVideo } from "./uploadPost.js";
import { toTrash } from "./trash.js";
import { slackNote } from "./slack.js";
import { XMLParser } from "fast-xml-parser";
import Anthropic from "@anthropic-ai/sdk";
import { waitUntil } from "@vercel/functions";
import { isListenNotesConfigured, submitToListenNotes, spendListenNotes } from "./listenNotes.js";
import { showTranscripts, recordings, hostedFeedHits, bioPages, hostPosts, hostedShows, hostedEpisodes, hostedDownloads, type HostedShowRow, type HostedEpisodeRow, type CleanResult, type PodcastStatsData } from "../shared/schema.js";

/**
 * Podcast hosting, all MilitaryVoices: a podcaster's show and its episodes,
 * served as an RSS feed Apple, Spotify and every other app read, with every
 * play counted on the way to the file.
 *
 * - The feed: /feed/<slug>. Apple's tags (itunes:*), plus the Podcasting 2.0
 *   ones that matter (podcast:guid, podcast:locked).
 * - The audio: /e/<episodeId>.<ext>, which counts the download and hands the
 *   app a short-lived link to the file in R2 (or at the old host, for an
 *   episode that came with an imported show).
 * - Counting, the way sponsors count (IAB-style): a request for the start of
 *   the file (no Range, or bytes=0-), not a HEAD, not a bot, once per
 *   listener per episode per day. The listener is a hash of IP, user agent
 *   and the day, so nobody's address is kept.
 */

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const feedUrl = (slug: string) => `${ORIGIN}/feed/${slug}`;
const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

// Apple's categories (the ones a military or veteran show lands in, and the rest of the top level).
export const CATEGORIES: Record<string, string[]> = {
  Government: [],
  History: [],
  "News": ["Politics", "Daily News", "News Commentary"],
  "Society & Culture": ["Personal Journals", "Documentary", "Philosophy", "Relationships"],
  "Health & Fitness": ["Mental Health", "Fitness", "Medicine"],
  Business: ["Entrepreneurship", "Careers", "Leadership", "Management"],
  Education: ["Self-Improvement", "How To"],
  "True Crime": [],
  Sports: [],
  Comedy: [],
  "Religion & Spirituality": ["Christianity", "Spirituality"],
  "Kids & Family": ["Parenting"],
  "TV & Film": [],
  Technology: [],
  Arts: [],
  Music: [],
  Science: [],
  Fiction: [],
  Leisure: ["Hobbies", "Automotive", "Aviation"],
};

// ---- Helpers ------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
const notesHtml = (s: string) => s.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`).join("");
const rfc822 = (iso: string) => new Date(iso).toUTCString();
/** Show notes as plain text for the public page: tags out (an imported feed's HTML is never put on our page), paragraphs kept. */
const notesText = (html: string) => html
  .replace(/<(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<[^>]+>/g, "")
  .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
/** A show's description as plain words: one that came in with tags (from an old host) loses them; plain text is left alone. */
/** The show's intro, outro and sponsor spots on an episode. What an episode is made from: when any part changes, the worker makes it again. */
/** The intro an episode gets: its own (a teaser about it) when it has one, else the show's. */
export const introOf = (s: HostedShowRow, e: HostedEpisodeRow) => e.introKey || s.introKey;
export const wantsBookends = (s: HostedShowRow, e: HostedEpisodeRow) =>
  !!(introOf(s, e) || s.outroKey) && !!e.audioKey && e.bookends !== "off" && (e.bookends === "on" || (!!s.bookendsSince && e.createdAt >= s.bookendsSince));
const spotLive = (sp: HostedSpotRow, day: string) => sp.active && (!sp.startsOn || sp.startsOn <= day) && (!sp.endsOn || sp.endsOn >= day);
const spotApplies = (sp: HostedSpotRow, e: HostedEpisodeRow) =>
  !e.spotsOff && !!e.audioKey && (sp.episodeId ? sp.episodeId === e.id : sp.scope === "all" || (sp.scope === "full" ? e.episodeType === "full" : e.createdAt >= sp.createdAt));
type Seg = { key: string; start?: number; end?: number };
/** In play order: intro, the before-spot, the episode (cut where mid-roll spots go), the after-spot, outro. One before and one after at a time (the newest). */
function planOf(s: HostedShowRow, e: HostedEpisodeRow, spots: HostedSpotRow[]) {
  const day = new Date().toISOString().slice(0, 10);
  const mine = spots.filter((x) => x.showId === s.id && spotLive(x, day) && spotApplies(x, e));
  const pick = (kind: string) => mine.filter((x) => x.kind === kind).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const pre = pick("pre"), post = pick("post");
  // Mid-rolls sit inside this episode's own audio; one per moment, none at the very start or end.
  const mids = mine.filter((x) => x.kind === "mid" && x.atSec > 0 && (!e.durationSec || x.atSec < e.durationSec - 5)).sort((a, b) => a.atSec - b.atSec).slice(0, 3);
  const bk = wantsBookends(s, e);
  const segs: Seg[] = [];
  if (bk && introOf(s, e)) segs.push({ key: introOf(s, e) });
  if (pre) segs.push({ key: pre.audioKey });
  let at = 0;
  for (const m of mids) { segs.push({ key: "main", start: at, end: m.atSec }); segs.push({ key: m.audioKey }); at = m.atSec; }
  segs.push(mids.length ? { key: "main", start: at } : { key: "main" });
  if (post) segs.push({ key: post.audioKey });
  if (bk && s.outroKey) segs.push({ key: s.outroKey });
  const any = segs.length > 1;
  const parts = segs.map((x) => x.key);
  const sig = crypto.createHash("sha1").update(segs.map((x) => `${x.key === "main" ? e.audioKey : x.key}@${x.start ?? ""}-${x.end ?? ""}`).join("|")).digest("hex").slice(0, 16);
  return { any, parts, segs, hasMid: mids.length > 0, sig, spotIds: [pre?.id, ...mids.map((m) => m.id), post?.id].filter((x): x is number => !!x).join(",") };
}
/** The finished episode (with whatever goes before and after it) when it is ready and still current; null: serve the original. */
const served = (s: HostedShowRow, e: HostedEpisodeRow, spots: HostedSpotRow[] = []) => { const p = planOf(s, e, spots); return p.any && e.servedKey && e.servedSig === p.sig ? { key: e.servedKey, size: e.servedSize, sec: e.servedSec, v: e.servedSig.slice(0, 8) } : null; };
const plainDesc = (d: string) => (/<[a-z!/][^>]*>|&(nbsp|amp|#\d+);/i.test(d) ? notesText(d) : d);
const extOf = (mime: string) => (/mp4|m4a|aac/.test(mime) ? (mime.startsWith("video") ? "mp4" : "m4a") : "mp3");

/** podcast:guid: a UUIDv5 of the feed address without its scheme, in the Podcasting 2.0 namespace. */
export function podcastGuid(url: string): string {
  const ns = Buffer.from("ead4c236bf5858c6a2c6a6b28d128cb6", "hex");
  const h = crypto.createHash("sha1").update(Buffer.concat([ns, Buffer.from(url.replace(/^[a-z]+:\/\//i, "").replace(/\/+$/, ""))])).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "show";
}

async function uniqueSlug(base: string, notId?: number): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const s = i ? `${base}-${i + 1}` : base;
    const [hit] = await db.select({ id: hostedShows.id }).from(hostedShows).where(eq(hostedShows.slug, s)).limit(1);
    if (!hit || hit.id === notId) return s;
  }
  return `${base}-${crypto.randomBytes(3).toString("hex")}`;
}

/** Which app asked for the file, from its user agent. */
/** Spotify's own copy of an episode: kept as a row, never counted as a download. */
export const SPOTIFY_COPIES = "Spotify (copies)";
const listens = () => sql`${hostedDownloads.app} <> ${SPOTIFY_COPIES}`;
/** The app on a download row. Spotify fetches a file once and plays its own copy to listeners, so its fetch is a copy, not a listener (Andrew, 20 Nov). */
const downloadApp = (ua: string) => { const a = appOf(ua); return a === "Spotify" ? SPOTIFY_COPIES : a; };

function appOf(ua: string): string {
  const u = ua.toLowerCase();
  if (/applecoremedia|apple ?podcasts|podcasts\/\d|itunes|itms/.test(u)) return "Apple Podcasts";
  if (/spotify/.test(u)) return "Spotify";
  if (/overcast/.test(u)) return "Overcast";
  if (/pocket ?casts/.test(u)) return "Pocket Casts";
  if (/castbox/.test(u)) return "Castbox";
  if (/podcast ?addict/.test(u)) return "Podcast Addict";
  if (/castro/.test(u)) return "Castro";
  if (/amazon|alexa|audible/.test(u)) return "Amazon Music";
  if (/iheart/.test(u)) return "iHeartRadio";
  if (/youtube|google/.test(u)) return "Google / YouTube";
  if (/podbean|podcast republic|antennapod|player\.fm|goodpods|fountain|podverse|truefans/.test(u)) return (u.match(/podbean|podcast republic|antennapod|player\.fm|goodpods|fountain|podverse|truefans/)![0]).replace(/\b\w/g, (c) => c.toUpperCase());
  if (/mozilla|chrome|safari|firefox|edg\//.test(u)) return "Web browser";
  return "Other";
}

// Not a listener: crawlers, link previews, monitors and scripts.
const BOT = /bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|embedly|curl\/|wget|python-requests|python-urllib|go-http-client|okhttp\/[0-4]\.|java\/|libwww|httpclient|axios|node-fetch|headless|lighthouse|pingdom|uptime|monitor|feedvalidator|podcastindex|podnews|podchaser|listennotes|chartable|podtrac-?check/i;

// ---- Reading another host's feed ------------------------------------------------------

/** Only public web addresses: no local names, no bare IPs (a feed address is fetched from the server). */
function safeFeedUrl(u: string): boolean {
  let x: URL;
  try { x = new URL(u); } catch { return false; }
  if (!/^https?:$/.test(x.protocol)) return false;
  const h = x.hostname.toLowerCase();
  if (!h.includes(".") || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^[\d.]+$/.test(h) || h.includes(":") || h.startsWith("[")) return false;
  return true;
}

type ParsedItem = { title: string; notes: string; url: string; mime: string; length: number; guid: string; published: string; duration: number; episode: number | null; season: number | null; episodeType: string; explicit: boolean; image: string };
type ParsedFeed = { title: string; description: string; author: string; ownerName: string; ownerEmail: string; artwork: string; category: string; subcategory: string; language: string; explicit: boolean; type: string; link: string; copyright: string; guid: string; items: ParsedItem[] };

const txt = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v).trim();
  if (Array.isArray(v)) return txt(v[0]);
  if (typeof v === "object") return txt((v as Record<string, unknown>)["#text"] ?? (v as Record<string, unknown>)["__cdata"] ?? "");
  return "";
};
/** Some hosts write "Isn&#39;t" into a title; ours is plain text (the feed escapes it once), so read those back to real characters. */
const plain = (s: string): string => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
  .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attr = (v: unknown, k: string): string => (v && typeof v === "object" ? txt((Array.isArray(v) ? v[0] : v as Record<string, unknown>)?.[`@_${k}`]) : "");
const list = <T,>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const yes = (v: unknown) => /^(yes|true|explicit)$/i.test(txt(v));
function dur(v: unknown): number {
  const s = txt(v);
  if (!s) return 0;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const p = s.split(":").map(Number);
  return p.some(Number.isNaN) ? 0 : Math.round(p.reduce((a, n) => a * 60 + n, 0));
}
const intOrNull = (v: unknown) => { const n = parseInt(txt(v), 10); return Number.isFinite(n) && n >= 0 ? n : null; };

export async function readFeed(url: string): Promise<ParsedFeed> {
  let r: Response;
  try {
    r = await fetch(url, { headers: { "User-Agent": "MilitaryVoices.ai podcast import", Accept: "application/rss+xml, application/xml, text/xml, */*" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new Error("We couldn't reach that address. Check it's your show's RSS feed.");
  }
  if (!r.ok) throw new Error(`The old host answered ${r.status} for that address.`);
  const xml = await r.text();
  if (xml.length > 40_000_000) throw new Error("That feed is too big to read in one go.");
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", cdataPropName: "__cdata", parseTagValue: false, trimValues: true }).parse(xml);
  const ch = doc?.rss?.channel;
  if (!ch) throw new Error("That address isn't a podcast RSS feed.");
  const cat = list(ch["itunes:category"])[0] as Record<string, unknown> | undefined;
  const items = list(ch.item as Record<string, unknown>[]).map((it): ParsedItem | null => {
    const enc = list(it.enclosure as Record<string, unknown>[])[0];
    const u = attr(enc, "url");
    if (!/^https?:\/\//.test(u)) return null;
    const pub = Date.parse(txt(it.pubDate));
    return {
      title: plain(txt(it.title)) || "Untitled episode",
      notes: txt(it["content:encoded"]) || txt(it.description) || txt(it["itunes:summary"]),
      url: u, mime: attr(enc, "type") || "audio/mpeg", length: Math.max(0, parseInt(attr(enc, "length"), 10) || 0),
      guid: txt(it.guid) || u,
      published: Number.isNaN(pub) ? "" : new Date(pub).toISOString(),
      duration: dur(it["itunes:duration"]),
      episode: intOrNull(it["itunes:episode"]), season: intOrNull(it["itunes:season"]),
      episodeType: ["full", "trailer", "bonus"].includes(txt(it["itunes:episodeType"])) ? txt(it["itunes:episodeType"]) : "full",
      explicit: yes(it["itunes:explicit"]), image: attr(it["itunes:image"], "href"),
    };
  }).filter((x): x is ParsedItem => !!x);
  const owner = (ch["itunes:owner"] ?? {}) as Record<string, unknown>;
  return {
    title: plain(txt(ch.title)), description: txt(ch.description) || txt(ch["itunes:summary"]), author: txt(ch["itunes:author"]),
    ownerName: txt(owner["itunes:name"]), ownerEmail: txt(owner["itunes:email"]),
    artwork: attr(ch["itunes:image"], "href") || txt((ch.image as Record<string, unknown> | undefined)?.url),
    category: attr(cat, "text"), subcategory: attr(cat?.["itunes:category"], "text"),
    language: txt(ch.language), explicit: yes(ch["itunes:explicit"]), type: txt(ch["itunes:type"]) === "serial" ? "serial" : "episodic",
    link: txt(ch.link), copyright: txt(ch.copyright), guid: txt(ch["podcast:guid"]),
    items,
  };
}

// ---- Data -----------------------------------------------------------------------

/** The shows they work on: an archived one is left out everywhere they pick a show (it still has its feed and pages). */
async function showsOf(email: string) {
  return db.select().from(hostedShows).where(and(eq(hostedShows.email, email), eq(hostedShows.archivedAt, ""))).orderBy(hostedShows.id);
}
/** Archive or bring back one show. Never the last one in use: they'd have nothing to work on. */
export async function setShowArchived(showId: number, on: boolean): Promise<{ error?: string; show?: HostedShowRow }> {
  await schemaIsReady();
  const [s] = await db.select().from(hostedShows).where(eq(hostedShows.id, showId)).limit(1);
  if (!s) return { error: "No such show." };
  if (on && !s.archivedAt) {
    const inUse = await showsOf(s.email);
    if (!inUse.some((x) => x.id !== s.id)) return { error: "That's their only show in use, so it stays. Archive a show when there's another one to work on." };
  }
  const t = now();
  const [out] = await db.update(hostedShows).set({ archivedAt: on ? s.archivedAt || t : "", updatedAt: t }).where(eq(hostedShows.id, s.id)).returning();
  return { show: out };
}
/** Whether this person has the Production plan (the team's post-production), set when it is switched on for them. */
async function hasProduction(email: string): Promise<boolean> {
  try { return !!(JSON.parse((await storage.getSetting(`package:${email.trim().toLowerCase()}`)) ?? "{}") as { on?: boolean }).on; } catch { return false; }
}

async function ownShow(email: string, id: number) {
  const [s] = await db.select().from(hostedShows).where(and(eq(hostedShows.id, id), eq(hostedShows.email, email))).limit(1);
  return s ?? null;
}
/**
 * The number a new full episode gets: one past the highest number the show has used, so gaps and unnumbered
 * episodes in an imported back catalogue don't push it ahead (Frank's 57 came after 54 when this was a count).
 */
function nextEpisodeNumber(eps: { episodeType: string; episodeNumber: number | null }[]): number {
  const full = eps.filter((x) => x.episodeType === "full");
  const nums = full.map((x) => x.episodeNumber).filter((n): n is number => typeof n === "number" && n > 0);
  return nums.length ? Math.max(...nums) + 1 : full.length + 1;
}

async function episodesOf(showId: number) {
  await schemaIsReady(); // a new column is added on the first request after a deploy; wait for it
  return db.select().from(hostedEpisodes).where(eq(hostedEpisodes.showId, showId)).orderBy(desc(hostedEpisodes.publishedAt), desc(hostedEpisodes.id));
}
const live = (e: HostedEpisodeRow) => e.status === "published" && !!e.publishedAt && Date.parse(e.publishedAt) <= Date.now() && !!(e.audioKey || e.audioUrl);

/** Our own storage (the photos bucket): art kept there stays when an old host's account closes. */
const ours = (url: string) => /\/storage\/v1\/object\/public\//.test(url);

/**
 * For a show that moved here: its cover art copied to our storage (square, at most 3000, a JPEG
 * Apple takes), and Apple's listing found by the old feed or ours, saved as live in Directories.
 */
export async function findListings(s: HostedShowRow): Promise<HostedShowRow> {
  const set: Partial<HostedShowRow> = {};
  if (s.artworkUrl && !ours(s.artworkUrl) && safeFeedUrl(s.artworkUrl)) {
    try {
      const r = await fetch(s.artworkUrl, { signal: AbortSignal.timeout(30_000) });
      const buf = Buffer.from(await r.arrayBuffer());
      if (r.ok && buf.length < 25_000_000) {
        const meta = await sharp(buf).metadata();
        const side = Math.min(3000, Math.min(meta.width ?? 0, meta.height ?? 0));
        if (side >= 600) {
          const img = await sharp(buf).rotate().resize(side, side, { fit: "cover", position: "attention" }).jpeg({ quality: 88 }).toBuffer();
          set.artworkUrl = await uploadPhoto(`podcast-art/${s.id}-${Date.now()}.jpg`, img, "image/jpeg");
        }
      }
    } catch (err) { console.warn("Cover art copy failed:", (err as Error).message); }
  }
  const dirs = (() => { try { return JSON.parse(s.directories || "{}") as Record<string, { state: string; url: string; at?: string }>; } catch { return {}; } })();
  if (!dirs.apple?.url && !s.appleUrl) {
    try {
      const norm = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
      const feeds = new Set([s.importedFrom, feedUrl(s.slug)].filter(Boolean).map(norm));
      const r = await fetch(`https://itunes.apple.com/search?${new URLSearchParams({ term: s.title, entity: "podcast", limit: "25" })}`, { signal: AbortSignal.timeout(15_000) });
      const j = (await r.json().catch(() => ({}))) as { results?: { feedUrl?: string; collectionViewUrl?: string }[] };
      const hit = (j.results ?? []).find((x) => x.feedUrl && feeds.has(norm(x.feedUrl)));
      if (hit?.collectionViewUrl) {
        const url = hit.collectionViewUrl.replace(/\?.*$/, "");
        dirs.apple = { state: "live", url, at: now() };
        set.appleUrl = url;
        set.directories = JSON.stringify(dirs);
      }
    } catch (err) { console.warn("Apple lookup failed:", (err as Error).message); }
  }
  if (!Object.keys(set).length) return s;
  const [out] = await db.update(hostedShows).set({ ...set, updatedAt: now() }).where(eq(hostedShows.id, s.id)).returning();
  return out;
}

/** What's missing before Apple will take the feed. */
function readiness(s: HostedShowRow, eps: HostedEpisodeRow[]): string[] {
  const out: string[] = [];
  if (!s.title.trim()) out.push("A show name");
  if (s.description.trim().length < 20) out.push("A description (a sentence or two)");
  if (!s.artworkUrl) out.push("Cover art (square, at least 1400 pixels)");
  if (!s.ownerEmail.trim()) out.push("An owner email (Apple and Spotify send the confirmation there)");
  else if (feedOwnerEmail(s) !== s.ownerEmail.trim()) out.push("Confirm the owner email (until then the feed uses your sign-in email)");
  if (!eps.some(live)) out.push("One published episode");
  return out;
}

// ---- The feed ---------------------------------------------------------------------

/** The owner email the feed may carry: the one they confirmed, or else the one they sign in with. */
export const feedOwnerEmail = (s: HostedShowRow) => (s.ownerEmail && s.ownerEmailVerified === s.ownerEmail.trim().toLowerCase() ? s.ownerEmail.trim() : s.email);

/** The show's footer for one episode, as the feed's HTML ("" when the show has none or the episode leaves it off). */
function footerText(s: HostedShowRow, e: HostedEpisodeRow): string {
  if (e.footerOff || !s.episodeFooter?.trim()) return "";
  return fillFooter(s.episodeFooter, { title: e.title, number: e.episodeNumber, season: e.season, guest: e.guest });
}
const footerHtml = (s: HostedShowRow, e: HostedEpisodeRow): string => { const t = footerText(s, e); return t ? notesHtml(t) : ""; };

export function feedXml(s: HostedShowRow, eps: HostedEpisodeRow[], spots: HostedSpotRow[] = []): string {
  const self = feedUrl(s.slug);
  const owner = feedOwnerEmail(s);
  const notes = (e: HostedEpisodeRow) => (e.notesFormat === "html" ? e.description : notesHtml(e.description)) + footerHtml(s, e);
  const link = s.website || `${ORIGIN}/podcast/${s.slug}`;
  const cat = s.subcategory
    ? `<itunes:category text="${esc(s.category)}"><itunes:category text="${esc(s.subcategory)}"/></itunes:category>`
    : `<itunes:category text="${esc(s.category)}"/>`;
  const items = eps.filter(live).map((e) => {
    const sv = served(s, e, spots);
    const url = `${ORIGIN}/e/${e.id}${sv ? `-${sv.v}` : ""}.${extOf(sv ? "audio/mpeg" : e.mime)}`;
    return `
    <item>
      <title>${esc(e.title)}</title>
      <description>${cdata(notes(e))}</description>
      <content:encoded>${cdata(notes(e))}</content:encoded>
      <enclosure url="${esc(url)}" length="${(sv ? sv.size : e.sizeBytes) || 0}" type="${esc(sv ? "audio/mpeg" : e.mime)}"/>
      <guid isPermaLink="false">${esc(e.guid || `mv-${e.id}`)}</guid>
      <pubDate>${rfc822(e.publishedAt)}</pubDate>
      ${(sv ? sv.sec : e.durationSec) ? `<itunes:duration>${sv ? sv.sec : e.durationSec}</itunes:duration>` : ""}
      ${e.episodeNumber != null ? `<itunes:episode>${e.episodeNumber}</itunes:episode>` : ""}
      ${e.season != null ? `<itunes:season>${e.season}</itunes:season>` : ""}
      <itunes:episodeType>${esc(e.episodeType)}</itunes:episodeType>
      <itunes:explicit>${e.explicit ? "true" : "false"}</itunes:explicit>
      ${e.artworkUrl ? `<itunes:image href="${esc(e.artworkUrl)}"/>` : ""}
    </item>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>${esc(s.title)}</title>
    <link>${esc(link)}</link>
    <atom:link href="${esc(self)}" rel="self" type="application/rss+xml"/>
    <atom:link href="${WEBSUB_HUB}" rel="hub"/>
    <language>${esc(s.language)}</language>
    <description>${cdata(plainDesc(s.description))}</description>
    <itunes:summary>${cdata(plainDesc(s.description))}</itunes:summary>
    <itunes:author>${esc(s.author || s.ownerName || s.title)}</itunes:author>
    <itunes:owner><itunes:name>${esc(s.ownerName || s.author)}</itunes:name><itunes:email>${esc(owner)}</itunes:email></itunes:owner>
    ${s.artworkUrl ? `<itunes:image href="${esc(s.artworkUrl)}"/>
    <image><url>${esc(s.artworkUrl)}</url><title>${esc(s.title)}</title><link>${esc(link)}</link></image>` : ""}
    ${cat}
    <itunes:explicit>${s.explicit ? "true" : "false"}</itunes:explicit>
    <itunes:type>${s.showType === "serial" ? "serial" : "episodic"}</itunes:type>
    ${s.copyright ? `<copyright>${esc(s.copyright)}</copyright>` : ""}
    <podcast:guid>${s.guid || podcastGuid(self)}</podcast:guid>
    <podcast:locked owner="${esc(owner)}">no</podcast:locked>${s.newFeedUrl ? `
    <itunes:new-feed-url>${esc(s.newFeedUrl)}</itunes:new-feed-url>` : ""}
    <generator>MilitaryVoices.ai</generator>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${items}
  </channel>
</rss>`;
}

// ---- Stats ------------------------------------------------------------------------

export async function showStats(showId: number, days = 30) {
  const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  // Downloads are listeners: Spotify's own copies are left out (its listeners play from Spotify's servers).
  const [tot] = await db.select({ n: sql<number>`count(*)::int` }).from(hostedDownloads).where(and(eq(hostedDownloads.showId, showId), listens()));
  const byDay = await db.select({ day: hostedDownloads.day, n: sql<number>`count(*)::int` }).from(hostedDownloads)
    .where(and(eq(hostedDownloads.showId, showId), gte(hostedDownloads.day, since), listens())).groupBy(hostedDownloads.day);
  const byEp = await db.select({ id: hostedDownloads.episodeId, n: sql<number>`count(*)::int` }).from(hostedDownloads)
    .where(and(eq(hostedDownloads.showId, showId), listens())).groupBy(hostedDownloads.episodeId);
  const byApp = await db.select({ app: hostedDownloads.app, n: sql<number>`count(*)::int` }).from(hostedDownloads)
    .where(and(eq(hostedDownloads.showId, showId), gte(hostedDownloads.day, since), listens())).groupBy(hostedDownloads.app);
  const map = new Map(byDay.map((r) => [r.day, r.n]));
  const series = Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().slice(0, 10);
    return { date: d, count: map.get(d) ?? 0 };
  });
  return { total: tot?.n ?? 0, series, episodes: new Map(byEp.map((r) => [r.id, r.n])), apps: Object.fromEntries(byApp.map((r) => [r.app || "Other", r.n])) };
}

/**
 * Every day a show has been counted, for the date ranges on Podcast analytics (Andrew, 21 Nov:
 * "Add dates to the analytics"): the whole series from its first download, and each
 * episode's and each app's days (only days with downloads), so any range adds up.
 */
async function showHistory(showId: number) {
  const rows = await db.select({ day: hostedDownloads.day, ep: hostedDownloads.episodeId, app: hostedDownloads.app, n: sql<number>`count(*)::int` }).from(hostedDownloads)
    .where(and(eq(hostedDownloads.showId, showId), listens())).groupBy(hostedDownloads.day, hostedDownloads.episodeId, hostedDownloads.app);
  const byDay = new Map<string, number>();
  const epDays = new Map<number, Record<string, number>>();
  const appDays: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.n);
    const e = epDays.get(r.ep) ?? {};
    e[r.day] = (e[r.day] ?? 0) + r.n;
    epDays.set(r.ep, e);
    const a = (appDays[r.app || "Other"] ??= {});
    a[r.day] = (a[r.day] ?? 0) + r.n;
  }
  const today = new Date().toISOString().slice(0, 10);
  const first = Array.from(byDay.keys()).sort()[0];
  // From the first download (at most three years back), or the last 30 days when there are none yet.
  const start = first && first < today ? Math.max(Date.parse(first), Date.now() - 1095 * 86400000) : Date.now() - 29 * 86400000;
  const series: { date: string; count: number }[] = [];
  for (let t = Date.parse(new Date(start).toISOString().slice(0, 10)); ; t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    series.push({ date: d, count: byDay.get(d) ?? 0 });
    if (d >= today) break;
  }
  return { series, epDays, appDays };
}

/** The hosted show in the same shape as Buzzsprout's and the rest, for the Dashboard and Your analytics. */
export async function hostedAsStats(email: string): Promise<{ source: "militaryvoices"; showName: string; status: string; error: string; fetchedAt: string; data: PodcastStatsData }[]> {
  await schemaIsReady();
  const shows = await showsOf(email);
  const out = [];
  for (const s of shows) {
    const eps = (await episodesOf(s.id)).filter(live);
    if (!eps.length) continue;
    const st = await showStats(s.id, 30);
    const h = await showHistory(s.id);
    out.push({
      source: "militaryvoices" as const,
      showName: s.title,
      status: "ok",
      error: "",
      fetchedAt: now(),
      data: {
        total: st.total,
        unit: "downloads" as const,
        episodes: eps.map((e) => ({ title: e.title, published: e.publishedAt.slice(0, 10), count: st.episodes.get(e.id) ?? 0, days: h.epDays.get(e.id) ?? {} })),
        series: h.series,
        audience: Object.keys(st.apps).length ? { apps: st.apps } : undefined,
        appDays: h.appDays,
        from: h.series[0]?.date,
        to: h.series[h.series.length - 1]?.date,
        artwork: s.artworkUrl || undefined,
      },
    });
  }
  return out;
}

// ---- Routes -----------------------------------------------------------------------

const art = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
/** The podcaster's episodes as the Library, Pōstify and Social grids show them (newest first), with the folder each is filed in. */
export async function listHostEpisodes(email: string): Promise<Array<Record<string, unknown> & { folderId: number }>> {
  const out: Array<Record<string, unknown> & { folderId: number }> = [];
  for (const sh of await showsOf(email)) {
    for (const e of await episodesOf(sh.id)) {
      if (!(e.audioKey || e.audioUrl) && !e.recordingId) continue;
      const rec = e.recordingId ? await storage.getRecording(e.recordingId) : undefined;
      const ownRec = rec && rec.status === "Ready" && !!rec.url && rec.email.trim().toLowerCase() === email ? rec : undefined;
      const videoFile = e.mime.startsWith("video/") && !!e.audioKey;
      const [made] = await db.select({ id: recordings.id }).from(recordings).where(and(eq(recordings.email, email), eq(recordings.egressId, `PODCAST_${e.id}`))).limit(1);
      out.push({
        id: e.id, showId: sh.id, show: sh.title, title: e.title, publishedAt: e.publishedAt, status: e.status, durationSec: e.durationSec,
        art: e.artworkUrl || sh.artworkUrl, kind: ownRec || videoFile || made ? "video" : "audio", recordingId: ownRec?.id ?? made?.id ?? null,
        making: e.videoJob === "queued" || e.videoJob === "running", videoFailed: e.videoJob === "failed", folderId: e.folderId,
      });
    }
  }
  out.sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")));
  return out;
}

const emailOf = (req: Request) => (getSessionEmail(req) ?? "").trim().toLowerCase();
const num = (v: unknown) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v))));

let lastBookendScan = 0;
/** An episode that wants the show's intro, outro or a sponsor spot and doesn't have them yet: the worker joins them (original untouched). */
export async function claimEpisodeBookends(canStitch = false, canSegments = false): Promise<{ id: number; title: string; durationSec: number; audioUrl: string; introUrl: string; outroUrl: string; sig: string; parts: string[]; spots: string; sources: string[]; segments: { src: number; start?: number; end?: number }[] } | null> {
  await schemaIsReady();
  // Looking through every episode on every poll would be wasteful: once every 15 seconds is plenty.
  if (Date.now() - lastBookendScan < 15_000) return null;
  const stale = new Date(Date.now() - 30 * 60_000).toISOString();
  const spots = await db.select().from(hostedSpots);
  const ownIntro = new Set((await db.select({ showId: hostedEpisodes.showId }).from(hostedEpisodes).where(ne(hostedEpisodes.introKey, ""))).map((r) => r.showId));
  const shows = (await db.select().from(hostedShows)).filter((x) => x.introKey || x.outroKey || ownIntro.has(x.id) || spots.some((p) => p.showId === x.id));
  for (const sh of shows) {
    for (const e of await episodesOf(sh.id)) {
      const plan = planOf(sh, e, spots);
      if (!plan.any || served(sh, e, spots)) continue;
      // A worker that doesn't know sponsor spots yet only does intro and outro.
      if (!canStitch && plan.parts.length > (wantsBookends(sh, e) ? 1 + (introOf(sh, e) ? 1 : 0) + (sh.outroKey ? 1 : 0) : 1)) continue;
      // Only a worker that can cut the episode where a mid-roll goes does those.
      if (plan.hasMid && !canSegments) continue;
      if (e.bookendJob === "failed" || (e.bookendJob === "running" && e.bookendJobAt > stale)) continue;
      const got = await db.update(hostedEpisodes).set({ bookendJob: "running", bookendJobAt: now() })
        .where(and(eq(hostedEpisodes.id, e.id), eq(hostedEpisodes.bookendJob, e.bookendJob))).returning({ id: hostedEpisodes.id });
      if (!got.length) continue;
      const keys = Array.from(new Set(plan.segs.map((x) => (x.key === "main" ? e.audioKey : x.key))));
      const sources = await Promise.all(keys.map((k) => signedRecordingUrl(k, 6 * 3600)));
      const segments = plan.segs.map((x) => ({ src: keys.indexOf(x.key === "main" ? e.audioKey : x.key), start: x.start, end: x.end }));
      const urls = await Promise.all(plan.parts.map((x) => signedRecordingUrl(x === "main" ? e.audioKey : x, 6 * 3600)));
      const bk = wantsBookends(sh, e);
      return {
        id: e.id, title: e.title, durationSec: e.durationSec, audioUrl: await signedRecordingUrl(e.audioKey, 6 * 3600),
        introUrl: bk && introOf(sh, e) ? await signedRecordingUrl(introOf(sh, e), 6 * 3600) : "", outroUrl: bk && sh.outroKey ? await signedRecordingUrl(sh.outroKey, 6 * 3600) : "",
        sig: plan.sig, parts: urls, spots: plan.spotIds, sources, segments,
      };
    }
  }
  lastBookendScan = Date.now();
  return null;
}

// ---- "Write it for me" ------------------------------------------------------------------------------------
type SaidLine = [number, number, string, string];
/** What was said in an episode: its Library recording's transcript, else ours (queued for the worker the first time). */
async function episodeSaid(e: HostedEpisodeRow, email: string, again = false): Promise<{ state: "ready"; said: string } | { state: "working" } | { state: "failed"; message: string }> {
  let lines: SaidLine[] = [];
  if (e.recordingId) {
    const rec = await storage.getRecording(e.recordingId).catch(() => undefined);
    try { lines = rec?.transcriptJson ? (JSON.parse(rec.transcriptJson) as SaidLine[]) : []; } catch { lines = []; }
  }
  if (!lines.length) {
    const key = `hosted:${e.id}`;
    const [t] = await db.select().from(showTranscripts).where(and(eq(showTranscripts.email, email), eq(showTranscripts.episodeKey, key))).limit(1);
    if (!t) {
      await db.insert(showTranscripts).values({ email, episodeKey: key, title: e.title, publishedAt: e.publishedAt, audioUrl: `${ORIGIN}/e/${e.id}.mp3`, status: "queued", createdAt: now() }).onConflictDoNothing();
      return { state: "working" };
    }
    if (t.status === "failed") {
      if (!again) return { state: "failed", message: t.error || "We couldn't listen to this one." };
      await db.update(showTranscripts).set({ status: "queued", error: "" }).where(eq(showTranscripts.id, t.id));
      return { state: "working" };
    }
    if (t.status !== "done" || !t.lines) return { state: "working" };
    try { lines = JSON.parse(t.lines) as SaidLine[]; } catch { lines = []; }
  }
  const said = lines.map((l) => l[3]).join(" ").replace(/\s+/g, " ").trim();
  if (said.length < 80) return { state: "failed", message: "There wasn't enough speech in it to write from." };
  return { state: "ready", said };
}

/** The show's own recent titles and notes (without the footer), so new ones read the way the host's always have. */
async function styleExamples(s: HostedShowRow): Promise<{ title: string; notes: string }[]> {
  const eps = await db.select({ title: hostedEpisodes.title, description: hostedEpisodes.description, notesFormat: hostedEpisodes.notesFormat }).from(hostedEpisodes)
    .where(and(eq(hostedEpisodes.showId, s.id), eq(hostedEpisodes.status, "published"))).orderBy(desc(hostedEpisodes.publishedAt)).limit(8);
  const footerStart = (s.episodeFooter ?? "").trim().split("\n")[0].replace(/\{[a-z]+\}/gi, "").trim().slice(0, 12);
  return eps.map((e) => {
    let notes = (e.notesFormat === "html" ? notesText(e.description) : e.description).trim();
    for (const cut of ["🎙", footerStart].filter(Boolean)) { const i = notes.indexOf(cut); if (i > 200) notes = notes.slice(0, i).trim(); }
    return { title: e.title, notes: notes.slice(0, 1600) };
  }).filter((x) => x.notes.length > 300).slice(0, 2);
}

/** A title and plain-text show notes from what was said, in the show's own style when it has past episodes. */
export async function writeEpisodeText(show: HostedShowRow, currentTitle: string, said: string): Promise<{ title: string; description: string }> {
  const text = said.length > 48000 ? `${said.slice(0, 24000)} [...] ${said.slice(-24000)}` : said;
  const examples = await styleExamples(show).catch(() => []);
  const shape = examples.length
    ? `Write the way this show's past episodes are written (examples below): the same voice and point of view, the same kind of title, the same shape, paragraph length and overall length. Take only their style, never their facts.
Notes: plain text only (no HTML, no markdown symbols), short paragraphs with a blank line between them. Leave out any episode-number line, hashtags, links and contact details: those are added for them. Under 2000 characters.`
    : `Title: under 70 characters, plain and specific, says what the episode is about. No clickbait, no episode number, no quotation marks.
Notes: plain text only (no HTML, no markdown symbols). A short opening paragraph of two or three sentences, then a line "In this episode:" followed by 3 to 5 lines that each start with "- " and name one thing covered. Under 1500 characters in all.`;
  const client = new Anthropic();
  const r = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 2500,
    system: `You write the title and show notes for one podcast episode on MilitaryVoices.ai, a platform for military and veteran creators. Work only from the transcript.
${shape}
Invent nothing: no names, ranks, branches, numbers, dates or links that are not in the transcript (the host's name may come from the examples). Describe only what is actually said: if a list or a point is cut off, do not finish it. If a speaker is not named, do not name them. Easy to read. No em dashes. No hype words like "journey", "delve" or "unlock". No episode number in the title.
Return JSON only: {"title":"","description":""}`,
    messages: [{ role: "user", content: `Show: ${show.title}${examples.map((x, i) => `\n\nPast episode ${i + 1}\nTitle: ${x.title}\nNotes:\n${x.notes}`).join("")}\n\nCurrent title (may just be a file name): ${currentTitle}\n\nTranscript:\n${text}` }],
  });
  const out = r.content.map((c) => ("text" in c ? c.text : "")).join("");
  if (out.indexOf("{") < 0) throw new Error(`no JSON (stop: ${r.stop_reason}): ${out.slice(0, 200)}`);
  const json = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as { title?: unknown; description?: unknown };
  const title = String(json.title ?? "").replace(/^["']|["']$/g, "").trim().slice(0, 120);
  const description = String(json.description ?? "").replace(/<[^>]*>/g, "").trim().slice(0, 4000);
  if (!title || !description) throw new Error("empty");
  return { title, description };
}

/** New drafts from here on get their title and notes written for them; older ones only when queued by hand. */
const AUTO_WRITE_SINCE = "2026-11-23T00:00:00.000Z";
/** A title nobody chose: a file name, "New episode", or the one we made from the recording. */
const madeUpTitle = (t: string, recTitle = "") => !t.trim() || t.trim() === recTitle.trim() || /[_]|\.(mp3|m4a|mp4|wav|mov)$|^new episode$|\(clean\)$/i.test(t.trim());

/**
 * "Write it for me" without the click (Andrew, 23 Nov 2026: "create the title and description so he doesn't have
 * to do it"): once a new draft has its audio and a transcript, the title and notes are filled in. Only what nobody
 * wrote is filled: a typed title or typed notes stay. Runs from the 5-minute cron.
 */
export async function autoWriteSweep(limit = 3): Promise<number> {
  const rows = await db.select().from(hostedEpisodes).where(and(eq(hostedEpisodes.status, "draft"), eq(hostedEpisodes.audioJob, ""), sql`(${hostedEpisodes.autoWrite} in ('queued', 'retry') or (${hostedEpisodes.autoWrite} = '' and ${hostedEpisodes.createdAt} >= ${AUTO_WRITE_SINCE}))`, sql`(${hostedEpisodes.audioKey} <> '' or ${hostedEpisodes.audioUrl} <> '')`)).orderBy(desc(hostedEpisodes.id)).limit(20);
  let done = 0;
  for (const e of rows) {
    if (done >= limit) break;
    const [show] = await db.select().from(hostedShows).where(eq(hostedShows.id, e.showId)).limit(1);
    if (!show) continue;
    const rec = e.recordingId ? await storage.getRecording(e.recordingId).catch(() => undefined) : undefined;
    const credits = e.recordingId ? (await withCredits("", e.recordingId).catch(() => "")).trim() : "";
    const noNotes = !e.description.trim() || e.description.trim() === credits;
    const noTitle = madeUpTitle(e.title, rec?.title ?? "");
    if (!noNotes && !noTitle) { await db.update(hostedEpisodes).set({ autoWrite: "skip" }).where(eq(hostedEpisodes.id, e.id)); continue; }
    const t = await episodeSaid(e, show.email);
    if (t.state === "working") {
      // Still being transcribed; give up after three days.
      if (Date.now() - Date.parse(e.createdAt) > 3 * 86400_000) await db.update(hostedEpisodes).set({ autoWrite: "failed" }).where(eq(hostedEpisodes.id, e.id));
      continue;
    }
    if (t.state === "failed") { await db.update(hostedEpisodes).set({ autoWrite: "failed" }).where(eq(hostedEpisodes.id, e.id)); continue; }
    try {
      const w = await writeEpisodeText(show, e.title, t.said);
      // Claim it only if nobody changed it meanwhile.
      await db.update(hostedEpisodes).set({
        autoWrite: "done",
        ...(noTitle ? { title: w.title } : {}),
        ...(noNotes ? { description: credits ? `${w.description}\n\n${credits}` : w.description, notesFormat: "text" } : {}),
      }).where(and(eq(hostedEpisodes.id, e.id), eq(hostedEpisodes.title, e.title), eq(hostedEpisodes.description, e.description)));
      done++;
    } catch (err) {
      console.error("Auto-write failed:", e.id, (err as Error).message);
      // One more go on the next run, then leave it for "Write it for me".
      await db.update(hostedEpisodes).set({ autoWrite: e.autoWrite === "retry" ? "failed" : "retry" }).where(eq(hostedEpisodes.id, e.id));
    }
  }
  return done;
}

/**
 * Move episodes to another of the person's shows (Andrew, 24 Nov 2026), one or many, in one transaction so a half-move
 * can't happen. Each keeps its guid, so an app that already has it doesn't count it twice when it turns up in the other
 * feed. Full episodes are numbered on from the new show's highest, in the order they already had (oldest number first);
 * trailers and bonuses keep theirs, and a serial show keeps number and season. Their downloads and their own sponsor
 * spots go with them; clips and transcripts hang off the episode and its recording, so they come along by themselves.
 * An intro made for one episode was made for the old show, so it goes: the new show's own intro and outro play.
 */
export async function moveEpisodes(email: string, ids: number[], toShowId: number): Promise<{ moved: HostedEpisodeRow[] } | { error: string; status: number }> {
  const to = await ownShow(email, toShowId);
  if (!to) return { error: "No such show.", status: 404 };
  const rows = ids.length ? await db.select().from(hostedEpisodes).where(inArray(hostedEpisodes.id, ids)) : [];
  if (rows.length !== new Set(ids).size) return { error: "No such episode.", status: 404 };
  for (const sid of Array.from(new Set(rows.map((e) => e.showId)))) if (!(await ownShow(email, sid))) return { error: "No such episode.", status: 404 };
  const going = rows.filter((e) => e.showId !== to.id)
    .sort((a, b) => (a.episodeNumber ?? Number.MAX_SAFE_INTEGER) - (b.episodeNumber ?? Number.MAX_SAFE_INTEGER) || (a.publishedAt || a.createdAt).localeCompare(b.publishedAt || b.createdAt));
  if (!going.length) return { moved: [] };
  const serial = to.showType === "serial";
  let next = nextEpisodeNumber(await episodesOf(to.id));
  const moved = await inTransaction(async (tx) => {
    const out: HostedEpisodeRow[] = [];
    for (const e of going) {
      const number = e.episodeType === "full" && !serial ? next++ : e.episodeNumber;
      const [m] = await tx.update(hostedEpisodes).set({ showId: to.id, episodeNumber: number, season: serial ? e.season : null, introKey: "" })
        .where(and(eq(hostedEpisodes.id, e.id), eq(hostedEpisodes.showId, e.showId))).returning();
      if (!m) throw new Error(`Episode ${e.id} changed while it was being moved.`);
      await tx.update(hostedDownloads).set({ showId: to.id }).where(eq(hostedDownloads.episodeId, e.id));
      await tx.update(hostedSpots).set({ showId: to.id }).where(eq(hostedSpots.episodeId, e.id));
      out.push(m as HostedEpisodeRow);
    }
    return out;
  }).catch((err: Error) => ({ error: err.message }));
  if ("error" in moved) return { error: "Some of those just changed, so nothing moved. Try again.", status: 409 };
  console.log(`Moved episodes ${going.map((e) => e.id).join(",")} to show ${to.id} for ${email}`);
  return { moved };
}

/**
 * A new recording from their Zoom or their studio (a package account): the episode appears in their Episodes at once, in
 * post-production. Into the show it's for (showFor: the first of `names` that is one of their show titles, e.g. the
 * studio's name, then their profile's podcast, else their only show), never just the oldest: Riccoh's Warriors' Voice
 * studio recording would have gone to his Devil Dawg show (24 Nov 2026). "no-show" when it can't tell which.
 */
export async function startEpisodeFromRecording(email: string, rec: { id: number; title: string; durationSec: number; url: string }, names: (string | null | undefined)[] = []): Promise<"made" | "had" | "no-show" | "no-file"> {
  await schemaIsReady();
  if (!rec.url) return "no-file";
  const have = await db.select({ id: hostedEpisodes.id }).from(hostedEpisodes).where(eq(hostedEpisodes.recordingId, rec.id)).limit(1);
  if (have.length) return "had";
  const e = email.trim().toLowerCase();
  const profile = await storage.getProfileByEmail(e).catch(() => undefined);
  // What's known for sure first (the show it was recorded for, the SmartLink's show, their only show), then the names (26 Nov).
  const pick = (await recordingShow(e, [rec.id])) ?? (await showFor(e, null, ...names, profile?.podcastName));
  const [show] = pick ? await db.select().from(hostedShows).where(eq(hostedShows.id, pick.id)).limit(1) : [];
  if (!show) return "no-show";
  const eps = await episodesOf(show.id);
  await db.insert(hostedEpisodes).values({
    showId: show.id, title: (rec.title || "New episode").slice(0, 300), recordingId: rec.id, durationSec: Math.round(rec.durationSec || 0),
    description: await withCredits("", rec.id),
    episodeNumber: show.showType === "serial" ? null : nextEpisodeNumber(eps),
    guid: crypto.randomUUID(), status: "draft", stage: "post", createdAt: now(), audioJob: "queued", audioJobAt: now(), bookends: "off",
  });
  return "made";
}

/** The worker's next episode to turn from video into audio (a stuck one is taken back after 30 minutes). */
export async function claimEpisodeAudio(mode: "convert" | "copy" = "convert"): Promise<{ id: number; title: string; durationSec: number; recordingUrl: string; copy?: boolean; mime?: string } | null> {
  await schemaIsReady();
  const stale = new Date(Date.now() - 30 * 60_000).toISOString();
  // Copies (a moved show's back catalogue, from the old host into our storage) wait behind everything else.
  const [want, busy] = mode === "copy" ? ["copy", "copying"] : ["queued", "running"];
  const rows = await db.execute(sql`
    UPDATE hosted_episodes SET audio_job = ${busy}, audio_job_at = ${now()}
    WHERE id = (
      SELECT id FROM hosted_episodes
      WHERE audio_job = ${want} OR (audio_job = ${busy} AND audio_job_at < ${stale})
      ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, title, duration_sec, recording_id, audio_url, mime`);
  const r = (rows as unknown as { id: number; title: string; duration_sec: number; recording_id: number | null; audio_url: string; mime: string }[])[0];
  if (!r) return null;
  if (mode === "copy") {
    if (!/^https?:\/\//.test(r.audio_url)) { await db.update(hostedEpisodes).set({ audioJob: "" }).where(eq(hostedEpisodes.id, r.id)); return null; }
    return { id: r.id, title: r.title, durationSec: r.duration_sec, recordingUrl: r.audio_url, copy: true, mime: r.mime };
  }
  const rec = r.recording_id ? await storage.getRecording(r.recording_id) : undefined;
  if (!rec?.url) {
    await db.update(hostedEpisodes).set({ audioJob: "failed", audioError: "The recording couldn't be found." }).where(eq(hostedEpisodes.id, r.id));
    return null;
  }
  const recordingUrl = /^https?:\/\//i.test(rec.url) ? rec.url : await signedRecordingUrl(rec.url, 6 * 3600);
  return { id: r.id, title: r.title, durationSec: r.duration_sec || rec.durationSec, recordingUrl };
}

const STILLS_OFF = true;

/**
 * An episode that's a video (uploaded, or made from a Library recording), with no picture of its own: the worker
 * takes a still from the video for it (the page's thumbnail, and the feed's).
 */
export async function claimEpisodeStill(): Promise<{ id: number; title: string; durationSec: number; url: string } | null> {
  // Off (Andrew, 23 Nov 2026: the podcast cover goes in the feed, not a frame from the video). An episode with no
  // picture of its own uses the show's cover in the feed, on its page and in the list; a podcaster can still add
  // one from the episode page. The worker asks and gets nothing.
  if (STILLS_OFF) return null;
  await schemaIsReady();
  const stale = new Date(Date.now() - 30 * 60_000).toISOString();
  const rows = await db.execute(sql`
    UPDATE hosted_episodes SET still_job = 'running', still_job_at = ${now()}
    WHERE id = (
      SELECT id FROM hosted_episodes
      WHERE artwork_url = '' AND (recording_id IS NOT NULL OR (mime LIKE 'video/%' AND audio_key <> '')) AND audio_job NOT IN ('queued', 'running')
        AND (still_job = '' OR (still_job = 'running' AND still_job_at < ${stale}))
      ORDER BY id DESC LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, title, duration_sec, recording_id, mime, audio_key`);
  const r = (rows as unknown as { id: number; title: string; duration_sec: number; recording_id: number | null; mime: string; audio_key: string }[])[0];
  if (!r) return null;
  // Uploaded as a video: the episode's own file.
  if (r.mime.startsWith("video/") && r.audio_key) return { id: r.id, title: r.title, durationSec: r.duration_sec, url: await signedRecordingUrl(r.audio_key, 6 * 3600) };
  const rec = r.recording_id ? await storage.getRecording(r.recording_id) : undefined;
  // An audio-only recording has no picture to take.
  if (!rec?.url || /\.(mp3|m4a|wav|aac|ogg|flac)(\?|$)/i.test(rec.url)) {
    await db.update(hostedEpisodes).set({ stillJob: "failed" }).where(eq(hostedEpisodes.id, r.id));
    return null;
  }
  const url = /^https?:\/\//i.test(rec.url) ? rec.url : await signedRecordingUrl(rec.url, 6 * 3600);
  return { id: r.id, title: r.title, durationSec: r.duration_sec || rec.durationSec, url };
}

/**
 * An audio-only episode they asked to turn into a video (cover art and a moving sound wave), so Pōstify can clip it and Social can post it.
 * The worker takes the next one; a stuck one is taken back after 40 minutes.
 */
export async function claimEpisodeVideo(): Promise<{ id: number; title: string; durationSec: number; audioUrl: string; artUrl: string } | null> {
  await schemaIsReady();
  const stale = new Date(Date.now() - 40 * 60_000).toISOString();
  const rows = await db.execute(sql`
    UPDATE hosted_episodes SET video_job = 'running', video_job_at = ${now()}
    WHERE id = (
      SELECT id FROM hosted_episodes
      WHERE video_job = 'queued' OR (video_job = 'running' AND video_job_at < ${stale})
      ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, show_id, title, duration_sec, audio_key, audio_url, artwork_url`);
  const r = (rows as unknown as { id: number; show_id: number; title: string; duration_sec: number; audio_key: string; audio_url: string; artwork_url: string }[])[0];
  if (!r) return null;
  const [sh] = await db.select().from(hostedShows).where(eq(hostedShows.id, r.show_id)).limit(1);
  const audioUrl = r.audio_key ? await signedRecordingUrl(r.audio_key, 6 * 3600) : r.audio_url;
  const artUrl = r.artwork_url || sh?.artworkUrl || "";
  if (!audioUrl) {
    await db.update(hostedEpisodes).set({ videoJob: "failed", videoError: "No audio to make a video from." }).where(eq(hostedEpisodes.id, r.id));
    return null;
  }
  return { id: r.id, title: r.title, durationSec: r.duration_sec, audioUrl, artUrl };
}

/** The video behind an episode, if it has one: the MP4 they uploaded, or its Library recording. */
async function videoKeyOf(e: HostedEpisodeRow, owner: string): Promise<string> {
  if (e.mime.startsWith("video/") && e.audioKey) return e.audioKey;
  if (e.recordingId) {
    const rec = await storage.getRecording(e.recordingId);
    if (rec && rec.status === "Ready" && rec.url && rec.email.trim().toLowerCase() === owner.trim().toLowerCase()) return rec.url;
  }
  return "";
}
/** When the Library already sent this recording to YouTube (Library → Post), so the podcast doesn't send it twice. */
export async function libraryYouTubeAt(recordingId: number | null): Promise<string> {
  if (!recordingId) return "";
  const [p] = await db.select({ createdAt: hostPosts.createdAt, scheduledAt: hostPosts.scheduledAt }).from(hostPosts)
    .where(and(eq(hostPosts.kind, "recording"), eq(hostPosts.refId, recordingId), sql`${hostPosts.platforms} like '%youtube%'`, sql`${hostPosts.status} in ('sent','sending','scheduled','queued')`))
    .orderBy(desc(hostPosts.id)).limit(1);
  return p ? p.scheduledAt || p.createdAt : "";
}
/** When their podcast already sent this recording to YouTube (null: it hasn't), so the Library doesn't send it twice. */
export async function podcastYouTubeAt(recordingId: number): Promise<string | null> {
  const eps = await db.select({ youtube: hostedEpisodes.youtube }).from(hostedEpisodes).where(eq(hostedEpisodes.recordingId, recordingId));
  for (const x of eps) {
    try { const y = JSON.parse(x.youtube || "{}") as { state?: string; at?: string; via?: string }; if (y.state === "sent" && y.via !== "library") return y.at ?? ""; } catch { /* not posted */ }
  }
  return null;
}
const hasVideo = (e: HostedEpisodeRow) => (e.mime.startsWith("video/") && !!e.audioKey) || !!e.recordingId;

/** Post one episode to the owner's YouTube channel. Throws with a message fit to show them. */
async function postEpisodeToYouTube(e: HostedEpisodeRow, show: HostedShowRow, privacyIn: string, again = false): Promise<string> {
  const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
  // Already sent from the Library: note it, don't post it twice (unless they press Post again themselves).
  const fromLibrary = again ? "" : await libraryYouTubeAt(e.recordingId);
  if (fromLibrary) {
    const yt = JSON.stringify({ state: "sent", at: fromLibrary, via: "library" });
    await db.update(hostedEpisodes).set({ youtube: yt, youtubeWanted: false }).where(eq(hostedEpisodes.id, e.id));
    return yt;
  }
  if (!isUploadPostConfigured()) throw fail("Posting to YouTube isn't switched on yet.", 503);
  const key = await videoKeyOf(e, show.email);
  if (!key) throw fail("This episode is audio only. YouTube needs the video: upload the MP4, or make the episode from its Library recording.");
  const profile = await storage.getProfileByEmail(show.email);
  if (!profile?.uploadPostUsername) throw fail("Connect your YouTube channel on the Social screen first.");
  const privacy = (["public", "unlisted", "private"].includes(privacyIn) ? privacyIn : "public") as "public";
  const plain = (e.notesFormat === "html" ? notesText(e.description) : e.description).replace(/<[^>]+>/g, " ").replace(/\s+\n/g, "\n").trim();
  // The show's footer (episode line, sign-off, contact details) goes on YouTube too, the same as in the feed (23 Nov).
  const description = [plain, footerText(show, e), `Listen wherever you get podcasts: ${ORIGIN}/podcast/${show.slug}`].filter(Boolean).join("\n\n").slice(0, 4900);
  const post = await storage.addHostPost({ email: show.email, kind: "episode", refId: e.id, shape: "", title: e.title, description, platforms: "youtube", scheduledAt: "", status: "sending", error: "", jobId: "", requestId: "", results: "", mediaKey: "", metrics: "", metricsAt: "" });
  try {
    const videoUrl = await signedRecordingUrl(key, 21_600);
    const r = await publishVideo({ username: profile.uploadPostUsername, platforms: ["youtube"], videoUrl, title: e.title, description, externalId: `hp-${post.id}`,
      youtube: { title: e.title.slice(0, 100), description, privacyStatus: privacy, thumbnailUrl: e.artworkUrl || show.artworkUrl || undefined, madeForKids: false, notifySubscribers: privacy === "public" } });
    await storage.updateHostPost(post.id, { status: "sent", requestId: r.requestId ?? `hp-${post.id}`, jobId: r.jobId ?? "" });
    const yt = JSON.stringify({ state: "sent", at: now(), privacy, post: post.id });
    await db.update(hostedEpisodes).set({ youtube: yt, youtubeWanted: false }).where(eq(hostedEpisodes.id, e.id));
    return yt;
  } catch (err) {
    await storage.deleteHostPost(post.id);
    const msg = (err as Error).message;
    console.error("Episode to YouTube failed:", msg);
    throw fail(/not connected|no .*account|youtube.*(missing|not found)/i.test(msg) ? "Connect your YouTube channel on the Social screen first." : "YouTube didn't take it just now. Try again in a few minutes.", 502);
  }
}

/**
 * A show on Listen Notes: once it has an episode out, its feed is submitted
 * (one request), and the Directories tab shows "live" with its page when
 * Listen Notes has it. Resubmitting is how a pending one is checked: it
 * answers "found" once accepted. At most once a day per show. Never an
 * AI-voiced show: Listen Notes refuses them, and blocks whoever sends them.
 */
export async function listOnListenNotes(showId: number, force = false): Promise<void> {
  if (!isListenNotesConfigured()) return;
  const [show] = await db.select().from(hostedShows).where(eq(hostedShows.id, showId)).limit(1);
  if (!show || show.aiVoice) return;
  const dirs = (() => { try { return JSON.parse(show.directories || "{}") as Record<string, { state: string; url: string; at?: string }>; } catch { return {}; } })();
  const cur = dirs.listennotes;
  if (cur?.state === "live" && cur.url) return;
  if (!force && cur?.state === "rejected") return;
  if (!force && cur?.at && Date.now() - Date.parse(cur.at) < 23 * 3600_000) return;
  // Only once an episode is really in the feed (published with its audio): an empty feed gets rejected.
  const [ep] = await db.select({ id: hostedEpisodes.id }).from(hostedEpisodes).where(and(eq(hostedEpisodes.showId, show.id), eq(hostedEpisodes.status, "published"), sql`(${hostedEpisodes.audioKey} <> '' or ${hostedEpisodes.audioUrl} <> '')`)).limit(1);
  if (!ep) return;
  if (!(await spendListenNotes())) return;
  try {
    const r = await submitToListenNotes(feedUrl(show.slug));
    dirs.listennotes = r.status === "found" && r.url ? { state: "live", url: r.url, at: now() } : { state: r.status === "rejected" ? "rejected" : "submitted", url: "", at: now() };
    await db.update(hostedShows).set({ directories: JSON.stringify(dirs), updatedAt: now() }).where(eq(hostedShows.id, show.id));
  } catch (err) {
    console.warn("Listen Notes submit failed for show", show.id, (err as Error).message);
  }
}

/**
 * For an episode that went out in the last three days: each app that has been reading this feed lately, and whether it has
 * read far enough to have this episode yet. Older episodes, and apps that never read the feed, say nothing.
 */
function deliveryOf(e: HostedEpisodeRow, hits: { app: string; lastAt: string; seenUntil: string }[], listed: string[] = []): { apps: { app: string; got: boolean; checked: string }[] } | null {
  if (!live(e)) return null;
  const age = Date.now() - Date.parse(e.publishedAt);
  if (!(age >= 0 && age < 72 * 3600_000)) return null;
  const recent: { app: string; lastAt: string; seenUntil: string }[] = hits.filter((h) => Date.now() - Date.parse(h.lastAt) < 30 * 86400_000);
  // Apps the show is listed in count even before they have ever read this feed (Spotify, right after a move: it hasn't been yet).
  for (const app of listed) if (!recent.some((h) => h.app === app)) recent.push({ app, lastAt: "", seenUntil: "" });
  if (!recent.length) return null;
  const order = (a: string) => (a === "Apple Podcasts" ? 0 : a === "Spotify" ? 1 : 2);
  return { apps: recent.sort((a, b) => order(a.app) - order(b.app) || a.app.localeCompare(b.app)).map((h) => ({ app: h.app, got: !!h.seenUntil && h.seenUntil >= e.publishedAt, checked: h.lastAt })) };
}

// ---- Telling the apps a new episode is out ----------------------------------------------
// Andrew, 21 Nov: "We should be pushing." Apps still read the feed (that's RSS, for every host), but the moment an
// episode goes live we tell them to look now instead of on their own schedule:
// - WebSub (Google's public hub; the feed names it in <atom:link rel="hub">), for the apps that subscribe to it;
// - Podcast Index's pubnotify (no key), which re-reads the feed for Podverse, Fountain, TrueFans and the rest of the Index;
// - Podping, when PODPING_TOKEN is set (a free token from podping.cloud).
// Apple and Spotify take no notice from a host: they re-read active feeds often (Apple came 500 times in a day).
const WEBSUB_HUB = "https://pubsubhubbub.appspot.com/";
type Announced = { ids: number[]; at: string; sent: string[]; failed: string[]; episodes: Record<string, string> };
const announcedKey = (showId: number) => `feed-announced:${showId}`;
async function announcedOf(showId: number): Promise<Announced | null> {
  try { return JSON.parse((await storage.getSetting(announcedKey(showId))) ?? "null"); } catch { return null; }
}
/** Tells the apps when the feed has an episode it didn't have last time. Safe to call often. */
export async function announceShow(showId: number): Promise<Announced | null> {
  const [s] = await db.select().from(hostedShows).where(eq(hostedShows.id, showId)).limit(1);
  if (!s || s.newFeedUrl) return null;
  const ids = (await episodesOf(s.id)).filter(live).map((e) => e.id).sort((a, b) => a - b);
  const prev = await announcedOf(s.id);
  const fresh = ids.filter((id) => !prev?.ids.includes(id));
  if (!fresh.length) return null;
  const url = feedUrl(s.slug);
  const ua = { "User-Agent": "MilitaryVoices.ai/1.0 (+https://www.militaryvoices.ai)" };
  const tell = async (name: string, go: () => Promise<Response>): Promise<[string, boolean]> => {
    try { const r = await go(); return [name, r.ok]; } catch { return [name, false]; }
  };
  const token = (process.env.PODPING_TOKEN ?? "").trim();
  const results = await Promise.all([
    tell("WebSub", () => fetch(WEBSUB_HUB, { method: "POST", headers: { ...ua, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ "hub.mode": "publish", "hub.url": url }), signal: AbortSignal.timeout(10_000) })),
    tell("Podcast Index", () => fetch(`https://api.podcastindex.org/api/1.0/hub/pubnotify?url=${encodeURIComponent(url)}`, { headers: ua, signal: AbortSignal.timeout(10_000) })),
    ...(token ? [tell("Podping", () => fetch(`https://podping.cloud/?url=${encodeURIComponent(url)}`, { headers: { ...ua, Authorization: token }, signal: AbortSignal.timeout(10_000) }))] : []),
  ]);
  const at = now();
  // The first time a show is seen, only its newest episode is marked: the older ones went out before this existed.
  const marked = prev ? fresh : fresh.slice(-1);
  const out: Announced = {
    ids, at,
    sent: results.filter(([, ok]) => ok).map(([n]) => n),
    failed: results.filter(([, ok]) => !ok).map(([n]) => n),
    episodes: { ...(prev?.episodes ?? {}), ...Object.fromEntries(marked.map((id) => [String(id), at])) },
  };
  // Keep the record small: the last 200 episodes marked.
  out.episodes = Object.fromEntries(Object.entries(out.episodes).sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, 200));
  await storage.setSetting(announcedKey(s.id), JSON.stringify(out));
  console.log(`Feed ${s.slug}: told the apps about ${fresh.join(", ")} (sent ${out.sent.join(", ") || "none"}${out.failed.length ? `; failed ${out.failed.join(", ")}` : ""})`);
  return out;
}
const announceSoon = (showId: number) => { const job = announceShow(showId).catch((err) => { console.warn("Announce failed:", (err as Error).message); return null; }); try { waitUntil(job); } catch { /* not on Vercel */ } };

export function registerHosting(app: Express, requireAgent: import("express").RequestHandler) {
  app.post("/api/agent/episode-still/:id/done", requireAgent, async (req, res) => {
    const id = Number(req.params.id);
    try {
      const buf = Buffer.from(String(req.body?.jpeg ?? ""), "base64");
      if (buf.length < 2000) throw new Error("no picture");
      // Square, on the people in it (Apple wants 1400 or more on a side).
      const img = await sharp(buf).resize(1400, 1400, { fit: "cover", position: "attention" }).jpeg({ quality: 88 }).toBuffer();
      const url = await uploadPhoto(`podcast-art/episode-${id}-${Date.now()}.jpg`, img, "image/jpeg");
      // Only if they haven't added a picture of their own meanwhile.
      await db.update(hostedEpisodes).set({ artworkUrl: url, stillJob: "done" }).where(and(eq(hostedEpisodes.id, id), eq(hostedEpisodes.artworkUrl, "")));
      await db.update(hostedEpisodes).set({ stillJob: "done" }).where(eq(hostedEpisodes.id, id));
      res.json({ ok: true, url });
    } catch (err) {
      console.error("Episode still failed:", (err as Error).message);
      await db.update(hostedEpisodes).set({ stillJob: "failed" }).where(eq(hostedEpisodes.id, id));
      res.status(400).json({ message: "Couldn't use that picture." });
    }
  });
  app.post("/api/agent/episode-still/:id/failed", requireAgent, async (req, res) => {
    await db.update(hostedEpisodes).set({ stillJob: "failed" }).where(eq(hostedEpisodes.id, Number(req.params.id)));
    res.json({ ok: true });
  });

  app.post("/api/agent/episode-video/:id/done", requireAgent, async (req, res) => {
    const id = Number(req.params.id);
    const key = String(req.body?.videoKey ?? "");
    if (!/^clean\/[\w.-]+$/.test(key)) return res.status(400).json({ message: "No video." });
    const [e] = await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.id, id)).limit(1);
    const [sh] = e ? await db.select().from(hostedShows).where(eq(hostedShows.id, e.showId)).limit(1) : [];
    if (!e || !sh) return res.status(404).json({ message: "No such episode." });
    const email = sh.email.trim().toLowerCase();
    const at = e.publishedAt || e.createdAt || new Date().toISOString();
    const [had] = await db.select({ id: recordings.id }).from(recordings).where(and(eq(recordings.email, email), eq(recordings.egressId, `PODCAST_${id}`))).limit(1);
    if (!had) {
      await db.insert(recordings).values({
        eventId: 0, studioId: 0, email, title: e.title || "Episode", egressId: `PODCAST_${id}`, status: "Ready", url: key,
        durationSec: num(req.body?.durationSec) ?? e.durationSec ?? 0, sizeBytes: String(num(req.body?.sizeBytes) ?? 0), startedAt: at, endedAt: at,
      });
    }
    await db.update(hostedEpisodes).set({ videoJob: "", videoError: "" }).where(eq(hostedEpisodes.id, id));
    res.json({ ok: true });
  });
  app.post("/api/agent/episode-video/:id/failed", requireAgent, async (req, res) => {
    await db.update(hostedEpisodes).set({ videoJob: "failed", videoError: String(req.body?.error ?? "").slice(0, 300) }).where(eq(hostedEpisodes.id, Number(req.params.id)));
    res.json({ ok: true });
  });

  app.post("/api/agent/episode-audio/:id/done", requireAgent, async (req, res) => {
    const key = String(req.body?.audioKey ?? "");
    if (!/^clean\/[\w.-]+$/.test(key)) return res.status(400).json({ message: "No audio." });
    const copied = req.body?.copy === true;
    await db.update(hostedEpisodes).set({ audioKey: key, ...(copied ? {} : { mime: "audio/mpeg" }), ...(num(req.body?.sizeBytes) ? { sizeBytes: num(req.body?.sizeBytes)! } : {}), ...(num(req.body?.durationSec) ? { durationSec: num(req.body?.durationSec)! } : {}), audioJob: "", audioError: "" }).where(eq(hostedEpisodes.id, Number(req.params.id)));
    // A published episode waiting for its audio goes live now: tell the apps.
    const [done] = await db.select({ showId: hostedEpisodes.showId }).from(hostedEpisodes).where(eq(hostedEpisodes.id, Number(req.params.id))).limit(1);
    if (done) announceSoon(done.showId);
    res.json({ ok: true });
  });
  app.post("/api/agent/episode-bookends/:id/done", requireAgent, async (req, res) => {
    const key = String(req.body?.servedKey ?? "");
    if (!/^clean\/[\w.-]+$/.test(key)) return res.status(400).json({ message: "No audio." });
    await db.update(hostedEpisodes).set({ servedKey: key, servedSize: num(req.body?.sizeBytes) ?? 0, servedSec: num(req.body?.durationSec) ?? 0, servedSig: String(req.body?.sig ?? "").slice(0, 40), servedSpots: String(req.body?.spots ?? "").replace(/[^0-9,]/g, "").slice(0, 60), bookendJob: "" }).where(eq(hostedEpisodes.id, Number(req.params.id)));
    res.json({ ok: true });
  });
  app.post("/api/agent/episode-bookends/:id/failed", requireAgent, async (req, res) => {
    await db.update(hostedEpisodes).set({ bookendJob: req.body?.requeue === true ? "" : "failed" }).where(eq(hostedEpisodes.id, Number(req.params.id)));
    res.json({ ok: true });
  });
  app.post("/api/agent/episode-audio/:id/failed", requireAgent, async (req, res) => {
    const requeue = req.body?.requeue === true;
    const [e] = await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.id, Number(req.params.id))).limit(1);
    // A copy that fails leaves the episode playing from the old host: nothing for the podcaster to do.
    const copying = e?.audioJob === "copying" || e?.audioJob === "copy";
    await db.update(hostedEpisodes).set(requeue ? { audioJob: copying ? "copy" : "queued" } : { audioJob: copying ? "" : "failed", audioError: String(req.body?.error ?? "").slice(0, 300) }).where(eq(hostedEpisodes.id, Number(req.params.id)));
    res.json({ ok: true });
  });

  // A fresh server creates the hosting tables on its first query; wait for that, so a feed or a play never meets a missing table.
  app.use(["/feed", "/e", "/api/host/hosting", "/api/public/podcast"], (_req, _res, next) => { schemaIsReady().then(() => next(), next); });

  // The show's public page: what anyone can see and play.
  app.get("/api/public/podcast/:slug", async (req, res) => {
    const [s] = await db.select().from(hostedShows).where(eq(hostedShows.slug, String(req.params.slug))).limit(1);
    if (!s || s.newFeedUrl) return res.status(404).json({ message: "No such show." });
    const eps = (await episodesOf(s.id)).filter(live);
    // A message to the host goes through their page's chat (the same conversation, the same Messages).
    const [page] = await db.select({ handle: bioPages.handle, published: bioPages.published, askEnabled: bioPages.askEnabled, welcome: bioPages.welcome }).from(bioPages).where(eq(bioPages.email, s.email)).limit(1);
    res.setHeader("Cache-Control", "public, max-age=120, s-maxage=120");
    res.json({
      chat: page?.published && page.askEnabled ? page.handle : null,
      chatWelcome: page?.welcome.trim() || "Hi! Thanks for listening. What's on your mind?",
      show: { title: s.title, description: plainDesc(s.description), author: s.author || s.ownerName, artworkUrl: s.artworkUrl, category: s.category, website: s.website, appleUrl: s.appleUrl, spotifyUrl: s.spotifyUrl, feedUrl: feedUrl(s.slug) },
      episodes: eps.map((e) => ({ id: e.id, title: e.title, notes: [e.notesFormat === "html" ? notesText(e.description) : e.description, footerText(s, e)].filter(Boolean).join("\n\n"), publishedAt: e.publishedAt, durationSec: e.durationSec, episodeNumber: e.episodeNumber, season: e.season, artworkUrl: e.artworkUrl, audio: `${ORIGIN}/e/${e.id}.${extOf(e.mime)}` })),
    });
  });

  // The feed.
  app.get("/feed/:slug", async (req, res) => {
    const slug = String(req.params.slug).replace(/\.(xml|rss)$/i, "");
    const [s] = await db.select().from(hostedShows).where(eq(hostedShows.slug, slug)).limit(1);
    if (!s) {
      // A feed name that was changed: the old address keeps working (setting "feed-alias:<old>" = new name), so nothing already submitted to Apple, Spotify or YouTube breaks.
      const moved = (await storage.getSetting(`feed-alias:${slug}`).catch(() => null))?.trim();
      if (moved && /^[a-z0-9-]+$/.test(moved)) return res.redirect(301, feedUrl(moved));
      return res.status(404).type("text/plain").send("No such feed.");
    }
    // Moved to another host: the apps follow a permanent redirect (and the tag, for the ones that read the feed first).
    if (s.newFeedUrl && req.query.preview !== "1") return res.redirect(301, s.newFeedUrl);
    const eps = await episodesOf(s.id);
    // Note which app is reading the feed and how far it got (the waiting chips on a new episode). Never holds the response up.
    if (req.method === "GET" && !req.query.preview) {
      const who = appOf(String(req.get("user-agent") ?? ""));
      if (who !== "Web browser" && who !== "Other") {
        const newest = eps.filter(live).reduce((m, e) => (e.publishedAt > m ? e.publishedAt : m), "");
        const t = now();
        void db.insert(hostedFeedHits).values({ showId: s.id, app: who, firstAt: t, lastAt: t, seenUntil: newest, hits: 1 })
          .onConflictDoUpdate({ target: [hostedFeedHits.showId, hostedFeedHits.app], set: { lastAt: t, seenUntil: sql`GREATEST(${hostedFeedHits.seenUntil}, ${newest})`, hits: sql`${hostedFeedHits.hits} + 1` } })
          .catch((err) => console.warn("Feed visit not noted:", (err as Error).message));
      }
    }
    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    // Every visit has to reach us to be seen, so the edge doesn't keep a copy (the apps ask with ETag, so a repeat is a tiny 304).
    res.setHeader("Cache-Control", "no-cache");
    res.send(feedXml(s, eps, await db.select().from(hostedSpots).where(eq(hostedSpots.showId, s.id))));
  });

  // The audio: count it, then send the app to the file.
  app.get("/e/:file", async (req, res) => {
    const id = Number(String(req.params.file).match(/^\d+/)?.[0]);
    const [e] = Number.isInteger(id) ? await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.id, id)).limit(1) : [];
    if (!e || !(e.audioKey || e.audioUrl)) return res.status(404).type("text/plain").send("Not found.");
    // With the show's intro, outro and sponsor spots on, when that version is ready; otherwise the original.
    const [sh] = e.audioKey ? await db.select().from(hostedShows).where(eq(hostedShows.id, e.showId)).limit(1) : [];
    const sv = sh && !req.query.original ? served(sh, e, await db.select().from(hostedSpots).where(eq(hostedSpots.showId, sh.id))) : null;
    const ua = String(req.get("user-agent") ?? "");
    const range = String(req.get("range") ?? "");
    const counts = req.method === "GET" && !req.query.preview && (!range || /^bytes=0-/.test(range)) && ua && !BOT.test(ua) && e.status === "published";
    if (counts) {
      const ip = String(req.ip ?? "");
      const day = today();
      const listenerHash = crypto.createHash("sha256").update(`${ip}|${ua}|${day}|${process.env.SESSION_SECRET ?? "mv"}`).digest("hex").slice(0, 40);
      // Once per listener per episode per day: the unique index does the de-duplicating. The sponsor spots in the file they got are noted with it.
      await db.insert(hostedDownloads).values({ showId: e.showId, episodeId: e.id, day, listenerHash, app: downloadApp(ua), spots: sv ? e.servedSpots : "", createdAt: now() }).onConflictDoNothing().catch((err) => console.warn("Download not counted:", (err as Error).message));
    }
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, sv ? await signedRecordingUrl(sv.key, 6 * 3600) : e.audioKey ? await signedRecordingUrl(e.audioKey, 6 * 3600) : e.audioUrl);
  });

  // ---- The podcaster's side ----

  app.get("/api/host/hosting", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const email = emailOf(req);
    const shows = await showsOf(email);
    const out = [];
    for (const s of shows) {
      const eps = await episodesOf(s.id);
      const spotRows = await db.select().from(hostedSpots).where(eq(hostedSpots.showId, s.id));
      const st = await showStats(s.id, 30);
      const dirs = (() => { try { return JSON.parse(s.directories || "{}") as Record<string, { state?: string }>; } catch { return {} as Record<string, { state?: string }>; } })();
      const listedApps = [dirs.apple?.state, ].some((x) => x === "live" || x === "submitted") ? ["Apple Podcasts"] : [];
      if (dirs.spotify?.state === "live" || dirs.spotify?.state === "submitted") listedApps.push("Spotify");
      // The chips are a nicety: if the table isn't there yet (the first minute after a deploy), the list still loads.
      const ann = await announcedOf(s.id);
      const hitRows = await db.select().from(hostedFeedHits).where(eq(hostedFeedHits.showId, s.id)).catch(() => [] as { app: string; lastAt: string; seenUntil: string }[]);
      out.push({
        show: s,
        feedUrl: feedUrl(s.slug),
        missing: readiness(s, eps),
        ownerConfirmed: feedOwnerEmail(s) === s.ownerEmail.trim(),
        // The Production plan (we make their episodes): only then does "Send back to post-production" make sense.
        production: await hasProduction(s.email),
        // announcedAt: when we told the apps about it (WebSub, Podcast Index, Podping), "" if not yet.
        episodes: await Promise.all(eps.map(async (e) => ({ ...e, announcedAt: ann?.episodes[String(e.id)] ?? "", delivery: deliveryOf(e, hitRows, listedApps), downloads: st.episodes.get(e.id) ?? 0, live: live(e), hasVideo: hasVideo(e), ytLibrary: await libraryYouTubeAt(e.recordingId), bookend: { wanted: planOf(s, e, spotRows).any, state: !planOf(s, e, spotRows).any ? "" : served(s, e, spotRows) ? "ready" : e.bookendJob === "failed" ? "failed" : "working" } }))),
        stats: { total: st.total, last30: st.series.reduce((a, d) => a + d.count, 0), series: st.series, apps: st.apps },
        // Apps that read this feed in the last 14 days: after a move, the proof each one followed.
        reading: Array.from(new Set(hitRows.filter((r) => Date.now() - Date.parse(r.lastAt) < 14 * 86400000).map((r) => r.app))),
      });
    }
    // YouTube connected through Upload-Post (the Social screen)?
    const profile = await storage.getProfileByEmail(email);
    const youtubeReady = !!profile?.uploadPostUsername && /youtube/i.test(profile.socialAccounts ?? "");
    // Put away, for "Archived shows" in Podcast Settings (one Unarchive each).
    const archived = await db.select({ id: hostedShows.id, title: hostedShows.title, artworkUrl: hostedShows.artworkUrl, archivedAt: hostedShows.archivedAt })
      .from(hostedShows).where(and(eq(hostedShows.email, email), ne(hostedShows.archivedAt, ""))).orderBy(hostedShows.id).catch(() => []);
    res.json({ shows: out, archived, categories: CATEGORIES, youtubeReady });
  });

  // Archive (24 Nov 2026): the team archives a show for them (Admin → contact); they bring it back here.
  app.put("/api/host/hosting/shows/:id/archive", requireHostSession, async (req, res) => {
    const s = await ownShow(emailOf(req), Number(req.params.id));
    if (!s) return res.status(404).json({ message: "No such show." });
    const r = await setShowArchived(s.id, req.body?.archived === true);
    if (r.error) return res.status(400).json({ message: r.error });
    res.json(r.show);
  });

  // ---- Podcast setup (15 Nov 2026): a new show starts from five plain answers ----------------------
  // Claude writes the title ideas and the description from what they said; Ideogram draws three covers with
  // the real title on them. Both are capped per person per day, so a stuck button can't run up a bill.
  const setupRuns = new Map<string, number[]>();
  const overLimit = (key: string, max: number) => {
    const t = Date.now();
    const hits = (setupRuns.get(key) ?? []).filter((x) => t - x < 24 * 3600_000);
    if (hits.length >= max) return true;
    setupRuns.set(key, [...hits, t]);
    return false;
  };

  app.post("/api/host/hosting/setup/write", requireHostSession, async (req, res) => {
    const email = emailOf(req);
    const a = (req.body?.answers ?? {}) as Record<string, unknown>;
    const clip = (k: string, n: number) => String(a[k] ?? "").trim().slice(0, n);
    const about = clip("about", 800);
    if (about.length < 8) return res.status(400).json({ message: "Tell us a little about your show first." });
    if (overLimit(`w:${email}`, 20)) return res.status(429).json({ message: "That's plenty for today. Try again tomorrow." });
    const profile = await storage.getProfileByEmail(email).catch(() => undefined);
    const feel = Array.isArray(a.feel) ? (a.feel as unknown[]).map((x) => String(x).slice(0, 30)).slice(0, 4).join(", ") : "";
    try {
      const client = new Anthropic();
      const r = await client.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 700,
        system: `You name and describe podcasts for MilitaryVoices.ai, a platform for military and veteran creators. From the host's own words, write three title ideas and one description.
Titles: 2 to 5 words, easy to say, easy to remember. Different from each other. Do not put "podcast" in them unless it is natural.
Description: two to four plain sentences, under 500 characters, in the host's voice ("we" or "I" is fine). Say what the show is, who it is for, and what a listener gets.
Use only what they told you. Invent no guests, ranks, branches, awards, numbers or claims. 8th-grade reading level. No em dashes. No hype words like "journey", "delve" or "unlock".
Return JSON only: {"titles":["","",""],"description":""}`,
        messages: [{ role: "user", content: `What the show is about: ${about}\nWho it is for: ${clip("who", 300) || "not said"}\nWho is talking: ${clip("hosts", 300) || profile?.hostName || "not said"}\nHow often: ${clip("often", 60) || "not said"}\nThe feel: ${feel || "not said"}` }],
      });
      const text = r.content.map((c) => ("text" in c ? c.text : "")).join("");
      const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { titles?: unknown; description?: unknown };
      const titles = (Array.isArray(json.titles) ? json.titles : []).map((t) => String(t).replace(/^["']|["']$/g, "").trim().slice(0, 80)).filter(Boolean).slice(0, 3);
      const description = String(json.description ?? "").trim().slice(0, 900);
      if (!titles.length || !description) throw new Error("empty");
      res.json({ titles, description });
    } catch (err) {
      console.error("Podcast setup write failed:", (err as Error).message);
      res.status(502).json({ message: "Couldn't write that just now. Try again, or type your own." });
    }
  });

  app.post("/api/host/hosting/setup/artwork", requireHostSession, async (req, res) => {
    const email = emailOf(req);
    const title = String(req.body?.title ?? "").replace(/["\n\r]/g, " ").trim().slice(0, 60);
    const about = String(req.body?.about ?? "").replace(/["\n\r]/g, " ").trim().slice(0, 200);
    if (!title) return res.status(400).json({ message: "Pick a name first." });
    if (!process.env.FAL_KEY) return res.status(503).json({ message: "Cover ideas aren't switched on yet. You can upload your own." });
    if (overLimit(`a:${email}`, 6)) return res.status(429).json({ message: "That's all the cover ideas for today. You can upload your own." });
    try {
      // Three different looks, drawn at once, so the choice is a real one.
      const looks = [
        "A bold round badge or emblem that suits the show, with the title across it. Deep navy, gold and cream.",
        "Huge, tight, poster-style title letters that fill most of the square, cream on deep navy, with one small gold detail. Minimal.",
        "A strong flat illustration of a scene that suits the show, with the title in a clean banner. Deep red, navy and cream.",
      ];
      const made = await Promise.all(looks.map(async (look) => {
        const r = await fetch("https://fal.run/fal-ai/ideogram/v3", {
          method: "POST", headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(80_000),
          body: JSON.stringify({
            prompt: `Square podcast cover. The title "${title.toUpperCase()}" in large, bold, clean letters, spelled exactly like that, and no other words anywhere. The show is about: ${about || "military and veteran stories"}. ${look} Flat, bold, professional, high contrast, plenty of space around the letters.`,
            image_size: { width: 1536, height: 1536 }, rendering_speed: "TURBO", num_images: 1, expand_prompt: false,
          }),
        });
        const j = (await r.json().catch(() => ({}))) as { images?: { url: string }[] };
        if (!r.ok || !j.images?.[0]) throw new Error(`fal ${r.status}`);
        return j.images[0].url;
      }));
      const tag = crypto.createHash("sha1").update(email).digest("hex").slice(0, 8);
      const options: string[] = [];
      for (let i = 0; i < made.length; i++) {
        const raw = Buffer.from(await (await fetch(made[i], { signal: AbortSignal.timeout(30_000) })).arrayBuffer());
        const img = await sharp(raw).resize(1500, 1500, { fit: "cover" }).jpeg({ quality: 90 }).toBuffer();
        options.push(await uploadPhoto(`podcast-art/draft-${tag}-${Date.now()}-${i}.jpg`, img, "image/jpeg"));
      }
      res.json({ options });
    } catch (err) {
      console.error("Podcast setup art failed:", (err as Error).message);
      res.status(502).json({ message: "Couldn't make covers just now. You can try again or upload your own." });
    }
  });

  // A show: new, with what we already know about them filled in.
  app.post("/api/host/hosting/shows", requireHostSession, async (req, res) => {
    const email = emailOf(req);
    const b = req.body ?? {};
    const profile = await storage.getProfileByEmail(email).catch(() => undefined);
    const title = String(b.title ?? "").trim().slice(0, 200) || (profile?.podcastName ?? "").trim() || "My podcast";
    const slug = await uniqueSlug(slugify(title));
    const [s] = await db.insert(hostedShows).values({
      // New shows post to YouTube with each episode unless they untick it (Publishing, 23 Nov 2026). Older shows keep theirs.
      email, slug, title, youtubeMode: "always",
      description: String(b.description ?? "").slice(0, 4000),
      author: String(b.author ?? profile?.hostName ?? "").slice(0, 200),
      ownerName: String(b.ownerName ?? profile?.hostName ?? "").slice(0, 200),
      ownerEmail: String(b.ownerEmail ?? email).slice(0, 200),
      artworkUrl: /^https:\/\//.test(String(b.artworkUrl ?? "")) ? String(b.artworkUrl) : "",
      guid: podcastGuid(feedUrl(slug)),
      ownerEmailVerified: email,
      createdAt: now(), updatedAt: now(),
    }).returning();
    res.status(201).json(s);
  });

  app.patch("/api/host/hosting/shows/:id", requireHostSession, async (req, res) => {
    const s = await ownShow(emailOf(req), Number(req.params.id));
    if (!s) return res.status(404).json({ message: "No such show." });
    const b = req.body ?? {};
    const str = (k: string, max: number) => (typeof b[k] === "string" ? { [k]: b[k].slice(0, max) } : {});
    const category = typeof b.category === "string" && b.category in CATEGORIES ? b.category : undefined;
    const subcategory = typeof b.subcategory === "string" && (b.subcategory === "" || (CATEGORIES[category ?? s.category] ?? []).includes(b.subcategory)) ? b.subcategory : undefined;
    const ownerEmail = typeof b.ownerEmail === "string" ? b.ownerEmail.trim().slice(0, 200) : undefined;
    if (ownerEmail !== undefined && ownerEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) return res.status(400).json({ message: "That owner email doesn't look right." });
    const newFeedUrl = typeof b.newFeedUrl === "string" ? b.newFeedUrl.trim() : undefined;
    if (newFeedUrl && (!/^https?:\/\/[^\s]+$/i.test(newFeedUrl) || newFeedUrl.startsWith(feedUrl(s.slug)))) return res.status(400).json({ message: "Paste the new host's feed address (https://…)." });
    const [out] = await db.update(hostedShows).set({
      ...(ownerEmail !== undefined ? { ownerEmail, ...(ownerEmail.toLowerCase() === s.email ? { ownerEmailVerified: s.email } : {}) } : {}),
      ...(newFeedUrl !== undefined ? { newFeedUrl } : {}),
      ...(typeof b.appleUrl === "string" && (b.appleUrl === "" || /^https:\/\/podcasts\.apple\.com\//.test(b.appleUrl)) ? { appleUrl: b.appleUrl.trim() } : {}),
      ...(typeof b.spotifyUrl === "string" && (b.spotifyUrl === "" || /^https:\/\/open\.spotify\.com\//.test(b.spotifyUrl)) ? { spotifyUrl: b.spotifyUrl.trim() } : {}),
      ...str("title", 200), ...str("description", 4000), ...str("episodeFooter", 4000), ...str("author", 200), ...str("ownerName", 200), ...str("website", 300), ...str("copyright", 300),
      ...(category ? { category, subcategory: subcategory ?? "" } : subcategory !== undefined ? { subcategory } : {}),
      ...(typeof b.explicit === "boolean" ? { explicit: b.explicit } : {}),
      ...(typeof b.aiVoice === "boolean" ? { aiVoice: b.aiVoice } : {}),
      ...(typeof b.autoPublish === "boolean" ? { autoPublish: b.autoPublish } : {}),
      ...(b.youtubeMode === "ask" || b.youtubeMode === "always" ? { youtubeMode: b.youtubeMode } : {}),
      ...(["public", "unlisted", "private"].includes(b.youtubePrivacy) ? { youtubePrivacy: b.youtubePrivacy } : {}),
      ...(b.showType === "serial" || b.showType === "episodic" ? { showType: b.showType } : {}),
      ...(typeof b.language === "string" && /^[a-z]{2}(-[a-z]{2})?$/i.test(b.language) ? { language: b.language.toLowerCase() } : {}),
      // Directories: each app's state and link. Apple's and Spotify's links also fill the follow buttons.
      ...(b.directories && typeof b.directories === "object" ? (() => {
        const clean: Record<string, { state: string; url: string; at: string }> = {};
        for (const [k, raw] of Object.entries(b.directories as Record<string, Record<string, unknown>>).slice(0, 20)) {
          if (!/^[a-z]{2,20}$/.test(k) || !raw || typeof raw !== "object") continue;
          const state = ["submitted", "live"].includes(String(raw.state)) ? String(raw.state) : "";
          // The app's page for the show; never their own feed.
          const url = typeof raw.url === "string" && /^https:\/\/[^\s]+$/.test(raw.url.trim()) && !/militaryvoices\.ai/i.test(raw.url) ? raw.url.trim().slice(0, 500) : "";
          if (state || url) clean[k] = { state: url ? "live" : state, url, at: typeof raw.at === "string" ? raw.at.slice(0, 40) : now() };
        }
        const apple = clean.apple?.url && /^https:\/\/podcasts\.apple\.com\//.test(clean.apple.url) ? { appleUrl: clean.apple.url } : {};
        const spotify = clean.spotify?.url && /^https:\/\/open\.spotify\.com\//.test(clean.spotify.url) ? { spotifyUrl: clean.spotify.url } : {};
        return { directories: JSON.stringify(clean), ...apple, ...spotify };
      })() : {}),
      updatedAt: now(),
    }).where(eq(hostedShows.id, s.id)).returning();
    res.json(out);
  });

  // Cover art: squared and sized to Apple's rule (3000 a side at most, 1400 at least).
  app.post("/api/host/hosting/shows/:id/artwork", requireHostSession, art.single("file"), async (req, res) => {
    const s = await ownShow(emailOf(req), Number(req.params.id));
    if (!s) return res.status(404).json({ message: "No such show." });
    if (!req.file) return res.status(400).json({ message: "Choose an image." });
    try {
      const meta = await sharp(req.file.buffer).metadata();
      const side = Math.min(meta.width ?? 0, meta.height ?? 0);
      if (side < 1400) return res.status(400).json({ message: `That image is ${side}px on its short side. Apple asks for at least 1400 × 1400.` });
      const img = await sharp(req.file.buffer).rotate().resize(Math.min(3000, side), Math.min(3000, side), { fit: "cover", position: "attention" }).jpeg({ quality: 90 }).toBuffer();
      const url = await uploadPhoto(`podcast-art/${s.id}-${Date.now()}.jpg`, img, "image/jpeg");
      const [out] = await db.update(hostedShows).set({ artworkUrl: url, updatedAt: now() }).where(eq(hostedShows.id, s.id)).returning();
      res.json(out);
    } catch (err) {
      console.error("Podcast art failed:", err);
      res.status(400).json({ message: "Couldn't read that image. Try a JPG or PNG." });
    }
  });

  // An episode: from an uploaded audio file, or a Library recording's clean audio.
  app.post("/api/host/hosting/shows/:id/episodes", requireHostSession, async (req, res) => {
    const email = emailOf(req);
    const s = await ownShow(email, Number(req.params.id));
    if (!s) return res.status(404).json({ message: "No such show." });
    const b = req.body ?? {};
    let audioKey = typeof b.audioKey === "string" && /^show-assets\/[\w.-]+$/.test(b.audioKey) ? b.audioKey : "";
    let mime = typeof b.mime === "string" && /^(audio|video)\/[\w.+-]+$/.test(b.mime) ? b.mime : "audio/mpeg";
    let durationSec = num(b.durationSec) ?? 0;
    let recordingId: number | null = null;
    let title = String(b.title ?? "").trim().slice(0, 300);
    if (!audioKey && b.recordingId) {
      const rec = await storage.getRecording(Number(b.recordingId));
      if (!rec || rec.email.trim().toLowerCase() !== email) return res.status(404).json({ message: "No such recording." });
      let c: CleanResult | null = null;
      try { c = rec.clean ? JSON.parse(rec.clean) : null; } catch { c = null; }
      recordingId = rec.id;
      title ||= rec.title;
      if (c?.audioKey && b.original !== true) {
        audioKey = c.audioKey;
        mime = "audio/mpeg";
        durationSec = Math.round(c.durationSec || rec.durationSec || 0);
      } else {
        // No clean audio (or they want the original): the worker makes the MP3 from the video.
        if (!rec.url) return res.status(400).json({ message: "That recording isn't ready yet." });
        durationSec = Math.round(rec.durationSec || 0);
      }
    }
    // One episode from a feed (the old host's, say): its words and its audio, copied in as a draft.
    if (b.fromFeed && typeof b.fromFeed === "object") {
      const url = await resolveFeed(String(b.fromFeed.url ?? "").trim());
      if (!safeFeedUrl(url)) return res.status(400).json({ message: "That isn't a feed address we can read." });
      let feed: ParsedFeed;
      try { feed = await readFeed(url); } catch (err) { return res.status(400).json({ message: (err as Error).message }); }
      const it = feed.items.find((x) => x.guid && x.guid === String(b.fromFeed.guid ?? ""));
      if (!it) return res.status(404).json({ message: "That episode isn't in the feed any more." });
      const eps0 = await episodesOf(s.id);
      const [e] = await db.insert(hostedEpisodes).values({
        showId: s.id, title: it.title.slice(0, 300), description: it.notes.slice(0, 20000), notesFormat: "html",
        audioUrl: it.url, mime: it.mime, sizeBytes: Math.min(2_000_000_000, it.length), durationSec: it.duration,
        episodeNumber: it.episode ?? (s.showType === "serial" ? null : nextEpisodeNumber(eps0)), season: it.season,
        episodeType: it.episodeType, explicit: it.explicit, artworkUrl: it.image,
        guid: it.guid, status: "draft", publishedAt: it.published || "", createdAt: now(), audioJob: "copy", bookends: "off", spotsOff: true,
      }).returning();
      return res.status(201).json(e);
    }
    // "Skip and upload later": the episode starts as a draft with no audio; the audio goes on from its page.
    if (!audioKey && !recordingId && b.later !== true) return res.status(400).json({ message: "Add the episode's audio." });
    const eps = await episodesOf(s.id);
    const [e] = await db.insert(hostedEpisodes).values({
      showId: s.id, title: title || "New episode", description: (await withCredits(String(b.description ?? ""), recordingId)).slice(0, 20000),
      audioKey, mime, sizeBytes: num(b.sizeBytes) ?? 0, durationSec, recordingId,
      episodeNumber: num(b.episodeNumber) ?? (s.showType === "serial" ? null : nextEpisodeNumber(eps)),
      season: num(b.season), guid: crypto.randomUUID(), status: "draft", createdAt: now(), spotsOff: true,
      audioJob: audioKey || !recordingId ? "" : "queued", audioJobAt: audioKey || !recordingId ? "" : now(),
    }).returning();
    res.status(201).json(e);
  });

  /** The show's intro or outro: set it from a file already in our storage, or clear it. New episodes get them; older ones are left as they are. */
  app.put("/api/host/hosting/shows/:id/bookends", requireHostSession, async (req, res) => {
    const s = await ownShow(emailOf(req), Number(req.params.id));
    if (!s) return res.status(404).json({ message: "No such show." });
    const b = req.body ?? {};
    const kind = b.kind === "outro" ? "outro" : b.kind === "intro" ? "intro" : "";
    if (!kind) return res.status(400).json({ message: "Intro or outro?" });
    let patch: Partial<HostedShowRow>;
    if (b.clear === true) {
      patch = kind === "intro" ? { introKey: "", introName: "", introSec: 0 } : { outroKey: "", outroName: "", outroSec: 0 };
    } else {
      const key = typeof b.key === "string" && /^show-assets\/[\w.-]+$/.test(b.key) ? b.key : "";
      if (!key) return res.status(400).json({ message: "Add the audio file." });
      const sec = Math.max(0, Math.round(Number(b.durationSec) || 0));
      if (sec > 300) return res.status(400).json({ message: "Keep it under 5 minutes." });
      const name = String(b.name ?? "").slice(0, 120);
      patch = kind === "intro" ? { introKey: key, introName: name, introSec: sec } : { outroKey: key, outroName: name, outroSec: sec };
    }
    const since = !(s.introKey || s.outroKey) ? { bookendsSince: now() } : {};
    const [out] = await db.update(hostedShows).set({ ...patch, ...since, updatedAt: now() }).where(eq(hostedShows.id, s.id)).returning();
    // A change makes the episodes that failed before try again.
    await db.update(hostedEpisodes).set({ bookendJob: "" }).where(and(eq(hostedEpisodes.showId, s.id), eq(hostedEpisodes.bookendJob, "failed")));
    res.json(out);
  });

  // ---- Sponsor spots (18 Nov 2026): a sponsor's message before or after the episodes -------------------
  const SPOT_VOICES: Record<string, { id: string; name: string }> = {
    brian: { id: "nPczCjzI2devNBz1zQrb", name: "Brian: deep, resonant, comforting" },
    adam: { id: "pNInz6obpgDQGcFmaJgB", name: "Adam: firm and confident" },
    eric: { id: "cjVigY5qzO86Huf0OWal", name: "Eric: smooth, trustworthy" },
    bill: { id: "sR8sxaLJeFSh308Gi6HS", name: "Bill: calm and friendly" },
  };
  const spotRuns = new Map<string, number[]>();
  const failedJobsReset = (showId: number) => db.update(hostedEpisodes).set({ bookendJob: "" }).where(and(eq(hostedEpisodes.showId, showId), eq(hostedEpisodes.bookendJob, "failed")));
  const ymd = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

  /**
   * Every episode of their podcast shows, for the pickers in Pōstify, Social and the Library: the picture, the length, and whether
   * there is a video behind it (a Library recording or an uploaded MP4) or only audio.
   */
  app.get("/api/host/podcast-episodes", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const folder = req.query.folder !== undefined ? Number(req.query.folder) || 0 : undefined;
    const all = await listHostEpisodes(emailOf(req));
    res.json(folder === undefined ? all : all.filter((e) => e.folderId === folder));
  });

  /** Episodes scheduled to go live (published, their time still ahead), for the Social Calendar's read-only
   *  "Episode goes live" markers (Andrew, 26 Nov 2026: the podcast episodes' dates and times on the calendar, no clips).
   *  Never a host post: nothing here is posted anywhere, the feed puts each one out at its time. */
  app.get("/api/host/episodes/upcoming", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const shows = await showsOf(emailOf(req));
    if (!shows.length) return res.json({ episodes: [] });
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 90 * 86_400_000).toISOString();
    const eps = await db.select({ id: hostedEpisodes.id, showId: hostedEpisodes.showId, title: hostedEpisodes.title, episodeNumber: hostedEpisodes.episodeNumber, publishedAt: hostedEpisodes.publishedAt, artworkUrl: hostedEpisodes.artworkUrl })
      .from(hostedEpisodes)
      .where(and(inArray(hostedEpisodes.showId, shows.map((s) => s.id)), eq(hostedEpisodes.status, "published"), sql`${hostedEpisodes.publishedAt} > ${from}`, sql`${hostedEpisodes.publishedAt} <= ${to}`))
      .orderBy(hostedEpisodes.publishedAt).limit(200);
    const byId = new Map(shows.map((s) => [s.id, s]));
    res.json({ episodes: eps.map((e) => ({ id: e.id, showId: e.showId, showTitle: byId.get(e.showId)?.title ?? "", number: e.episodeNumber ?? null, title: e.title, at: Date.parse(e.publishedAt), cover: e.artworkUrl || byId.get(e.showId)?.artworkUrl || "" })) });
  });

  /** File a podcast episode in a Library folder, or take it out (folderId 0 or null). */
  app.post("/api/host/podcast-episodes/:id/folder", requireHostSession, async (req, res) => {
    const email = emailOf(req);
    const [e] = await db.select({ id: hostedEpisodes.id, showId: hostedEpisodes.showId }).from(hostedEpisodes).where(eq(hostedEpisodes.id, Number(req.params.id))).limit(1);
    if (!e || !(await ownShow(email, e.showId))) return res.status(404).json({ message: "No such episode." });
    const folderId = Number(req.body?.folderId) || 0;
    if (folderId && !(await storage.listFolders(email)).some((f) => f.id === folderId)) return res.status(404).json({ message: "No such folder." });
    await db.update(hostedEpisodes).set({ folderId }).where(eq(hostedEpisodes.id, e.id));
    res.json({ ok: true, folderId });
  });

  /** Turn an audio-only episode into a video (the worker does it): cover art, a soft backdrop and a moving sound wave. */
  app.post("/api/host/podcast-episodes/:id/make-video", requireHostSession, async (req, res) => {
    const email = emailOf(req);
    const [e] = await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.id, Number(req.params.id))).limit(1);
    const sh = e ? await ownShow(email, e.showId) : undefined;
    if (!e || !sh) return res.status(404).json({ message: "No such episode." });
    if (!(e.audioKey || e.audioUrl)) return res.status(400).json({ message: "That episode has no audio yet." });
    if (e.mime.startsWith("video/")) return res.status(400).json({ message: "That episode already has a video." });
    if (e.videoJob === "queued" || e.videoJob === "running") return res.json({ ok: true });
    await db.update(hostedEpisodes).set({ videoJob: "queued", videoJobAt: now(), videoError: "" }).where(eq(hostedEpisodes.id, e.id));
    res.json({ ok: true });
  });

  /** A podcast episode as a Library recording, so Pōstify and Social can work from it. A video episode becomes one at once; audio only can't. */
  app.post("/api/host/podcast-episodes/:id/library", requireHostSession, async (req, res) => {
    const email = emailOf(req);
    const [e] = await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.id, Number(req.params.id))).limit(1);
    const sh = e ? await ownShow(email, e.showId) : undefined;
    if (!e || !sh) return res.status(404).json({ message: "No such episode." });
    const linked = e.recordingId ? await storage.getRecording(e.recordingId) : undefined;
    if (linked && linked.status === "Ready" && linked.url && linked.email.trim().toLowerCase() === email) return res.json({ recording: linked });
    const [had] = await db.select().from(recordings).where(and(eq(recordings.email, email), eq(recordings.egressId, `PODCAST_${e.id}`))).limit(1);
    if (had) return res.json({ recording: had });
    if (!(e.mime.startsWith("video/") && e.audioKey)) return res.status(409).json({ audioOnly: true, message: "That one is audio only. Make a video from it first." });
    const at = e.publishedAt || e.createdAt || new Date().toISOString();
    const [row] = await db.insert(recordings).values({
      eventId: 0, studioId: 0, email, title: e.title || "Episode", egressId: `PODCAST_${e.id}`, status: "Ready", url: e.audioKey,
      durationSec: e.durationSec || 0, sizeBytes: String(e.sizeBytes || 0), startedAt: at, endedAt: at,
    }).returning();
    res.status(201).json({ recording: row });
  });

  app.get("/api/host/hosting/shows/:id/spots", requireHostSession, async (req, res) => {
    const s = await ownShow(emailOf(req), Number(req.params.id));
    if (!s) return res.status(404).json({ message: "No such show." });
    res.setHeader("Cache-Control", "no-store");
    const rows = (await db.select().from(hostedSpots).where(eq(hostedSpots.showId, s.id))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const out = [];
    for (const sp of rows) {
      const like = `%,${sp.id},%`;
      const [t] = (await db.execute(sql`select count(*)::int n from hosted_downloads where show_id = ${s.id} and app <> ${SPOTIFY_COPIES} and (',' || spots || ',') like ${like}`)) as unknown as { n: number }[];
      const [m] = (await db.execute(sql`select count(*)::int n from hosted_downloads where show_id = ${s.id} and app <> ${SPOTIFY_COPIES} and day >= ${since} and (',' || spots || ',') like ${like}`)) as unknown as { n: number }[];
      const day = new Date().toISOString().slice(0, 10);
      const state = !sp.active ? "paused" : sp.endsOn && sp.endsOn < day ? "ended" : sp.startsOn && sp.startsOn > day ? "scheduled" : "live";
      out.push({ ...sp, state, delivered: t?.n ?? 0, delivered30: m?.n ?? 0 });
    }
    res.json({ spots: out, voices: Object.entries(SPOT_VOICES).map(([k, v]) => ({ key: k, name: v.name })) });
  });

  /** A spot recorded from the words they wrote, in a voice they pick. Nothing is added to the show until they save it. */
  app.post("/api/host/hosting/shows/:id/spots/generate", requireHostSession, async (req, res) => {
    const email = emailOf(req);
    const s = await ownShow(email, Number(req.params.id));
    if (!s) return res.status(404).json({ message: "No such show." });
    const text = String(req.body?.text ?? "").trim().slice(0, 1500);
    const voice = SPOT_VOICES[String(req.body?.voice ?? "")] ?? SPOT_VOICES.brian;
    if (text.length < 10) return res.status(400).json({ message: "Write the sponsor's message first (a sentence or two)." });
    const key = (process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY || "").trim();
    if (!key) return res.status(503).json({ message: "Recording isn't set up on this server." });
    const hits = (spotRuns.get(email) ?? []).filter((t) => Date.now() - t < 24 * 3600_000);
    if (hits.length >= 20) return res.status(429).json({ message: "That's a lot of recordings for today. Try again tomorrow, or upload one." });
    spotRuns.set(email, [...hits, Date.now()]);
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}?output_format=mp3_44100_128`, {
        method: "POST", signal: AbortSignal.timeout(60_000), headers: { "xi-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.3, speed: 1.0 } }),
      });
      if (!r.ok) return res.status(502).json({ message: "The recording didn't come out. Try again." });
      const buf = Buffer.from(await r.arrayBuffer());
      const k = `show-assets/spot-${s.id}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.mp3`;
      await putRecordingObject(k, buf, "audio/mpeg");
      res.json({ key: k, durationSec: Math.max(1, Math.round(buf.length / 16000)), url: await signedRecordingUrl(k, 3600) });
    } catch (err) {
      console.error("Spot recording failed:", err);
      res.status(502).json({ message: "The recording didn't come out. Try again." });
    }
  });

  app.post("/api/host/hosting/shows/:id/spots", requireHostSession, async (req, res) => {
    const s = await ownShow(emailOf(req), Number(req.params.id));
    if (!s) return res.status(404).json({ message: "No such show." });
    const b = req.body ?? {};
    const key = typeof b.key === "string" && /^show-assets\/[\w.-]+$/.test(b.key) ? b.key : "";
    if (!key) return res.status(400).json({ message: "Add the recording first." });
    const sec = Math.max(0, Math.round(Number(b.durationSec) || 0));
    if (sec > 300) return res.status(400).json({ message: "Keep a spot under 5 minutes." });
    const sponsor = String(b.sponsor ?? "").trim().slice(0, 120);
    if (!sponsor) return res.status(400).json({ message: "Who is the sponsor?" });
    // For one episode (and a mid-roll is always for one): it has to be this show's.
    let forEpisode = 0;
    if (b.episodeId) {
      const [ep] = await db.select().from(hostedEpisodes).where(and(eq(hostedEpisodes.id, Number(b.episodeId)), eq(hostedEpisodes.showId, s.id))).limit(1);
      if (!ep) return res.status(404).json({ message: "That episode isn't in this show." });
      forEpisode = ep.id;
    }
    const atSec = Math.max(0, Math.round(Number(b.atSec) || 0));
    if (b.kind === "mid" && (!forEpisode || atSec < 5)) return res.status(400).json({ message: "A spot in the middle needs one episode and a time in it." });
    const [row] = await db.insert(hostedSpots).values({
      showId: s.id, sponsor, kind: b.kind === "post" ? "post" : b.kind === "mid" ? "mid" : "pre", episodeId: forEpisode, atSec: b.kind === "mid" ? atSec : 0, audioKey: key, audioName: String(b.name ?? "").slice(0, 120), audioSec: sec,
      script: String(b.script ?? "").slice(0, 1500), voice: String(b.voice ?? "").slice(0, 20), startsOn: ymd(b.startsOn), endsOn: ymd(b.endsOn),
      scope: ["future", "all", "full"].includes(b.scope) ? b.scope : "future", active: true, createdAt: now(),
    }).returning();
    await failedJobsReset(s.id);
    res.status(201).json(row);
  });

  app.patch("/api/host/hosting/spots/:id", requireHostSession, async (req, res) => {
    const [sp] = await db.select().from(hostedSpots).where(eq(hostedSpots.id, Number(req.params.id))).limit(1);
    if (!sp || !(await ownShow(emailOf(req), sp.showId))) return res.status(404).json({ message: "No such spot." });
    const b = req.body ?? {};
    const [row] = await db.update(hostedSpots).set({
      ...(typeof b.active === "boolean" ? { active: b.active } : {}),
      ...("startsOn" in b ? { startsOn: ymd(b.startsOn) } : {}),
      ...("endsOn" in b ? { endsOn: ymd(b.endsOn) } : {}),
      ...(["future", "all", "full"].includes(b.scope) ? { scope: b.scope } : {}),
      ...(typeof b.sponsor === "string" && b.sponsor.trim() ? { sponsor: b.sponsor.trim().slice(0, 120) } : {}),
    }).where(eq(hostedSpots.id, sp.id)).returning();
    await failedJobsReset(sp.showId);
    res.json(row);
  });

  app.delete("/api/host/hosting/spots/:id", requireHostSession, async (req, res) => {
    const [sp] = await db.select().from(hostedSpots).where(eq(hostedSpots.id, Number(req.params.id))).limit(1);
    if (!sp || !(await ownShow(emailOf(req), sp.showId))) return res.status(404).json({ message: "No such spot." });
    await db.delete(hostedSpots).where(eq(hostedSpots.id, sp.id));
    res.json({ ok: true });
  });

  app.get("/api/host/hosting/spots/:id/audio", requireHostSession, async (req, res) => {
    const [sp] = await db.select().from(hostedSpots).where(eq(hostedSpots.id, Number(req.params.id))).limit(1);
    if (!sp || !(await ownShow(emailOf(req), sp.showId))) return res.status(404).json({ message: "No such spot." });
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, await signedRecordingUrl(sp.audioKey, 3600));
  });

  /** Play the show's intro or outro (their own page's player). */
  app.get("/api/host/hosting/shows/:id/bookend/:kind", requireHostSession, async (req, res) => {
    const s = await ownShow(emailOf(req), Number(req.params.id));
    // ?ep=<id>: that episode's own intro when it has one (a teaser), else the show's.
    const [ep] = s && req.query.ep ? await db.select().from(hostedEpisodes).where(and(eq(hostedEpisodes.id, Number(req.query.ep)), eq(hostedEpisodes.showId, s.id))).limit(1) : [];
    const key = s ? (req.params.kind === "outro" ? s.outroKey : ep ? introOf(s, ep) : s.introKey) : "";
    if (!s || !key) return res.status(404).json({ message: "Not set." });
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, await signedRecordingUrl(key, 3600));
  });

  /** The episodes in a feed (the show's old host by default), newest first, to import one or to pull its words. */
  app.get("/api/host/hosting/shows/:id/feed-episodes", requireHostSession, async (req, res) => {
    const s = await ownShow(emailOf(req), Number(req.params.id));
    if (!s) return res.status(404).json({ message: "No such show." });
    const url = await resolveFeed(String(req.query.url ?? s.importedFrom ?? "").trim());
    if (!safeFeedUrl(url)) return res.status(400).json({ message: "Paste the RSS feed address (https://…) or an Apple Podcasts link." });
    let feed: ParsedFeed;
    try { feed = await readFeed(url); } catch (err) { return res.status(400).json({ message: (err as Error).message }); }
    const have = await episodesOf(s.id);
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const guids = new Set(have.map((x) => x.guid).filter(Boolean));
    const titles = new Set(have.map((x) => norm(x.title)));
    res.json({
      url, show: feed.title,
      episodes: feed.items.slice(0, 300).map((it) => ({ guid: it.guid, title: it.title, published: it.published, durationSec: it.duration, have: guids.has(it.guid) || titles.has(norm(it.title)) })).filter((x) => x.guid),
    });
  });

  /** An episode's title and show notes as they are in the feed: found by its id there, else by its title. Nothing is saved; the page fills the fields. */
  app.post("/api/host/hosting/episodes/:id/pull-from-feed", requireHostSession, async (req, res) => {
    const [e] = await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.id, Number(req.params.id))).limit(1);
    const s = e ? await ownShow(emailOf(req), e.showId) : undefined;
    if (!e || !s) return res.status(404).json({ message: "No such episode." });
    const url = await resolveFeed(String(req.body?.url ?? s.importedFrom ?? "").trim());
    if (!safeFeedUrl(url)) return res.status(400).json({ message: "Paste the feed address (https://…) to pull from." });
    let feed: ParsedFeed;
    try { feed = await readFeed(url); } catch (err) { return res.status(400).json({ message: (err as Error).message }); }
    const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w.length > 2));
    const mine = words(e.title);
    let best: { it: ParsedItem; score: number } | null = null;
    for (const it of feed.items) {
      if (e.guid && it.guid === e.guid) { best = { it, score: 2 }; break; }
      const w = words(it.title);
      const common = Array.from(mine).filter((x) => w.has(x)).length;
      const score = common / Math.max(1, Math.max(mine.size, w.size));
      if (!best || score > best.score) best = { it, score };
    }
    if (!best || best.score < 0.6) return res.json({ found: false });
    res.json({ found: true, title: best.it.title, notes: notesText(best.it.notes), matchedBy: best.score >= 2 ? "id" : "title" });
  });

  // An episode's own picture (in place of the still from its video, or the show's art).
  app.post("/api/host/hosting/episodes/:id/artwork", requireHostSession, art.single("file"), async (req, res) => {
    const [e] = await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.id, Number(req.params.id))).limit(1);
    if (!e || !(await ownShow(emailOf(req), e.showId))) return res.status(404).json({ message: "No such episode." });
    if (!req.file) return res.status(400).json({ message: "Choose an image." });
    try {
      const meta = await sharp(req.file.buffer).metadata();
      const side = Math.min(meta.width ?? 0, meta.height ?? 0);
      if (side < 600) return res.status(400).json({ message: `That image is ${side}px on its short side. Use one at least 1400 × 1400.` });
      const img = await sharp(req.file.buffer).rotate().resize(Math.min(3000, Math.max(1400, side)), Math.min(3000, Math.max(1400, side)), { fit: "cover", position: "attention" }).jpeg({ quality: 90 }).toBuffer();
      const url = await uploadPhoto(`podcast-art/episode-${e.id}-${Date.now()}.jpg`, img, "image/jpeg");
      await db.update(hostedEpisodes).set({ artworkUrl: url, stillJob: "done" }).where(eq(hostedEpisodes.id, e.id));
      res.json({ ok: true, url });
    } catch (err) {
      console.error("Episode art failed:", err);
      res.status(500).json({ message: "Couldn't use that image. Try a JPG or PNG." });
    }
  });

  app.patch("/api/host/hosting/episodes/:id", requireHostSession, async (req, res) => {
    const email = emailOf(req);
    const [e] = await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.id, Number(req.params.id))).limit(1);
    if (!e || !(await ownShow(email, e.showId))) return res.status(404).json({ message: "No such episode." });
    const b = req.body ?? {};
    const publish = b.status === "published";
    // Audio still being made (from a video, or copied in): it can be published now, and it joins
    // the feed by itself the moment its audio lands (the feed only lists episodes with audio).
    // Made from a Library recording and its MP3 not started yet: Publish starts it now.
    const makeAudio = publish && !(e.audioKey || e.audioUrl) && !e.audioJob && !!e.recordingId;
    if (publish && !makeAudio && !(e.audioKey || e.audioUrl) && (!e.audioJob || e.audioJob === "failed")) return res.status(400).json({ message: e.audioJob === "failed" ? "Its audio couldn't be made. Delete it and try again, or upload the audio." : "It needs its audio first." });
    // "Final draft" is the team's (or their) word that post-production is done. With auto-post on, that is the moment it goes out.
    const stageIn = b.stage === "post" || b.stage === "final" ? (b.stage as string) : undefined;
    if (stageIn === "post" && !(await hasProduction(email))) return res.status(403).json({ message: "Post-production is part of the Production plan." });
    // "Remove this audio" on a draft: it goes back to waiting for an upload (a published one is unpublished first).
    if (b.removeAudio === true) {
      if (e.status !== "draft") return res.status(400).json({ message: "Unpublish it first, then you can swap its audio." });
      const [cleared] = await db.update(hostedEpisodes).set({ audioKey: "", audioUrl: "", mime: "audio/mpeg", sizeBytes: 0, durationSec: 0, audioJob: "", servedSpots: "" }).where(eq(hostedEpisodes.id, e.id)).returning();
      await db.delete(showTranscripts).where(and(eq(showTranscripts.email, emailOf(req)), eq(showTranscripts.episodeKey, `hosted:${e.id}`))).catch(() => undefined);
      return res.json(cleared);
    }
    const readyToGo = !!(e.audioKey || e.audioUrl) && !e.audioJob;
    const autoShow = stageIn === "final" && e.status === "draft" && readyToGo && !publish ? await ownShow(email, e.showId) : null;
    const autoGo = !!autoShow?.autoPublish;
    // Publishing means everywhere at once (Andrew, 23 Nov 2026: Publishing mockup, "Yes, build both"): a show set to post to
    // YouTube "always" sends it there too, when the channel is connected and the episode has video. An "ask" show is left
    // as it was: nothing goes to YouTube it didn't tick. Already on YouTube (from the Library, or before): not again.
    const autoYouTube = autoGo && autoShow?.youtubeMode === "always" && hasVideo(e) && !/"state":"(sent|done|working)"/.test(e.youtube || "")
      && await storage.getProfileByEmail(email).then((p) => !!p?.uploadPostUsername && /youtube/i.test(p.socialAccounts ?? "")).catch(() => false);
    const at = typeof b.publishedAt === "string" && !Number.isNaN(Date.parse(b.publishedAt)) ? new Date(b.publishedAt).toISOString() : undefined;
    const [out] = await db.update(hostedEpisodes).set({
      ...(typeof b.title === "string" ? { title: b.title.slice(0, 300) } : {}),
      ...(typeof b.description === "string" ? { description: b.description.slice(0, 20000) } : {}),
      ...(b.notesFormat === "text" || b.notesFormat === "html" ? { notesFormat: b.notesFormat } : {}),
      ...(typeof b.guest === "string" ? { guest: b.guest.trim().slice(0, 200) } : {}),
      // The audio, added after the episode was made ("upload later"): the file is already in our storage.
      ...(typeof b.audioKey === "string" && /^show-assets\/[\w.-]+$/.test(b.audioKey) && !(e.audioKey || e.audioUrl) ? {
        audioKey: b.audioKey, audioJob: "",
        mime: typeof b.mime === "string" && /^(audio|video)\/[\w.+-]+$/.test(b.mime) ? b.mime : "audio/mpeg",
        sizeBytes: num(b.sizeBytes) ?? 0, durationSec: num(b.durationSec) ?? 0,
      } : {}),
      ...(typeof b.footerOff === "boolean" ? { footerOff: b.footerOff } : {}),
      ...(typeof b.spotsOff === "boolean" ? { spotsOff: b.spotsOff } : {}),
      ...(b.bookends === "on" || b.bookends === "off" || b.bookends === "" ? { bookends: b.bookends, ...(e.bookendJob === "failed" ? { bookendJob: "" } : {}) } : {}),
      ...("episodeNumber" in b ? { episodeNumber: num(b.episodeNumber) } : {}),
      ...("season" in b ? { season: num(b.season) } : {}),
      ...(["full", "trailer", "bonus"].includes(b.episodeType) ? { episodeType: b.episodeType } : {}),
      ...(typeof b.explicit === "boolean" ? { explicit: b.explicit } : {}),
      ...(stageIn ? { stage: stageIn } : {}),
      ...(autoGo ? { status: "published", publishedAt: now(), youtubeWanted: autoYouTube } : {}),
      ...(publish ? { status: "published", publishedAt: at ?? (e.publishedAt || now()) } : b.status === "draft" ? { status: "draft" } : {}),
      ...(makeAudio ? { audioJob: "queued", audioJobAt: now(), audioError: "" } : {}),
      ...(!publish && at ? { publishedAt: at } : {}),
      ...(typeof b.youtube === "boolean" ? { youtubeWanted: b.youtube && hasVideo(e) } : {}),
    }).where(eq(hostedEpisodes.id, e.id)).returning();
    // First episode out: the show goes to Listen Notes by itself.
    if (out.status === "published") { const job = listOnListenNotes(out.showId); try { waitUntil(job); } catch { /* not on Vercel */ } }
    // Out now: tell the apps (a scheduled one is told by the 15-minute cron when its time comes).
    if (out.status === "published") announceSoon(out.showId);
    // Out now and asked for YouTube: post it straight away (a scheduled one goes with the cron).
    if (out.youtubeWanted && out.status === "published" && Date.parse(out.publishedAt) <= Date.now()) {
      const show = await ownShow(emailOf(req), out.showId);
      try { if (show) return res.json({ ...out, youtubeWanted: false, youtube: await postEpisodeToYouTube(out, show, show.youtubePrivacy) }); }
      catch (err) { return res.json({ ...out, youtubeError: (err as Error).message }); }
    }
    res.json(out);
  });

  // An episode to their YouTube channel, as a video (Upload-Post, the account they connected on
  // the Social screen). The video: the MP4 they uploaded, or the Library recording it came from.
  app.post("/api/host/hosting/episodes/:id/youtube", requireHostSession, async (req, res) => {
    const email = emailOf(req);
    const [e] = await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.id, Number(req.params.id))).limit(1);
    const show = e ? await ownShow(email, e.showId) : null;
    if (!e || !show) return res.status(404).json({ message: "No such episode." });
    const privacy = ["public", "unlisted", "private"].includes(String(req.body?.privacy)) ? String(req.body.privacy) : show.youtubePrivacy;
    try {
      res.json({ ok: true, youtube: await postEpisodeToYouTube(e, show, privacy, req.body?.again === true) });
    } catch (err) {
      res.status((err as { status?: number }).status ?? 502).json({ message: (err as Error).message });
    }
  });

  // Not this one: it stays off YouTube, and "Always post" leaves it alone.
  app.post("/api/host/hosting/episodes/:id/youtube/skip", requireHostSession, async (req, res) => {
    const [e] = await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.id, Number(req.params.id))).limit(1);
    if (!e || !(await ownShow(emailOf(req), e.showId))) return res.status(404).json({ message: "No such episode." });
    const skip = req.body?.skip !== false;
    const [out] = await db.update(hostedEpisodes).set({ youtube: skip ? JSON.stringify({ state: "skipped", at: now() }) : "", youtubeWanted: false }).where(eq(hostedEpisodes.id, e.id)).returning();
    res.json(out);
  });

  // Every 15 minutes: scheduled episodes that asked for YouTube, once they're out.
  /** Daily: shows with an episode out that aren't live on Listen Notes yet are (re)submitted; a pending one comes back "found" once accepted. */
  app.get("/api/cron/listennotes", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") !== secret) return res.status(401).json({ message: "Not authorised." });
    if (!isListenNotesConfigured()) return res.json({ checked: 0, reason: "no key" });
    await schemaIsReady();
    const ids = (await db.selectDistinct({ id: hostedEpisodes.showId }).from(hostedEpisodes).where(eq(hostedEpisodes.status, "published"))).map((r) => r.id);
    let checked = 0;
    // A few a day at most: the free plan is 150 requests a month.
    for (const id of ids.slice(0, 25)) { await listOnListenNotes(id); checked++; }
    res.json({ checked });
  });

  app.get("/api/cron/youtube-episodes", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") !== secret) return res.status(401).json({ message: "Not authorised." });
    const due = await db.select().from(hostedEpisodes).where(and(eq(hostedEpisodes.youtubeWanted, true), eq(hostedEpisodes.status, "published"))).limit(50);
    let sent = 0;
    for (const e of due) {
      if (!e.publishedAt || Date.parse(e.publishedAt) > Date.now()) continue;
      // Claimed first, so it can't go twice.
      const [mine] = await db.update(hostedEpisodes).set({ youtubeWanted: false }).where(and(eq(hostedEpisodes.id, e.id), eq(hostedEpisodes.youtubeWanted, true))).returning({ id: hostedEpisodes.id });
      if (!mine) continue;
      const [show] = await db.select().from(hostedShows).where(eq(hostedShows.id, e.showId)).limit(1);
      if (!show) continue;
      try { await postEpisodeToYouTube(e, show, show.youtubePrivacy); sent++; }
      catch (err) { await db.update(hostedEpisodes).set({ youtube: JSON.stringify({ state: "failed", at: now(), error: (err as Error).message }) }).where(eq(hostedEpisodes.id, e.id)); }
    }
    // Every show with an episode that went live since we last told the apps (a scheduled one whose time came,
    // or one we missed): tell them now. Only shows with something new make any request.
    const showIds = (await db.selectDistinct({ id: hostedEpisodes.showId }).from(hostedEpisodes).where(eq(hostedEpisodes.status, "published"))).map((r) => r.id);
    let announced = 0;
    for (const id of showIds) if (await announceShow(id).catch(() => null)) announced++;
    res.json({ sent, announced });
  });

  // Confirm the owner email with a code, before it goes in the feed.
  app.post("/api/host/hosting/shows/:id/owner-email/send", requireHostSession, async (req, res) => {
    const s = await ownShow(emailOf(req), Number(req.params.id));
    if (!s) return res.status(404).json({ message: "No such show." });
    const to = s.ownerEmail.trim();
    if (!to) return res.status(400).json({ message: "Add the owner email first." });
    if (s.ownerCodeAt && Date.now() - Date.parse(s.ownerCodeAt) < 45_000) return res.status(429).json({ message: "A code is on its way. Give it a minute before asking for another." });
    const code = String(crypto.randomInt(100000, 1000000));
    await db.update(hostedShows).set({ ownerCode: crypto.createHash("sha256").update(`${s.id}:${code}`).digest("hex"), ownerCodeAt: now() }).where(eq(hostedShows.id, s.id));
    const ok = await sendPodcastOwnerCodeEmail({ to, code, show: s.title });
    if (!ok) return res.status(502).json({ message: "Couldn't send the code just now. Try again in a minute." });
    res.json({ sent: to });
  });
  app.post("/api/host/hosting/shows/:id/owner-email/confirm", requireHostSession, async (req, res) => {
    const s = await ownShow(emailOf(req), Number(req.params.id));
    if (!s) return res.status(404).json({ message: "No such show." });
    const code = String(req.body?.code ?? "").replace(/\D/g, "");
    const fresh = s.ownerCodeAt && Date.now() - Date.parse(s.ownerCodeAt) < 30 * 60_000;
    if (!fresh || !s.ownerCode || crypto.createHash("sha256").update(`${s.id}:${code}`).digest("hex") !== s.ownerCode) return res.status(400).json({ message: "That code isn't right, or it's more than 30 minutes old. Send a new one." });
    const [out] = await db.update(hostedShows).set({ ownerEmailVerified: s.ownerEmail.trim().toLowerCase(), ownerCode: "", ownerCodeAt: "" }).where(eq(hostedShows.id, s.id)).returning();
    res.json(out);
  });

  // Move a show here: read its feed from the old host, keep every episode (and its guid, so no app plays it twice).
  // A show they named at sign-up that's already hosted here, on another account (23 Nov 2026: Andrew, "Admin-only is fine").
  // Moving between accounts is admin-only (Admin → contact → Move), so the card offers "Ask us to move it" instead of an import that can only fail.
  const hostedElsewhere = async (rss: string, me: string) => {
    const slug = rss.match(/militaryvoices?\.ai\/feed\/([a-z0-9-]+)/i)?.[1] ?? "";
    if (!slug && !/^https?:\/\//i.test(rss)) return null;
    const [s] = await db.select({ id: hostedShows.id, email: hostedShows.email, title: hostedShows.title }).from(hostedShows)
      .where(sql`${hostedShows.slug} = ${slug} or (${hostedShows.importedFrom} <> '' and ${hostedShows.importedFrom} = ${rss})`).limit(1);
    return s && s.email.toLowerCase() !== me ? s : null;
  };
  const askKey = (showId: number, me: string) => `move-ask:${showId}:${me}`;
  app.get("/api/host/hosting/elsewhere", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const me = emailOf(req), s = await hostedElsewhere(String(req.query.rss ?? "").trim(), me);
    if (!s) return res.json({ elsewhere: false });
    res.json({ elsewhere: true, title: s.title, asked: !!(await storage.getSetting(askKey(s.id, me)).catch(() => null)) });
  });
  app.post("/api/host/hosting/ask-move", requireHostSession, async (req, res) => {
    const me = emailOf(req), s = await hostedElsewhere(String(req.body?.rss ?? "").trim(), me);
    if (!s) return res.status(404).json({ message: "We couldn't find that show here." });
    const key = askKey(s.id, me);
    if (!(await storage.getSetting(key).catch(() => null))) {
      await storage.setSetting(key, now());
      const p = await storage.getProfileByEmail(me).catch(() => undefined);
      const name = p?.hostName || "";
      const link = `${ORIGIN}/admin/crm?profile=${encodeURIComponent(s.email.toLowerCase())}&move=${s.id}&to=${encodeURIComponent(me)}`;
      await storage.createHelpRequest({ name, email: me, question: `Please move my show "${s.title}" (show ${s.id}, now on ${s.email}) to this account, ${me}.`, transcript: `Move: ${link}`, page: "/podcast" }).catch((e) => console.warn("move ask not saved:", (e as Error).message));
      await slackNote(`:truck: Move request: ${name ? `${name} <${me}>` : me} asks to move "${s.title}" (show ${s.id}) from ${s.email} to ${me}.`, { label: "Open Move", url: link });
    }
    res.json({ ok: true });
  });

  app.post("/api/host/hosting/import", requireHostSession, async (req, res) => {
    const email = emailOf(req);
    // An Apple Podcasts page link works too: we look up the feed behind it.
    const url = await resolveFeed(String(req.body?.feedUrl ?? "").trim());
    if (!safeFeedUrl(url)) return res.status(400).json({ message: "Paste your show's RSS feed address (https://…), or its Apple Podcasts link." });
    const mine = await showsOf(email);
    const target = mine[0];
    if (target && (await episodesOf(target.id)).length) return res.status(409).json({ message: "You already host a show here with episodes. Moving a second show over is coming later." });
    let feed: ParsedFeed;
    try {
      feed = await readFeed(url);
    } catch (e) {
      return res.status(400).json({ message: (e as Error).message });
    }
    if (!feed.items.length) return res.status(400).json({ message: "That feed has no episodes we can play." });
    // Already hosted here (our own feed, or an old feed that forwards to it): importing would copy it under a second address and
    // chain a redirect off our own feed. A show moves between accounts instead (Admin → contact → Move).
    const ourSlug = url.match(/militaryvoices?\.ai\/feed\/([a-z0-9-]+)/i)?.[1];
    const [already] = await db.select({ id: hostedShows.id, email: hostedShows.email }).from(hostedShows)
      .where(sql`${hostedShows.slug} = ${ourSlug ?? ""} or ${hostedShows.importedFrom} = ${url} or (${hostedShows.guid} <> '' and ${hostedShows.guid} = ${feed.guid || "-"})`).limit(1);
    if (already && already.id !== target?.id) return res.status(409).json({ message: already.email.toLowerCase() === email ? "That show is already hosted here, on this account." : "That show is already hosted on MilitaryVoices, on another account. Ask us and we'll move it to this one, with its feed, listings and downloads unchanged." });
    const slug = target?.slug ?? await uniqueSlug(slugify(feed.title || "show"));
    const fields = {
      title: feed.title.slice(0, 200), description: plainDesc(feed.description).slice(0, 4000), author: feed.author.slice(0, 200),
      ownerName: feed.ownerName.slice(0, 200), ownerEmail: (feed.ownerEmail || email).slice(0, 200),
      ownerEmailVerified: (feed.ownerEmail || email).toLowerCase() === email ? email : "",
      artworkUrl: feed.artwork, category: feed.category in CATEGORIES ? feed.category : "Government",
      subcategory: feed.category in CATEGORIES && (CATEGORIES[feed.category] ?? []).includes(feed.subcategory) ? feed.subcategory : "",
      language: /^[a-z]{2}(-[a-z]{2})?$/i.test(feed.language) ? feed.language.toLowerCase() : "en-us",
      explicit: feed.explicit, showType: feed.type, website: (/(^|\.)(buzzsprout|libsyn|podbean|transistor|simplecast|megaphone|captivate|rss|spreaker|anchor|spotify|acast|omny|blubrry|castos|fireside|redcircle|podomatic)\.(com|fm|co|io)\b/i.test(feed.link) ? "" : feed.link).slice(0, 300), copyright: feed.copyright.slice(0, 300),
      guid: feed.guid || podcastGuid(url), importedFrom: url, redirectOk: false, redirectCheckedAt: "", updatedAt: now(),
    };
    const [show] = target
      ? await db.update(hostedShows).set(fields).where(eq(hostedShows.id, target.id)).returning()
      : await db.insert(hostedShows).values({ email, slug, ...fields, youtubeMode: "always", createdAt: now() }).returning();
    const rows = feed.items.slice(0, 3000).map((it) => ({
      showId: show.id, title: it.title.slice(0, 300), description: it.notes.slice(0, 20000), notesFormat: "html",
      audioUrl: it.url, mime: it.mime, sizeBytes: Math.min(2_000_000_000, it.length), durationSec: it.duration,
      episodeNumber: it.episode, season: it.season, episodeType: it.episodeType, explicit: it.explicit, artworkUrl: it.image,
      guid: it.guid, status: "published", publishedAt: it.published || now(), createdAt: now(),
      audioJob: "copy",
    }));
    for (let i = 0; i < rows.length; i += 200) await db.insert(hostedEpisodes).values(rows.slice(i, i + 200));
    // The cover art, kept with us (the old host's copy goes when the account does), and where it's listed already.
    await findListings(show).catch((err) => console.warn("Listings on import:", (err as Error).message));
    res.status(201).json({ show, episodes: rows.length });
  });

  // A moved show: bring its cover art over, and find where it's listed already (Apple, by its feed).
  app.post("/api/host/hosting/shows/:id/listings", requireHostSession, async (req, res) => {
    const s = await ownShow(emailOf(req), Number(req.params.id));
    if (!s) return res.status(404).json({ message: "No such show." });
    res.json(await findListings(s));
  });

  // Has the old host started forwarding to us? Follow the old feed and see where it ends.
  app.post("/api/host/hosting/shows/:id/redirect-check", requireHostSession, async (req, res) => {
    const s = await ownShow(emailOf(req), Number(req.params.id));
    if (!s) return res.status(404).json({ message: "No such show." });
    if (!s.importedFrom) return res.status(400).json({ message: "This show started here: there's no old feed to forward." });
    const ours = feedUrl(s.slug).replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
    const norm = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
    let at = s.importedFrom;
    const hops: { url: string; status: number }[] = [];
    let ok = false;
    let tagged = false;
    try {
      for (let i = 0; i < 6; i++) {
        if (!safeFeedUrl(at)) break;
        const r = await fetch(at, { redirect: "manual", headers: { "User-Agent": "MilitaryVoices.ai redirect check" }, signal: AbortSignal.timeout(10_000) });
        hops.push({ url: at, status: r.status });
        const loc = r.headers.get("location");
        if (r.status >= 300 && r.status < 400 && loc) {
          at = new URL(loc, at).toString();
          if (norm(at).replace(/\?.*$/, "") === ours) { ok = true; break; }
          continue;
        }
        if (r.ok) { const m = (await r.text()).match(/<itunes:new-feed-url>\s*([^<\s]+)\s*<\/itunes:new-feed-url>/i); tagged = !!m && norm(m[1]) === ours; }
        break;
      }
    } catch (e) {
      hops.push({ url: at, status: 0 });
    }
    const [out] = await db.update(hostedShows).set({ redirectOk: ok, redirectCheckedAt: now() }).where(eq(hostedShows.id, s.id)).returning();
    res.json({ ok, tagged, hops, show: out });
  });

  // Delete a show: its episodes go with it and its feed stops, so apps still reading it drop the show.
  // They typed its name to confirm; the help says to take it down in Apple and Spotify first.
  app.delete("/api/host/hosting/shows/:id", requireHostSession, async (req, res) => {
    const email = emailOf(req);
    const s = await ownShow(email, Number(req.params.id));
    if (!s) return res.status(404).json({ message: "No such show." });
    if (String(req.body?.confirm ?? "").trim().toLowerCase() !== s.title.trim().toLowerCase()) return res.status(400).json({ message: "Type the show's name to delete it." });
    const eps = await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.showId, s.id));
    await toTrash({ email, kind: "show", label: s.title || "Your show", rows: { hostedShows: [s], hostedEpisodes: eps } });
    await db.delete(hostedEpisodes).where(eq(hostedEpisodes.showId, s.id));
    await db.delete(hostedShows).where(eq(hostedShows.id, s.id));
    res.json({ ok: true });
  });

  // Move an episode to another of their shows (Andrew, 24 Nov 2026: Riccoh's Warriors' Voice episodes). It keeps its
  // guid, so an app that already has it doesn't count it twice when it turns up in the other feed; it takes the next
  // number there (the highest used + 1). Its downloads and its own sponsor spots go with it; its clips and transcript
  // hang off its id and its recording, so they come along by themselves. An intro made for this episode was made for
  // the old show, so it goes: the new show's own intro and outro play.
  app.post("/api/host/hosting/episodes/:id/move", requireHostSession, async (req, res) => {
    const r = await moveEpisodes(emailOf(req), [Number(req.params.id)], Number(req.body?.showId));
    if ("error" in r) return res.status(r.status).json({ message: r.error });
    res.json(r.moved[0] ?? null);
  });
  // Several at once (Andrew, 24 Nov: "if he wanted to move 12 of them over"): one request, all or none.
  app.post("/api/host/hosting/episodes/move", requireHostSession, async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 500) : [];
    if (!ids.length) return res.status(400).json({ message: "Choose the episodes to move." });
    const r = await moveEpisodes(emailOf(req), ids, Number(req.body?.toShowId));
    if ("error" in r) return res.status(r.status).json({ message: r.error });
    res.json({ moved: r.moved.length });
  });

  app.delete("/api/host/hosting/episodes/:id", requireHostSession, async (req, res) => {
    const email = emailOf(req);
    const [e] = await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.id, Number(req.params.id))).limit(1);
    if (!e || !(await ownShow(email, e.showId))) return res.status(404).json({ message: "No such episode." });
    await toTrash({ email, kind: "episode", label: e.title || "An episode", rows: { hostedEpisodes: [e] } });
    await db.delete(hostedEpisodes).where(eq(hostedEpisodes.id, e.id));
    res.json({ ok: true });
  });

  // "Write it for me": a title and show notes drafted from what is said on the episode. The worker listens first
  // (the same transcriber Ask my show uses), so the first answer is "working"; the page asks again until it's ready.
  app.post("/api/host/hosting/episodes/:id/write", requireHostSession, async (req, res) => {
    const email = emailOf(req);
    const [e] = await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.id, Number(req.params.id))).limit(1);
    const show = e ? await ownShow(email, e.showId) : null;
    if (!e || !show) return res.status(404).json({ message: "No such episode." });
    if (!(e.audioKey || e.audioUrl)) return res.status(400).json({ message: "Add the audio first, then we can listen to it." });
    const t = await episodeSaid(e, email, req.body?.again === true);
    if (t.state === "working") return res.json({ state: "working" });
    if (t.state === "failed") return res.json({ state: "failed", message: t.message });
    if (overLimit(`d:${email}`, 30)) return res.status(429).json({ message: "That's plenty for today. Try again tomorrow." });
    try {
      res.json({ state: "done", ...(await writeEpisodeText(show, e.title, t.said)) });
    } catch (err) {
      console.error("Episode write failed:", (err as Error).message);
      res.status(502).json({ message: "Couldn't write that just now. Try again, or type your own." });
    }
  });
}
