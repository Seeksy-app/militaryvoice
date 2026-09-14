import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, resolveUploadUrl } from "@/lib/queryClient";
import { totalSlots, slotStart, slotEnd, formatDateInZone, formatTimeInZone, onAirWindow } from "@/lib/schedule";
import type { PublicEvent, PublicSignup } from "@shared/schema";
import { Radio, Mic2 } from "lucide-react";

// Picking a time happens inside an event, after the show is set up. It used to
// live on the dashboard against whichever event was featured, which meant you
// could claim a time for an event you had never opened — and, if you had no
// show for it, be refused by the server with no way forward from that screen.

export function EventSlotPicker({ event, disabled }: { event: PublicEvent; disabled?: boolean }) {
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
        signup: (signups ?? []).find((s) => s.slotIndex === i),
      })),
    [event, signups],
  );
  const open = slots.filter((s) => !s.signup);

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
      <p className="mb-3 text-sm text-muted-foreground">
        {open.length} open · {slots.length - open.length} taken.
      </p>
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
            </button>
          );
        })}
      </div>
    </div>
  );
}
