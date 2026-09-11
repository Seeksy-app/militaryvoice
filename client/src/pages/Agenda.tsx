import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { TimeZoneSelect } from "@/components/TimeZoneSelect";
import { AgendaSignupActions } from "@/components/AgendaSignupActions";
import { SocialIconRow, parseSocialAccounts } from "@/components/SocialIcons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Copy, Mic2, ArrowRight, CalendarDays, Radio } from "lucide-react";
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

      <section className="relative overflow-hidden bg-[#053877] text-white">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-[#F0A71F] opacity-[0.14] blur-3xl"
        />
        <div className="relative mx-auto max-w-[1500px] px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
          {eventLoading ? (
            <Skeleton className="h-10 w-96 bg-white/20" />
          ) : (
            <>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest">
                <CalendarDays className="h-3.5 w-3.5 text-[#F0A71F]" /> On-air agenda
              </div>
              <h1
                className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl"
                style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}
                data-testid="text-agenda-title"
              >
                {event?.name?.trim()}
              </h1>
              <p className="mt-3 max-w-2xl text-base text-white/75 sm:text-lg">
                {event?.tagline || "Every speaker, every slot, one lineup — share it, save it, or claim what's still open."}
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <div className="rounded-xl bg-white/95 p-1 text-foreground shadow">
                  <TimeZoneSelect value={viewZone} onChange={setViewZone} onDetect={() => setViewZone(localZone)} localZone={localZone} />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyAgenda}
                  className="gap-1.5 rounded-full border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
                  data-testid="button-copy-agenda"
                >
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

                {(() => {
                  const bookedItems = group.items.filter((s) => s.signup);
                  const openItems = group.items.filter((s) => !s.signup);
                  return (
                    <>
                      {bookedItems.length === 0 ? (
                        <div className="rounded-2xl border-2 border-dashed border-primary/20 bg-card p-8 text-center">
                          <Mic2 className="mx-auto h-8 w-8 text-primary/60" />
                          <p className="mt-3 font-semibold">No shows confirmed for this day yet.</p>
                          <p className="mt-1 text-sm text-muted-foreground">Check back soon — the lineup fills in as podcasters claim their times.</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {bookedItems.map((s) => {
                            const signup = s.signup!;
                            const shareText = `I'm tuning in to ${signup.hostName} on ${signup.podcastName} — ${s.dateLabel}, ${formatTimeInZone(
                              s.start,
                              viewZone
                            )} ${zoneLabel(viewZone)}, during the MilitaryVoice.ai 24 Hour Podcastathon! ${
                              typeof window !== "undefined" ? window.location.href : ""
                            }`;
                            const onAir = onAirSettings ? onAirWindow(s.start, onAirSettings) : null;
                            return (
                              <div
                                key={s.index}
                                data-testid={`row-agenda-${s.index}`}
                                className="relative flex flex-col overflow-hidden rounded-2xl border-2 border-primary/15 bg-card shadow-md transition-shadow hover:shadow-lg"
                              >
                                <div className="flex items-center justify-between bg-[#053877] px-4 py-2.5 text-white">
                                  <span className="font-mono text-sm font-bold tabular-nums">
                                    {formatTimeInZone(s.start, viewZone)}
                                    <span className="text-white/60"> – {formatTimeInZone(s.end, viewZone)}</span>
                                  </span>
                                  <span className="inline-flex items-center gap-1 rounded-full bg-[#F0A71F] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#1a1200]">
                                    <Radio className="h-3 w-3" /> Live
                                  </span>
                                </div>
                                <div className="flex flex-col gap-3 p-4">
                                  <div className="flex items-center gap-3" data-testid={`text-agenda-podcast-${s.index}`}>
                                    {signup.photoUrl ? (
                                      <img
                                        src={resolveUploadUrl(signup.photoUrl)}
                                        alt={signup.hostName}
                                        className="h-16 w-16 shrink-0 rounded-full object-cover ring-4 ring-[#F0A71F]/40"
                                        data-testid={`img-agenda-photo-${s.index}`}
                                      />
                                    ) : (
                                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                                        <Mic2 className="h-6 w-6" />
                                      </div>
                                    )}
                                    <div className="min-w-0">
                                      <div className="line-clamp-2 font-semibold leading-tight">{signup.podcastName}</div>
                                      <div className="truncate text-sm text-muted-foreground">with {signup.hostName}</div>
                                      <SocialIconRow accounts={parseSocialAccounts(signup.socialAccounts)} className="mt-1.5" />
                                    </div>
                                  </div>
                                  {onAir && (
                                    <div className="text-xs text-muted-foreground" data-testid={`text-agenda-onair-${s.index}`}>
                                      On air {formatTimeInZone(onAir.start, viewZone)}–{formatTimeInZone(onAir.end, viewZone)}
                                    </div>
                                  )}
                                  <div className="mt-auto border-t border-border pt-3">
                                    <AgendaSignupActions signup={signup} shareText={shareText} />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {openItems.length > 0 && (
                        <div className="mt-6 rounded-2xl border border-border bg-muted/40 p-4" data-testid={`strip-open-${group.dateLabel}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {openItems.length} open slot{openItems.length === 1 ? "" : "s"} this day
                            </div>
                            <Link
                              href={slug ? `/event/${slug}/schedule` : "/schedule"}
                              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                              data-testid={`link-claim-${group.dateLabel}`}
                            >
                              Podcaster? Claim one <ArrowRight className="h-3 w-3" />
                            </Link>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {openItems.map((s) => (
                              <span
                                key={s.index}
                                className="rounded-full border border-border bg-background px-2.5 py-1 font-mono text-[11px] tabular-nums text-muted-foreground"
                              >
                                {formatTimeInZone(s.start, viewZone)}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
