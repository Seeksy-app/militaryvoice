import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, BarChart3, CalendarDays, Check, ChevronDown, ChevronRight, Headphones, Infinity as InfinityIcon, Link2, ListMusic, Loader2, RefreshCw, Sparkles, Trophy, Upload, Users, X } from "lucide-react";
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

// ---- Date ranges (Andrew, 21 Nov: "Add dates to the analytics 7 days, month, custom") ----

type RangeKey = "7d" | "30d" | "90d" | "12m" | "all" | "custom";
type RangeSel = { r: RangeKey; from: string; to: string };
const RANGE_LABEL: Record<RangeKey, string> = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", "12m": "Last 12 months", all: "All time", custom: "Custom dates" };
const RANGE_STORE = "mv:podcast-range";
const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const utc = (d: string) => Date.parse(`${d.length === 7 ? `${d}-01` : d}T00:00:00Z`);
const thisYear = new Date().getUTCFullYear();
/** "Nov 14", with the year when it isn't this one. */
const fmtDay = (d: string) => new Date(utc(d)).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC", ...(Number(d.slice(0, 4)) !== thisYear ? { year: "numeric" } : {}) });
const fmtMonth = (d: string, long = false) => new Date(utc(d)).toLocaleDateString(undefined, { month: long ? "long" : "short", timeZone: "UTC", ...(long || Number(d.slice(0, 4)) !== thisYear ? { year: long ? "numeric" : "2-digit" } : {}) });

function useRange(): [RangeSel, (v: RangeSel) => void] {
  const [sel, setSel] = useState<RangeSel>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(RANGE_STORE) || "null") as RangeSel | null;
      if (v && RANGE_LABEL[v.r]) return v;
    } catch { /* private window: the default */ }
    return { r: "30d", from: "", to: "" };
  });
  return [sel, (v) => { setSel(v); try { localStorage.setItem(RANGE_STORE, JSON.stringify(v)); } catch { /* not kept */ } }];
}

type Span = { from: string; to: string; all: boolean; label: string; prevFrom?: string; prevTo?: string; before?: string };
/** The days a choice covers (inclusive), and the same stretch just before it, for the change. */
function spanOf(sel: RangeSel): Span {
  const today = iso(Date.now());
  const back = ({ "7d": 7, "30d": 30, "90d": 90, "12m": 365 } as Record<string, number>)[sel.r];
  if (back) {
    return { from: iso(Date.now() - (back - 1) * DAY), to: today, all: false, label: sel.r === "12m" ? "last 12 months" : `last ${back} days`,
      prevFrom: iso(Date.now() - (2 * back - 1) * DAY), prevTo: iso(Date.now() - back * DAY), before: sel.r === "12m" ? "the 12 months before" : `the ${back} days before` };
  }
  if (sel.r === "custom") {
    const [a, b] = [sel.from || iso(Date.now() - 29 * DAY), sel.to || today].sort();
    const n = Math.round((utc(b) - utc(a)) / DAY) + 1;
    return { from: a, to: b, all: false, label: a === b ? fmtDay(a) : `${fmtDay(a)} – ${fmtDay(b)}`, prevFrom: iso(utc(a) - n * DAY), prevTo: iso(utc(a) - DAY), before: `the ${n} day${n === 1 ? "" : "s"} before` };
  }
  return { from: "0000-01-01", to: "9999-12-31", all: true, label: "all time" };
}

/** One range for every tab, beside the tabs: a plain menu, and two dates for Custom. */
function RangePicker({ sel, onChange }: { sel: RangeSel; onChange: (v: RangeSel) => void }) {
  const today = iso(Date.now());
  const span = spanOf(sel);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="podcast-range">
      <span className="relative">
        <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <select
          aria-label="Dates"
          value={sel.r}
          onChange={(e) => {
            const r = e.target.value as RangeKey;
            // Custom starts from the dates on screen, so the two boxes are already filled.
            onChange(r === "custom" ? { r, from: sel.from || (span.all ? iso(Date.now() - 29 * DAY) : span.from), to: sel.to || today } : { ...sel, r });
          }}
          className="h-9 cursor-pointer appearance-none rounded-full border border-border bg-background pl-9 pr-8 text-sm font-semibold text-foreground shadow-sm hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="select-podcast-range"
        >
          {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => <option key={k} value={k}>{RANGE_LABEL[k]}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </span>
      {sel.r === "custom" && (
        <span className="flex items-center gap-1.5">
          <input type="date" aria-label="From" value={sel.from} max={sel.to || today} onChange={(e) => e.target.value && onChange({ ...sel, from: e.target.value })} className="h-9 rounded-full border border-border bg-background px-3 text-sm text-foreground" data-testid="input-range-from" />
          <span className="text-xs text-muted-foreground">to</span>
          <input type="date" aria-label="To" value={sel.to} min={sel.from} max={today} onChange={(e) => e.target.value && onChange({ ...sel, to: e.target.value })} className="h-9 rounded-full border border-border bg-background px-3 text-sm text-foreground" data-testid="input-range-to" />
        </span>
      )}
    </div>
  );
}

/** A series' dates as yyyy-mm-dd (or yyyy-mm for months), whatever the file said. */
function normSeries(s: { date: string; count: number }[] | undefined) {
  return (s ?? []).map((x) => {
    const d = /^\d{4}-\d{2}-\d{2}/.test(x.date) ? x.date.slice(0, 10) : /^\d{4}-\d{2}$/.test(x.date) ? x.date : Number.isFinite(Date.parse(x.date)) ? iso(Date.parse(x.date)) : "";
    return { date: d, count: Number(x.count) || 0 };
  }).filter((x) => x.date).sort((a, b) => a.date.localeCompare(b.date));
}
const sumDays = (m: Record<string, number> | undefined, from: string, to: string) => Object.entries(m ?? {}).reduce((a, [d, n]) => (d >= from && d <= to ? a + n : a), 0);

