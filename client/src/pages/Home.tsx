import { useMemo, useState } from "react";
import { useCountdown } from "@/hooks/use-countdown";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { NavBar } from "@/components/NavBar";
import { TimeZoneSelect } from "@/components/TimeZoneSelect";
import { SlotCard } from "@/components/SlotCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, Radio, Mic2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { PublicEvent, PublicSignup } from "@shared/schema";
import {
  detectLocalTimeZone,
  slotStart,
  slotEnd,
  totalSlots,
  formatDateInZone,
  formatTimeInZone,
} from "@/lib/schedule";

interface Props {
  slug?: string;
}

/**
 * Right-hand visual on the schedule hero. Uses /schedule-hero.jpg (drop a
 * photo of podcasters into client/public) and falls back to an on-air
 * graphic until one exists.
 */
function HeroArt() {
  const [photoOk, setPhotoOk] = useState(false);
  const bars = [14, 26, 40, 22, 34, 48, 30, 18, 38, 26, 44, 20, 32, 16];
  return (
    <div className="relative">
      <div className="absolute inset-0 -rotate-2 rounded-[2rem] bg-[#F0A71F]/90" aria-hidden="true" />
      <div className="relative aspect-[4/3] overflow-hidden rounded-[1.75rem] bg-[#053877] shadow-2xl">
        <img
          src="/schedule-hero.jpg"
          alt="Podcasters recording together"
          onLoad={() => setPhotoOk(true)}
          className={`h-full w-full object-cover ${photoOk ? "" : "hidden"}`}
        />
        {!photoOk && (
          <div className="flex h-full w-full flex-col items-center justify-center gap-6 p-8 text-white" aria-hidden="true">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" /> On air
            </div>
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 ring-8 ring-white/5">
              <Mic2 className="h-12 w-12 text-[#F0A71F]" />
            </div>
            <div className="flex h-14 items-end gap-1.5">
              {bars.map((h, i) => (
                <span
                  key={i}
                  className="w-2 rounded-full bg-white/70"
                  style={{ height: `${h}px`, animation: `mvbar 1.${(i % 5) + 2}s ease-in-out ${i * 0.07}s infinite alternate` }}
                />
              ))}
            </div>
            <style>{`@keyframes mvbar { from { transform: scaleY(0.4); } to { transform: scaleY(1.15); } }`}</style>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home({ slug }: Props) {
  const [, navigate] = useLocation();
  const { data: event, isLoading: eventLoading } = useQuery<PublicEvent>({
    queryKey: ["/api/event", slug ?? "featured"],
    queryFn: async () => {
      const res = await apiRequest("GET", slug ? `/api/event?slug=${encodeURIComponent(slug)}` : "/api/event");
      return res.json();
    },
  });
  const { data: signups, isLoading: signupsLoading } = useQuery<PublicSignup[]>({
    queryKey: ["/api/signups", event?.id ?? "none"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/signups?eventId=${event!.id}`);
      return res.json();
    },
    enabled: !!event,
  });

  const [viewZone, setViewZone] = useState(detectLocalTimeZone);
  const localZone = useMemo(detectLocalTimeZone, []);

  const countdown = useCountdown(event?.startAtUtc, event?.durationHours);

  const slots = useMemo(() => {
    if (!event) return [];
    const n = totalSlots(event.durationHours, event.slotMinutes);
    let lastDate = "";
    return Array.from({ length: n }, (_, i) => {
      const start = slotStart(event.startAtUtc, event.slotMinutes, i);
      const end = slotEnd(event.startAtUtc, event.slotMinutes, i);
      const dateLabel = formatDateInZone(start, viewZone);
      const showDate = dateLabel !== lastDate;
      lastDate = dateLabel;
      const signup = signups?.find((s) => s.slotIndex === i && s.status !== "cancelled");
      return { index: i, start, end, showDate, signup };
    });
  }, [event, signups, viewZone]);

  function openClaim(index: number) {
    // Pick the time first, then sign in / set up the profile on the dashboard
    // with this slot held (?slot=&event=). Claiming completes there.
    navigate(`/host/dashboard?slot=${index}${event ? `&event=${event.id}` : ""}`);
  }

  const openCount = slots.filter((s) => !s.signup).length;
  const bookedCount = slots.length - openCount;

  const onAirSettings = event
    ? { onAirMinutes: event.onAirMinutes, bufferMinutes: event.bufferMinutes, bufferPosition: event.bufferPosition }
    : undefined;

  return (
    <div className="min-h-screen">
      <NavBar />

      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          {eventLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-72" />
              <Skeleton className="h-4 w-96" />
            </div>
          ) : (
            <div>
              <div className="mb-4 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                <span className="inline-block h-2.5 w-4 rounded-full bg-primary" />
                Live schedule · pick your slot
              </div>
              <h1
                className="text-3xl font-bold leading-[1.08] tracking-tight text-foreground sm:text-4xl lg:text-[2.75rem]"
                style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}
                data-testid="text-event-name"
              >
                {event?.name}
              </h1>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground" data-testid="text-event-description">
                {event?.description}
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Button
                  size="lg"
                  className="rounded-full px-6 gap-1.5"
                  data-testid="button-hero-claim"
                  onClick={() => document.getElementById("schedule")?.scrollIntoView({ behavior: "smooth" })}
                >
                  Claim a slot <ArrowRight className="h-4 w-4" />
                </Button>
                <Link href={slug ? `/event/${slug}/agenda` : "/agenda"}>
                  <Button variant="outline" size="lg" className="rounded-full px-6" data-testid="button-view-agenda">
                    View shareable agenda
                  </Button>
                </Link>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
                  <Radio className="h-3.5 w-3.5" />
                  {countdown.label}
                </div>
                <span className="text-sm text-muted-foreground" data-testid="text-open-count">
                  {signupsLoading ? "…" : `${openCount} of ${slots.length} slots open`}
                </span>
              </div>

              <div className="mt-5 max-w-sm">
                <TimeZoneSelect value={viewZone} onChange={setViewZone} onDetect={() => setViewZone(localZone)} localZone={localZone} />
              </div>
            </div>
          )}

          {!eventLoading && (
            <div className="relative hidden lg:block">
              <HeroArt />
            </div>
          )}
        </div>
      </section>

      <section id="schedule" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-8 sm:px-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Pick your slot</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Every half hour in order, so you can see who's on before and after you. Taken slots show who has them.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1">
              <span className="h-2 w-2 rounded-full bg-primary" /> {openCount} open
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1">
              <span className="h-2 w-2 rounded-full bg-[#F0A71F]" /> {bookedCount} taken
            </span>
          </div>
        </div>
        {eventLoading || signupsLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {slots.map((s) => (
              <SlotCard
                key={s.index}
                index={s.index}
                start={s.start}
                end={s.end}
                viewZone={viewZone}
                signup={s.signup}
                showDate={s.showDate}
                onClaim={openClaim}
                onAirSettings={onAirSettings}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
