// Audience figures for the accounts podcasters have connected.
//
// influencers.club enriches a handle into followers, engagement and audience
// makeup. Two things shape how this is written:
//
//   1. Their response schema is not published. So nothing here assumes a field
//      name — each number is read from a list of plausible paths, and the
//      untouched response is stored alongside. When the real shape is known
//      from one live call, the readers get corrected and the stored raw rows
//      can be re-read without spending another credit.
//   2. Credits are consumed per successful result. Nothing calls this on a
//      schedule; a person asks for it, and asks for one handle or all of them.

const BASE = "https://api-dashboard.influencers.club";

export function isConfigured(): boolean {
  return Boolean((process.env.INFLUENCER_CLUB_API_KEY || "").trim());
}

function key(): string {
  const k = (process.env.INFLUENCER_CLUB_API_KEY || "").trim();
  if (!k) throw new Error("INFLUENCER_CLUB_API_KEY is not set.");
  return k;
}

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${key()}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`influencers.club ${path} → ${res.status} ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`influencers.club ${path} returned something that isn't JSON: ${text.slice(0, 200)}`);
  }
}

/** How many credits are left, so a refresh can say what it will cost first. */
export async function credits(): Promise<unknown> {
  return call("/account-credits-and-usage", { method: "GET" });
}

// ---------------------------------------------------------------------------
// Reading a response whose shape we don't have in writing
// ---------------------------------------------------------------------------

/** Walk a dotted path, tolerating arrays and missing links. */
function at(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, part) => {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) return cur[Number(part)] ?? undefined;
    if (typeof cur === "object") return (cur as Record<string, unknown>)[part];
    return undefined;
  }, obj);
}

/** The first path that yields a usable number. */
function num(obj: unknown, paths: string[]): number {
  for (const p of paths) {
    const v = at(obj, p);
    const n = typeof v === "string" ? Number(v.replace(/[, ]/g, "")) : typeof v === "number" ? v : NaN;
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
  }
  return 0;
}

/** Same, kept as text so "2.4" and "2.4%" both survive unrounded. */
function ratio(obj: unknown, paths: string[]): string {
  for (const p of paths) {
    const v = at(obj, p);
    const n = typeof v === "string" ? Number(v.replace(/[%, ]/g, "")) : typeof v === "number" ? v : NaN;
    if (!Number.isFinite(n)) continue;
    // Some providers give 0.024 for 2.4%. Anything under 1 is read as a share.
    return (n > 0 && n <= 1 ? n * 100 : n).toFixed(2);
  }
  return "";
}

function firstObject(obj: unknown, paths: string[]): unknown {
  for (const p of paths) {
    const v = at(obj, p);
    if (v && typeof v === "object") return v;
  }
  return null;
}

export interface Metrics {
  followers: number;
  engagementRate: string;
  avgViews: number;
  avgLikes: number;
  credibility: string;
  audience: unknown;
  raw: unknown;
}

/**
 * Pull one handle. Field paths are ordered most-to-least likely; every one of
 * them is a guess until a real response is seen, which is why `raw` is kept.
 */
export async function enrichHandle(platform: string, handle: string): Promise<Metrics> {
  const clean = handle.trim().replace(/^@/, "");
  const raw = await call("/enrich-by-handle/analytics", {
    method: "POST",
    body: JSON.stringify({ platform: platform.toLowerCase(), handle: clean, username: clean }),
  });

  return {
    followers: num(raw, [
      "followers",
      "data.followers",
      "profile.followers",
      "data.profile.followers",
      "analytics.followers",
      "followerCount",
      "data.follower_count",
    ]),
    engagementRate: ratio(raw, [
      "engagementRate",
      "engagement_rate",
      "data.engagement_rate",
      "analytics.engagement_rate",
      "data.analytics.engagement_rate",
    ]),
    avgViews: num(raw, ["avgViews", "average_views", "data.average_views", "analytics.average_views"]),
    avgLikes: num(raw, ["avgLikes", "average_likes", "data.average_likes", "analytics.average_likes"]),
    credibility: ratio(raw, [
      "credibility",
      "audience.credibility",
      "data.audience.credibility",
      "analytics.audience.credibility",
      "follower_credibility",
    ]),
    audience: firstObject(raw, ["audience", "data.audience", "analytics.audience", "data.analytics.audience"]),
    raw,
  };
}

/**
 * Deduplicated reach across several creators, when the provider can give it.
 *
 * This is the number worth publishing. Summing followings overstates badly —
 * the same person follows several shows in one community — and a sponsor's
 * marketing team discounts a sum to nothing. Returns null when the call isn't
 * available, so the caller can say "combined, not deduplicated" honestly
 * rather than quietly passing off a sum as reach.
 */
export async function audienceOverlap(handles: { platform: string; handle: string }[]): Promise<unknown | null> {
  if (handles.length < 2) return null;
  const q = new URLSearchParams({
    handles: handles.map((h) => `${h.platform}:${h.handle.replace(/^@/, "")}`).join(","),
  });
  try {
    return await call(`/audience-overlap?${q}`, { method: "GET" });
  } catch (err) {
    console.warn("audience overlap unavailable:", (err as Error).message);
    return null;
  }
}
