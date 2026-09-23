import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search, Sparkles, BadgeCheck, Bookmark, BookmarkCheck, Users, Mail, Phone, Globe, ShieldCheck,
  Mic2, Megaphone, CalendarDays, X, Loader2, ExternalLink, Plus, Trash2, Download, ChevronRight, Lock, MapPin, Heart, Hash, Handshake, Info,
} from "lucide-react";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, resolveUploadUrl } from "@/lib/queryClient";
import { Turnstile, useTurnstileSiteKey } from "@/components/Turnstile";

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
};
type Me = { signedIn: boolean; email?: string; isPodcaster?: boolean; member?: { role: string; orgName: string } | null; reveals?: { used: number; allowance: number } | null };
type SearchResult = { brief: string; total: number; page: number; pageSize: number; results: Card[]; verified: Card[]; understood?: { notes?: string[]; from_nlp?: Record<string, unknown> } | null };
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

  const [door, setDoor] = useState<(typeof DOORS)[number]["key"]>("brand");
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState("instagram");
  const [branch, setBranch] = useState("");
  const [size, setSize] = useState(0);
  const [sort, setSort] = useState("relevancy");
  const [page, setPage] = useState(0);
  const [submitted, setSubmitted] = useState<null | { q: string; platform: string; branch: string; size: number; sort: string }>(null);
  const [tab, setTab] = useState<"search" | "lists">("search");
  const [open, setOpen] = useState<Card | null>(null);
  const [gate, setGate] = useState(false);
  const d = DOORS.find((x) => x.key === door)!;

  // Anything that runs a search asks for an account first; the search it
  // wanted runs the moment the account exists.
  const run = (over?: Partial<{ q: string; branch: string; size: number; sort: string; platform: string }>) => {
    const next = { q: over?.q ?? q, platform: over?.platform ?? platform, branch: over?.branch ?? branch, size: over?.size ?? size, sort: over?.sort ?? sort };
    if (over?.q !== undefined) setQ(over.q);
    setPage(0);
    setSubmitted(next);
    setTab("search");
    if (!isMember) setGate(true);
  };

  const search = useQuery<SearchResult>({
    queryKey: ["/api/discover/search", submitted, page],
    enabled: isMember && !!submitted,
    queryFn: async () => {
      const s = submitted!;
      const res = await fetch("/api/discover/search", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: s.q, platform: s.platform, branch: s.branch, sort: s.sort, page, minFollowers: SIZES[s.size].min, maxFollowers: SIZES[s.size].max }),
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
    if (submitted) setSubmitted((s) => (s ? { ...s, platform, branch, size, sort } : s));
    setPage(0);
  }, [platform, branch, size, sort]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const r = search.data;
  const results = r?.results ?? [];

  return (
    <div className="min-h-screen bg-background">
      <NavBar />

      {/* ---------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden" style={{ background: NAVY }}>
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[32rem] w-[32rem] rounded-full opacity-[0.16] blur-3xl" style={{ background: GOLD }} />
        <div aria-hidden className="pointer-events-none absolute -bottom-48 -left-32 h-[28rem] w-[28rem] rounded-full bg-[#1d5cc4] opacity-20 blur-3xl" />
        <div className="relative mx-auto w-full max-w-6xl px-4 pb-10 pt-12 sm:px-6 sm:pt-16">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#F0A71F]">
              <Sparkles className="h-3.5 w-3.5" /> MilitaryVoice Discovery
            </p>
            {isMember && me?.reveals && (
              <p className="text-xs text-white/60" data-testid="discover-allowance">
                {Math.max(0, me.reveals.allowance - me.reveals.used)} of {me.reveals.allowance} free contacts left this month
              </p>
            )}
          </div>
          <h1 className="mt-5 max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-6xl" style={HEADLINE}>
            Find the military and veteran voices <span style={{ color: GOLD }}>worth working with.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-white/70">
            Creators to sponsor, guests to book, speakers for the stage. Search in plain English across Instagram, YouTube, TikTok, X and Twitch, with the audience data that tells you who's real.
          </p>

          {/* the three doors */}
          <div className="mt-8 grid gap-2 sm:grid-cols-3" role="tablist" aria-label="What you're looking for">
            {DOORS.map((x) => {
              const Icon = x.icon;
              const on = door === x.key;
              return (
                <button
                  key={x.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setDoor(x.key)}
                  className={`group flex items-start gap-3 rounded-2xl border p-4 text-left transition-all ${on ? "border-[#F0A71F] bg-white text-foreground shadow-lg" : "border-white/10 bg-white/[0.04] text-white hover:border-white/25 hover:bg-white/[0.08]"}`}
                  data-testid={`door-${x.key}`}
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${on ? "bg-[#053877] text-white" : "bg-white/10 text-[#F0A71F]"}`}><Icon className="h-5 w-5" /></span>
                  <span className="min-w-0">
                    <span className="block text-base font-bold" style={HEADLINE}>{x.title}</span>
                    <span className={`block text-sm ${on ? "text-muted-foreground" : "text-white/60"}`}>{x.blurb}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* the search */}
          <form
            onSubmit={(e) => { e.preventDefault(); run(); }}
            className="mt-4 flex flex-col gap-2 rounded-2xl bg-white p-2 shadow-2xl sm:flex-row sm:items-center"
            data-testid="discover-search-form"
          >
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="h-12 rounded-xl border-0 bg-muted/60 px-3 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-[#053877] sm:w-40"
              aria-label="Platform"
              data-testid="discover-platform"
            >
              {PLATFORMS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
            </select>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={d.placeholder}
                className="h-12 border-0 pl-11 text-base text-foreground shadow-none focus-visible:ring-0"
                data-testid="discover-q"
              />
            </div>
            <Button type="submit" className="h-12 gap-2 rounded-xl bg-[#053877] px-6 text-base font-semibold text-white hover:bg-[#0a4a99]" data-testid="discover-go">
              <Search className="h-4 w-4" /> Search
            </Button>
          </form>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">Try</span>
            {d.tries.map((t) => (
              <button key={t} type="button" onClick={() => run({ q: t })} className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white/85 hover:bg-white/10" data-testid="discover-try">
                {t}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- filter bar */}
      <div className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
          {isMember && (
            <div className="mr-2 flex rounded-full bg-muted p-1 text-sm">
              {(["search", "lists"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full px-3 py-1 font-medium ${tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`} data-testid={`discover-tab-${t}`}>
                  {t === "search" ? "Search" : `Saved${(lists.data?.reduce((n, l) => n + l.items.length, 0) ?? 0) ? ` · ${lists.data!.reduce((n, l) => n + l.items.length, 0)}` : ""}`}
                </button>
              ))}
            </div>
          )}
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
            <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="h-9 rounded-full border border-border bg-card px-3 text-sm" aria-label="Audience size">
              {SIZES.map((s, i) => <option key={s.label} value={i}>{s.label}</option>)}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-9 rounded-full border border-border bg-card px-3 text-sm" aria-label="Sort">
              {SORTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        {tab === "lists" && isMember ? (
          <Lists lists={lists.data ?? []} onOpen={setOpen} />
        ) : !submitted || !isMember ? (
          <Welcome verified={verified} isMember={isMember} signedIn={!!me?.signedIn} onOpenVerified={setOpen} onJoin={() => setGate(true)} loading={meLoading} />
        ) : (
          <>
            {/* what ran */}
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-2xl font-bold tracking-tight" style={HEADLINE}>
                  {search.isLoading ? "Searching…" : r ? `${r.total.toLocaleString()} creators on ${platformLabel(submitted.platform)}` : "Search"}
                </h2>
                {r && <p className="mt-1 text-sm text-muted-foreground">We searched for <span className="font-medium text-foreground">"{r.brief}"</span></p>}
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
                <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-[#8a5a00]"><BadgeCheck className="h-4 w-4" /> Verified on MilitaryVoice</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {r.verified.map((c) => <CreatorCard key={`v-${c.name}`} c={c} saved={false} onOpen={() => setOpen(c)} />)}
                </div>
              </section>
            )}

            <section className="mt-8">
              {search.isLoading ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}</div>
              ) : results.length === 0 && r ? (
                <div className="rounded-2xl border border-dashed border-border p-10 text-center">
                  <p className="text-lg font-semibold" style={HEADLINE}>Nobody matched that.</p>
                  <p className="mt-1 text-sm text-muted-foreground">Try fewer words, another platform, or a wider audience size.</p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {results.map((c) => (
                    <CreatorCard key={`${c.platform}:${c.handle}`} c={c} saved={saved.has(`${c.platform}:${c.handle.toLowerCase()}`)} onOpen={() => setOpen(c)} onSave={() => saveTo.mutate({ card: c })} />
                  ))}
                </div>
              )}
              {r && r.total > (page + 1) * r.pageSize && (
                <div className="mt-6 flex justify-center gap-2">
                  {page > 0 && <Button variant="outline" className="rounded-full" onClick={() => setPage(page - 1)}>Previous</Button>}
                  <Button variant="outline" className="rounded-full" onClick={() => { setPage(page + 1); window.scrollTo({ top: 480, behavior: "smooth" }); }} data-testid="discover-more">
                    Next {r.pageSize}
                  </Button>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      <ProfileDrawer card={open} onClose={() => setOpen(null)} isMember={isMember} onJoin={() => setGate(true)} lists={lists.data ?? []} onSave={(card, listId) => saveTo.mutate({ card, listId })} saved={open ? saved.has(`${open.platform}:${open.handle.toLowerCase()}`) : false} />
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
// Before a search: our creators, and what Discovery is
// ===========================================================================

function Welcome({ verified, isMember, signedIn, onOpenVerified, onJoin, loading }: { verified: Card[]; isMember: boolean; signedIn: boolean; onOpenVerified: (c: Card) => void; onJoin: () => void; loading: boolean }) {
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
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight" style={HEADLINE}>
            <BadgeCheck className="h-6 w-6 text-[#F0A71F]" /> Verified on MilitaryVoice
          </h2>
          <p className="text-sm text-muted-foreground">Podcasters on The Podcast Marathon, October 5. We know every one of them.</p>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {verified.length === 0
            ? Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)
            : verified.map((c) => <CreatorCard key={`v-${c.name}-${c.verified?.show}`} c={c} saved={false} onOpen={() => onOpenVerified(c)} />)}
        </div>
      </section>
    </div>
  );
}

