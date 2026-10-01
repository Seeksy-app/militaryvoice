// The keepsake magazine for an event: a cover, Riccoh's welcome, the lineup,
// one page per show and the sponsors. Built from what we already hold (the
// lineup, print-quality headshots, show art, SmartLinks); SI drafts each
// show's paragraph and the welcome, and a person edits them in admin. A pull
// quote is only ever the podcaster's own words, lifted from an episode
// transcript we hold, and checked word for word before it's kept.
//
// The same data drives the digital magazine (/magazine) and the print file
// (the same page, printed to PDF at US Letter).
import type { Express, RequestHandler } from "express";
import Anthropic from "@anthropic-ai/sdk";
import multer from "multer";
import sharp from "sharp";
import crypto from "node:crypto";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { getAdminEmail } from "./session.js";
import { uploadPhoto } from "./photoStorage.js";
import { bioPages, clips, discoveryCache, hostedShows, magazineAds, magazinePages, podcasterProfiles, signups, sponsors } from "../shared/schema.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const now = () => new Date().toISOString();
/** The row that says the magazine is out: until then only admins can open it. */
const PUBLISHED = -1;
const WELCOME = 0;
/** The cover photo, when one is set (in `art`); without it the cover is every podcaster's face. */
const COVER = -2;

const clean = (s: unknown, n: number) => {
  const t = String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

async function eventFor(slug?: string) {
  if (slug) return storage.getEventBySlug(slug);
  return storage.getFeaturedEvent();
}

type Episode = { title: string; date: string; audioUrl: string };
const unxml = (t: string) => t.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).trim();

