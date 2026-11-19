import { Sparkles } from "lucide-react";
import type { ClipOptions } from "@shared/schema";

/**
 * How two people on screen are framed, always on Make clips (Andrew's rule): Stacked, Side by
 * side or Follow the speaker, plus Automatic. When the detector has looked and found two
 * people, each choice shows a still from the recording's own footage and the one it likes best
 * is marked and lit to start with; otherwise it is the same four choices as plain chips.
 * The pick goes out with the normal clip request (options.layout). It is the only place the
 * layout is set on this screen.
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

const HINTS: Record<Choice | "auto", string> = {
  stacked: "Two people, one over the other",
  side: "The whole picture, both people side by side",
  single: "Follows whoever is talking",
  auto: "We choose for you",
};

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

export function LayoutPicker({ value, own, suggestion, onChange }: {
  /** The layout on the options now (undefined = automatic). */
  value: ClipOptions["layout"];
  /** The layout the recording itself carries ("radio" for a Radio show). Stacked puts it back. */
  own: ClipOptions["layout"];
  suggestion: LayoutSuggestion | null;
  onChange: (layout: ClipOptions["layout"]) => void;
}) {
  // A Radio show's own layout is a stacked one; it lights Stacked.
  const lit: Choice | "auto" = value === "radio" ? "stacked" : isChoice(value) ? value : "auto";
  const set = (k: Choice | "auto") => onChange(k === "auto" ? undefined : k === "stacked" && own === "radio" ? "radio" : k);
  const tile = "rounded-xl border p-1.5 text-left transition-colors hover:border-[#053877]/50";
  const on = "border-[#F0A71F] ring-1 ring-[#F0A71F]";

  if (suggestion) {
    return (
      <div className="rounded-2xl border border-border bg-card p-3" data-testid="post-layout">
        <p className="text-sm font-semibold">We found two people. How should they look?</p>
        {/* The stills are the vertical clip frame (9:16): small portrait tiles beside the name. */}
        <div className="mt-2 grid grid-cols-4 gap-2">
          {CHOICES.map((c) => (
            <button key={c.key} type="button" onClick={() => set(c.key)} aria-pressed={lit === c.key} title={HINTS[c.key]} className={`flex items-center gap-2 ${tile} ${lit === c.key ? on : "border-border"}`} data-testid={`post-layout-${c.key}`}>
              <span className="aspect-[9/16] h-[104px] shrink-0 overflow-hidden rounded-lg bg-muted">
                {suggestion.previews[c.key] && <img src={suggestion.previews[c.key]} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} className="h-full w-full object-cover" />}
              </span>
              <span className="flex min-w-0 flex-col items-start gap-1 text-xs font-semibold leading-tight">
                <span>{c.label}</span>
                {suggestion.suggested === c.key && <span className="rounded-full bg-[#F0A71F] px-1.5 py-0.5 text-[10px] text-[#1a1200]">Best</span>}
              </span>
            </button>
          ))}
          <button type="button" onClick={() => set("auto")} aria-pressed={lit === "auto"} title={HINTS.auto} className={`flex flex-col items-center justify-center gap-1.5 ${tile} ${lit === "auto" ? on : "border-border"}`} data-testid="post-layout-auto">
            <Sparkles className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-semibold">Automatic</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2" role="group" aria-label="Two people on screen" data-testid="post-layout">
      <span className="text-sm font-semibold">Two people on screen</span>
      <div className="flex flex-wrap items-center gap-1 rounded-full bg-muted/60 p-1 text-xs font-semibold">
        {([["auto", "Automatic"], ...CHOICES.map((c) => [c.key, c.label] as const)] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => set(k)} aria-pressed={lit === k} title={HINTS[k]} className={`rounded-full px-3 py-1 ${lit === k ? "bg-[#F0A71F] text-[#1a1200]" : "text-muted-foreground hover:text-foreground"}`} data-testid={`post-layout-${k}`}>{label}</button>
        ))}
      </div>
    </div>
  );
}
