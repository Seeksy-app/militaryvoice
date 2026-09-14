import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MyRecordings } from "@/components/MyRecordings";
import { apiRequest } from "@/lib/queryClient";
import type { PublicEvent, RecordingRow } from "@shared/schema";
import { Disc } from "lucide-react";

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

  // Only offer events that actually have something to show, plus whichever is
  // currently selected, so the filter never lists dead ends.
  const counts = new Map<number, number>();
  for (const r of recordings ?? []) counts.set(r.eventId, (counts.get(r.eventId) ?? 0) + 1);
  const options = (entries ?? []).filter((e) => counts.has(e.event.id));

  return (
    <section className="mt-6">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
        <Disc className="h-4 w-4" /> Your recordings
      </h2>
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
        Every session the studio recorded for you. Downloads are private links made fresh each time, so they can't
        be passed around by accident.
      </p>

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
    </section>
  );
}
