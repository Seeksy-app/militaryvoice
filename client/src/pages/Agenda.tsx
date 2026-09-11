import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavBar } from "@/components/NavBar";
import { TimeZoneSelect } from "@/components/TimeZoneSelect";
import { AgendaSignupActions } from "@/components/AgendaSignupActions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Copy, Mic2 } from "lucide-react";
import type { PublicEvent, PublicSignup } from "@shared/schema";
import { resolveUploadUrl, apiRequest } from "@/lib/queryClient";
import {
  detectLocalTimeZone,
  slotStart,
  slotEnd,
  totalSlots,
  formatDateInZone,
  formatTimeInZone,
  zoneLabel,
  onAirWindow,
} from "@/lib/schedule";

interface Props {
  slug?: string;
}

export default function Agenda({ slug }: Props) {
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
  const { toast } = useToast();

  const [viewZone, setViewZone] = useState(detectLocalTimeZone);
  const localZone = useMemo(detectLocalTimeZone, []);

  const onAirSettings = event
    ? { onAirMinutes: event.onAirMinutes, bufferMinutes: event.bufferMinutes, bufferPosition: event.bufferPosition }
    : undefined;

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
              style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}
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
                const shareText = s.signup
                  ? `I'm tuning in to ${s.signup.hostName} on ${s.signup.podcastName} — ${s.dateLabel}, ${formatTimeInZone(
                      s.start,
                      viewZone
                    )} ${zoneLabel(viewZone)}, during the MilitaryVoice.ai 24-Hour Podcast Marathon! ${
                      typeof window !== "undefined" ? window.location.href : ""
                    }`
                  : "";
                return (
                  <div key={s.index} className="flex flex-col gap-2 p-4" data-testid={`row-agenda-${s.index}`}>
                    {s.showDate && (
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">{s.dateLabel}</div>
                    )}
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        {s.signup?.photoUrl && (
                          <img
                            src={resolveUploadUrl(s.signup.photoUrl)}
                            alt={s.signup.hostName}
                            className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-border"
                            data-testid={`img-agenda-photo-${s.index}`}
                          />
                        )}
                        <div className="flex flex-col">
                          <span className="font-mono text-sm font-semibold tabular-nums">
                            {formatTimeInZone(s.start, viewZone)}–{formatTimeInZone(s.end, viewZone)}
                          </span>
                          {s.signup && onAirSettings && (
                            <span className="text-xs text-muted-foreground" data-testid={`text-agenda-onair-${s.index}`}>
                              On air {formatTimeInZone(onAirWindow(s.start, onAirSettings).start, viewZone)}–
                              {formatTimeInZone(onAirWindow(s.start, onAirSettings).end, viewZone)}
                            </span>
                          )}
                          {s.signup ? (
                            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0 text-sm" data-testid={`text-agenda-podcast-${s.index}`}>
                              <span className="flex items-center gap-1.5 font-medium">
                                <Mic2 className="h-3.5 w-3.5 text-primary" /> {s.signup.podcastName}
                              </span>
                              <span className="text-xs text-muted-foreground">— {s.signup.hostName}</span>
                            </span>
                          ) : (
                            <Badge variant="outline" className="mt-0.5 w-fit text-muted-foreground">
                              Open — up for grabs
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    {s.signup && <AgendaSignupActions signup={s.signup} shareText={shareText} />}
                  </div>
                );
              })}
        </div>
      </section>
    </div>
  );
}
