// Room phase 2 (20 Nov 2026), the data side: a creator's room look and its scenes, the files it
// uses (logo, background, intro, outro), and "Mark a clip" while recording.
//
// - The look is one JSON document per room (room_looks), saved whole on every change with a rev.
//   look.onStage is the scene on air: POST /api/host/my-studio/stage is the one way to switch it.
// - Every save puts a small copy of the look on the LiveKit room's metadata (key "look"), so the
//   recording page (/room/composite, no login) and everyone in the room see it at once.
// - Files go up with the usual R2 browser upload, then are registered here. Their URLs are stable
//   (/api/my-studio/:id/asset/:assetId → a fresh signed R2 link each time), so a long show never
//   holds an expired link. Asset ids are random: the URL is the permission.
// - Marks are seconds from the recording's start, by the server's clock. A Pōstify clip job on
//   that recording carries them (options.marks) and the moment picker builds clips around them.
import type { Express, Request, RequestHandler } from "express";
import crypto from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db, schemaIsReady } from "./storage.js";
import { getSessionEmail } from "./session.js";
import { isLiveKitConfigured, rooms } from "./livekit.js";
import { signedRecordingUrl } from "./recordingStorage.js";
import { personalStudios, recordings, roomAssets, roomLooks, roomMarks, type PersonalStudioRow, type RoomAssetRow } from "../shared/schema.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const SECRET = process.env.SESSION_SECRET || "dev-only-insecure-secret-change-me";
const now = () => new Date().toISOString();
const me = (req: Request) => (getSessionEmail(req) ?? "").trim().toLowerCase();

export type Layout = "solo" | "side" | "grid" | "speaker" | "screen" | "pip";
const LAYOUTS: Layout[] = ["solo", "side", "grid", "speaker", "screen", "pip"];
export type AssetKind = "logo" | "background" | "intro" | "outro";
const KINDS: AssetKind[] = ["logo", "background", "intro", "outro"];
export type Asset = { id: string; kind: AssetKind; name: string; mime: string; sec: number; url: string };
type Background = { kind: "color"; value: "blue" | "dark" | "light" } | { kind: "image"; asset: Asset };
type SceneLook = { background?: Background; logo?: { asset: Asset; corner: "tl" | "tr" } | null; banner?: string };
export type Scene = { id: string; n: number; name: string; layout: Layout; stage: string[]; look?: SceneLook };
export type Look = {
  rev: number;
  background: Background;
  logo: { asset: Asset; corner: "tl" | "tr" } | null;
  logos: Asset[];
  banners: { id: string; text: string; seconds: number }[];
  intro: Asset | null;
  outro: Asset | null;
  scenes: Scene[];
  onStage: string;
  showing: { bannerId: string; until: string } | null;
};

const freshLook = (): Look => ({
  rev: 0,
  background: { kind: "color", value: "blue" },
  logo: null,
  logos: [],
  banners: [],
  intro: null,
  outro: null,
  scenes: [
    { id: "s1", n: 1, name: "Just us", layout: "side", stage: [] },
    { id: "s2", n: 2, name: "Sharing a screen", layout: "screen", stage: [] },
  ],
  onStage: "s1",
  showing: null,
});

/** The key the recording page passes to read a room's look without a login. */
export const roomLookKey = (studioId: number) => crypto.createHmac("sha256", SECRET).update(`room-look:${studioId}`).digest("base64url").slice(0, 24);
const keyOk = (studioId: number, k: unknown) => {
  const want = Buffer.from(roomLookKey(studioId));
  const got = Buffer.from(String(k ?? ""));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
};
const assetUrl = (studioId: number, id: string) => `${ORIGIN}/api/my-studio/${studioId}/asset/${id}`;
const toAsset = (a: RoomAssetRow): Asset => ({ id: a.id, kind: a.kind as AssetKind, name: a.name, mime: a.mime, sec: a.sec, url: assetUrl(a.studioId, a.id) });

async function studioOf(email: string): Promise<PersonalStudioRow | undefined> {
  await schemaIsReady();
  const [s] = await db.select().from(personalStudios).where(eq(personalStudios.ownerEmail, email)).limit(1);
  return s;
}

/** A room's look (the starting one if it has never been saved). */
export async function getLook(studioId: number): Promise<Look> {
  await schemaIsReady();
  const [row] = await db.select().from(roomLooks).where(eq(roomLooks.studioId, studioId)).limit(1);
  if (!row) return freshLook();
  try { return { ...freshLook(), ...(JSON.parse(row.look) as Partial<Look>), rev: row.rev }; } catch { return { ...freshLook(), rev: row.rev }; }
}

