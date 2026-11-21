import type { Icon3D } from "@/lib/icons3d";

/**
 * Our how-to videos that sit in a podcaster's Library (PM, 21 Nov: Frank's "How to use Discovery",
 * "How to find a guest", "How to invite a guest" and "Your MilitaryVoices.ai tutorial"). They're ours to
 * watch, not his recordings: no Pōstify (it would clip our video and spend his credits), their own row
 * after his work, and a drawn poster, because their own frames come out black.
 *
 * Known by title for now; a podcaster's own "How to …" episode doesn't match, only these.
 */
const HOW_TO: { re: RegExp; art: Icon3D; label?: string }[] = [
  { re: /^how to use discovery\b/i, art: "compass" },
  { re: /^how to find a guest\b/i, art: "search" },
  { re: /^how to invite a guest\b/i, art: "mail" },
  // "Your MilitaryVoices.ai tutorial" can't fit a phone card without a lone last word; the card says it shorter.
  { re: /militaryvoices(\.ai)? tutorial\b/i, art: "tv", label: "The full tutorial" },
];

/** The 3D icon for one of our how-to videos, or undefined for the podcaster's own recording. */
export const howToArt = (title: string): Icon3D | undefined => HOW_TO.find((h) => h.re.test(title.trim()))?.art;
/** What the card calls it: a shorter label where the stored title won't fit, else the title itself. */
export const howToLabel = (title: string) => HOW_TO.find((h) => h.re.test(title.trim()))?.label ?? title;
export const isHowTo = (title: string) => howToArt(title) !== undefined;
