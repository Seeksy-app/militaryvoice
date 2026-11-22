import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UploadRecording } from "@/components/UploadRecording";
import { MyRecordings } from "@/components/MyRecordings";
import { ClipsLibrary } from "@/components/ClipsLibrary";
import { PodcastEpisodeGrid, usePodcastEpisodes } from "@/components/PodcastEpisodes";
import { FolderBar, LibraryFoldersProvider, TUTORIALS, useLibraryFolders } from "@/components/LibraryFolders";
import { isHowTo } from "@/lib/howTo";
import { apiRequest } from "@/lib/queryClient";
import type { PublicEvent, RecordingRow, ClipRow, HostPostRow, CleanResult } from "@shared/schema";
import { Clock3, Film, Library, Scissors, Send, Timer } from "lucide-react";

// Every session this podcaster has recorded, with a filter by event. Sessions
// belong to an event, so once somebody has been in two the list needs saying
// which is which — but with one event the filter shouldn't be a wall.

interface EventEntry {
  event: PublicEvent;
  slotIndex: number | null;
}

export function RecordingsScreen({ socialAccounts }: { socialAccounts?: string | null }) {
  // One set of folders for the whole Library: its bar sits above the tabs.
  return <LibraryFoldersProvider><Library_ socialAccounts={socialAccounts} /></LibraryFoldersProvider>;
}

