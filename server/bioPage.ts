import type { Express, Request } from "express";
import crypto from "node:crypto";
import multer from "multer";
import sharp from "sharp";
import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { requireHostSession, getSessionEmail } from "./session.js";
import { uploadPhoto } from "./photoStorage.js";
import { sendListenerQuestionEmail, sendListenerReplyEmail } from "./email.js";
import { buildShareCard } from "./shareCard.js";
import Anthropic from "@anthropic-ai/sdk";
import { readFeed } from "./hosting.js";
import { aiFor, knowledgeOf, syncKnowledge } from "./askShow.js";
import { bioPages, bioEvents, listenerQuestions, hostedShows, hostedEpisodes, type BioPageRow } from "../shared/schema.js";
import { parseTheme, parseSections, parseSocials, handleOk, TEMPLATES, type BioPublic, type BioSection, type BioSocial, type BioTheme } from "../shared/bio.js";

/**
 * The bio page: militaryvoices.ai/<handle>. The podcast top and centre (the
 * show hosted here, or read from its feed), their links and socials, and a
 * box for a listener's question that lands in the podcaster's inbox.
 */

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const now = () => new Date().toISOString();
const emailOf = (req: Request) => (getSessionEmail(req) ?? "").trim().toLowerCase();
const art = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "").slice(0, 24);

async function freeHandle(base: string): Promise<string> {
  const b = handleOk(base) ? base : `${base || "show"}pod`.slice(0, 24);
  for (let i = 0; i < 50; i++) {
    const h = i ? `${b}${i + 1}` : b;
    if (!handleOk(h)) continue;
    const [hit] = await db.select({ id: bioPages.id }).from(bioPages).where(eq(bioPages.handle, h)).limit(1);
    if (!hit) return h;
  }
  return `${b}${crypto.randomBytes(2).toString("hex")}`;
}

/** Their page, made on first visit from what we already know about them. */
async function pageFor(email: string): Promise<BioPageRow> {
  await schemaIsReady();
  const [row] = await db.select().from(bioPages).where(eq(bioPages.email, email)).limit(1);
  if (row) return row;
  const p = await storage.getProfileByEmail(email).catch(() => undefined);
  const handle = await freeHandle(slugify(p?.podcastName || p?.hostName || email.split("@")[0]));
  const [made] = await db.insert(bioPages).values({
    email, handle,
    displayName: p?.podcastName || p?.hostName || "",
    avatarUrl: p?.photoUrl || "",
    rssUrl: p?.rssUrl || "",
    theme: JSON.stringify({ ...TEMPLATES.bold.theme, template: "bold", color: "#F0A71F" }),
    sections: "[]", socials: "[]",
    createdAt: now(), updatedAt: now(),
  }).onConflictDoNothing().returning();
  if (made) return made;
  const [again] = await db.select().from(bioPages).where(eq(bioPages.email, email)).limit(1);
  return again;
}

// The feed for a show that isn't hosted here: read at most every 30 minutes per server.
const feedCache = new Map<string, { at: number; data: BioPublic["podcast"] }>();