// ===========================================================================
// A creator, as a card
// ===========================================================================

function CreatorCard({ c, saved, onOpen, onSave }: { c: Card; saved: boolean; onOpen: () => void; onSave?: () => void }) {
  return (
    <div className="group relative flex flex-col rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-[#053877]/30 hover:shadow-lg" data-testid={`creator-${c.handle || c.name}`}>
      <button type="button" onClick={onOpen} className="flex items-start gap-3 text-left" aria-label={`Open ${c.name}`}>
        <Avatar src={c.picture} name={c.name} size={52} ring={!!c.verified} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span className="truncate text-[15px] font-bold leading-tight" style={HEADLINE}>{c.name}</span>
            {c.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-[#F0A71F]" aria-label="Verified on MilitaryVoice" />}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {c.verified ? c.verified.show : `@${c.handle}`}
          </span>
        </span>
      </button>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {c.branch && <span className="rounded-full bg-[#053877]/10 px-2 py-0.5 text-[11px] font-semibold text-[#053877]">{c.branch}</span>}
        {c.verified?.serviceStatus && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{c.verified.serviceStatus}</span>}
        {c.verified && <span className="rounded-full bg-[#F0A71F]/15 px-2 py-0.5 text-[11px] font-semibold text-[#8a5a00]">On air {c.verified.slotLabel}</span>}
        {!c.verified && c.platform && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{platformLabel(c.platform)}</span>}
      </div>
      <div className="mt-auto flex items-end justify-between gap-2 pt-4">
        <div className="flex gap-4">
          {c.followers != null ? (
            <div>
              <div className="text-lg font-bold tabular-nums leading-none">{compact(c.followers)}</div>
              <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{c.verified ? "reach" : "followers"}</div>
            </div>
          ) : c.verified ? (
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Mic2 className="h-3.5 w-3.5 text-[#053877]" /> Podcast host</div>
          ) : null}
          {c.engagement != null && (
            <div>
              <div className="text-lg font-bold tabular-nums leading-none">{pct(c.engagement, 2)}</div>
              <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">engagement</div>
            </div>
          )}
        </div>
        {onSave && (
          <button type="button" onClick={onSave} disabled={saved} className={`rounded-full p-2 transition-colors ${saved ? "text-[#8a5a00]" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} title={saved ? "Saved" : "Save to shortlist"} data-testid="creator-save">
            {saved ? <BookmarkCheck className="h-5 w-5" /> : <Bookmark className="h-5 w-5" />}
          </button>
        )}
      </div>
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

function ProfileDrawer({ card, onClose, isMember, onJoin, lists, onSave, saved }: { card: Card | null; onClose: () => void; isMember: boolean; onJoin: () => void; lists: List[]; onSave: (c: Card, listId?: number) => void; saved: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [view, setView] = useState<"overview" | "audience" | "content" | "similar">("overview");
  const [contact, setContact] = useState<null | { email: string | null; phone: string | null; website: string | null; location: string | null }>(null);
  useEffect(() => { setView("overview"); setContact(null); }, [card?.handle, card?.name]);
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
    enabled: canAnalyze && view === "similar",
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

  const data = a.data;
  const aud = data?.audience;
  const quality = aud?.credibility == null ? null : aud.credibility >= 80 ? "good" : aud.credibility >= 60 ? "warn" : "bad";
  const us = aud?.countries.find((x) => x.name === "United States")?.pct ?? null;

  return (
    <Sheet open={!!card} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl">
        {card && (
          <>
            <SheetTitle className="sr-only">{card.name}</SheetTitle>
            {/* header */}
            <div className="relative overflow-hidden px-6 pb-5 pt-8 text-white" style={{ background: NAVY }}>
              <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full opacity-20 blur-3xl" style={{ background: GOLD }} />
              <div className="relative flex items-start gap-4">
                <Avatar src={card.picture} name={card.name} size={80} ring />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h2 className="truncate text-2xl font-bold tracking-tight" style={HEADLINE}>{card.name}</h2>
                    {card.verified && <BadgeCheck className="h-5 w-5 shrink-0 text-[#F0A71F]" />}
                  </div>
                  {card.handle && (
                    <a href={profileUrl(card)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-white/70 hover:text-white">
                      @{card.handle} on {platformLabel(card.platform)} <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {card.verified && <p className="mt-1 text-sm text-white/80">{card.verified.show} · on air {card.verified.slotLabel}, October 5</p>}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {card.branch && <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-white">{card.branch}</span>}
                    {card.verified?.serviceStatus && <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/80">{card.verified.serviceStatus}</span>}
                  </div>
                </div>
              </div>
              <div className="relative mt-5 grid grid-cols-3 gap-2">
                {[["Followers", compact(card.followers)], ["Engagement", card.engagement != null ? pct(card.engagement, 2) : "–"], ["Audience quality", aud?.credibility != null ? `${aud.credibility}/100` : isMember ? (a.isLoading ? "…" : "–") : "🔒"]].map(([l, v]) => (
                  <div key={l} className="rounded-xl bg-white/[0.07] p-3">
                    <div className="text-[11px] uppercase tracking-wide text-white/60">{l}</div>
                    <div className="mt-0.5 text-xl font-bold tabular-nums">{v}</div>
                  </div>
                ))}
              </div>
              <div className="relative mt-4 flex flex-wrap gap-2">
                {isMember && card.handle && !card.verified && (
                  <Button size="sm" onClick={() => onSave(card, lists[0]?.id)} disabled={saved} className="gap-1.5 rounded-full bg-[#F0A71F] font-semibold text-[#1a1200] hover:bg-[#f5b944]" data-testid="drawer-save">
                    {saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />} {saved ? "Saved" : "Save"}
                  </Button>
                )}
                {isMember && card.handle && !card.verified && !contact && (
                  <Button size="sm" variant="outline" onClick={() => reveal.mutate()} disabled={reveal.isPending} className="gap-1.5 rounded-full border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white" data-testid="drawer-reveal">
                    {reveal.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Reveal contact
                  </Button>
                )}
                {card.verified && (
                  <a href="/agenda" target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="gap-1.5 rounded-full border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"><CalendarDays className="h-4 w-4" /> See their show</Button></a>
                )}
              </div>
              {contact && (
                <div className="relative mt-4 grid gap-1.5 rounded-xl bg-white p-3 text-sm text-foreground">
                  {contact.email && <a href={`mailto:${contact.email}`} className="flex items-center gap-2 font-medium text-[#053877] hover:underline"><Mail className="h-4 w-4" /> {contact.email}</a>}
                  {contact.phone && <a href={`tel:${contact.phone}`} className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /> {contact.phone}</a>}
                  {contact.website && <a href={String(contact.website).startsWith("http") ? contact.website : `https://${contact.website}`} target="_blank" rel="noreferrer" className="flex items-center gap-2"><Globe className="h-4 w-4 text-muted-foreground" /> {contact.website}</a>}
                  {!contact.email && !contact.phone && !contact.website && <span className="text-muted-foreground">No public contact on file.</span>}
                </div>
              )}
            </div>

            {/* body */}
            {card.verified ? (
              <div className="p-6 text-sm text-muted-foreground">
                <p>{card.verified.host} hosts <span className="font-semibold text-foreground">{card.verified.show}</span> and is on the lineup for The Podcast Marathon at {card.verified.slotLabel} on October 5.</p>
                <p className="mt-3">Want to book them, sponsor their show or bring them to your event? We'll make the introduction: <a className="font-semibold text-[#053877] underline underline-offset-2" href={`mailto:hello@militaryvoice.ai?subject=${encodeURIComponent(`Introduction to ${card.verified.host}`)}`}>hello@militaryvoice.ai</a></p>
              </div>
            ) : !isMember ? (
              <div className="p-6">
                <div className="rounded-2xl border border-dashed border-border p-6 text-center">
                  <Lock className="mx-auto h-6 w-6 text-muted-foreground" />
                  <p className="mt-2 font-semibold">Audience quality, demographics and brand history</p>
                  <p className="mt-1 text-sm text-muted-foreground">Free with a Discovery account.</p>
                  <Button onClick={onJoin} className="mt-4 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]">Create your free account</Button>
                </div>
              </div>
            ) : (
              <div className="p-6">
                <div className="flex gap-1 rounded-full bg-muted p-1 text-sm">
                  {(["overview", "audience", "content", "similar"] as const).map((v) => (
                    <button key={v} type="button" onClick={() => setView(v)} className={`flex-1 rounded-full px-3 py-1.5 font-medium capitalize ${view === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`} data-testid={`drawer-${v}`}>{v}</button>
                  ))}
                </div>
                {a.isLoading ? (
                  <div className="mt-5 grid gap-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
                ) : a.isError ? (
                  <p className="mt-5 rounded-xl bg-destructive/5 p-4 text-sm text-destructive">{(a.error as Error).message}</p>
                ) : data && aud ? (
                  <div className="mt-5">
                    {view === "overview" && (
                      <div className="flex flex-col gap-5">
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          <Stat label="Real followers" value={pct(aud.realPct, 0)} sub={aud.suspiciousPct != null ? `${pct(aud.suspiciousPct, 0)} suspicious` : undefined} tone={aud.realPct == null ? undefined : aud.realPct >= 60 ? "good" : aud.realPct >= 40 ? "warn" : "bad"} />
                          <Stat label="US audience" value={pct(us, 0)} sub={aud.countries[0] && aud.countries[0].name !== "United States" ? `Top: ${aud.countries[0].name}` : undefined} tone={us == null ? undefined : us >= 60 ? "good" : us >= 35 ? "warn" : "bad"} />
                          <Stat label="Audience" value={aud.femalePct != null ? `${aud.femalePct.toFixed(0)}% women` : "–"} sub={aud.ages[0] ? `Mostly ${[...aud.ages].sort((x, y) => y.pct - x.pct)[0].name}` : undefined} />
                          <Stat label="Est. income" value={data.incomeMin != null ? `$${compact(data.incomeMin)}–$${compact(data.incomeMax)}` : "–"} sub="last 90 days" />
                          <Stat label="Median likes" value={compact(data.likesMedian)} sub={data.commentsMedian != null ? `${compact(data.commentsMedian)} comments` : undefined} />
                          <Stat label="Reels views" value={compact(data.reelsMedianViews)} sub={data.reelsPercent != null ? `${data.reelsPercent.toFixed(0)}% of posts are reels` : undefined} />
                        </div>
                        {quality && (
                          <div className={`flex items-start gap-3 rounded-xl p-4 text-sm ${quality === "good" ? "bg-emerald-500/10" : quality === "warn" ? "bg-[#F0A71F]/15" : "bg-destructive/10"}`}>
                            <ShieldCheck className={`mt-0.5 h-5 w-5 shrink-0 ${quality === "good" ? "text-emerald-600" : quality === "warn" ? "text-[#8a5a00]" : "text-destructive"}`} />
                            <span>
                              <span className="font-semibold">Audience quality {aud.credibility}/100.</span>{" "}
                              {quality === "good" ? "Most of this audience is real people who engage." : quality === "warn" ? "A fair share of mass-following and inactive accounts. Worth a look at recent posts." : "A lot of this audience is mass-following or suspicious accounts. Reach will be lower than the follower count says."}
                            </span>
                          </div>
                        )}
                        <div className="rounded-xl border border-border p-4">
                          <h4 className="text-sm font-semibold">Follower growth</h4>
                          <div className="mt-2"><Growth points={data.growth} /></div>
                        </div>
                        {aud.interests.length > 0 && (
                          <div className="rounded-xl border border-border p-4">
                            <h4 className="flex items-center gap-1.5 text-sm font-semibold"><Heart className="h-4 w-4 text-[#b36b00]" /> What their audience is into</h4>
                            <div className="mt-3"><Bars items={aud.interests.slice(0, 6)} color={GOLD} /></div>
                          </div>
                        )}
                      </div>
                    )}
                    {view === "audience" && (
                      <div className="grid gap-5 sm:grid-cols-2">
                        {[["Countries", aud.countries], ["States", aud.states], ["Cities", aud.cities], ["Ages", aud.ages], ["Languages", aud.languages], ["Brands they love", aud.brandAffinity]].map(([t, items]) =>
                          (items as { name: string; pct: number }[]).length ? (
                            <div key={t as string} className="rounded-xl border border-border p-4">
                              <h4 className="text-sm font-semibold">{t as string}</h4>
                              <div className="mt-3"><Bars items={(items as { name: string; pct: number }[]).slice(0, 6)} /></div>
                            </div>
                          ) : null,
                        )}
                        {aud.femalePct != null && (
                          <div className="rounded-xl border border-border p-4 sm:col-span-2">
                            <h4 className="text-sm font-semibold">Gender</h4>
                            <div className="mt-3 flex h-3 overflow-hidden rounded-full">
                              <span style={{ width: `${aud.femalePct}%`, background: GOLD }} />
                              <span style={{ width: `${aud.malePct ?? 100 - aud.femalePct}%`, background: "#053877" }} />
                            </div>
                            <div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{aud.femalePct.toFixed(0)}% women</span><span>{(aud.malePct ?? 100 - aud.femalePct).toFixed(0)}% men</span></div>
                          </div>
                        )}
                      </div>
                    )}
                    {view === "content" && (
                      <div className="flex flex-col gap-5">
                        {data.hashtags.length > 0 && (
                          <div>
                            <h4 className="flex items-center gap-1.5 text-sm font-semibold"><Hash className="h-4 w-4" /> Hashtags they use</h4>
                            <div className="mt-2 flex flex-wrap gap-1.5">{data.hashtags.map((h) => <span key={h} className="rounded-full border border-border px-2.5 py-1 text-xs">#{h}</span>)}</div>
                          </div>
                        )}
                        <div>
                          <h4 className="flex items-center gap-1.5 text-sm font-semibold"><Handshake className="h-4 w-4" /> Brands they've worked with or mentioned</h4>
                          {data.pastSponsors.length + data.brandsMentioned.length === 0 ? (
                            <p className="mt-2 text-sm text-muted-foreground">None found in recent posts. A fresh partner for your brand.</p>
                          ) : (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {data.pastSponsors.map((s) => <span key={s.brand} className="rounded-full bg-[#053877] px-2.5 py-1 text-xs font-semibold text-white">@{s.brand}{s.posts ? ` · ${s.posts}` : ""}</span>)}
                              {data.brandsMentioned.map((b) => <a key={b} href={`https://instagram.com/${b}`} target="_blank" rel="noreferrer" className="rounded-full bg-[#053877]/10 px-2.5 py-1 text-xs font-semibold text-[#053877] hover:underline">@{b}</a>)}
                            </div>
                          )}
                        </div>
                        {data.collaborators.length > 0 && (
                          <div>
                            <h4 className="flex items-center gap-1.5 text-sm font-semibold"><Users className="h-4 w-4" /> Who they collaborate with</h4>
                            <div className="mt-2 flex flex-wrap gap-1.5">{data.collaborators.map((u) => <a key={u} href={`https://instagram.com/${u}`} target="_blank" rel="noreferrer" className="rounded-full border border-border px-2.5 py-1 text-xs hover:border-[#053877]/40">@{u}</a>)}</div>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          <Stat label="Affiliate links" value={data.promotesAffiliates == null ? "–" : data.promotesAffiliates ? "Yes" : "No"} />
                          <Stat label="Sells merch" value={data.hasMerch == null ? "–" : data.hasMerch ? "Yes" : "No"} />
                        </div>
                      </div>
                    )}
                    {view === "similar" && (
                      similar.isLoading ? (
                        <div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
                      ) : similar.isError ? (
                        <p className="text-sm text-destructive">{(similar.error as Error).message}</p>
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-2">{(similar.data ?? []).map((c) => <CreatorCard key={c.handle} c={c} saved={false} onOpen={() => { window.open(profileUrl(c), "_blank"); }} />)}</div>
                      )
                    )}
                    <p className="mt-6 text-[11px] text-muted-foreground">Updated {new Date(data.fetchedAt).toLocaleDateString()}. Estimates from public data.</p>
                  </div>
                ) : (
                  <p className="mt-5 text-sm text-muted-foreground">No analytics for this platform yet.</p>
                )}
              </div>
            )}
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
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F0A71F]">MilitaryVoice Discovery</p>
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
              <p className="text-center text-xs text-muted-foreground">Already on MilitaryVoice? Use the same email and Discovery joins your account.</p>
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
