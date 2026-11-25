// Studio templates (Andrew, 24 Nov, approved with the mockup): a set of scenes for a kind of show, offered on
// "Choose a setup" and in the studio's Scenes ⋯ → Start from a template. In the studio a template only adds scenes
// (a name already in use gets a 2), so it never deletes the host's own. Media scenes start with nothing picked.
import type { RoomBox, RoomScene } from "./roomLook.js";

export type TemplateId = "interview" | "solo" | "panel";
export type TemplateScene = Pick<RoomScene, "name" | "layout" | "type" | "people"> & { boxes?: RoomBox[]; media?: null };

/** Two people stacked, for v3 (a scene's own layout); v2 has no boxes, so it gets the picture-in-picture layout. */
const STACK: RoomBox[] = [
  { id: "top", kind: "camera", who: "host", x: 0.27, y: 0.03, w: 0.46, h: 0.46, shape: "rounded", fit: "cover" },
  { id: "bottom", kind: "camera", who: "next", x: 0.27, y: 0.51, w: 0.46, h: 0.46, shape: "rounded", fit: "cover" },
];

export const TEMPLATES: { id: TemplateId; name: string; line: string; scenes: (v3: boolean) => TemplateScene[] }[] = [
  {
    id: "interview", name: "Interview", line: "You and a guest, with a clip to show.",
    scenes: (v3) => [
      { name: "Just us", type: "two", layout: "side", people: 2 },
      v3 ? { name: "Two people", type: "two", layout: "side", people: 2, boxes: STACK } : { name: "Two people", type: "two", layout: "pip", people: 2 },
      { name: "Media full", type: "media", layout: "screen", people: 0, media: null },
      { name: "Speaker", type: "single", layout: "solo", people: 1 },
    ],
  },
  {
    id: "solo", name: "Solo + slides", line: "Just you, talking through slides or a clip.",
    scenes: () => [
      { name: "Me", type: "single", layout: "solo", people: 1 },
      { name: "Slides + me", type: "media", layout: "screen", people: 1, media: null },
      { name: "Media full", type: "media", layout: "screen", people: 0, media: null },
    ],
  },
  {
    id: "panel", name: "Panel", line: "Three or more people, one at a time when needed.",
    scenes: () => [
      { name: "Group", type: "group", layout: "grid", people: 3 },
      { name: "Speaker", type: "single", layout: "solo", people: 1 },
      { name: "Media", type: "media", layout: "screen", people: 3, media: null },
    ],
  },
];
export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);

/** A name not already in `taken`: "Speaker", else "Speaker 2", "Speaker 3"… */
export function freeName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) if (!taken.has(`${name} ${i}`)) return `${name} ${i}`;
}
