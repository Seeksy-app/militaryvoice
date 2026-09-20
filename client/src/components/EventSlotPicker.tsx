import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, resolveUploadUrl } from "@/lib/queryClient";
import { totalSlots, slotStart, slotEnd, formatDateInZone, formatTimeInZone, onAirWindow } from "@/lib/schedule";
import { isLiveOnlyBlock, LIVE_ONLY_LABEL } from "@shared/slots";
import type { PublicEvent, PublicSignup } from "@shared/schema";
import { Radio, Mic2, Lock } from "lucide-react";

// Picking a time happens inside an event, after the show is set up. It used to
// live on the dashboard against whichever event was featured, which meant you
// could claim a time for an event you had never opened — and, if you had no
// show for it, be refused by the server with no way forward from that screen.

export function EventSlotPicker({
  event,
  disabled,
  showFormat,
}: {
  event: PublicEvent;
  disabled?: boolean;
  /** How their show runs. Daytime slots are live only, so a recorded show
      can't take one — said on the slot itself rather than after the click. */
  showFormat?: string;
}) {
  const recorded = showFormat === "prerecorded";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

  const { data: signups } = useQuery<PublicSignup[]>({
    queryKey: ["/api/signups", event.id],
    queryFn: async () => (await apiRequest("GET", `/api/signups?eventId=${event.id}`)).json(),
  });

  const slots = useMemo(
    () =>
      Array.from({ length: totalSlots(event.durationHours, event.slotMinutes) }, (_, i) => ({
        index: i,
        start: slotStart(event.startAtUtc, event.slotMinutes, i),
        end: slotEnd(event.startAtUtc, event.slotMinutes, i),
        liveOnly: isLiveOnlyBlock(
          slotStart(event.startAtUtc, event.slotMinutes, i),
          slotEnd(event.startAtUtc, event.slotMinutes, i),
        ),
        signup: (signups ?? []).find((s) => s.slotIndex === i),
      })),
    [event, signups],
  );
  const open = slots.filter((s) => !s.signup);
  const full = slots.length > 0 && open.length === 0;
  // Closed outranks full. Full is a count and a cancellation undoes it; closed
  // is somebody's decision that the lineup is set, and it has to survive one.
  const closed = event.closed === true;

  const claim = useMutation({
    mutationFn: async (slotIndex: number) =>
      apiRequest("POST", "/api/signups", { slotIndex, eventId: event.id, timezone: zone }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signups", event.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/host/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/host/dashboard"] });
      toast({ title: "You're on the schedule", description: "This slot is now yours." });
    },
    onError: (err: Error) => toast({ title: "Couldn't take that slot", description: err.message, variant: "destructive" }),
  });

  if (!signups) return <p className="text-sm text-muted-foreground">Loading the schedule…</p>;
  if (slots.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">The schedule isn't published yet — check back shortly.</p>
    );
  }

  return (
    <div>
      {/* Said plainly, once, at the top. A grid of thirty-two greyed-out
          buttons is not an answer to "when can I go on" — somebody has to read
          every one of them to work out there is nothing left. */}
      {closed ? (
        <p
          className="mb-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm font-semibold text-foreground"
          data-testid="text-lineup-closed"
        >
          The lineup is closed.{" "}
          <span className="font-normal text-muted-foreground">
            Every slot is spoken for and the running order is set. Nothing further is being
            taken, and a slot that frees up stays closed.
          </span>
        </p>
      ) : (
        full && (
          <p
            className="mb-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm font-semibold text-foreground"
            data-testid="text-all-slots-taken"
          >
            All slots are taken.{" "}
            <span className="font-normal text-muted-foreground">
              Every time on this event is spoken for. If one frees up it will appear here.
            </span>
          </p>
        )
      )}
      {!closed && (
        <p className="mb-3 text-sm text-muted-foreground">
          {open.length} open · {slots.length - open.length} taken.{" "}
          {recorded
            ? `Times between ${LIVE_ONLY_LABEL} are live only, so they're closed to a recorded episode.`
            : `Times between ${LIVE_ONLY_LABEL} are live only.`}
        </p>
      )}
      <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {slots.map((s) => {
          const air = onAirWindow(s.start, {
            onAirMinutes: event.onAirMinutes,
            bufferMinutes: event.bufferMinutes,
            bufferPosition: event.bufferPosition,
          });
          const header = (
            <>
              <div className="text-xs font-medium uppercase tracking-[0.08em] text-foreground">
                {formatDateInZone(air.start, zone)}
              </div>
              <div className="tabular-nums font-semibold">
                {formatTimeInZone(air.start, zone)}–{formatTimeInZone(air.end, zone)}
              </div>
            </>
          );

          if (s.signup) {
            return (
              <div key={s.index} className="rounded-lg border border-border bg-card p-3 text-sm">
                {header}
                <div className="mt-2 flex items-center gap-2">
                  {s.signup.photoUrl ? (
                    <img src={resolveUploadUrl(s.signup.photoUrl)} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent">
                      <Mic2 className="h-3.5 w-3.5" />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{s.signup.podcastName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{s.signup.hostName}</span>
                  </span>
                </div>
              </div>
            );
          }

          // Empty, but not on offer. Rendered as a tile rather than a
          // disabled button so nobody clicks it hoping.
          if (closed) {
            return (
              <div
                key={s.index}
                className="rounded-lg border border-dashed border-border bg-muted/30 p-3 text-sm opacity-70"
                data-testid={`slot-closed-${s.index}`}
              >
                {header}
                <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  <Lock className="h-3 w-3" /> Closed
                </span>
              </div>
            );
          }

          // Open, but not to them: a recorded show can't take a daytime slot.
          if (s.liveOnly && recorded) {
            return (
              <div
                key={s.index}
                className="rounded-lg border border-dashed border-border bg-muted/30 p-3 text-sm opacity-70"
                data-testid={`slot-live-only-${s.index}`}
              >
                {header}
                <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  <Lock className="h-3 w-3" /> Live only
                </span>
              </div>
            );
          }

          return (
            <button
              key={s.index}
              type="button"
              disabled={disabled || claim.isPending}
              onClick={() => claim.mutate(s.index)}
              className="rounded-lg border border-border bg-card p-3 text-left text-sm transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid={`button-take-slot-${s.index}`}
            >
              {header}
              <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-primary">
                <Radio className="h-3 w-3" /> {claim.isPending ? "Taking…" : "Open"}
              </span>
              {s.liveOnly && (
                <span className="mt-1 block text-xs text-muted-foreground">Live only</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
