// Podcasts in Discovery: shows to pitch or be a guest on, and the people who
// host them or have been on them (Podchaser's index, through our cache).
import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, CalendarDays, Check, ChevronRight, Copy, ExternalLink, Globe, Loader2, Lock, Mail, MapPin, Mic2, Rss, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";

export type PodShow = {
  kind: "show"; id: string; title: string; about: string; image: string; web: string; site: string; rss: string;
  episodes: number | null; latest: string; since: string; categories: string[]; host: string;
  rating: number | null; ratings: number | null; language: string;
  audience: number | null; audienceRange: { from: number; to: number } | null; powerScore: number | null; hasGuests: boolean | null;
  socials: { platform: string; url: string }[]; apple: string; spotify: string; status?: string; everyDays?: number | null;
};
export type PodPerson = {
  kind: "person"; pcid: string; name: string; subtitle: string; bio: string; image: string; web: string; location: string;
  followers: number | null; appearances: number | null; socials: { platform: string; url: string }[];
};
type PodShowFull = PodShow & { contacts: { name: string; email: string; url: string; type: string }[]; email: string; people: { pcid: string; name: string; image: string; role: string; episodes: number | null }[]; locked: string[] };
type PodPersonFull = PodPerson & { shows: { id: string; title: string; image: string; web: string; role: string; episodes: number | null }[]; recent: { title: string; date: string; web: string; show: string; showId: string; image: string; role: string }[] };
type PodItem = PodShow | PodPerson;
type Page = { kind: "shows" | "people"; page: number; pageSize: number; total: number; results: PodItem[]; preview: boolean; locked: string[] };

/** What a podcast search asks. */
export type PodAsk = { q: string; kind: "shows" | "people"; branch: string; sort: string; hasGuests: boolean; active: boolean };
/** Something the drawer opens: a show by id, a person by pcid (with what we know so far). */
export type PodOpen = { kind: "show"; id: string; seed?: Partial<PodShow> } | { kind: "person"; pcid: string; seed?: Partial<PodPerson> };

export const POD_SHOW_SORTS = [
  { v: "best", label: "Best match" },
  { v: "power", label: "Biggest (Power Score)" },
  { v: "newest", label: "Newest shows" },
];
export const POD_PEOPLE_SORTS = [
  { v: "best", label: "Best match" },
  { v: "appearances", label: "Most episodes" },
  { v: "recent", label: "Recently on a show" },
];

const compact = (v: number | null | undefined) => (v == null ? "–" : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v));
function ago(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} mo ago`;
  return `${Math.round(days / 365)} yr ago`;
}
/** A show that's gone quiet: nothing new for six months. */
const quiet = (iso: string) => Number.isFinite(Date.parse(iso)) && Date.now() - Date.parse(iso) > 183 * 86_400_000;

/** Save shape for the shared lists: a show as "podcast:<id>", a person as "podperson:<pcid>". */
export const podCard = (x: PodItem) => x.kind === "show"
  ? { platform: "podcast", handle: x.id, name: x.title, picture: x.image, followers: x.audience, engagement: null, branch: "", category: x.categories[0] ?? "" }
  : { platform: "podperson", handle: x.pcid, name: x.name, picture: x.image, followers: x.followers, engagement: null, branch: "", category: x.subtitle };

function Art({ src, name, round = false, size = 56 }: { src: string; name: string; round?: boolean; size?: number }) {
  const [bad, setBad] = useState(false);
  const r = round ? "rounded-full" : "rounded-xl";
  if (!src || bad) return <span className={`flex shrink-0 items-center justify-center bg-[#053877]/10 font-semibold text-[#053877] ${r}`} style={{ width: size, height: size, fontSize: size * 0.38 }}>{(name || "?").trim().charAt(0).toUpperCase()}</span>;
  return <img src={src} alt="" loading="lazy" onError={() => setBad(true)} className={`shrink-0 bg-muted object-cover ${r}`} style={{ width: size, height: size }} />;
}

