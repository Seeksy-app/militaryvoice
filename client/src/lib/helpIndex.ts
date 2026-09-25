/**
 * What the help search can find. One entry per thing a podcaster or a
 * listener asks about, with the page that answers it and the words they
 * tend to use. Kept by hand: it is the map of the help, not the help itself.
 */
export interface HelpEntry {
  title: string;
  summary: string;
  href: string;
  keywords: string;
  /** Where it applies: everyone, or people on the lineup. */
  audience: "everyone" | "podcasters";
  /** The shelf it sits on, on the help hub. */
  category: HelpCategory;
  /** A question from the FAQ: found by search, and reached from the shelf's "More questions" link. */
  faq?: boolean;
}

export type HelpCategory = "lineup" | "showday" | "youtube" | "watching" | "sponsors";
export const HELP_CATEGORIES: { key: HelpCategory; title: string; blurb: string }[] = [
  { key: "lineup", title: "Getting on the lineup", blurb: "Your sign-in, your slot, your photo and your card." },
  { key: "showday", title: "Show day", blurb: "The green room, going live, a recorded episode, co-hosting." },
  { key: "youtube", title: "Your YouTube and Zoom", blurb: "Your segment on your channel, and your Zoom recordings in your Library." },
  { key: "watching", title: "Watching the marathon", blurb: "What it is, when it is, and how to catch a show." },
  { key: "sponsors", title: "Sponsors", blurb: "Backing a show, and what a sponsor gets." },
];

