import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { PostDialog, type PostTarget } from "@/components/PostDialog";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { PlatformIcon, platformLabel } from "@/components/SocialIcons";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { ClipRow, HostPostRow, RecordingRow, SocialPlatform } from "@shared/schema";
import { AlertTriangle, CalendarClock, Check, FolderOpen, Link2, Play, Repeat2, Scissors, Send, Share2, Trash2 } from "lucide-react";

/**
 * Social: one place to post anything in the Library or out of Pōstify to the
 * accounts you've connected — now or on a schedule — and to see what's gone
 * out and what's waiting. Promotion for an event stays with the event.
 */
export function SocialScreen() {
  const [target, setTarget] = useState<PostTarget | null>(null);
  const [viewing, setViewing] = useState<{ src: string; title: string } | null>(null);
  const [tab, setTab] = useState<"clips" | "scheduled" | "posted">("clips");
  const [deleting, setDeleting] = useState<ClipRow | null>(null);

  const social = useQuery<{ configured: boolean; accounts: { platform: SocialPlatform; username?: string; followers?: number }[] }>({
    queryKey: ["/api/host/social"],
    queryFn: async () => (await apiRequest("GET", "/api/host/social")).json(),
  });
  const clips = useQuery<ClipRow[]>({
    queryKey: ["/api/host/clips"],
    queryFn: async () => (await apiRequest("GET", "/api/host/clips")).json(),
  });
  const recs = useQuery<RecordingRow[]>({
    queryKey: ["/api/host/recordings"],
    queryFn: async () => (await apiRequest("GET", "/api/host/recordings")).json(),
  });
  const posts = useQuery<HostPostRow[]>({
    queryKey: ["/api/host/posts"],
    queryFn: async () => (await apiRequest("GET", "/api/host/posts")).json(),
  });

  const accounts = social.data?.accounts ?? [];
  const episodes = (recs.data ?? []).filter((r) => r.status === "Ready");
  const clipList = useMemo(() => [...(clips.data ?? [])].sort((a, b) => b.id - a.id), [clips.data]);
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const all = posts.data ?? [];
  const isUpcoming = (p: HostPostRow) => p.status === "scheduled" && Date.parse(p.scheduledAt) > Date.now();

  /**
   * Each thing posted, once per folder: a clip sent twice (two shapes, or
   * again later) is one tile with every account it went to.
   */
  function folder(match: (p: HostPostRow) => boolean, newest: boolean): Item[] {
    const byRef = new Map<string, HostPostRow[]>();
    for (const p of all.filter(match)) byRef.set(`${p.kind}-${p.refId}`, [...(byRef.get(`${p.kind}-${p.refId}`) ?? []), p]);
    const items: Item[] = [];
    for (const group of Array.from(byRef.values())) {
      const at = (p: HostPostRow) => Date.parse(p.scheduledAt || p.createdAt);
      group.sort((a, b) => (newest ? at(b) - at(a) : at(a) - at(b)));
      const p = group[0];
      const clip = p.kind === "clip" ? clipList.find((c) => c.id === p.refId) : undefined;
      const rec = p.kind === "recording" ? episodes.find((r) => r.id === p.refId) : undefined;
      items.push({
        key: `${p.kind}-${p.refId}`,
        posts: group,
        title: p.title || clip?.title || rec?.title || "Untitled",
        src: clip ? clip.verticalUrl || clip.squareUrl || clip.url : rec ? `/api/host/recordings/${rec.id}/video` : "",
        wide: !clip || (!clip.verticalUrl && !clip.squareUrl),
        clip,
        rec,
        platforms: Array.from(new Set(group.flatMap((g) => g.platforms.split(",").filter(Boolean)))) as SocialPlatform[],
        at: at(p),
      });
    }
    return items.sort((a, b) => (newest ? b.at - a.at : a.at - b.at));
  }
  const scheduled = folder(isUpcoming, false);
  const posted = folder((p) => !isUpcoming(p), true);
  // A clip leaves Clips once it's posted or scheduled; one that didn't go out stays, to try again.
  const gone = new Set(all.filter((p) => p.kind === "clip" && p.status !== "failed").map((p) => p.refId));
  const toPost = clipList.filter((c) => !gone.has(c.id) && (c.verticalUrl || c.squareUrl || c.url));
  const failedClip = new Set(all.filter((p) => p.kind === "clip" && p.status === "failed").map((p) => p.refId));
  const postClip = (c: ClipRow) => {
    const shapes = ([["vertical", c.verticalUrl], ["square", c.squareUrl], ["wide", c.url]] as const).filter(([, u]) => u).map(([s]) => s);
    setTarget({ kind: "clip", id: c.id, title: c.title, caption: c.caption, shapes: [...shapes] });
  };

  return (
    <section className="mt-6" data-testid="social-screen">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
        <Share2 className="h-4 w-4" /> Social
      </h2>
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">Post your clips to your own accounts, now or on a schedule. Once a clip's posted it moves to its folder. Whole episodes post from your Library.</p>

      {/* Where it goes */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">Your accounts</span>
          {accounts.length ? (
            accounts.map((a, i) => (
              <span key={`${a.platform}-${i}`} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium">
                <PlatformIcon platform={a.platform} className="h-3.5 w-3.5" /> {a.username ? `@${a.username.replace(/^@/, "")}` : platformLabel(a.platform)}
              </span>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">None connected yet.</span>
          )}
        </div>
        <Button asChild variant="outline" size="sm" className="gap-1.5 rounded-full">
          <a href="/host/dashboard/integrations"><Link2 className="h-3.5 w-3.5" /> {accounts.length ? "Manage" : "Connect accounts"}</a>
        </Button>
      </div>

      {/* Three folders: still to post, waiting to go out, gone out. */}
      <div className="mb-4 flex gap-1 border-b border-border" role="tablist">
        {([
          { k: "clips", label: "Clips", n: toPost.length, icon: Scissors },
          { k: "scheduled", label: "Scheduled", n: scheduled.length, icon: CalendarClock },
          { k: "posted", label: "Posted", n: posted.length, icon: Send },
        ] as const).map((t) => (
          <button key={t.k} type="button" role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)} className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold ${tab === t.k ? "border-[#F0A71F] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`} data-testid={`social-tab-${t.k}`}>
            {tab === t.k ? <FolderOpen className="h-4 w-4" /> : <t.icon className="h-4 w-4" />} {t.label} <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{t.n}</span>
          </button>
        ))}
      </div>

      {tab === "scheduled" ? (
        scheduled.length ? (
          <Grid>
            {scheduled.map((it) => (
              <Tile key={it.key} src={it.src} wide={it.wide} title={it.title} onPlay={() => setViewing({ src: it.src, title: it.title })} badge={<Badge tone="amber"><CalendarClock className="h-3 w-3" /> {it.posts.length > 1 ? `${it.posts.length} waiting` : "Scheduled"}</Badge>}>
                <p className="text-[11px] leading-tight text-muted-foreground">{when(it.posts[0].scheduledAt)}</p>
                <Platforms list={it.platforms} />
              </Tile>
            ))}
          </Grid>
        ) : (
          <p className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">Nothing scheduled. Choose "Later" when you post a clip.</p>
        )
      ) : tab === "posted" ? (
        posted.length ? (
          <Grid>
            {posted.map((it) => {
              const failed = it.posts.every((p) => p.status === "failed");
              const latest = it.posts[0];
              return (
                <Tile key={it.key} src={it.src} wide={it.wide} title={it.title} onPlay={() => setViewing({ src: it.src, title: it.title })} badge={failed ? <Badge tone="red"><AlertTriangle className="h-3 w-3" /> Didn't go out</Badge> : <Badge tone="green"><Check className="h-3 w-3" /> Posted{it.posts.length > 1 ? ` ×${it.posts.length}` : ""}</Badge>}>
                  <p className={`text-[11px] leading-tight ${failed ? "text-destructive" : "text-muted-foreground"}`} title={failed ? latest.error : undefined}>{failed ? latest.error || "Try again" : `Sent ${when(latest.scheduledAt || latest.createdAt)}`}</p>
                  <div className="flex items-center justify-between gap-1">
                    <Platforms list={it.platforms} />
                    {it.clip && (
                      <button type="button" onClick={() => postClip(it.clip!)} className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Post ${it.title} again`} title="Post again" data-testid={`social-repost-${it.clip.id}`}>
                        <Repeat2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </Tile>
              );
            })}
          </Grid>
        ) : (
          <p className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">Nothing posted yet. What you post moves here, with where it went.</p>
        )
      ) : toPost.length ? (
        <Grid>
          {toPost.map((c) => {
            const src = c.verticalUrl || c.squareUrl || c.url;
            return (
              <Tile key={c.id} src={src} wide={!c.verticalUrl && !c.squareUrl} title={c.title} onPlay={() => setViewing({ src, title: c.title })} testId={`social-play-${c.id}`} badge={failedClip.has(c.id) ? <Badge tone="red"><AlertTriangle className="h-3 w-3" /> Didn't go out</Badge> : null}>
                <div className="flex items-center gap-1">
                  <Button size="sm" onClick={() => postClip(c)} className="h-7 flex-1 gap-1 rounded-full bg-[#053877] px-2 text-xs text-white hover:bg-[#0a4a99]" data-testid={`social-post-clip-${c.id}`}>
                    <Send className="h-3 w-3" /> Post it
                  </Button>
                  <button type="button" onClick={() => setDeleting(c)} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive" aria-label={`Delete ${c.title}`} data-testid={`social-delete-${c.id}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </Tile>
            );
          })}
        </Grid>
      ) : clipList.length ? (
        <p className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">Every clip's posted or scheduled. Pōstify an episode for more.</p>
      ) : (
        <Empty text="No clips yet. Pōstify makes them from any episode in your Library." href="/host/dashboard/postify" cta="Open Pōstify" />
      )}

      <Dialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)}>
        <DialogContent className="max-w-md p-3">
          <DialogTitle className="line-clamp-2 pr-8 text-sm">{viewing?.title}</DialogTitle>
          {viewing && <video src={viewing.src} controls autoPlay playsInline className="max-h-[75vh] w-full rounded-lg bg-black object-contain" />}
        </DialogContent>
      </Dialog>
      <PostDialog target={target} onClose={() => setTarget(null)} />
      <ConfirmDelete open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)} title={`Delete "${deleting?.title ?? "this clip"}"?`} description="All its shapes go for good. Anything already posted stays on your accounts." url={`/api/host/clips/${deleting?.id}`} />
    </section>
  );
}

type Item = { key: string; posts: HostPostRow[]; title: string; src: string; wide: boolean; clip?: ClipRow; rec?: RecordingRow; platforms: SocialPlatform[]; at: number };

/** Small tiles: the clip's own picture, a quarter the size of Pōstify's cards. */
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] items-start gap-3">{children}</div>;
}

