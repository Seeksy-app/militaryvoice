import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EventShowForm, type EventShow } from "@/components/EventShowForm";
import { EventSlotPicker } from "@/components/EventSlotPicker";
import { ShareYourSlot } from "@/components/ShareYourSlot";
import { apiRequest } from "@/lib/queryClient";
import { formatDateInZone, formatTimeInZone, detectLocalTimeZone, slotStart, onAirWindow } from "@/lib/schedule";
import type { PublicEvent } from "@shared/schema";
import { CalendarDays, ChevronRight, ArrowLeft, Check, Clock } from "lucide-react";

// Choose an event, then set up the show you're bringing to it. Everything
// about one event lives behind its own card, so a podcaster in two events
// never has to wonder which one they're editing.

interface EventEntry {
  event: PublicEvent;
  show: EventShow | null;
  slotIndex: number | null;
  signupId: number | null;
}

export function EventSettings({
  profilePhotoUrl,
  onPickSlot,
  children,
}: {
  profilePhotoUrl?: string;
  /** Send them to the slot picker for this event. */
  onPickSlot: (eventId: number) => void;
  /** Show materials / Stream / Recordings, rendered once an event is chosen. */
  children?: (entry: EventEntry) => React.ReactNode;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const zone = detectLocalTimeZone();

  const { data: entries, isLoading } = useQuery<EventEntry[]>({
    queryKey: ["/api/host/events"],
    queryFn: async () => (await apiRequest("GET", "/api/host/events")).json(),
  });

  const { data: openShow } = useQuery<EventShow>({
    queryKey: ["/api/host/shows", openId],
    queryFn: async () => (await apiRequest("GET", `/api/host/shows/${openId}`)).json(),
    enabled: openId != null,
  });

  if (isLoading) {
    return (
      <div className="mt-6 space-y-3">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }

  const open = entries?.find((e) => e.event.id === openId) ?? null;

  // ------------------------------------------------------------ chooser
  if (!open) {
    const all = entries ?? [];
    // Setting up a show for an event is what joining it means — there is no
    // separate registration to keep in step with anything.
    const mine = all.filter((e) => !!e.show?.showName);
    const joinable = all.filter((e) => !e.show?.showName);

    const card = (entry: EventEntry) => {
      const ready = !!entry.show?.showName;
      const booked = entry.slotIndex != null;
      return (
              <button
                key={entry.event.id}
                type="button"
                onClick={() => setOpenId(entry.event.id)}
                className="group flex items-center justify-between gap-4 rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/40 hover:shadow-md"
                data-testid={`button-choose-event-${entry.event.id}`}
              >
                <div className="min-w-0">
                  <div className="text-base font-semibold group-hover:text-primary">{entry.event.name}</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    {formatDateInZone(new Date(entry.event.startAtUtc), zone)} · {entry.event.durationHours} hours
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                        ready ? "bg-primary/10 text-primary" : "border border-border bg-card text-muted-foreground"
                      }`}
                    >
                      {ready ? <Check className="h-3 w-3" /> : null}
                      {ready ? `Show: ${entry.show!.showName}` : "Show not set up"}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                        booked ? "bg-[#F0A71F]/20 text-[#8a5d00]" : "border border-border bg-card text-muted-foreground"
                      }`}
                    >
                      <Clock className="h-3 w-3" />
                      {booked
                        ? formatTimeInZone(
                            onAirWindow(
                              slotStart(entry.event.startAtUtc, entry.event.slotMinutes, entry.slotIndex!),
                              {
                                onAirMinutes: entry.event.onAirMinutes,
                                bufferMinutes: entry.event.bufferMinutes,
                                bufferPosition: entry.event.bufferPosition,
                              },
                            ).start,
                            zone,
                          )
                        : "No time yet"}
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-primary" />
              </button>
      );
    };

    return (
      <section className="mt-6 flex flex-col gap-8">
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
            <CalendarDays className="h-4 w-4" /> Your events
          </h2>
          {mine.length === 0 ? (
            <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
              You haven't joined an event yet. Pick one below and set your show up for it.
            </p>
          ) : (
            <div className="flex flex-col gap-3">{mine.map(card)}</div>
          )}
        </div>

        {joinable.length > 0 && (
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
              <CalendarDays className="h-4 w-4" /> Events you can join
            </h2>
            <div className="flex flex-col gap-3">{joinable.map(card)}</div>
          </div>
        )}
      </section>
    );
  }

  // ------------------------------------------------------- one event
  return (
    <section className="mt-6">
      <button
        type="button"
        onClick={() => setOpenId(null)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        data-testid="button-back-to-events"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All events
      </button>

      <h2 className="text-xl font-bold tracking-tight">{open.event.name}</h2>

      {openShow && (
        <div className="mt-4">
          <EventShowForm
            eventId={open.event.id}
            eventName={open.event.name}
            show={openShow}
            profilePhotoUrl={profilePhotoUrl}
            onSaved={() => {}}
          />
        </div>
      )}

      {/* ------------------------------------------------ time slot */}
      <div className="mt-6 rounded-2xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-foreground">Your time slot</h3>
        {open.slotIndex != null ? (
          <p className="mt-2 text-sm">
            <span className="font-semibold">
              {formatDateInZone(
                onAirWindow(slotStart(open.event.startAtUtc, open.event.slotMinutes, open.slotIndex), {
                  onAirMinutes: open.event.onAirMinutes,
                  bufferMinutes: open.event.bufferMinutes,
                  bufferPosition: open.event.bufferPosition,
                }).start,
                zone,
              )}{" "}
              ·{" "}
              {formatTimeInZone(
                onAirWindow(slotStart(open.event.startAtUtc, open.event.slotMinutes, open.slotIndex), {
                  onAirMinutes: open.event.onAirMinutes,
                  bufferMinutes: open.event.bufferMinutes,
                  bufferPosition: open.event.bufferPosition,
                }).start,
                zone,
              )}
            </span>{" "}
            <span className="text-muted-foreground">— you're on the schedule.</span>
          </p>
        ) : (
          <>
            <p className="mb-3 mt-1 text-sm text-muted-foreground">
              {open.show?.showName
                ? "Tap any open time to take it."
                : "Save your show above first — a slot needs a show attached to it."}
            </p>
            <EventSlotPicker event={open.event} disabled={!open.show?.showName} />
          </>
        )}
      </div>

      {open.slotIndex != null && open.signupId != null && (
        <ShareYourSlot
          signupId={open.signupId}
          podcastName={open.show?.showName || open.event.name}
          whenLabel={`${formatDateInZone(
            onAirWindow(slotStart(open.event.startAtUtc, open.event.slotMinutes, open.slotIndex), {
              onAirMinutes: open.event.onAirMinutes,
              bufferMinutes: open.event.bufferMinutes,
              bufferPosition: open.event.bufferPosition,
            }).start,
            zone,
          )} at ${formatTimeInZone(
            onAirWindow(slotStart(open.event.startAtUtc, open.event.slotMinutes, open.slotIndex), {
              onAirMinutes: open.event.onAirMinutes,
              bufferMinutes: open.event.bufferMinutes,
              bufferPosition: open.event.bufferPosition,
            }).start,
            zone,
          )}`}
        />
      )}

      {children?.(open)}
    </section>
  );
}
