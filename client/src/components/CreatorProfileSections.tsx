import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ExternalLink, Heart, MessageCircle, Eye, Star, ShieldCheck, Film, Image as ImageIcon, Youtube } from "lucide-react";

// The body of a creator's profile: nine numbered sections down the page and a
// contents list that follows you. Brand managers read a profile top to bottom
// once and then jump straight back to the part they argue about, so the
// contents list is the navigation, not a decoration.

type W = { name: string; pct: number };
type Person = { handle: string; name: string; picture: string; followers: number | null; url: string; platform: string };
type Audience = {
  credibility: number | null; credibilityClass: string;
  types: { real: number | null; massFollowers: number | null; influencers: number | null; suspicious: number | null };
  reachability: W[]; femalePct: number | null; malePct: number | null; ages: W[];
  genderPerAge: { name: string; male: number; female: number }[];
  ethnicities: W[]; languages: W[]; countries: W[]; states: W[]; cities: W[];
  interests: (W & { affinity: number | null; brands: W[] })[];
  brandAffinity: W[]; notable: Person[]; notableRatio: number | null; lookalikes: Person[];
};
type Post = { url: string; date: string; text: string; thumb: string; video?: string; likes: number | null; comments: number | null; views: number | null; kind: string };
export type Profile = {
  platform: string; handle: string; fetchedAt: string;
  identity: { name: string; bio: string; picture: string; followers: number | null; following: number | null; posts: number | null; totalViews: number | null; verified: boolean; creatorType: string; category: string; country: string; since: string; links: string[] };
  signals: { engagementRate: number | null; engagementBasis: string; lastPostAt: string | null; postsPerWeek: number | null; growth6m: number | null; incomeMin: number | null; incomeMax: number | null; topCountry: W | null; femalePct: number | null; malePct: number | null; realReach: number | null; realPct: number | null; credibility: number | null };
  audiences: Partial<Record<"followers" | "likers" | "commenters", Audience | null>>;
  growth: { monthsAgo: number; pct: number }[];
  postsPerMonth: { key: string; label: string; count: number }[];
  posts: Post[];
  content: {
    reelsPct: number | null; shortsPct: number | null; likesMedian: number | null; commentsMedian: number | null; reelsMedianViews: number | null; reelsAvgViews: number | null;
    avgViewsLong: number | null; avgViewsShorts: number | null; medianViewsLong: number | null; engagementLong: number | null; engagementShorts: number | null;
    lastLongVideo: string; lastShort: string; hashtags: { name: string; count: number }[]; keywords: string[]; categories: string[]; niches: string[];
    promotesAffiliates: boolean | null; hasMerch: boolean | null;
  };
  brands: {
    pastSponsors: { handle: string; posts: number | null; firstSeen: string; lastSeen: string }[];
    sponsoredPosts: { url: string; date: string; text: string; thumb: string; kind: string }[];
    mentioned: string[]; collaborators: string[];
  };
};

const NAVY = "#053877";
const GOLD = "#F0A71F";
const HEADLINE = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

const compact = (n: number | null | undefined) =>
  n == null ? "–" : Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(Math.abs(n) >= 10_000_000 ? 0 : 1)}M` : Math.abs(n) >= 1_000 ? `${(n / 1_000).toFixed(Math.abs(n) >= 10_000 ? 0 : 1)}K` : String(Math.round(n));
const money = (n: number | null) => (n == null ? "–" : `$${compact(n)}`);
const pctText = (n: number | null | undefined, d = 1) => (n == null ? "–" : `${n.toFixed(n >= 10 && d === 1 ? 0 : d)}%`);
const shortDate = (s: string) => (s && Number.isFinite(Date.parse(s)) ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
function ago(s: string | null): { value: string; sub: string } | null {
  if (!s || !Number.isFinite(Date.parse(s))) return null;
  const days = Math.max(0, Math.round((Date.now() - Date.parse(s)) / 86_400_000));
  return days === 0 ? { value: "Today", sub: "posted today" } : days < 14 ? { value: `${days} day${days === 1 ? "" : "s"}`, sub: "since the last post" } : days < 60 ? { value: `${Math.round(days / 7)} weeks`, sub: "since the last post" } : { value: `${Math.round(days / 30)} months`, sub: "since the last post" };
}
const brandUrl = (platform: string, h: string) => (platform === "youtube" ? `https://youtube.com/@${h}` : platform === "tiktok" ? `https://tiktok.com/@${h}` : `https://instagram.com/${h}`);

