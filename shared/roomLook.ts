// The Room's look and live state, as the recorded and streamed picture reads them.
//
// Two sources, kept apart on purpose:
//   - the LOOK is Podcasting's (scenes, background, logo, banners, intro and outro), saved and
//     served by them (GET /api/room/:studioId/look?k=<key>); this file only describes its shape;
//   - the LIVE state is ours, on the LiveKit room metadata: which scene is on, which banner is
//     showing, which clip is playing, and a small lookRev that says "fetch the look again".
// roomStageMeta() joins the two into what the stage renderer (StageGrid) draws.

/** The layouts in the Room's picker. */
export type RoomLayoutKey = "solo" | "side" | "grid" | "speaker" | "screen" | "pip";

/** An uploaded file; url is a stable link that needs no login (Podcasting's /api/room-assets/:id). */
export interface RoomAsset {
  id?: string;
  kind?: string;
  name?: string;
  mime?: string;
  url: string;
  sec?: number;
}

/** A background: a named colour (blue, dark, light) or a picture (Podcasting's shape). */
export type RoomBackground = { kind: "color"; value: string } | { kind: "image"; asset: RoomAsset };

export interface RoomLookStyle {
  background?: RoomBackground;
  /** corner: tl | tr | bl | br */
  logo?: { asset: RoomAsset; corner: string } | null;
}

/** Studio v3 scene kinds. A scene without one keeps its layout, as before. */
export type RoomSceneType = "single" | "two" | "group" | "media" | "profile";

/** A guest's card, drawn full frame (v3 "profile" scene). */
export interface RoomProfile {
  who?: string;
  name?: string;
  title?: string;
  line?: string;
  links?: string[];
  photo?: RoomAsset | null;
}

/**
 * A box in a scene's own layout (the layout editor, Andrew 21 Nov: "Yes" to the StreamYard-style
 * mockup). x, y, w, h are fractions of the 16:9 frame, so the same layout draws at any size. In a
 * 16:9 frame a 16:9 box has w === h. Later boxes sit on top.
 * - camera: one person. who = "host", "next" (whoever is on stage and not in another box), or a
 *   participant identity.
 * - media: the scene's picture, clip or current slide (scene.media). Empty = not drawn.
 * - grid: everyone on stage not already in a box, in order. Nobody is left off by accident.
 */
export type RoomBoxKind = "camera" | "media" | "grid";
export type RoomBoxShape = "rounded" | "square" | "circle";
export interface RoomBox {
  id: string;
  kind: RoomBoxKind;
  x: number;
  y: number;
  w: number;
  h: number;
  who?: string;
  shape?: RoomBoxShape;
  /** cover = fill the box (cameras' default); contain = show all (media's default). */
  fit?: "cover" | "contain";
}
export const BOX_LIMIT = 9;
/** The smallest a box can be, as a share of the frame. */
export const BOX_MIN = 0.06;

export interface RoomScene {
  id: string;
  n?: number;
  name: string;
  layout: RoomLayoutKey;
  /** v3: the scene's own layout. Present and non-empty = it replaces the type's layout. */
  boxes?: RoomBox[];
  /** Guest identities shown in this scene; [] means everyone. The host is always shown. */
  stage?: string[];
  /** Overrides for this scene only. */
  look?: RoomLookStyle;
  type?: RoomSceneType;
  /** v3: people on stage in this scene, 1 to 9 (media 0 to 9: 0 = the media fills the scene). */
  people?: number;
  /** Media scene: the picture or clip that fills the frame. */
  media?: RoomAsset | null;
  profile?: RoomProfile | null;
}

/** A sound pad or a music track (v3). source.credit is set for CC BY items (the line we must show). */
export interface RoomAudioItem { id: string; name?: string; asset?: RoomAsset | null; url?: string; source?: { licence?: string; credit?: string; [k: string]: unknown } | null }

export interface RoomStyle {
  preset?: string;
  brandColor?: string;
  nameTag?: "bar" | "pill" | "block" | "plain";
  showNames?: boolean;
  textSize?: "s" | "m" | "l";
  font?: string;
}

