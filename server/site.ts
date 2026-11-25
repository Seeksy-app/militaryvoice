// The free podcast website (12 Oct 2026): every published SmartLink gets a show site at
// militaryvoices.ai/<handle>/show — the show, every episode with its own page (notes and
// transcript, so search engines find them), their clips, the host, a "be a guest" form and
// the media kit. Built from what's already here: the SmartLink, the show (hosted here or its
// feed), Pōstify clips and the transcripts Ask my show made. Free on every plan; the
// podcaster can switch it off (site-off:<page id> in site_settings).
import type { Express } from "express";
import crypto from "node:crypto";
import { and, desc, eq, like, ne } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { requireHostSession } from "./session.js";
import { sendListenerQuestionEmail } from "./email.js";
import { readFeed } from "./hosting.js";
import { resolveFeed } from "./podcastIntake.js";
import { bioPages, bioEvents, clips, siteSettings, hostedEpisodes, hostedShows, listenerQuestions, showTranscripts, type BioPageRow } from "../shared/schema.js";
import { parseBrands, parseSocials, parseTheme } from "../shared/bio.js";
import type { SiteEpisode, SiteEpisodeFull, SitePublic } from "../shared/site.js";
import { REVIEW_EMAIL } from "../shared/review.js";
import { buildShareCard } from "./shareCard.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const now = () => new Date().toISOString();
const str = (v: unknown, n: number) => (typeof v === "string" ? v : "").slice(0, n);
const offKey = (pageId: number) => `site-off:${pageId}`;

