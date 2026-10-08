import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UploadRecording } from "@/components/UploadRecording";
import { MyRecordings } from "@/components/MyRecordings";
import { ClipsLibrary } from "@/components/ClipsLibrary";
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
  // Episodes or Clips; a link can open the clips (?tab=clips&ep=48).
  const q = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const [tab, setTab] = useState<"episodes" | "clips">(q.get("tab") === "clips" ? "clips" : "episodes");
  const [clipEp, setClipEp] = useState<number | null>(Number(q.get("ep")) || null);
  const showClips = (ep: number | null) => { setClipEp(ep); setTab("clips"); window.scrollTo({ top: 0, behavior: "smooth" }); };

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
  // The counts that lead somewhere are buttons: episodes, clips, and the posts on the Social calendar.
  const stats: { icon: typeof Film; n: string; label: string; go?: () => void }[] = [
    { icon: Film, n: String(originals.length), label: originals.length === 1 ? "Episode" : "Episodes", go: () => setTab("episodes") },
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
        Your episodes: every session the studio recorded, every video you've uploaded, and the clean episodes Pōstify makes.
        {/* The Zoom question, answered in the one line that has room for it. */}
        {" "}Record on Zoom?{" "}
        <a href="/host/dashboard/integrations#section-content" className="font-medium text-[#053877] underline-offset-2 hover:underline dark:text-[#8fb5e8]" data-testid="zoom-hint">Connect Zoom</a> and your recordings come in by themselves.
      </p>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <div className="col-span-2 sm:col-span-3 lg:col-span-2">
          <UploadRecording autoOpen />
        </div>
        {/* On a phone the counts are one swipeable row, so the episodes start on the first screen (8 Oct). */}
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

      {/* Two views of one Library: the episodes (with their folders), and every clip made from them. */}
      <div className="mb-4 inline-flex rounded-full border border-border bg-card p-1" role="tablist">
        {([["episodes", "Episodes", originals.length], ["clips", "Clips", clips?.length ?? 0]] as const).map(([k, label, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => (k === "clips" ? showClips(clipEp) : setTab("episodes"))} className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${tab === k ? "bg-[#053877] text-white" : "text-muted-foreground hover:text-foreground"}`} data-testid={`library-tab-${k}`}>
            {label} <span className={tab === k ? "text-white/70" : ""}>{n}</span>
          </button>
        ))}
      </div>

      {tab === "clips" ? (
        <ClipsLibrary clips={clips ?? []} posts={posts ?? []} recordings={recordings ?? []} episode={clipEp} onEpisode={setClipEp} />
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

      {/* Clips and clean episodes live in Pōstify; this page is the recordings. */}
      <p className="mt-6 text-sm text-muted-foreground">
        Clips and clean episodes are made in{" "}
        <a href="/host/dashboard/postify" className="font-semibold text-[#053877] hover:underline dark:text-[#8fb5e8]">Pōstify →</a>
      </p>
    </section>
  );
}
