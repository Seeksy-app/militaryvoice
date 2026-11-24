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
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { bearer } from "./ingestEngine.js";
import { noteMusicPlayed, toAsset } from "./roomKit.js";
import { and, eq, inArray } from "drizzle-orm";
import { db, schemaIsReady, storage } from "./storage.js";
import { getSessionEmail } from "./session.js";
import { isLiveKitConfigured, publicLiveKitUrl, rooms } from "./livekit.js";
import { personalStudios, roomAssets, type PersonalStudioRow } from "../shared/schema.js";
import { clipOf, ROOM_CARD_SLOTS, type RoomCardSlot, type RoomLook, type RoomLive } from "../shared/roomLook.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
/** Studio v3 (scene types, ready-made cards, sounds and music through the player bot). Off until all three teams are in. */
export const STUDIO_V3 = process.env.STUDIO_V3 === "1";

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
    // Every view reads the flag from here, so the recording page needs no setting of its own.
    await rooms().updateRoomMetadata(room, JSON.stringify({ ...cur, ...patch, v3: STUDIO_V3 }));
    return true;
  } catch (err) {
    console.error("Room metadata failed:", (err as Error).message);
    return false;
  }
}

/** The music on air when a recording starts gets its credit noted too (it may have started first). */
export async function noteMusicOnAir(studioId: number): Promise<void> {
  if (!STUDIO_V3 || !isLiveKitConfigured()) return;
  try {
    const [r] = await rooms().listRooms([`my-${studioId}`]);
    const id = (JSON.parse(r?.metadata || "{}") as RoomLive).music?.id;
    if (id) await noteMusicPlayed(studioId, id);
  } catch { /* nothing on air */ }
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

/** A real person (the owner or a guest), not the recorder, a stage view or the player bot. */
const isPerson = (identity: string) => /^(owner|guest)-/.test(identity);

export function registerRoomStage(app: Express, requireHostSession: RequestHandler) {
  /**
   * The player bot on the stream box asks every few seconds which studios have someone in them,
   * and gets a token to join each one. Only occupied studios, so it is in a room (and costs) only
   * while people are. Bearer INGEST_TOKEN, the box's one secret.
   */
  app.get("/api/ingest/players", bearer, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!STUDIO_V3 || !isLiveKitConfigured()) return res.json({ rooms: [] });
    try {
      const all = (await rooms().listRooms()).filter((r) => /^my-\d+$/.test(r.name) && r.numParticipants > 0);
      const out: { studioId: number; room: string; url: string; token: string; lookKey: string }[] = [];
      for (const r of all) {
        const people = await rooms().listParticipants(r.name);
        if (!people.some((p) => isPerson(p.identity))) continue;
        const studioId = Number(r.name.slice(3));
        const at = new AccessToken(process.env.LIVEKIT_API_KEY ?? "", process.env.LIVEKIT_API_SECRET ?? "", { identity: `player-${studioId}`, name: "Studio sound", ttl: "2h" });
        at.addGrant({ room: r.name, roomJoin: true, canPublish: true, canPublishSources: [TrackSource.MICROPHONE], canPublishData: false, canSubscribe: true });
        at.attributes = { role: "player", stage: "on" };
        out.push({ studioId, room: r.name, url: publicLiveKitUrl(), token: await at.toJwt(), lookKey: kit?.roomLookKey(studioId) ?? "" });
      }
      res.json({ rooms: out });
    } catch (err) {
      res.status(502).json({ message: (err as Error).message.slice(0, 120) });
    }
  });

  /** Switch scene. Idempotent, so the room UI can also call it after joining to put the live state on the room. */
  app.post("/api/host/my-studio/scene", requireHostSession, async (req, res) => {
    const got = await studioOf(req);
    if (!got) return res.status(404).json({ message: "Open your studio first." });
    const want = String(req.body?.sceneId ?? "").trim();
    if (!want) return res.status(400).json({ message: "Which scene?" });
    const look = await readLook(got.row.id);
    if (look && !look.scenes.some((s) => s.id === want)) return res.status(400).json({ message: "That scene isn't in your studio." });
    const ok = await mergeRoomMeta(roomOf(got.row), { activeScene: want });
    if (!ok) return res.status(409).json({ message: "Join your studio first." });
    res.json({ ok: true, scene: want });
  });

  /** Show a banner on the stage for its own number of seconds, or take it off (bannerId null). */
  app.post("/api/host/my-studio/banner", requireHostSession, async (req, res) => {
    const got = await studioOf(req);
    if (!got) return res.status(404).json({ message: "Open your studio first." });
    const id = req.body?.bannerId == null ? "" : String(req.body.bannerId);
    if (!id) {
      const ok = await mergeRoomMeta(roomOf(got.row), { showing: null });
      return res.json({ ok, showing: null });
    }
    const look = await readLook(got.row.id);
    const banner = look?.banners?.find((b) => b.id === id);
    if (!banner) return res.status(404).json({ message: "That banner isn't in your studio." });
    const until = Date.now() + Math.max(1, Math.min(120, Number(banner.seconds) || 6)) * 1000;
    const ok = await mergeRoomMeta(roomOf(got.row), { showing: { bannerId: id, until } });
    if (!ok) return res.status(409).json({ message: "Join your studio first." });
    res.json({ ok, showing: { bannerId: id, until } });
  });

  /** Play the room's intro or outro on the stage (so the recording and the stream carry it), or stop. */
  app.post("/api/host/my-studio/media", requireHostSession, async (req, res) => {
    const got = await studioOf(req);
    if (!got) return res.status(404).json({ message: "Open your studio first." });
    const action = String(req.body?.action ?? "");
    const room = roomOf(got.row);
    if (action === "stop") return res.json({ ok: await mergeRoomMeta(room, { playing: null }), playing: false });
    // The ready-made cards are drawn live in the owner's look, so there is no file to check.
    if (STUDIO_V3 && (ROOM_CARD_SLOTS as string[]).includes(action)) {
      const minutes = action === "countdown" ? Math.max(1, Math.min(60, Math.round(Number(req.body?.minutes) || 5))) : undefined;
      const next = action === "countdown" && req.body?.next ? String(req.body.next).slice(0, 40) : undefined;
      const playing = { slot: action as RoomCardSlot, at: Date.now(), ...(minutes ? { minutes } : {}), ...(next ? { next } : {}) };
      const ok = await mergeRoomMeta(room, { playing });
      if (!ok) return res.status(409).json({ message: "Join your studio first, then play it." });
      return res.json({ ok, playing: true, action, ...(minutes ? { minutes } : {}) });
    }
    if (action !== "intro" && action !== "outro") return res.status(400).json({ message: "Play the intro or the outro." });
    const look = await readLook(got.row.id);
    const clip = clipOf(look, action);
    if (!clip?.url) return res.status(400).json({ message: `Upload your ${action} first.` });
    const ok = await mergeRoomMeta(room, { playing: { slot: action, at: Date.now() } });
    if (!ok) return res.status(409).json({ message: "Join your studio first, then play it." });
    res.json({ ok, playing: true, action });
  });

  /** Play a sound pad once. Everyone in the studio hears it, and so do the recording and the stream (the player bot). */
  app.post("/api/host/my-studio/sound", requireHostSession, async (req, res) => {
    if (!STUDIO_V3) return res.status(404).json({ message: "Sounds aren't switched on yet." });
    const got = await studioOf(req);
    if (!got) return res.status(404).json({ message: "Open your studio first." });
    const id = String(req.body?.id ?? "");
    const look = await readLook(got.row.id);
    if (!look?.sounds?.some((s) => s.id === id)) return res.status(404).json({ message: "That sound isn't in your studio." });
    const sound = { id, at: Date.now() };
    const ok = await mergeRoomMeta(roomOf(got.row), { sound });
    if (!ok) return res.status(409).json({ message: "Join your studio first." });
    res.json({ ok, sound });
  });

  /** Start a music bed (it loops under the voices) or stop it (id null). */
  app.post("/api/host/my-studio/music", requireHostSession, async (req, res) => {
    if (!STUDIO_V3) return res.status(404).json({ message: "Music isn't switched on yet." });
    const got = await studioOf(req);
    if (!got) return res.status(404).json({ message: "Open your studio first." });
    const id = req.body?.id == null ? "" : String(req.body.id);
    if (!id) return res.json({ ok: await mergeRoomMeta(roomOf(got.row), { music: null }), music: null });
    const look = await readLook(got.row.id);
    if (!look?.music?.some((m) => m.id === id)) return res.status(404).json({ message: "That track isn't in your studio." });
    const music = { id, at: Date.now() };
    const ok = await mergeRoomMeta(roomOf(got.row), { music });
    if (!ok) return res.status(409).json({ message: "Join your studio first." });
    // A CC BY track's credit is kept against the recording, for its episode and clip descriptions (Podcasting's).
    void noteMusicPlayed(got.row.id, id).catch(() => {});
    res.json({ ok, music });
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
    if (!got) return res.status(404).json({ message: "Open your studio first." });
    if (!isLiveKitConfigured()) return res.status(503).json({ message: "The studio isn't switched on yet." });
    const at = new AccessToken(process.env.LIVEKIT_API_KEY ?? "", process.env.LIVEKIT_API_SECRET ?? "", { identity: `view-${got.row.id}-${crypto.randomBytes(3).toString("hex")}`, name: "Stage view", ttl: "6h" });
    at.addGrant({ room: roomOf(got.row), roomJoin: true, canPublish: false, canPublishData: false, canSubscribe: true, hidden: true });
    res.json({ url: publicLiveKitUrl(), token: await at.toJwt(), studioId: got.row.id, name: got.row.name, lookKey: kit?.roomLookKey(got.row.id) ?? "" });
  });

  /**
   * A presented video's sound for the people in the studio (Andrew, 24 Nov: "If someone's going to
   * play a video clip during a recording…"). The host's page plays the clip and publishes its sound
   * as "player-<id>-clip", so the host, guests and backstage hear it as an ordinary remote track:
   * their echo cancellation takes it out of their mics, and nothing on the stream box is needed.
   * Publish only (it hears nothing); the recording ignores it (isClipSound), since its own copy of
   * the video carries the sound in sync. The owner only.
   */
  app.post("/api/host/my-studio/clip-token", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const got = await studioOf(req);
    if (!got) return res.status(404).json({ message: "Open your studio first." });
    if (!isLiveKitConfigured()) return res.status(503).json({ message: "The studio isn't switched on yet." });
    const at = new AccessToken(process.env.LIVEKIT_API_KEY ?? "", process.env.LIVEKIT_API_SECRET ?? "", { identity: `player-${got.row.id}-clip`, name: "Studio sound", ttl: "6h" });
    at.addGrant({ room: roomOf(got.row), roomJoin: true, canPublish: true, canPublishSources: [TrackSource.MICROPHONE], canPublishData: false, canSubscribe: false });
    at.attributes = { role: "player", stage: "on" };
    res.json({ url: publicLiveKitUrl(), token: await at.toJwt() });
  });

  /** Bring a guest on stage, or send them backstage. Only guests move; the host is always on stage. */
  app.post("/api/host/my-studio/backstage", requireHostSession, async (req, res) => {
    const got = await studioOf(req);
    if (!got) return res.status(404).json({ message: "Open your studio first." });
    const identity = String(req.body?.identity ?? "");
    if (!/^guest-[a-z0-9]+$/i.test(identity) && !new RegExp(`^owner-${got.row.id}-cam-[a-f0-9]+$`).test(identity)) return res.status(400).json({ message: "Only guests and extra cameras can be moved." });
    const on = req.body?.on === true;
    try {
      const people = await rooms().listParticipants(roomOf(got.row));
      if (!people.some((p) => p.identity === identity)) return res.status(404).json({ message: "They've left the studio." });
      await rooms().updateParticipant(roomOf(got.row), identity, { attributes: { stage: on ? "on" : "off" } });
    } catch {
      return res.status(502).json({ message: "The studio didn't answer. Try again in a moment." });
    }
    res.json({ identity, onStage: on });
  });

  /**
   * A guest's ⋯ menu (StreamYard's person tile, 21 Nov): mute their mic, or remove them from the
   * studio. Guests only. Mute is one way: they unmute themselves when they're ready. A removed guest
   * can come back on the invite link (a new link keeps them out).
   */
  const guestIn = async (row: PersonalStudioRow, identity: string) =>
    (await rooms().listParticipants(roomOf(row))).find((p) => p.identity === identity);
  app.post("/api/host/my-studio/mute", requireHostSession, async (req, res) => {
    const got = await studioOf(req);
    if (!got) return res.status(404).json({ message: "Open your studio first." });
    const identity = String(req.body?.identity ?? "");
    if (!/^guest-[a-z0-9]+$/i.test(identity)) return res.status(400).json({ message: "Only guests can be muted from here." });
    try {
      const p = await guestIn(got.row, identity);
      if (!p) return res.status(404).json({ message: "They've left the studio." });
      const mic = p.tracks.find((t) => t.source === TrackSource.MICROPHONE && !t.muted);
      if (mic) await rooms().mutePublishedTrack(roomOf(got.row), identity, mic.sid, true);
    } catch {
      return res.status(502).json({ message: "The studio didn't answer. Try again in a moment." });
    }
    res.json({ identity, muted: true });
  });
  app.post("/api/host/my-studio/remove", requireHostSession, async (req, res) => {
    const got = await studioOf(req);
    if (!got) return res.status(404).json({ message: "Open your studio first." });
    const identity = String(req.body?.identity ?? "");
    if (!/^guest-[a-z0-9]+$/i.test(identity)) return res.status(400).json({ message: "Only guests can be removed." });
    try {
      if (await guestIn(got.row, identity)) await rooms().removeParticipant(roomOf(got.row), identity);
    } catch {
      return res.status(502).json({ message: "The studio didn't answer. Try again in a moment." });
    }
    res.json({ identity, removed: true });
  });

  /**
   * Slides (StreamYard's "Slides", 21 Nov): the browser turns a PDF into one picture per page and
   * uploads them as photos; this keeps the deck per studio, so its ← → work from any computer. The
   * page on air is the Presenting scene's media, as with any picture.
   */
  const DECK_PAGES = 60;
  const deckKey = (id: number) => `studio-deck:${id}`;
  const readDeck = async (studioId: number): Promise<{ name: string; pages: ReturnType<typeof toAsset>[] } | null> => {
    let saved: { name?: string; ids?: string[] } = {};
    try { saved = JSON.parse((await storage.getSetting(deckKey(studioId))) || "{}"); } catch { saved = {}; }
    const ids = Array.isArray(saved.ids) ? saved.ids.map(String).slice(0, DECK_PAGES) : [];
    if (!ids.length) return null;
    const rows = await db.select().from(roomAssets).where(and(eq(roomAssets.studioId, studioId), inArray(roomAssets.id, ids)));
    const byId = new Map(rows.map((r) => [r.id, toAsset(r)]));
    const pages = ids.map((i) => byId.get(i)).filter((a): a is NonNullable<typeof a> => !!a);
    return pages.length ? { name: String(saved.name ?? "").slice(0, 120), pages } : null;
  };
  app.get("/api/host/my-studio/deck", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const got = await studioOf(req);
    if (!got) return res.status(404).json({ message: "Open your studio first." });
    res.json({ deck: await readDeck(got.row.id) });
  });
  app.put("/api/host/my-studio/deck", requireHostSession, async (req, res) => {
    const got = await studioOf(req);
    if (!got) return res.status(404).json({ message: "Open your studio first." });
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map((x: unknown) => String(x)).filter((x: string) => /^[\w-]{1,64}$/.test(x));
    if (!ids.length) { await storage.setSetting(deckKey(got.row.id), ""); return res.json({ deck: null }); }
    if (ids.length > DECK_PAGES) return res.status(400).json({ message: `Present up to ${DECK_PAGES} slides at a time.` });
    const rows = await db.select({ id: roomAssets.id, kind: roomAssets.kind }).from(roomAssets).where(and(eq(roomAssets.studioId, got.row.id), inArray(roomAssets.id, ids)));
    if (rows.length !== new Set(ids).size || rows.some((r) => r.kind !== "photo")) return res.status(400).json({ message: "Those slides didn't all come through. Try the PDF again." });
    await storage.setSetting(deckKey(got.row.id), JSON.stringify({ name: String(req.body?.name ?? "").slice(0, 120), ids }));
    res.json({ deck: await readDeck(got.row.id) });
  });

  /**
   * An extra camera (StreamYard's "Add another camera"): a second camera on the owner's computer
   * joins as its own picture, owner-<id>-cam-<hex>, so it goes on stage or backstage like a guest.
   * Video only: it can't publish sound or listen in.
   */
  app.post("/api/host/my-studio/camera-token", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const got = await studioOf(req);
    if (!got) return res.status(404).json({ message: "Open your studio first." });
    if (!isLiveKitConfigured()) return res.status(503).json({ message: "The studio isn't switched on yet." });
    const identity = `owner-${got.row.id}-cam-${crypto.randomBytes(3).toString("hex")}`;
    const name = String(req.body?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || "Camera 2";
    const at = new AccessToken(process.env.LIVEKIT_API_KEY ?? "", process.env.LIVEKIT_API_SECRET ?? "", { identity, name, ttl: "12h" });
    at.addGrant({ room: roomOf(got.row), roomJoin: true, canPublish: true, canPublishSources: [TrackSource.CAMERA], canPublishData: false, canSubscribe: false });
    at.attributes = { role: "camera", stage: "on", who: identity };
    res.json({ url: publicLiveKitUrl(), token: await at.toJwt(), identity });
  });
}