function Library_({ socialAccounts }: { socialAccounts?: string | null }) {
  const [eventId, setEventId] = useState<number | null>(null);
  // Episodes, Podcast episodes or Clips; a link can open the clips (?tab=clips&ep=48).
  const q = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const [tab, setTab] = useState<"episodes" | "podcast" | "clips">(q.get("tab") === "clips" ? "clips" : "episodes");
  const [clipEp, setClipEp] = useState<number | null>(Number(q.get("ep")) || null);
  const lib = useLibraryFolders();
  const open = lib?.open ?? null;
  const showClips = (ep: number | null) => { lib?.setOpen(null); setClipEp(ep); setTab("clips"); window.scrollTo({ top: 0, behavior: "smooth" }); };

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

  // The Library at a glance. Everything counted is ours to count: podcast
  // downloads live with each show's own host, which we aren't connected to.
  // Their podcast's episodes count too (a video one is already a recording once opened).
  const { data: podEps } = usePodcastEpisodes();
  const published = (podEps ?? []).filter((e) => e.status === "published");
  const podOnly = published.filter((e) => !e.recordingId).length;
  // Our tutorials sit in their own Tutorials folder and aren't counted as their episodes.
  const tutorials = (recordings ?? []).filter((r) => isHowTo(r.title));
  const originals = (recordings ?? []).filter((r) => r.status === "Ready" && !r.egressId.startsWith("CLEAN_") && !isHowTo(r.title));
  // What each folder holds: episodes (their clean and edited copies go with them), podcast episodes and clips.
  const mains = (recordings ?? []).filter((r) => !r.egressId.startsWith("CLEAN_") && !isHowTo(r.title));
  const folderCounts = new Map<number, number>();
  for (const x of [...mains, ...published, ...(clips ?? [])]) if (x.folderId) folderCounts.set(x.folderId, (folderCounts.get(x.folderId) ?? 0) + 1);
  // Podcast episodes get a tab of their own once there are recordings too (with none, they are the Episodes tab).
  const podTab = published.length > 0 && (recordings?.length ?? 0) > 0;
  const hours = originals.reduce((n, r) => n + r.durationSec, 0) / 3600;
  const saved = (recordings ?? []).reduce((n, r) => {
    try { return n + (r.clean ? ((JSON.parse(r.clean) as CleanResult).removedSec ?? 0) : 0); } catch { return n; }
  }, 0);
  // What they record or upload is a Recording (Andrew, 22 Nov: "instead of Episodes, we name recorded videos something else");
  // "Podcast episodes" are their show's. An audio-only show with no recordings yet: that tab is its podcast episodes.
  const audioOnly = originals.length === 0 && podOnly > 0;
  const mainLabel = audioOnly ? "Podcast episodes" : "Recordings";
  // The counts that lead somewhere are buttons: recordings, clips, and the posts on the Social calendar.
  const stats: { icon: typeof Film; n: string; label: string; go?: () => void }[] = [
    { icon: Film, n: String(audioOnly ? podOnly : originals.length), label: audioOnly ? (podOnly === 1 ? "Podcast episode" : "Podcast episodes") : originals.length === 1 ? "Recording" : "Recordings", go: () => { lib?.setOpen(null); setTab("episodes"); } },
    { icon: Clock3, n: hours >= 1 ? hours.toFixed(1) : `${Math.round(hours * 60)}m`, label: hours >= 1 ? "Hours recorded" : "Recorded" },
    { icon: Scissors, n: String(clips?.length ?? 0), label: "Clips made", go: () => showClips(null) },
    { icon: Send, n: String(posts?.filter((p) => p.status !== "failed").length ?? 0), label: "Posts sent", go: () => { window.location.href = "/host/dashboard/social"; } },
    { icon: Timer, n: saved >= 60 ? `${Math.floor(saved / 60)}:${String(Math.round(saved % 60)).padStart(2, "0")}` : `${Math.round(saved)}s`, label: "Time saved" },
  ];

  const clipCounts = new Map<number, number>();
  for (const c of clips ?? []) clipCounts.set(c.recordingId, (clipCounts.get(c.recordingId) ?? 0) + 1);

  // Only offer events that actually have something to show, plus whichever is
  // currently selected, so the filter never lists dead ends.
  const counts = new Map<number, number>();
  for (const r of recordings ?? []) counts.set(r.eventId, (counts.get(r.eventId) ?? 0) + 1);
  const options = (entries ?? []).filter((e) => counts.has(e.event.id));

  return (
    <section className="mt-6">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
        <Library className="h-4 w-4" /> Library
      </h2>
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
        Your recordings: every session the studio recorded, every video you've uploaded, and the clean episodes Pōstify makes.
        {/* The Zoom question, answered in the one line that has room for it. */}
        {" "}Record on Zoom?{" "}
        <a href="/host/dashboard/integrations#section-content" className="font-medium text-[#053877] underline-offset-2 hover:underline dark:text-[#8fb5e8]" data-testid="zoom-hint">Connect Zoom</a> and your recordings come in by themselves.
      </p>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <div className="col-span-2 sm:col-span-3 lg:col-span-2">
          <UploadRecording autoOpen />
        </div>
        {/* On a phone the counts are one swipeable row, so the recordings start on the first screen (8 Oct). */}
        <div className="col-span-2 -mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] sm:contents [&::-webkit-scrollbar]:hidden">
        {stats.map((s) => {
          const inner = (
            <>
              <s.icon className="h-4 w-4 text-[#b36b00] dark:text-[#F0A71F]" />
              <p className="mt-1 text-xl font-bold tabular-nums text-foreground sm:mt-1.5 sm:text-2xl">{s.n}</p>
              <p className="text-xs text-muted-foreground">{s.label}{s.go && <span aria-hidden> →</span>}</p>
            </>
          );
          return s.go ? (
            <button key={s.label} type="button" onClick={s.go} className="flex min-w-[7.25rem] shrink-0 flex-col justify-center rounded-2xl border border-border bg-card px-3.5 py-2.5 text-left transition-colors hover:border-[#053877]/40 sm:min-w-0 sm:px-4 sm:py-3 hover:bg-[#053877]/[0.03]" data-testid={`library-stat-${s.label}`}>{inner}</button>
          ) : (
            <div key={s.label} className="flex min-w-[7.25rem] shrink-0 flex-col justify-center rounded-2xl border border-border bg-card px-3.5 py-2.5 sm:min-w-0 sm:px-4 sm:py-3" data-testid={`library-stat-${s.label}`}>{inner}</div>
          );
        })}
        </div>
      </div>

      {/* The folders, for everything below: drag any card onto one, or open one to see all it holds. */}
      <FolderBar counts={folderCounts} tutorials={tutorials.length} />

      {open === TUTORIALS ? (
        <MyRecordings tutorials />
      ) : open != null ? (
        <FolderContents folder={open} socialAccounts={socialAccounts} clipCounts={clipCounts} onShowClips={showClips} recordings={recordings ?? []} clips={clips ?? []} posts={posts ?? []} counts={{ recs: mains.filter((r) => r.folderId === open).length, pods: published.filter((e) => e.folderId === open).length }} />
      ) : (<>
      {/* Views of one Library: the recordings, the podcast's episodes, and every clip made from them. */}
      <div className="mb-4 inline-flex rounded-full border border-border bg-card p-1" role="tablist">
        {([["episodes", mainLabel, podTab ? originals.length : originals.length + podOnly], ...(podTab ? [["podcast", "Podcast episodes", published.length] as const] : []), ["clips", "Clips", clips?.length ?? 0]] as const).map(([k, label, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => (k === "clips" ? showClips(clipEp) : setTab(k))} className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${tab === k ? "bg-[#053877] text-white" : "text-muted-foreground hover:text-foreground"}`} data-testid={`library-tab-${k}`}>
            {label} <span className={tab === k ? "text-white/70" : ""}>{n}</span>
          </button>
        ))}
      </div>

      {tab === "clips" ? (
        <ClipsLibrary clips={clips ?? []} posts={posts ?? []} recordings={recordings ?? []} episode={clipEp} onEpisode={setClipEp} />
      ) : tab === "podcast" && podTab ? (
        <PodcastEpisodeGrid testid="library-podcast" min={240} fileable onPick={(rec) => { window.location.href = `/host/dashboard/postify?rec=${rec.id}`; }} />
      ) : (<>
      {options.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {[{ id: null as number | null, label: "All events", n: recordings?.length ?? 0 }, ...options.map((e) => ({
            id: e.event.id as number | null,
            label: e.event.name,
            n: counts.get(e.event.id) ?? 0,
          }))].map((o) => {
            const on = eventId === o.id;
            return (
              <button
                key={String(o.id)}
                type="button"
                aria-pressed={on}
                onClick={() => setEventId(o.id)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  on ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-[#053877]/[0.04]"
                }`}
                data-testid={`filter-recordings-${o.id ?? "all"}`}
              >
                {o.label} <span className="text-muted-foreground">({o.n})</span>
              </button>
            );
          })}
        </div>
      )}

      <MyRecordings socialAccounts={socialAccounts} eventId={eventId} showEmpty clipCounts={clipCounts} onShowClips={showClips} />
      </>)}
      </>)}

      {/* Clips and clean episodes live in Pōstify; this page is the recordings. Not in Tutorials: no Pōstify there. */}
      {open !== TUTORIALS && (
        <p className="mt-6 text-sm text-muted-foreground">
          Clips and clean episodes are made in{" "}
          <a href="/host/dashboard/postify" className="font-semibold text-[#053877] hover:underline dark:text-[#8fb5e8]">Pōstify →</a>
        </p>
      )}
    </section>
  );
}

