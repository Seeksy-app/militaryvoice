import { shrinkImage } from "@/lib/shrinkImage";
import { GuestInvites } from "@/components/GuestInvites";
import type { IconType } from "react-icons";
import { SiApplepodcasts, SiCastbox, SiDeezer, SiIheartradio, SiPlayerfm, SiPocketcasts, SiPodcastindex, SiSpotify, SiYoutube, SiYoutubemusic } from "react-icons/si";
import { PhotoCropDialog } from "@/components/PhotoCropDialog";
import { FaAmazon } from "react-icons/fa";
import { BrandMark } from "@/components/BrandMark";
import { PodcastSetup, type SetupNext } from "@/components/PodcastSetup";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { durationOf, uploadToStorage } from "@/lib/upload";
import { GuestFinder, ShowFinder, INVITE_KEY } from "@/components/DiscoverPodcasts";
import type { HostedEpisodeRow, HostedShowRow, HostedSpotRow, PodcastStatsData, RecordingRow } from "@shared/schema";
import { fillFooter, FOOTER_TOKENS } from "@shared/footer";
import { AlertCircle, BarChart3, Check, ChevronLeft, Copy, Download, ExternalLink, Film, ImagePlus, Loader2, Mic2, Pause, Pencil, Play, Plus, Podcast, Radio, Send, Sparkles, Trash2, Upload } from "lucide-react";
import { IconTile } from "@/components/ui/icon-tile";

/**
 * Podcast: the show hosted on MilitaryVoices. A feed Apple, Spotify and every
 * app read; episodes from an audio file or a clean episode in the Library;
 * downloads counted the way sponsors count them. The numbers flow into the
 * Dashboard, Your analytics and the profile sponsors see.
 */

type Delivery = { apps: { app: string; got: boolean; checked: string }[] };
type Ep = HostedEpisodeRow & { downloads: number; live: boolean; hasVideo?: boolean; ytLibrary?: string; delivery?: Delivery | null; announcedAt?: string };
type Hosted = { show: HostedShowRow; feedUrl: string; missing: string[]; ownerConfirmed: boolean; production?: boolean; episodes: Ep[]; stats: { total: number; last30: number; series: { date: string; count: number }[]; apps: Record<string, number> }; reading?: string[] };
type Resp = { shows: Hosted[]; categories: Record<string, string[]>; youtubeReady?: boolean };

