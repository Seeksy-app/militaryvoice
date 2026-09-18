// What the lineup's own channels reach, in a number a sponsor can be shown.
//
// Upload-Post already holds every connected account's platform analytics — we
// were reading one field out of it (followers) and throwing the rest away.
// This turns the whole payload into one figure per event, and it is written
// defensively for two reasons:
//
//   1. **The numbers arrive dirty.** Platforms report through Upload-Post's
//      passthrough, and a live probe came back with 17,891 shares on 744
//      impressions, and a negative save count. Publishing that to a sponsor is
//      worse than publishing nothing, so every figure is checked against the
//      others before it counts, and anything impossible is dropped and tallied
//      rather than clamped into the total silently.
//   2. **These are other people's audiences.** The line drawn here is between
//      an aggregate and an attribution. What comes out of this file is one set
//      of totals with no name, handle, show or per-account figure anywhere in
//      it — the collective reach of an event these podcasters signed up to be
//      broadcast on, which is fair to state. Naming a podcaster's own numbers
//      to a sponsor is a different thing, and that stays behind the
//      `shareAudienceStats` flag they set for themselves.
//
// The result is stored as a dated snapshot. Public pages read the snapshot;
// they never trigger the upstream calls, so a cold sponsor page is one DB read
// rather than a dozen third-party round trips.

import { storage } from "./storage.js";
import { rawAnalytics, isUploadPostConfigured, parseSocialAccounts, SOCIAL_PLATFORMS } from "./uploadPost.js";

export const AUDIENCE_SNAPSHOT_KEY = "audienceSnapshot";

/** The window Upload-Post's analytics cover. Stated on the page, not implied. */
export const AUDIENCE_WINDOW_DAYS = 365;

export interface PlatformTotal {
  platform: string;
  channels: number;
  followers: number;
}

export interface AudienceSnapshot {
  generatedAt: string;
  windowDays: number;
  /** Shows whose figures are in this total. */
  shows: number;
  /** Shows on the confirmed lineup, so the page can say "N of M so far". */
  showsTotal: number;
  channels: number;
  followers: number;
  reach: number;
  impressions: number;
  engagements: number;
  byPlatform: PlatformTotal[];
  /** Accounts whose numbers failed a sanity check and were left out. */
  dropped: number;
  /** Accounts the platform refused to report on (permissions, missing page id). */
  unavailable: number;
}

// ---------------------------------------------------------------------------
// Reading a payload whose shape differs per platform
// ---------------------------------------------------------------------------

/**
 * Find a number by any of its names, at any depth.
 *
 * Instagram calls it `reach`, YouTube calls it `views`, and the same platform
 * nests it differently between the profile block and the post block. Matching
 * on the key rather than a path means a schema change upstream costs us a
 * missing metric, not a wrong one.
 */
