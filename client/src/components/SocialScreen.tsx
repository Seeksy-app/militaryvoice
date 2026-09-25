import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { PostDialog, type PostTarget } from "@/components/PostDialog";
import { PlatformIcon, platformLabel } from "@/components/SocialIcons";
import type { ClipRow, HostPostRow, RecordingRow, SocialPlatform } from "@shared/schema";
import { CalendarClock, Check, Film, Link2, Scissors, Send, Share2 } from "lucide-react";

/**
 * Social: one place to post anything in the Library or out of Pōstify to the
 * accounts you've connected — now or on a schedule — and to see what's gone
 * out and what's waiting. Promotion for an event stays with the event.
 */
export function SocialScreen() {
  const [target, setTarget] = useState<PostTarget | null>(null);
  const [tab, setTab] = useState<"clips" | "episodes">("clips");

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
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">Post your clips and episodes to your own accounts, now or on a schedule, and see what's gone out.</p>

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

      {/* Scheduled */}
      {upcoming.length > 0 && (
        <div className="mb-6">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground"><CalendarClock className="h-4 w-4 text-[#b36b00]" /> Scheduled</p>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
            {upcoming.map((p) => <PostRow key={p.id} p={p} title={titleOf(p)} line={`Goes out ${when(p.scheduledAt)}`} />)}
          </ul>
        </div>
      )}

      {/* Ready to post */}
      <div className="mb-3 flex items-center gap-1.5">
        {([
          { k: "clips", label: `Clips (${clipList.length})`, icon: Scissors },
          { k: "episodes", label: `Episodes (${episodes.length})`, icon: Film },
        ] as const).map((t) => (
          <button key={t.k} type="button" onClick={() => setTab(t.k)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium ${tab === t.k ? "border-[#053877] bg-[#053877] text-white" : "border-border bg-card hover:border-[#053877]/40"}`} data-testid={`social-tab-${t.k}`}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "clips" ? (
        clipList.length ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
            {clipList.map((c) => {
              const shapes = ([["vertical", c.verticalUrl], ["square", c.squareUrl], ["wide", c.url]] as const).filter(([, u]) => u).map(([s]) => s);
              const sent = (posts.data ?? []).filter((p) => p.kind === "clip" && p.refId === c.id).length;
              return (
                <div key={c.id} className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                  <div className="relative aspect-[9/16] bg-black">
                    <video src={`${c.verticalUrl || c.url}#t=1`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                    {sent > 0 && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white"><Check className="h-3 w-3" /> Posted{sent > 1 ? ` ×${sent}` : ""}</span>}
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-3">
                    <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{c.title}</p>
                    <Button size="sm" onClick={() => setTarget({ kind: "clip", id: c.id, title: c.title, caption: c.caption, shapes: [...shapes] })} className="mt-auto gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid={`social-post-clip-${c.id}`}>
                      <Send className="h-3.5 w-3.5" /> Post it
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty text="No clips yet. Pōstify makes them from any episode in your Library." href="/host/dashboard/postify" cta="Open Pōstify" />
        )
      ) : episodes.length ? (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          {episodes.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3">
              <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-[#050d26]">
                <video src={`/api/host/recordings/${r.id}/video#t=8`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
              </div>
              <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{r.title || "Your session"}</p>
              <Button size="sm" variant="outline" onClick={() => setTarget({ kind: "recording", id: r.id, title: r.title })} className="gap-1.5 rounded-full" data-testid={`social-post-rec-${r.id}`}>
                <Send className="h-3.5 w-3.5" /> Post it
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty text="Nothing in your Library yet. Upload an episode there, or record one in the studio." href="/host/dashboard/library" cta="Open your Library" />
      )}

      {/* History */}
      {done.length > 0 && (
        <div className="mt-8">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground"><Send className="h-4 w-4 text-[#053877]" /> Posted</p>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
            {done.map((p) => <PostRow key={p.id} p={p} title={titleOf(p)} line={p.status === "failed" ? `Didn't go out: ${p.error || "try again"}` : `Sent ${when(p.scheduledAt || p.createdAt)}`} />)}
          </ul>
        </div>
      )}

      <PostDialog target={target} onClose={() => setTarget(null)} />
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
