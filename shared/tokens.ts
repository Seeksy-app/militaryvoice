/**
 * Pōstify pricing: a monthly plan with credits, and extra credits billed
 * automatically at the end of the month up to a limit the subscriber sets.
 * The server charges from these numbers, never from anything the browser sends.
 *
 * What a credit costs us, measured on real episodes (25 Sep 2026): an
 * animated vertical or wide clip ≈ 45¢ of Creatomate, a square ≈ 26¢; a
 * Classic clip (our own renderer) and a clean episode are pennies. So every
 * credit costs us at most ~50¢, and the plans sell them at 50–66¢.
 */
export const PLANS = {
  // Plan names (6 Oct 2026): Growth (free) → Scale → Pro. The key stays
  // "creator" so existing subscriptions and Stripe prices keep matching.
  creator: { key: "creator", name: "Scale", cents: 1995, yearCents: 19900, credits: 30, clipsPerEpisode: 4, overageCents: 60, blurb: "About 3 episodes a month with animated captions, or 6 with Classic." },
  // Pro: 6 clips an episode (12 credits animated, 7 Classic).
  pro: { key: "pro", name: "Pro", cents: 4900, quarterCents: 14700, yearCents: 49000, credits: 90, clipsPerEpisode: 6, overageCents: 50, blurb: "6 clips an episode instead of 4: about 7 episodes a month with animated captions, or 12 with Classic.", popular: true },
} as const;
/**
 * Yearly: two months free, and the year's credits (12 months' worth) the day
 * it's paid. No automatic extras — Stripe can't bill a monthly meter on a
 * yearly subscription — so a yearly plan tops up with credit packs.
 */
export type PlanInterval = "month" | "year" | "quarter";
/** Pro is paid every three months, no other way (Andrew, 17 Nov 2026): $49 a month, $147 a quarter, and its credits (90 a month) arrive three months at a time. */
export const QUARTERLY_ONLY: readonly string[] = ["pro"];
export type PlanKey = keyof typeof PLANS;
/** Studio hours a month (Andrew, 25 Nov 2026: "1. Agree"): recording or live in a creator's own Studio. */
export const STUDIO_HOURS = { growth: 2, creator: 4, pro: 10 } as const;
export const planOf = (key: string) => (key in PLANS ? PLANS[key as PlanKey] : undefined);

/**
 * Founding Members 2026, our Black Friday offer (Andrew, 19 Nov 2026: "Yes, card"). Scale paid monthly with the first
 * 30 days free (Stripe's own trial, card taken at checkout), one trial per email. Open until 11:59 pm ET on Sunday
 * 29 Nov 2026 (Andrew, 24 Nov: "ends midnight the Sunday following BF"; it was Dec 31). The plan's credits come on
 * day 1; extras aren't billed during the trial.
 */
// activationCents: $5 charged at checkout, once, not credited toward the plan (Andrew, 24 Nov: "add $5", so the card is
// really on file and they're committed). Shown only on Stripe's page, not on ours ("Let it be in Stripe the first time
// they see it"); off again if people stop there (Admin → Black Friday funnel: activation started vs finished).
// People who joined before pay nothing more.
export const FOUNDING = { plan: "creator", plans: ["creator", "pro"], trialDays: 30, activationCents: 500, endsAt: "2026-11-30T05:00:00.000Z", endsLabel: "Sunday, November 29", endsShort: "Sun, Nov 29", cohort: "founding-2026" } as const;
export const foundingOpen = (now = Date.now()) => now < Date.parse(FOUNDING.endsAt);

/** The limit on extra credits each month, unless they choose another. */
export const DEFAULT_OVERAGE_CAP_CENTS = 2000;
export const OVERAGE_CAP_CHOICES = [0, 1000, 2000, 5000, 10000] as const;

/** Clips Pōstify makes from an episode (the clipper's CLIP_COUNT). */
export const CLIPS_PER_EPISODE = 4;
/** A video this short is one clip: Pōstify cleans the whole thing, captions it and makes the three shapes, charged as one clip. */
export const SHORT_VIDEO_SEC = 120;

