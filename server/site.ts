// The free podcast website (12 Oct 2026): every published SmartLink gets a show site at
// militaryvoices.ai/<handle>/show — the show, every episode with its own page (notes and
// transcript, so search engines find them), their clips, the host, a "be a guest" form and
// the media kit. Built from what's already here: the SmartLink, the show (hosted here or its
// feed), Pōstify clips and the transcripts Ask my show made. Free on every plan; the
// podcaster can switch it off (site-off:<page id> in site_settings).
import type { Express } from "express";
import crypto from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { requireHostSession } from "./session.js";
import { sendListenerQuestionEmail } from "./email.js";
import { readFeed } from "./hosting.js";
import { bioPages, bioEvents, clips, hostedEpisodes, hostedShows, listenerQuestions, showTranscripts, type BioPageRow } from "../shared/schema.js";
import { parseBrands, parseSocials, parseTheme } from "../shared/bio.js";
import type { SiteEpisode, SiteEpisodeFull, SitePublic } from "../shared/site.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const now = () => new Date().toISOString();
const str = (v: unknown, n: number) => (typeof v === "string" ? v : "").slice(0, n);
const offKey = (pageId: number) => `site-off:${pageId}`;

/** Notes as plain text: tags out, paragraphs kept. */
function plain(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
const slugOf = (title: string) => title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "") || "episode";
const rssKey = (guid: string) => "r" + crypto.createHash("sha1").update(guid).digest("hex").slice(0, 8);

type Ep = SiteEpisode & { notes: string; transcriptKey: string };
type Show = { title: string; description: string; author: string; artworkUrl: string; appleUrl: string; spotifyUrl: string; feedUrl: string; pageUrl: string; episodes: Ep[] };

// The show behind a page, with every episode's notes: read at most every 30 minutes per server.
const cache = new Map<number, { at: number; show: Show | null }>();
async function showFor(row: BioPageRow): Promise<Show | null> {
  const hit = cache.get(row.id);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.show;
  const show = await buildShow(row).catch(() => null);
  cache.set(row.id, { at: Date.now(), show });
  return show;
}

async function buildShow(row: BioPageRow): Promise<Show | null> {
  // Their pick on the SmartLink: a show hosted here (the first by default), or their feed.
  const source = parseTheme(row.theme).podcast?.source ?? "";
  const shows = source === "rss" ? [] : await db.select().from(hostedShows).where(eq(hostedShows.email, row.email)).orderBy(hostedShows.id);
  const hosted = source.startsWith("show:") ? shows.find((s) => s.id === Number(source.slice(5))) ?? shows[0] : shows[0];
  if (hosted && !hosted.newFeedUrl) {
    const eps = (await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.showId, hosted.id)).orderBy(desc(hostedEpisodes.publishedAt)))
      .filter((e) => e.status === "published" && e.publishedAt && Date.parse(e.publishedAt) <= Date.now() && (e.audioKey || e.audioUrl));
    if (eps.length) {
      return {
        title: hosted.title, description: plain(hosted.description), author: hosted.author, artworkUrl: hosted.artworkUrl,
        appleUrl: hosted.appleUrl, spotifyUrl: hosted.spotifyUrl, feedUrl: `${ORIGIN}/feed/${hosted.slug}`, pageUrl: hosted.website,
        episodes: eps.map((e) => {
          const notes = plain(e.description);
          const key = `h${e.id}`;
          return {
            key, slug: `${slugOf(e.title)}-${key}`, title: e.title, publishedAt: e.publishedAt, durationSec: e.durationSec,
            audio: `${ORIGIN}/e/${e.id}.${/mp4|m4a|aac/.test(e.mime) ? (e.mime.startsWith("video") ? "mp4" : "m4a") : "mp3"}`,
            artworkUrl: e.artworkUrl || hosted.artworkUrl, summary: notes.slice(0, 220), episodeNumber: e.episodeNumber, season: e.season,
            hasTranscript: false, notes, transcriptKey: `hosted:${e.id}`,
          };
        }),
      };
    }
  }
  const url = row.rssUrl.trim();
  if (!/^https?:\/\//.test(url)) return null;
  const f = await readFeed(url);
  const items = f.items.filter((it) => it.url).sort((a, b) => b.published.localeCompare(a.published)).slice(0, 200);
  return {
    title: f.title, description: plain(f.description), author: f.author, artworkUrl: f.artwork, appleUrl: "", spotifyUrl: "", feedUrl: url, pageUrl: f.link,
    episodes: items.map((it) => {
      const notes = plain(it.notes);
      const key = rssKey(it.guid || it.url);
      return {
        key, slug: `${slugOf(it.title)}-${key}`, title: it.title, publishedAt: it.published, durationSec: it.duration, audio: it.url,
        artworkUrl: it.image || f.artwork, summary: notes.slice(0, 220), episodeNumber: it.episode, season: it.season,
        hasTranscript: false, notes, transcriptKey: `rss:${it.guid}`.slice(0, 400),
      };
    }),
  };
}

