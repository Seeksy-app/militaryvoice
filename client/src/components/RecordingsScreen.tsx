import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { durationOf, putWithProgress } from "@/components/PostStudio";
import { MyRecordings } from "@/components/MyRecordings";
import { apiRequest } from "@/lib/queryClient";
import type { PublicEvent, RecordingRow } from "@shared/schema";
import { Disc, Loader2, Upload } from "lucide-react";

// Every session this podcaster has recorded, with a filter by event. Sessions
// belong to an event, so once somebody has been in two the list needs saying
// which is which — but with one event the filter shouldn't be a wall.

interface EventEntry {
  event: PublicEvent;
  slotIndex: number | null;
}

/** Add a video you already have: it's filed as a recording, nothing more (clipping is Pōstify's). */
function UploadRecording() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  async function go(file: File) {
    if (!file.type.startsWith("video/") && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) {
      toast({ title: "That isn't a video", description: "Upload an MP4, MOV or WebM.", variant: "destructive" });
      return;
    }
    if (file.size > 2 * 1024 ** 3) {
      toast({ title: "That file is over 2GB", description: "Export a smaller copy (1080p is plenty) and try again.", variant: "destructive" });
      return;
    }
    try {
      setPct(0);
      const durationSec = await durationOf(file);
      const { uploadUrl, storageKey } = (await (await apiRequest("POST", "/api/host/assets/upload-url", { fileName: file.name })).json()) as { uploadUrl: string; storageKey: string };
      await putWithProgress(uploadUrl, file, setPct);
      await apiRequest("POST", "/api/host/uploads/recording", { storageKey, fileName: file.name, durationSec, sizeBytes: file.size });
      await qc.invalidateQueries({ queryKey: ["/api/host/recordings"] });
      toast({ title: "Added to your recordings", description: "Open it in Pōstify to make clips and a clean episode." });
    } catch (e) {
      toast({ title: "Couldn't upload that", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPct(null);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <>
      <input ref={input} type="file" accept="video/*" className="hidden" onChange={(e) => e.target.files?.[0] && void go(e.target.files[0])} data-testid="recording-upload-input" />
      <Button onClick={() => input.current?.click()} disabled={pct !== null} className="gap-2 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="recording-upload">
        {pct === null ? <Upload className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
        {pct === null ? "Upload a video" : pct < 100 ? `Uploading… ${pct}%` : "Saving…"}
      </Button>
    </>
  );
}

export function RecordingsScreen({ socialAccounts }: { socialAccounts?: string | null }) {
  const [eventId, setEventId] = useState<number | null>(null);

  const { data: entries } = useQuery<EventEntry[]>({
    queryKey: ["/api/host/events"],
    queryFn: async () => (await apiRequest("GET", "/api/host/events")).json(),
  });
  const { data: recordings } = useQuery<RecordingRow[]>({
    queryKey: ["/api/host/recordings"],
    queryFn: async () => (await apiRequest("GET", "/api/host/recordings")).json(),
  });

  // Only offer events that actually have something to show, plus whichever is
  // currently selected, so the filter never lists dead ends.
  const counts = new Map<number, number>();
  for (const r of recordings ?? []) counts.set(r.eventId, (counts.get(r.eventId) ?? 0) + 1);
  const options = (entries ?? []).filter((e) => counts.has(e.event.id));

  return (
    <section className="mt-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
            <Disc className="h-4 w-4" /> Your recordings
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Every session the studio recorded for you, and every video you've uploaded. Downloads are private links
            made fresh each time, so they can't be passed around by accident.
          </p>
        </div>
        <UploadRecording />
      </div>

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

      <MyRecordings socialAccounts={socialAccounts} eventId={eventId} showEmpty />

      {/* Clips and clean episodes live in Pōstify; this page is the recordings. */}
      <p className="mt-6 text-sm text-muted-foreground">
        Clips and clean episodes are made in{" "}
        <a href="/host/dashboard/postify" className="font-semibold text-[#053877] hover:underline dark:text-[#8fb5e8]">Pōstify →</a>
      </p>
    </section>
  );
}