/** A show's newest few episodes, from its feed (an Apple Podcasts page is looked up to its feed first). */
async function recentEpisodes(raw: string): Promise<Episode[]> {
  try {
    let feed = raw.trim();
    const appleId = /podcasts\.apple\.com\/.*\/id(\d+)/i.exec(feed)?.[1];
    if (appleId) feed = ((await (await fetch(`https://itunes.apple.com/lookup?id=${appleId}&entity=podcast`, { signal: AbortSignal.timeout(5_000) })).json()) as { results?: { feedUrl?: string }[] }).results?.[0]?.feedUrl ?? "";
    if (!/^https?:\/\//i.test(feed)) return [];
    const xml = (await (await fetch(feed, { signal: AbortSignal.timeout(7_000), headers: { "User-Agent": "MilitaryVoices.ai/1.0 (+https://www.militaryvoices.ai)" } })).text()).slice(0, 600_000);
    const out: Episode[] = [];
    for (const chunk of xml.split(/<item[\s>]/i).slice(1)) {
      const item = chunk.split(/<\/item>/i)[0];
      const audioUrl = /<enclosure\b[^>]*\burl\s*=\s*["']([^"']+)["']/i.exec(item)?.[1] ?? "";
      const title = unxml(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(item)?.[1] ?? "");
      if (!title || !/^https?:\/\//i.test(audioUrl)) continue;
      const when = Date.parse(unxml(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i.exec(item)?.[1] ?? ""));
      out.push({ title: title.slice(0, 160), audioUrl: unxml(audioUrl), date: Number.isFinite(when) ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(when)) : "" });
      if (out.length >= 4) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Every show's newest episodes, kept half a day (feeds are slow; the magazine is opened often). */
async function episodesFor(eventId: number, lineup: { id: number; rssUrl: string }[]): Promise<Record<number, Episode[]>> {
  const key = `mag:episodes:${eventId}`;
  const [row] = await db.select().from(discoveryCache).where(eq(discoveryCache.key, key));
  const have = row ? (JSON.parse(row.payload) as Record<number, Episode[]>) : {};
  const fresh = row && Date.now() - Date.parse(row.createdAt) < 12 * 3600_000;
  if (fresh && lineup.every((s) => s.id in have)) return have;
  const got = await Promise.all(lineup.map(async (s) => [s.id, s.rssUrl ? await recentEpisodes(s.rssUrl) : []] as const));
  // A feed that didn't answer this time keeps what it had.
  const next: Record<number, Episode[]> = Object.fromEntries(got.map(([id, eps]) => [id, eps.length ? eps : have[id] ?? []]));
  const payload = JSON.stringify(next);
  const createdAt = now();
  await db.insert(discoveryCache).values({ key, payload, createdAt }).onConflictDoUpdate({ target: discoveryCache.key, set: { payload, createdAt } });
  return next;
}

/** Everything the magazine prints, in running order. */
async function buildMagazine(eventId: number) {
  const ev = await storage.getEventById(eventId);
  if (!ev) return null;
  const lineup = (await db.select().from(signups).where(and(eq(signups.eventId, eventId), ne(signups.status, "cancelled")))).sort((a, b) => a.slotIndex - b.slotIndex);
  const emails = lineup.map((s) => s.email.trim().toLowerCase());
  const profiles = emails.length ? await db.select().from(podcasterProfiles).where(inArray(podcasterProfiles.email, emails)) : [];
  const pages = await db.select().from(bioPages).where(eq(bioPages.published, true));
  const hosted = await db.select({ ownerEmail: hostedShows.ownerEmail, slug: hostedShows.slug }).from(hostedShows);
  const words = await db.select().from(magazinePages).where(eq(magazinePages.eventId, eventId));
  const byEmail = <T extends { email: string }>(rows: T[], e: string) => rows.find((r) => r.email.trim().toLowerCase() === e);
  const start = Date.parse(ev.startAtUtc);
  const et = (ms: number) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(ms)) + " ET";
  const out = new Set(words.filter((x) => x.hidden).map((x) => x.signupId));
  const episodes = await episodesFor(eventId, lineup.filter((s) => !out.has(s.id)).map((s) => ({ id: s.id, rssUrl: s.rssUrl ?? "" }))).catch(() => ({} as Record<number, Episode[]>));
  const shows = lineup.filter((s) => !out.has(s.id)).map((s, i) => {
    const e = s.email.trim().toLowerCase();
    const p = byEmail(profiles, e);
    const bio = byEmail(pages, e);
    const show = hosted.find((h) => h.ownerEmail.trim().toLowerCase() === e);
    const w = words.find((x) => x.signupId === s.id);
    const at = start + s.slotIndex * ev.slotMinutes * 60_000;
    return {
      signupId: s.id,
      number: i + 1,
      time: et(at),
      podcastName: s.podcastName,
      hostName: s.hostName,
      branch: s.branch || p?.branch || "",
      service: s.serviceStatus || p?.serviceStatus || "",
      headshot: p?.photoOriginalUrl || s.photoUrl || p?.photoUrl || "",
      printQuality: Boolean(p?.photoOriginalUrl),
      art: p?.artworkPrintUrl || w?.art || "",
      blurb: w?.blurb ?? "",
      quote: w?.quote ?? "",
      // In their own words: the bio on their SmartLink.
      about: clean(bio?.bio, 650),
      audio: w?.audio ?? "",
      episodes: episodes[s.id] ?? [],
      edited: w?.edited ?? false,
      // Where the QR goes: their SmartLink, else the show we host, else their share page.
      link: bio?.handle ? `${ORIGIN}/${bio.handle}` : show ? `${ORIGIN}/podcast/${show.slug}` : `${ORIGIN}/s/${s.id}`,
    };
  });
  const sponsorRows = (await db.select().from(sponsors).where(and(eq(sponsors.eventId, eventId), eq(sponsors.active, true)))).sort((a, b) => a.sortOrder - b.sortOrder);
  const adRows = await db.select().from(magazineAds).where(eq(magazineAds.eventId, eventId)).orderBy(asc(magazineAds.sortOrder), asc(magazineAds.id));
  const allSponsors = adRows.some((a) => a.sponsorId) ? await db.select().from(sponsors) : [];
  const riccoh = await storage.getProfileByEmail("riccoh.player@drphil.tv").catch(() => undefined);
  const day = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" }).format(new Date(start));
  return {
    event: { id: ev.id, name: ev.name, tagline: ev.tagline || "", day, occasion: (ev as { occasion?: string }).occasion || "National Military Podcast Day" },
    published: words.some((x) => x.signupId === PUBLISHED),
    welcome: words.find((x) => x.signupId === WELCOME)?.blurb ?? "",
    host: { name: "Riccoh Player", title: "USMC (Ret.) · Host", photo: riccoh?.photoOriginalUrl || riccoh?.photoUrl || "" },
    shows,
    /** Left out by an admin (listed for admin only, so they can be put back). */
    leftOut: lineup.filter((s) => out.has(s.id)).map((s) => ({ signupId: s.id, podcastName: s.podcastName, hostName: s.hostName })),
    sponsors: sponsorRows.map((r) => ({ name: r.name, logo: r.logoUrl, url: r.url })),
    cover: { photo: words.find((x) => x.signupId === COVER)?.art ?? "" },
    // A sponsor's QR goes through the counted link, so the magazine's scans show in their numbers.
    ads: adRows.map((a) => {
      const sp = allSponsors.find((x) => x.id === a.sponsorId);
      const site = a.url || sp?.url || "";
      return {
        id: a.id, sponsorId: a.sponsorId, name: a.name || sp?.name || "", headline: a.headline, body: a.body,
        site, link: sp ? `${ORIGIN}/go/sponsor/${sp.id}?src=magazine` : site,
        logo: a.logoUrl || sp?.logoUrl || "", artwork: a.artworkUrl,
      };
    }),
  };
}

async function saveWords(eventId: number, signupId: number, patch: Partial<{ blurb: string; quote: string; art: string; edited: boolean; hidden: boolean; audio: string }>) {
  await db.insert(magazinePages).values({ eventId, signupId, blurb: patch.blurb ?? "", quote: patch.quote ?? "", art: patch.art ?? "", edited: patch.edited ?? false, hidden: patch.hidden ?? false, audio: patch.audio ?? "", updatedAt: now() })
    .onConflictDoUpdate({ target: [magazinePages.eventId, magazinePages.signupId], set: { ...patch, updatedAt: now() } });
}

/** A show's own description and cover, from its feed. */
async function feedFacts(rss: string): Promise<{ about: string; image: string }> {
  if (!/^https?:\/\//.test(rss)) return { about: "", image: "" };
  try {
    const xml = await (await fetch(rss, { signal: AbortSignal.timeout(8_000) })).text();
    const channel = xml.split(/<item[\s>]/i)[0] ?? "";
    const desc = /<itunes:summary>([\s\S]*?)<\/itunes:summary>/i.exec(channel)?.[1] ?? /<description>([\s\S]*?)<\/description>/i.exec(channel)?.[1] ?? "";
    const image = /<itunes:image[^>]*href="([^"]+)"/i.exec(channel)?.[1] ?? /<image>[\s\S]*?<url>([^<]+)<\/url>/i.exec(channel)?.[1] ?? "";
    return { about: clean(desc.replace(/<!\[CDATA\[|\]\]>/g, ""), 1500), image: image.trim() };
  } catch {
    return { about: "", image: "" };
  }
}

/** SI writes one show's paragraph, and picks a quote only from transcripts we hold (checked verbatim). */
async function draftShow(ai: Anthropic, eventId: number, s: { signupId: number; podcastName: string; hostName: string; branch: string; service: string }, rss: string, smartBio: string, transcripts: string[]) {
  const feed = await feedFacts(rss);
  const facts = [
    `Show: ${s.podcastName}`, `Host: ${s.hostName}`,
    s.branch && `Branch: ${s.branch}`, s.service && `Service: ${s.service}`,
    feed.about && `The show describes itself: ${feed.about}`,
    smartBio && `The host's own bio: ${clean(smartBio, 800)}`,
  ].filter(Boolean).join("\n");
  const out = await ai.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 900,
    system: `You write one page's text for a keepsake magazine of The Podcast Marathon, a day of military and veteran podcasts. Return JSON only: {"blurb": "...", "quote": "..."}.
"blurb": 60 to 90 words, third person, present tense, warm and specific, 8th-grade reading level. Say what the show is and who it's for, and who the host is. Use ONLY the facts given; never invent ranks, awards, numbers or history. No hype words ("amazing", "incredible").
"quote": copy ONE sentence (at most 28 words) EXACTLY as it appears in the transcripts, word for word, that says something true and striking in the host's own voice. If there are no transcripts, or nothing fits, return "".`,
    messages: [{ role: "user", content: `${facts}\n\nTranscripts from their episode:\n${transcripts.length ? transcripts.map((t) => `- ${clean(t, 900)}`).join("\n") : "(none)"}` }],
  });
  const text = out.content.map((c) => ("text" in c ? c.text : "")).join("");
  const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { blurb?: string; quote?: string };
  let quote = clean(j.quote, 240).replace(/^["“]|["”]$/g, "");
  // Their own words or nothing: the quote must appear in a transcript we hold.
  if (quote && !transcripts.some((t) => norm(t).includes(norm(quote)))) quote = "";
  await saveWords(eventId, s.signupId, { blurb: clean(j.blurb, 900), quote, art: feed.image });
}

