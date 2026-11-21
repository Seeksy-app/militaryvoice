// Room phase 2 (20 Nov 2026), the data side: a creator's room look and its scenes, the files it
// uses (logo, background, intro, outro), and "Mark a clip" while recording.
//
// - The look is one JSON document per room (room_looks), saved whole on every change with a rev. It holds
//   the scene DEFINITIONS only: which scene is on air, and a banner showing, are live state, Engineering's,
//   in the LiveKit room metadata (server/roomStage.ts). onLookSaved() lets them hear about each save.
// - The recording page (/room/composite) has no login: it reads the look with the room's HMAC key
//   (GET /api/room/:studioId/look?k=, key from roomLookKey()).
// - Files go up with the usual R2 browser upload, then are registered here. Their URLs are stable
//   (/api/room-assets/:id → a fresh signed R2 link each time), so a long show never holds an expired
//   link. Asset ids are random: the URL is the permission.
// - Marks are seconds from the recording's start, by the server's clock. A Pōstify clip job on
//   that recording carries them (options.marks) and the moment picker builds clips around them.
import type { Express, Request, RequestHandler } from "express";
import crypto from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db, schemaIsReady } from "./storage.js";
import { getSessionEmail } from "./session.js";
import { signedRecordingUrl } from "./recordingStorage.js";
import { personalStudios, recordings, roomAssets, roomLooks, roomMarks, type PersonalStudioRow, type RoomAssetRow } from "../shared/schema.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const SECRET = process.env.SESSION_SECRET || "dev-only-insecure-secret-change-me";
const now = () => new Date().toISOString();
const me = (req: Request) => (getSessionEmail(req) ?? "").trim().toLowerCase();

export type Layout = "solo" | "side" | "grid" | "speaker" | "screen" | "pip";
const LAYOUTS: Layout[] = ["solo", "side", "grid", "speaker", "screen", "pip"];
// Contract v3 (Studio phase 3, Andrew's OK 21 Nov): files can also be video clips, sounds, music and a
// profile photo.
export type AssetKind = "logo" | "background" | "intro" | "outro" | "video" | "sound" | "music" | "photo";
const KINDS: AssetKind[] = ["logo", "background", "intro", "outro", "video", "sound", "music", "photo"];
export type Asset = { id: string; kind: AssetKind; name: string; mime: string; sec: number; url: string };
type Background = { kind: "color"; value: "blue" | "dark" | "light" } | { kind: "image"; asset: Asset };
type SceneLook = { background?: Background; logo?: { asset: Asset; corner: "tl" | "tr" } | null; banner?: string };

/**
 * v3 scene type and people on stage (Andrew, 21 Nov: "people per scene", on every scene, editable; never a
 * cap on how many scenes). Media is 0 by default (the media fills the scene); 1+ are tiles over it.
 */
export type SceneType = "single" | "two" | "group" | "media" | "profile";
const SCENE_TYPES: SceneType[] = ["single", "two", "group", "media", "profile"];
export const PEOPLE_DEFAULT: Record<SceneType, number> = { single: 1, two: 2, group: 3, media: 0, profile: 1 };
/** The profile scene: one person's card. Links are shown, not clickable (print only). */
export type Profile = { photo: Asset | null; name: string; title: string; line: string; links: string[] };
export type Scene = {
  id: string; n: number; name: string; layout: Layout; stage: string[];
  type: SceneType; people: number;
  /** look.background is always set in v3 (every scene has its own background). */
  look?: SceneLook;
  profile?: Profile;
};

/** v3 style: one set for the whole studio. Fonts are a short hosted list, OFL only. */
export const FONTS = ["Inter", "Montserrat", "Oswald", "Bebas Neue", "Source Sans 3", "Merriweather", "Playfair Display", "Roboto Slab"] as const;
export type Style = {
  preset: string;
  brandColor: string;
  nameTag: "bar" | "pill" | "block" | "plain";
  showNames: boolean;
  textSize: "s" | "m" | "l";
  font: (typeof FONTS)[number];
};
const freshStyle = (): Style => ({ preset: "classic", brandColor: "#F0A71F", nameTag: "bar", showNames: true, textSize: "m", font: "Inter" });

/** Media → Video clips: uploads (intro and outro are just tagged ones), each with its own Loop. */
export type VideoClip = { asset: Asset; role: "" | "intro" | "outro"; loop: boolean };
/** Sounds play once; music is a bed. Volume 0–100. */
export type SoundItem = { asset: Asset; volume: number };
export type MusicItem = { asset: Asset; volume: number; loop: boolean };
/**
 * Our built-in cards, drawn live on the stage and the recording in the owner's look (UI/UX spec, 21 Nov):
 * never files. The countdown's minutes are chosen when it's played (live state, Engineering's), and it
 * ends on "We're starting": the host takes the next scene (never a switch on the clock).
 */
