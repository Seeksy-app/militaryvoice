// The Room's picture, as the recording and the stream see it. The live state goes on the LiveKit
// room itself, so the host's view, the recording and the stream can never disagree:
//   - the template: record and live film /room/composite/<key> (our own page) instead of
//     LiveKit's stock grid, and fall back to the stock grid if our page can't be reached;
//   - backstage: participant attribute stage = "on" | "off". Only "on" is shown or heard;
//   - live state in the room metadata (ours alone): activeScene, showing {bannerId, until},
//     playing {slot, at}, lookRev. The LOOK itself (scenes, background, logo, banners, intro and
//     outro) is Podcasting's: saved and served by them, read here and by the page through
//     GET /api/room/:studioId/look?k=<key>. We keep no copy of it.
import type { Express, RequestHandler } from "express";
import crypto from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import { eq } from "drizzle-orm";
import { db, schemaIsReady } from "./storage.js";
import { getSessionEmail } from "./session.js";
import { isLiveKitConfigured, publicLiveKitUrl, rooms } from "./livekit.js";
import { personalStudios, type PersonalStudioRow } from "../shared/schema.js";
import type { RoomLook, RoomLive } from "../shared/roomLook.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");

/** Podcasting's roomKit plugs in here (see myStudio.ts): the key that lets a page read a room's look without a login. */
let kit: { roomLookKey: (studioId: number) => string } | null = null;
export function useRoomKit(k: { roomLookKey: (studioId: number) => string }) { kit = k; }

const roomOf = (s: PersonalStudioRow) => `my-${s.id}`;

async function studioOf(req: Parameters<RequestHandler>[0]): Promise<{ row: PersonalStudioRow; email: string } | null> {
  const email = (getSessionEmail(req) ?? "").trim().toLowerCase();
  if (!email) return null;
  await schemaIsReady();
  const [row] = await db.select().from(personalStudios).where(eq(personalStudios.ownerEmail, email)).limit(1);
  return row ? { row, email } : null;
}