async function draftWelcome(ai: Anthropic, eventId: number, m: NonNullable<Awaited<ReturnType<typeof buildMagazine>>>) {
  const out = await ai.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 700,
    system: `You write the welcome letter that opens a keepsake magazine, in the voice of Riccoh Player, USMC (Ret.), the host of the day. First person, warm, direct, short sentences, 140 to 190 words, 8th-grade reading level. Use only the facts given. No sign-off (it's added). Return the letter as plain text with blank lines between paragraphs.`,
    messages: [{ role: "user", content: `Event: ${m.event.name}\nDay: ${m.event.day}\nOccasion: ${m.event.occasion}\nShows on the day: ${m.shows.length}\nWho they are: military and veteran podcasters, back to back all day, live and recorded.\nThis magazine: one page for every show, to keep.` }],
  });
  const letter = out.content.map((c) => ("text" in c ? c.text : "")).join("").trim();
  await saveWords(eventId, WELCOME, { blurb: letter.slice(0, 2500) });
}

export function registerMagazine(app: Express, requireAdmin: RequestHandler) {
  /** The magazine. Before it's published, only admins can open it. */
  app.get(["/api/magazine", "/api/magazine/:slug"], async (req, res) => {
    await schemaIsReady();
    res.setHeader("Cache-Control", "no-store");
    const ev = await eventFor(typeof req.params.slug === "string" && req.params.slug ? req.params.slug : undefined);
    if (!ev) return res.status(404).json({ message: "No such magazine." });
    const m = await buildMagazine(ev.id);
    if (!m) return res.status(404).json({ message: "No such magazine." });
    const admin = !!getAdminEmail(req) && (await storage.isAdminEmail(getAdminEmail(req)!));
    if (!m.published && !admin) return res.status(404).json({ message: "The magazine isn't out yet." });
    res.json({ ...m, leftOut: admin ? m.leftOut : [], admin });
  });

  /** SI drafts every show page that has no words yet (or all, with ?all=1), and the welcome. */
  app.post("/api/admin/magazine/:eventId/draft", requireAdmin, async (req, res) => {
    const eventId = Number(req.params.eventId);
    const m = await buildMagazine(eventId);
    if (!m) return res.status(404).json({ message: "No such event." });
    const all = req.query.all === "1";
    const ai = new Anthropic();
    const lineup = await db.select().from(signups).where(eq(signups.eventId, eventId));
    const bios = await db.select({ email: bioPages.email, bio: bioPages.bio }).from(bioPages);
    const episodeClips = await db.select({ signupId: clips.signupId, transcript: clips.transcript }).from(clips).where(and(eq(clips.eventId, eventId), eq(clips.recordingId, 0)));
    const todo = m.shows.filter((s) => all ? !s.edited : !s.blurb);
    let done = 0;
    const failed: string[] = [];
    // A few at a time: 33 shows in well under a minute.
    for (let i = 0; i < todo.length; i += 6) {
      await Promise.all(todo.slice(i, i + 6).map(async (s) => {
        const sg = lineup.find((x) => x.id === s.signupId);
        const p = sg ? await storage.getProfileByEmail(sg.email.trim().toLowerCase()).catch(() => undefined) : undefined;
        const rss = sg?.rssUrl || p?.rssUrl || "";
        const bio = bios.find((b) => b.email.trim().toLowerCase() === sg?.email.trim().toLowerCase())?.bio ?? "";
        const transcripts = episodeClips.filter((c) => c.signupId === s.signupId && c.transcript).map((c) => c.transcript).slice(0, 4);
        try { await draftShow(ai, eventId, s, rss, bio, transcripts); done++; } catch (err) { failed.push(s.podcastName); console.warn("Magazine draft failed for", s.podcastName, (err as Error).message); }
      }));
    }
    if (!m.welcome || all) await draftWelcome(ai, eventId, m).catch((err) => console.warn("Welcome draft failed:", (err as Error).message));
    res.json({ drafted: done, failed });
  });

  /** A person's edit: the paragraph, the quote (their words only), or the welcome letter (signupId 0). */
  app.put("/api/admin/magazine/:eventId/pages/:signupId", requireAdmin, async (req, res) => {
    const eventId = Number(req.params.eventId);
    const signupId = Number(req.params.signupId);
    if (!Number.isInteger(signupId) || signupId < 0) return res.status(400).json({ message: "Which page?" });
    await saveWords(eventId, signupId, {
      ...(typeof req.body?.blurb === "string" ? { blurb: req.body.blurb.slice(0, 2500) } : {}),
      ...(typeof req.body?.quote === "string" ? { quote: req.body.quote.slice(0, 300) } : {}),
      ...(typeof req.body?.audio === "string" ? { audio: /^https?:\/\//i.test(req.body.audio.trim()) ? req.body.audio.trim().slice(0, 800) : "" } : {}),
      ...(typeof req.body?.hidden === "boolean" ? { hidden: req.body.hidden } : typeof req.body?.audio === "string" ? {} : { edited: true }),
    });
    res.json({ ok: true });
  });

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 }, fileFilter: (_req, f, cb) => cb(null, f.mimetype.startsWith("image/")) });
  /** A page-sized picture: up to 2550 × 3300 (US Letter at 300 dpi), never enlarged. */
  const savePage = async (buf: Buffer, tag: string) => {
    const out = await sharp(buf).rotate().resize(2550, 3300, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    return uploadPhoto(`magazine/${tag}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.jpg`, out);
  };

  /** An ad page: a sponsor's (their logo and counted link), or anyone's by name and link. */
  app.post("/api/admin/magazine/:eventId/ads", requireAdmin, upload.single("artwork"), async (req, res) => {
    const eventId = Number(req.params.eventId);
    const b = req.body ?? {};
    const sponsorId = Number(b.sponsorId) || 0;
    const name = String(b.name ?? "").trim().slice(0, 120);
    if (!sponsorId && !name) return res.status(400).json({ message: "Pick a sponsor or give the advertiser a name." });
    const url = String(b.url ?? "").trim().slice(0, 500);
    const count = (await db.select({ id: magazineAds.id }).from(magazineAds).where(eq(magazineAds.eventId, eventId))).length;
    const [row] = await db.insert(magazineAds).values({
      eventId, sponsorId, name,
      headline: String(b.headline ?? "").trim().slice(0, 140),
      body: String(b.body ?? "").trim().slice(0, 600),
      url: url && !/^https?:\/\//i.test(url) ? `https://${url}` : url,
      artworkUrl: req.file ? await savePage(req.file.buffer, "ad") : "",
      sortOrder: count,
      createdAt: now(),
    }).returning();
    res.json(row);
  });

  app.put("/api/admin/magazine/ads/:id", requireAdmin, async (req, res) => {
    const b = req.body ?? {};
    const patch: Record<string, string | number> = {};
    for (const [k, n] of [["name", 120], ["headline", 140], ["body", 600], ["url", 500]] as const) if (typeof b[k] === "string") patch[k] = b[k].trim().slice(0, n);
    if (typeof patch.url === "string" && patch.url && !/^https?:\/\//i.test(patch.url)) patch.url = `https://${patch.url}`;
    if (b.artwork === "") patch.artworkUrl = "";
    if (Number.isInteger(b.sortOrder)) patch.sortOrder = b.sortOrder;
    if (Object.keys(patch).length) await db.update(magazineAds).set(patch).where(eq(magazineAds.id, Number(req.params.id)));
    res.json({ ok: true });
  });

  /** Their finished page, edge to edge. */
  app.post("/api/admin/magazine/ads/:id/artwork", requireAdmin, upload.single("artwork"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Pick their ad first (a JPG or PNG)." });
    const meta = await sharp(req.file.buffer).metadata().catch(() => ({} as { width?: number; height?: number }));
    const artworkUrl = await savePage(req.file.buffer, "ad");
    await db.update(magazineAds).set({ artworkUrl }).where(eq(magazineAds.id, Number(req.params.id)));
    res.json({ ok: true, artworkUrl, width: meta.width ?? 0, height: meta.height ?? 0 });
  });

  /** An advertiser's logo, when they aren't one of the event's sponsors (kept as sent: a PNG keeps its see-through background). */
  app.post("/api/admin/magazine/ads/:id/logo", requireAdmin, upload.single("logo"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Pick their logo first." });
    const ext = req.file.mimetype === "image/png" ? "png" : req.file.mimetype === "image/svg+xml" ? "svg" : "jpg";
    const logoUrl = await uploadPhoto(`magazine/logo-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`, req.file.buffer, req.file.mimetype);
    await db.update(magazineAds).set({ logoUrl }).where(eq(magazineAds.id, Number(req.params.id)));
    res.json({ ok: true, logoUrl });
  });

  app.delete("/api/admin/magazine/ads/:id", requireAdmin, async (req, res) => {
    await db.delete(magazineAds).where(eq(magazineAds.id, Number(req.params.id)));
    res.json({ ok: true });
  });

  /** The cover photo (or, deleted, back to every podcaster's face). */
  app.post("/api/admin/magazine/:eventId/cover", requireAdmin, upload.single("photo"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Pick a photo first." });
    const meta = await sharp(req.file.buffer).metadata().catch(() => ({} as { width?: number; height?: number }));
    const art = await savePage(req.file.buffer, "cover");
    await saveWords(Number(req.params.eventId), COVER, { art });
    res.json({ ok: true, photo: art, width: meta.width ?? 0, height: meta.height ?? 0 });
  });
  app.delete("/api/admin/magazine/:eventId/cover", requireAdmin, async (req, res) => {
    await db.delete(magazinePages).where(and(eq(magazinePages.eventId, Number(req.params.eventId)), eq(magazinePages.signupId, COVER)));
    res.json({ ok: true });
  });

  /** Out to the world, or back to admins only. */
  app.post("/api/admin/magazine/:eventId/publish", requireAdmin, async (req, res) => {
    const eventId = Number(req.params.eventId);
    if (req.body?.published === false) await db.delete(magazinePages).where(and(eq(magazinePages.eventId, eventId), eq(magazinePages.signupId, PUBLISHED)));
    else await saveWords(eventId, PUBLISHED, { blurb: "published" });
    res.json({ ok: true, published: req.body?.published !== false });
  });
}
