import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, ChevronDown, Headphones, Link2, Loader2, RefreshCw, Trophy, Upload, X } from "lucide-react";
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

/** The chart: bars for the dates, a few dates underneath, and the number on hover (or tap). */
function RangeChart({ bars, ticks, unit }: { bars: Bar[]; ticks: number[]; unit: string }) {
  const [hi, setHi] = useState<number | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.count));
  const at = (i: number) => {
    const left = ((i + 0.5) / bars.length) * 100;
    return { left: `${left}%`, transform: left < 10 ? "translateX(-10%)" : left > 90 ? "translateX(-90%)" : "translateX(-50%)" };
  };
  return (
    <div className="mt-4" data-testid="podcast-chart">
      <div className="relative">
        {hi !== null && bars[hi] && (
          <div role="tooltip" className="pointer-events-none absolute -top-8 z-10 whitespace-nowrap rounded-lg bg-foreground px-2.5 py-1 text-xs font-semibold text-background shadow-md" style={at(hi)} data-testid="chart-tooltip">
            {bars[hi].tip}: {bars[hi].count.toLocaleString()} {bars[hi].count === 1 ? unit.replace(/s$/, "") : unit}
          </div>
        )}
        <div className="flex h-24 items-end gap-px" onMouseLeave={() => setHi(null)} aria-label={`${unit} over time`}>
          {bars.map((b, i) => (
            <div key={b.key} className="flex h-full min-w-0 flex-1 cursor-default items-end" onMouseEnter={() => setHi(i)} onClick={() => setHi(i)} title={`${b.tip}: ${b.count}`}>
              <div className={`w-full rounded-t transition-colors ${hi === i ? "bg-[#F0A71F]" : "bg-[#053877]/80 dark:bg-[#8ab4f8]/80"}`} style={{ height: `${Math.max(2, (b.count / max) * 100)}%` }} />
            </div>
          ))}
        </div>
      </div>
      <div className="relative mt-1 h-4 text-[10px] text-muted-foreground">
        {ticks.map((i) => <span key={i} className="absolute whitespace-nowrap" style={at(i)}>{bars[i].tick}</span>)}
      </div>
    </div>
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
      <div className="flex flex-wrap items-center gap-2">
      {tabs.length > 1 && (
        <div role="tablist" className="flex min-w-0 max-w-full flex-1 gap-1 overflow-x-auto rounded-full bg-muted/60 p-1" data-testid="podcast-tabs">
          {tabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={pick === t.key} type="button" onClick={() => setTab(t.key)} data-testid={`podcast-tab-${t.key}`}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${pick === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {TAB_MARK[t.key] && <img src={TAB_MARK[t.key]} alt="" className="h-4 w-4 rounded-sm object-contain" />}{t.label}
            </button>
          ))}
        </div>
      )}
        <div className="ml-auto"><RangePicker sel={range} onChange={setRange} /></div>
      </div>
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
              <div className="rounded-xl bg-muted/50 px-3 py-2.5"><p className="text-xl font-bold tabular-nums text-foreground">{compact(appView.n)}</p><p className="text-xs text-muted-foreground">downloads through {appView.name}, {span.label}</p></div>
              <div className="rounded-xl bg-muted/50 px-3 py-2.5"><p className="text-xl font-bold tabular-nums text-foreground">{appTotal ? `${Math.round((appView.n / appTotal) * 100)}%` : "–"}</p><p className="text-xs text-muted-foreground">of all your downloads{span.all ? "" : " in these dates"}</p></div>
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
          {!span.all && <p className="mt-3 text-xs text-muted-foreground" data-testid="range-note">Subscribers are today's count, so the dates don't change it.</p>}
        </div>
      )}
      {shown.map((s) => {
        const d = s.data!;
        const isAll = (s.source as string) === "all";
        const v = inRange(d, span);
        const who = isAll ? "Your numbers" : s.source === "militaryvoices" ? "MilitaryVoices" : NAME[s.source];
        const stale = s.source === "spotify" && Date.now() - Date.parse(s.fetchedAt) > MONTH;
        const change = v.prevSum && v.prevSum > 0 && span.before ? Math.round(((v.sum - v.prevSum) / v.prevSum) * 100) : null;
        const stats: [string, string, string?][] = [
          [span.all && s.source === "podbean" ? `${d.unit}, last 2 years` : `${d.unit}, ${span.label}`, compact(v.sum)],
          [span.all ? "average per episode" : v.byDate ? "average per episode played" : "average per episode, all time", compact(v.avg)],
          ...(change !== null ? [[`vs ${span.before}`, `${change > 0 ? "+" : ""}${change}%`, change > 0 ? "text-emerald-700 dark:text-emerald-400" : change < 0 ? "text-red-700 dark:text-red-400" : ""] as [string, string, string]] : []),
          ...(d.followers ? [["followers", compact(d.followers)] as [string, string]] : []),
        ];
        // What this source can't do for these dates, said once, quietly.
        const notes: string[] = [];
        if (v.monthly && !span.all) notes.push(`${who} counts by the month, so this shows whole months.`);
        if (v.startsLate) notes.push(s.source === "militaryvoices" ? `Hosted here from ${fmtDay(v.first)}, so this starts there.` : s.source === "buzzsprout" ? `Buzzsprout's day-by-day numbers start ${fmtDay(v.first)} here; each refresh adds a month further back.` : `${isAll ? who : `${who}'s numbers`} start ${fmtDay(v.first)}, so this starts there.`);
        if (v.endsEarly) notes.push(s.source === "spotify" ? `Spotify's numbers run to ${fmtDay(v.last)}, from your last upload.` : `${isAll ? who : `${who}'s numbers`} run to ${fmtDay(v.last)}.`);
        if (!span.all && !v.byDate && d.episodes.length) notes.push(`${isAll ? "Buzzsprout gives" : `${who} gives`} each episode's total, not by date, so Top episodes is all time.`);
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
              {stats.map(([label, n, tone]) => (
                <div key={label} className="rounded-xl bg-muted/50 px-3 py-2.5" data-testid="podcast-tile">
                  <p className={`text-xl font-bold tabular-nums ${tone || "text-foreground"}`}>{n}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
            {!span.all && <p className="mt-2 text-xs text-muted-foreground" data-testid="all-time-line">{compact(d.total)} {d.unit} all time{d.episodes.length ? ` · ${d.episodes.length} episode${d.episodes.length === 1 ? "" : "s"}` : ""}</p>}
            {v.bars.length > 1 && <RangeChart bars={v.bars} ticks={v.ticks} unit={d.unit} />}
            {notes.length > 0 && <p className="mt-3 text-xs text-muted-foreground" data-testid="range-note">{notes.join(" ")}</p>}
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              {d.episodes.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Top episodes{!span.all && v.byDate ? `, ${span.label}` : ""}</p>
                  {v.top.length ? <Bars items={v.top.map((e) => [e.title, e.n])} /> : <p className="text-sm text-muted-foreground">No {d.unit} in these dates.</p>}
                </div>
              )}
              {(d.audience?.age || d.audience?.countries || (v.apps && Object.keys(v.apps).length > 0) || d.audience?.gender) && (
                <div className="space-y-4">
                  {d.audience?.age && <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Age</p><Bars items={top(d.audience.age, 6)} /></div>}
                  {d.audience?.gender && <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Gender</p><Bars items={top(d.audience.gender)} /></div>}
                  {d.audience?.countries && Object.keys(d.audience.countries).length > 0 && <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Countries</p><Bars items={top(d.audience.countries)} /></div>}
                  {v.apps && Object.keys(v.apps).length > 0 && <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Where they listen{d.appDays && !span.all ? `, ${span.label}` : ""}</p><Bars items={top(v.apps)} /></div>}
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
