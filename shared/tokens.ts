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
  creator: { key: "creator", name: "Creator", cents: 1995, yearCents: 19900, credits: 30, clipsPerEpisode: 4, overageCents: 60, blurb: "About 3 animated episodes a month, or 6 with Classic captions." },
  // Pro: 6 clips an episode for the same credits as 4 (≈90¢ more of Creatomate per episode, still well over cost).
  pro: { key: "pro", name: "Pro", cents: 4900, yearCents: 49000, credits: 90, clipsPerEpisode: 6, overageCents: 50, blurb: "About 10 animated episodes a month, or 18 with Classic captions — and 6 clips an episode instead of 4.", popular: true },
} as const;
/**
 * Yearly: two months free, and the year's credits (12 months' worth) the day
 * it's paid. No automatic extras — Stripe can't bill a monthly meter on a
 * yearly subscription — so a yearly plan tops up with credit packs.
 */
export type PlanInterval = "month" | "year";
export type PlanKey = keyof typeof PLANS;
export const planOf = (key: string) => (key in PLANS ? PLANS[key as PlanKey] : undefined);

/** The limit on extra credits each month, unless they choose another. */
export const DEFAULT_OVERAGE_CAP_CENTS = 2000;
export const OVERAGE_CAP_CHOICES = [0, 1000, 2000, 5000, 10000] as const;

/** Clips Pōstify makes from an episode (the clipper's CLIP_COUNT). */
export const CLIPS_PER_EPISODE = 4;

/**
 * What an episode costs in credits:
 *  - Classic captions: 1 credit a clip, every shape included;
 *  - Animated captions: 1 credit per shape, per clip;
 *  - the clean episode: 1 credit.
 */
export function episodeCredits(o: { formats: readonly string[]; captions: "animated" | "classic" }, clips = CLIPS_PER_EPISODE): number {
  return 1 + (o.captions === "classic" ? clips : clips * Math.max(1, o.formats.length));
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
  discovery: {
    key: "discovery", name: "Discovery Pro", cents: 2900, reveals: 100, lookups: 1000,
    blurb: "Find military and veteran creators, guests and sponsors, and reach them.",
    features: ["100 contact reveals a month (10 free)", "1,000 profile look-ups a month (200 free)", "Plus everything in free Discovery: every filter, saved lists, full profiles"],
  },
} as const;
export type AddonKey = keyof typeof ADDONS;
export const FREE_DISCOVERY = { reveals: 10, lookups: 200 } as const;

/** Not on the page: /pricing?test shows it, for trying a real payment for $1. */
export const TEST_PACK = { key: "tokens-2", tokens: 2, price: 1, blurb: "Test pack: a real $1 payment." } as const;
export const tokenPack = (key: string) => [...CREDIT_PACKS, TEST_PACK].find((p) => p.key === key);

export const cents = (n: number) => (n % 100 === 0 ? `$${n / 100}` : `$${(n / 100).toFixed(2)}`);
