import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, ArrowRight, X, ListChecks } from "lucide-react";
import { buildSteps, goToStep, type StepState, type StepNav } from "@/components/NextSteps";

// The same checklist as the one on the dashboard, following them around.
//
// The section on the home screen is read once, on the day they sign up, and
// then never again — you have to scroll to it, and by the second visit you
// know what is down there. Most of the lineup got to within three weeks of the
// event with no social link, no media and no YouTube, which is not a list
// nobody read; it is a list nobody was shown twice.
//
// So it floats, on every screen of the dashboard, until there is nothing left
// on it. Two rules keep that from being obnoxious: it collapses to a small
// pill the moment they ask it to and stays collapsed, and every item can be
// ticked off by hand — including the ones we cannot verify, like whether
// somebody actually posted their link. A checklist that refuses to let you
// finish it is one you learn to ignore.

const HIDDEN_KEY = "mv_checklist_collapsed";
const TICKED_KEY = "mv_checklist_ticked";

function readTicked(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(TICKED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function FloatingChecklist({ state, ...nav }: { state: StepState } & StepNav) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(HIDDEN_KEY) === "1");
  const [ticked, setTicked] = useState<string[]>(readTicked);

  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_KEY, collapsed ? "1" : "0");
    } catch {
      /* a private window is not a reason to break the page */
    }
  }, [collapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(TICKED_KEY, JSON.stringify(ticked));
    } catch {
      /* same */
    }
  }, [ticked]);

  const steps = useMemo(() => buildSteps(state, nav), [state, nav.onGoEvents, nav.onGoIntegrations, nav.onGoPromotion]);
  // Verified beats ticked: something we can see is done stays done even if
  // they never touched it, and something they ticked reads as done until the
  // real answer arrives.
  const rows = steps.map((s) => ({ ...s, crossed: s.done || ticked.includes(s.key), verified: s.done }));
  const left = rows.filter((r) => !r.crossed).length;

  // Nothing left to say. It does not hang around congratulating itself.
  if (left === 0) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-20 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2.5 text-sm font-semibold shadow-lg transition-transform hover:scale-[1.03] sm:bottom-24 sm:right-5"
        data-testid="button-checklist-open"
      >
        <ListChecks className="h-4 w-4 text-[#F0A71F]" />
        {left} to do
      </button>
    );
  }

  return (
    <aside
      className="fixed bottom-20 right-4 z-40 w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl sm:bottom-24 sm:right-5"
      aria-label="What's left before you're on air"
      data-testid="panel-checklist"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border bg-[#053877] px-4 py-2.5 text-white">
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <ListChecks className="h-4 w-4 shrink-0 text-[#F0A71F]" />
          <span className="truncate">{left} to do before you're on air</span>
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="shrink-0 rounded-md p-1 text-white/70 transition-colors hover:bg-white/15 hover:text-white"
          aria-label="Collapse the checklist"
          data-testid="button-checklist-close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <ul className="max-h-[min(24rem,50vh)] divide-y divide-border overflow-y-auto">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-1" data-testid={`checklist-${r.key}`}>
            {/* The tick is its own target. Tapping the row means "take me
                there"; tapping the circle means "I've done this" — and those
                are different enough intentions that sharing one hit area
                would make both of them feel broken. */}
            <button
              type="button"
              disabled={r.verified}
              onClick={() => setTicked((t) => (t.includes(r.key) ? t.filter((k) => k !== r.key) : [...t, r.key]))}
              className="shrink-0 rounded-lg p-3 transition-colors enabled:hover:bg-muted"
              aria-label={r.crossed ? `Mark "${r.label}" as not done` : `Mark "${r.label}" as done`}
              aria-pressed={r.crossed}
              title={r.verified ? "We can see this one is done" : r.crossed ? "Tick it back on" : "Mark it done"}
              data-testid={`checklist-tick-${r.key}`}
            >
              {r.crossed ? (
                <CheckCircle2 className="h-5 w-5 text-primary" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground/40" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                goToStep(r);
                setCollapsed(true);
              }}
              className="flex min-w-0 flex-1 items-center gap-2 py-3 pr-3 text-left transition-colors hover:bg-[#053877]/[0.06]"
              data-testid={`checklist-go-${r.key}`}
            >
              <span
                className={`min-w-0 flex-1 text-[13px] font-medium leading-snug ${
                  r.crossed ? "text-muted-foreground line-through" : "text-foreground"
                }`}
              >
                {r.label}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
