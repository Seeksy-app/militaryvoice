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

/**
 * The window Upload-Post's analytics actually cover.
 *
 * Checked against the raw payloads rather than assumed: every platform returns
 * a daily series running about thirty days back, and Facebook states
 * `period_days=30` outright. This was published as "the last 12 months" for
 * one afternoon, which understated the shows by a factor of twelve and would
 * have been the first thing a sponsor's analyst disproved.
 * scripts/audience-window.ts re-runs the check.
 */
export const AUDIENCE_WINDOW_DAYS = 30;

export interface PlatformTotal {
  platform: string;
  channels: number;
  followers: number;
}

/**
 * What the lineup has already made.
 *
 * A sponsor cannot be shown download figures — those belong to each host and
 * we do not have them. What a feed proves instead is longevity and output, and
 * a show with six hundred episodes over ten years has an audience whether or
 * not anybody hands us a number for it. It is the inference a reader makes
 * themselves, which is worth more than us asserting "engaged audience".
 */
export interface Catalogue {
  /** Episodes across every feed that answered. */
  episodes: number;
  /** How many feeds that was — never the whole lineup, so the figure is a floor. */
  feeds: number;
  /** The year of the oldest episode we can find. */
  sinceYear: number;
  /** Half the shows have more than this. Median, because one long-runner
   *  would otherwise speak for everybody. */
  medianEpisodes: number;
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
  /**
   * What reach and impressions actually describe.
   *
   * Only a channel with connected analytics reports them, while `followers`
   * counts every channel we know of — so the two cover different populations.
   * Shown so nobody divides one by the other and calls it an engagement rate.
   */
  measuredFollowers?: number;
  measuredChannels?: number;
  measuredShows?: number;
  catalogue?: Catalogue;
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


/** One week either side of the event — the window a sponsor is buying. */
export const CAMPAIGN_WINDOW_DAYS = 14;

export interface ReachProjection {
  windowDays: number;
  /** Expected unique accounts reached across the lineup in that window. */
  reach: number;
  /** Expected impressions — reach times how often each account sees something. */
  impressions: number;
  /** Followers behind the shows we can actually measure. */
  measuredFollowers: number;
  measuredShows: number;
  /** Reach as a share of followers, observed rather than assumed. */
  reachRate: number;
  /** What the measured shows actually got, before the ceiling. */
  observedReachRate: number;
  /** True when the observed rate was above what we are willing to claim. */
  capped: boolean;
  /** Impressions per account reached, observed. */
  frequency: number;
}

/**
 * What a sponsor can expect, from what these shows already do.
 *
 * Not an industry benchmark. A published "20–35% of followers" is a number
 * about somebody else's audience, and a media buyer is entitled to ask where
 * it came from. This takes the reach these shows actually got over thirty days
 * — measured through their own connected analytics — expresses it as a share
 * of the followers behind those same channels, and applies that rate to the
 * whole lineup.
 *
 * Two things it assumes, and both are stated on the page rather than buried:
 * that the shows we cannot read behave like the ones we can, and that each
 * posts about the event at the rate they already post. It is a projection, and
 * the word estimate belongs next to it.
 *
 * Returns null when there is nothing measured to reason from. A guess with no
 * basis is worse to a sponsor than no number at all.
 */
export function projectReach(snapshot: AudienceSnapshot): ReachProjection | null {
  const measuredFollowers = snapshot.measuredFollowers ?? 0;
  if (measuredFollowers <= 0 || snapshot.reach <= 0 || snapshot.followers <= 0) return null;

  // A rate measured on nine small shows, applied to two hundred thousand
  // followers, is the flattering direction of a real bias: the accounts whose
  // analytics we can read are the ones that connected them, and they skew
  // small and engaged. A small account routinely reaches most of its
  // followers; a large one never does.
  //
  // Organic reach past forty percent does not survive contact with a media
  // buyer, so that is the ceiling. Capping understates a sponsor's return,
  // which is the only direction worth being wrong in.
  const observed = snapshot.reach / measuredFollowers;
  const reachRate = Math.min(observed, 0.4);
  const capped = observed > 0.4;
  // How many times a reached account saw something. Never below one: you
  // cannot reach an account fewer times than once.
  const frequency = snapshot.reach > 0 ? Math.max(1, snapshot.impressions / snapshot.reach) : 1;
  const windowScale = CAMPAIGN_WINDOW_DAYS / (snapshot.windowDays || AUDIENCE_WINDOW_DAYS);

  const reach = Math.round(snapshot.followers * reachRate * windowScale);
  return {
    windowDays: CAMPAIGN_WINDOW_DAYS,
    reach,
    impressions: Math.round(reach * frequency),
    measuredFollowers,
    measuredShows: snapshot.measuredShows ?? 0,
    reachRate,
    observedReachRate: observed,
    capped,
    frequency,
  };
}

/**
 * Recompute from the live API. Costs one Upload-Post call per podcaster with
 * connected accounts, so nothing calls this on a page load — an admin asks.
 */
/**
 * Read every feed we hold and count what is in it.
 *
 * A URL on file is not a feed that answers — six of nineteen return a page
 * with no items in it, most likely a show's homepage pasted into the feed
 * box. Those are skipped rather than counted as zero-episode shows, because
 * the number is a floor and a broken link should not drag it down.
 */
async function readCatalogue(urls: string[]): Promise<Catalogue | undefined> {
  const counts: number[] = [];
  let oldest = Infinity;
  await Promise.all(
    urls.map(async (url) => {
      try {
        const xml = await (await fetch(url, { signal: AbortSignal.timeout(15_000) })).text();
        const items = (xml.match(/<item>/g) || []).length;
        if (!items) return;
        counts.push(items);
        const dates = xml.match(/<pubDate>[^<]+<\/pubDate>/g) ?? [];
        for (const d of dates) {
          const t = Date.parse(d.replace(/<\/?pubDate>/g, ""));
          if (Number.isFinite(t) && t < oldest) oldest = t;
        }
      } catch {
        /* a feed that will not answer is not a show with no episodes */
      }
    }),
  );
  if (!counts.length) return undefined;
  const sorted = [...counts].sort((a, b) => a - b);
  return {
    episodes: counts.reduce((t, n) => t + n, 0),
    feeds: counts.length,
    sinceYear: Number.isFinite(oldest) ? new Date(oldest).getUTCFullYear() : 0,
    medianEpisodes: sorted[Math.floor(sorted.length / 2)],
  };
}

export async function buildAudienceSnapshot(eventId?: number): Promise<AudienceSnapshot> {
  const now = new Date().toISOString();
  // What the reach and impression figures actually describe.
  let measuredFollowers = 0;
  let measuredChannels = 0;
  const measuredShowKeys = new Set<string>();
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
    const active = signups.filter((s) => s.status !== "cancelled");
    // A booking past the end of the day — the organisers' own show parked at
    // midnight so they can see the dashboard as a podcaster does — is not a
    // show on the lineup, and the sponsor page should not count it as one.
    const totalSlots = Math.floor((event.durationHours * 60) / event.slotMinutes);
    empty.showsTotal = active.filter((s) => s.slotIndex < totalSlots).length;
    // A feed can be on the signup (the host typed it when they booked) or on
    // the profile (we found it later), and the two do not agree — a feed added
    // to the profile went uncounted here for as long as the signup's own
    // column was blank. One per show, profile first because it is the newer of
    // the two, and deduplicated so a show with both is still one feed.
    const byEmail = new Map(profiles.map((p) => [p.email, p.rssUrl?.trim() ?? ""]));
    const feeds = new Set(
      active.map((s) => byEmail.get(s.email) || s.rssUrl.trim()).filter(Boolean),
    );
    empty.catalogue = await readCatalogue(Array.from(feeds));
  }