export const CARDS = [
  { id: "brb", title: "Be right back" },
  { id: "starting", title: "Starting soon" },
  { id: "thanks", title: "Thank you for watching" },
  { id: "countdown", title: "We're starting" },
] as const;

export type Look = {
  rev: number;
  /** v3: the background a NEW scene starts with (and the fallback); each scene carries its own. */
  background: Background;
  logo: { asset: Asset; corner: "tl" | "tr" } | null;
  logos: Asset[];
  /** Uploaded background pictures to pick from. */
  backgrounds: Asset[];
  banners: { id: string; text: string; seconds: number }[];
  /** Kept for the players that know intro/outro: always the videos tagged intro and outro. */
  intro: Asset | null;
  outro: Asset | null;
  scenes: Scene[];
  style: Style;
  videos: VideoClip[];
  sounds: SoundItem[];
  music: MusicItem[];
  cards: typeof CARDS;
};

const freshLook = (): Look => ({
  rev: 0,
  background: { kind: "color", value: "blue" },
  logo: null,
  logos: [],
  backgrounds: [],
  banners: [],
  intro: null,
  outro: null,
  scenes: [
    { id: "s1", n: 1, name: "Just us", layout: "side", stage: [], type: "two", people: 2, look: { background: { kind: "color", value: "blue" } } },
    { id: "s2", n: 2, name: "Sharing a screen", layout: "screen", stage: [], type: "media", people: 1, look: { background: { kind: "color", value: "blue" } } },
  ],
  style: freshStyle(),
  videos: [],
  sounds: [],
  music: [],
  cards: CARDS,
});

/** A scene type from a v2 layout, for looks saved before v3. */
const typeFromLayout = (l: Layout): SceneType => (l === "solo" || l === "speaker" ? "single" : l === "side" ? "two" : l === "grid" ? "group" : "media");
const peopleRange = (t: SceneType, n: number) => Math.max(t === "media" ? 0 : 1, Math.min(9, Math.round(n)));

/** v2 → v3 on read: every scene gets a type, people and its own background; intro/outro become video clips. */
export function upgrade(l: Look): Look {
  const scenes = l.scenes.map((s) => {
    const type = SCENE_TYPES.includes(s.type) ? s.type : typeFromLayout(s.layout);
    const people = Number.isFinite(s.people) ? peopleRange(type, s.people) : type === "group" ? Math.max(3, Math.min(9, s.stage.length || 3)) : PEOPLE_DEFAULT[type];
    return { ...s, type, people, look: { ...(s.look ?? {}), background: s.look?.background ?? l.background } };
  });
  let videos = Array.isArray(l.videos) ? l.videos : [];
  for (const role of ["intro", "outro"] as const) {
    const a = l[role];
    if (a && !videos.some((v) => v.role === role)) videos = [...videos, { asset: a, role, loop: false }];
  }
  return { ...l, scenes, videos, style: { ...freshStyle(), ...(l.style ?? {}) }, sounds: l.sounds ?? [], music: l.music ?? [], cards: CARDS };
}

/** The key the recording page passes to read a room's look without a login. */
export const roomLookKey = (studioId: number) => crypto.createHmac("sha256", SECRET).update(`room-look:${studioId}`).digest("base64url").slice(0, 24);
const keyOk = (studioId: number, k: unknown) => {
  const want = Buffer.from(roomLookKey(studioId));
  const got = Buffer.from(String(k ?? ""));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
};
const assetUrl = (id: string) => `${ORIGIN}/api/room-assets/${id}`;
const toAsset = (a: RoomAssetRow): Asset => ({ id: a.id, kind: a.kind as AssetKind, name: a.name, mime: a.mime, sec: a.sec, url: assetUrl(a.id) });

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
  try { return upgrade({ ...freshLook(), ...(JSON.parse(row.look) as Partial<Look>), rev: row.rev }); } catch { return { ...freshLook(), rev: row.rev }; }
}

// ---- checking what the client sends: only known shapes, short strings, our own assets ----
const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const id8 = (v: unknown) => (/^[\w-]{1,24}$/.test(String(v ?? "")) ? String(v) : "");

