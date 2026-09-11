import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { TimeZoneSelect } from "@/components/TimeZoneSelect";
import { AgendaSignupActions } from "@/components/AgendaSignupActions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Copy, Mic2, ArrowRight, CalendarDays } from "lucide-react";
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

  const groups = useMemo(() => {
    const out: { dateLabel: string; items: typeof slots }[] = [];
    for (const s of slots) {
      if (s.showDate || out.length === 0) {
        out.push({ dateLabel: s.dateLabel, items: [s] });
      } else {
        out[out.length - 1].items.push(s);
      }
    }
    return out;
  }, [slots]);

  return (
    <div className="min-h-screen">
      <NavBar />

      <section className="border-b border-border bg-gradient-to-b from-accent/40 to-transparent">
        <div className="mx-auto max-w-[1500px] px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
          {eventLoading ? (
            <Skeleton className="h-10 w-96" />
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
                <CalendarDays className="h-3.5 w-3.5" /> On-air agenda
              </div>
              <h1
                className="mt-2 text-3xl font-bold tracking-tight sm:text-5xl"
                style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}
                data-testid="text-agenda-title"
              >
                {event?.name}
              </h1>
              <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">
                {event?.tagline || "Every speaker, every slot, one lineup — share it, save it, or claim what's still open."}
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <TimeZoneSelect value={viewZone} onChange={setViewZone} onDetect={() => setViewZone(localZone)} localZone={localZone} />
                <Button variant="outline" size="sm" onClick={copyAgenda} className="gap-1.5" data-testid="button-copy-agenda">
                  <Copy className="h-3.5 w-3.5" /> Copy as text
                </Button>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-[1500px] px-4 py-10 sm:px-6 lg:px-10">
        {signupsLoading || eventLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-10">
            {groups.map((group) => (
              <div key={group.dateLabel}>
                <div className="mb-4 flex items-center gap-3">
                  <h2
                    className="whitespace-nowrap text-xl font-bold tracking-tight sm:text-2xl"
                    style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}
                  >
                    {group.dateLabel}
                  </h2>
                  <div className="h-px flex-1 bg-border" />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {group.items.map((s) => {
                    const shareText = s.signup
                      ? `I'm tuning in to ${s.signup.hostName} on ${s.signup.podcastName} — ${s.dateLabel}, ${formatTimeInZone(
                          s.start,
                          viewZone
                        )} ${zoneLabel(viewZone)}, during the MilitaryVoice.ai 24-Hour Podcast Marathon! ${
                          typeof window !== "undefined" ? window.location.href : ""
                        }`
                      : "";
                    return (
                      <div
                        key={s.index}
                        data-testid={`row-agenda-${s.index}`}
                        className={`flex flex-col gap-3 rounded-xl p-5 transition-colors ${
                          s.signup
                            ? "border border-border bg-card shadow-sm"
                            : "border border-dashed border-border/70 bg-card/40"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-mono text-lg font-bold tabular-nums leading-tight">
                            {formatTimeInZone(s.start, viewZone)}
                            <span className="text-muted-foreground"> – {formatTimeInZone(s.end, viewZone)}</span>
                          </span>
                          {!s.signup && (
                            <Badge variant="outline" className="shrink-0 text-primary border-primary/40">
                              Open
                            </Badge>
                          )}
                        </div>
                        {s.signup && onAirSettings && (
                          <span className="text-xs text-muted-foreground" data-testid={`text-agenda-onair-${s.index}`}>
                            On air {formatTimeInZone(onAirWindow(s.start, onAirSettings).start, viewZone)}–
                            {formatTimeInZone(onAirWindow(s.start, onAirSettings).end, viewZone)}
                          </span>
                        )}

                        {s.signup ? (
                          <>
                            <div className="flex items-center gap-3" data-testid={`text-agenda-podcast-${s.index}`}>
                              {s.signup.photoUrl ? (
                                <img
                                  src={resolveUploadUrl(s.signup.photoUrl)}
                                  alt={s.signup.hostName}
                                  className="h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-primary/15"
                                  data-testid={`img-agenda-photo-${s.index}`}
                                />
                              ) : (
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                                  <Mic2 className="h-5 w-5" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="truncate font-semibold leading-tight">{s.signup.podcastName}</div>
                                <div className="truncate text-sm text-muted-foreground">{s.signup.hostName}</div>
                              </div>
                            </div>
                            <div className="mt-auto pt-1">
                              <AgendaSignupActions signup={s.signup} shareText={shareText} />
                            </div>
                          </>
                        ) : (
                          <Link
                            href="/#schedule"
                            className="mt-auto flex items-center gap-1 text-sm font-medium text-primary hover-elevate"
                            data-testid={`link-claim-${s.index}`}
                          >
                            Claim this slot <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
