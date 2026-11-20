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

export interface RoomScene {
  id: string;
  n?: number;
  name: string;
  layout: RoomLayoutKey;
  /** Overrides for this scene only. */
  look?: RoomLookStyle;
}

export interface RoomLook extends RoomLookStyle {
  scenes: RoomScene[];
  logos?: RoomAsset[];
  banners?: { id: string; text: string; seconds: number }[];
  intro?: RoomAsset | null;
  outro?: RoomAsset | null;
  rev?: number;
}

/** Ours: written to the LiveKit room's metadata by the server, read by every view of the room. */
export interface RoomLive {
  activeScene?: string;
  showing?: { bannerId: string; until: number } | null;
  playing?: { slot: "intro" | "outro"; at: number } | null;
  lookRev?: number;
}

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
  const clip = playing ? (playing.slot === "intro" ? l.intro : l.outro) : null;
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

/** The room name LiveKit puts in a token ("my-12") back to the studio id. */
export function studioIdFromRoom(room: string): number | null {
  const m = /^my-(\d+)$/.exec(room);
  return m ? Number(m[1]) : null;
}
