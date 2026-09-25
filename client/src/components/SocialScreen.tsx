import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { PostDialog, type PostTarget } from "@/components/PostDialog";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { PlatformIcon, platformLabel } from "@/components/SocialIcons";
import type { ClipRow, HostPostRow, RecordingRow, SocialPlatform } from "@shared/schema";
import { CalendarClock, Check, Film, Link2, Play, Scissors, Send, Share2, Trash2 } from "lucide-react";

/**
 * Social: one place to post anything in the Library or out of Pōstify to the
 * accounts you've connected — now or on a schedule — and to see what's gone
 * out and what's waiting. Promotion for an event stays with the event.
 */
export function SocialScreen() {
  const [target, setTarget] = useState<PostTarget | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
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
  const titleOf = (p: HostPostRow) => p.title || (p.kind === "clip" ? clipList.find((c) => c.id === p.refId)?.title : episodes.find((r) => r.id === p.refId)?.title) || "Untitled";
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const upcoming = (posts.data ?? []).filter((p) => p.status === "scheduled" && Date.parse(p.scheduledAt) > Date.now());
  const done = (posts.data ?? []).filter((p) => !upcoming.includes(p));

  return (
    <section className="mt-6" data-testid="social-screen">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
        <Share2 className="h-4 w-4" /> Social
      </h2>
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">Post your clips to your own accounts, now or on a schedule, and see what's gone out. Whole episodes post from your Library.</p>

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

      {/* Three views, not one long page: what you can post, what's waiting, what's gone out. */}
      <div className="mb-4 flex gap-1 border-b border-border" role="tablist">
        {([
          { k: "clips", label: "Clips", n: clipList.length, icon: Scissors },
          { k: "scheduled", label: "Scheduled", n: upcoming.length, icon: CalendarClock },
          { k: "posted", label: "Posted", n: done.length, icon: Send },
        ] as const).map((t) => (
          <button key={t.k} type="button" role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)} className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold ${tab === t.k ? "border-[#F0A71F] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`} data-testid={`social-tab-${t.k}`}>
            <t.icon className="h-4 w-4" /> {t.label} <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{t.n}</span>
          </button>
        ))}
      </div>

      {tab === "scheduled" ? (
        upcoming.length ? (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
            {upcoming.map((p) => <PostRow key={p.id} p={p} title={titleOf(p)} line={`Goes out ${when(p.scheduledAt)}`} />)}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">Nothing scheduled. Choose "Later" when you post a clip.</p>
        )
      ) : tab === "posted" ? (
        done.length ? (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
            {done.map((p) => <PostRow key={p.id} p={p} title={titleOf(p)} line={p.status === "failed" ? `Didn't go out: ${p.error || "try again"}` : `Sent ${when(p.scheduledAt || p.createdAt)}`} />)}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">Nothing posted yet. What you post shows here, with where it went.</p>
        )
      ) : clipList.length ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
          {clipList.map((c) => {
            const shapes = ([["vertical", c.verticalUrl], ["square", c.squareUrl], ["wide", c.url]] as const).filter(([, u]) => u).map(([s]) => s);
            const src = c.verticalUrl || c.squareUrl || c.url;
            const sent = (posts.data ?? []).filter((p) => p.kind === "clip" && p.refId === c.id).length;
            if (!src) return null; // still being made
            return (
              <div key={c.id} className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <div className="relative aspect-[9/16] bg-black">
                  {playing === c.id ? (
                    <video src={src} controls autoPlay playsInline className="h-full w-full bg-black object-contain" />
                  ) : (
                    <button type="button" onClick={() => setPlaying(c.id)} className="absolute inset-0" aria-label={`Play ${c.title}`} data-testid={`social-play-${c.id}`}>
                      <video src={`${src}#t=1`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                      <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-[#000741] shadow-lg"><Play className="h-5 w-5 fill-current" /></span>
                      </span>
                      {sent > 0 && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white"><Check className="h-3 w-3" /> Posted{sent > 1 ? ` ×${sent}` : ""}</span>}
                    </button>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{c.title}</p>
                  <div className="mt-auto flex items-center gap-1.5">
                    <Button size="sm" onClick={() => setTarget({ kind: "clip", id: c.id, title: c.title, caption: c.caption, shapes: [...shapes] })} className="flex-1 gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid={`social-post-clip-${c.id}`}>
                      <Send className="h-3.5 w-3.5" /> Post it
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setDeleting(c)} className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:text-destructive" aria-label={`Delete ${c.title}`} data-testid={`social-delete-${c.id}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty text="No clips yet. Pōstify makes them from any episode in your Library." href="/host/dashboard/postify" cta="Open Pōstify" />
      )}

      <PostDialog target={target} onClose={() => setTarget(null)} />
      <ConfirmDelete open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)} title={`Delete "${deleting?.title ?? "this clip"}"?`} description="All its shapes go for good. Anything already posted stays on your accounts." url={`/api/host/clips/${deleting?.id}`} />
    </section>
  );
}

function PostRow({ p, title, line }: { p: HostPostRow; title: string; line: string }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${p.kind === "clip" ? "bg-[#F0A71F]/15 text-[#b36b00]" : "bg-[#053877]/10 text-[#053877]"}`}>
        {p.kind === "clip" ? <Scissors className="h-4 w-4" /> : <Film className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{title}{p.shape ? <span className="font-normal text-muted-foreground"> · {p.shape}</span> : null}</p>
        <p className={`text-xs ${p.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{line}</p>
      </div>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {p.platforms.split(",").filter(Boolean).map((pl) => <PlatformIcon key={pl} platform={pl as SocialPlatform} className="h-4 w-4" />)}
      </span>
    </li>
  );
}

function Empty({ text, href, cta }: { text: string; href: string; cta: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
      <p className="mx-auto max-w-md text-sm text-muted-foreground">{text}</p>
      <Button asChild className="mt-4 rounded-full"><a href={href}>{cta}</a></Button>
    </div>
  );
}
