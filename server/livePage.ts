// Your MilitaryVoices live page (Andrew, 22 Nov 2026: "Going live on their MilitaryVoices web page. They would toggle that
// on"; the one-place Live settings mockup OK'd: "Yes, build it"). militaryvoices.ai/<handle>/live plays whatever the
// podcaster has live right now: their studio's show (pressing Go live) or a stream they send in from StreamYard,
// Restream or OBS. Viewers join the LiveKit room hidden and subscribe-only, so the page costs nothing until someone
// watches, and the studio picture is the same one the recorder films.
import type { Express, RequestHandler } from "express";
import crypto from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import { eq } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { freeHandle, slugify, podcastFor } from "./bioPage.js";
import { getSessionEmail } from "./session.js";
import { isLiveKitConfigured, publicLiveKitUrl } from "./livekit.js";
import { roomLookKey } from "./roomKit.js";
import { bioPages, personalStudios, streamKeys, watchPages, type BioPageRow } from "../shared/schema.js";
import { ownHlsBase, ownWatchOn, watchIdKey } from "./streamIn.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const norm = (e: string) => e.trim().toLowerCase();

/** The live page is on unless they switched it off. */
export async function livePageOn(email: string): Promise<boolean> {
  return (await storage.getSetting(`live-page:${norm(email)}`).catch(() => null)) !== "0";
}
/** Streaming in also goes live (their page, and on to YouTube and their other keys) unless they switched it off. */
export async function streamInOutOn(email: string): Promise<boolean> {
  return (await storage.getSetting(`streamin:out:${norm(email)}`).catch(() => null)) !== "0";
}

/**
 * Where their live page lives: their SmartLink's handle (on or off: the handle is theirs either way), else their own
 * watch address, made here the first time it's asked for (Andrew, 25 Nov 2026: "We should automatically have a web
 * page, regardless of whether they have a podcast or not"). Making one never makes a SmartLink.
 */
export async function liveHandleOf(email: string, make = true): Promise<string> {
  const e = norm(email);
  if (!e) return "";
  await schemaIsReady();
  const [bio] = await db.select({ handle: bioPages.handle }).from(bioPages).where(eq(bioPages.email, e)).limit(1);
  if (bio?.handle) return bio.handle;
  const [w] = await db.select({ handle: watchPages.handle }).from(watchPages).where(eq(watchPages.email, e)).limit(1);
  if (w?.handle || !make) return w?.handle ?? "";
  const p = await storage.getProfileByEmail(e).catch(() => undefined);
  for (let i = 0; i < 3; i++) {
    const handle = await freeHandle(slugify(p?.hostName || p?.podcastName || e.split("@")[0]));
    const [made] = await db.insert(watchPages).values({ email: e, handle, createdAt: new Date().toISOString() }).onConflictDoNothing().returning();
    if (made) return made.handle;
    const [again] = await db.select({ handle: watchPages.handle }).from(watchPages).where(eq(watchPages.email, e)).limit(1);
    if (again) return again.handle; // a second request made it first
  }
  return "";
}
/** Their picture for the live page: their SmartLink's, else their profile photo. Empty when there's none. */
export async function livePhotoOf(email: string): Promise<string> {
  const [row] = await db.select({ avatarUrl: bioPages.avatarUrl }).from(bioPages).where(eq(bioPages.email, norm(email))).limit(1);
  if (row?.avatarUrl) return row.avatarUrl;
  return (await storage.getProfileByEmail(norm(email)).catch(() => undefined))?.photoUrl || "";
}
export const liveUrlOf = (handle: string) => (handle ? `${ORIGIN}/${handle}/live` : "");

/** A hidden, watch-only seat in a room: never drawn, never heard, never counted as a person. */
async function viewerToken(room: string): Promise<string> {
  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: `viewer-${crypto.randomBytes(6).toString("hex")}`,
    name: "Viewer",
    ttl: "4h",
  });
  at.addGrant({ room, roomJoin: true, canPublish: false, canSubscribe: true, canPublishData: false, hidden: true });
  return at.toJwt();
}

export type LiveNow =
  | { kind: "studio"; since: string; url: string; token: string; lookKey: string; studioId: number }
  | { kind: "stream"; since: string; url: string; token: string }
  /** A stream sent in to our own box: its watch relay, played as HLS (no LiveKit seat). */
  | { kind: "hls"; since: string; src: string };

