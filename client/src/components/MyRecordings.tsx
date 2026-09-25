import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PostDialog } from "@/components/PostDialog";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import type { LibraryFolderRow, RecordingRow } from "@shared/schema";
import { Check, Download, Folder, FolderInput, FolderOpen, FolderPlus, Library, Loader2, MoreHorizontal, Pencil, Play, Share2, Trash2, Wand2, X } from "lucide-react";

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

/** The episode a clean or edited copy was made from (CLEAN_12, CLEAN_EDIT_12_…). */
function sourceOf(r: RecordingRow): number | null {
  const m = r.egressId.match(/^CLEAN_(EDIT_)?(\d+)/);
  return m ? Number(m[2]) : null;
}

type Version = { label: string; rec: RecordingRow };
type Episode = { main: RecordingRow; versions: Version[] };

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
      return {
        main,
        versions: mine.length === 0 ? [] : [
          ...clean.map((rec) => ({ label: "Clean", rec })),
          ...edited.map((rec, i) => ({ label: edited.length > 1 ? `Edited ${i + 1}` : "Edited", rec })),
          { label: "Original", rec: main },
        ],
      };
    });
}

const plainTitle = (t: string) => t.replace(/ \((clean|edited)\)$/i, "");

export function MyRecordings({
  socialAccounts,
  eventId,
  showEmpty = false,
}: {
  socialAccounts?: string | null;
  /** Only this event's sessions. Omit for every event. */
  eventId?: number | null;
  /** Say so when there is nothing, instead of rendering nothing at all. */
  showEmpty?: boolean;
}) {
  const [publishing, setPublishing] = useState<RecordingRow | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<RecordingRow | null>(null);
  /** Which version each episode's card shows, by the episode's id. */
  const [picked, setPicked] = useState<Record<number, number>>({});
  /** The open folder: null for everything. */
  const [openFolder, setOpenFolder] = useState<number | null>(null);
  const [naming, setNaming] = useState<{ id: number | null; name: string; file?: number } | null>(null);
  const [removingFolder, setRemovingFolder] = useState<LibraryFolderRow | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const folderQ = useQuery<LibraryFolderRow[]>({
    queryKey: ["/api/host/folders"],
    queryFn: async () => (await apiRequest("GET", "/api/host/folders")).json(),
  });
  const folders = folderQ.data ?? [];
  const { data: all, isLoading } = useQuery<RecordingRow[]>({
    queryKey: ["/api/host/recordings"],
    queryFn: async () => (await apiRequest("GET", "/api/host/recordings")).json(),
    // A session that's still being written turns up shortly after it stops.
    refetchInterval: (q) =>
      (q.state.data ?? []).some((r) => r.status === "Recording" || r.status === "Importing") ? 15_000 : false,
  });
  const data = eventId == null ? all : (all ?? []).filter((r) => r.eventId === eventId);
  const eps = episodes(data ?? []);
  // A folder that was deleted elsewhere just stops being open.
  const current = openFolder != null && folders.some((f) => f.id === openFolder) ? openFolder : null;
  const shown = current == null ? eps : eps.filter((e) => e.main.folderId === current);
  const inFolder = (id: number) => eps.filter((e) => e.main.folderId === id).length;

  async function fileIn(recId: number, folderId: number) {
    try {
      await apiRequest("POST", `/api/host/recordings/${recId}/folder`, { folderId });
      await qc.invalidateQueries({ queryKey: ["/api/host/recordings"] });
      const f = folders.find((x) => x.id === folderId);
      toast({ title: f ? `Moved to ${f.name}` : "Taken out of its folder" });
    } catch (err) {
      toast({ title: "Couldn't move that", description: (err as Error).message, variant: "destructive" });
    }
  }

  async function saveFolder() {
    if (!naming) return;
    const name = naming.name.trim();
    if (!name) return setNaming(null);
    try {
      const res = naming.id == null
        ? await apiRequest("POST", "/api/host/folders", { name })
        : await apiRequest("PATCH", `/api/host/folders/${naming.id}`, { name });
      const row = (await res.json()) as LibraryFolderRow;
      await qc.invalidateQueries({ queryKey: ["/api/host/folders"] });
      if (naming.file != null) await fileIn(naming.file, row.id);
      if (naming.id == null) setOpenFolder(row.id);
      setNaming(null);
    } catch (err) {
      toast({ title: "Couldn't save that folder", description: (err as Error).message, variant: "destructive" });
    }
  }

  if (isLoading) return null;
  if (!data || data.length === 0) {
    if (!showEmpty) return null;
    return (
      <p className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Nothing here yet. Studio sessions appear once they've been on air, or upload a video above.
      </p>
    );
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

  return (
    <section className="mt-2">
      {/* Folders: the podcaster's own. Click to open one; drag an episode onto one to file it. */}
      <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="library-folders">
        <FolderChip active={current == null} onClick={() => setOpenFolder(null)} icon={<Library className="h-3.5 w-3.5" />} label="All episodes" n={eps.length} />
        {folders.map((f) =>
          naming?.id === f.id ? (
            <NameInput key={f.id} value={naming.name} onChange={(name) => setNaming({ ...naming, name })} onSave={saveFolder} onCancel={() => setNaming(null)} />
          ) : (
            <FolderChip
              key={f.id}
              active={current === f.id}
              over={dragOver === f.id}
              onClick={() => setOpenFolder(f.id)}
              icon={current === f.id ? <FolderOpen className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}
              label={f.name}
              n={inFolder(f.id)}
              onDragOver={(e) => { e.preventDefault(); setDragOver(f.id); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => { e.preventDefault(); setDragOver(null); const id = Number(e.dataTransfer.getData("text/x-recording")); if (id) void fileIn(id, f.id); }}
              testId={`folder-${f.id}`}
            />
          ),
        )}
        {naming?.id === null ? (
          <NameInput value={naming.name} onChange={(name) => setNaming({ ...naming, name })} onSave={saveFolder} onCancel={() => setNaming(null)} />
        ) : (
          <button type="button" onClick={() => setNaming({ id: null, name: "" })} className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-foreground/40 hover:text-foreground" data-testid="button-new-folder">
            <FolderPlus className="h-3.5 w-3.5" /> New folder
          </button>
        )}
        {current != null && naming?.id !== current && (
          <span className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-7 gap-1 rounded-full px-2.5 text-xs" onClick={() => setNaming({ id: current, name: folders.find((f) => f.id === current)?.name ?? "" })} data-testid="button-rename-folder">
              <Pencil className="h-3 w-3" /> Rename
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1 rounded-full px-2.5 text-xs text-muted-foreground hover:text-destructive" onClick={() => setRemovingFolder(folders.find((f) => f.id === current) ?? null)} data-testid="button-delete-folder">
              <Trash2 className="h-3 w-3" /> Delete folder
            </Button>
          </span>
        )}
      </div>

      {shown.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Nothing in this folder yet. Drag an episode onto it, or use an episode's ⋯ menu → Move to folder.
        </p>
      )}

      {/* Thumbnails, each with one menu: the things you do with an episode. */}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map(({ main, versions }) => {
          // The clean copy first: it's the one to post.
          const r = versions.find((v) => v.rec.id === picked[main.id])?.rec ?? versions[0]?.rec ?? main;
          const clean = versions.length > 0 || main.egressId.startsWith("CLEAN_");
          return (
          <li
            key={main.id}
            draggable={folders.length > 0}
            onDragStart={(e) => { e.dataTransfer.setData("text/x-recording", String(main.id)); e.dataTransfer.effectAllowed = "move"; }}
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
            <div className="flex items-start gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-semibold leading-snug text-card-foreground" title={plainTitle(main.title)}>{plainTitle(main.title) || "Your session"}</p>
                <p className="mt-0.5 tabular-nums text-xs text-muted-foreground">
                  {new Date(r.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  {size(r.sizeBytes) ? ` · ${size(r.sizeBytes)}` : ""}
                </p>
                {versions.length > 0 && (
                  <div className="mt-2 inline-flex rounded-full border border-border p-0.5" role="group" aria-label="Version">
                    {versions.map((v) => (
                      <button
                        key={v.rec.id}
                        type="button"
                        onClick={() => { setPicked((p) => ({ ...p, [main.id]: v.rec.id })); setPlaying(null); }}
                        aria-pressed={v.rec.id === r.id}
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${v.rec.id === r.id ? "bg-[#000741] text-white dark:bg-white dark:text-[#000741]" : "text-muted-foreground hover:text-foreground"}`}
                        data-testid={`version-${main.id}-${v.rec.id}`}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {r.status === "Ready" && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full" aria-label="More" data-testid={`menu-recording-${r.id}`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onSelect={() => void download(r.id)} className="gap-2" data-testid={`button-download-recording-${r.id}`}>
                      <Download className="h-4 w-4" /> {versions.length > 0 ? `Download ${versions.find((v) => v.rec.id === r.id)?.label.toLowerCase()}` : "Download"}
                    </DropdownMenuItem>
                    {/* Clips and the clean episode are made in Pōstify. */}
                    {/* A clean copy is already Pōstify's output; clips come from the original. */}
                    {!main.egressId.startsWith("CLEAN_") && (
                      <DropdownMenuItem onSelect={() => { window.location.href = `/host/dashboard/postify?rec=${main.id}`; }} className="gap-2" data-testid={`button-postify-recording-${main.id}`}>
                        <Wand2 className="h-4 w-4 text-[#b36b00]" /> {main.clipStatus === "done" ? "Clips in Pōstify" : "Pōstify it"}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => setPublishing(r)} className="gap-2" data-testid={`button-publish-recording-${r.id}`}>
                      <Share2 className="h-4 w-4" /> Post it
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="gap-2" data-testid={`button-move-recording-${main.id}`}>
                        <FolderInput className="h-4 w-4" /> Move to folder
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-48">
                        {folders.map((f) => (
                          <DropdownMenuItem key={f.id} onSelect={() => void fileIn(main.id, f.id)} className="gap-2">
                            <Folder className="h-4 w-4" /> <span className="truncate">{f.name}</span>
                            {main.folderId === f.id && <Check className="ml-auto h-3.5 w-3.5" />}
                          </DropdownMenuItem>
                        ))}
                        {main.folderId > 0 && (
                          <DropdownMenuItem onSelect={() => void fileIn(main.id, 0)} className="gap-2">
                            <X className="h-4 w-4" /> Out of the folder
                          </DropdownMenuItem>
                        )}
                        {(folders.length > 0 || main.folderId > 0) && <DropdownMenuSeparator />}
                        <DropdownMenuItem onSelect={() => setNaming({ id: null, name: "", file: main.id })} className="gap-2">
                          <FolderPlus className="h-4 w-4" /> New folder…
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    {/* Uploads and Pōstify's copies; a studio session is the event's too. */}
                    {(r.egressId.startsWith("UPLOAD_") || r.egressId.startsWith("CLEAN_") || r.egressId.startsWith("ZOOM_") || r.egressId.startsWith("LINK_")) && (
                      <DropdownMenuItem onSelect={() => setDeleting(r)} className="gap-2 text-destructive focus:text-destructive" data-testid={`button-delete-recording-${r.id}`}>
                        <Trash2 className="h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </li>
          );
        })}
      </ul>

      <ConfirmDelete
        open={!!removingFolder}
        onOpenChange={(v) => !v && setRemovingFolder(null)}
        title={`Delete the "${removingFolder?.name ?? ""}" folder?`}
        description="Only the folder goes. Its episodes stay in your Library, under All episodes."
        url={`/api/host/folders/${removingFolder?.id}`}
        onDeleted={() => { setOpenFolder(null); void qc.invalidateQueries({ queryKey: ["/api/host/folders"] }); }}
      />
      <PostDialog target={publishing ? { kind: "recording", id: publishing.id, title: publishing.title } : null} onClose={() => setPublishing(null)} />
      <ConfirmDelete
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete "${deleting?.title || "this recording"}"?`}
        description={deleting?.egressId.startsWith("CLEAN_") ? "This version leaves your Library. The original episode and its clips aren't touched." : "The video, its clean copy and any clips made from it are deleted for good."}
        url={`/api/host/recordings/${deleting?.id}`}
      />
    </section>
  );
}

function FolderChip({ active, over, onClick, icon, label, n, onDragOver, onDragLeave, onDrop, testId }: {
  active: boolean;
  over?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  n: number;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      aria-pressed={active}
      className={`inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        over ? "border-[#F0A71F] bg-[#F0A71F]/15 text-foreground" : active ? "border-[#000741] bg-[#000741] text-white dark:border-white dark:bg-white dark:text-[#000741]" : "border-border bg-card text-muted-foreground hover:text-foreground"
      }`}
      data-testid={testId}
    >
      {icon} <span className="truncate">{label}</span> <span className={`tabular-nums ${active ? "opacity-70" : ""}`}>{n}</span>
    </button>
  );
}

function NameInput({ value, onChange, onSave, onCancel }: { value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(); }} className="inline-flex items-center gap-1">
      <Input
        autoFocus
        value={value}
        maxLength={60}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        placeholder="Folder name"
        className="h-8 w-44 rounded-full text-xs"
        data-testid="input-folder-name"
      />
      <Button type="submit" size="sm" className="h-8 rounded-full px-3 text-xs" data-testid="button-save-folder">Save</Button>
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-full" onClick={onCancel} aria-label="Cancel"><X className="h-3.5 w-3.5" /></Button>
    </form>
  );
}