function Tile({ src, wide, title, badge, onPlay, testId, children }: { src: string; wide: boolean; title: string; badge?: React.ReactNode; onPlay: () => void; testId?: string; children?: React.ReactNode }) {
  return (
    <div className="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <button type="button" onClick={onPlay} className={`relative block w-full bg-black ${wide ? "aspect-video" : "aspect-[9/16]"}`} aria-label={`Play ${title}`} data-testid={testId}>
        {src && <video src={`${src}#t=1`} preload="metadata" muted playsInline className="h-full w-full object-cover" />}
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-[#000741] shadow"><Play className="h-3.5 w-3.5 fill-current" /></span>
        </span>
        {badge && <span className="absolute left-1.5 top-1.5">{badge}</span>}
      </button>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        <p className="line-clamp-2 text-xs font-semibold leading-snug text-foreground" title={title}>{title}</p>
        <div className="mt-auto flex flex-col gap-1">{children}</div>
      </div>
    </div>
  );
}

function Badge({ tone, children }: { tone: "green" | "amber" | "red"; children: React.ReactNode }) {
  const c = tone === "green" ? "bg-emerald-500 text-white" : tone === "amber" ? "bg-[#F0A71F] text-[#1a1200]" : "bg-destructive text-white";
  return <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${c}`}>{children}</span>;
}

function Platforms({ list }: { list: SocialPlatform[] }) {
  return <span className="flex flex-wrap items-center gap-1 text-muted-foreground">{list.map((pl) => <PlatformIcon key={pl} platform={pl} className="h-3.5 w-3.5" />)}</span>;
}

function Empty({ text, href, cta }: { text: string; href: string; cta: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
      <p className="mx-auto max-w-md text-sm text-muted-foreground">{text}</p>
      <Button asChild className="mt-4 rounded-full"><a href={href}>{cta}</a></Button>
    </div>
  );
}
