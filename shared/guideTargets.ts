// What an account's guide (Lori for Frank, 21 Nov 2026) can open: a fixed list, nothing else. She offers
// ("Want me to open that for you?"). Only after the person taps "Yes, open it" does the page open, and then
// the walkthrough points at each control in turn (showGuide, with Next / Back / Stop). She only takes them
// there and points; they make every click. A step whose control isn't on screen is skipped.
//
// Step lines: start with the verb, one control each, 15 words at most (UI/UX copy pass).

export interface GuideTargetStep { sel: string; text: string }
/** optional: skipped at once (0.7 s) when its control isn't on screen, e.g. "Pick your show" when a show is already open. */
export interface GuideTarget {
  id: string;
  /** What she calls it in the offer: "Want me to open <label> for you?" */
  label: string;
  /** For her prompt: what's there, so she offers the right one. */
  about: string;
  path: string;
  /** One control per step, in order. Each step lists places to point, best first. */
  steps: { title: string; optional?: boolean; at: GuideTargetStep[] }[];
}

const t = (id: string, text: string): GuideTargetStep => ({ sel: `[data-testid="${id}"]`, text });
/** The show cards in the all-shows list (hosting-show-<id>; the dash keeps the hosting-shows grid out). */
const pickShow = { title: "Pick your show", optional: true, at: [{ sel: '[data-testid^="hosting-show-"]', text: "Pick your show first." }] };

export const GUIDE_TARGETS: GuideTarget[] = [
  { id: "home", label: "your home page", about: "The dashboard home: next steps, what's coming up, your files.", path: "/host/dashboard",
    steps: [{ title: "Your next steps", at: [t("alex-next", "Start here. Each step opens the page that does it.")] }] },
  { id: "library", label: "your Library", about: "Every recording and upload, including Zoom cloud recordings once Zoom is connected.", path: "/host/dashboard/library",
    steps: [
      { title: "Your Library", at: [t("library-folders", "Pick a folder. Zoom recordings land here on their own.")] },
      { title: "Your clips", at: [t("clips-library", "Open a recording to see its clips and files.")] },
    ] },
  { id: "zoom", label: "Connect Zoom", about: "Connect Zoom so cloud recordings come into the Library by themselves.", path: "/host/dashboard/integrations",
    steps: [
      { title: "Connect Zoom", at: [t("zoom-connect-button", "Click Connect Zoom and sign in to your Zoom account."), t("zoom-connect", "Click Connect Zoom and sign in to your Zoom account.")] },
      { title: "Bring recordings in", at: [t("zoom-auto", "Switch this on and new cloud recordings come in by themselves.")] },
    ] },
  { id: "youtube", label: "your YouTube stream key", about: "Paste your YouTube stream key once so your Radio segment and Go live also go out on your channel.", path: "/host/dashboard/integrations",
    steps: [{ title: "Add your YouTube stream key", at: [t("youtube-key-input", "Paste your stream key from YouTube Studio → Create → Go live → Stream, then press Save key.")] }] },
  { id: "social", label: "your social accounts", about: "Connect Instagram, TikTok, Facebook, LinkedIn and others so Pōstify can post for you.", path: "/host/dashboard/social",
    steps: [{ title: "Your accounts", at: [t("button-social-connect", "Click here and pick the accounts you use.")] }] },
  { id: "postify", label: "Pōstify", about: "Turn a recording into short clips with captions, ready to post.", path: "/host/dashboard/postify",
    steps: [
      { title: "Pick a recording", at: [t("recording-upload", "Drop a video here, or click to pick one.")] },
      { title: "Make the clips", at: [t("post-start-hero", "Click Start Pōstify and we cut the best moments into clips.")] },
    ] },
  { id: "podcast", label: "your podcast", about: "The show we host: its feed, artwork, details, and moving a show in from another host.", path: "/host/dashboard/podcast",
    steps: [{ title: "Your podcast", at: [
      t("hosting-move-yours", "Click here to move your show. Apple and Spotify keep your listing."),
      t("hosting-start", "Click here to set up your show. It's free."),
      { sel: '[data-testid^="hosting-show-"]', text: "Pick your show to see its episodes and settings." },
    ] }] },
  { id: "new-episode", label: "a new episode", about: "Add a new podcast episode from the Library or a file, and publish it or schedule it.", path: "/host/dashboard/podcast",
    steps: [
      { title: "New episode", at: [t("hosting-new-episode", "Click New episode.")] },
      { title: "Pick the audio", at: [t("new-episode-library", "Pick a recording from your Library."), t("new-episode-drop", "Drop the audio or video file here.")] },
    ] },
  { id: "guest-invite", label: "Invite a guest", about: "Invite a guest to be on your show: send them a link with the date, where you'll record, and your questions.", path: "/host/dashboard/podcast",
    steps: [
      pickShow,
      { title: "Invite a guest", at: [t("hosting-tab-invite", "Click Invite a guest.")] },
      { title: "Fill it in", at: [t("guest-invite-form", "Add their name and email, when, and where you'll record.")] },
      { title: "Send it", at: [t("guest-invite-submit", "Click here to send the invite.")] },
    ] },
  { id: "guest-book", label: "Book a guest", about: "Find people to have on your show: other podcasters and experts open to being a guest.", path: "/host/dashboard/podcast",
    steps: [
      pickShow,
      { title: "Book a guest", at: [t("hosting-tab-guests", "Click Book a guest to find people to have on.")] },
    ] },
  { id: "smartlink", label: "your SmartLink", about: "The one link for everything: show, episodes, socials, and the free podcast website.", path: "/host/dashboard/page",
    steps: [
      { title: "Your link", at: [t("bio-handle", "Pick the name for your link here. It saves as you go.")] },
      { title: "Fill it in", at: [t("bio-step", "Work down these steps. Everything saves as you go.")] },
    ] },
  { id: "studio", label: "your studio", about: "Record or go live with guests from the browser.", path: "/my-studio",
    steps: [
      { title: "Invite a guest", at: [t("my-studio-invite", "Click Invite and send the link to your guest.")] },
      { title: "Record", at: [t("my-studio-record", "Click Record when you're ready. It lands in your Library.")] },
      { title: "Go live", at: [t("my-studio-live", "Click Go live to stream to YouTube or another channel.")] },
    ] },
  { id: "photo", label: "your profile photo", about: "Add or change the photo shown on your SmartLink and show pages.", path: "/host/dashboard/profile",
    steps: [{ title: "Your photo", at: [t("button-upload-photo", "Click the circle and pick a photo.")] }] },
  { id: "analytics", label: "your podcast analytics", about: "Downloads and listens for the show.", path: "/host/dashboard/podcast-analytics",
    steps: [{ title: "Your numbers", at: [t("podcast-analytics", "See downloads and listens here.")] }] },
  { id: "billing", label: "your plan and billing", about: "What your plan includes and your billing. Opening it only; changes are yours to make.", path: "/host/dashboard/billing",
    steps: [{ title: "Your plan", at: [t("account-billing", "See your plan and what it includes here.")] }] },
];

export const guideTarget = (id: string) => GUIDE_TARGETS.find((x) => x.id === id);
