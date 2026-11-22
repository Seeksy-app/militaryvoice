/**
 * A recording's stored name, made fit to post: Radio recordings are saved as
 * "<Show> · MilitaryVoices Radio · Mon, Nov 16", and clean versions get " (clean)"
 * on the end. Neither belongs in a YouTube or LinkedIn title (Frank, 22 Nov 2026:
 * his talk was about to go out as "Bounce Back in Business & Life · MilitaryVoices
 * Radio · Mon, Nov 16").
 */
export function postableTitle(raw: string): string {
  let t = String(raw ?? "").trim();
  for (let i = 0; i < 3 && /\(clean\)$/i.test(t); i++) t = t.replace(/\s*\(clean\)$/i, "").trim();
  t = t.replace(/\s*·\s*MilitaryVoices Radio(\s*·.*)?$/i, "").trim();
  return t || String(raw ?? "").trim();
}
