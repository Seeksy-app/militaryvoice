import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UploadRecording } from "@/components/UploadRecording";
import { MyRecordings } from "@/components/MyRecordings";
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
  const [eventId, setEventId] = useState<number | null>(null);

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
  const originals = (recordings ?? []).filter((r) => r.status === "Ready" && !r.egressId.startsWith("CLEAN_"));
  const hours = originals.reduce((n, r) => n + r.durationSec, 0) / 3600;
  const saved = (recordings ?? []).reduce((n, r) => {
    try { return n + (r.clean ? ((JSON.parse(r.clean) as CleanResult).removedSec ?? 0) : 0); } catch { return n; }
  }, 0);
  const stats = [
    { icon: Film, n: String(originals.length), label: originals.length === 1 ? "Episode" : "Episodes" },
    { icon: Clock3, n: hours >= 1 ? hours.toFixed(1) : `${Math.round(hours * 60)}m`, label: hours >= 1 ? "Hours recorded" : "Recorded" },
    { icon: Scissors, n: String(clips?.length ?? 0), label: "Clips made" },
    { icon: Send, n: String(posts?.filter((p) => p.status !== "failed").length ?? 0), label: "Posts sent" },
    { icon: Timer, n: saved >= 60 ? `${Math.floor(saved / 60)}:${String(Math.round(saved % 60)).padStart(2, "0")}` : `${Math.round(saved)}s`, label: "Time saved" },
  ];

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
        Your episodes: every session the studio recorded, every video you've uploaded, and the clean episodes Pōstify makes.
      </p>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <div className="col-span-2 sm:col-span-3 lg:col-span-2">
          <UploadRecording />
          {/* The Zoom question, answered where they'd ask it. */}
          <p className="mt-1.5 px-1 text-[11px] text-muted-foreground" data-testid="zoom-hint">
            From Zoom? Open <a href="https://zoom.us/recording" target="_blank" rel="noreferrer" className="font-medium text-[#053877] underline-offset-2 hover:underline dark:text-[#8fb5e8]">zoom.us/recording</a>, download the MP4 and drop it here — or <a href="/host/dashboard/integrations#import-link" className="font-medium text-[#053877] underline-offset-2 hover:underline dark:text-[#8fb5e8]">make it automatic</a>.
          </p>
        </div>
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col justify-center rounded-2xl border border-border bg-card px-4 py-3" data-testid={`library-stat-${s.label}`}>
            <s.icon className="h-4 w-4 text-[#b36b00] dark:text-[#F0A71F]" />
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">{s.n}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
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