/** The room's look, from Podcasting, the same way the filmed page reads it. */
async function readLook(studioId: number): Promise<RoomLook | null> {
  const key = kit?.roomLookKey(studioId);
  if (!key) return null;
  try {
    const r = await fetch(`${ORIGIN}/api/room/${studioId}/look?k=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { look?: RoomLook };
    return j.look ?? null;
  } catch {
    return null;
  }
}

/** Merge into the room's metadata (LiveKit replaces it whole). False when the room doesn't exist yet. */
export async function mergeRoomMeta(room: string, patch: Partial<RoomLive>): Promise<boolean> {
  if (!isLiveKitConfigured()) return false;
  try {
    const [r] = await rooms().listRooms([room]);
    if (!r) return false;
    let cur: Record<string, unknown> = {};
    try { cur = JSON.parse(r.metadata || "{}") as Record<string, unknown>; } catch { cur = {}; }
    await rooms().updateRoomMetadata(room, JSON.stringify({ ...cur, ...patch }));
    return true;
  } catch (err) {
    console.error("Room metadata failed:", (err as Error).message);
    return false;
  }
}

/** Podcasting's onLookSaved calls this, so the filmed page and the room fetch the look again. */
export async function bumpLookRev(studioId: number, rev: number): Promise<void> {
  await mergeRoomMeta(`my-${studioId}`, { lookRev: rev });
}

// Our own page films the room when it can be reached; otherwise LiveKit's stock grid does, so a
// bad deploy (or a room kit not wired yet) can never cost anyone a recording.
let tpl: { at: number; ok: boolean } | null = null;
export async function roomTemplateUrl(studioId: number): Promise<string | undefined> {
  const key = kit?.roomLookKey(studioId);
  if (!key) return undefined;
  const url = `${ORIGIN}/room/composite/${encodeURIComponent(key)}`;
  if (tpl && Date.now() - tpl.at < 60_000) return tpl.ok ? url : undefined;
  let ok = false;
  try {
    const r = await fetch(`${ORIGIN}/room/composite/check`, { method: "GET", signal: AbortSignal.timeout(3000) });
    ok = r.ok && (r.headers.get("content-type") ?? "").includes("text/html");
  } catch {
    ok = false;
  }
  tpl = { at: Date.now(), ok };
  if (!ok) console.error("Room template unreachable; recording with the stock layout.");
  return ok ? url : undefined;
}

export function registerRoomStage(app: Express, requireHostSession: RequestHandler) {
  /** Switch scene. Idempotent, so the room UI can also call it after joining to put the live state on the room. */
  app.post("/api/host/my-studio/scene", requireHostSession, async (req, res) => {
    const got = await studioOf(req);
    if (!got) return res.status(404).json({ message: "Open your room first." });
    const want = String(req.body?.sceneId ?? "").trim();
    if (!want) return res.status(400).json({ message: "Which scene?" });
    const look = await readLook(got.row.id);
    if (look && !look.scenes.some((s) => s.id === want)) return res.status(400).json({ message: "That scene isn't in your room." });
    const ok = await mergeRoomMeta(roomOf(got.row), { activeScene: want });
    if (!ok) return res.status(409).json({ message: "Join your room first." });
    res.json({ ok: true, scene: want });
  });

  /** Show a banner on the stage for its own number of seconds, or take it off (bannerId null). */
  app.post("/api/host/my-studio/banner", requireHostSession, async (req, res) => {
    const got = await studioOf(req);
    if (!got) return res.status(404).json({ message: "Open your room first." });
    const id = req.body?.bannerId == null ? "" : String(req.body.bannerId);
    if (!id) {
      const ok = await mergeRoomMeta(roomOf(got.row), { showing: null });
      return res.json({ ok, showing: null });
    }
    const look = await readLook(got.row.id);
    const banner = look?.banners?.find((b) => b.id === id);
    if (!banner) return res.status(404).json({ message: "That banner isn't in your room." });
    const until = Date.now() + Math.max(1, Math.min(120, Number(banner.seconds) || 6)) * 1000;
    const ok = await mergeRoomMeta(roomOf(got.row), { showing: { bannerId: id, until } });
    if (!ok) return res.status(409).json({ message: "Join your room first." });
    res.json({ ok, showing: { bannerId: id, until } });
  });

  /** Play the room's intro or outro on the stage (so the recording and the stream carry it), or stop. */
  app.post("/api/host/my-studio/media", requireHostSession, async (req, res) => {
    const got = await studioOf(req);
    if (!got) return res.status(404).json({ message: "Open your room first." });
    const action = String(req.body?.action ?? "");
    const room = roomOf(got.row);
    if (action === "stop") return res.json({ ok: await mergeRoomMeta(room, { playing: null }), playing: false });
    if (action !== "intro" && action !== "outro") return res.status(400).json({ message: "Play the intro or the outro." });
    const look = await readLook(got.row.id);
    const clip = action === "intro" ? look?.intro : look?.outro;
    if (!clip?.url) return res.status(400).json({ message: `Upload your ${action} first.` });
    const ok = await mergeRoomMeta(room, { playing: { slot: action, at: Date.now() } });
    if (!ok) return res.status(409).json({ message: "Join your room first, then play it." });
    res.json({ ok, playing: true, action });
  });

  /**
   * A hidden, listen-only connection for the room UI's own stage view (RoomStage), so it shows
   * exactly what the recorder films. Hidden, so nobody sees it in the room; its own identity,
   * so it never knocks the host's own connection out. Also returns what the view needs to read
   * the look.
   */
  app.post("/api/host/my-studio/preview-token", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const got = await studioOf(req);
    if (!got) return res.status(404).json({ message: "Open your room first." });
    if (!isLiveKitConfigured()) return res.status(503).json({ message: "Rooms aren't switched on yet." });
    const at = new AccessToken(process.env.LIVEKIT_API_KEY ?? "", process.env.LIVEKIT_API_SECRET ?? "", { identity: `view-${got.row.id}-${crypto.randomBytes(3).toString("hex")}`, name: "Stage view", ttl: "6h" });
    at.addGrant({ room: roomOf(got.row), roomJoin: true, canPublish: false, canPublishData: false, canSubscribe: true, hidden: true });
    res.json({ url: publicLiveKitUrl(), token: await at.toJwt(), studioId: got.row.id, name: got.row.name, lookKey: kit?.roomLookKey(got.row.id) ?? "" });
  });

  /** Bring a guest on stage, or send them backstage. Only guests move; the host is always on stage. */
  app.post("/api/host/my-studio/backstage", requireHostSession, async (req, res) => {
    const got = await studioOf(req);
    if (!got) return res.status(404).json({ message: "Open your room first." });
    const identity = String(req.body?.identity ?? "");
    if (!/^guest-[a-z0-9]+$/i.test(identity)) return res.status(400).json({ message: "Only guests can be moved." });
    const on = req.body?.on === true;
    try {
      const people = await rooms().listParticipants(roomOf(got.row));
      if (!people.some((p) => p.identity === identity)) return res.status(404).json({ message: "They've left the room." });
      await rooms().updateParticipant(roomOf(got.row), identity, { attributes: { stage: on ? "on" : "off" } });
    } catch {
      return res.status(502).json({ message: "The room didn't answer. Try again in a moment." });
    }
    res.json({ identity, onStage: on });
  });
}