export function clean(raw: any, assets: Map<string, Asset>): Look | string {
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
  const fallbackBg: Background = bg(raw.background) ?? { kind: "color", value: "blue" };
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
    const layout: Layout = LAYOUTS.includes(s?.layout) ? s.layout : "side";
    const type: SceneType = SCENE_TYPES.includes(s?.type) ? s.type : typeFromLayout(layout);
    const people = Number.isFinite(Number(s?.people)) && s?.people !== null && s?.people !== "" ? peopleRange(type, Number(s.people))
      : type === "group" && Array.isArray(s?.stage) && s.stage.length ? Math.max(3, Math.min(9, s.stage.length)) : PEOPLE_DEFAULT[type];
    // Every scene has its own background (v3); one that came without gets the starting one.
    look.background = look.background ?? fallbackBg;
    const p = s?.profile;
    const profile: Profile | undefined = type === "profile" && p && typeof p === "object" ? {
      photo: p.photo ? asset(p.photo, "photo") ?? asset(p.photo, "logo") : null,
      name: str(p.name, 60), title: str(p.title, 80), line: str(p.line, 140),
      links: (Array.isArray(p.links) ? p.links : []).map((u: unknown) => str(u, 200)).filter((u: string) => /^https:\/\/[^\s]+\.[^\s]+$/.test(u)).slice(0, 3),
    } : undefined;
    scenes.push({
      id, n: scenes.length + 1, name: str(s?.name, 30) || `Scene ${scenes.length + 1}`,
      layout,
      stage: (Array.isArray(s?.stage) ? s.stage : []).map((x: unknown) => str(x, 80)).filter(Boolean).slice(0, 12),
      type, people,
      look,
      ...(profile ? { profile } : {}),
    });
  }
  if (!scenes.length) return "Keep at least one scene.";

  // Video clips: intro and outro are tagged uploads (one of each at most); old looks sent intro/outro.
  const roles = new Set<string>();
  const videos: VideoClip[] = [];
  for (const v of (Array.isArray(raw.videos) ? raw.videos : []).slice(0, 12)) {
    const a = asset(v?.asset);
    if (!a || !["video", "intro", "outro"].includes(a.kind) || videos.some((x) => x.asset.id === a.id)) continue;
    let role: VideoClip["role"] = v?.role === "intro" || v?.role === "outro" ? v.role : "";
    if (role && roles.has(role)) role = "";
    if (role) roles.add(role);
    videos.push({ asset: a, role, loop: v?.loop === true });
  }
  for (const role of ["intro", "outro"] as const) {
    const a = raw[role] ? asset(raw[role], role) : null;
    if (a && !roles.has(role) && !raw.videos) { videos.push({ asset: a, role, loop: false }); roles.add(role); }
  }
  const vol = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.max(0, Math.min(100, Math.round(Number(v)))) : d);
  const sounds: SoundItem[] = (Array.isArray(raw.sounds) ? raw.sounds : []).slice(0, 12)
    .map((v: any) => { const a = asset(v?.asset, "sound"); return a ? { asset: a, volume: vol(v?.volume, 80) } : null; }).filter(Boolean) as SoundItem[];
  const music: MusicItem[] = (Array.isArray(raw.music) ? raw.music : []).slice(0, 12)
    .map((v: any) => { const a = asset(v?.asset, "music"); return a ? { asset: a, volume: vol(v?.volume, 25), loop: v?.loop !== false } : null; }).filter(Boolean) as MusicItem[];

  const st = raw.style && typeof raw.style === "object" ? raw.style : {};
  const base = freshStyle();
  const style: Style = {
    preset: id8(st.preset) || base.preset,
    brandColor: /^#[0-9a-fA-F]{6}$/.test(String(st.brandColor ?? "")) ? String(st.brandColor).toUpperCase() : base.brandColor,
    nameTag: ["bar", "pill", "block", "plain"].includes(st.nameTag) ? st.nameTag : base.nameTag,
    showNames: st.showNames !== false,
    textSize: ["s", "m", "l"].includes(st.textSize) ? st.textSize : base.textSize,
    font: (FONTS as readonly string[]).includes(st.font) ? st.font : base.font,
  };
  const pick = (role: "intro" | "outro") => videos.find((v) => v.role === role)?.asset ?? null;
  return {
    rev: 0,
    background: fallbackBg,
    logo: logo(raw.logo) ?? null,
    logos: (Array.isArray(raw.logos) ? raw.logos : []).map((v: any) => asset(v, "logo")).filter(Boolean).slice(0, 6) as Asset[],
    backgrounds: (Array.isArray(raw.backgrounds) ? raw.backgrounds : []).map((v: any) => asset(v, "background")).filter(Boolean).slice(0, 6) as Asset[],
    banners,
    intro: pick("intro"), outro: pick("outro"), scenes,
    style, videos, sounds, music, cards: CARDS,
  };
}

async function assetsOf(studioId: number): Promise<Map<string, Asset>> {
  const rows = await db.select().from(roomAssets).where(eq(roomAssets.studioId, studioId)).orderBy(asc(roomAssets.createdAt));
  return new Map(rows.map((a) => [a.id, toAsset(a)]));
}

