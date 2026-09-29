import type { Express, Request } from "express";
import crypto from "node:crypto";
import multer from "multer";
import sharp from "sharp";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { requireHostSession, getSessionEmail } from "./session.js";
import { signedRecordingUrl } from "./recordingStorage.js";
import { uploadPhoto } from "./photoStorage.js";
import { sendPodcastOwnerCodeEmail } from "./email.js";
import { XMLParser } from "fast-xml-parser";
import { bioPages, hostedShows, hostedEpisodes, hostedDownloads, type HostedShowRow, type HostedEpisodeRow, type CleanResult, type PodcastStatsData } from "../shared/schema.js";

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
const notesHtml = (s: string) => s.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
const rfc822 = (iso: string) => new Date(iso).toUTCString();
/** Show notes as plain text for the public page: tags out (an imported feed's HTML is never put on our page), paragraphs kept. */
const notesText = (html: string) => html
  .replace(/<(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/\n{3,}/g, "\n\n").trim();
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
function appOf(ua: string): string {
  const u = ua.toLowerCase();
  if (/applecoremedia|apple ?podcasts|podcasts\/\d|itunes/.test(u)) return "Apple Podcasts";
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
      title: txt(it.title) || "Untitled episode",
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
    title: txt(ch.title), description: txt(ch.description) || txt(ch["itunes:summary"]), author: txt(ch["itunes:author"]),
    ownerName: txt(owner["itunes:name"]), ownerEmail: txt(owner["itunes:email"]),
    artwork: attr(ch["itunes:image"], "href") || txt((ch.image as Record<string, unknown> | undefined)?.url),
    category: attr(cat, "text"), subcategory: attr(cat?.["itunes:category"], "text"),
    language: txt(ch.language), explicit: yes(ch["itunes:explicit"]), type: txt(ch["itunes:type"]) === "serial" ? "serial" : "episodic",
    link: txt(ch.link), copyright: txt(ch.copyright), guid: txt(ch["podcast:guid"]),
    items,
  };
}

// ---- Data -----------------------------------------------------------------------

async function showsOf(email: string) {
  return db.select().from(hostedShows).where(eq(hostedShows.email, email)).orderBy(hostedShows.id);
}
async function ownShow(email: string, id: number) {
  const [s] = await db.select().from(hostedShows).where(and(eq(hostedShows.id, id), eq(hostedShows.email, email))).limit(1);
  return s ?? null;
}
async function episodesOf(showId: number) {
  return db.select().from(hostedEpisodes).where(eq(hostedEpisodes.showId, showId)).orderBy(desc(hostedEpisodes.publishedAt), desc(hostedEpisodes.id));
}
const live = (e: HostedEpisodeRow) => e.status === "published" && !!e.publishedAt && Date.parse(e.publishedAt) <= Date.now() && !!(e.audioKey || e.audioUrl);

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

