import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { TimeZoneSelect } from "@/components/TimeZoneSelect";
import { SlotCard } from "@/components/SlotCard";
import { SignupDialog } from "@/components/SignupDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Globe2, ArrowRight, Radio } from "lucide-react";
import type { PublicEvent, PublicSignup } from "@shared/schema";
import {
  detectLocalTimeZone,
  slotStart,
  slotEnd,
  totalSlots,
  formatDateInZone,
  isHiddenGemSlot,
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

  return (
    <div className="min-h-screen">
      <NavBar />

      <section className="border-b border-border bg-gradient-to-b from-secondary/[0.04] to-transparent">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
          {eventLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-72" />
              <Skeleton className="h-4 w-96" />
            </div>
          ) : (
            <>
              <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <Radio className="h-3.5 w-3.5" />
                {countdown.label}
              </div>
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl" style={{ fontFamily: "'Cabinet Grotesk','General Sans',sans-serif" }} data-testid="text-event-name">
                {event?.name}
              </h1>
              <p className="mt-2 max-w-2xl text-base text-muted-foreground" data-testid="text-event-description">
                {event?.description}
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <TimeZoneSelect value={viewZone} onChange={setViewZone} onDetect={() => setViewZone(localZone)} localZone={localZone} />
                <span className="text-sm text-muted-foreground" data-testid="text-open-count">
                  {signupsLoading ? "…" : `${openCount} of ${slots.length} slots open`}
                </span>
                <Link href="/agenda" className="ml-auto">
                  <Button variant="outline" size="sm" data-testid="button-view-agenda" className="gap-1.5">
                    View shareable agenda <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
            </>
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

      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
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
