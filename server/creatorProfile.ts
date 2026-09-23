// A creator, read in full.
//
// Two Influencers Club answers make one profile: the analytics answer (0.8
// credits — audience, growth, brands, lookalikes) and the raw answer (0.03 —
// the account itself and its latest posts). Both are cached raw, so this reader
// can grow new sections later and every profile already paid for gets them
// without being bought again.
//
// Nothing here guesses. A figure the index didn't send is null, and the page
// leaves that tile out rather than printing a zero.

type Weighted = { name: string; pct: number };

const num = (v: unknown): number | null => {
  if (v == null || v === "" || v === "None") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (v == null || v === "None" ? "" : String(v));
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const pct1 = (w: unknown) => Math.round((num(w) ?? 0) * 1000) / 10;

/** Pictures go through our proxy: the index's links are short-lived and cross-origin. */
export const viaProxy = (u: string) => (u ? `/api/discover/img?u=${encodeURIComponent(u)}` : "");

function weighted(list: unknown, n: number, nameOf: (x: any) => string = (x) => str(x?.name ?? x?.code)): Weighted[] {
  return arr(list)
    .map((x) => ({ name: nameOf(x), pct: pct1(x?.weight) }))
    .filter((x) => x.name && x.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, n);
}

const AGE_ORDER = ["13-17", "18-24", "25-34", "35-44", "45-64", "65-"];
const REACH_LABEL: Record<string, string> = { "-500": "Under 500", "500-1000": "500–1K", "1000-1500": "1K–1.5K", "1500-": "1.5K+" };

function readAudience(d: any, platform: string) {
  if (!d) return null;
  const types = Object.fromEntries(arr(d.audience_types).map((t) => [str(t?.code), pct1(t?.weight)]));
  const genders = Object.fromEntries(arr(d.audience_genders).map((t) => [str(t?.code).toLowerCase(), pct1(t?.weight)]));
  const brandAffinity = arr(d.audience_brand_affinity)
    .map((b) => ({ name: str(b?.name), pct: pct1(b?.weight), interests: arr(b?.interest).map((i) => str(i?.name ?? i)).filter(Boolean) }))
    .filter((b) => b.name && b.pct > 0)
    .sort((a, b) => b.pct - a.pct);
  // Each interest carries the brands its followers also follow — the "sub" lines.
  const interests = arr(d.audience_interests)
    .map((i) => ({ name: str(i?.name), pct: pct1(i?.weight), affinity: num(i?.affinity) }))
    .filter((i) => i.name && i.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 12)
    .map((i) => ({ ...i, brands: brandAffinity.filter((b) => b.interests.includes(i.name)).slice(0, 3).map(({ name, pct }) => ({ name, pct })) }));
  const person = (u: any) => {
    const handle = str(u?.username ?? u?.handle ?? u?.custom_name);
    return handle
      ? { handle, name: str(u?.fullname ?? u?.full_name ?? u?.custom_name) || handle, picture: viaProxy(str(u?.picture)), followers: num(u?.followers), url: str(u?.url), platform }
      : null;
  };
  const credibility = num(d.audience_credibility);
  return {
    credibility: credibility == null ? null : Math.round(credibility * 100),
    credibilityClass: str(d.credibility_class),
    types: {
      real: types.real ?? null,
      massFollowers: types.mass_followers ?? null,
      influencers: types.influencers ?? null,
      suspicious: types.suspicious ?? null,
    },
    reachability: arr(d.audience_reachability).map((r) => ({ name: REACH_LABEL[str(r?.code)] ?? str(r?.code), pct: pct1(r?.weight) })).filter((r) => r.pct > 0),
    femalePct: genders.female ?? null,
    malePct: genders.male ?? null,
    ages: weighted(d.audience_ages, 6, (x) => str(x?.code)).sort((a, b) => AGE_ORDER.indexOf(a.name) - AGE_ORDER.indexOf(b.name)),
    genderPerAge: arr(d.audience_genders_per_age)
      .map((g) => ({ name: str(g?.code), male: pct1(g?.male), female: pct1(g?.female) }))
      .sort((a, b) => AGE_ORDER.indexOf(a.name) - AGE_ORDER.indexOf(b.name)),
    ethnicities: weighted(d.audience_ethnicities, 5),
    languages: weighted(d.audience_languages, 6),
    countries: weighted(d.audience_geo?.countries, 8),
    states: weighted(d.audience_geo?.states, 8),
    cities: weighted(d.audience_geo?.cities, 8),
    interests,
    brandAffinity: brandAffinity.slice(0, 16).map(({ name, pct }) => ({ name, pct })),
    notable: arr(d.notable_users).map(person).filter(Boolean).slice(0, 12),
    notableRatio: num(d.notable_users_ratio) == null ? null : pct1(d.notable_users_ratio),
    lookalikes: arr(d.audience_lookalikes).map(person).filter(Boolean).slice(0, 18),
  };
}

function readPosts(platform: string, raw: any) {
  return arr(raw?.post_data)
    .map((p) => {
      const e = p?.engagement ?? {};
      if (platform === "youtube") {
        const t = p?.media?.thumbnails ?? {};
        return {
          url: str(p?.post_url) || (p?.video_id ? `https://www.youtube.com/watch?v=${p.video_id}` : ""),
          date: str(p?.published_at),
          text: str(p?.title),
          thumb: viaProxy(str(t.medium ?? t.high ?? t.default ?? (p?.video_id ? `https://i.ytimg.com/vi/${p.video_id}/mqdefault.jpg` : ""))),
          likes: num(e.like_count),
          comments: num(e.comment_count),
          views: num(e.view_count),
          video: "",
          kind: "video",
        };
      }
      const media = arr(p?.media);
      const image = media.find((m) => str(m?.type) === "image")?.url ?? p?.thumbnail ?? p?.cover ?? "";
      return {
        url: str(p?.post_url),
        date: str(p?.created_at ?? p?.create_time),
        text: str(p?.caption ?? p?.description ?? p?.text).slice(0, 400),
        thumb: viaProxy(str(image)),
        // Reels have no still: the page shows the video's first frame instead.
        video: image ? "" : str(media.find((m) => str(m?.type) === "video")?.url),
        likes: num(e.likes ?? e.like_count ?? p?.likes),
        comments: num(e.comments ?? e.comment_count ?? p?.comments),
        views: num(e.view_count ?? e.play_count ?? p?.views),
        kind: str(p?.product_type) === "clips" || media.some((m) => str(m?.type) === "video") ? "reel" : p?.is_carousel === true ? "carousel" : "post",
      };
    })
    .filter((p) => p.url || p.text)
    .sort((a, b) => Date.parse(b.date || "0") - Date.parse(a.date || "0"));
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * @param analytics the cached analytics answer's `result` (keyed by platform, or already unwrapped)
 * @param rawAnswer the cached raw answer's `result` (the same), or null if we haven't bought it
 */
export function buildProfile(platform: string, handle: string, analytics: any, rawAnswer: any, fetchedAt: string) {
  const a = analytics?.[platform] ?? analytics ?? {};
  const r = rawAnswer?.[platform] ?? rawAnswer ?? {};

  const followers = num(r.follower_count ?? r.subscriber_count ?? r.followers);
  const posts = readPosts(platform, r);

  // The audiences the index measured: followers always, likers or commenters when it could.
  const audiences: Record<string, ReturnType<typeof readAudience>> = {};
  for (const [k, label] of [["audience_followers", "followers"], ["audience_likers", "likers"], ["audience_commenters", "commenters"]] as const) {
    const block = a?.audience?.[k];
    if (block?.success && block?.data) audiences[label] = readAudience(block.data, platform);
  }
  const main = audiences.followers ?? audiences.likers ?? audiences.commenters ?? null;

  // Engagement: interactions on a typical recent post over the audience that could see it.
  const interactions = posts.map((p) => (p.likes ?? 0) + (p.comments ?? 0)).filter((n) => n > 0);
  const views = posts.map((p) => p.views ?? 0).filter((n) => n > 0);
  let engagementRate: number | null = null;
  let engagementBasis = "";
  if (platform === "youtube") {
    const perView = posts.filter((p) => (p.views ?? 0) > 0).map((p) => ((p.likes ?? 0) + (p.comments ?? 0)) / (p.views as number));
    const m = median(perView);
    if (m != null) { engagementRate = Math.round(m * 10000) / 100; engagementBasis = "likes + comments / views"; }
  } else if (followers) {
    const likes = num(a.likes_median), comments = num(a.comments_median);
    const m = likes != null ? likes + (comments ?? 0) : median(interactions);
    if (m != null) { engagementRate = Math.round((m / followers) * 10000) / 100; engagementBasis = "likes + comments / followers"; }
  }

  // Cadence from the dates themselves, over the span the posts cover.
  const dates = posts.map((p) => Date.parse(p.date)).filter((t) => Number.isFinite(t)).sort((x, y) => y - x);
  const lastPostAt = dates[0] ? new Date(dates[0]).toISOString() : str(a.last_short_video_upload_date || a.last_long_video_upload_date) || null;
  const spanWeeks = dates.length > 1 ? (dates[0] - dates[dates.length - 1]) / (7 * 86_400_000) : 0;
  const postsPerWeek = spanWeeks >= 1 ? Math.round(((dates.length - 1) / spanWeeks) * 10) / 10 : num(a.posting_frequency) != null ? Math.round(((num(a.posting_frequency) as number) / 4.33) * 10) / 10 : null;

  const growth = Object.entries(a.creator_follower_growth ?? {})
    .map(([k, v]) => ({ monthsAgo: Number(String(k).match(/\d+/)?.[0] ?? 0), pct: num(v) }))
    .filter((x): x is { monthsAgo: number; pct: number } => !!x.monthsAgo && x.pct != null)
    .sort((x, y) => y.monthsAgo - x.monthsAgo)
    .map((x) => ({ ...x, pct: Math.round(x.pct * 10) / 10 }));

  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const postsPerMonth = Object.entries(a.posts_per_month ?? {})
    .flatMap(([year, months]) => Object.entries((months as Record<string, unknown>) ?? {}).map(([m, n]) => ({ key: `${year}-${String(MONTHS.indexOf(m) + 1).padStart(2, "0")}`, label: `${m.slice(0, 3)} ${String(year).slice(2)}`, count: num(n) ?? 0 })))
    .sort((x, y) => x.key.localeCompare(y.key))
    .slice(-12);

  const real = main?.types.real ?? null;
  const topCountry = main?.countries[0] ?? null;
  const unique = (xs: unknown[]) => Array.from(new Set(xs.map((x) => str(x)).filter(Boolean)));

  return {
    platform,
    handle,
    fetchedAt,
    identity: {
      name: str(r.full_name ?? r.title ?? r.name) || handle,
      bio: str(r.biography ?? r.description),
      picture: viaProxy(str(r.profile_picture_hd ?? r.profile_picture)),
      followers,
      following: num(r.following_count),
      posts: num(r.media_count ?? r.video_count),
      totalViews: num(r.view_count),
      verified: str(r.is_verified) === "True" || r.is_verified === true,
      creatorType: r.is_business_account === true || str(r.is_business_account) === "True" ? "Business" : r.video_content_creator === true || platform === "youtube" || platform === "tiktok" ? "Creator" : r.exists ? "Personal" : "",
      category: str(r.category),
      country: str(r.country),
      since: str(r.published_at),
      links: arr(r.links_in_bio).map((l) => str(l?.url ?? l)).filter((u) => /^https?:\/\//.test(u)).slice(0, 5),
    },
    signals: {
      engagementRate,
      engagementBasis,
      lastPostAt,
      postsPerWeek,
      growth6m: growth.find((g) => g.monthsAgo === 6)?.pct ?? null,
      incomeMin: num(a.income?.min),
      incomeMax: num(a.income?.max),
      topCountry,
      femalePct: main?.femalePct ?? null,
      malePct: main?.malePct ?? null,
      realReach: followers != null && real != null ? Math.round((followers * real) / 100) : null,
      realPct: real,
      credibility: main?.credibility ?? null,
    },
    audiences,
    growth,
    postsPerMonth,
    posts: posts.slice(0, 12),
    content: {
      reelsPct: num(a.reels_percentage_last_12_posts),
      shortsPct: num(a.shorts_percentage),
      likesMedian: num(a.likes_median),
      commentsMedian: num(a.comments_median),
      reelsMedianViews: num(a.reels?.median_view_count),
      reelsAvgViews: num(a.reels?.avg_view_count),
      avgViewsLong: num(a.avg_views_long),
      avgViewsShorts: num(a.avg_views_shorts),
      medianViewsLong: num(a.median_views_long),
      engagementLong: num(a.engagement_percent_long),
      engagementShorts: num(a.engagement_percent_shorts),
      lastLongVideo: str(a.last_long_video_upload_date),
      lastShort: str(a.last_short_video_upload_date),
      hashtags: arr(a.hashtags_count).map((h) => ({ name: str(h?.name), count: num(h?.count) ?? 0 })).filter((h) => h.name.length > 1).slice(0, 20),
      keywords: unique(arr(a.keywords)).slice(0, 16),
      categories: unique([...arr(a.video_categories), ...arr(a.topic_details), ...arr(r.topic_details)]).slice(0, 8),
      niches: unique(arr(a.niche_sub_class)).slice(0, 10),
      promotesAffiliates: typeof a.promotes_affiliate_links === "boolean" ? a.promotes_affiliate_links : null,
      hasMerch: typeof a.has_merch === "boolean" ? a.has_merch : null,
    },
    brands: {
      pastSponsors: arr(a.past_sponsors)
        .map((s) => ({ handle: str(s?.handle ?? s?.brand_handle ?? s?.brand), posts: num(s?.post_count), firstSeen: str(s?.first_seen), lastSeen: str(s?.last_seen) }))
        .filter((s) => s.handle)
        .sort((x, y) => Date.parse(y.lastSeen || "0") - Date.parse(x.lastSeen || "0"))
        .slice(0, 24),
      sponsoredPosts: arr(a.sponsored_posts)
        .map((p) => ({ url: str(p?.post_url), date: str(p?.created_at), text: str(p?.caption).slice(0, 280), thumb: viaProxy(str(p?.thumbnail)), kind: str(p?.media_type) }))
        .filter((p) => p.url)
        .sort((x, y) => Date.parse(y.date || "0") - Date.parse(x.date || "0"))
        .slice(0, 9),
      mentioned: unique(arr(a.brands_found)).slice(0, 16),
      collaborators: unique(arr(a.tagged).map((t) => t?.username).filter((u) => u && String(u).toLowerCase() !== handle.toLowerCase())).slice(0, 12),
    },
  };
}

export type CreatorProfile = ReturnType<typeof buildProfile>;
