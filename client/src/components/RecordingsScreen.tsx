import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UploadRecording } from "@/components/UploadRecording";
import { MyRecordings } from "@/components/MyRecordings";
import { PodcastEpisodeGrid, usePodcastEpisodes } from "@/components/PodcastEpisodes";
import { DRAG, FolderBar, LibraryFoldersProvider, TUTORIALS, useLibraryFolders } from "@/components/LibraryFolders";
import { isHowTo } from "@/lib/howTo";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PublicEvent, RecordingRow, ClipRow, HostPostRow, CleanResult } from "@shared/schema";
import { ArrowRight, Check, Loader2, Play, Podcast, Scissors, Sparkles, Upload, Wand2 } from "lucide-react";

// The Library is your media (Andrew, 26 Nov: "the library shouldn't have clips in there… The library is more like your
// media"): what they record in Studio and Rooms, uploads, Zoom calls, and their podcast's episodes. Clips moved to
// Pōstify → Clips. One row of controls, 4 across, and the episodes Pōstify finished get a proud card at the top.

const HEAD = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

interface EventEntry {
  event: PublicEvent;
  slotIndex: number | null;
}

export function RecordingsScreen({ socialAccounts }: { socialAccounts?: string | null }) {
  // One set of folders for the whole Library.
  return <LibraryFoldersProvider><Library_ socialAccounts={socialAccounts} /></LibraryFoldersProvider>;
}

const clipsHref = (ep?: number | null) => `/host/dashboard/clips${ep ? `?ep=${ep}` : ""}`;
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
const cutText = (sec: number) => (sec >= 60 ? mmss(sec) : `${Math.round(sec)}s`);
const cleanOf = (r: RecordingRow | undefined): CleanResult | null => { try { return r?.clean ? (JSON.parse(r.clean) as CleanResult) : null; } catch { return null; } };
/** The episode a clean or edited copy was made from (CLEAN_12, CLEAN_EDIT_12_…). */
const sourceOf = (r: RecordingRow) => { const m = r.egressId.match(/^CLEAN_(EDIT_)?(\d+)/); return m ? Number(m[2]) : null; };
const plainTitle = (t: string) => t.replace(/ \((clean|edited)\)$/i, "");

