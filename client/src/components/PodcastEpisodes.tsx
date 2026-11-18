import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Headphones, Loader2, Mic, Video, Wand2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { RecordingRow } from "@shared/schema";

/** An episode of one of their podcast shows, as the pickers see it. */
export type PodEpisode = {
  id: number; showId: number; show: string; title: string; publishedAt: string; status: string; durationSec: number;
  art: string; kind: "video" | "audio"; recordingId: number | null; making: boolean; videoFailed: boolean;
};

const clock = (s: number) => { const m = Math.floor(s / 60); const r = Math.round(s % 60); return `${m}:${String(r).padStart(2, "0")}`; };

/** Their podcast's episodes. Checks again while a video is being made. */
export function usePodcastEpisodes(enabled = true) {
  return useQuery<PodEpisode[]>({
    queryKey: ["/api/host/podcast-episodes"],
    queryFn: async () => (await apiRequest("GET", "/api/host/podcast-episodes")).json(),
    enabled,
    staleTime: 15_000,
    refetchInterval: (q) => ((q.state.data as PodEpisode[] | undefined)?.some((e) => e.making) ? 6000 : false),
  });
}

/** The Library recording behind a podcast episode (made on the spot for a video episode). */
export async function recordingOfEpisode(id: number): Promise<RecordingRow> {
  return ((await (await apiRequest("POST", `/api/host/podcast-episodes/${id}/library`)).json()) as { recording: RecordingRow }).recording;
}

/**
 * Their podcast episodes as cards. A video episode opens straight into the job (`onPick` gets its Library recording);
 * an audio-only one offers "Make a video", which puts the cover art and a moving sound wave behind the audio.
 */
export function PodcastEpisodeGrid({ onPick, used, testid = "podcast-episodes", min = 200 }: {
  onPick: (rec: RecordingRow, ep: PodEpisode) => void;
  used?: (ep: PodEpisode) => string | undefined;
  testid?: string;
  min?: number;
}) {
  const q = usePodcastEpisodes();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const eps = (q.data ?? []).filter((e) => e.status === "published");

  async function pick(e: PodEpisode) {
    setBusy(e.id);
    try {
      const rec = await recordingOfEpisode(e.id);
      void qc.invalidateQueries({ queryKey: ["/api/host/recordings"] });
      void qc.invalidateQueries({ queryKey: ["/api/host/podcast-episodes"] });
      onPick(rec, e);
    } catch (err) {
      toast({ title: "Couldn't open that episode", description: (err as Error).message.replace(/^\d+:\s*/, ""), variant: "destructive" });
    } finally { setBusy(null); }
  }
  async function makeVideo(e: PodEpisode) {
    setBusy(e.id);
    try {
      await apiRequest("POST", `/api/host/podcast-episodes/${e.id}/make-video`);
      await qc.invalidateQueries({ queryKey: ["/api/host/podcast-episodes"] });
      toast({ title: "Making the video", description: "It takes a few minutes. It shows here, ready to clip and post, when it's done." });
    } catch (err) {
      toast({ title: "Couldn't start that", description: (err as Error).message.replace(/^\d+:\s*/, ""), variant: "destructive" });
    } finally { setBusy(null); }
  }

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading your podcast episodes…</p>;
  if (!eps.length) return <p className="text-sm text-muted-foreground" data-testid={`${testid}-empty`}>No published podcast episodes yet.</p>;
  return (
    <ul className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${min}px,1fr))` }} data-testid={testid}>
      {eps.map((e) => {
        const tag = used?.(e);
        const working = e.making || busy === e.id;
        return (
          <li key={e.id} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-left" data-testid={`${testid}-${e.id}`}>
            <button type="button" disabled={working || e.kind === "audio"} onClick={() => void pick(e)} className="relative block aspect-video bg-[#050d26] disabled:cursor-default" aria-label={`Open ${e.title}`}>
              {e.art ? <img src={e.art} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span className="flex h-full w-full items-center justify-center text-white/60"><Mic className="h-8 w-8" /></span>}
              <span className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${e.kind === "video" ? "bg-[#053877] text-white" : "bg-white/90 text-[#000741]"}`}>
                {e.kind === "video" ? <Video className="h-3 w-3" /> : <Headphones className="h-3 w-3" />}{e.kind === "video" ? "Video" : "Audio only"}
              </span>
              {e.durationSec > 0 && <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">{clock(e.durationSec)}</span>}
              {working && <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-white"><Loader2 className="h-6 w-6 animate-spin" /></span>}
            </button>
            {tag && <span className="px-2 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-[#8a5a00]">{tag}</span>}
            <div className="flex items-start gap-2 p-2.5">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-xs font-semibold leading-snug" title={e.title}>{e.title}</p>
                <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{e.publishedAt ? new Date(e.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : ""}</p>
              </div>
              {e.kind === "audio" && (
                <button type="button" disabled={working} onClick={() => void makeVideo(e)} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold hover:border-[#053877]/50 disabled:opacity-60" data-testid={`${testid}-make-${e.id}`}>
                  <Wand2 className="h-3 w-3" /> {e.making ? "Making…" : e.videoFailed ? "Try again" : "Make a video"}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
