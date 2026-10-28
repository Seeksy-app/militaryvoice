import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clapperboard, Film, Globe, Headphones, Send } from "lucide-react";
import type { ClipRow, HostPostRow, RecordingRow } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// The Dashboard's "Your files" (28 Oct, after Clay's home): what they've made,
// as quiet rows under a few tabs — their shows and SmartLink, their episodes,
// their Pōstify clips and their posts. A tab shows only once there's
// something in it; each row opens the screen it lives on.

type Screen = "podcast" | "page" | "recordings" | "postify" | "social";
type HostingShow = { show: { id: number; title: string; artworkUrl: string }; episodes: { live?: boolean }[]; stats?: { total: number } };
type Tab = "shows" | "episodes" | "clips" | "posts";

const get = <T,>(url: string) => async () => (await apiRequest("GET", url)).json() as Promise<T>;
const date = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric" }) : "");
const length = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : s > 0 ? `${Math.max(1, Math.round(s / 60))} min` : "");
const NETWORK: Record<string, string> = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", linkedin: "LinkedIn", x: "X", threads: "Threads", bluesky: "Bluesky", pinterest: "Pinterest", reddit: "Reddit" };

type Row = { key: string; icon: React.ReactNode; name: string; detail: string; when: string; action: string; go: () => void };

export function HomeFiles({ goTo, handle }: { goTo: (s: Screen) => void; handle: string }) {
  const { toast } = useToast();
  const hosting = useQuery<{ shows: HostingShow[] }>({ queryKey: ["/api/host/hosting"], queryFn: get("/api/host/hosting"), staleTime: 60_000 });
  const recs = useQuery<RecordingRow[]>({ queryKey: ["/api/host/recordings"], queryFn: get("/api/host/recordings") });
  const clips = useQuery<ClipRow[]>({ queryKey: ["/api/host/clips"], queryFn: get("/api/host/clips") });
  const posts = useQuery<HostPostRow[]>({ queryKey: ["/api/host/posts"], queryFn: get("/api/host/posts") });

  const icon = (I: typeof Film) => <I className="h-4 w-4 shrink-0 text-muted-foreground" />;
  const shows: Row[] = [
    ...(hosting.data?.shows ?? []).map(({ show, episodes, stats }) => ({
      key: `show-${show.id}`,
      icon: show.artworkUrl ? <img src={show.artworkUrl} alt="" className="h-6 w-6 shrink-0 rounded object-cover" /> : icon(Headphones),
      name: show.title || "Your show",
      detail: `${(stats?.total ?? 0).toLocaleString()} downloads`,
      when: `${episodes.filter((e) => e.live !== false).length} episodes`,
      action: "Open",
      go: () => goTo("podcast"),
    })),
    ...((hosting.data?.shows.length ?? 0) === 0 && hosting.isSuccess
      ? [{ key: "show-new", icon: icon(Headphones), name: "Your podcast", detail: "Host it free, or bring it over", when: "", action: "Start", go: () => goTo("podcast") }]
      : []),
    handle
      ? { key: "smartlink", icon: icon(Globe), name: `SmartLink · militaryvoices.ai/${handle}`, detail: "One link for every bio", when: "", action: "Copy", go: () => void navigator.clipboard.writeText(`https://www.militaryvoices.ai/${handle}`).then(() => toast({ title: "Link copied" })) }
      : { key: "smartlink", icon: icon(Globe), name: "SmartLink", detail: "One link for every bio", when: "", action: "Make it", go: () => goTo("page") },
  ];
  const episodes: Row[] = [...(recs.data ?? [])]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .map((r) => ({ key: `rec-${r.id}`, icon: icon(Film), name: r.title || "Untitled recording", detail: length(r.durationSec), when: date(r.startedAt), action: "Open", go: () => goTo("recordings") }));
  const clipRows: Row[] = [...(clips.data ?? [])]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((c) => ({ key: `clip-${c.id}`, icon: icon(Clapperboard), name: c.title || "Clip", detail: c.subtitle || length(c.endSec - c.startSec), when: date(c.createdAt), action: "Open", go: () => goTo("postify") }));
  const postRows: Row[] = [...(posts.data ?? [])]
    .sort((a, b) => Date.parse(b.scheduledAt || b.createdAt) - Date.parse(a.scheduledAt || a.createdAt))
    .map((p) => ({
      key: `post-${p.id}`,
      icon: icon(Send),
      name: p.title || "Post",
      detail: p.platforms.split(",").map((x) => NETWORK[x.trim()] ?? x.trim()).filter(Boolean).join(", "),
      when: p.status === "scheduled" ? `Scheduled ${date(p.scheduledAt)}` : p.status === "failed" ? "Didn't go out" : date(p.scheduledAt || p.createdAt),
      action: "Open",
      go: () => goTo("social"),
    }));

  const tabs: { key: Tab; label: string; rows: Row[]; all?: Screen }[] = [
    { key: "shows" as const, label: "Shows", rows: shows },
    { key: "episodes" as const, label: "Episodes", rows: episodes, all: "recordings" as const },
    { key: "clips" as const, label: "Clips", rows: clipRows, all: "postify" as const },
    { key: "posts" as const, label: "Posts", rows: postRows, all: "social" as const },
  ].filter((t) => t.key === "shows" || t.rows.length > 0);
  const [tab, setTab] = useState<Tab>("shows");
  const cur = tabs.find((t) => t.key === tab) ?? tabs[0];
  const rows = cur.rows.slice(0, 6);

  return (
    <section className="mt-8" data-testid="dashboard-files">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Your files</h2>
        <div className="inline-flex rounded-xl border border-border bg-card p-1" role="tablist">
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={t.key === cur.key} onClick={() => setTab(t.key)} className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${t.key === cur.key ? "bg-[#053877]/[0.08] font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`} data-testid={`files-tab-${t.key}`}>
              {t.label}{t.key !== "shows" && <span className="ml-1 text-xs text-muted-foreground">{t.rows.length}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="hidden grid-cols-[minmax(0,1fr)_200px_140px_72px] gap-4 border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground sm:grid">
          <span>Name</span><span>Details</span><span>{cur.key === "shows" ? "Episodes" : "Date"}</span><span />
        </div>
        {rows.map((r) => (
          <button key={r.key} type="button" onClick={r.go} className="grid w-full grid-cols-[minmax(0,1fr)_72px] items-center gap-4 border-b border-border px-4 py-3 text-left text-sm last:border-b-0 hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_200px_140px_72px]" data-testid={`files-row-${r.key}`}>
            <span className="flex min-w-0 items-center gap-3">{r.icon}<span className="min-w-0"><span className="block truncate font-medium text-foreground">{r.name}</span><span className="block truncate text-xs text-muted-foreground sm:hidden">{[r.detail, r.when].filter(Boolean).join(" · ")}</span></span></span>
            <span className="hidden truncate text-muted-foreground sm:block">{r.detail}</span>
            <span className="hidden truncate text-muted-foreground sm:block">{r.when}</span>
            <span className="text-right text-sm font-semibold text-[#053877] dark:text-[#8ab4f8]">{r.action}</span>
          </button>
        ))}
        {cur.all && cur.rows.length > rows.length && (
          <button type="button" onClick={() => goTo(cur.all!)} className="w-full px-4 py-2.5 text-left text-sm font-medium text-[#053877] hover:bg-muted/50 dark:text-[#8ab4f8]">See all {cur.rows.length}</button>
        )}
      </div>
    </section>
  );
}
