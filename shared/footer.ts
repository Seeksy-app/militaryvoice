/**
 * A show's episode footer, filled in for one episode. The footer is written once per show; {title}, {number}, {season}
 * and {guest} are replaced from the episode. A line whose fill-in is empty (no guest, no number) is dropped, so
 * "Guest: {guest}" simply isn't there on an episode without one.
 */
export const FOOTER_TOKENS = ["title", "number", "season", "guest"] as const;

export function fillFooter(footer: string, v: { title?: string; number?: number | null; season?: number | null; guest?: string }): string {
  const vals: Record<string, string> = {
    title: (v.title ?? "").trim(),
    number: v.number != null ? String(v.number) : "",
    season: v.season != null ? String(v.season) : "",
    guest: (v.guest ?? "").trim(),
  };
  return footer
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      let empty = false;
      const out = line.replace(/\{(title|number|season|guest)\}/gi, (_m, k: string) => {
        const x = vals[k.toLowerCase()];
        if (!x) empty = true;
        return x;
      });
      return empty ? null : out;
    })
    .filter((l): l is string => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