type Bar = { key: string; count: number; tip: string; tick: string };
/**
 * A source's numbers inside the chosen dates: the total, the stretch before it,
 * bars for the chart (days up to 92, then weeks, then months), and what the source
 * can't do, said once.
 */
function inRange(d: PodcastStatsData, span: Span) {
  const series = normSeries(d.series);
  const monthly = series.length > 0 && series.every((x) => x.date.length === 7);
  const first = series[0]?.date ?? "";
  const last = series[series.length - 1]?.date ?? "";
  const monthEnd = (m: string) => iso(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0));
  const hit = (x: { date: string }, from: string, to: string) => (monthly ? monthEnd(x.date) >= from && x.date + "-01" <= to : x.date >= from && x.date <= to);
  const sum = span.all ? d.total : series.filter((x) => hit(x, span.from, span.to)).reduce((a, x) => a + x.count, 0);
  const prevCovered = !!span.prevFrom && !monthly && !!first && first <= span.prevFrom;
  const prevSum = prevCovered ? series.filter((x) => hit(x, span.prevFrom!, span.prevTo!)).reduce((a, x) => a + x.count, 0) : null;
  const startsLate = !span.all && !!first && first > span.from && !monthly;
  const endsEarly = !!last && !monthly && last < iso(Date.now() - 2 * DAY) && span.to > last;

  let bars: Bar[] = [];
  if (monthly) {
    bars = series.filter((x) => span.all || hit(x, span.from, span.to)).map((x) => ({ key: x.date, count: x.count, tip: fmtMonth(x.date, true), tick: fmtMonth(x.date) }));
  } else if (first) {
    const start = span.all || first > span.from ? first : span.from;
    const end = span.all || last < span.to ? last : span.to;
    const byDay = new Map(series.map((x) => [x.date, x.count]));
    const days: string[] = [];
    for (let t = utc(start); t <= utc(end); t += DAY) days.push(iso(t));
    if (days.length <= 92) {
      bars = days.map((x) => ({ key: x, count: byDay.get(x) ?? 0, tip: new Date(utc(x)).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }), tick: fmtDay(x) }));
    } else if (days.length <= 731) {
      // Weeks starting Monday.
      const weeks = new Map<string, number>();
      for (const x of days) { const w = iso(utc(x) - ((new Date(utc(x)).getUTCDay() + 6) % 7) * DAY); weeks.set(w, (weeks.get(w) ?? 0) + (byDay.get(x) ?? 0)); }
      bars = Array.from(weeks, ([w, n]) => ({ key: w, count: n, tip: `Week of ${fmtDay(w)}`, tick: fmtMonth(w) }));
    } else {
      const months = new Map<string, number>();
      for (const x of days) months.set(x.slice(0, 7), (months.get(x.slice(0, 7)) ?? 0) + (byDay.get(x) ?? 0));
      bars = Array.from(months, ([m, n]) => ({ key: m, count: n, tip: fmtMonth(m, true), tick: fmtMonth(m) }));
    }
  }
  // Which bars carry a date underneath: a handful, at days, Mondays or the turn of a month.
  const weekly = bars.length > 0 && !monthly && bars.length <= 105 && bars[0].tip.startsWith("Week");
  const daily = !monthly && !weekly && bars.length > 0 && !/^\d{4}-\d{2}$/.test(bars[0].key);
  let ticks: number[] = [];
  if (daily && bars.length <= 31) {
    const step = bars.length <= 8 ? 1 : Math.ceil(bars.length / 6);
    ticks = bars.map((_, i) => i).filter((i) => i % step === 0);
  } else if (daily) {
    ticks = bars.map((b, i) => (new Date(utc(b.key)).getUTCDay() === 1 ? i : -1)).filter((i) => i >= 0);
  } else {
    ticks = bars.map((b, i) => (i === 0 || b.tick !== bars[i - 1].tick ? i : -1)).filter((i) => i >= 0);
  }
  if (ticks.length > 7) { const k = Math.ceil(ticks.length / 7); ticks = ticks.filter((_, j) => j % k === 0); }

  // Episodes: ranked inside the dates when the source counts them by day.
  const byDate = d.episodes.length > 0 && d.episodes.every((e) => e.days);
  const eps = span.all || !byDate ? d.episodes.map((e) => ({ title: e.title, n: e.count })) : d.episodes.map((e) => ({ title: e.title, n: sumDays(e.days, span.from, span.to) }));
  const played = eps.filter((e) => e.n > 0);
  const avg = span.all || !byDate
    ? (d.episodes.length ? d.episodes.reduce((a, e) => a + e.count, 0) / d.episodes.length : 0)
    : (played.length ? played.reduce((a, e) => a + e.n, 0) / played.length : 0);
  const apps = d.appDays && !span.all
    ? Object.fromEntries(Object.entries(d.appDays).map(([a, m]) => [a, sumDays(m, span.from, span.to)]).filter(([, n]) => (n as number) > 0))
    : d.audience?.apps;
  return { sum, prevSum, bars, ticks, monthly, first, last, startsLate, endsEarly, byDate, top: played.sort((a, b) => b.n - a.n).slice(0, 5), avg, apps };
}

