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
import { getSessionEmail } from "./session.js";
import { isLiveKitConfigured, publicLiveKitUrl } from "./livekit.js";
import { roomLookKey } from "./roomKit.js";
import { bioPages, personalStudios, streamKeys } from "../shared/schema.js";

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

/** Their published SmartLink's handle: the live page lives under it. */
export async function liveHandleOf(email: string): Promise<string> {
  const [row] = await db.select({ handle: bioPages.handle, published: bioPages.published }).from(bioPages).where(eq(bioPages.email, norm(email))).limit(1);
  return row?.published ? row.handle : "";
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
  | { kind: "stream"; since: string; url: string; token: string };

/** What's live for this person right now, if anything (stream in first: it's what they're sending us this minute). */
async function liveNowFor(email: string, withToken: boolean): Promise<LiveNow | null> {
  if (!isLiveKitConfigured()) return null;
  const [k] = await db.select().from(streamKeys).where(eq(streamKeys.ownerEmail, email)).limit(1);
  if (k && k.engine === "livekit" && k.room && k.status === "live" && k.egressId && k.egressId !== "pending" && (await streamInOutOn(email))) {
    return { kind: "stream", since: k.liveSince, url: publicLiveKitUrl(), token: withToken ? await viewerToken(k.room) : "" };
  }
  const [s] = await db.select().from(personalStudios).where(eq(personalStudios.ownerEmail, email)).limit(1);
  if (s?.liveEgressId) {
    return { kind: "studio", since: s.liveSince, url: publicLiveKitUrl(), token: withToken ? await viewerToken(`my-${s.id}`) : "", lookKey: roomLookKey(s.id), studioId: s.id };
  }
  return null;
}

export function registerLivePage(app: Express, requireHostSession: RequestHandler): void {
  /** The public page's data: who it is, and their show if it's live (with a watch-only seat). Polled every 20 s. */
  app.get("/api/live/:handle", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await schemaIsReady();
    const h = String(req.params.handle ?? "").toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,60}$/.test(h)) return res.status(404).json({ message: "No such page." });
    const [row] = await db.select().from(bioPages).where(eq(bioPages.handle, h)).limit(1);
    if (!row || !row.published) return res.status(404).json({ message: "No such page." });
    const email = norm(row.email);
    const on = await livePageOn(email);
    const live = on ? await liveNowFor(email, true).catch(() => null) : null;
    res.json({ handle: row.handle, name: row.displayName || row.handle, photo: row.avatarUrl || "", on, live });
  });

  /** Their switch, and where the page is. */
  app.get("/api/host/live-page", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const email = norm(getSessionEmail(req) ?? "");
    const handle = await liveHandleOf(email);
    res.json({ on: await livePageOn(email), url: liveUrlOf(handle), handle, streamInOut: await streamInOutOn(email), live: !!(await liveNowFor(email, false).catch(() => null)) });
  });
  app.put("/api/host/live-page", requireHostSession, async (req, res) => {
    const email = norm(getSessionEmail(req) ?? "");
    if (typeof req.body?.on === "boolean") await storage.setSetting(`live-page:${email}`, req.body.on ? "" : "0");
    if (typeof req.body?.streamInOut === "boolean") await storage.setSetting(`streamin:out:${email}`, req.body.streamInOut ? "" : "0");
    const handle = await liveHandleOf(email);
    res.json({ on: await livePageOn(email), url: liveUrlOf(handle), handle, streamInOut: await streamInOutOn(email), live: !!(await liveNowFor(email, false).catch(() => null)) });
  });
}
