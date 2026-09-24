import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search, Sparkles, BadgeCheck, Bookmark, BookmarkCheck, Users, Mail, Phone, Globe, ShieldCheck,
  Mic2, Megaphone, CalendarDays, X, Loader2, ExternalLink, Plus, Trash2, Download, ChevronRight, Lock, MapPin, Heart, Hash, Handshake, Info,
  Check, SlidersHorizontal, AtSign, Type as TypeIcon, Wand2, TrendingUp, Instagram, Youtube, Twitter, Twitch, Music2, Share2, Linkedin, Facebook,
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
  channels?: string[];
  platformVerified?: boolean;
  category?: string;
  extra?: RowExtra | null;
};
type RowExtra = {
  growth: { monthsAgo: number; pct: number }[]; growth6m: number | null;
  country: { name: string; code: string; pct: number } | null;
  niches: { name: string; pct: number }[]; collabs: string[]; collabCount: number;
};
type Me = { signedIn: boolean; email?: string; isPodcaster?: boolean; member?: { role: string; orgName: string } | null; reveals?: { used: number; allowance: number } | null; lookups?: { used: number; allowance: number } | null; isAdmin?: boolean };
/** The saved sample search, every column filled; free to show. */
type Sample = { q: string; platform: string; total: number; results: Card[]; builtAt: string };
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
  /** Set when the full read failed and this is the account read alone. */
  partial?: string;
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
      <span className={`${cls} flex items-center justify-center bg-[#053877]/10 font-semibold text-[#053877]`} style={{ width: size, height: size, fontSize: size / 2.8 }}>
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
  // Branches combine: "Army,Navy" searches both.
  const [branch, setBranch] = useState("");
  const branchList = branch ? branch.split(",") : [];
  const [size, setSize] = useState(0);
  const [sort, setSort] = useState("relevancy");
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<Mode>("ai");
  const [filters, setFilters] = useState<Filters>({});
  const [showFilters, setShowFilters] = useState(false);
  // While the search-mode menu is open the hero sits above the sticky filter bar, so the menu isn't painted over.
  const [menuOpen, setMenuOpen] = useState(false);
  // The hero demo's typing and the list it lights up.
  const [ghost, setGhost] = useState("");
  const [spotlight, setSpotlight] = useState(false);
  const [demoHide, setDemoHide] = useState(false);
  // The saved sample search, and the nudge to try your own once it's been seen.
  const sampleQ = useQuery<Sample | { none: true }>({ queryKey: ["/api/discover/sample"], queryFn: async () => (await fetch("/api/discover/sample")).json(), staleTime: 30 * 60_000 });
  const sample = sampleQ.data && !("none" in sampleQ.data) ? sampleQ.data : null;
  if (typeof window !== "undefined") (window as unknown as { __mvSampleQ?: string }).__mvSampleQ = sample?.q;
  const sampleKeys = useMemo(() => new Set((sample?.results ?? []).map((c) => `${c.platform}:${c.handle}`.toLowerCase())), [sample]);
  const [tryOwn, setTryOwn] = useState(false);
  const [tryOwnDone, setTryOwnDone] = useState(false);
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

  // The end of the demo: when it played through and there's a sample, the
  // first creator's profile slides out for a moment and back — the depth
  // behind every row — and then "Now try your own". Touching anything in the
  // meantime keeps the profile open for them.
  // If they took over the profile, the nudge waits until they close it.
  const [tryOwnPending, setTryOwnPending] = useState(false);
  useEffect(() => {
    if (tryOwnPending && !open) { setTryOwnPending(false); const t = window.setTimeout(() => setTryOwn(true), 500); return () => clearTimeout(t); }
  }, [tryOwnPending, open]);
  const sampleRef = useRef<Sample | null>(null);
  sampleRef.current = sample;
  useEffect(() => {
    const timers: number[] = [];
    let touched = false;
    const touch = () => { touched = true; };
    const onDone = (e: Event) => {
      const first = sampleRef.current?.results[0];
      if ((e as CustomEvent).detail !== "played" || !first) { setTryOwn(true); return; }
      touched = false;
      window.addEventListener("pointerdown", touch, { once: true });
      window.addEventListener("wheel", touch, { once: true });
      setOpenFrom(sampleRef.current!.results);
      setOpenRaw(first);
      timers.push(window.setTimeout(() => {
        window.removeEventListener("pointerdown", touch);
        window.removeEventListener("wheel", touch);
        if (touched) { setTryOwnPending(true); return; }
        setOpenRaw(null);
        timers.push(window.setTimeout(() => setTryOwn(true), 700));
      }, 3200));
    };
    window.addEventListener("mv-demo-search-done", onDone);
    return () => { window.removeEventListener("mv-demo-search-done", onDone); timers.forEach(clearTimeout); window.removeEventListener("pointerdown", touch); window.removeEventListener("wheel", touch); };
  }, []);
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
    // A visitor gets a real answer — the top five — before being asked for an
    // account. Looking up one exact account is a member's tool.
    if (!isMember && m === "username") { setSubmitted(next); setGate(true); return; }
    if (m === "username") return void lookupUser(next.q, next.platform);
    if (sample && m === "ai" && next.q.trim().toLowerCase() === sample.q.toLowerCase() && next.platform === sample.platform && !next.branch && next.size === 0 && activeFilters(filters).length === 0) {
      setSubmitted(null);
      setTimeout(() => {
        document.getElementById("discover-sample")?.scrollIntoView({ behavior: "smooth", block: "start" });
        setSpotlight(true);
        window.setTimeout(() => { setSpotlight(false); setTryOwn(true); }, 2600);
      }, 60);
      return;
    }
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
    enabled: !!submitted && submitted.mode !== "username" && (isMember || !meLoading),
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

  // A shared profile link: /discover?creator=instagram:handle opens it — for
  // anyone when it's a lineup podcaster's own (their Share link), for members otherwise.
  const sharedKey = useMemo(() => new URLSearchParams(window.location.search).get("creator") ?? "", []);
  useEffect(() => {
    const [pf, h] = sharedKey.split(":");
    if (pf && h && PLATFORMS.some((x) => x.v === pf)) setOpen({ platform: pf, handle: h, name: h, picture: "", followers: null, engagement: null, branch: "" });
  }, [sharedKey]);

  const r = search.data?.pages[0];
  const results = useMemo(() => {
    const seen = new Set<string>();
    return (search.data?.pages ?? []).flatMap((p) => p.results).filter((c) => { const k = `${c.platform}:${c.handle}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }, [search.data]);

  return (
    <div className="relative min-h-screen bg-background">
      <SearchDemo enabled={!submitted && tab === "search"} onType={setGhost} onSpotlight={setSpotlight} onHide={setDemoHide} />
      <NavBar product="discovery" account={isMember ? { label: "Saved", icon: "saved", onClick: () => { setTab("lists"); document.getElementById("discover-main")?.scrollIntoView({ behavior: "smooth" }); } } : { label: me?.signedIn ? "Add Discovery" : "Sign in", onClick: () => setGate(true) }} />

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
            ghost={ghost}
            callout={tryOwn && !tryOwnDone && !submitted && !q && !ghost ? <TryYourOwn onClose={() => setTryOwnDone(true)} /> : null}
            onFocusQ={() => { if (tryOwn) setTryOwnDone(true); }}
            onSubmit={() => run()}
            busy={userLoading}
            filterCount={activeFilters(filters).length}
            onMenu={setMenuOpen}
            onFilters={() => { setShowFilters((v) => !v); setTimeout(() => document.getElementById("discover-main")?.scrollIntoView({ behavior: "smooth" }), 60); }}
          />
        );
        const tries = (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Try</span>
            {d.tries.map((t) => (
              <button key={t} type="button" onClick={() => run({ q: t, mode: "ai" })} className="rounded-full bg-[#2563eb] px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#1d4ed8]" data-testid="discover-try">
                {t}
              </button>
            ))}
          </div>
        );
        const toEnrich = () => { setTab("enrich"); setTimeout(() => document.getElementById("discover-main")?.scrollIntoView({ behavior: "smooth" }), 50); };
        return (
          <>
            {heroVariant === "a" ? (
              <HeroA raised={false} door={door} setDoor={setDoor} bar={null} tries={null} onEnrich={toEnrich} allowance={isMember ? me?.reveals ?? null : null} />
            ) : (
              <HeroB raised={false} door={door} setDoor={setDoor} bar={null} tries={null} onEnrich={toEnrich} verified={verified} onOpen={openIn(verified)} />
            )}
            {/* The search, the suggestions and the filters: one block, straight under the hero. */}
            <section className={`relative bg-background ${menuOpen ? "z-30" : "z-10"}`}>
              <div className="mx-auto w-full max-w-[88rem] px-4 pb-2 pt-6 sm:px-6">
                {bar}
                {tries}
                {tab !== "enrich" && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <div className="flex flex-wrap gap-1.5" aria-label="Branch">
                      {BRANCHES.map((b) => {
                        const on = branchList.includes(b);
                        return (
                          <button
                            key={b}
                            type="button"
                            aria-pressed={on}
                            onClick={() => setBranch((prev) => { const cur = prev ? prev.split(",") : []; return (cur.includes(b) ? cur.filter((x) => x !== b) : [...cur, b]).join(","); })}
                            className={`rounded-full border px-3 py-1 text-sm transition-colors ${on ? "border-[#053877] bg-[#053877] text-white" : "border-border bg-card text-foreground hover:border-[#053877]/40"}`}
                            data-testid={`branch-${b}`}
                          >
                            {b}
                          </button>
                        );
                      })}
                    </div>
                    <button type="button" onClick={() => setShowFilters((v) => !v)} className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors ${showFilters || activeFilters(filters).length ? "border-[#053877] bg-[#053877] text-white" : "border-border bg-card hover:border-[#053877]/40"}`} data-testid="discover-filters">
                      <SlidersHorizontal className="h-4 w-4" /> Filters{activeFilters(filters).length ? ` · ${activeFilters(filters).length}` : ""}
                    </button>
                    <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="h-9 rounded-full border border-border bg-card px-3 text-sm" aria-label="Audience size">
                      {SIZES.map((sz, i) => <option key={sz.label} value={i}>{sz.label}</option>)}
                    </select>
                    <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-9 rounded-full border border-border bg-card px-3 text-sm" aria-label="Sort">
                      {SORTS.map((so) => <option key={so.v} value={so.v}>{so.label}</option>)}
                    </select>
                  </div>
                )}
              </div>
            </section>
          </>
        );
      })()}

      <main id="discover-main" className="mx-auto w-full max-w-[88rem] scroll-mt-16 px-4 py-8 sm:px-6">
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
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Account</h2>
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
          <>
          <button type="button" onClick={() => setTab("search")} className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-[#053877] hover:underline dark:text-[#8fb5e8]" data-testid="back-to-search"><ChevronRight className="h-4 w-4 rotate-180" /> Back to search</button>
          <Lists lists={lists.data ?? []} onOpen={(c) => openIn((lists.data ?? []).flatMap((l) => l.items.map((i) => i.snapshot)))(c)} />
          </>
        ) : !submitted || submitted.mode === "username" ? (
          <Welcome sample={sample} onOpenSample={openIn(sample?.results ?? [])} isAdmin={!!me?.isAdmin} verified={branchList.length ? verified.filter((c) => branchList.some((b) => c.branch.toLowerCase() === b.toLowerCase())) : verified} isMember={isMember} signedIn={!!me?.signedIn} onOpenVerified={openIn(verified)} onSaveVerified={(c) => saveTo.mutate({ card: c })} onSaveMany={saveMany} saved={saved} spotlight={spotlight} hidden={demoHide} onJoin={() => setGate(true)} loading={meLoading} />
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
                <div className="rounded-2xl border border-border bg-card">
                  <SonarLoader title="Searching the index" steps={submitted?.mode === "keywords" ? ["Reading bios for your words", "Applying your filters", "Measuring each creator"] : ["Understanding your brief", "Searching across the network", "Applying your filters", "Measuring each creator"]} />
                </div>
              ) : results.length === 0 && r ? (
                <div className="rounded-2xl border border-dashed border-border p-10 text-center">
                  <p className="text-lg font-semibold">Nobody matched that.</p>
                  <p className="mt-1 text-sm text-muted-foreground">Try fewer words, another platform, or a wider audience size.</p>
                </div>
              ) : (
                <ResultsList rows={results} total={r?.total} saved={saved} isMember={isMember} isAdmin={!!me?.isAdmin} onOpen={openIn([...(r?.verified ?? []), ...results])} onSave={(c) => saveTo.mutate({ card: c })} onSaveMany={saveMany} lockAfter={isMember ? undefined : 5} onLocked={() => setGate(true)} />
              )}
              {search.hasNextPage && (
                <div className="mt-6 flex flex-col items-center gap-1">
                  <Button variant="outline" className="h-11 gap-2 rounded-full px-6" onClick={() => (isMember ? void search.fetchNextPage() : setGate(true))} disabled={search.isFetchingNextPage} data-testid="discover-more">
                    {search.isFetchingNextPage ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Load 10 more
                  </Button>
                  <span className="text-xs text-muted-foreground">Showing {results.length} of {r!.total.toLocaleString()}</span>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      <ProfileDrawer freeKeys={sampleKeys} card={open} siblings={openFrom} sharedKey={sharedKey} allowance={me?.reveals} onOpenCreator={setOpenRaw} onClose={() => setOpenRaw(null)} isMember={isMember} onJoin={() => setGate(true)} lists={lists.data ?? []} onSave={(card, listId) => saveTo.mutate({ card, listId })} saved={open ? saved.has(`${open.platform}:${open.handle.toLowerCase()}`) : false} />
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
      <SiteFooter />
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
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open} className="flex h-12 w-full items-center gap-2 whitespace-nowrap rounded-xl bg-[#053877]/[0.07] px-3 text-sm font-medium text-[#053877] hover:bg-[#053877]/[0.11] sm:w-auto" data-testid="discover-mode">
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

/** Points at the search box once the sample has been seen. */
function TryYourOwn({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute left-2 top-[calc(100%+14px)] z-20 w-[min(22rem,calc(100vw-3rem))] animate-in fade-in slide-in-from-top-1 duration-500" role="status" data-testid="discover-try-own">
      <span aria-hidden className="absolute -top-1.5 left-8 h-3 w-3 rotate-45 rounded-[2px] bg-[#053877]" />
      <div className="relative flex items-start gap-3 rounded-2xl bg-[#053877] py-3 pl-4 pr-3 text-white shadow-[0_18px_40px_-12px_rgba(5,56,119,0.6)]">
        <span className="relative mt-1 flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#F0A71F] opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#F0A71F]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Now try your own</span>
          <span className="block text-sm text-white/80">Describe who you're looking for.</span>
        </span>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Close"><X className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function SearchBar({ platform, setPlatform, mode, setMode, q, setQ, placeholder, onSubmit, busy, filterCount, onFilters, onMenu, ghost, callout, onFocusQ }: {
  onMenu?: (open: boolean) => void;
  /** A pointer under the box, e.g. "Now try your own". */
  callout?: React.ReactNode;
  onFocusQ?: () => void;
  /** The demo's typing, shown as if typed; never the real value. */
  ghost?: string;
  platform: string; setPlatform: (p: string) => void; mode: Mode; setMode: (m: Mode) => void; q: string; setQ: (q: string) => void;
  placeholder: string; onSubmit: () => void; busy: boolean; filterCount: number; onFilters: () => void;
}) {
  const Lead = mode === "username" ? AtSign : Search;
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="rounded-2xl border border-border bg-card p-2 text-foreground shadow-[0_12px_32px_-16px_rgba(4,16,43,0.35)]" data-testid="discover-search-form">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="h-12 rounded-xl border-0 bg-muted/60 px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#053877] sm:w-[8.5rem]" aria-label="Platform" data-testid="discover-platform">
            {PLATFORMS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
          </select>
          <ModeMenu mode={mode} setMode={setMode} onOpenChange={onMenu} />
        </div>
        <div className="relative flex-1">
          <Lead className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onFocus={onFocusQ} onChange={(e) => setQ(e.target.value)} placeholder={!q && ghost ? ghost : placeholder} className={`h-12 border-0 pl-11 text-base shadow-none focus-visible:ring-0 ${!q && ghost ? "placeholder:text-foreground" : ""}`} data-testid="discover-q" />
          {callout}
        </div>
        <div className="flex gap-2">
          {mode !== "username" && (
            <button type="button" onClick={onFilters} className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground hover:border-[#053877]/40 hover:text-[#053877]" aria-label="Filters" title="All filters" data-testid="discover-bar-filters">
              <SlidersHorizontal className="h-5 w-5" />
              {filterCount > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#F0A71F] px-1 text-[11px] font-semibold text-[#1a1200]">{filterCount}</span>}
            </button>
          )}
          <Button type="submit" disabled={busy} className="h-12 flex-1 gap-2 rounded-xl bg-[#053877] px-6 text-base font-medium text-white hover:bg-[#0a4a99] sm:flex-none" data-testid="discover-go">
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
      <div className="relative mx-auto w-full max-w-[88rem] px-4 pb-10 pt-12 sm:px-6 sm:pt-16">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#F0A71F]"><Sparkles className="h-3.5 w-3.5" /> MilitaryVoices Discovery</p>
          {allowance && <p className="text-xs text-white/60" data-testid="discover-allowance">{Math.max(0, allowance.allowance - allowance.used)} of {allowance.allowance} free contacts left this month</p>}
        </div>
        <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl">
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
                <span className="min-w-0"><span className="block text-base font-semibold">{x.title}</span><span className={`block text-sm ${on ? "text-muted-foreground" : "text-white/60"}`}>{x.blurb}</span></span>
              </button>
            );
          })}
        </div>
        {bar}
        {tries}
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

      <div className="mx-auto grid w-full max-w-[88rem] items-center gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:pb-24 lg:pt-20">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 rounded-full border border-[#F0A71F]/30 bg-[#F0A71F]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#F0A71F]">
            <Sparkles className="h-3.5 w-3.5" /> MilitaryVoices Discovery
          </p>
          <h1 className="mt-6 text-5xl font-semibold leading-[1.02] tracking-[-0.02em] text-white sm:text-[4.25rem] lg:text-[3.9rem] xl:text-[4.25rem]">
            <span className="whitespace-nowrap">Military creators,</span>
            <br />
            <span className="bg-gradient-to-r from-[#F0A71F] via-[#ffd27a] to-[#F0A71F] bg-clip-text text-transparent">measured.</span>
          </h1>
          <p className="mt-6 max-w-xl text-xl leading-relaxed text-white/70">
            Veterans, service members and military spouses across Instagram, YouTube, TikTok, X and Twitch, with real reach, audience quality and brand history on every profile.
          </p>

          {/* what you're here for: three doors, one row */}
          <div className="mt-8 inline-flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1" role="tablist" aria-label="What you're looking for">
            {DOORS.map((x) => {
              const Icon = x.icon;
              const on = door === x.key;
              return (
                <button key={x.key} type="button" role="tab" aria-selected={on} onClick={() => setDoor(x.key)} className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-all ${on ? "bg-white text-[#04102b] shadow" : "text-white/70 hover:bg-white/[0.07] hover:text-white"}`} data-testid={`door-${x.key}`}>
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

      </div>
    </section>
  );
}

/**
 * The second half of the hero's demo: the cursor leaves the creator card, goes
 * down to the search, types "Military podcasters", presses Search, and our
 * verified list lights up. Visual only — nothing is searched or spent — and it
 * gives way the moment someone touches the search box.
 */
function SearchDemo({ enabled, onType, onSpotlight, onHide }: { enabled: boolean; onType: (t: string) => void; onSpotlight: (on: boolean) => void; onHide: (hide: boolean) => void }) {
  const [pos, setPos] = useState({ x: 0, y: 0, on: false, click: 0 });
  const live = useRef(enabled);
  live.current = enabled;
  useEffect(() => {
    let timers: number[] = [];
    const done = (played = false) => window.dispatchEvent(new CustomEvent("mv-demo-search-done", { detail: played ? "played" : "" }));
    const stop = () => {
      timers.forEach(clearTimeout);
      timers = [];
      setPos((p) => ({ ...p, on: false }));
      onType("");
      onSpotlight(false);
      onHide(false);
      done();
    };
    const at = (sel: string, dx = 0.5, dy = 0.5) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + window.scrollX + r.width * dx, y: r.top + window.scrollY + r.height * dy };
    };
    const run = (e?: Event) => {
      const input = document.querySelector('[data-testid="discover-q"]') as HTMLInputElement | null;
      const form = document.querySelector('[data-testid="discover-search-form"]');
      if (!live.current || !input || !form || input.value || document.activeElement === input) return done();
      // Scrolled into view by the visitor: type where they are, don't move the page.
      if ((e as CustomEvent | undefined)?.detail === "in-view") { onHide(true); timers.push(window.setTimeout(play, 300)); return; }
      // Glide down so the search sits under the site header with the first few
      // verified creators below it: the visitor sees the typing and the answer.
      // The answer isn't shown until the question is asked.
      onHide(true);
      const header = (document.querySelector("header") as HTMLElement | null)?.offsetHeight ?? 80;
      const target = Math.max(0, form.getBoundingClientRect().top + window.scrollY - header - 24);
      if (Math.abs(window.scrollY - target) > 8) window.scrollTo({ top: target, behavior: "smooth" });
      timers.push(window.setTimeout(play, Math.abs(window.scrollY - target) > 8 ? 900 : 0));
    };
    const play = () => {
      const input = document.querySelector('[data-testid="discover-q"]') as HTMLInputElement | null;
      const card = at('[data-testid="hero-preview"]', 0.54, 0.4);
      const q = at('[data-testid="discover-q"]', 0.12, 0.55);
      const go = at('[data-testid="discover-go"]', 0.5, 0.55);
      if (!live.current || !input || input.value || document.activeElement === input || !card || !q || !go) { onHide(false); return done(); }
      // Start from the card if it's still on screen, else just above the search.
      const start = card.y > window.scrollY + 60 ? card : { x: q.x + 180, y: q.y - 90 };
      const T = (ms: number, f: () => void) => { timers.push(window.setTimeout(f, ms)); };
      const text = (window as unknown as { __mvSampleQ?: string }).__mvSampleQ || "Military podcasters";
      setPos({ ...start, on: true, click: 0 });
      T(250, () => setPos((p) => ({ ...p, ...q })));
      T(1350, () => setPos((p) => ({ ...p, click: p.click + 1 })));
      for (let k = 1; k <= text.length; k++) T(1500 + k * 75, () => onType(text.slice(0, k)));
      const end = 1500 + text.length * 75;
      T(end + 350, () => setPos((p) => ({ ...p, ...go })));
      T(end + 1350, () => setPos((p) => ({ ...p, click: p.click + 1 })));
      T(end + 1450, () => { onHide(false); onSpotlight(true); });
      T(end + 2300, () => { setPos((p) => ({ ...p, on: false })); onType(""); });
      T(end + 4600, () => { onSpotlight(false); done(true); });
    };
    const touched = (e: Event) => { if ((e.target as HTMLElement)?.getAttribute?.("data-testid") === "discover-q" && timers.length) stop(); };
    window.addEventListener("mv-demo-search", run);
    document.addEventListener("focusin", touched);
    // Once, the first time the visitor scrolls with the search fully in view:
    // it types the sample's question, presses Search, and the answer appears.
    // A scroll listener, not an IntersectionObserver: on a tall screen the
    // search is already in view at load, so an observer never fires again.
    let fired = false;
    const check = () => {
      if (fired || window.scrollY <= 120) return;
      const form = document.querySelector('[data-testid="discover-search-form"]');
      if (!form) return;
      const r = form.getBoundingClientRect();
      if (r.top >= 0 && r.bottom <= window.innerHeight) {
        fired = true;
        window.removeEventListener("scroll", check);
        window.dispatchEvent(new CustomEvent("mv-demo-search", { detail: "in-view" }));
      }
    };
    window.addEventListener("scroll", check, { passive: true });
    return () => {
      window.removeEventListener("mv-demo-search", run);
      document.removeEventListener("focusin", touched);
      window.removeEventListener("scroll", check);
      timers.forEach(clearTimeout);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div aria-hidden className="pointer-events-none absolute left-0 top-0 z-50 transition-all duration-1000 ease-[cubic-bezier(.4,0,.2,1)]" style={{ transform: `translate(${pos.x}px, ${pos.y}px)`, opacity: pos.on ? 1 : 0 }}>
      {pos.click > 0 && <span key={pos.click} className="absolute -left-3 -top-3 h-8 w-8 rounded-full bg-[#F0A71F]/60" style={{ animation: "mv-click .5s ease-out forwards" }} />}
      <style>{`@keyframes mv-click{0%{transform:scale(.4);opacity:.9}100%{transform:scale(2.2);opacity:0}}`}</style>
      <svg width="26" height="26" viewBox="0 0 24 24" className="drop-shadow-[0_4px_8px_rgba(0,0,0,0.45)]"><path d="M4 2l15 8.2-6.4 1.6 3.9 7.3-2.9 1.5-3.9-7.3L4 18z" fill="white" stroke="#0b1733" strokeWidth="1.3" strokeLinejoin="round" /></svg>
    </div>
  );
}

type Showcase = {
  platform: string; handle: string; name: string; picture: string; show: string; verified: boolean; branch: string;
  followers: number | null; engagement: number | null; realReach: number | null; realPct: number | null;
  credibility: number | null; credibilityClass: string;
  types: { real: number | null; massFollowers: number | null; influencers: number | null; suspicious: number | null };
  topCountry: { name: string; pct: number } | null; femalePct: number | null; postsPerWeek: number | null;
  interests: { name: string; pct: number }[];
  profile?: Profile;
};

/**
 * The profile panel, the real one, drawn at full size and scaled down into the
 * card, scrolling itself while the "cursor" reads. Not a mock-up of the panel:
 * the same component a member sees, with the creator's own data.
 */
function DemoRail({ c, open, reading }: { c: Showcase; open: boolean; reading: boolean }) {
  // Drawn at a narrower width than the real panel, so it scales up: bigger and easier to read.
  const W = 700;
  const outer = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 400, h: 500 });
  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // Measured again once the profile arrives: before it, the panel isn't drawn and there's nothing to measure.
  }, [!!c.profile]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (!reading) {
      if (!open) el.scrollTop = 0;
      return;
    }
    let raf = 0;
    const start = performance.now();
    const to = Math.min(el.scrollHeight - el.clientHeight, 1700);
    const tick = (t: number) => {
      // About a second: Andrew wants the read to feel brisk, not a slow crawl.
      const k = Math.min(1, (t - start) / 1000);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      el.scrollTop = to * e;
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reading, open]);
  if (!c.profile) return null;
  const scale = box.w / W;
  const id = c.profile.identity;
  const niches = Array.from(new Set([...(c.profile.content.categories ?? []), ...(c.profile.content.niches ?? [])])).slice(0, 3);
  const toolbar = (
    <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/95 px-6 py-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground"><ChevronRight className="h-4 w-4 rotate-180" /></span>
      <span className="text-sm text-muted-foreground"><b className="font-medium text-foreground">1</b> of 30</span>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground"><ChevronRight className="h-4 w-4" /></span>
      <span className="ml-2 inline-flex items-center gap-1.5 rounded-lg border border-[#053877]/30 px-2.5 py-1.5 text-sm font-medium"><PlatformIcon platform={c.platform} /> {compact(c.followers)}</span>
      <span className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#2563eb] px-3 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Add to list</span>
      <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-muted/70 px-3 text-sm font-medium"><Share2 className="h-4 w-4" /> Share</span>
      <X className="ml-1 h-4 w-4 text-muted-foreground" />
    </div>
  );
  const header = (
    <div className="border-b-8 border-muted/60 bg-card px-8 py-6">
      <div className="flex items-start gap-5">
        <img src={c.picture.startsWith("/api/") ? c.picture : resolveUploadUrl(c.picture)} alt="" className={`h-[84px] w-[84px] rounded-full object-cover ${c.verified ? "ring-2 ring-[#F0A71F] ring-offset-2 ring-offset-background" : ""}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-semibold tracking-tight">{id.name || c.name}</span>
            <BadgeCheck className={`h-5 w-5 ${c.verified ? "text-[#F0A71F]" : "text-[#2563eb]"}`} />
            <span className="text-sm text-[#2563eb]">@{c.handle}</span>
          </div>
          {id.bio && <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{id.bio}</p>}
          <p className="mt-2 text-sm"><b className="font-semibold">{compact(c.followers)}</b> <span className="text-muted-foreground">followers</span>{c.engagement != null && <> · <b className="font-semibold">{pct(c.engagement, 2)}</b> <span className="text-muted-foreground">engagement</span></>}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {c.branch && <span className="rounded-md bg-[#053877]/[0.07] px-2 py-0.5 font-medium text-[#053877]">{c.branch}</span>}
            {c.verified && <span className="inline-flex items-center gap-1 rounded-md border border-[#F0A71F]/50 bg-[#F0A71F]/10 px-2 py-0.5 font-medium text-[#8a5a00]"><BadgeCheck className="h-3.5 w-3.5" /> Verified on MilitaryVoices{c.show ? ` · ${c.show}` : ""}</span>}
            {niches.map((n) => <span key={n} className="rounded-md border border-[#2563eb]/25 bg-[#2563eb]/[0.05] px-2 py-0.5 font-medium capitalize text-[#1e3a8a]">{n}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
  return (
    <div ref={outer} aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden bg-background transition-transform duration-700 ease-[cubic-bezier(.2,.8,.2,1)] ${open ? "translate-y-0" : "translate-y-full"}`}>
      <div style={{ width: W, height: box.h / scale, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <div ref={scroller} className="h-full overflow-hidden bg-background text-foreground">
          <CreatorProfileSections profile={c.profile} toolbar={toolbar} header={header} cardEngagement={c.engagement} scrollRoot={scroller} onOpenCreator={() => {}} similar={null} />
        </div>
      </div>
    </div>
  );
}

/**
 * The hero's demo. A real creator's card; a cursor comes in and clicks it; their
 * profile rises over the card with the numbers a brand would see, the contents
 * ticking down; then it slides away and the next creator comes round. Only
 * creators we already hold data for are shown, and every figure is theirs.
 * Hovering pauses it; clicking opens the real profile.
 */
export function PreviewStack({ verified, onOpen }: { verified: Card[]; onOpen: (c: Card) => void }) {
  const showcase = useQuery<Showcase[]>({ queryKey: ["/api/discover/showcase"], queryFn: async () => (await fetch("/api/discover/showcase")).json(), staleTime: 30 * 60_000 });
  const pool = useMemo(() => {
    const demo = (showcase.data ?? []).filter((d) => d.picture);
    if (demo.length) return demo;
    // Still loading hers: wait (the placeholder shows) rather than flash the
    // first lineup podcaster and swap. The lineup is only the fallback if the
    // showcase comes back empty.
    if (showcase.isLoading) return [];
    return verified.filter((c) => c.picture && (c.followers ?? 0) > 0).slice(0, 8).map((c) => ({
      platform: c.platform, handle: c.handle, name: c.name, picture: c.picture, show: c.verified?.show ?? "", verified: !!c.verified, branch: c.branch,
      followers: c.followers, engagement: c.engagement, realReach: null, realPct: null, credibility: c.quality ?? null, credibilityClass: "",
      types: { real: null, massFollowers: null, influencers: null, suspicious: null }, topCountry: null, femalePct: null, postsPerWeek: null, interests: [],
    }) as Showcase);
  }, [showcase.data, showcase.isLoading, verified]);

  const [i, setI] = useState(0);
  // idle → cursor travels → click → the profile rises → it reads → it slides away → next
  const [phase, setPhase] = useState<"idle" | "move" | "click" | "open" | "read" | "close">("idle");
  const [paused, setPaused] = useState(false);
  // After the first look at a profile, the demo walks down to the search once, then comes back here.
  const [waiting, setWaiting] = useState(false);
  const handedOff = useRef(false);
  useEffect(() => {
    const done = () => setWaiting(false);
    window.addEventListener("mv-demo-search-done", done);
    return () => window.removeEventListener("mv-demo-search-done", done);
  }, []);
  // No auto-play any more (Andrew, 23 Sep): the card just sits there with her
  // picture and a pulsing invitation; clicking opens the real side panel.
  const AUTOPLAY = false;
  useEffect(() => {
    if (!AUTOPLAY || !pool.length || paused || waiting) return;
    const plan: [typeof phase, number][] = [["idle", 1200], ["move", 1000], ["click", 300], ["open", 700], ["read", 2200], ["close", 700]];
    const at = plan.findIndex(([p]) => p === phase);
    const t = setTimeout(() => {
      if (at === plan.length - 1) {
        setPhase("idle");
        setI((n) => (n + 1) % pool.length);
        if (!handedOff.current) {
          handedOff.current = true;
          setWaiting(true);
          window.dispatchEvent(new Event("mv-demo-search"));
        }
      }
      else setPhase(plan[at + 1][0]);
    }, plan[at][1]);
    return () => clearTimeout(t);
  }, [phase, paused, waiting, pool.length]);

  if (!pool.length) return <div className="aspect-[4/5] w-full rounded-[28px] border border-white/10 bg-white/[0.03]" />;
  const c = pool[i % pool.length];
  const next = pool[(i + 1) % pool.length];
  const src = (u: string) => (u.startsWith("/api/") ? u : resolveUploadUrl(u));
  const open = phase === "open" || phase === "read";
  const cursorOn = phase === "move" || phase === "click" || phase === "open";
  const tiles = [
    ["Followers", compact(c.followers)],
    c.engagement != null ? ["Engagement", pct(c.engagement, 2)] : null,
    c.credibility != null ? ["Audience quality", `${c.credibility}/100`] : null,
  ].filter(Boolean) as [string, string][];
  const asCard = (): Card => ({ platform: c.platform, handle: c.handle, name: c.name, picture: c.picture, followers: c.followers, engagement: c.engagement, branch: c.branch, quality: c.credibility });

  return (
    <div className="group/tilt relative mx-auto w-full max-w-[36rem] select-none [perspective:1600px]" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <style>{`@keyframes mv-click{0%{transform:scale(.4);opacity:.9}100%{transform:scale(2.2);opacity:0}}`}</style>
      {/* the next one, waiting behind */}
      {pool.length > 1 && <div aria-hidden className="absolute inset-x-6 top-0 h-full overflow-hidden rounded-[28px] border border-white/10 bg-[#0b1733] opacity-50 shadow-2xl" style={{ transform: "translateY(-18px) scale(0.94)" }}>
        <img src={src(next.picture)} alt="" className="h-2/3 w-full object-cover opacity-60" />
      </div>}

      <div className={`relative overflow-hidden rounded-[28px] border border-white/15 bg-[#0b1733] text-left shadow-[0_50px_100px_-24px_rgba(0,0,0,0.75)] transition-transform duration-700 ease-out [transform:rotateY(-9deg)_rotateX(4deg)_rotateZ(1deg)] group-hover/tilt:[transform:rotateY(0deg)_rotateX(0deg)_rotateZ(0deg)] ${phase === "click" ? "scale-[0.985]" : ""}`}>
        <button key={c.handle} type="button" onClick={() => onOpen(asCard())} className="block w-full text-left animate-in fade-in-0 duration-500" data-testid="hero-preview">
          <div className="relative aspect-[4/3] w-full overflow-hidden">
            <img src={src(c.picture)} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0b1733] via-[#0b1733]/10 to-transparent" />
            {c.verified && <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-[#F0A71F] px-2.5 py-1 text-xs font-semibold text-[#1a1200] shadow"><BadgeCheck className="h-3.5 w-3.5" /> Verified on MilitaryVoices</span>}
            <span className="absolute right-4 top-4 rounded-full bg-black/45 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">{platformLabel(c.platform)}</span>
          </div>
          <div className="-mt-12 px-5 pb-5">
            <div className="relative">
              <div className="truncate text-xl font-semibold tracking-tight text-white">{c.name}</div>
              <div className="truncate text-sm text-white/65">{c.show || `@${c.handle}`}{c.branch ? ` · ${c.branch}` : ""}</div>
            </div>
            <div className="mt-4 grid gap-px overflow-hidden rounded-2xl bg-white/10" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0,1fr))` }}>
              {tiles.map(([l, v]) => (
                <div key={l} className="bg-[#0e1d3f] px-3 py-3">
                  <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/50">{l}</div>
                  <div className="mt-1 text-xl font-medium tabular-nums text-white">{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-white/50">
              {/* The invitation, pulsing so it can't be missed. */}
              <span className="relative inline-flex items-center gap-1.5 rounded-full bg-[#F0A71F] px-3.5 py-1.5 text-[13px] font-semibold text-[#1a1200] shadow-[0_0_24px_rgba(240,167,31,0.45)]" data-testid="hero-open-cta">
                <span className="absolute inset-0 rounded-full bg-[#F0A71F] opacity-60 motion-safe:animate-ping" aria-hidden="true" />
                <TrendingUp className="relative h-3.5 w-3.5" /> <span className="relative">Click to see the full profile</span>
              </span>
              <span className="flex gap-1">{pool.map((_, k) => <span key={k} className={`h-1.5 rounded-full transition-all ${k === i % pool.length ? "w-5 bg-[#F0A71F]" : "w-1.5 bg-white/25"}`} />)}</span>
            </div>
          </div>
        </button>

        {/* the profile, the real panel, rising over the card (auto-play only) */}
        {AUTOPLAY && <DemoRail c={c} open={open} reading={phase === "read"} />}
      </div>

      {/* the cursor (auto-play only) */}
      {AUTOPLAY && <div aria-hidden className="pointer-events-none absolute z-10 transition-all duration-1000 ease-[cubic-bezier(.4,0,.2,1)]" style={{ left: cursorOn ? "54%" : "96%", top: cursorOn ? "40%" : "104%", opacity: cursorOn ? 1 : 0 }}>
        {phase === "click" && <span className="absolute -left-3 -top-3 h-8 w-8 rounded-full bg-[#F0A71F]/60" style={{ animation: "mv-click .5s ease-out forwards" }} />}
        <svg width="26" height="26" viewBox="0 0 24 24" className="drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)]"><path d="M4 2l15 8.2-6.4 1.6 3.9 7.3-2.9 1.5-3.9-7.3L4 18z" fill="white" stroke="#0b1733" strokeWidth="1.3" strokeLinejoin="round" /></svg>
      </div>}
    </div>
  );
}

// ===========================================================================
// Waiting, shown as work being done: a sonar sweep and the steps ticking off
// ===========================================================================

function SonarLoader({ steps, title }: { steps: string[]; title?: string }) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setAt((n) => Math.min(n + 1, steps.length - 1)), 1600);
    return () => clearInterval(t);
  }, [steps.length]);
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center" role="status" aria-live="polite" data-testid="sonar-loader">
      <style>{`@keyframes mv-sweep{to{transform:rotate(360deg)}}@keyframes mv-slide{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}@keyframes mv-ring{0%{transform:scale(.55);opacity:.7}100%{transform:scale(1.25);opacity:0}}`}</style>
      <div className="relative h-28 w-28">
        {[0, 0.8, 1.6].map((d) => (
          <span key={d} className="absolute inset-0 rounded-full border border-[#053877]/40 dark:border-[#8fb5e8]/40" style={{ animation: `mv-ring 2.4s ease-out ${d}s infinite` }} />
        ))}
        <span className="absolute inset-2 rounded-full border border-[#053877]/15 dark:border-white/15" />
        <span className="absolute inset-6 rounded-full border border-[#053877]/15 dark:border-white/15" />
        <span className="absolute inset-2 rounded-full" style={{ background: "conic-gradient(from 0deg, rgba(240,167,31,0.55), rgba(240,167,31,0) 28%)", animation: "mv-sweep 1.8s linear infinite" }} />
        <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#F0A71F] shadow-[0_0_16px_4px_rgba(240,167,31,0.45)]" />
      </div>
      {title && <p className="mt-6 text-base font-medium">{title}</p>}
      <ul className="mt-4 flex flex-col gap-1.5 text-sm">
        {steps.map((st, i) => (
          <li key={st} className={`flex items-center justify-center gap-2 transition-all duration-500 ${i < at ? "text-muted-foreground" : i === at ? "font-medium text-foreground" : "text-muted-foreground/40"}`}>
            {i < at ? <Check className="h-4 w-4 text-emerald-600" /> : i === at ? <Loader2 className="h-4 w-4 animate-spin text-[#F0A71F]" /> : <span className="h-4 w-4" />}
            {st}
          </li>
        ))}
      </ul>
      <div className="mt-6 h-1 w-64 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-[#053877] to-[#F0A71F]" style={{ animation: "mv-slide 1.3s ease-in-out infinite" }} />
      </div>
    </div>
  );
}

// ===========================================================================
// Results as a list: scan down, compare across, select many
// ===========================================================================

function PlatformIcon({ platform, className = "h-4 w-4" }: { platform: string; className?: string }) {
  const I = PLATFORM_ICON[platform] ?? Globe;
  const color = platform === "instagram" ? "text-[#d62976]" : platform === "youtube" ? "text-[#ff0000]" : platform === "twitch" ? "text-[#9146ff]" : platform === "linkedin" ? "text-[#0a66c2]" : platform === "facebook" ? "text-[#1877f2]" : "text-foreground";
  return <I className={`${className} ${color}`} />;
}

const flagOf = (code: string) => (/^[A-Za-z]{2}$/.test(code) ? String.fromCodePoint(...code.toUpperCase().split("").map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : "");
const NICHE_DOT = ["#16a34a", "#d97706", "#2563eb", "#db2777", "#7c3aed", "#0891b2"];

/** A little line of the follower checkpoints, oldest to newest, as the index reports them. */
function Spark({ points }: { points: { monthsAgo: number; pct: number }[] }) {
  if (points.length < 2) return null;
  const W = 64, H = 20;
  const vals = points.map((p) => p.pct);
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const d = points.map((p, i) => `${i ? "L" : "M"}${((i / (points.length - 1)) * W).toFixed(1)},${(H - 2 - ((p.pct - min) / span) * (H - 4)).toFixed(1)}`).join(" ");
  const up = points[points.length - 1].pct >= points[0].pct;
  return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden><path d={d} fill="none" stroke={up ? "#16a34a" : "#dc2626"} strokeOpacity=".7" strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}

function ResultsList({ rows, total, saved, isMember, isAdmin, onOpen, onSave, onSaveMany, onFilled, lockAfter, onLocked }: {
  rows: Card[]; total?: number; saved: Set<string>; isMember: boolean; isAdmin?: boolean;
  onOpen: (c: Card) => void; onSave: (c: Card) => void; onSaveMany: (cs: Card[]) => Promise<void>; onFilled?: (rows: Card[]) => void;
  /** A visitor sees this many in full; the rest are greyed and ask for an account. */
  lockAfter?: number; onLocked?: () => void;
}) {
  const { toast } = useToast();
  const keyOf = (c: Card) => `${c.platform}:${c.handle.toLowerCase()}:${c.name}`;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [filling, setFilling] = useState(false);
  const [extras, setExtras] = useState<Record<string, RowExtra | null>>({});
  const all = rows.length > 0 && rows.every((c) => picked.has(keyOf(c)));
  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const ex = (c: Card) => extras[`${c.platform}:${c.handle.toLowerCase()}`] ?? c.extra ?? null;
  // Each column shows only when some row on the page has it.
  const has = {
    quality: rows.some((c) => c.quality != null),
    channels: rows.some((c) => (c.channels ?? []).some((ch) => PLATFORM_ICON[ch])),
    growth: rows.some((c) => (ex(c)?.growth.length ?? 0) > 1),
    country: rows.some((c) => ex(c)?.country),
    niches: rows.some((c) => (ex(c)?.niches.length ?? 0) > 0),
    collabs: false, // left out so the table fits; the profile carries the brand history
  };
  const missing = rows.filter((c) => c.handle && !ex(c));
  const fill = async () => {
    setFilling(true);
    try {
      const res = await fetch("/api/admin/discover/fill", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows: missing.map((c) => ({ platform: c.platform, handle: c.handle })) }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      setExtras((prev) => ({ ...prev, ...Object.fromEntries((j.rows as Card[]).map((r) => [`${r.platform}:${r.handle.toLowerCase()}`, r.extra ?? null])) }));
      toast({ title: `Filled ${j.bought} creators`, description: `${j.credits} credits used. Anyone who opens them now pays nothing.` });
      onFilled?.(j.rows);
    } catch (e) {
      toast({ title: "Couldn't fill this page", description: (e as Error).message, variant: "destructive" });
    } finally {
      setFilling(false);
    }
  };
  const head = "text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground";
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {isAdmin && missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-[#053877]/[0.05] px-4 py-2.5 text-sm dark:bg-white/[0.04]">
          <span className="text-muted-foreground">Growth, audience country and niches fill in with each creator's full profile.</span>
          <Button size="sm" variant="outline" disabled={filling} onClick={() => void fill()} className="ml-auto h-8 gap-1.5 rounded-lg" data-testid="results-fill" title={`About ${Math.round(missing.length * 0.8 * 10) / 10} credits`}>
            {filling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Fill in {missing.length} {missing.length === 1 ? "profile" : "profiles"}
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className="w-10 px-4 py-2.5 text-left">{isMember && <input type="checkbox" checked={all} onChange={() => setPicked(all ? new Set() : new Set(rows.map(keyOf)))} className="h-4 w-4 rounded border-border accent-[#053877]" aria-label="Select all on page" />}</th>
              <th className={`py-2.5 pr-3 text-left ${head}`}>
                {picked.size ? (
                  <Button size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await onSaveMany(rows.filter((c) => picked.has(keyOf(c)))); setPicked(new Set()); } finally { setBusy(false); } }} className="h-7 gap-1.5 rounded-lg bg-[#2563eb] text-xs normal-case tracking-normal text-white hover:bg-[#1d4ed8]" data-testid="results-save-selected">
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add {picked.size} to list
                  </Button>
                ) : `Select all on page (${rows.length}${total && total > rows.length ? ` of ${total.toLocaleString()}` : ""})`}
              </th>
              <th className={`px-3 py-2.5 text-right ${head}`}>Followers</th>
              {has.channels && <th className={`px-3 py-2.5 text-left ${head}`}>Other channels</th>}
              {has.growth && <th className={`px-3 py-2.5 text-left ${head}`}>Follower growth</th>}
              <th className={`px-3 py-2.5 text-right ${head}`}>ER %</th>
              {has.quality && <th className={`px-3 py-2.5 text-right ${head}`}>Quality</th>}
              {has.country && <th className={`px-3 py-2.5 text-left ${head}`}>Aud. primary country</th>}
              {has.niches && <th className={`px-3 py-2.5 text-left ${head}`}>Aud. niches</th>}
              {has.collabs && <th className={`px-3 py-2.5 text-left ${head}`}>Collabs</th>}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((c, i) => {
              const k = keyOf(c);
              const x = ex(c);
              const isSaved = saved.has(`${c.platform}:${c.handle.toLowerCase()}`);
              const locked = lockAfter != null && i >= lockAfter;
              return (
                <tr
                  key={k}
                  onClickCapture={locked ? (e) => { e.preventDefault(); e.stopPropagation(); onLocked?.(); } : undefined}
                  className={`group transition-colors ${locked ? "cursor-pointer select-none opacity-35 blur-[2px] grayscale" : "hover:bg-muted/40"} ${picked.has(k) ? "bg-[#053877]/[0.04]" : ""}`}
                  aria-hidden={locked || undefined}
                  data-testid={`result-${c.handle || c.name}`}
                >
                  <td className="px-4 py-3 align-middle">{isMember && <input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)} className="h-4 w-4 rounded border-border accent-[#053877]" aria-label={`Select ${c.name}`} />}</td>
                  <td className="py-3 pr-3">
                    <button type="button" onClick={() => onOpen(c)} className="flex min-w-0 items-center gap-3 text-left">
                      <Avatar src={c.picture} name={c.name} size={44} ring={!!c.verified} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-medium group-hover:text-[#053877] dark:group-hover:text-[#8fb5e8]">{c.name}</span>
                          {c.verified ? <BadgeCheck className="h-4 w-4 shrink-0 text-[#F0A71F]" aria-label="Verified on MilitaryVoices" /> : c.platformVerified ? <BadgeCheck className="h-4 w-4 shrink-0 text-[#2563eb]" aria-label="Verified on the platform" /> : null}
                        </span>
                        <span className="block max-w-[16rem] truncate text-xs text-muted-foreground">{c.verified ? c.verified.show : c.handle ? `@${c.handle}` : ""}{c.branch ? ` · ${c.branch}` : c.category ? ` · ${c.category}` : ""}</span>
                      </span>
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-medium tabular-nums"><span className="inline-flex items-center gap-1.5">{c.platform && <PlatformIcon platform={c.platform} className="h-3.5 w-3.5" />}{c.followers != null ? compact(c.followers) : "–"}</span></td>
                  {has.channels && <td className="px-3 py-3"><span className="flex gap-1.5">{(c.channels ?? []).filter((ch) => PLATFORM_ICON[ch]).slice(0, 4).map((ch) => <PlatformIcon key={ch} platform={ch} className="h-4 w-4" />)}</span></td>}
                  {has.growth && (
                    <td className="whitespace-nowrap px-3 py-3">
                      {x && x.growth.length > 1 ? (
                        <span className="inline-flex items-center gap-2"><Spark points={x.growth} /><span className="tabular-nums text-muted-foreground">{x.growth6m != null ? `${x.growth6m > 0 ? "+" : ""}${x.growth6m.toFixed(2)}%` : ""}</span></span>
                      ) : <span className="text-muted-foreground">–</span>}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{c.engagement != null ? pct(c.engagement, 2) : "–"}</td>
                  {has.quality && <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-muted-foreground">{c.quality != null ? `${c.quality}/100` : "–"}</td>}
                  {has.country && <td className="whitespace-nowrap px-3 py-3">{x?.country ? <span className="inline-flex items-center gap-2"><span className="text-base leading-none">{flagOf(x.country.code)}</span>{x.country.name}</span> : <span className="text-muted-foreground">–</span>}</td>}
                  {has.niches && (
                    <td className="px-3 py-2">
                      {x?.niches.length ? (
                        <ul className="flex flex-col gap-0.5 text-xs">
                          {x.niches.map((n, ni) => (
                            <li key={n.name} className={`flex items-center gap-2 ${ni === 0 ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                              <span className="flex gap-0.5">{[0, 1, 2].map((d) => <span key={d} className="h-1.5 w-1.5 rounded-full" style={{ background: d < 3 - ni ? NICHE_DOT[ni] : "hsl(var(--muted))" }} />)}</span>
                              <span className="max-w-[12rem] truncate">{n.name}</span>
                            </li>
                          ))}
                        </ul>
                      ) : <span className="text-muted-foreground">–</span>}
                    </td>
                  )}
                  {has.collabs && (
                    <td className="px-3 py-3">
                      {x?.collabCount ? (
                        <span className="flex items-center" title={x.collabs.map((b) => `@${b}`).join(", ")}>
                          {x.collabs.map((b, bi) => <span key={b} className="-ml-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-card text-[11px] font-semibold uppercase first:ml-0" style={{ background: ["#0b1733", "#e0f2e9", "#fde7ef"][bi % 3], color: bi % 3 === 0 ? "white" : "#0b1733" }}>{b[0]}</span>)}
                          {x.collabCount > x.collabs.length && <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">+{x.collabCount - x.collabs.length}</span>}
                        </span>
                      ) : <span className="text-muted-foreground">–</span>}
                    </td>
                  )}
                  <td className="px-2 py-3 text-right">
                    {isMember && (
                      <button type="button" onClick={() => onSave(c)} disabled={isSaved} className={`rounded-lg p-1.5 ${isSaved ? "text-[#b36b00]" : "text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100"}`} title={isSaved ? "Saved" : "Save"} aria-label="Save">
                        {isSaved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {lockAfter != null && rows.length > lockAfter && (
        <div className="flex flex-col items-center gap-2 border-t border-border bg-gradient-to-b from-card to-[#053877]/[0.04] px-6 py-7 text-center" data-testid="results-locked">
          <p className="text-balance text-lg font-semibold text-foreground">See all {(total ?? rows.length).toLocaleString()} creators, and every profile in full</p>
          <p className="text-balance text-sm text-muted-foreground">Free, and it takes a minute. Save lists, share profiles, and search as much as you like.</p>
          <Button onClick={onLocked} className="mt-2 h-11 rounded-full bg-[#2563eb] px-6 font-semibold text-white hover:bg-[#1d4ed8]" data-testid="results-unlock">
            Create a free account to continue
          </Button>
        </div>
      )}
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

function Welcome({ sample, onOpenSample, verified, isMember, isAdmin, signedIn, onOpenVerified, onSaveVerified, onSaveMany, saved, spotlight, hidden, onJoin, loading }: { sample: Sample | null; onOpenSample: (c: Card) => void; verified: Card[]; isMember: boolean; isAdmin?: boolean; signedIn: boolean; onOpenVerified: (c: Card) => void; onSaveVerified: (c: Card) => void; onSaveMany: (cs: Card[]) => Promise<void>; saved: Set<string>; spotlight?: boolean; hidden?: boolean; onJoin: () => void; loading: boolean }) {
  // The demo types the sample's question and "presses Search": the sample is
  // the answer it lights up. Without a sample yet, our verified list is.
  const answer = (on: boolean) => `rounded-2xl transition-all duration-700 ${on && hidden ? "pointer-events-none translate-y-6 opacity-0" : "translate-y-0 opacity-100"} ${on && spotlight ? "ring-4 ring-[#F0A71F]/50 shadow-[0_0_48px_rgba(240,167,31,0.35)]" : ""}`;
  return (
    <div className="flex flex-col gap-12">
      {sample && (
        <section id="discover-sample" className="scroll-mt-24" data-testid="discover-sample">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#b36b00] dark:text-[#F0A71F]">A sample search</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight">"{sample.q}"</h2>
            </div>
            <p className="text-sm text-muted-foreground">{sample.total.toLocaleString()} creators on {platformLabel(sample.platform)} · the top {sample.results.length}, every column filled in</p>
          </div>
          <div className={`mt-5 ${answer(true)}`}>
            <ResultsList rows={sample.results} total={sample.total} saved={saved} isMember={isMember} onOpen={onOpenSample} onSave={onSaveVerified} onSaveMany={onSaveMany} />
          </div>
        </section>
      )}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <BadgeCheck className="h-5 w-5 text-[#F0A71F]" /> Verified on MilitaryVoices
          </h2>
          <p className="text-sm text-muted-foreground">Creators we know personally. Every one checked by our team.</p>
        </div>
        <div className={`mt-5 ${answer(!sample)}`}>
          {verified.length === 0 ? <ResultsSkeleton /> : <ResultsList rows={verified} saved={saved} isMember={isMember} isAdmin={isAdmin} onOpen={onOpenVerified} onSave={onSaveVerified} onSaveMany={onSaveMany} />}
        </div>
      </section>
      {!isMember && !loading && (
        <section className="grid gap-6 rounded-3xl border border-border bg-card p-6 sm:p-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{signedIn ? "Add Discovery to your account" : "Free account. Real audience data."}</h2>
            <p className="mt-2 text-muted-foreground">
              {signedIn
                ? "One click and Discovery sits beside your show on your dashboard. Same sign-in, nothing new to remember."
                : "Search every network, see who's real, save shortlists, and reveal contacts. No card, no password: your email and a code."}
            </p>
            <Button onClick={onJoin} className="mt-5 h-11 gap-2 rounded-full bg-[#053877] px-6 font-semibold text-white hover:bg-[#0a4a99]" data-testid="discover-join-cta">
              {signedIn ? "Add Discovery" : "Create a free account to continue"} <ChevronRight className="h-4 w-4" />
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

    </div>
  );
}

// ===========================================================================
// A creator, as a card
// ===========================================================================

function CoverImage({ src, name }: { src: string; name: string }) {
  const [broken, setBroken] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  if (!src || broken) return <span className="flex h-full w-full items-center justify-center text-5xl font-semibold text-white/25">{initials}</span>;
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
            <span className="inline-flex items-center gap-1 rounded-full bg-[#F0A71F] px-2 py-0.5 text-[11px] font-semibold text-[#1a1200] shadow"><BadgeCheck className="h-3 w-3" /> Verified</span>
          ) : c.platform ? (
            <span className="rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">{platformLabel(c.platform)}</span>
          ) : null}
          {c.branch && c.quality != null && <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-[#053877]">{c.branch}</span>}
        </span>
        <span className="absolute inset-x-3 bottom-3">
          <span className="block truncate text-lg font-semibold leading-tight text-white drop-shadow">{c.name}</span>
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
              <span className="block truncate text-base font-medium tabular-nums leading-none">{v}</span>
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
      <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</div>
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

const PLATFORM_ICON: Record<string, typeof Instagram> = { instagram: Instagram, youtube: Youtube, tiktok: Music2, twitter: Twitter, x: Twitter, twitch: Twitch, linkedin: Linkedin, facebook: Facebook };

/**
 * A creator, opened: a panel over the results, so the list stays in view. The
 * contents run down the left the whole height; the reading column carries a
 * toolbar that follows you (back, next, add to list, share, close), who they
 * are, and then the nine sections.
 */
function ProfileDrawer({ card, siblings, onClose, onOpenCreator, isMember, onJoin, lists, onSave, saved, allowance, sharedKey = "", freeKeys }: {
  card: Card | null; siblings: Card[]; onClose: () => void; onOpenCreator: (c: Card) => void; isMember: boolean; onJoin: () => void; sharedKey?: string;
  /** platform:handle profiles anyone may open (the sample search's). */
  freeKeys?: Set<string>;
  lists: List[]; onSave: (c: Card, listId?: number) => void; saved: boolean; allowance: { used: number; allowance: number } | null | undefined;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [wantSimilar, setWantSimilar] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [contact, setContact] = useState<null | { email: string | null; phone: string | null; website: string | null; location: string | null }>(null);
  useEffect(() => { setContact(null); setWantSimilar(false); scroller.current?.scrollTo({ top: 0 }); }, [card?.handle, card?.name]);
  const viaShare = !!card && (sharedKey.toLowerCase() === `${card.platform}:${card.handle}`.toLowerCase() || !!freeKeys?.has(`${card.platform}:${card.handle}`.toLowerCase()));
  const canAnalyze = !!card && !!card.handle && !!card.platform && (isMember || viaShare) && ["instagram", "youtube", "tiktok", "twitter", "twitch"].includes(card.platform);
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
      toast({ title: "Link copied", description: card.verified ? "Anyone can open this profile — send it to a sponsor." : "Anyone with a Discovery account can open this profile." });
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
        <Avatar src={card.picture || id?.picture || ""} name={card.name} size={84} ring={!!card.verified} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-2xl font-semibold tracking-tight">{id?.name || card.name}</h2>
            {card.verified ? <BadgeCheck className="h-5 w-5 text-[#F0A71F]" aria-label="Verified on MilitaryVoices" /> : id?.verified ? <BadgeCheck className="h-5 w-5 text-[#2563eb]" aria-label="Verified account" /> : null}
            {card.handle && <a href={profileUrl(card)} target="_blank" rel="noreferrer" className="text-sm text-[#2563eb] underline-offset-2 hover:underline">@{card.handle}</a>}
          </div>
          {id?.bio && <p className="mt-1.5 line-clamp-2 max-w-3xl text-sm text-muted-foreground">{id.bio}</p>}
          <p className="mt-2 text-sm">
            <span className="font-semibold tabular-nums">{compact(id?.followers ?? card.followers)}</span> <span className="text-muted-foreground">followers</span>
            {(card.engagement ?? profile?.signals.engagementRate) != null && (
              <> <span className="mx-1.5 text-muted-foreground/50">·</span><span className="font-semibold tabular-nums">{pct(card.engagement ?? profile?.signals.engagementRate, 2)}</span> <span className="text-muted-foreground">engagement</span></>
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
          {a.data?.partial && (
            <p className="mt-4 rounded-lg border border-[#F0A71F]/40 bg-[#F0A71F]/10 px-3 py-2 text-sm text-[#8a5a00]">
              The index couldn't read this creator's audience just now, so this is their account and recent posts. Open them again later for the audience, growth and brand history.
            </p>
          )}
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
    <div className="p-5 sm:p-8">
      <div className="rounded-2xl border border-border bg-card">
        <SonarLoader title={`Building ${card.name.split(" ")[0]}'s profile`} steps={["Reading their audience", "Measuring growth", "Pulling recent posts", "Checking brand history"]} />
      </div>
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
            <p className="text-lg font-semibold">No saved creators yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">Press the bookmark on any creator and they land here.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-2xl font-semibold tracking-tight">{current.name}</h2>
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
          <DialogTitle className="mt-2 text-2xl font-semibold text-white">
            {step === "about" ? (me?.isPodcaster ? "Add Discovery to your account" : "One last thing") : "Create a free account to continue"}
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