const KEY = ["/api/host/hosting"];
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));
const hms = (sec: number) => { const s = Math.round(sec); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const short = (app: string) => app.replace(/ Podcasts$/, "");
const ago = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
const waiting = (d?: Delivery | null) => !!d && d.apps.some((a) => !a.got);
/** An app that hasn't looked in six hours (or ever) is slower than usual: the only case where the person might need to do something. */
const slowApp = (a: { got: boolean; checked: string }) => !a.got && (!a.checked || Date.now() - Date.parse(a.checked) > 6 * 3600_000);
const BIG_APPS = /Apple|Spotify/;
/** A new episode's trip to the apps, in plain words: it is in the feed, the apps pick it up by themselves, and only a slow one is flagged. */
function DeliveryChips({ ep }: { ep: Ep }) {
  const d = ep.delivery;
  if (!d || !d.apps.length) return null;
  const slow = d.apps.filter((a) => BIG_APPS.test(a.app) && slowApp(a));
  return (
    <span className="mt-1 flex flex-wrap gap-1" data-testid={`delivery-${ep.id}`}>
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${waiting(d) ? "bg-muted text-muted-foreground" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"}`}>
        <Check className="h-3 w-3" />{waiting(d) ? "In your feed · the apps pick it up within the hour" : "In every app"}
      </span>
      {slow.map((a) => <span key={a.app} className="inline-flex items-center gap-1 rounded-full bg-[#F0A71F]/20 px-2 py-0.5 text-[11px] font-semibold text-[#8a5a00] dark:text-[#F0A71F]">{short(a.app)} is slow to pick it up</span>)}
    </span>
  );
}
/** Show notes as the plain words a person would type: tags out, paragraphs kept, a link written as "text (address)". */
function htmlToText(html: string): string {
  if (!/<[a-z!/]/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walk = (n: Node): string => {
    if (n.nodeType === 3) return n.textContent ?? "";
    if (n.nodeType !== 1) return "";
    const el = n as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const inner = Array.from(el.childNodes).map(walk).join("");
    if (tag === "br") return "\n";
    if (tag === "li") return `• ${inner.trim()}\n`;
    if (tag === "a") { const href = el.getAttribute("href") ?? ""; const t = inner.trim(); return href && t && t !== href && !t.includes(href) ? `${t} (${href})` : inner; }
    if (/^(p|div|h[1-6]|ul|ol|blockquote)$/.test(tag)) return `${inner.trim()}\n\n`;
    return inner;
  };
  return walk(doc.body).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
/** The three words an episode goes through: In post-production (we are still working on it, or its audio isn't here yet), Final draft (ready for them to publish), Live. */
type Stage = "post" | "final" | "live" | "scheduled" | "failed";
const stageOf = (e: Ep): Stage =>
  e.status === "published" ? (e.live ? "live" : "scheduled")
  : e.audioJob === "failed" ? "failed"
  : e.stage === "post" || e.audioJob || !(e.audioKey || e.audioUrl) ? "post"
  : "final";
const STAGE: Record<Stage, { label: string; cls: string }> = {
  post: { label: "In post-production", cls: "bg-[#053877]/10 text-[#053877] dark:bg-[#8fb5e8]/15 dark:text-[#8fb5e8]" },
  final: { label: "Final draft", cls: "bg-[#F0A71F]/20 text-[#8a5a00] dark:text-[#F0A71F]" },
  live: { label: "Live", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  scheduled: { label: "Scheduled", cls: "bg-[#053877]/10 text-[#053877] dark:text-[#8fb5e8]" },
  failed: { label: "Audio failed", cls: "bg-destructive/10 text-destructive" },
};
const dateOf = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

export function PodcastHosting() {
  const { toast } = useToast();
  const qc = useQueryClient();
  // The show they picked at sign-up (its feed is on their profile): shown first, with one press to move it here.
  const { data: profile } = useQuery<{ podcastName?: string; rssUrl?: string }>({ queryKey: ["/api/host/profile"], queryFn: async () => (await apiRequest("GET", "/api/host/profile")).json() });
  // Their real feed (an Apple link from sign-up resolved to the feed behind it), from Alex's intake.
  const { data: intake } = useQuery<{ known: { rss: string } }>({ queryKey: ["/api/host/podcast-intake"], queryFn: async () => (await apiRequest("GET", "/api/host/podcast-intake")).json() });
  const feedUrl = intake?.known.rss || profile?.rssUrl || "";
  // While an episode's audio is being made, check back every few seconds.
  const q = useQuery<Resp>({ queryKey: KEY, queryFn: async () => (await apiRequest("GET", "/api/host/hosting")).json(), refetchInterval: (qq) => { const sh = (qq.state.data as Resp | undefined)?.shows; return sh?.some((x) => x.episodes.some((e) => e.audioJob === "queued" || e.audioJob === "running")) ? 5000 : sh?.some((x) => x.episodes.some((e) => waiting(e.delivery))) ? 30_000 : false; } });
  const refresh = () => { void qc.invalidateQueries({ queryKey: KEY }); void qc.invalidateQueries({ queryKey: ["/api/host/podcast-stats"] }); };
  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/host/hosting/shows", {})).json(),
    onSuccess: (r: { id?: number }) => { refresh(); if (r?.id) { setOpenId(r.id); go("details"); } },
    onError: (e: Error) => toast({ title: "Couldn't set that up", description: e.message, variant: "destructive" }),
  });
  // Which show is open (none: the grid of shows), and which of its tabs.
  const [openId, setOpenId] = useState<number | null>(null);
  // Podcast always opens on Episodes (not wherever they last wandered).
  const [tab, setTab] = useState<PodTab>("episodes");
  const go = (t: PodTab) => setTab(t);
  // Their own stream key (Integrations → Live). The Stream in button shows only once they've made one (Andrew, 23 Nov:
  // "restream banner should not be on the podcast unless an RTMP key was created. it will only confuse people").
  const streamIn = useQuery<{ key: unknown | null }>({ queryKey: ["/api/host/stream-in"], queryFn: async () => (await apiRequest("GET", "/api/host/stream-in")).json(), staleTime: 60_000 });
  const hasStreamKey = !!streamIn.data?.key;
  // Invite to my show (a Book a guest profile, here or on Discover) leaves the person in the session:
  // open Invite a guest with their name, and their email if it was found. n refills the same person.
  const [prefill, setPrefill] = useState<{ name: string; email: string; n: number } | undefined>(undefined);
  const takeInvite = () => {
    let p: { name?: string; email?: string } | null = null;
    try { p = JSON.parse(sessionStorage.getItem(INVITE_KEY) || "null"); sessionStorage.removeItem(INVITE_KEY); } catch { p = null; }
    if (!p?.name) return;
    setPrefill((x) => ({ name: p!.name!, email: p!.email ?? "", n: (x?.n ?? 0) + 1 }));
    setTab("invite");
  };
  useEffect(() => { takeInvite(); }, []);
  // The field Show details opens on (from the checklist): the description, the name, the owner email.
  const [focus, setFocus] = useState<"" | "title" | "description" | "ownerEmail">("");
  const [adding, setAdding] = useState(false);
  const [newShow, setNewShow] = useState(false);
  // The setup screens stay up while a new show is made, even though the list now has one in it.
  const [inSetup, setInSetup] = useState(() => { try { const u = new URL(window.location.href); const on = u.searchParams.get("setup") === "1"; if (on) { u.searchParams.delete("setup"); window.history.replaceState(null, "", u.pathname + u.search); } return on; } catch { return false; } });
  const [editEp, setEditEp] = useState<Ep | null>(null);
  // An episode a sponsor spot is being added for (from that episode's page).
  const [spotFor, setSpotFor] = useState<number | null>(null);
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

  const finishSetup = (next: SetupNext, id: number | null) => {
    setInSetup(false);
    refresh();
    if (id) setOpenId(id);
    if (next === "rooms") { window.location.assign("/host/dashboard/studio"); return; }
    if (next === "zoom") { window.location.assign("/help/zoom"); return; }
    go("episodes");
    if (next === "upload") setAdding(true);
  };

  if (!shows.length || inSetup) {
    return (
      <section className="mt-2" data-testid="podcast-hosting">
        {/* Their show first (the one from sign-up): one press to move it here. Then the way in: have one, or starting one. */}
        {feedUrl && !inSetup && <YourShowElsewhere name={profile?.podcastName ?? ""} rss={feedUrl} onMoved={refresh} />}
        <PodcastSetup initialFeed={feedUrl} onImported={() => { refresh(); toast({ title: "Alex: your episodes are here", description: "Next, point Apple and Spotify at your new feed so they read it instead of your old host. It is under Directories." }); }} onCreating={() => setInSetup(true)} onFinish={finishSetup} onBack={() => (shows.length ? setInSetup(false) : window.location.assign("/host/dashboard"))} />
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
            const xd = parseDirs(x.show.directories);
            const listed = DIRS.filter((d) => liveOn(x, xd, d.key)).length;
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
          <button type="button" onClick={() => setInSetup(true)} className="flex min-h-[16rem] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-[#053877]/40 hover:text-[#053877] dark:hover:text-[#8fb5e8]" data-testid="hosting-add-show">
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
    if (/confirm the owner/i.test(m)) {
      // Up to the owner email, and send the code from here: one click, then the box for the code is right there.
      document.getElementById("hosting-owner")?.scrollIntoView({ behavior: "smooth", block: "center" });
      const send = document.querySelector<HTMLButtonElement>('[data-testid="hosting-owner-send"]');
      if (send) send.click(); else document.querySelector<HTMLInputElement>('#hosting-owner input')?.focus();
      return;
    }
    setFocus(/description/i.test(m) ? "description" : /show name/i.test(m) ? "title" : /owner email/i.test(m) ? "ownerEmail" : "");
    go("details");
  };
  const inSettings = tab === "publishing" || tab === "details" || tab === "sponsors" || tab === "move";
  const tabBtn = (t: PodTab, label: string) => (
    <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => go(t)} className={`border-b-2 px-1 pb-2.5 text-sm font-semibold transition-colors ${tab === t ? "border-[#053877] text-foreground dark:border-[#8fb5e8]" : "border-transparent text-muted-foreground hover:text-foreground"}`} data-testid={`hosting-tab-${t}`}>{label}</button>
  );

  return (
    <section className="mt-2 space-y-4 pb-24" data-testid="podcast-hosting">
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
            {!editEp && <button type="button" onClick={() => setInSetup(true)} className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-border px-3 text-xs font-semibold text-[#053877] hover:bg-[#053877]/5 dark:text-[#8fb5e8]" data-testid="hosting-add-show"><Plus className="h-3.5 w-3.5" /> Add a show</button>}
            {h.episodes.some((e) => e.live) && <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 rounded-full"><a href={`/podcast/${s.slug}`} target="_blank" rel="noreferrer" data-testid="hosting-public-page">Your show page <ExternalLink className="h-3 w-3" /></a></Button>}
          </div>
        </div>
      </div>

      {/* On a phone the last tabs run off the edge: closer together, and a fade that says there's more (8 Oct). */}
      <div className="flex gap-4 overflow-x-auto whitespace-nowrap border-b border-border pr-6 [mask-image:linear-gradient(to_right,black_82%,transparent)] [scrollbar-width:none] sm:gap-6 sm:pr-0 sm:[mask-image:none]" role="tablist">
        {tabBtn("episodes", "Episodes")}
        {/* Settings sits next to Episodes, where it is found: the show's details, how episodes go out, and its sponsors. */}
        <button type="button" role="tab" aria-selected={inSettings} onClick={() => go(inSettings ? tab : "publishing")} className={`border-b-2 px-1 pb-2.5 text-sm font-semibold transition-colors ${inSettings ? "border-[#053877] text-foreground dark:border-[#8fb5e8]" : "border-transparent text-muted-foreground hover:text-foreground"}`} data-testid="hosting-tab-settings">Settings</button>
        {tabBtn("directories", ready ? "Directories" : "Directories · to do")}
        {tabBtn("invite", "Invite a guest")}
        {tabBtn("guests", "Book a guest")}
        {tabBtn("pitch", "Be a guest")}
      </div>

      {s.newFeedUrl && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/[0.05] p-4 text-sm" data-testid="hosting-leaving">
          <span className="font-semibold">This show is moving to another host.</span> <span>The feed forwards apps to <span className="break-all font-mono text-xs">{s.newFeedUrl}</span>. <button type="button" onClick={() => go("move")} className="font-semibold text-primary hover:underline">Stop the move under Settings → Redirect</button>.</span>
        </div>
      )}

      {tab === "episodes" && editEp && (
        <EpisodePage ep={h.episodes.find((x) => x.id === editEp.id) ?? editEp} show={s} youtubeReady={!!q.data?.youtubeReady} production={!!h.production} onDirectories={() => { setEditEp(null); go("directories"); }} onBack={() => setEditEp(null)} onSaved={refresh} onAddSpot={(id) => { setSpotFor(id); setEditEp(null); go("sponsors"); }} />
      )}
      {tab === "episodes" && !editEp && adding && (
        <NewEpisodePage show={s} onBack={() => setAdding(false)} onCreated={(e) => { refresh(); setAdding(false); setEditEp({ ...e, downloads: 0, live: false }); }} />
      )}
      {tab === "episodes" && !editEp && !adding && (
        <>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold"><Mic2 className="h-4 w-4 text-[#053877] dark:text-[#8fb5e8]" /> Episodes</h2>
                <p className="text-xs text-muted-foreground">{compact(h.stats.last30)} downloads in the last 30 days · {compact(h.stats.total)} in all</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Recording somewhere else: their own stream key, and each live show lands in the Library (/stream-in). Only
                    for those who made a key; everyone else sets one up in Integrations → Live. */}
                {hasStreamKey && (
                  <Button asChild variant="outline" className="h-9 gap-1.5 rounded-lg" data-testid="hosting-stream-in">
                    <a href="/stream-in"><span className="inline-flex items-center gap-1"><BrandMark brand="streamyard" className="h-4 w-4" /><BrandMark brand="restream" className="h-4 w-4" /><BrandMark brand="obs" className="h-4 w-4" /></span> Stream in from StreamYard, Restream or OBS</a>
                  </Button>
                )}
                <Button onClick={() => setAdding(true)} className="h-9 gap-1.5 rounded-lg bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="hosting-new-episode"><Plus className="h-4 w-4" /> New episode</Button>
              </div>
            </div>
            {h.episodes.length ? (
              <ul className="divide-y divide-border">
                {/* What still needs them (post-production, final drafts) first, newest first; then what is out. */}
                {[...h.episodes].sort((a, b) => Number(b.status === "draft") - Number(a.status === "draft") || (a.status === "draft" && b.status === "draft" ? (b.episodeNumber ?? 0) - (a.episodeNumber ?? 0) || b.createdAt.localeCompare(a.createdAt) : 0)).map((e) => (
                  <li key={e.id} className="flex items-center gap-3 py-2.5" data-testid={`hosting-episode-${e.id}`}>
                    <EpisodeArt ep={e} fallback={s.artworkUrl} onDone={refresh} />
                    {/* On a phone the badge moves under the title, which gets the width (8 Oct: "8. MCDP 1 Warfig…"). */}
                    <span className={`hidden shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold sm:inline-flex sm:items-center sm:gap-1 ${STAGE[stageOf(e)].cls}`} data-testid={`hosting-stage-${e.id}`}>
                      {e.audioJob && e.audioJob !== "failed" && <Loader2 className="h-3 w-3 animate-spin" />}{STAGE[stageOf(e)].label}
                    </span>
                    <button type="button" onClick={() => setEditEp(e)} className="min-w-0 flex-1 text-left">
                      <span className="line-clamp-2 text-sm font-medium sm:line-clamp-none sm:block sm:truncate">{e.episodeNumber != null ? `${e.episodeNumber}. ` : ""}{e.title}</span>
                      <span className="block text-xs text-muted-foreground"><span className="font-semibold sm:hidden">{STAGE[stageOf(e)].label} · </span>{e.publishedAt ? dateOf(e.publishedAt) : "Not published"}{e.durationSec ? ` · ${hms(e.durationSec)}` : ""}{e.youtube ? " · on YouTube" : ""}</span>
                      <DeliveryChips ep={e} />
                    </button>
                    <span className="hidden w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block"><b className="text-foreground">{compact(e.downloads)}</b> downloads</span>
                    <Button size="sm" variant="outline" className="h-8 shrink-0 rounded-full" onClick={() => setEditEp(e)}>{stageOf(e) === "final" ? "Publish" : stageOf(e) === "post" ? "Open" : "Edit"}</Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">No episodes yet. Add your first: upload the audio or the video, or use a recording from your Library.</p>
            )}
          </div>
        </>
      )}

      {/* Settings in plain words, one tab each (Andrew, 23 Nov: "Yes, build it"). */}
      {inSettings && (
        <div className="-mt-1 flex gap-5 overflow-x-auto whitespace-nowrap border-b border-border [scrollbar-width:none]" role="tablist" data-testid="hosting-settings-nav">
          {([["publishing", "Publishing"], ["details", "Show details"], ["sponsors", "Sponsors"], ["move", "Redirect"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => go(k)} className={`border-b-2 px-0.5 pb-2 text-sm font-medium transition-colors ${tab === k ? "border-[#053877] font-semibold text-[#053877] dark:border-[#8fb5e8] dark:text-[#8fb5e8]" : "border-transparent text-muted-foreground hover:text-foreground"}`} data-testid={`hosting-settings-${k}`}>{l}</button>
          ))}
        </div>
      )}
      {tab === "publishing" && <PublishingPanel key={s.id} h={h} youtubeReady={!!q.data?.youtubeReady} onSaved={refresh} />}
      {tab === "move" && <><MoveHost show={s} feedUrl={h.feedUrl} onSaved={refresh} /><DeleteShow show={s} onDeleted={() => { setOpenId(null); refresh(); }} /></>}
      {tab === "sponsors" && <SponsorsPanel key={`${s.id}-${spotFor ?? 0}`} h={h} onSaved={refresh} preset={spotFor} onPresetUsed={() => setSpotFor(null)} />}

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
                      <span className="shrink-0 text-xs font-semibold text-[#b36b00] opacity-70 group-hover:opacity-100">{/confirm the owner/i.test(m) ? "Send me a code →" : "Add it →"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {/* A moved show is in the apps already, by its old feed: forwarding that feed moves them all here. */}
          {s.importedFrom && <MoveSubscribers h={h} onDone={refresh} />}
          <Directories h={h} ready={ready} youtubeReady={!!q.data?.youtubeReady} onSaved={refresh} youtube={<YouTubeEpisodes embedded h={h} ready={!!q.data?.youtubeReady} onDone={refresh} />} />
        </>
      )}

      {tab === "invite" && <GuestInvites prefill={prefill} />}
      {tab === "guests" && <GuestFinder showTitle={s.title} onInvite={takeInvite} />}
      {tab === "pitch" && <ShowFinder topics={[s.category, s.subcategory].filter(Boolean) as string[]} />}

      {tab === "details" && <ShowForm key={s.id} show={s} focus={focus} categories={q.data?.categories ?? {}} onSaved={() => { refresh(); setFocus(""); }} />}

      {addShowDialog}
    </section>
  );
}

type PodTab = "episodes" | "publishing" | "sponsors" | "move" | "directories" | "details" | "guests" | "pitch" | "invite";
type DirState = { state: "" | "submitted" | "live" | "rejected"; url: string; at?: string };
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
const DIRS: { key: string; name: string; reach: string; url: string; steps: string[]; link: string; auto?: boolean }[] = [
  { key: "apple", name: "Apple Podcasts", reach: "Apple Podcasts, and the apps that read Apple's list (Overcast, Castro)", url: "https://podcastsconnect.apple.com/my-podcasts/new-feed", steps: ["Sign in with your Apple ID.", "Choose to add a show with an RSS feed, and paste your feed (it's copied).", "Submit. Apple reviews it, usually in a day or two, and writes to your owner email."], link: "https://podcasts.apple.com/…" },
  { key: "spotify", name: "Spotify", reach: "Spotify", url: "https://creators.spotify.com/", steps: ["Sign in to Spotify for Creators (it opens in a new tab).", "Choose to add a podcast you already have on another host, and paste your feed.", "Spotify emails a code to your owner email: type it in. It's live within hours."], link: "https://open.spotify.com/show/…" },
  { key: "amazon", name: "Amazon Music & Audible", reach: "Amazon Music, Audible and Alexa", url: "https://podcasters.amazon.com/", steps: ["Sign in with an Amazon account.", "Add your podcast and paste your feed.", "Confirm with the code sent to your owner email."], link: "https://music.amazon.com/podcasts/…" },
  { key: "iheart", name: "iHeartRadio", reach: "iHeartRadio", url: "https://podcasters.iheart.com/", steps: ["Open iHeart's podcast submission page and sign in.", "Paste your feed and submit."], link: "https://www.iheart.com/podcast/…" },
  { key: "pocketcasts", name: "Pocket Casts", reach: "Pocket Casts", url: "https://pocketcasts.com/submit/", steps: ["Paste your feed and press Submit. No account needed."], link: "https://pca.st/…" },
  { key: "tunein", name: "TuneIn", reach: "TuneIn and the radios and smart speakers that use it", url: "https://help.tunein.com/contact/add-your-podcast-S19TR3Sdf", steps: ["Open TuneIn's form to add a podcast (your feed is copied).", "Paste your feed, and your show's name, then send it.", "TuneIn reviews it and lists it, usually within a few days."], link: "https://tunein.com/podcasts/…" },
  { key: "deezer", name: "Deezer", reach: "Deezer", url: "https://podcasters.deezer.com/", steps: ["Sign in to Deezer for Creators, or make a free account.", "Add a podcast and paste your feed.", "Confirm with the code Deezer emails to your owner email."], link: "https://www.deezer.com/show/…" },
  { key: "playerfm", name: "Player FM", reach: "Player FM", url: "https://player.fm/importer/feed", steps: ["Paste your feed and press Import. No account needed."], link: "https://player.fm/series/…" },
  { key: "castbox", name: "Castbox", reach: "Castbox", url: "https://castbox.fm/", steps: ["Open Castbox and search for your show. If it isn't there, choose Submit a podcast and paste your feed.", "Confirm with the code Castbox emails to your owner email."], link: "https://castbox.fm/channel/…" },
  { key: "podcastindex", name: "Podcast Index", reach: "Dozens of newer apps (Fountain, Podverse, Castamatic and more)", url: "https://podcastindex.org/add", steps: ["Paste your feed and press Submit. That's all."], link: "https://podcastindex.org/podcast/…" },
  { key: "youtube", name: "YouTube Music", reach: "YouTube and YouTube Music, as an audio podcast", url: "https://studio.youtube.com", steps: ["Open YouTube Studio on your channel.", "Create, then New podcast, then submit an RSS feed. Paste your feed.", "Confirm with the code YouTube emails to your owner email."], link: "https://music.youtube.com/playlist?list=…" },
  { key: "listennotes", name: "Listen Notes", reach: "The podcast search engine. We list your show there for you once an episode is out.", url: "https://www.listennotes.com", steps: [], link: "https://www.listennotes.com/podcasts/…", auto: true },
];

/** TuneIn and Listen Notes have no mark in the icon set: drawn here, in their colours. */
const TuneInMark: IconType = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-5 6h10v2h-4v7h-2v-7H7V8Z" /></svg>
);
const ListenNotesMark: IconType = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M12 3a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h1v-7H5v-1a7 7 0 0 1 14 0v1h-2v7h1a3 3 0 0 0 3-3v-5a9 9 0 0 0-9-9Z" /></svg>
);
/** Each app's own mark, so it's recognisable at a glance (7 Oct). */
// The names each app reads the feed under (server appOf): seen in the last 14 days = it follows the new feed.
// Podverse, Fountain and TrueFans read through Podcast Index, so one of them fetching proves the Index has the show.
const READS_AS: Record<string, string[]> = { apple: ["Apple Podcasts"], spotify: ["Spotify"], amazon: ["Amazon Music"], iheart: ["iHeartRadio"], pocketcasts: ["Pocket Casts"], castbox: ["Castbox"], youtube: ["Google / YouTube"], playerfm: ["Player.Fm"], podcastindex: ["Podverse", "Fountain", "Truefans"] };
/** Live on an app: we have the show's page there, or (a moved show) the app read the new feed in the last 14 days. */
function liveOn(h: Hosted, dirs: Record<string, DirState>, key: string): boolean {
  if (dirs[key]?.state === "live" && dirs[key]?.url) return true;
  return !!h.show.importedFrom && !!READS_AS[key]?.some((a) => h.reading?.includes(a));
}
const DIR_ICON: Record<string, { icon: IconType; color: string }> = {
  apple: { icon: SiApplepodcasts, color: "#9933CC" },
  spotify: { icon: SiSpotify, color: "#1DB954" },
  youtube: { icon: SiYoutubemusic, color: "#FF0000" },
  amazon: { icon: FaAmazon, color: "#FF9900" },
  iheart: { icon: SiIheartradio, color: "#C6002B" },
  pocketcasts: { icon: SiPocketcasts, color: "#F43E37" },
  podcastindex: { icon: SiPodcastindex, color: "#F90000" },
  deezer: { icon: SiDeezer, color: "#A238FF" },
  playerfm: { icon: SiPlayerfm, color: "#C8102E" },
  castbox: { icon: SiCastbox, color: "#F65E3B" },
  tunein: { icon: TuneInMark, color: "#14D8CC" },
  listennotes: { icon: ListenNotesMark, color: "#2D6CDF" },
};

function Directories({ h, ready, youtubeReady, onSaved, youtube }: { h: Hosted; ready: boolean; youtubeReady: boolean; onSaved: () => void; youtube?: React.ReactNode }) {
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
  // One "Live" (Andrew via PM, 21 Nov: "if it's live, why do we have to confirm it? ... Just say it's live"): live when we
  // have the show's page there, or when the app read the new feed in the last 14 days. Open when we have the page's link.
  const isLive = (key: string) => liveOn(h, dirs, key);
  const confirmed = (key: string) => dirs[key]?.state === "live" && !!dirs[key]?.url;
  const listed = DIRS.filter((d) => isLive(d.key)).length;
  const renderRow = (d: (typeof DIRS)[number]) => {
          const st = dirs[d.key];
          const live = isLive(d.key);
          const isOpen = open === d.key;
          // A moved show whose old feed forwards: the app follows on its own, so the row is its status only (Andrew,
          // 23 Nov). Listing it by hand is inside the row, for the rare app that never had it.
          const quiet = moved && !!s.redirectOk && !st?.state && !live && !d.auto;
          // "Spotify" under Spotify says nothing: the reach line only when it adds something (UI/UX, a1ee1d0d).
          // Status only once it's live (Andrew, 23 Nov): the reach line is for deciding to list it.
          const reach = d.reach === d.name || (live && d.key !== "youtube") ? "" : d.reach;
          const badge = live ? "bg-emerald-600 text-white dark:bg-emerald-500"
            : st?.state === "submitted" ? "bg-[#F0A71F]/20 text-[#8a5a00] dark:text-[#F0A71F]" : "bg-muted text-muted-foreground";
          return (
            <li key={d.key} className="py-3" data-testid={`hosting-dir-${d.key}`}>
              <div className="flex flex-wrap items-center gap-3">
                {DIR_ICON[d.key] ? (() => { const I = DIR_ICON[d.key].icon; return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-border"><I className="h-5 w-5" style={{ color: DIR_ICON[d.key].color }} /></span>; })()
                  : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#053877]/10 text-sm font-bold text-[#053877] dark:bg-white/10 dark:text-[#8fb5e8]">{d.name[0]}</span>}
                <button type="button" onClick={() => setOpen(isOpen || st?.state === "submitted" ? `-${d.key}` : d.key)} className="min-w-0 flex-1 text-left">
                  <span className="block text-sm font-semibold">{d.name}{d.auto && <span className="ml-2 align-middle text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Powered by Listen Notes</span>}</span>
                  {/* Wraps on a phone (it was cut to "Amazon Mu…" at 390, 21 Nov); one line on a computer. */}
                  {reach && <span className="block text-xs text-muted-foreground sm:truncate">{reach}</span>}
                </button>
                {/* State and action: beside the name on a computer; on a phone their own line under the name, so neither squeezes it. */}
                <span className="flex basis-full items-center justify-between gap-2 pl-12 empty:hidden sm:basis-auto sm:justify-end sm:pl-0">
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge}`} title={live && !confirmed(d.key) ? `${d.name} gets your episodes from your new feed.` : undefined} data-testid={`hosting-dir-state-${d.key}`}>{live && !confirmed(d.key) ? "Live" : confirmed(d.key) ? (moved && !s.redirectOk ? "Live, by your old feed" : "Live") : st?.state === "live" ? (moved ? (s.redirectOk ? "Follows your forward" : "Waits for your old feed to forward") : "Link needed") : st?.state === "submitted" ? "Submitted" : d.auto && s.aiVoice ? "Not listed" : d.auto ? "Automatic" : moved ? (s.redirectOk ? "Follows your forward" : "Waits for your old feed to forward") : "Not listed"}</span>
                {live ? (
                  // Live: Open when we have the show's page, otherwise nothing to press.
                  st?.url ? <Button asChild size="sm" variant="outline" className="h-8 gap-1 rounded-full"><a href={st.url} target="_blank" rel="noreferrer">Open <ExternalLink className="h-3 w-3" /></a></Button> : null
                ) : d.auto && s.aiVoice && !(st?.state === "live" && st.url) ? (
                  <span className="shrink-0 text-xs text-muted-foreground" data-testid={`hosting-dir-ai-${d.key}`}>Doesn't take AI-voiced shows</span>
                ) : d.auto && !(st?.state === "live" && st.url) ? (
                  // Listed for them (our Listen Notes submission): nothing to press.
                  <span className="shrink-0 text-xs text-muted-foreground" data-testid={`hosting-dir-auto-${d.key}`}>
                    {st?.state === "submitted" ? "In review (up to 12 hours)" : st?.state === "rejected" ? "Not accepted" : "When your first episode is out"}
                  </span>
                ) : st?.state === "live" ? (st.url
                  ? <Button asChild size="sm" variant="outline" className="h-8 gap-1 rounded-full"><a href={st.url} target="_blank" rel="noreferrer">Open <ExternalLink className="h-3 w-3" /></a></Button>
                  : <Button size="sm" variant="outline" onClick={() => setOpen(isOpen ? `-${d.key}` : d.key)} className="h-8 rounded-full" data-testid={`hosting-dir-confirm-${d.key}`}>Confirm</Button>
                ) : quiet ? null : (
                  <Button size="sm" variant={moved ? "outline" : "default"} onClick={() => void listIt(d)} disabled={!ready} title={ready ? undefined : "Finish what the apps need first (above)"} className={`h-8 gap-1 rounded-full ${moved ? "" : "bg-[#053877] text-white hover:bg-[#0a4a99]"}`} data-testid={`hosting-dir-list-${d.key}`}>{st?.state === "submitted" ? "Open again" : moved ? "Not there? List it" : "List it"} <ExternalLink className="h-3 w-3" /></Button>
                )}
                </span>
              </div>
              {(isOpen || (st?.state === "submitted" && !live && open !== `-${d.key}`)) && (
                <div className="ml-12 mt-2 space-y-2 text-sm">
                  {live ? (
                    <p className="text-xs text-muted-foreground">{d.name} gets your episodes from your new feed. Optional: <a href={FIND[d.key]?.(s.title) ?? d.url} target="_blank" rel="noreferrer" className="font-semibold text-[#053877] underline dark:text-[#8fb5e8]">find your show on {d.name}</a> and paste its address below to put a {d.name} button on your show page.</p>
                  ) : <>
                  {quiet && <p className="text-xs text-muted-foreground">{d.name} follows your forward on its own. Not there after a week? List it once:</p>}
                  <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">{d.steps.map((x) => <li key={x}>{x}</li>)}</ol>
                  {quiet && <Button size="sm" variant="outline" onClick={() => void listIt(d)} disabled={!ready} className="h-8 gap-1 rounded-full" data-testid={`hosting-dir-list-${d.key}`}>List it on {d.name} <ExternalLink className="h-3 w-3" /></Button>}
                  <p className="text-xs text-muted-foreground">That's all: it goes live on its own once {d.name} approves it, usually within a few days. <span className="text-muted-foreground/80">Optional: <a href={FIND[d.key]?.(s.title) ?? d.url} target="_blank" rel="noreferrer" className="font-semibold text-[#053877] underline dark:text-[#8fb5e8]">find your show on {d.name}</a> and paste its address below to put a {d.name} button on your show page.</span></p>
                  </>}
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    const u = (links[d.key] ?? st?.url ?? "").trim();
                    // Their own feed isn't the app's page for the show.
                    if (/militaryvoices\.ai/i.test(u)) return toast({ title: "That's your feed", description: `Paste your show's page on ${d.name} (like ${d.link}).` });
                    if (u && !/^https:\/\//.test(u)) return toast({ title: "Paste the whole link", description: `It starts with https:// (like ${d.link}).` });
                    // Live means a confirmed page, so saving needs the link (PM, 21 Nov).
                    if (!u) return toast({ title: "Paste your show's link", description: `Find your show on ${d.name} and paste its address (like ${d.link}).` });
                    put(d.key, { state: "live", url: u, at: new Date().toISOString() });
                    setOpen(null);
                    setLinks((x) => { const n = { ...x }; delete n[d.key]; return n; });
                    toast({ title: `${d.name}: live`, description: "Its button is on your show page now." });
                  }} className="flex flex-wrap gap-2">
                    <Input value={links[d.key] ?? st?.url ?? ""} onChange={(e) => setLinks((x) => ({ ...x, [d.key]: e.target.value }))} placeholder={`Your show on ${d.name}: ${d.link}`} className="h-9 min-w-0 flex-1 text-xs" data-testid={`hosting-dir-link-${d.key}`} />
                    <Button type="submit" size="sm" variant="outline" className="h-9 rounded-lg" data-testid={`hosting-dir-live-${d.key}`}>Save link</Button>
                    {st && <button type="button" onClick={() => { put(d.key, null); setOpen(null); }} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Reset</button>}
                  </form>
                </div>
              )}
            </li>
          );
  };
  return (
    <>
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm" data-testid="hosting-directories">
      {/* A clear line under the header, so the first app doesn't read as part of it (Andrew, 21 Nov). */}
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div>
          <h2 className="text-base font-semibold">Podcast apps</h2>
          <p className="text-sm text-muted-foreground">{moved ? (s.redirectOk ? "Your old feed forwards here, so each app moves over on its own." : "Your show is in these already, by your old feed: forwarding it (above) moves each one here. List it only where it isn't yet.") : "Where people find and follow your show. List it once in each; new episodes reach them on their own."}</p>
          {/* The count on its own line, so it doesn't wrap mid-phrase (UI/UX, 21 Nov). */}
          {listed > 0 && <p className="mt-1 text-xs font-medium text-foreground" data-testid="hosting-dir-count">Live on {listed} · {DIRS.length} apps</p>}
        </div>
        <FeedLink url={h.feedUrl} />
      </div>
      <ul className="divide-y divide-border">
        {DIRS.filter((d) => d.key !== "youtube").map(renderRow)}
      </ul>
    </div>
    {/* YouTube is two different places, one plain line each (Andrew, 23 Nov). Whether a video goes up is ticked in each episode's publish box. */}
    <div className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-sm" data-testid="hosting-youtube-section">
      <h2 className="text-base font-semibold">YouTube</h2>
      <p className="text-sm text-muted-foreground">Two different places on YouTube.</p>
      <ul className="mt-1 divide-y divide-border">
        {renderRow({ ...DIRS.find((d) => d.key === "youtube")!, reach: "Your podcast as audio, in the YouTube Music app. Set up once." })}
        <li className="flex flex-wrap items-center gap-3 py-3" data-testid="hosting-yt-channel">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-border"><SiYoutube className="h-5 w-5" style={{ color: "#FF0000" }} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Your YouTube channel</span>
            <span className="block text-xs text-muted-foreground">Each episode with video, as a video. {youtubeReady ? "Ticked when you publish; untick it for one\u00a0episode." : "Connect your channel first."}</span>
          </span>
          {!youtubeReady && <a href="/host/dashboard/social" className="basis-full pl-12 text-left text-sm font-semibold text-[#053877] hover:underline dark:text-[#8fb5e8] sm:basis-auto sm:pl-0" data-testid="hosting-yt-connect">Connect YouTube</a>}
        </li>
      </ul>
      {h.episodes.some((e) => e.hasVideo) && youtube}
    </div>
    </>
  );
}

/** Episodes to their YouTube channel as videos (Upload-Post; their channel is connected on the Social screen). */
function YouTubeEpisodes({ h, ready, onDone, embedded = false }: { h: Hosted; ready: boolean; onDone: () => void; embedded?: boolean }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const s = h.show;
  const videos = h.episodes.filter((e) => e.hasVideo);
  const setShow = async (patch: Record<string, string>) => {
    try { await apiRequest("PATCH", `/api/host/hosting/shows/${s.id}`, patch); onDone(); }
    catch (err) { toast({ title: "Didn't save", description: (err as Error).message, variant: "destructive" }); }
  };
  const act = async (e: Ep, path: string, body: object, done?: string) => {
    setBusy(e.id);
    try {
      await apiRequest("POST", `/api/host/hosting/episodes/${e.id}/${path}`, body);
      if (done) toast({ title: done, description: "It uploads in the next few minutes. Its status is on the Social screen." });
      onDone();
    } catch (err) {
      const msg = (err as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "");
      toast({ title: /Social screen/.test(msg) ? "Connect YouTube first" : "Not posted", description: msg, variant: /Social screen/.test(msg) ? undefined : "destructive" });
    } finally { setBusy(null); }
  };
  const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";
  return (
    <div className={embedded ? "mt-3 border-t border-border pt-3" : "rounded-2xl border border-border bg-card p-4 shadow-sm"} data-testid="hosting-youtube">
      <h2 className="text-sm font-semibold">Your episodes with video</h2>
      <p className="text-xs text-muted-foreground">Posted to your channel with their title, notes and picture. {ready ? "Your channel is connected on the " : "Connect your channel on the "}<a href="/host/dashboard/social" className="font-semibold text-[#053877] underline dark:text-[#8fb5e8]">Social</a> screen.</p>
      {/* Standalone only: embedded in Directories, the choice is the tick in each episode's publish box. */}
      <div className={`mt-3 flex-wrap items-center gap-2 text-sm ${embedded ? "hidden" : "flex"}`}>
        <span className="text-muted-foreground">When I publish an episode with video:</span>
        <select value={s.youtubeMode} onChange={(e) => void setShow({ youtubeMode: e.target.value })} className={sel} aria-label="When I publish" data-testid="hosting-yt-mode">
          <option value="ask">Ask me each time</option>
          <option value="always">Always post it to YouTube</option>
        </select>
        <select value={s.youtubePrivacy} onChange={(e) => void setShow({ youtubePrivacy: e.target.value })} className={sel} aria-label="Who can see it">
          <option value="public">Public</option>
          <option value="unlisted">Unlisted (only with the link)</option>
        </select>
      </div>
      {videos.length ? (
        <ul className="mt-2 divide-y divide-border">
          {videos.map((e) => {
            let yt: { at?: string; state?: string; error?: string; via?: string } = {};
            try { yt = e.youtube ? JSON.parse(e.youtube) : {}; } catch { yt = {}; }
            const fromLibrary = yt.via === "library" || (!yt.state && !!e.ytLibrary);
            const sent = yt.state === "sent" || (!yt.state && !!yt.at) || !!e.ytLibrary;
            const skipped = yt.state === "skipped";
            const status = sent ? `On YouTube since ${dateOf(yt.at ?? e.ytLibrary ?? "")}${fromLibrary ? ", posted from your Library" : ""}`
              : skipped ? "Not for YouTube"
              : e.youtubeWanted ? `Goes to YouTube when it's out (${dateOf(e.publishedAt)})`
              : yt.state === "failed" ? `Didn't post: ${yt.error ?? "try again"}`
              : "Not on YouTube";
            return (
              <li key={e.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{e.title}</span><span className={`block text-xs ${yt.state === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{status}</span></span>
                {skipped ? (
                  <Button size="sm" variant="ghost" onClick={() => void act(e, "youtube/skip", { skip: false })} disabled={busy != null} className="h-8 rounded-full">Undo</Button>
                ) : (
                  <>
                    {!sent && <Button size="sm" variant="ghost" onClick={() => void act(e, "youtube/skip", { skip: true })} disabled={busy != null} className="h-8 rounded-full text-muted-foreground" data-testid={`hosting-yt-skip-${e.id}`}>Not this one</Button>}
                    <Button size="sm" variant="outline" onClick={() => { if (sent && !window.confirm("It's already on YouTube. Post it a second time?")) return; void act(e, "youtube", sent ? { again: true } : {}, "On its way to YouTube"); }} disabled={busy != null || !ready} className="h-8 gap-1.5 rounded-full" data-testid={`hosting-yt-${e.id}`}>{busy === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {sent ? "Post again" : "Post now"}</Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : <p className="mt-2 text-sm text-muted-foreground">Episodes made from a video (an MP4 you upload, or a Library recording) can go to YouTube too. This show's are audio only so far.</p>}
    </div>
  );
}

/** The show they told us about at sign-up, hosted somewhere else: what it is, and moving it here in one press. */
export function YourShowElsewhere({ name, rss, onMoved }: { name: string; rss: string; onMoved: () => void }) {
  const { toast } = useToast();
  const found = useQuery<{ title: string; host: string; rss: string; image: string; apple: string; episodes: number }[]>({
    queryKey: ["/api/host/find-show", name],
    queryFn: async () => (await apiRequest("GET", `/api/host/find-show?q=${encodeURIComponent(name)}`)).json(),
    enabled: name.length > 1,
    staleTime: 3600_000,
  });
  const show = (found.data ?? []).find((x) => x.rss === rss);
  const move = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/host/hosting/import", { feedUrl: rss })).json() as Promise<{ episodes: number }>,
    onSuccess: (r) => { toast({ title: "Your show is here", description: `${r.episodes} episode${r.episodes === 1 ? "" : "s"} moved over. Next: forward your old feed so your subscribers follow.` }); onMoved(); },
    onError: (e: Error) => toast({ title: "Couldn't move it", description: e.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  let host = "";
  try { host = new URL(rss).hostname.replace(/^(www|feeds?|rss)\./, ""); } catch { /* fine */ }
  // Already hosted here, on another account: importing would copy it under a second feed address. Moving between accounts is
  // admin-only (Andrew, 23 Nov: "Admin-only is fine"), so the card asks us instead, and we move it (Admin → contact → Move).
  const elsewhere = useQuery<{ elsewhere: boolean; title?: string; asked?: boolean }>({
    queryKey: ["/api/host/hosting/elsewhere", rss],
    queryFn: async () => (await apiRequest("GET", `/api/host/hosting/elsewhere?rss=${encodeURIComponent(rss)}`)).json(),
    staleTime: 60_000,
  });
  const ours = elsewhere.data?.elsewhere ?? /(^|\.)militaryvoices?\.ai$/i.test(host);
  const [asked, setAsked] = useState(false);
  const ask = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/host/hosting/ask-move", { rss })).json(),
    onSuccess: () => setAsked(true),
    onError: (e: Error) => toast({ title: "Not sent yet", description: e.message.replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  const sent = asked || !!elsewhere.data?.asked;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-4 rounded-2xl border border-[#053877]/25 bg-[#053877]/[0.04] p-5 text-left" data-testid="hosting-yours">
      {show?.image ? <img src={show.image} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover shadow-sm" /> : <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-[#053877] text-2xl font-bold text-white">{name.charAt(0)}</span>}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Your show</p>
        <p className="mt-0.5 text-lg font-semibold">{show?.title || name}</p>
        <p className="text-sm text-muted-foreground">{[show?.episodes ? `${show.episodes} episodes` : "", host && `hosted at ${host}`].filter(Boolean).join(" · ")}{show?.apple ? <> · <a href={show.apple} target="_blank" rel="noreferrer" className="hover:underline">on Apple Podcasts</a></> : null}</p>
        <p className="mt-1 text-sm">{!ours ? "It's on your card and SmartLink already. Host it here and your downloads are counted the way sponsors count them."
          : sent ? <span className="font-medium text-emerald-700 dark:text-emerald-400" data-testid="hosting-ask-sent">Sent. We'll move it with its feed, listings and downloads unchanged, and email you when it's done.</span>
          : "This show is hosted on another MilitaryVoices account. We'll move it to this one, with its feed, listings and downloads unchanged."}</p>
      </div>
      {ours && !sent && <Button onClick={() => ask.mutate()} disabled={ask.isPending || elsewhere.isLoading} className="h-10 gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="hosting-ask-move">{ask.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : "Ask us to move it"}</Button>}
      {!ours && <Button onClick={() => move.mutate()} disabled={move.isPending} className="h-10 gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="hosting-move-yours">{move.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Moving…</> : "Move it here"}</Button>}
    </div>
  );
}

/** Move a show here from its old host: its feed brings every episode, with their IDs, so no app plays one twice. */
function ImportShow({ onDone, initialUrl = "" }: { onDone: () => void; initialUrl?: string }) {
  const { toast } = useToast();
  const [url, setUrl] = useState(initialUrl);
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
              {/buzzsprout\.com/i.test(s.importedFrom ?? "")
                ? <li>In Buzzsprout, go to <b>Settings</b>, then <b>Podcast Settings</b>, then the <b>Redirect</b> tab.</li>
                : <li>At your old host, find <b>Redirect feed</b>, <b>301 redirect</b> or <b>Move to a new host</b> (usually in the show's settings, under RSS or Distribution).</li>}
              <li>Paste your new feed address: <button type="button" onClick={() => navigator.clipboard.writeText(h.feedUrl).then(() => t2({ title: "Copied" }))} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-muted/70">{h.feedUrl.replace(/^https:\/\//, "")} <Copy className="h-3 w-3" /></button></li>
              <li>Save, then press <b>Check the redirect</b>. Keep the old account open for four weeks while the apps catch up.</li>
            </ol>
          )}
          {!s.redirectOk && (
            <div className="mt-3 rounded-xl bg-[#F0A71F]/10 px-3 py-2.5 text-sm">
              <p className="font-semibold">Can't get into your old host?</p>
              <p className="mt-0.5 text-muted-foreground">Ask their support to turn on the redirect to your new feed; hosts do this even for paused or unpaid accounts. And if you own your Apple listing, you can change its feed address yourself in Apple Podcasts Connect (your show's information, RSS feed).</p>
            </div>
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
      fd.append("file", await shrinkImage(file));
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
  // Change cover opens a square crop first (Andrew, 23 Nov: "Change cover with a square crop"). Too small for Apple: said
  // before the crop, never blown up to fit.
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const closeCrop = () => { if (cropSrc) URL.revokeObjectURL(cropSrc); setCropSrc(null); if (input.current) input.current.value = ""; };
  const pick = async (file: File) => {
    let side = 0;
    try { const bmp = await createImageBitmap(file); side = Math.min(bmp.width, bmp.height); bmp.close(); } catch { side = -1; }
    if (side >= 0 && side < 1400) {
      if (input.current) input.current.value = "";
      return toast({ title: "That picture is too small", description: `It's ${side} pixels on its short side. Apple and Spotify ask for at least 1400 × 1400.`, variant: "destructive" });
    }
    if (side < 0) return void go(file); // a picture the browser can't read (HEIC): the server judges it
    setCropSrc(URL.createObjectURL(file));
  };
  const go = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", await shrinkImage(file));
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
      <input ref={input} id={`hosting-art-input-${show.id}`} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
      <PhotoCropDialog kind="cover" open={!!cropSrc} imageSrc={cropSrc} onCancel={closeCrop} onConfirm={(blob) => { closeCrop(); void go(new File([blob], "cover.jpg", { type: "image/jpeg" })); }} />
      <button type="button" onClick={() => input.current?.click()} disabled={busy} className="group relative h-32 w-32 shrink-0 overflow-hidden rounded-2xl border border-border bg-muted" title="Cover art: square JPG or PNG, 1400 to 3000 pixels" data-testid="hosting-artwork">
        {show.artworkUrl ? <img src={show.artworkUrl} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground"><ImagePlus className="h-6 w-6" /> Cover art</span>}
        <span className={`absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-semibold text-white transition-opacity ${busy ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Change"}</span>
      </button>
    </>
  );
}

function ShowForm({ show, categories, onSaved, focus = "" }: { show: HostedShowRow; categories: Record<string, string[]>; onSaved: () => void; focus?: string }) {
  const { toast } = useToast();
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
        <h2 className="text-base font-semibold">Show details</h2>
        <p className="mb-4 mt-0.5 text-sm text-muted-foreground">What Apple, Spotify and every podcast app show about your podcast.</p>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        {/* The cover, changed right here (a square crop first). */}
        <div className="mx-auto w-40 shrink-0 text-center sm:mx-0" data-testid="hosting-details-cover">
          <button type="button" onClick={() => document.getElementById(`hosting-art-input-${show.id}`)?.click()} className="block aspect-square w-40 overflow-hidden rounded-2xl border border-border bg-muted" aria-label="Change cover">
            {show.artworkUrl ? <img src={show.artworkUrl} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground"><ImagePlus className="h-7 w-7" /> No cover yet</span>}
          </button>
          <Button type="button" variant="outline" onClick={() => document.getElementById(`hosting-art-input-${show.id}`)?.click()} className="mt-2.5 h-9 w-full rounded-full font-semibold text-[#053877] dark:text-[#8fb5e8]" data-testid="hosting-change-cover">{show.artworkUrl ? "Change cover" : "Add a cover"}</Button>
          <p className="mt-1.5 text-xs leading-snug text-muted-foreground">Square, at least 1400&nbsp;×&nbsp;1400. We crop it for&nbsp;you.</p>
        </div>
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
          <label className={`${label} sm:col-span-2`}>Show name<Input autoFocus={focus === "title"} value={v.title} onChange={(e) => set("title", e.target.value)} className="mt-1 font-normal text-foreground" /></label>
          <label className={`${label} sm:col-span-2`}>Description<Textarea autoFocus={focus === "description"} value={v.description} onChange={(e) => set("description", e.target.value)} rows={9} className="mt-1 font-normal text-foreground" placeholder="What the show is about, who it's for, and who hosts it." /></label>
          <label className={`${label} sm:col-span-2`}>Under every episode (your sign-off)
            <Textarea value={v.episodeFooter ?? ""} onChange={(e) => set("episodeFooter", e.target.value)} rows={11} className="mt-1 font-normal text-foreground" placeholder={"Your name and title\nYour website and social links\nYour email"} data-testid="hosting-signoff" />
            <span className="mt-1 block font-normal">Added at the end of every episode's notes on Apple, Spotify and YouTube: who you are, your links, how to reach&nbsp;you.</span>
          </label>
          <label className={label}>Host or author<Input value={v.author} onChange={(e) => set("author", e.target.value)} className="mt-1 font-normal text-foreground" /></label>
          <label className={label}>Owner email<Input autoFocus={focus === "ownerEmail"} type="email" value={v.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)} className="mt-1 font-normal text-foreground" /></label>
          <label className={label}>Category
            <select value={v.category} onChange={(e) => { set("category", e.target.value); set("subcategory", ""); }} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal text-foreground">
              {Object.keys(categories).map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className={label}>Subcategory
            <select value={v.subcategory} onChange={(e) => set("subcategory", e.target.value)} disabled={!(categories[v.category] ?? []).length} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal text-foreground disabled:opacity-50">
              <option value="">None</option>
              {(categories[v.category] ?? []).map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className={label}>Website (optional)<Input value={v.website} onChange={(e) => set("website", e.target.value)} className="mt-1 font-normal text-foreground" placeholder="https://" /></label>
          <label className={label}>Copyright (optional)<Input value={v.copyright} onChange={(e) => set("copyright", e.target.value)} className="mt-1 font-normal text-foreground" placeholder={`© ${new Date().getFullYear()} ${v.author || v.title}`} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.explicit} onChange={(e) => set("explicit", e.target.checked)} /> Explicit language</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.showType === "serial"} onChange={(e) => set("showType", e.target.checked ? "serial" : "episodic")} /> Listen in order (a series)</label>
          <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={v.aiVoice} onChange={(e) => set("aiVoice", e.target.checked)} className="mt-1 font-normal text-foreground" data-testid="hosting-ai-voice" /><span>AI voices (a synthetic host or narrator)<span className="block text-xs text-muted-foreground">Listen Notes doesn't list AI-voiced shows, so we won't send this one there.</span></span></label>
        </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          {dirty && <Button variant="outline" onClick={() => setF({})}>Undo changes</Button>}
          <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty} className="bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="hosting-details-save">{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Deleting the show, at the bottom of Settings → Redirect (Andrew, 23 Nov): a pop-up that says what goes and points to
 * moving first. It goes to Recently deleted for 15 days, so it can be put back.
 */
function DeleteShow({ show, onDeleted }: { show: HostedShowRow; onDeleted: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [sure, setSure] = useState("");
  const del = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/host/hosting/shows/${show.id}`, { confirm: sure })).json(),
    onSuccess: () => { setOpen(false); setSure(""); onDeleted(); toast({ title: "Show deleted", description: "Its feed has stopped. Put it back from Recently deleted within 15 days." }); },
    onError: (e: Error) => toast({ title: "Not deleted", description: e.message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" }),
  });
  const close = () => { setOpen(false); setSure(""); };
  return (
    <div className="mt-6 flex justify-center" data-testid="hosting-delete-area">
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-destructive hover:underline" data-testid="hosting-delete">Delete this show…</button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {show.title}?</DialogTitle>
            <DialogDescription>Are you sure? All of your episodes will be deleted, and your feed stops, so Apple, Spotify and the other apps lose the&nbsp;show.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {show.newFeedUrl
              ? <p className="rounded-lg bg-muted/60 px-3 py-2"><b>Your move is on.</b> Deleting stops the forward, so any app that hasn't followed yet loses the show. Wait until Apple and Spotify show your new&nbsp;host.</p>
              : <p className="rounded-lg bg-muted/60 px-3 py-2"><b>Moving to a new host?</b> Do that first with the steps above: they copy every episode over and your subscribers come with you. Download your stats there too.</p>}
            <p>We keep it in Recently deleted for 15 days, in case you change your mind. Type the show's name to delete&nbsp;it.</p>
            <Input value={sure} onChange={(e) => setSure(e.target.value)} placeholder={show.title} data-testid="hosting-delete-confirm" />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={close}>Keep it</Button>
            <Button onClick={() => del.mutate()} disabled={del.isPending || sure.trim().toLowerCase() !== show.title.trim().toLowerCase()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="hosting-delete-go">{del.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Delete this show</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Their downloads, every day since the first one, as a spreadsheet: before a move, since their new host counts from then on. */
async function downloadStats(title: string): Promise<boolean> {
  const r = (await (await apiRequest("GET", "/api/host/podcast-stats")).json()) as { sources: { source: string; showName: string; data: PodcastStatsData }[] };
  const d = r.sources.find((x) => x.source === "militaryvoices" && x.showName === title)?.data;
  if (!d) return false;
  const cell = (v: string | number) => (typeof v === "number" ? String(v) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const apps = Object.keys(d.appDays ?? {}).sort();
  const lines = [
    ["Date", "Downloads", ...apps].map(cell).join(","),
    ...(d.series ?? []).map((x) => [x.date, x.count, ...apps.map((a) => d.appDays?.[a]?.[x.date] ?? 0)].map(cell).join(",")),
    "",
    ["Episode", "Published", "Downloads"].map(cell).join(","),
    ...d.episodes.map((e) => [e.title, e.published, e.count].map(cell).join(",")),
  ];
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${title.replace(/[^\w -]+/g, "").trim() || "podcast"} downloads.csv` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}

/**
 * Moving the show to another host, as its own card with every step (Andrew, 23 Nov: "put a whole section down there,
 * move to another host, and leave 'Optional' out … make sure we have all the steps that are entailed in moving it over").
 * Saving the new host's feed address turns on the 301 and Apple's new-feed tag; clearing it stops the move.
 */
function MoveHost({ show, feedUrl, onSaved }: { show: HostedShowRow; feedUrl: string; onSaved: () => void }) {
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const moving = !!show.newFeedUrl;
  const valid = /^https?:\/\/\S+\.\S+/i.test(url.trim()) && !url.trim().startsWith(feedUrl);
  const save = useMutation({
    mutationFn: async (newFeedUrl: string) => (await apiRequest("PATCH", `/api/host/hosting/shows/${show.id}`, { newFeedUrl })).json(),
    onSuccess: (_d, newFeedUrl) => {
      setConfirm(false); setUrl(""); onSaved();
      toast(newFeedUrl ? { title: "Your feed is moving", description: "Every app is being sent to your new host. Keep this show here so the forward keeps working." } : { title: "Move stopped", description: "Your feed is here again, and the apps read it from MilitaryVoices." });
    },
    onError: (e: Error) => toast({ title: "Couldn't save that", description: e.message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" }),
  });
  const stats = async () => {
    setBusy(true);
    try { if (!(await downloadStats(show.title))) toast({ title: "No downloads yet", description: "There's nothing to save until the show has an episode out." }); }
    catch { toast({ title: "Couldn't get your stats", description: "Try again in a minute.", variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const statsBtn = (
    <Button type="button" variant="outline" size="sm" onClick={stats} disabled={busy} className="mt-2 h-8 gap-1.5 rounded-full text-xs" data-testid="move-stats">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download your stats
    </Button>
  );
  const copyFeed = (
    <button type="button" onClick={() => navigator.clipboard.writeText(feedUrl).then(() => toast({ title: "Feed address copied", description: "Paste it into your new host's import." }))} className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium hover:bg-muted" data-testid="move-copy-feed">
      <Radio className="h-3.5 w-3.5 shrink-0 text-[#b36b00]" /> <span className="truncate">{feedUrl.replace(/^https:\/\//, "")}</span> <Copy className="h-3 w-3 shrink-0 text-muted-foreground" />
    </button>
  );
  const steps: { body: React.ReactNode; extra?: React.ReactNode; done?: boolean }[] = [
    { body: <><b>Download your stats first.</b> After the move, your new host counts your downloads, not&nbsp;us.</>, extra: statsBtn },
    { body: <><b>At your new host, import your show</b> using this feed address. They copy your episodes&nbsp;over.</>, extra: copyFeed },
    { body: moving
        ? <><b>Your feed forwards to your new host.</b> Every podcast app is sent there, and your subscribers follow. <span className="text-muted-foreground">(A 301 redirect, plus Apple's new-feed&nbsp;tag.)</span></>
        : <><b>Paste your new host's feed address below</b> and press Move my feed. Every podcast app is sent there, and your subscribers follow. <span className="text-muted-foreground">(A 301 redirect, plus Apple's new-feed&nbsp;tag.)</span></>, done: moving },
    { body: <><b>Keep this show here, and don't delete&nbsp;it.</b> The forward only works while it's here. Apple and Spotify usually follow within a few&nbsp;days.</> },
    { body: <><b>Your SmartLink, Studio, clips and MilitaryVoices page stay&nbsp;yours.</b></> },
  ];
  return (
    <div id="move-host" className="scroll-mt-24 rounded-2xl border border-border bg-card p-5 shadow-sm" data-testid="move-host">
      <h3 className="text-base font-semibold text-foreground">Move to another host</h3>
      <p className="mt-0.5 text-sm text-muted-foreground">Your subscribers come with you. Here's the whole move, in&nbsp;order.</p>
      <ol className="mt-4 space-y-3.5">
        {steps.map((st, i) => (
          <li key={i} className="flex gap-3 text-sm leading-snug" data-testid={`move-step-${i + 1}`}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${st.done ? "bg-[#067647] text-white" : "bg-[#053877]/10 text-[#053877] dark:bg-white/10 dark:text-white"}`}>{st.done ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
            <div className="min-w-0 pt-0.5 [text-wrap:pretty]">{st.body}{st.extra && <div>{st.extra}</div>}</div>
          </li>
        ))}
      </ol>
      <div className="mt-5 border-t border-border pt-4">
        {moving ? (
          <div className="rounded-xl border border-[#abefc6] bg-[#ecfdf3] p-3.5 text-sm text-[#05603a] dark:border-[#067647]/50 dark:bg-[#067647]/15 dark:text-[#a6f4c5]" data-testid="move-on">
            <p className="font-semibold">The move is on.</p>
            <p className="mt-0.5">Every app is sent to <span className="break-all font-mono text-xs">{show.newFeedUrl}</span>. Keep this show here so the forward keeps&nbsp;working.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => save.mutate("")} disabled={save.isPending} className="mt-3 h-8 rounded-full bg-white text-xs text-foreground dark:bg-transparent" data-testid="move-stop">
              {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Stop the move
            </Button>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (valid) setConfirm(true); }}>
            <label htmlFor="move-url" className="block text-xs font-semibold text-muted-foreground">Your new host's feed address</label>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <Input id="move-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://feeds.newhost.com/your-show" inputMode="url" autoComplete="off" spellCheck={false} className="min-w-0 flex-1" data-testid="move-url" />
              <Button type="submit" disabled={!valid} className="shrink-0 bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="move-go">Move my feed</Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{url.trim() && url.trim().startsWith(feedUrl) ? "That's this feed. Paste the address from your new host." : "Leave it empty to stay here."}</p>
          </form>
        )}
      </div>
      <Dialog open={confirm} onOpenChange={(o) => !save.isPending && setConfirm(o)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="[text-wrap:balance]">Move {show.title} to your new&nbsp;host?</DialogTitle>
            <DialogDescription className="[text-wrap:pretty]">Every podcast app will be sent to <span className="break-all font-mono text-xs text-foreground">{url.trim()}</span>, and your subscribers will follow. New downloads are counted there, not here. You can stop the move while this show is still&nbsp;here.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirm(false)} disabled={save.isPending}>Not yet</Button>
            <Button onClick={() => save.mutate(url.trim())} disabled={save.isPending} className="bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="move-confirm">{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Move my feed</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A new episode: the audio first (a file, or a clean episode from the Library), then its words. */
/** Now, as the value a date-and-time picker wants (their own clock), so it can't pick a time that has passed. */
const localNow = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000); return d.toISOString().slice(0, 16); };

/** One episode, a whole page (borrowed from the best of what hosts offer, then made plainer): the player, the words, when it goes out, where it is. */
/**
 * The show's intro and outro on their own, from the episode page (Andrew, 23 Nov 2026: "so he can just easily go into
 * one and click intro and outro and listen"). The player above already plays the whole episode with them on.
 */
function BookendListen({ show, ep, state }: { show: HostedShowRow; ep: Ep; state: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<"" | "intro" | "outro">("");
  useEffect(() => () => { audio.current?.pause(); }, []);
  const play = (kind: "intro" | "outro") => {
    if (playing === kind) { audio.current?.pause(); setPlaying(""); return; }
    audio.current?.pause();
    const a = new Audio(`/api/host/hosting/shows/${show.id}/bookend/${kind}?ep=${ep.id}`);
    a.onended = () => setPlaying("");
    audio.current = a; setPlaying(kind); void a.play().catch(() => setPlaying(""));
  };
  const btn = (kind: "intro" | "outro", label: string) => (
    <button type="button" onClick={() => play(kind)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${playing === kind ? "border-[#053877] bg-[#053877] text-white" : "border-border text-[#053877] hover:border-[#053877]/50 dark:text-[#8fb5e8]"}`} data-testid={`episode-listen-${kind}`}>
      {playing === kind ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {label}
    </button>
  );
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-xs" data-testid="episode-bookend-listen">
      <span className="text-muted-foreground">{state === "ready" ? "Plays with your intro and outro, as the apps hear it. Hear them on their own:" : state === "failed" ? "Your intro and outro couldn't be added yet. Hear them on their own:" : "Your intro and outro are being added (a few minutes). Hear them on their own:"}</span>
      {(ep.introKey || show.introKey) && btn("intro", ep.introKey ? "Intro (this episode's)" : "Intro")}
      {show.outroKey && btn("outro", "Outro")}
    </div>
  );
}

function EpisodePage({ ep, show, youtubeReady, production, onDirectories, onBack, onSaved, onAddSpot }: { ep: Ep; show: HostedShowRow; youtubeReady: boolean; production: boolean; onDirectories?: () => void; onBack: () => void; onSaved: () => void; onAddSpot: (episodeId: number) => void }) {
  const { toast } = useToast();
  const [f, setF] = useState<Record<string, unknown>>({});
  const [at, setAt] = useState("");
  // A date and time means "schedule it"; empty means it goes out the moment they press Publish.
  const when: "now" | "later" = at ? "later" : "now";
  const [writing, setWriting] = useState(false);
  const [yt, setYt] = useState<boolean | null>(null);
  const [pull, setPull] = useState<{ open: boolean; url: string; busy: boolean }>({ open: false, url: "", busy: false });
  const [pct, setPct] = useState<number | null>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const ytState = (() => { try { return ep.youtube ? (JSON.parse(ep.youtube) as { state?: string }).state ?? "" : ""; } catch { return ""; } })();
  const offerYt = ep.status === "draft" && !!ep.hasVideo && ytState !== "sent" && !ep.ytLibrary;
  // The YouTube tick starts from the show's saved choice (youtubeMode; a show that never chose stays unticked). Publishing
  // with it ticked makes it the show's choice; unticked leaves just this episode off. Who can see it is the show's too
  // (youtubePrivacy), changed here. Nothing changes for a show until they publish (Andrew, 23 Nov 2026: "Yes, build both").
  const ytOn = yt ?? (youtubeReady && show.youtubeMode === "always" && ytState !== "skipped");
  const [privacy, setPrivacy] = useState(show.youtubePrivacy || "public");
  const v = { ...ep, ...f } as Ep;
  const set = (k: string, val: unknown) => setF((x) => ({ ...x, [k]: val }));
  // People type notes in plain words: an imported episode's HTML is shown as text, and kept as it was unless they change it.
  const notesPlain = ep.notesFormat === "html" ? htmlToText(ep.description) : ep.description;
  const hasAudio = !!(ep.audioKey || ep.audioUrl);
  // A new draft's title and notes are written for them (server: autoWriteSweep); until then the notes box says so, and the page checks back.
  const autoPending = ep.status === "draft" && hasAudio && !notesPlain.trim() && (ep.autoWrite === "queued" || ep.autoWrite === "retry" || (ep.autoWrite === "" && ep.createdAt >= "2026-11-23T00:00:00.000Z"));
  useEffect(() => {
    if (!autoPending) return;
    const t = setInterval(onSaved, 20_000);
    return () => clearInterval(t);
  }, [autoPending, onSaved]);
  const dirty = Object.keys(f).length > 0;
  // The show's intro and outro: on for episodes made after they were set, unless this one says otherwise.
  const bookendsOn = (v.bookends ?? "") === "on" || ((v.bookends ?? "") !== "off" && !!show.bookendsSince && ep.createdAt >= show.bookendsSince);
  const bookendState = (ep as Ep & { bookend?: { state?: string } }).bookend?.state ?? "";
  const label = "block text-xs font-semibold text-muted-foreground";
  const save = async (status?: "published" | "draft") => {
    try {
      const body: Record<string, unknown> = { ...f };
      if (status) body.status = status;
      if (status === "published" && when === "later" && at) body.publishedAt = new Date(at).toISOString();
      if (status === "published" && ep.status !== "published" && when === "now") body.publishedAt = new Date().toISOString();
      if (status === "published" && offerYt && youtubeReady) {
        body.youtube = ytOn;
        // Remembered for the show, before the episode goes (it's posted with the show's privacy). Ticking it sticks
        // (the next one starts ticked); unticking leaves just this one off, as Directories says.
        const showPatch: Record<string, unknown> = {};
        if (ytOn && show.youtubeMode !== "always") showPatch.youtubeMode = "always";
        if (ytOn && privacy !== show.youtubePrivacy) showPatch.youtubePrivacy = privacy;
        if (Object.keys(showPatch).length) await apiRequest("PATCH", `/api/host/hosting/shows/${show.id}`, showPatch);
      }
      const out = (await (await apiRequest("PATCH", `/api/host/hosting/episodes/${ep.id}`, body)).json()) as Ep & { youtubeError?: string };
      if (out.youtubeError) toast({ title: "Published, but not on YouTube", description: out.youtubeError, variant: "destructive" });
      onSaved();
      setF({});
      const waiting = status === "published" && !out.audioKey && !out.audioUrl && !!out.audioJob;
      toast(waiting
        ? { title: when === "later" && at ? "Scheduled" : "It goes out as soon as it's ready", description: "Its audio is being made: a few minutes. It joins your feed by itself; nothing else to do." }
        : { title: status === "published" ? (when === "later" && at ? "Scheduled" : "Published") : status === "draft" ? "Unpublished" : "Saved", description: status === "published" ? "It's in your feed. The apps pick it up within the hour." : undefined });
    } catch (e) {
      toast({ title: "Couldn't save", description: (e as Error).message.replace(/^\d+:\s*/, ""), variant: "destructive" });
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${ep.title}"?\n\nIt leaves your feed and your show page right away. Apple Podcasts, Spotify and the other apps drop it the next time they check (usually within hours).${ytState === "sent" || ep.ytLibrary ? "\n\nIt stays on YouTube until you remove it there." : ""}\n\nWe keep a copy for 15 days in Recently deleted, in case you change your mind. After that it's gone for good.`)) return;
    await apiRequest("DELETE", `/api/host/hosting/episodes/${ep.id}`);
    onSaved();
    onBack();
  };
  const addAudio = async (file: File) => {
    if (!/^audio\/|^video\/mp4/.test(file.type)) return toast({ title: "That file won't play as an episode", description: "Choose an MP3 or M4A, or an MP4 video.", variant: "destructive" });
    try {
      setPct(0);
      const dur = await durationOf(file).catch(() => 0);
      const key = await uploadToStorage(file, setPct);
      await apiRequest("PATCH", `/api/host/hosting/episodes/${ep.id}`, { audioKey: key, mime: file.type === "audio/mp3" ? "audio/mpeg" : file.type, sizeBytes: file.size, durationSec: Math.round(dur) });
      onSaved();
      toast({ title: "Audio added" });
    } catch (e) {
      toast({ title: "Couldn't upload that", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPct(null);
      if (fileIn.current) fileIn.current.value = "";
    }
  };
  const pullNow = async (url?: string) => {
    setPull((p) => ({ ...p, busy: true }));
    try {
      const r = (await (await apiRequest("POST", `/api/host/hosting/episodes/${ep.id}/pull-from-feed`, { url: url || undefined })).json()) as { found: boolean; title?: string; notes?: string };
      if (!r.found) { toast({ title: "Couldn't find this episode in that feed", description: "Check the feed address, or that the episode is still there." }); return; }
      setF((x) => ({ ...x, title: r.title ?? v.title, description: r.notes ?? "", notesFormat: "text" }));
      setPull({ open: false, url: "", busy: false });
      toast({ title: "Pulled from the feed", description: "The title and notes are filled in. Check them, then press Save." });
    } catch (e) {
      toast({ title: "Couldn't read that feed", description: (e as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" });
    } finally {
      setPull((p) => ({ ...p, busy: false }));
    }
  };
  // "Write it for me": the worker listens to the episode, then a title and notes are drafted. First asks start the
  // listening; the page asks again every few seconds until it's ready, then fills the boxes (nothing is saved until Save).
  const writeIt = async (again = false) => {
    if (!again && ((typeof f.description === "string" ? f.description : notesPlain).trim() && !window.confirm("This replaces the notes you have now (until you press Save). Go on?"))) return;
    setWriting(true);
    try {
      for (let i = 0; i < 90; i++) {
        const r = (await (await apiRequest("POST", `/api/host/hosting/episodes/${ep.id}/write`, { again: again && i === 0 })).json()) as { state: string; title?: string; description?: string; message?: string };
        if (r.state === "done") {
          const placeholder = !v.title.trim() || /[_]|\.(mp3|m4a|mp4|wav)$|^new episode$/i.test(v.title.trim());
          setF((x) => ({ ...x, description: r.description ?? "", notesFormat: "text", ...(placeholder || window.confirm(`Use this title too?\n\n${r.title}`) ? { title: r.title ?? v.title } : {}) }));
          toast({ title: "Written", description: "Read it over and change anything you like, then press Save." });
          return;
        }
        if (r.state === "failed") { toast({ title: "Couldn't write it", description: r.message, variant: "destructive" }); return; }
        if (i === 0) toast({ title: "Listening to your episode", description: "This takes a few minutes. You can keep working; it fills in here when it's ready." });
        await new Promise((res) => setTimeout(res, 8000));
      }
      toast({ title: "Still listening", description: "It's taking longer than usual. Press Write it for me again in a few minutes." });
    } catch (e) {
      toast({ title: "Couldn't write it", description: (e as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" });
    } finally { setWriting(false); }
  };
  const removeAudio = async () => {
    if (!window.confirm("Take this audio off the episode? You can then upload a new file. Your title and notes stay.")) return;
    try { await apiRequest("PATCH", `/api/host/hosting/episodes/${ep.id}`, { removeAudio: true }); onSaved(); toast({ title: "Audio removed", description: "Choose the new file below." }); }
    catch (e) { toast({ title: "Couldn't remove it", description: (e as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" }); }
  };
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); toast({ title: `${what} copied` }); } catch { toast({ title: what, description: text }); } };
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const stage = stageOf(ep);
  const statusLine = ep.live ? `Live since ${dateOf(ep.publishedAt)}` : ep.status === "published" ? `Goes out ${dateOf(ep.publishedAt)}` : stage === "post" ? "We're still working on this one. It isn't in your feed." : "Ready for you to publish. It isn't in your feed yet.";
  const setStage = async (st: "post" | "final") => {
    try {
      await apiRequest("PATCH", `/api/host/hosting/episodes/${ep.id}`, { stage: st });
      onSaved();
      toast(st === "final" ? { title: show.autoPublish ? "Final draft: it's going out" : "Final draft", description: show.autoPublish ? "Your show publishes by itself (Settings → Publishing), so it's going out now." : "Press Publish when you're happy with it." } : { title: "Back in post-production" });
    } catch (e) { toast({ title: "Couldn't change that", description: (e as Error).message.replace(/^\d+:\s*/, ""), variant: "destructive" }); }
  };
  return (
    <div className="space-y-4" data-testid="episode-page">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="episode-back"><ChevronLeft className="h-4 w-4" /> All episodes</button>
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm" data-testid="episode-player">
            {hasAudio ? (
              <audio key={ep.id} controls preload="none" src={`/e/${ep.id}.mp3?preview=1`} className="w-full" data-testid="hosting-ep-player" />
            ) : ep.audioJob && ep.audioJob !== "failed" ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Its audio is being made. You can play it here in a few minutes.</p>
            ) : (
              <>
                <input ref={fileIn} type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,video/mp4,.mp3,.m4a,.mp4" className="hidden" onChange={(e) => e.target.files?.[0] && void addAudio(e.target.files[0])} />
                <button type="button" onClick={() => fileIn.current?.click()} disabled={pct !== null} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const x = e.dataTransfer.files?.[0]; if (x) void addAudio(x); }} className="flex h-28 w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-sm hover:border-[#053877]/50 hover:bg-muted/40 disabled:opacity-60" data-testid="episode-add-audio">
                  {pct === null ? <><Upload className="h-5 w-5 text-[#053877]" /><span className="font-semibold">{ep.audioJob === "failed" ? "Its audio couldn't be made. Add the file again" : "Add the audio: drag the file here or choose it"}</span><span className="text-xs text-muted-foreground">MP3 or M4A, or an MP4 video</span></> : <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Uploading… {Math.round(pct)}%</span>}
                </button>
              </>
            )}
            {hasAudio && bookendsOn && !!(ep.introKey || show.introKey || show.outroKey) && <BookendListen show={show} ep={ep} state={bookendState} />}
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span><b className="tabular-nums">{compact(ep.downloads)}</b> <span className="text-muted-foreground">downloads</span></span>
              {ep.durationSec > 0 && <span><b className="tabular-nums">{hms(ep.durationSec)}</b> <span className="text-muted-foreground">long</span></span>}
              <span className="text-muted-foreground">{statusLine}</span>
              {hasAudio && ep.status === "draft" && !ep.audioJob && <button type="button" onClick={() => void removeAudio()} className="ml-auto text-xs font-semibold text-muted-foreground underline hover:text-foreground" data-testid="episode-remove-audio">Remove this audio and upload a new one</button>}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm" data-testid="episode-details">
            <label className={label}>Title<Input value={v.title} onChange={(e) => set("title", e.target.value)} className="mt-1 h-11 text-base font-semibold" placeholder="Episode title" data-testid="hosting-ep-title" /></label>
            <div className="mt-4 flex flex-wrap items-end gap-4">
              <div><span className={label}>Picture</span><div className="mt-1"><EpisodeArt ep={ep} fallback={show.artworkUrl} onDone={onSaved} /></div></div>
              <label className={label}>Episode<Input type="number" min={0} value={v.episodeNumber ?? ""} onChange={(e) => set("episodeNumber", e.target.value === "" ? null : Number(e.target.value))} className="mt-1 w-24" /></label>
              <label className={label}>Season<Input type="number" min={0} value={v.season ?? ""} onChange={(e) => set("season", e.target.value === "" ? null : Number(e.target.value))} className="mt-1 w-24" /></label>
              <label className={label}>Type
                <select value={v.episodeType} onChange={(e) => set("episodeType", e.target.value)} className="mt-1 block h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground">
                  <option value="full">Full episode</option><option value="trailer">Trailer</option><option value="bonus">Bonus</option>
                </select>
              </label>
              <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={v.explicit} onChange={(e) => set("explicit", e.target.checked)} /> Explicit</label>
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className={label}>Description (show notes)</span>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <button type="button" onClick={() => void writeIt()} disabled={writing || !hasAudio} title={hasAudio ? "We listen to the episode and write the title and notes" : undefined} className="inline-flex items-center gap-1 text-xs font-semibold text-[#053877] hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline disabled:opacity-80 dark:text-[#8fb5e8]" data-testid="episode-write">
                  {writing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {writing ? "Listening…" : hasAudio ? "Write it for me" : ep.audioJob && ep.audioJob !== "failed" ? "Write it for me: ready when the audio is done" : "Write it for me: add the audio first"}
                </button>
                {show.importedFrom && !ep.recordingId && (
                  <button type="button" onClick={() => void pullNow()} disabled={pull.busy} className="inline-flex items-center gap-1 text-xs font-semibold text-[#053877] hover:underline disabled:opacity-60 dark:text-[#8fb5e8]" data-testid="episode-pull">
                    {pull.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radio className="h-3.5 w-3.5" />} Pull from your old feed
                  </button>
                )}
              </span>
            </div>
            <div className="relative">
              <Textarea value={typeof f.description === "string" ? f.description : notesPlain} onChange={(e) => setF((x) => ({ ...x, description: e.target.value, notesFormat: "text" }))} readOnly={writing || autoPending} rows={12} placeholder="What it's about, who's on it, and any links you mention." data-testid="hosting-ep-notes" />
              {(writing || autoPending) && (
                // The "listening" state sits in the box itself, so it's plain that something is happening (Andrew, 23 Nov).
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md bg-card/90 px-6 text-center" data-testid="episode-writing">
                  <Loader2 className="h-7 w-7 animate-spin text-[#053877] dark:text-[#8fb5e8]" />
                  <p className="text-base font-semibold">{writing ? "Listening to your episode…" : "Writing your title and notes…"}</p>
                  <p className="max-w-sm text-sm text-muted-foreground">This takes a few minutes. The title and notes appear here when they're ready. You can keep working.</p>
                </div>
              )}
            </div>
            {/* No Guest box: the notes say who is on it, written from the episode (Andrew, 23 Nov). */}
            {false && (show.introKey || show.outroKey) && hasAudio && (
              <div className="mt-3 rounded-xl border border-border px-3 py-2.5 text-sm" data-testid="hosting-ep-bookends">
                <label className="flex items-center gap-2"><input type="checkbox" checked={bookendsOn} onChange={(e) => set("bookends", e.target.checked ? "on" : "off")} /> Add your intro{show.outroKey ? " and outro" : ""} to this episode</label>
                <p className="mt-1 text-xs text-muted-foreground">{!bookendsOn ? "Plays as you uploaded it." : bookendState === "ready" ? "Added. The apps play it with your intro and outro." : bookendState === "failed" ? "Couldn't add them. Save again to retry." : "Being added now: a few minutes. Until then the apps play it as it is."}</p>
              </div>
            )}
            {hasAudio && (
              <label className="mt-3 flex items-center gap-2 rounded-xl border border-border px-3 py-2.5 text-sm" data-testid="hosting-ep-spots"><input type="checkbox" checked={!(v.spotsOff as boolean)} onChange={(e) => set("spotsOff", !e.target.checked)} /> Play your sponsor spots on this episode<button type="button" onClick={() => onAddSpot(ep.id)} className="ml-auto text-xs font-semibold text-[#053877] hover:underline dark:text-[#8fb5e8]" data-testid="episode-add-spot">+ Add a sponsor or shout-out to this episode</button></label>
            )}
            {false && (show.episodeFooter ?? "").trim() && (
              <div className="mt-3 rounded-xl border border-border px-3 py-2.5 text-sm" data-testid="hosting-ep-footer">
                <label className="flex items-center gap-2"><input type="checkbox" checked={!(v.footerOff as boolean)} onChange={(e) => set("footerOff", !e.target.checked)} /> Add your show's footer to this episode</label>
                {!(v.footerOff as boolean) && <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">{fillFooter(show.episodeFooter, { title: v.title, number: v.episodeNumber, season: v.season, guest: (v.guest as string) ?? "" })}</p>}
              </div>
            )}
          </div>
        </div>
        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-2xl border border-border bg-card shadow-sm">
            <div className={`rounded-t-2xl px-4 py-3 text-sm font-semibold ${stage === "live" ? "bg-emerald-600 text-white" : stage === "scheduled" ? "bg-[#053877] text-white" : stage === "final" ? "bg-[#F0A71F] text-[#3a2600]" : stage === "failed" ? "bg-destructive text-white" : "bg-[#053877]/10 text-[#053877] dark:text-[#8fb5e8]"}`} data-testid="episode-stage">{stage === "live" ? "Live" : STAGE[stage].label}</div>
            <div className="space-y-3 p-4 text-sm">
              <p className="text-muted-foreground">{statusLine}</p>
              {ep.delivery && ep.delivery.apps.length > 0 && (() => {
                const d = ep.delivery!;
                const big = d.apps.filter((a) => BIG_APPS.test(a.app));
                const rest = d.apps.filter((a) => !BIG_APPS.test(a.app));
                return (
                  <div className="space-y-2 rounded-xl bg-muted/50 px-3 py-2.5" data-testid="episode-delivery">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground"><Check className="h-3.5 w-3.5 text-emerald-600" /> It's in your feed</p>
                    <p className="text-xs text-muted-foreground">{waiting(d) ? "Apple, Spotify and the other apps pick it up on their own, usually within an hour. There's nothing you need to do, and you can leave this page: it keeps going without you." : "Every app that reads your feed has it."}</p>
                    {ep.announcedAt && <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="episode-announced"><Check className="h-3 w-3 text-emerald-600" /> Announced to the apps {new Date(ep.announcedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>}
                    {big.map((a) => (
                      <div key={a.app} className="text-xs">
                        <p className="flex items-center justify-between gap-2"><span className="font-medium">{a.app}</span>
                          {a.got ? <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400"><Check className="h-3 w-3" /> Has it</span> : slowApp(a) ? <span className="font-semibold text-[#8a5a00] dark:text-[#F0A71F]">Slower than usual</span> : <span className="text-muted-foreground">Will pick it up soon</span>}
                        </p>
                        {!a.got && slowApp(a) && (
                          <p className="mt-0.5 text-muted-foreground">{a.checked ? `${short(a.app)} hasn't looked at your feed for a while.` : `${short(a.app)} hasn't looked at your feed yet.`} {onDirectories && <button type="button" onClick={onDirectories} className="font-semibold text-[#053877] underline dark:text-[#8fb5e8]">See what to do</button>}</p>
                        )}
                      </div>
                    ))}
                    {rest.length > 0 && <p className="text-[11px] text-muted-foreground">{rest.filter((a) => a.got).length} of {rest.length} other apps already have it.</p>}
                  </div>
                );
              })()}
              {ep.status === "draft" && stage === "post" && (
                <>
                  <p className="rounded-xl bg-[#053877]/[0.06] px-3 py-2.5 text-xs text-foreground/80">Your original recording is in your Library. We're editing this one: intro and outro, clean-up, the notes. When it's done it becomes a <b>Final draft</b> and you can publish it.</p>
                  <Button onClick={() => void setStage("final")} disabled={!hasAudio || !!ep.audioJob} className="w-full bg-[#F0A71F] text-[#3a2600] hover:bg-[#d9941a]" data-testid="episode-mark-final">Mark as final draft</Button>
                  {!hasAudio && !ep.audioJob && <p className="text-xs text-muted-foreground">Add the audio first.</p>}
                  <Button variant="outline" onClick={() => void save()} disabled={!dirty} className="w-full">Save changes</Button>
                </>
              )}
              {ep.status === "draft" && stage !== "post" && (
                <>
                  <label className={label}>Schedule it for later (optional)
                    <Input type="datetime-local" value={at} min={localNow()} onChange={(e) => setAt(e.target.value)} className="mt-1 h-9" data-testid="hosting-schedule" />
                    <span className="mt-1 block text-[11px] font-normal">{at ? `Goes out ${new Date(at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} (${Intl.DateTimeFormat().resolvedOptions().timeZone}). ` : "Leave it empty to publish right away. "}{at && <button type="button" onClick={() => setAt("")} className="font-semibold text-[#053877] underline dark:text-[#8fb5e8]">Clear</button>}</span>
                  </label>
                  {ep.ytLibrary && <p className="rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground">Already on YouTube: you posted it from your Library on {dateOf(ep.ytLibrary)}.</p>}
                  {/* Where it goes: every podcast app always; their YouTube channel when it has video, ticked from the show's choice. */}
                  <div className="rounded-xl border border-border p-3" data-testid="hosting-goes-to">
                    <p className="text-xs font-semibold text-muted-foreground">It goes to</p>
                    <ul className="mt-2 space-y-2 text-sm">
                      <li className="flex items-center gap-2"><input type="checkbox" checked disabled aria-label="Every podcast app" className="h-4 w-4" /> <span title="Every podcast app">Apple, Spotify and&nbsp;more</span></li>
                      {offerYt && (youtubeReady ? (
                        <li className="flex flex-wrap items-center gap-2">
                          <label className="flex items-center gap-2"><input type="checkbox" checked={ytOn} onChange={(e) => setYt(e.target.checked)} className="h-4 w-4" data-testid="hosting-publish-yt" /> Your YouTube channel</label>
                          <select value={privacy} disabled={!ytOn} onChange={(e) => setPrivacy(e.target.value)} aria-label="Who can see it on YouTube" className="ml-auto h-8 rounded-md border border-input bg-background px-1.5 text-xs disabled:opacity-50" data-testid="hosting-publish-yt-privacy">
                            <option value="public">Public</option>
                            <option value="unlisted">Unlisted</option>
                            <option value="private">Private</option>
                          </select>
                        </li>
                      ) : (
                        <li className="text-xs text-muted-foreground">Your YouTube channel too? <a href="/host/dashboard/social" className="font-semibold text-[#053877] underline dark:text-[#8fb5e8]">Connect YouTube</a> first.</li>
                      ))}
                    </ul>
                    {offerYt && youtubeReady && !ytOn && <p className="mt-2 text-[11px] text-muted-foreground">Tick YouTube to post this one there&nbsp;too.</p>}
                  </div>
                  <Button onClick={() => void save("published")} disabled={!v.title.trim() || (!!at && Date.parse(at) < Date.now() - 60_000) || (!hasAudio && !ep.audioJob && !ep.recordingId)} className="w-full gap-1.5 bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="hosting-publish"><Send className="h-4 w-4" /> {when === "later" ? "Schedule it" : "Publish now"}</Button>
                  {!hasAudio && !ep.audioJob && !ep.recordingId && <p className="text-xs text-muted-foreground">Add the audio first, then you can publish.</p>}
                  <Button variant="outline" onClick={() => void save()} disabled={!dirty} className="w-full">Save draft</Button>
                  {production && <button type="button" onClick={() => void setStage("post")} className="w-full text-center text-xs font-semibold text-muted-foreground hover:text-foreground" data-testid="episode-back-to-post">Send back to post-production</button>}
                </>
              )}
              {ep.status !== "draft" && (
                <>
                  <Button onClick={() => void save()} disabled={!dirty} className="w-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="episode-save">Save changes</Button>
                  <Button variant="outline" onClick={() => void save("draft")} className="w-full">Unpublish</Button>
                </>
              )}
            </div>
          </div>
          <div className="space-y-1 rounded-2xl border border-border bg-card p-2 shadow-sm">
            {ep.live && <a href={`/podcast/${show.slug}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-muted"><ExternalLink className="h-4 w-4 text-muted-foreground" /> Open your show's page</a>}
            {hasAudio && <button type="button" onClick={() => void copy(`${origin}/e/${ep.id}.mp3`, "Audio link")} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-muted" data-testid="episode-copy-audio"><Copy className="h-4 w-4 text-muted-foreground" /> Copy the direct link to the audio</button>}
            <button type="button" onClick={() => void remove()} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10" data-testid="episode-delete"><Trash2 className="h-4 w-4" /> Delete this episode</button>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** How the show's episodes go out. (The intro, outro and footer are done in post-production for now, so they are not here.) */
/** One answer in a two-way question: a card with a dot, its name, and one line under it. */
function Choice({ on, title, sub, badge, disabled, onPick, testid }: { on: boolean; title: string; sub: string; badge?: React.ReactNode; disabled?: boolean; onPick: () => void; testid: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} disabled={disabled} onClick={onPick} className={`flex w-full items-start gap-3 rounded-xl border-[1.5px] p-3.5 text-left transition-colors disabled:opacity-60 ${on ? "border-[#053877] bg-[#053877]/[0.04] dark:border-[#8fb5e8] dark:bg-white/5" : "border-border hover:border-[#053877]/40"}`} data-testid={testid}>
      <span className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-[#053877] dark:border-[#8fb5e8]" : "border-muted-foreground/50"}`}>{on && <span className="h-2 w-2 rounded-full bg-[#053877] dark:bg-[#8fb5e8]" />}</span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">{title}{typeof badge === "string" ? <span className="rounded-full bg-[#F0A71F]/20 px-2 py-px text-[11px] font-semibold text-[#8a5a00] dark:text-[#F0A71F]">{badge}</span> : badge}</span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{sub}</span>
      </span>
    </button>
  );
}

/**
 * "Recommended", with the reason on hover (a computer) or tap (a phone): Andrew, 23 Nov 2026, "for the first few, until
 * he gets comfortable with auto, he can change anytime".
 */
function RecommendedNote() {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} className="cursor-help rounded-full bg-[#F0A71F]/20 px-2 py-px text-[11px] font-semibold text-[#8a5a00] underline decoration-dotted underline-offset-2 dark:text-[#F0A71F]" data-testid="hosting-publish-recommended">Recommended</span>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-64 rounded-xl border-0 bg-[#04102b] px-3 py-2.5 text-xs leading-snug text-white" onOpenAutoFocus={(e) => e.preventDefault()}>
        Recommended for your first few episodes, until you're comfortable with auto. You can change it&nbsp;anytime.
      </PopoverContent>
    </Popover>
  );
}

/**
 * Publishing: one question (Andrew, 23 Nov 2026: "Yes, build both"). Self-publish or Auto-publish (autoPublish), and
 * publishing goes everywhere at once: every podcast app, and YouTube when the episode has video. Whether a video goes
 * to YouTube, and who can see it there, is in the publish box on each episode (youtubeMode, youtubePrivacy: the same
 * fields, remembered from there). The clip layout lives in Pōstify only ("Yes, Pōstify only").
 */
function PublishingPanel({ h, youtubeReady, onSaved }: { h: Hosted; youtubeReady: boolean; onSaved: () => void }) {
  const { toast } = useToast();
  const show = h.show;
  const [busy, setBusy] = useState(false);
  const patch = async (body: Record<string, unknown>, done: { title: string; description?: string }) => {
    setBusy(true);
    try { await apiRequest("PATCH", `/api/host/hosting/shows/${show.id}`, body); onSaved(); toast(done); }
    catch (e) { toast({ title: "Couldn't change that", description: (e as Error).message, variant: "destructive" }); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm" role="radiogroup" aria-label="When an episode is ready" data-testid="hosting-publishing">
      <h2 className="text-base font-semibold">When an episode is&nbsp;ready <span className="whitespace-nowrap font-normal text-muted-foreground">(audio and video)</span></h2>
      <p className="mt-0.5 text-sm text-muted-foreground">Ready means post-production is&nbsp;done.</p>
      <div className="mt-3.5 grid gap-3 sm:grid-cols-2" data-testid="hosting-autopublish">
        <Choice on={!show.autoPublish} disabled={busy} onPick={() => show.autoPublish && void patch({ autoPublish: false }, { title: "Self-publish", description: "You press Publish on each episode." })} title="Self-publish" badge={<RecommendedNote />} sub="You press Publish." testid="hosting-publish-hand" />
        <Choice on={!!show.autoPublish} disabled={busy} onPick={() => !show.autoPublish && void patch({ autoPublish: true }, { title: "Auto-publish", description: "Each episode goes out as soon as post-production is done." })} title="Auto-publish" sub="It goes out as soon as it's ready." testid="hosting-publish-auto" />
      </div>
      <p className="mt-4 flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
        <Send className="mt-0.5 h-4 w-4 shrink-0 text-[#053877] dark:text-[#8fb5e8]" />
        <span>Publishing sends it everywhere at once: Apple, Spotify, every podcast app, and YouTube when the episode has&nbsp;video.{!youtubeReady && <> <a href="/host/dashboard/social" className="font-semibold text-[#053877] hover:underline dark:text-[#8fb5e8]">Connect YouTube</a> for&nbsp;that.</>}</span>
      </p>
    </div>
  );
}

type SpotRow = HostedSpotRow & { state: "live" | "scheduled" | "ended" | "paused"; delivered: number; delivered30: number };
type SpotsResp = { spots: SpotRow[]; voices: { key: string; name: string }[] };

/** A sponsor's message before or after the episodes. The episode itself is never changed; a spot can be paused, dated or swapped any time. */
function SponsorsPanel({ h, onSaved, preset = null, onPresetUsed }: { h: Hosted; onSaved: () => void; preset?: number | null; onPresetUsed?: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const show = h.show;
  const KEY = ["/api/host/hosting/spots", show.id];
  const q = useQuery<SpotsResp>({ queryKey: KEY, queryFn: async () => (await apiRequest("GET", `/api/host/hosting/shows/${show.id}/spots`)).json(), refetchInterval: 30_000 });
  const blank = { sponsor: "", kind: "pre" as "pre" | "mid" | "post", mode: "write" as "write" | "upload", script: "", voice: "brian", startsOn: "", endsOn: "", target: "future" as string, at: "" };
  const [adding, setAdding] = useState(preset != null);
  const [f, setF] = useState(preset != null ? { ...blank, target: `ep:${preset}` } : blank);
  const player = useRef<HTMLAudioElement>(null);
  const [rec, setRec] = useState<{ key: string; sec: number; url: string; name: string } | null>(null);
  const [busy, setBusy] = useState<"" | "record" | "upload" | "save">("");
  const [pct, setPct] = useState<number | null>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setF((x) => ({ ...x, [k]: v }));
  const msg = (e: unknown) => (e as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "");
  const reload = () => { void qc.invalidateQueries({ queryKey: KEY }); onSaved(); };
  const record = async () => {
    setBusy("record");
    try { const r = (await (await apiRequest("POST", `/api/host/hosting/shows/${show.id}/spots/generate`, { text: f.script, voice: f.voice })).json()) as { key: string; durationSec: number; url: string }; setRec({ key: r.key, sec: r.durationSec, url: r.url, name: `${f.sponsor || "Sponsor"} spot` }); }
    catch (e) { toast({ title: "Couldn't record that", description: msg(e), variant: "destructive" }); } finally { setBusy(""); }
  };
  const upload = async (file: File) => {
    if (!/^audio\//.test(file.type)) return toast({ title: "That isn't an audio file", description: "Choose an MP3, M4A or WAV.", variant: "destructive" });
    setBusy("upload");
    try { setPct(0); const dur = await durationOf(file).catch(() => 0); const k = await uploadToStorage(file, setPct); setRec({ key: k, sec: Math.round(dur), url: URL.createObjectURL(file), name: file.name.replace(/\.[a-z0-9]+$/i, "") }); }
    catch (e) { toast({ title: "Couldn't upload that", description: msg(e), variant: "destructive" }); } finally { setBusy(""); setPct(null); if (fileIn.current) fileIn.current.value = ""; }
  };
  const epId = f.target.startsWith("ep:") ? Number(f.target.slice(3)) : 0;
  const parseAt = (t: string) => { const m = t.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$|^(\d+)$/); if (!m) return 0; return m[4] ? Number(m[4]) : (Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])); };
  const atSec = parseAt(f.at);
  const save = async () => {
    if (!rec) return;
    setBusy("save");
    try {
      await apiRequest("POST", `/api/host/hosting/shows/${show.id}/spots`, { sponsor: f.sponsor, kind: f.kind, key: rec.key, name: rec.name, durationSec: rec.sec, script: f.mode === "write" ? f.script : "", voice: f.mode === "write" ? f.voice : "", startsOn: f.startsOn, endsOn: f.endsOn, scope: epId ? "future" : f.target, episodeId: epId || undefined, atSec: f.kind === "mid" ? atSec : 0 });
      toast({ title: "Sponsor spot added", description: "It's being put on your episodes now: a few minutes. The originals are kept." });
      setAdding(false); setF(blank); setRec(null); onPresetUsed?.(); reload();
    } catch (e) { toast({ title: "Couldn't save it", description: msg(e), variant: "destructive" }); } finally { setBusy(""); }
  };
  const patch = async (id: number, body: Record<string, unknown>) => { try { await apiRequest("PATCH", `/api/host/hosting/spots/${id}`, body); reload(); } catch (e) { toast({ title: "Couldn't change it", description: msg(e), variant: "destructive" }); } };
  const remove = async (sp: SpotRow) => {
    if (!window.confirm(`Take ${sp.sponsor}'s spot off your episodes? It stops playing, and your sponsor's numbers stay in your records.`)) return;
    await apiRequest("DELETE", `/api/host/hosting/spots/${sp.id}`); reload();
  };
  const eps = h.episodes.slice().sort((a, b) => (b.episodeNumber ?? 0) - (a.episodeNumber ?? 0) || b.id - a.id);
  const working = h.episodes.filter((e) => (e as Ep & { bookend?: { state?: string } }).bookend?.state === "working").length;
  const label = "block text-xs font-semibold text-muted-foreground";
  const pill = (on: boolean) => `rounded-full border px-3 py-1 text-xs font-semibold ${on ? "border-[#053877] bg-[#053877] text-white" : "border-border hover:bg-muted"}`;
  const STATE: Record<SpotRow["state"], string> = { live: "bg-emerald-600 text-white", scheduled: "bg-[#F0A71F] text-[#3a2600]", ended: "bg-muted text-muted-foreground", paused: "bg-muted text-muted-foreground" };
  const scopeText = (c: string) => (c === "all" ? "Every episode, old and new" : c === "full" ? "Every full episode (not trailers or bonuses)" : "Episodes from now on");
  const canRecord = f.script.trim().length >= 10;
  return (
    <div className="space-y-4" data-testid="hosting-sponsors">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-xl">
            <h2 className="text-sm font-semibold">Sponsor spots</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Play a sponsor's message before or after your episodes. Record it here from a few words, or upload one. Your own audio is never changed, and you can pause, date or swap a spot any time.</p>
          </div>
          {!adding && <Button onClick={() => setAdding(true)} className="gap-1.5 bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="spot-add"><Plus className="h-4 w-4" /> Add a sponsor spot</Button>}
        </div>
        {working > 0 && <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Putting it on {working} episode{working === 1 ? "" : "s"} now. The originals are kept.</p>}
      </div>

      {adding && (
        <div className="space-y-4 rounded-2xl border border-[#053877]/30 bg-card p-5 shadow-sm" data-testid="spot-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>Sponsor<Input value={f.sponsor} onChange={(e) => set("sponsor", e.target.value)} className="mt-1" placeholder="Who is it for?" data-testid="spot-sponsor" /></label>
            <div>
              <span className={label}>Plays</span>
              <div className="mt-1 flex flex-wrap gap-2">
                <button type="button" className={pill(f.kind === "pre")} onClick={() => set("kind", "pre")} data-testid="spot-kind-pre">Before the episode</button>
                <button type="button" className={pill(f.kind === "mid")} onClick={() => { set("kind", "mid"); if (!epId && eps[0]) set("target", `ep:${eps[0].id}`); }} data-testid="spot-kind-mid">In the middle</button>
                <button type="button" className={pill(f.kind === "post")} onClick={() => set("kind", "post")} data-testid="spot-kind-post">After the episode</button>
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>On which episodes
              <select value={f.target} onChange={(e) => set("target", e.target.value)} className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" data-testid="spot-target">
                {f.kind !== "mid" && <><option value="future">New episodes from now on</option><option value="all">Every episode</option><option value="full">Every full episode (no trailers or bonuses)</option></>}
                <optgroup label="Just one episode">
                  {eps.map((e) => <option key={e.id} value={`ep:${e.id}`}>{e.episodeNumber != null ? `${e.episodeNumber}. ` : ""}{e.title.slice(0, 70)}</option>)}
                </optgroup>
              </select>
            </label>
            {f.kind === "mid" && (
              <label className={label}>At this point in the episode
                <Input value={f.at} onChange={(e) => set("at", e.target.value)} className="mt-1" placeholder="12:30" data-testid="spot-at" />
              </label>
            )}
          </div>
          {f.kind === "mid" && epId > 0 && (
            <div className="rounded-xl border border-border bg-muted/30 p-3" data-testid="spot-midpoint">
              <p className="mb-2 text-xs text-muted-foreground">Play the episode here, and press the button where the spot should go. The episode picks up again right after it.</p>
              <audio ref={player} key={epId} controls preload="metadata" src={`/e/${epId}.mp3?preview=1&original=1`} className="w-full" />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" className="h-8 rounded-full" onClick={() => { const t = Math.round(player.current?.currentTime ?? 0); set("at", `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`); }} data-testid="spot-use-time">Use this time</Button>
                <span className="text-xs text-muted-foreground">{atSec ? `The spot plays at ${hms(atSec)}.` : "Type a time, like 12:30, or use the player."}</span>
              </div>
            </div>
          )}
          <div>
            <span className={label}>The spot</span>
            <div className="mt-1 flex gap-2">
              <button type="button" className={pill(f.mode === "write")} onClick={() => { set("mode", "write"); setRec(null); }}>Write it, we record it</button>
              <button type="button" className={pill(f.mode === "upload")} onClick={() => { set("mode", "upload"); setRec(null); }}>Upload a recording</button>
            </div>
            {f.mode === "write" ? (
              <div className="mt-3 space-y-3">
                <Textarea value={f.script} onChange={(e) => { set("script", e.target.value); setRec(null); }} rows={4} maxLength={1500} placeholder="This episode is brought to you by… Say what they do and where to go. About 60 words is 30 seconds." data-testid="spot-script" />
                <div className="flex flex-wrap items-end gap-3">
                  <label className={label}>Voice
                    <select value={f.voice} onChange={(e) => { set("voice", e.target.value); setRec(null); }} className="mt-1 block h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground" data-testid="spot-voice">
                      {(q.data?.voices ?? [{ key: "brian", name: "Brian" }]).map((v) => <option key={v.key} value={v.key}>{v.name}</option>)}
                    </select>
                  </label>
                  <Button variant="outline" className="h-9 rounded-full" disabled={!canRecord || busy === "record"} onClick={() => void record()} data-testid="spot-record">{busy === "record" ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Recording…</> : rec ? "Record it again" : "Hear it"}</Button>
                </div>
              </div>
            ) : (
              <div className="mt-3">
                <input ref={fileIn} type="file" accept="audio/*,.mp3,.m4a,.wav" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
                <button type="button" onClick={() => fileIn.current?.click()} disabled={busy === "upload"} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const x = e.dataTransfer.files?.[0]; if (x) void upload(x); }} className="flex h-24 w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-sm hover:border-[#053877]/50 hover:bg-muted/40 disabled:opacity-60" data-testid="spot-upload">
                  {busy === "upload" ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Uploading… {Math.round(pct ?? 0)}%</span> : <><Upload className="h-5 w-5 text-[#053877]" /><span className="font-semibold">{rec ? "Choose a different file" : "Drag the recording here or choose it"}</span><span className="text-xs text-muted-foreground">Up to 5 minutes</span></>}
                </button>
              </div>
            )}
            {rec && <div className="mt-3"><audio controls src={rec.url} className="w-full" data-testid="spot-preview" /><p className="mt-1 text-xs text-muted-foreground">{rec.name} · {hms(rec.sec)}</p></div>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>Starts (optional)<Input type="date" value={f.startsOn} onChange={(e) => set("startsOn", e.target.value)} className="mt-1" /></label>
            <label className={label}>Ends (optional)<Input type="date" value={f.endsOn} onChange={(e) => set("endsOn", e.target.value)} className="mt-1" /></label>
          </div>
          {f.kind !== "mid" && !epId && f.target !== "future" && <p className="text-xs text-muted-foreground">Older episodes get a new copy with the spot on; the originals are kept. This takes a few minutes per episode.</p>}
          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={!rec || !f.sponsor.trim() || busy === "save" || (f.kind === "mid" && (!epId || atSec < 5))} className="bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="spot-save">{busy === "save" ? "Saving…" : "Add this spot"}</Button>
            <Button variant="ghost" onClick={() => { setAdding(false); setF(blank); setRec(null); }}>Cancel</Button>
          </div>
        </div>
      )}

      {q.isLoading ? null : (q.data?.spots ?? []).length ? (
        <ul className="space-y-3">
          {(q.data?.spots ?? []).map((sp) => (
            <li key={sp.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm" data-testid={`spot-${sp.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${STATE[sp.state]}`}>{sp.state}</span>
                <span className="text-sm font-semibold">{sp.sponsor}</span>
                <span className="text-xs text-muted-foreground">{sp.kind === "pre" ? "Before the episode" : sp.kind === "post" ? "After the episode" : `At ${hms(sp.atSec)}`} · {hms(sp.audioSec)}</span>
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="outline" className="h-8 rounded-full" onClick={() => void patch(sp.id, { active: !sp.active })}>{sp.active ? "Pause" : "Turn on"}</Button>
                  <Button size="sm" variant="ghost" className="h-8 rounded-full text-muted-foreground" onClick={() => void remove(sp)} aria-label={`Remove ${sp.sponsor}'s spot`}><Trash2 className="h-4 w-4" /></Button>
                </span>
              </div>
              <audio controls preload="none" src={`/api/host/hosting/spots/${sp.id}/audio`} className="mt-2 w-full" />
              <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-2 text-xs text-muted-foreground">
                <span><b className="text-base tabular-nums text-foreground">{compact(sp.delivered)}</b> plays delivered · <b className="tabular-nums text-foreground">{compact(sp.delivered30)}</b> in the last 30 days</span>
                <span>{sp.episodeId ? (() => { const e = eps.find((x) => x.id === sp.episodeId); return e ? `Just episode ${e.episodeNumber ?? ""} ${e.title.slice(0, 40)}`.replace("  ", " ") : "Just one episode"; })() : scopeText(sp.scope)}</span>
                <label className="flex items-center gap-1">Starts <Input type="date" defaultValue={sp.startsOn} onBlur={(e) => e.target.value !== sp.startsOn && void patch(sp.id, { startsOn: e.target.value })} className="h-7 w-36 text-xs" /></label>
                <label className="flex items-center gap-1">Ends <Input type="date" defaultValue={sp.endsOn} onBlur={(e) => e.target.value !== sp.endsOn && void patch(sp.id, { endsOn: e.target.value })} className="h-7 w-36 text-xs" /></label>
              </div>
            </li>
          ))}
        </ul>
      ) : !adding ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <p className="font-semibold">No sponsor spots yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Add one, and it plays before or after your episodes. You'll see how many plays each sponsor got, so you can show them.</p>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">One spot plays in each place at a time: the newest live one. Plays are counted from your feed, once per listener per episode per day.</p>
    </div>
  );
}

/** One of the show's two bookends: its file, a player, and replace or remove. */
function BookendCard({ show, kind, onSaved }: { show: HostedShowRow; kind: "intro" | "outro"; onSaved: () => void }) {
  const { toast } = useToast();
  const key = kind === "intro" ? show.introKey : show.outroKey;
  const name = kind === "intro" ? show.introName : show.outroName;
  const sec = kind === "intro" ? show.introSec : show.outroSec;
  const [pct, setPct] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const put = async (file: File) => {
    if (!/^audio\//.test(file.type)) return toast({ title: "That isn't an audio file", description: "Choose an MP3, M4A or WAV.", variant: "destructive" });
    try {
      setPct(0);
      const dur = await durationOf(file).catch(() => 0);
      const k = await uploadToStorage(file, setPct);
      await apiRequest("PUT", `/api/host/hosting/shows/${show.id}/bookends`, { kind, key: k, name: file.name.replace(/\.[a-z0-9]+$/i, ""), durationSec: Math.round(dur) });
      onSaved();
      toast({ title: `Your ${kind} is set`, description: "New episodes get it automatically." });
    } catch (e) {
      toast({ title: "Couldn't use that", description: (e as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" });
    } finally {
      setPct(null);
      if (input.current) input.current.value = "";
    }
  };
  const clear = async () => {
    if (!window.confirm(`Take your ${kind} off? New episodes won't get it.`)) return;
    await apiRequest("PUT", `/api/host/hosting/shows/${show.id}/bookends`, { kind, clear: true });
    onSaved();
  };
  return (
    <div className="rounded-xl border border-border p-4" data-testid={`bookend-${kind}`}>
      <p className="text-sm font-semibold capitalize">{kind}</p>
      <input ref={input} type="file" accept="audio/*,.mp3,.m4a,.wav" className="hidden" onChange={(e) => e.target.files?.[0] && void put(e.target.files[0])} />
      {key ? (
        <>
          <p className="mt-1 truncate text-xs text-muted-foreground">{name || "Your file"}{sec ? ` · ${hms(sec)}` : ""}</p>
          <audio controls preload="none" src={`/api/host/hosting/shows/${show.id}/bookend/${kind}`} className="mt-2 w-full" />
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" className="h-8 rounded-full" disabled={pct !== null} onClick={() => input.current?.click()}>{pct === null ? "Replace" : `Uploading ${Math.round(pct)}%`}</Button>
            <Button size="sm" variant="ghost" className="h-8 rounded-full text-muted-foreground" onClick={() => void clear()}>Remove</Button>
          </div>
        </>
      ) : (
        <button type="button" onClick={() => input.current?.click()} disabled={pct !== null} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const x = e.dataTransfer.files?.[0]; if (x) void put(x); }} className="mt-2 flex h-28 w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-sm hover:border-[#053877]/50 hover:bg-muted/40 disabled:opacity-60" data-testid={`bookend-${kind}-add`}>
          {pct === null ? <><Upload className="h-5 w-5 text-[#053877]" /><span className="font-semibold">Add your {kind}</span><span className="text-xs text-muted-foreground">Drag a file here or choose one (up to 5 minutes)</span></> : <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Uploading… {Math.round(pct)}%</span>}
        </button>
      )}
    </div>
  );
}

/** A new episode: drop the file, or skip and add it later, or bring one in from an RSS feed or your Library. */
function NewEpisodePage({ show, onBack, onCreated }: { show: HostedShowRow; onBack: () => void; onCreated: (e: HostedEpisodeRow) => void }) {
  const { toast } = useToast();
  const [pct, setPct] = useState<number | null>(null);
  const [more, setMore] = useState<"" | "rss" | "library">("");
  const [over, setOver] = useState(false);
  const [feed, setFeed] = useState(show.importedFrom ?? "");
  const [found, setFound] = useState<{ url: string; show: string; episodes: { guid: string; title: string; published: string; durationSec: number; have: boolean }[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const recs = useQuery<RecordingRow[]>({ queryKey: ["/api/host/recordings"], queryFn: async () => (await apiRequest("GET", "/api/host/recordings")).json(), enabled: more === "library" });
  const hasClean = (r: RecordingRow) => { try { const c = r.clean ? JSON.parse(r.clean) : null; return c?.status === "done" && !!c.audioKey; } catch { return false; } };
  const usable = (recs.data ?? []).filter((r) => r.status === "Ready" && r.url);
  const make = async (body: Record<string, unknown>) => {
    const e = (await (await apiRequest("POST", `/api/host/hosting/shows/${show.id}/episodes`, body)).json()) as HostedEpisodeRow;
    onCreated(e);
  };
  const fail = (title: string) => (e: Error) => toast({ title, description: e.message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" });
  const upload = async (file: File) => {
    if (!/^audio\/|^video\/mp4/.test(file.type)) return toast({ title: "That file won't play as an episode", description: "Choose an MP3 or M4A, or an MP4 video.", variant: "destructive" });
    try {
      setPct(0);
      const dur = await durationOf(file).catch(() => 0);
      const key = await uploadToStorage(file, setPct);
      await make({ audioKey: key, mime: file.type === "audio/mp3" ? "audio/mpeg" : file.type, sizeBytes: file.size, durationSec: Math.round(dur), title: file.name.replace(/\.[a-z0-9]+$/i, "") });
    } catch (e) {
      fail("Couldn't upload that")(e as Error);
    } finally {
      setPct(null);
      if (input.current) input.current.value = "";
    }
  };
  const later = async () => { setBusy("later"); try { await make({ later: true }); } catch (e) { fail("Couldn't start it")(e as Error); } finally { setBusy(null); } };
  const find = async () => {
    setBusy("find");
    try { setFound((await (await apiRequest("GET", `/api/host/hosting/shows/${show.id}/feed-episodes?url=${encodeURIComponent(feed.trim())}`)).json())); } catch (e) { fail("Couldn't read that feed")(e as Error); } finally { setBusy(null); }
  };
  const importOne = async (guid: string) => { setBusy(guid); try { await make({ fromFeed: { url: found?.url, guid } }); } catch (e) { fail("Couldn't bring that in")(e as Error); } finally { setBusy(null); } };
  const useRec = async (id: number) => { setBusy(`rec${id}`); try { await make({ recordingId: id }); } catch (e) { fail("Couldn't use that")(e as Error); } finally { setBusy(null); } };
  return (
    <div className="space-y-4" data-testid="new-episode-page">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"><ChevronLeft className="h-4 w-4" /> All episodes</button>
      <h2 className="text-2xl font-bold tracking-tight">New episode</h2>
      <input ref={input} type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,video/mp4,.mp3,.m4a,.mp4" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const x = e.dataTransfer.files?.[0]; if (x && pct === null) void upload(x); }}
        className={`flex min-h-[18rem] flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 text-center transition-colors ${over ? "border-[#053877] bg-[#053877]/5" : "border-border bg-card"}`} data-testid="new-episode-drop"
      >
        {pct === null ? (
          <>
            <p className="text-2xl font-bold tracking-tight sm:text-3xl">Drag your audio or video here or <button type="button" onClick={() => input.current?.click()} className="underline decoration-2 underline-offset-4 hover:text-[#053877]" data-testid="new-episode-choose">choose a file</button></p>
            <p className="mt-2 text-sm text-muted-foreground">MP3 or M4A, or an MP4 video (the one you put on YouTube).</p>
            <button type="button" onClick={() => void later()} disabled={busy === "later"} className="mt-5 text-sm font-semibold text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-60" data-testid="new-episode-later">{busy === "later" ? "Starting…" : "Skip and upload later"}</button>
          </>
        ) : (
          <div className="w-full max-w-sm">
            <p className="flex items-center justify-center gap-2 text-lg font-semibold"><Loader2 className="h-5 w-5 animate-spin" /> Uploading… {Math.round(pct)}%</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[#053877] transition-all" style={{ width: `${pct}%` }} /></div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {([["rss", "Import from an RSS feed", Radio], ["library", "From your Library", Film]] as const).map(([k, l, I]) => (
          <button key={k} type="button" onClick={() => setMore(more === k ? "" : k)} className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold ${more === k ? "border-[#053877] bg-[#053877] text-white" : "border-border bg-card hover:bg-muted"}`} data-testid={`new-episode-${k}`}><I className="h-4 w-4" /> {l}</button>
        ))}
      </div>
      {more === "rss" && (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm" data-testid="new-episode-rss">
          <p className="mb-2 text-sm text-muted-foreground">Bring one episode over from a feed: its title, its notes and its audio.</p>
          <div className="flex gap-2">
            <Input value={feed} onChange={(e) => setFeed(e.target.value)} placeholder="Your RSS feed address, or your Apple Podcasts link" className="h-9" data-testid="new-episode-feed" />
            <Button className="h-9 rounded-full" onClick={() => void find()} disabled={busy === "find" || !feed.trim()}>{busy === "find" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Find episodes"}</Button>
          </div>
          {found && (
            <ul className="mt-3 max-h-80 divide-y divide-border overflow-y-auto">
              {found.episodes.length ? found.episodes.map((x) => (
                <li key={x.guid} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{x.title}</span><span className="block text-xs text-muted-foreground">{x.published ? dateOf(x.published) : ""}{x.durationSec ? ` · ${hms(x.durationSec)}` : ""}</span></span>
                  {x.have ? <span className="text-xs font-semibold text-muted-foreground">Already here</span> : <Button size="sm" variant="outline" className="h-8 rounded-full" disabled={busy !== null} onClick={() => void importOne(x.guid)}>{busy === x.guid ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Bring it in"}</Button>}
                </li>
              )) : <li className="py-6 text-center text-sm text-muted-foreground">No episodes in that feed.</li>}
            </ul>
          )}
        </div>
      )}
      {more === "library" && (
        <div className="max-h-80 overflow-y-auto rounded-2xl border border-border bg-card p-4 shadow-sm" data-testid="new-episode-library">
          {recs.isLoading ? <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-muted-foreground" /> : usable.length ? (
            <ul className="divide-y divide-border">
              {usable.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.title || "Untitled"}</span>
                    <span className="block text-xs text-muted-foreground">{hasClean(r) ? "Clean audio: ums and long pauses already out" : "We'll turn the video into audio (a minute or two)"}</span>
                  </span>
                  <Button size="sm" variant="outline" className="h-8 rounded-full" disabled={busy !== null} onClick={() => void useRec(r.id)}>{busy === `rec${r.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Use this"}</Button>
                </li>
              ))}
            </ul>
          ) : <p className="py-8 text-center text-sm text-muted-foreground">Nothing in your Library yet. Upload the audio instead.</p>}
        </div>
      )}
    </div>
  );
}

