import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Headphones, Link2, Loader2, RefreshCw, Trophy, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { apiRequest } from "@/lib/queryClient";
import type { PodcastStatsData } from "@shared/schema";

type Source = "militaryvoices" | "buzzsprout" | "podbean" | "transistor" | "spotify";
interface SourceView { source: Source; showName: string; status: string; error: string; fetchedAt: string; data: PodcastStatsData | null }
interface StatsResponse { sources: SourceView[]; benchmark: { unit: string; avg: number; percentile: number; peers: number }[] }

const KEY = ["/api/host/podcast-stats"];
const NAME: Record<Source, string> = { militaryvoices: "MilitaryVoices", buzzsprout: "Buzzsprout", podbean: "Podbean", transistor: "Transistor", spotify: "Spotify" };
/** Each host's real mark, saved in client/public/brands (not hotlinked). Podbean and Transistor have
 *  no row any more (20 Nov 2026), so they keep a plain letter if old numbers ever show. */
const MARK: Partial<Record<Source, string>> = {
  militaryvoices: "/icons/icon-192.png",
  buzzsprout: "/brands/buzzsprout.svg",
  spotify: "/brands/spotify.svg",
};
/** The same marks on the Podcast analytics tabs, which also show the apps we count for a hosted show. */
const TAB_MARK: Record<string, string> = { ...MARK, "app:apple": "/brands/apple-podcasts.svg", "app:spotify": "/brands/spotify.svg", yt: "/brands/youtube.svg" } as Record<string, string>;
const COLOR: Record<Source, string> = { militaryvoices: "#053877", buzzsprout: "#1B1B1B", podbean: "#7ACB2F", transistor: "#2C3E50", spotify: "#1DB954" };
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n)));
const when = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
const MONTH = 30 * 86400000;

export function usePodcastStats() {
  return useQuery<StatsResponse>({ queryKey: KEY, queryFn: async () => (await apiRequest("GET", "/api/host/podcast-stats")).json(), staleTime: 5 * 60_000 });
}

type HostingShowLite = { show: { id: number; title: string; artworkUrl?: string; directories?: string; appleUrl?: string; spotifyUrl?: string; importedFrom?: string; redirectOk?: boolean }; episodes?: { live?: boolean }[]; /** Apps that read the feed in the last 14 days. */ reading?: string[] };
function useHosting() {
  return useQuery<{ shows: HostingShowLite[] }>({ queryKey: ["/api/host/hosting"], queryFn: async () => (await apiRequest("GET", "/api/host/hosting")).json(), staleTime: 60_000 });
}

/**
 * Is their show hosted with us (20 Nov 2026)? A show here with a live episode,
 * and, when it moved from another host, the old feed already forwarding to ours.
 * Mid-move they still count as hosted elsewhere, so Integrations keeps Buzzsprout.
 */
export function useHostedHere(): { ready: boolean; hosted: boolean } {
  const q = useHosting();
  const hosted = (q.data?.shows ?? []).some((x) => (x.episodes ?? []).some((e) => e.live) && (!x.show.importedFrom || !!x.show.redirectOk));
  return { ready: !q.isLoading, hosted };
}