// ---- checking what the client sends: only known shapes, short strings, our own assets ----
const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const id8 = (v: unknown) => (/^[\w-]{1,24}$/.test(String(v ?? "")) ? String(v) : "");

function clean(raw: any, assets: Map<string, Asset>): Look | string {
  if (!raw || typeof raw !== "object") return "That look didn't come through.";
  const asset = (v: any, kind?: AssetKind): Asset | null => {
    const a = assets.get(String(v?.id ?? ""));
    return a && (!kind || a.kind === kind) ? a : null;
  };
  const bg = (v: any): Background | undefined => {
    if (v?.kind === "color" && ["blue", "dark", "light"].includes(v.value)) return { kind: "color", value: v.value };
    if (v?.kind === "image") { const a = asset(v.asset, "background"); if (a) return { kind: "image", asset: a }; }
    return undefined;
  };
  const logo = (v: any) => {
    if (v === null) return null;
    const a = asset(v?.asset, "logo");
    return a ? { asset: a, corner: v.corner === "tl" ? "tl" as const : "tr" as const } : undefined;
  };
  const banners = (Array.isArray(raw.banners) ? raw.banners : []).slice(0, 10)
    .map((b: any) => ({ id: id8(b?.id) || crypto.randomBytes(4).toString("hex"), text: str(b?.text, 80), seconds: Math.max(2, Math.min(60, Math.round(Number(b?.seconds) || 6))) }))
    .filter((b: { text: string }) => b.text);
  const seen = new Set<string>();
  const scenes: Scene[] = [];
  for (const s of (Array.isArray(raw.scenes) ? raw.scenes : []).slice(0, 9)) {
    const id = id8(s?.id) || crypto.randomBytes(4).toString("hex");
    if (seen.has(id)) continue;
    seen.add(id);
    const look: SceneLook = {};
    if (s?.look && typeof s.look === "object") {
      const b = bg(s.look.background); if (b) look.background = b;
      const l = logo(s.look.logo); if (l !== undefined) look.logo = l;
      if (typeof s.look.banner === "string" && banners.some((x: { id: string }) => x.id === s.look.banner)) look.banner = s.look.banner;
    }
    scenes.push({
      id, n: scenes.length + 1, name: str(s?.name, 30) || `Scene ${scenes.length + 1}`,
      layout: LAYOUTS.includes(s?.layout) ? s.layout : "side",
      stage: (Array.isArray(s?.stage) ? s.stage : []).map((x: unknown) => str(x, 80)).filter(Boolean).slice(0, 12),
      ...(Object.keys(look).length ? { look } : {}),
    });
  }
  if (!scenes.length) return "Keep at least one scene.";
  const onStage = scenes.some((s) => s.id === raw.onStage) ? String(raw.onStage) : scenes[0].id;
  const intro = raw.intro ? asset(raw.intro, "intro") : null;
  const outro = raw.outro ? asset(raw.outro, "outro") : null;
  return {
    rev: 0,
    background: bg(raw.background) ?? { kind: "color", value: "blue" },
    logo: logo(raw.logo) ?? null,
    logos: (Array.isArray(raw.logos) ? raw.logos : []).map((v: any) => asset(v, "logo")).filter(Boolean).slice(0, 6) as Asset[],
    banners,
    intro, outro, scenes, onStage,
    showing: raw.showing && banners.some((b: { id: string }) => b.id === raw.showing.bannerId) && !Number.isNaN(Date.parse(raw.showing.until)) ? { bannerId: raw.showing.bannerId, until: new Date(raw.showing.until).toISOString() } : null,
  };
}

async function assetsOf(studioId: number): Promise<Map<string, Asset>> {
  const rows = await db.select().from(roomAssets).where(eq(roomAssets.studioId, studioId)).orderBy(asc(roomAssets.createdAt));
  return new Map(rows.map((a) => [a.id, toAsset(a)]));
}

/** What goes on the LiveKit room: the look without the logo shelf. A few KB at most. */
const metaLook = (l: Look) => ({ rev: l.rev, background: l.background, logo: l.logo, banners: l.banners, intro: l.intro, outro: l.outro, scenes: l.scenes, onStage: l.onStage, showing: l.showing });

/** Puts the look on the room (merged with whatever else is there). The room may not exist until someone joins. */
export async function pushLookToRoom(studioId: number, look?: Look): Promise<void> {
  if (!isLiveKitConfigured()) return;
  const l = look ?? (await getLook(studioId));
  const name = `my-${studioId}`;
  try {
    const [r] = await rooms().listRooms([name]);
    if (!r) return;
    let meta: Record<string, unknown> = {};
    try { meta = r.metadata ? JSON.parse(r.metadata) : {}; } catch { /* not ours */ }
    await rooms().updateRoomMetadata(name, JSON.stringify({ ...meta, look: metaLook(l) }));
  } catch (err) {
    console.warn("Room look to LiveKit failed:", (err as Error).message);
  }
}