export interface RoomLook extends RoomLookStyle {
  scenes: RoomScene[];
  logos?: RoomAsset[];
  banners?: { id: string; text: string; seconds: number }[];
  intro?: RoomAsset | null;
  outro?: RoomAsset | null;
  /** v3: the video shelf; intro and outro are also tagged here (look.intro/outro stay equal to them). */
  videos?: { asset: RoomAsset; role?: string; loop?: boolean }[];
  sounds?: RoomAudioItem[];
  music?: RoomAudioItem[];
  /** 0 to 1; defaults 0.8 and 0.25. */
  soundVolume?: number;
  musicVolume?: number;
  /** The music bed repeats (default true). */
  musicLoop?: boolean;
  style?: RoomStyle;
  rev?: number;
}

/** The ready-made cards, drawn live in the owner's look (no video files). */
export type RoomCardSlot = "brb" | "soon" | "thanks" | "countdown";
export const ROOM_CARD_SLOTS: RoomCardSlot[] = ["brb", "soon", "thanks", "countdown"];

/** Ours: written to the LiveKit room's metadata by the server, read by every view of the room. */
export interface RoomLive {
  activeScene?: string;
  showing?: { bannerId: string; until: number } | null;
  playing?: { slot: "intro" | "outro" | RoomCardSlot; at: number; minutes?: number; next?: string } | null;
  lookRev?: number;
  /** v3: a sound pad pressed (plays once per `at`), and the music bed on air. The player bot plays both. */
  sound?: { id: string; at: number } | null;
  music?: { id: string; at: number } | null;
  /** Studio v3 is switched on (the server's STUDIO_V3, written with every live-state change). Off or missing = the v2 stage. */
  v3?: boolean;
}

/** Intro or outro: the slot first, then the v3 video shelf. */
export function clipOf(look: RoomLook | null, slot: "intro" | "outro"): RoomAsset | null {
  if (!look) return null;
  if (look[slot]?.url) return look[slot] ?? null;
  const got = (look.videos ?? []).find((x) => x.role === slot)?.asset;
  return got?.url ? got : null;
}

/** A sound or music item's playable address. */
export function audioUrlOf(item: RoomAudioItem | undefined, origin = ""): string {
  return abs(item?.asset?.url ?? item?.url, origin);
}

/**
 * The credit line owed while a music track plays (CC BY: "Music: HoliznaCC0"), or "" for none.
 * Drawn on the filmed page, so recordings and live video carry it.
 */
export function musicCreditOf(look: RoomLook | null, live: RoomLive): string {
  const id = live.music?.id;
  if (!id || !look) return "";
  const credit = String((look.music ?? []).find((m) => m.id === id)?.source?.credit ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!credit) return "";
  return /^music\b/i.test(credit) ? credit : `Music: ${credit}`;
}

/** The participant the player bot joins as; never a tile, always heard. */
export const isPlayer = (identity: string, attrs?: Record<string, string>) => identity.startsWith("player-") || attrs?.role === "player";

/** The stage layouts StageView understands: contain, cover, showtime, sidebar, pip. */
export const ROOM_LAYOUT_TO_STAGE: Record<RoomLayoutKey, string> = {
  solo: "contain",
  side: "contain",
  grid: "cover",
  speaker: "sidebar",
  screen: "sidebar",
  pip: "pip",
};

const COLORS: Record<string, string> = { blue: "#0a3a8f", dark: "#101828", light: "#e8eef7" };
const CORNERS: Record<string, string> = { tl: "top-left", tr: "top-right", bl: "bottom-left", br: "bottom-right" };

export const DEFAULT_LOGO = "/logo-lockup-dark.png";

const abs = (u: string | undefined, origin: string) => (u && u.startsWith("/") && origin ? `${origin}${u}` : u || "");

function backgroundOf(b: RoomBackground | undefined | null, origin: string): string {
  if (!b) return "";
  if (b.kind === "image") return abs(b.asset?.url, origin);
  return COLORS[b.value] ?? (b.value?.startsWith("#") ? b.value : "");
}

