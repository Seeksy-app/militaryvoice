// Audience figures for accounts a podcaster has *not* connected to us.
//
// Upload-Post can only speak for the handful who went through its connect
// flow. For everyone else we have a profile link they typed at signup, which
// shared/socialLinks.ts turns into a platform and a handle — and that pair is
// exactly what this provider takes.
//
// Two things shape how this is written:
//
//   1. **One call answers for every platform.** The profile endpoint is asked
//      about one handle and returns a block per network it can match that
//      creator to, so asking about a YouTube handle can come back with their
//      Instagram and TikTok as well. Reading only the platform we asked about
//      would throw most of what we paid for away.
//   2. **Credits are consumed per successful result** (0.2 each, nothing when
//      there's no data). Nothing calls this on a schedule; a person asks for
//      it, for one handle or all of them.
//
// The response's nested per-platform shapes are not fully documented, so each
// number is read from a list of plausible keys and the untouched response is
// stored alongside — the readers can then be corrected without spending again.

const BASE = "https://api-dashboard.influencers.club/public/v1";

/** Platforms the profile endpoint accepts. Ours that it doesn't: threads. */
const SUPPORTED = new Set(["instagram", "youtube", "tiktok", "twitter", "facebook", "linkedin", "pinterest", "snapchat", "twitch", "discord", "onlyfans"]);

/** Our platform names to theirs. */
function providerPlatform(p: string): string | null {
  const v = p.toLowerCase();
  if (v === "x") return "twitter";
  return SUPPORTED.has(v) ? v : null;
}

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
  if (!res.ok) {
    // A 403 that answers in HTML is their web app, not their API — almost
    // always a wrong path rather than a wrong key, and worth saying so because
    // the two have very different fixes.
    const htmlish = text.trimStart().startsWith("<");
    const detail = htmlish ? "(HTML response — check the path, not the key)" : text.slice(0, 300);
    throw new Error(`influencers.club ${path} → ${res.status} ${detail}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`influencers.club ${path} returned something that isn't JSON: ${text.slice(0, 200)}`);
  }
}

/** How many credits are left, so a refresh can say what it will cost first. */
export async function credits(): Promise<unknown> {
  return call("/account/credits", { method: "GET" });
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

/** One platform's figures out of a profile response. */
export interface PlatformMetrics extends Metrics {
  platform: string;
  handle: string;
}

const FOLLOWER_KEYS = [
  "followers", "follower_count", "followers_count", "subscribers", "subscriber_count",
  "subscribers_count", "fans", "connections", "edge_followed_by",
];

/** Read one platform block out of `result`. Null when there's nothing usable. */
function readPlatform(platform: string, block: unknown): Omit<PlatformMetrics, "raw"> | null {
  if (!block || typeof block !== "object") return null;
  const followers = num(block, FOLLOWER_KEYS);
  const handle =
    (typeof (block as Record<string, unknown>).handle === "string" && (block as Record<string, string>).handle) ||
    (typeof (block as Record<string, unknown>).username === "string" && (block as Record<string, string>).username) ||
    "";
  const engagementRate = ratio(block, ["engagement_rate", "engagementRate", "engagement", "er"]);
  const avgViews = num(block, ["average_views", "avg_views", "avgViews", "median_views"]);
  const avgLikes = num(block, ["average_likes", "avg_likes", "avgLikes", "median_likes"]);
  const credibility = ratio(block, ["credibility", "audience_credibility", "follower_credibility", "real_followers"]);
  const audience = firstObject(block, ["audience", "demographics", "audience_demographics"]);
  if (followers === 0 && !engagementRate && avgViews === 0 && avgLikes === 0) return null;
  return { platform, handle: String(handle).replace(/^@/, ""), followers, engagementRate, avgViews, avgLikes, credibility, audience };
}

/**
 * Enrich one handle, and keep every platform the answer contains.
 *
 * Asking about a YouTube channel routinely comes back with the same creator's
 * Instagram and TikTok too. Those are already paid for by the one request, so
 * they are returned rather than discarded — which for a lineup where most
 * hosts only pasted a single link is most of the value.
 */
export async function enrichHandle(platform: string, handle: string): Promise<Metrics & { platforms: PlatformMetrics[] }> {
  const clean = handle.trim().replace(/^@/, "");
  const wanted = providerPlatform(platform);
  if (!wanted) throw new Error(`influencers.club does not cover ${platform}.`);

  const raw = await call("/creators/enrich/handle/profile/", {
    method: "POST",
    body: JSON.stringify({ handle: clean, platform: wanted, email_required: "preferred" }),
  });

  const result = (raw as { result?: Record<string, unknown> })?.result ?? {};
  const platforms: PlatformMetrics[] = [];
  for (const [name, block] of Object.entries(result)) {
    const read = readPlatform(name === "twitter" ? "x" : name, block);
    if (read) platforms.push({ ...read, handle: read.handle || clean, raw: block });
  }

  // The platform actually asked about leads, so a caller that only wants one
  // number gets the one it asked for.
  const primary = platforms.find((p) => p.platform === (platform === "x" ? "x" : platform.toLowerCase())) ?? platforms[0];
  return {
    followers: primary?.followers ?? 0,
    engagementRate: primary?.engagementRate ?? "",
    avgViews: primary?.avgViews ?? 0,
    avgLikes: primary?.avgLikes ?? 0,
    credibility: primary?.credibility ?? "",
    audience: primary?.audience ?? null,
    raw,
    platforms,
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
