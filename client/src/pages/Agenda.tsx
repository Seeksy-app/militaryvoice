import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavBar } from "@/components/NavBar";
import { TimeZoneSelect } from "@/components/TimeZoneSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Copy, Globe2, Mic2, Video, Presentation, Image as ImageIcon, HeadphonesIcon } from "lucide-react";
import type { PublicEvent, PublicSignup } from "@shared/schema";
import {
  detectLocalTimeZone,
  slotStart,
  slotEnd,
  totalSlots,
  formatDateInZone,
  formatTimeInZone,
  primeZonesFor,
  isHiddenGemSlot,
  zoneLabel,
} from "@/lib/schedule";

export default function Agenda() {
  const { data: event, isLoading: eventLoading } = useQuery<PublicEvent>({ queryKey: ["/api/event"] });
  const { data: signups, isLoading: signupsLoading } = useQuery<PublicSignup[]>({ queryKey: ["/api/signups"] });
  const { toast } = useToast();

  const [viewZone, setViewZone] = useState(detectLocalTimeZone);
  const localZone = useMemo(detectLocalTimeZone, []);

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
      return { index: i, start, end, showDate, dateLabel, signup };
    });
  }, [event, signups, viewZone]);

  function copyAgenda() {
    if (!event) return;
    const lines = [`${event.name} — Agenda (${zoneLabel(viewZone)})`, ""];
    let lastDate = "";
    for (const s of slots) {
      if (s.dateLabel !== lastDate) {
        lines.push(`— ${s.dateLabel} —`);
        lastDate = s.dateLabel;
      }
      const time = `${formatTimeInZone(s.start, viewZone)}–${formatTimeInZone(s.end, viewZone)}`;
      lines.push(s.signup ? `${time}  ${s.signup.podcastName}` : `${time}  OPEN — sign up now`);
    }
    navigator.clipboard.writeText(lines.join("\n")).then(
      () => toast({ title: "Agenda copied", description: "Paste it anywhere — social captions, show notes, emails." }),
      () => toast({ title: "Couldn't copy", variant: "destructive" })
    );
  }

  return (
    <div className="min-h-screen">
      <NavBar />

      <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        {eventLoading ? (
          <Skeleton className="h-8 w-72" />
        ) : (
          <>
            <h1
              className="text-xl font-bold tracking-tight sm:text-2xl"
              style={{ fontFamily: "'Cabinet Grotesk','General Sans',sans-serif" }}
              data-testid="text-agenda-title"
            >
              {event?.name} — On-Air Agenda
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Share this page, or copy it as text for social captions and show notes.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <TimeZoneSelect value={viewZone} onChange={setViewZone} onDetect={() => setViewZone(localZone)} localZone={localZone} />
              <Button variant="outline" size="sm" onClick={copyAgenda} className="gap-1.5" data-testid="button-copy-agenda">
                <Copy className="h-3.5 w-3.5" /> Copy as text
              </Button>
            </div>
          </>
        )}

        <div className="mt-8 divide-y divide-border rounded-lg border border-border">
          {signupsLoading || eventLoading
            ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
            : slots.map((s) => {
                const prime = primeZonesFor(s.start);
                const gem = isHiddenGemSlot(s.start);
                return (
                  <div key={s.index} className="flex flex-col gap-1 p-4" data-testid={`row-agenda-${s.index}`}>
                    {s.showDate && (
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">{s.dateLabel}</div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm font-semibold tabular-nums">
                          {formatTimeInZone(s.start, viewZone)}–{formatTimeInZone(s.end, viewZone)}
                        </span>
                        {s.signup ? (
                          <span className="flex items-center gap-1.5 text-sm font-medium" data-testid={`text-agenda-podcast-${s.index}`}>
                            <Mic2 className="h-3.5 w-3.5 text-primary" /> {s.signup.podcastName}
                          </span>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            Open — up for grabs
                          </Badge>
                        )}
                      </div>
                      {s.signup && (
                        <div className="flex flex-wrap gap-1">
                          {s.signup.hasVideoIntro && <Video className="h-3.5 w-3.5 text-muted-foreground" aria-label="Video intro" />}
                          {s.signup.hasVideoOutro && <Video className="h-3.5 w-3.5 scale-x-[-1] text-muted-foreground" aria-label="Video outro" />}
                          {s.signup.hasSlides && <Presentation className="h-3.5 w-3.5 text-muted-foreground" aria-label="Slides" />}
                          {s.signup.hasImages && <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" aria-label="Images" />}
                          {s.signup.needsInterviewer && (
                            <HeadphonesIcon className="h-3.5 w-3.5 text-primary" aria-label="Needs interviewer" />
                          )}
                        </div>
                      )}
                    </div>
                    {prime.length > 0 && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Globe2 className="h-3 w-3 text-primary" />
                        {gem ? "Prime time overseas: " : "Great time in: "}
                        {prime.map((z) => z.label).join(", ")}
                      </div>
                    )}
                  </div>
                );
              })}
        </div>
      </section>
    </div>
  );
}
