import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { GreenRoomButton, StudioIcon } from "@/components/GreenRoomButton";
import { formatDateInZone, formatTimeInZone, zoneLabel, detectLocalTimeZone, slotStart, onAirWindow } from "@/lib/schedule";
import type { PublicEvent } from "@shared/schema";
import { Camera, Clock, Headphones, Mic, Wifi } from "lucide-react";

interface EventEntry { event: PublicEvent; slotIndex: number | null }

const CHECKS = [
  { icon: Camera, text: "Camera at eye level, light in front of you, not behind." },
  { icon: Mic, text: "Your microphone picked in the green room, not the laptop's own." },
  { icon: Headphones, text: "Headphones on, so the stream doesn't echo back." },
  { icon: Wifi, text: "A wired connection if you can; close anything uploading." },
  { icon: Clock, text: "Come in 15 minutes before your time. The producer brings you on stage." },
];

/**
 * Events → Green room: the way into the studio for each event you're on, and
 * what to check before you go on. The room itself opens in a new tab; this is
 * the door, with your time beside it.
 */
export function GreenRoomScreen() {
  const zone = detectLocalTimeZone();
  const { data: entries, isLoading } = useQuery<EventEntry[]>({
    queryKey: ["/api/host/events"],
    queryFn: async () => (await apiRequest("GET", "/api/host/events")).json(),
  });
  if (isLoading) return null;
  const list = entries ?? [];
  return (
    <section className="mt-6" data-testid="green-room-screen">
      <div className="flex items-start gap-3">
        <StudioIcon className="h-11 w-11" tone="green" />
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Green room</h2>
          <p className="text-sm text-muted-foreground">Check your camera and mic any time. On the day, come in early and the producer brings you on stage.</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {list.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground md:col-span-2">
            You're not on an event yet. Once you have a time, your green room opens here.
          </div>
        ) : (
          list.map(({ event, slotIndex }) => {
            const href = event.isFeatured === false && event.slug ? `/event/${event.slug}/studio` : "/studio";
            // The on-air window, as everywhere else on the dashboard (the slot less its changeover).
            const air = slotIndex != null
              ? onAirWindow(slotStart(event.startAtUtc, event.slotMinutes, slotIndex), { onAirMinutes: event.onAirMinutes, bufferMinutes: event.bufferMinutes, bufferPosition: event.bufferPosition })
              : null;
            const start = air?.start ?? null;
            const end = air?.end ?? null;
            return (
              <div key={event.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5" data-testid={`green-room-${event.id}`}>
                <div>
                  <p className="font-semibold text-foreground">{event.name}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {start && end
                      ? `You're on ${formatDateInZone(start, zone)}, ${formatTimeInZone(start, zone)}–${formatTimeInZone(end, zone)} · ${zoneLabel(zone)}`
                      : "Open to you for this event"}
                  </p>
                </div>
                <div><GreenRoomButton href={href} testId={`button-green-room-${event.id}`} /></div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card p-5">
        <p className="text-sm font-semibold text-foreground">Before you go on</p>
        <ul className="mt-3 space-y-2.5">
          {CHECKS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 text-sm text-foreground/85">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"><Icon className="h-4 w-4" /></span>
              {text}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