/** The Spotify for Creators CSV upload: one button, used in Integrations and, for hosted shows, in Podcast analytics. */
function SpotifyUpload({ has, stale, onOpenStats }: { has: boolean; stale?: boolean; onOpenStats?: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const see = onOpenStats ? <ToastAction altText="See your numbers in Podcast analytics" onClick={onOpenStats} data-testid="toast-see-numbers">See your numbers</ToastAction> : undefined;
  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      const list = await Promise.all(Array.from(files).map(async (f) => ({ name: f.name, text: await f.text() })));
      return (await apiRequest("POST", "/api/host/podcast-stats/spotify", { files: list })).json();
    },
    onSuccess: (r: SourceView & { read: string[]; skipped: string[] }) => {
      toast({ title: "Spotify numbers added", description: `Read ${r.read.length} file${r.read.length === 1 ? "" : "s"}${r.skipped.length ? `; couldn't use ${r.skipped.join(", ")}` : ""}.`, action: see });
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e: Error) => toast({ title: "Couldn't read those files", description: e.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
    onSettled: () => { if (file.current) file.current.value = ""; },
  });
  return (
    <>
      <input ref={file} type="file" accept=".csv,text/csv" multiple className="hidden" onChange={(e) => e.target.files?.length && upload.mutate(e.target.files)} data-testid="input-spotify-csv" />
      <Button variant={stale ? "default" : "outline"} size="sm" className="h-8 gap-1 rounded-full px-3.5 text-xs" disabled={upload.isPending} onClick={() => file.current?.click()} data-testid="button-spotify-upload">
        {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {has ? "Update" : "Upload CSVs"}
      </Button>
    </>
  );
}

/** A card's header: the show's artwork with the source's mark on its corner, like Buzzsprout's (Andrew, 21 Nov: "add icons to all"). */
function CardHead({ art, mark, title, sub, right }: { art?: string; mark: ReactNode; title: ReactNode; sub: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <span className="relative shrink-0">
        {art ? <img src={art} alt="" className="h-12 w-12 rounded-xl object-cover" /> : <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#053877] text-white"><Headphones className="h-6 w-6" /></span>}
        <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center overflow-hidden rounded-full bg-white ring-2 ring-card">{mark}</span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
      {right}
    </div>
  );
}
const markImg = (src: string) => <img src={src} alt="" className="h-full w-full object-contain p-px" />;
const ALL_MARK = <span className="flex h-full w-full items-center justify-center bg-[#053877] text-white"><Headphones className="h-3 w-3" /></span>;

function Badge({ source }: { source: Source }) {
  const mark = MARK[source];
  if (mark) {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white ring-1 ring-border" aria-hidden>
        <img src={mark} alt="" className="h-6 w-6 object-contain" />
      </span>
    );
  }
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-black text-white" style={{ background: COLOR[source] }} aria-hidden>
      {NAME[source][0]}
    </span>
  );
}

/**
 * Integrations → Podcast stats: connect Buzzsprout with the podcaster's
 * own key, or upload what Spotify for Creators exports.
 */
export function PodcastStatsRows({ Row, onOpenStats }: { Row: (p: { icon: ReactNode; name: string; line: ReactNode; right: ReactNode; children?: ReactNode; testId?: string }) => JSX.Element; /** Opens Podcast analytics: the success message carries it. */ onOpenStats?: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = usePodcastStats();
  const [open, setOpen] = useState<Source | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const done = () => { setForm({}); setOpen(null); void qc.invalidateQueries({ queryKey: KEY }); };
  // The same way to the numbers as the link under the section's intro.
  const see = onOpenStats ? <ToastAction altText="See your numbers in Podcast analytics" onClick={onOpenStats} data-testid="toast-see-numbers">See your numbers</ToastAction> : undefined;
  const connect = useMutation({
    mutationFn: async (source: "buzzsprout") => (await apiRequest("POST", `/api/host/podcast-stats/${source}`, form)).json(),
    onSuccess: (r: SourceView) => { toast({ title: `${NAME[r.source]} connected`, description: r.showName ? `${r.showName}: your numbers are in Podcast analytics.` : "Your numbers are in Podcast analytics.", action: see }); done(); },
    onError: (e: Error) => toast({ title: "Couldn't connect", description: e.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  const remove = async (source: Source) => {
    if (!window.confirm(`Disconnect ${NAME[source]}? Its numbers leave Podcast analytics.`)) return;
    await apiRequest("DELETE", `/api/host/podcast-stats/${source}`);
    void qc.invalidateQueries({ queryKey: KEY });
  };
  const row = (s: Source) => q.data?.sources.find((x) => x.source === s);
  const field = (k: string, label: string, secret = false) => (
    <label className="block text-xs font-semibold text-muted-foreground">
      {label}
      <Input type={secret ? "password" : "text"} autoComplete="off" value={form[k] ?? ""} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} className="mt-1 h-9 text-sm" data-testid={`input-${k}`} />
    </label>
  );
  const status = (r: SourceView | undefined) =>
    !r ? "Not connected"
    : r.status === "failed" ? <span className="text-destructive">{r.error}</span>
    : <><span className="font-medium text-foreground">{r.showName || "Connected"}</span>{r.data ? ` · ${compact(r.data.total)} ${r.data.unit}` : ""}{r.fetchedAt ? ` · updated ${when(r.fetchedAt)}` : ""}</>;
  const right = (s: "buzzsprout") => {
    const r = row(s);
    return r ? (
      <span className="flex items-center gap-1">
        <Connected />
        <button type="button" onClick={() => void remove(s)} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Disconnect ${NAME[s]}`}><X className="h-3.5 w-3.5" /></button>
      </span>
    ) : (
      <Button variant="outline" size="sm" className="h-8 gap-1 rounded-full px-3.5 text-xs" onClick={() => { setForm({}); setOpen(open === s ? null : s); }} aria-expanded={open === s} data-testid={`button-connect-${s}`}>
        Connect <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open === s ? "rotate-180" : ""}`} />
      </Button>
    );
  };
  const spotify = row("spotify");
  const spotifyStale = spotify && Date.now() - Date.parse(spotify.fetchedAt) > MONTH;
  return (
    <>
      <Row testId="row-buzzsprout" icon={<Badge source="buzzsprout" />} name="Buzzsprout" line={status(row("buzzsprout"))} right={right("buzzsprout")}>
        {open === "buzzsprout" && (
          <form onSubmit={(e) => { e.preventDefault(); connect.mutate("buzzsprout"); }} className="mt-4 grid gap-3 rounded-xl bg-muted/40 p-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
            {field("token", "API token", true)}
            {field("podcastId", "Podcast ID (optional)")}
            <Button type="submit" disabled={connect.isPending || !form.token} className="h-9 gap-1.5 rounded-full">{connect.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Connect</Button>
            <p className="text-xs text-muted-foreground sm:col-span-3">In Buzzsprout, open <span className="font-semibold text-foreground">Profile → API</span> and copy your API token. With more than one show, add the podcast's ID (the number in its Buzzsprout address). We read your download numbers only, and keep the token encrypted.</p>
          </form>
        )}
      </Row>
      {/* Transistor and Podbean rows came out on 20 Nov 2026: never used. Their endpoints in server/podcastStats.ts stay, to bring back. */}
      <Row
        testId="row-spotify"
        icon={<Badge source="spotify" />}
        name="Spotify"
        line={spotify ? <>{status(spotify)}{spotifyStale && <span className="font-semibold text-amber-700 dark:text-amber-400"> · time for this month's</span>}</> : "Upload what Spotify for Creators exports. About once a month."}
        right={
          <span className="flex items-center gap-1">
            <SpotifyUpload has={!!spotify} stale={!!spotifyStale} onOpenStats={onOpenStats} />
            {spotify && <button type="button" onClick={() => void remove("spotify")} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Remove Spotify numbers"><X className="h-3.5 w-3.5" /></button>}
          </span>
        }
      >
        {!spotify && (
          <p className="mt-2 pl-[3.4rem] text-xs text-muted-foreground">
            On <span className="font-semibold text-foreground">creators.spotify.com → Analytics</span>, press <span className="font-semibold text-foreground">Export</span> on Plays, on Episodes and on Audience (age, gender, location), then choose all the files here at once.
          </p>
        )}
      </Row>
    </>
  );
}

function Connected() {
  return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400"><Check className="h-3.5 w-3.5" /> Connected</span>;
}

/** A few bars, largest first: episodes, ages, countries. */
function Bars({ items, unit }: { items: [string, number][]; unit?: string }) {
  const max = Math.max(1, ...items.map(([, n]) => n));
  return (
    <ul className="space-y-1.5">
      {items.map(([k, n]) => (
        <li key={k} className="text-xs">
          <div className="flex justify-between gap-2"><span className="truncate text-foreground">{k}</span><span className="shrink-0 tabular-nums text-muted-foreground">{compact(n)}{unit ?? ""}</span></div>
          <div className="mt-0.5 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-[#053877] dark:bg-[#8ab4f8]" style={{ width: `${(n / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

const top = (m: Record<string, number> | undefined, n = 5): [string, number][] => Object.entries(m ?? {}).sort((a, b) => b[1] - a[1]).slice(0, n);

/** The connected podcast hosts with numbers, for the Dashboard. */
export function usePodcastSources() {
  const q = usePodcastStats();
  return (q.data?.sources ?? []).filter((s) => s.data);
}

/** A podcast host in the Dashboard's Connected accounts row: its mark, the show, and its downloads. */
export function PodcastChips({ onOpen, hostName }: { onOpen: () => void; /** The person it belongs to: the line under the show's name until it has listens to count. */ hostName?: string }) {
  const sources = usePodcastSources();
  return (
    <>
      {sources.map((s) => (
        <button key={s.source} type="button" onClick={onOpen} title={`${s.showName || NAME[s.source]}. Open your podcast`} className="group flex shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1.5 text-left transition-colors hover:border-primary/40 hover:shadow-sm sm:gap-2.5 sm:px-3 sm:py-2" data-testid={`chip-podcast-${s.source}`}>
          {/* The show's cover, with the host's mark riding it, as the social accounts have theirs. */}
          <span className="relative shrink-0">
            {s.data!.artwork ? (
              <img src={s.data!.artwork} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-black text-white" style={{ background: COLOR[s.source] }} aria-hidden>{(s.showName || NAME[s.source])[0]}</span>
            )}
            {MARK[s.source] && <img src={MARK[s.source]} alt="" className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-white object-contain p-px ring-2 ring-card" />}
          </span>
          <span className="min-w-0">
            <span className="hidden max-w-[9.5rem] truncate text-sm font-medium leading-tight text-foreground sm:block">{s.showName || NAME[s.source]}</span>
            <span className="block truncate text-xs font-semibold leading-tight text-foreground sm:font-normal sm:text-muted-foreground">{s.data!.total > 0 ? `${compact(s.data!.total)} ${s.data!.unit}` : (s.source === "militaryvoices" && hostName ? hostName : NAME[s.source])}</span>
          </span>
        </button>
      ))}
    </>
  );
}

/**
 * Your analytics → Podcast listens: downloads and streams from wherever the
 * show is connected, and where it fits among MilitaryVoices shows.
 */
export function PodcastListens({ onConnect, bare = false }: { onConnect: () => void; /** Inside Your analytics' Podcast section: no title of its own. */ bare?: boolean }) {
  const q = usePodcastStats();
  const { hosted: hostedHere } = useHostedHere();
  const hostingQ = useHosting();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("all");
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [bz, setBz] = useState({ token: "", podcastId: "" });
  const social = useQuery<{ accounts?: { platform: string; username?: string; followers?: number }[] }>({ queryKey: ["/api/host/social"], queryFn: async () => (await apiRequest("GET", "/api/host/social")).json(), staleTime: 5 * 60_000 });
  const addBz = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/host/podcast-stats/buzzsprout", bz)).json(),
    onSuccess: (r: SourceView) => { toast({ title: "Buzzsprout connected", description: `${r.showName || "Your show"}: its history is on this page now.` }); setBz({ token: "", podcastId: "" }); setAdding(false); setTab("all"); void qc.invalidateQueries({ queryKey: KEY }); },
    onError: (e: Error) => toast({ title: "Couldn't connect", description: e.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  if (q.isLoading) return null;
  const sources = (q.data?.sources ?? []).filter((s) => s.data);
  if (!sources.length) {
    return (
      <div className={`${bare ? "" : "mb-6 "}flex flex-wrap items-center gap-4 rounded-2xl border border-dashed border-border p-5`} data-testid="podcast-listens-empty">
        <Headphones className="h-7 w-7 shrink-0 text-[#053877] dark:text-[#8ab4f8]" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">See your podcast's downloads here</p>
          <p className="text-sm text-muted-foreground">Connect Buzzsprout or upload your Spotify numbers, and see where your show fits among MilitaryVoices podcasts.</p>
        </div>
        <Button variant="outline" className="gap-1.5 rounded-full" onClick={onConnect} data-testid="button-podcast-stats-connect"><Link2 className="h-4 w-4" /> Connect</Button>
      </div>
    );
  }
  const refresh = async (s: Source) => {
    setRefreshing(s);
    try { await apiRequest("POST", `/api/host/podcast-stats/${s}/refresh`); await qc.invalidateQueries({ queryKey: KEY }); } finally { setRefreshing(null); }
  };
  // Tabs across the top: everything together, then one for each place the numbers come from.
  const merged: SourceView | null = (() => {
    if (sources.length < 2) return null;
    const eps = new Map<string, { title: string; published: string; count: number }>();
    const days = new Map<string, number>();
    const apps: Record<string, number> = {};
    for (const x of sources) {
      for (const e of x.data!.episodes) { const k = e.title.trim().toLowerCase(); const had = eps.get(k); eps.set(k, had ? { ...had, count: had.count + e.count } : { ...e }); }
      for (const d of x.data!.series ?? []) days.set(d.date, (days.get(d.date) ?? 0) + d.count);
      for (const [a, n] of Object.entries(x.data!.audience?.apps ?? {})) apps[a] = (apps[a] ?? 0) + n;
    }
    const first = sources[0];
    return {
      source: "all" as unknown as Source, showName: first.showName, status: "ok", error: "",
      fetchedAt: sources.map((x) => x.fetchedAt).sort().slice(-1)[0] ?? "",
      data: {
        total: sources.reduce((a, x) => a + (x.data!.unit === "downloads" ? x.data!.total : 0), 0), unit: "downloads",
        episodes: Array.from(eps.values()), series: Array.from(days, ([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
        audience: Object.keys(apps).length ? { apps } : undefined, artwork: sources.find((x) => x.data!.artwork)?.data!.artwork,
      },
    };
  })();
  // Where they listen (counted from our own feed), for the Apple and Spotify tabs; the YouTube tab reads the connected channel.
  const hosted = sources.find((x) => x.source === "militaryvoices");
  const apps: Record<string, number> = merged?.data?.audience?.apps ?? hosted?.data?.audience?.apps ?? {};
  const appSum = (re: RegExp) => Object.entries(apps).filter(([k]) => re.test(k)).reduce((a, [, n]) => a + n, 0);
  const appTotal = Object.values(apps).reduce((a, n) => a + n, 0);
  const yt = (social.data?.accounts ?? []).find((x) => x.platform === "youtube");
  const tabs: { key: string; label: string }[] = [
    ...(merged ? [{ key: "all", label: "All sources" }] : []),
    ...sources.map((x) => ({ key: x.source, label: x.source === "militaryvoices" ? "MilitaryVoices" : NAME[x.source] })),
    ...(hosted ? [{ key: "app:apple", label: "Apple Podcasts" }, ...(sources.some((x) => x.source === "spotify") ? [] : [{ key: "app:spotify", label: "Spotify" }])] : []),
    ...(yt ? [{ key: "yt", label: "YouTube" }] : []),
  ];
  const pick = tabs.some((t) => t.key === tab) ? tab : tabs[0].key;
  const shown = pick === "all" && merged ? [merged] : sources.filter((x) => x.source === pick);
  const appView = pick.startsWith("app:") ? (pick === "app:apple" ? { name: "Apple Podcasts", n: appSum(/apple/i) } : { name: "Spotify", n: appSum(/spotify/i) }) : null;
  // The show's artwork for every card's header, and which apps read the feed (to say the zeros honestly).
  const art = sources.find((x) => x.data?.artwork)?.data!.artwork || (hostingQ.data?.shows ?? []).find((x) => x.show.artworkUrl)?.show.artworkUrl || "";
  const reads = new Set((hostingQ.data?.shows ?? []).flatMap((x) => x.reading ?? []));
  return (
    <section className={`${bare ? "" : "mb-6 "}space-y-4`} data-testid="podcast-listens">
      {!sources.some((x) => x.source === "buzzsprout") && (
        <div className="rounded-2xl border border-dashed border-border p-4" data-testid="add-buzzsprout">
          <div className="flex flex-wrap items-center gap-3">
            <Link2 className="h-5 w-5 shrink-0 text-[#053877] dark:text-[#8ab4f8]" />
            <p className="min-w-0 flex-1 text-sm"><span className="font-semibold text-foreground">Bring in your Buzzsprout history.</span> <span className="text-muted-foreground">Every episode's plays, from before the move.</span></p>
            <Button variant="outline" size="sm" className="h-8 rounded-full px-3.5 text-xs" onClick={() => setAdding((v) => !v)} aria-expanded={adding} data-testid="button-add-buzzsprout">{adding ? "Close" : "Add Buzzsprout"}</Button>
          </div>
          {adding && (
            <form onSubmit={(e) => { e.preventDefault(); addBz.mutate(); }} className="mt-4 grid gap-3 rounded-xl bg-muted/40 p-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
              <label className="block text-xs font-semibold text-muted-foreground">API token<Input type="password" autoComplete="off" value={bz.token} onChange={(e) => setBz((f) => ({ ...f, token: e.target.value }))} className="mt-1 h-9 text-sm" data-testid="input-bz-token" /></label>
              <label className="block text-xs font-semibold text-muted-foreground">Podcast ID (optional)<Input autoComplete="off" value={bz.podcastId} onChange={(e) => setBz((f) => ({ ...f, podcastId: e.target.value }))} className="mt-1 h-9 text-sm" data-testid="input-bz-id" /></label>
              <Button type="submit" disabled={addBz.isPending || !bz.token.trim()} className="h-9 gap-1.5 rounded-full" data-testid="button-bz-connect">{addBz.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Connect</Button>
              <p className="text-xs text-muted-foreground sm:col-span-3">In Buzzsprout, open <span className="font-semibold text-foreground">Profile → API</span> and copy the token. With more than one show, add the podcast's ID (the number in its Buzzsprout address).</p>
            </form>
          )}
        </div>
      )}
      {tabs.length > 1 && (
        <div role="tablist" className="flex gap-1 overflow-x-auto rounded-full bg-muted/60 p-1" data-testid="podcast-tabs">
          {tabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={pick === t.key} type="button" onClick={() => setTab(t.key)} data-testid={`podcast-tab-${t.key}`}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${pick === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {TAB_MARK[t.key] && <img src={TAB_MARK[t.key]} alt="" className="h-4 w-4 rounded-sm object-contain" />}{t.label}
            </button>
          ))}
        </div>
      )}
      {!bare && <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground"><Headphones className="h-4 w-4" /> Podcast listens</h3>}
      {(q.data?.benchmark ?? []).map((b) => (
        <div key={b.unit} className="flex items-center gap-3 rounded-2xl bg-[#053877] p-4 text-white" data-testid={`benchmark-${b.unit}`}>
          <Trophy className="h-6 w-6 shrink-0 text-[#F0A71F]" />
          <p className="text-sm">
            Your episodes average <span className="font-bold">{compact(b.avg)} {b.unit}</span>.{" "}
            {b.percentile >= 0
              ? <>That's more than <span className="font-bold text-[#F0A71F]">{b.percentile}%</span> of the {b.peers} MilitaryVoices shows that share theirs.</>
              : <span className="text-white/75">Once five shows share their {b.unit}, you'll see where you fit among them.</span>}
          </p>
        </div>
      ))}
      {appView && (
        <div className="rounded-2xl border border-border bg-card p-5" data-testid={`listens-${pick}`}>
          <CardHead art={art} mark={markImg(TAB_MARK[pick])} title={appView.name} sub={pick === "app:spotify" ? "Your MilitaryVoices feed, as Spotify reads it." : "Counted from your MilitaryVoices feed, by the app that asked for each episode."} />
          {/* Spotify copies each episode once and plays its own copy, so no host ever sees Spotify's plays: no 0 to show. */}
          {pick !== "app:spotify" && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-muted/50 px-3 py-2.5"><p className="text-xl font-bold tabular-nums text-foreground">{compact(appView.n)}</p><p className="text-xs text-muted-foreground">downloads through {appView.name}</p></div>
              <div className="rounded-xl bg-muted/50 px-3 py-2.5"><p className="text-xl font-bold tabular-nums text-foreground">{appTotal ? `${Math.round((appView.n / appTotal) * 100)}%` : "–"}</p><p className="text-xs text-muted-foreground">of all your downloads</p></div>
            </div>
          )}
          {pick === "app:spotify" ? (
            <p className="text-sm text-muted-foreground" data-testid="spotify-note">{reads.has("Spotify") ? "Spotify reads your MilitaryVoices feed now. It keeps its own copy of each episode and plays that copy to listeners, so Spotify's plays don't come through any podcast host, us included. Spotify counts them in Spotify for Creators: add those details below to see them here." : "Once your show's address in Spotify points at your MilitaryVoices feed, Spotify takes each new episode from us. It plays its own copy, so its plays show in Spotify for Creators: add those details below to see them here."}</p>
          ) : appView.n === 0 && (
            <p className="mt-4 text-sm text-muted-foreground" data-testid="apple-note">{reads.has("Apple Podcasts") ? "Apple Podcasts reads your MilitaryVoices feed now. A download through Apple shows here each time a listener plays or downloads an episode, so most arrive the day a new one is out. Earlier history is in your Buzzsprout tab." : "Nothing yet. Once your show's address in Apple Podcasts points at your MilitaryVoices feed, each listen shows here. Earlier history is in your Buzzsprout tab."}</p>
          )}
        </div>
      )}
      {pick === "yt" && yt && (
        <div className="rounded-2xl border border-border bg-card p-5" data-testid="listens-yt">
          <CardHead art={art} mark={markImg("/brands/youtube.svg")} title={<>YouTube{yt.username ? <span className="font-normal text-muted-foreground"> · @{yt.username.replace(/^@/, "")}</span> : null}</>} sub="Your connected channel. Views and how each post did are under Social → Analytics." />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl bg-muted/50 px-3 py-2.5"><p className="text-xl font-bold tabular-nums text-foreground">{compact(yt.followers ?? 0)}</p><p className="text-xs text-muted-foreground">subscribers</p></div>
          </div>
        </div>
      )}
      {shown.map((s) => {
        const d = s.data!;
        const isAll = (s.source as string) === "all";
        const avg = d.episodes.length ? d.episodes.reduce((a, e) => a + e.count, 0) / d.episodes.length : 0;
        const recent = (d.series ?? []).slice(-30);
        const recentSum = recent.reduce((a, x) => a + x.count, 0);
        const max = Math.max(1, ...recent.map((x) => x.count));
        const stale = s.source === "spotify" && Date.now() - Date.parse(s.fetchedAt) > MONTH;
        const stats: [string, string][] = [
          [s.source === "podbean" ? `${d.unit}, last 2 years` : `${d.unit}, all time`, compact(d.total)],
          ["average per episode", compact(avg)],
          ...(recent.length ? [[s.source === "podbean" ? "last 12 months" : `last ${recent.length} days`, compact(s.source === "podbean" ? (d.series ?? []).slice(-12).reduce((a, x) => a + x.count, 0) : recentSum)] as [string, string]] : []),
          ...(d.followers ? [["followers", compact(d.followers)] as [string, string]] : []),
        ];
        return (
          <div key={s.source} className="rounded-2xl border border-border bg-card p-5" data-testid={`listens-${isAll ? "all" : s.source}`}>
            <CardHead
              art={d.artwork || art}
              mark={isAll ? ALL_MARK : MARK[s.source] ? markImg(MARK[s.source]!) : <span className="text-[10px] font-bold text-foreground">{NAME[s.source][0]}</span>}
              title={s.showName || (isAll ? "Your show" : NAME[s.source])}
              sub={<>
                {isAll ? `All your sources together: ${sources.map((x) => NAME[x.source]).join(", ")}` : s.source === "militaryvoices" ? "Hosted on MilitaryVoices" : s.source === "spotify" ? "From Spotify for Creators" : `From ${NAME[s.source]}`}
                {" · "}{s.source === "spotify" ? `Uploaded ${when(s.fetchedAt)}` : `Updated ${when(s.fetchedAt)}`}
                {stale && <span className="font-semibold text-amber-700 dark:text-amber-400"> · a month old: upload this month's {hostedHere ? "below" : "in Integrations"}</span>}
                {s.status === "failed" && <span className="text-destructive"> · {s.error}</span>}
              </>}
              right={!isAll && s.source !== "spotify" && s.source !== "militaryvoices" ? (
                <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => void refresh(s.source)} disabled={refreshing === s.source}>
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing === s.source ? "animate-spin" : ""}`} /> Refresh
                </Button>
              ) : undefined}
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {stats.map(([label, n]) => (
                <div key={label} className="rounded-xl bg-muted/50 px-3 py-2.5">
                  <p className="text-xl font-bold tabular-nums text-foreground">{n}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
            {recent.length > 1 && (
              <div className="mt-4">
                <div className="flex h-20 items-end gap-0.5" aria-label={`${d.unit} over time`}>
                  {recent.map((x) => <div key={x.date} title={`${x.date}: ${x.count}`} className="min-w-0 flex-1 rounded-t bg-[#053877]/80 dark:bg-[#8ab4f8]/80" style={{ height: `${Math.max(2, (x.count / max) * 100)}%` }} />)}
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{recent[0].date}</span><span>{recent[recent.length - 1].date}</span></div>
              </div>
            )}
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              {d.episodes.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Top episodes</p>
                  <Bars items={[...d.episodes].sort((a, b) => b.count - a.count).slice(0, 5).map((e) => [e.title, e.count])} />
                </div>
              )}
              {(d.audience?.age || d.audience?.countries || d.audience?.apps || d.audience?.gender) && (
                <div className="space-y-4">
                  {d.audience?.age && <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Age</p><Bars items={top(d.audience.age, 6)} /></div>}
                  {d.audience?.gender && <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Gender</p><Bars items={top(d.audience.gender)} /></div>}
                  {d.audience?.countries && Object.keys(d.audience.countries).length > 0 && <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Countries</p><Bars items={top(d.audience.countries)} /></div>}
                  {d.audience?.apps && Object.keys(d.audience.apps).length > 0 && <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Where they listen</p><Bars items={top(d.audience.apps)} /></div>}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {/* Hosted with us: Integrations no longer shows Podcast stats, so Spotify's audience upload lives here. */}
      {hostedHere && (() => {
        const sp = sources.find((x) => x.source === "spotify");
        const spStale = !!sp && Date.now() - Date.parse(sp.fetchedAt) > MONTH;
        return (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-3" data-testid="add-spotify-details">
            <img src="/brands/spotify.svg" alt="" className="h-5 w-5 shrink-0 object-contain" />
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-semibold text-foreground">{sp ? "Spotify details" : "Add Spotify details (optional)"}</span>{" "}
              <span className="text-muted-foreground">{sp ? `Uploaded ${when(sp.fetchedAt)}.` : "Adds listener age, gender and location from Spotify. Export them at creators.spotify.com → Analytics."}</span>
            </p>
            <SpotifyUpload has={!!sp} stale={spStale} />
          </div>
        );
      })()}
    </section>
  );
}

/** Where each hosted show is live (its Directories tab): Apple Podcasts, Spotify, Listen Notes… one chip each. */
const LISTING: Record<string, { name: string; domain: string }> = {
  apple: { name: "Apple Podcasts", domain: "podcasts.apple.com" },
  spotify: { name: "Spotify", domain: "open.spotify.com" },
  youtube: { name: "YouTube Music", domain: "music.youtube.com" },
  amazon: { name: "Amazon Music", domain: "music.amazon.com" },
  iheart: { name: "iHeartRadio", domain: "iheart.com" },
  pocketcasts: { name: "Pocket Casts", domain: "pocketcasts.com" },
  podcastindex: { name: "Podcast Index", domain: "podcastindex.org" },
  listennotes: { name: "Listen Notes", domain: "listennotes.com" },
};
type Listing = { key: string; show: string; artwork: string; url: string };
export function useListings(): Listing[] {
  const q = useHosting();
  const out: Listing[] = [];
  for (const { show } of q.data?.shows ?? []) {
    let dirs: Record<string, { state?: string; url?: string }> = {};
    try { dirs = JSON.parse(show.directories || "{}"); } catch { /* none */ }
    if (show.appleUrl && !dirs.apple?.url) dirs.apple = { state: "live", url: show.appleUrl };
    if (show.spotifyUrl && !dirs.spotify?.url) dirs.spotify = { state: "live", url: show.spotifyUrl };
    for (const [key, d] of Object.entries(dirs)) {
      if (d?.state === "live" && d.url && LISTING[key]) out.push({ key, show: show.title, artwork: show.artworkUrl ?? "", url: d.url });
    }
  }
  return out;
}
export function ListingChips() {
  const listings = useListings();
  return (
    <>
      {listings.map((l) => (
        <a key={`${l.key}-${l.url}`} href={l.url} target="_blank" rel="noopener noreferrer" title={`${l.show} on ${LISTING[l.key].name}`} className="group flex shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1.5 transition-colors hover:border-primary/40 hover:shadow-sm sm:gap-2.5 sm:px-3 sm:py-2" data-testid={`chip-listing-${l.key}`}>
          <span className="relative shrink-0">
            {l.artwork ? <img src={l.artwork} alt="" className="h-8 w-8 rounded-full object-cover" /> : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{l.show[0]}</span>}
            <img src={`https://www.google.com/s2/favicons?domain=${LISTING[l.key].domain}&sz=64`} alt="" className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-white object-contain p-px ring-2 ring-card" />
          </span>
          <span className="min-w-0">
            <span className="hidden max-w-[9.5rem] truncate text-sm font-medium leading-tight text-foreground sm:block">{l.show}</span>
            <span className="block truncate text-xs font-semibold leading-tight text-foreground sm:font-normal sm:text-muted-foreground">{LISTING[l.key].name}</span>
          </span>
        </a>
      ))}
    </>
  );
}
