import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { durationOf, uploadToStorage } from "@/lib/upload";
import { GuestFinder, ShowFinder } from "@/components/DiscoverPodcasts";
import type { HostedEpisodeRow, HostedShowRow, RecordingRow } from "@shared/schema";
import { AlertCircle, BarChart3, Check, ChevronLeft, Copy, ExternalLink, Film, ImagePlus, Loader2, Mic2, Pencil, Plus, Podcast, Radio, Send, Trash2, Upload } from "lucide-react";

/**
 * Podcast: the show hosted on MilitaryVoices. A feed Apple, Spotify and every
 * app read; episodes from an audio file or a clean episode in the Library;
 * downloads counted the way sponsors count them. The numbers flow into the
 * Dashboard, Your analytics and the profile sponsors see.
 */

type Ep = HostedEpisodeRow & { downloads: number; live: boolean };
type Hosted = { show: HostedShowRow; feedUrl: string; missing: string[]; ownerConfirmed: boolean; episodes: Ep[]; stats: { total: number; last30: number; series: { date: string; count: number }[]; apps: Record<string, number> } };
type Resp = { shows: Hosted[]; categories: Record<string, string[]> };

const KEY = ["/api/host/hosting"];
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));
const hms = (sec: number) => { const s = Math.round(sec); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const dateOf = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

export function PodcastHosting() {
  const { toast } = useToast();
  const qc = useQueryClient();
  // While an episode's audio is being made, check back every few seconds.
  const q = useQuery<Resp>({ queryKey: KEY, queryFn: async () => (await apiRequest("GET", "/api/host/hosting")).json(), refetchInterval: (qq) => ((qq.state.data as Resp | undefined)?.shows.some((x) => x.episodes.some((e) => e.audioJob === "queued" || e.audioJob === "running")) ? 5000 : false) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: KEY }); void qc.invalidateQueries({ queryKey: ["/api/host/podcast-stats"] }); };
  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/host/hosting/shows", {})).json(),
    onSuccess: (r: { id?: number }) => { refresh(); if (r?.id) { setOpenId(r.id); go("details"); } },
    onError: (e: Error) => toast({ title: "Couldn't set that up", description: e.message, variant: "destructive" }),
  });
  // Which show is open (none: the grid of shows), and which of its tabs.
  const [openId, setOpenId] = useState<number | null>(null);
  const [tab, setTab] = useState<PodTab>(() => { try { const t = localStorage.getItem("mv_pod_tab"); return t === "directories" || t === "details" || t === "guests" || t === "pitch" ? t : "episodes"; } catch { return "episodes"; } });
  const go = (t: PodTab) => { setTab(t); try { localStorage.setItem("mv_pod_tab", t); } catch { /* fine */ } };
  // The field Show details opens on (from the checklist): the description, the name, the owner email.
  const [focus, setFocus] = useState<"" | "title" | "description" | "ownerEmail">("");
  const [adding, setAdding] = useState(false);
  const [newShow, setNewShow] = useState(false);
  const [editEp, setEditEp] = useState<Ep | null>(null);
  // From the Library ("Add to my podcast"): ?ep=<id> opens that episode, ready for its words.
  const [wantEp, setWantEp] = useState<number | null>(() => { try { return Number(new URLSearchParams(window.location.search).get("ep")) || null; } catch { return null; } });
  useEffect(() => {
    if (!wantEp || !q.data) return;
    const host = q.data.shows.find((x) => x.episodes.some((e) => e.id === wantEp));
    const ep = host?.episodes.find((e) => e.id === wantEp);
    if (host && ep) { setOpenId(host.show.id); go("episodes"); setEditEp(ep); }
    setWantEp(null);
    try { const u = new URL(window.location.href); u.searchParams.delete("ep"); window.history.replaceState(null, "", u.pathname + u.search); } catch { /* fine */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantEp, q.data]);

  if (q.isLoading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const shows = q.data?.shows ?? [];

  if (!shows.length) {
    return (
      <section className="mt-2" data-testid="podcast-hosting">
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#053877] text-[#F0A71F]"><Podcast className="h-7 w-7" /></span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Host your podcast on MilitaryVoices</h1>
          <p className="mx-auto mt-2 max-w-xl text-balance text-muted-foreground">Your show's feed for Apple Podcasts, Spotify and every other app, with your downloads counted the way sponsors count them, and shown on your profile.</p>
          <ul className="mx-auto mt-5 grid max-w-2xl gap-3 text-left text-sm sm:grid-cols-3">
            {[
              [Upload, "Publish from anywhere", "Upload the audio or the video, or use a recording from your Library."],
              [Radio, "One feed, every app", "List it on Apple, Spotify and the rest once; new episodes go out on their own."],
              [BarChart3, "Downloads sponsors trust", "Counted once per listener a day, bots left out, by app and episode."],
            ].map(([I, t, d]) => {
              const Icon = I as typeof Upload;
              return (
                <li key={t as string} className="rounded-xl border border-border p-3">
                  <Icon className="h-4 w-4 text-[#053877] dark:text-[#8fb5e8]" />
                  <p className="mt-1.5 font-semibold">{t as string}</p>
                  <p className="text-xs text-muted-foreground">{d as string}</p>
                </li>
              );
            })}
          </ul>
          <Button onClick={() => create.mutate()} disabled={create.isPending} className="mt-6 h-11 gap-2 rounded-full bg-[#053877] px-6 text-white hover:bg-[#0a4a99]" data-testid="hosting-start">
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Set up your show
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">Free while you're a MilitaryVoices podcaster.</p>
        </div>
        <ImportShow onDone={refresh} />
      </section>
    );
  }

  // One show opens straight to it; more than one starts on the grid.
  const h = shows.find((x) => x.show.id === openId) ?? (shows.length === 1 ? shows[0] : undefined);
  const addShowDialog = (
    <Dialog open={newShow} onOpenChange={setNewShow}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a show</DialogTitle>
          <DialogDescription>Start a new one here, or move one you host somewhere else.</DialogDescription>
        </DialogHeader>
        <Button onClick={() => create.mutate(undefined, { onSuccess: () => setNewShow(false) })} disabled={create.isPending} className="h-11 gap-2 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="hosting-new-show">{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Start a new show</Button>
        <ImportShow onDone={() => { setNewShow(false); refresh(); }} />
      </DialogContent>
    </Dialog>
  );

  if (!h) {
    return (
      <section className="mt-2" data-testid="podcast-hosting">
        <h1 className="text-2xl font-bold tracking-tight">Your shows</h1>
        <p className="mt-1 text-sm text-muted-foreground">Each one has its own feed for Apple, Spotify and every podcast app.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="hosting-shows">
          {shows.map((x) => {
            const live = x.episodes.filter((e) => e.live).length;
            const listed = Object.values(parseDirs(x.show.directories)).filter((d) => d.state === "live").length;
            return (
              <button key={x.show.id} type="button" onClick={() => setOpenId(x.show.id)} className="group overflow-hidden rounded-2xl border border-border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#053877]/40 hover:shadow-md" data-testid={`hosting-show-${x.show.id}`}>
                <div className="aspect-square w-full bg-muted">{x.show.artworkUrl ? <img src={x.show.artworkUrl} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-muted-foreground"><Podcast className="h-10 w-10" /></span>}</div>
                <div className="p-4">
                  <p className="line-clamp-2 text-balance font-semibold leading-snug group-hover:text-[#053877] dark:group-hover:text-[#8fb5e8]">{x.show.title || "Untitled show"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{live} {live === 1 ? "episode" : "episodes"} out{x.stats.last30 ? ` · ${compact(x.stats.last30)} downloads this month` : ""}</p>
                  <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${listed ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : x.missing.length ? "bg-[#F0A71F]/20 text-[#8a5a00] dark:text-[#F0A71F]" : "bg-[#053877]/10 text-[#053877] dark:text-[#8fb5e8]"}`}>{listed ? `Listed on ${listed} ${listed === 1 ? "app" : "apps"}` : x.missing.length ? "Getting set up" : "Ready to list"}</span>
                </div>
              </button>
            );
          })}
          <button type="button" onClick={() => setNewShow(true)} className="flex min-h-[16rem] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-[#053877]/40 hover:text-[#053877] dark:hover:text-[#8fb5e8]" data-testid="hosting-add-show">
            <Plus className="h-7 w-7" /><span className="font-semibold">Add a show</span>
          </button>
        </div>
        {addShowDialog}
      </section>
    );
  }

  const s = h.show;
  const ready = h.missing.length === 0;
  // Each thing the apps need, one tap from where it's added.
  const fix = (m: string) => {
    if (/cover art/i.test(m)) return document.getElementById(`hosting-art-input-${s.id}`)?.click();
    if (/published episode/i.test(m)) { go("episodes"); return setAdding(true); }
    if (/confirm the owner/i.test(m)) return document.getElementById("hosting-owner")?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFocus(/description/i.test(m) ? "description" : /show name/i.test(m) ? "title" : /owner email/i.test(m) ? "ownerEmail" : "");
    go("details");
  };
  const tabBtn = (t: PodTab, label: string) => (
    <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => go(t)} className={`border-b-2 px-1 pb-2.5 text-sm font-semibold transition-colors ${tab === t ? "border-[#053877] text-foreground dark:border-[#8fb5e8]" : "border-transparent text-muted-foreground hover:text-foreground"}`} data-testid={`hosting-tab-${t}`}>{label}</button>
  );

  return (
    <section className="mt-2 space-y-4" data-testid="podcast-hosting">
      {shows.length > 1 && <button type="button" onClick={() => setOpenId(null)} className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground" data-testid="hosting-all-shows"><ChevronLeft className="h-4 w-4" /> All shows</button>}
      {/* The show: its art, its name, its feed. */}
      <div className="flex flex-wrap items-start gap-5">
        <ArtworkButton show={s} onDone={refresh} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Your podcast</p>
          <h1 className="mt-0.5 text-balance text-2xl font-bold tracking-tight">{s.title}</h1>
          <div id="hosting-owner"><OwnerEmail h={h} onDone={refresh} /></div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <FeedLink url={h.feedUrl} />
            {h.episodes.some((e) => e.live) && <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 rounded-full"><a href={`/podcast/${s.slug}`} target="_blank" rel="noreferrer" data-testid="hosting-public-page">Your show page <ExternalLink className="h-3 w-3" /></a></Button>}
          </div>
        </div>
        {shows.length === 1 && <button type="button" onClick={() => setNewShow(true)} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-[#053877] hover:bg-[#053877]/5 dark:text-[#8fb5e8]" data-testid="hosting-add-show"><Plus className="h-3.5 w-3.5" /> Add a show</button>}
      </div>

      <div className="flex gap-6 overflow-x-auto whitespace-nowrap border-b border-border [scrollbar-width:none]" role="tablist">
        {tabBtn("episodes", "Episodes")}
        {tabBtn("directories", ready ? "Directories" : "Directories · to do")}
        {tabBtn("details", "Show details")}
        {tabBtn("guests", "Book a guest")}
        {tabBtn("pitch", "Be a guest")}
      </div>

      {s.newFeedUrl && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/[0.05] p-4 text-sm" data-testid="hosting-leaving">
          <span className="font-semibold">This show is moving to another host.</span> The feed forwards apps to <span className="font-mono text-xs">{s.newFeedUrl}</span>. Clear it in Show details to stay.
        </div>
      )}

      {tab === "episodes" && (
        <>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold"><Mic2 className="h-4 w-4 text-[#053877] dark:text-[#8fb5e8]" /> Episodes</h2>
                <p className="text-xs text-muted-foreground">{compact(h.stats.last30)} downloads in the last 30 days · {compact(h.stats.total)} in all</p>
              </div>
              <Button onClick={() => setAdding(true)} className="h-9 gap-1.5 rounded-lg bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="hosting-new-episode"><Plus className="h-4 w-4" /> New episode</Button>
            </div>
            {h.episodes.length ? (
              <ul className="divide-y divide-border">
                {h.episodes.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 py-2.5" data-testid={`hosting-episode-${e.id}`}>
                    <EpisodeArt ep={e} fallback={s.artworkUrl} onDone={refresh} />
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.audioJob === "failed" ? "bg-destructive/10 text-destructive" : e.audioJob ? "bg-[#F0A71F]/20 text-[#8a5a00] dark:text-[#F0A71F]" : e.live ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : e.status === "published" ? "bg-[#053877]/10 text-[#053877] dark:text-[#8fb5e8]" : "bg-muted text-muted-foreground"}`}>
                      {e.audioJob === "failed" ? "Audio failed" : e.audioJob ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Preparing audio</span> : e.live ? "Live" : e.status === "published" ? "Scheduled" : "Draft"}
                    </span>
                    <button type="button" onClick={() => setEditEp(e)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-medium">{e.episodeNumber != null ? `${e.episodeNumber}. ` : ""}{e.title}</span>
                      <span className="block text-xs text-muted-foreground">{e.publishedAt ? dateOf(e.publishedAt) : "Not published"}{e.durationSec ? ` · ${hms(e.durationSec)}` : ""}{e.youtube ? " · on YouTube" : ""}</span>
                    </button>
                    <span className="hidden w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block"><b className="text-foreground">{compact(e.downloads)}</b> downloads</span>
                    <Button size="sm" variant="outline" className="h-8 shrink-0 rounded-full" onClick={() => setEditEp(e)}>{e.status === "draft" ? "Publish" : "Edit"}</Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">No episodes yet. Add your first: upload the audio or the video, or use a recording from your Library.</p>
            )}
          </div>
        </>
      )}

      {tab === "directories" && (
        <>
          {!ready ? (
            <div className="max-w-2xl rounded-xl border border-[#F0A71F]/40 bg-[#F0A71F]/[0.07] p-3.5" data-testid="hosting-missing">
              <p className="flex items-center gap-2 text-sm font-semibold"><AlertCircle className="h-4 w-4 text-[#b36b00]" /> First, what the apps need
                <a href="/help/podcast#ready" target="_blank" rel="noreferrer" className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[11px] font-bold text-[#b36b00] hover:bg-[#F0A71F]/20" title="How your show gets to Apple and Spotify" aria-label="How your show gets to Apple and Spotify">?</a>
              </p>
              <ul className="mt-2 space-y-1">
                {h.missing.map((m) => (
                  <li key={m}>
                    <button type="button" onClick={() => fix(m)} className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground/85 transition-colors hover:bg-[#F0A71F]/15" data-testid="hosting-missing-item">
                      <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-[#b36b00]/60" />
                      <span className="min-w-0 flex-1">{m}</span>
                      <span className="shrink-0 text-xs font-semibold text-[#b36b00] opacity-70 group-hover:opacity-100">Add it →</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {/* A moved show is in the apps already, by its old feed: forwarding that feed moves them all here. */}
          {s.importedFrom && <MoveSubscribers h={h} onDone={refresh} />}
          <Directories h={h} ready={ready} onSaved={refresh} />
          <YouTubeEpisodes h={h} onDone={refresh} />
        </>
      )}

      {tab === "guests" && <GuestFinder showTitle={s.title} />}
      {tab === "pitch" && <ShowFinder topics={[s.category, s.subcategory].filter(Boolean) as string[]} />}

      {tab === "details" && <ShowForm key={s.id} show={s} focus={focus} categories={q.data?.categories ?? {}} onSaved={() => { refresh(); setFocus(""); }} onDeleted={() => { setOpenId(null); refresh(); }} />}

      {addShowDialog}
      <NewEpisodeDialog open={adding} onClose={() => setAdding(false)} show={s} onCreated={(e) => { refresh(); setAdding(false); setEditEp({ ...e, downloads: 0, live: false }); }} />
      <EpisodeDialog ep={editEp} onClose={() => setEditEp(null)} onSaved={refresh} />
    </section>
  );
}

type PodTab = "episodes" | "directories" | "details" | "guests" | "pitch";
type DirState = { state: "" | "submitted" | "live"; url: string; at?: string };
const parseDirs = (raw: string | null | undefined): Record<string, DirState> => { try { const v = raw ? JSON.parse(raw) : {}; return v && typeof v === "object" ? v : {}; } catch { return {}; } };

/**
 * The podcast apps, each listed once from the feed: where to go, the few steps there, and the
 * show's link once it's live (Apple's and Spotify's also fill the follow buttons everywhere).
 */
/** Where to search each app for the show, to find its page once it's approved. */
const FIND: Record<string, (t: string) => string> = {
  apple: (t) => `https://podcasts.apple.com/us/search?term=${encodeURIComponent(t)}`,
  spotify: (t) => `https://open.spotify.com/search/${encodeURIComponent(t)}/podcasts`,
  youtube: (t) => `https://music.youtube.com/search?q=${encodeURIComponent(t)}`,
  amazon: (t) => `https://music.amazon.com/search/${encodeURIComponent(t)}?filter=IsLibrary%7Cfalse&sc=none`,
  iheart: (t) => `https://www.iheart.com/search/?q=${encodeURIComponent(t)}`,
  pocketcasts: (t) => `https://pocketcasts.com/search?q=${encodeURIComponent(t)}`,
  podcastindex: (t) => `https://podcastindex.org/search?q=${encodeURIComponent(t)}&type=all`,
};
const DIRS: { key: string; name: string; reach: string; url: string; steps: string[]; link: string }[] = [
  { key: "apple", name: "Apple Podcasts", reach: "Apple Podcasts, and the apps that read Apple's list (Overcast, Castro)", url: "https://podcastsconnect.apple.com/my-podcasts/new-feed", steps: ["Sign in with your Apple ID.", "Choose to add a show with an RSS feed, and paste your feed (it's copied).", "Submit. Apple reviews it, usually in a day or two, and writes to your owner email."], link: "https://podcasts.apple.com/…" },
  { key: "spotify", name: "Spotify", reach: "Spotify", url: "https://creators.spotify.com/pod/dashboard/import", steps: ["Sign in to Spotify for Creators.", "Pick the option to add an existing podcast, and paste your feed.", "Spotify emails a code to your owner email: type it in. It's live within hours."], link: "https://open.spotify.com/show/…" },
  { key: "youtube", name: "YouTube Music", reach: "YouTube and YouTube Music, as an audio podcast", url: "https://studio.youtube.com", steps: ["Open YouTube Studio on your channel.", "Create, then New podcast, then submit an RSS feed. Paste your feed.", "Confirm with the code YouTube emails to your owner email."], link: "https://music.youtube.com/playlist?list=…" },
  { key: "amazon", name: "Amazon Music & Audible", reach: "Amazon Music, Audible and Alexa", url: "https://podcasters.amazon.com/", steps: ["Sign in with an Amazon account.", "Add your podcast and paste your feed.", "Confirm with the code sent to your owner email."], link: "https://music.amazon.com/podcasts/…" },
  { key: "iheart", name: "iHeartRadio", reach: "iHeartRadio", url: "https://www.iheart.com/content/submit-your-podcast/", steps: ["Open iHeart's podcast submission page and sign in.", "Paste your feed and submit."], link: "https://www.iheart.com/podcast/…" },
  { key: "pocketcasts", name: "Pocket Casts", reach: "Pocket Casts", url: "https://pocketcasts.com/submit/", steps: ["Paste your feed and press Submit. No account needed."], link: "https://pca.st/…" },
  { key: "podcastindex", name: "Podcast Index", reach: "Dozens of newer apps (Fountain, Podverse, Castamatic and more)", url: "https://podcastindex.org/add", steps: ["Paste your feed and press Submit. That's all."], link: "https://podcastindex.org/podcast/…" },
];

function Directories({ h, ready, onSaved }: { h: Hosted; ready: boolean; onSaved: () => void }) {
  const { toast } = useToast();
  const s = h.show;
  const moved = !!s.importedFrom;
  // A moved show: bring its cover art over and find its Apple listing, once.
  const looked = useRef(0);
  useEffect(() => {
    if (!moved || looked.current === s.id) return;
    looked.current = s.id;
    void apiRequest("POST", `/api/host/hosting/shows/${s.id}/listings`, {}).then(() => onSaved()).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moved, s.id]);
  const dirs = parseDirs(s.directories);
  // Apple's and Spotify's links may already be in from before.
  if (s.appleUrl && !dirs.apple?.url) dirs.apple = { state: "live", url: s.appleUrl };
  if (s.spotifyUrl && !dirs.spotify?.url) dirs.spotify = { state: "live", url: s.spotifyUrl };
  const [open, setOpen] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: async (next: Record<string, DirState>) => (await apiRequest("PATCH", `/api/host/hosting/shows/${s.id}`, { directories: next })).json(),
    onSuccess: onSaved,
    onError: (e: Error) => toast({ title: "Couldn't save that", description: e.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  const put = (key: string, v: DirState | null) => { const next = { ...dirs }; if (v) next[key] = v; else delete next[key]; save.mutate(next); };
  const listIt = async (d: (typeof DIRS)[number]) => {
    await navigator.clipboard.writeText(h.feedUrl).catch(() => {});
    window.open(d.url, "_blank", "noopener");
    setOpen(d.key);
    if (!dirs[d.key]?.state) put(d.key, { state: "submitted", url: "", at: new Date().toISOString() });
    toast({ title: "Your feed is copied", description: `Paste it into ${d.name}.` });
  };
  const listed = DIRS.filter((d) => dirs[d.key]?.state === "live").length;
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm" data-testid="hosting-directories">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Where your show is listed</h2>
          <p className="text-xs text-muted-foreground">{moved ? "Your show is in these already, by your old feed: forwarding it (above) moves each one here. List it only where it isn't yet." : "List it once in each; new episodes reach them on their own."} {listed ? `Live on ${listed} of ${DIRS.length}.` : ""}</p>
        </div>
        <FeedLink url={h.feedUrl} />
      </div>
      <ul className="divide-y divide-border">
        {DIRS.map((d) => {
          const st = dirs[d.key];
          const isOpen = open === d.key;
          return (
            <li key={d.key} className="py-3" data-testid={`hosting-dir-${d.key}`}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#053877]/10 text-sm font-bold text-[#053877] dark:bg-white/10 dark:text-[#8fb5e8]">{d.name[0]}</span>
                <button type="button" onClick={() => setOpen(isOpen || st?.state === "submitted" ? `-${d.key}` : d.key)} className="min-w-0 flex-1 text-left">
                  <span className="block text-sm font-semibold">{d.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{d.reach}</span>
                </button>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st?.state === "live" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : st?.state === "submitted" ? "bg-[#F0A71F]/20 text-[#8a5a00] dark:text-[#F0A71F]" : "bg-muted text-muted-foreground"}`}>{st?.state === "live" ? (moved && !s.redirectOk ? "Live, by your old feed" : "Live") : st?.state === "submitted" ? "Submitted" : moved ? "Moves with your forward" : "Not listed"}</span>
                {st?.state === "live" ? (st.url
                  ? <Button asChild size="sm" variant="outline" className="h-8 gap-1 rounded-full"><a href={st.url} target="_blank" rel="noreferrer">Open <ExternalLink className="h-3 w-3" /></a></Button>
                  : <Button size="sm" variant="outline" onClick={() => setOpen(d.key)} className="h-8 rounded-full">Add its link</Button>
                ) : (
                  <Button size="sm" variant={moved ? "outline" : "default"} onClick={() => void listIt(d)} disabled={!ready} title={ready ? undefined : "Finish what the apps need first (above)"} className={`h-8 gap-1 rounded-full ${moved ? "" : "bg-[#053877] text-white hover:bg-[#0a4a99]"}`} data-testid={`hosting-dir-list-${d.key}`}>{st?.state === "submitted" ? "Open again" : moved ? "Not there? List it" : "List it"} <ExternalLink className="h-3 w-3" /></Button>
                )}
              </div>
              {(isOpen || (st?.state === "submitted" && open !== `-${d.key}`)) && (
                <div className="ml-12 mt-2 space-y-2 text-sm">
                  <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">{d.steps.map((x) => <li key={x}>{x}</li>)}</ol>
                  <p className="text-xs text-muted-foreground">Approved (usually a few days)? <a href={FIND[d.key]?.(s.title) ?? d.url} target="_blank" rel="noreferrer" className="font-semibold text-[#053877] underline dark:text-[#8fb5e8]">Find it on {d.name}</a>, open your show there, and copy its address into the box. The link is optional: it adds a {d.name} button to your show page.</p>
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    const u = (links[d.key] ?? st?.url ?? "").trim();
                    // Their own feed isn't the app's page for the show.
                    if (/militaryvoices\.ai/i.test(u)) return toast({ title: "That's your feed", description: `Paste your show's page on ${d.name} (like ${d.link}), or leave the box empty.` });
                    if (u && !/^https:\/\//.test(u)) return toast({ title: "Paste the whole link", description: `It starts with https:// (like ${d.link}).` });
                    put(d.key, { state: "live", url: u, at: new Date().toISOString() });
                    setOpen(null);
                    setLinks((x) => { const n = { ...x }; delete n[d.key]; return n; });
                    toast({ title: `${d.name}: live`, description: u ? "Its button is on your show page now." : "Add its link any time." });
                  }} className="flex flex-wrap gap-2">
                    <Input value={links[d.key] ?? st?.url ?? ""} onChange={(e) => setLinks((x) => ({ ...x, [d.key]: e.target.value }))} placeholder={`Your show on ${d.name}: ${d.link}`} className="h-9 min-w-0 flex-1 text-xs" data-testid={`hosting-dir-link-${d.key}`} />
                    <Button type="submit" size="sm" variant="outline" className="h-9 rounded-lg" data-testid={`hosting-dir-live-${d.key}`}>It's live</Button>
                    {st && <button type="button" onClick={() => { put(d.key, null); setOpen(null); }} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Reset</button>}
                  </form>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Episodes to their YouTube channel as videos (Upload-Post; their channel is connected on the Social screen). */
function YouTubeEpisodes({ h, onDone }: { h: Hosted; onDone: () => void }) {
  const { toast } = useToast();
  const [privacy, setPrivacy] = useState<"public" | "unlisted">("public");
  const [busy, setBusy] = useState<number | null>(null);
  const videos = h.episodes.filter((e) => (e.mime.startsWith("video/") && e.audioKey) || e.recordingId);
  const post = async (e: Ep) => {
    setBusy(e.id);
    try {
      await apiRequest("POST", `/api/host/hosting/episodes/${e.id}/youtube`, { privacy });
      toast({ title: "On its way to YouTube", description: "It uploads in the next few minutes. Its status is on the Social screen." });
      onDone();
    } catch (err) {
      const msg = (err as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "");
      toast({ title: /Social screen/.test(msg) ? "Connect YouTube first" : "Not posted", description: msg, variant: /Social screen/.test(msg) ? undefined : "destructive" });
    } finally { setBusy(null); }
  };
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm" data-testid="hosting-youtube">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Your episodes as videos on YouTube</h2>
          <p className="text-xs text-muted-foreground">Posted to your channel with their title, notes and picture. Your channel is connected on the <a href="/host/dashboard/social" className="font-semibold text-[#053877] underline dark:text-[#8fb5e8]">Social</a> screen.</p>
        </div>
        <select value={privacy} onChange={(e) => setPrivacy(e.target.value as "public")} className="h-9 rounded-md border border-input bg-background px-2 text-sm" aria-label="Who can see it">
          <option value="public">Public</option>
          <option value="unlisted">Unlisted (only with the link)</option>
        </select>
      </div>
      {videos.length ? (
        <ul className="mt-2 divide-y divide-border">
          {videos.map((e) => {
            let yt: { at?: string } = {};
            try { yt = e.youtube ? JSON.parse(e.youtube) : {}; } catch { yt = {}; }
            return (
              <li key={e.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{e.title}</span><span className="block text-xs text-muted-foreground">{yt.at ? `Sent to YouTube ${dateOf(yt.at)}` : "Not on YouTube yet"}</span></span>
                <Button size="sm" variant="outline" onClick={() => void post(e)} disabled={busy != null} className="h-8 gap-1.5 rounded-full" data-testid={`hosting-yt-${e.id}`}>{busy === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {yt.at ? "Post again" : "Post to YouTube"}</Button>
              </li>
            );
          })}
        </ul>
      ) : <p className="mt-2 text-sm text-muted-foreground">Episodes made from a video (an MP4 you upload, or a Library recording) can go to YouTube too. This show's are audio only so far.</p>}
    </div>
  );
}

/** Move a show here from its old host: its feed brings every episode, with their IDs, so no app plays one twice. */
function ImportShow({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const go = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/host/hosting/import", { feedUrl: url.trim() })).json() as Promise<{ episodes: number }>,
    onSuccess: (r) => { toast({ title: "Your show is here", description: `${r.episodes} episode${r.episodes === 1 ? "" : "s"} moved over. Next: forward your old feed so your subscribers follow.` }); onDone(); },
    onError: (e: Error) => toast({ title: "Couldn't move that show", description: e.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  return (
    <div className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-sm" data-testid="hosting-import">
      <p className="font-semibold">Already hosted somewhere else? Move your show here</p>
      <p className="mt-0.5 text-sm text-muted-foreground">Paste your show's RSS feed. We bring every episode, its notes and its artwork. Your subscribers follow once your old host forwards the feed (we'll show you how).</p>
      <form onSubmit={(e) => { e.preventDefault(); go.mutate(); }} className="mt-3 flex flex-wrap gap-2">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://feeds.yourhost.com/your-show" className="h-10 min-w-0 flex-1" data-testid="hosting-import-url" />
        <Button type="submit" disabled={go.isPending || !/^https?:\/\//.test(url.trim())} className="h-10 gap-1.5 rounded-lg bg-[#053877] text-white hover:bg-[#0a4a99]">{go.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Moving…</> : "Move my show"}</Button>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">It's in your old host's settings, often under Distribution or RSS. Buzzsprout, Libsyn, Transistor, Podbean, RSS.com, Spotify for Creators and the rest all have one.</p>
    </div>
  );
}

/** After a move: forward the old feed (a 301) so Apple, Spotify and every app move the subscribers, then check it took. */
function MoveSubscribers({ h, onDone }: { h: Hosted; onDone: () => void }) {
  const { toast } = useToast();
  const s = h.show;
  const check = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/host/hosting/shows/${s.id}/redirect-check`, {})).json() as Promise<{ ok: boolean; tagged: boolean; hops: { url: string; status: number }[] }>,
    onSuccess: (r) => {
      onDone();
      toast(r.ok ? { title: "Forwarding works", description: "Your old feed sends apps here. Subscribers move over as each app checks in, usually within a few days." } : r.tagged ? { title: "Almost", description: "Your old feed names the new address, but doesn't forward yet. Turn on the redirect (301) at your old host too." } : { title: "Not forwarding yet", description: `Your old feed still answers itself (${r.hops.map((x) => x.status).join(" → ") || "no answer"}). Turn on the redirect at your old host, then check again.`, variant: "destructive" });
    },
    onError: (e: Error) => toast({ title: "Couldn't check", description: e.message, variant: "destructive" }),
  });
  const { toast: t2 } = useToast();
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${s.redirectOk ? "border-emerald-500/40 bg-emerald-500/[0.05]" : "border-[#053877]/25 bg-card"}`} data-testid="hosting-move">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-semibold">{s.redirectOk ? <><Check className="h-4 w-4 text-emerald-600" /> Your subscribers are following</> : "Bring your subscribers with you"}</p>
          {s.redirectOk ? (
            <p className="mt-1 text-sm text-muted-foreground">Your old feed forwards here{s.redirectCheckedAt ? ` (checked ${dateOf(s.redirectCheckedAt)})` : ""}. Keep your old host's account open for four weeks while every app catches up, then you can close it.</p>
          ) : (
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm">
              <li>At your old host, find <b>Redirect feed</b>, <b>301 redirect</b> or <b>Move to a new host</b> (usually in the show's settings, under RSS or Distribution).</li>
              <li>Paste your new feed address: <button type="button" onClick={() => navigator.clipboard.writeText(h.feedUrl).then(() => t2({ title: "Copied" }))} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-muted/70">{h.feedUrl.replace(/^https:\/\//, "")} <Copy className="h-3 w-3" /></button></li>
              <li>Save, then press <b>Check the redirect</b>. Keep the old account open for four weeks while the apps catch up.</li>
            </ol>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Old feed: <span className="font-mono">{s.importedFrom}</span></p>
        </div>
        <Button variant="outline" onClick={() => check.mutate()} disabled={check.isPending} className="h-9 gap-1.5 rounded-full" data-testid="hosting-redirect-check">{check.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />} Check the redirect</Button>
      </div>
    </div>
  );
}

/** The owner email: Apple and Spotify send their confirmation there, so only a confirmed one goes in the feed. */
function OwnerEmail({ h, onDone }: { h: Hosted; onDone: () => void }) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const s = h.show;
  const send = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/host/hosting/shows/${s.id}/owner-email/send`, {})).json(),
    onSuccess: () => { setSent(true); toast({ title: "Code sent", description: `Check ${s.ownerEmail}.` }); },
    onError: (e: Error) => toast({ title: "Couldn't send it", description: e.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  const confirm = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/host/hosting/shows/${s.id}/owner-email/confirm`, { code })).json(),
    onSuccess: () => { setSent(false); setCode(""); toast({ title: "Email confirmed", description: "It's in your feed now." }); onDone(); },
    onError: (e: Error) => toast({ title: "Not confirmed", description: e.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  if (!s.ownerEmail) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" data-testid="hosting-owner">
      <span className="text-muted-foreground">Owner email</span>
      <span className="font-medium">{s.ownerEmail}</span>
      {h.ownerConfirmed ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-400"><Check className="h-3 w-3" /> Confirmed</span>
      ) : sent ? (
        <form onSubmit={(e) => { e.preventDefault(); confirm.mutate(); }} className="flex items-center gap-1.5">
          <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="6-digit code" className="h-7 w-28 text-xs" autoFocus />
          <Button type="submit" size="sm" disabled={code.length !== 6 || confirm.isPending} className="h-7 rounded-full px-3 text-xs">Confirm</Button>
          <button type="button" onClick={() => send.mutate()} className="text-muted-foreground underline">Resend</button>
        </form>
      ) : (
        <>
          <span className="rounded-full bg-[#F0A71F]/20 px-2 py-0.5 font-semibold text-[#8a5a00] dark:text-[#F0A71F]">Not confirmed</span>
          <button type="button" onClick={() => send.mutate()} disabled={send.isPending} className="font-semibold text-[#053877] underline dark:text-[#8fb5e8]" data-testid="hosting-owner-send">{send.isPending ? "Sending…" : "Send me a code"}</button>
        </>
      )}
    </div>
  );
}

function FeedLink({ url }: { url: string }) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => navigator.clipboard.writeText(url).then(() => toast({ title: "Feed address copied", description: "Paste it into Apple Podcasts Connect or Spotify for Creators." }))} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium hover:bg-muted" title="Copy your RSS feed address" data-testid="hosting-feed">
      <Radio className="h-3.5 w-3.5 shrink-0 text-[#b36b00]" /> <span className="truncate">{url.replace(/^https:\/\//, "")}</span> <Copy className="h-3 w-3 shrink-0 text-muted-foreground" />
    </button>
  );
}

/** An episode's picture: the still from its video (made for it), or one they choose. */
function EpisodeArt({ ep, fallback, onDone }: { ep: Ep; fallback: string; onDone: () => void }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const go = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/host/hosting/episodes/${ep.id}/artwork`, { method: "POST", body: fd, credentials: "include" });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { message?: string }).message || "Couldn't use that image.");
      onDone();
    } catch (e) {
      toast({ title: "Picture not changed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const src = ep.artworkUrl || fallback;
  return (
    <>
      <input ref={input} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => e.target.files?.[0] && void go(e.target.files[0])} />
      <button type="button" onClick={() => input.current?.click()} disabled={busy} className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-muted" title="The episode's picture. Tap to change it." data-testid={`hosting-episode-art-${ep.id}`}>
        {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-muted-foreground"><ImagePlus className="h-4 w-4" /></span>}
        <span className={`absolute inset-0 flex items-center justify-center bg-black/50 text-[10px] font-semibold text-white transition-opacity ${busy ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Change"}</span>
      </button>
    </>
  );
}

function ArtworkButton({ show, onDone }: { show: HostedShowRow; onDone: () => void }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const go = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/host/hosting/shows/${show.id}/artwork`, { method: "POST", body: fd, credentials: "include" });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { message?: string }).message || "Couldn't use that image.");
      onDone();
    } catch (e) {
      toast({ title: "Cover art not changed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <>
      <input ref={input} id={`hosting-art-input-${show.id}`} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => e.target.files?.[0] && void go(e.target.files[0])} />
      <button type="button" onClick={() => input.current?.click()} disabled={busy} className="group relative h-32 w-32 shrink-0 overflow-hidden rounded-2xl border border-border bg-muted" title="Cover art: square JPG or PNG, 1400 to 3000 pixels" data-testid="hosting-artwork">
        {show.artworkUrl ? <img src={show.artworkUrl} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground"><ImagePlus className="h-6 w-6" /> Cover art</span>}
        <span className={`absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-semibold text-white transition-opacity ${busy ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Change"}</span>
      </button>
    </>
  );
}

function ShowForm({ show, categories, onSaved, onDeleted, focus = "" }: { show: HostedShowRow; categories: Record<string, string[]>; onSaved: () => void; onDeleted: () => void; focus?: string }) {
  const { toast } = useToast();
  // Deleting: they type the show's name to be sure.
  const [deleting, setDeleting] = useState(false);
  const [sure, setSure] = useState("");
  const del = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/host/hosting/shows/${show.id}`, { confirm: sure })).json(),
    onSuccess: () => { setDeleting(false); setSure(""); onDeleted(); toast({ title: "Show deleted", description: "Its feed has stopped." }); },
    onError: (e: Error) => toast({ title: "Not deleted", description: e.message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" }),
  });
  const [f, setF] = useState<Partial<HostedShowRow>>({});
  const v = { ...show, ...f };
  const set = (k: keyof HostedShowRow, val: unknown) => setF((x) => ({ ...x, [k]: val }));
  const save = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", `/api/host/hosting/shows/${show.id}`, f)).json(),
    onSuccess: () => { onSaved(); setF({}); toast({ title: "Show details saved" }); },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  const label = "block text-xs font-semibold text-muted-foreground";
  const dirty = Object.keys(f).length > 0;
  return (
    <div className="space-y-4" data-testid="hosting-details">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <p className="mb-3 text-sm text-muted-foreground">What Apple, Spotify and every podcast app show about your podcast.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={`${label} sm:col-span-2`}>Show name<Input autoFocus={focus === "title"} value={v.title} onChange={(e) => set("title", e.target.value)} className="mt-1" /></label>
          <label className={`${label} sm:col-span-2`}>Description<Textarea autoFocus={focus === "description"} value={v.description} onChange={(e) => set("description", e.target.value)} rows={4} className="mt-1" placeholder="What the show is about, who it's for, and who hosts it." /></label>
          <label className={label}>Host or author<Input value={v.author} onChange={(e) => set("author", e.target.value)} className="mt-1" /></label>
          <label className={label}>Owner email<Input autoFocus={focus === "ownerEmail"} type="email" value={v.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)} className="mt-1" /></label>
          <label className={label}>Category
            <select value={v.category} onChange={(e) => { set("category", e.target.value); set("subcategory", ""); }} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground">
              {Object.keys(categories).map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className={label}>Subcategory
            <select value={v.subcategory} onChange={(e) => set("subcategory", e.target.value)} disabled={!(categories[v.category] ?? []).length} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground disabled:opacity-50">
              <option value="">None</option>
              {(categories[v.category] ?? []).map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className={label}>Website (optional)<Input value={v.website} onChange={(e) => set("website", e.target.value)} className="mt-1" placeholder="https://" /></label>
          <label className={label}>Copyright (optional)<Input value={v.copyright} onChange={(e) => set("copyright", e.target.value)} className="mt-1" placeholder={`© ${new Date().getFullYear()} ${v.author || v.title}`} /></label>
          <label className={`${label} sm:col-span-2`}>Moving to another host? (optional)<Input value={v.newFeedUrl} onChange={(e) => set("newFeedUrl", e.target.value)} className="mt-1" placeholder="Your new host's feed address. Leave empty to stay." /><span className="mt-1 block font-normal">Your feed then forwards every app there (a 301), and your subscribers follow.</span></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.explicit} onChange={(e) => set("explicit", e.target.checked)} /> Explicit language</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.showType === "serial"} onChange={(e) => set("showType", e.target.checked ? "serial" : "episodic")} /> Listen in order (a series)</label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          {dirty && <Button variant="outline" onClick={() => setF({})}>Undo changes</Button>}
          <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty} className="bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="hosting-details-save">{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
        </div>
      </div>
      {/* Deleting the show: the apps first (the help says how), then here; its feed stops. */}
      <div className="rounded-2xl border border-destructive/30 p-4">
        {deleting ? (
          <div className="space-y-2">
            <p className="text-sm">This deletes <b>{show.title}</b> and its episodes, and its feed stops. If it's in Apple or Spotify, <a href="/help/podcast#unlist" target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">take it down there first</a>. Type the show's name to delete it.</p>
            <Input value={sure} onChange={(e) => setSure(e.target.value)} placeholder={show.title} data-testid="hosting-delete-confirm" />
            <div className="flex gap-2">
              <Button onClick={() => del.mutate()} disabled={del.isPending || sure.trim().toLowerCase() !== show.title.trim().toLowerCase()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="hosting-delete-go">{del.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Delete this show</Button>
              <Button variant="outline" onClick={() => { setDeleting(false); setSure(""); }}>Keep it</Button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setDeleting(true)} className="text-sm font-semibold text-destructive hover:underline" data-testid="hosting-delete">Delete this show…</button>
        )}
      </div>
    </div>
  );
}

/** A new episode: the audio first (a file, or a clean episode from the Library), then its words. */
function NewEpisodeDialog({ open, onClose, show, onCreated }: { open: boolean; onClose: () => void; show: HostedShowRow; onCreated: (e: HostedEpisodeRow) => void }) {
  const { toast } = useToast();
  const [from, setFrom] = useState<"upload" | "library">("upload");
  const [pct, setPct] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const recs = useQuery<RecordingRow[]>({ queryKey: ["/api/host/recordings"], queryFn: async () => (await apiRequest("GET", "/api/host/recordings")).json(), enabled: open });
  const hasClean = (r: RecordingRow) => { try { const c = r.clean ? JSON.parse(r.clean) : null; return c?.status === "done" && !!c.audioKey; } catch { return false; } };
  const usable = (recs.data ?? []).filter((r) => r.status === "Ready" && r.url);
  const make = async (body: Record<string, unknown>) => {
    const e = (await (await apiRequest("POST", `/api/host/hosting/shows/${show.id}/episodes`, body)).json()) as HostedEpisodeRow;
    onCreated(e);
  };
  const upload = async (file: File) => {
    if (!/^audio\/|^video\/mp4/.test(file.type)) return toast({ title: "That file won't play as an episode", description: "Choose an MP3 or M4A, or an MP4 video.", variant: "destructive" });
    try {
      setPct(0);
      const dur = await durationOf(file).catch(() => 0);
      const key = await uploadToStorage(file, setPct);
      await make({ audioKey: key, mime: file.type === "audio/mp3" ? "audio/mpeg" : file.type, sizeBytes: file.size, durationSec: Math.round(dur), title: file.name.replace(/\.[a-z0-9]+$/i, "") });
    } catch (e) {
      toast({ title: "Couldn't upload that", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPct(null);
      if (input.current) input.current.value = "";
    }
  };
  const pick = useMutation({ mutationFn: (id: number) => make({ recordingId: id }), onError: (e: Error) => toast({ title: "Couldn't use that", description: e.message, variant: "destructive" }) });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && pct === null && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New episode</DialogTitle>
          <DialogDescription>Start with the audio. You'll add the title and notes next, and choose when it goes out.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1 rounded-xl bg-muted/60 p-1" role="tablist">
          {([["upload", "Upload audio or video", Upload], ["library", "From your Library", Film]] as const).map(([k, l, I]) => (
            <button key={k} type="button" role="tab" aria-selected={from === k} onClick={() => setFrom(k)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${from === k ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"}`}><I className="h-4 w-4" /> {l}</button>
          ))}
        </div>
        {from === "upload" ? (
          <>
            <input ref={input} type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,video/mp4,.mp3,.m4a,.mp4" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
            <button type="button" onClick={() => input.current?.click()} disabled={pct !== null} className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-sm hover:border-[#053877]/50 hover:bg-[#053877]/[0.03]" data-testid="hosting-upload">
              {pct === null ? <><Upload className="h-6 w-6 text-[#053877]" /><span className="font-semibold">Choose the episode's file</span><span className="text-xs text-muted-foreground">MP3 or M4A, or an MP4 video (the one you put on YouTube)</span></> : <><Loader2 className="h-6 w-6 animate-spin text-[#053877]" /><span className="font-semibold tabular-nums">Uploading… {pct}%</span><span className="text-xs text-muted-foreground">Keep this page open until it finishes.</span></>}
            </button>
          </>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            {recs.isLoading ? <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-muted-foreground" /> : usable.length ? (
              <ul className="divide-y divide-border">
                {usable.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.title || "Untitled"}</span>
                      <span className="block text-xs text-muted-foreground">{hasClean(r) ? "Clean audio: ums and long pauses already out" : "We'll turn the video into audio (a minute or two)"}</span>
                    </span>
                    <Button size="sm" variant="outline" className="h-8 rounded-full" disabled={pick.isPending} onClick={() => pick.mutate(r.id)}>{pick.isPending && pick.variables === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Use this"}</Button>
                  </li>
                ))}
              </ul>
            ) : <p className="py-8 text-center text-sm text-muted-foreground">Nothing in your Library yet. Upload the audio instead.</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** An episode's words and when it goes out: publish now, schedule it, or keep it as a draft. */
function EpisodeDialog({ ep, onClose, onSaved }: { ep: Ep | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState<Record<string, unknown>>({});
  const [when, setWhen] = useState<"now" | "later">("now");
  const [at, setAt] = useState("");
  if (!ep) return null;
  const v = { ...ep, ...f } as Ep;
  const set = (k: string, val: unknown) => setF((x) => ({ ...x, [k]: val }));
  const close = () => { setF({}); setWhen("now"); setAt(""); onClose(); };
  const save = async (status?: "published" | "draft") => {
    try {
      const body: Record<string, unknown> = { ...f };
      if (status) body.status = status;
      if (status === "published" && when === "later" && at) body.publishedAt = new Date(at).toISOString();
      if (status === "published" && ep.status !== "published" && when === "now") body.publishedAt = new Date().toISOString();
      const out = (await (await apiRequest("PATCH", `/api/host/hosting/episodes/${ep.id}`, body)).json()) as Ep;
      onSaved();
      const waiting = status === "published" && !out.audioKey && !out.audioUrl && !!out.audioJob;
      toast(waiting
        ? { title: when === "later" && at ? "Scheduled" : "It goes out as soon as it's ready", description: "Its audio is being made: a few minutes. It joins your feed by itself; nothing else to do." }
        : { title: status === "published" ? (when === "later" && at ? "Scheduled" : "Published") : "Saved", description: status === "published" ? "It's in your feed. The apps pick it up within the hour." : undefined });
      close();
    } catch (e) {
      toast({ title: "Couldn't save", description: (e as Error).message, variant: "destructive" });
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${ep.title}"? It leaves your feed, and the apps drop it on their next check.`)) return;
    await apiRequest("DELETE", `/api/host/hosting/episodes/${ep.id}`);
    onSaved();
    close();
  };
  const label = "block text-xs font-semibold text-muted-foreground";
  return (
    <Dialog open={!!ep} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{ep.status === "draft" ? "Publish an episode" : "Edit episode"}</DialogTitle>
          <DialogDescription>{ep.durationSec ? `${hms(ep.durationSec)} long. ` : ""}{ep.live ? `Live since ${dateOf(ep.publishedAt)} · ${compact(ep.downloads)} downloads.` : ep.status === "published" ? `Goes out ${dateOf(ep.publishedAt)}.` : "A draft: only you can see it."}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[1fr_6rem_6rem]">
          <label className={label}>Title<Input value={v.title} onChange={(e) => set("title", e.target.value)} className="mt-1" data-testid="hosting-ep-title" /></label>
          <label className={label}>Episode<Input type="number" min={0} value={v.episodeNumber ?? ""} onChange={(e) => set("episodeNumber", e.target.value === "" ? null : Number(e.target.value))} className="mt-1" /></label>
          <label className={label}>Season<Input type="number" min={0} value={v.season ?? ""} onChange={(e) => set("season", e.target.value === "" ? null : Number(e.target.value))} className="mt-1" /></label>
          <label className={`${label} sm:col-span-3`}>Show notes<Textarea value={v.description} onChange={(e) => set("description", e.target.value)} rows={6} className="mt-1" placeholder="What it's about, who's on it, and any links you mentioned." /></label>
          <div className="flex flex-wrap items-center gap-4 text-sm sm:col-span-3">
            <label className="flex items-center gap-2">Type
              <select value={v.episodeType} onChange={(e) => set("episodeType", e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
                <option value="full">Full episode</option><option value="trailer">Trailer</option><option value="bonus">Bonus</option>
              </select>
            </label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={v.explicit} onChange={(e) => set("explicit", e.target.checked)} /> Explicit</label>
          </div>
          {ep.status === "draft" && (
            <div className="flex flex-wrap items-center gap-2 text-sm sm:col-span-3">
              <span className="text-xs font-semibold text-muted-foreground">Goes out</span>
              {(["now", "later"] as const).map((w) => (
                <button key={w} type="button" onClick={() => setWhen(w)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${when === w ? "border-[#053877] bg-[#053877] text-white" : "border-border hover:bg-muted"}`}>{w === "now" ? "Now" : "Pick a time"}</button>
              ))}
              {when === "later" && <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="h-8 w-56" />}
            </div>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => void remove()} className="gap-1.5 text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /> Delete</Button>
          <div className="flex gap-2">
            {ep.status === "draft" ? (
              <>
                <Button variant="outline" onClick={() => void save()} disabled={!Object.keys(f).length}>Save draft</Button>
                <Button onClick={() => void save("published")} disabled={!v.title.trim() || (when === "later" && !at)} className="gap-1.5 bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="hosting-publish"><Send className="h-4 w-4" /> {when === "later" ? "Schedule" : "Publish"}</Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => void save("draft")}>Unpublish</Button>
                <Button onClick={() => void save()} disabled={!Object.keys(f).length} className="bg-[#053877] text-white hover:bg-[#0a4a99]">Save</Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
