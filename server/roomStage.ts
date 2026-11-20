// The Room's picture, as the recording and the stream see it. Three jobs, all through the
// LiveKit room itself so the host's view, the recording and the stream always agree:
//   1. the template: record and live film /room/composite (our own page) instead of
//      LiveKit's stock grid, and fall back to the stock grid if our page can't be reached;
//   2. backstage: a guest is "Backstage" until the host brings them "On stage" (the same
//      participant state the event studio uses, so the stage already knows what to do);
//   3. media: the room's intro or outro plays full-frame on the stage, which both the
//      recording and the stream capture, and the scene and look follow the room metadata.
// Where a room's look, scenes and uploads are SAVED is Podcasting's; this reads them through
// roomLookSource() and keeps no copy of its own.
import type { Express, RequestHandler } from "express";
import crypto from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import { eq } from "drizzle-orm";
import { db, schemaIsReady } from "./storage.js";
import { getSessionEmail } from "./session.js";
import { isLiveKitConfigured, publicLiveKitUrl, rooms, syncParticipantState } from "./livekit.js";
import { personalStudios, type PersonalStudioRow } from "../shared/schema.js";
import { DEFAULT_ROOM_LOOK, roomMetaFrom, type RoomLook } from "../shared/roomLook.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");

/** Where the look comes from. Podcasting's storage plugs in here; until then every room gets the default. */
type LookSource = (email: string, studio: PersonalStudioRow) => Promise<RoomLook>;
let lookSource: LookSource = async () => DEFAULT_ROOM_LOOK;
export function roomLookSource(fn: LookSource) { lookSource = fn; }

const roomOf = (s: PersonalStudioRow) => `my-${s.id}`;

async function studioOf(req: Parameters<RequestHandler>[0]): Promise<{ row: PersonalStudioRow; email: string } | null> {
  const email = (getSessionEmail(req) ?? "").trim().toLowerCase();
  if (!email) return null;
  await schemaIsReady();
  const [row] = await db.select().from(personalStudios).where(eq(personalStudios.ownerEmail, email)).limit(1);
  return row ? { row, email } : null;
}

/** Merge into the room's metadata (it is replaced whole by LiveKit). False when the room doesn't exist yet. */
export async function mergeRoomMeta(room: string, patch: Record<string, unknown>): Promise<boolean> {
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

/** Put the room's look and active scene on its LiveKit room. Safe to call again and again. */
export async function applyRoomLook(row: PersonalStudioRow, email: string, sceneId?: string): Promise<{ ok: boolean; scene: string }> {
  const look = await lookSource(email, row);
  const meta = roomMetaFrom(row.name, look, sceneId, ORIGIN);
  const ok = await mergeRoomMeta(roomOf(row), meta);
  return { ok, scene: String(meta.activeScene ?? "") };
}

// Our own page films the room when it can be reached; otherwise LiveKit's stock grid does, so a
// bad deploy can never cost anyone a recording.
let tpl: { at: number; ok: boolean } | null = null;
export async function roomTemplateUrl(): Promise<string | undefined> {
  const url = `${ORIGIN}/room/composite`;
  if (tpl && Date.now() - tpl.at < 60_000) return tpl.ok ? url : undefined;
  let ok = false;
  try {
    const r = await fetch(url, { method: "GET", signal: AbortSignal.timeout(3000) });
    ok = r.ok && (r.headers.get("content-type") ?? "").includes("text/html");
  } catch {
    ok = false;
  }
  tpl = { at: Date.now(), ok };
  if (!ok) console.error("Room template unreachable; recording with the stock layout.");
  return ok ? url : undefined;
}

export function registerRoomStage(app: Express, requireHostSession: RequestHandler) {
  /** Switch scene. Idempotent: the room UI also calls it after joining, so the look is on the room. */
  app.post("/api/host/my-studio/scene", requireHostSession, async (req, res) => {
    const got = await studioOf(req);
    if (!got) return res.status(404).json({ message: "Open your room first." });
    const look = await lookSource(got.email, got.row);
    const want = String(req.body?.sceneId ?? "").trim();
    if (want && !look.scenes.some((s) => s.id === want)) return res.status(400).json({ message: "That scene isn't in your room." });
    const out = await applyRoomLook(got.row, got.email, want || undefined);
    res.json(out);
  });

  /**
   * A hidden, listen-only connection for the room UI's own stage view (RoomStage), so it shows
   * exactly what the recorder films. Hidden, so nobody sees it in the room; its own identity,
   * so it never knocks the host's own connection out.
   */
  app.post("/api/host/my-studio/preview-token", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const got = await studioOf(req);
    if (!got) return res.status(404).json({ message: "Open your room first." });
    if (!isLiveKitConfigured()) return res.status(503).json({ message: "Rooms aren't switched on yet." });
    const at = new AccessToken(process.env.LIVEKIT_API_KEY ?? "", process.env.LIVEKIT_API_SECRET ?? "", { identity: `view-${got.row.id}-${crypto.randomBytes(3).toString("hex")}`, name: "Stage view", ttl: "6h" });
    at.addGrant({ room: roomOf(got.row), roomJoin: true, canPublish: false, canPublishData: false, canSubscribe: true, hidden: true });
    res.json({ url: publicLiveKitUrl(), token: await at.toJwt() });
  });

  /** Bring a guest on stage, or send them back. Only guests move; the host is always on. */
  app.post("/api/host/my-studio/stage", requireHostSession, async (req, res) => {
    const got = await studioOf(req);
    if (!got) return res.status(404).json({ message: "Open your room first." });
    const identity = String(req.body?.identity ?? "");
    if (!/^guest-[a-z0-9]+$/i.test(identity)) return res.status(400).json({ message: "Only guests can be moved." });
    const on = req.body?.on === true;
    try {
      const people = await rooms().listParticipants(roomOf(got.row));
      if (!people.some((p) => p.identity === identity)) return res.status(404).json({ message: "They've left the room." });
    } catch {
      return res.status(502).json({ message: "The room didn't answer. Try again in a moment." });
    }
    await syncParticipantState(roomOf(got.row), identity, on ? "On stage" : "Backstage");
    res.json({ identity, onStage: on });
  });

  /** Play the room's intro or outro on the stage (so the recording and the stream carry it), or stop. */
  app.post("/api/host/my-studio/media", requireHostSession, async (req, res) => {
    const got = await studioOf(req);
    if (!got) return res.status(404).json({ message: "Open your room first." });
    const action = String(req.body?.action ?? "");
    const room = roomOf(got.row);
    if (action === "stop") {
      const ok = await mergeRoomMeta(room, { stageMediaPlaying: false, stageMediaUrl: "", stageMediaKind: "", stageMediaLabel: "", stageMediaPeople: false });
      return res.json({ ok, playing: false });
    }
    if (action !== "intro" && action !== "outro") return res.status(400).json({ message: "Play the intro or the outro." });
    const look = await lookSource(got.email, got.row);
    const raw = action === "intro" ? look.introUrl : look.outroUrl;
    if (!raw) return res.status(400).json({ message: `Upload your ${action} first.` });
    const url = raw.startsWith("/") ? `${ORIGIN}${raw}` : raw;
    const ok = await mergeRoomMeta(room, { stageMediaPlaying: true, stageMediaUrl: url, stageMediaKind: "video", stageMediaLabel: action === "intro" ? "Intro" : "Outro", stageMediaPeople: false });
    if (!ok) return res.status(409).json({ message: "Join your room first, then play it." });
    res.json({ ok, playing: true, action });
  });
}