/** Saves the look if rev matches; null when someone saved first. */
async function saveLook(studioId: number, rev: number, look: Look): Promise<Look | null> {
  const next = { ...look, rev: rev + 1 };
  const body = JSON.stringify({ ...next, rev: undefined });
  if (rev === 0) {
    const [made] = await db.insert(roomLooks).values({ studioId, look: body, rev: 1, updatedAt: now() }).onConflictDoNothing().returning();
    if (!made) return null;
  } else {
    const [out] = await db.update(roomLooks).set({ look: body, rev: rev + 1, updatedAt: now() }).where(and(eq(roomLooks.studioId, studioId), eq(roomLooks.rev, rev))).returning();
    if (!out) return null;
  }
  void pushLookToRoom(studioId, next);
  return next;
}

const clock = (sec: number) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`; };

/** A recording's marks, in seconds, for the clip job. */
export async function marksFor(recordingId: number): Promise<number[]> {
  const rows = await db.select({ atSec: roomMarks.atSec }).from(roomMarks).where(eq(roomMarks.recordingId, recordingId)).orderBy(asc(roomMarks.atSec));
  return rows.map((r) => r.atSec);
}

export function registerRoomKit(app: Express, requireHostSession: RequestHandler): void {
  // ---- the look ----
  app.put("/api/host/my-studio/look", requireHostSession, async (req, res) => {
    const s = await studioOf(me(req));
    if (!s) return res.status(404).json({ message: "Open your room first." });
    const cur = await getLook(s.id);
    const rev = Number(req.body?.rev);
    if (rev !== cur.rev) return res.status(409).json({ message: "Your look changed in another window. Here's the latest.", look: cur });
    const look = clean(req.body?.look, await assetsOf(s.id));
    if (typeof look === "string") return res.status(400).json({ message: look });
    const out = await saveLook(s.id, cur.rev, look);
    if (!out) return res.status(409).json({ message: "Your look changed in another window. Here's the latest.", look: await getLook(s.id) });
    res.json({ look: out });
  });

  /** The one way to change the scene on air. */
  app.post("/api/host/my-studio/stage", requireHostSession, async (req, res) => {
    const s = await studioOf(me(req));
    if (!s) return res.status(404).json({ message: "Open your room first." });
    for (let i = 0; i < 3; i++) {
      const cur = await getLook(s.id);
      const scene = cur.scenes.find((x) => x.id === req.body?.sceneId) ?? cur.scenes.find((x) => x.n === Number(req.body?.n));
      if (!scene) return res.status(404).json({ message: "No such scene." });
      if (cur.onStage === scene.id) return res.json({ look: cur });
      const out = await saveLook(s.id, cur.rev, { ...cur, onStage: scene.id });
      if (out) return res.json({ look: out });
    }
    res.status(409).json({ message: "Try that again.", look: await getLook(s.id) });
  });

  /** A banner on screen for its seconds, or off (bannerId null). */
  app.post("/api/host/my-studio/banner", requireHostSession, async (req, res) => {
    const s = await studioOf(me(req));
    if (!s) return res.status(404).json({ message: "Open your room first." });
    for (let i = 0; i < 3; i++) {
      const cur = await getLook(s.id);
      const b = req.body?.bannerId ? cur.banners.find((x) => x.id === req.body.bannerId) : null;
      if (req.body?.bannerId && !b) return res.status(404).json({ message: "No such banner." });
      const out = await saveLook(s.id, cur.rev, { ...cur, showing: b ? { bannerId: b.id, until: new Date(Date.now() + b.seconds * 1000).toISOString() } : null });
      if (out) return res.json({ look: out });
    }
    res.status(409).json({ message: "Try that again.", look: await getLook(s.id) });
  });

  /** For the recording page and guests: no login, the room's key. */
  app.get("/api/my-studio/:id/look", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !keyOk(id, req.query.t)) return res.status(404).json({ message: "Not found." });
    res.json({ look: metaLook(await getLook(id)) });
  });

  // ---- files ----
  app.post("/api/host/my-studio/assets", requireHostSession, async (req, res) => {
    const s = await studioOf(me(req));
    if (!s) return res.status(404).json({ message: "Open your room first." });
    const key = String(req.body?.storageKey ?? "");
    const kind = String(req.body?.kind ?? "") as AssetKind;
    if (!/^show-assets\/[\w.-]+$/.test(key) || !KINDS.includes(kind)) return res.status(400).json({ message: "That file didn't come through." });
    // What's really there: its type and size from storage, not from the browser.
    let mime = "", size = 0;
    try {
      const r = await fetch(await signedRecordingUrl(key, 300), { headers: { Range: "bytes=0-0" } });
      mime = (r.headers.get("content-type") ?? "").split(";")[0].trim();
      size = Number((r.headers.get("content-range") ?? "").split("/")[1]) || Number(r.headers.get("content-length")) || 0;
      if (!r.ok) throw new Error(String(r.status));
    } catch {
      return res.status(400).json({ message: "We couldn't find that file. Upload it again." });
    }
    const image = /^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(mime);
    const media = /^(video|audio)\//.test(mime);
    if ((kind === "logo" || kind === "background") && !image) return res.status(400).json({ message: "Use a picture: PNG, JPG, WebP or SVG." });
    if ((kind === "intro" || kind === "outro") && !media) return res.status(400).json({ message: "Use a video or audio file." });
    if (image && size > 10 * 1024 * 1024) return res.status(400).json({ message: "That picture is over 10 MB. Use a smaller one." });
    if (media && size > 500 * 1024 * 1024) return res.status(400).json({ message: "That file is over 500 MB. Use a shorter or smaller one." });
    const sec = Math.max(0, Math.min(3600, Math.round(Number(req.body?.sec) || 0)));
    const [a] = await db.insert(roomAssets).values({
      id: crypto.randomBytes(12).toString("base64url"), studioId: s.id, kind, name: str(req.body?.name, 80), storageKey: key, mime, sizeBytes: size, sec, createdAt: now(),
    }).returning();
    res.json({ asset: toAsset(a) });
  });

  app.delete("/api/host/my-studio/assets/:assetId", requireHostSession, async (req, res) => {
    const s = await studioOf(me(req));
    if (!s) return res.status(404).json({ message: "Open your room first." });
    const [gone] = await db.delete(roomAssets).where(and(eq(roomAssets.studioId, s.id), eq(roomAssets.id, String(req.params.assetId)))).returning();
    if (!gone) return res.status(404).json({ message: "No such file." });
    // Out of the look wherever it was used.
    for (let i = 0; i < 3; i++) {
      const cur = await getLook(s.id);
      if (cur.rev === 0) break;
      const fixed = clean(cur, await assetsOf(s.id));
      if (typeof fixed === "string" || (await saveLook(s.id, cur.rev, fixed))) break;
    }
    res.json({ ok: true });
  });

  /** A room's file, for anyone with its link (the recording page has no login). */
  app.get("/api/my-studio/:id/asset/:assetId", async (req, res) => {
    await schemaIsReady();
    const [a] = await db.select().from(roomAssets).where(and(eq(roomAssets.studioId, Number(req.params.id) || 0), eq(roomAssets.id, String(req.params.assetId)))).limit(1);
    if (!a) return res.status(404).type("text/plain").send("Not found.");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.redirect(302, await signedRecordingUrl(a.storageKey, 6 * 3600));
  });

  // ---- Mark a clip ----
  app.post("/api/host/my-studio/mark", requireHostSession, async (req, res) => {
    const email = me(req);
    const s = await studioOf(email);
    if (!s?.recordingEgressId || !s.recordingSince) return res.status(409).json({ message: "Start recording first, then mark a clip." });
    const [rec] = await db.select({ id: recordings.id }).from(recordings).where(eq(recordings.egressId, s.recordingEgressId)).limit(1);
    if (!rec) return res.status(409).json({ message: "Start recording first, then mark a clip." });
    const atSec = Math.max(0, Math.round((Date.now() - Date.parse(s.recordingSince)) / 1000));
    const [m] = await db.insert(roomMarks).values({ studioId: s.id, recordingId: rec.id, email, atSec, createdAt: now() }).returning();
    res.json({ id: m.id, recordingId: rec.id, atSec, label: clock(atSec) });
  });

  app.delete("/api/host/my-studio/mark/:id", requireHostSession, async (req, res) => {
    const [gone] = await db.delete(roomMarks).where(and(eq(roomMarks.id, Number(req.params.id) || 0), eq(roomMarks.email, me(req)))).returning();
    if (!gone) return res.status(404).json({ message: "No such mark." });
    res.json({ ok: true });
  });

  app.get("/api/host/recordings/:id/marks", requireHostSession, async (req, res) => {
    await schemaIsReady();
    const rows = await db.select().from(roomMarks).where(and(eq(roomMarks.recordingId, Number(req.params.id) || 0), eq(roomMarks.email, me(req)))).orderBy(asc(roomMarks.atSec));
    res.json(rows.map((m) => ({ id: m.id, atSec: m.atSec, label: clock(m.atSec) })));
  });
}
