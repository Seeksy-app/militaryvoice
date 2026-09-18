import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EventShowForm, type EventShow } from "@/components/EventShowForm";
import { EventSlotPicker } from "@/components/EventSlotPicker";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiRequest } from "@/lib/queryClient";
import { formatDateInZone, formatTimeInZone, zoneLabel, detectLocalTimeZone, slotStart, slotEnd, onAirWindow } from "@/lib/schedule";
import { isLiveOnlyBlock } from "@shared/slots";
import type { PublicEvent } from "@shared/schema";
import { CalendarDays, ChevronRight, ArrowLeft, Check, Clock, Trash2, Headphones, Megaphone } from "lucide-react";

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
  onOpenPromotion,
  children,
}: {
  profilePhotoUrl?: string;
  /** Send them to the slot picker for this event. */
  onPickSlot: (eventId: number) => void;
  /** Promotion lives in its own tab; this is the way there. */
  onOpenPromotion: () => void;
  /** Show materials / Stream / Recordings, rendered once an event is chosen. */
  children?: (entry: EventEntry) => React.ReactNode;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const zone = detectLocalTimeZone();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: entries, isLoading } = useQuery<EventEntry[]>({
    queryKey: ["/api/host/events"],
    queryFn: async () => (await apiRequest("GET", "/api/host/events")).json(),
  });

  const { data: openShow } = useQuery<EventShow>({
    queryKey: ["/api/host/shows", openId],
    queryFn: async () => (await apiRequest("GET", `/api/host/shows/${openId}`)).json(),
    enabled: openId != null,
  });

  const removeSlot = useMutation({
    mutationFn: async (signupId: number) => apiRequest("DELETE", `/api/host/signups/${signupId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/host/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/host/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/signups"] });
      toast({ title: "Time released", description: "That slot is back on the open schedule." });
    },
    onError: (err: Error) =>
      toast({ title: "Couldn't release that time", description: err.message, variant: "destructive" }),
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

  const onAirLabel =
    open?.slotIndex != null
      ? (() => {
          const air = onAirWindow(slotStart(open.event.startAtUtc, open.event.slotMinutes, open.slotIndex), {
            onAirMinutes: open.event.onAirMinutes,
            bufferMinutes: open.event.bufferMinutes,
            bufferPosition: open.event.bufferPosition,
          });
          return `${formatDateInZone(air.start, zone)} · ${formatTimeInZone(air.start, zone)}–${formatTimeInZone(air.end, zone)}`;
        })()
      : "";

  // The event's own studio is at /studio; anything that isn't the site's
  // featured event is reached through its slug.
  const greenRoomHref =
    open?.event.isFeatured === false && open.event.slug ? `/event/${open.event.slug}/studio` : "/studio";

  // Daytime slots have to be broadcast live, so the show form hides the
  // recorded-episode option for anyone holding one.
  const heldSlotIsLiveOnly =
    open?.slotIndex != null &&
    isLiveOnlyBlock(
      slotStart(open.event.startAtUtc, open.event.slotMinutes, open.slotIndex),
      slotEnd(open.event.startAtUtc, open.event.slotMinutes, open.slotIndex),
    );

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
      const timeLabel = booked
        ? formatTimeInZone(
            onAirWindow(slotStart(entry.event.startAtUtc, entry.event.slotMinutes, entry.slotIndex!), {
              onAirMinutes: entry.event.onAirMinutes,
              bufferMinutes: entry.event.bufferMinutes,
              bufferPosition: entry.event.bufferPosition,
            }).start,
            zone,
          )
        : null;

      return (
        <button
          key={entry.event.id}
          type="button"
          onClick={() => setOpenId(entry.event.id)}
          // A row, not a poster. One event or six, it reads the same.
          className="group flex w-full items-stretch overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-primary/50 hover:bg-[#053877]/[0.02]"
          data-testid={`button-choose-event-${entry.event.id}`}
        >
          {entry.event.imageUrl && (
            <img
              src={entry.event.imageUrl}
              alt=""
              // Fixed 4:3 so the mark is never sliced by an odd container height.
              className="hidden aspect-[4/3] w-[132px] shrink-0 object-cover sm:block"
              loading="lazy"
            />
          )}

          <div className="flex min-w-0 flex-1 items-center gap-4 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-bold leading-tight text-foreground group-hover:text-primary">
                {entry.event.name}
              </div>
              <div className="mt-0.5 text-[15px] text-muted-foreground">
                {formatDateInZone(new Date(entry.event.startAtUtc), zone)} · {entry.event.durationHours} hours
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
                <span
                  className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 font-semibold ${
                    ready ? "bg-primary/10 text-primary" : "border border-dashed border-border text-muted-foreground"
                  }`}
                >
                  {ready && <Check className="h-3 w-3 shrink-0" />}
                  <span className="truncate">{ready ? entry.show!.showName : "Show not set up"}</span>
                </span>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                    booked ? "bg-[#F0A71F]/25 text-[#7a5200]" : "border border-dashed border-border text-muted-foreground"
                  }`}
                >
                  <Clock className="h-3 w-3" />
                  {timeLabel ?? "No time yet"}
                </span>
              </div>
            </div>

            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </div>
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

      {/* ------------------------------------------------ time slot */}
      <div className="mt-4 scroll-mt-24 rounded-2xl border border-border bg-card p-5" id="your-time-slot">
        <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
          {open.slotIndex != null ? "Your time slot" : "Choose a time"}
        </h3>
        {open.slotIndex != null ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#053877]/20 bg-[#053877]/[0.05] px-4 py-3">
            <div className="min-w-0">
              <p className="text-lg font-bold leading-tight text-[#053877]">{onAirLabel}</p>
              <p className="text-xs text-muted-foreground">
                {zoneLabel(zone)} · you're on the schedule for {open.event.name}.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" /> Remove this time
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Give up this time?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {onAirLabel} goes back on the open schedule for anyone to claim, and you can pick a different
                    time straight after. Anyone who set a reminder for this slot won't be notified.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => open.signupId != null && removeSlot.mutate(open.signupId)}
                    data-testid="button-remove-slot"
                  >
                    {removeSlot.isPending ? "Removing…" : "Remove it"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : (
          <>
            <p className="mb-3 mt-1 text-sm text-muted-foreground">
              {open.show?.showName
                ? "Tap any open time to take it."
                : "Save your show above first — a slot needs a show attached to it."}
            </p>
            <EventSlotPicker
              event={open.event}
              disabled={!open.show?.showName}
              showFormat={openShow?.showFormat ?? open.show?.showFormat}
            />
          </>
        )}
      </div>

      {/* ------------------------------------------------ green room */}
      {/* Open whenever they want it, not just on the day. The first time
          anyone discovers their microphone is the wrong one should not be
          ninety seconds before they go on. */}
      <div className="mt-4 rounded-2xl border border-border bg-card p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
          <Headphones className="h-4 w-4" /> Green room
        </h3>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Your waiting room for {open.event.name}. Check your camera, microphone and speakers, see yourself the way the
          audience will, and set your levels. Nothing you do in here goes on air — the producer brings you onto the
          stage when it's your turn.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <a href={greenRoomHref} target="_blank" rel="noreferrer" data-testid="link-green-room">
            <Button className="gap-1.5 rounded-full">
              <Headphones className="h-4 w-4" /> Enter the green room
            </Button>
          </a>
          <span className="text-xs text-muted-foreground">
            Open any time. Worth a two-minute check this week.
          </span>
        </div>
      </div>

      {openShow && (
        <div className="mt-6">
          <EventShowForm
            eventId={open.event.id}
            eventName={open.event.name}
            show={openShow}
            profilePhotoUrl={profilePhotoUrl}
            liveOnlySlot={heldSlotIsLiveOnly}
            onSaved={() => {}}
          />
        </div>
      )}

      {children?.(open)}

      {/* Promotion has its own tab now. It sat here, underneath the work,
          which meant people finished the work and left — and promotion is
          what decides whether anyone is watching. */}
      {open.slotIndex != null && open.signupId != null && (
        <button
          type="button"
          onClick={onOpenPromotion}
          className="mt-6 flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-5 text-left transition-colors hover-elevate"
          data-testid="link-to-promotion"
        >
          <span className="min-w-0">
            <span className="flex items-center gap-2 font-semibold text-foreground">
              <Megaphone className="h-4 w-4 text-primary" /> Get people watching
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              Your share card, a posting plan for the days before, and the clips we cut afterwards.
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
            Open Promotion <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </button>
      )}
    </section>
  );
}
