import type { Express, Request } from "express";
import crypto from "node:crypto";
import multer from "multer";
import sharp from "sharp";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, storage } from "./storage.js";
import { requireHostSession, getSessionEmail } from "./session.js";
import { signedRecordingUrl } from "./recordingStorage.js";
import { uploadPhoto } from "./photoStorage.js";
import { hostedShows, hostedEpisodes, hostedDownloads, type HostedShowRow, type HostedEpisodeRow, type CleanResult, type PodcastStatsData } from "../shared/schema.js";

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
  if (!eps.some(live)) out.push("One published episode");
  return out;
}

// ---- The feed ---------------------------------------------------------------------

export function feedXml(s: HostedShowRow, eps: HostedEpisodeRow[]): string {
  const self = feedUrl(s.slug);
  const link = s.website || ORIGIN;
  const cat = s.subcategory
    ? `<itunes:category text="${esc(s.category)}"><itunes:category text="${esc(s.subcategory)}"/></itunes:category>`
    : `<itunes:category text="${esc(s.category)}"/>`;
  const items = eps.filter(live).map((e) => {
    const url = `${ORIGIN}/e/${e.id}.${extOf(e.mime)}`;
    return `
    <item>
      <title>${esc(e.title)}</title>
      <description>${cdata(notesHtml(e.description))}</description>
      <content:encoded>${cdata(notesHtml(e.description))}</content:encoded>
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
    <itunes:owner><itunes:name>${esc(s.ownerName || s.author)}</itunes:name><itunes:email>${esc(s.ownerEmail)}</itunes:email></itunes:owner>
    ${s.artworkUrl ? `<itunes:image href="${esc(s.artworkUrl)}"/>
    <image><url>${esc(s.artworkUrl)}</url><title>${esc(s.title)}</title><link>${esc(link)}</link></image>` : ""}
    ${cat}
    <itunes:explicit>${s.explicit ? "true" : "false"}</itunes:explicit>
    <itunes:type>${s.showType === "serial" ? "serial" : "episodic"}</itunes:type>
    ${s.copyright ? `<copyright>${esc(s.copyright)}</copyright>` : ""}
    <podcast:guid>${s.guid || podcastGuid(self)}</podcast:guid>
    <podcast:locked owner="${esc(s.ownerEmail)}">no</podcast:locked>
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

export function registerHosting(app: Express) {
  // The feed.
  app.get("/feed/:slug", async (req, res) => {
    const slug = String(req.params.slug).replace(/\.(xml|rss)$/i, "");
    const [s] = await db.select().from(hostedShows).where(eq(hostedShows.slug, slug)).limit(1);
    if (!s) return res.status(404).type("text/plain").send("No such feed.");
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
    const [out] = await db.update(hostedShows).set({
      ...str("title", 200), ...str("description", 4000), ...str("author", 200), ...str("ownerName", 200), ...str("ownerEmail", 200), ...str("website", 300), ...str("copyright", 300),
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
      if (!c?.audioKey) return res.status(400).json({ message: "That recording has no clean audio yet. Clean it in Pōstify first, or upload the audio file." });
      audioKey = c.audioKey;
      mime = "audio/mpeg";
      durationSec = Math.round(c.durationSec || rec.durationSec || 0);
      recordingId = rec.id;
      title ||= rec.title;
    }
    if (!audioKey) return res.status(400).json({ message: "Add the episode's audio." });
    const eps = await episodesOf(s.id);
    const [e] = await db.insert(hostedEpisodes).values({
      showId: s.id, title: title || "New episode", description: String(b.description ?? "").slice(0, 20000),
      audioKey, mime, sizeBytes: num(b.sizeBytes) ?? 0, durationSec, recordingId,
      episodeNumber: num(b.episodeNumber) ?? (s.showType === "serial" ? null : eps.filter((x) => x.episodeType === "full").length + 1),
      season: num(b.season), guid: crypto.randomUUID(), status: "draft", createdAt: now(),
    }).returning();
    res.status(201).json(e);
  });

  app.patch("/api/host/hosting/episodes/:id", requireHostSession, async (req, res) => {
    const email = emailOf(req);
    const [e] = await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.id, Number(req.params.id))).limit(1);
    if (!e || !(await ownShow(email, e.showId))) return res.status(404).json({ message: "No such episode." });
    const b = req.body ?? {};
    const publish = b.status === "published";
    if (publish && !(e.audioKey || e.audioUrl)) return res.status(400).json({ message: "It needs its audio first." });
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

  app.delete("/api/host/hosting/episodes/:id", requireHostSession, async (req, res) => {
    const email = emailOf(req);
    const [e] = await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.id, Number(req.params.id))).limit(1);
    if (!e || !(await ownShow(email, e.showId))) return res.status(404).json({ message: "No such episode." });
    await db.delete(hostedEpisodes).where(eq(hostedEpisodes.id, e.id));
    res.json({ ok: true });
  });
}