/** Feed text with its character codes turned back into characters ("O&#039; Nukes" → "O' Nukes"). */
function decode(t: string): string {
  return t
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Notes as plain text: tags out, paragraphs kept. */
function plain(html: string): string {
  return decode(html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n")).trim();
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
  const shows = source === "rss" ? [] : await db.select().from(hostedShows).where(eq(hostedShows.email, row.email)).orderBy(hostedShows.archivedAt, hostedShows.id); // archived last: the default is a show in use
  const hosted = source.startsWith("show:") ? shows.find((s) => s.id === Number(source.slice(5))) ?? shows[0] : shows[0];
  if (hosted && !hosted.newFeedUrl) {
    const eps = (await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.showId, hosted.id)).orderBy(desc(hostedEpisodes.publishedAt)))
      .filter((e) => e.status === "published" && e.publishedAt && Date.parse(e.publishedAt) <= Date.now() && (e.audioKey || e.audioUrl));
    if (eps.length) {
      return {
        title: decode(hosted.title), description: plain(hosted.description), author: decode(hosted.author), artworkUrl: hosted.artworkUrl,
        appleUrl: hosted.appleUrl, spotifyUrl: hosted.spotifyUrl, feedUrl: `${ORIGIN}/feed/${hosted.slug}`, pageUrl: hosted.website,
        episodes: eps.map((e) => {
          const notes = plain(e.description);
          const key = `h${e.id}`;
          return {
            key, slug: `${slugOf(decode(e.title))}-${key}`, title: decode(e.title), publishedAt: e.publishedAt, durationSec: e.durationSec,
            audio: `${ORIGIN}/e/${e.id}.${/mp4|m4a|aac/.test(e.mime) ? (e.mime.startsWith("video") ? "mp4" : "m4a") : "mp3"}`,
            artworkUrl: e.artworkUrl || hosted.artworkUrl, summary: notes.slice(0, 220), episodeNumber: e.episodeNumber, season: e.season,
            hasTranscript: false, notes, transcriptKey: `hosted:${e.id}`,
          };
        }),
      };
    }
  }
  const profile = await storage.getProfileByEmail(row.email).catch(() => undefined);
  let f: Awaited<ReturnType<typeof readFeed>> | null = null;
  let url = "";
  for (const raw of [row.rssUrl, profile?.rssUrl ?? ""].map((u) => u.trim()).filter((u, i, a) => /^https?:\/\//.test(u) && a.indexOf(u) === i)) {
    url = await resolveFeed(raw);
    f = await readFeed(url).catch(() => null);
    if (f?.items.length) break;
  }
  if (!f) return null;
  const items = f.items.filter((it) => it.url).sort((a, b) => b.published.localeCompare(a.published)).slice(0, 200);
  return {
    title: decode(f.title), description: plain(f.description), author: decode(f.author), artworkUrl: f.artwork, appleUrl: "", spotifyUrl: "", feedUrl: url, pageUrl: f.link,
    episodes: items.map((it) => {
      const notes = plain(it.notes);
      const key = rssKey(it.guid || it.url);
      return {
        key, slug: `${slugOf(decode(it.title))}-${key}`, title: decode(it.title), publishedAt: it.published, durationSec: it.duration, audio: it.url,
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

  // ── Link previews (Andrew, 24 Nov: "It's showing up the marathon by default, so we need to have a master fix") ──
  // A show website, an episode page, a hosted show's page or the Black Friday page pasted into a message shows its own
  // title and picture. Only the preview robots get these pages (vercel.json routes their user agents here); people get the app.
  const PREVIEW_BOT = /facebookexternalhit|facebot|twitterbot|slackbot|linkedinbot|whatsapp|telegrambot|discordbot|applebot|redditbot|pinterest|embedly|skypeuripreview|mastodon|bluesky|iframely|vkshare|quora link preview/i;
  const bot = (req: { get(h: string): string | undefined }) => PREVIEW_BOT.test(String(req.get("user-agent") ?? ""));
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const oneLine = (v: string, n = 280) => v.replace(/\s+/g, " ").replace(/\*\*|__|\*/g, "").trim().slice(0, n);
  const previewHtml = (o: { title: string; desc: string; url: string; img: string; type?: string; alt?: string }) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${esc(o.title)}</title><meta name="description" content="${esc(o.desc)}" /><meta property="og:type" content="${o.type ?? "website"}" /><meta property="og:site_name" content="MilitaryVoices.ai" /><meta property="og:title" content="${esc(o.title)}" /><meta property="og:description" content="${esc(o.desc)}" /><meta property="og:url" content="${esc(o.url)}" /><meta property="og:image" content="${esc(o.img)}" /><meta property="og:image:secure_url" content="${esc(o.img)}" /><meta property="og:image:type" content="image/jpeg" /><meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" /><meta property="og:image:alt" content="${esc(o.alt ?? o.title)}" /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${esc(o.title)}" /><meta name="twitter:description" content="${esc(o.desc)}" /><meta name="twitter:image" content="${esc(o.img)}" /><link rel="canonical" href="${esc(o.url)}" /></head><body><h1>${esc(o.title)}</h1><p>${esc(o.desc)}</p></body></html>`;
  const sendPreview = (res: import("express").Response, html: string) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=600");
    res.end(html);
  };
  const episodeIn = (show: Show | null, slug: string) => {
    const key = /-(h\d+|r[0-9a-f]{8})$/.exec(slug)?.[1] ?? slug;
    return show?.episodes.find((e) => e.key === key) ?? null;
  };
  const sitePreview = async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    if (!bot(req)) return next();
    const row = await pageFor(String(req.params.handle)).catch(() => null);
    if (!row) return next();
    const show = await showFor(row).catch(() => null);
    const slug = req.params.slug ? String(req.params.slug) : "";
    const e = slug ? episodeIn(show, slug) : null;
    if (slug && !e) return next();
    const name = row.displayName || row.handle;
    const showTitle = show?.title || name;
    const title = e ? `${e.title} · ${showTitle}` : showTitle;
    const desc = oneLine(e ? (e.summary || `A new episode of ${showTitle}. Listen now.`) : (show?.description || row.bio || `Listen to ${showTitle}: every episode, with transcripts and clips.`));
    const url = `${ORIGIN}/${row.handle}/show${e ? `/${e.slug}` : ""}`;
    const img = `${ORIGIN}/og/site/${row.handle}.jpg?${e ? `e=${encodeURIComponent(e.key)}&` : ""}v=${encodeURIComponent((row.updatedAt || row.createdAt).slice(0, 16))}`;
    sendPreview(res, previewHtml({ title, desc, url, img, type: e ? "article" : "website", alt: `${showTitle} cover` }));
  };
  app.get("/:handle/show", sitePreview);
  app.get("/:handle/show/:slug", sitePreview);
  /** An episode title as the card can draw it: a long one loses its " - Guest name" tail, and symbols the card's font lacks
   *  become words (Frank's "Visibility ≠ Vanity" drew a gap). */
  const cardTitle = (t: string) => {
    let v = t.replace(/≠/g, "isn't").replace(/[→⇒]/g, "to").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x20-\x7E\u00A0-\u017F—–…]/g, "").replace(/\s+/g, " ").trim();
    if (v.length > 48) { const cut = v.split(/\s+[-|–—]\s+/)[0]; if (cut.length >= 12) v = cut; }
    if (v.length > 48) { const head = v.split(/:\s/)[0]; if (head.length >= 12 && head.length < v.length) v = head; }
    return v;
  };
  /** The picture for a show website or one of its episodes: the cover on our navy, the title, the host. */
  app.get("/og/site/:handle.jpg", async (req, res) => {
    const row = await pageFor(String(req.params.handle)).catch(() => null);
    if (!row) return res.status(404).end();
    const show = await showFor(row).catch(() => null);
    const e = req.query.e ? show?.episodes.find((x) => x.key === String(req.query.e)) ?? null : null;
    const profile = await storage.getProfileByEmail(row.email).catch(() => undefined);
    const host = profile?.hostName?.trim() || row.displayName || "";
    const showTitle = show?.title || row.displayName || row.handle;
    const photo = e?.artworkUrl || show?.artworkUrl || row.avatarUrl || "";
    const jpg = await buildShareCard({
      podcastName: e ? cardTitle(e.title) : showTitle,
      hostName: host,
      subline: e ? showTitle : host ? `with ${host}` : "Listen, follow, ask a question",
      whenLabel: "Listen now",
      photoUrl: photo || undefined,
      photoShape: show?.artworkUrl || e?.artworkUrl ? "art" : "circle",
      eyebrow: e ? "Episode" : "Podcast",
      footer: `militaryvoices.ai/${row.handle}/show`,
    }, "wide");
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
    res.end(jpg);
  });
  /** A show hosted here (/podcast/<slug>): its own cover and name, archived or not (its listeners still follow it). */
  app.get("/podcast/:slug", async (req, res, next) => {
    if (!bot(req)) return next();
    const [s] = await db.select().from(hostedShows).where(eq(hostedShows.slug, String(req.params.slug))).limit(1).catch(() => []);
    if (!s || s.newFeedUrl) return next();
    const url = `${ORIGIN}/podcast/${s.slug}`;
    const img = `${ORIGIN}/og/podcast/${s.slug}.jpg?v=${encodeURIComponent((s.updatedAt || s.createdAt).slice(0, 16))}`;
    sendPreview(res, previewHtml({ title: decode(s.title) || "A MilitaryVoices.ai podcast", desc: oneLine(plain(s.description) || `Listen to ${decode(s.title)} on Apple Podcasts, Spotify or any podcast app.`), url, img, alt: `${decode(s.title)} cover` }));
  });
  app.get("/og/podcast/:slug.jpg", async (req, res) => {
    const [s] = await db.select().from(hostedShows).where(eq(hostedShows.slug, String(req.params.slug))).limit(1).catch(() => []);
    if (!s) return res.status(404).end();
    const host = decode(s.author) || (await storage.getProfileByEmail(s.email).catch(() => undefined))?.hostName || "";
    const jpg = await buildShareCard({
      podcastName: decode(s.title) || "MilitaryVoices.ai",
      hostName: host,
      subline: host ? `with ${host}` : "Listen on any podcast app",
      whenLabel: "Listen now",
      photoUrl: s.artworkUrl || undefined,
      photoShape: "art",
      eyebrow: "Podcast",
      footer: `militaryvoices.ai/podcast/${s.slug}`,
    }, "wide");
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
    res.end(jpg);
  });
  /** Founding Members 2026 (the Black Friday offer): its own card, never the Marathon's. */
  app.get("/black-friday", (req, res, next) => {
    if (!bot(req)) return next();
    sendPreview(res, previewHtml({
      title: "Founding Members 2026 · MilitaryVoices.ai",
      // The page's own words (its h1 and title), not new copy: Social owns Black Friday.
      desc: "Black Friday Special: Founding Members 2026. 30 days free.",
      url: `${ORIGIN}/black-friday`, img: `${ORIGIN}/og-black-friday.jpg?v=1`, alt: "Black Friday special: 30 days free, Founding Member 2026",
    }));
  });

  /**
   * Every podcaster's SmartLink, website and episode pages, for search engines (12 Oct).
   * Listed in robots.txt beside /sitemap.xml. Built at most every 6 hours per server.
   */
  let map: { at: number; xml: string } | null = null;
  app.get("/sitemap-shows.xml", async (_req, res) => {
    if (!map || Date.now() - map.at > 6 * 3600_000) {
      await schemaIsReady();
      const pages = await db.select().from(bioPages).where(eq(bioPages.published, true));
      const off = new Set((await db.select({ key: siteSettings.key, value: siteSettings.value }).from(siteSettings).where(like(siteSettings.key, "site-off:%"))).filter((r) => r.value === "1").map((r) => Number(r.key.slice(9))));
      const urls: { loc: string; lastmod: string; priority: string }[] = [];
      const today = now().slice(0, 10);
      const day = (iso: string) => (Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString().slice(0, 10) : today);
      // Our own team's test pages and the app-review account stay out of search.
      const team = new Set([...(await storage.listAdmins()).map((a) => a.email.trim().toLowerCase()), REVIEW_EMAIL.toLowerCase()]);
      const ours = /@(podlogix\.co|militaryvoices?\.ai|workready360\.com|smartloads\.io|empowerify\.io)$/i;
      const live = pages.filter((p) => p.handle && !team.has(p.email.trim().toLowerCase()) && !ours.test(p.email.trim()));
      // A few feeds at a time: a slow host shouldn't hold up the rest.
      for (let i = 0; i < live.length; i += 4) {
        await Promise.all(live.slice(i, i + 4).map(async (row) => {
          // Only podcasters with a show to play: a page with nothing in it isn't worth a search result.
          const show = await showFor(row).catch(() => null);
          if (!show?.episodes.length) return;
          urls.push({ loc: `${ORIGIN}/${row.handle}`, lastmod: day(row.updatedAt), priority: "0.6" });
          if (off.has(row.id)) return;
          urls.push({ loc: `${ORIGIN}/${row.handle}/show`, lastmod: day(show.episodes[0]?.publishedAt ?? row.updatedAt), priority: "0.8" });
          for (const e of show.episodes.slice(0, 500)) urls.push({ loc: `${ORIGIN}/${row.handle}/show/${e.slug}`, lastmod: day(e.publishedAt), priority: "0.5" });
        }));
      }
      const esc = (u: string) => u.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      map = { at: Date.now(), xml: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority}</priority></url>`).join("\n")}\n</urlset>\n` };
    }
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=21600");
    res.type("application/xml").send(map.xml);
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