function pick(node: unknown, names: string[], depth = 0): number | null {
  if (depth > 4 || node == null || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  for (const name of names) {
    const v = obj[name];
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(/,/g, "")) : NaN;
    if (Number.isFinite(n)) return n;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const found = pick(v, names, depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
}

interface AccountFigures {
  followers: number;
  reach: number;
  impressions: number;
  engagements: number;
}

/** Upper bound on a plausible follower count. Above this, something is wrong. */
const MAX_FOLLOWERS = 50_000_000;

/**
 * Turn one platform's block into figures we're willing to publish, or null.
 *
 * The checks are deliberately cross-field. Any single number looks fine on its
 * own; it's the relationships that expose a bad feed — more engagement than
 * impressions, more unique people reached than times the thing was shown.
 */
export function sanitizeAccount(block: unknown): { figures: AccountFigures | null; reason: string } {
  if (!block || typeof block !== "object") return { figures: null, reason: "no data" };
  const b = block as Record<string, unknown>;
  if (b.success === false || (typeof b.error === "string" && b.error.trim() !== "")) {
    return { figures: null, reason: String(b.error || "platform declined") };
  }

  const followersRaw = pick(b, ["followers", "follower_count", "followers_count", "subscribers", "subscriber_count"]);
  const reachRaw = pick(b, ["reach", "accounts_reached", "unique_views", "reached_accounts"]);
  const impressionsRaw = pick(b, ["impressions", "views", "video_views", "plays", "profile_views"]);
  const likes = pick(b, ["likes", "like_count", "total_likes"]) ?? 0;
  const comments = pick(b, ["comments", "comment_count", "total_comments"]) ?? 0;
  const shares = pick(b, ["shares", "share_count", "total_shares"]) ?? 0;

  // Followers is the one figure we'll publish on its own, so it has to stand
  // on its own: a whole number inside a believable range.
  let followers = 0;
  if (followersRaw !== null && followersRaw >= 0 && followersRaw <= MAX_FOLLOWERS) followers = Math.round(followersRaw);
  else if (followersRaw !== null) return { figures: null, reason: `implausible follower count (${followersRaw})` };

  let reach = reachRaw !== null && reachRaw >= 0 ? Math.round(reachRaw) : 0;
  let impressions = impressionsRaw !== null && impressionsRaw >= 0 ? Math.round(impressionsRaw) : 0;
  let engagements = [likes, comments, shares].reduce((t, n) => t + (n >= 0 ? Math.round(n) : 0), 0);

  // Impressions are every time it was shown; reach is the people it was shown
  // to. Reach above impressions means one of the two is measuring something
  // else, so neither is safe to add up.
  if (reach > 0 && impressions > 0 && reach > impressions * 1.05) {
    reach = 0;
    impressions = 0;
  }

  // This is the check that caught X: 17,891 shares against 744 impressions.
  // Nobody shares a post more often than it was seen.
  if (engagements > 0 && impressions > 0 && engagements > impressions) engagements = 0;

  // A dead account reports nothing but its follower count, which is still
  // worth having. Only a completely empty read is a drop.
  if (followers === 0 && reach === 0 && impressions === 0 && engagements === 0) {
    return { figures: null, reason: "empty" };
  }
  return { figures: { followers, reach, impressions, engagements }, reason: "" };
}

// ---------------------------------------------------------------------------
// Building the snapshot
// ---------------------------------------------------------------------------

/**
 * Recompute from the live API. Costs one Upload-Post call per podcaster with
 * connected accounts, so nothing calls this on a page load — an admin asks.
 */
export async function buildAudienceSnapshot(eventId?: number): Promise<AudienceSnapshot> {
  const now = new Date().toISOString();
  const empty: AudienceSnapshot = {
    generatedAt: now,
    windowDays: AUDIENCE_WINDOW_DAYS,
    shows: 0,
    showsTotal: 0,
    channels: 0,
    followers: 0,
    reach: 0,
    impressions: 0,
    engagements: 0,
    byPlatform: [],
    dropped: 0,
    unavailable: 0,
  };
  if (!isUploadPostConfigured()) return empty;

  const profiles = await storage.listAllProfiles();
  const counted = profiles.filter((p) => p.uploadPostUsername.trim() !== "");

  // "N of M shows" only means something against a real lineup.
  if (eventId) {
    const signups = await storage.listSignups(eventId);
    empty.showsTotal = signups.filter((s) => s.status !== "cancelled").length;
  }

  const byPlatform = new Map<string, PlatformTotal>();
  let shows = 0;
  let channels = 0;
  let followers = 0;
  let reach = 0;
  let impressions = 0;
  let engagements = 0;
  let dropped = 0;
  let unavailable = 0;

  for (const profile of counted) {
    const accounts = parseSocialAccounts(profile.socialAccounts);
    const platforms = accounts.map((a) => a.platform).filter((p) => SOCIAL_PLATFORMS.includes(p));
    if (platforms.length === 0) continue;

    // Facebook only answers for a Page, and the Page id is what we stored as
    // the account's username the first time we asked. Without it every
    // Facebook account in the lineup comes back "page_id is required".
    const fb = accounts.find((a) => a.platform === "facebook");
    const pageId = fb && /^\d+$/.test(fb.username) ? fb.username : undefined;

    let res: Record<string, unknown>;
    try {
      res = await rawAnalytics(profile.uploadPostUsername, platforms, pageId);
    } catch (err) {
      // One podcaster's provider hiccup must not cost us the whole snapshot.
      console.warn(`audience: analytics failed for ${profile.uploadPostUsername}:`, (err as Error).message);
      unavailable += platforms.length;
      continue;
    }

    let counted = 0;
    for (const platform of platforms) {
      let { figures, reason } = sanitizeAccount(res[platform]);

      // A platform can refuse today and have answered last week — LinkedIn
      // wants an ADMINISTRATOR role we may not hold, and a Page can lose its
      // permission grant. We already hold that earlier answer on the account
      // itself, from the same provider, so a live refusal costs us the
      // engagement detail rather than the whole channel.
      if (!figures) {
        const cached = accounts.find((a) => a.platform === platform)?.followers;
        if (typeof cached === "number" && cached > 0 && cached <= MAX_FOLLOWERS) {
          figures = { followers: Math.round(cached), reach: 0, impressions: 0, engagements: 0 };
          reason = "";
        }
      }

      if (!figures) {
        if (reason === "empty" || reason === "no data") unavailable += 1;
        else if (/declined|permission|required|forbidden|403/i.test(reason)) unavailable += 1;
        else dropped += 1;
        continue;
      }
      counted += 1;
      channels += 1;
      followers += figures.followers;
      reach += figures.reach;
      impressions += figures.impressions;
      engagements += figures.engagements;
      const row = byPlatform.get(platform) ?? { platform, channels: 0, followers: 0 };
      row.channels += 1;
      row.followers += figures.followers;
      byPlatform.set(platform, row);
    }
    if (counted > 0) shows += 1;
  }

  return {
    ...empty,
    shows,
    channels,
    followers,
    reach,
    impressions,
    engagements,
    dropped,
    unavailable,
    byPlatform: Array.from(byPlatform.values()).sort((a, b) => b.followers - a.followers),
  };
}

export async function readAudienceSnapshot(): Promise<AudienceSnapshot | null> {
  const json = await storage.getSetting(AUDIENCE_SNAPSHOT_KEY);
  if (!json) return null;
  try {
    const v = JSON.parse(json) as AudienceSnapshot;
    return typeof v?.followers === "number" ? v : null;
  } catch {
    return null;
  }
}

export async function saveAudienceSnapshot(snap: AudienceSnapshot): Promise<void> {
  await storage.setSetting(AUDIENCE_SNAPSHOT_KEY, JSON.stringify(snap));
}
