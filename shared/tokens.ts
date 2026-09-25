/**
 * Pōstify token packs, beta pricing. One token is one clip or one clean
 * episode; an episode (4 clips + its clean episode) is EPISODE_TOKENS. The
 * server charges from this list, never from a price the browser sends.
 * A clip costs us about $1.35 to make, so even the biggest pack is over cost.
 */
export const TOKEN_PACKS = [
  { key: "tokens-10", tokens: 10, price: 20, blurb: "Two episodes, to try it properly." },
  { key: "tokens-25", tokens: 25, price: 45, blurb: "A month of weekly episodes.", popular: true },
  { key: "tokens-60", tokens: 60, price: 96, blurb: "For a network, or a busy show." },
] as const;

/** Not on the page: /pricing?test shows it, for trying a real payment for $1. */
export const TEST_PACK = { key: "tokens-2", tokens: 2, price: 1, blurb: "Test pack: a real $1 payment." } as const;

export const EPISODE_TOKENS = 5;

export const tokenPack = (key: string) => [...TOKEN_PACKS, TEST_PACK].find((p) => p.key === key);
