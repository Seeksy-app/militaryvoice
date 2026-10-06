
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
  // The Growth plan's first steps (6 Oct onboarding audit): the checklist
  // used to be the Marathon's to-do list for everyone, after it had ended.
  hasPhoto?: boolean;
  hasSmartLink?: boolean;
  hasPodcast?: boolean;
  hasClips?: boolean;
  /** What they said they came for on the way in (events, grow, discover, host). */
  interests?: string;
  /** An event is coming up that they can still be part of. Event steps only show then. */
  eventOpen?: boolean;
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
  photo: "section-about",
  smartlink: "",
  podcast: "",
  discovery: "",
  postify: "",
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
  onGoProfile?: () => void;
  onGoPage?: () => void;
  onGoPodcast?: () => void;
  onGoDiscovery?: () => void;
  onGoPostify?: () => void;
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
  const want = (state.interests ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const wants = (k: string) => want.length === 0 || want.includes(k);
  const go = (f?: () => void) => f ?? nav.onGoIntegrations;

  // The free plan, in the order that gets someone somewhere: who they are,
  // one link for their bio, their show, their accounts, then the paid-for
  // things they can try free.
  const growth: Step[] = [
    { key: "photo", label: "Add your photo", detail: "It goes on your SmartLink and your directory card.", done: Boolean(state.hasPhoto), cta: "Add a photo", go: go(nav.onGoProfile) },
    { key: "smartlink", label: "Make your SmartLink", detail: "One link for every bio: your show, your videos, and a way to collect emails. Free.", done: Boolean(state.hasSmartLink), cta: "Make my SmartLink", go: go(nav.onGoPage) },
    ...(wants("grow") || wants("events") || wants("host")
      ? ([{ key: "podcast", label: "Host or bring over your podcast", detail: "Your feed on every app, free. Already hosted? Paste your feed and we copy it across.", done: Boolean(state.hasPodcast), cta: "Set up my podcast", go: go(nav.onGoPodcast) }] as Step[])
      : []),
    { key: "accounts", label: "Connect your social accounts", detail: "They become follow buttons, and Pōstify can post your clips to them.", done: state.hasAccounts, cta: "Connect accounts", go: nav.onGoIntegrations },
    ...(wants("grow") || wants("events") || wants("host")
      ? ([{ key: "postify", label: "Make clips with Pōstify", detail: "Your first episode is free: short clips with captions, in every shape.", done: Boolean(state.hasClips), cta: "Try Pōstify", go: go(nav.onGoPostify) }] as Step[])
      : []),
    ...(want.includes("discover")
      ? ([{ key: "discovery", label: "Find a guest in Discovery", detail: "Search a topic and see who's been on the most shows. 10 contact emails a month, free.", done: false, cta: "Open Discovery", go: go(nav.onGoDiscovery) }] as Step[])
      : []),
  ];

  // An event's own to-do list, only while there's an event to do it for.
  const eventSteps: Step[] = state.eventOpen && (state.hasSlot || want.includes("events"))
    ? [
        { key: "show", label: "Set your show up for the event", detail: "Its name, whether you're live or playing a recording, and your artwork.", done: state.hasShow, cta: "Set up your show", go: nav.onGoEvents },
        ...(state.hasSlot || state.slotsOpen !== false
          ? ([{ key: "slot", label: "Claim your time slot", detail: "Pick when you want to be on air. You can move it later.", done: state.hasSlot, cta: "Choose a time", go: nav.onGoEvents }] as Step[])
          : []),
        { key: "materials", label: "Send us your media", detail: "Intro, outro, slides — anything you want us to roll. All optional.", done: state.hasMaterials, cta: "Upload your media", go: nav.onGoEvents },
        { key: "youtube", label: "Connect your YouTube to stream to", detail: "We open a broadcast on your own channel when your slot starts. Optional — it airs here either way.", done: state.hasYouTube, cta: "Connect YouTube", go: nav.onGoIntegrations },
        ...(state.hasSlot ? ([{ key: "share", label: "Share your slot", detail: "Your link shows your artwork and your time wherever you post it.", done: false, cta: "Get your link", go: nav.onGoPromotion }] as Step[]) : []),
      ]
    : [];

  return [...eventSteps, ...growth];
}
