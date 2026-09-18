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

      {/* ------------------------------------- slot and green room, in one line */}
      {/* Two full-width cards to say one time and offer one button was most of
          a screen before anybody reached the thing they came to do. The slot
          is a clock and a time; the green room is the button beside it. */}
      {open.slotIndex != null ? (
        <div
          className="mt-4 flex scroll-mt-24 flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-border bg-card px-5 py-4"
          id="your-time-slot"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#053877]/10 text-[#053877]">
              <Clock className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-base font-bold leading-tight text-[#053877] dark:text-[#8ab4f8]">
                {onAirLabel}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {zoneLabel(zone)} · you're on the schedule
              </span>
            </span>
          </div>

          <span className="hidden h-8 w-px bg-border sm:block" aria-hidden="true" />

          <a href={greenRoomHref} target="_blank" rel="noreferrer" data-testid="link-green-room">
            <Button className="gap-1.5 rounded-full">
              <Headphones className="h-4 w-4" /> Enter the green room
            </Button>
          </a>
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            Check your camera, mic and lighting. Open any time — nothing in there goes on air.
          </span>

          {/* Giving up a slot is rare and permanent, so it sits at the far end
              looking like what it is rather than beside the primary action. */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="shrink-0 gap-1.5 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" /> Remove
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
                  disabled={removeSlot.isPending}
                  data-testid="button-remove-slot"
                >
                  {removeSlot.isPending ? "Removing…" : "Remove it"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : (
        <div className="mt-4 scroll-mt-24 rounded-2xl border border-border bg-card p-5" id="your-time-slot">
          <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-foreground">Choose a time</h3>
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
        </div>
      )}

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

      {/* What to do next, at the point they've finished.
          The page saves as it goes, so there is no Save button to end on and
          nothing telling anyone they're done — people got to the bottom of a
          long form, found no full stop, and left. This is the full stop, and
          it points at the thing that actually decides whether anyone watches. */}
      {open.slotIndex != null && open.signupId != null && (
        <div
          className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-primary/25 bg-primary/5 p-5"
          data-testid="link-to-promotion"
        >
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Check className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-foreground">That's your show set up — it saves as you go.</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Next: get people watching. Your share card, a posting plan for the days before, and the clips we cut
                afterwards.
              </p>
            </div>
          </div>
          <Button onClick={onOpenPromotion} className="shrink-0 gap-1.5 rounded-full" data-testid="button-next-promotion">
            <Megaphone className="h-4 w-4" /> Go to Promotion <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </section>
  );
}