/** What StageGrid draws, plus the banner text (StageGrid only shows its lower third over clips). */
export function roomStageMeta(look: RoomLook | null, live: RoomLive, name: string, origin = "", now = Date.now()): { meta: Record<string, unknown>; banner: string } {
  const l: RoomLook = look ?? { scenes: [] };
  const scene = l.scenes.find((s) => s.id === live.activeScene) ?? l.scenes[0];
  const style: RoomLookStyle = { ...l, ...(scene?.look ?? {}) };
  const logoUrl = style.logo === null ? "" : abs(style.logo?.asset?.url, origin) || (look ? "" : abs(DEFAULT_LOGO, origin));
  const meta: Record<string, unknown> = {
    studioName: name,
    logoUrl,
    logoCorner: CORNERS[style.logo?.corner ?? "tr"] ?? "top-right",
    logoSize: 150,
    backgroundUrl: backgroundOf(style.background, origin),
    stageLayout: ROOM_LAYOUT_TO_STAGE[scene?.layout ?? "side"],
  };
  const playing = live.playing;
  const clip = playing && (playing.slot === "intro" || playing.slot === "outro") ? clipOf(l, playing.slot) : null;
  if (playing && clip?.url) {
    meta.stageMediaPlaying = true;
    meta.stageMediaUrl = abs(clip.url, origin);
    meta.stageMediaKind = (clip.mime ?? "").startsWith("image") ? "image" : "video";
    meta.stageMediaLabel = playing.slot === "intro" ? "Intro" : "Outro";
  }
  const show = live.showing;
  const banner = show && show.until > now ? (l.banners ?? []).find((b) => b.id === show.bannerId)?.text ?? "" : "";
  return { meta, banner };
}

/**
 * Who is shown: not sent backstage (only an explicit stage = "off" hides someone, so a person who
 * joined before this existed, with no setting, is never left out of a recording), and, when the
 * scene on air names guests, only those. The host is always shown.
 */
export function shownOnStage(attrs: Record<string, string>, look: RoomLook | null, live: RoomLive): boolean {
  // The player bot is picked so its audio plays; RoomPicture never draws it.
  if (attrs.role === "player") return true;
  if (attrs.stage === "off") return false;
  if (attrs.role === "host") return true;
  const scene = look?.scenes.find((x) => x.id === live.activeScene) ?? look?.scenes[0];
  const list = scene?.stage ?? [];
  return list.length === 0 || list.includes(attrs.who ?? "");
}

/** The scene on air (the first one before the host has picked). */
export function sceneOf(look: RoomLook | null, live: RoomLive): RoomScene | undefined {
  return look?.scenes.find((s) => s.id === live.activeScene) ?? look?.scenes[0];
}

/**
 * v3: who is drawn in the scene on air, in order: the host first, then the scene's own list, then
 * everyone else. single = 1, two = 2, group = its count (3 to 6). media and profile draw nobody
 * (the card or clip fills the frame). Anyone not drawn is still heard, as before.
 */
export function castOf(people: { identity: string; host: boolean; who?: string }[], scene: RoomScene | undefined): { drawn: string[]; layout?: string } {
  const list = scene?.stage ?? [];
  const rank = (p: { identity: string; host: boolean; who?: string }) => (p.host ? -1 : (() => { const i = list.indexOf(p.who ?? p.identity); return i < 0 ? 1e6 : i; })());
  const ordered = [...people].sort((a, b) => rank(a) - rank(b) || a.identity.localeCompare(b.identity)).map((p) => p.identity);
  const n = (d: number, lo = 1) => Math.max(lo, Math.min(9, Math.round(Number.isFinite(Number(scene?.people)) ? Number(scene?.people) : d)));
  switch (scene?.type) {
    case "single": return { drawn: ordered.slice(0, n(1)), layout: "contain" };
    case "two": return { drawn: ordered.slice(0, n(2)), layout: "contain" };
    case "group": return { drawn: ordered.slice(0, n(3)), layout: "cover" };
    // Media: 0 people = the media fills the frame; 1 or more = their tiles beside it.
    case "media": return { drawn: ordered.slice(0, n(0, 0)) };
    case "profile": return { drawn: [] };
    default: return { drawn: ordered };
  }
}

type CastPerson = { identity: string; host: boolean; who?: string };

/**
 * Who fills each box of a scene's own layout. Pinned boxes first (the host, a named person), then
 * each "next" box takes the next person in the scene's order who isn't in a box yet, then the
 * first grid takes everyone left (up to 9). A box with nobody for it stays empty and isn't drawn;
 * anyone in no box is still heard.
 */