/** What's live for this person right now, if anything (stream in first: it's what they're sending us this minute). */
async function liveNowFor(email: string, withToken: boolean): Promise<LiveNow | null> {
  if (!isLiveKitConfigured()) return null;
  const [k] = await db.select().from(streamKeys).where(eq(streamKeys.ownerEmail, email)).limit(1);
  if (k && k.engine === "livekit" && k.room && k.status === "live" && k.egressId && k.egressId !== "pending" && (await streamInOutOn(email))) {
    return { kind: "stream", since: k.liveSince, url: publicLiveKitUrl(), token: withToken ? await viewerToken(k.room) : "" };
  }
  if (k && k.engine === "own" && k.status === "live" && (await ownWatchOn()) && (await streamInOutOn(email))) {
    const id = await storage.getSetting(watchIdKey(k.id)).catch(() => null);
    if (id) return { kind: "hls", since: k.liveSince, src: `${await ownHlsBase()}/w/${id}/index.m3u8` };
  }
  const [s] = await db.select().from(personalStudios).where(eq(personalStudios.ownerEmail, email)).limit(1);
  if (s?.liveEgressId) {
    return { kind: "studio", since: s.liveSince, url: publicLiveKitUrl(), token: withToken ? await viewerToken(`my-${s.id}`) : "", lookKey: roomLookKey(s.id), studioId: s.id };
  }
  return null;
}

type PageAt = { email: string; handle: string; name: string; photo: string; bio: BioPageRow | null; moved?: string };

/** Whose live page a handle is: a SmartLink's (on or off), else a watch address. */
async function pageAt(h: string): Promise<PageAt | null> {
  const [row] = await db.select().from(bioPages).where(eq(bioPages.handle, h)).limit(1);
  if (row) {
    const email = norm(row.email);
    const p = row.displayName && row.avatarUrl ? undefined : await storage.getProfileByEmail(email).catch(() => undefined);
    return { email, handle: row.handle, name: row.displayName || p?.hostName || p?.podcastName || row.handle, photo: row.avatarUrl || p?.photoUrl || "", bio: row };
  }
  const [w] = await db.select().from(watchPages).where(eq(watchPages.handle, h)).limit(1);
  if (!w) return null;
  const email = norm(w.email);
  const [bio] = await db.select().from(bioPages).where(eq(bioPages.email, email)).limit(1);
  if (bio && bio.handle !== w.handle) return { email, handle: w.handle, name: "", photo: "", bio, moved: bio.handle };
  const p = await storage.getProfileByEmail(email).catch(() => undefined);
  return { email, handle: w.handle, name: p?.hostName || p?.podcastName || w.handle, photo: p?.photoUrl || "", bio: null };
}

/** Their podcast for the card under the player: the SmartLink's pick, else the first show hosted here, else their feed. */
async function showCardOf(email: string, bio: BioPageRow | null): Promise<{ title: string; artworkUrl: string; url: string; latest: string } | null> {
  let row = bio;
  if (!row) {
    const p = await storage.getProfileByEmail(email).catch(() => undefined);
    row = { email, theme: "", rssUrl: p?.rssUrl || "" } as BioPageRow;
  }
  const pod = await podcastFor(row);
  if (!pod) return null;
  return { title: pod.title, artworkUrl: pod.artworkUrl, url: (bio?.published ? `${ORIGIN}/${bio.handle}` : "") || pod.pageUrl || "", latest: pod.episodes[0]?.title ?? "" };
}

export function registerLivePage(app: Express, requireHostSession: RequestHandler): void {
  /** The public page's data: who it is, and their show if it's live (with a watch-only seat). Polled every 20 s. */
  app.get("/api/live/:handle", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await schemaIsReady();
    const h = String(req.params.handle ?? "").toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,60}$/.test(h)) return res.status(404).json({ message: "No such page." });
    const page = await pageAt(h);
    if (!page) return res.status(404).json({ message: "No such page." });
    // An old watch address whose owner has since made a SmartLink under another handle: send them on.
    if (page.moved) return res.json({ moved: page.moved });
    const email = page.email;
    const on = await livePageOn(email);
    const live = on ? await liveNowFor(email, true).catch(() => null) : null;
    res.json({
      handle: page.handle, name: page.name, photo: page.photo, on, live,
      /** Their SmartLink, when it's on: the live page links back to it. */
      smartLink: page.bio?.published ? page.bio.handle : "",
      podcast: on ? await showCardOf(email, page.bio).catch(() => null) : null,
    });
  });

  /** Their switch, and where the page is. */
  app.get("/api/host/live-page", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const email = norm(getSessionEmail(req) ?? "");
    const handle = await liveHandleOf(email);
    res.json({ on: await livePageOn(email), url: liveUrlOf(handle), handle, photo: await livePhotoOf(email).catch(() => ""), streamInOut: await streamInOutOn(email), live: !!(await liveNowFor(email, false).catch(() => null)) });
  });
  app.put("/api/host/live-page", requireHostSession, async (req, res) => {
    const email = norm(getSessionEmail(req) ?? "");
    if (typeof req.body?.on === "boolean") await storage.setSetting(`live-page:${email}`, req.body.on ? "" : "0");
    if (typeof req.body?.streamInOut === "boolean") await storage.setSetting(`streamin:out:${email}`, req.body.streamInOut ? "" : "0");
    const handle = await liveHandleOf(email);
    res.json({ on: await livePageOn(email), url: liveUrlOf(handle), handle, photo: await livePhotoOf(email).catch(() => ""), streamInOut: await streamInOutOn(email), live: !!(await liveNowFor(email, false).catch(() => null)) });
  });
}
