import { useEffect, useState } from "react";
import { Check } from "lucide-react";

/**
 * "We found two people. Stack them?" on Make clips: the detector looked at the recording and
 * thinks two people share the picture, so it offers each way of framing them with a still from
 * the recording's own footage. Nothing is applied until a thumbnail is tapped; "No thanks"
 * hides it for this recording. The pick goes out with the normal clip request (options.layout).
 */
export type LayoutChoice = "stacked" | "side" | "single";

export interface LayoutSuggestion {
  suggested: LayoutChoice;
  people: number;
  previews: Partial<Record<LayoutChoice, string>>;
}

const CHOICES: { key: LayoutChoice; label: string }[] = [
  { key: "stacked", label: "One over the other" },
  { key: "side", label: "Side by side" },
  { key: "single", label: "Follow the speaker" },
];

const isChoice = (v: unknown): v is LayoutChoice => v === "stacked" || v === "side" || v === "single";

/** The recording's `layoutSuggestion` (a JSON string, or ""). Only a finished look at two or more people with at least one picture shows the banner. */
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

const memoryKey = (recId: number) => `mv_layout_nudge_${recId}`;
const read = (recId: number): string => { try { return localStorage.getItem(memoryKey(recId)) ?? ""; } catch { return ""; } };
const write = (recId: number, v: string) => { try { localStorage.setItem(memoryKey(recId), v); } catch { /* private mode */ } };

export function LayoutNudge({ recId, suggestion, onPick, onClear }: { recId: number; suggestion: LayoutSuggestion; onPick: (layout: LayoutChoice) => void; onClear: () => void }) {
  const remembered = read(recId); // "no", a layout already chosen for this recording, or ""
  const [picked, setPicked] = useState<LayoutChoice | null>(isChoice(remembered) ? remembered : null);
  const [phase, setPhase] = useState<"ask" | "done" | "no">(remembered === "no" ? "no" : isChoice(remembered) ? "done" : "ask");
  const [broken, setBroken] = useState<Partial<Record<LayoutChoice, boolean>>>({});

  // Coming back to a recording where they already chose: put that choice back on the options.
  useEffect(() => { if (picked) onPick(picked); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (phase === "no") return null;

  if (phase === "done" && picked) {
    const label = CHOICES.find((c) => c.key === picked)?.label ?? "";
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm" data-testid="layout-nudge-done">
        <Check className="h-4 w-4 shrink-0 text-emerald-600" />
        <span className="min-w-0 truncate font-semibold">Two people: {label.toLowerCase()}</span>
        <button type="button" onClick={() => setPhase("ask")} className="ml-auto text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" data-testid="layout-nudge-change">Change</button>
      </div>
    );
  }

  const pick = (c: LayoutChoice) => { write(recId, c); setPicked(c); setPhase("done"); onPick(c); };
  // "No thanks" means automatic again, even after an earlier pick.
  const dismiss = () => { write(recId, "no"); setPhase("no"); if (picked) { setPicked(null); onClear(); } };

  return (
    <div className="rounded-2xl border border-border bg-card p-3" data-testid="layout-nudge">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold">We found two people. Stack them?</p>
        <button type="button" onClick={dismiss} className="ml-auto text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" data-testid="layout-nudge-no">No thanks</button>
      </div>
      {/* The pictures are the vertical clip frame (9:16), so each is a small portrait tile beside its name. */}
      <div className="mt-2 grid grid-cols-3 gap-2">
        {CHOICES.filter((c) => suggestion.previews[c.key]).map((c) => (
          <button key={c.key} type="button" onClick={() => pick(c.key)} aria-label={c.label} className={`flex items-center gap-2 rounded-xl border p-1.5 text-left transition-colors hover:border-[#053877]/50 ${suggestion.suggested === c.key ? "border-[#F0A71F] ring-1 ring-[#F0A71F]" : "border-border"}`} data-testid={`layout-nudge-${c.key}`}>
            <span className="aspect-[9/16] h-[104px] shrink-0 overflow-hidden rounded-lg bg-muted">
              {!broken[c.key] && <img src={suggestion.previews[c.key]} alt="" loading="lazy" onError={() => setBroken((b) => ({ ...b, [c.key]: true }))} className="h-full w-full object-cover" />}
            </span>
            <span className="flex min-w-0 flex-col items-start gap-1 text-xs font-semibold leading-tight">
              <span>{c.label}</span>
              {suggestion.suggested === c.key && <span className="rounded-full bg-[#F0A71F] px-1.5 py-0.5 text-[10px] text-[#1a1200]">Best</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