export const HELP_INDEX: HelpEntry[] = [
  {
    title: "Send your slot to your own YouTube",
    summary: "Connect your channel once and your segment streams there too, live. A 45-second video and the steps.",
    href: "/help/youtube",
    keywords: "youtube connect channel stream live integrations google verified advanced continue scope broadcast",
    audience: "podcasters",
    category: "youtube",
  },
  {
    title: "Google says the app isn't verified",
    summary: "That screen is expected while we're in Google's review. Press Advanced, then Go to Military Voice (unsafe), then Continue.",
    href: "/help/youtube#verified",
    keywords: "google not verified unverified warning advanced continue access blocked review",
    audience: "podcasters",
    category: "youtube",
  },
  {
    title: "Bring your Zoom recordings into your Library",
    summary: "Connect Zoom once in Integrations and your cloud recordings come into your Library, ready for Pōstify.",
    href: "/help/zoom",
    keywords: "zoom connect cloud recording recordings import library integrations meeting marketplace app postify pōstify",
    audience: "podcasters",
    category: "youtube",
  },
  {
    title: "Import past Zoom recordings",
    summary: "Press Import past recordings on the Zoom card, pick from the last 30 days, and it shows in your Library.",
    href: "/help/zoom#use",
    keywords: "zoom past old recordings import 30 days mp4 importing from zoom automatic auto new recording switch",
    audience: "podcasters",
    category: "youtube",
  },
  {
    title: "Disconnect or remove the Zoom app",
    summary: "Press Disconnect on the Zoom card, or remove MilitaryVoices in Zoom's App Marketplace. The connection is deleted at once.",
    href: "/help/zoom#remove",
    keywords: "zoom disconnect remove uninstall deauthorize revoke delete data marketplace added apps privacy scopes",
    audience: "podcasters",
    category: "youtube",
  },
  {
    title: "Sign in to your dashboard",
    summary: "Your email and a 6-digit code we send you. No password. Tick 'keep me signed in' on your own device.",
    href: "/host/dashboard",
    keywords: "sign in login code password email dashboard keep me signed in 30 days",
    audience: "podcasters",
    category: "lineup",
  },
  {
    title: "Pick or change your slot",
    summary: "Claim an open half-hour on the schedule, or move to another one from Event settings on your dashboard.",
    href: "/schedule",
    keywords: "slot time claim schedule change move release remove agenda when am I on",
    audience: "podcasters",
    category: "lineup",
  },
  {
    title: "Live, or a recorded episode",
    summary: "Go live from the green room in your window, or send us an episode you've already recorded and we roll it.",
    href: "/prepare",
    keywords: "pre-recorded prerecorded recorded episode upload file live format mp4 send us",
    audience: "podcasters",
    category: "showday",
  },
  {
    title: "The green room on show day",
    summary: "Where you wait with your camera on. Alex brings you to the stage when it's your turn. Be there 15 minutes early.",
    href: "/prepare",
    keywords: "green room studio camera mic show day on air stage producer alex call time",
    audience: "podcasters",
    category: "showday",
  },
  {
    title: "Co-host an hour with Riccoh or Alex",
    summary: "Take an hour on the main stage between shows. Pick it from Co-host Available Slots on your dashboard.",
    href: "/host/dashboard",
    keywords: "co-host cohost hour main stage riccoh alex between shows",
    audience: "podcasters",
    category: "showday",
  },
  {
    title: "Your photo and your card",
    summary: "A hi-res headshot, at least 1000 × 1000 pixels, and your show's details make your card on the lineup and the big screen.",
    href: "/host/dashboard",
    keywords: "photo headshot picture profile card lineup crop image hi-res high resolution size pixels blurry",
    audience: "podcasters",
    category: "lineup",
  },
  {
    title: "Connect your social accounts",
    summary: "Link the accounts you post from. They show as follow buttons on your card, and we post your promo cards for you.",
    href: "/host/dashboard",
    keywords: "social instagram tiktok facebook linkedin x threads connect accounts follow promo post upload-post",
    audience: "podcasters",
    category: "lineup",
  },
  {
    title: "Bring a sponsor to your segment",
    summary: "A sponsor on your segment is $250, and if you bring them you earn half. Bigger packages pay ten percent.",
    href: "/sponsors",
    keywords: "sponsor sponsorship money earn share package rev revenue bring",
    audience: "podcasters",
    category: "sponsors",
  },
  {
    title: "Recordings and clips after the show",
    summary: "Your segment's recording and the clips cut from it land on your dashboard under Media → Recordings.",
    href: "/host/dashboard",
    keywords: "recording clips download after the show video shorts captions",
    audience: "podcasters",
    category: "showday",
  },
  {
    title: "What is The Podcast Marathon?",
    summary: "26.2 miles of stories: one day of military and veteran podcasts, back to back, live, for National Military Podcast Day.",
    href: "/faq",
    keywords: "what is marathon podcastathon national military podcast day event about",
    audience: "everyone",
    category: "watching",
  },
  {
    title: "When is it, and how do I watch?",
    summary: "Monday, October 5, 2026, from 7:00 AM Eastern. Watch on the site or on YouTube; the agenda has every show and time.",
    href: "/agenda",
    keywords: "when date time watch agenda schedule lineup october 5 listen",
    audience: "everyone",
    category: "watching",
  },
  {
    title: "Get a reminder for a show",
    summary: "Press Remind me on any card on the agenda and we'll email you before it starts.",
    href: "/agenda",
    keywords: "reminder remind me email notify before show starts",
    audience: "everyone",
    category: "watching",
  },
  {
    title: "Does it cost anything?",
    summary: "No. Watching is free, and podcasters take a slot for free.",
    href: "/faq",
    keywords: "cost free price pay charge fee",
    audience: "everyone",
    category: "watching",
  },
  {
    title: "What is the Podcast Marathon?",
    summary: "From the FAQ.",
    href: "/faq#what-is-the-podcast-marathon",
    keywords: "faq what is the podcast marathon?",
    audience: "everyone",
    category: "watching",
    faq: true,
  },
  {
    title: "When is it?",
    summary: "From the FAQ.",
    href: "/faq#when-is-it",
    keywords: "faq when is it?",
    audience: "everyone",
    category: "watching",
    faq: true,
  },
  {
    title: "Who is hosting?",
    summary: "From the FAQ.",
    href: "/faq#who-is-hosting",
    keywords: "faq who is hosting?",
    audience: "everyone",
    category: "watching",
    faq: true,
  },
  {
    title: "Does it cost anything?",
    summary: "From the FAQ.",
    href: "/faq#does-it-cost-anything",
    keywords: "faq does it cost anything?",
    audience: "everyone",
    category: "watching",
    faq: true,
  },
  {
    title: "Who can claim a slot?",
    summary: "From the FAQ.",
    href: "/faq#who-can-claim-a-slot",
    keywords: "faq who can claim a slot?",
    audience: "everyone",
    category: "lineup",
    faq: true,
  },
  {
    title: "How do I claim a slot?",
    summary: "From the FAQ.",
    href: "/faq#how-do-i-claim-a-slot",
    keywords: "faq how do i claim a slot?",
    audience: "everyone",
    category: "lineup",
    faq: true,
  },
  {
    title: "Do I need a password?",
    summary: "From the FAQ.",
    href: "/faq#do-i-need-a-password",
    keywords: "faq do i need a password?",
    audience: "everyone",
    category: "lineup",
    faq: true,
  },
  {
    title: "How long is a slot, and how much of it am I on the air?",
    summary: "From the FAQ.",
    href: "/faq#how-long-is-a-slot-and-how-much-of-it-am-i-on-the-air",
    keywords: "faq how long is a slot, and how much of it am i on the air?",
    audience: "everyone",
    category: "showday",
    faq: true,
  },
  {
    title: "Can I hold more than one slot?",
    summary: "From the FAQ.",
    href: "/faq#can-i-hold-more-than-one-slot",
    keywords: "faq can i hold more than one slot?",
    audience: "everyone",
    category: "lineup",
    faq: true,
  },
  {
    title: "Can I change or cancel my slot?",
    summary: "From the FAQ.",
    href: "/faq#can-i-change-or-cancel-my-slot",
    keywords: "faq can i change or cancel my slot?",
    audience: "everyone",
    category: "lineup",
    faq: true,
  },
  {
    title: "Can I play an episode I already recorded instead of going live?",
    summary: "From the FAQ.",
    href: "/faq#can-i-play-an-episode-i-already-recorded-instead-of-going-live",
    keywords: "faq can i play an episode i already recorded instead of going live?",
    audience: "everyone",
    category: "showday",
    faq: true,
  },
  {
    title: "Where do I broadcast from?",
    summary: "From the FAQ.",
    href: "/faq#where-do-i-broadcast-from",
    keywords: "faq where do i broadcast from?",
    audience: "everyone",
    category: "showday",
    faq: true,
  },
  {
    title: "Why do you ask for my RSS feed?",
    summary: "From the FAQ.",
    href: "/faq#why-do-you-ask-for-my-rss-feed",
    keywords: "faq why do you ask for my rss feed?",
    audience: "everyone",
    category: "lineup",
    faq: true,
  },
  {
    title: "What does connecting my social accounts do?",
    summary: "From the FAQ.",
    href: "/faq#what-does-connecting-my-social-accounts-do",
    keywords: "faq what does connecting my social accounts do?",
    audience: "everyone",
    category: "lineup",
    faq: true,
  },
  {
    title: "What should I have ready?",
    summary: "From the FAQ.",
    href: "/faq#what-should-i-have-ready",
    keywords: "faq what should i have ready?",
    audience: "everyone",
    category: "showday",
    faq: true,
  },
  {
    title: "Do listeners need to claim anything?",
    summary: "From the FAQ.",
    href: "/faq#do-listeners-need-to-claim-anything",
    keywords: "faq do listeners need to claim anything?",
    audience: "everyone",
    category: "watching",
    faq: true,
  },
  {
    title: "How do I know when a show I care about is starting?",
    summary: "From the FAQ.",
    href: "/faq#how-do-i-know-when-a-show-i-care-about-is-starting",
    keywords: "faq how do i know when a show i care about is starting?",
    audience: "everyone",
    category: "watching",
    faq: true,
  },
  {
    title: "Where do I watch or listen?",
    summary: "From the FAQ.",
    href: "/faq#where-do-i-watch-or-listen",
    keywords: "faq where do i watch or listen?",
    audience: "everyone",
    category: "watching",
    faq: true,
  },
  {
    title: "I'm overseas. Will the times make sense?",
    summary: "From the FAQ.",
    href: "/faq#i-m-overseas-will-the-times-make-sense",
    keywords: "faq i'm overseas. will the times make sense?",
    audience: "everyone",
    category: "watching",
    faq: true,
  },
  {
    title: "Can I share a show?",
    summary: "From the FAQ.",
    href: "/faq#can-i-share-a-show",
    keywords: "faq can i share a show?",
    audience: "everyone",
    category: "watching",
    faq: true,
  },
];

/** Rank entries against a query: title hits first, then keywords, then summary. */
export function searchHelp(query: string, audience?: HelpEntry["audience"]): HelpEntry[] {
  const q = query.trim().toLowerCase();
  const terms = q.split(/\s+/).filter((t) => t.length > 1);
  const pool = audience ? HELP_INDEX.filter((e) => e.audience === audience || e.audience === "everyone") : HELP_INDEX;
  if (terms.length === 0) return pool;
  return pool
    .map((e) => {
      const title = e.title.toLowerCase();
      const kw = e.keywords.toLowerCase();
      const sum = e.summary.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (title.includes(t)) score += 5;
        if (kw.includes(t)) score += 3;
        if (sum.includes(t)) score += 1;
      }
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.e);
}
