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
import { emailShell, EMAIL_BANNERS, sendOneOffEmail } from "./email.js";
import { uploadPhoto } from "./photoStorage.js";
import { signedRecordingUrl } from "./recordingStorage.js";
import { bioPages, clips, discoveryCache, hostedShows, magazineAds, magazinePages, podcasterProfiles, recordings, segmentCuts, signups, sponsors } from "../shared/schema.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const now = () => new Date().toISOString();
/** The row that says the magazine is out: until then only admins can open it. */
const PUBLISHED = -1;
const WELCOME = 0;
/** When the magazine went out to the podcasters (blurb: JSON {at, sent}), so it isn't sent twice. */
const DISTRIBUTED = -3;
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

const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["the", "podcast", "show", "with", "and"].includes(w)));

/**
 * A show's feed when what we were given isn't one (a StreamYard or Spotify link, or nothing): Apple
 * Podcasts' directory, searched by the show's name, kept only when the name matches closely and
 * the host's surname is on it, so we never play somebody else's show.
 */
async function findFeed(show: string, host: string): Promise<string> {
  const term = show.split(/[:|]/)[0].trim();
  const r = (await (await fetch(`https://itunes.apple.com/search?media=podcast&entity=podcast&limit=8&term=${encodeURIComponent(term)}`, { signal: AbortSignal.timeout(5_000) })).json()) as { results?: { collectionName?: string; artistName?: string; feedUrl?: string }[] };
  const want = words(term);
  const whole = words(show);
  const surname = host.trim().split(/\s+/).pop()?.toLowerCase() ?? "";
  for (const c of r.results ?? []) {
    const got = words(c.collectionName ?? "");
    const shared = Array.from(want).filter((w) => got.has(w)).length;
    // Exactly their show's name (nothing in it that isn't in ours), or most of it with the host's surname on it.
    const same = want.size > 0 && shared === want.size && Array.from(got).every((w) => whole.has(w));
    const theirs = surname.length > 2 && `${c.artistName ?? ""} ${c.collectionName ?? ""}`.toLowerCase().includes(surname);
    if (c.feedUrl && (same || (theirs && shared / Math.max(want.size, 1) >= 0.75))) return c.feedUrl;
  }
  return "";
}

