import type { Express, Request } from "express";
import crypto from "node:crypto";
import multer from "multer";
import sharp from "sharp";
import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { requireHostSession, getSessionEmail } from "./session.js";
import { uploadPhoto, uploadShowAsset } from "./photoStorage.js";
import { sendListenerQuestionEmail, sendListenerReplyEmail, sendSponsorInquiryEmail } from "./email.js";
import { parseSocialAccounts } from "./uploadPost.js";
import { audienceFor } from "./discovery.js";
import { buildShareCard } from "./shareCard.js";
import Anthropic from "@anthropic-ai/sdk";
import { readFeed, hostedAsStats } from "./hosting.js";
import { signedRecordingUrl } from "./recordingStorage.js";
import { aiFor, knowledgeOf, syncKnowledge } from "./askShow.js";
import { bioPages, bioEvents, bioSubscribers, listenerQuestions, hostedShows, hostedEpisodes, type BioPageRow } from "../shared/schema.js";
import { DEFAULT_PODCAST, parseTheme, parseSections, parseSocials, parseBrands, parseFamily, type BioFamily, type BioFamilyPublic, handleOk, TEMPLATES, type BioPublic, type BioSection, type BioSocial, type BioTheme, type BioBrands, type BioBrandsPublic, type BioViewMedia, type BioLayout, BRANDS_SECTIONS, FAMILY_SECTIONS, INTRO_VOICES } from "../shared/bio.js";
import type { PodcastStatsData } from "../shared/schema.js";

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
  // Their pick: a show hosted here (the first by default), or a feed from another host.
  const source = parseTheme(row.theme).podcast?.source ?? "";
  const shows = source === "rss" ? [] : await db.select().from(hostedShows).where(eq(hostedShows.email, row.email)).orderBy(hostedShows.id);
  const show = source.startsWith("show:") ? shows.find((s) => s.id === Number(source.slice(5))) ?? shows[0] : shows[0];
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
    // An uploaded video plays from a signed address, good for a few hours.
    sections: await Promise.all(parseSections(row.sections).filter((s) => s.visible).map(async (s) => (s.type === "video" && s.url.startsWith("r2:") ? { ...s, file: (await uploadedVideo(s.url))?.url ?? "" } : s))),
    podcast: await podcastFor(row).catch(() => null),
    askEnabled: row.askEnabled,
    welcome: row.welcome.trim() || `Hi! Thanks for listening. What's on your mind?`,
    brandsOn: parseBrands(row.brands).on,
    cutoutUrl: row.cutoutFrom && row.cutoutFrom === row.avatarUrl ? row.cutoutUrl : "",
    livingUrl: row.livingFrom && row.livingFrom === (row.heroUrl || row.avatarUrl) ? row.livingUrl : "",
    introUrl: row.introUrl,
    ai: await aiFor(row),
  };
}

// ---- The Brands view (media kit) ----------------------------------------------------

const SOURCE_NAMES: Record<string, string> = { militaryvoices: "MilitaryVoices hosting", buzzsprout: "Buzzsprout", podbean: "Podbean", transistor: "Transistor", spotify: "Spotify" };

/** A show's numbers from one source: a typical recent episode (median of the last ten), the last 30 days, all time. */
function numbersOf(d: PodcastStatsData) {
  const counts = d.episodes.slice().sort((x, y) => y.published.localeCompare(x.published)).slice(0, 10).map((e) => e.count).filter((n) => n > 0).sort((x, y) => x - y);
  const since = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const daily = (d.series ?? []).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date));
  return {
    perEpisode: counts.length ? counts[Math.floor(counts.length / 2)] : null,
    last30: daily.length ? daily.filter((x) => x.date >= since).reduce((a, x) => a + x.count, 0) : null,
    total: d.total > 0 ? d.total : null,
    unit: d.unit,
  };
}

