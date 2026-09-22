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
}

export const HELP_INDEX: HelpEntry[] = [
  {
    title: "Send your slot to your own YouTube",
    summary: "Connect your channel once and your segment streams there too, live. A 45-second video and the steps.",
    href: "/help/youtube",
    keywords: "youtube connect channel stream live integrations google verified advanced continue scope broadcast",
    audience: "podcasters",
  },
  {
    title: "Google says the app isn't verified",
    summary: "That screen is expected while we're in Google's review. Press Advanced, then Go to MilitaryVoice.ai, then Continue.",
    href: "/help/youtube#verified",
    keywords: "google not verified unverified warning advanced continue access blocked review",
    audience: "podcasters",
  },
  {
    title: "Sign in to your dashboard",
    summary: "Your email and a 6-digit code we send you. No password. Tick 'keep me signed in' on your own device.",
    href: "/host/dashboard",
    keywords: "sign in login code password email dashboard keep me signed in 30 days",
    audience: "podcasters",
  },
  {
    title: "Pick or change your slot",
    summary: "Claim an open half-hour on the schedule, or move to another one from Event settings on your dashboard.",
    href: "/schedule",
    keywords: "slot time claim schedule change move release remove agenda when am I on",
    audience: "podcasters",
  },
  {
    title: "Live, or a recorded episode",
    summary: "Go live from the green room in your window, or send us an episode you've already recorded and we roll it.",
    href: "/prepare",
    keywords: "pre-recorded prerecorded recorded episode upload file live format mp4 send us",
    audience: "podcasters",
  },
  {
    title: "The green room on show day",
    summary: "Where you wait with your camera on. Alex brings you to the stage when it's your turn. Be there 15 minutes early.",
    href: "/prepare",
    keywords: "green room studio camera mic show day on air stage producer alex call time",
    audience: "podcasters",
  },
  {
    title: "Co-host an hour with Riccoh or Alex",
    summary: "Take an hour on the main stage between shows. Pick it from Co-host Available Slots on your dashboard.",
    href: "/host/dashboard",
    keywords: "co-host cohost hour main stage riccoh alex between shows",
    audience: "podcasters",
  },
  {
    title: "Your photo and your card",
    summary: "A hi-res headshot, at least 1000 × 1000 pixels, and your show's details make your card on the lineup and the big screen.",
    href: "/host/dashboard",
    keywords: "photo headshot picture profile card lineup crop image hi-res high resolution size pixels blurry",
    audience: "podcasters",
  },
  {
    title: "Connect your social accounts",
    summary: "Link the accounts you post from. They show as follow buttons on your card, and we post your promo cards for you.",
    href: "/host/dashboard",
    keywords: "social instagram tiktok facebook linkedin x threads connect accounts follow promo post upload-post",
    audience: "podcasters",
  },
  {
    title: "Bring a sponsor to your segment",
    summary: "A sponsor on your segment is $250, and if you bring them you earn half. Bigger packages pay ten percent.",
    href: "/sponsors",
    keywords: "sponsor sponsorship money earn share package rev revenue bring",
    audience: "podcasters",
  },
  {
    title: "Recordings and clips after the show",
    summary: "Your segment's recording and the clips cut from it land on your dashboard under Recordings & clips.",
    href: "/host/dashboard",
    keywords: "recording clips download after the show video shorts captions",
    audience: "podcasters",
  },
  {
    title: "What is The Podcast Marathon?",
    summary: "26.2 miles of stories: one day of military and veteran podcasts, back to back, live, for National Military Podcast Day.",
    href: "/faq",
    keywords: "what is marathon podcastathon national military podcast day event about",
    audience: "everyone",
  },
  {
    title: "When is it, and how do I watch?",
    summary: "Monday, October 5, 2026, from 7:00 AM Eastern. Watch on the site or on YouTube; the agenda has every show and time.",
    href: "/agenda",
    keywords: "when date time watch agenda schedule lineup october 5 listen",
    audience: "everyone",
  },
  {
    title: "Get a reminder for a show",
    summary: "Press Remind me on any card on the agenda and we'll email you before it starts.",
    href: "/agenda",
    keywords: "reminder remind me email notify before show starts",
    audience: "everyone",
  },
  {
    title: "Does it cost anything?",
    summary: "No. Watching is free, and podcasters take a slot for free.",
    href: "/faq",
    keywords: "cost free price pay charge fee",
    audience: "everyone",
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
