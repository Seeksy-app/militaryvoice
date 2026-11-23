import type { ClipOptions } from "@shared/schema";

/**
 * What the detector saw of two people on screen, and the one choice Pōstify offers about them (see TwoUp below).
 * The pick goes out with the normal clip request (options.layout).
 */
export type Layout = NonNullable<ClipOptions["layout"]>;
type Choice = "stacked" | "side" | "single";

export interface LayoutSuggestion {
  suggested: Choice;
  people: number;
  previews: Partial<Record<Choice, string>>;
}

const CHOICES: { key: Choice; label: string }[] = [
  { key: "stacked", label: "Stacked" },
  { key: "side", label: "Side by side" },
  { key: "single", label: "Follow the speaker" },
];

const isChoice = (v: unknown): v is Choice => v === "stacked" || v === "side" || v === "single";

/** The recording's `layoutSuggestion` (a JSON string, or ""). Only a finished look at two or more people with at least one picture counts. */
export function parseLayoutSuggestion(raw: unknown): LayoutSuggestion | null {
  let v: any = raw;
  if (typeof raw === "string") { try { v = raw ? JSON.parse(raw) : null; } catch { v = null; } }
  if (!v || v.status !== "done" || !(Number(v.people) >= 2)) return null;
  const previews: LayoutSuggestion["previews"] = {};
  for (const c of CHOICES) {
    const u = v.previews?.[c.key];
    if (typeof u === "string" && /^(https?:\/\/|\/|data:image\/)/.test(u)) previews[c.key] = u;
  }
  if (!Object.keys(previews).length) return null;
  return { suggested: isChoice(v.suggested) ? v.suggested : "stacked", people: Math.round(Number(v.people)), previews };
}

/** The detector has looked and seen two or more people (pictures or not). The Library asks how they should look before starting. */
export function seesTwoPeople(raw: unknown): boolean {
  let v: any = raw;
  if (typeof raw === "string") { try { v = raw ? JSON.parse(raw) : null; } catch { v = null; } }
  return !!v && v.status === "done" && Number(v.people) >= 2;
}

/** What the detector would pick for two people, pictures or not (null: one person, or not looked at). */
// True once the detector has looked and found one person: there is nothing to frame, so no choice.
export function seesOnePerson(raw: unknown): boolean {
  let v: any = raw;
  if (typeof raw === "string") { try { v = raw ? JSON.parse(raw) : null; } catch { v = null; } }
  return !!v && v.status === "done" && Number(v.people) < 2;
}

export function suggestedLayout(raw: unknown): Choice | null {
  if (!seesTwoPeople(raw)) return null;
  let v: any = raw;
  if (typeof raw === "string") { try { v = JSON.parse(raw); } catch { return null; } }
  return isChoice(v?.suggested) ? v.suggested : "stacked";
}

/**
 * Two people on screen, since 23 Nov 2026 (Andrew: "Yes, build it", the simpler Ready for Pōstify): one choice, under
 * Options, only when two people are seen. Stacked (best for Reels, the default) or Follow the speaker. Wide clips and the
 * full episode always stay as recorded. An older pick of Side by side or Automatic starts on Stacked.
 */
export type TwoUp = "stacked" | "single";
export const twoUpOf = (v: unknown): TwoUp => (v === "single" ? "single" : "stacked");
/** What goes out on the clip request: a Radio show's own stack stays "radio". */
export const twoUpLayout = (v: TwoUp, own: unknown): "stacked" | "single" | "radio" => (v === "stacked" && own === "radio" ? "radio" : v);
