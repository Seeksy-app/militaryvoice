import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { TimeZoneSelect } from "@/components/TimeZoneSelect";
import { SlotCard } from "@/components/SlotCard";
import { SignupDialog } from "@/components/SignupDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Globe2, ArrowRight, Radio, Mic2, Bell } from "lucide-react";
import { resolveUploadUrl } from "@/lib/queryClient";
import type { PublicEvent, PublicSignup } from "@shared/schema";
import {
  detectLocalTimeZone,
  slotStart,
  slotEnd,
  totalSlots,
  formatDateInZone,
  formatTimeInZone,
  isHiddenGemSlot,
  primeZonesFor,
} from "@/lib/schedule";

function useCountdown(startAtUtc?: string, durationHours?: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  if (!startAtUtc || !durationHours) return { label: "", phase: "loading" as const };

  const start = new Date(startAtUtc);
  const end = new Date(start.getTime() + durationHours * 3600000);

  if (now < start) {
    const diffMs = start.getTime() - now.getTime();
    const days = Math.floor(diffMs / 86400000);
    const hours = Math.floor((diffMs % 86400000) / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    parts.push(`${hours}h`, `${mins}m`);
    return { label: `Starts in ${parts.join(" ")}`, phase: "upcoming" as const };
  }
  if (now >= start && now < end) {
    return { label: "On the air right now", phase: "live" as const };
  }
  return { label: "This marathon has wrapped", phase: "done" as const };
}

export default function Home() {
  const { data: event, isLoading: eventLoading } = useQuery<PublicEvent>({ queryKey: ["/api/event"] });
  const { data: signups, isLoading: signupsLoading } = useQuery<PublicSignup[]>({ queryKey: ["/api/signups"] });

  const [viewZone, setViewZone] = useState(detectLocalTimeZone);
  const localZone = useMemo(detectLocalTimeZone, []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);

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

  const spotlightSlots = useMemo(
    () => slots.filter((s) => !s.signup && isHiddenGemSlot(s.start)).slice(0, 4),
    [slots]
  );

  function openClaim(index: number) {
    setSelectedSlot(index);
    setDialogOpen(true);
  }

  const selected = slots.find((s) => s.index === selectedSlot);
  const openCount = slots.filter((s) => !s.signup).length;

  const nextBooked = useMemo(
    () => slots.filter((s) => s.signup && s.end > new Date()).sort((a, b) => a.start.getTime() - b.start.getTime())[0],
    [slots]
  );
  const spotlightPreview = spotlightSlots[0];

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
                24-Hour Podcast Marathon
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
                <Link href="/agenda">
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
              <div className="absolute inset-0 -rotate-2 rounded-[2rem] bg-primary" />
              <div className="relative flex flex-col gap-4 p-8">
                <div className="ml-auto w-[88%] rounded-2xl bg-card p-4 shadow-lg" data-testid="card-hero-preview-next">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next up</span>
                    <Bell className="h-3.5 w-3.5 text-primary" />
                  </div>
                  {nextBooked?.signup ? (
                    <div className="mt-3 flex items-center gap-3">
                      {nextBooked.signup.photoUrl ? (
                        <img
                          src={resolveUploadUrl(nextBooked.signup.photoUrl)}
                          alt={nextBooked.signup.hostName}
                          className="h-11 w-11 shrink-0 rounded-full object-cover ring-2 ring-primary/15"
                        />
                      ) : (
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                          <Mic2 className="h-5 w-5" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-card-foreground">{nextBooked.signup.podcastName}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {formatDateInZone(nextBooked.start, viewZone)} · {formatTimeInZone(nextBooked.start, viewZone)}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                        <Mic2 className="h-5 w-5" />
                      </div>
                      <div className="text-sm text-muted-foreground">Slots are open — be the first on the air.</div>
                    </div>
                  )}
                </div>

                <div className="w-[88%] rounded-2xl bg-card p-4 shadow-lg" data-testid="card-hero-preview-prime">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Globe2 className="h-3.5 w-3.5 text-primary" />
                    Prime time overseas
                  </div>
                  <div className="mt-3 text-sm font-medium text-card-foreground">
                    {spotlightPreview
                      ? `${formatTimeInZone(spotlightPreview.start, viewZone)} hits daytime for your overseas listeners`
                      : "Every slot is timezone-mapped for deployed listeners"}
                  </div>
                  {spotlightPreview && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {primeZonesFor(spotlightPreview.start)
                        .slice(0, 3)
                        .map((z) => (
                          <span key={z.id} className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                            {z.label}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {spotlightSlots.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
          <div className="mb-3 flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Great slots for our overseas listeners
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {spotlightSlots.map((s) => (
              <SlotCard
                key={s.index}
                index={s.index}
                start={s.start}
                end={s.end}
                viewZone={viewZone}
                signup={s.signup}
                showDate={true}
                onClaim={openClaim}
              />
            ))}
          </div>
        </section>
      )}

      <section id="schedule" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-8 sm:px-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Full schedule</h2>
        {eventLoading || signupsLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
              />
            ))}
          </div>
        )}
      </section>

      <SignupDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        slotIndex={selectedSlot}
        start={selected?.start ?? null}
        end={selected?.end ?? null}
        viewZone={viewZone}
      />
    </div>
  );
}
