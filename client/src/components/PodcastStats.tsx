import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Headphones, Link2, Loader2, RefreshCw, Trophy, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { PodcastStatsData } from "@shared/schema";

type Source = "militaryvoices" | "buzzsprout" | "podbean" | "transistor" | "spotify";
interface SourceView { source: Source; showName: string; status: string; error: string; fetchedAt: string; data: PodcastStatsData | null }
interface StatsResponse { sources: SourceView[]; benchmark: { unit: string; avg: number; percentile: number; peers: number }[] }

const KEY = ["/api/host/podcast-stats"];
const NAME: Record<Source, string> = { militaryvoices: "MilitaryVoices", buzzsprout: "Buzzsprout", podbean: "Podbean", transistor: "Transistor", spotify: "Spotify" };
/** Each host's own mark, as a small badge (their site icon). */
const MARK: Record<Source, string> = {
  militaryvoices: "/icons/icon-192.png",
  buzzsprout: "https://www.google.com/s2/favicons?domain=buzzsprout.com&sz=64",
  podbean: "https://www.google.com/s2/favicons?domain=podbean.com&sz=64",
  transistor: "https://www.google.com/s2/favicons?domain=transistor.fm&sz=64",
  spotify: "https://www.google.com/s2/favicons?domain=podcasters.spotify.com&sz=64",
};
const COLOR: Record<Source, string> = { militaryvoices: "#053877", buzzsprout: "#1B1B1B", podbean: "#7ACB2F", transistor: "#2C3E50", spotify: "#1DB954" };
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n)));
const when = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
const MONTH = 30 * 86400000;

export function usePodcastStats() {
  return useQuery<StatsResponse>({ queryKey: KEY, queryFn: async () => (await apiRequest("GET", "/api/host/podcast-stats")).json(), staleTime: 5 * 60_000 });
}

function Badge({ source }: { source: Source }) {
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-black text-white" style={{ background: COLOR[source] }} aria-hidden>
      {source === "spotify" ? <Headphones className="h-5 w-5" /> : NAME[source][0]}
    </span>
  );
}

/**
 * Integrations → Podcast stats: connect Buzzsprout or Podbean with the
 * podcaster's own keys, or upload what Spotify for Creators exports.
 */