/** Everything a brand sees: the kit they wrote, and numbers we measured (never typed in by them). */
async function brandsOf(row: BioPageRow): Promise<BioBrandsPublic> {
  const [hosted, stats, profile, pod, audience] = await Promise.all([
    hostedAsStats(row.email).catch(() => []),
    storage.listPodcastStats(row.email).catch(() => []),
    storage.getProfileByEmail(row.email).catch(() => undefined),
    podcastFor(row).catch(() => null),
    audienceFor(row.email).catch((err) => { console.warn("Kit audience failed:", (err as Error).message); return null; }),
  ]);
  const sources = [
    ...hosted.map((h) => ({ source: "militaryvoices", data: h.data })),
    ...stats.map((r) => { try { return { source: r.source, data: JSON.parse(r.data) as PodcastStatsData }; } catch { return null; } }).filter((x): x is { source: string; data: PodcastStatsData } => Boolean(x?.data?.episodes)),
  ].map((x) => ({ source: x.source, ...numbersOf(x.data) }));
  // The source with the most per episode is the show's real audience (a moved show's old host keeps its history).
  const best = sources.sort((a, b) => (b.perEpisode ?? 0) - (a.perEpisode ?? 0) || (b.total ?? 0) - (a.total ?? 0))[0];
  const followers = parseSocialAccounts(profile?.socialAccounts).filter((a) => (a.followers ?? 0) > 0).map((a) => ({ platform: a.platform, username: a.username, followers: a.followers ?? 0 })).sort((a, b) => b.followers - a.followers);
  const since = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const ev = await db.select({ kind: bioEvents.kind, n: sql<number>`count(*)::int` }).from(bioEvents).where(and(eq(bioEvents.pageId, row.id), gte(bioEvents.day, since))).groupBy(bioEvents.kind);
  const count = (k: string) => ev.find((e) => e.kind === k)?.n ?? 0;
  const kit = parseBrands(row.brands);
  return {
    handle: row.handle,
    displayName: row.displayName,
    bio: row.bio,
    avatarUrl: row.avatarUrl,
    branch: profile?.branch && profile.branch !== "Not applicable" ? profile.branch : "",
    theme: parseTheme(row.theme),
    kit,
    heroUrl: row.heroUrl,
    socials: parseSocials(row.socials).filter((x) => x.on && /^https?:\/\//.test(x.url)),
    cutoutUrl: row.cutoutFrom && row.cutoutFrom === row.avatarUrl ? row.cutoutUrl : "",
    podcast: pod ? { title: pod.title, artworkUrl: pod.artworkUrl, pageUrl: pod.pageUrl, episodeCount: pod.episodeCount, latest: pod.episodes.slice(0, 3).map((e) => ({ title: e.title, publishedAt: e.publishedAt, artworkUrl: e.artworkUrl || pod.artworkUrl })) } : null,
    numbers: {
      perEpisode: best?.perEpisode ?? null,
      last30: best?.last30 ?? null,
      total: best?.total ?? null,
      unit: best?.unit ?? "downloads",
      source: best ? SOURCE_NAMES[best.source] ?? best.source : "",
      followers,
      reach: followers.reduce((a, f) => a + f.followers, 0),
      pageViews30: count("view"),
      plays30: count("play"),
    },
    audience,
    media: {
      video: await uploadedVideo(kit.video),
      sample: sampleOf(kit, pod),
    },
  };
}

/** An uploaded video ("r2:<key>") as an address to play for a few hours; a link plays as it is. */
async function uploadedVideo(v: string): Promise<BioViewMedia["video"]> {
  const m = v.match(/^r2:(show-assets\/[\w.-]+)$/);
  if (!m) return null;
  const url = await signedRecordingUrl(m[1], 12 * 3600).catch(() => "");
  return url ? { from: v, url } : null;
}

/** The sample for brands: one of their episodes, or the link (read when they saved it). */
function sampleOf(kit: BioBrands, pod: Awaited<ReturnType<typeof podcastFor>> | null): BioViewMedia["sample"] {
  const ep = kit.sample.match(/^ep:(.+)$/);
  if (ep) {
    const e = pod?.episodes.find((x) => x.id === ep[1]);
    return e ? { from: kit.sample, title: e.title, audio: e.audio, artworkUrl: e.artworkUrl || pod?.artworkUrl || "" } : null;
  }
  return kit.sample && kit.sampleInfo?.audio ? { from: kit.sample, ...kit.sampleInfo } : null;
}

/** A sample link: an audio file plays as it is; a feed gives its latest episode. */
async function readSample(url: string): Promise<BioBrands["sampleInfo"]> {
  if (/\.(mp3|m4a|aac|wav|ogg)(\?|$)/i.test(url)) return { title: "Sample episode", audio: url, artworkUrl: "" };
  const feed = await readFeed(url).catch(() => null);
  const it = feed?.items.slice().sort((a, b) => b.published.localeCompare(a.published))[0];
  return it?.url ? { title: it.title, audio: it.url, artworkUrl: it.image || feed?.artwork || "" } : undefined;
}

// ---- The Family view (private link) ---------------------------------------------------

const newKey = () => crypto.randomBytes(12).toString("base64url");

/** Their family settings, with a private key made the first time. */
async function familyOf(row: BioPageRow): Promise<BioFamily> {
  const f = parseFamily(row.family);
  if (f.key) return f;
  const out = { ...f, key: newKey() };
  await db.update(bioPages).set({ family: JSON.stringify(out) }).where(eq(bioPages.id, row.id));
  return out;
}

async function familyPublicOf(row: BioPageRow, f: BioFamily): Promise<BioFamilyPublic> {
  const [profile, pod, hosted, stats, video, audio] = await Promise.all([
    storage.getProfileByEmail(row.email).catch(() => undefined),
    podcastFor(row).catch(() => null),
    hostedAsStats(row.email).catch(() => []),
    storage.listPodcastStats(row.email).catch(() => []),
    uploadedVideo(f.video ?? ""),
    uploadedVideo(f.audio ?? ""),
  ]);
  const totals = [...hosted.map((h) => h.data.total), ...stats.map((r) => { try { return (JSON.parse(r.data) as PodcastStatsData).total ?? 0; } catch { return 0; } })];
  const followers = parseSocialAccounts(profile?.socialAccounts).reduce((a, x) => a + (x.followers ?? 0), 0);
  const { key: _key, ...family } = f;
  return {
    handle: row.handle,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    heroUrl: row.heroUrl,
    branch: profile?.branch && profile.branch !== "Not applicable" ? profile.branch : "",
    theme: parseTheme(row.theme),
    family,
    podcast: pod ? { title: pod.title, artworkUrl: pod.artworkUrl, episodeCount: pod.episodeCount, episodes: pod.episodes.map((e) => ({ id: e.id, title: e.title, publishedAt: e.publishedAt, durationSec: e.durationSec, audio: e.audio, artworkUrl: e.artworkUrl || pod.artworkUrl })) } : null,
    numbers: { episodes: pod?.episodeCount ?? 0, listens: Math.max(0, ...totals), followers },
    askEnabled: row.askEnabled,
    firstName: (profile?.hostName || "").trim().split(/\s+/)[0] || "",
    media: { video, audio, sample: null },
    socials: parseSocials(row.socials).filter((x) => x.on && /^https?:\/\//.test(x.url)),
    cutoutUrl: row.cutoutFrom && row.cutoutFrom === row.avatarUrl ? row.cutoutUrl : "",
  };
}

function cleanFamily(v: unknown, prev: BioFamily): BioFamily {
  const x = (v ?? {}) as Record<string, unknown>;
  const id = (p: Record<string, unknown>) => str(p?.id, 20) || crypto.randomBytes(4).toString("hex");
  return {
    on: typeof x.on === "boolean" ? x.on : prev.on,
    key: x.resetKey === true ? newKey() : prev.key || newKey(),
    note: typeof x.note === "string" ? x.note.slice(0, 1000) : prev.note,
    noteAlign: x.noteAlign === "center" || x.noteAlign === "right" || x.noteAlign === "left" ? x.noteAlign : prev.noteAlign ?? "left",
    story: typeof x.story === "string" ? x.story.slice(0, 4000) : prev.story,
    milestones: Array.isArray(x.milestones)
      ? x.milestones.slice(0, 30).map((m: Record<string, unknown>) => ({ id: id(m), when: str(m?.when, 40), title: str(m?.title, 120), note: str(m?.note, 400) })).filter((m) => m.when || m.title || m.note)
      : prev.milestones,
    photos: Array.isArray(x.photos)
      ? x.photos.slice(0, 24).map((p: Record<string, unknown>) => ({ id: id(p), url: httpUrl(p?.url), caption: str(p?.caption, 160) })).filter((p) => p.url)
      : prev.photos,
    favorites: Array.isArray(x.favorites) ? x.favorites.filter((f: unknown): f is string => typeof f === "string").slice(0, 6).map((f) => f.slice(0, 40)) : prev.favorites,
    photo: typeof x.photo === "string" ? httpUrl(x.photo) : prev.photo,
    name: typeof x.name === "string" ? x.name.slice(0, 80) : prev.name ?? "",
    video: typeof x.video === "string" ? videoRef(x.video) : prev.video ?? "",
    audio: typeof x.audio === "string" ? (/^r2:show-assets\/[\w.-]+$/.test(x.audio) ? x.audio : "") : prev.audio ?? "",
    layout: layoutOf(x.layout, prev.layout),
    order: idsOf(x.order, FAMILY_SECTIONS, prev.order),
    hidden: idsOf(x.hidden, FAMILY_SECTIONS, prev.hidden),
  };
}

const LAYOUTS: BioLayout[] = ["portrait", "landscape", "blend", "hero", "shape", "cutout", "popout", "sticker", "magazine"];
const layoutOf = (v: unknown, prev: BioLayout | "" | undefined): BioLayout | "" => (v === "" || LAYOUTS.includes(v as BioLayout) ? (v as BioLayout | "") : prev ?? "");
/** A list of section ids, only known ones, once each. */
const idsOf = <T extends string>(v: unknown, all: readonly { id: T }[], prev: T[] | undefined): T[] =>
  Array.isArray(v) ? Array.from(new Set(v.filter((x): x is T => all.some((a) => a.id === x)))) : prev ?? [];

/** A video link (https) or one they uploaded to us. */
const videoRef = (v: string) => (/^r2:show-assets\/[\w.-]+$/.test(v) ? v : httpUrl(v));

function cleanBrands(v: unknown, prev: BioBrands): BioBrands {
  const x = (v ?? {}) as Record<string, unknown>;
  return {
    on: typeof x.on === "boolean" ? x.on : prev.on,
    pitch: typeof x.pitch === "string" ? x.pitch.slice(0, 400) : prev.pitch,
    audience: typeof x.audience === "string" ? x.audience.slice(0, 400) : prev.audience,
    showRates: typeof x.showRates === "boolean" ? x.showRates : prev.showRates,
    partners: Array.isArray(x.partners)
      ? x.partners.slice(0, 24).map((p: Record<string, unknown>) => ({ id: str(p?.id, 20) || crypto.randomBytes(4).toString("hex"), name: str(p?.name, 60).trim(), url: httpUrl(p?.url), logo: httpUrl(p?.logo) })).filter((p) => p.name || p.url)
      : prev.partners,
    photo: typeof x.photo === "string" ? httpUrl(x.photo) : prev.photo,
    name: typeof x.name === "string" ? x.name.slice(0, 80) : prev.name ?? "",
    sponsorOn: typeof x.sponsorOn === "boolean" ? x.sponsorOn : prev.sponsorOn ?? true,
    video: typeof x.video === "string" ? videoRef(x.video) : prev.video ?? "",
    sample: typeof x.sample === "string" ? (/^ep:[\w:.-]{1,200}$/.test(x.sample) ? x.sample : httpUrl(x.sample)) : prev.sample ?? "",
    sampleInfo: prev.sampleInfo,
    layout: layoutOf(x.layout, prev.layout),
    order: idsOf(x.order, BRANDS_SECTIONS, prev.order),
    hidden: idsOf(x.hidden, BRANDS_SECTIONS, prev.hidden),
  };
}

// ---- Cleaning what the builder sends -----------------------------------------------

const httpUrl = (v: unknown) => { const s = String(v ?? "").trim().slice(0, 500); return /^https?:\/\/[^\s]+$/i.test(s) ? s : ""; };
const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);

function cleanSections(v: unknown): BioSection[] {
  if (!Array.isArray(v)) return [];
  // One podcast block, wherever they put it.
  let podcast = false;
  return v.slice(0, 30).filter((x) => (x as { type?: string })?.type !== "podcast" || (!podcast && (podcast = true))).flatMap((raw): BioSection[] => {
    const x = raw as Record<string, unknown>;
    const base = { id: /^[\w-]{1,40}$/.test(String(x.id)) ? String(x.id) : crypto.randomBytes(5).toString("hex"), visible: x.visible !== false, title: str(x.title, 80) };
    switch (x.type) {
      case "links": return [{ ...base, type: "links", links: (Array.isArray(x.links) ? x.links : []).slice(0, 30).map((l: Record<string, unknown>) => ({ id: /^[\w-]{1,40}$/.test(String(l.id)) ? String(l.id) : crypto.randomBytes(4).toString("hex"), label: str(l.label, 80), url: httpUrl(l.url) })).filter((l) => l.label || l.url) }];
      case "video": return [{ ...base, type: "video", url: videoRef(String(x.url ?? "")) }];
      case "promo": return [{ ...base, type: "promo", code: str(x.code, 40), url: httpUrl(x.url), note: str(x.note, 200),
        codes: (Array.isArray(x.codes) ? x.codes : []).slice(0, 20).map((c: Record<string, unknown>) => ({ id: /^[\w-]{1,40}$/.test(String(c.id)) ? String(c.id) : crypto.randomBytes(4).toString("hex"), brand: str(c.brand, 60), code: str(c.code, 40), note: str(c.note, 200), url: httpUrl(c.url) })) }];
      case "music": return [{ ...base, type: "music", tracks: (Array.isArray(x.tracks) ? x.tracks : []).slice(0, 12).map((t: Record<string, unknown>) => ({ id: /^[\w-]{1,40}$/.test(String(t.id)) ? String(t.id) : crypto.randomBytes(4).toString("hex"), url: str(t.url, 500).trim() })).filter((t) => !t.url || /^https:\/\/\S+$/.test(t.url)) }];
      case "meeting": return [{ ...base, type: "meeting", url: httpUrl(x.url), note: str(x.note, 200) }];
      case "podcast": return [{ ...base, type: "podcast" }];
      case "signup": return [{ ...base, type: "signup", note: str(x.note, 200), button: str(x.button, 40) }];
      case "text": return [{ ...base, type: "text", body: str(x.body, 2000), align: x.align === "center" || x.align === "right" ? x.align : "left" }];
      case "divider": return [{ ...base, type: "divider", space: Number.isFinite(Number(x.space)) ? Math.max(0, Math.min(160, Math.round(Number(x.space)))) : 24, line: (["none", "thin", "thick", "dashed", "dots"] as const).includes(x.line as never) ? (x.line as "none") : "thin" }];
      default: return [];
    }
  });
}

function cleanTheme(v: unknown, prev: BioTheme): BioTheme {
  const x = (v ?? {}) as Record<string, unknown>;
  const pick = <T extends string>(k: string, ok: readonly T[], d: T): T => (ok.includes(x[k] as T) ? (x[k] as T) : d);
  return {
    template: pick("template", ["classic", "bold", "minimal", "vibrant", "portrait"] as const, prev.template),
    color: /^#[0-9a-f]{6}$/i.test(String(x.color)) ? String(x.color) : prev.color,
    shade: pick("shade", ["none", "minimal", "light", "tint", "dark"] as const, prev.shade),
    font: pick("font", ["sans", "serif", "mono", "playfair", "montserrat", "poppins"] as const, prev.font),
    linkShape: pick("linkShape", ["pill", "rounded", "square", "squircle"] as const, prev.linkShape),
    linkStyle: pick("linkStyle", ["fill", "outline", "soft", "hard"] as const, prev.linkStyle),
    linkColor: typeof x.linkColor === "string" ? (/^#[0-9a-f]{6}$/i.test(x.linkColor) ? x.linkColor : "") : prev.linkColor ?? "",
    stickerColor: typeof x.stickerColor === "string" ? (/^#[0-9a-f]{6}$/i.test(x.stickerColor) ? x.stickerColor : "") : prev.stickerColor ?? "",
    background: (() => {
      const o = (x.background ?? {}) as Record<string, unknown>;
      const pv = prev.background ?? { mode: "solid" as const, color: "", image: "" };
      return {
        mode: (["solid", "gradient", "image"] as const).includes(o.mode as "solid") ? (o.mode as "solid" | "gradient" | "image") : pv.mode,
        color: typeof o.color === "string" ? (/^#[0-9a-f]{6}$/i.test(o.color) ? o.color : "") : pv.color,
        image: typeof o.image === "string" ? httpUrl(o.image) : pv.image,
      };
    })(),
    imageY: Number.isFinite(Number(x.imageY)) && x.imageY !== undefined ? Math.max(0, Math.min(100, Math.round(Number(x.imageY)))) : prev.imageY ?? 50,
    avatarSize: pick("avatarSize", ["s", "m", "l"] as const, prev.avatarSize ?? "m"),
    branding: typeof x.branding === "boolean" ? x.branding : prev.branding ?? true,
    shareButton: typeof x.shareButton === "boolean" ? x.shareButton : prev.shareButton ?? false,
    contactButton: typeof x.contactButton === "boolean" ? x.contactButton : prev.contactButton ?? false,
    hideName: typeof x.hideName === "boolean" ? x.hideName : prev.hideName ?? false,
    hideBio: typeof x.hideBio === "boolean" ? x.hideBio : prev.hideBio ?? false,
    bgTint: Number.isFinite(Number(x.bgTint)) && x.bgTint !== undefined ? Math.max(0, Math.min(100, Math.round(Number(x.bgTint)))) : prev.bgTint ?? 0,
    bgBrightness: Number.isFinite(Number(x.bgBrightness)) && x.bgBrightness !== undefined ? Math.max(-100, Math.min(100, Math.round(Number(x.bgBrightness)))) : prev.bgBrightness ?? 0,
    cutoutY: Number.isFinite(Number(x.cutoutY)) && x.cutoutY !== undefined ? Math.max(-160, Math.min(160, Math.round(Number(x.cutoutY)))) : prev.cutoutY ?? 0,
    socialsFirst: typeof x.socialsFirst === "boolean" ? x.socialsFirst : prev.socialsFirst ?? false,
    living: typeof x.living === "boolean" ? x.living : prev.living ?? false,
    intro: typeof x.intro === "boolean" ? x.intro : prev.intro ?? false,
    introSay: Array.isArray(x.introSay) ? (x.introSay as unknown[]).map((l) => String(l ?? "").replace(/\s+/g, " ").trim().slice(0, 32)).filter((l, i, all) => l && all.indexOf(l) === i).slice(0, 6) : prev.introSay ?? [],
    introBack: typeof x.introBack === "string" ? x.introBack.replace(/\s+/g, " ").trim().slice(0, 32) : prev.introBack ?? "",
    introAt: (["top-left", "top-right", "bottom-left", "bottom-right", "bio"] as const).includes(x.introAt as never) ? (x.introAt as BioTheme["introAt"]) : prev.introAt ?? "bottom-left",
    chatAt: (["top-left", "top-right", "bottom-left", "bottom-right", "socials"] as const).includes(x.chatAt as never) ? (x.chatAt as BioTheme["chatAt"]) : prev.chatAt ?? "top-right",
    scene: typeof x.scene === "string" ? httpUrl(x.scene) : prev.scene ?? "",
    sceneKey: typeof x.sceneKey === "string" ? x.sceneKey.slice(0, 120) : prev.sceneKey ?? "",
    popup: x.popup && typeof x.popup === "object" ? (() => {
      const p = x.popup as Record<string, unknown>;
      const kind = (["none", "promo", "email"] as const).includes(p.kind as never) ? (p.kind as "none") : "none";
      return { kind, pre: str(p.pre, 60), heading: str(p.heading, 80), note: str(p.note, 200), button: str(p.button, 40), image: httpUrl(p.image), url: httpUrl(p.url) };
    })() : prev.popup,
    nameY: Number.isFinite(Number(x.nameY)) && x.nameY !== undefined ? Math.max(-120, Math.min(120, Math.round(Number(x.nameY)))) : prev.nameY ?? 0,
    nameSize: Number.isFinite(Number(x.nameSize)) && x.nameSize !== undefined ? Math.max(60, Math.min(150, Math.round(Number(x.nameSize)))) : prev.nameSize ?? 100,
    cutoutSize: Number.isFinite(Number(x.cutoutSize)) && x.cutoutSize !== undefined ? Math.max(60, Math.min(150, Math.round(Number(x.cutoutSize)))) : prev.cutoutSize ?? 100,
    bgWash: Number.isFinite(Number(x.bgWash)) && x.bgWash !== undefined ? Math.max(0, Math.min(100, Math.round(Number(x.bgWash)))) : prev.bgWash ?? 65,
    layout: pick("layout", ["portrait", "landscape", "blend", "hero", "shape", "cutout", "popout", "sticker", "magazine"] as const, prev.layout),
    podcastStyle: pick("podcastStyle", ["spotlight", "list", "carousel"] as const, prev.podcastStyle),
    podcastFrame: pick("podcastFrame", ["full", "card"] as const, prev.podcastFrame),
    podcast: (() => {
      const o = (x.podcast ?? {}) as Record<string, unknown>;
      const pv = prev.podcast ?? DEFAULT_PODCAST;
      const b = (k: "on" | "apple" | "spotify" | "all" | "rss") => (typeof o[k] === "boolean" ? (o[k] as boolean) : pv[k]);
      return { on: b("on"), heading: typeof o.heading === "string" ? o.heading.slice(0, 80) : pv.heading, count: [3, 5, 10].includes(Number(o.count)) ? Number(o.count) : pv.count, apple: b("apple"), spotify: b("spotify"), all: b("all"), rss: b("rss"),
        source: typeof o.source === "string" && /^(|rss|show:\d{1,9})$/.test(o.source) ? o.source : pv.source ?? "" };
    })(),
  };
}

function cleanSocials(v: unknown): BioSocial[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 20).map((s: Record<string, unknown>) => ({ platform: str(s.platform, 30), username: str(s.username, 100), url: httpUrl(s.url), on: s.on !== false })).filter((s) => s.platform);
}

// ---- Routes -------------------------------------------------------------------------

/** Who signed up on their SmartLink (Stay in touch), newest first: for their Contacts. */
export async function subscribersFor(email: string): Promise<{ id: number; name: string; email: string; createdAt: string }[]> {
  await schemaIsReady();
  const [page] = await db.select({ id: bioPages.id }).from(bioPages).where(eq(bioPages.email, email)).limit(1);
  if (!page) return [];
  return db.select({ id: bioSubscribers.id, name: bioSubscribers.name, email: bioSubscribers.email, createdAt: bioSubscribers.createdAt }).from(bioSubscribers).where(eq(bioSubscribers.pageId, page.id)).orderBy(desc(bioSubscribers.id));
}

/** The living photo's job: fal making it (status, response), then the worker making it smaller (squeeze). */
type LivingState = { status?: string; response?: string; from: string; at: number; squeeze?: "queued" | "running"; src?: string };

/**
 * A video for the worker to make smaller for phones: a living photo (720p, silent)
 * or a talking intro (720p, with its sound), starting as it loads.
 */
export async function claimLivingSqueeze(): Promise<{ id: number; url: string; kind: "living" | "intro" } | null> {
  await schemaIsReady();
  for (const kind of ["living", "intro"] as const) {
    const col = kind === "living" ? bioPages.livingJob : bioPages.introJob;
    const rows = await db.select({ id: bioPages.id, job: col }).from(bioPages).where(sql`${col} LIKE '%"squeeze"%'`).limit(10);
    for (const r of rows) {
      let j: LivingState;
      try { j = JSON.parse(r.job) as LivingState; } catch { continue; }
      if (!j.src || !(j.squeeze === "queued" || (j.squeeze === "running" && Date.now() - j.at > 20 * 60_000))) continue;
      const next = JSON.stringify({ ...j, squeeze: "running", at: Date.now() } satisfies LivingState);
      const got = await db.update(bioPages).set(kind === "living" ? { livingJob: next } : { introJob: next }).where(and(eq(bioPages.id, r.id), eq(col, r.job))).returning({ id: bioPages.id });
      if (got.length) return { id: r.id, url: j.src, kind };
    }
  }
  return null;
}

/** The worker's side of the living photo: the smaller copy comes back, or it couldn't (the big one stays). */
export function registerBioAgent(app: Express, requireAgent: import("express").RequestHandler) {
  app.post("/api/agent/living-squeeze/:id/done", requireAgent, async (req, res) => {
    const id = Number(req.params.id);
    const intro = req.query.kind === "intro";
    const [row] = await db.select().from(bioPages).where(eq(bioPages.id, id)).limit(1);
    if (!row) return res.status(404).json({ message: "No such page." });
    let j: LivingState | null = null;
    try { j = JSON.parse(intro ? row.introJob : row.livingJob) as LivingState; } catch { j = null; }
    try {
      const buf = Buffer.from(String(req.body?.mp4 ?? ""), "base64");
      if (buf.length < 20_000) throw new Error("no video");
      // Only if it's still the one on their page (they may have made a new one meanwhile).
      if (intro && j?.src && j.src === row.introUrl) {
        const url = await uploadShowAsset(`bio/${id}-intro-${Date.now()}-720.mp4`, buf, "video/mp4");
        await db.update(bioPages).set({ introUrl: url, introJob: "" }).where(and(eq(bioPages.id, id), eq(bioPages.introUrl, j.src)));
      } else if (!intro && j?.src && j.src === row.livingUrl) {
        const url = await uploadShowAsset(`bio/${id}-living-${Date.now()}-720.mp4`, buf, "video/mp4");
        await db.update(bioPages).set({ livingUrl: url, livingJob: "" }).where(and(eq(bioPages.id, id), eq(bioPages.livingUrl, j.src)));
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("Living photo squeeze failed:", (err as Error).message);
      await db.update(bioPages).set(intro ? { introJob: "" } : { livingJob: "" }).where(eq(bioPages.id, id));
      res.status(400).json({ message: "Couldn't use that video." });
    }
  });
  app.post("/api/agent/living-squeeze/:id/failed", requireAgent, async (req, res) => {
    if (req.query.kind === "intro") await db.update(bioPages).set({ introJob: "" }).where(and(eq(bioPages.id, Number(req.params.id)), sql`${bioPages.introJob} LIKE '%"squeeze"%'`));
    else await db.update(bioPages).set({ livingJob: "" }).where(and(eq(bioPages.id, Number(req.params.id)), sql`${bioPages.livingJob} LIKE '%"squeeze"%'`));
    res.json({ ok: true });
  });
}

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
    const fam = await familyOf(row);
    res.json({
      page: { ...row, theme: parseTheme(row.theme), sections: parseSections(row.sections), socials: parseSocials(row.socials), brands: parseBrands(row.brands), family: fam },
      familyPreview: await familyPublicOf(row, fam).catch((err) => { console.warn("Family preview failed:", (err as Error).message); return null; }),
      brandsPreview: await brandsOf(row).catch((err) => { console.warn("Brands preview failed:", (err as Error).message); return null; }),
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
    if (b.brands && typeof b.brands === "object") {
      const prev = parseBrands(row.brands);
      const kit = cleanBrands(b.brands, prev);
      // A sample link is read once, when it's saved (a feed gives its latest episode).
      if (kit.sample !== prev.sample) kit.sampleInfo = /^https?:/.test(kit.sample) ? await readSample(kit.sample) : undefined;
      patch.brands = JSON.stringify(kit);
    }
    if (b.family && typeof b.family === "object") patch.family = JSON.stringify(cleanFamily(b.family, await familyOf(row)));
    if (typeof b.aiEnabled === "boolean") patch.aiEnabled = b.aiEnabled;
    if (typeof b.published === "boolean") patch.published = b.published;
    if (b.avatarUrl === "" || b.heroUrl === "") { if (b.avatarUrl === "") patch.avatarUrl = ""; if (b.heroUrl === "") patch.heroUrl = ""; }
    // A fixed-up or restyled copy they chose, or their own photo back: only this page's own, from our photo storage.
    const ours = (v: unknown, kind: "avatar" | "hero") => {
      const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
      return typeof v === "string" && !!base && v.startsWith(`${base}/storage/v1/object/public/`) && new RegExp(`/bio/${row.id}-${kind}-((fixed|styled-[a-z]+)-)?\\d+\\.jpg$`).test(v);
    };
    if (ours(b.avatarUrl, "avatar")) patch.avatarUrl = b.avatarUrl;
    if (ours(b.heroUrl, "hero")) patch.heroUrl = b.heroUrl;
    if (b.theme) patch.theme = JSON.stringify(cleanTheme(b.theme, parseTheme(row.theme)));
    if (b.sections) patch.sections = JSON.stringify(cleanSections(b.sections));
    if (b.socials) patch.socials = JSON.stringify(cleanSocials(b.socials));
    const [out] = await db.update(bioPages).set(patch).where(eq(bioPages.id, row.id)).returning();
    res.json({
      page: { ...out, theme: parseTheme(out.theme), sections: parseSections(out.sections), socials: parseSocials(out.socials) }, url: `${ORIGIN}/${out.handle}`, preview: await publicOf(out),
      // The Brands or Family preview again when they changed, for its video and sample.
      ...(b.brands ? { brandsPreview: await brandsOf(out).catch(() => null) } : {}),
      ...(b.family ? { familyPreview: await familyPublicOf(out, parseFamily(out.family)).catch(() => null) } : {}),
    });
  });

  // The photo (square) and the cover (wide), sized for the page.
  app.post("/api/host/bio/image/:kind", requireHostSession, art.single("file"), async (req, res) => {
    const row = await pageFor(emailOf(req));
    const kind = req.params.kind === "hero" ? "hero" : ["family", "brands", "bg"].includes(String(req.params.kind)) ? "family" : "avatar";
    if (!req.file) return res.status(400).json({ message: "Choose an image." });
    try {
      // A family photo: kept at its own unlisted address, added to the Family view by the builder.
      if (kind === "family") {
        const img = await sharp(req.file.buffer).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
        return res.json({ url: await uploadPhoto(`bio/${row.id}-family-${crypto.randomBytes(8).toString("hex")}.jpg`, img, "image/jpeg") });
      }
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

  // Cutout: their profile photo with the background taken out (BiRefNet on fal, portrait model), kept as a PNG.
  const cutting = new Map<number, number[]>();
  // ---- fal: the living photo and the scenes behind a cut-out ------------------------
  const FAL = () => ({ Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" });

  // The living photo: their top photo, moving for five seconds (a blink, a breath, a smile),
  // ending on the photo itself so it loops without a jump. Kling on fal's queue, about a minute.
  const LIVING = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";
  const livingRuns = new Map<number, number[]>();
  type LivingJob = LivingState;
  app.post("/api/host/bio/living", requireHostSession, async (req, res) => {
    const row = await pageFor(emailOf(req));
    if (!process.env.FAL_KEY) return res.status(503).json({ message: "Living photos aren't switched on yet." });
    const photo = row.heroUrl || row.avatarUrl;
    if (!photo) return res.status(400).json({ message: "Add a photo first." });
    if (row.livingUrl && row.livingFrom === photo && !req.body?.again) return res.json({ status: "done", livingUrl: row.livingUrl });
    const job = row.livingJob ? (JSON.parse(row.livingJob) as LivingJob) : null;
    if (job && !job.squeeze && job.from === photo && Date.now() - job.at < 15 * 60_000) return res.json({ status: "running" });
    const hits = (livingRuns.get(row.id) ?? []).filter((t) => Date.now() - t < 24 * 3600_000);
    if (hits.length >= 4) return res.status(429).json({ message: "That's four today. Try again tomorrow." });
    livingRuns.set(row.id, [...hits, Date.now()]);
    try {
      const r = await fetch(`https://queue.fal.run/${LIVING}`, {
        method: "POST", headers: FAL(), signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          image_url: photo, tail_image_url: photo, duration: "5", cfg_scale: 0.5,
          prompt: "The person in the photo comes to life: they breathe naturally, blink, and give a small warm smile, then settle back to exactly how they started. Subtle, natural, gentle motion. The camera stays completely still. Same framing, same lighting, same background.",
          negative_prompt: "camera movement, zoom, pan, talking, big gestures, blur, distortion, morphing face, extra limbs, low quality",
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { status_url?: string; response_url?: string };
      if (!r.ok || !j.status_url || !j.response_url) throw new Error(`fal ${r.status}`);
      await db.update(bioPages).set({ livingJob: JSON.stringify({ status: j.status_url, response: j.response_url, from: photo, at: Date.now() } satisfies LivingJob) }).where(eq(bioPages.id, row.id));
      res.json({ status: "running" });
    } catch (err) {
      console.error("Living photo failed to start:", (err as Error).message);
      res.status(502).json({ message: "Couldn't start that. Try again in a moment." });
    }
  });
  // How it's going: when fal has it, the video is copied to our storage and kept.
  app.get("/api/host/bio/living", requireHostSession, async (req, res) => {
    const row = await pageFor(emailOf(req));
    const photo = row.heroUrl || row.avatarUrl;
    const job = row.livingJob ? (JSON.parse(row.livingJob) as LivingJob) : null;
    // Made, and waiting to be made smaller for phones: it's already on the page.
    if (!job || job.squeeze) return res.json(row.livingUrl && row.livingFrom === photo ? { status: "done", livingUrl: row.livingUrl } : { status: "none" });
    try {
      const st = (await (await fetch(job.status!, { headers: FAL(), signal: AbortSignal.timeout(20_000) })).json().catch(() => ({}))) as { status?: string };
      if (st.status !== "COMPLETED") {
        if (Date.now() - job.at > 15 * 60_000) { await db.update(bioPages).set({ livingJob: "" }).where(eq(bioPages.id, row.id)); return res.json({ status: "failed", message: "That took too long. Try again." }); }
        return res.json({ status: "running", queued: st.status === "IN_QUEUE" });
      }
      const out = (await (await fetch(job.response!, { headers: FAL(), signal: AbortSignal.timeout(30_000) })).json().catch(() => ({}))) as { video?: { url?: string }; detail?: unknown };
      if (!out.video?.url) {
        await db.update(bioPages).set({ livingJob: "" }).where(eq(bioPages.id, row.id));
        return res.json({ status: "failed", message: "It couldn't bring that photo to life. Try a clearer photo of just you, facing the camera." });
      }
      const buf = Buffer.from(await (await fetch(out.video.url, { signal: AbortSignal.timeout(60_000) })).arrayBuffer());
      const url = await uploadShowAsset(`bio/${row.id}-living-${Date.now()}.mp4`, buf, "video/mp4");
      // On the page now; the worker makes a smaller copy for phones (720p, no sound) and swaps it in.
      const [saved] = await db.update(bioPages).set({ livingUrl: url, livingFrom: job.from, livingJob: JSON.stringify({ from: job.from, at: Date.now(), squeeze: "queued", src: url } satisfies LivingJob), updatedAt: now() }).where(eq(bioPages.id, row.id)).returning();
      res.json({ status: "done", livingUrl: url, preview: await publicOf(saved) });
    } catch (err) {
      console.error("Living photo check failed:", (err as Error).message);
      res.json({ status: "running" });
    }
  });

  // The talking intro: their profile photo saying hello, in their own recorded voice or an AI voice
  // (ElevenLabs), made to speak by Kling's avatar model on fal's queue, a few minutes. Up to 45 seconds.
  const INTRO = "fal-ai/kling-video/ai-avatar/v2/standard";
  const VOICES = INTRO_VOICES.map((v) => v.id);
  const introRuns = new Map<number, number[]>();
  app.post("/api/host/bio/intro", requireHostSession, async (req, res) => {
    const row = await pageFor(emailOf(req));
    if (!process.env.FAL_KEY) return res.status(503).json({ message: "Talking intros aren't switched on yet." });
    if (!row.avatarUrl) return res.status(400).json({ message: "Add a profile photo first: a clear one of your face works best." });
    const job = row.introJob ? (JSON.parse(row.introJob) as LivingState) : null;
    if (job && !job.squeeze && Date.now() - job.at < 20 * 60_000) return res.json({ status: "running" });
    const hits = (introRuns.get(row.id) ?? []).filter((t) => Date.now() - t < 24 * 3600_000);
    if (hits.length >= 3) return res.status(429).json({ message: "That's three today. Try again tomorrow." });
    let audio = "";
    try {
      if (req.body?.mode === "voice") {
        // Their own voice, recorded in the builder and stored with us.
        const key = String(req.body?.audioKey ?? "").replace(/^r2:/, "");
        if (!/^show-assets\/[\w.-]+$/.test(key)) return res.status(400).json({ message: "Record your hello first." });
        audio = await signedRecordingUrl(key, 6 * 3600);
      } else {
        const text = String(req.body?.script ?? "").trim().slice(0, 600);
        if (text.length < 10) return res.status(400).json({ message: "Write what you'd like to say." });
        const voice = VOICES.includes(String(req.body?.voice)) ? String(req.body.voice) : "Brian";
        const t = await fetch("https://fal.run/fal-ai/elevenlabs/tts/turbo-v2.5", { method: "POST", headers: FAL(), signal: AbortSignal.timeout(60_000), body: JSON.stringify({ text, voice, stability: 0.5, similarity_boost: 0.75, speed: 1 }) });
        const tj = (await t.json().catch(() => ({}))) as { audio?: { url?: string } };
        if (!t.ok || !tj.audio?.url) throw new Error(`tts ${t.status}`);
        audio = tj.audio.url;
      }
      introRuns.set(row.id, [...hits, Date.now()]);
      const r = await fetch(`https://queue.fal.run/${INTRO}`, {
        method: "POST", headers: FAL(), signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ image_url: row.avatarUrl, audio_url: audio, prompt: "The person speaks warmly and naturally to the camera with a friendly expression and small natural head movements." }),
      });
      const j = (await r.json().catch(() => ({}))) as { status_url?: string; response_url?: string };
      if (!r.ok || !j.status_url || !j.response_url) throw new Error(`fal ${r.status}`);
      await db.update(bioPages).set({ introJob: JSON.stringify({ status: j.status_url, response: j.response_url, from: row.avatarUrl, at: Date.now() } satisfies LivingState) }).where(eq(bioPages.id, row.id));
      res.json({ status: "running" });
    } catch (err) {
      console.error("Talking intro failed to start:", (err as Error).message);
      res.status(502).json({ message: "Couldn't start that. Try again in a moment." });
    }
  });
  app.get("/api/host/bio/intro", requireHostSession, async (req, res) => {
    const row = await pageFor(emailOf(req));
    const job = row.introJob ? (JSON.parse(row.introJob) as LivingState) : null;
    if (!job || job.squeeze) return res.json(row.introUrl ? { status: "done", livingUrl: row.introUrl } : { status: "none" });
    try {
      const st = (await (await fetch(job.status!, { headers: FAL(), signal: AbortSignal.timeout(20_000) })).json().catch(() => ({}))) as { status?: string };
      if (st.status !== "COMPLETED") {
        if (Date.now() - job.at > 20 * 60_000) { await db.update(bioPages).set({ introJob: "" }).where(eq(bioPages.id, row.id)); return res.json({ status: "failed", message: "That took too long. Try again." }); }
        return res.json({ status: "running" });
      }
      const out = (await (await fetch(job.response!, { headers: FAL(), signal: AbortSignal.timeout(30_000) })).json().catch(() => ({}))) as { video?: { url?: string } };
      if (!out.video?.url) {
        await db.update(bioPages).set({ introJob: "" }).where(eq(bioPages.id, row.id));
        return res.json({ status: "failed", message: "It couldn't make your photo talk. Try a clear photo of your face, looking at the camera." });
      }
      const buf = Buffer.from(await (await fetch(out.video.url, { signal: AbortSignal.timeout(90_000) })).arrayBuffer());
      const url = await uploadShowAsset(`bio/${row.id}-intro-${Date.now()}.mp4`, buf, "video/mp4");
      // On the page now; the worker makes a smaller copy for phones (with its sound) and swaps it in.
      const [saved] = await db.update(bioPages).set({ introUrl: url, introJob: JSON.stringify({ from: job.from, at: Date.now(), squeeze: "queued", src: url } satisfies LivingState), updatedAt: now() }).where(eq(bioPages.id, row.id)).returning();
      res.json({ status: "done", livingUrl: url, preview: await publicOf(saved) });
    } catch (err) {
      console.error("Talking intro check failed:", (err as Error).message);
      res.json({ status: "running" });
    }
  });

  // Photo fix-up: their profile or cover photo, sharper and cleaner (Topaz, faces enhanced), about 20 seconds.
  // Sent back to look at first; it becomes their photo only when they choose it.
  const fixRuns = new Map<number, number[]>();
  app.post("/api/host/bio/fixup", requireHostSession, async (req, res) => {
    const row = await pageFor(emailOf(req));
    if (!process.env.FAL_KEY) return res.status(503).json({ message: "Fix-up isn't switched on yet." });
    const kind = req.body?.kind === "hero" ? "hero" : "avatar";
    const src = kind === "hero" ? row.heroUrl : row.avatarUrl;
    if (!src) return res.status(400).json({ message: "Add a photo first." });
    const hits = (fixRuns.get(row.id) ?? []).filter((t) => Date.now() - t < 24 * 3600_000);
    if (hits.length >= 10) return res.status(429).json({ message: "That's ten today. Try again tomorrow." });
    fixRuns.set(row.id, [...hits, Date.now()]);
    try {
      const r = await fetch("https://fal.run/fal-ai/topaz/upscale/image", {
        method: "POST", headers: FAL(), signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({ image_url: src, model: "Standard V2", upscale_factor: 2, face_enhancement: true, face_enhancement_strength: 0.8, fix_compression: 0.5, denoise: 0.3, sharpen: 0.2, output_format: "jpeg" }),
      });
      const j = (await r.json().catch(() => ({}))) as { image?: { url?: string } };
      if (!r.ok || !j.image?.url) throw new Error(`fal ${r.status}`);
      const raw = Buffer.from(await (await fetch(j.image.url, { signal: AbortSignal.timeout(60_000) })).arrayBuffer());
      const img = kind === "avatar"
        ? await sharp(raw).resize(1200, 1200, { fit: "cover", position: "attention" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer()
        : await sharp(raw).resize(2400, 2400, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
      res.json({ url: await uploadPhoto(`bio/${row.id}-${kind}-fixed-${Date.now()}.jpg`, img, "image/jpeg") });
    } catch (err) {
      console.error("Fix-up failed:", (err as Error).message);
      res.status(502).json({ message: "Couldn't fix up that photo. Try again in a moment." });
    }
  });

  // Styles: their photo redrawn in another look (FLUX Kontext), the same person and pose, about 7 seconds.
  // Sent back to look at; it becomes their photo only when they choose it.
  const STYLES: Record<string, string> = {
    comic: "a bold comic book illustration with clean black ink lines, flat colours and halftone shading",
    oil: "a classic oil painting portrait with rich colour and visible brush strokes on canvas",
    cartoon: "a friendly 3D animated film character with soft studio lighting and smooth shading",
    watercolor: "a loose, bright watercolour painting on white paper with soft bleeding edges",
    sketch: "a detailed graphite pencil sketch on cream paper with cross-hatched shading",
    popart: "1960s pop art: a bold screen print with flat bright colours and thick outlines",
    anime: "a clean Japanese anime illustration with crisp line art and cel shading",
    neon: "a synthwave neon portrait with glowing magenta and cyan rim light on a dark background",
  };
  const styleRuns = new Map<number, number[]>();
  app.post("/api/host/bio/style", requireHostSession, async (req, res) => {
    const row = await pageFor(emailOf(req));
    if (!process.env.FAL_KEY) return res.status(503).json({ message: "Styles aren't switched on yet." });
    const kind = req.body?.kind === "hero" ? "hero" : "avatar";
    const key = String(req.body?.style ?? "");
    const look = STYLES[key];
    // Always from the photo they uploaded (or fixed up), never a style on a style.
    const src = String(req.body?.from ?? "") || (kind === "hero" ? row.heroUrl : row.avatarUrl);
    if (!look) return res.status(400).json({ message: "Pick a style." });
    const store = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
    const theirs = src === row.avatarUrl || src === row.heroUrl || (!!store && src.startsWith(`${store}/storage/v1/object/public/`) && src.includes(`/bio/${row.id}-`));
    if (!src || !theirs) return res.status(400).json({ message: "Add a photo first." });
    const hits = (styleRuns.get(row.id) ?? []).filter((t) => Date.now() - t < 24 * 3600_000);
    if (hits.length >= 30) return res.status(429).json({ message: "That's a lot of styles today. Try again tomorrow." });
    styleRuns.set(row.id, [...hits, Date.now()]);
    try {
      const r = await fetch("https://fal.run/fal-ai/flux-pro/kontext", {
        method: "POST", headers: FAL(), signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({ image_url: src, prompt: `Redraw this photo as ${look}. Keep the same person: their face, expression, hair, pose, clothes and framing exactly. Only change the art style.`, ...(kind === "avatar" ? { aspect_ratio: "1:1" } : {}), output_format: "jpeg", safety_tolerance: "2", num_images: 1 }),
      });
      const j = (await r.json().catch(() => ({}))) as { images?: { url?: string }[]; has_nsfw_concepts?: boolean[] };
      if (j.has_nsfw_concepts?.[0]) return res.status(400).json({ message: "Try a different photo." });
      if (!r.ok || !j.images?.[0]?.url) throw new Error(`fal ${r.status}`);
      const raw = Buffer.from(await (await fetch(j.images[0].url, { signal: AbortSignal.timeout(30_000) })).arrayBuffer());
      const img = kind === "avatar"
        ? await sharp(raw).resize(1024, 1024, { fit: "cover" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer()
        : await sharp(raw).resize(2000, 2000, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
      res.json({ url: await uploadPhoto(`bio/${row.id}-${kind}-styled-${key}-${Date.now()}.jpg`, img, "image/jpeg") });
    } catch (err) {
      console.error("Style failed:", (err as Error).message);
      res.status(502).json({ message: "Couldn't make that style. Try again in a moment." });
    }
  });

  // A scene behind their cut-out: one of ours, or one they describe. FLUX schnell, a few seconds.
  const SCENES: Record<string, string> = {
    flag: "a huge American flag waving in the wind, dramatic soft light",
    base: "a military airfield at golden hour, fighter jets far away on the runway, warm sunset sky",
    studio: "a cozy podcast studio with warm lamps, microphones and acoustic panels",
    sea: "a navy ship on a calm ocean at dusk, pink and orange sky",
    mountains: "a mountain range at dawn, pastel sky and soft morning haze",
    city: "a city skyline at night with warm glowing lights",
    beach: "a calm beach at sunset, warm golden light on the water",
    camo: "an abstract woodland camouflage pattern, soft studio light",
  };
  const sceneRuns = new Map<number, number[]>();
  app.post("/api/host/bio/scene", requireHostSession, async (req, res) => {
    const row = await pageFor(emailOf(req));
    if (!process.env.FAL_KEY) return res.status(503).json({ message: "Scenes aren't switched on yet." });
    const preset = SCENES[String(req.body?.preset ?? "")];
    const own = String(req.body?.prompt ?? "").trim().slice(0, 300);
    if (!preset && own.length < 3) return res.status(400).json({ message: "Pick a scene, or describe one." });
    const hits = (sceneRuns.get(row.id) ?? []).filter((t) => Date.now() - t < 3600_000);
    if (hits.length >= 20) return res.status(429).json({ message: "That's a lot of scenes. Try again in an hour." });
    sceneRuns.set(row.id, [...hits, Date.now()]);
    try {
      const r = await fetch("https://fal.run/fal-ai/flux/schnell", {
        method: "POST", headers: FAL(), signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({ prompt: `${preset || own}. Photorealistic background photo, no people, nothing in the middle foreground, soft depth of field, vertical composition.`, image_size: "portrait_4_3", num_images: 1, output_format: "jpeg", enable_safety_checker: true }),
      });
      const j = (await r.json().catch(() => ({}))) as { images?: { url?: string }[]; has_nsfw_concepts?: boolean[] };
      if (j.has_nsfw_concepts?.[0]) return res.status(400).json({ message: "Try describing a different scene." });
      if (!r.ok || !j.images?.[0]?.url) throw new Error(`fal ${r.status}`);
      const raw = Buffer.from(await (await fetch(j.images[0].url, { signal: AbortSignal.timeout(30_000) })).arrayBuffer());
      const jpg = await sharp(raw).resize(1080, 1440, { fit: "cover" }).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
      res.json({ url: await uploadPhoto(`bio/${row.id}-scene-${Date.now()}.jpg`, jpg) });
    } catch (err) {
      console.error("Scene failed:", (err as Error).message);
      res.status(502).json({ message: "Couldn't make that scene. Try again in a moment." });
    }
  });

  // A brand's logo from its home page: its app icon (apple-touch-icon, the biggest there is), or its site icon.
  app.get("/api/host/bio/logo", requireHostSession, async (req, res) => {
    let u: URL;
    try { u = new URL(/^https?:\/\//i.test(String(req.query.url ?? "")) ? String(req.query.url) : `https://${String(req.query.url ?? "")}`); } catch { return res.status(400).json({ message: "That isn't a web address." }); }
    const host = u.hostname.toLowerCase();
    if (!/\.[a-z]{2,}$/.test(host) || /^(localhost|.*\.local|.*\.internal)$/.test(host) || /^[\d.]+$/.test(host)) return res.status(400).json({ message: "That isn't a web address." });
    const fallback = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
    try {
      const r = await fetch(`https://${host}/`, { redirect: "follow", signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Mozilla/5.0 (compatible; MilitaryVoices logo finder)", Accept: "text/html" } });
      const html = (await r.text()).slice(0, 400_000);
      const links = Array.from(html.matchAll(/<link\b[^>]*>/gi)).map((m) => m[0]);
      const attr = (tag: string, k: string) => tag.match(new RegExp(`${k}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] ?? "";
      const icons = links
        .filter((l) => /rel\s*=\s*["'][^"']*(apple-touch-icon|icon)[^"']*["']/i.test(l) && attr(l, "href") && !/\.svg(\?|$)/i.test(attr(l, "href")))
        // Its size from sizes="180x180", or from the file's name (favicon_32x32.png).
        .map((l) => ({ href: attr(l, "href"), apple: /apple-touch-icon/i.test(attr(l, "rel")), size: Number(attr(l, "sizes").split("x")[0]) || Number(attr(l, "href").match(/(\d{2,3})x\d{2,3}/)?.[1]) || 0 }))
        .sort((a, b) => Number(b.apple) - Number(a.apple) || b.size - a.size);
      const base = r.url || `https://${host}/`;
      let best = icons[0]?.apple ? new URL(icons[0].href, base).toString() : "";
      // Most sites keep an app icon at the usual address even when the page doesn't link it.
      if (!best) {
        const touch = new URL("/apple-touch-icon.png", base).toString();
        const t = await fetch(touch, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(4000) }).catch(() => null);
        if (t?.ok && /^image\//.test(t.headers.get("content-type") ?? "")) best = touch;
      }
      // A big site icon will do; a tiny one looks worse than Google's copy of it at 128.
      if (!best && icons[0] && (icons[0].size >= 64 || (!icons[0].size && !/favicon\.ico/i.test(icons[0].href)))) best = new URL(icons[0].href, base).toString();
      res.json({ logo: /^https:\/\//.test(best) ? best : fallback });
    } catch {
      res.json({ logo: fallback });
    }
  });

  app.post("/api/host/bio/cutout", requireHostSession, async (req, res) => {
    const row = await pageFor(emailOf(req));
    if (!process.env.FAL_KEY) return res.status(503).json({ message: "Cutout isn't switched on yet." });
    // The photo the builder is showing (it may be a moment ahead of what's saved): their own photo, or this page's own copy of one.
    const store = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
    const asked = typeof req.body?.from === "string" ? req.body.from : "";
    const photo = asked && (asked === row.avatarUrl || (!!store && asked.startsWith(`${store}/storage/v1/object/public/`) && new RegExp(`/bio/${row.id}-avatar-`).test(asked))) ? asked : row.avatarUrl;
    if (!photo) return res.status(400).json({ message: "Add a profile photo first." });
    if (row.cutoutUrl && row.cutoutFrom === photo) return res.json({ cutoutUrl: row.cutoutUrl, cutoutFrom: photo, preview: await publicOf(row) });
    const hits = (cutting.get(row.id) ?? []).filter((t) => Date.now() - t < 3600_000);
    if (hits.length >= 10) return res.status(429).json({ message: "That's a lot of cutouts. Try again in an hour." });
    cutting.set(row.id, [...hits, Date.now()]);
    try {
      const r = await fetch("https://fal.run/fal-ai/birefnet/v2", {
        method: "POST",
        headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: photo, model: "Portrait", output_format: "png", operating_resolution: "1024x1024" }),
        signal: AbortSignal.timeout(60_000),
      });
      const j = (await r.json().catch(() => ({}))) as { image?: { url?: string } };
      if (!r.ok || !j.image?.url) throw new Error(`fal ${r.status}`);
      const raw = Buffer.from(await (await fetch(j.image.url, { signal: AbortSignal.timeout(30_000) })).arrayBuffer());
      // Trimmed to the person, so they stand on the foot of the header.
      const png = await sharp(raw).trim({ threshold: 1 }).resize(1200, 1200, { fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
      const url = await uploadPhoto(`bio/${row.id}-cutout-${Date.now()}.png`, png, "image/png");
      const [out] = await db.update(bioPages).set({ cutoutUrl: url, cutoutFrom: row.avatarUrl, updatedAt: now() }).where(eq(bioPages.id, row.id)).returning();
      res.json({ cutoutUrl: url, preview: await publicOf(out) });
    } catch (err) {
      console.error("Cutout failed:", (err as Error).message);
      res.status(502).json({ message: "Couldn't cut out that photo. Try a clearer one of just you." });
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
  app.get("/:handle/brands", async (req, res, next) => {
    const ua = String(req.get("user-agent") ?? "");
    const h = String(req.params.handle).toLowerCase();
    if (!PREVIEW_BOT.test(ua) || !handleOk(h)) return next();
    const [row] = await db.select().from(bioPages).where(eq(bioPages.handle, h)).limit(1);
    if (!row || !row.published) return next();
    const origin = `https://${req.get("host")}`;
    const kit = parseBrands(row.brands);
    const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const title = `Sponsor ${row.displayName || row.handle}`;
    const desc = (kit.pitch || row.bio || `Media kit for ${row.displayName || row.handle}: downloads, reach and rates.`).replace(/\s+/g, " ").replace(/\*\*|__|\*/g, "").slice(0, 280);
    const url = `${origin}/${row.handle}/brands`;
    const img = `${origin}/og/bio/${row.handle}.jpg?v=${encodeURIComponent((row.updatedAt || row.createdAt).slice(0, 16))}`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=600");
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${esc(title)}</title><meta name="description" content="${esc(desc)}" /><meta property="og:type" content="profile" /><meta property="og:site_name" content="MilitaryVoices.ai" /><meta property="og:title" content="${esc(title)}" /><meta property="og:description" content="${esc(desc)}" /><meta property="og:url" content="${url}" /><meta property="og:image" content="${img}" /><meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${esc(title)}" /><meta name="twitter:description" content="${esc(desc)}" /><meta name="twitter:image" content="${img}" /><link rel="canonical" href="${url}" /></head><body><h1>${esc(title)}</h1><p>${esc(desc)}</p></body></html>`);
  });

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
    const desc = (row.bio || (pod ? `Listen to ${pod.title}: the latest episodes, and ask the show a question.` : `${title} on MilitaryVoices.ai.`)).replace(/\s+/g, " ").replace(/\*\*|__|\*/g, "").slice(0, 280);
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

  // The Family view: only with the private key, never cached by anyone in between, never indexed.
  app.get("/api/public/bio/:handle/family/:key", async (req, res) => {
    await schemaIsReady();
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    const [row] = await db.select().from(bioPages).where(eq(bioPages.handle, String(req.params.handle).toLowerCase())).limit(1);
    const f = row ? parseFamily(row.family) : null;
    const given = Buffer.from(String(req.params.key));
    const ok = Boolean(row && row.published && f?.on && f.key && given.length === Buffer.from(f.key).length && crypto.timingSafeEqual(given, Buffer.from(f.key)));
    if (!ok) return res.status(404).json({ message: "This link isn't working. Ask for a new one." });
    res.json(await familyPublicOf(row!, f!));
  });

  // The Brands view: the media kit, with the numbers we measure.
  app.get("/api/public/bio/:handle/brands", async (req, res) => {
    await schemaIsReady();
    const [row] = await db.select().from(bioPages).where(eq(bioPages.handle, String(req.params.handle).toLowerCase())).limit(1);
    if (!row || !row.published || !parseBrands(row.brands).on) return res.status(404).json({ message: "No media kit here." });
    res.setHeader("Cache-Control", "public, max-age=120, s-maxage=300");
    res.json(await brandsOf(row));
  });

  // A brand asks to sponsor the show: into the sponsor inquiries, and to our partnerships team.
  const sponsorHits = new Map<string, number[]>();
  app.post("/api/public/bio/:handle/sponsor", async (req, res) => {
    const [row] = await db.select().from(bioPages).where(eq(bioPages.handle, String(req.params.handle).toLowerCase())).limit(1);
    if (!row || !row.published || !parseBrands(row.brands).on) return res.status(404).json({ message: "No media kit here." });
    const ip = String(req.ip ?? "");
    const hits = (sponsorHits.get(ip) ?? []).filter((t) => Date.now() - t < 3600_000);
    if (hits.length >= 5) return res.status(429).json({ message: "Thanks, we have your note. Try again later if you need to add something." });
    sponsorHits.set(ip, [...hits, Date.now()]);
    if (str(req.body?.website, 100)) return res.json({ ok: true }); // a bot filled the hidden field
    const name = str(req.body?.name, 80).trim();
    const company = str(req.body?.company, 120).trim();
    const email = str(req.body?.email, 200).trim();
    const budget = str(req.body?.budget, 40).trim();
    const message = str(req.body?.message, 2000).trim();
    if (!name) return res.status(400).json({ message: "Tell us your name." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ message: "That email doesn't look right." });
    const show = row.displayName || row.handle;
    const body = [`Wants to sponsor: ${show} (${ORIGIN}/${row.handle})`, budget ? `Budget: ${budget}` : "", message].filter(Boolean).join("\n\n");
    await storage.createSponsorInquiry({ name, company, title: "", email, phone: "", message: body, packageId: 0, packageName: `Show: ${show}` });
    await db.insert(bioEvents).values({ pageId: row.id, kind: "sponsor", label: company || name, day: now().slice(0, 10), createdAt: now() }).catch(() => {});
    try {
      const admins = await storage.listAdmins();
      await sendSponsorInquiryEmail({ to: admins.map((a) => a.email), name, company, email, phone: "", message: body });
    } catch (err) {
      console.error("Brand inquiry email failed:", (err as Error).message);
    }
    res.json({ ok: true });
  });

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
  // Stay in touch: a listener's email, into the podcaster's Contacts (once per page).
  const joins = new Map<string, number[]>();
  app.post("/api/public/bio/:handle/subscribe", async (req, res) => {
    await schemaIsReady();
    const [row] = await db.select().from(bioPages).where(eq(bioPages.handle, String(req.params.handle).toLowerCase())).limit(1);
    if (!row || !row.published || !(parseSections(row.sections).some((x) => x.type === "signup" && x.visible) || parseTheme(row.theme).popup?.kind === "email")) return res.status(404).json({ message: "Sign-ups are off for this page." });
    const ip = String(req.ip ?? "");
    const hits = (joins.get(ip) ?? []).filter((t) => Date.now() - t < 3600_000);
    if (hits.length >= 10) return res.status(429).json({ message: "Try again in a little while." });
    joins.set(ip, [...hits, Date.now()]);
    if (str(req.body?.website, 100)) return res.json({ ok: true }); // a bot filled the hidden field
    const email = str(req.body?.email, 200).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ message: "That email doesn't look right." });
    await db.insert(bioSubscribers).values({ pageId: row.id, email, name: str(req.body?.name, 80).trim(), createdAt: now() }).onConflictDoNothing();
    await db.insert(bioEvents).values({ pageId: row.id, kind: "click", label: "Stay in touch", day: now().slice(0, 10), createdAt: now() }).catch(() => {});
    res.json({ ok: true });
  });

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
