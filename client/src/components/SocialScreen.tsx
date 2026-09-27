import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTip, XAxis, YAxis } from "recharts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PostDialog, type PostTarget } from "@/components/PostDialog";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { UploadRecording } from "@/components/UploadRecording";
import { uploadToStorage } from "@/lib/upload";
import { PlatformIcon, platformLabel } from "@/components/SocialIcons";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ClipRow, HostPostRow, PostMetrics, PostResult, RecordingRow, SocialPlatform } from "@shared/schema";
import { AlertTriangle, BarChart3, Heart, Lightbulb, MessageCircle, Repeat2, TrendingDown, TrendingUp, Users, Eye, ChevronDown, Clapperboard, Film, ImagePlus, Upload, CalendarClock, CalendarDays, Check, ChevronLeft, ChevronRight, Clock, ExternalLink, Home, Link2, ListPlus, Loader2, Play, Plus, Send, Settings2, Target, Trash2, X } from "lucide-react";

/**
 * Social: the podcaster's own social desk, the way Later or Buffer lay it out.
 * Home says how the week is going, what's up next, what's ready to go and how
 * the last posts landed; the Calendar is the week at a glance, with open queue
 * slots to fill and posts to drag to another day. Clips and episodes live in
 * the Library; Create post picks from there. Posting runs through Upload-Post:
 * the next open slot in their queue by default, now, or a time they pick.
 */

type Queue = { settings: { timezone: string; slots: { hour: number; minute: number }[]; days_of_week: number[] } | null; slots: { datetime_utc: string; available: boolean; post_count: number; is_full: boolean }[]; next?: string };
type Post = HostPostRow & { at: number; results_: PostResult[]; thumb: string; wide: boolean };

