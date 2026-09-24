import { SponsorRibbon } from "@/components/SponsorRibbon";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { NavBar } from "@/components/NavBar";
import { AgendaCard } from "@/components/AgendaCard";
import { TimeZoneSelect } from "@/components/TimeZoneSelect";
import { AgendaSignupActions } from "@/components/AgendaSignupActions";
import { SocialIconRow, parseSocialAccounts } from "@/components/SocialIcons";
import { deriveSocialAccounts } from "@shared/socialLinks";
import { PodcasterDialog } from "@/components/PodcasterDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Mic2, ArrowRight, CalendarDays, Radio, Play, Check } from "lucide-react";
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
import { mileMarkers } from "@shared/mileMarkers";
import { MileMarker } from "@/components/MileMarker";
import { isLiveOnlyBlock } from "@shared/slots";
import { SiteFooter } from "@/components/SiteFooter";

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

  const [viewZone, setViewZone] = useState(detectLocalTimeZone);
  // Podcaster whose bio popup is open, plus their block start so the dialog can
  // show the on-air window.
  const [selected, setSelected] = useState<{ signup: PublicSignup; start: Date } | null>(null);

  // /agenda?slot=N is where a podcaster's share link lands. Scroll to their
  // card and open it, so the reader sees the show they were promised rather
  // than the top of a 48-row list.
  const search = useSearch();
  const deepLinkSlot = (() => {
    const v = new URLSearchParams(search).get("slot");
    const n = v == null ? NaN : Number(v);
    return Number.isInteger(n) && n >= 0 ? n : null;
  })();
  const deepLinked = useRef(false);

  // A slot goes on air and comes off it while the page is open — on the day
  // this page sits on a screen all day, so the badges have to move
  // without a reload. Half a minute is plenty for 30-minute slots.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
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
      return { index: i, start, end, showDate, dateLabel, signup, liveOnly: isLiveOnlyBlock(start, end) };
    });
  }, [event, signups, viewZone]);

  // Once the slots exist, scroll the shared card into view and open it. Runs
  // once — reopening every render would trap someone who closed the dialog.
  useEffect(() => {
    if (deepLinked.current || deepLinkSlot == null || slots.length === 0) return;
    const hit = slots.find((s) => s.index === deepLinkSlot && s.signup);
    if (!hit?.signup) return;
    deepLinked.current = true;
    setSelected({ signup: hit.signup, start: hit.start });
    // Let the row paint before scrolling to it.
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-testid="row-agenda-${deepLinkSlot}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [deepLinkSlot, slots]);

  const markers = useMemo(() => mileMarkers(slots), [slots]);

  // The closing sequence runs short. The grid is half-hour slots because the
  // day is a whole number of hours and 30 divides into it, but the goodbye and
  // the thank-you are a quarter hour each — so the schedule would otherwise
  // read as running to 11pm when the day is finished at 10:30. Nothing reads
  // these times back, so the cards show the real length and the slot keeps its
  // index.
  const closingTimes = useMemo(() => {
    const out = new Map<number, { start: Date; end: Date }>();
    const finish = markers.findIndex((m) => m.kind === "finish");
    if (finish < 0 || !slots[finish]) return out;
    const q = 15 * 60000;
    const t0 = slots[finish].start.getTime();
    out.set(finish, { start: new Date(t0), end: new Date(t0 + q) });
    const medal = markers.findIndex((m) => m.kind === "medal");
    if (medal >= 0) out.set(medal, { start: new Date(t0 + q), end: new Date(t0 + 2 * q) });
    return out;
  }, [markers, slots]);


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
        {/* full-bleed studio shot behind the banner */}
        <img
          src="/agenda-bg.jpg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover object-[center_32%]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,7,65,0.94)_0%,rgba(0,7,65,0.82)_38%,rgba(5,56,119,0.55)_68%,rgba(5,56,119,0.35)_100%)]"
        />
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

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Link href="/watch">
                  <span className="inline-flex items-center gap-2 rounded-full bg-[#F0A71F] px-5 py-2 text-sm font-semibold text-[#1a1200] transition-opacity hover:opacity-90">
                    <Radio className="h-3.5 w-3.5" /> Watch Live
                  </span>
                </Link>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-white/60">Times shown in</span>
                <TimeZoneSelect variant="dark" value={viewZone} onChange={setViewZone} onDetect={() => setViewZone(localZone)} localZone={localZone} />
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

                <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {group.items.map((s) => {
                    const signup = s.signup;
                    const onAir = onAirSettings ? onAirWindow(s.start, onAirSettings) : null;

                    // A hole left by a cancellation on a closed event is not
                    // an invitation. Shown as a gap rather than a link, so the
                    // public lineup never advertises a slot the server would
                    // refuse.
                    if (!signup && event?.closed) {
                      return (
                        <div
                          key={s.index}
                          className="flex h-full flex-col overflow-hidden rounded-2xl border-2 border-dashed border-border bg-muted/20 opacity-70"
                          data-testid={`card-closed-${s.index}`}
                        >
                          <div className="flex items-center justify-between bg-muted/60 px-4 py-2.5">
                            <span className="text-sm font-bold tabular-nums text-muted-foreground">
                              {formatTimeInZone(s.start, viewZone)}
                              <span className="opacity-60"> – {formatTimeInZone(s.end, viewZone)}</span>
                            </span>
                            <span className="rounded-full border border-border px-2 py-0.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Closed
                            </span>
                          </div>
                          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-5 text-center">
                            <div className="text-sm font-semibold text-muted-foreground">Not on the lineup</div>
                          </div>
                        </div>
                      );
                    }

                    if (!signup) {
                      return (
                        <Link
                          key={s.index}
                          href={slug ? `/event/${slug}/schedule#schedule` : "/schedule#schedule"}
                          className="group flex h-full flex-col overflow-hidden rounded-2xl border-2 border-dashed border-border bg-muted/20 transition-colors hover:border-primary/40 hover:bg-muted/40"
                          data-testid={`card-open-${s.index}`}
                        >
                          <div className="flex items-center justify-between bg-muted/60 px-4 py-2.5">
                            <span className="text-sm font-bold tabular-nums text-muted-foreground">
                              {formatTimeInZone(s.start, viewZone)}
                              <span className="opacity-60"> – {formatTimeInZone(s.end, viewZone)}</span>
                            </span>
                            <span className="rounded-full border border-border px-2 py-0.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Open
                            </span>
                          </div>
                          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-5 text-center">
                            <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-border text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary">
                              <Mic2 className="h-5 w-5" />
                            </div>
                            <div className="text-sm font-semibold text-muted-foreground">This could be you</div>
                            {s.liveOnly && (
                              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                Live only
                              </div>
                            )}
                            <div className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                              Claim this slot <ArrowRight className="h-3 w-3" />
                            </div>
                          </div>
                        </Link>
                      );
                    }

                    const shareText = `I'm tuning in to ${signup.hostName} on ${signup.podcastName} — ${s.dateLabel}, ${formatTimeInZone(
                      s.start,
                      viewZone
                    )} ${zoneLabel(viewZone)}, during the MilitaryVoices.ai Podcast Marathon! ${
                      typeof window !== "undefined" ? window.location.href : ""
                    }`;

                    return (
                      <AgendaCard
                        key={s.index}
                        signup={signup}
                        index={s.index}
                        marker={markers[s.index]}
                        start={closingTimes.get(s.index)?.start ?? s.start}
                        end={closingTimes.get(s.index)?.end ?? s.end}
                        onAir={onAir && !closingTimes.has(s.index) ? onAir : null}
                        zone={viewZone}
                        now={now}
                        shareText={shareText}
                        onSelect={(sg) => setSelected({ signup: sg, start: s.start })}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <PodcasterDialog
        signup={selected?.signup ?? null}
        onAirStart={selected && onAirSettings ? onAirWindow(selected.start, onAirSettings).start : undefined}
        onAirEnd={selected && onAirSettings ? onAirWindow(selected.start, onAirSettings).end : undefined}
        zone={viewZone}
        shareText={
          selected
            ? `I'm tuning in to ${selected.signup.hostName} on ${selected.signup.podcastName} during the MilitaryVoices.ai Podcast Marathon! ${
                typeof window !== "undefined" ? window.location.href : ""
              }`
            : undefined
        }
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    <SiteFooter />
    </div>
  );
}
