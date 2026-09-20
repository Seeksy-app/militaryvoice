
// What's left to do, worked out from what they've actually done rather than
// asked as questions. A checklist that already knows the answer is worth
// reading; one that asks "have you connected your accounts?" is not.
//
// This file is the definitions only. The section that used to render them on
// the dashboard home is gone — the floating panel says the same thing on every
// screen, and two copies of one checklist on one page is one of them being
// ignored. See FloatingChecklist.

export interface StepState {
  hasShow: boolean;
  hasSlot: boolean;
  hasAccounts: boolean;
  hasMaterials: boolean;
  hasYouTube: boolean;
  /** False when the event is full, so there is nothing left to claim. */
  slotsOpen?: boolean;
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
  youtube: "section-going-out-live",
  share: "section-share-slot",
} as const;

export interface Step {
  key: keyof typeof STEP_ANCHOR;
  label: string;
  detail: string;
  done: boolean;
  cta: string;
  go: () => void;
}

export interface StepNav {
  onGoEvents: () => void;
  onGoIntegrations: () => void;
  onGoPromotion: () => void;
}

/**
 * Take them to the screen, then to the spot on it.
 *
 * The screen swap is a React render, so the anchor can't exist yet when the
 * click happens. Poll briefly for it rather than guessing at a delay — a cold
 * query can take a second, and a fixed timeout is either too short or a
 * needless wait.
 */
export function goToStep(step: Step): void {
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

/**
 * The one list, built once.
 *
 * The floating panel and the section on the dashboard are the same checklist
 * shown twice. Two copies of these definitions would drift the first time a
 * step was added to one of them — which is exactly how the studio's graphics
 * ended up reaching air without reaching the producer's own monitor.
 */
export function buildSteps(state: StepState, nav: StepNav): Step[] {
  const steps: Step[] = [
    {
      key: "show",
      label: "Set your show up for the event",
      detail: "Its name, whether you're live or playing a recording, and your artwork.",
      done: state.hasShow,
      cta: "Set up your show",
      go: nav.onGoEvents,
    },
    // Only worth listing while there is something to claim. Telling somebody
    // to pick a time on a full schedule is a to-do they cannot do, and it sits
    // at the top of their list unticked for a fortnight.
    ...(state.hasSlot || state.slotsOpen !== false
      ? ([{
          key: "slot",
          label: "Claim your time slot",
          detail: "Pick when you want to be on air. You can move it later.",
          done: state.hasSlot,
          cta: "Choose a time",
          go: nav.onGoEvents,
        }] as Step[])
      : []),
    {
      key: "materials",
      label: "Send us your media",
      detail: "Intro, outro, slides — anything you want us to roll. All optional.",
      done: state.hasMaterials,
      cta: "Upload your media",
      go: nav.onGoEvents,
    },
    {
      key: "accounts",
      label: "Connect your social accounts",
      detail: "They become follow buttons on your card in the public lineup.",
      done: state.hasAccounts,
      cta: "Connect accounts",
      go: nav.onGoIntegrations,
    },
    {
      key: "youtube",
      label: "Connect your YouTube to stream to",
      detail: "We open a broadcast on your own channel when your slot starts. Optional — it airs here either way.",
      done: state.hasYouTube,
      cta: "Connect YouTube",
      go: nav.onGoIntegrations,
    },
    {
      key: "share",
      label: "Share your slot",
      detail: "Your link shows your artwork and your time wherever you post it.",
      // Nobody can tell whether someone posted, so this one stays open as a
      // prompt rather than pretending to know.
      done: false,
      cta: "Get your link",
      go: nav.onGoPromotion,
    },
  ];
  // Sharing only makes sense once there's a time to share.
  return steps.filter((s) => s.key !== "share" || state.hasSlot);
}