/** An open folder: everything filed in it, recordings first, then podcast episodes, then clips. */
function FolderContents({ folder, socialAccounts, clipCounts, onShowClips, recordings, clips, posts, counts }: {
  folder: number;
  socialAccounts?: string | null;
  clipCounts: Map<number, number>;
  onShowClips: (ep: number | null) => void;
  recordings: RecordingRow[];
  clips: ClipRow[];
  posts: HostPostRow[];
  counts: { recs: number; pods: number };
}) {
  const filedClips = clips.filter((c) => c.folderId === folder);
  if (!counts.recs && !counts.pods && !filedClips.length) {
    return (
      <p className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground" data-testid="folder-empty">
        Nothing in this folder yet. Drag a recording or a clip onto it, or use its ⋯ menu → Move to folder.
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
          <PodcastEpisodeGrid testid="folder-podcast" min={240} fileable only={(e) => e.folderId === folder} onPick={(rec) => { window.location.href = `/host/dashboard/postify?rec=${rec.id}`; }} />
        </div>
      )}
      {filedClips.length > 0 && (
        <div>
          <Head>{`Clips (${filedClips.length})`}</Head>
          <ClipsLibrary clips={filedClips} posts={posts} recordings={recordings} episode={null} onEpisode={() => {}} bare />
        </div>
      )}
    </div>
  );
}