async function pageFor(handle: string): Promise<BioPageRow | null> {
  await schemaIsReady();
  const [row] = await db.select().from(bioPages).where(eq(bioPages.handle, handle.toLowerCase())).limit(1);
  if (!row || !row.published) return null;
  if ((await storage.getSetting(offKey(row.id))) === "1") return null;
  return row;
}

/** Which of these episodes have a finished transcript. */
async function transcribed(email: string): Promise<Set<string>> {
  const rows = await db.select({ key: showTranscripts.episodeKey }).from(showTranscripts).where(and(eq(showTranscripts.email, email), eq(showTranscripts.status, "done")));
  return new Set(rows.map((r) => r.key));
}

const bare = ({ notes: _n, transcriptKey: _t, ...e }: Ep): SiteEpisode => e;

export function registerSite(app: Express): void {
  /** The whole site in one read: the show, every episode (without full notes), clips, the host. */
  app.get("/api/public/site/:handle", async (req, res) => {
    const row = await pageFor(String(req.params.handle));
    if (!row) return res.status(404).json({ message: "No such site." });
    const [show, profile, have, made] = await Promise.all([
      showFor(row),
      storage.getProfileByEmail(row.email).catch(() => undefined),
      transcribed(row.email),
      db.select().from(clips).where(and(eq(clips.email, row.email), ne(clips.url, ""))).orderBy(desc(clips.createdAt)).limit(12),
    ]);
    const theme = parseTheme(row.theme);
    const out: SitePublic = {
      handle: row.handle,
      name: profile?.hostName?.trim() || row.displayName,
      bio: row.bio,
      avatarUrl: row.avatarUrl,
      heroUrl: row.heroUrl,
      branch: profile?.branch ?? "",
      color: theme.color,
      socials: parseSocials(row.socials).filter((s) => s.on && /^https?:\/\//.test(s.url)).map((s) => ({ platform: s.platform, url: s.url })),
      youtubeUrl: profile?.youtubeUrl ?? "",
      show: show ? { title: show.title, description: show.description, author: show.author, artworkUrl: show.artworkUrl, appleUrl: show.appleUrl, spotifyUrl: show.spotifyUrl, feedUrl: show.feedUrl, pageUrl: show.pageUrl } : null,
      episodes: (show?.episodes ?? []).map((e) => ({ ...bare(e), hasTranscript: have.has(e.transcriptKey) })),
      clips: made.map((c) => ({ id: c.id, title: c.editTitle || c.title, caption: c.caption, url: c.url, verticalUrl: c.verticalUrl, squareUrl: c.squareUrl })),
      brandsOn: parseBrands(row.brands).on,
      askEnabled: row.askEnabled,
    };
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
    res.json(out);
  });

  /** One episode: its full notes and transcript, and the ones either side. */
  app.get("/api/public/site/:handle/episode/:slug", async (req, res) => {
    const row = await pageFor(String(req.params.handle));
    if (!row) return res.status(404).json({ message: "No such site." });
    const show = await showFor(row);
    const want = String(req.params.slug);
    const key = /-(h\d+|r[0-9a-f]{8})$/.exec(want)?.[1] ?? want;
    const eps = show?.episodes ?? [];
    const i = eps.findIndex((e) => e.key === key);
    if (i < 0) return res.status(404).json({ message: "No such episode." });
    const e = eps[i];
    const [t] = await db.select({ lines: showTranscripts.lines }).from(showTranscripts).where(and(eq(showTranscripts.email, row.email), eq(showTranscripts.episodeKey, e.transcriptKey), eq(showTranscripts.status, "done"))).limit(1);
    let lines: SiteEpisodeFull["transcript"] = null;
    try { lines = t?.lines ? (JSON.parse(t.lines) as [number, number, string, string][]).map(([s, , who, text]) => ({ at: s, who, text })) : null; } catch { lines = null; }
    const out: SiteEpisodeFull = {
      ...bare(e), hasTranscript: Boolean(lines?.length), notes: e.notes, transcript: lines,
      newer: i > 0 ? { slug: eps[i - 1].slug, title: eps[i - 1].title } : null,
      older: i < eps.length - 1 ? { slug: eps[i + 1].slug, title: eps[i + 1].title } : null,
      show: show ? { title: show.title, artworkUrl: show.artworkUrl } : null, name: row.displayName, color: parseTheme(row.theme).color,
    };
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
    res.json(out);
  });

  /** Be a guest: a pitch to come on the show, into their SmartLink messages and their inbox. */
  const recent = new Map<string, number[]>();
  app.post("/api/public/site/:handle/guest", async (req, res) => {
    const row = await pageFor(String(req.params.handle));
    if (!row) return res.status(404).json({ message: "No such site." });
    const ip = String(req.ip ?? "");
    const hits = (recent.get(ip) ?? []).filter((t) => Date.now() - t < 3600_000);
    if (hits.length >= 4) return res.status(429).json({ message: "Thanks! Try again in a little while." });
    recent.set(ip, [...hits, Date.now()]);
    if (str(req.body?.website, 100)) return res.json({ ok: true }); // a bot filled the hidden field
    const name = str(req.body?.name, 80).trim();
    const fromEmail = str(req.body?.email, 200).trim();
    const topic = str(req.body?.topic, 200).trim();
    const about = str(req.body?.about, 1500).trim();
    const links = str(req.body?.links, 400).trim();
    if (!name) return res.status(400).json({ message: "Add your name." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fromEmail)) return res.status(400).json({ message: "Add an email they can reply to." });
    if (topic.length < 3) return res.status(400).json({ message: "What would you talk about?" });
    const question = [`Guest request: ${name} would like to come on the show.`, "", `Topic: ${topic}`, ...(about ? ["", about] : []), ...(links ? ["", `Links: ${links}`] : [])].join("\n");
    const token = crypto.randomBytes(18).toString("base64url");
    await db.insert(listenerQuestions).values({ pageId: row.id, email: row.email, name, fromEmail, question, episode: "Be a guest", token, createdAt: now() });
    await db.insert(bioEvents).values({ pageId: row.id, kind: "ask", label: "Be a guest", day: now().slice(0, 10), createdAt: now() }).catch(() => {});
    void sendListenerQuestionEmail({ to: row.email, show: row.displayName, name, fromEmail, question, episode: "Be a guest", dashboardUrl: `${ORIGIN}/host/dashboard/page?tab=messages` }).catch(() => {});
    res.json({ ok: true });
  });

  /** The podcaster's switch: on unless they turn it off. */
  app.get("/api/host/site", requireHostSession, async (req, res) => {
    const email = String((req as any).hostEmail ?? "");
    const [row] = await db.select({ id: bioPages.id, handle: bioPages.handle, published: bioPages.published }).from(bioPages).where(eq(bioPages.email, email)).limit(1);
    if (!row) return res.json({ on: false, url: "", published: false });
    res.json({ on: (await storage.getSetting(offKey(row.id))) !== "1", url: `${ORIGIN}/${row.handle}/show`, published: row.published });
  });
  app.post("/api/host/site", requireHostSession, async (req, res) => {
    const email = String((req as any).hostEmail ?? "");
    const [row] = await db.select({ id: bioPages.id, handle: bioPages.handle, published: bioPages.published }).from(bioPages).where(eq(bioPages.email, email)).limit(1);
    if (!row) return res.status(404).json({ message: "Set up your SmartLink first." });
    const on = req.body?.on !== false;
    await storage.setSetting(offKey(row.id), on ? "" : "1");
    res.json({ on, url: `${ORIGIN}/${row.handle}/show`, published: row.published });
  });
}