/** The show for the page: hosted here first; otherwise their feed. */
async function podcastFor(row: BioPageRow): Promise<BioPublic["podcast"]> {
  const [show] = await db.select().from(hostedShows).where(eq(hostedShows.email, row.email)).orderBy(hostedShows.id).limit(1);
  if (show && !show.newFeedUrl) {
    const eps = (await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.showId, show.id)).orderBy(desc(hostedEpisodes.publishedAt)))
      .filter((e) => e.status === "published" && e.publishedAt && Date.parse(e.publishedAt) <= Date.now() && (e.audioKey || e.audioUrl));
    if (eps.length) {
      return {
        title: show.title, artworkUrl: show.artworkUrl, feedUrl: `${ORIGIN}/feed/${show.slug}`, pageUrl: `${ORIGIN}/podcast/${show.slug}`,
        appleUrl: show.appleUrl, spotifyUrl: show.spotifyUrl, episodeCount: eps.length,
        episodes: eps.slice(0, 12).map((e) => ({ id: String(e.id), title: e.title, publishedAt: e.publishedAt, durationSec: e.durationSec, audio: `${ORIGIN}/e/${e.id}.${/mp4|m4a|aac/.test(e.mime) ? (e.mime.startsWith("video") ? "mp4" : "m4a") : "mp3"}`, notes: "", artworkUrl: e.artworkUrl || show.artworkUrl })),
      };
    }
  }
  const url = row.rssUrl.trim();
  if (!/^https?:\/\//.test(url)) return null;
  const hit = feedCache.get(url);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.data;
  const data = await readFeed(url).then((f) => ({
    title: f.title, artworkUrl: f.artwork, feedUrl: url, pageUrl: f.link, appleUrl: "", spotifyUrl: "", episodeCount: f.items.length,
    episodes: f.items.slice().sort((a, b) => b.published.localeCompare(a.published)).slice(0, 12).map((it, i) => ({ id: `rss-${i}`, title: it.title, publishedAt: it.published, durationSec: it.duration, audio: it.url, notes: "", artworkUrl: it.image || f.artwork })),
  })).catch(() => null);
  feedCache.set(url, { at: Date.now(), data });
  return data;
}

async function publicOf(row: BioPageRow): Promise<BioPublic> {
  const p = await storage.getProfileByEmail(row.email).catch(() => undefined);
  return {
    handle: row.handle,
    displayName: row.displayName,
    bio: row.bio,
    avatarUrl: row.avatarUrl,
    heroUrl: row.heroUrl,
    branch: p?.branch ?? "",
    theme: parseTheme(row.theme),
    socials: parseSocials(row.socials).filter((s) => s.on && /^https?:\/\//.test(s.url)),
    sections: parseSections(row.sections).filter((s) => s.visible),
    podcast: await podcastFor(row).catch(() => null),
    askEnabled: row.askEnabled,
    welcome: row.welcome.trim() || `Hi! Thanks for listening. What's on your mind?`,
    ai: await aiFor(row),
  };
}

// ---- Cleaning what the builder sends -----------------------------------------------

const httpUrl = (v: unknown) => { const s = String(v ?? "").trim().slice(0, 500); return /^https?:\/\/[^\s]+$/i.test(s) ? s : ""; };
const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);

function cleanSections(v: unknown): BioSection[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 30).flatMap((raw): BioSection[] => {
    const x = raw as Record<string, unknown>;
    const base = { id: /^[\w-]{1,40}$/.test(String(x.id)) ? String(x.id) : crypto.randomBytes(5).toString("hex"), visible: x.visible !== false, title: str(x.title, 80) };
    switch (x.type) {
      case "links": return [{ ...base, type: "links", links: (Array.isArray(x.links) ? x.links : []).slice(0, 30).map((l: Record<string, unknown>) => ({ id: /^[\w-]{1,40}$/.test(String(l.id)) ? String(l.id) : crypto.randomBytes(4).toString("hex"), label: str(l.label, 80), url: httpUrl(l.url) })).filter((l) => l.label || l.url) }];
      case "video": return [{ ...base, type: "video", url: httpUrl(x.url) }];
      case "promo": return [{ ...base, type: "promo", code: str(x.code, 40), url: httpUrl(x.url), note: str(x.note, 200) }];
      case "meeting": return [{ ...base, type: "meeting", url: httpUrl(x.url), note: str(x.note, 200) }];
      case "text": return [{ ...base, type: "text", body: str(x.body, 2000) }];
      default: return [];
    }
  });
}

