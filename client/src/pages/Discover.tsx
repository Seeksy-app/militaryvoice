import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search, Sparkles, BadgeCheck, Bookmark, BookmarkCheck, Users, Mail, Phone, Globe, ShieldCheck,
  Mic2, Megaphone, CalendarDays, X, Loader2, ExternalLink, Plus, Trash2, Download, ChevronRight, Lock, MapPin, Heart, Hash, Handshake, Info,
  SlidersHorizontal, AtSign, Type as TypeIcon, Wand2, TrendingUp, Instagram, Youtube, Twitter, Twitch, Music2, Share2,
} from "lucide-react";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, resolveUploadUrl } from "@/lib/queryClient";
import { Turnstile, useTurnstileSiteKey } from "@/components/Turnstile";
import { CreatorProfileSections, type Profile, type ProfilePerson } from "@/components/CreatorProfileSections";
import { DiscoverEnrich, type EnrichCard } from "@/components/DiscoverEnrich";
import { FiltersPanel, FilterChips, activeFilters, filtersForServer, type Filters } from "@/components/DiscoverFilters";

const HEADLINE = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const NAVY = "#04102b";
const GOLD = "#F0A71F";

type Card = {
  platform: string;
  handle: string;
  name: string;
  picture: string;
  followers: number | null;
  engagement: number | null;
  branch: string;
  verified?: { show: string; host: string; serviceStatus: string; slotLabel: string } | null;
  signupId?: number;
  quality?: number | null;
};
type Me = { signedIn: boolean; email?: string; isPodcaster?: boolean; member?: { role: string; orgName: string } | null; reveals?: { used: number; allowance: number } | null; lookups?: { used: number; allowance: number } | null };
type SearchResult = { brief: string; mode?: string; total: number; page: number; pageSize: number; results: Card[]; verified: Card[]; understood?: { notes?: string[]; from_nlp?: Record<string, unknown> } | null };
type Analytics = {
  incomeMin: number | null; incomeMax: number | null; likesMedian: number | null; commentsMedian: number | null;
  reelsPercent: number | null; reelsMedianViews: number | null;
  growth: { monthsAgo: number; pct: number }[]; hashtags: string[]; brandsMentioned: string[]; collaborators: string[];
  pastSponsors: { brand: string; posts: number | null; lastSeen: string }[];
  promotesAffiliates: boolean | null; hasMerch: boolean | null;
  audience: {
    credibility: number | null; credibilityClass: string; realPct: number | null; suspiciousPct: number | null; massFollowersPct: number | null; influencersPct: number | null;
    femalePct: number | null; malePct: number | null;
    ages: { name: string; pct: number }[]; countries: { name: string; pct: number }[]; states: { name: string; pct: number }[]; cities: { name: string; pct: number }[];
    languages: { name: string; pct: number }[]; interests: { name: string; pct: number }[]; brandAffinity: { name: string; pct: number }[];
  };
  fetchedAt: string;
  profile?: Profile;
};
type List = { id: number; name: string; createdAt: string; items: { id: number; platform: string; handle: string; snapshot: Card; createdAt: string }[] };

const PLATFORMS = [
  { v: "instagram", label: "Instagram" },
  { v: "youtube", label: "YouTube" },
  { v: "tiktok", label: "TikTok" },
  { v: "twitter", label: "X" },
  { v: "twitch", label: "Twitch" },
];
const BRANCHES = ["Army", "Navy", "Air Force", "Marine Corps", "Coast Guard", "Space Force", "Military spouse"];
const SIZES = [
  { label: "Any size", min: null as number | null, max: null as number | null },
  { label: "1K to 10K", min: 1_000, max: 10_000 },
  { label: "10K to 100K", min: 10_000, max: 100_000 },
  { label: "100K to 1M", min: 100_000, max: 1_000_000 },
  { label: "1M and up", min: 1_000_000, max: null },
];
const SORTS = [
  { v: "relevancy", label: "Best match" },
  { v: "engagement_rate", label: "Most engaged" },
  { v: "number_of_followers", label: "Biggest" },
  { v: "growth_rate", label: "Fastest growing" },
];
/** Three doors into one search: the same engine, asked three ways. */
const DOORS = [
  {
    key: "brand", icon: Megaphone, title: "Sponsor creators", blurb: "Veterans and military families with the audience your brand wants.",
    placeholder: "Veteran fitness creators with a US audience…",
    tries: ["Veteran-owned business creators", "Military spouse lifestyle creators", "Army veterans in outdoors and hunting", "Veteran fitness coaches"],
  },
  {
    key: "podcaster", icon: Mic2, title: "Book guests", blurb: "Veterans with a story, a following and a reason to come on your show.",
    placeholder: "Marine Corps veterans who talk about transition…",
    tries: ["Veteran authors", "Combat veterans who speak about PTSD", "Veteran entrepreneurs", "Navy veteran podcasters"],
  },
  {
    key: "event", icon: CalendarDays, title: "Find speakers", blurb: "Voices for the stage, the panel and the keynote.",
    placeholder: "Veteran keynote speakers on leadership…",
    tries: ["Veteran leadership speakers", "Military spouse advocates", "Women veterans in business", "Special operations veterans"],
  },
] as const;

/** Three ways to ask: describe them, name the words in their bio, or name the account. */
const MODES = [
  { v: "ai", label: "AI search", icon: Wand2, hint: "Describe who you want, in plain English." },
  { v: "keywords", label: "Keywords in bio", icon: TypeIcon, hint: "Words that appear in their bio. Separate with commas." },
  { v: "username", label: "Username", icon: AtSign, hint: "A handle or a profile link. Opens their full profile." },
] as const;
type Mode = (typeof MODES)[number]["v"];

const compact = (n: number | null | undefined) =>
  n == null ? "–" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(Math.round(n));
const pct = (n: number | null | undefined, d = 1) => (n == null ? "–" : `${n.toFixed(d)}%`);
const profileUrl = (c: Pick<Card, "platform" | "handle">) =>
  c.platform === "youtube" ? `https://youtube.com/@${c.handle}` : c.platform === "tiktok" ? `https://tiktok.com/@${c.handle}` : c.platform === "twitter" ? `https://x.com/${c.handle}` : c.platform === "twitch" ? `https://twitch.tv/${c.handle}` : `https://instagram.com/${c.handle}`;
const platformLabel = (p: string) => PLATFORMS.find((x) => x.v === p)?.label ?? p;

/** An avatar that falls back to initials rather than a broken image. */
function Avatar({ src, name, size = 56, ring = false }: { src: string; name: string; size?: number; ring?: boolean }) {
  const [broken, setBroken] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  const cls = `shrink-0 rounded-full object-cover ${ring ? "ring-2 ring-[#F0A71F] ring-offset-2 ring-offset-background" : ""}`;
  if (!src || broken)
    return (
      <span className={`${cls} flex items-center justify-center bg-[#053877]/10 font-bold text-[#053877]`} style={{ width: size, height: size, fontSize: size / 2.8 }}>
        {initials}
      </span>
    );
  return <img src={src.startsWith("/api/") ? src : resolveUploadUrl(src)} alt="" loading="lazy" onError={() => setBroken(true)} className={cls} style={{ width: size, height: size }} />;
}

// ===========================================================================
// The page
// ===========================================================================

