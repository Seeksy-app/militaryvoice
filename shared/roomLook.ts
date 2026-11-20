// The Room's look, as the recorded and streamed picture needs it. Podcasting owns where a
// room's look and scenes are saved; this file is only the shape the stage reads, and the
// one place a Room layout name becomes a stage layout name. Types and a mapping: no data.

/** The layouts in the Room's picker. */
export type RoomLayoutKey = "solo" | "side" | "grid" | "speaker" | "screen" | "pip";

export interface RoomScene {
  id: string;
  name: string;
  layout: RoomLayoutKey;
  /** A picture or #rrggbb behind the people; falls back to the room's own. */
  backgroundUrl?: string;
}

export interface RoomLook {
  logoUrl?: string;
  /** top-left | top-right | bottom-left | bottom-right */
  logoCorner?: string;
  logoSize?: number;
  backgroundUrl?: string;
  scenes: RoomScene[];
  /** Public URLs (the filmed page has no login). */
  introUrl?: string;
  outroUrl?: string;
}

/** The stage layouts StageView understands: contain, cover, showtime, sidebar, pip, thumbnails. */
export const ROOM_LAYOUT_TO_STAGE: Record<RoomLayoutKey, string> = {
  solo: "contain",
  side: "contain",
  grid: "cover",
  speaker: "sidebar",
  screen: "sidebar",
  pip: "pip",
};

/** Used until a room has saved a look of its own. */
export const DEFAULT_ROOM_LOOK: RoomLook = {
  logoUrl: "/logo-lockup-dark.png",
  logoCorner: "top-right",
  logoSize: 150,
  scenes: [{ id: "just-us", name: "Just us", layout: "side" }],
};

/** What goes on the LiveKit room so the host's view, the recording and the stream all follow it. */
export function roomMetaFrom(name: string, look: RoomLook, sceneId?: string, origin = ""): Record<string, unknown> {
  const scene = look.scenes.find((s) => s.id === sceneId) ?? look.scenes[0];
  const abs = (u?: string) => (u && u.startsWith("/") && origin ? `${origin}${u}` : u || "");
  return {
    studioName: name,
    logoUrl: abs(look.logoUrl),
    logoCorner: look.logoCorner || "top-right",
    logoSize: look.logoSize ?? 150,
    backgroundUrl: abs(scene?.backgroundUrl || look.backgroundUrl),
    stageLayout: ROOM_LAYOUT_TO_STAGE[scene?.layout ?? "side"],
    activeScene: scene?.id ?? "",
  };
}
