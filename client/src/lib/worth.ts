/**
 * Know your worth: what to ask a brand for one sponsored piece, per platform
 * and per kind of post. A starting point for a conversation, not a quote.
 *
 * How it's worked out, the way the rate tools (Social Bluebook, Later,
 * CreatorIQ) do it, but with every step visible:
 *
 * 1. A market rate per 1,000 followers for each kind of post: what sponsors
 *    typically pay creators of that size on that platform (2025-26 ranges).
 * 2. Adjusted by how the audience actually behaves, where we can see it:
 *    engagement against the platform's usual rate, reel views against what
 *    an account that size usually gets, how many followers are real people,
 *    and how much of the audience is in the US (what most of our sponsors buy).
 * 3. A premium for the niche: military and veteran audiences are hard to
 *    reach any other way, and defense, VA-adjacent and veteran-owned brands
 *    pay for that.
 * 4. Rounded, with a low and a high (20% either side) for the negotiation.
 */

export type WorthPlatform = "instagram" | "tiktok" | "youtube" | "facebook" | "x" | "linkedin" | "threads";

export interface WorthInput {
  platform: string;
  followers: number;
  /** Likes plus comments over followers, as a percent (0.71 = 0.71%). */
  engagementRate?: number | null;
  /** Median views of their reels / videos. */
  medianViews?: number | null;
  /** Share of followers who are real people, percent. */
  realPct?: number | null;
  /** Share of the audience in the US, percent. */
  usPct?: number | null;
}

export interface Deliverable { key: string; label: string; hint: string; low: number; mid: number; high: number }
export interface Factor { label: string; value: number; why: string }
export interface Worth { platform: WorthPlatform; followers: number; tier: string; deliverables: Deliverable[]; factors: Factor[] }

/** Dollars per 1,000 followers for one sponsored piece, and the engagement rate that counts as usual there. */
const RATES: Record<WorthPlatform, { bench: number; items: { key: string; label: string; hint: string; per1k: number; views?: boolean }[] }> = {
  instagram: { bench: 1.5, items: [
    { key: "reel", label: "Reel", hint: "A sponsored reel", per1k: 18, views: true },
    { key: "post", label: "Feed post", hint: "A sponsored photo or carousel", per1k: 12 },
    { key: "story", label: "Story", hint: "A story frame or set, 24 hours", per1k: 8 },
  ] },
  tiktok: { bench: 4, items: [
    { key: "video", label: "Video", hint: "A sponsored TikTok", per1k: 12, views: true },
  ] },
  youtube: { bench: 2, items: [
    { key: "integration", label: "Integration", hint: "A 60–90 second read inside an episode", per1k: 15, views: true },
    { key: "dedicated", label: "Dedicated video", hint: "A whole video about the brand", per1k: 32, views: true },
    { key: "short", label: "Short", hint: "A sponsored Short", per1k: 5 },
  ] },
  facebook: { bench: 0.5, items: [
    { key: "reel", label: "Reel", hint: "A sponsored reel", per1k: 8 },
    { key: "post", label: "Post", hint: "A sponsored post", per1k: 6 },
  ] },
  x: { bench: 0.5, items: [
    { key: "post", label: "Post", hint: "A sponsored post or thread", per1k: 3 },
  ] },
  linkedin: { bench: 2, items: [
    { key: "post", label: "Post", hint: "A sponsored post (professional audience)", per1k: 10 },
  ] },
  threads: { bench: 1, items: [
    { key: "post", label: "Post", hint: "A sponsored post", per1k: 4 },
  ] },
};