function cleanTheme(v: unknown, prev: BioTheme): BioTheme {
  const x = (v ?? {}) as Record<string, unknown>;
  const pick = <T extends string>(k: string, ok: readonly T[], d: T): T => (ok.includes(x[k] as T) ? (x[k] as T) : d);
  return {
    template: pick("template", ["classic", "bold", "minimal", "vibrant"] as const, prev.template),
    color: /^#[0-9a-f]{6}$/i.test(String(x.color)) ? String(x.color) : prev.color,
    shade: pick("shade", ["light", "dark"] as const, prev.shade),
    font: pick("font", ["sans", "serif", "mono"] as const, prev.font),
    linkShape: pick("linkShape", ["pill", "rounded", "square"] as const, prev.linkShape),
    linkStyle: pick("linkStyle", ["fill", "outline", "soft"] as const, prev.linkStyle),
    layout: pick("layout", ["portrait", "landscape", "blend", "hero", "shape"] as const, prev.layout),
    podcastStyle: pick("podcastStyle", ["spotlight", "list", "carousel"] as const, prev.podcastStyle),
    podcastFrame: pick("podcastFrame", ["full", "card"] as const, prev.podcastFrame),
  };
}

function cleanSocials(v: unknown): BioSocial[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 20).map((s: Record<string, unknown>) => ({ platform: str(s.platform, 30), username: str(s.username, 100), url: httpUrl(s.url), on: s.on !== false })).filter((s) => s.platform);
}

// ---- Routes -------------------------------------------------------------------------

