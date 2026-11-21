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

export interface RoomScene {
  id: string;
  n?: number;
  name: string;
  layout: RoomLayoutKey;
  /** Guest identities shown in this scene; [] means everyone. The host is always shown. */
  stage?: string[];
  /** Overrides for this scene only. */
  look?: RoomLookStyle;
  type?: RoomSceneType;
  /** Group: how many people at most (3 to 6). */
  onStage?: number;
  /** Media scene: the picture or clip that fills the frame. */
  media?: RoomAsset | null;
  profile?: RoomProfile | null;
}

/** A sound pad or a music track (v3). */
export interface RoomAudioItem { id: string; name?: string; asset?: RoomAsset | null; url?: string; volume?: number }

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
  /** v3: the video shelf; intro and outro are found here when the slots aren't set. */
  videos?: (RoomAsset & { slot?: string })[] | { intro?: RoomAsset | null; outro?: RoomAsset | null; [k: string]: unknown };
  sounds?: RoomAudioItem[];
  music?: RoomAudioItem[];
  soundVolume?: number;
  musicVolume?: number;
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
}

/** Intro or outro: the slot first, then the v3 video shelf. */
export function clipOf(look: RoomLook | null, slot: "intro" | "outro"): RoomAsset | null {
  if (!look) return null;
  if (look[slot]?.url) return look[slot] ?? null;
  const v = look.videos;
  if (Array.isArray(v)) return v.find((x) => x.slot === slot || x.kind === slot) ?? null;
  const got = v?.[slot] as RoomAsset | null | undefined;
  return got?.url ? got : null;
}

/** A sound or music item's playable address. */
export function audioUrlOf(item: RoomAudioItem | undefined, origin = ""): string {
  return abs(item?.asset?.url ?? item?.url, origin);
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
  switch (scene?.type) {
    case "single": return { drawn: ordered.slice(0, 1), layout: "contain" };
    case "two": return { drawn: ordered.slice(0, 2), layout: "contain" };
    case "group": return { drawn: ordered.slice(0, Math.max(3, Math.min(6, Math.round(Number(scene.onStage) || 4)))), layout: "cover" };
    case "media":
    case "profile": return { drawn: [] };
    default: return { drawn: ordered };
  }
}

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