/** Engineering's hook (server/roomStage.ts): told after every save, e.g. to refresh a room that's live. */
type LookListener = (studioId: number, look: Look) => void | Promise<void>;
const listeners: LookListener[] = [];
export function onLookSaved(fn: LookListener): void { listeners.push(fn); }

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
  for (const fn of listeners) Promise.resolve().then(() => fn(studioId, next)).catch((e) => console.warn("onLookSaved:", (e as Error).message));
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
  app.get("/api/host/room/look", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const s = await studioOf(me(req));
    if (!s) return res.status(404).json({ message: "Open your studio first." });
    res.json({ look: await getLook(s.id) });
  });

  app.put("/api/host/room/look", requireHostSession, async (req, res) => {
    const s = await studioOf(me(req));
    if (!s) return res.status(404).json({ message: "Open your studio first." });
    const cur = await getLook(s.id);
    const rev = Number(req.body?.rev);
    if (rev !== cur.rev) return res.status(409).json({ message: "Your look changed in another window. Here's the latest.", look: cur });
    const look = clean(req.body?.look, await assetsOf(s.id));
    if (typeof look === "string") return res.status(400).json({ message: look });
    const out = await saveLook(s.id, cur.rev, look);
    if (!out) return res.status(409).json({ message: "Your look changed in another window. Here's the latest.", look: await getLook(s.id) });
    res.json({ look: out });
  });

  /** For the recording page and guests: no login, the room's key. */
  app.get("/api/room/:studioId/look", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const id = Number(req.params.studioId);
    if (!Number.isInteger(id) || !keyOk(id, req.query.k)) return res.status(404).json({ message: "Not found." });
    const { logos: _logos, backgrounds: _backgrounds, ...look } = await getLook(id);
    res.json({ look });
  });

  // ---- files ----
  app.post("/api/host/room/assets", requireHostSession, async (req, res) => {
    const s = await studioOf(me(req));
    if (!s) return res.status(404).json({ message: "Open your studio first." });
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
    const audio = /^audio\//.test(mime);
    if ((kind === "logo" || kind === "background" || kind === "photo") && !image) return res.status(400).json({ message: "Use a picture: PNG, JPG, WebP or SVG." });
    if ((kind === "intro" || kind === "outro" || kind === "video") && !media) return res.status(400).json({ message: "Use a video or audio file." });
    if ((kind === "sound" || kind === "music") && !audio) return res.status(400).json({ message: "Use an audio file: MP3, WAV or M4A." });
    // Their own clips, sounds and music (v3): they confirm they have the rights ("I have the rights to use this").
    if ((kind === "video" || kind === "sound" || kind === "music") && req.body?.rights !== true) return res.status(400).json({ message: "Tick \"I have the rights to use this\" first." });
    if (image && size > 10 * 1024 * 1024) return res.status(400).json({ message: "That picture is over 10 MB. Use a smaller one." });
    if (media && size > 500 * 1024 * 1024) return res.status(400).json({ message: "That file is over 500 MB. Use a shorter or smaller one." });
    const sec = Math.max(0, Math.min(3600, Math.round(Number(req.body?.sec) || 0)));
    const [a] = await db.insert(roomAssets).values({
      id: crypto.randomBytes(12).toString("base64url"), studioId: s.id, kind, name: str(req.body?.name, 80), storageKey: key, mime, sizeBytes: size, sec, createdAt: now(),
    }).returning();
    res.json({ asset: toAsset(a) });
  });

  app.delete("/api/host/room/assets/:assetId", requireHostSession, async (req, res) => {
    const s = await studioOf(me(req));
    if (!s) return res.status(404).json({ message: "Open your studio first." });
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
  app.get("/api/room-assets/:assetId", async (req, res) => {
    await schemaIsReady();
    const [a] = await db.select().from(roomAssets).where(eq(roomAssets.id, String(req.params.assetId))).limit(1);
    if (!a) return res.status(404).type("text/plain").send("Not found.");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.redirect(302, await signedRecordingUrl(a.storageKey, 6 * 3600));
  });

  // ---- Mark a clip ----
  app.post("/api/host/room/mark", requireHostSession, async (req, res) => {
    const email = me(req);
    const s = await studioOf(email);
    if (!s?.recordingEgressId || !s.recordingSince) return res.status(409).json({ message: "Start recording first, then mark a clip." });
    const [rec] = await db.select({ id: recordings.id }).from(recordings).where(eq(recordings.egressId, s.recordingEgressId)).limit(1);
    if (!rec) return res.status(409).json({ message: "Start recording first, then mark a clip." });
    const atSec = Math.max(0, Math.round((Date.now() - Date.parse(s.recordingSince)) / 1000));
    const [m] = await db.insert(roomMarks).values({ studioId: s.id, recordingId: rec.id, email, atSec, createdAt: now() }).returning();
    res.json({ id: m.id, recordingId: rec.id, atSec, label: clock(atSec) });
  });

  app.delete("/api/host/room/mark/:id", requireHostSession, async (req, res) => {
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