export default function Discover() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: me, isLoading: meLoading } = useQuery<Me>({ queryKey: ["/api/discover/me"], queryFn: async () => (await apiRequest("GET", "/api/discover/me")).json() });
  const { data: verified = [] } = useQuery<Card[]>({ queryKey: ["/api/discover/verified"], queryFn: async () => (await apiRequest("GET", "/api/discover/verified")).json() });
  const isMember = !!me?.member;
  // Where they came from (?src=), remembered for the account they create, and a visit counted once per load.
  const [source] = useState(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("src") ?? "";
      if (fromUrl) sessionStorage.setItem("mv_discover_src", fromUrl);
      return fromUrl || sessionStorage.getItem("mv_discover_src") || "direct";
    } catch {
      return "direct";
    }
  });
  useEffect(() => {
    void fetch("/api/discover/visit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source }) }).catch(() => {});
  }, [source]);

  useEffect(() => {
    const was = document.title;
    document.title = "Discovery — MilitaryVoices.ai";
    return () => { document.title = was; };
  }, []);
  const [door, setDoor] = useState<(typeof DOORS)[number]["key"]>("brand");
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState("instagram");
  const [branch, setBranch] = useState("");
  const [size, setSize] = useState(0);
  const [sort, setSort] = useState("relevancy");
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<Mode>("ai");
  const [filters, setFilters] = useState<Filters>({});
  const [showFilters, setShowFilters] = useState(false);
  // While the search-mode menu is open the hero sits above the sticky filter bar, so the menu isn't painted over.
  const [menuOpen, setMenuOpen] = useState(false);
  const [submitted, setSubmitted] = useState<null | { q: string; platform: string; branch: string; size: number; sort: string; mode: Mode; filters: Filters }>(null);
  const [heroVariant] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("hero") === "a" ? "a" : "b";
    } catch {
      return "b";
    }
  });
  const [tab, setTab] = useState<"search" | "enrich" | "lists">("search");
  const [open, setOpenRaw] = useState<Card | null>(null);
  // The list a creator was opened from, for back and next in the panel.
  const [openFrom, setOpenFrom] = useState<Card[]>([]);
  const openIn = (from: Card[]) => (c: Card | null) => { setOpenFrom(from); setOpenRaw(c); };
  const setOpen = (c: Card | null) => { setOpenFrom([]); setOpenRaw(c); };
  const [gate, setGate] = useState(false);
  const d = DOORS.find((x) => x.key === door)!;

  // Anything that runs a search asks for an account first; the search it
  // wanted runs the moment the account exists.
  const run = (over?: Partial<{ q: string; branch: string; size: number; sort: string; platform: string; mode: Mode }>) => {
    const m = over?.mode ?? mode;
    const next = { q: over?.q ?? q, platform: over?.platform ?? platform, branch: over?.branch ?? branch, size: over?.size ?? size, sort: over?.sort ?? sort, mode: m, filters };
    if (over?.q !== undefined) setQ(over.q);
    if (over?.mode) setMode(over.mode);
    setShowFilters(false);
    setTab("search");
    if (!isMember) { setSubmitted(next); setGate(true); return; }
    if (m === "username") return void lookupUser(next.q, next.platform);
    if (m === "keywords" && !next.q.trim() && !filters.keywordsInBio?.trim()) return toast({ title: "Type a word to look for", description: "For example: army wife, milso, veteran owned." });
    setSubmitted(next);
  };

  // Username: straight to the account, no search. The same cached read Enrich uses.
  const [userResult, setUserResult] = useState<Card | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const lookupUser = async (handle: string, onPlatform: string) => {
    if (!handle.trim()) return;
    setUserLoading(true);
    try {
      const res = await fetch("/api/discover/enrich", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [handle.trim()], platform: onPlatform }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? "Couldn't look that up.");
      const row = j.rows?.[0];
      if (row?.status !== "found" || !row.card) throw new Error(row?.message ?? "No account by that name.");
      setUserResult(row.card);
      setOpen(row.card);
    } catch (e) {
      toast({ title: "Not found", description: (e as Error).message, variant: "destructive" });
    } finally {
      setUserLoading(false);
    }
  };

  // Ten at a time; "Load more" adds the next ten under them.
  const search = useInfiniteQuery<SearchResult>({
    queryKey: ["/api/discover/search", submitted],
    enabled: isMember && !!submitted && submitted.mode !== "username",
    initialPageParam: 0,
    getNextPageParam: (last) => (last.total > (last.page + 1) * last.pageSize && last.page < 40 ? last.page + 1 : undefined),
    queryFn: async ({ pageParam }) => {
      const s = submitted!;
      const res = await fetch("/api/discover/search", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: s.q, mode: s.mode, filters: filtersForServer(s.filters), platform: s.platform, branch: s.branch, sort: s.sort, page: pageParam, minFollowers: SIZES[s.size].min, maxFollowers: SIZES[s.size].max }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? "Search failed");
      return j;
    },
    staleTime: 10 * 60_000,
    retry: false,
  });

  // Filters re-run the search once one has been asked.
  useEffect(() => {
    if (submitted) setSubmitted((s) => (s ? { ...s, platform, branch, size, sort, filters } : s));
    setPage(0);
  }, [platform, branch, size, sort, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const lists = useQuery<List[]>({
    queryKey: ["/api/discover/lists"],
    enabled: isMember,
    queryFn: async () => (await apiRequest("GET", "/api/discover/lists")).json(),
  });
  const saved = useMemo(() => {
    const m = new Set<string>();
    for (const l of lists.data ?? []) for (const i of l.items) m.add(`${i.platform}:${i.handle}`);
    return m;
  }, [lists.data]);

  const saveTo = useMutation({
    mutationFn: async ({ card, listId }: { card: Card; listId?: number }) => {
      let id = listId ?? lists.data?.[0]?.id;
      if (!id) id = (await (await apiRequest("POST", "/api/discover/lists", { name: "Shortlist" })).json()).id;
      await apiRequest("POST", `/api/discover/lists/${id}/items`, { card });
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/discover/lists"] });
      toast({ title: "Saved to your shortlist" });
    },
    onError: (e: Error) => toast({ title: "Couldn't save that", description: e.message, variant: "destructive" }),
  });

  // Enrich's "Save all": one new list per run, so a campaign's sheet stays together.
  const saveAll = async (cards: EnrichCard[]) => {
    const name = `Enriched ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    const id = (await (await apiRequest("POST", "/api/discover/lists", { name })).json()).id;
    for (const card of cards) await apiRequest("POST", `/api/discover/lists/${id}/items`, { card }).catch(() => null);
    queryClient.invalidateQueries({ queryKey: ["/api/discover/lists"] });
  };

  // Many at once from the results: into the first list (made if there isn't one).
  const saveMany = async (cards: Card[]) => {
    let id = lists.data?.[0]?.id;
    if (!id) id = (await (await apiRequest("POST", "/api/discover/lists", { name: "Shortlist" })).json()).id;
    for (const card of cards) await apiRequest("POST", `/api/discover/lists/${id}/items`, { card }).catch(() => null);
    queryClient.invalidateQueries({ queryKey: ["/api/discover/lists"] });
    toast({ title: `Saved ${cards.length} to your list` });
  };

  // A shared profile link: /discover?creator=instagram:handle opens it.
  useEffect(() => {
    if (!isMember) return;
    const raw = new URLSearchParams(window.location.search).get("creator") ?? "";
    const [pf, h] = raw.split(":");
    if (pf && h && PLATFORMS.some((x) => x.v === pf)) setOpen({ platform: pf, handle: h, name: h, picture: "", followers: null, engagement: null, branch: "" });
  }, [isMember]); // eslint-disable-line react-hooks/exhaustive-deps

  const r = search.data?.pages[0];
  const results = useMemo(() => {
    const seen = new Set<string>();
    return (search.data?.pages ?? []).flatMap((p) => p.results).filter((c) => { const k = `${c.platform}:${c.handle}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }, [search.data]);

  return (
    <div className="min-h-screen bg-background">
      <NavBar product="discovery" account={isMember ? { label: "Saved", onClick: () => { setTab("lists"); document.getElementById("discover-main")?.scrollIntoView({ behavior: "smooth" }); } } : { label: me?.signedIn ? "Add Discovery" : "Sign in", onClick: () => setGate(true) }} />

      {/* ---------------------------------------------------------------- hero */}
      {(() => {
        const bar = (
          <SearchBar
            platform={platform}
            setPlatform={setPlatform}
            mode={mode}
            setMode={setMode}
            q={q}
            setQ={setQ}
            placeholder={mode === "ai" ? d.placeholder : mode === "keywords" ? "army wife, military spouse, milso" : "@handle, or paste a profile link"}
            onSubmit={() => run()}
            busy={userLoading}
            filterCount={activeFilters(filters).length}
            onMenu={setMenuOpen}
            onFilters={() => { setShowFilters((v) => !v); setTimeout(() => document.getElementById("discover-main")?.scrollIntoView({ behavior: "smooth" }), 60); }}
          />
        );
        const tries = (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">Try</span>
            {d.tries.map((t) => (
              <button key={t} type="button" onClick={() => run({ q: t, mode: "ai" })} className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white/85 transition-colors hover:border-white/30 hover:bg-white/10" data-testid="discover-try">
                {t}
              </button>
            ))}
          </div>
        );
        const toEnrich = () => { setTab("enrich"); setTimeout(() => document.getElementById("discover-main")?.scrollIntoView({ behavior: "smooth" }), 50); };
        return heroVariant === "a" ? (
          <HeroA raised={menuOpen} door={door} setDoor={setDoor} bar={bar} tries={tries} onEnrich={toEnrich} allowance={isMember ? me?.reveals ?? null : null} />
        ) : (
          <HeroB raised={menuOpen} door={door} setDoor={setDoor} bar={bar} tries={tries} onEnrich={toEnrich} verified={verified} onOpen={openIn(verified)} />
        );
      })()}

      {/* -------------------------------------------------------- filter bar */}
      <div className="sticky top-[77px] z-20 border-b border-border bg-background/90 backdrop-blur lg:top-[93px]">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
          {(
            <div className="mr-2 flex rounded-full bg-muted p-1 text-sm">
              {(isMember ? (["search", "enrich", "lists"] as const) : (["search", "enrich"] as const)).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full px-3 py-1 font-medium ${tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`} data-testid={`discover-tab-${t}`}>
                  {t === "search" ? "Search" : t === "enrich" ? "Enrich" : `Saved${(lists.data?.reduce((n, l) => n + l.items.length, 0) ?? 0) ? ` · ${lists.data!.reduce((n, l) => n + l.items.length, 0)}` : ""}`}
                </button>
              ))}
            </div>
          )}
          {tab !== "enrich" && <>
          <div className="flex flex-wrap gap-1.5" aria-label="Branch">
            {BRANCHES.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBranch(branch === b ? "" : b)}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${branch === b ? "border-[#053877] bg-[#053877] text-white" : "border-border bg-card text-foreground hover:border-[#053877]/40"}`}
                data-testid={`branch-${b}`}
              >
                {b}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => setShowFilters((v) => !v)} className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors ${showFilters || activeFilters(filters).length ? "border-[#053877] bg-[#053877] text-white" : "border-border bg-card hover:border-[#053877]/40"}`} data-testid="discover-filters">
              <SlidersHorizontal className="h-4 w-4" /> Filters{activeFilters(filters).length ? ` · ${activeFilters(filters).length}` : ""}
            </button>
            <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="h-9 rounded-full border border-border bg-card px-3 text-sm" aria-label="Audience size">
              {SIZES.map((s, i) => <option key={s.label} value={i}>{s.label}</option>)}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-9 rounded-full border border-border bg-card px-3 text-sm" aria-label="Sort">
              {SORTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
          </div>
          </>}
        </div>
      </div>

      <main id="discover-main" className="mx-auto w-full max-w-6xl scroll-mt-16 px-4 py-8 sm:px-6">
        {tab !== "enrich" && showFilters && (
          <div className="mb-8">
            <FiltersPanel value={filters} onChange={setFilters} platform={platform} onClose={() => setShowFilters(false)} onApply={() => run()} />
          </div>
        )}
        {tab !== "enrich" && !showFilters && activeFilters(filters).length > 0 && (
          <div className="mb-6"><FilterChips value={filters} onChange={setFilters} /></div>
        )}
        {tab === "search" && userResult && (!submitted || submitted.mode === "username") && (
          <section className="mb-10">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.14em] text-muted-foreground">Account</h2>
            <div className="max-w-sm"><CreatorCard c={userResult} saved={saved.has(`${userResult.platform}:${userResult.handle.toLowerCase()}`)} onOpen={() => setOpen(userResult)} onSave={isMember ? () => saveTo.mutate({ card: userResult }) : undefined} /></div>
          </section>
        )}
        {tab === "enrich" ? (
          <DiscoverEnrich
            isMember={isMember}
            onJoin={() => setGate(true)}
            onOpen={(c) => setOpen(c)}
            onSaveAll={saveAll}
            lookups={me?.lookups}
            onUsed={() => queryClient.invalidateQueries({ queryKey: ["/api/discover/me"] })}
          />
        ) : tab === "lists" && isMember ? (
          <Lists lists={lists.data ?? []} onOpen={(c) => openIn((lists.data ?? []).flatMap((l) => l.items.map((i) => i.snapshot)))(c)} />
        ) : !submitted || !isMember || submitted.mode === "username" ? (
          <Welcome verified={verified} isMember={isMember} signedIn={!!me?.signedIn} onOpenVerified={openIn(verified)} onSaveVerified={(c) => saveTo.mutate({ card: c })} onJoin={() => setGate(true)} loading={meLoading} />
        ) : (
          <>
            {/* what ran */}
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold tracking-tight">
                  {search.isLoading ? "Searching…" : r ? `${r.total.toLocaleString()} creators on ${platformLabel(submitted.platform)}` : "Search"}
                </h2>
                {r && <p className="mt-1 text-sm text-muted-foreground">{r.mode === "keywords" ? <>Creators whose <span className="font-medium text-foreground">{r.brief}</span></> : <>We searched for <span className="font-medium text-foreground">"{r.brief}"</span></>}</p>}
              </div>
            </div>
            {r?.understood?.notes?.length ? (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-[#053877]/15 bg-[#053877]/[0.04] px-4 py-3 text-sm text-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#053877]" />
                <span className="min-w-0">
                  {r.understood.notes.slice(0, 2).join(" ")}
                  {SIZES[submitted.size].min == null && /follower minimum/i.test(r.understood.notes.join(" ")) && (
                    <button type="button" onClick={() => setSize(1)} className="ml-2 font-semibold text-[#053877] underline underline-offset-2">Show smaller creators</button>
                  )}
                </span>
              </div>
            ) : null}
            {search.isError && (
              <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">{(search.error as Error).message}</div>
            )}

            {/* ours first */}
            {!!r?.verified?.length && (
              <section className="mt-8">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#8a5a00]"><BadgeCheck className="h-4 w-4" /> Verified on MilitaryVoices</h3>
                <div className="mt-3">
                  <ResultsList rows={r.verified} saved={saved} isMember={isMember} onOpen={openIn([...r.verified, ...results])} onSave={(c) => saveTo.mutate({ card: c })} onSaveMany={saveMany} />
                </div>
              </section>
            )}

            <section className="mt-8">
              {search.isLoading ? (
                <ResultsSkeleton />
              ) : results.length === 0 && r ? (
                <div className="rounded-2xl border border-dashed border-border p-10 text-center">
                  <p className="text-lg font-semibold" style={HEADLINE}>Nobody matched that.</p>
                  <p className="mt-1 text-sm text-muted-foreground">Try fewer words, another platform, or a wider audience size.</p>
                </div>
              ) : (
                <ResultsList rows={results} total={r?.total} saved={saved} isMember={isMember} onOpen={openIn([...(r?.verified ?? []), ...results])} onSave={(c) => saveTo.mutate({ card: c })} onSaveMany={saveMany} />
              )}
              {search.hasNextPage && (
                <div className="mt-6 flex flex-col items-center gap-1">
                  <Button variant="outline" className="h-11 gap-2 rounded-full px-6" onClick={() => void search.fetchNextPage()} disabled={search.isFetchingNextPage} data-testid="discover-more">
                    {search.isFetchingNextPage ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Load 10 more
                  </Button>
                  <span className="text-xs text-muted-foreground">Showing {results.length} of {r!.total.toLocaleString()}</span>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      <ProfileDrawer card={open} siblings={openFrom} allowance={me?.reveals} onOpenCreator={setOpenRaw} onClose={() => setOpenRaw(null)} isMember={isMember} onJoin={() => setGate(true)} lists={lists.data ?? []} onSave={(card, listId) => saveTo.mutate({ card, listId })} saved={open ? saved.has(`${open.platform}:${open.handle.toLowerCase()}`) : false} />
      <JoinDialog
        open={gate}
        me={me}
        onClose={() => setGate(false)}
        onDone={() => {
          setGate(false);
          queryClient.invalidateQueries({ queryKey: ["/api/discover/me"] });
        }}
        defaultRole={door}
        source={source}
      />
      <SiteFooter product="discovery" />
    </div>
  );
}

// ===========================================================================
// The search bar: platform, how to search, what, and the filters
// ===========================================================================

function ModeMenu({ mode, setMode, onOpenChange }: { mode: Mode; setMode: (m: Mode) => void; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => onOpenChange?.(open), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);
  const cur = MODES.find((m) => m.v === mode)!;
  const Icon = cur.icon;
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open} className="flex h-12 w-full items-center gap-2 whitespace-nowrap rounded-xl bg-[#053877]/[0.07] px-3 text-sm font-semibold text-[#053877] hover:bg-[#053877]/[0.11] sm:w-auto" data-testid="discover-mode">
        <Icon className="h-4 w-4" /> {cur.label}
        <ChevronRight className={`ml-auto h-3.5 w-3.5 transition-transform sm:ml-0 ${open ? "-rotate-90" : "rotate-90"}`} />
      </button>
      {open && (
        <ul role="listbox" className="absolute left-0 top-[calc(100%+6px)] z-30 w-72 overflow-hidden rounded-2xl border border-border bg-popover p-1.5 text-foreground shadow-2xl">
          {MODES.map((m) => {
            const I = m.icon;
            return (
              <li key={m.v}>
                <button type="button" role="option" aria-selected={m.v === mode} onClick={() => { setMode(m.v); setOpen(false); }} className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-muted ${m.v === mode ? "bg-[#053877]/[0.06]" : ""}`} data-testid={`discover-mode-${m.v}`}>
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#053877]/10 text-[#053877]"><I className="h-4 w-4" /></span>
                  <span><span className="block text-sm font-semibold">{m.label}</span><span className="block text-xs text-muted-foreground">{m.hint}</span></span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SearchBar({ platform, setPlatform, mode, setMode, q, setQ, placeholder, onSubmit, busy, filterCount, onFilters, onMenu }: {
  onMenu?: (open: boolean) => void;
  platform: string; setPlatform: (p: string) => void; mode: Mode; setMode: (m: Mode) => void; q: string; setQ: (q: string) => void;
  placeholder: string; onSubmit: () => void; busy: boolean; filterCount: number; onFilters: () => void;
}) {
  const Lead = mode === "username" ? AtSign : Search;
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="rounded-2xl bg-white p-2 text-foreground shadow-[0_24px_60px_-12px_rgba(0,0,0,0.55)] ring-1 ring-black/5" data-testid="discover-search-form">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="h-12 rounded-xl border-0 bg-muted/60 px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#053877] sm:w-[8.5rem]" aria-label="Platform" data-testid="discover-platform">
            {PLATFORMS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
          </select>
          <ModeMenu mode={mode} setMode={setMode} onOpenChange={onMenu} />
        </div>
        <div className="relative flex-1">
          <Lead className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-12 border-0 pl-11 text-base shadow-none focus-visible:ring-0" data-testid="discover-q" />
        </div>
        <div className="flex gap-2">
          {mode !== "username" && (
            <button type="button" onClick={onFilters} className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground hover:border-[#053877]/40 hover:text-[#053877]" aria-label="Filters" title="All filters" data-testid="discover-bar-filters">
              <SlidersHorizontal className="h-5 w-5" />
              {filterCount > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#F0A71F] px-1 text-[11px] font-bold text-[#1a1200]">{filterCount}</span>}
            </button>
          )}
          <Button type="submit" disabled={busy} className="h-12 flex-1 gap-2 rounded-xl bg-[#053877] px-6 text-base font-semibold text-white hover:bg-[#0a4a99] sm:flex-none" data-testid="discover-go">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} {mode === "username" ? "Look up" : "Search"}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ===========================================================================
// Two heroes: B is the default; A is the one before it, at ?hero=a
// ===========================================================================

type HeroProps = { raised: boolean; door: (typeof DOORS)[number]["key"]; setDoor: (d: (typeof DOORS)[number]["key"]) => void; bar: React.ReactNode; tries: React.ReactNode; onEnrich: () => void };

function HeroA({ raised, door, setDoor, bar, tries, onEnrich, allowance }: HeroProps & { allowance: { used: number; allowance: number } | null }) {
  return (
    <section className={`relative isolate ${raised ? "z-30" : ""}`} style={{ background: NAVY }}>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -right-40 -top-40 h-[32rem] w-[32rem] rounded-full opacity-[0.16] blur-3xl" style={{ background: GOLD }} />
        <div className="absolute -bottom-48 -left-32 h-[28rem] w-[28rem] rounded-full bg-[#1d5cc4] opacity-20 blur-3xl" />
      </div>
      <div className="relative mx-auto w-full max-w-6xl px-4 pb-10 pt-12 sm:px-6 sm:pt-16">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#F0A71F]"><Sparkles className="h-3.5 w-3.5" /> MilitaryVoices Discovery</p>
          {allowance && <p className="text-xs text-white/60" data-testid="discover-allowance">{Math.max(0, allowance.allowance - allowance.used)} of {allowance.allowance} free contacts left this month</p>}
        </div>
        <h1 className="mt-5 max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-6xl" style={HEADLINE}>
          Find the military and veteran voices <span style={{ color: GOLD }}>worth working with.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-white/70">Creators to sponsor, guests to book, speakers for the stage. Search in plain English across Instagram, YouTube, TikTok, X and Twitch, with the audience data that tells you who's real.</p>
        <div className="mt-8 grid gap-2 sm:grid-cols-3" role="tablist" aria-label="What you're looking for">
          {DOORS.map((x) => {
            const Icon = x.icon;
            const on = door === x.key;
            return (
              <button key={x.key} type="button" role="tab" aria-selected={on} onClick={() => setDoor(x.key)} className={`group flex items-start gap-3 rounded-2xl border p-4 text-left transition-all ${on ? "border-[#F0A71F] bg-white text-foreground shadow-lg" : "border-white/10 bg-white/[0.04] text-white hover:border-white/25 hover:bg-white/[0.08]"}`} data-testid={`door-${x.key}`}>
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${on ? "bg-[#053877] text-white" : "bg-white/10 text-[#F0A71F]"}`}><Icon className="h-5 w-5" /></span>
                <span className="min-w-0"><span className="block text-base font-bold" style={HEADLINE}>{x.title}</span><span className={`block text-sm ${on ? "text-muted-foreground" : "text-white/60"}`}>{x.blurb}</span></span>
              </button>
            );
          })}
        </div>
        <div className="mt-4">{bar}</div>
        {tries}
        <button type="button" onClick={onEnrich} className="mt-4 text-sm font-medium text-[#F0A71F] hover:underline" data-testid="discover-to-enrich">Already have a list? Enrich handles, links or emails →</button>
      </div>
    </section>
  );
}

/**
 * Hero B. The product is the pitch: the search bar is the biggest thing on the
 * page, and beside it a real creator from our verified list, turning over, with
 * the numbers a brand would see. No invented figures: every tile on the preview
 * is that creator's own.
 */
function HeroB({ raised, door, setDoor, bar, tries, onEnrich, verified, onOpen }: HeroProps & { verified: Card[]; onOpen: (c: Card) => void }) {
  const d = DOORS.find((x) => x.key === door)!;
  return (
    <section className={`relative isolate ${raised ? "z-30" : ""}`} style={{ background: "#030b1f" }}>
      {/* depth: a fine grid that fades out, and two soft lights, clipped on their own layer so the section never scrolls or clips its menus */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-[0.55]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)", backgroundSize: "44px 44px", maskImage: "radial-gradient(ellipse 80% 70% at 70% 30%, black 20%, transparent 75%)", WebkitMaskImage: "radial-gradient(ellipse 80% 70% at 70% 30%, black 20%, transparent 75%)" }} />
      <div aria-hidden className="pointer-events-none absolute -top-48 right-[-10%] -z-10 h-[40rem] w-[40rem] rounded-full opacity-25 blur-[120px]" style={{ background: GOLD }} />
      <div aria-hidden className="pointer-events-none absolute -bottom-64 -left-40 -z-10 h-[36rem] w-[36rem] rounded-full bg-[#1d5cc4] opacity-30 blur-[120px]" />

      </div>

      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pb-14 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:pb-20 lg:pt-20">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 rounded-full border border-[#F0A71F]/30 bg-[#F0A71F]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#F0A71F]">
            <Sparkles className="h-3.5 w-3.5" /> MilitaryVoices Discovery
          </p>
          <h1 className="mt-6 text-[2.75rem] font-bold leading-[0.98] tracking-[-0.03em] text-white sm:text-7xl" style={HEADLINE}>
            Military creators,
            <br />
            <span className="bg-gradient-to-r from-[#F0A71F] via-[#ffd27a] to-[#F0A71F] bg-clip-text text-transparent">measured.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/70">
            Veterans, service members and military spouses across Instagram, YouTube, TikTok, X and Twitch, with real reach, audience quality and brand history on every profile.
          </p>

          {/* what you're here for: three doors, one row */}
          <div className="mt-8 inline-flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1" role="tablist" aria-label="What you're looking for">
            {DOORS.map((x) => {
              const Icon = x.icon;
              const on = door === x.key;
              return (
                <button key={x.key} type="button" role="tab" aria-selected={on} onClick={() => setDoor(x.key)} className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-all ${on ? "bg-white text-[#04102b] shadow" : "text-white/70 hover:bg-white/[0.07] hover:text-white"}`} data-testid={`door-${x.key}`}>
                  <Icon className={`h-4 w-4 ${on ? "text-[#053877]" : "text-[#F0A71F]"}`} /> {x.title}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-sm text-white/50">{d.blurb}</p>
        </div>

        <div className="hidden lg:block">
          <PreviewStack verified={verified} onOpen={onOpen} />
        </div>

        {/* the search gets the full width: it's the product */}
        <div className="min-w-0 lg:col-span-2 lg:-mt-2">
          {bar}
          {tries}
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-white/60">
            {["Free account", "No card", "Audience data on every profile"].map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-[#F0A71F]" /> {t}</span>
            ))}
            <button type="button" onClick={onEnrich} className="font-semibold text-[#F0A71F] hover:underline" data-testid="discover-to-enrich">Have a list? Enrich it →</button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** A real verified creator, turning over every few seconds, as a brand would see them. */
function PreviewStack({ verified, onOpen }: { verified: Card[]; onOpen: (c: Card) => void }) {
  const pool = useMemo(() => verified.filter((c) => c.picture && (c.followers ?? 0) > 0).sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0)).slice(0, 8), [verified]);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (pool.length < 2 || paused) return;
    const t = setInterval(() => setI((n) => (n + 1) % pool.length), 4200);
    return () => clearInterval(t);
  }, [pool.length, paused]);
  if (!pool.length) return <div className="aspect-[4/5] w-full rounded-[28px] border border-white/10 bg-white/[0.03]" />;
  const c = pool[i % pool.length];
  const next = pool[(i + 1) % pool.length];
  const after = pool[(i + 2) % pool.length];
  const tiles = [
    ["Followers", compact(c.followers)],
    c.engagement != null ? ["Engagement", pct(c.engagement, 2)] : null,
    c.quality != null ? ["Audience quality", `${c.quality}/100`] : null,
  ].filter(Boolean) as [string, string][];
  return (
    <div className="relative mx-auto w-full max-w-[25rem]" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {/* the two behind */}
      {[after, next].map((b, k) => (
        <div key={`${b.name}-${k}`} aria-hidden className="absolute inset-x-6 top-0 h-full overflow-hidden rounded-[28px] border border-white/10 bg-[#0b1733] shadow-2xl" style={{ transform: `translateY(${(2 - k) * -18}px) scale(${0.9 + k * 0.05})`, opacity: 0.35 + k * 0.25 }}>
          <img src={b.picture.startsWith("/api/") ? b.picture : resolveUploadUrl(b.picture)} alt="" className="h-2/3 w-full object-cover opacity-60" />
        </div>
      ))}
      {/* the one in front */}
      <button key={c.name} type="button" onClick={() => onOpen(c)} className="relative block w-full overflow-hidden rounded-[28px] border border-white/15 bg-[#0b1733] text-left shadow-[0_40px_80px_-20px_rgba(0,0,0,0.7)] transition-transform duration-500 animate-in fade-in-0 zoom-in-95 hover:-translate-y-1" data-testid="hero-preview">
        <div className="relative aspect-[4/3] w-full overflow-hidden">
          <img src={c.picture.startsWith("/api/") ? c.picture : resolveUploadUrl(c.picture)} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0b1733] via-[#0b1733]/10 to-transparent" />
          <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-[#F0A71F] px-2.5 py-1 text-xs font-bold text-[#1a1200] shadow"><BadgeCheck className="h-3.5 w-3.5" /> Verified on MilitaryVoices</span>
          <span className="absolute right-4 top-4 rounded-full bg-black/45 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">{platformLabel(c.platform)}</span>
        </div>
        <div className="-mt-12 px-5 pb-5">
          <div className="relative">
            <div className="truncate text-2xl font-bold tracking-tight text-white" style={HEADLINE}>{c.name}</div>
            <div className="truncate text-sm text-white/65">{c.verified?.show ?? `@${c.handle}`}{c.branch ? ` · ${c.branch}` : ""}</div>
          </div>
          <div className="mt-4 grid gap-px overflow-hidden rounded-2xl bg-white/10" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0,1fr))` }}>
            {tiles.map(([l, v]) => (
              <div key={l} className="bg-[#0e1d3f] px-3 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/50">{l}</div>
                <div className="mt-1 text-xl font-bold tabular-nums text-white">{v}</div>
              </div>
            ))}
          </div>
          {c.quality != null && (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-[#F0A71F]" style={{ width: `${Math.min(100, c.quality)}%` }} /></div>
            </div>
          )}
          <div className="mt-4 flex items-center justify-between text-xs text-white/50">
            <span className="inline-flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5 text-[#F0A71F]" /> Open the full profile</span>
            <span className="flex gap-1">{pool.map((_, k) => <span key={k} className={`h-1.5 rounded-full transition-all ${k === i % pool.length ? "w-5 bg-[#F0A71F]" : "w-1.5 bg-white/25"}`} />)}</span>
          </div>
        </div>
      </button>
    </div>
  );
}

// ===========================================================================
// Results as a list: scan down, compare across, select many
// ===========================================================================

function PlatformIcon({ platform, className = "h-4 w-4" }: { platform: string; className?: string }) {
  const I = PLATFORM_ICON[platform] ?? Globe;
  const color = platform === "instagram" ? "text-[#d62976]" : platform === "youtube" ? "text-[#ff0000]" : platform === "twitch" ? "text-[#9146ff]" : "text-foreground";
  return <I className={`${className} ${color}`} />;
}

function ResultsList({ rows, total, saved, isMember, onOpen, onSave, onSaveMany }: {
  rows: Card[]; total?: number; saved: Set<string>; isMember: boolean;
  onOpen: (c: Card) => void; onSave: (c: Card) => void; onSaveMany: (cs: Card[]) => Promise<void>;
}) {
  const keyOf = (c: Card) => `${c.platform}:${c.handle.toLowerCase()}:${c.name}`;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const all = rows.length > 0 && rows.every((c) => picked.has(keyOf(c)));
  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {isMember && <input type="checkbox" checked={all} onChange={() => setPicked(all ? new Set() : new Set(rows.map(keyOf)))} className="h-4 w-4 rounded border-border accent-[#053877]" aria-label="Select all on page" />}
        <span className="flex-1">{picked.size ? `${picked.size} selected` : `Select all on page (${rows.length}${total && total > rows.length ? ` of ${total.toLocaleString()}` : ""})`}</span>
        {picked.size > 0 && (
          <Button size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await onSaveMany(rows.filter((c) => picked.has(keyOf(c)))); setPicked(new Set()); } finally { setBusy(false); } }} className="h-7 gap-1.5 rounded-lg bg-[#2563eb] text-xs normal-case tracking-normal text-white hover:bg-[#1d4ed8]" data-testid="results-save-selected">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add {picked.size} to list
          </Button>
        )}
        <span className="hidden w-24 text-right sm:block">Followers</span>
        <span className="hidden w-24 text-right sm:block">Engagement</span>
        <span className="hidden w-20 text-right md:block">Quality</span>
        <span className="w-8" />
      </div>
      <ul className="divide-y divide-border">
        {rows.map((c) => {
          const k = keyOf(c);
          const isSaved = saved.has(`${c.platform}:${c.handle.toLowerCase()}`);
          return (
            <li key={k} className={`group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 ${picked.has(k) ? "bg-[#053877]/[0.04]" : ""}`} data-testid={`result-${c.handle || c.name}`}>
              {isMember && <input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)} className="h-4 w-4 rounded border-border accent-[#053877]" aria-label={`Select ${c.name}`} />}
              <button type="button" onClick={() => onOpen(c)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <Avatar src={c.picture} name={c.name} size={44} ring={!!c.verified} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium group-hover:text-[#053877] dark:group-hover:text-[#8fb5e8]">{c.name}</span>
                    {c.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-[#F0A71F]" aria-label="Verified on MilitaryVoices" />}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.verified ? c.verified.show : c.handle ? `@${c.handle}` : ""}
                    {c.branch ? ` · ${c.branch}` : ""}
                  </span>
                </span>
              </button>
              <span className="hidden w-24 items-center justify-end gap-1.5 text-sm font-medium tabular-nums sm:flex">
                {c.platform && <PlatformIcon platform={c.platform} className="h-3.5 w-3.5" />} {c.followers != null ? compact(c.followers) : "–"}
              </span>
              <span className="hidden w-24 text-right text-sm tabular-nums text-muted-foreground sm:block">{c.engagement != null ? pct(c.engagement, 2) : "–"}</span>
              <span className="hidden w-20 text-right text-sm tabular-nums text-muted-foreground md:block">{c.quality != null ? `${c.quality}/100` : "–"}</span>
              <span className="flex w-8 justify-end">
                {isMember && (
                  <button type="button" onClick={() => onSave(c)} disabled={isSaved} className={`rounded-lg p-1.5 ${isSaved ? "text-[#b36b00]" : "text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100"}`} title={isSaved ? "Saved" : "Save"} aria-label="Save">
                    {isSaved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border bg-muted/40 px-4 py-3"><Skeleton className="h-3 w-40" /></div>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
          <Skeleton className="h-11 w-11 rounded-full" />
          <div className="flex-1"><Skeleton className="h-3.5 w-44" /><Skeleton className="mt-2 h-3 w-28" /></div>
          <Skeleton className="hidden h-3.5 w-16 sm:block" />
          <Skeleton className="hidden h-3.5 w-14 sm:block" />
        </div>
      ))}
    </div>
  );
}

// ===========================================================================
// Before a search: our creators, and what Discovery is
// ===========================================================================

function Welcome({ verified, isMember, signedIn, onOpenVerified, onSaveVerified, onJoin, loading }: { verified: Card[]; isMember: boolean; signedIn: boolean; onOpenVerified: (c: Card) => void; onSaveVerified: (c: Card) => void; onJoin: () => void; loading: boolean }) {
  return (
    <div className="flex flex-col gap-12">
      {!isMember && !loading && (
        <section className="grid gap-6 rounded-3xl border border-border bg-card p-6 sm:p-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl" style={HEADLINE}>{signedIn ? "Add Discovery to your account" : "Free account. Real audience data."}</h2>
            <p className="mt-2 text-muted-foreground">
              {signedIn
                ? "One click and Discovery sits beside your show on your dashboard. Same sign-in, nothing new to remember."
                : "Search every network, see who's real, save shortlists, and reveal contacts. No card, no password: your email and a code."}
            </p>
            <Button onClick={onJoin} className="mt-5 h-11 gap-2 rounded-full bg-[#053877] px-6 font-semibold text-white hover:bg-[#0a4a99]" data-testid="discover-join-cta">
              {signedIn ? "Add Discovery" : "Create your free account"} <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <ul className="grid gap-3 text-sm">
            {[
              [ShieldCheck, "Audience quality", "Real versus suspicious followers, before you spend a dollar."],
              [MapPin, "Who's watching", "Country, state, age and gender of the audience, not just a follower count."],
              [Handshake, "Brand history", "The brands they've already mentioned and the ones their audience loves."],
              [Bookmark, "Shortlists", "Save, compare and export the people you want to reach."],
            ].map(([Icon, t, b]) => {
              const I = Icon as typeof ShieldCheck;
              return (
                <li key={t as string} className="flex gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F0A71F]/15 text-[#8a5a00]"><I className="h-4 w-4" /></span>
                  <span><span className="block font-semibold">{t as string}</span><span className="text-muted-foreground">{b as string}</span></span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <BadgeCheck className="h-5 w-5 text-[#F0A71F]" /> Verified on MilitaryVoices
          </h2>
          <p className="text-sm text-muted-foreground">Creators we know personally. Every one checked by our team.</p>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {verified.length === 0
            ? Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)
            : verified.map((c) => <CreatorCard key={`v-${c.name}-${c.verified?.show}`} c={c} saved={false} onOpen={() => onOpenVerified(c)} onSave={isMember ? () => onSaveVerified(c) : undefined} />)}
        </div>
      </section>
    </div>
  );
}

// ===========================================================================
// A creator, as a card
// ===========================================================================

function CoverImage({ src, name }: { src: string; name: string }) {
  const [broken, setBroken] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  if (!src || broken) return <span className="flex h-full w-full items-center justify-center text-5xl font-bold text-white/25" style={HEADLINE}>{initials}</span>;
  return <img src={src.startsWith("/api/") ? src : resolveUploadUrl(src)} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />;
}

/**
 * A creator as a card: the face is the card. The photo runs edge to edge with
 * the name set on it, and the three numbers a brand reads first sit under it
 * in one row. Verified creators carry the gold edge and badge; nothing else
 * about them is different.
 */
function CreatorCard({ c, saved, onOpen, onSave }: { c: Card; saved: boolean; onOpen: () => void; onSave?: () => void }) {
  const stats = [
    c.followers != null ? ["Followers", compact(c.followers)] : null,
    c.engagement != null ? ["Engagement", pct(c.engagement, 2)] : null,
    c.quality != null ? ["Quality", `${c.quality}`] : c.branch ? ["Branch", c.branch.replace("Military spouse", "Spouse").replace("Marine Corps", "Marines")] : null,
  ].filter(Boolean) as [string, string][];
  return (
    <div className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-card transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_18px_40px_-16px_rgba(4,16,43,0.45)] ${c.verified ? "border-[#F0A71F]/60 ring-1 ring-[#F0A71F]/25" : "border-border hover:border-[#053877]/30"}`} data-testid={`creator-${c.handle || c.name}`}>
      <button type="button" onClick={onOpen} className="relative block aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-[#0a2a5e] to-[#04102b] text-left" aria-label={`Open ${c.name}`}>
        <CoverImage src={c.picture} name={c.name} />
        <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
        <span className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {c.verified ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#F0A71F] px-2 py-0.5 text-[11px] font-bold text-[#1a1200] shadow"><BadgeCheck className="h-3 w-3" /> Verified</span>
          ) : c.platform ? (
            <span className="rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">{platformLabel(c.platform)}</span>
          ) : null}
          {c.branch && c.quality != null && <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-[#053877]">{c.branch}</span>}
        </span>
        <span className="absolute inset-x-3 bottom-3">
          <span className="block truncate text-lg font-bold leading-tight text-white drop-shadow" style={HEADLINE}>{c.name}</span>
          <span className="block truncate text-xs text-white/75">{c.verified ? c.verified.show : c.handle ? `@${c.handle}` : ""}</span>
        </span>
      </button>
      {onSave && (
        <button type="button" onClick={onSave} disabled={saved} className={`absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full backdrop-blur transition-colors ${saved ? "bg-[#F0A71F] text-[#1a1200]" : "bg-black/40 text-white hover:bg-black/60"}`} title={saved ? "Saved" : "Save to shortlist"} data-testid="creator-save">
          {saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
        </button>
      )}
      {stats.length ? (
        <button type="button" onClick={onOpen} className="grid divide-x divide-border text-left" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0,1fr))` }} tabIndex={-1}>
          {stats.map(([l, v]) => (
            <span key={l} className="min-w-0 px-3 py-3">
              <span className="block truncate text-base font-bold tabular-nums leading-none">{v}</span>
              <span className="mt-1.5 block text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{l}</span>
            </span>
          ))}
        </button>
      ) : (
        <div className="flex items-center gap-1.5 px-3 py-3 text-xs font-medium text-muted-foreground"><Mic2 className="h-3.5 w-3.5 text-[#053877]" /> Podcast host</div>
      )}
    </div>
  );
}

// ===========================================================================
// A creator, opened
// ===========================================================================

function Bars({ items, color = "#053877" }: { items: { name: string; pct: number }[]; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.pct));
  return (
    <ul className="flex flex-col gap-2">
      {items.map((i) => (
        <li key={i.name} className="grid grid-cols-[minmax(0,9rem)_1fr_3rem] items-center gap-2 text-sm">
          <span className="truncate text-muted-foreground" title={i.name}>{i.name}</span>
          <span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full" style={{ width: `${(i.pct / max) * 100}%`, background: color }} /></span>
          <span className="text-right tabular-nums">{i.pct.toFixed(i.pct < 10 ? 1 : 0)}%</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "warn" ? "text-[#b36b00]" : tone === "bad" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Growth({ points }: { points: { monthsAgo: number; pct: number }[] }) {
  if (points.length < 2) return <p className="text-sm text-muted-foreground">Not enough history yet.</p>;
  // Shown as reported, one figure per checkpoint. The index doesn't say
  // which way its sign points, so the chart makes no claim of up or down.
  const W = 320, H = 80, pad = 8;
  const vals = points.map((p) => p.pct);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (H - pad * 2);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-full" preserveAspectRatio="none" aria-label="Follower growth">
        <path d={path} fill="none" stroke="#053877" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => <circle key={p.monthsAgo} cx={x(i)} cy={y(p.pct)} r="3" fill="#053877" />)}
      </svg>
      <div className="mt-1 grid text-center text-[11px] text-muted-foreground" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0,1fr))` }}>
        {points.map((p) => (
          <span key={p.monthsAgo}>
            <span className="block font-semibold tabular-nums text-foreground">{p.pct > 0 ? "+" : ""}{p.pct.toFixed(1)}%</span>
            {p.monthsAgo} mo
          </span>
        ))}
      </div>
    </div>
  );
}

function RequestButton({ kind, card, isMember, onJoin }: { kind: "email" | "phone"; card: Card; isMember: boolean; onJoin: () => void }) {
  const { toast } = useToast();
  const [done, setDone] = useState(false);
  const ask = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/discover/intro", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ signupId: card.signupId, kind }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
    },
    onSuccess: () => {
      setDone(true);
      toast({ title: "Requested", description: `We'll ask ${card.verified?.host.split(" ")[0] ?? "them"} and put you in touch, usually within a day.` });
    },
    onError: (e: Error) => toast({ title: "Couldn't send that", description: e.message, variant: "destructive" }),
  });
  if (done) return <span className="text-xs font-semibold text-emerald-600">Requested</span>;
  return (
    <Button size="sm" variant="outline" className="h-8 rounded-full" disabled={ask.isPending} onClick={() => (isMember ? ask.mutate() : onJoin())} data-testid={`request-${kind}`}>
      {ask.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Request"}
    </Button>
  );
}

const PLATFORM_ICON: Record<string, typeof Instagram> = { instagram: Instagram, youtube: Youtube, tiktok: Music2, twitter: Twitter, twitch: Twitch };

/**
 * A creator, opened: a panel over the results, so the list stays in view. The
 * contents run down the left the whole height; the reading column carries a
 * toolbar that follows you (back, next, add to list, share, close), who they
 * are, and then the nine sections.
 */
function ProfileDrawer({ card, siblings, onClose, onOpenCreator, isMember, onJoin, lists, onSave, saved, allowance }: {
  card: Card | null; siblings: Card[]; onClose: () => void; onOpenCreator: (c: Card) => void; isMember: boolean; onJoin: () => void;
  lists: List[]; onSave: (c: Card, listId?: number) => void; saved: boolean; allowance: { used: number; allowance: number } | null | undefined;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [wantSimilar, setWantSimilar] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [contact, setContact] = useState<null | { email: string | null; phone: string | null; website: string | null; location: string | null }>(null);
  useEffect(() => { setContact(null); setWantSimilar(false); scroller.current?.scrollTo({ top: 0 }); }, [card?.handle, card?.name]);
  const canAnalyze = !!card && !!card.handle && !!card.platform && isMember && ["instagram", "youtube", "tiktok", "twitter", "twitch"].includes(card.platform);
  const a = useQuery<Analytics>({
    queryKey: ["/api/discover/creator", card?.platform, card?.handle],
    enabled: canAnalyze,
    queryFn: async () => {
      const res = await fetch(`/api/discover/creator?platform=${card!.platform}&handle=${encodeURIComponent(card!.handle)}`, { credentials: "include" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      return j;
    },
    staleTime: 60 * 60_000,
    retry: false,
  });
  const similar = useQuery<Card[]>({
    queryKey: ["/api/discover/similar", card?.platform, card?.handle],
    enabled: canAnalyze && wantSimilar,
    queryFn: async () => {
      const res = await fetch(`/api/discover/similar?platform=${card!.platform}&handle=${encodeURIComponent(card!.handle)}`, { credentials: "include" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      return j;
    },
    staleTime: 60 * 60_000,
    retry: false,
  });
  const reveal = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/discover/reveal", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: card!.platform, handle: card!.handle }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      return j;
    },
    onSuccess: (j) => {
      setContact(j);
      queryClient.invalidateQueries({ queryKey: ["/api/discover/me"] });
      if (!j.email && !j.phone) toast({ title: "No public contact for this creator", description: "Try their profile link, or their website." });
    },
    onError: (e: Error) => toast({ title: "Couldn't get the contact", description: e.message, variant: "destructive" }),
  });

  // Back and next through the list it was opened from; the arrow keys too.
  const at = card ? siblings.findIndex((c) => c.platform === card.platform && c.handle.toLowerCase() === card.handle.toLowerCase() && c.name === card.name) : -1;
  const go = (d: number) => { const n = siblings[at + d]; if (n) onOpenCreator(n); };
  useEffect(() => {
    if (!card) return;
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const share = async () => {
    if (!card) return;
    const url = `${window.location.origin}/discover?creator=${encodeURIComponent(`${card.platform}:${card.handle}`)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: "Anyone with a Discovery account can open this profile." });
    } catch {
      toast({ title: "Copy this link", description: url });
    }
  };

  const profile = a.data?.profile;
  const id = profile?.identity;
  const PIcon = card ? PLATFORM_ICON[card.platform] ?? Globe : Globe;
  const niches = profile ? Array.from(new Set([...(profile.content.categories ?? []), ...(profile.content.niches ?? [])])).slice(0, 4) : [];

  const toolbar = card && (
    <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur sm:px-6">
      {siblings.length > 1 && at >= 0 && (
        <div className="flex items-center gap-1.5 text-sm">
          <button type="button" onClick={() => go(-1)} disabled={at <= 0} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-40" aria-label="Previous creator" data-testid="drawer-prev"><ChevronRight className="h-4 w-4 rotate-180" /></button>
          <span className="min-w-[4.5rem] text-center tabular-nums text-muted-foreground"><span className="font-medium text-foreground">{at + 1}</span> of {siblings.length}</span>
          <button type="button" onClick={() => go(1)} disabled={at >= siblings.length - 1} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-40" aria-label="Next creator" data-testid="drawer-next"><ChevronRight className="h-4 w-4" /></button>
          <span className="mx-1.5 h-6 w-px bg-border" />
        </div>
      )}
      {card.handle && (
        <a href={profileUrl(card)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-[#053877]/30 bg-[#053877]/[0.04] px-2.5 py-1.5 text-sm font-medium hover:border-[#053877]/50">
          <PIcon className="h-4 w-4" /> {compact(id?.followers ?? card.followers)}
        </a>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        {isMember && (card.handle || card.verified) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" disabled={saved} className="h-8 gap-1.5 rounded-lg bg-[#2563eb] font-medium text-white hover:bg-[#1d4ed8]" data-testid="drawer-save">
                {saved ? <BookmarkCheck className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {saved ? "Saved" : "Add to list"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {lists.length ? lists.map((l) => <DropdownMenuItem key={l.id} onClick={() => onSave(card, l.id)}>{l.name}</DropdownMenuItem>) : <DropdownMenuItem onClick={() => onSave(card)}>Shortlist</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {!isMember && <Button size="sm" onClick={onJoin} className="h-8 rounded-lg bg-[#2563eb] font-medium text-white hover:bg-[#1d4ed8]">Create free account</Button>}
        {card.handle && <Button size="sm" variant="ghost" onClick={() => void share()} className="h-8 gap-1.5 rounded-lg bg-muted/70 font-medium" data-testid="drawer-share"><Share2 className="h-4 w-4" /> Share</Button>}
        <button type="button" onClick={onClose} className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close" data-testid="drawer-close"><X className="h-4 w-4" /></button>
      </div>
    </div>
  );

  const header = card && (
    <div className="border-b-8 border-muted/60 bg-card px-5 py-6 sm:px-8">
      <div className="flex items-start gap-5">
        <Avatar src={id?.picture || card.picture} name={card.name} size={84} ring={!!card.verified} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-2xl font-semibold tracking-tight">{id?.name || card.name}</h2>
            {card.verified ? <BadgeCheck className="h-5 w-5 text-[#F0A71F]" aria-label="Verified on MilitaryVoices" /> : id?.verified ? <BadgeCheck className="h-5 w-5 text-[#2563eb]" aria-label="Verified account" /> : null}
            {card.handle && <a href={profileUrl(card)} target="_blank" rel="noreferrer" className="text-sm text-[#2563eb] underline-offset-2 hover:underline">@{card.handle}</a>}
          </div>
          {id?.bio && <p className="mt-1.5 line-clamp-2 max-w-3xl text-sm text-muted-foreground">{id.bio}</p>}
          <p className="mt-2 text-sm">
            <span className="font-semibold tabular-nums">{compact(id?.followers ?? card.followers)}</span> <span className="text-muted-foreground">followers</span>
            {(profile?.signals.engagementRate ?? card.engagement) != null && (
              <> <span className="mx-1.5 text-muted-foreground/50">·</span><span className="font-semibold tabular-nums">{pct(profile?.signals.engagementRate ?? card.engagement, 2)}</span> <span className="text-muted-foreground">engagement</span></>
            )}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {id?.country && <span className="inline-flex items-center gap-1 text-muted-foreground"><MapPin className="h-3.5 w-3.5" /> {id.country}</span>}
            {card.branch && <span className="rounded-md bg-[#053877]/[0.07] px-2 py-0.5 text-xs font-medium text-[#053877] dark:text-[#8fb5e8]">{card.branch}</span>}
            {card.verified && <span className="inline-flex items-center gap-1 rounded-md border border-[#F0A71F]/50 bg-[#F0A71F]/10 px-2 py-0.5 text-xs font-medium text-[#8a5a00]"><BadgeCheck className="h-3.5 w-3.5" /> Verified on MilitaryVoices · {card.verified.show}</span>}
            {card.verified?.serviceStatus && <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{card.verified.serviceStatus}</span>}
          </div>
          {niches.length > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 text-xs text-muted-foreground">Creator niche</div>
              <div className="flex flex-wrap gap-1.5">{niches.map((n) => <span key={n} className="rounded-md border border-[#2563eb]/25 bg-[#2563eb]/[0.05] px-2.5 py-1 text-xs font-medium capitalize text-[#1e3a8a] dark:text-[#bfdbfe]">{n}</span>)}</div>
            </div>
          )}
          {/* contact: our creators through us; everyone else from the index */}
          {card.verified ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Contact through MilitaryVoices, with their say-so:</span>
              <RequestButton kind="email" card={card} isMember={isMember} onJoin={onJoin} />
              <RequestButton kind="phone" card={card} isMember={isMember} onJoin={onJoin} />
            </div>
          ) : isMember && card.handle && !contact ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <Button size="sm" variant="outline" onClick={() => reveal.mutate()} disabled={reveal.isPending} className="h-8 gap-1.5 rounded-lg" data-testid="drawer-reveal">
                {reveal.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Reveal contact
              </Button>
              {allowance && <span className="text-xs text-muted-foreground">{Math.max(0, allowance.allowance - allowance.used)} of {allowance.allowance} left this month</span>}
            </div>
          ) : null}
          {contact && (
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
              {contact.email && <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1.5 font-medium text-[#2563eb] hover:underline"><Mail className="h-4 w-4" /> {contact.email}</a>}
              {contact.phone && <a href={`tel:${contact.phone}`} className="inline-flex items-center gap-1.5"><Phone className="h-4 w-4 text-muted-foreground" /> {contact.phone}</a>}
              {contact.website && <a href={String(contact.website).startsWith("http") ? contact.website : `https://${contact.website}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5"><Globe className="h-4 w-4 text-muted-foreground" /> {contact.website}</a>}
              {!contact.email && !contact.phone && !contact.website && <span className="text-muted-foreground">No public contact on file.</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const placeholder = !card ? null : card.verified && !card.handle ? (
    <p className="p-8 text-sm text-muted-foreground">No public social account on file for audience data yet.</p>
  ) : !isMember ? (
    <div className="p-8">
      <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
        <Lock className="mx-auto h-6 w-6 text-muted-foreground" />
        <p className="mt-2 font-medium">Audience quality, demographics, growth and brand history</p>
        <p className="mt-1 text-sm text-muted-foreground">Nine sections on every creator, free with a Discovery account.</p>
        <Button onClick={onJoin} className="mt-4 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]">Create your free account</Button>
      </div>
    </div>
  ) : a.isError ? (
    <p className="m-8 rounded-xl bg-destructive/5 p-4 text-sm text-destructive">{(a.error as Error).message}</p>
  ) : (
    <div className="flex flex-col gap-2 p-5 sm:p-8">
      <p className="text-sm text-muted-foreground">Reading their audience, growth, posts and brand history…</p>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="bg-card p-4"><Skeleton className="h-3 w-20" /><Skeleton className="mt-3 h-6 w-16" /></div>)}</div>
      <Skeleton className="mt-6 h-40 rounded-2xl" />
    </div>
  );

  return (
    <Sheet open={!!card} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent ref={scroller} side="right" className="w-full overflow-y-auto bg-background p-0 sm:max-w-3xl lg:max-w-[min(76rem,92vw)] [&>button.absolute]:hidden">
        {card && (
          <>
            <SheetTitle className="sr-only">{card.name}</SheetTitle>
            <CreatorProfileSections
              profile={profile}
              toolbar={toolbar}
              header={header}
              placeholder={placeholder}
              cardEngagement={card.engagement}
              scrollRoot={scroller}
              onOpenCreator={(p: ProfilePerson) => onOpenCreator({ platform: p.platform, handle: p.handle, name: p.name, picture: p.picture, followers: p.followers, engagement: null, branch: "" })}
              similar={
                !wantSimilar ? (
                  <Button variant="outline" className="self-start rounded-full" onClick={() => setWantSimilar(true)} data-testid="find-similar">Search for more creators like this</Button>
                ) : similar.isLoading ? (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
                ) : similar.isError ? (
                  <p className="text-sm text-destructive">{(similar.error as Error).message}</p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{(similar.data ?? []).map((c) => <CreatorCard key={c.handle} c={c} saved={false} onOpen={() => onOpenCreator(c)} />)}</div>
                )
              }
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ===========================================================================
// Saved lists
// ===========================================================================

function Lists({ lists, onOpen }: { lists: List[]; onOpen: (c: Card) => void }) {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<number | null>(null);
  const [name, setName] = useState("");
  const current = lists.find((l) => l.id === active) ?? lists[0];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/discover/lists"] });
  const create = async () => {
    if (!name.trim()) return;
    const row = await (await apiRequest("POST", "/api/discover/lists", { name: name.trim() })).json();
    setName("");
    setActive(row.id);
    refresh();
  };
  const exportCsv = () => {
    if (!current) return;
    const rows = [["Name", "Handle", "Platform", "Followers", "Engagement %", "Branch", "Profile"], ...current.items.map((i) => [i.snapshot.name, `@${i.handle}`, platformLabel(i.platform), String(i.snapshot.followers ?? ""), String(i.snapshot.engagement ?? ""), i.snapshot.branch ?? "", profileUrl(i)])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${current.name.replace(/[^a-z0-9]+/gi, "-")}.csv`;
    a.click();
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-2">
        {lists.map((l) => (
          <button key={l.id} type="button" onClick={() => setActive(l.id)} className={`flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm ${current?.id === l.id ? "bg-[#053877] text-white" : "hover:bg-muted"}`}>
            <span className="truncate font-medium">{l.name}</span>
            <span className={`text-xs ${current?.id === l.id ? "text-white/70" : "text-muted-foreground"}`}>{l.items.length}</span>
          </button>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); void create(); }} className="mt-2 flex gap-1.5">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New list" className="h-9" />
          <Button type="submit" size="icon" variant="outline" className="h-9 w-9 shrink-0"><Plus className="h-4 w-4" /></Button>
        </form>
      </aside>
      <section>
        {!current ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center">
            <p className="text-lg font-semibold" style={HEADLINE}>No saved creators yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">Press the bookmark on any creator and they land here.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-2xl font-bold tracking-tight" style={HEADLINE}>{current.name}</h2>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-1.5 rounded-full" onClick={exportCsv} disabled={!current.items.length}><Download className="h-4 w-4" /> Export CSV</Button>
                <Button variant="ghost" size="sm" className="gap-1.5 rounded-full text-muted-foreground" onClick={async () => { if (window.confirm(`Delete "${current.name}"?`)) { await apiRequest("DELETE", `/api/discover/lists/${current.id}`); setActive(null); refresh(); } }}><Trash2 className="h-4 w-4" /> Delete list</Button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {current.items.map((i) => (
                <div key={i.id} className="relative">
                  <CreatorCard c={i.snapshot} saved onOpen={() => onOpen(i.snapshot)} />
                  <button type="button" onClick={async () => { await apiRequest("DELETE", `/api/discover/lists/${current.id}/items/${i.id}`); refresh(); }} className="absolute right-2 top-2 rounded-full bg-background/80 p-1.5 text-muted-foreground hover:text-destructive" title="Remove"><X className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ===========================================================================
// The free account: email, code, and what they're here for
// ===========================================================================

function JoinDialog({ open, me, onClose, onDone, defaultRole, source }: { open: boolean; me?: Me; onClose: () => void; onDone: () => void; defaultRole: string; source: string }) {
  const { toast } = useToast();
  const siteKey = useTurnstileSiteKey();
  const [step, setStep] = useState<"email" | "code" | "about">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [human, setHuman] = useState<string | null>(null);
  const [humanReset, setHumanReset] = useState(0);
  const [role, setRole] = useState(defaultRole);
  const [org, setOrg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setStep(me?.signedIn ? "about" : "email"); setRole(defaultRole); } }, [open, me?.signedIn, defaultRole]);

  const requestCode = async () => {
    setBusy(true);
    try {
      await apiRequest("POST", "/api/host/request-code", { email: email.trim(), turnstileToken: human });
      setStep("code");
    } catch (e) {
      toast({ title: "Couldn't send a code", description: (e as Error).message, variant: "destructive" });
      setHumanReset((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    setBusy(true);
    try {
      await apiRequest("POST", "/api/host/verify-code", { email: email.trim(), code: code.trim(), remember: true });
      setStep("about");
    } catch (e) {
      toast({ title: "That code didn't work", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  const join = async () => {
    setBusy(true);
    try {
      await apiRequest("POST", "/api/discover/join", { role, orgName: org.trim(), source });
      toast({ title: "Discovery is on your account" });
      onDone();
    } catch (e) {
      toast({ title: "Couldn't add Discovery", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md overflow-hidden p-0">
        <div className="px-6 pb-2 pt-6" style={{ background: NAVY }}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F0A71F]">MilitaryVoices Discovery</p>
          <DialogTitle className="mt-2 text-2xl font-bold text-white" style={HEADLINE}>
            {step === "about" ? (me?.isPodcaster ? "Add Discovery to your account" : "One last thing") : "Create your free account"}
          </DialogTitle>
          <DialogDescription className="pb-4 text-white/70">
            {step === "email" ? "Your email and a 6-digit code. No password, no card." : step === "code" ? `We sent a code to ${email}.` : "So we can tailor your searches."}
          </DialogDescription>
        </div>
        <div className="flex flex-col gap-4 p-6">
          {step === "email" && (
            <form onSubmit={(e) => { e.preventDefault(); void requestCode(); }} className="flex flex-col gap-3">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="h-11" autoFocus data-testid="join-email" />
              {siteKey ? <Turnstile siteKey={siteKey} onToken={setHuman} resetSignal={humanReset} /> : null}
              <Button type="submit" disabled={busy || !email.includes("@") || (!!siteKey && !human)} className="h-11 rounded-full bg-[#053877] font-semibold text-white hover:bg-[#0a4a99]" data-testid="join-send">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send me a code"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">Already on MilitaryVoices? Use the same email and Discovery joins your account.</p>
            </form>
          )}
          {step === "code" && (
            <form onSubmit={(e) => { e.preventDefault(); void verify(); }} className="flex flex-col gap-3">
              <Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit code" className="h-11 text-center text-lg tracking-[0.4em]" autoFocus data-testid="join-code" />
              <Button type="submit" disabled={busy || code.length !== 6} className="h-11 rounded-full bg-[#053877] font-semibold text-white hover:bg-[#0a4a99]">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}
              </Button>
              <button type="button" onClick={() => setStep("email")} className="text-xs text-muted-foreground hover:text-foreground">Use a different email</button>
            </form>
          )}
          {step === "about" && (
            <form onSubmit={(e) => { e.preventDefault(); void join(); }} className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                {[["brand", "A brand"], ["podcaster", "A podcaster"], ["event", "An event"], ["agency", "An agency"]].map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setRole(v)} className={`rounded-xl border px-3 py-2.5 text-sm font-medium ${role === v ? "border-[#053877] bg-[#053877] text-white" : "border-border hover:border-[#053877]/40"}`}>{l}</button>
                ))}
              </div>
              <Input value={org} onChange={(e) => setOrg(e.target.value)} placeholder={role === "podcaster" ? "Your show (optional)" : "Company or event (optional)"} className="h-11" />
              <Button type="submit" disabled={busy} className="h-11 rounded-full bg-[#F0A71F] font-semibold text-[#1a1200] hover:bg-[#f5b944]" data-testid="join-go">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start discovering"}
              </Button>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