export function registerBioPage(app: Express) {
  // Straight after a deploy, wait for new tables and columns before the first query.
  app.use(["/api/host/bio", "/api/public/bio"], (_req, _res, next) => { schemaIsReady().then(() => next(), next); });
  // The builder.
  app.get("/api/host/bio", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const row = await pageFor(emailOf(req));
    // Line up any new episodes for Ask my show to learn (the worker transcribes them).
    void syncKnowledge(row.email).catch((err) => console.warn("Ask my show sync failed:", (err as Error).message));
    const since = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const counts = await db.select({ kind: bioEvents.kind, n: sql<number>`count(*)::int` }).from(bioEvents).where(and(eq(bioEvents.pageId, row.id), gte(bioEvents.day, since))).groupBy(bioEvents.kind);
    const questions = await db.select().from(listenerQuestions).where(eq(listenerQuestions.pageId, row.id)).orderBy(desc(listenerQuestions.id)).limit(50);
    res.json({
      page: { ...row, theme: parseTheme(row.theme), sections: parseSections(row.sections), socials: parseSocials(row.socials) },
      url: `${ORIGIN}/${row.handle}`,
      preview: await publicOf(row),
      stats: Object.fromEntries(counts.map((c) => [c.kind, c.n])),
      questions: questions.map(({ token: _t, ...q }) => q),
      knowledge: await knowledgeOf(row.email),
    });
  });

  app.patch("/api/host/bio", requireHostSession, async (req, res) => {
    const row = await pageFor(emailOf(req));
    const b = req.body ?? {};
    const patch: Partial<BioPageRow> = { updatedAt: now() };
    if (typeof b.handle === "string" && b.handle !== row.handle) {
      const h = b.handle.trim().toLowerCase();
      if (!handleOk(h)) return res.status(400).json({ message: "3 to 30 letters, numbers, dots, dashes or underscores, and not a word the site already uses." });
      const [taken] = await db.select({ id: bioPages.id }).from(bioPages).where(eq(bioPages.handle, h)).limit(1);
      if (taken && taken.id !== row.id) return res.status(409).json({ message: `militaryvoices.ai/${h} is taken. Try another.` });
      patch.handle = h;
    }
    if (typeof b.displayName === "string") patch.displayName = b.displayName.slice(0, 80);
    if (typeof b.bio === "string") patch.bio = b.bio.slice(0, 500);
    if (typeof b.rssUrl === "string") patch.rssUrl = httpUrl(b.rssUrl);
    if (typeof b.askEnabled === "boolean") patch.askEnabled = b.askEnabled;
    if (typeof b.welcome === "string") patch.welcome = b.welcome.trim().slice(0, 280);
    if (typeof b.aiEnabled === "boolean") patch.aiEnabled = b.aiEnabled;
    if (typeof b.published === "boolean") patch.published = b.published;
    if (b.avatarUrl === "" || b.heroUrl === "") { if (b.avatarUrl === "") patch.avatarUrl = ""; if (b.heroUrl === "") patch.heroUrl = ""; }
    if (b.theme) patch.theme = JSON.stringify(cleanTheme(b.theme, parseTheme(row.theme)));
    if (b.sections) patch.sections = JSON.stringify(cleanSections(b.sections));
    if (b.socials) patch.socials = JSON.stringify(cleanSocials(b.socials));
    const [out] = await db.update(bioPages).set(patch).where(eq(bioPages.id, row.id)).returning();
    res.json({ page: { ...out, theme: parseTheme(out.theme), sections: parseSections(out.sections), socials: parseSocials(out.socials) }, url: `${ORIGIN}/${out.handle}`, preview: await publicOf(out) });
  });

  // The photo (square) and the cover (wide), sized for the page.
  app.post("/api/host/bio/image/:kind", requireHostSession, art.single("file"), async (req, res) => {
    const row = await pageFor(emailOf(req));
    const kind = req.params.kind === "hero" ? "hero" : "avatar";
    if (!req.file) return res.status(400).json({ message: "Choose an image." });
    try {
      const img = kind === "avatar"
        ? await sharp(req.file.buffer).rotate().resize(800, 800, { fit: "cover", position: "attention" }).jpeg({ quality: 88 }).toBuffer()
        : await sharp(req.file.buffer).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
      const url = await uploadPhoto(`bio/${row.id}-${kind}-${Date.now()}.jpg`, img, "image/jpeg");
      const [out] = await db.update(bioPages).set(kind === "avatar" ? { avatarUrl: url, updatedAt: now() } : { heroUrl: url, updatedAt: now() }).where(eq(bioPages.id, row.id)).returning();
      res.json({ url, preview: await publicOf(out) });
    } catch {
      res.status(400).json({ message: "Couldn't read that image. Try a JPG or PNG." });
    }
  });

  // Write it for me: a first draft of their bio from what we know (the show, its episodes, their service). They edit it.
  app.post("/api/host/bio/draft-bio", requireHostSession, async (req, res) => {
    const row = await pageFor(emailOf(req));
    const p = await storage.getProfileByEmail(row.email).catch(() => undefined);
    const pod = await podcastFor(row).catch(() => null);
    const facts = [
      `Name on the page: ${row.displayName || p?.podcastName || ""}`,
      p?.hostName ? `Host: ${p.hostName}` : "",
      p?.branch ? `Branch: ${p.branch}${p.serviceStatus ? ` (${p.serviceStatus})` : ""}` : "",
      pod ? `Podcast: ${pod.title}, ${pod.episodeCount} episode${pod.episodeCount === 1 ? "" : "s"}` : "",
      pod?.episodes.length ? `Recent episode titles: ${pod.episodes.slice(0, 8).map((e) => e.title).join(" | ")}` : "",
    ].filter(Boolean).join("\n");
    try {
      const client = new Anthropic();
      const out = await client.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 200,
        system: "You write short bios for military and veteran podcasters' link-in-bio pages. Two sentences, under 280 characters, first person, warm and plain, no hashtags, no emoji, no quotation marks. Say who they are and what the show is about and who it's for, using only the facts given; never invent ranks, units, awards or numbers.",
        messages: [{ role: "user", content: `Facts:\n${facts}\n\nWrite the bio.` }],
      });
      const text = out.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("").trim().replace(/^["']|["']$/g, "").slice(0, 500);
      res.json({ bio: text });
    } catch (err) {
      console.error("Bio draft failed:", (err as Error).message);
      res.status(502).json({ message: "Couldn't write one just now. Try again in a moment." });
    }
  });

  app.patch("/api/host/bio/questions/:id", requireHostSession, async (req, res) => {
    const row = await pageFor(emailOf(req));
    const status = ["new", "answered", "archived"].includes(req.body?.status) ? req.body.status : "answered";
    await db.update(listenerQuestions).set({ status }).where(and(eq(listenerQuestions.id, Number(req.params.id)), eq(listenerQuestions.pageId, row.id)));
    res.json({ ok: true });
  });

  // The podcaster answers: it shows in the listener's chat on the page, and by email when they left one.
  app.post("/api/host/bio/questions/:id/reply", requireHostSession, async (req, res) => {
    const row = await pageFor(emailOf(req));
    const reply = str(req.body?.reply, 3000).trim();
    if (reply.length < 1) return res.status(400).json({ message: "Write your reply first." });
    const [q] = await db.update(listenerQuestions).set({ reply, repliedAt: now(), status: "answered" })
      .where(and(eq(listenerQuestions.id, Number(req.params.id)), eq(listenerQuestions.pageId, row.id))).returning();
    if (!q) return res.status(404).json({ message: "That message is gone." });
    const emailed = q.fromEmail ? await sendListenerReplyEmail({ to: q.fromEmail, show: row.displayName || row.handle, question: q.question, reply, pageUrl: `${ORIGIN}/${row.handle}#chat=${q.token}` }).catch(() => false) : false;
    res.json({ ok: true, emailed });
  });

  // ---- Link previews: Slack, iMessage, Facebook, LinkedIn, X ----
  //      The page is the app's one index.html, whose tags can't vary per
  //      podcaster; so the preview robots (only them: vercel.json sends their
  //      user agents here) get a page of their own tags: the podcaster's name,
  //      bio and a card with their photo. People get the app as always.

  app.get("/og/bio/:handle.jpg", async (req, res) => {
    const [row] = await db.select().from(bioPages).where(eq(bioPages.handle, String(req.params.handle).toLowerCase())).limit(1);
    if (!row || !row.published) return res.status(404).end();
    const pod = await podcastFor(row).catch(() => null);
    const photo = row.avatarUrl || pod?.artworkUrl || undefined;
    const jpg = await buildShareCard({
      podcastName: row.displayName || row.handle,
      hostName: "",
      subline: pod?.title && pod.title !== row.displayName ? pod.title : pod ? `${pod.episodeCount} episode${pod.episodeCount === 1 ? "" : "s"} · listen, follow, ask` : "Listen, follow, ask a question",
      whenLabel: pod ? "Listen now" : "Visit my page",
      photoUrl: photo,
      eyebrow: pod ? "Podcast" : "Military voices",
      footer: `militaryvoices.ai/${row.handle}`,
    }, "wide");
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
    res.end(jpg);
  });

  const PREVIEW_BOT = /facebookexternalhit|facebot|twitterbot|slackbot|linkedinbot|whatsapp|telegrambot|discordbot|applebot|redditbot|pinterest|embedly|skypeuripreview|mastodon|bluesky|iframely|vkshare|quora link preview/i;
  app.get("/:handle", async (req, res, next) => {
    const ua = String(req.get("user-agent") ?? "");
    const h = String(req.params.handle).toLowerCase();
    if (!PREVIEW_BOT.test(ua)) return next();
    const origin = `https://${req.get("host")}`;
    const [row] = handleOk(h) ? await db.select().from(bioPages).where(eq(bioPages.handle, h)).limit(1) : [];
    if (!row || !row.published) {
      // Not a page of ours (/faq, /events…): the app's own index.html, with its usual tags.
      const html = await fetch(`${origin}/index.html`).then((r) => r.text()).catch(() => "");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(html || "<!doctype html><title>MilitaryVoices.ai</title>");
    }
    const pod = await podcastFor(row).catch(() => null);
    const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const title = row.displayName || row.handle;
    const desc = (row.bio || (pod ? `Listen to ${pod.title}: the latest episodes, and ask the show a question.` : `${title} on MilitaryVoices.ai.`)).replace(/\s+/g, " ").slice(0, 280);
    const url = `${origin}/${row.handle}`;
    const img = `${origin}/og/bio/${row.handle}.jpg?v=${encodeURIComponent((row.updatedAt || row.createdAt).slice(0, 16))}`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=600");
    res.end(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<meta property="og:type" content="profile" />
<meta property="og:site_name" content="MilitaryVoices.ai" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${url}" />
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
<link rel="canonical" href="${url}" />
</head><body><h1>${esc(title)}</h1><p>${esc(desc)}</p><p><a href="${url}">${esc(url)}</a></p></body></html>`);
  });

  // ---- The public page ----

  app.get("/api/public/bio/:handle", async (req, res) => {
    await schemaIsReady();
    const [row] = await db.select().from(bioPages).where(eq(bioPages.handle, String(req.params.handle).toLowerCase())).limit(1);
    if (!row || !row.published) return res.status(404).json({ message: "No such page." });
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
    res.json(await publicOf(row));
  });

  // What listeners do there: views, taps, plays, shares. No one's identity is kept.
  app.post("/api/public/bio/:handle/event", async (req, res) => {
    const kind = ["view", "click", "play", "share"].includes(req.body?.kind) ? req.body.kind : null;
    if (!kind) return res.status(400).json({ message: "Unknown." });
    const [row] = await db.select({ id: bioPages.id }).from(bioPages).where(eq(bioPages.handle, String(req.params.handle).toLowerCase())).limit(1);
    if (row) await db.insert(bioEvents).values({ pageId: row.id, kind, label: str(req.body?.label, 200), day: now().slice(0, 10), createdAt: now() }).catch(() => {});
    res.json({ ok: true });
  });

  // A listener's question: kept, and sent to the podcaster (reply goes straight to the listener).
  const recent = new Map<string, number[]>();
  app.post("/api/public/bio/:handle/ask", async (req, res) => {
    const [row] = await db.select().from(bioPages).where(eq(bioPages.handle, String(req.params.handle).toLowerCase())).limit(1);
    if (!row || !row.published || !row.askEnabled) return res.status(404).json({ message: "Questions are off for this page." });
    const ip = String(req.ip ?? "");
    const hits = (recent.get(ip) ?? []).filter((t) => Date.now() - t < 3600_000);
    if (hits.length >= 5) return res.status(429).json({ message: "That's a lot of questions. Try again in a while." });
    recent.set(ip, [...hits, Date.now()]);
    const question = str(req.body?.question, 1500).trim();
    const fromEmail = str(req.body?.email, 200).trim();
    const name = str(req.body?.name, 80).trim();
    if (question.length < 5) return res.status(400).json({ message: "Write your question first." });
    if (fromEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fromEmail)) return res.status(400).json({ message: "That email doesn't look right." });
    if (str(req.body?.website, 100)) return res.json({ ok: true }); // a bot filled the hidden field
    const token = crypto.randomBytes(18).toString("base64url");
    const [q] = await db.insert(listenerQuestions).values({ pageId: row.id, email: row.email, name, fromEmail, question, episode: str(req.body?.episode, 200), token, createdAt: now() }).returning();
    await db.insert(bioEvents).values({ pageId: row.id, kind: "ask", label: "", day: now().slice(0, 10), createdAt: now() }).catch(() => {});
    void sendListenerQuestionEmail({ to: row.email, show: row.displayName, name, fromEmail, question, episode: q.episode, dashboardUrl: `${ORIGIN}/host/dashboard/page?tab=messages` }).catch(() => {});
    res.json({ ok: true, token, createdAt: q.createdAt });
  });

  // A listener's conversation: the messages their browser holds keys for, with any replies.
  app.post("/api/public/bio/:handle/messages", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const tokens = (Array.isArray(req.body?.tokens) ? req.body.tokens : []).filter((t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{20,40}$/.test(t)).slice(0, 30);
    if (!tokens.length) return res.json({ messages: [] });
    const [row] = await db.select({ id: bioPages.id }).from(bioPages).where(eq(bioPages.handle, String(req.params.handle).toLowerCase())).limit(1);
    if (!row) return res.json({ messages: [] });
    const rows = await db.select().from(listenerQuestions).where(and(eq(listenerQuestions.pageId, row.id), inArray(listenerQuestions.token, tokens), ne(listenerQuestions.status, "archived"))).orderBy(listenerQuestions.id);
    res.json({ messages: rows.map((q) => ({ token: q.token, question: q.question, reply: q.reply, repliedAt: q.repliedAt, createdAt: q.createdAt })) });
  });
}