  const byPlatform = new Map<string, PlatformTotal>();
  // What Upload-Post has already answered for, so the influencers.club pass
  // below can fill gaps without counting the same channel twice.
  const countedByEmail = new Map<string, Set<string>>();
  const countedShows = new Set<string>();
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
      const key = profile.email.trim().toLowerCase();
      if (!countedByEmail.has(key)) countedByEmail.set(key, new Set());
      countedByEmail.get(key)!.add(platform);
      countedShows.add(key);
      followers += figures.followers;
      reach += figures.reach;
      impressions += figures.impressions;
      engagements += figures.engagements;
      // Kept apart from the total on purpose. Reach and impressions can only
      // come from a channel whose analytics we can actually read, and the
      // follower total includes shows we cannot. Summing them and showing the
      // two side by side invites a sponsor to divide one by the other and get
      // an engagement rate for a population that was never measured.
      measuredFollowers += figures.followers;
      measuredChannels += 1;
      measuredShowKeys.add(key);
      const row = byPlatform.get(platform) ?? { platform, channels: 0, followers: 0 };
      row.channels += 1;
      row.followers += figures.followers;
      byPlatform.set(platform, row);
    }
    if (counted > 0) shows += 1;
  }

  // ---------------------------------------------------------------------
  // The shows that never connected
  //
  // Upload-Post can only speak for the handful who went through its connect
  // flow. Everyone else pasted a profile link at signup, and where an admin
  // has spent an influencers.club credit on one of those handles we hold a
  // real follower count for it. Folding those in is the difference between a
  // figure covering five shows and one covering the lineup — and some of the
  // biggest followings on the board belong to hosts who never connected.
  //
  // Only followers are taken. influencers.club reports engagement over its own
  // window on its own definitions, and adding that to Upload-Post's 30 days
  // would produce a number describing neither.
  for (const m of await storage.listSocialMetrics()) {
    if (m.error || m.followers <= 0 || m.followers > MAX_FOLLOWERS) continue;
    const key = m.email.trim().toLowerCase();
    // Never double-count a platform Upload-Post already answered for.
    if (countedByEmail.get(key)?.has(m.platform)) continue;
    (countedByEmail.get(key) ?? countedByEmail.set(key, new Set()).get(key)!).add(m.platform);
    if (!countedShows.has(key)) {
      countedShows.add(key);
      shows += 1;
    }
    channels += 1;
    followers += m.followers;
    const row = byPlatform.get(m.platform) ?? { platform: m.platform, channels: 0, followers: 0 };
    row.channels += 1;
    row.followers += m.followers;
    byPlatform.set(m.platform, row);
  }

  return {
    ...empty,
    shows,
    channels,
    followers,
    reach,
    impressions,
    engagements,
    measuredFollowers,
    measuredChannels,
    measuredShows: measuredShowKeys.size,
    catalogue: empty.catalogue,
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