const SECTIONS = [
  ["signals", "Decision signals", "the numbers a brand decides on"],
  ["quality", "Audience quality", "who is really watching"],
  ["growth", "Growth & trajectory", "where the account is heading"],
  ["posts", "Recent posts", "what they've put out lately"],
  ["content", "Content patterns", "how they post"],
  ["demographics", "Demographics", "gender and age"],
  ["geo", "Geography & language", "where the audience is"],
  ["brands", "Brand collaborations", "who has paid them, and who they mention"],
  ["lookalikes", "Lookalikes", "creators with an audience like this one"],
] as const;
type SectionKey = (typeof SECTIONS)[number][0];

function Img({ src, className, alt = "" }: { src: string; className?: string; alt?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return null;
  return <img src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} className={className} />;
}

/** A reel's first frame, for posts that come with a video and no still. */
function Frame({ src }: { src: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return null;
  return <video src={`${src}#t=0.5`} muted playsInline preload="metadata" onError={() => setBroken(true)} className="absolute inset-0 h-full w-full object-cover" />;
}

function Face({ p, size = 44 }: { p: Pick<Person, "picture" | "name">; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initials = p.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  if (!p.picture || broken)
    return <span className="flex shrink-0 items-center justify-center rounded-full bg-[#053877]/10 font-bold text-[#053877]" style={{ width: size, height: size, fontSize: size / 2.8 }}>{initials}</span>;
  return <img src={p.picture} alt="" loading="lazy" onError={() => setBroken(true)} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
}

function Tile({ label, value, sub, star, tone }: { label: string; value: ReactNode; sub?: ReactNode; star?: boolean; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "warn" ? "text-[#b36b00]" : tone === "bad" ? "text-destructive" : "text-foreground";
  return (
    <div className={`p-4 ${star ? "bg-[#f3f6fb] dark:bg-[#0c1830]" : "bg-card"}`}>
      <div className={`flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.1em] ${star ? "text-[#053877] dark:text-[#8fb5e8]" : "text-muted-foreground"}`}>
        {star && <Star className="h-3 w-3 fill-current" />} {label}
      </div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums tracking-tight ${color}`} style={HEADLINE}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function TileGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}

function Bars({ items, color = NAVY, max: fixedMax }: { items: W[]; color?: string; max?: number }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">Not measured.</p>;
  const max = fixedMax ?? Math.max(1, ...items.map((i) => i.pct));
  return (
    <ul className="flex flex-col gap-2">
      {items.map((i) => (
        <li key={i.name} className="grid grid-cols-[minmax(0,10rem)_1fr_3.25rem] items-center gap-3 text-sm">
          <span className="truncate" title={i.name}>{i.name}</span>
          <span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full" style={{ width: `${(i.pct / max) * 100}%`, background: color }} /></span>
          <span className="text-right tabular-nums text-muted-foreground">{pctText(i.pct)}</span>
        </li>
      ))}
    </ul>
  );
}

function Block({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <h4 className="mb-3 text-sm font-semibold">{title}</h4>
      {children}
    </div>
  );
}

function Chips({ items, href }: { items: string[]; href?: (s: string) => string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t) =>
        href ? (
          <a key={t} href={href(t)} target="_blank" rel="noreferrer" className="rounded-full border border-border px-2.5 py-1 text-xs hover:border-[#053877]/40 hover:text-[#053877]">{t}</a>
        ) : (
          <span key={t} className="rounded-full border border-border px-2.5 py-1 text-xs">{t}</span>
        ),
      )}
    </div>
  );
}

const INTEREST_COLORS = ["#16a34a", "#7c3aed", "#4f46e5", "#0891b2", "#d97706", "#dc2626", "#db2777", "#0d9488", "#65a30d", "#9333ea", "#2563eb", "#ea580c"];

export function CreatorProfileSections({ profile, cardEngagement, scrollRoot, onOpenCreator, similar }: {
  profile: Profile;
  /** The search card's figure, used when the posts alone can't give one. */
  cardEngagement: number | null;
  scrollRoot: RefObject<HTMLElement>;
  onOpenCreator: (p: Person) => void;
  /** The paid "more like this" search, run only when asked. */
  similar: ReactNode;
}) {
  const sources = (["followers", "likers", "commenters"] as const).filter((k) => profile.audiences[k]);
  const [source, setSource] = useState<(typeof sources)[number] | undefined>(sources[0]);
  useEffect(() => setSource(sources[0]), [profile.handle]); // eslint-disable-line react-hooks/exhaustive-deps
  const aud = (source && profile.audiences[source]) || null;
  const [active, setActive] = useState<SectionKey>("signals");
  const refs = useRef<Partial<Record<SectionKey, HTMLElement | null>>>({});

  // Scroll-spy: the section whose heading last crossed the top third is "here".
  useEffect(() => {
    const root = scrollRoot.current;
    if (!root) return;
    const onScroll = () => {
      const top = root.getBoundingClientRect().top + root.clientHeight * 0.3;
      let here: SectionKey = "signals";
      for (const [k] of SECTIONS) {
        const el = refs.current[k];
        if (el && el.getBoundingClientRect().top <= top) here = k;
      }
      setActive(here);
    };
    onScroll();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [scrollRoot, profile.handle]);
  const jump = (k: SectionKey) => refs.current[k]?.scrollIntoView({ behavior: "smooth", block: "start" });

  const s = profile.signals;
  const c = profile.content;
  const yt = profile.platform === "youtube";
  const last = ago(s.lastPostAt);
  const engagement = s.engagementRate ?? cardEngagement;
  const cls = (aud?.credibilityClass || "").toLowerCase();
  const credLabel = cls === "high" ? "High" : cls === "normal" ? "Normal" : cls === "bad" || cls === "low" ? "Low" : "";
  const credTone = aud?.credibility == null ? undefined : aud.credibility >= 80 ? "good" : aud.credibility >= 60 ? "warn" : "bad";

  const section = (k: SectionKey, i: number, body: ReactNode) => {
    const [, title, sub] = SECTIONS[i];
    return (
      <section key={k} ref={(el) => { refs.current[k] = el; }} className="scroll-mt-4 border-b border-border px-5 py-8 last:border-b-0 sm:px-8" data-testid={`profile-section-${k}`}>
        <h3 className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm font-semibold tabular-nums text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
          <span className="text-xl font-bold tracking-tight" style={HEADLINE}>{title}</span>
          <span className="text-sm text-muted-foreground">{sub}</span>
        </h3>
        {body}
      </section>
    );
  };

  const sourceSwitch = sources.length > 1 && (
    <div className="flex gap-1 rounded-full bg-muted p-1 text-xs">
      {sources.map((k) => (
        <button key={k} type="button" onClick={() => setSource(k)} className={`flex-1 rounded-full px-2.5 py-1 font-medium capitalize ${source === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`} data-testid={`audience-source-${k}`}>{k}</button>
      ))}
    </div>
  );

  const typeBar = aud && [
    ["Real people", aud.types.real, "#15803d"],
    ["Mass followers", aud.types.massFollowers, "#d4a017"],
    ["Influencers", aud.types.influencers, "#3b82f6"],
    ["Suspicious", aud.types.suspicious, "#c2410c"],
  ].filter(([, v]) => v != null) as [string, number, string][];

  const maxPerMonth = Math.max(1, ...profile.postsPerMonth.map((m) => m.count));

  return (
    <div className="lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)]">
      {/* contents */}
      <nav aria-label="Profile sections" className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur lg:h-[calc(100dvh-1px)] lg:border-b-0 lg:border-r lg:bg-transparent lg:backdrop-blur-0">
        <div className="flex gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none] lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-4 lg:py-6 [&::-webkit-scrollbar]:hidden">
          <div className="hidden px-2 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground lg:block">Sections</div>
          {SECTIONS.map(([k, title], i) => (
            <button key={k} type="button" onClick={() => jump(k)} className={`flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${active === k ? "bg-[#053877]/[0.08] font-semibold text-[#053877] dark:bg-white/10 dark:text-white" : "text-muted-foreground hover:text-foreground"}`} data-testid={`toc-${k}`}>
              <span className="text-xs tabular-nums opacity-70">{String(i + 1).padStart(2, "0")}</span>
              <span className="whitespace-nowrap">{title}</span>
            </button>
          ))}
          {sourceSwitch && (
            <div className="hidden px-2 pt-6 lg:block">
              <div className="pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Audience measured on</div>
              {sourceSwitch}
            </div>
          )}
        </div>
      </nav>

      <div className="min-w-0">
        {section("signals", 0, (
          <TileGrid>
            <Tile label="Engagement rate" value={pctText(engagement, 2)} sub={s.engagementBasis || "per post"} tone={engagement == null ? undefined : engagement >= 3 ? "good" : engagement >= 1 ? undefined : "warn"} />
            <Tile label="Most recent post" value={last?.value ?? "–"} sub={last?.sub} tone={!s.lastPostAt ? undefined : Date.now() - Date.parse(s.lastPostAt) < 30 * 86_400_000 ? "good" : "warn"} />
            <Tile label="Follower change · 6 mo" value={s.growth6m == null ? "–" : `${s.growth6m > 0 ? "+" : ""}${s.growth6m.toFixed(1)}%`} sub="as reported by the index" />
            <Tile label="Posting cadence" value={s.postsPerWeek == null ? "–" : <>{s.postsPerWeek}<span className="text-sm font-medium text-muted-foreground"> / wk</span></>} />
            <Tile label="Est. income" value={s.incomeMin == null ? "–" : s.incomeMax && s.incomeMax !== s.incomeMin ? `${money(s.incomeMin)}–${money(s.incomeMax)}` : money(s.incomeMin)} sub="from sponsored posts, a month" />
            <Tile label="Creator type" value={profile.identity.creatorType || "–"} sub={profile.identity.category || (profile.identity.verified ? "verified account" : undefined)} />
            <Tile label="Top audience country" value={s.topCountry ? pctText(s.topCountry.pct) : "–"} sub={s.topCountry?.name} />
            <Tile label="Audience gender" value={s.femalePct == null ? "–" : `${Math.round(s.femalePct)}% F · ${Math.round(s.malePct ?? 100 - s.femalePct)}% M`} />
            <Tile star label="Real reach" value={compact(s.realReach)} sub={s.realPct != null ? `${pctText(s.realPct)} of followers are real people` : undefined} />
            <Tile star label="Audience credibility" value={s.credibility == null ? "–" : <>{s.credibility}<span className="text-sm font-medium text-muted-foreground"> /100</span></>} tone={s.credibility == null ? undefined : s.credibility >= 80 ? "good" : s.credibility >= 60 ? "warn" : "bad"} />
            <Tile star label="Followers" value={compact(profile.identity.followers)} sub={profile.identity.posts != null ? `${compact(profile.identity.posts)} ${yt ? "videos" : "posts"}` : undefined} />
          </TileGrid>
        ))}

        {section("quality", 1, aud ? (
          <div className="flex flex-col gap-8">
            {sourceSwitch && <div className="max-w-xs lg:hidden">{sourceSwitch}</div>}
            {(aud.credibility != null || (typeBar && typeBar.length > 0)) && (
              <div>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="font-semibold">Audience credibility</h4>
                    <p className="text-sm text-muted-foreground">based on the {source ?? "followers"} the index could measure</p>
                  </div>
                  {aud.credibility != null && (
                    <div className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 ${credTone === "good" ? "border-emerald-500/30 bg-emerald-500/10" : credTone === "warn" ? "border-[#F0A71F]/40 bg-[#F0A71F]/10" : "border-destructive/30 bg-destructive/10"}`}>
                      <ShieldCheck className="h-4 w-4" />
                      <span className="text-xl font-bold tabular-nums">{aud.credibility}</span>
                      <span className="text-sm text-muted-foreground">/100</span>
                      {credLabel && <span className="border-l border-border pl-2 text-sm font-semibold">{credLabel}</span>}
                    </div>
                  )}
                </div>
                {typeBar && typeBar.length > 0 && (
                  <>
                    <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-muted">
                      {typeBar.map(([n, v, col]) => <span key={n} title={`${n} ${v}%`} style={{ width: `${v}%`, background: col }} />)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                      {typeBar.map(([n, v, col]) => (
                        <span key={n} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: col }} /><span className="font-semibold tabular-nums">{pctText(v)}</span> {n}</span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {aud.reachability.length > 0 && (
              <Block title="How many accounts their audience follows">
                <p className="-mt-2 mb-3 text-xs text-muted-foreground">Under 1,500 means a post has a fair chance of being seen in the feed.</p>
                <Bars items={aud.reachability} max={100} />
              </Block>
            )}
            {aud.interests.length > 0 && (
              <Block title="Audience interests">
                <div className="grid gap-x-10 gap-y-5 md:grid-cols-2">
                  {aud.interests.map((it, i) => {
                    const col = INTEREST_COLORS[i % INTEREST_COLORS.length];
                    return (
                      <div key={it.name}>
                        <div className="flex items-baseline justify-between gap-3 border-b border-border pb-1.5">
                          <span className="inline-flex items-center gap-2 font-semibold" style={{ color: col }}><span className="h-2 w-2 rounded-full" style={{ background: col }} />{it.name}</span>
                          <span className="font-bold tabular-nums">{pctText(it.pct)}</span>
                        </div>
                        {it.brands.length > 0 && (
                          <ul className="mt-1.5 flex flex-col gap-1">
                            {it.brands.map((b) => (
                              <li key={b.name} className="grid grid-cols-[1fr_5rem_3rem] items-center gap-3 pl-4 text-sm">
                                <span className="truncate text-muted-foreground">› {b.name}</span>
                                <span className="h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, (b.pct / Math.max(1, it.pct)) * 100)}%`, background: col }} /></span>
                                <span className="text-right text-xs tabular-nums text-muted-foreground">{pctText(b.pct)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">Under each interest: brands that same audience follows.</p>
              </Block>
            )}
            {aud.notable.length > 0 && (
              <Block title={`Notable accounts in the audience${aud.notableRatio != null ? ` · ${pctText(aud.notableRatio)} of it` : ""}`}>
                <div className="flex flex-wrap gap-3">
                  {aud.notable.slice(0, 10).map((p) => (
                    <a key={p.handle} href={p.url || brandUrl(profile.platform, p.handle)} target="_blank" rel="noreferrer" className="flex w-40 items-center gap-2 rounded-xl border border-border p-2 hover:border-[#053877]/40">
                      <Face p={p} size={32} />
                      <span className="min-w-0 text-xs"><span className="block truncate font-semibold">{p.name}</span><span className="block text-muted-foreground">{compact(p.followers)}</span></span>
                    </a>
                  ))}
                </div>
              </Block>
            )}
          </div>
        ) : <p className="text-sm text-muted-foreground">The index couldn't measure this audience.</p>)}

        {section("growth", 2, (
          <div className="flex flex-col gap-8">
            <TileGrid>
              <Tile label={yt ? "Subscribers" : "Followers"} value={compact(profile.identity.followers)} />
              {profile.identity.following != null && <Tile label="Following" value={compact(profile.identity.following)} />}
              <Tile label={yt ? "Videos" : "Posts"} value={compact(profile.identity.posts)} />
              {profile.identity.totalViews != null && <Tile label="Lifetime views" value={compact(profile.identity.totalViews)} />}
              {profile.identity.since && <Tile label="On the platform since" value={new Date(profile.identity.since).getFullYear()} />}
            </TileGrid>
            <Block title="Follower change, by checkpoint">
              {profile.growth.length < 2 ? <p className="text-sm text-muted-foreground">Not enough history yet.</p> : (
                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${profile.growth.length}, minmax(0,1fr))` }}>
                  {profile.growth.map((g) => {
                    const max = Math.max(1, ...profile.growth.map((x) => Math.abs(x.pct)));
                    return (
                      <div key={g.monthsAgo} className="flex flex-col items-center gap-1.5">
                        <div className="relative flex h-24 w-full items-center justify-center">
                          <span className="absolute left-0 right-0 top-1/2 h-px bg-border" />
                          <span className="absolute w-8 rounded-sm" style={{ background: NAVY, height: `${(Math.abs(g.pct) / max) * 48}px`, ...(g.pct >= 0 ? { bottom: "50%" } : { top: "50%" }) }} />
                        </div>
                        <span className="text-sm font-semibold tabular-nums">{g.pct > 0 ? "+" : ""}{g.pct.toFixed(1)}%</span>
                        <span className="text-xs text-muted-foreground">{g.monthsAgo} months ago</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="mt-3 text-xs text-muted-foreground">Figures as the index reports them for each checkpoint.</p>
            </Block>
            {profile.postsPerMonth.length > 0 && (
              <Block title="Uploads a month">
                <div className="flex h-32 items-end gap-2">
                  {profile.postsPerMonth.map((m) => (
                    <div key={m.key} className="flex flex-1 flex-col items-center gap-1">
                      <span className="text-xs tabular-nums text-muted-foreground">{m.count}</span>
                      <span className="w-full max-w-10 rounded-t" style={{ height: `${(m.count / maxPerMonth) * 88}px`, background: GOLD }} />
                      <span className="text-[11px] capitalize text-muted-foreground">{m.label}</span>
                    </div>
                  ))}
                </div>
              </Block>
            )}
          </div>
        ))}

        {section("posts", 3, profile.posts.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {profile.posts.map((p) => (
              <a key={p.url || p.date} href={p.url} target="_blank" rel="noreferrer" className="group flex flex-col overflow-hidden rounded-2xl border border-border hover:border-[#053877]/40">
                <div className="relative aspect-video bg-muted">
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">{yt ? <Youtube className="h-8 w-8" /> : p.kind === "reel" ? <Film className="h-8 w-8" /> : <ImageIcon className="h-8 w-8" />}</div>
                  {p.thumb ? <Img src={p.thumb} className="absolute inset-0 h-full w-full object-cover" /> : p.video ? <Frame src={p.video} /> : null}
                  <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold capitalize text-white">{p.kind}</span>
                </div>
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <span className="text-xs text-muted-foreground">{shortDate(p.date)}</span>
                  <p className="line-clamp-3 text-sm">{p.text || "No caption"}</p>
                  <div className="mt-auto flex flex-wrap gap-3 pt-1 text-xs tabular-nums text-muted-foreground">
                    {p.views != null && <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" />{compact(p.views)}</span>}
                    {p.likes != null && <span className="inline-flex items-center gap-1"><Heart className="h-3.5 w-3.5" />{compact(p.likes)}</span>}
                    {p.comments != null && <span className="inline-flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" />{compact(p.comments)}</span>}
                    <ExternalLink className="ml-auto h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                </div>
              </a>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">No recent posts came back for this account.</p>)}

        {section("content", 4, (
          <div className="flex flex-col gap-8">
            <TileGrid>
              {yt ? (
                <>
                  <Tile label="Shorts" value={pctText(c.shortsPct)} sub="of recent uploads" />
                  <Tile label="Avg views · long" value={compact(c.avgViewsLong)} sub={c.medianViewsLong != null ? `median ${compact(c.medianViewsLong)}` : undefined} />
                  <Tile label="Avg views · shorts" value={compact(c.avgViewsShorts)} />
                  <Tile label="Engagement · long" value={pctText(c.engagementLong, 2)} />
                  <Tile label="Engagement · shorts" value={pctText(c.engagementShorts, 2)} />
                  <Tile label="Last long video" value={shortDate(c.lastLongVideo) || "–"} />
                  <Tile label="Last short" value={shortDate(c.lastShort) || "–"} />
                </>
              ) : (
                <>
                  <Tile label="Reels" value={pctText(c.reelsPct)} sub="of the last 12 posts" />
                  <Tile label="Median likes" value={compact(c.likesMedian)} />
                  <Tile label="Median comments" value={compact(c.commentsMedian)} />
                  <Tile label="Reel views · median" value={compact(c.reelsMedianViews)} sub={c.reelsAvgViews != null ? `average ${compact(c.reelsAvgViews)}` : undefined} />
                </>
              )}
              <Tile label="Affiliate links" value={c.promotesAffiliates == null ? "–" : c.promotesAffiliates ? "Yes" : "No"} />
              {c.hasMerch != null && <Tile label="Sells merch" value={c.hasMerch ? "Yes" : "No"} />}
            </TileGrid>
            {c.hashtags.length > 0 && (
              <Block title="Hashtags they use">
                <div className="flex flex-wrap gap-1.5">
                  {c.hashtags.map((h) => <span key={h.name} className="rounded-full border border-border px-2.5 py-1 text-xs">#{h.name.replace(/^#/, "")}{h.count > 1 && <span className="ml-1 text-muted-foreground">×{h.count}</span>}</span>)}
                </div>
              </Block>
            )}
            {c.categories.length + c.niches.length > 0 && <Block title="Topics and niches"><Chips items={[...c.categories, ...c.niches]} /></Block>}
            {c.keywords.length > 0 && <Block title="Keywords"><Chips items={c.keywords} /></Block>}
          </div>
        ))}

        {section("demographics", 5, aud ? (
          <div className="grid gap-8 md:grid-cols-2">
            {sourceSwitch && <div className="max-w-xs md:col-span-2 lg:hidden">{sourceSwitch}</div>}
            {aud.femalePct != null && (
              <Block title="Gender" className="md:col-span-2">
                <div className="flex h-3 overflow-hidden rounded-full">
                  <span style={{ width: `${aud.femalePct}%`, background: GOLD }} />
                  <span style={{ width: `${aud.malePct ?? 100 - aud.femalePct}%`, background: NAVY }} />
                </div>
                <div className="mt-2 flex justify-between text-sm"><span><b>{pctText(aud.femalePct)}</b> women</span><span><b>{pctText(aud.malePct ?? 100 - aud.femalePct)}</b> men</span></div>
              </Block>
            )}
            <Block title="Age"><Bars items={aud.ages} /></Block>
            {aud.genderPerAge.length > 0 && (
              <Block title="Age by gender">
                <ul className="flex flex-col gap-2">
                  {aud.genderPerAge.map((g) => {
                    const max = Math.max(1, ...aud.genderPerAge.map((x) => x.male + x.female));
                    return (
                      <li key={g.name} className="grid grid-cols-[3.5rem_1fr_5.5rem] items-center gap-3 text-sm">
                        <span>{g.name}</span>
                        <span className="flex h-2 overflow-hidden rounded-full bg-muted">
                          <span style={{ width: `${(g.female / max) * 100}%`, background: GOLD }} />
                          <span style={{ width: `${(g.male / max) * 100}%`, background: NAVY }} />
                        </span>
                        <span className="text-right text-xs tabular-nums text-muted-foreground">{pctText(g.female)} · {pctText(g.male)}</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">Women first, then men.</p>
              </Block>
            )}
            {aud.ethnicities.length > 0 && <Block title="Ethnicity"><Bars items={aud.ethnicities} /></Block>}
          </div>
        ) : <p className="text-sm text-muted-foreground">Not measured.</p>)}

        {section("geo", 6, aud ? (
          <div className="grid gap-8 md:grid-cols-2">
            <Block title="Countries"><Bars items={aud.countries} /></Block>
            {aud.states.length > 0 && <Block title="States"><Bars items={aud.states} /></Block>}
            {aud.cities.length > 0 && <Block title="Cities"><Bars items={aud.cities} /></Block>}
            <Block title="Languages"><Bars items={aud.languages} /></Block>
          </div>
        ) : <p className="text-sm text-muted-foreground">Not measured.</p>)}

        {section("brands", 7, (
          <div className="flex flex-col gap-8">
            {profile.brands.pastSponsors.length === 0 && profile.brands.mentioned.length === 0 ? (
              <p className="rounded-xl bg-emerald-500/10 p-4 text-sm">No paid partnerships found in recent posts. A fresh face for your brand.</p>
            ) : null}
            {profile.brands.pastSponsors.length > 0 && (
              <Block title={`Paid partnerships · ${profile.brands.pastSponsors.length} brand${profile.brands.pastSponsors.length === 1 ? "" : "s"}`}>
                <div className="overflow-hidden rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                      <tr><th className="px-3 py-2 font-medium">Brand</th><th className="px-3 py-2 text-right font-medium">Posts</th><th className="hidden px-3 py-2 font-medium sm:table-cell">First seen</th><th className="px-3 py-2 font-medium">Last seen</th></tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {profile.brands.pastSponsors.map((b) => (
                        <tr key={b.handle}>
                          <td className="px-3 py-2"><a href={brandUrl(profile.platform, b.handle)} target="_blank" rel="noreferrer" className="font-medium text-[#053877] hover:underline dark:text-[#8fb5e8]">@{b.handle}</a></td>
                          <td className="px-3 py-2 text-right tabular-nums">{b.posts ?? "–"}</td>
                          <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{shortDate(b.firstSeen)}</td>
                          <td className="px-3 py-2 text-muted-foreground">{shortDate(b.lastSeen)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Block>
            )}
            {profile.brands.sponsoredPosts.length > 0 && (
              <Block title="Recent sponsored posts">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {profile.brands.sponsoredPosts.map((p) => (
                    <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="flex gap-3 rounded-xl border border-border p-2.5 hover:border-[#053877]/40">
                      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-muted"><Img src={p.thumb} className="h-full w-full object-cover" /></div>
                      <div className="min-w-0 text-xs">
                        <div className="text-muted-foreground">{shortDate(p.date)}</div>
                        <p className="mt-0.5 line-clamp-3">{p.text || "Sponsored post"}</p>
                      </div>
                    </a>
                  ))}
                </div>
              </Block>
            )}
            {profile.brands.mentioned.length > 0 && <Block title="Brands they mention"><Chips items={profile.brands.mentioned.map((b) => `@${b}`)} href={(b) => brandUrl(profile.platform, b.slice(1))} /></Block>}
            {profile.brands.collaborators.length > 0 && <Block title="Accounts they tag"><Chips items={profile.brands.collaborators.map((b) => `@${b}`)} href={(b) => brandUrl(profile.platform, b.slice(1))} /></Block>}
            {aud && aud.brandAffinity.length > 0 && <Block title="Brands their audience follows"><Bars items={aud.brandAffinity.slice(0, 10)} color={GOLD} /></Block>}
          </div>
        ))}

        {section("lookalikes", 8, (
          <div className="flex flex-col gap-6">
            {aud && aud.lookalikes.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {aud.lookalikes.map((p) => (
                  <button key={p.handle} type="button" onClick={() => onOpenCreator(p)} className="flex items-center gap-3 rounded-2xl border border-border p-3 text-left hover:border-[#053877]/40 hover:shadow-sm" data-testid={`lookalike-${p.handle}`}>
                    <Face p={p} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{p.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">@{p.handle}</span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums">{compact(p.followers)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No lookalikes measured for this audience.</p>
            )}
            {similar}
          </div>
        ))}

        <p className="px-5 pb-8 text-[11px] text-muted-foreground sm:px-8">Updated {shortDate(profile.fetchedAt)}. Estimates from public data.</p>
      </div>
    </div>
  );
}

export type { Person as ProfilePerson };
