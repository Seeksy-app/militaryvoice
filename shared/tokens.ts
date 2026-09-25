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
  creator: { key: "creator", name: "Creator", cents: 1995, credits: 30, overageCents: 60, blurb: "About 3 animated episodes a month, or 6 with Classic captions." },
  pro: { key: "pro", name: "Pro", cents: 4900, credits: 90, overageCents: 50, blurb: "About 10 animated episodes a month, or 18 with Classic captions.", popular: true },
} as const;
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

/** Not on the page: /pricing?test shows it, for trying a real payment for $1. */
export const TEST_PACK = { key: "tokens-2", tokens: 2, price: 1, blurb: "Test pack: a real $1 payment." } as const;
export const tokenPack = (key: string) => (key === TEST_PACK.key ? TEST_PACK : undefined);

export const cents = (n: number) => (n % 100 === 0 ? `$${n / 100}` : `$${(n / 100).toFixed(2)}`);