/*
 * The look (Andrew, 22 Nov: "can you make the analtyics page more engaging. I wan it to look very very cool"):
 * then (same day: "I want each one of those to look the same… the dark blue takes way too much room"): one layout for every
 * tab, an Overview of everything first, the number counting up in one small navy tile, a small trend line, a milestone pill,
 * medals on the top episodes and a ring of the apps people listen in.
 */
const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
/** A number that counts up to `to` when it appears or changes. */
function useCountUp(to: number, ms = 900) {
  const [v, setV] = useState(() => (reduced() ? to : 0));
  const from = useRef(0);
  useEffect(() => {
    if (reduced()) { setV(to); return; }
    let raf = 0; const start = performance.now(); const a = from.current;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms), e = 1 - Math.pow(1 - k, 3);
      setV(a + (to - a) * e);
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return v;
}
function CountUp({ n }: { n: number }) {
  const v = useCountUp(n);
  return <>{n >= 1000 ? compact(v) : Math.round(v).toLocaleString()}</>;
}

const MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000];
/** A small ring to the next milestone, from all-time downloads. */
function Milestone({ total, unit }: { total: number; unit: string }) {
  const next = MILESTONES.find((m) => m > total) ?? total;
  const share = next ? Math.min(1, total / next) : 1;
  const [shown, setShown] = useState(reduced() ? share : 0);
  useEffect(() => { const t = setTimeout(() => setShown(share), 60); return () => clearTimeout(t); }, [share]);
  const R = 15, C = 2 * Math.PI * R;
  return (
    <div className="flex items-center gap-2.5 rounded-full border border-border bg-background py-1 pl-1 pr-3.5" data-testid="podcast-milestone">
      <svg viewBox="0 0 40 40" className="h-9 w-9 shrink-0 -rotate-90" aria-hidden>
        <circle cx="20" cy="20" r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth="5" />
        <circle cx="20" cy="20" r={R} fill="none" stroke="#F0A71F" strokeWidth="5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - shown)} style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1)" }} />
      </svg>
      <div className="leading-tight">
        <p className="text-xs font-bold text-foreground">Next: {compact(next)} {unit}</p>
        <p className="text-[11px] text-muted-foreground">{compact(Math.max(0, next - total))} to go</p>
      </div>
    </div>
  );
}