export function boxCast(people: CastPerson[], scene: RoomScene | undefined): { byBox: Record<string, string[]>; drawn: string[] } {
  const boxes = scene?.boxes ?? [];
  const list = scene?.stage ?? [];
  const rank = (p: CastPerson) => (p.host ? -1 : (() => { const i = list.indexOf(p.who ?? p.identity); return i < 0 ? 1e6 : i; })());
  const ordered = [...people].sort((a, b) => rank(a) - rank(b) || a.identity.localeCompare(b.identity));
  const used = new Set<string>();
  const byBox: Record<string, string[]> = {};
  for (const b of boxes) {
    if (b.kind !== "camera" || !b.who || b.who === "next") continue;
    const p = b.who === "host" ? ordered.find((x) => x.host && !used.has(x.identity)) : ordered.find((x) => (x.who ?? x.identity) === b.who || x.identity === b.who);
    if (p && !used.has(p.identity)) { byBox[b.id] = [p.identity]; used.add(p.identity); }
  }
  for (const b of boxes) {
    if (b.kind !== "camera" || (b.who && b.who !== "next")) continue;
    const p = ordered.find((x) => !used.has(x.identity));
    if (p) { byBox[b.id] = [p.identity]; used.add(p.identity); }
  }
  const grid = boxes.find((b) => b.kind === "grid");
  if (grid) {
    const rest = ordered.filter((x) => !used.has(x.identity)).slice(0, 9).map((x) => x.identity);
    if (rest.length) { byBox[grid.id] = rest; rest.forEach((x) => used.add(x)); }
  }
  return { byBox, drawn: ordered.filter((x) => used.has(x.identity)).map((x) => x.identity) };
}

/**
 * Columns for n 16:9 pictures in a box `aspect` (its width / height, in pixels) times as wide as
 * tall: the count that makes each picture biggest.
 */
export function gridColumns(n: number, aspect: number): number {
  let best = 1, size = 0;
  for (let c = 1; c <= Math.max(1, n); c++) {
    const r = Math.ceil(n / c);
    const s = Math.min(aspect / c, (1 / r) * (16 / 9));
    if (s > size + 1e-9) { size = s; best = c; }
  }
  return best;
}

/** "Start from a layout": ready-made boxes the editor drops in. */
export const BOX_PRESETS: { id: string; label: string; boxes: Omit<RoomBox, "id">[] }[] = [
  { id: "solo", label: "Solo", boxes: [{ kind: "camera", who: "next", x: 0.03, y: 0.05, w: 0.94, h: 0.9, shape: "rounded" }] },
  { id: "side", label: "Side by side", boxes: [
    { kind: "camera", who: "host", x: 0.03, y: 0.27, w: 0.46, h: 0.46, shape: "rounded" },
    { kind: "camera", who: "next", x: 0.51, y: 0.27, w: 0.46, h: 0.46, shape: "rounded" },
  ] },
  { id: "grid", label: "Grid", boxes: [{ kind: "grid", x: 0.03, y: 0.05, w: 0.94, h: 0.9, shape: "rounded" }] },
  { id: "pip", label: "Corner camera", boxes: [
    { kind: "camera", who: "next", x: 0.03, y: 0.05, w: 0.94, h: 0.9, shape: "rounded" },
    { kind: "camera", who: "host", x: 0.71, y: 0.64, w: 0.24, h: 0.24, shape: "rounded" },
  ] },
  { id: "media2", label: "Media + 2", boxes: [
    { kind: "media", x: 0.03, y: 0.06, w: 0.64, h: 0.88, shape: "rounded", fit: "contain" },
    { kind: "camera", who: "host", x: 0.69, y: 0.06, w: 0.28, h: 0.43, shape: "rounded" },
    { kind: "camera", who: "next", x: 0.69, y: 0.51, w: 0.28, h: 0.43, shape: "rounded" },
  ] },
  { id: "mediagrid", label: "Media + grid", boxes: [
    { kind: "media", x: 0.03, y: 0.04, w: 0.94, h: 0.68, shape: "rounded", fit: "contain" },
    { kind: "grid", x: 0.03, y: 0.75, w: 0.94, h: 0.21, shape: "rounded" },
  ] },
];

/** The Countdown card's text: m:ss, then "We're starting" at zero. It never switches anything. */
export function countdownText(playing: RoomLive["playing"], now = Date.now()): string {
  if (!playing || playing.slot !== "countdown") return "";
  const left = Math.ceil((playing.at + (playing.minutes ?? 5) * 60_000 - now) / 1000);
  if (left <= 0) return "We're starting";
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

/** The headline on each ready-made card. */
export const CARD_TITLE: Record<RoomCardSlot, string> = { brb: "Be right back", soon: "Starting soon", thanks: "Thank you for watching", countdown: "Starting in" };

/** The room name LiveKit puts in a token ("my-12") back to the studio id. */
export function studioIdFromRoom(room: string): number | null {
  const m = /^my-(\d+)$/.exec(room);
  return m ? Number(m[1]) : null;
}
