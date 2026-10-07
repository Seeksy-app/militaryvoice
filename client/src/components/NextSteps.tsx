import { pathOf } from "@shared/schema";
import { showGuide, type GuideStep } from "@/components/Guide";

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
  /** An event planner has created at least one event of their own. */
  hasOwnEvent?: boolean;
  /** They said yes to being found by brands in Discovery. */
  openToBrands?: boolean;
  /** Discovery isn't on their plan (Growth creators): its step is left out. */
  discoveryLocked?: boolean;
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
  myevent: "",
  brands: "brands-optin",
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
  onGoMyEvents?: () => void;
}

/**
 * Where each step's pointer lands (7 Oct 2026): not the section, the control
 * itself, with a line saying what to do. Several places per step, best first,
 * because what's on screen depends on how far they've got.
 */
const t = (sel: string, text: string) => ({ sel: `[data-testid="${sel}"]`, text });
export const STEP_GUIDE: Partial<Record<keyof typeof STEP_ANCHOR, GuideStep>> = {
  photo: { title: "Add your photo", at: [t("button-upload-photo", "Click the circle and pick a photo. You can zoom and frame it before it saves.")] },
  smartlink: { title: "Your SmartLink", at: [
    t("bio-handle", "Pick the name for your link here, like militaryvoices.ai/yourname. Everything saves as you go."),
    t("bio-checklist", "Work down these steps. Everything saves as you go."),
  ] },
  podcast: { title: "Your podcast", at: [
    t("hosting-move-yours", "Move it here: your feed comes across and Apple and Spotify keep your listing."),
    t("hosting-start", "Click here to set up your show. It's free, and works with every podcast app."),
  ] },
  accounts: { title: "Your accounts", at: [t("button-social-connect", "Click here and pick the accounts you use. Pōstify can post to them for you.")] },
  postify: { title: "Pōstify", at: [
    t("recording-upload", "Drop a video here, or click to pick one. Your first one is free."),
    t("post-start-hero", "Click Start Pōstify and we'll cut the best moments into clips."),
  ] },
  brands: { title: "Let brands find you", at: [t("switch-brands-optin", "Switch this on and brands searching for creators can find you. We make the introduction.")] },
  discovery: { title: "Discovery", at: [t("discover-q", "Type a topic, like veteran entrepreneurs, and press Search.")] },
  myevent: { title: "Create your event", at: [{ sel: "#ev-name", text: "Start with its name. Pick the day and the slot length below, then Create my event." }] },
  show: { title: "Your show", at: [
    t("input-show-name", "Type your show's name, then Save show at the bottom."),
    { sel: '[data-testid^="button-choose-event-"]', text: "Pick the event to set your show up for." },
  ] },
  slot: { title: "Your time", at: [
    { sel: '[data-testid^="button-take-slot-"]:not([disabled])', text: "Pick a time that works. You can move it later." },
    { sel: '[data-testid^="button-choose-event-"]', text: "Pick the event first." },
  ] },
  materials: { title: "Your media", at: [t("button-media-yes", "Have an intro, outro or slides? Click here to add them. All optional."), t("input-asset-file", "Pick a file to send us.")] },
  youtube: { title: "YouTube", at: [t("button-youtube-connect", "Click here to connect your channel. We open the broadcast on it when your slot starts.")] },
  share: { title: "Share your slot", at: [t("input-share-link-copy", "Copy your link and post it anywhere. It shows your artwork and your time.")] },
};

/**
 * Take them to the screen, then point at the control.
 *
 * The screen swap is a React render, so the control can't exist yet when the
 * click happens. The pointer waits for it (and brings it into view); a step
 * without one scrolls to its section, polling briefly rather than guessing at
 * a delay.
 */
export function goToStep(step: Step): void {
  step.go();
  const guide = STEP_GUIDE[step.key];
  if (guide) { showGuide([guide]); return; }
  const id = STEP_ANCHOR[step.key];
  if (!id) return;
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
  const path = pathOf(state.interests);
  const goTo = (f?: () => void) => f ?? nav.onGoIntegrations;
  // Each path's own first steps (6 Oct): an event planner's are about their
  // event; a content creator's skip podcast hosting.
  // A brand's getting-started lives on its own home (BrandHome), not the creator checklist.
  if (path === "brand") return [];
  if (path === "planner") {
    return [
      { key: "myevent", label: "Create your event", detail: "Name it, pick the day and the slot length. It stays private until we approve it.", done: Boolean(state.hasOwnEvent), cta: "Create my event", go: goTo(nav.onGoMyEvents) },
      { key: "photo", label: "Add your photo", detail: "It goes on your event page as the organizer.", done: Boolean(state.hasPhoto), cta: "Add a photo", go: goTo(nav.onGoProfile) },
      { key: "discovery", label: "Find speakers in Discovery", detail: "Search military and veteran podcasters and creators by topic. 10 contact emails a month, free.", done: false, cta: "Open Discovery", go: goTo(nav.onGoDiscovery) },
      { key: "accounts", label: "Connect your social accounts", detail: "So clips from your event can go out to them.", done: state.hasAccounts, cta: "Connect accounts", go: nav.onGoIntegrations },
    ];
  }
  if (path === "creator") {
    return [
      { key: "photo", label: "Add your photo", detail: "It goes on your SmartLink and your directory card.", done: Boolean(state.hasPhoto), cta: "Add a photo", go: goTo(nav.onGoProfile) },
      { key: "smartlink", label: "Make your SmartLink", detail: "One link for every bio: your videos, your links, and a way to collect emails. Free.", done: Boolean(state.hasSmartLink), cta: "Make my SmartLink", go: goTo(nav.onGoPage) },
      { key: "accounts", label: "Connect your social accounts", detail: "Pōstify posts your clips to them, on a schedule.", done: state.hasAccounts, cta: "Connect accounts", go: nav.onGoIntegrations },
      { key: "postify", label: "Turn a video into clips", detail: "Your first one is free: short clips with captions, in every shape.", done: Boolean(state.hasClips), cta: "Try Pōstify", go: goTo(nav.onGoPostify) },
      { key: "brands", label: "Let brands find you", detail: "Show up when brands search for creators to sponsor or hire. We make the introduction.", done: Boolean(state.openToBrands), cta: "Turn it on", go: goTo(nav.onGoProfile) },
      ...(state.discoveryLocked ? [] : ([{ key: "discovery", label: "Find collaborators in Discovery", detail: "Creators and shows to work with, with their real reach.", done: false, cta: "Open Discovery", go: goTo(nav.onGoDiscovery) }] as Step[])),
    ];
  }
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
    { key: "brands", label: "Let brands find you", detail: "Show up when brands search for shows to sponsor. We make the introduction.", done: Boolean(state.openToBrands), cta: "Turn it on", go: go(nav.onGoProfile) },
    ...(want.includes("discover") && !state.discoveryLocked
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