/** A show's newest few episodes, from its feed (an Apple Podcasts page is looked up to its feed first). */
async function recentEpisodes(raw: string, show = "", host = ""): Promise<Episode[]> {
  try {
    let feed = raw.trim();
    const appleId = /podcasts\.apple\.com\/.*\/id(\d+)/i.exec(feed)?.[1];
    if (appleId) feed = ((await (await fetch(`https://itunes.apple.com/lookup?id=${appleId}&entity=podcast`, { signal: AbortSignal.timeout(5_000) })).json()) as { results?: { feedUrl?: string }[] }).results?.[0]?.feedUrl ?? "";
    else if (!/^https?:\/\//i.test(feed) || /streamyard\.com|spotify\.com|youtube\.com|youtu\.be|\/episodes\/?$/i.test(feed)) feed = show ? await findFeed(show, host) : "";
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
async function episodesFor(eventId: number, lineup: { id: number; rssUrl: string; show: string; host: string }[]): Promise<Record<number, Episode[]>> {
  const key = `mag:episodes3:${eventId}`;
  const [row] = await db.select().from(discoveryCache).where(eq(discoveryCache.key, key));
  const have = row ? (JSON.parse(row.payload) as Record<number, Episode[]>) : {};
  const fresh = row && Date.now() - Date.parse(row.createdAt) < 12 * 3600_000;
  if (fresh && lineup.every((s) => s.id in have)) return have;
  const got = await Promise.all(lineup.map(async (s) => [s.id, await recentEpisodes(s.rssUrl, s.show, s.host)] as const));
  // A feed that didn't answer this time keeps what it had.
  const next: Record<number, Episode[]> = Object.fromEntries(got.map(([id, eps]) => [id, eps.length ? eps : have[id] ?? []]));
  const payload = JSON.stringify(next);
  const createdAt = now();
  await db.insert(discoveryCache).values({ key, payload, createdAt }).onConflictDoUpdate({ target: discoveryCache.key, set: { payload, createdAt } });
  return next;
}

// ---------------------------------------------------------------------------
// Each show's segment, cut from the day's recording
// ---------------------------------------------------------------------------

/** A show's on-air minutes, from the slot times (the buffer before or after, as the event runs it). */
function onAir(ev: { startAtUtc: string; slotMinutes: number; onAirMinutes: number; bufferMinutes: number; bufferPosition: string }, slotIndex: number) {
  const block = Date.parse(ev.startAtUtc) + slotIndex * ev.slotMinutes * 60_000;
  const start = ev.bufferPosition === "before" ? block + ev.bufferMinutes * 60_000 : block;
  return { start, end: start + ev.onAirMinutes * 60_000 };
}

/** A little either side, so a show that starts early or runs over isn't clipped mid-word. */
const MARGIN_MS = 45_000;

/**
 * Work out every show's segment from the event's finished recordings and queue the cuts the
 * worker hasn't made yet. Safe to run again: a cut already made from the same place is kept.
 */
export async function planSegments(eventId: number): Promise<{ queued: number; kept: number; notRecorded: string[] }> {
  await schemaIsReady();
  const ev = await storage.getEventById(eventId);
  if (!ev) return { queued: 0, kept: 0, notRecorded: [] };
  const recs = (await db.select().from(recordings).where(and(eq(recordings.eventId, eventId), eq(recordings.status, "Ready"))))
    .filter((r) => r.url && r.durationSec > 0)
    .map((r) => ({ id: r.id, from: Date.parse(r.startedAt), to: Date.parse(r.startedAt) + r.durationSec * 1000 }));
  const lineup = await db.select().from(signups).where(and(eq(signups.eventId, eventId), ne(signups.status, "cancelled")));
  const have = await db.select().from(segmentCuts).where(eq(segmentCuts.eventId, eventId));
  let queued = 0;
  let kept = 0;
  const notRecorded: string[] = [];
  for (const s of lineup) {
    const w = onAir(ev as never, s.slotIndex);
    const want = { from: w.start - MARGIN_MS, to: w.end + MARGIN_MS };
    // The recording that holds the most of it (a restart mid-day leaves two files).
    const best = recs
      .map((r) => ({ r, overlap: Math.min(r.to, want.to) - Math.max(r.from, want.from) }))
      .sort((a, b) => b.overlap - a.overlap)[0];
    if (!best || best.overlap < 5 * 60_000) { notRecorded.push(s.podcastName); continue; }
    const startSec = Math.max(0, Math.round((Math.max(want.from, best.r.from) - best.r.from) / 1000));
    const durationSec = Math.round(best.overlap / 1000);
    const prior = have.find((c) => c.signupId === s.id);
    if (prior && prior.recordingId === best.r.id && Math.abs(prior.startSec - startSec) < 5 && prior.status !== "failed") { kept++; continue; }
    await db.insert(segmentCuts).values({ eventId, signupId: s.id, recordingId: best.r.id, startSec, durationSec, status: "queued", audioKey: "", error: "", claimedAt: "", updatedAt: now() })
      .onConflictDoUpdate({ target: [segmentCuts.eventId, segmentCuts.signupId], set: { recordingId: best.r.id, startSec, durationSec, status: "queued", audioKey: "", error: "", claimedAt: "", updatedAt: now() } });
    queued++;
  }
  return { queued, kept, notRecorded };
}

/** The next cut for the worker (or one a worker took and went quiet on for half an hour). */
export async function claimSegmentCut(): Promise<{ id: number; title: string; startSec: number; durationSec: number; downloadUrl: string } | null> {
  await schemaIsReady();
  const stale = new Date(Date.now() - 30 * 60_000).toISOString();
  const [c] = (await db.select().from(segmentCuts).where(inArray(segmentCuts.status, ["queued", "claimed"])))
    .filter((x) => x.status === "queued" || x.claimedAt < stale)
    .sort((a, b) => a.id - b.id);
  if (!c) return null;
  const [took] = await db.update(segmentCuts).set({ status: "claimed", claimedAt: now(), updatedAt: now() })
    .where(and(eq(segmentCuts.id, c.id), eq(segmentCuts.status, c.status), eq(segmentCuts.claimedAt, c.claimedAt))).returning();
  if (!took) return null;
  const [rec] = await db.select().from(recordings).where(eq(recordings.id, c.recordingId));
  const [sg] = await db.select().from(signups).where(eq(signups.id, c.signupId));
  const downloadUrl = !rec?.url ? "" : /^https?:\/\//i.test(rec.url) ? rec.url : await signedRecordingUrl(rec.url, 6 * 3600).catch(() => "");
  if (!downloadUrl) {
    await db.update(segmentCuts).set({ status: "failed", error: "The day's recording couldn't be opened.", updatedAt: now() }).where(eq(segmentCuts.id, c.id));
    return null;
  }
  return { id: c.id, title: sg?.podcastName ?? `Segment ${c.id}`, startSec: c.startSec, durationSec: c.durationSec, downloadUrl };
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
  const cuts = await db.select().from(segmentCuts).where(eq(segmentCuts.eventId, eventId));
  const episodes = await episodesFor(eventId, lineup.filter((s) => !out.has(s.id) && !/ceremon/i.test(s.podcastName)).map((s) => ({ id: s.id, rssUrl: s.rssUrl ?? "", show: s.podcastName, host: s.hostName }))).catch(() => ({} as Record<number, Episode[]>));
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
      about: w?.about ? w.about : clean(bio?.bio, 650),
      aboutOwn: w?.about ?? "",
      // Their segment: one set by hand, else the one cut from the day's recording.
      audio: w?.audio || (cuts.some((c) => c.signupId === s.id && c.status === "done") ? `${ORIGIN}/api/magazine/segment/${s.id}` : ""),
      episodes: episodes[s.id] ?? [],
      links: (() => { try { return w?.links ? (JSON.parse(w.links) as { title: string; url: string }[]) : []; } catch { return []; } })(),
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
    distributed: (() => { try { return JSON.parse(words.find((x) => x.signupId === DISTRIBUTED)?.blurb || "null") as { at: string; sent: number } | null; } catch { return null; } })(),
    welcome: words.find((x) => x.signupId === WELCOME)?.blurb ?? "",
    host: { name: "Riccoh Player", title: "USMC (Ret.) · Host", photo: riccoh?.photoOriginalUrl || riccoh?.photoUrl || "" },
    shows,
    /** Left out by an admin (listed for admin only, so they can be put back). */
    leftOut: lineup.filter((s) => out.has(s.id)).map((s) => ({ signupId: s.id, podcastName: s.podcastName, hostName: s.hostName })),
    sponsors: sponsorRows.map((r) => ({ name: r.name, logo: r.logoUrl, url: r.url })),
    cover: { photo: words.find((x) => x.signupId === COVER)?.art ?? "", style: words.find((x) => x.signupId === COVER)?.quote ?? "" },
    segments: { done: cuts.filter((c) => c.status === "done").length, working: cuts.filter((c) => c.status === "queued" || c.status === "claimed").length, failed: cuts.filter((c) => c.status === "failed").length },
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

async function saveWords(eventId: number, signupId: number, patch: Partial<{ blurb: string; quote: string; art: string; edited: boolean; hidden: boolean; audio: string; about: string; links: string }>) {
  await db.insert(magazinePages).values({ eventId, signupId, blurb: patch.blurb ?? "", quote: patch.quote ?? "", art: patch.art ?? "", edited: patch.edited ?? false, hidden: patch.hidden ?? false, audio: patch.audio ?? "", about: patch.about ?? "", links: patch.links ?? "", updatedAt: now() })
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

export function registerMagazine(app: Express, requireAdmin: RequestHandler, requireAgent: RequestHandler) {
  /** A show's segment from the day, to play: a fresh link to the MP3 each time. */
  app.get("/api/magazine/segment/:signupId", async (req, res) => {
    await schemaIsReady();
    const [c] = await db.select().from(segmentCuts).where(and(eq(segmentCuts.signupId, Number(req.params.signupId)), eq(segmentCuts.status, "done")));
    if (!c?.audioKey) return res.status(404).end();
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, await signedRecordingUrl(c.audioKey, 6 * 3600));
  });

  /** Cut every show's segment from the day's recording (it also runs by itself when a recording finishes). */
  app.post("/api/admin/magazine/:eventId/segments", requireAdmin, async (req, res) => {
    res.json(await planSegments(Number(req.params.eventId)));
  });

  app.post("/api/agent/segment-cuts/:id/done", requireAgent, async (req, res) => {
    const key = String(req.body?.audioKey ?? "");
    if (!/^clean\/[\w.-]+$/.test(key)) return res.status(400).json({ message: "No audio." });
    await db.update(segmentCuts).set({ status: "done", audioKey: key, error: "", ...(Number(req.body?.durationSec) > 0 ? { durationSec: Math.round(Number(req.body.durationSec)) } : {}), updatedAt: now() }).where(eq(segmentCuts.id, Number(req.params.id)));
    res.json({ ok: true });
  });
  app.post("/api/agent/segment-cuts/:id/failed", requireAgent, async (req, res) => {
    const requeue = req.body?.requeue === true;
    await db.update(segmentCuts).set(requeue ? { status: "queued", claimedAt: "", updatedAt: now() } : { status: "failed", error: String(req.body?.error ?? "").slice(0, 300), updatedAt: now() }).where(eq(segmentCuts.id, Number(req.params.id)));
    res.json({ ok: true });
  });

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
      ...(typeof req.body?.about === "string" ? { about: req.body.about.trim().slice(0, 900) } : {}),
      // "Title | link", one a line (a bare link is its own title).
      ...(typeof req.body?.links === "string" ? { links: JSON.stringify(req.body.links.split("\n").map((l: string) => {
        const m = /^(.*?)\s*\|\s*(https?:\/\/\S+)\s*$/.exec(l.trim()) ?? /^()(https?:\/\/\S+)$/.exec(l.trim());
        return m ? { title: (m[1] || m[2]).slice(0, 140), url: m[2].slice(0, 600) } : null;
      }).filter(Boolean).slice(0, 6)) } : {}),
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
    await saveWords(Number(req.params.eventId), COVER, { art, quote: "photo" });
    res.json({ ok: true, photo: art, width: meta.width ?? 0, height: meta.height ?? 0 });
  });
  /** Which cover: a collage style ("glass", "medallion", "prints") or "photo". Kept in the cover row's quote field. */
  app.put("/api/admin/magazine/:eventId/cover-style", requireAdmin, async (req, res) => {
    const style = ["glass", "medallion", "prints", "letters", "photo"].includes(String(req.body?.style)) ? String(req.body.style) : "";
    if (!style) return res.status(400).json({ message: "Which cover?" });
    await saveWords(Number(req.params.eventId), COVER, { quote: style });
    res.json({ ok: true, style });
  });
  app.delete("/api/admin/magazine/:eventId/cover", requireAdmin, async (req, res) => {
    await db.delete(magazinePages).where(and(eq(magazinePages.eventId, Number(req.params.eventId)), eq(magazinePages.signupId, COVER)));
    res.json({ ok: true });
  });

  /**
   * Distribute: publish the magazine and email every podcaster on it (and their co-host) from
   * Riccoh, each with a link straight to their own page. { test: true } sends one sample to the
   * admin pressing the button. Sends once; { again: true } to send a second time on purpose.
   */
  app.post("/api/admin/magazine/:eventId/distribute", requireAdmin, async (req, res) => {
    const eventId = Number(req.params.eventId);
    const m = await buildMagazine(eventId);
    if (!m) return res.status(404).json({ message: "No such magazine." });
    const ev = await storage.getEventById(eventId);
    const base = `${ORIGIN}/magazine${ev?.slug ? `/${encodeURIComponent(ev.slug)}` : ""}`;
    const lineup = await db.select().from(signups).where(and(eq(signups.eventId, eventId), ne(signups.status, "cancelled")));
    const riccoh = "riccoh.player@drphil.tv";
    // Everyone with a page (not the ceremonies), once each; a co-host gets their own copy.
    const people = new Map<string, { first: string; show: string; signupId: number }>();
    for (const s of m.shows) {
      if (/ceremon/i.test(s.podcastName)) continue;
      const sg = lineup.find((x) => x.id === s.signupId);
      for (const email of [sg?.email, sg?.coHostEmail].map((e) => (e ?? "").trim().toLowerCase()).filter((e) => /@/.test(e) && e !== riccoh)) {
        if (!people.has(email)) people.set(email, { first: email === sg?.email.trim().toLowerCase() ? s.hostName : "", show: s.podcastName, signupId: s.signupId });
      }
    }
    const firstName = (n: string) => n.replace(/^(dr|mr|mrs|ms|sgt|sergeant major)\.?\s+(\(ret\.\)\s+)?/i, "").trim().split(/\s+/)[0] || "there";
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const subject = "Your page in the Podcast Marathon keepsake magazine";
    const letter = (p: { first: string; show: string; signupId: number }) => {
      const link = `${base}#show-${p.signupId}`;
      const hi = p.first ? firstName(p.first) : "there";
      const text = `Hi ${hi},

The keepsake magazine from the Podcast Marathon is out, and ${p.show} has its own page in it: your photo, a few words about the show, and your latest episodes, which play right from the page.

See your page: ${link}

It's a keepsake of everyone who was part of National Military Podcast Day. Share your page with your listeners, and flip through the other shows while you're there.

Thank you for being part of the day.

Riccoh`;
      const html = emailShell({
        banner: EMAIL_BANNERS.podcasters,
        eyebrow: "The Podcast Marathon · keepsake magazine",
        heading: "Your page in the magazine",
        body: `<p>Hi ${esc(hi)},</p>
<p>The keepsake magazine from the Podcast Marathon is out, and <strong>${esc(p.show)}</strong> has its own page in it: your photo, a few words about the show, and your latest episodes, which play right from the page.</p>
<p>It's a keepsake of everyone who was part of National Military Podcast Day. Share your page with your listeners, and flip through the other shows while you're there.</p>
<p>Thank you for being part of the day.</p>
<p>Riccoh</p>`,
        cta: { href: link, label: "See your page" },
      });
      return { text, html };
    };

    if (req.body?.test === true) {
      const me = (getAdminEmail(req) ?? "").trim().toLowerCase();
      const sample = Array.from(people.values())[0];
      if (!me || !sample) return res.status(400).json({ message: "Nothing to send a test of." });
      const { text, html } = letter(sample);
      const id = await sendOneOffEmail({ kind: "magazine-test", to: me, subject: `[Test] ${subject}`, html, text });
      if (!id) return res.status(502).json({ message: "The mail provider didn't accept it." });
      return res.json({ ok: true, test: true, to: me, recipients: people.size });
    }

    if (m.distributed && req.body?.again !== true) return res.status(409).json({ message: `Already sent to ${m.distributed.sent} on ${new Date(m.distributed.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.` });
    // The link has to work when they click it.
    await saveWords(eventId, PUBLISHED, { blurb: "published" });
    let sent = 0;
    const failed: string[] = [];
    for (const [email, p] of Array.from(people.entries())) {
      const { text, html } = letter(p);
      const id = await sendOneOffEmail({ kind: "magazine", to: email, subject, html, text }).catch(() => null);
      if (id) {
        sent++;
        await storage.recordOneOffSend({ eventId, subject, bodyText: text, sender: "member:1", banner: "podcasters", email, resendId: id }).catch(() => {});
      } else failed.push(email);
      // The mail provider takes a couple a second.
      await new Promise((r) => setTimeout(r, 550));
    }
    await saveWords(eventId, DISTRIBUTED, { blurb: JSON.stringify({ at: now(), sent }) });
    res.json({ ok: true, sent, failed });
  });

  /** Out to the world, or back to admins only. */
  app.post("/api/admin/magazine/:eventId/publish", requireAdmin, async (req, res) => {
    const eventId = Number(req.params.eventId);
    if (req.body?.published === false) await db.delete(magazinePages).where(and(eq(magazinePages.eventId, eventId), eq(magazinePages.signupId, PUBLISHED)));
    else await saveWords(eventId, PUBLISHED, { blurb: "published" });
    res.json({ ok: true, published: req.body?.published !== false });
  });
}