function Library_({ socialAccounts }: { socialAccounts?: string | null }) {
  const [eventId, setEventId] = useState<number | null>(null);
  const [tab, setTab] = useState<"episodes" | "podcast">("episodes");
  // A video dropped anywhere on the page uploads (the button replaced the wide drop bar, Andrew via PM, 26 Nov).
  const [dropped, setDropped] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [unfileOver, setUnfileOver] = useState(false);
  const lib = useLibraryFolders();
  const open = lib?.open ?? null;
  const showClips = (ep: number | null) => { window.location.href = clipsHref(ep); };

  const { data: entries } = useQuery<EventEntry[]>({
    queryKey: ["/api/host/events"],
    queryFn: async () => (await apiRequest("GET", "/api/host/events")).json(),
  });
  const { data: recordings } = useQuery<RecordingRow[]>({
    queryKey: ["/api/host/recordings"],
    queryFn: async () => (await apiRequest("GET", "/api/host/recordings")).json(),
  });
  const { data: clips } = useQuery<ClipRow[]>({
    queryKey: ["/api/host/clips"],
    queryFn: async () => (await apiRequest("GET", "/api/host/clips")).json(),
  });
  const { data: posts } = useQuery<HostPostRow[]>({
    queryKey: ["/api/host/posts"],
    queryFn: async () => (await apiRequest("GET", "/api/host/posts")).json(),
  });

  const { data: podEps } = usePodcastEpisodes();
  const published = (podEps ?? []).filter((e) => e.status === "published");
  const podOnly = published.filter((e) => !e.recordingId).length;
  // Our tutorials sit in their own Tutorials folder and aren't counted as their recordings.
  const tutorials = (recordings ?? []).filter((r) => isHowTo(r.title));
  const originals = (recordings ?? []).filter((r) => r.status === "Ready" && !r.egressId.startsWith("CLEAN_") && !isHowTo(r.title));
  // What each folder holds: recordings (their clean and edited copies go with them) and podcast episodes.
  const mains = (recordings ?? []).filter((r) => !r.egressId.startsWith("CLEAN_") && !isHowTo(r.title));
  const folderCounts = new Map<number, number>();
  for (const x of [...mains, ...published]) if (x.folderId) folderCounts.set(x.folderId, (folderCounts.get(x.folderId) ?? 0) + 1);
  // Library (no folder open) holds only what isn't filed, like Drive (Andrew, 24 Nov).
  const loose = <T extends { folderId: number }>(x: T) => !x.folderId;
  const hereOriginals = originals.filter(loose);
  const herePublished = published.filter(loose);
  const herePodOnly = herePublished.filter((e) => !e.recordingId).length;
  const podTab = published.length > 0 && (recordings?.length ?? 0) > 0;
  const audioOnly = originals.length === 0 && podOnly > 0;
  const mainLabel = audioOnly ? "Podcast episodes" : "Recordings";

  const clipCounts = new Map<number, number>();
  for (const c of clips ?? []) clipCounts.set(c.recordingId, (clipCounts.get(c.recordingId) ?? 0) + 1);

  // Only offer events that actually have something to show.
  const counts = new Map<number, number>();
  for (const r of recordings ?? []) counts.set(r.eventId, (counts.get(r.eventId) ?? 0) + 1);
  const options = (entries ?? []).filter((e) => counts.has(e.event.id));

  const isFile = (e: React.DragEvent) => e.dataTransfer.types.includes("Files") && !e.dataTransfer.types.includes(DRAG);
  const unfile = (e: React.DragEvent) => {
    setUnfileOver(false);
    try { const item = JSON.parse(e.dataTransfer.getData(DRAG)); if (item?.kind && item.id) { e.preventDefault(); void lib?.file(item, 0); } } catch { /* not one of ours */ }
  };

  return (
    <section
      className="relative mt-4"
      onDragOver={(e) => { if (isFile(e)) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={(e) => { if (!isFile(e)) return; e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) setDropped(f); }}
      data-testid="library"
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center rounded-3xl border-2 border-dashed border-[#053877] bg-[#053877]/[0.06] pt-40 backdrop-blur-[1px]">
          <span className="inline-flex items-center gap-2 rounded-full bg-[#053877] px-5 py-3 text-[15px] font-semibold text-white shadow-lg"><Upload className="h-5 w-5" /> Drop it to add it to your Library</span>
        </div>
      )}

      {/* The title, one line, and the one way in for new media. */}
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold tracking-tight" style={HEAD}>Library</h1>
          <p className="hidden text-[14px] text-muted-foreground text-balance sm:block">
            Your media: what you record in Studio and Rooms, your uploads and{" "}
            <a href="/host/dashboard/integrations#section-content" className="font-medium text-[#053877] underline-offset-2 hover:underline dark:text-[#8fb5e8]" data-testid="zoom-hint">Zoom&nbsp;calls</a>.
          </p>
        </div>
        <UploadRecording button autoOpen initialFile={dropped} />
      </div>

      {open == null && <Finished recordings={recordings ?? []} clips={clips ?? []} posts={posts ?? []} clipCounts={clipCounts} />}

      {/* The one row: what to show, then the folders (and the event, when there's more than one). On a phone it scrolls sideways. */}
      <div className="-mx-4 mb-4 mt-5 flex items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" data-testid="library-row">
        <div
          className={`inline-flex shrink-0 rounded-full border bg-card p-1 ${unfileOver ? "border-[#F0A71F] bg-[#F0A71F]/10" : "border-border"}`}
          role="tablist"
          onDragOver={(e) => { if (open != null && e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); setUnfileOver(true); } }}
          onDragLeave={() => setUnfileOver(false)}
          onDrop={unfile}
        >
          {([["episodes", mainLabel, podTab ? hereOriginals.length : hereOriginals.length + herePodOnly], ...(podTab ? [["podcast", "Podcast episodes", herePublished.length] as const] : [])] as const).map(([k, label, n]) => {
            const on = open == null && tab === k;
            return (
              <button key={k} type="button" role="tab" aria-selected={on} onClick={() => { lib?.setOpen(null); setTab(k); }} className={`whitespace-nowrap rounded-full px-3.5 py-1 text-[13px] font-semibold transition-colors ${on ? "bg-[#053877] text-white" : "text-muted-foreground hover:text-foreground"}`} data-testid={`library-tab-${k}`}>
                {label} <span className={on ? "text-white/70" : ""}>{n}</span>
              </button>
            );
          })}
        </div>
        <span className="mx-1 hidden h-6 w-px shrink-0 bg-border sm:block" />
        <FolderBar inline counts={folderCounts} tutorials={tutorials.length} />
        {open == null && tab === "episodes" && options.length > 1 && (
          <select value={eventId ?? ""} onChange={(e) => setEventId(e.target.value ? Number(e.target.value) : null)} className="h-8 shrink-0 rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground/80 sm:ml-auto" aria-label="Which event" data-testid="filter-recordings">
            <option value="">All events ({recordings?.length ?? 0})</option>
            {options.map((o) => <option key={o.event.id} value={o.event.id}>{o.event.name} ({counts.get(o.event.id) ?? 0})</option>)}
          </select>
        )}
      </div>

      {open === TUTORIALS ? (
        <MyRecordings tutorials />
      ) : open != null ? (
        <FolderContents folder={open} socialAccounts={socialAccounts} clipCounts={clipCounts} onShowClips={showClips} counts={{ recs: mains.filter((r) => r.folderId === open).length, pods: published.filter((e) => e.folderId === open).length }} />
      ) : tab === "podcast" && podTab ? (
        <PodcastEpisodeGrid testid="library-podcast" min={200} fileable only={(e) => !e.folderId} onPick={(rec) => { window.location.href = `/host/dashboard/postify?rec=${rec.id}`; }} />
      ) : (
        <MyRecordings socialAccounts={socialAccounts} eventId={eventId} folder={0} showEmpty clipCounts={clipCounts} onShowClips={showClips} />
      )}

      {open !== TUTORIALS && (clips?.length ?? 0) > 0 && (
        <p className="mt-6 text-center text-[13px] text-muted-foreground">
          Your clips have moved:{" "}
          <a href={clipsHref()} className="font-semibold text-[#053877] hover:underline dark:text-[#8fb5e8]" data-testid="library-clips-moved">Pōstify → Clips</a>
        </p>
      )}
    </section>
  );
}

