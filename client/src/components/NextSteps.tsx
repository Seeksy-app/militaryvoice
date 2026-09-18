import { CheckCircle2, Circle, ArrowRight } from "lucide-react";

// What's left to do, worked out from what they've actually done rather than
// asked as questions. A checklist that already knows the answer is worth
// reading; one that asks "have you connected your accounts?" is not.

export interface StepState {
  hasShow: boolean;
  hasSlot: boolean;
  hasAccounts: boolean;
  hasMaterials: boolean;
}

/**
 * Anchors the step rows scroll to.
 *
 * Moving to the right screen isn't the same as arriving at the thing. These
 * ids are on the sections themselves, so a click lands on the control rather
 * than at the top of a page the person then has to search.
 */
export const STEP_ANCHOR = {
  show: "set-up-your-show",
  slot: "your-time-slot",
  materials: "section-media",
  accounts: "section-social-accounts",
  share: "section-share-slot",
} as const;

interface Step {
  key: keyof typeof STEP_ANCHOR;
  label: string;
  detail: string;
  done: boolean;
  cta: string;
  go: () => void;
}

export function NextSteps({
  state,
  onGoEvents,
  onGoIntegrations,
  onGoPromotion,
}: {
  state: StepState;
  onGoEvents: () => void;
  onGoIntegrations: () => void;
  onGoPromotion: () => void;
}) {
  /**
   * Take them to the screen, then to the spot on it.
   *
   * The screen swap is a React render, so the anchor can't exist yet when the
   * click happens. Poll briefly for it rather than guessing at a delay — a
   * cold query can take a second, and a fixed timeout is either too short or
   * a needless wait.
   */
  function goTo(step: Step) {
    step.go();
    const id = STEP_ANCHOR[step.key];
    const started = Date.now();
    const find = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (Date.now() - started < 4000) requestAnimationFrame(find);
    };
    requestAnimationFrame(find);
  }

  const steps: Step[] = [
    {
      key: "show",
      label: "Set your show up for the event",
      detail: "Its name, whether you're live or playing a recording, and your artwork.",
      done: state.hasShow,
      cta: "Set up your show",
      go: onGoEvents,
    },
    {
      key: "slot",
      label: "Claim your time slot",
      detail: "Pick when you want to be on air. You can move it later.",
      done: state.hasSlot,
      cta: "Choose a time",
      go: onGoEvents,
    },
    {
      key: "materials",
      label: "Send us your show materials",
      detail: "Intro, outro, slides — anything you want us to roll. All optional.",
      done: state.hasMaterials,
      cta: "Add materials",
      go: onGoEvents,
    },
    {
      key: "accounts",
      label: "Connect your social accounts",
      detail: "They become follow buttons on your card in the public lineup.",
      done: state.hasAccounts,
      cta: "Connect accounts",
      go: onGoIntegrations,
    },
    {
      key: "share",
      label: "Share your slot",
      detail: "Your link shows your artwork and your time wherever you post it.",
      // Nobody can tell whether someone posted, so this one stays open as a
      // prompt rather than pretending to know.
      done: false,
      cta: "Get your link",
      go: onGoPromotion,
    },
  ];

  // Sharing only makes sense once there's a time to share.
  const visible = steps.filter((s) => s.key !== "share" || state.hasSlot);
  const doneCount = visible.filter((s) => s.done).length;
  const next = visible.find((s) => !s.done);

  return (
    <section className="mt-8">
      <h2 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
        Before you're on air
        <span className="rounded-full bg-[#053877]/10 px-2.5 py-0.5 text-xs font-bold text-[#053877]">
          {doneCount} of {visible.length} done
        </span>
      </h2>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <ul className="divide-y divide-border">
          {visible.map((s) => {
            const isNext = s.key === next?.key;
            return (
              <li key={s.key} data-testid={`step-${s.key}`}>
                <button
                  type="button"
                  onClick={() => goTo(s)}
                  className={`flex w-full flex-wrap items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-[#053877]/[0.06] ${
                    isNext ? "bg-[#053877]/[0.04]" : ""
                  }`}
                  data-testid={`step-row-${s.key}`}
                >
                {s.done ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
                ) : (
                  <Circle className={`h-5 w-5 shrink-0 ${isNext ? "text-[#F0A71F]" : "text-muted-foreground/40"}`} />
                )}

                <div className="min-w-0 flex-1">
                  <p className={`text-[15px] font-semibold ${s.done ? "text-muted-foreground line-through" : "text-foreground"}`}>
                    {s.label}
                  </p>
                  {!s.done && <p className="text-xs text-muted-foreground">{s.detail}</p>}
                </div>

                  {!s.done && (
                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold ${
                        isNext
                          ? "bg-[#053877] text-white"
                          : "border border-border bg-card text-foreground"
                      }`}
                      data-testid={`step-cta-${s.key}`}
                    >
                      {s.cta} <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  )}
                  {/* A finished step is still worth revisiting — it just
                      doesn't shout about it. */}
                  {s.done && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/40" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