export function feedXml(s: HostedShowRow, eps: HostedEpisodeRow[]): string {
  const self = feedUrl(s.slug);
  const owner = feedOwnerEmail(s);
  const notes = (e: HostedEpisodeRow) => (e.notesFormat === "html" ? e.description : notesHtml(e.description));
  const link = s.website || `${ORIGIN}/podcast/${s.slug}`;
  const cat = s.subcategory
    ? `<itunes:category text="${esc(s.category)}"><itunes:category text="${esc(s.subcategory)}"/></itunes:category>`
    : `<itunes:category text="${esc(s.category)}"/>`;
  const items = eps.filter(live).map((e) => {
    const url = `${ORIGIN}/e/${e.id}.${extOf(e.mime)}`;
    return `
    <item>
      <title>${esc(e.title)}</title>
      <description>${cdata(notes(e))}</description>
      <content:encoded>${cdata(notes(e))}</content:encoded>
      <enclosure url="${esc(url)}" length="${e.sizeBytes || 0}" type="${esc(e.mime)}"/>
      <guid isPermaLink="false">${esc(e.guid || `mv-${e.id}`)}</guid>
      <pubDate>${rfc822(e.publishedAt)}</pubDate>
      ${e.durationSec ? `<itunes:duration>${e.durationSec}</itunes:duration>` : ""}
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
    <language>${esc(s.language)}</language>
    <description>${cdata(s.description)}</description>
    <itunes:summary>${cdata(s.description)}</itunes:summary>
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
  const [tot] = await db.select({ n: sql<number>`count(*)::int` }).from(hostedDownloads).where(eq(hostedDownloads.showId, showId));
  const byDay = await db.select({ day: hostedDownloads.day, n: sql<number>`count(*)::int` }).from(hostedDownloads)
    .where(and(eq(hostedDownloads.showId, showId), gte(hostedDownloads.day, since))).groupBy(hostedDownloads.day);
  const byEp = await db.select({ id: hostedDownloads.episodeId, n: sql<number>`count(*)::int` }).from(hostedDownloads)
    .where(eq(hostedDownloads.showId, showId)).groupBy(hostedDownloads.episodeId);
  const byApp = await db.select({ app: hostedDownloads.app, n: sql<number>`count(*)::int` }).from(hostedDownloads)
    .where(and(eq(hostedDownloads.showId, showId), gte(hostedDownloads.day, since))).groupBy(hostedDownloads.app);
  const map = new Map(byDay.map((r) => [r.day, r.n]));
  const series = Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().slice(0, 10);
    return { date: d, count: map.get(d) ?? 0 };
  });
  return { total: tot?.n ?? 0, series, episodes: new Map(byEp.map((r) => [r.id, r.n])), apps: Object.fromEntries(byApp.map((r) => [r.app || "Other", r.n])) };
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
    out.push({
      source: "militaryvoices" as const,
      showName: s.title,
      status: "ok",
      error: "",
      fetchedAt: now(),
      data: {
        total: st.total,
        unit: "downloads" as const,
        episodes: eps.map((e) => ({ title: e.title, published: e.publishedAt.slice(0, 10), count: st.episodes.get(e.id) ?? 0 })),
        series: st.series,
        audience: Object.keys(st.apps).length ? { apps: st.apps } : undefined,
        artwork: s.artworkUrl || undefined,
      },
    });
  }
  return out;
}

// ---- Routes -----------------------------------------------------------------------

const art = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const emailOf = (req: Request) => (getSessionEmail(req) ?? "").trim().toLowerCase();
const num = (v: unknown) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v))));

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

/**
 * An episode that's a video (uploaded, or made from a Library recording), with no picture of its own: the worker
 * takes a still from the video for it (the page's thumbnail, and the feed's).
 */
export async function claimEpisodeStill(): Promise<{ id: number; title: string; durationSec: number; url: string } | null> {
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

  app.post("/api/agent/episode-audio/:id/done", requireAgent, async (req, res) => {
    const key = String(req.body?.audioKey ?? "");
    if (!/^clean\/[\w.-]+$/.test(key)) return res.status(400).json({ message: "No audio." });
    const copied = req.body?.copy === true;
    await db.update(hostedEpisodes).set({ audioKey: key, ...(copied ? {} : { mime: "audio/mpeg" }), ...(num(req.body?.sizeBytes) ? { sizeBytes: num(req.body?.sizeBytes)! } : {}), ...(num(req.body?.durationSec) ? { durationSec: num(req.body?.durationSec)! } : {}), audioJob: "", audioError: "" }).where(eq(hostedEpisodes.id, Number(req.params.id)));
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
      show: { title: s.title, description: s.description, author: s.author || s.ownerName, artworkUrl: s.artworkUrl, category: s.category, website: s.website, appleUrl: s.appleUrl, spotifyUrl: s.spotifyUrl, feedUrl: feedUrl(s.slug) },
      episodes: eps.map((e) => ({ id: e.id, title: e.title, notes: e.notesFormat === "html" ? notesText(e.description) : e.description, publishedAt: e.publishedAt, durationSec: e.durationSec, episodeNumber: e.episodeNumber, season: e.season, artworkUrl: e.artworkUrl, audio: `${ORIGIN}/e/${e.id}.${extOf(e.mime)}` })),
    });
  });

  // The feed.
  app.get("/feed/:slug", async (req, res) => {
    const slug = String(req.params.slug).replace(/\.(xml|rss)$/i, "");
    const [s] = await db.select().from(hostedShows).where(eq(hostedShows.slug, slug)).limit(1);
    if (!s) return res.status(404).type("text/plain").send("No such feed.");
    // Moved to another host: the apps follow a permanent redirect (and the tag, for the ones that read the feed first).
    if (s.newFeedUrl && req.query.preview !== "1") return res.redirect(301, s.newFeedUrl);
    const eps = await episodesOf(s.id);
    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
    res.send(feedXml(s, eps));
  });

  // The audio: count it, then send the app to the file.
  app.get("/e/:file", async (req, res) => {
    const id = Number(String(req.params.file).split(".")[0]);
    const [e] = Number.isInteger(id) ? await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.id, id)).limit(1) : [];
    if (!e || !(e.audioKey || e.audioUrl)) return res.status(404).type("text/plain").send("Not found.");
    const ua = String(req.get("user-agent") ?? "");
    const range = String(req.get("range") ?? "");
    const counts = req.method === "GET" && (!range || /^bytes=0-/.test(range)) && ua && !BOT.test(ua) && e.status === "published";
    if (counts) {
      const ip = String(req.ip ?? "");
      const day = today();
      const listenerHash = crypto.createHash("sha256").update(`${ip}|${ua}|${day}|${process.env.SESSION_SECRET ?? "mv"}`).digest("hex").slice(0, 40);
      // Once per listener per episode per day: the unique index does the de-duplicating.
      await db.insert(hostedDownloads).values({ showId: e.showId, episodeId: e.id, day, listenerHash, app: appOf(ua), createdAt: now() }).onConflictDoNothing().catch((err) => console.warn("Download not counted:", (err as Error).message));
    }
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, e.audioKey ? await signedRecordingUrl(e.audioKey, 6 * 3600) : e.audioUrl);
  });

  // ---- The podcaster's side ----

  app.get("/api/host/hosting", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const email = emailOf(req);
    const shows = await showsOf(email);
    const out = [];
    for (const s of shows) {
      const eps = await episodesOf(s.id);
      const st = await showStats(s.id, 30);
      out.push({
        show: s,
        feedUrl: feedUrl(s.slug),
        missing: readiness(s, eps),
        ownerConfirmed: feedOwnerEmail(s) === s.ownerEmail.trim(),
        episodes: eps.map((e) => ({ ...e, downloads: st.episodes.get(e.id) ?? 0, live: live(e) })),
        stats: { total: st.total, last30: st.series.reduce((a, d) => a + d.count, 0), series: st.series, apps: st.apps },
      });
    }
    res.json({ shows: out, categories: CATEGORIES });
  });

  // A show: new, with what we already know about them filled in.
  app.post("/api/host/hosting/shows", requireHostSession, async (req, res) => {
    const email = emailOf(req);
    const b = req.body ?? {};
    const profile = await storage.getProfileByEmail(email).catch(() => undefined);
    const title = String(b.title ?? "").trim().slice(0, 200) || (profile?.podcastName ?? "").trim() || "My podcast";
    const slug = await uniqueSlug(slugify(title));
    const [s] = await db.insert(hostedShows).values({
      email, slug, title,
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
      ...str("title", 200), ...str("description", 4000), ...str("author", 200), ...str("ownerName", 200), ...str("website", 300), ...str("copyright", 300),
      ...(category ? { category, subcategory: subcategory ?? "" } : subcategory !== undefined ? { subcategory } : {}),
      ...(typeof b.explicit === "boolean" ? { explicit: b.explicit } : {}),
      ...(b.showType === "serial" || b.showType === "episodic" ? { showType: b.showType } : {}),
      ...(typeof b.language === "string" && /^[a-z]{2}(-[a-z]{2})?$/i.test(b.language) ? { language: b.language.toLowerCase() } : {}),
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
    if (!audioKey && !recordingId) return res.status(400).json({ message: "Add the episode's audio." });
    const eps = await episodesOf(s.id);
    const [e] = await db.insert(hostedEpisodes).values({
      showId: s.id, title: title || "New episode", description: String(b.description ?? "").slice(0, 20000),
      audioKey, mime, sizeBytes: num(b.sizeBytes) ?? 0, durationSec, recordingId,
      episodeNumber: num(b.episodeNumber) ?? (s.showType === "serial" ? null : eps.filter((x) => x.episodeType === "full").length + 1),
      season: num(b.season), guid: crypto.randomUUID(), status: "draft", createdAt: now(),
      audioJob: audioKey ? "" : "queued", audioJobAt: audioKey ? "" : now(),
    }).returning();
    res.status(201).json(e);
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
    if (publish && !(e.audioKey || e.audioUrl) && (!e.audioJob || e.audioJob === "failed")) return res.status(400).json({ message: e.audioJob === "failed" ? "Its audio couldn't be made. Delete it and try again, or upload the audio." : "It needs its audio first." });
    const at = typeof b.publishedAt === "string" && !Number.isNaN(Date.parse(b.publishedAt)) ? new Date(b.publishedAt).toISOString() : undefined;
    const [out] = await db.update(hostedEpisodes).set({
      ...(typeof b.title === "string" ? { title: b.title.slice(0, 300) } : {}),
      ...(typeof b.description === "string" ? { description: b.description.slice(0, 20000) } : {}),
      ...("episodeNumber" in b ? { episodeNumber: num(b.episodeNumber) } : {}),
      ...("season" in b ? { season: num(b.season) } : {}),
      ...(["full", "trailer", "bonus"].includes(b.episodeType) ? { episodeType: b.episodeType } : {}),
      ...(typeof b.explicit === "boolean" ? { explicit: b.explicit } : {}),
      ...(publish ? { status: "published", publishedAt: at ?? (e.publishedAt || now()) } : b.status === "draft" ? { status: "draft" } : {}),
      ...(!publish && at ? { publishedAt: at } : {}),
    }).where(eq(hostedEpisodes.id, e.id)).returning();
    res.json(out);
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
  app.post("/api/host/hosting/import", requireHostSession, async (req, res) => {
    const email = emailOf(req);
    const url = String(req.body?.feedUrl ?? "").trim();
    if (!safeFeedUrl(url)) return res.status(400).json({ message: "Paste your show's RSS feed address (https://…)." });
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
    const slug = target?.slug ?? await uniqueSlug(slugify(feed.title || "show"));
    const fields = {
      title: feed.title.slice(0, 200), description: feed.description.slice(0, 4000), author: feed.author.slice(0, 200),
      ownerName: feed.ownerName.slice(0, 200), ownerEmail: (feed.ownerEmail || email).slice(0, 200),
      ownerEmailVerified: (feed.ownerEmail || email).toLowerCase() === email ? email : "",
      artworkUrl: feed.artwork, category: feed.category in CATEGORIES ? feed.category : "Government",
      subcategory: feed.category in CATEGORIES && (CATEGORIES[feed.category] ?? []).includes(feed.subcategory) ? feed.subcategory : "",
      language: /^[a-z]{2}(-[a-z]{2})?$/i.test(feed.language) ? feed.language.toLowerCase() : "en-us",
      explicit: feed.explicit, showType: feed.type, website: feed.link.slice(0, 300), copyright: feed.copyright.slice(0, 300),
      guid: feed.guid || podcastGuid(url), importedFrom: url, redirectOk: false, redirectCheckedAt: "", updatedAt: now(),
    };
    const [show] = target
      ? await db.update(hostedShows).set(fields).where(eq(hostedShows.id, target.id)).returning()
      : await db.insert(hostedShows).values({ email, slug, ...fields, createdAt: now() }).returning();
    const rows = feed.items.slice(0, 3000).map((it) => ({
      showId: show.id, title: it.title.slice(0, 300), description: it.notes.slice(0, 20000), notesFormat: "html",
      audioUrl: it.url, mime: it.mime, sizeBytes: Math.min(2_000_000_000, it.length), durationSec: it.duration,
      episodeNumber: it.episode, season: it.season, episodeType: it.episodeType, explicit: it.explicit, artworkUrl: it.image,
      guid: it.guid, status: "published", publishedAt: it.published || now(), createdAt: now(),
      audioJob: "copy",
    }));
    for (let i = 0; i < rows.length; i += 200) await db.insert(hostedEpisodes).values(rows.slice(i, i + 200));
    res.status(201).json({ show, episodes: rows.length });
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
    await db.delete(hostedEpisodes).where(eq(hostedEpisodes.showId, s.id));
    await db.delete(hostedShows).where(eq(hostedShows.id, s.id));
    res.json({ ok: true });
  });

  app.delete("/api/host/hosting/episodes/:id", requireHostSession, async (req, res) => {
    const email = emailOf(req);
    const [e] = await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.id, Number(req.params.id))).limit(1);
    if (!e || !(await ownShow(email, e.showId))) return res.status(404).json({ message: "No such episode." });
    await db.delete(hostedEpisodes).where(eq(hostedEpisodes.id, e.id));
    res.json({ ok: true });
  });
}
