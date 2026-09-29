import { useState } from "react";
import { Check, Clapperboard } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipCard, ClipPreview } from "@/components/PostStudio";
import type { ClipRow, HostPostRow, RecordingRow } from "@shared/schema";

/**
 * Library > Clips: every clip, newest first, with where each one stands
 * (ready, scheduled, posted). The same card as Pōstify's, so Post, Trim and
 * Edit the title work here too; one episode's clips with the filter.
 */
export function ClipsLibrary({ clips, posts, recordings, episode, onEpisode }: {
  clips: ClipRow[];
  posts: HostPostRow[];
  recordings: RecordingRow[];
  episode: number | null;
  onEpisode: (id: number | null) => void;
}) {
  const [playing, setPlaying] = useState<ClipRow | null>(null);
  // Each clip's standing, from its posts: out, or waiting in the queue.
  const standing = new Map<number, "Scheduled" | "Posted">();
  for (const p of posts) {
    if (p.kind !== "clip" || p.status === "failed") continue;
    const waiting = p.status === "scheduled" && Date.parse(p.scheduledAt) > Date.now();
    standing.set(p.refId, standing.get(p.refId) === "Posted" || !waiting ? "Posted" : "Scheduled");
  }
  const titleOf = new Map(recordings.map((r) => [r.id, r.title.replace(/ \((clean|edited)\)$/i, "") || "Episode"]));
  const withClips = Array.from(new Set(clips.map((c) => c.recordingId))).filter((id) => titleOf.has(id));
  const shown = clips.filter((c) => episode == null || c.recordingId === episode).sort((a, b) => b.id - a.id);

  return (
    <div data-testid="clips-library">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={episode == null ? "all" : String(episode)} onValueChange={(v) => onEpisode(v === "all" ? null : Number(v))}>
          <SelectTrigger className="h-9 w-72 max-w-full" data-testid="clips-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All episodes ({clips.length})</SelectItem>
            {withClips.map((id) => <SelectItem key={id} value={String(id)}>{titleOf.get(id)} ({clips.filter((c) => c.recordingId === id).length})</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{shown.length} clip{shown.length === 1 ? "" : "s"}</span>
      </div>
      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          <Clapperboard className="h-6 w-6" />
          No clips yet. Open an episode in <a href="/host/dashboard/postify" className="font-semibold text-[#053877] hover:underline dark:text-white">Pōstify</a> and it makes them for you.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((c) => {
            const st = standing.get(c.id);
            return (
              <div key={c.id} className="relative flex min-w-0 flex-col">
                <ClipCard c={c} onPreview={() => setPlaying(c)} />
                {st && (
                  <span className={`pointer-events-none absolute right-2 top-2 z-10 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${st === "Scheduled" ? "bg-[#053877]" : "bg-emerald-500"}`}>
                    <Check className="h-3 w-3" /> {st}
                  </span>
                )}
                <p className="mt-1 truncate px-1 text-[11px] text-muted-foreground">{titleOf.get(c.recordingId) ?? ""}</p>
              </div>
            );
          })}
        </div>
      )}
      <ClipPreview c={playing} onClose={() => setPlaying(null)} />
    </div>
  );
}