const DAY = 86400_000;
const fmtTime = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const fmtWhen = (t: number) => new Date(t).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** Monday 00:00 of the week `t` is in. */
const weekStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
/** A datetime-local value for a time. */
const local = (t: number) => { const d = new Date(t); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

export function SocialScreen() {
  const { toast } = useToast();
  const qc = useQueryClient();
  type Tab = "home" | "calendar" | "analytics";
  const [tab, setTab] = useState<Tab>(() => { try { const v = localStorage.getItem("mv_social_tab"); return v === "calendar" || v === "analytics" ? v : "home"; } catch { return "home"; } });
  const go = (t: Tab) => { setTab(t); try { localStorage.setItem("mv_social_tab", t); } catch { /* fine */ } };
  const [target, setTarget] = useState<PostTarget | null>(null);
  const [targetAt, setTargetAt] = useState<string | undefined>(undefined);
  const [picking, setPicking] = useState<string | null>(null); // Create post, optionally for a slot (datetime-local)
  const [pickKind, setPickKind] = useState<"clips" | "episodes" | "upload">("clips");
  const create = (k: "clips" | "episodes" | "upload") => { setPickKind(k); setPicking(""); };
  const [open, setOpen] = useState<Post | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [viewing, setViewing] = useState<{ src: string; title: string } | null>(null);
  const [removing, setRemoving] = useState<Post | null>(null);

  const social = useQuery<{ configured: boolean; accounts: { platform: SocialPlatform; username?: string; followers?: number }[] }>({ queryKey: ["/api/host/social"], queryFn: async () => (await apiRequest("GET", "/api/host/social")).json() });
  const clips = useQuery<ClipRow[]>({ queryKey: ["/api/host/clips"], queryFn: async () => (await apiRequest("GET", "/api/host/clips")).json() });
  const recs = useQuery<RecordingRow[]>({ queryKey: ["/api/host/recordings"], queryFn: async () => (await apiRequest("GET", "/api/host/recordings")).json() });
  const postsQ = useQuery<HostPostRow[]>({ queryKey: ["/api/host/posts"], queryFn: async () => (await apiRequest("GET", "/api/host/posts")).json(), refetchInterval: 60_000 });
  const queue = useQuery<Queue>({ queryKey: ["/api/host/social/queue"], queryFn: async () => (await apiRequest("GET", "/api/host/social/queue")).json(), retry: false });

  const accounts = social.data?.accounts ?? [];
  const connected = Array.from(new Set(accounts.map((a) => a.platform)));
  const clipList = useMemo(() => [...(clips.data ?? [])].filter((c) => c.verticalUrl || c.squareUrl || c.url).sort((a, b) => b.id - a.id), [clips.data]);
  const episodes = (recs.data ?? []).filter((r) => r.status === "Ready");
  const posts: Post[] = useMemo(() => (postsQ.data ?? []).map((p) => {
    const clip = p.kind === "clip" ? clipList.find((c) => c.id === p.refId) : undefined;
    let results_: PostResult[] = [];
    try { results_ = p.results ? JSON.parse(p.results) : []; } catch { results_ = []; }
    return {
      ...p,
      at: Date.parse(p.scheduledAt || p.createdAt),
      results_,
      thumb: p.kind === "photo" ? `/api/host/posts/${p.id}/media` : clip ? (p.shape === "square" ? clip.squareUrl : p.shape === "wide" ? clip.url : clip.verticalUrl) || clip.verticalUrl || clip.squareUrl || clip.url : p.kind === "recording" ? `/api/host/recordings/${p.refId}/video` : "",
      wide: p.kind === "recording" || p.shape === "wide",
    };
  }), [postsQ.data, clipList]);
  const now = Date.now();
  const upcoming = posts.filter((p) => p.status === "scheduled" && p.at > now).sort((a, b) => a.at - b.at);
  const gone = posts.filter((p) => !(p.status === "scheduled" && p.at > now) && p.status !== "sending").sort((a, b) => b.at - a.at);
  const usedClips = new Set(posts.filter((p) => p.kind === "clip" && p.status !== "failed").map((p) => p.refId));
  const ready = clipList.filter((c) => !usedClips.has(c.id));

  // A posting goal for the week, as Buffer does it: small, visible, theirs.
  const [goal, setGoal] = useState(() => { try { return Number(localStorage.getItem("mv_post_goal")) || 5; } catch { return 5; } });
  const wk = weekStart(now);
  const thisWeek = posts.filter((p) => p.status !== "failed" && p.at >= wk && p.at < wk + 7 * DAY).length;

  const refresh = () => { void qc.invalidateQueries({ queryKey: ["/api/host/posts"] }); void qc.invalidateQueries({ queryKey: ["/api/host/social/queue"] }); };
  const shapesOf = (c: ClipRow) => ([["vertical", c.verticalUrl], ["square", c.squareUrl], ["wide", c.url]] as const).filter(([, u]) => u).map(([s]) => s);
  const postClip = (c: ClipRow, at?: string) => { setTargetAt(at); setTarget({ kind: "clip", id: c.id, title: c.title, caption: c.caption, shapes: [...shapesOf(c)] }); };
  const postEpisode = (r: RecordingRow, at?: string) => { setTargetAt(at); setTarget({ kind: "recording", id: r.id, title: r.title }); };

  // One tap: the clip, in its first shape, to every connected account, in the next open slot.
  const queueClip = useMutation({
    mutationFn: async (c: ClipRow) => (await apiRequest("POST", `/api/host/clips/${c.id}/publish`, { platforms: connected, title: c.title, description: c.caption ?? "", shape: shapesOf(c)[0], queue: true })).json() as Promise<{ scheduledAt?: string }>,
    onSuccess: (r) => { refresh(); toast({ title: "In your queue", description: r.scheduledAt ? `It goes out ${fmtWhen(Date.parse(r.scheduledAt))}.` : "It goes out in your next open slot." }); },
    onError: (e: Error) => toast({ title: "Couldn't queue that", description: e.message, variant: "destructive" }),
  });
  const move = useMutation({
    mutationFn: async (v: { id: number; at: number }) => (await apiRequest("PATCH", `/api/host/posts/${v.id}`, { scheduledAt: new Date(v.at).toISOString() })).json(),
    onSuccess: () => { refresh(); toast({ title: "Moved" }); },
    onError: (e: Error) => toast({ title: "Couldn't move it", description: e.message, variant: "destructive" }),
  });
  const cancel = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/host/posts/${id}`)).json(),
    onSuccess: () => { refresh(); setOpen(null); toast({ title: "Cancelled", description: "It won't go out. The clip is back in Ready to post." }); },
    onError: (e: Error) => toast({ title: "Couldn't cancel it", description: e.message, variant: "destructive" }),
  });

  const noAccounts = social.isSuccess && connected.length === 0;

  return (
    <section className="mt-2" data-testid="social-screen">
      {/* Header: the accounts, and the two things you do here. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-2 text-xl font-bold text-foreground">Social</h1>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {accounts.map((a, i) => (
            <span key={`${a.platform}-${i}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium" title={platformLabel(a.platform)}>
              <PlatformIcon platform={a.platform} className="h-3.5 w-3.5" />
              {a.username ? `@${a.username.replace(/^@/, "")}` : platformLabel(a.platform)}
              {typeof a.followers === "number" && <span className="tabular-nums text-muted-foreground">{compact(a.followers)}</span>}
            </span>
          ))}
          <a href="/host/dashboard/integrations" className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground"><Link2 className="h-3.5 w-3.5" /> {accounts.length ? "Manage" : "Connect accounts"}</a>
        </div>
      </div>

      {/* The two views, and on the same line the queue's times and the way to make a post. */}
      <div className="mb-4 flex items-end gap-1 border-b border-border" role="tablist">
        {([["home", "Home", Home], ["calendar", "Calendar", CalendarDays], ["analytics", "Analytics", BarChart3]] as const).map(([k, label, I]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => go(k)} className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold ${tab === k ? "border-[#F0A71F] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`} data-testid={`social-tab-${k}`}>
            <I className="h-4 w-4" /> {label}
          </button>
        ))}
        <div className="mb-1.5 ml-auto flex items-center gap-2">
          <Tip text="Queue times: the days and times your posts go out">
            <button type="button" onClick={() => setQueueOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card hover:bg-muted" aria-label="Queue times" data-testid="social-queue-settings"><Settings2 className="h-4 w-4" /></button>
          </Tip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={noAccounts} className="h-9 gap-1.5 rounded-lg bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="social-create"><Plus className="h-4 w-4" /> Create post <ChevronDown className="h-3.5 w-3.5 opacity-70" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => create("clips")} className="gap-2" data-testid="social-create-clip"><Clapperboard className="h-4 w-4" /> Choose a clip</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => create("episodes")} className="gap-2" data-testid="social-create-episode"><Film className="h-4 w-4" /> Choose an episode</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => create("upload")} className="gap-2" data-testid="social-create-upload"><Upload className="h-4 w-4" /> Upload new</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {noAccounts && (
        <div className="mb-4 rounded-2xl border border-dashed border-border bg-card p-6 text-center">
          <p className="text-sm font-semibold">Connect your accounts to start posting</p>
          <p className="mt-1 text-sm text-muted-foreground">Instagram, YouTube, TikTok, Facebook, LinkedIn, X and more.</p>
          <Button asChild className="mt-3 rounded-full"><a href="/host/dashboard/integrations">Connect accounts</a></Button>
        </div>
      )}

      {tab === "home" ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="flex min-w-0 flex-col gap-4">
            {/* Ready to post: clips from the Library that haven't gone out. */}
            <Card title="Ready to post" icon={ListPlus} note={ready.length ? `${ready.length} clip${ready.length === 1 ? "" : "s"}` : undefined}>
              {ready.length ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                  {ready.slice(0, 8).map((c) => {
                    const src = c.verticalUrl || c.squareUrl || c.url;
                    return (
                      <div key={c.id} className="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background" data-testid={`social-ready-${c.id}`}>
                        <button type="button" onClick={() => setViewing({ src, title: c.title })} className="relative aspect-[4/5] bg-black" aria-label={`Play ${c.title}`}>
                          <video src={`${src}#t=1`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                          <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-[#000741]"><Play className="h-3.5 w-3.5 fill-current" /></span></span>
                        </button>
                        <div className="flex flex-1 flex-col gap-2 p-2">
                          <p className="line-clamp-2 text-xs font-semibold leading-snug">{c.title}</p>
                          <div className="mt-auto flex items-center gap-1">
                            <Tip text="Add to your queue: every connected account, the next open slot">
                              <Button size="sm" onClick={() => queueClip.mutate(c)} disabled={queueClip.isPending || noAccounts} className="h-7 flex-1 gap-1 rounded-full bg-[#053877] px-2 text-xs text-white hover:bg-[#0a4a99]" data-testid={`social-queue-${c.id}`}>
                                {queueClip.isPending && queueClip.variables?.id === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CalendarClock className="h-3 w-3" />} Queue
                              </Button>
                            </Tip>
                            <Tip text="Choose the words, accounts and time">
                              <button type="button" onClick={() => postClip(c)} disabled={noAccounts} className="flex h-7 w-7 items-center justify-center rounded-full border border-border hover:bg-muted" aria-label="Post with options" data-testid={`social-post-${c.id}`}><Send className="h-3.5 w-3.5" /></button>
                            </Tip>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{clipList.length ? "Every clip is posted or queued. Pōstify another episode for more." : <>No clips yet. <a href="/host/dashboard/postify" className="font-semibold text-[#053877] underline dark:text-[#8fb5e8]">Pōstify an episode</a> to make some.</>}</p>
              )}
            </Card>

            {/* How the last posts landed, with a link to each one live. */}
            <Card title="Recently posted" icon={Send}>
              {gone.length ? (
                <ul className="divide-y divide-border">
                  {gone.slice(0, 8).map((p) => <PostRow key={p.id} p={p} onOpen={() => setOpen(p)} />)}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nothing yet. What goes out shows here, with a link to it on each account.</p>
              )}
            </Card>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <Card title="This week" icon={Target}>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums">{thisWeek}</span>
                <span className="text-sm text-muted-foreground">of {goal} posts</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[#F0A71F] transition-all" style={{ width: `${Math.min(100, (thisWeek / goal) * 100)}%` }} /></div>
              <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                Goal
                {[3, 5, 7, 14].map((g) => (
                  <button key={g} type="button" onClick={() => { setGoal(g); try { localStorage.setItem("mv_post_goal", String(g)); } catch { /* fine */ } }} className={`rounded-full px-2 py-0.5 font-semibold ${goal === g ? "bg-[#053877] text-white" : "hover:bg-muted"}`}>{g}</button>
                ))}
              </div>
            </Card>

            <Card title="Up next" icon={Clock} note={upcoming.length ? `${upcoming.length} scheduled` : undefined}>
              {upcoming.length ? (
                <ul className="divide-y divide-border">
                  {upcoming.slice(0, 6).map((p) => <PostRow key={p.id} p={p} onOpen={() => setOpen(p)} onRemove={() => setRemoving(p)} compactRow />)}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nothing scheduled. Queue a clip from Ready to post{queue.data?.next ? `: the next open slot is ${fmtWhen(Date.parse(queue.data.next))}` : ""}.</p>
              )}
              <button type="button" onClick={() => go("calendar")} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#053877] hover:underline dark:text-[#8fb5e8]">See the calendar <ChevronRight className="h-3 w-3" /></button>
            </Card>
          </div>
        </div>
      ) : tab === "analytics" ? (
        <Analytics clips={clipList} onOpen={(id) => { const p = posts.find((x) => x.id === id); if (p) setOpen(p); }} />
      ) : (
        <Calendar
          posts={posts}
          onRemove={setRemoving}
          slots={(queue.data?.slots ?? []).filter((s) => s.available && s.post_count === 0).map((s) => Date.parse(s.datetime_utc))}
          onOpen={setOpen}
          onSlot={(t) => { setPickKind("clips"); setPicking(local(t)); }}
          onMove={(p, t) => {
            if (t < Date.now() + 60_000) return toast({ title: "That's in the past", description: "Drop it on today or a later day.", variant: "destructive" });
            move.mutate({ id: p.id, at: t });
          }}
        />
      )}

      {/* Create post: choose from the Library. */}
      <Dialog open={picking !== null} onOpenChange={(v) => !v && setPicking(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Create post</DialogTitle>
            <DialogDescription>{picking ? `For ${fmtWhen(new Date(picking).getTime())}. ` : ""}Pick a clip or an episode from your Library, or upload something new.</DialogDescription>
          </DialogHeader>
          <LibraryPicker
            initial={pickKind}
            clips={clipList}
            episodes={episodes}
            used={usedClips}
            onClip={(c) => { const at = picking || undefined; setPicking(null); postClip(c, at); }}
            onEpisode={(r) => { const at = picking || undefined; setPicking(null); postEpisode(r, at); }}
            onPhoto={(ph) => { const at = picking || undefined; setPicking(null); setTargetAt(at); setTarget({ kind: "photo", id: 0, title: ph.title, storageKey: ph.storageKey, preview: ph.preview }); }}
            onVideo={async (id) => {
              const at = picking || undefined;
              // Filed in the Library: read its title back, then post it like any episode.
              const list = (await (await apiRequest("GET", "/api/host/recordings")).json()) as RecordingRow[];
              void qc.invalidateQueries({ queryKey: ["/api/host/recordings"] });
              setPicking(null);
              setTargetAt(at);
              setTarget({ kind: "recording", id, title: list.find((r) => r.id === id)?.title || "New video" });
            }}
          />
        </DialogContent>
      </Dialog>

      {/* One post: where it went, and (while it's waiting) move or cancel. */}
      <PostDetail p={open} onClose={() => setOpen(null)} onMove={(p, t) => { move.mutate({ id: p.id, at: t }); setOpen(null); }} onCancel={(p) => cancel.mutate(p.id)} busy={move.isPending || cancel.isPending} />

      <ConfirmDelete
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={`Delete "${removing?.title || "this post"}" from the queue?`}
        description={removing ? `It was going out ${fmtWhen(removing.at)}. It won't post, and the clip goes back to Ready to post.` : ""}
        url={`/api/host/posts/${removing?.id}`}
        onDeleted={() => { setRemoving(null); setOpen(null); void qc.invalidateQueries({ queryKey: ["/api/host/social/queue"] }); }}
      />

      <QueueDialog open={queueOpen} onClose={() => setQueueOpen(false)} settings={queue.data?.settings ?? null} onSaved={refresh} />

      <Dialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)}>
        <DialogContent className="max-w-md p-3">
          <DialogTitle className="line-clamp-2 pr-8 text-sm">{viewing?.title}</DialogTitle>
          {viewing && <video src={viewing.src} controls autoPlay playsInline className="max-h-[75vh] w-full rounded-lg bg-black object-contain" />}
        </DialogContent>
      </Dialog>
      <PostDialog target={target} at={targetAt} onClose={() => { setTarget(null); setTargetAt(undefined); }} />
    </section>
  );
}

function compact(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K` : String(n);
}

function Tip({ text, children }: { text: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-[16rem] text-xs">{text}</TooltipContent>
    </Tooltip>
  );
}

function Card({ title, icon: I, note, children }: { title: string; icon: typeof Home; note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><I className="h-4 w-4 text-[#053877] dark:text-[#8fb5e8]" /> {title}</h2>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </div>
      {children}
    </div>
  );
}

function Thumb({ p, className = "h-12 w-9" }: { p: Post; className?: string }) {
  return (
    <span className={`relative block shrink-0 overflow-hidden rounded-md bg-black ${p.wide ? "w-16" : ""} ${className}`}>
      {p.thumb && (p.kind === "photo" ? <img src={p.thumb} alt="" className="h-full w-full object-cover" /> : <video src={`${p.thumb}#t=1`} preload="metadata" muted playsInline className="h-full w-full object-cover" />)}
    </span>
  );
}

/** Where a post went: each platform, lit and linked when it's live, red when it failed. */
function Outcomes({ p }: { p: Post }) {
  const list = p.platforms.split(",").filter(Boolean) as SocialPlatform[];
  return (
    <span className="flex flex-wrap items-center gap-1">
      {list.map((pl) => {
        const r = p.results_.find((x) => x.platform === pl);
        const cls = "inline-flex h-6 w-6 items-center justify-center rounded-full border";
        if (r?.ok && r.url) return <a key={pl} href={r.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={`See it on ${platformLabel(pl)}`} className={`${cls} border-emerald-500/50 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950`}><PlatformIcon platform={pl} className="h-3 w-3" /></a>;
        if (r && !r.ok) return <span key={pl} title={`${platformLabel(pl)}: ${r.error || "didn't go out"}`} className={`${cls} border-red-400 text-red-600`}><PlatformIcon platform={pl} className="h-3 w-3" /></span>;
        return <span key={pl} title={r?.inbox ? `${platformLabel(pl)}: in your drafts, publish it from the app` : platformLabel(pl)} className={`${cls} border-border text-muted-foreground`}><PlatformIcon platform={pl} className="h-3 w-3" /></span>;
      })}
    </span>
  );
}

function PostRow({ p, onOpen, onRemove, compactRow }: { p: Post; onOpen: () => void; onRemove?: () => void; compactRow?: boolean }) {
  const failed = p.status === "failed";
  return (
    <li className="group flex items-center gap-1">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left hover:bg-muted/40" data-testid={`social-post-row-${p.id}`}>
        <Thumb p={p} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{p.title || "Untitled"}</span>
          <span className={`block text-xs ${failed ? "text-destructive" : "text-muted-foreground"}`}>
            {failed ? <><AlertTriangle className="mr-1 inline h-3 w-3" />{p.error || "Didn't go out"}</> : p.status === "scheduled" && p.at > Date.now() ? fmtWhen(p.at) : `Posted ${fmtWhen(p.at)}`}
          </span>
        </span>
        {!compactRow && <Outcomes p={p} />}
        {compactRow && <span className="flex gap-0.5 text-muted-foreground">{(p.platforms.split(",").filter(Boolean) as SocialPlatform[]).map((pl) => <PlatformIcon key={pl} platform={pl} className="h-3.5 w-3.5" />)}</span>}
      </button>
      {onRemove && (
        <Tip text="Delete from the queue">
          <button type="button" onClick={onRemove} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-red-50 hover:text-destructive dark:hover:bg-red-950" aria-label="Delete from the queue" data-testid={`social-remove-${p.id}`}><Trash2 className="h-4 w-4" /></button>
        </Tip>
      )}
    </li>
  );
}

/** The week: seven days, each with its posts and its open queue slots. Drag a waiting post to another day. */
function Calendar({ posts, slots, onOpen, onSlot, onMove, onRemove }: { posts: Post[]; slots: number[]; onOpen: (p: Post) => void; onSlot: (t: number) => void; onMove: (p: Post, t: number) => void; onRemove: (p: Post) => void }) {
  const [start, setStart] = useState(() => weekStart(Date.now()));
  const [dragging, setDragging] = useState<Post | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => start + i * DAY);
  const label = `${new Date(start).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${new Date(start + 6 * DAY).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  const movable = (p: Post) => p.status === "scheduled" && p.at > Date.now() && !!p.jobId;
  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-sm" data-testid="social-calendar">
      <div className="mb-3 flex items-center gap-2">
        <button type="button" onClick={() => setStart(start - 7 * DAY)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-muted" aria-label="Last week"><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" onClick={() => setStart(weekStart(Date.now()))} className="h-8 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted">Today</button>
        <button type="button" onClick={() => setStart(start + 7 * DAY)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-muted" aria-label="Next week"><ChevronRight className="h-4 w-4" /></button>
        <span className="ml-1 text-sm font-semibold">{label}</span>
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">Drag a scheduled post to another day. Click an open slot to fill it.</span>
      </div>
      <div className="grid grid-cols-7 gap-1.5 overflow-x-auto">
        {days.map((d) => {
          const today = sameDay(d, Date.now());
          const past = d + DAY <= Date.now();
          const items = posts.filter((p) => p.status !== "sending" && sameDay(p.at, d)).sort((a, b) => a.at - b.at);
          const open = slots.filter((t) => sameDay(t, d)).sort((a, b) => a - b);
          return (
            <div
              key={d}
              onDragOver={(e) => { if (dragging && !past) { e.preventDefault(); setOver(d); } }}
              onDragLeave={() => setOver((o) => (o === d ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                if (!dragging) return;
                const t = new Date(dragging.at);
                const nd = new Date(d);
                nd.setHours(t.getHours(), t.getMinutes(), 0, 0);
                if (!sameDay(nd.getTime(), dragging.at)) onMove(dragging, nd.getTime());
                setDragging(null);
              }}
              className={`flex min-h-[22rem] min-w-[7.5rem] flex-col gap-1.5 rounded-xl border p-1.5 transition-colors ${over === d ? "border-[#F0A71F] bg-[#F0A71F]/10" : today ? "border-[#053877]/40 bg-[#053877]/[0.03]" : "border-border"} ${past ? "opacity-70" : ""}`}
              data-testid={`social-day-${new Date(d).getDay()}`}
            >
              <p className={`px-1 text-xs font-semibold ${today ? "text-[#053877] dark:text-[#8fb5e8]" : "text-muted-foreground"}`}>
                {new Date(d).toLocaleDateString(undefined, { weekday: "short" })} <span className="tabular-nums">{new Date(d).getDate()}</span>
              </p>
              {[...items.map((p) => ({ t: p.at, p })), ...open.map((t) => ({ t, p: null as Post | null }))].sort((a, b) => a.t - b.t).map(({ t, p }) =>
                p ? (
                  <div key={`p${p.id}`} className="group/item relative">
                  <button
                    type="button"
                    draggable={movable(p)}
                    onDragStart={() => setDragging(p)}
                    onDragEnd={() => { setDragging(null); setOver(null); }}
                    onClick={() => onOpen(p)}
                    className={`flex w-full items-center gap-1.5 rounded-lg border p-1 text-left text-[11px] leading-tight ${p.status === "failed" ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40" : p.status === "scheduled" && p.at > Date.now() ? "border-[#053877]/30 bg-[#053877]/[0.06]" : "border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-950/30"} ${movable(p) ? "cursor-grab active:cursor-grabbing" : ""}`}
                    data-testid={`social-cal-post-${p.id}`}
                  >
                    <Thumb p={p} className="h-9 w-7" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold tabular-nums">{fmtTime(p.at)}</span>
                      <span className="line-clamp-2">{p.title || "Untitled"}</span>
                    </span>
                  </button>
                  {p.status === "scheduled" && p.at > Date.now() && (
                    <button type="button" onClick={() => onRemove(p)} className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-destructive group-hover/item:flex" aria-label="Delete from the queue" title="Delete from the queue" data-testid={`social-cal-remove-${p.id}`}><X className="h-3 w-3" /></button>
                  )}
                  </div>
                ) : (
                  <button key={`s${t}`} type="button" onClick={() => onSlot(t)} className="flex w-full items-center gap-1 rounded-lg border border-dashed border-border px-1.5 py-1.5 text-[11px] text-muted-foreground hover:border-[#053877]/50 hover:text-foreground" data-testid="social-open-slot">
                    <Plus className="h-3 w-3" /> <span className="tabular-nums">{fmtTime(t)}</span> open
                  </button>
                ),
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LibraryPicker({ initial = "clips", clips, episodes, used, onClip, onEpisode, onPhoto, onVideo }: { initial?: "clips" | "episodes" | "upload"; clips: ClipRow[]; episodes: RecordingRow[]; used: Set<number>; onClip: (c: ClipRow) => void; onEpisode: (r: RecordingRow) => void; onPhoto: (p: { storageKey: string; preview: string; title: string }) => void; onVideo: (id: number) => void }) {
  const [kind, setKind] = useState<"clips" | "episodes" | "upload">(initial);
  const { toast } = useToast();
  const [pct, setPct] = useState<number | null>(null);
  const photo = async (file: File) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return toast({ title: "A JPG, PNG or WebP, please", variant: "destructive" });
    if (file.size > 8 * 1024 ** 2) return toast({ title: "Keep it under 8MB", description: "Instagram and others turn larger pictures down.", variant: "destructive" });
    try {
      setPct(0);
      const storageKey = await uploadToStorage(file, setPct);
      onPhoto({ storageKey, preview: URL.createObjectURL(file), title: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() });
    } catch (e) {
      toast({ title: "Couldn't upload that", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPct(null);
    }
  };
  return (
    <div>
      <div className="mb-3 inline-flex rounded-full border border-border p-0.5 text-xs">
        {(["clips", "episodes", "upload"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-full px-3 py-1 font-semibold ${kind === k ? "bg-[#053877] text-white" : "text-muted-foreground hover:text-foreground"}`} data-testid={`social-pick-tab-${k}`}>{k === "upload" ? "Upload new" : k === "clips" ? "Clips" : "Episodes"}{k !== "upload" && <span className="ml-1 opacity-70">{k === "clips" ? clips.length : episodes.length}</span>}</button>
        ))}
      </div>
      {kind === "upload" ? (
        // Something new to post: a picture for this post, or a video (kept in the Library, where Pōstify can clip it too).
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={`flex min-h-[12rem] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border p-6 text-center transition-colors hover:border-[#053877]/50 ${pct !== null ? "pointer-events-none opacity-70" : ""}`} data-testid="social-upload-photo">
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void photo(e.target.files[0])} />
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#053877]/10 text-[#053877] dark:text-[#8fb5e8]">{pct === null ? <ImagePlus className="h-5 w-5" /> : <Loader2 className="h-5 w-5 animate-spin" />}</span>
            <span className="text-sm font-semibold">{pct === null ? "A picture" : `Uploading ${pct}%`}</span>
            <span className="text-xs text-muted-foreground">JPG, PNG or WebP. Posts to everything but YouTube.</span>
          </label>
          <div className="min-h-[12rem]" data-testid="social-upload-video">
            <UploadRecording tall title="A video" note="Drop it here or click. It's saved to your Library too, so Pōstify can clip it." onDone={onVideo} />
          </div>
        </div>
      ) : kind === "clips" ? (
        clips.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
            {clips.map((c) => (
              <button key={c.id} type="button" onClick={() => onClip(c)} className="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-border text-left hover:border-[#053877]/50" data-testid={`social-pick-clip-${c.id}`}>
                <span className="relative block aspect-[4/5] bg-black">
                  <video src={`${c.verticalUrl || c.squareUrl || c.url}#t=1`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                  {used.has(c.id) && <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold text-white"><Check className="h-2.5 w-2.5" /> Posted</span>}
                </span>
                <span className="line-clamp-2 p-2 text-xs font-semibold leading-snug">{c.title}</span>
              </button>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">No clips yet. Pōstify an episode to make some.</p>
      ) : episodes.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {episodes.map((r) => (
            <button key={r.id} type="button" onClick={() => onEpisode(r)} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border text-left hover:border-[#053877]/50" data-testid={`social-pick-episode-${r.id}`}>
              <span className="relative block aspect-video bg-black"><video src={`/api/host/recordings/${r.id}/video#t=8`} preload="metadata" muted playsInline className="h-full w-full object-cover" /></span>
              <span className="line-clamp-2 p-2 text-xs font-semibold leading-snug">{r.title || "Session"}</span>
            </button>
          ))}
        </div>
      ) : <p className="text-sm text-muted-foreground">Nothing in your Library yet.</p>}
    </div>
  );
}

function PostDetail({ p, onClose, onMove, onCancel, busy }: { p: Post | null; onClose: () => void; onMove: (p: Post, t: number) => void; onCancel: (p: Post) => void; busy: boolean }) {
  const [when, setWhen] = useState("");
  const waiting = !!p && p.status === "scheduled" && p.at > Date.now();
  return (
    <Dialog open={!!p} onOpenChange={(v) => { if (!v) { onClose(); setWhen(""); } }}>
      <DialogContent className="sm:max-w-md">
        {p && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6">{p.title || "Untitled"}</DialogTitle>
              <DialogDescription>{waiting ? `Goes out ${fmtWhen(p.at)}` : p.status === "failed" ? "Didn't go out" : `Posted ${fmtWhen(p.at)}`}</DialogDescription>
            </DialogHeader>
            <div className="flex gap-3">
              <Thumb p={p} className="h-28 w-20" />
              <div className="min-w-0 flex-1 space-y-2 text-sm">
                {p.description && <p className="line-clamp-4 text-muted-foreground">{p.description}</p>}
                <div className="space-y-1">
                  {(p.platforms.split(",").filter(Boolean) as SocialPlatform[]).map((pl) => {
                    const r = p.results_.find((x) => x.platform === pl);
                    return (
                      <p key={pl} className="flex items-center gap-2 text-xs">
                        <PlatformIcon platform={pl} className="h-3.5 w-3.5" /> {platformLabel(pl)}
                        {r?.ok && r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 font-semibold text-emerald-600 hover:underline dark:text-emerald-400">Live <ExternalLink className="h-3 w-3" /></a>
                          : r && !r.ok ? <span className="ml-auto truncate text-destructive" title={r.error}>{r.error || "Failed"}</span>
                          : r?.inbox ? <span className="ml-auto text-amber-600">In drafts</span>
                          : <span className="ml-auto text-muted-foreground">{waiting ? "Waiting" : "Checking…"}</span>}
                      </p>
                    );
                  })}
                </div>
              </div>
            </div>
            {waiting && (
              p.jobId ? (
                <div className="space-y-2 rounded-xl border border-border p-3">
                  <p className="text-xs font-semibold">Move it</p>
                  <div className="flex gap-2">
                    <Input type="datetime-local" value={when || local(p.at)} onChange={(e) => setWhen(e.target.value)} className="h-9" data-testid="social-move-when" />
                    <Button size="sm" disabled={busy || !when} onClick={() => onMove(p, new Date(when).getTime())} className="h-9" data-testid="social-move-save">Move</Button>
                  </div>
                </div>
              ) : <p className="text-xs text-muted-foreground">Scheduled before the calendar could move posts: cancel and post again to change it.</p>
            )}
            <DialogFooter className="gap-2 sm:justify-between">
              {waiting ? (
                <Button variant="ghost" className="gap-1.5 text-destructive hover:text-destructive" disabled={busy} onClick={() => onCancel(p)} data-testid="social-cancel"><Trash2 className="h-4 w-4" /> Delete from queue</Button>
              ) : <span />}
              <Button variant="outline" onClick={onClose}><X className="h-4 w-4" /> Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The queue's times: which days, and what times of day, posts go out. */
function QueueDialog({ open, onClose, settings, onSaved }: { open: boolean; onClose: () => void; settings: Queue["settings"]; onSaved: () => void }) {
  const { toast } = useToast();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const pad = (n: number) => String(n).padStart(2, "0");
  const [days, setDays] = useState<number[]>([]);
  const [times, setTimes] = useState<string[]>([]);
  const [seeded, setSeeded] = useState(false);
  if (open && !seeded) {
    setDays(settings?.days_of_week ?? [0, 1, 2, 3, 4]);
    setTimes((settings?.slots ?? [{ hour: 9, minute: 0 }, { hour: 12, minute: 0 }, { hour: 17, minute: 0 }]).map((s) => `${pad(s.hour)}:${pad(s.minute)}`));
    setSeeded(true);
  }
  if (!open && seeded) setSeeded(false);
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/host/social/queue", { days, timezone: tz, slots: times.filter(Boolean).map((t) => ({ hour: Number(t.split(":")[0]), minute: Number(t.split(":")[1]) })) })).json(),
    onSuccess: () => { onSaved(); onClose(); toast({ title: "Queue times saved" }); },
    onError: (e: Error) => toast({ title: "Couldn't save that", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Queue times</DialogTitle>
          <DialogDescription>When your queue posts. Add to queue puts each post in the next open time.{settings?.timezone && settings.timezone !== tz ? ` Saving sets the time zone to ${tz}.` : ""}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-sm font-medium">Days</p>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d, i) => (
                <button key={d} type="button" onClick={() => setDays((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort()))} className={`rounded-full border px-3 py-1 text-xs font-semibold ${days.includes(i) ? "border-[#053877] bg-[#053877] text-white" : "border-border hover:border-[#053877]/40"}`} data-testid={`queue-day-${i}`}>{d}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium">Times <span className="font-normal text-muted-foreground">({tz})</span></p>
            <div className="space-y-1.5">
              {times.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input type="time" value={t} onChange={(e) => setTimes((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))} className="h-9 w-36" data-testid={`queue-time-${i}`} />
                  <button type="button" onClick={() => setTimes((cur) => cur.filter((_, j) => j !== i))} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Remove this time"><X className="h-4 w-4" /></button>
                </div>
              ))}
              {times.length < 12 && <button type="button" onClick={() => setTimes((cur) => [...cur, "12:00"])} className="inline-flex items-center gap-1 text-xs font-semibold text-[#053877] hover:underline dark:text-[#8fb5e8]"><Plus className="h-3 w-3" /> Add a time</button>}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !days.length || !times.filter(Boolean).length} data-testid="queue-save">{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Analytics = {
  days: number; connected: boolean; start?: string; end?: string;
  views?: { total_impressions?: number; per_platform?: Record<string, number>; per_day?: Record<string, number>; error?: string };
  engagement?: { metrics?: Record<string, number>; per_platform?: Record<string, Record<string, number>>; per_day?: Record<string, Record<string, number>>; error?: string };
  posts?: { id: number; kind: string; refId: number; shape: string; title: string; at: string; platforms: string; results: string; metrics: string; metricsAt: string }[];
};

/** Latest of a day-keyed series and its change since the first day. Upload-Post's daily numbers are running totals, so they're read, not added up. */
function trend(series?: Record<string, number>) {
  const days = Object.keys(series ?? {}).sort();
  if (!days.length) return null;
  const first = series![days[0]] ?? 0, last = series![days[days.length - 1]] ?? 0;
  return { last, change: last - first, pct: first > 0 ? ((last - first) / first) * 100 : null };
}

/**
 * Analytics: how the accounts are growing and which posts carried it, the way
 * Later and Buffer lead: headline numbers with their change, one chart, where
 * the reach comes from, the posts ranked, and plain-English tips once there's
 * enough to go on.
 */
function Analytics({ clips, onOpen }: { clips: ClipRow[]; onOpen: (id: number) => void }) {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [metric, setMetric] = useState<"reach" | "followers" | "likes">("reach");
  const q = useQuery<Analytics>({ queryKey: ["/api/host/social/analytics", days], queryFn: async () => (await apiRequest("GET", `/api/host/social/analytics?days=${days}`)).json() });
  const a = q.data;
  const pd = a?.engagement?.per_day ?? {};
  const series = metric === "reach" ? a?.views?.per_day : pd[metric];
  const chart = Object.keys(series ?? {}).sort().map((d) => ({ d, v: series![d] }));
  const reach = trend(a?.views?.per_day);
  const followers = trend(pd.followers);
  const engagementDay: Record<string, number> = {};
  for (const k of ["likes", "comments", "shares"]) for (const [d, v] of Object.entries(pd[k] ?? {})) engagementDay[d] = (engagementDay[d] ?? 0) + (v ?? 0);
  const engagement = trend(engagementDay);
  const share = Object.entries(a?.views?.per_platform ?? {}).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
  const shareTotal = share.reduce((n, [, v]) => n + v, 0);

  const posts = (a?.posts ?? []).map((p) => {
    let m: PostMetrics = {};
    try { m = p.metrics ? JSON.parse(p.metrics) : {}; } catch { m = {}; }
    const sum = (k: "views" | "likes" | "comments" | "shares") => Object.values(m).reduce((n, v) => n + (v[k] ?? 0), 0);
    const clip = p.kind === "clip" ? clips.find((c) => c.id === p.refId) : undefined;
    return { ...p, m, views: sum("views"), likes: sum("likes"), comments: sum("comments"), shares: sum("shares"), measured: Object.keys(m).length > 0, len: clip ? clip.endSec - clip.startSec : 0, thumb: p.kind === "photo" ? `/api/host/posts/${p.id}/media` : clip ? clip.verticalUrl || clip.squareUrl || clip.url : p.kind === "recording" ? `/api/host/recordings/${p.refId}/video` : "" };
  }).sort((x, y) => y.views - x.views || y.likes - x.likes);
  const measured = posts.filter((p) => p.measured);

  // Tips, from their own posts once there are a few with numbers.
  const tips: string[] = [];
  if (measured.length >= 3) {
    const byPlatform: Record<string, number[]> = {};
    for (const p of measured) for (const [pl, v] of Object.entries(p.m)) (byPlatform[pl] ??= []).push(v.views ?? 0);
    const avg = (xs: number[]) => xs.reduce((a2, b) => a2 + b, 0) / Math.max(1, xs.length);
    const best = Object.entries(byPlatform).map(([pl, xs]) => [pl, avg(xs)] as const).sort((x, y) => y[1] - x[1]);
    if (best.length > 1 && best[0][1] > 0) tips.push(`${platformLabel(best[0][0] as SocialPlatform)} is where your posts get seen most: about ${compact(Math.round(best[0][1]))} views each.`);
    const byDay: Record<number, number[]> = {};
    for (const p of measured) (byDay[new Date(p.at).getDay()] ??= []).push(p.views);
    const bestDay = Object.entries(byDay).filter(([, xs]) => xs.length >= 2).map(([d, xs]) => [Number(d), avg(xs)] as const).sort((x, y) => y[1] - x[1])[0];
    if (bestDay) tips.push(`Your ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][bestDay[0]]} posts do best. Put your strongest clip there.`);
    const short = measured.filter((p) => p.len > 0 && p.len < 45), long = measured.filter((p) => p.len >= 45);
    if (short.length >= 2 && long.length >= 2) {
      const s2 = avg(short.map((p) => p.views)), l2 = avg(long.map((p) => p.views));
      if (s2 > l2 * 1.2) tips.push(`Clips under 45 seconds get ${Math.round((s2 / Math.max(1, l2) - 1) * 100)}% more views than longer ones.`);
      else if (l2 > s2 * 1.2) tips.push(`Your longer clips (45 seconds and up) get ${Math.round((l2 / Math.max(1, s2) - 1) * 100)}% more views: your audience stays for the story.`);
    }
  }

  if (q.isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!a?.connected) return <p className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">Connect your accounts and your numbers show here.</p>;

  const kpi = (label: string, I: typeof Home, t: ReturnType<typeof trend>, hint: string) => (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><I className="h-3.5 w-3.5" /> {label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{t ? compact(t.last) : "—"}</p>
      {t && t.change !== 0 ? (
        <p className={`mt-0.5 flex items-center gap-1 text-xs font-semibold ${t.change > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600"}`}>
          {t.change > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
          {t.change > 0 ? "+" : ""}{label === "Followers" ? compact(t.change) : t.pct !== null ? `${Math.round(t.pct)}%` : compact(t.change)} <span className="font-normal text-muted-foreground">in {days} days</span>
        </p>
      ) : <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );

  return (
    <div className="flex flex-col gap-4" data-testid="social-analytics">
      <div className="flex items-center gap-1.5">
        {([7, 30, 90] as const).map((d) => (
          <button key={d} type="button" onClick={() => setDays(d)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${days === d ? "border-[#053877] bg-[#053877] text-white" : "border-border hover:border-[#053877]/40"}`} data-testid={`analytics-days-${d}`}>Last {d} days</button>
        ))}
        {q.isFetching && <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpi("Reach & views", Eye, reach, "People who saw your posts")}
        {kpi("Followers", Users, followers, "Across your accounts")}
        {kpi("Engagement", Heart, engagement, "Likes, comments and shares")}
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Send className="h-3.5 w-3.5" /> Posts</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{posts.length}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Sent from here in {days} days</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-1.5">
            {([["reach", "Reach & views"], ["followers", "Followers"], ["likes", "Likes"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setMetric(k)} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${metric === k ? "bg-[#F0A71F] text-[#1a1200]" : "text-muted-foreground hover:bg-muted"}`}>{l}</button>
            ))}
          </div>
          {chart.length > 1 ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                  <defs><linearGradient id="socialFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#F0A71F" stopOpacity={0.35} /><stop offset="100%" stopColor="#F0A71F" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-border" />
                  <XAxis dataKey="d" tickFormatter={(d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tickFormatter={(v: number) => compact(v)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} domain={["auto", "auto"]} />
                  <ChartTip formatter={(v: number) => v.toLocaleString()} labelFormatter={(d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} />
                  <Area type="monotone" dataKey="v" stroke="#F0A71F" strokeWidth={2} fill="url(#socialFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="py-10 text-center text-sm text-muted-foreground">A chart appears after a couple of days of numbers.</p>}
        </div>

        <div className="flex flex-col gap-4">
          <Card title="Where your reach comes from" icon={Repeat2}>
            {share.length ? (
              <div className="space-y-2.5">
                {share.map(([pl, v]) => (
                  <div key={pl}>
                    <div className="mb-1 flex items-center justify-between text-xs"><span className="flex items-center gap-1.5 font-medium"><PlatformIcon platform={pl as SocialPlatform} className="h-3.5 w-3.5" /> {platformLabel(pl as SocialPlatform)}</span><span className="tabular-nums text-muted-foreground">{Math.round((v / shareTotal) * 100)}%</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[#053877]" style={{ width: `${(v / shareTotal) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">Nothing yet for this range.</p>}
          </Card>
          <Card title="Tips" icon={Lightbulb}>
            {tips.length ? <ul className="list-disc space-y-1.5 pl-4 text-sm">{tips.map((t) => <li key={t}>{t}</li>)}</ul> : <p className="text-sm text-muted-foreground">Tips appear once a few of your posts from here have numbers: which platform, day and clip length work best for you.</p>}
          </Card>
        </div>
      </div>

      <Card title="Your posts" icon={TrendingUp} note={posts.length ? "Best first" : undefined}>
        {posts.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-2 font-medium">Post</th><th className="pb-2 text-right font-medium"><Eye className="ml-auto h-3.5 w-3.5" aria-label="Views" /></th><th className="pb-2 text-right font-medium"><Heart className="ml-auto h-3.5 w-3.5" aria-label="Likes" /></th><th className="pb-2 text-right font-medium"><MessageCircle className="ml-auto h-3.5 w-3.5" aria-label="Comments" /></th><th className="pb-2 text-right font-medium"><Repeat2 className="ml-auto h-3.5 w-3.5" aria-label="Shares" /></th></tr></thead>
              <tbody className="divide-y divide-border">
                {posts.map((p) => (
                  <tr key={p.id} onClick={() => onOpen(p.id)} className="cursor-pointer hover:bg-muted/40" data-testid={`analytics-post-${p.id}`}>
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-3">
                        <span className="block h-11 w-8 shrink-0 overflow-hidden rounded bg-black">{p.thumb && (p.kind === "photo" ? <img src={p.thumb} alt="" className="h-full w-full object-cover" /> : <video src={`${p.thumb}#t=1`} preload="metadata" muted playsInline className="h-full w-full object-cover" />)}</span>
                        <span className="min-w-0">
                          <span className="block max-w-[22rem] truncate font-medium">{p.title || "Untitled"}</span>
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{fmtWhen(Date.parse(p.at))} {(p.platforms.split(",").filter(Boolean) as SocialPlatform[]).map((pl) => <PlatformIcon key={pl} platform={pl} className="h-3 w-3" />)}</span>
                        </span>
                      </span>
                    </td>
                    {p.measured ? (["views", "likes", "comments", "shares"] as const).map((k) => <td key={k} className="py-2 text-right tabular-nums">{compact(p[k])}</td>) : <td colSpan={4} className="py-2 text-right text-xs text-muted-foreground">Numbers come in a few hours after it's out</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-muted-foreground">Nothing posted from here in the last {days} days.</p>}
      </Card>
    </div>
  );
}
