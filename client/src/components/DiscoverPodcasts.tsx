// Podcasts in Discovery: shows to pitch or be a guest on, and the people who
// host them or have been on them (Podchaser's index, through our cache).
import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, CalendarDays, Check, ChevronRight, Copy, ExternalLink, Globe, Loader2, Lock, Mail, MapPin, Mic2, Rss, Search, Sparkles, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
          {(first as { source?: string } | undefined)?.source === "listennotes" && (
            <a href="https://www.listennotes.com" target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground" data-testid="powered-by-listennotes">Powered by Listen Notes</a>
          )}
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
export function PodcastDrawer({ open, from, onGo, onClose, isMember, onJoin, saved, onSave, reveals, onRevealed, pitch = false }: {
  open: PodOpen | null; from: PodOpen[]; onGo: (o: PodOpen) => void; onClose: () => void;
  isMember: boolean; onJoin: () => void; saved: Set<string>; onSave: (card: ReturnType<typeof podCard>) => void;
  /** Contact look-ups left this month (Find their email uses one). */
  reveals?: { used: number; allowance: number } | null; onRevealed?: () => void;
  /** Be a guest: a show opens with a pitch to write and send to its host. */
  pitch?: boolean;
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
              {/* A Listen Notes show: its latest episodes, and the credit their terms ask for. */}
              {show && Array.isArray((show as { recent?: unknown[] }).recent) && ((show as { recent: unknown[] }).recent.length > 0) && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Latest episodes</h3>
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {((show as unknown as { recent: { title: string; date: string; web: string; minutes: number | null }[] }).recent).map((e) => (
                      <li key={e.web || e.title} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <a href={e.web || undefined} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium hover:underline">{e.title}</a>
                        <span className="shrink-0 text-xs text-muted-foreground">{e.date ? ago(e.date) : ""}{e.minutes ? ` · ${e.minutes} min` : ""}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {show && id.startsWith("ln:") && (
                <a href={show.web || "https://www.listennotes.com"} target="_blank" rel="noreferrer" className="inline-block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">Powered by Listen Notes</a>
              )}
              {person && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label="Episodes" value={person.appearances != null ? person.appearances.toLocaleString() : "–"} sub="hosted or a guest on" />
                  {person.shows?.length ? <Stat label="Shows" value={String(person.shows.length)} sub="they're credited on" /> : null}
                </div>
              )}

              {/* Be a guest: a pitch to this show's host, written for them, sent from their own email. */}
              {show && pitch && isMember && full && <PitchBox key={id} show={show as PodShowFull} />}

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
      void me.refetch();
      if (j.byCredit) toast({ title: "1 credit used", description: `${j.credits} left.` });
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
  // Past the month's reveals, a contact is a credit: how many they have.
  const me = useQuery<{ credits?: number; discoveryPro?: boolean }>({ queryKey: ["/api/discover/me"], queryFn: async () => (await fetch("/api/discover/me", { credentials: "include" })).json(), staleTime: 30_000 });
  const credits = me.data?.credits ?? 0;
  const outOfAll = left === 0 && credits < 1;
  return (
    <section className="space-y-3 rounded-2xl border border-[#053877]/20 bg-[#053877]/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.03]" data-testid="pod-guest-actions">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Book them</h3>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setInviting((v) => !v)} className="h-9 gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="pod-invite"><Mic2 className="h-4 w-4" /> Invite to my show</Button>
        <Button variant="outline" onClick={() => void find()} disabled={!handle || finding || !!contact || outOfAll} title={handle ? undefined : "No X account on file for them"} className="h-9 gap-1.5 rounded-full" data-testid="pod-find-email">{finding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Find their email</Button>
        <Button variant="outline" onClick={onSave} disabled={saved} className="h-9 gap-1.5 rounded-full" data-testid="pod-save-guest">{saved ? <BookmarkCheck className="h-4 w-4 text-[#053877]" /> : <Bookmark className="h-4 w-4" />} {saved ? "In Guests" : "Save to Guests"}</Button>
      </div>
      {!contact && (
        <p className="text-xs text-muted-foreground">
          {!handle ? "No X account on file, so their email can't be looked up here. Their shows below list how to reach them."
            : left == null ? `Find their email looks them up by their X account (@${handle}).`
            : left > 0 ? <>Find their email looks them up by their X account (@{handle}). It uses one of your contact reveals: <b className="text-foreground">{left} of {reveals!.allowance}</b> left this month{me.data?.discoveryPro ? "" : " (Discovery Pro: 100 a month)"}.</>
            : credits >= 1 ? <>This month's contact reveals are used, so this one is <b className="text-foreground">1 credit</b> (you have {credits}).</>
            : <>This month's contact reveals are used. <a href="/pricing#discovery" className="font-semibold text-[#053877] underline dark:text-[#8fb5e8]">Discovery Pro</a> gives 100 a month, or <a href="/host/dashboard/postify" className="font-semibold text-[#053877] underline dark:text-[#8fb5e8]">add credits</a> (1 a contact).</>}
        </p>
      )}
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

/**
 * Book a guest, on its own (the Podcast screen's tab): search people who've been guests on
 * podcasts, open one, then invite, find their email or save them. Uses Discovery underneath;
 * a podcaster who hasn't added Discovery gets it (free) with their first search.
 */
export function GuestFinder({ showTitle = "" }: { showTitle?: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const me = useQuery<{ signedIn?: boolean; member?: unknown; reveals?: { used: number; allowance: number } | null }>({ queryKey: ["/api/discover/me"], queryFn: async () => (await fetch("/api/discover/me", { credentials: "include" })).json() });
  const lists = useQuery<SavedList[]>({ queryKey: ["/api/discover/lists"], enabled: !!me.data?.member, queryFn: async () => (await fetch("/api/discover/lists", { credentials: "include" })).json() });
  const saved = useMemo(() => new Set((lists.data ?? []).flatMap((l) => l.items.map((i) => `${i.platform}:${i.handle}`))), [lists.data]);
  const guestList = lists.data?.find((l) => l.name === "Guests");
  const [view, setView] = useState<"search" | "saved">("search");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("appearances");
  const [ask, setAsk] = useState<PodAsk | null>(null);
  const [open, setOpen] = useState<PodOpen | null>(null);
  const [from, setFrom] = useState<PodOpen[]>([]);
  const [joining, setJoining] = useState(false);
  const run = async (words: string) => {
    // Discovery is free for podcasters: added the first time they search here.
    if (!me.data?.member) {
      setJoining(true);
      try {
        const r = await fetch("/api/discover/join", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "podcaster", source: "book-a-guest" }) });
        if (r.ok) await qc.invalidateQueries({ queryKey: ["/api/discover/me"] });
      } finally { setJoining(false); }
    }
    setQ(words);
    setAsk({ q: words.trim(), kind: "people", branch: "", sort, hasGuests: false, active: false });
  };
  useEffect(() => { if (ask) setAsk({ ...ask, sort }); }, [sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveGuest = async (card: ReturnType<typeof podCard>) => {
    try {
      let id = lists.data?.find((l) => l.name === "Guests")?.id;
      if (!id) id = (await (await fetch("/api/discover/lists", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Guests" }) })).json()).id;
      const r = await fetch(`/api/discover/lists/${id}/items`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ card }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { message?: string }).message || "Not saved");
      void qc.invalidateQueries({ queryKey: ["/api/discover/lists"] });
      toast({ title: `${card.name} saved to Guests`, description: "Your Guests list is in Discovery, under Saved." });
    } catch (e) { toast({ title: "Couldn't save that", description: (e as Error).message, variant: "destructive" }); }
  };
  const tries = ["Veteran authors", "Special operations", "Military historians", "Medal of Honor", showTitle && showTitle.split(/\s+/).slice(0, 3).join(" ")].filter(Boolean) as string[];
  return (
    <div className="space-y-4" data-testid="book-a-guest">
      <ViewSwitch view={view} setView={setView} saved={guestList?.items.filter((i) => i.platform === "podperson").length ?? 0} label="Saved guests" />
      {view === "saved" ? <SavedPanel list={guestList} kind="person" onOpen={(o, f) => { setFrom(f); setOpen(o); }} onRemoved={() => void qc.invalidateQueries({ queryKey: ["/api/discover/lists"] })} /> : <>
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Find a guest</h2>
        <p className="text-xs text-muted-foreground">People who've been guests on podcasts, the most-booked first. Open one to invite them onto your show, find their email, or save them for later.</p>
        <form onSubmit={(e) => { e.preventDefault(); void run(q); }} className="mt-3 flex flex-wrap gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="A topic they're known for, or a name…" className="h-11 min-w-0 flex-1" data-testid="guest-q" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-11 rounded-md border border-input bg-background px-3 text-sm" aria-label="Sort">
            {POD_PEOPLE_SORTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <Button type="submit" disabled={joining} className="h-11 gap-2 rounded-lg bg-[#053877] px-5 text-white hover:bg-[#0a4a99]" data-testid="guest-go">{joining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search</Button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Try</span>
          {tries.map((t) => <button key={t} type="button" onClick={() => void run(t)} className="rounded-full bg-[#2563eb] px-3 py-1 text-xs font-medium text-white hover:bg-[#1d4ed8]">{t}</button>)}
        </div>
      </div>
      {ask && <PodcastResults ask={ask} isMember={!!me.data?.member} onJoin={() => void run(q)} onOpen={(o, f) => { setFrom(f); setOpen(o); }} saved={saved} onSave={(card) => void saveGuest(card)} />}
      </>}
      <PodcastDrawer open={open} from={from} onGo={setOpen} onClose={() => setOpen(null)} isMember={!!me.data?.member} onJoin={() => void run(q)} saved={saved} onSave={(card) => void saveGuest(card)} reveals={me.data?.reveals ?? null} onRevealed={() => void qc.invalidateQueries({ queryKey: ["/api/discover/me"] })} />
    </div>
  );
}

/** A pitch to a show's host: written from their SmartLink and podcast, theirs to edit, sent from their own email. */
function PitchBox({ show }: { show: PodShowFull }) {
  const { toast } = useToast();
  const to = show.email || show.contacts?.find((c) => c.email)?.email || "";
  const [angle, setAngle] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const write = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/host/pitch", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ show: { title: show.title, about: show.about, host: show.host }, angle }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message);
      setSubject(j.subject); setBody(j.body);
    } catch (e) { toast({ title: "No pitch this time", description: (e as Error).message, variant: "destructive" }); } finally { setBusy(false); }
  };
  const copy = async () => { await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`).catch(() => {}); toast({ title: "Pitch copied" }); };
  return (
    <section className="space-y-3 rounded-2xl border border-[#F0A71F]/40 bg-[#F0A71F]/[0.05] p-4" data-testid="pod-pitch">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8a5a00] dark:text-[#F0A71F]">Pitch yourself</h3>
      {!body ? (
        <>
          <Input value={angle} onChange={(e) => setAngle(e.target.value)} maxLength={300} placeholder="What would you talk about? (optional: leave it and we'll suggest)" className="h-10 bg-background" data-testid="pod-pitch-angle" />
          <Button onClick={() => void write()} disabled={busy} className="h-10 gap-2 rounded-full bg-[#F0A71F] font-semibold text-[#1a1200] hover:bg-[#f5b94a]" data-testid="pod-pitch-write">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Write my pitch</Button>
          <p className="text-xs text-muted-foreground">Written from your SmartLink and your show, for {show.title}. You read it and send it yourself.</p>
        </>
      ) : (
        <>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="h-10 bg-background font-semibold" aria-label="Subject" />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="bg-background text-sm leading-relaxed" aria-label="Your pitch" data-testid="pod-pitch-body" />
          <div className="flex flex-wrap items-center gap-2">
            {to ? <Button asChild className="h-9 gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]"><a href={`mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`} data-testid="pod-pitch-send"><Mail className="h-4 w-4" /> Open in my email</a></Button> : null}
            <Button variant="outline" onClick={() => void copy()} className="h-9 gap-1.5 rounded-full"><Copy className="h-4 w-4" /> Copy</Button>
            <button type="button" onClick={() => void write()} disabled={busy} className="text-xs font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground">{busy ? "Writing…" : "Write another"}</button>
          </div>
          <p className="text-xs text-muted-foreground">{to ? `It goes to ${to}, from your own email.` : "No email for this show: paste it into their website's contact form, or send it to them on social."}</p>
        </>
      )}
    </section>
  );
}

/**
 * Be a guest (the Podcast screen's tab): shows that take guests and are putting out episodes,
 * by topic. Open one to see its host and how to reach them, and write a pitch to send.
 */
export function ShowFinder({ topics = [] }: { topics?: string[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const me = useQuery<{ member?: unknown }>({ queryKey: ["/api/discover/me"], queryFn: async () => (await fetch("/api/discover/me", { credentials: "include" })).json() });
  const lists = useQuery<SavedList[]>({ queryKey: ["/api/discover/lists"], enabled: !!me.data?.member, queryFn: async () => (await fetch("/api/discover/lists", { credentials: "include" })).json() });
  const saved = useMemo(() => new Set((lists.data ?? []).flatMap((l) => l.items.map((i) => `${i.platform}:${i.handle}`))), [lists.data]);
  const pitchList = lists.data?.find((l) => l.name === "Shows to pitch");
  const [view, setView] = useState<"search" | "saved">("search");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("best");
  const [ask, setAsk] = useState<PodAsk | null>(null);
  const [open, setOpen] = useState<PodOpen | null>(null);
  const [from, setFrom] = useState<PodOpen[]>([]);
  const [joining, setJoining] = useState(false);
  const run = async (words: string) => {
    if (!me.data?.member) {
      setJoining(true);
      try {
        const r = await fetch("/api/discover/join", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "podcaster", source: "be-a-guest" }) });
        if (r.ok) await qc.invalidateQueries({ queryKey: ["/api/discover/me"] });
      } finally { setJoining(false); }
    }
    setQ(words);
    setAsk({ q: words.trim(), kind: "shows", branch: "", sort, hasGuests: true, active: true });
  };
  useEffect(() => { if (ask) setAsk({ ...ask, sort }); }, [sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveShow = async (card: ReturnType<typeof podCard>) => {
    try {
      let id = lists.data?.find((l) => l.name === "Shows to pitch")?.id;
      if (!id) id = (await (await fetch("/api/discover/lists", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Shows to pitch" }) })).json()).id;
      const r = await fetch(`/api/discover/lists/${id}/items`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ card }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { message?: string }).message || "Not saved");
      void qc.invalidateQueries({ queryKey: ["/api/discover/lists"] });
      toast({ title: `${card.name} saved to Shows to pitch` });
    } catch (e) { toast({ title: "Couldn't save that", description: (e as Error).message, variant: "destructive" }); }
  };
  const tries = [...topics, "Leadership", "Transition", "Entrepreneurs", "Mental health", "Fitness"].filter((t, i, a) => t && a.indexOf(t) === i).slice(0, 6);
  return (
    <div className="space-y-4" data-testid="be-a-guest">
      <ViewSwitch view={view} setView={setView} saved={pitchList?.items.filter((i) => i.platform === "podcast").length ?? 0} label="Saved shows" />
      {view === "saved" ? <SavedPanel list={pitchList} kind="show" onOpen={(o, f) => { setFrom(f); setOpen(o); }} onRemoved={() => void qc.invalidateQueries({ queryKey: ["/api/discover/lists"] })} /> : <>
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Find shows to be a guest on</h2>
        <p className="text-xs text-muted-foreground">Podcasts that have guests and put out an episode in the last 90 days. Open one to see its host and how to reach them, then write your pitch.</p>
        <form onSubmit={(e) => { e.preventDefault(); void run(q); }} className="mt-3 flex flex-wrap gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="What you'd talk about: leadership, transition, faith…" className="h-11 min-w-0 flex-1" data-testid="show-q" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-11 rounded-md border border-input bg-background px-3 text-sm" aria-label="Sort">
            {POD_SHOW_SORTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <Button type="submit" disabled={joining} className="h-11 gap-2 rounded-lg bg-[#053877] px-5 text-white hover:bg-[#0a4a99]" data-testid="show-go">{joining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search</Button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Try</span>
          {tries.map((t) => <button key={t} type="button" onClick={() => void run(t)} className="rounded-full bg-[#2563eb] px-3 py-1 text-xs font-medium text-white hover:bg-[#1d4ed8]">{t}</button>)}
        </div>
      </div>
      {ask && <PodcastResults ask={ask} isMember={!!me.data?.member} onJoin={() => void run(q)} onOpen={(o, f) => { setFrom(f); setOpen(o); }} saved={saved} onSave={(card) => void saveShow(card)} />}
      </>}
      <PodcastDrawer open={open} from={from} onGo={setOpen} onClose={() => setOpen(null)} isMember={!!me.data?.member} onJoin={() => void run(q)} saved={saved} onSave={(card) => void saveShow(card)} pitch />
    </div>
  );
}

type SavedList = { id: number; name: string; items: { id: number; platform: string; handle: string; snapshot: { name?: string; picture?: string; category?: string; followers?: number | null } }[] };

/** A saved list (Guests, or Shows to pitch): open one, or take it off. */
function SavedPanel({ list, kind, onOpen, onRemoved }: { list: SavedList | undefined; kind: "person" | "show"; onOpen: (o: PodOpen, from: PodOpen[]) => void; onRemoved: () => void }) {
  const { toast } = useToast();
  const items = (list?.items ?? []).filter((i) => i.platform === (kind === "person" ? "podperson" : "podcast"));
  const opens: PodOpen[] = items.map((i) => (kind === "person" ? { kind: "person", pcid: i.handle, seed: { name: i.snapshot.name, image: i.snapshot.picture } } : { kind: "show", id: i.handle, seed: { title: i.snapshot.name, image: i.snapshot.picture } }));
  const remove = async (itemId: number) => {
    const r = await fetch(`/api/discover/lists/${list!.id}/items/${itemId}`, { method: "DELETE", credentials: "include" });
    if (r.ok) { onRemoved(); toast({ title: "Taken off the list" }); }
  };
  if (!items.length) return <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">{kind === "person" ? "No saved guests yet. Open someone and press Save to Guests." : "No saved shows yet. Open a show and press Save."}</div>;
  return (
    <ul className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="saved-list">
      {items.map((i, n) => (
        <li key={i.id} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0">
          <button type="button" onClick={() => onOpen(opens[n], opens)} className="flex min-w-0 flex-1 items-center gap-4 text-left">
            <Art src={i.snapshot.picture ?? ""} name={i.snapshot.name ?? ""} round={kind === "person"} />
            <span className="min-w-0 flex-1"><span className="block truncate font-semibold hover:underline">{i.snapshot.name || "Saved"}</span><span className="block truncate text-sm text-muted-foreground">{i.snapshot.category || (kind === "person" ? "Guest" : "Podcast")}</span></span>
          </button>
          <button type="button" onClick={() => void remove(i.id)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:border-destructive/40 hover:text-destructive" aria-label="Take off the list" title="Take off the list"><X className="h-4 w-4" /></button>
        </li>
      ))}
    </ul>
  );
}

/** Search, or what's saved: the two views at the top of Book a guest and Be a guest. */
function ViewSwitch({ view, setView, saved, label }: { view: "search" | "saved"; setView: (v: "search" | "saved") => void; saved: number; label: string }) {
  const seg = (on: boolean) => `rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${on ? "bg-[#053877] text-white" : "text-muted-foreground hover:text-foreground"}`;
  return (
    <div className="inline-flex gap-1 rounded-full border border-border bg-card p-1" role="tablist">
      <button type="button" role="tab" aria-selected={view === "search"} onClick={() => setView("search")} className={seg(view === "search")} data-testid="view-search">Search</button>
      <button type="button" role="tab" aria-selected={view === "saved"} onClick={() => setView("saved")} className={seg(view === "saved")} data-testid="view-saved">{label}{saved ? ` (${saved})` : ""}</button>
    </div>
  );
}
