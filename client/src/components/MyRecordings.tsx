import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useMoveEpisode } from "@/components/MoveEpisode";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PostDialog } from "@/components/PostDialog";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { DEFAULT_CLIP_OPTIONS, parseClipOptions, type RecordingRow } from "@shared/schema";
import { CalendarClock, Check, Download, Library, Loader2, Mic2, MoreHorizontal, Pencil, Play, Share2, Trash2, Wand2, X, Send } from "lucide-react";
import { PodcastEpisodeGrid, usePodcastEpisodes } from "@/components/PodcastEpisodes";
import { MoveToFolder, dragToFolder, useLibraryFolders } from "@/components/LibraryFolders";
import { seesTwoPeople } from "@/components/LayoutPicker";
import { Art3D } from "@/components/ui/icon-tile";
import { howToArt, howToLabel, isHowTo } from "@/lib/howTo";

// A podcaster's own sessions. The studio writes them; nothing here is uploaded
// by hand. The bucket is private, so every download is a fresh signed link.

function duration(sec: number): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function clock(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function size(bytes: string): string {
  const n = Number(bytes);
  if (!n) return "";
  const mb = n / 1_048_576;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/** Ours to delete: uploads, imports, Pōstify's copies and staged test episodes. Studio sessions belong to the event. */
// Theirs to delete: uploads, imports, Pōstify's copies, staged test episodes, and what they recorded in their Room (no event).
const deletable = (r: RecordingRow) => /^(UPLOAD_|CLEAN_|ZOOM_|LINK_|STAGED_)/.test(r.egressId) || (r.eventId === 0 && r.studioId === 0);

/** The episode a clean or edited copy was made from (CLEAN_12, CLEAN_EDIT_12_…). */
function sourceOf(r: RecordingRow): number | null {
  const m = r.egressId.match(/^CLEAN_(EDIT_)?(\d+)/);
  return m ? Number(m[2]) : null;
}

type Version = { label: string; rec: RecordingRow };
type Episode = { main: RecordingRow; versions: Version[]; earlier: Version[] };

/**
 * One card per episode: the original with its clean and edited copies as
 * versions of it, not cards of their own. A copy whose original is gone
 * keeps a card.
 */
function episodes(rows: RecordingRow[]): Episode[] {
  const ids = new Set(rows.map((r) => r.id));
  const copies = new Map<number, RecordingRow[]>();
  for (const r of rows) {
    const src = sourceOf(r);
    if (src != null && ids.has(src)) copies.set(src, [...(copies.get(src) ?? []), r]);
  }
  return rows
    .filter((r) => { const src = sourceOf(r); return src == null || !ids.has(src); })
    .map((main) => {
      const mine = copies.get(main.id) ?? [];
      const clean = mine.filter((c) => !c.egressId.startsWith("CLEAN_EDIT_"));
      const edited = mine.filter((c) => c.egressId.startsWith("CLEAN_EDIT_")).sort((a, b) => a.id - b.id);
      // Only the latest edit on the card; the ones before it wait under Earlier edits.
      const latest = edited[edited.length - 1];
      const when = (rec: RecordingRow) => new Date(rec.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      return {
        main,
        versions: mine.length === 0 ? [] : [
          ...clean.map((rec) => ({ label: "Clean", rec })),
          ...(latest ? [{ label: "Edited", rec: latest }] : []),
          { label: "Original", rec: main },
        ],
        earlier: edited.slice(0, -1).reverse().map((rec) => ({ label: `Edited ${when(rec)}`, rec })),
      };
    });
}

const plainTitle = (t: string) => t.replace(/ \((clean|edited)\)$/i, "");

export function MyRecordings({
  socialAccounts,
  eventId,
  showEmpty = false,
  clipCounts,
  onShowClips,
  folder = null,
  tutorials = false,
}: {
  /** The Tutorials folder: only our tutorials, watch-only. */
  tutorials?: boolean;
  /** Only what's filed in this Library folder; null for every episode. */
  folder?: number | null;
  socialAccounts?: string | null;
  /** Clips per recording, for the "4 clips →" link on each card. */
  clipCounts?: Map<number, number>;
  onShowClips?: (recordingId: number) => void;
  /** Only this event's sessions. Omit for every event. */
  eventId?: number | null;
  /** Say so when there is nothing, instead of rendering nothing at all. */
  showEmpty?: boolean;
}) {
  const [publishing, setPublishing] = useState<RecordingRow | null>(null);
  const [scheduling, setScheduling] = useState(false);
  // Their podcast shows, so a recording becomes an episode in one step (then its words, on the Podcast screen).
  const showsQ = useQuery<{ shows: { show: { id: number; title: string }; episodes?: { id: number; title: string; recordingId: number | null; live?: boolean }[] }[] }>({ queryKey: ["/api/host/hosting"], queryFn: async () => (await apiRequest("GET", "/api/host/hosting")).json(), staleTime: 60_000 });
  const podShows = showsQ.data?.shows ?? [];
  // Folders are the Library's, one set for episodes, podcast episodes and clips (LibraryFolders.tsx).
  const lib = useLibraryFolders();
  // A podcast and no recordings (an audio show, say): its episodes are this tab.
  const podQ = usePodcastEpisodes();
  const hasPodcast = (podQ.data ?? []).some((e) => e.status === "published");
  const [makingEp, setMakingEp] = useState(false);
  // Already an episode: which show it's in, so the menu says "Move episode to" instead of adding it twice (Andrew, 24 Nov).
  const episodeOf = (ids: number[]) => {
    for (const x of podShows) { const e = (x.episodes ?? []).find((y) => y.recordingId != null && ids.includes(y.recordingId)); if (e) return { show: x.show, ep: e }; }
    return null;
  };
  const mover = useMoveEpisode();
  const { toast: epToast } = useToast();
  async function toEpisode(recId: number, showId: number) {
    setMakingEp(true);
    try {
      const e = (await (await apiRequest("POST", `/api/host/hosting/shows/${showId}/episodes`, { recordingId: recId })).json()) as { id: number };
      window.location.href = `/host/dashboard/podcast?ep=${e.id}`;
    } catch (err) {
      epToast({ title: "Couldn't make the episode", description: (err as Error).message.replace(/^\d+:\s*/, ""), variant: "destructive" });
      setMakingEp(false);
    }
  }
  const [playing, setPlaying] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<RecordingRow | null>(null);
  /** Which version each episode's card shows, by the episode's id. */
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [renaming, setRenaming] = useState<{ id: number; title: string } | null>(null);
  async function saveTitle() {
    if (!renaming) return;
    const title = renaming.title.trim();
    if (!title) return setRenaming(null);
    try {
      await apiRequest("POST", `/api/host/recordings/${renaming.id}/title`, { title });
      await qc.invalidateQueries({ queryKey: ["/api/host/recordings"] });
      setRenaming(null);
    } catch (e) {
      toast({ title: "Couldn't rename that", description: (e as Error).message, variant: "destructive" });
    }
  }
  const { toast } = useToast();
  const qc = useQueryClient();
  const [starting, setStarting] = useState<number | null>(null);
  const { data: all, isLoading } = useQuery<RecordingRow[]>({
    queryKey: ["/api/host/recordings"],
    queryFn: async () => (await apiRequest("GET", "/api/host/recordings")).json(),
    // A session that's still being written turns up shortly after it stops.
    refetchInterval: (q) =>
      (q.state.data ?? []).some((r) => r.status === "Recording" || r.status === "Importing") ? 15_000 : false,
  });
  const data = eventId == null ? all : (all ?? []).filter((r) => r.eventId === eventId);
  const eps = episodes(data ?? []);
  // Our how-to videos get their own row after the podcaster's own work, and never in a folder view.
  const howTos = eps.filter((e) => isHowTo(e.main.title));
  const shown = (folder == null ? eps : eps.filter((e) => e.main.folderId === folder)).filter((e) => !isHowTo(e.main.title));

  // The Tutorials folder's cards: a drawn poster, Watch, and nothing else.
  function tutorialGrid() {
    return (<>
      {/* Our tutorials, in the Tutorials folder (Andrew, 21 Nov): watch only, no Pōstify anywhere. A drawn poster, since their own frames came out black. */}
      {howTos.length > 0 && (
        <div data-testid="library-tutorials">
          <p className="mb-3 text-sm text-muted-foreground">Short videos from us on using MilitaryVoices.ai.</p>
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {howTos.map(({ main: r }) => (
              <li key={r.id} className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm" data-testid={`howto-${r.id}`}>
                <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-[#000741] via-[#053877] to-[#0a5bb5]">
                  {playing === r.id ? (
                    <video src={`/api/host/recordings/${r.id}/video`} controls autoPlay playsInline className="h-full w-full bg-black object-contain" />
                  ) : (
                    <button type="button" onClick={() => setPlaying(r.id)} className="absolute inset-0 flex items-center justify-center" aria-label={`Watch ${plainTitle(r.title)}`}>
                      <span className="absolute inset-0 bg-[radial-gradient(circle_at_50%_55%,rgba(255,255,255,0.22),transparent_60%)]" />
                      <Art3D name={howToArt(r.title)!} size={64} className="relative drop-shadow-[0_8px_16px_rgba(0,0,0,0.35)] transition-transform duration-200 group-hover:scale-110" />
                      <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#000741]">Tutorial</span>
                      {r.durationSec > 0 && <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">{clock(r.durationSec)}</span>}
                    </button>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-2 p-3">
                  {/* No lone last word: the last two words stay together. */}
                  <p className="text-balance text-sm font-semibold leading-snug text-card-foreground" title={plainTitle(r.title)}>{howToLabel(plainTitle(r.title)).replace(/ (\S+)$/, "\u00a0$1")}</p>
                  {r.status === "Ready" && (
                    <Button size="sm" variant="outline" onClick={() => setPlaying(playing === r.id ? null : r.id)} className="mt-auto h-8 w-fit gap-1.5 rounded-full px-3 text-xs" data-testid={`button-watch-${r.id}`}>
                      {playing === r.id ? <><X className="h-3.5 w-3.5" /> Close</> : <><Play className="h-3.5 w-3.5 fill-current" /> Watch</>}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

    </>);
  }
  if (isLoading) return null;
  if (tutorials) return <section className="mt-2">{tutorialGrid()}</section>;
  if (folder != null && shown.length === 0) return null;
  // Nothing of their own (our tutorials alone are in the Tutorials folder): same as empty.
  if (!data || shown.length === 0) {
    // Only a podcast, no recordings (an audio show, say): its episodes are the Library.
    if (hasPodcast) return (
      <section className="mt-2" data-testid="library-podcast-only">
        <h3 className="mb-3 text-base font-bold text-foreground">Podcast episodes</h3>
        <PodcastEpisodeGrid testid="library-podcast" min={240} fileable onPick={(rec) => { window.location.href = `/host/dashboard/postify?rec=${rec.id}`; }} />
      </section>
    );
    if (!showEmpty) return null;
    return (
      <p className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Nothing here yet. Studio sessions appear once they've been on air, or upload a video above.
      </p>
    );
  }

  // "Pōstify it" starts the job here, on the click, so it's running on our
  // side before Pōstify opens: closing the tab on the way can't lose it. Not
  // started (no credits, too long): Pōstify opens with the way to go on.
  // Two people on screen and no layout of its own (Andrew, 20 Nov): Pōstify opens on its start
  // screen instead, where they pick Stacked, Side by side, Follow the speaker or Automatic first.
  async function postifyIt(rec: RecordingRow) {
    const id = rec.id;
    if (starting != null) return;
    if (seesTwoPeople((rec as { layoutSuggestion?: string }).layoutSuggestion) && !parseClipOptions(rec.clipOptions).layout) {
      window.location.href = `/host/dashboard/postify?rec=${id}`;
      return;
    }
    setStarting(id);
    let opts = DEFAULT_CLIP_OPTIONS;
    try { opts = parseClipOptions(localStorage.getItem("mv_clip_options") ?? ""); } catch { /* private mode */ }
    let started = false;
    try {
      await apiRequest("POST", `/api/host/recordings/${id}/clip`, { options: { ...opts, formats: ["vertical", "square", "wide"] } });
      started = true;
    } catch { /* Pōstify says why and offers the way on */ }
    window.location.href = `/host/dashboard/postify?rec=${id}${started ? "" : "&go=1"}`;
  }

  async function download(id: number) {
    try {
      const res = await apiRequest("GET", `/api/host/recordings/${id}/download`);
      const { url } = (await res.json()) as { url: string };
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast({ title: "Couldn't open that file", description: (err as Error).message, variant: "destructive" });
    }
  }

  /** Email it to their editor (set up on the Zoom card in Integrations). */
  async function sendToEditor(id: number) {
    try {
      const res = await apiRequest("POST", `/api/host/recordings/${id}/send-editor`);
      const { to } = (await res.json()) as { to: string[] };
      toast({ title: "Sent to your editor", description: `${to.join(", ")} got a download link.` });
    } catch (err) {
      const m = (err as Error).message;
      toast(/editor's email/.test(m)
        ? { title: "Add your editor first", description: "In Integrations, on the Zoom card: Send new recordings to my editor." }
        : { title: "Couldn't send it", description: m, variant: "destructive" });
    }
  }

  return (
    <section className="mt-2">
      {mover.dialog}
      {/* Thumbnails, each with one menu: the things you do with an episode. */}
      {shown.length > 0 && <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map(({ main, versions, earlier }) => {
          // Their latest edit first when there is one (it's the one they made to use); otherwise the clean copy.
          const all = [...versions, ...earlier];
          const r = all.find((v) => v.rec.id === picked[main.id])?.rec ?? versions.find((v) => v.label === "Edited")?.rec ?? versions[0]?.rec ?? main;
          const olderPicked = earlier.find((v) => v.rec.id === r.id);
          const clean = versions.length > 0 || main.egressId.startsWith("CLEAN_");
          const inShow = episodeOf([main.id, ...all.map((v) => v.rec.id)]);
          return (
          <li
            key={main.id}
            {...dragToFolder(lib, { kind: "recording", id: main.id })}
            className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
            data-testid={`recording-${r.id}`}
          >
            <div className="relative aspect-video bg-[#050d26]">
              {r.status === "Ready" ? (
                playing === r.id ? (
                  <video src={`/api/host/recordings/${r.id}/video`} controls autoPlay playsInline className="h-full w-full bg-black object-contain" />
                ) : (
                  <button type="button" onClick={() => setPlaying(r.id)} className="absolute inset-0" aria-label={`Play ${r.title || "recording"}`}>
                    <video src={`/api/host/recordings/${r.id}/video#t=8`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/10 opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-[#000741] shadow-lg"><Play className="h-5 w-5 fill-current" /></span>
                    </span>
                    {r.durationSec > 0 && <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">{clock(r.durationSec)}</span>}
                    {/* What the episode has, whichever version is showing. */}
                    <span className="absolute left-2 top-2 flex flex-wrap gap-1">
                      {main.clipStatus === "done" && <span className="inline-flex items-center gap-1 rounded-full bg-[#F0A71F] px-2 py-0.5 text-[10px] font-bold text-[#1a1200]"><Wand2 className="h-3 w-3" /> Clips ready</span>}
                      {clean && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white"><Wand2 className="h-3 w-3" /> Clean episode</span>}
                    </span>
                  </button>
                )
              ) : (
                <span className="absolute inset-0 flex items-center justify-center gap-1.5 text-xs font-medium text-white/70">
                  {r.status === "Recording" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Still recording</> : r.status === "Importing" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {r.egressId.startsWith("ZOOM_") ? "Importing from Zoom…" : "Importing…"}</> : r.egressId.startsWith("ZOOM_") || r.egressId.startsWith("LINK_") ? `Couldn't bring it in${r.error ? `: ${r.error}` : ""}` : "Didn't save — tell us and we'll look"}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-start gap-2 p-3">
              <div className="min-w-0 flex-1">
                {renaming?.id === main.id ? (
                  <form onSubmit={(e) => { e.preventDefault(); void saveTitle(); }} className="flex items-center gap-1">
                    <Input
                      autoFocus
                      value={renaming.title}
                      maxLength={150}
                      onChange={(e) => setRenaming({ id: main.id, title: e.target.value })}
                      onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                      onFocus={(e) => e.currentTarget.select()}
                      className="h-8 min-w-0 flex-1 text-sm"
                      aria-label="Recording name"
                      data-testid={`input-rename-${main.id}`}
                    />
                    <Button type="submit" size="sm" className="h-8 rounded-full px-3 text-xs" data-testid={`button-save-rename-${main.id}`}>Save</Button>
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full" onClick={() => setRenaming(null)} aria-label="Cancel"><X className="h-3.5 w-3.5" /></Button>
                  </form>
                ) : (
                  <p className="line-clamp-2 text-sm font-semibold leading-snug text-card-foreground" title={plainTitle(main.title)}>{plainTitle(main.title) || "Your session"}</p>
                )}
                <p className="mt-0.5 tabular-nums text-xs text-muted-foreground">
                  {new Date(r.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  {size(r.sizeBytes) ? ` · ${size(r.sizeBytes)}` : ""}
                  {onShowClips && (clipCounts?.get(main.id) ?? 0) > 0 && (
                    <> · <button type="button" onClick={() => onShowClips(main.id)} className="font-semibold text-[#053877] hover:underline dark:text-[#8fb5e8]" data-testid={`recording-clips-${main.id}`}>{clipCounts!.get(main.id)} clip{clipCounts!.get(main.id) === 1 ? "" : "s"} →</button></>
                  )}
                </p>
              </div>
              {/* Pōstify on the card itself, not only in the menu: storing an episode spends nothing; this is the button that does. */}
              {r.status === "Ready" && !main.egressId.startsWith("CLEAN_") && (
                <a
                  href={`/host/dashboard/postify?rec=${main.id}`}
                  onClick={(e) => {
                    if (main.clipStatus !== "none" && main.clipStatus !== "failed") return;
                    e.preventDefault();
                    void postifyIt(main);
                  }}
                  className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${main.clipStatus === "none" || main.clipStatus === "failed" ? "bg-[#F0A71F] text-[#1a1200] hover:bg-[#f5b94a]" : "border border-border text-foreground hover:bg-muted"}`}
                  data-testid={`button-postify-card-${main.id}`}
                >
                  {starting === main.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} {starting === main.id ? "Starting…" : main.clipStatus === "none" || main.clipStatus === "failed" ? "Pōstify it" : main.clipStatus === "done" ? "Open in Pōstify" : "Pōstifying…"}
                </a>
              )}
              {(r.status === "Ready" || (r.status !== "Recording" && deletable(r))) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full" aria-label="More" data-testid={`menu-recording-${r.id}`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    {r.status === "Ready" && (<>
                    <DropdownMenuItem onSelect={() => void download(r.id)} className="gap-2" data-testid={`button-download-recording-${r.id}`}>
                      <Download className="h-4 w-4" /> {versions.length > 0 ? `Download ${olderPicked ? "this edit" : versions.find((v) => v.rec.id === r.id)?.label.toLowerCase()}` : "Download"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void sendToEditor(r.id)} className="gap-2" data-testid={`button-editor-recording-${r.id}`}>
                      <Send className="h-4 w-4" /> Send to my editor
                    </DropdownMenuItem>
                    {/* Clips and the clean episode are made in Pōstify. */}
                    {/* A clean copy is already Pōstify's output; clips come from the original. */}
                    {!main.egressId.startsWith("CLEAN_") && (
                      <DropdownMenuItem onSelect={() => { if (main.clipStatus === "none" || main.clipStatus === "failed") void postifyIt(main); else window.location.href = `/host/dashboard/postify?rec=${main.id}`; }} className="gap-2" data-testid={`button-postify-recording-${main.id}`}>
                        <Wand2 className="h-4 w-4 text-[#b36b00]" /> {main.clipStatus === "done" ? "Clips in Pōstify" : "Pōstify it"}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => setRenaming({ id: main.id, title: plainTitle(main.title) })} className="gap-2" data-testid={`button-rename-recording-${main.id}`}>
                      <Pencil className="h-4 w-4" /> Rename
                    </DropdownMenuItem>
                    {/* An episode of their podcast (Andrew, 24 Nov): not one yet, add it to a show (one show, straight in; none, start one).
                        Already one: which show it's in, and the others to move it to. */}
                    {inShow ? (podShows.length > 1 ? (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="gap-2" disabled={mover.busy} data-testid={`button-move-episode-recording-${r.id}`}><Mic2 className="h-4 w-4" /> Move episode to</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-60">
                          {podShows.map((x) => x.show.id === inShow.show.id ? (
                            <DropdownMenuItem key={x.show.id} disabled className="justify-between gap-2 data-[disabled]:opacity-100"><span className="truncate">{x.show.title || "Untitled show"}</span><Check className="h-4 w-4 shrink-0 text-emerald-600" /></DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem key={x.show.id} onSelect={() => mover.move({ epId: inShow.ep.id, title: inShow.ep.title, live: !!inShow.ep.live, from: inShow.show.title, to: { id: x.show.id, title: x.show.title } })} className="truncate" data-testid={`button-move-to-${x.show.id}`}>{x.show.title || "Untitled show"}</DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    ) : (
                      <DropdownMenuItem disabled className="gap-2 data-[disabled]:opacity-100" data-testid={`episode-in-show-${r.id}`}>
                        <Mic2 className="h-4 w-4" /> <span className="min-w-0 truncate">In {inShow.show.title || "your show"}</span> <Check className="ml-auto h-4 w-4 shrink-0 text-emerald-600" />
                      </DropdownMenuItem>
                    )) : podShows.length > 1 ? (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="gap-2" disabled={makingEp} data-testid={`button-episode-recording-${r.id}`}><Mic2 className="h-4 w-4" /> Add as an episode to</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-60">
                          {podShows.map((x) => <DropdownMenuItem key={x.show.id} onSelect={() => void toEpisode(r.id, x.show.id)} className="truncate">{x.show.title || "Untitled show"}</DropdownMenuItem>)}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    ) : (
                      <DropdownMenuItem disabled={makingEp} onSelect={() => { if (podShows[0]) void toEpisode(r.id, podShows[0].show.id); else window.location.href = "/host/dashboard/podcast"; }} className="gap-2" data-testid={`button-episode-recording-${r.id}`}>
                        {makingEp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic2 className="h-4 w-4" />} {podShows[0] ? "Add as an episode" : "Start my podcast"}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => { setScheduling(false); setPublishing(r); }} className="gap-2" data-testid={`button-publish-recording-${r.id}`}>
                      <Share2 className="h-4 w-4" /> Post now
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => { setScheduling(true); setPublishing(r); }} className="gap-2" data-testid={`button-schedule-recording-${r.id}`}>
                      <CalendarClock className="h-4 w-4" /> Schedule…
                    </DropdownMenuItem>
                    <MoveToFolder item={{ kind: "recording", id: main.id }} current={main.folderId} />
                    </>)}
                    {/* Uploads, imports and Pōstify's copies (a failed import too); a studio session is the event's too. */}
                    {deletable(r) && (
                      <DropdownMenuItem onSelect={() => setDeleting(r)} className="gap-2 text-destructive focus:text-destructive" data-testid={`button-delete-recording-${r.id}`}>
                        <Trash2 className="h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {/* The versions get their own full-width row so the labels never wrap. */}
              {versions.length > 0 && (
                <div className="mt-1 flex w-full items-center gap-1 rounded-full border border-border p-1" role="group" aria-label="Version">
                  {versions.map((v) => (
                    <button
                      key={v.rec.id}
                      type="button"
                      onClick={() => { setPicked((p) => ({ ...p, [main.id]: v.rec.id })); setPlaying(null); }}
                      aria-pressed={v.rec.id === r.id}
                      className={`flex-1 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${v.rec.id === r.id ? "bg-[#000741] text-white dark:bg-white dark:text-[#000741]" : "text-muted-foreground hover:text-foreground"}`}
                      data-testid={`version-${main.id}-${v.rec.id}`}
                    >
                      {v.label}
                    </button>
                  ))}
                  {earlier.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" className={`flex-1 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${olderPicked ? "bg-[#000741] text-white dark:bg-white dark:text-[#000741]" : "text-muted-foreground hover:text-foreground"}`} data-testid={`version-earlier-${main.id}`}>
                          {olderPicked ? olderPicked.label : `Earlier edits (${earlier.length})`} ▾
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-56">
                        {earlier.map((v) => (
                          <DropdownMenuItem key={v.rec.id} onSelect={() => { setPicked((p) => ({ ...p, [main.id]: v.rec.id })); setPlaying(null); }} className="flex justify-between gap-2 text-sm">
                            <span>{v.label}</span>
                            <span className="tabular-nums text-xs text-muted-foreground">{clock(v.rec.durationSec)}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              )}
            </div>
          </li>
          );
        })}
      </ul>}

      <PostDialog target={publishing ? { kind: "recording", id: publishing.id, title: publishing.title, clipsFrom: sourceOf(publishing) ?? publishing.id } : null} onClose={() => setPublishing(null)} schedule={scheduling} />
      <ConfirmDelete
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete "${deleting?.title || "this recording"}"?`}
        description={deleting?.egressId.startsWith("CLEAN_") ? "This version leaves your Library. The original recording and its clips aren't touched." : "The video, its clean copy and any clips made from it move to Recently deleted. You can put them back for 15 days."}
        url={`/api/host/recordings/${deleting?.id}`}
        restorable
      />
    </section>
  );
}