/** What an account that size usually gets on a reel or video, as a share of followers. */
const USUAL_VIEWS: Partial<Record<WorthPlatform, number>> = { instagram: 0.25, tiktok: 0.3, youtube: 0.1 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round5 = (v: number) => Math.max(25, Math.round(v / 5) * 5);

/**
 * A podcast's rates: sponsors buy host-read ads by CPM, dollars per 1,000
 * downloads an episode gets (2025-26 rates for host-read ads), with the same
 * premium for the military and veteran audience. The number that counts is
 * downloads per episode, not the show's lifetime total.
 */
export interface PodcastWorth { perEpisode: number; deliverables: Deliverable[]; factors: Factor[] }
const POD_RATES = [
  { key: "pre", label: "Pre-roll", hint: "15–30 seconds, read by you before the show", cpm: 18 },
  { key: "mid", label: "Mid-roll", hint: "60 seconds, read by you in the middle: the one sponsors want most", cpm: 25 },
  { key: "post", label: "Post-roll", hint: "15–30 seconds at the end", cpm: 10 },
  { key: "pack", label: "4-episode package", hint: "A mid-roll in four episodes in a row, at 10% off", cpm: 25 * 4 * 0.9 },
];
export function podcastWorthFor(perEpisode: number): PodcastWorth | null {
  if (!(perEpisode > 0)) return null;
  const niche = 1.1;
  const single = POD_RATES.filter((r) => r.key !== "pack").map((r) => {
    const mid = (perEpisode / 1000) * r.cpm * niche;
    return { key: r.key, label: r.label, hint: r.hint, low: round5(mid * 0.8), mid: round5(mid), high: round5(mid * 1.2) };
  });
  // The package is four of the mid-roll as priced above, 10% off: priced from its own floor-rounded
  // figure, or a small show's four reads came out at $25, the same as one (8 Oct).
  const m = single.find((d) => d.key === "mid")!;
  const pack = POD_RATES.find((r) => r.key === "pack")!;
  const four = (v: number) => Math.round((v * 4 * 0.9) / 5) * 5;
  const deliverables = [...single, { key: pack.key, label: pack.label, hint: pack.hint, low: four(m.low), mid: four(m.mid), high: four(m.high) }];
  return {
    perEpisode,
    deliverables,
    factors: [
      { label: "Downloads per episode", value: perEpisode, why: `about ${Math.round(perEpisode).toLocaleString()} for a typical recent episode` },
      { label: "Military & veteran audience", value: niche, why: "a niche brands can't reach easily any other way" },
    ],
  };
}

export function tierOf(followers: number): string {
  return followers < 10_000 ? "Nano creator" : followers < 100_000 ? "Micro creator" : followers < 500_000 ? "Mid-tier creator" : followers < 1_000_000 ? "Macro creator" : "Mega creator";
}

export function isWorthPlatform(p: string): p is WorthPlatform {
  return p in RATES;
}

export function worthFor(i: WorthInput): Worth | null {
  if (!isWorthPlatform(i.platform) || !(i.followers > 0)) return null;
  const table = RATES[i.platform];
  const factors: Factor[] = [];
  let shared = 1;
  if (i.engagementRate != null && i.engagementRate >= 0) {
    const f = clamp(Math.pow(Math.max(0.001, i.engagementRate) / table.bench, 0.4), 0.75, 1.5);
    shared *= f;
    factors.push({ label: "Engagement", value: f, why: `${i.engagementRate.toFixed(2)}% against a usual ${table.bench}% on this platform` });
  }
  if (i.realPct != null && i.realPct > 0) {
    const f = clamp(i.realPct / 80, 0.7, 1.1);
    shared *= f;
    factors.push({ label: "Real followers", value: f, why: `${Math.round(i.realPct)}% of followers are real people (80% is typical)` });
  }
  if (i.usPct != null && i.usPct >= 0) {
    const f = clamp(0.85 + 0.3 * (i.usPct / 100), 0.85, 1.15);
    shared *= f;
    factors.push({ label: "US audience", value: f, why: `${Math.round(i.usPct)}% of the audience is in the US` });
  }
  const niche = 1.1;
  shared *= niche;
  factors.push({ label: "Military & veteran audience", value: niche, why: "a niche brands can't reach easily any other way" });

  let viewsFactor: number | null = null;
  const usual = USUAL_VIEWS[i.platform];
  if (i.medianViews != null && i.medianViews > 0 && usual) {
    viewsFactor = clamp(Math.pow(i.medianViews / (i.followers * usual), 0.3), 0.8, 1.5);
    factors.push({ label: "Video views", value: viewsFactor, why: `${Math.round(i.medianViews).toLocaleString()} typical views, against ${Math.round(i.followers * usual).toLocaleString()} usual for this size (reels and videos only)` });
  }

  const deliverables = table.items.map((d) => {
    const mid = (i.followers / 1000) * d.per1k * shared * (d.views && viewsFactor != null ? viewsFactor : 1);
    return { key: d.key, label: d.label, hint: d.hint, low: round5(mid * 0.8), mid: round5(mid), high: round5(mid * 1.2) };
  });
  return { platform: i.platform, followers: i.followers, tier: tierOf(i.followers), deliverables, factors };
}
