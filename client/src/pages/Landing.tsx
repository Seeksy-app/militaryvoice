import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { LogoMark, Wordmark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SocialIconRow, parseSocialAccounts } from "@/components/SocialIcons";
import { spotlightFromSignup, type SpotlightItem } from "@/components/SpotlightCard";
import { useCountdown } from "@/hooks/use-countdown";
import { resolveUploadUrl, apiRequest } from "@/lib/queryClient";
import type { PublicEvent, PublicSignup, PublicPodcaster } from "@shared/schema";
import {
  detectLocalTimeZone,
  slotStart,
  totalSlots,
  formatDateInZone,
  formatTimeInZone,
  zoneLabel,
  onAirWindow,
} from "@/lib/schedule";
import {
  ArrowRight,
  Radio,
  Mic2,
  Clock,
  Globe2,
  Users,
  CalendarDays,
  BellRing,
  UserCircle2,
  MousePointerClick,
  Headphones,
} from "lucide-react";

interface Props {
  slug?: string;
}

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const MINI_CARDS = 3;
function longDate(d: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: zone }).format(d);
}
const FADE_UP = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};

export default function Landing({ slug }: Props) {
  const { data: event, isLoading: eventLoading } = useQuery<PublicEvent>({
    queryKey: ["/api/event", slug ?? "featured"],
    queryFn: async () => {
      const res = await apiRequest("GET", slug ? `/api/event?slug=${encodeURIComponent(slug)}` : "/api/event");
      return res.json();
    },
  });
  const { data: signups } = useQuery<PublicSignup[]>({
    queryKey: ["/api/signups", event?.id ?? "none"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/signups?eventId=${event!.id}`);
      return res.json();
    },
    enabled: !!event,
  });

  const { data: podcasters } = useQuery<PublicPodcaster[]>({ queryKey: ["/api/podcasters"] });

  const zone = useMemo(detectLocalTimeZone, []);
  const countdown = useCountdown(event?.startAtUtc, event?.durationHours);

  const start = event ? new Date(event.startAtUtc) : null;
  const end = event && start ? new Date(start.getTime() + event.durationHours * 3600000) : null;
  const slotCount = event ? totalSlots(event.durationHours, event.slotMinutes) : 0;
  const booked = useMemo(() => (signups ?? []).filter((s) => s.status !== "cancelled"), [signups]);
  const openCount = Math.max(slotCount - booked.length, 0);

  const lineup = useMemo(() => {
    if (!event) return [];
    return [...booked]
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map((s) => {
        const blockStart = slotStart(event.startAtUtc, event.slotMinutes, s.slotIndex);
        const onAir = onAirWindow(blockStart, {
          onAirMinutes: event.onAirMinutes,
          bufferMinutes: event.bufferMinutes,
          bufferPosition: event.bufferPosition,
        });
        return { signup: s, start: onAir.start };
      });
  }, [booked, event]);

  // Spotlight = everyone with a claimed slot (first), then podcasters who've
  // finished a profile but haven't picked a time yet.
  const spotlight = useMemo<SpotlightItem[]>(() => {
    const fromSlots = lineup.map(({ signup, start }) => spotlightFromSignup(signup, start));
    const seen = new Set(fromSlots.map((i) => `${i.podcastName}|${i.hostName}`.toLowerCase()));
    const fromProfiles = (podcasters ?? [])
      .filter((p) => !seen.has(`${p.podcastName}|${p.hostName}`.toLowerCase()))
      .map<SpotlightItem>((p) => ({
        key: `profile-${p.id}`,
        podcastName: p.podcastName,
        hostName: p.hostName,
        photoUrl: p.photoUrl,
        numPeople: p.numPeople,
        socialAccounts: p.socialAccounts,
        rssUrl: p.rssUrl,
        youtubeUrl: p.youtubeUrl,
      }));
    return [...fromSlots, ...fromProfiles];
  }, [lineup, podcasters]);

  // Small podcaster cards under the event card: up to MINI_CARDS at a time,
  // rotating through pages every 7s once there are more than fit.
  const [miniPage, setMiniPage] = useState(0);
  const miniPages = Math.max(1, Math.ceil(spotlight.length / MINI_CARDS));
  useEffect(() => {
    if (miniPages < 2) {
      setMiniPage(0);
      return;
    }
    const id = setInterval(() => setMiniPage((p) => (p + 1) % miniPages), 7000);
    return () => clearInterval(id);
  }, [miniPages]);
  const miniItems = spotlight.slice(miniPage * MINI_CARDS, miniPage * MINI_CARDS + MINI_CARDS);

  const agendaHref = slug ? `/event/${slug}/agenda` : "/agenda";
  const scheduleHref = slug ? `/event/${slug}/schedule` : "/schedule";

  return (
    <div className="min-h-screen">
      <NavBar />

      {/* ------------------------------------------------------------ HERO */}
      <section className="relative overflow-hidden bg-[#053877] text-white dark:bg-[#04244d]">
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-[#F0A71F] opacity-[0.14] blur-3xl"
          animate={{ x: [0, 40, 0], y: [0, 24, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-40 right-0 h-[30rem] w-[30rem] rounded-full bg-white opacity-[0.08] blur-3xl"
          animate={{ x: [0, -30, 0], y: [0, -20, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-24">
          {eventLoading || !event ? (
            <div className="space-y-4">
              <Skeleton className="h-5 w-56 bg-white/20" />
              <Skeleton className="h-14 w-full max-w-xl bg-white/20" />
              <Skeleton className="h-5 w-96 bg-white/20" />
            </div>
          ) : (
            <motion.div
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.09 } } }}
            >
              <motion.div variants={FADE_UP} className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]">
                <span className="inline-block h-2 w-2 rounded-full bg-[#F0A71F]" />
                Live · National Military Podcast Day
                {start && (
                  <>
                    <span className="opacity-40">·</span>
                    {longDate(start, zone)}
                  </>
                )}
              </motion.div>
              <motion.h1
                variants={FADE_UP}
                className="text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl"
                style={HEADLINE_FONT}
                data-testid="text-landing-title"
              >
                {event.name.trim()}
              </motion.h1>
              <motion.p variants={FADE_UP} className="mt-5 max-w-xl text-lg leading-relaxed text-white/80" data-testid="text-landing-tagline">
                {event.description || event.tagline}
              </motion.p>

              <motion.div variants={FADE_UP} className="mt-8 flex flex-wrap items-center gap-3">
                <Link href={scheduleHref}>
                  <Button
                    size="lg"
                    className="gap-2 rounded-full bg-[#F0A71F] px-7 text-base font-semibold text-[#1a1200] hover:bg-[#f5b944]"
                    data-testid="button-landing-claim"
                  >
                    <Mic2 className="h-4 w-4" /> Pick your slot
                  </Button>
                </Link>
                <Link href={agendaHref}>
                  <Button
                    size="lg"
                    variant="outline"
                    className="gap-2 rounded-full border-white/30 bg-transparent px-7 text-base text-white hover:bg-white/10 hover:text-white"
                    data-testid="button-landing-lineup"
                  >
                    See who's on <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </motion.div>

              <motion.p variants={FADE_UP} className="mt-6 text-sm text-white/60">
                Free for podcasters. Go live from your own studio. Times shown in {zoneLabel(zone)}.
              </motion.p>
            </motion.div>
          )}

          {/* Event details card + small podcaster cards under it */}
          {event && start && end && (
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: "easeOut", delay: 0.2 }}
              className="flex flex-col"
            >
              <div className="relative">
              <div className="absolute inset-0 rotate-2 rounded-[1.75rem] bg-[#F0A71F]/90" aria-hidden="true" />
              <div className="relative rounded-[1.75rem] bg-card p-6 text-card-foreground shadow-2xl sm:p-8" data-testid="card-landing-stats">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {countdown.phase === "live" ? "Live now" : countdown.phase === "done" ? "Wrapped" : "Countdown"}
                  </span>
                  <Radio className={`h-4 w-4 ${countdown.phase === "live" ? "animate-pulse text-destructive" : "text-primary"}`} />
                </div>

                {countdown.phase === "upcoming" ? (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {[
                      [countdown.days, "days"],
                      [countdown.hours, "hours"],
                      [countdown.minutes, "min"],
                    ].map(([n, label]) => (
                      <div key={label} className="rounded-xl bg-muted px-3 py-3 text-center">
                        <div className="font-mono text-3xl font-bold tabular-nums text-foreground sm:text-4xl">{n}</div>
                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 text-2xl font-bold">{countdown.label}</div>
                )}

                <dl className="mt-6 space-y-3 text-sm">
                  <div className="flex items-start gap-3">
                    <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div>
                      <dt className="font-medium">
                        {formatDateInZone(start, zone)} · {formatTimeInZone(start, zone)}
                      </dt>
                      <dd className="text-muted-foreground">
                        through {formatDateInZone(end, zone)} · {formatTimeInZone(end, zone)}
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Users className="h-4 w-4 shrink-0 text-primary" />
                    <dt className="font-medium">
                      {booked.length} podcaster{booked.length === 1 ? "" : "s"} confirmed
                    </dt>
                  </div>
                  <div className="flex items-center gap-3">
                    <Clock className="h-4 w-4 shrink-0 text-primary" />
                    <dt className="font-medium" data-testid="text-landing-open">
                      {openCount} of {slotCount} slots still open
                    </dt>
                  </div>
                </dl>

                <div className="mt-6 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${slotCount ? Math.round((booked.length / slotCount) * 100) : 0}%` }}
                  />
                </div>
              </div>
              </div>

              {spotlight.length > 0 && (
                <div className="relative mt-5" data-testid="strip-mini-podcasters">
                  <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-white/70">
                    <span className="inline-flex items-center gap-1.5">
                      <Radio className="h-3.5 w-3.5 text-[#F0A71F]" />
                      {booked.length > 0 ? "On the lineup" : "Joining the marathon"}
                    </span>
                    {spotlight.length > MINI_CARDS && (
                      <span className="font-mono normal-case tracking-normal">
                        {miniPage + 1}/{Math.ceil(spotlight.length / MINI_CARDS)}
                      </span>
                    )}
                  </div>
                  <div className={`grid gap-2 ${miniItems.length === 1 ? "grid-cols-1" : miniItems.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
                    <AnimatePresence mode="popLayout" initial={false}>
                      {miniItems.map((it) => (
                        <motion.div
                          key={it.key}
                          layout
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.4 }}
                          className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur"
                          data-testid={`card-mini-${it.key}`}
                        >
                          {it.photoUrl ? (
                            <img src={resolveUploadUrl(it.photoUrl)} alt={it.hostName} className="h-11 w-11 shrink-0 rounded-full object-cover ring-2 ring-[#F0A71F]/60" />
                          ) : (
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15">
                              <Mic2 className="h-5 w-5" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold leading-tight">{it.podcastName}</div>
                            <div className="truncate text-xs text-white/70">{it.hostName}</div>
                            <div className="mt-0.5 truncate font-mono text-[11px] text-[#F0A71F]">
                              {it.start ? `${formatDateInZone(it.start, zone)} · ${formatTimeInZone(it.start, zone)}` : "Time coming soon"}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------ HOST */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:items-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="relative mx-auto w-full max-w-sm"
            >
              <div className="absolute -inset-3 -rotate-2 rounded-[2rem] bg-[#F0A71F]/80" aria-hidden="true" />
              <img
                src="/rico-player.jpg"
                alt="Rico Player in Marine Corps utilities holding his Emmy award"
                className="relative aspect-[3/4] w-full rounded-[1.75rem] object-cover object-top shadow-2xl"
                loading="lazy"
                data-testid="img-host"
              />
              <div className="absolute bottom-4 left-4 right-4 rounded-xl border border-white/40 bg-background/90 px-4 py-3 shadow-lg backdrop-blur">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Your host</div>
                <div className="text-lg font-bold leading-tight" style={HEADLINE_FONT}>
                  Rico Player
                </div>
                <div className="text-xs text-muted-foreground">Marine · Emmy winner · Podcaster</div>
              </div>
            </motion.div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Hosted by</div>
              <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl" style={HEADLINE_FONT} data-testid="text-host-name">
                Rico Player
              </h2>
              <p className="mt-5 text-xl leading-relaxed text-foreground">
                Thirty-three years in the Marine Corps. Five combat tours. An Emmy, and a seat beside a global media
                executive.
              </p>
              <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
                He's made the transition you are in the middle of, and he wrote down what actually carried over.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {[
                  ["33", "years in the Corps"],
                  ["5", "combat tours"],
                  ["1", "Emmy"],
                ].map(([n, label]) => (
                  <div key={label} className="flex items-baseline gap-1.5 rounded-full border border-border bg-card px-4 py-2">
                    <span className="font-mono text-lg font-bold text-primary">{n}</span>
                    <span className="text-sm text-muted-foreground">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-16 grid gap-6 sm:grid-cols-3">
            {[
              {
                icon: Globe2,
                title: `${event?.durationHours ?? 24} hours, back to back`,
                body: "Shows hand off to each other every half hour, so someone is always on the air no matter where the audience is waking up.",
              },
              {
                icon: Mic2,
                title: "Your show, your studio",
                body: "Record or stream from wherever you normally do. We give you the time block, the lineup, and the audience.",
              },
              {
                icon: Users,
                title: "One shared lineup",
                body: "Every podcaster gets a card on the public agenda with their photo, links, and socials, so listeners can follow you after your slot.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-border bg-card p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- HOW IT WORKS */}
      <section className="border-b border-border bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">For podcasters</div>
              <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl" style={HEADLINE_FONT}>
                Claiming a slot takes about two minutes.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                Pick a time, drop your email, tell us about your show once. Every slot you claim after that reuses your
                photo, show details, and connected socials, so there's nothing to re-enter.
              </p>
              <Link href={scheduleHref}>
                <Button size="lg" className="mt-6 gap-2 rounded-full px-6" data-testid="button-landing-claim-2">
                  See open slots <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>

            <ol className="space-y-4">
              {[
                {
                  icon: MousePointerClick,
                  title: "Pick an open slot",
                  body: `Choose any open ${event?.slotMinutes ?? 30}-minute block on the schedule, shown in your own time zone. We hold it while you finish.`,
                },
                {
                  icon: UserCircle2,
                  title: "Drop your email, set up your show",
                  body: "A one-time code signs you in, no password. Then add a photo, your show name, and your RSS feed so listeners can hit play.",
                },
                {
                  icon: Radio,
                  title: "Go live",
                  body: event
                    ? `You're on the air for ${event.onAirMinutes} minutes, with a ${event.bufferMinutes}-minute handoff ${
                        event.bufferPosition === "before" ? "before" : "after"
                      } for the transition to the next show.`
                    : "You get an on-air window plus a short handoff to the next show.",
                },
              ].map(({ icon: Icon, title, body }, i) => (
                <li key={title} className="flex gap-4 rounded-2xl border border-border bg-card p-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-sm font-bold text-primary-foreground">
                    {i + 1}
                  </div>
                  <div>
                    <h3 className="flex items-center gap-2 text-base font-semibold">
                      <Icon className="h-4 w-4 text-primary" /> {title}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- LINEUP */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">The lineup</div>
              <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl" style={HEADLINE_FONT}>
                {booked.length === 0 ? "The lineup is filling up." : `${booked.length} show${booked.length === 1 ? "" : "s"} confirmed so far`}
              </h2>
            </div>
            <Link href={agendaHref}>
              <Button variant="outline" className="gap-1.5 rounded-full" data-testid="button-landing-agenda">
                Full agenda <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>

          {booked.length === 0 ? (
            <div className="mt-8 flex flex-col items-start gap-4 rounded-2xl border border-dashed border-border bg-card p-8 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-base font-semibold">Be the first name on the board.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {slotCount} slots are open right now. Early claims get the prime-time picks.
                </p>
              </div>
              <Link href={scheduleHref}>
                <Button className="gap-2 rounded-full" data-testid="button-landing-claim-empty">
                  <Mic2 className="h-4 w-4" /> Pick a slot
                </Button>
              </Link>
            </div>
          ) : (
            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {lineup.slice(0, 12).map(({ signup, start: onAirStart }, i) => (
                <motion.div
                  key={signup.id}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.45, delay: Math.min(i, 6) * 0.06 }}
                  className="flex flex-col items-center rounded-2xl border border-border bg-card p-5 text-center"
                  data-testid={`card-lineup-${signup.id}`}
                >
                  {signup.photoUrl ? (
                    <img
                      src={resolveUploadUrl(signup.photoUrl)}
                      alt={signup.hostName}
                      className="h-20 w-20 rounded-full object-cover ring-4 ring-primary/10"
                    />
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent text-accent-foreground">
                      <Mic2 className="h-7 w-7" />
                    </div>
                  )}
                  <div className="mt-3 line-clamp-2 text-sm font-semibold leading-tight">{signup.podcastName}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{signup.hostName}</div>
                  <div className="mt-2 font-mono text-xs text-primary">
                    {formatDateInZone(onAirStart, zone)} · {formatTimeInZone(onAirStart, zone)}
                  </div>
                  <SocialIconRow accounts={parseSocialAccounts(signup.socialAccounts)} className="mt-3 justify-center" />
                </motion.div>
              ))}
              {lineup.length > 12 && (
                <Link
                  href={agendaHref}
                  className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card p-5 text-center text-sm font-medium text-primary hover-elevate"
                >
                  +{lineup.length - 12} more on the agenda <ArrowRight className="mt-1 h-4 w-4" />
                </Link>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------- LISTENERS */}
      <section className="border-b border-border bg-muted/40">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">For listeners</div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl" style={HEADLINE_FONT}>
              Follow along, pick your shows, get a nudge before they go live.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              The agenda updates as podcasters claim slots. Every card has a share button, a calendar reminder, and a
              one-click "I want to watch this one" that emails you before that show starts.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href={agendaHref}>
                <Button size="lg" className="gap-2 rounded-full px-6" data-testid="button-landing-listen">
                  <Headphones className="h-4 w-4" /> Browse the agenda
                </Button>
              </Link>
              <Link href={scheduleHref}>
                <Button size="lg" variant="outline" className="gap-2 rounded-full px-6">
                  <CalendarDays className="h-4 w-4" /> Full schedule
                </Button>
              </Link>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {[
              { icon: BellRing, title: "Reminders", body: "Drop your email on any show's card and we'll ping you before it starts." },
              { icon: CalendarDays, title: "Calendar files", body: "Add any slot to your calendar in your own time zone." },
              { icon: Globe2, title: "Every time zone", body: "Switch the schedule to wherever you are. Overseas listeners welcome." },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-3 rounded-2xl border border-border bg-card p-4">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <div className="text-sm font-semibold">{title}</div>
                  <div className="text-sm text-muted-foreground">{body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- FINAL CTA */}
      <section className="bg-[#053877] text-white dark:bg-[#04244d]">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-14 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl" style={HEADLINE_FONT}>
              Ready to put your show on the board?
            </h2>
            <p className="mt-2 text-white/75">
              {openCount > 0 ? `${openCount} slots open. ` : ""}
              {countdown.phase === "upcoming" ? countdown.label + "." : ""}
            </p>
          </div>
          <Link href={scheduleHref}>
            <Button
              size="lg"
              className="gap-2 rounded-full bg-[#F0A71F] px-7 text-base font-semibold text-[#1a1200] hover:bg-[#f5b944]"
              data-testid="button-landing-claim-3"
            >
              <Mic2 className="h-4 w-4" /> Pick your slot
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2">
            <LogoMark className="h-5 w-5" />
            <Wordmark className="text-base" />
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href={agendaHref} className="hover:text-foreground">
              Agenda
            </Link>
            <Link href={scheduleHref} className="hover:text-foreground">
              Schedule
            </Link>
            <Link href="/events" className="hover:text-foreground">
              Events
            </Link>
            <Link href="/host/dashboard" className="hover:text-foreground">
              Podcaster login
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
