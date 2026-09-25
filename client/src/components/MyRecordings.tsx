import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PostDialog } from "@/components/PostDialog";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import type { RecordingRow } from "@shared/schema";
import { Download, Loader2, MoreHorizontal, Play, Share2, Trash2, Wand2 } from "lucide-react";

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
  const { toast } = useToast();
  const { data: all, isLoading } = useQuery<RecordingRow[]>({
    queryKey: ["/api/host/recordings"],
    queryFn: async () => (await apiRequest("GET", "/api/host/recordings")).json(),
    // A session that's still being written turns up shortly after it stops.
    refetchInterval: (q) =>
      (q.state.data ?? []).some((r) => r.status === "Recording" || r.status === "Importing") ? 15_000 : false,
  });
  const data = eventId == null ? all : (all ?? []).filter((r) => r.eventId === eventId);

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
      {/* Thumbnails, each with one menu: the three things you do with a recording. */}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data.map((r) => (
          <li key={r.id} className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm" data-testid={`recording-${r.id}`}>
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
                    {r.egressId.startsWith("CLEAN_") && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white"><Wand2 className="h-3 w-3" /> Clean episode</span>}
                    {r.clipStatus === "done" && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-[#F0A71F] px-2 py-0.5 text-[10px] font-bold text-[#1a1200]"><Wand2 className="h-3 w-3" /> Clips ready</span>}
                  </button>
                )
              ) : (
                <span className="absolute inset-0 flex items-center justify-center gap-1.5 text-xs font-medium text-white/70">
                  {r.status === "Recording" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Still recording</> : r.status === "Importing" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Importing from Zoom…</> : r.egressId.startsWith("ZOOM_") ? `Couldn't bring it in from Zoom${r.error ? `: ${r.error}` : ""}` : "Didn't save — tell us and we'll look"}
                </span>
              )}
            </div>
            <div className="flex items-start gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-semibold leading-snug text-card-foreground" title={r.title}>{r.title || "Your session"}</p>
                <p className="mt-0.5 tabular-nums text-xs text-muted-foreground">
                  {new Date(r.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  {size(r.sizeBytes) ? ` · ${size(r.sizeBytes)}` : ""}
                </p>
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
                      <Download className="h-4 w-4" /> Download
                    </DropdownMenuItem>
                    {/* Clips and the clean episode are made in Pōstify. */}
                    {/* A clean copy is already Pōstify's output; clips come from the original. */}
                    {!r.egressId.startsWith("CLEAN_") && (
                      <DropdownMenuItem onSelect={() => { window.location.href = `/host/dashboard/postify?rec=${r.id}`; }} className="gap-2" data-testid={`button-postify-recording-${r.id}`}>
                        <Wand2 className="h-4 w-4 text-[#b36b00]" /> {r.clipStatus === "done" ? "Clips in Pōstify" : "Pōstify it"}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => setPublishing(r)} className="gap-2" data-testid={`button-publish-recording-${r.id}`}>
                      <Share2 className="h-4 w-4" /> Post it
                    </DropdownMenuItem>
                    {/* Uploads and Pōstify's copies; a studio session is the event's too. */}
                    {(r.egressId.startsWith("UPLOAD_") || r.egressId.startsWith("CLEAN_") || r.egressId.startsWith("ZOOM_")) && (
                      <DropdownMenuItem onSelect={() => setDeleting(r)} className="gap-2 text-destructive focus:text-destructive" data-testid={`button-delete-recording-${r.id}`}>
                        <Trash2 className="h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </li>
        ))}
      </ul>

      <PostDialog target={publishing ? { kind: "recording", id: publishing.id, title: publishing.title } : null} onClose={() => setPublishing(null)} />
      <ConfirmDelete
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete "${deleting?.title || "this recording"}"?`}
        description={deleting?.egressId.startsWith("CLEAN_") ? "It leaves your Library. The original episode isn't touched." : "The video and any clips made from it are deleted for good."}
        url={`/api/host/recordings/${deleting?.id}`}
      />
    </section>
  );
}