/**
 * What an episode costs in credits: a flat price for everything — every clip
 * in all three shapes, and the clean episode.
 *  - Animated captions: 2 credits a clip (8 for the usual 4; 12 for Pro's 6);
 *  - Classic captions: 1 credit a clip, plus 1 for the clean episode.
 * Our cost for an animated clip in all three shapes is about $1.15, so a
 * credit at 50–66¢ covers it.
 */
export function episodeCredits(o: { formats?: readonly string[]; captions: "animated" | "classic" }, clips = CLIPS_PER_EPISODE): number {
  return o.captions === "classic" ? clips + 1 : clips * 2;
}

/**
 * Credits bought once, no plan. A little dearer per credit than a plan (so a
 * regular show is better off subscribing), still well over what a credit
 * costs us. They don't run out while the beta lasts.
 */
export const CREDIT_PACKS = [
  { key: "pack-20", tokens: 20, price: 15, blurb: "An episode or two." },
  { key: "pack-50", tokens: 50, price: 35, blurb: "A season's highlights.", popular: true },
  { key: "pack-120", tokens: 120, price: 78, blurb: "For a network, or a backlog." },
] as const;

/**
 * Add-ons: their own monthly subscriptions, with or without a Pōstify plan.
 * Discovery Pro raises Discovery's monthly allowances (free: 10 contact
 * reveals, 200 look-ups).
 */
export const ADDONS = {
  // Repriced 17 Nov 2026 from Influencers Club's list price (about 42¢ a credit): a search page 0.24 credits, a full profile
  // about 0.83, a contact 0.2. At $50 a month the worst case is about $23 of cost; the old 1,000 look-ups could have cost far more.
  discovery: {
    key: "discovery", name: "Discovery Pro", cents: 5000, reveals: 50, lookups: 25, searches: 100,
    blurb: "Find military and veteran creators, guests and sponsors, and reach them.",
    features: ["100 searches a month", "25 full creator profiles a month", "50 contact emails a month", "Every filter, saved lists, and Verified creators included"],
  },
  // The creators we know: our own lineup, with their real numbers (Andrew, 17 Nov 2026). Cost to us is near nothing.
  verified: {
    key: "verified", name: "Verified creators", cents: 1000,
    blurb: "The creators MilitaryVoices knows: everyone who has been on our events, with their real reach.",
    features: ["Every creator on our lineup, with pictures and real numbers", "Their shows, branches and audiences", "Included with Pro and Discovery Pro"],
  },
  // Post-production for a show (17 Nov 2026): a Pro add-on of its own, $195 a month paid every three months ($585),
  // a separate subscription so it can stop while Pro carries on.
  production: {
    key: "production", name: "Production", cents: 19500, quarterCents: 58500, quarterly: true,
    // Up to two episodes a week of up to 60 minutes each (Andrew, 17 Nov 2026).
    weeklyEpisodes: 2, maxMinutes: 60,
    blurb: "We make your episodes: intro, outro and music, the guest card, and four clips, the moment your recording lands. Up to 2 episodes a week, up to 60 minutes each.",
    features: ["Up to 2 episodes a week, up to 60 minutes each", "The intro and outro, with music, on every episode", "A guest card with your guest's own name and photo", "Four clips an episode, in every shape", "Nothing posts until you've seen it"],
  },
} as const;
export type AddonKey = keyof typeof ADDONS;
/** What Scale and Pro get of Discovery without the add-on: a taste. */
export const FREE_DISCOVERY = { reveals: 10, lookups: 5, searches: 10 } as const;
/** Brands, agencies and event planners: Discovery is free for them, as it always was. */
export const HOUSE_DISCOVERY = { reveals: 10, lookups: 200 } as const;

/** Not on the page: /pricing?test shows it, for trying a real payment for $1. */
export const TEST_PACK = { key: "tokens-2", tokens: 2, price: 1, blurb: "Test pack: a real $1 payment." } as const;
export const tokenPack = (key: string) => [...CREDIT_PACKS, TEST_PACK].find((p) => p.key === key);

export const cents = (n: number) => (n % 100 === 0 ? `$${n / 100}` : `$${(n / 100).toFixed(2)}`);