/** A small trend line over the dates: a dot and the number on hover (or tap). */
function TrendChart({ bars, ticks, unit }: { bars: Bar[]; ticks: number[]; unit: string }) {
  const [hi, setHi] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(reduced());
  useEffect(() => { const t = setTimeout(() => setDrawn(true), 30); return () => clearTimeout(t); }, []);
  const id = useId().replace(/:/g, "");
  const W = 1000, H = 120, pad = 8;
  const max = Math.max(1, ...bars.map((b) => b.count));
  const x = (i: number) => (bars.length === 1 ? W / 2 : (i / (bars.length - 1)) * W);
  const y = (n: number) => H - pad - (n / max) * (H - pad * 2);
  const pts = bars.map((b, i) => [x(i), y(b.count)] as const);
  let line = pts.length ? `M${pts[0][0]},${pts[0][1]}` : "";
  for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2; line += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`; }
  const area = `${line} L${W},${H} L0,${H} Z`;
  const pct = (i: number) => (bars.length === 1 ? 50 : (i / (bars.length - 1)) * 100);
  const tipAt = (i: number) => { const l = pct(i); return { left: `${l}%`, transform: l < 12 ? "translateX(-8%)" : l > 88 ? "translateX(-92%)" : "translateX(-50%)" }; };
  const pick = (e: React.PointerEvent<HTMLDivElement>) => { const r = e.currentTarget.getBoundingClientRect(); setHi(Math.max(0, Math.min(bars.length - 1, Math.round(((e.clientX - r.left) / r.width) * (bars.length - 1))))); };
  return (
    <div className="mt-4 rounded-2xl border border-border px-4 pb-3 pt-4" data-testid="podcast-chart">
      <div className="relative h-24 text-[#053877] sm:h-28 dark:text-[#8ab4f8]" onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHi(null)} aria-label={`${unit} over time`}>
        {hi !== null && bars[hi] && (
          <div role="tooltip" className="pointer-events-none absolute -top-8 z-10 whitespace-nowrap rounded-lg bg-[#000741] px-2.5 py-1 text-xs font-semibold text-white shadow-lg" style={tipAt(hi)} data-testid="chart-tooltip">
            {bars[hi].tip}: {bars[hi].count.toLocaleString()} {bars[hi].count === 1 ? unit.replace(/s$/, "") : unit}
          </div>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          <defs><linearGradient id={`a${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity="0.22" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
          {[0.33, 0.66].map((g) => <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} stroke="hsl(var(--border))" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
          <path d={area} fill={`url(#a${id})`} style={{ opacity: drawn ? 1 : 0, transition: "opacity .8s ease .3s" }} />
          <path d={line} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" pathLength={1} strokeDasharray="1" strokeDashoffset={drawn ? 0 : 1} style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1)" }} />
          {hi !== null && pts[hi] && <line x1={pts[hi][0]} x2={pts[hi][0]} y1="0" y2={H} stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
        </svg>
        {hi !== null && pts[hi] && <span className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#F0A71F] shadow-[0_0_0_5px_rgba(240,167,31,0.25)]" style={{ left: `${pct(hi)}%`, top: `${(pts[hi][1] / H) * 100}%` }} />}
      </div>
      <div className="relative mt-2 h-4 text-[11px] text-muted-foreground">
        {ticks.map((i) => <span key={i} className="absolute whitespace-nowrap" style={tipAt(i)}>{bars[i].tick}</span>)}
      </div>
    </div>
  );
}

/** Top episodes with 1, 2, 3 medals and bars that grow in. */
const MEDAL = ["bg-gradient-to-br from-[#FFE08A] to-[#E6A100] text-[#4a3300]", "bg-gradient-to-br from-[#F1F4F8] to-[#AEB8C6] text-[#2b3442]", "bg-gradient-to-br from-[#F5C9A4] to-[#B9733F] text-[#3d220c]"];
function RankList({ items }: { items: [string, number][] }) {
  const max = Math.max(1, ...items.map(([, n]) => n));
  const [grown, setGrown] = useState(reduced());
  useEffect(() => { const t = setTimeout(() => setGrown(true), 80); return () => clearTimeout(t); }, []);
  return (
    <ol className="space-y-3">
      {items.map(([k, n], i) => (
        <li key={k} className="flex items-center gap-3">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black shadow-sm ${MEDAL[i] ?? "bg-muted text-muted-foreground"}`}>{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2"><span className="truncate text-sm font-medium text-foreground">{k}</span><span className="shrink-0 text-sm font-bold tabular-nums text-foreground">{compact(n)}</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-gradient-to-r from-[#053877] to-[#3b82f6] dark:from-[#8ab4f8] dark:to-[#c3d7fb]" style={{ width: grown ? `${(n / max) * 100}%` : "0%", transition: `width .9s cubic-bezier(.2,.8,.2,1) ${i * 90}ms` }} /></div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Where they listen as a ring, each app in its own colour, with its logo when we have one. */
const APP_LOOK: { re: RegExp; color: string; logo?: string }[] = [
  { re: /apple/i, color: "#A45EE5", logo: "/brands/apple-podcasts.svg" },
  { re: /spotify/i, color: "#1DB954", logo: "/brands/spotify.svg" },
  { re: /youtube/i, color: "#FF0033", logo: "/brands/youtube.svg" },
  { re: /overcast/i, color: "#FC7E0F" },
  { re: /pocket ?casts/i, color: "#F43E37" },
  { re: /addict/i, color: "#F4842D" },
  { re: /castbox/i, color: "#F55B23" },
  { re: /amazon|audible/i, color: "#25D1DA" },
  { re: /iheart/i, color: "#C6002B" },
  { re: /browser|web/i, color: "#64748B" },
];
const SPARE = ["#053877", "#3b82f6", "#14b8a6", "#F0A71F", "#94a3b8"];
function Donut({ items }: { items: [string, number][] }) {
  const total = items.reduce((a, [, n]) => a + n, 0) || 1;
  const looks = items.map(([k], i) => { const l = APP_LOOK.find((x) => x.re.test(k)); return { color: l?.color ?? SPARE[i % SPARE.length], logo: l?.logo }; });
  const [drawn, setDrawn] = useState(reduced());
  useEffect(() => { const t = setTimeout(() => setDrawn(true), 80); return () => clearTimeout(t); }, []);
  const R = 42, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="flex items-center gap-4 sm:gap-5">
      <div className="relative h-[104px] w-[104px] shrink-0 sm:h-[120px] sm:w-[120px]">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="60" cy="60" r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth="16" />
          {items.map(([k, n], i) => {
            const len = (n / total) * C, off = acc; acc += len;
            return <circle key={k} cx="60" cy="60" r={R} fill="none" stroke={looks[i].color} strokeWidth="16" strokeDasharray={`${drawn ? Math.max(0, len - 2) : 0} ${C}`} strokeDashoffset={-off} style={{ transition: `stroke-dasharray .9s cubic-bezier(.2,.8,.2,1) ${i * 120}ms` }} />;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-xl font-black tabular-nums text-foreground">{items.length}</span><span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{items.length === 1 ? "app" : "apps"}</span></div>
      </div>
      <ul className="min-w-0 flex-1 space-y-2">
        {items.map(([k, n], i) => (
          <li key={k} className="flex items-center gap-2 text-sm">
            {looks[i].logo ? <img src={looks[i].logo} alt="" className="h-5 w-5 shrink-0 object-contain" /> : <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: looks[i].color }} />}
            <span className="min-w-0 flex-1 truncate text-foreground">{k}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{Math.round((n / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PodcastListens({ onConnect, bare = false }: { onConnect: () => void; /** Inside Your analytics' Podcast section: no title of its own. */ bare?: boolean }) {
  const q = usePodcastStats();
  const { hosted: hostedHere } = useHostedHere();
  const hostingQ = useHosting();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("all");
  const [range, setRange] = useRange();
  const span = spanOf(range);
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
    const eps = new Map<string, { title: string; published: string; count: number; days?: Record<string, number> }>();
    const days = new Map<string, number>();
    const apps: Record<string, number> = {};
    const appDays: Record<string, Record<string, number>> = {};
    // Episodes rank by date only when every source counts them by day.
    const epDays = sources.every((x) => !x.data!.episodes.length || x.data!.episodes.every((e) => e.days));
    for (const x of sources) {
      for (const e of x.data!.episodes) {
        const k = e.title.trim().toLowerCase();
        const had = eps.get(k);
        const dd: Record<string, number> = { ...(had?.days ?? {}) };
        for (const [day, n] of Object.entries(e.days ?? {})) dd[day] = (dd[day] ?? 0) + n;
        eps.set(k, { title: had?.title ?? e.title, published: had?.published ?? e.published, count: (had?.count ?? 0) + e.count, ...(epDays ? { days: dd } : {}) });
      }
      // Days add up across sources; a source counted by the month stays on its own tab.
      for (const d of normSeries(x.data!.series)) if (d.date.length === 10) days.set(d.date, (days.get(d.date) ?? 0) + d.count);
      for (const [a, n] of Object.entries(x.data!.audience?.apps ?? {})) apps[a] = (apps[a] ?? 0) + n;
      for (const [a, m] of Object.entries(x.data!.appDays ?? {})) for (const [day, n] of Object.entries(m)) (appDays[a] ??= {})[day] = (appDays[a][day] ?? 0) + n;
    }
    const first = sources[0];
    return {
      source: "all" as unknown as Source, showName: first.showName, status: "ok", error: "",
      fetchedAt: sources.map((x) => x.fetchedAt).sort().slice(-1)[0] ?? "",
      data: {
        total: sources.reduce((a, x) => a + (x.data!.unit === "downloads" ? x.data!.total : 0), 0), unit: "downloads",
        episodes: Array.from(eps.values()), series: Array.from(days, ([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
        audience: Object.keys(apps).length ? { apps } : undefined, appDays: Object.keys(appDays).length ? appDays : undefined, artwork: sources.find((x) => x.data!.artwork)?.data!.artwork,
      },
    };
  })();
  // Where they listen (counted from our own feed), for the Apple and Spotify tabs; the YouTube tab reads the connected channel.
  const hosted = sources.find((x) => x.source === "militaryvoices");
  const hostedData = merged?.data ?? hosted?.data;
  const apps: Record<string, number> = (hostedData ? inRange(hostedData, span).apps : undefined) ?? {};
  const appSum = (re: RegExp) => Object.entries(apps).filter(([k]) => re.test(k)).reduce((a, [, n]) => a + n, 0);
  const appTotal = Object.values(apps).reduce((a, n) => a + n, 0);
  const yt = (social.data?.accounts ?? []).find((x) => x.platform === "youtube");
  const spotifySrc = sources.find((x) => x.source === "spotify");
  // The show's artwork for every panel, and which apps read the feed (to say the zeros honestly).
  const art = sources.find((x) => x.data?.artwork)?.data!.artwork || (hostingQ.data?.shows ?? []).find((x) => x.show.artworkUrl)?.show.artworkUrl || "";
  const reads = new Set((hostingQ.data?.shows ?? []).flatMap((x) => x.reading ?? []));
  // "Bring in your Buzzsprout history" only for a show that moved here from Buzzsprout and isn't connected yet
  // (Andrew via PM, 22 Nov: "that banner only needs to show if it pertains to a podcaster who redirected his podcast over"). Everyone else never sees it.
  const movedFromBuzzsprout = (hostingQ.data?.shows ?? []).some((x) => /buzzsprout/i.test(x.show.importedFrom ?? ""));
  const showName = sources.find((x) => x.showName)?.showName || (hostingQ.data?.shows ?? [])[0]?.show.title || "Your show";
  // One app's downloads from our own feed (Apple Podcasts), shaped like any other source so its tab looks the same.
  const appData = (re: RegExp): PodcastStatsData | null => {
    if (!hostedData) return null;
    const days: Record<string, number> = {};
    for (const [a, m] of Object.entries(hostedData.appDays ?? {})) if (re.test(a)) for (const [day, n] of Object.entries(m)) days[day] = (days[day] ?? 0) + n;
    const allTime = Object.entries(hostedData.audience?.apps ?? {}).filter(([k]) => re.test(k)).reduce((a, [, n]) => a + n, 0);
    return { total: allTime || Object.values(days).reduce((a, n) => a + n, 0), unit: "downloads", episodes: [], series: Object.entries(days).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)) };
  };

  // Every tab is one Panel, so they all look the same (Andrew, 22 Nov: "I want each one of those to look the same").
  const srcSub = (s: SourceView) => <>{s.source === "militaryvoices" ? "Hosted on MilitaryVoices" : s.source === "spotify" ? "From Spotify for Creators" : `From ${NAME[s.source]}`}{" · "}<span className="whitespace-nowrap">{s.source === "spotify" ? `Uploaded ${when(s.fetchedAt)}` : `Updated ${when(s.fetchedAt)}`}</span>{s.status === "failed" && <span className="text-destructive"> · {s.error}</span>}</>;
  const models: Model[] = [];
  const overviewData = merged?.data ?? hosted?.data ?? sources[0].data!;
  models.push({ key: "all", label: "Overview", icon: <BarChart3 className="h-4 w-4" />, title: showName, sub: merged ? `Everything together: ${sources.map((x) => (x.source === "militaryvoices" ? "MilitaryVoices" : NAME[x.source])).join(", ")}` : "All your podcast numbers in one place", mark: ALL_MARK, data: overviewData, who: merged ? "Your numbers" : who(hosted ?? sources[0]), source: merged ? undefined : (hosted ?? sources[0]).source, milestone: true });
  for (const s of sources) {
    const sp = s.source === "spotify";
    models.push({
      key: s.source, label: s.source === "militaryvoices" ? "MilitaryVoices" : NAME[s.source], logo: TAB_MARK[s.source],
      title: s.showName || NAME[s.source], sub: srcSub(s), mark: MARK[s.source] ? markImg(MARK[s.source]!) : <span className="text-[10px] font-bold text-foreground">{NAME[s.source][0]}</span>,
      data: s.data, who: who(s), source: s.source, milestone: true,
      action: sp ? <SpotifyUpload has stale={Date.now() - Date.parse(s.fetchedAt) > MONTH} /> : s.source !== "militaryvoices" ? (
        <Button variant="outline" size="sm" className="h-8 gap-1 rounded-full px-3.5 text-xs" onClick={() => void refresh(s.source)} disabled={refreshing === s.source}><RefreshCw className={`h-3.5 w-3.5 ${refreshing === s.source ? "animate-spin" : ""}`} /> Refresh</Button>
      ) : undefined,
      warn: sp && Date.now() - Date.parse(s.fetchedAt) > MONTH ? "These are a month old: upload this month's from Spotify for Creators." : undefined,
    });
  }
  if (hosted) {
    const apple = appData(/apple/i);
    const share = appTotal ? `${Math.round((appSum(/apple/i) / appTotal) * 100)}%` : "–";
    models.push({
      key: "app:apple", label: "Apple Podcasts", logo: TAB_MARK["app:apple"], title: "Apple Podcasts", sub: "Counted from your MilitaryVoices feed, each time Apple asks for an episode", mark: markImg(TAB_MARK["app:apple"]),
      data: apple, who: "Apple Podcasts", extra: [{ icon: <Headphones className="h-4 w-4" />, label: `of all your downloads${span.all ? "" : ", these dates"}`, n: share }],
      empty: apple && apple.total === 0 ? (reads.has("Apple Podcasts") ? "Apple Podcasts reads your MilitaryVoices feed. Each time a listener plays or downloads an episode it shows here, so most arrive the day a new one is out." : "Nothing yet. Once your show's address in Apple Podcasts points at your MilitaryVoices feed, each listen shows here.") : undefined,
    });
    if (!spotifySrc) models.push({
      key: "app:spotify", label: "Spotify", logo: TAB_MARK["app:spotify"], title: "Spotify", sub: reads.has("Spotify") ? <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5 text-emerald-600" /> Spotify reads your MilitaryVoices feed</span> : "Not reading your MilitaryVoices feed yet", mark: markImg(TAB_MARK["app:spotify"]),
      data: null, who: "Spotify",
      empty: <><span className="font-semibold text-foreground">Spotify doesn't share plays with any podcast host</span>, us included: it keeps its own copy of each episode. To see your Spotify plays here, export them from Spotify for Creators (Analytics → Export) and upload the files.</>,
      emptyAction: <SpotifyUpload has={false} />, main: { n: "–", label: "Spotify plays: add your numbers" },
    });
  }
  if (yt) models.push({
    key: "yt", label: "YouTube", logo: TAB_MARK.yt, title: <>YouTube{yt.username ? <span className="font-normal text-muted-foreground"> · @{yt.username.replace(/^@/, "")}</span> : null}</>, sub: "Your connected channel", mark: markImg("/brands/youtube.svg"),
    data: null, who: "YouTube", main: { n: compact(yt.followers ?? 0), label: "subscribers today" },
    empty: "Views and how each post did are under Social → Analytics.",
  });
  const pick = models.some((m) => m.key === tab) ? tab : models[0].key;
  const cur = models.find((m) => m.key === pick)!;
  // The Overview's list of where the numbers come from: one row each, a tap opens its tab.
  const rowsFor = models.filter((m) => m.key !== "all").map((m) => {
    const n = m.data ? inRange(m.data, span).sum : m.key === "yt" ? yt?.followers ?? 0 : null;
    return { m, n, unit: m.key === "yt" ? "subscribers" : m.data?.unit ?? "" };
  });
  const maxRow = Math.max(1, ...rowsFor.map((r) => (r.unit === "subscribers" ? 0 : r.n ?? 0)));
  return (
    <section className={`${bare ? "" : "mb-6 "}space-y-4`} data-testid="podcast-listens">
      {movedFromBuzzsprout && !sources.some((x) => x.source === "buzzsprout") && (
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
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex w-full min-w-0 max-w-full gap-1 overflow-x-auto rounded-full bg-muted/60 p-1 sm:w-auto sm:flex-1" data-testid="podcast-tabs">
          {models.map((t) => (
            <button key={t.key} role="tab" aria-selected={pick === t.key} type="button" onClick={() => setTab(t.key)} data-testid={`podcast-tab-${t.key}`}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${pick === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {t.icon ?? (t.logo && <img src={t.logo} alt="" className="h-4 w-4 rounded-sm object-contain" />)}{t.label}
            </button>
          ))}
        </div>
        {/* Custom's two date boxes take a row of their own, so the tabs keep theirs. */}
        <div className={range.r === "custom" ? "flex w-full justify-end" : "ml-auto"}><RangePicker sel={range} onChange={setRange} /></div>
      </div>
      {!bare && <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground"><Headphones className="h-4 w-4" /> Podcast listens</h3>}
      <Panel m={cur} art={art} span={span} key={cur.key}>
        {pick === "all" && (
          <>
            {(q.data?.benchmark ?? []).map((b) => (
              <p key={b.unit} className="mt-4 flex items-center gap-2 rounded-xl bg-[#F0A71F]/10 px-3 py-2 text-sm text-foreground" data-testid={`benchmark-${b.unit}`}>
                <Trophy className="h-4 w-4 shrink-0 text-[#b36b00] dark:text-[#F0A71F]" />
                <span>Your episodes average <span className="font-bold">{compact(b.avg)} {b.unit}</span>.{" "}
                  {b.percentile >= 0 ? <>More than <span className="font-bold">{b.percentile}%</span> of the {b.peers} MilitaryVoices shows that share theirs.</> : <span className="text-muted-foreground">Once five shows share their {b.unit}, you'll see where you fit.</span>}</span>
              </p>
            ))}
            {rowsFor.length > 0 && (
              <div className="mt-4 rounded-2xl border border-border p-4 sm:p-5" data-testid="podcast-sources">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Where your numbers come from{span.all ? "" : `, ${span.label}`}</p>
                <ul className="divide-y divide-border">
                  {rowsFor.map(({ m, n, unit }) => (
                    <li key={m.key}>
                      <button type="button" onClick={() => setTab(m.key)} className="group flex w-full items-center gap-3 py-2.5 text-left" data-testid={`podcast-source-${m.key}`}>
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">{m.logo ? <img src={m.logo} alt="" className="h-5 w-5 object-contain" /> : m.mark}</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground sm:w-44 sm:flex-none">{m.label}{m.key === "militaryvoices" && <span className="hidden font-normal text-muted-foreground sm:inline"> · all apps</span>}</span>
                        <span className="hidden h-2 flex-1 overflow-hidden rounded-full bg-muted sm:block">{n !== null && unit !== "subscribers" && <span className="block h-full rounded-full bg-gradient-to-r from-[#053877] to-[#3b82f6] dark:from-[#8ab4f8] dark:to-[#c3d7fb]" style={{ width: `${(n / maxRow) * 100}%` }} />}</span>
                        <span className="shrink-0 text-sm tabular-nums text-foreground sm:w-36 sm:text-right">{n === null ? <span className="font-semibold text-[#b36b00] dark:text-[#F0A71F]">Add your numbers</span> : <><span className="font-bold">{compact(n)}</span> <span className="text-muted-foreground">{unit}</span></>}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Panel>
    </section>
  );
}

/** The big number takes the whole first row on a phone, then sits first in the row on a wide screen. */
const GRID: Record<number, string> = { 0: "grid-cols-1", 1: "grid-cols-2", 2: "grid-cols-2 lg:grid-cols-3", 3: "grid-cols-3 lg:grid-cols-4" };
const MAIN_SPAN: Record<number, string> = { 2: "col-span-2 lg:col-span-1", 3: "col-span-3 lg:col-span-1" };
type Tile = { icon: ReactNode; label: string; n: string };
type Model = {
  key: string; label: string; icon?: ReactNode; logo?: string;
  title: ReactNode; sub: ReactNode; mark: ReactNode;
  /** null: nothing to count here (Spotify before an upload, YouTube): the panel says why instead. */
  data: PodcastStatsData | null;
  who: string; source?: Source; milestone?: boolean;
  extra?: Tile[]; action?: ReactNode; warn?: string;
  empty?: ReactNode; emptyAction?: ReactNode;
  /** A tab without download numbers still leads with the big tile: YouTube's subscribers, or "–" before a Spotify upload. */
  main?: { n: string; label: string };
};
const poss = (w: string) => (w.endsWith("s") ? `${w}'` : `${w}'s`);
const who = (s: SourceView) => (s.source === "militaryvoices" ? "MilitaryVoices" : NAME[s.source]);

/** One tab's page: header, four numbers, a small trend line, top episodes and apps. The same for every tab. */
function Panel({ m, art, span, children }: { m: Model; art: string; span: Span; children?: ReactNode }) {
  const d = m.data;
  const v = d ? inRange(d, span) : null;
  const change = v && v.prevSum && v.prevSum > 0 && span.before ? Math.round(((v.sum - v.prevSum) / v.prevSum) * 100) : null;
  const notes: string[] = [];
  if (d && v) {
    const isAll = m.key === "all" && !m.source;
    if (v.monthly && !span.all) notes.push(`${m.who} counts by the month, so this shows whole months.`);
    if (v.startsLate) notes.push(m.source === "militaryvoices" ? `Hosted here from ${fmtDay(v.first)}, so this starts there.` : m.source === "buzzsprout" ? d.history?.complete ? `Buzzsprout's day-by-day numbers start ${fmtDay(v.first)}.` : `Buzzsprout's day-by-day numbers start ${fmtDay(v.first)} here; each refresh adds a month further back.` : `${isAll ? m.who : `${poss(m.who)} numbers`} start ${fmtDay(v.first)}, so this starts there.`);
    if (v.endsEarly) notes.push(m.source === "spotify" ? `Spotify's numbers run to ${fmtDay(v.last)}, from your last upload.` : `${isAll ? m.who : `${poss(m.who)} numbers`} run to ${fmtDay(v.last)}.`);
    if (!span.all && !v.byDate && d.episodes.length) notes.push(`${isAll ? "Buzzsprout gives" : `${m.who} gives`} each episode's total, not by date, so Top episodes is all time.`);
  }
  const tiles: Tile[] = d && v ? [
    ...(d.episodes.length ? [{ icon: <Headphones className="h-4 w-4" />, label: span.all ? "average per episode" : v.byDate ? "average per episode played" : "average per episode, all time", n: v.avg > 0 && v.avg < 10 ? v.avg.toFixed(1).replace(/\.0$/, "") : compact(v.avg) }] : []),
    { icon: <InfinityIcon className="h-4 w-4" />, label: `${d.unit} all time`, n: compact(d.total) },
    ...(d.episodes.length ? [{ icon: <ListMusic className="h-4 w-4" />, label: d.episodes.length === 1 ? "episode" : "episodes", n: String(d.episodes.length) }] : []),
    ...(d.followers ? [{ icon: <Users className="h-4 w-4" />, label: "followers", n: compact(d.followers) }] : []),
    ...(m.extra ?? []),
  ].slice(0, 3) : (m.extra ?? []);
  const apps = v?.apps && Object.keys(v.apps).length > 0 ? v.apps : null;
  const audience = !!(apps || d?.audience?.age || d?.audience?.gender || (d?.audience?.countries && Object.keys(d.audience.countries).length));
  const mainLabel = d ? (span.all && m.source === "podbean" ? `${d.unit}, last 2 years` : `${d.unit}, ${span.label}`) : "";
  const changeText = change === null ? "" : change >= 900 ? `${Math.round(v!.sum / v!.prevSum!)}×` : `${change > 0 ? "+" : ""}${change}%`;
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6" data-testid={`listens-${m.key}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span className="relative shrink-0">
          {art ? <img src={art} alt="" className="h-11 w-11 rounded-xl object-cover ring-1 ring-border" /> : <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted"><Headphones className="h-5 w-5 text-muted-foreground" /></span>}
          <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center overflow-hidden rounded-full bg-background ring-2 ring-background">{m.mark}</span>
        </span>
        <div className="min-w-0 flex-1 basis-44">
          <p className="truncate font-bold leading-tight text-foreground">{m.title}</p>
          <p className="text-xs text-muted-foreground">{m.sub}</p>
        </div>
        {m.milestone && d && <Milestone total={d.total} unit={d.unit} />}
        {m.action}
      </div>
      {m.warn && <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-300">{m.warn}</p>}

      {!d && m.main && (
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
          <div className="relative overflow-hidden rounded-2xl bg-[#000741] px-4 py-3 text-white" data-testid="podcast-main">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_100%_0%,rgba(59,130,246,0.45),transparent_60%)]" aria-hidden />
            <p className={`relative text-3xl font-black leading-none tabular-nums ${m.main.n === "–" ? "text-white/50" : ""}`}>{m.main.n}</p>
            <p className="relative mt-1.5 text-xs text-white/70">{m.main.label}</p>
          </div>
        </div>
      )}
      {(d && v) || tiles.length ? (
        <div className={`mt-4 grid gap-2.5 sm:gap-3 ${!(d && v) ? "grid-cols-2 lg:grid-cols-4" : GRID[tiles.length] ?? GRID[3]}`}>
          {d && v && (
            <div className={`relative overflow-hidden rounded-2xl bg-[#000741] px-4 py-3 text-white ${MAIN_SPAN[tiles.length] ?? ""}`} data-testid="podcast-main">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_100%_0%,rgba(59,130,246,0.45),transparent_60%)]" aria-hidden />
              <div className="relative flex items-end gap-3 lg:block">
                <p className="text-3xl font-black leading-none tabular-nums" data-testid="podcast-hero-number"><CountUp n={v.sum} /></p>
                {change !== null && <span className={`mb-0.5 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-bold lg:mt-2 ${change >= 0 ? "bg-emerald-400/15 text-emerald-300" : "bg-red-400/15 text-red-300"}`} data-testid="podcast-change">{change >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}{changeText} <span className="font-medium opacity-80">vs {span.before}</span></span>}
              </div>
              <p className="relative mt-1.5 text-xs text-white/70">{mainLabel}</p>
            </div>
          )}
          {tiles.map((t) => (
            <div key={t.label} className="min-w-0 rounded-2xl border border-border bg-background px-3 py-3 sm:px-4" data-testid="podcast-tile">
              <div className="flex items-center gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#053877]/10 text-[#053877] dark:bg-[#8ab4f8]/15 dark:text-[#8ab4f8]">{t.icon}</span><p className="text-2xl font-black leading-none tabular-nums text-foreground">{t.n}</p></div>
              <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{t.label}</p>
            </div>
          ))}
        </div>
      ) : null}

      {v && v.bars.length > 1 && v.sum + (v.prevSum ?? 0) > 0 && <TrendChart bars={v.bars} ticks={v.ticks} unit={d!.unit} />}
      {notes.length > 0 && <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="range-note"><Sparkles className="mt-px h-3.5 w-3.5 shrink-0 text-[#b36b00] dark:text-[#F0A71F]" />{notes.join(" ")}</p>}
      {m.empty && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-4" data-testid={`podcast-empty-${m.key}`}>
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">{m.empty}</p>
          {m.emptyAction}
        </div>
      )}
      {children}
      {d && v && (d.episodes.length > 0 || audience) && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {d.episodes.length > 0 && (
            <div className="min-w-0 rounded-2xl border border-border p-4 sm:p-5">
              <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground"><Trophy className="h-4 w-4 text-[#b36b00] dark:text-[#F0A71F]" /> Top episodes{!span.all && v.byDate ? `, ${span.label}` : ""}</p>
              {v.top.length ? <RankList items={v.top.map((e) => [e.title, e.n])} /> : <p className="text-sm text-muted-foreground">No {d.unit} in these dates.</p>}
            </div>
          )}
          {audience && (
            <div className="min-w-0 space-y-5 rounded-2xl border border-border p-4 sm:p-5">
              {apps && <div><p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground"><Headphones className="h-4 w-4 text-[#053877] dark:text-[#8ab4f8]" /> Listening apps{d.appDays && !span.all ? `, ${span.label}` : ""}</p><Donut items={top(apps)} /></div>}
              {d.audience?.age && <div><p className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Age</p><Bars items={top(d.audience.age, 6)} /></div>}
              {d.audience?.gender && <div><p className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Gender</p><Bars items={top(d.audience.gender)} /></div>}
              {d.audience?.countries && Object.keys(d.audience.countries).length > 0 && <div><p className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">Countries</p><Bars items={top(d.audience.countries)} /></div>}
            </div>
          )}
        </div>
      )}
    </div>
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