/** The results of a podcast search: ten at a time, the first five open to a visitor. */
export function PodcastResults({ ask, isMember, onJoin, onOpen, saved, onSave }: {
  ask: PodAsk; isMember: boolean; onJoin: () => void; onOpen: (o: PodOpen, from: PodOpen[]) => void;
  saved: Set<string>; onSave: (card: ReturnType<typeof podCard>) => void;
}) {
  const search = useInfiniteQuery<Page>({
    queryKey: ["/api/discover/podcasts/search", ask],
    initialPageParam: 0,
    getNextPageParam: (last) => (last.total > (last.page + 1) * last.pageSize && last.page < 20 ? last.page + 1 : undefined),
    queryFn: async ({ pageParam }) => {
      const res = await fetch("/api/discover/podcasts/search", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...ask, page: pageParam }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? "Search failed");
      return j;
    },
    staleTime: 10 * 60_000,
    retry: false,
  });
  const first = search.data?.pages[0];
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return (search.data?.pages ?? []).flatMap((p) => p.results).filter((x) => { const k = x.kind === "show" ? x.id : x.pcid; if (seen.has(k)) return false; seen.add(k); return true; });
  }, [search.data]);
  const opens: PodOpen[] = rows.map((x) => (x.kind === "show" ? { kind: "show", id: x.id, seed: x } : { kind: "person", pcid: x.pcid, seed: x }));
  const lockAfter = isMember ? Infinity : 8;
  const people = ask.kind === "people";

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">
            {/* Plain search counts every show with any of the words; past a few thousand, the count says nothing. */}
            {search.isLoading ? "Searching…" : first ? first.total > 2000 ? "Best matches" : `${first.total.toLocaleString()} ${people ? (first.total === 1 ? "host or guest" : "hosts and guests") : first.total === 1 ? "podcast" : "podcasts"}` : "Search"}
          </h2>
          {first && <p className="mt-1 text-sm text-muted-foreground">{people ? "People who host a show or have been a guest on one" : "Shows"}{ask.q ? <> about <span className="font-medium text-foreground">"{ask.q}"</span></> : null}{ask.branch ? <> · {ask.branch.split(",").join(", ")}</> : !people ? " in the military and veteran community" : ""}</p>}
        </div>
      </div>
      {search.isError && <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">{(search.error as Error).message}</div>}
      <section className="mt-6">
        {search.isLoading ? (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className="flex animate-pulse items-center gap-4 border-b border-border px-4 py-4 last:border-0"><span className="h-14 w-14 rounded-xl bg-muted" /><span className="flex-1 space-y-2"><span className="block h-4 w-1/3 rounded bg-muted" /><span className="block h-3 w-2/3 rounded bg-muted" /></span></div>)}
          </div>
        ) : rows.length === 0 && first ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center">
            <p className="text-lg font-semibold">Nothing matched that.</p>
            <p className="mt-1 text-sm text-muted-foreground">Try fewer words, or another branch.</p>
          </div>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="pod-results">
            {rows.map((x, i) => {
              const locked = i >= lockAfter;
              const key = x.kind === "show" ? `podcast:${x.id}` : `podperson:${x.pcid}`;
              return (
                <li key={key} className={`relative border-b border-border last:border-0 ${locked ? "select-none" : ""}`}>
                  <div className={`flex items-center gap-4 px-4 py-3.5 ${locked ? "pointer-events-none blur-[3px] opacity-60" : ""}`}>
                    <button type="button" onClick={() => onOpen(opens[i], opens.slice(0, Number.isFinite(lockAfter) ? lockAfter : undefined))} className="flex min-w-0 flex-1 items-center gap-4 text-left" data-testid="pod-row">
                      <Art src={x.image} name={x.kind === "show" ? x.title : x.name} round={x.kind === "person"} />
                      {x.kind === "show" ? (
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold hover:underline">{x.title}</span>
                          <span className="block truncate text-sm text-muted-foreground">{x.host || x.categories.join(" · ") || "Podcast"}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            {x.episodes != null && <span>{x.episodes.toLocaleString()} episodes</span>}
                            {x.latest && <span className={quiet(x.latest) ? "text-[#b45309]" : ""}>Last episode {ago(x.latest)}</span>}
                            {x.hasGuests && <span className="rounded-full bg-emerald-600/10 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-400">Has guests</span>}
                            {x.categories.slice(0, 2).map((c) => <span key={c} className="rounded-full bg-muted px-2 py-0.5">{c}</span>)}
                          </span>
                        </span>
                      ) : (
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold hover:underline">{x.name}</span>
                          <span className="block truncate text-sm text-muted-foreground">{x.subtitle || x.location || "Podcast guest"}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                            {x.appearances != null && <span>{x.appearances.toLocaleString()} {x.appearances === 1 ? "episode" : "episodes"}</span>}
                            {x.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{x.location}</span>}
                          </span>
                        </span>
                      )}
                    </button>
                    {x.kind === "show" && (x.audience != null || x.powerScore != null) && (
                      <span className="hidden shrink-0 text-right sm:block">
                        {x.audience != null && <span className="block text-base font-semibold tabular-nums">{compact(x.audience)}</span>}
                        {x.audience != null && <span className="block text-[11px] text-muted-foreground">an episode</span>}
                        {x.audience == null && x.powerScore != null && <><span className="block text-base font-semibold tabular-nums">{Math.round(x.powerScore)}</span><span className="block text-[11px] text-muted-foreground">Power Score</span></>}
                      </span>
                    )}
                    {x.kind === "person" && x.followers != null && x.followers > 0 && (
                      <span className="hidden shrink-0 text-right sm:block"><span className="block text-base font-semibold tabular-nums">{compact(x.followers)}</span><span className="block text-[11px] text-muted-foreground">followers</span></span>
                    )}
                    {isMember && (
                      <button type="button" onClick={() => onSave(podCard(x))} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:border-[#053877]/40 hover:text-[#053877]" aria-label={saved.has(key) ? "Saved" : "Save to your list"} title={saved.has(key) ? "Saved" : "Save to your list"} data-testid="pod-save">
                        {saved.has(key) ? <BookmarkCheck className="h-4 w-4 text-[#053877]" /> : <Bookmark className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                  {locked && i === lockAfter && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center">
                      <Button onClick={onJoin} className="gap-2 rounded-full bg-[#053877] px-5 text-white hover:bg-[#0a4a99]" data-testid="pod-unlock"><Lock className="h-4 w-4" /> Create a free account to see them all</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {search.hasNextPage && (
          <div className="mt-6 flex flex-col items-center gap-1">
            <Button variant="outline" className="h-11 gap-2 rounded-full px-6" onClick={() => (isMember ? void search.fetchNextPage() : onJoin())} disabled={search.isFetchingNextPage} data-testid="pod-more">
              {search.isFetchingNextPage ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Load more
            </Button>
            <span className="text-xs text-muted-foreground">Showing {rows.length} of {first!.total.toLocaleString()}</span>
          </div>
        )}
        {first && <p className="mt-4 text-center text-[11px] text-muted-foreground">Podcast data from Podchaser.</p>}
      </section>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

const SOCIAL_NAME: Record<string, string> = { twitter: "X", facebook: "Facebook", instagram: "Instagram", youtube: "YouTube", linkedin: "LinkedIn", tiktok: "TikTok", patreon: "Patreon", twitch: "Twitch", wikipedia: "Wikipedia" };
function LinkChip({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium hover:border-[#053877]/40 hover:text-[#053877]">{children}<ExternalLink className="h-3 w-3 opacity-60" /></a>;
}

/** A show or a person, opened: what we know, who's on it, how to reach them. */
export function PodcastDrawer({ open, from, onGo, onClose, isMember, onJoin, saved, onSave, reveals, onRevealed }: {
  open: PodOpen | null; from: PodOpen[]; onGo: (o: PodOpen) => void; onClose: () => void;
  isMember: boolean; onJoin: () => void; saved: Set<string>; onSave: (card: ReturnType<typeof podCard>) => void;
  /** Contact look-ups left this month (Find their email uses one). */
  reveals?: { used: number; allowance: number } | null; onRevealed?: () => void;
}) {
  const { toast } = useToast();
  const scroller = useRef<HTMLDivElement>(null);
  const id = open ? (open.kind === "show" ? open.id : open.pcid) : "";
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [id]);
  const q = useQuery<PodShowFull | PodPersonFull>({
    queryKey: ["/api/discover/podcasts", open?.kind, id],
    enabled: !!open && isMember,
    queryFn: async () => {
      const res = await fetch(open!.kind === "show" ? `/api/discover/podcasts/show?id=${encodeURIComponent(id)}` : `/api/discover/podcasts/person?pcid=${encodeURIComponent(id)}`, { credentials: "include" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      return j;
    },
    staleTime: 60 * 60_000,
    retry: false,
  });
  const at = open ? from.findIndex((o) => o.kind === open.kind && (o.kind === "show" ? o.id : o.pcid) === id) : -1;
  const go = (d: number) => { const n = from[at + d]; if (n) onGo(n); };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast({ title: "Copied", description: text }); } catch { toast({ title: text }); } };

  const full = q.data;
  const show = open?.kind === "show" ? ({ ...(open.seed ?? {}), ...(full ?? {}) } as Partial<PodShowFull>) : null;
  const person = open?.kind === "person" ? ({ ...(open.seed ?? {}), ...(full ?? {}) } as Partial<PodPersonFull>) : null;
  const saveKey = open ? (open.kind === "show" ? `podcast:${id}` : `podperson:${id}`) : "";
  const canSave = isMember && (show?.title || person?.name);

  return (
    <Sheet open={!!open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent ref={scroller} side="right" className="w-full overflow-y-auto bg-background p-0 sm:max-w-2xl [&>button.absolute]:hidden" data-testid="pod-drawer">
        {open && (
          <>
            <SheetTitle className="sr-only">{show?.title ?? person?.name ?? "Podcast"}</SheetTitle>
            <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur sm:px-6">
              {from.length > 1 && at >= 0 && (
                <div className="flex items-center gap-1.5 text-sm">
                  <button type="button" onClick={() => go(-1)} disabled={at <= 0} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-40" aria-label="Previous"><ChevronRight className="h-4 w-4 rotate-180" /></button>
                  <span className="min-w-[4.5rem] text-center tabular-nums text-muted-foreground"><span className="font-medium text-foreground">{at + 1}</span> of {from.length}</span>
                  <button type="button" onClick={() => go(1)} disabled={at >= from.length - 1} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-40" aria-label="Next"><ChevronRight className="h-4 w-4" /></button>
                </div>
              )}
              <div className="ml-auto flex items-center gap-2">
                {canSave && (
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-lg" onClick={() => onSave(podCard((show ? { kind: "show", ...show } : { kind: "person", ...person }) as PodItem))} data-testid="pod-drawer-save">
                    {saved.has(saveKey) ? <BookmarkCheck className="h-4 w-4 text-[#053877]" /> : <Bookmark className="h-4 w-4" />} {saved.has(saveKey) ? "Saved" : "Save"}
                  </Button>
                )}
                <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close"><X className="h-4 w-4" /></button>
              </div>
            </div>

            <div className="space-y-6 px-4 py-6 sm:px-6">
              {/* Who or what */}
              <div className="flex items-start gap-4">
                <Art src={(show?.image ?? person?.image) || ""} name={(show?.title ?? person?.name) || ""} round={!!person} size={96} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-balance text-2xl font-semibold leading-tight tracking-tight">{show?.title ?? person?.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{show ? show.host || (show.categories ?? []).join(" · ") : person?.subtitle}</p>
                  {person?.location && <p className="mt-1 inline-flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="h-3.5 w-3.5" />{person.location}</p>}
                  {show && !!show.categories?.length && <div className="mt-2 flex flex-wrap gap-1.5">{show.categories.map((c) => <span key={c} className="rounded-full bg-muted px-2.5 py-0.5 text-xs">{c}</span>)}</div>}
                </div>
              </div>

              {!isMember ? (
                <div className="rounded-2xl border border-[#053877]/20 bg-[#053877]/[0.04] p-5 text-center">
                  <p className="font-semibold">See the whole profile</p>
                  <p className="mt-1 text-sm text-muted-foreground">{show ? "Who hosts it, who's been on, how to reach them, and how big it is." : "The shows they host, where they've been a guest, and how to reach them."}</p>
                  <Button onClick={onJoin} className="mt-3 gap-2 rounded-full bg-[#053877] px-5 text-white hover:bg-[#0a4a99]">Create a free account</Button>
                </div>
              ) : q.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Reading the full profile…</div>
              ) : q.isError ? (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{(q.error as Error).message}</div>
              ) : null}

              {/* The numbers */}
              {show && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {show.audience != null ? <Stat label="Listeners" value={compact(show.audience)} sub={show.audienceRange ? `${compact(show.audienceRange.from)}–${compact(show.audienceRange.to)} an episode` : "an episode"} /> : null}
                  {show.powerScore != null ? <Stat label="Power Score" value={String(Math.round(show.powerScore))} sub="Podchaser's reach score" /> : null}
                  <Stat label="Episodes" value={show.episodes != null ? show.episodes.toLocaleString() : "–"} sub={show.since ? `since ${new Date(show.since).getFullYear()}` : undefined} />
                  <Stat label="Last episode" value={show.latest ? ago(show.latest) : "–"} sub={show.status === "complete" ? "show has ended" : show.latest && quiet(show.latest) ? "gone quiet" : show.everyDays ? `every ${Math.round(show.everyDays)} ${Math.round(show.everyDays) === 1 ? "day" : "days"}` : undefined} />
                  {show.rating != null && show.ratings ? <Stat label="Rating" value={`${show.rating.toFixed(1)} ★`} sub={`${show.ratings.toLocaleString()} ratings`} /> : null}
                  {show.hasGuests != null ? <Stat label="Guests" value={show.hasGuests ? "Yes" : "No"} sub={show.hasGuests ? "takes guests" : "host only"} /> : null}
                </div>
              )}
              {person && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label="Episodes" value={person.appearances != null ? person.appearances.toLocaleString() : "–"} sub="hosted or a guest on" />
                  {person.shows?.length ? <Stat label="Shows" value={String(person.shows.length)} sub="they're credited on" /> : null}
                </div>
              )}

              {/* Book them: invite to your show, find their email, keep them in Guests. */}
              {person && isMember && full && <GuestActions key={id} person={person as PodPersonFull} saved={saved.has(saveKey)} onSave={() => onSave(podCard({ kind: "person", ...person } as PodItem))} reveals={reveals ?? null} onRevealed={onRevealed} />}

              {/* About */}
              {(show?.about || person?.bio) && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">About</h3>
                  <p className="whitespace-pre-line text-sm leading-relaxed">{show?.about || person?.bio}</p>
                </section>
              )}

              {/* How to reach them */}
              {isMember && full && (show ? (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Reach them</h3>
                  {show.email || show.contacts?.length ? (
                    <ul className="space-y-2">
                      {show.email && <li className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm"><Mail className="h-4 w-4 shrink-0 text-[#053877]" /><a href={`mailto:${show.email}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{show.email}</a><span className="text-xs text-muted-foreground">from the feed</span><button type="button" onClick={() => void copy(show.email!)} className="rounded-md p-1 text-muted-foreground hover:text-foreground" aria-label="Copy"><Copy className="h-3.5 w-3.5" /></button></li>}
                      {(show.contacts ?? []).map((c, i) => (
                        <li key={i} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                          {c.email ? <Mail className="h-4 w-4 shrink-0 text-[#053877]" /> : <Globe className="h-4 w-4 shrink-0 text-[#053877]" />}
                          {c.email ? <a href={`mailto:${c.email}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{c.email}</a> : <a href={c.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-medium hover:underline">{c.url.replace(/^https?:\/\/(www\.)?/, "")}</a>}
                          <span className="truncate text-xs text-muted-foreground">{[c.name, c.type].filter(Boolean).join(" · ")}</span>
                          <button type="button" onClick={() => void copy(c.email || c.url)} className="rounded-md p-1 text-muted-foreground hover:text-foreground" aria-label="Copy"><Copy className="h-3.5 w-3.5" /></button>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-muted-foreground">No email listed for this show. Try its website or socials below.</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {show.site && <LinkChip href={show.site}><Globe className="h-3.5 w-3.5" /> Website</LinkChip>}
                    {show.apple && <LinkChip href={show.apple}>Apple Podcasts</LinkChip>}
                    {show.spotify && <LinkChip href={show.spotify}>Spotify</LinkChip>}
                    {(show.socials ?? []).map((s) => <LinkChip key={s.platform} href={s.url}>{SOCIAL_NAME[s.platform] ?? s.platform}</LinkChip>)}
                    {show.rss && <LinkChip href={show.rss}><Rss className="h-3.5 w-3.5" /> RSS</LinkChip>}
                    {show.web && <LinkChip href={show.web}>Podchaser</LinkChip>}
                  </div>
                </section>
              ) : (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Reach them</h3>
                  <div className="flex flex-wrap gap-2">
                    {(person?.socials ?? []).map((s) => <LinkChip key={s.platform} href={s.url}>{SOCIAL_NAME[s.platform] ?? s.platform}</LinkChip>)}
                    {person?.web && <LinkChip href={person.web}>Podchaser</LinkChip>}
                  </div>
                  {!person?.socials?.length && <p className="mt-2 text-sm text-muted-foreground">Their shows below list how to reach them.</p>}
                </section>
              ))}

              {/* Who's on it */}
              {show && !!show.people?.length && (
                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"><Users className="h-3.5 w-3.5" /> Hosts and guests</h3>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {show.people.map((p) => (
                      <li key={`${p.pcid}-${p.role}`}>
                        <button type="button" onClick={() => onGo({ kind: "person", pcid: p.pcid, seed: { name: p.name, image: p.image } })} className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2 text-left hover:border-[#053877]/40" data-testid="pod-person">
                          <Art src={p.image} name={p.name} round size={36} />
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{p.name}</span><span className="block truncate text-xs text-muted-foreground">{p.role}{p.episodes ? ` · ${p.episodes} ${p.episodes === 1 ? "episode" : "episodes"}` : ""}</span></span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {show && full && (full as PodShowFull).locked?.includes("credits") && <p className="text-xs text-muted-foreground">Hosts and guests for a show aren't on our Podchaser plan yet. Search Hosts & guests to find people.</p>}

              {/* Their shows and their guest spots */}
              {person && !!person.shows?.length && (
                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"><Mic2 className="h-3.5 w-3.5" /> Shows</h3>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {person.shows.map((s) => (
                      <li key={`${s.id}-${s.role}`}>
                        <button type="button" onClick={() => onGo({ kind: "show", id: s.id, seed: { title: s.title, image: s.image } })} className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2 text-left hover:border-[#053877]/40" data-testid="pod-show">
                          <Art src={s.image} name={s.title} size={40} />
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{s.title}</span><span className="block truncate text-xs text-muted-foreground">{s.role}{s.episodes ? ` · ${s.episodes} ${s.episodes === 1 ? "episode" : "episodes"}` : ""}</span></span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {person && !!person.recent?.length && (
                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" /> Episodes they're on</h3>
                  <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                    {person.recent.map((e, i) => (
                      <li key={i}>
                        <button type="button" onClick={() => e.showId && onGo({ kind: "show", id: e.showId, seed: { title: e.show, image: e.image } })} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50">
                          <Art src={e.image} name={e.show} size={36} />
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{e.title}</span><span className="block truncate text-xs text-muted-foreground">{e.show}{e.role ? ` · ${e.role}` : ""}{e.date ? ` · ${ago(e.date)}` : ""}</span></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <p className="pt-2 text-[11px] text-muted-foreground">Podcast data from Podchaser, refreshed monthly.</p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Booking a guest from their profile: find their email (by their X account, one of the month's
 * contact look-ups), invite them onto your live slot (they get their own link into the green room),
 * or keep them in your Guests list for later.
 */
function GuestActions({ person, saved, onSave, reveals, onRevealed }: { person: PodPersonFull; saved: boolean; onSave: () => void; reveals: { used: number; allowance: number } | null; onRevealed?: () => void }) {
  const { toast } = useToast();
  const x = (person.socials ?? []).find((s) => s.platform === "twitter")?.url ?? "";
  const handle = (x.match(/(?:twitter|x)\.com\/(?!intent|share|home)@?([A-Za-z0-9_]{1,15})/i) ?? [])[1] ?? "";
  const [contact, setContact] = useState<{ email: string | null; website: string | null } | null>(null);
  const [finding, setFinding] = useState(false);
  const find = async () => {
    setFinding(true);
    try {
      const res = await fetch("/api/discover/reveal", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "twitter", handle }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message);
      setContact({ email: j.email ?? null, website: j.website ?? null });
      onRevealed?.();
      if (!j.email) toast({ title: "No public email for them", description: j.website ? "Their website is below: most have a contact page." : "Try their X account or one of their shows." });
    } catch (e) { toast({ title: "Couldn't look them up", description: (e as Error).message, variant: "destructive" }); } finally { setFinding(false); }
  };
  // Their live slots here, to invite them onto.
  const [inviting, setInviting] = useState(false);
  const dash = useQuery<{ mySignups: { id: number; podcastName: string; slotIndex: number | null; status: string }[] }>({ queryKey: ["/api/host/dashboard"], queryFn: async () => { const r = await fetch("/api/host/dashboard", { credentials: "include" }); if (!r.ok) throw new Error("no"); return r.json(); }, enabled: inviting, retry: false, staleTime: 60_000 });
  const slots = (dash.data?.mySignups ?? []).filter((s) => s.status !== "cancelled");
  const [added, setAdded] = useState<{ id: number; signupId: number } | null>(null);
  const invite = async (signupId: number) => {
    try {
      const r = await fetch("/api/host/guests", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ signupId, name: person.name, title: (person.subtitle ?? "").replace(/^Guest on .*/i, "").slice(0, 120), email: contact?.email ?? "", intro: (person.bio ?? "").slice(0, 1200) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message);
      setAdded({ id: j.guest.id, signupId });
      setInviting(false);
      toast({ title: `${person.name} is on your guest list`, description: contact?.email ? "Send their link below, or from your dashboard." : "Add their email on your dashboard to send their link." });
    } catch (e) { toast({ title: "Couldn't add them", description: (e as Error).message, variant: "destructive" }); }
  };
  const [sending, setSending] = useState(false);
  const sendLink = async () => {
    if (!added) return;
    setSending(true);
    try {
      const r = await fetch(`/api/host/guests/${added.id}/invite`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Not sent");
      toast({ title: "Invite sent", description: `${person.name} has their link into your green room.` });
    } catch (e) { toast({ title: "Not sent", description: (e as Error).message, variant: "destructive" }); } finally { setSending(false); }
  };
  const left = reveals ? Math.max(0, reveals.allowance - reveals.used) : null;
  return (
    <section className="space-y-3 rounded-2xl border border-[#053877]/20 bg-[#053877]/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.03]" data-testid="pod-guest-actions">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Book them</h3>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setInviting((v) => !v)} className="h-9 gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="pod-invite"><Mic2 className="h-4 w-4" /> Invite to my show</Button>
        <Button variant="outline" onClick={() => void find()} disabled={!handle || finding || !!contact} title={handle ? undefined : "No X account on file for them"} className="h-9 gap-1.5 rounded-full" data-testid="pod-find-email">{finding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Find their email</Button>
        <Button variant="outline" onClick={onSave} disabled={saved} className="h-9 gap-1.5 rounded-full" data-testid="pod-save-guest">{saved ? <BookmarkCheck className="h-4 w-4 text-[#053877]" /> : <Bookmark className="h-4 w-4" />} {saved ? "In Guests" : "Save to Guests"}</Button>
      </div>
      {!contact && <p className="text-xs text-muted-foreground">{handle ? `Find their email looks them up by their X account (@${handle})${left != null ? `: ${left} of ${reveals!.allowance} look-ups left this month` : ""}.` : "No X account on file, so their email can't be looked up here. Their shows below list how to reach them."}</p>}
      {contact && (
        <div className="space-y-1 rounded-xl bg-background p-3 text-sm">
          {contact.email ? <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-[#053877]" /><a href={`mailto:${contact.email}`} className="font-medium hover:underline">{contact.email}</a><button type="button" onClick={() => void navigator.clipboard.writeText(contact.email!).then(() => toast({ title: "Copied" }))} className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Copy"><Copy className="h-3.5 w-3.5" /></button></p> : <p className="text-muted-foreground">No public email.</p>}
          {contact.website && <p className="flex items-center gap-2"><Globe className="h-4 w-4 text-[#053877]" /><a href={contact.website} target="_blank" rel="noreferrer" className="truncate hover:underline">{contact.website.replace(/^https?:\/\/(www\.)?/, "")}</a></p>}
        </div>
      )}
      {inviting && (
        <div className="rounded-xl bg-background p-3 text-sm" data-testid="pod-invite-pick">
          {dash.isLoading ? <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Your live slots…</p>
            : slots.length ? (
              <>
                <p className="mb-2 font-medium">Invite {person.name} onto:</p>
                <div className="flex flex-wrap gap-2">{slots.map((sl) => <Button key={sl.id} variant="outline" size="sm" onClick={() => void invite(sl.id)} className="h-8 rounded-full">{sl.podcastName || "Your live slot"}</Button>)}</div>
                <p className="mt-2 text-xs text-muted-foreground">They get their own link into your green room: nothing to sign up for.</p>
              </>
            ) : <p className="text-muted-foreground">You don't have a live slot yet. <a href="/host/dashboard/events" className="font-semibold text-[#053877] underline dark:text-[#8fb5e8]">Book one</a>, then invite {person.name} onto it. Meanwhile, Save to Guests keeps them for later.</p>}
        </div>
      )}
      {added && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-emerald-500/[0.07] p-3 text-sm">
          <Check className="h-4 w-4 text-emerald-600" /> <span className="min-w-0 flex-1">On your guest list.</span>
          {contact?.email && <Button size="sm" onClick={() => void sendLink()} disabled={sending} className="h-8 gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="pod-send-invite">{sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />} Email them their link</Button>}
          <a href="/host/dashboard#your-guests" className="text-xs font-semibold text-[#053877] underline dark:text-[#8fb5e8]">Your guests</a>
        </div>
      )}
    </section>
  );
}