/**
 * The proud moment (Andrew, 26 Nov: "celebrate more about the post-edit of their podcasts"): the newest episode Pōstify
 * finished, big, with what it did and what to do next, and one line of totals instead of a row of pills. Before
 * anything's finished it's one line asking them to finish their latest recording.
 */
function Finished({ recordings, clips, posts, clipCounts }: { recordings: RecordingRow[]; clips: ClipRow[]; posts: HostPostRow[]; clipCounts: Map<number, number> }) {
  const { toast } = useToast();
  const [playing, setPlaying] = useState(false);
  const [making, setMaking] = useState(false);
  const showsQ = useQuery<{ shows: { show: { id: number; title: string }; episodes?: { id: number; recordingId: number | null }[] }[] }>({ queryKey: ["/api/host/hosting"], queryFn: async () => (await apiRequest("GET", "/api/host/hosting")).json(), staleTime: 60_000 });
  const byId = new Map(recordings.map((r) => [r.id, r]));
  // Finished = a Ready clean or edited copy of one of their own recordings; the newest copy per recording, edits first.
  const best = new Map<number, RecordingRow>();
  for (const c of recordings) {
    const src = sourceOf(c);
    if (src == null || c.status !== "Ready" || isHowTo(c.title) || !byId.has(src)) continue;
    const cur = best.get(src);
    const edit = c.egressId.startsWith("CLEAN_EDIT_");
    if (!cur || (edit && !cur.egressId.startsWith("CLEAN_EDIT_")) || (edit === cur.egressId.startsWith("CLEAN_EDIT_") && c.id > cur.id)) best.set(src, c);
  }
  const done = Array.from(best.entries()).map(([src, copy]) => ({ src: byId.get(src)!, copy })).sort((a, b) => b.copy.id - a.copy.id);
  const originals = recordings.filter((r) => r.status === "Ready" && !r.egressId.startsWith("CLEAN_") && !isHowTo(r.title));

  if (!done.length) {
    if (!originals.length) return null;
    const latest = [...originals].sort((a, b) => b.id - a.id)[0];
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-[#F0A71F]/40 bg-gradient-to-r from-[#FFF8E8] via-card to-card p-4 sm:flex-row sm:items-center dark:from-[#F0A71F]/10" data-testid="library-finish-invite">
        <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#F0A71F] text-[#1a1200] sm:flex"><Wand2 className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold text-balance" style={HEAD}>Turn your latest recording into a finished&nbsp;episode</p>
          <p className="text-[13px] text-muted-foreground text-balance">Pōstify cuts the dead air and ums, levels your audio and makes the clips. It all comes back&nbsp;here.</p>
        </div>
        <a href={`/host/dashboard/postify?rec=${latest.id}`} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-[#053877] px-5 py-2.5 text-[14px] font-semibold text-white hover:bg-[#0a4aa0]" data-testid="library-finish-go">Open Pōstify <ArrowRight className="h-4 w-4" /></a>
      </div>
    );
  }

  const top = done[0];
  const cut = cleanOf(top.src)?.removedSec ?? 0;
  const totalCut = done.reduce((n, d) => n + (cleanOf(d.src)?.removedSec ?? 0), 0);
  const topClips = clipCounts.get(top.src.id) ?? 0;
  const sent = posts.filter((p) => p.status !== "failed").length;
  const when = new Date(top.copy.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const title = plainTitle(top.src.title) || "Your episode";
  // Already in their podcast: open it there; otherwise make it an episode of their first show (a draft to finish there).
  const shows = showsQ.data?.shows ?? [];
  const inShow = shows.flatMap((x) => x.episodes ?? []).find((e) => e.recordingId != null && (e.recordingId === top.copy.id || e.recordingId === top.src.id));
  async function toPodcast() {
    if (inShow) { window.location.href = `/host/dashboard/podcast?ep=${inShow.id}`; return; }
    if (!shows[0]) { window.location.href = "/host/dashboard/podcast"; return; }
    setMaking(true);
    try {
      const e = (await (await apiRequest("POST", `/api/host/hosting/shows/${shows[0].show.id}/episodes`, { recordingId: top.copy.id })).json()) as { id: number };
      window.location.href = `/host/dashboard/podcast?ep=${e.id}`;
    } catch (err) {
      toast({ title: "Couldn't make the episode", description: (err as Error).message.replace(/^\d+:\s*/, ""), variant: "destructive" });
      setMaking(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#053877] via-[#0a4aa0] to-[#0e7490] text-white shadow-[0_10px_30px_rgba(5,56,119,0.25)]" data-testid="library-finished">
      <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-3 p-3 sm:grid-cols-[minmax(0,300px)_1fr] sm:items-center sm:gap-x-5 sm:p-4">
        <div className="relative aspect-video overflow-hidden rounded-xl bg-black/30 ring-1 ring-white/15 sm:row-span-2">
          {playing ? (
            <video src={`/api/host/recordings/${top.copy.id}/video`} controls autoPlay playsInline className="h-full w-full bg-black object-contain" />
          ) : (
            <button type="button" onClick={() => setPlaying(true)} className="absolute inset-0" aria-label={`Watch ${title}`}>
              <video src={`/api/host/recordings/${top.copy.id}/video#t=8`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
              <span className="absolute inset-0 flex items-center justify-center"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-[#053877] shadow-lg sm:h-12 sm:w-12"><Play className="h-4 w-4 fill-current sm:h-5 sm:w-5" /></span></span>
              {top.copy.durationSec > 0 && <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">{mmss(top.copy.durationSec)}</span>}
            </button>
          )}
        </div>
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#F0A71F]"><Sparkles className="h-3.5 w-3.5" /> Finished<span className="hidden sm:inline">&nbsp;in Pōstify</span> · {when}</p>
          <p className="mt-1 line-clamp-2 text-[16px] font-semibold leading-tight text-balance sm:text-[20px]" style={HEAD}>{title} is cleaned up and ready for your&nbsp;listeners</p>
          <p className="mt-1 hidden text-[13px] text-white/75 text-balance sm:block">
            {cut > 0 ? `Pōstify cut ${cutText(cut)} of dead air and ums and levelled the audio.` : "Pōstify cleaned it up and levelled the audio."}
            {topClips > 0 ? ` ${topClips} ${topClips === 1 ? "clip" : "clips"} came out of it.` : ""}
          </p>
        </div>
        <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-1 sm:col-start-2">
          <button type="button" onClick={() => void toPodcast()} disabled={making} className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[#F0A71F] px-4 py-2 text-[13px] font-semibold text-[#1a1200] hover:bg-[#f5b94a] disabled:opacity-70 sm:flex-none" data-testid="library-finished-podcast">
            {making ? <Loader2 className="h-4 w-4 animate-spin" /> : <Podcast className="h-4 w-4" />} {inShow ? "Open it in your podcast" : "Publish to your podcast"}
          </button>
          <button type="button" onClick={() => setPlaying(true)} className="hidden items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-[13px] font-semibold text-white ring-1 ring-white/25 hover:bg-white/20 sm:inline-flex"><Play className="h-4 w-4" /> Watch it</button>
          {topClips > 0 && <a href={clipsHref(top.src.id)} className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-[13px] font-semibold text-white ring-1 ring-white/25 hover:bg-white/20"><Scissors className="h-4 w-4" /> {topClips} {topClips === 1 ? "clip" : "clips"}</a>}
        </div>
      </div>
      {/* Everything Pōstify has finished, as one line of proud numbers instead of a row of pills. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-white/15 bg-black/15 px-4 py-2.5 text-[13px] text-white/75">
        <span className="inline-flex items-center gap-1.5 font-semibold text-[#7ee2b8]"><Check className="h-4 w-4" /> {done.length} {done.length === 1 ? "episode" : "episodes"} finished</span>
        {totalCut > 0 && <span><b className="text-white">{cutText(totalCut)}</b> of dead air cut</span>}
        <span><b className="text-white">{clips.length}</b> {clips.length === 1 ? "clip" : "clips"} made</span>
        <span><b className="text-white">{sent}</b> {sent === 1 ? "post" : "posts"} sent</span>
      </div>
    </div>
  );
}

/** An open folder: everything filed in it, recordings first, then podcast episodes. */
function FolderContents({ folder, socialAccounts, clipCounts, onShowClips, counts }: {
  folder: number;
  socialAccounts?: string | null;
  clipCounts: Map<number, number>;
  onShowClips: (ep: number | null) => void;
  counts: { recs: number; pods: number };
}) {
  if (!counts.recs && !counts.pods) {
    return (
      <p className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground" data-testid="folder-empty">
        Nothing in this folder yet. Drag a recording onto it, or use its ⋯ menu → Move to folder.
      </p>
    );
  }
  const Head = ({ children }: { children: string }) => <h3 className="mb-3 text-sm font-semibold text-foreground">{children}</h3>;
  return (
    <div className="space-y-8" data-testid="folder-contents">
      {counts.recs > 0 && (
        <div>
          <Head>{`Recordings (${counts.recs})`}</Head>
          <MyRecordings socialAccounts={socialAccounts} folder={folder} clipCounts={clipCounts} onShowClips={onShowClips} />
        </div>
      )}
      {counts.pods > 0 && (
        <div>
          <Head>{`Podcast episodes (${counts.pods})`}</Head>
          <PodcastEpisodeGrid testid="folder-podcast" min={200} fileable only={(e) => e.folderId === folder} onPick={(rec) => { window.location.href = `/host/dashboard/postify?rec=${rec.id}`; }} />
        </div>
      )}
    </div>
  );
}