export function PodcastStatsRows({ Row }: { Row: (p: { icon: ReactNode; name: string; line: ReactNode; right: ReactNode; children?: ReactNode; testId?: string }) => JSX.Element }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const q = usePodcastStats();
  const [open, setOpen] = useState<Source | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const file = useRef<HTMLInputElement>(null);
  const done = () => { setForm({}); setOpen(null); void qc.invalidateQueries({ queryKey: KEY }); };
  const connect = useMutation({
    mutationFn: async (source: "buzzsprout" | "podbean" | "transistor") => (await apiRequest("POST", `/api/host/podcast-stats/${source}`, form)).json(),
    onSuccess: (r: SourceView) => { toast({ title: `${NAME[r.source]} connected`, description: r.showName || "Your numbers are in Your analytics." }); done(); },
    onError: (e: Error) => toast({ title: "Couldn't connect", description: e.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      const list = await Promise.all(Array.from(files).map(async (f) => ({ name: f.name, text: await f.text() })));
      return (await apiRequest("POST", "/api/host/podcast-stats/spotify", { files: list })).json();
    },
    onSuccess: (r: SourceView & { read: string[]; skipped: string[] }) => {
      toast({ title: "Spotify numbers added", description: `Read ${r.read.length} file${r.read.length === 1 ? "" : "s"}${r.skipped.length ? `; couldn't use ${r.skipped.join(", ")}` : ""}.` });
      done();
    },
    onError: (e: Error) => toast({ title: "Couldn't read those files", description: e.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
    onSettled: () => { if (file.current) file.current.value = ""; },
  });
  const remove = async (source: Source) => {
    if (!window.confirm(`Disconnect ${NAME[source]}? Its numbers leave Your analytics.`)) return;
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
  const right = (s: "buzzsprout" | "podbean" | "transistor") => {
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
      <Row testId="row-transistor" icon={<Badge source="transistor" />} name="Transistor" line={status(row("transistor"))} right={right("transistor")}>
        {open === "transistor" && (
          <form onSubmit={(e) => { e.preventDefault(); connect.mutate("transistor"); }} className="mt-4 grid gap-3 rounded-xl bg-muted/40 p-4 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
            {field("key", "API key", true)}
            {field("show", "Show (optional)")}
            <Button type="submit" disabled={connect.isPending || !form.key} className="h-9 gap-1.5 rounded-full">{connect.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Connect</Button>
            <p className="text-xs text-muted-foreground sm:col-span-3">In Transistor, open <span className="font-semibold text-foreground">Account → API</span> (top right, your name) and copy your API key. With more than one show, paste the show's RSS feed address (like feeds.transistor.fm/your-show) under Show. We read your download numbers only, and keep the key encrypted.</p>
          </form>
        )}
      </Row>
      <Row testId="row-podbean" icon={<Badge source="podbean" />} name="Podbean" line={status(row("podbean"))} right={right("podbean")}>
        {open === "podbean" && (
          <form onSubmit={(e) => { e.preventDefault(); connect.mutate("podbean"); }} className="mt-4 grid gap-3 rounded-xl bg-muted/40 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            {field("clientId", "Client ID")}
            {field("secret", "Client secret", true)}
            <Button type="submit" disabled={connect.isPending || !form.clientId || !form.secret} className="h-9 gap-1.5 rounded-full">{connect.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Connect</Button>
            <p className="text-xs text-muted-foreground sm:col-span-3">In your Podbean dashboard, go to <span className="font-semibold text-foreground">Settings → Advanced Options → AI &amp; Integrations</span>, turn the API on, then <span className="font-semibold text-foreground">Check API Credentials</span>. Podbean offers this on its Business plan. We read your download numbers only, and keep the secret encrypted.</p>
          </form>
        )}
      </Row>
      <Row
        testId="row-spotify"
        icon={<Badge source="spotify" />}
        name="Spotify"
        line={spotify ? <>{status(spotify)}{spotifyStale && <span className="font-semibold text-amber-700 dark:text-amber-400"> · time for this month's</span>}</> : "Upload what Spotify for Creators exports. About once a month."}
        right={
          <span className="flex items-center gap-1">
            <input ref={file} type="file" accept=".csv,text/csv" multiple className="hidden" onChange={(e) => e.target.files?.length && upload.mutate(e.target.files)} data-testid="input-spotify-csv" />
            <Button variant={spotifyStale ? "default" : "outline"} size="sm" className="h-8 gap-1 rounded-full px-3.5 text-xs" disabled={upload.isPending} onClick={() => file.current?.click()} data-testid="button-spotify-upload">
              {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {spotify ? "Update" : "Upload CSVs"}
            </Button>
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
export function PodcastChips({ onOpen }: { onOpen: () => void }) {
  const sources = usePodcastSources();
  return (
    <>
      {sources.map((s) => (
        <button key={s.source} type="button" onClick={onOpen} title={`${NAME[s.source]}: ${s.showName}. See your listens`} className="group flex shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1.5 text-left transition-colors hover:border-primary/40 hover:shadow-sm sm:gap-2.5 sm:px-3 sm:py-2" data-testid={`chip-podcast-${s.source}`}>
          {/* The show's cover, with the host's mark riding it, as the social accounts have theirs. */}
          <span className="relative shrink-0">
            {s.data!.artwork ? (
              <img src={s.data!.artwork} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-black text-white" style={{ background: COLOR[s.source] }} aria-hidden>{(s.showName || NAME[s.source])[0]}</span>
            )}
            <img src={MARK[s.source]} alt="" className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-white object-contain p-px ring-2 ring-card" />
          </span>
          <span className="min-w-0">
            <span className="hidden max-w-[9.5rem] truncate text-sm font-medium leading-tight text-foreground sm:block">{s.showName || NAME[s.source]}</span>
            <span className="block truncate text-xs font-semibold leading-tight text-foreground sm:font-normal sm:text-muted-foreground">{s.data!.total > 0 ? `${compact(s.data!.total)} ${s.data!.unit}` : NAME[s.source]}</span>
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
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState<string | null>(null);
  if (q.isLoading) return null;
  const sources = (q.data?.sources ?? []).filter((s) => s.data);
  if (!sources.length) {
    return (
      <div className={`${bare ? "" : "mb-6 "}flex flex-wrap items-center gap-4 rounded-2xl border border-dashed border-border p-5`} data-testid="podcast-listens-empty">
        <Headphones className="h-7 w-7 shrink-0 text-[#053877] dark:text-[#8ab4f8]" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">See your podcast's downloads here</p>
          <p className="text-sm text-muted-foreground">Connect Buzzsprout, Transistor or Podbean, or upload your Spotify numbers, and see where your show fits among MilitaryVoices podcasts.</p>
        </div>
        <Button variant="outline" className="gap-1.5 rounded-full" onClick={onConnect} data-testid="button-podcast-stats-connect"><Link2 className="h-4 w-4" /> Connect</Button>
      </div>
    );
  }
  const refresh = async (s: Source) => {
    setRefreshing(s);
    try { await apiRequest("POST", `/api/host/podcast-stats/${s}/refresh`); await qc.invalidateQueries({ queryKey: KEY }); } finally { setRefreshing(null); }
  };
  return (
    <section className={`${bare ? "" : "mb-6 "}space-y-4`} data-testid="podcast-listens">
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
      {sources.map((s) => {
        const d = s.data!;
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
          <div key={s.source} className="rounded-2xl border border-border bg-card p-5" data-testid={`listens-${s.source}`}>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Badge source={s.source} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground">{NAME[s.source]}{s.showName ? <span className="font-normal text-muted-foreground"> · {s.showName}</span> : null}</p>
                <p className="text-xs text-muted-foreground">
                  {s.source === "spotify" ? `Uploaded ${when(s.fetchedAt)}` : `Updated ${when(s.fetchedAt)}`}
                  {stale && <span className="font-semibold text-amber-700 dark:text-amber-400"> · a month old: upload this month's in Integrations</span>}
                  {s.status === "failed" && <span className="text-destructive"> · {s.error}</span>}
                </p>
              </div>
              {s.source !== "spotify" && s.source !== "militaryvoices" && (
                <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => void refresh(s.source)} disabled={refreshing === s.source}>
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing === s.source ? "animate-spin" : ""}`} /> Refresh
                </Button>
              )}
            </div>
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
  const q = useQuery<{ shows: { show: { id: number; title: string; artworkUrl?: string; directories?: string; appleUrl?: string; spotifyUrl?: string } }[] }>({
    queryKey: ["/api/host/hosting"],
    queryFn: async () => (await apiRequest("GET", "/api/host/hosting")).json(),
    staleTime: 60_000,
  });
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
