import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { LogoLockup } from "@/components/Logo";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SocialIconRow, PlatformIcon, platformLabel, parseSocialAccounts } from "@/components/SocialIcons";
import { spotlightFromSignup, type SpotlightItem } from "@/components/SpotlightCard";
import { sponsorHref, SponsorRibbon } from "@/components/SponsorRibbon";
import { SponsorDialog } from "@/components/SponsorDialog";
import { PodcasterDialog } from "@/components/PodcasterDialog";
import { useCountdown } from "@/hooks/use-countdown";
import { resolveUploadUrl, apiRequest } from "@/lib/queryClient";
import type { PublicEvent, PublicSignup, PublicPodcaster, PublicSponsor, SocialPlatform } from "@shared/schema";
import { mileMarkers } from "@shared/mileMarkers";
import { MileMarker } from "@/components/MileMarker";
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
  Users,
  CalendarDays,
  BellRing,
  UserCircle2,
  MousePointerClick,
  Headphones,
  Tag,
} from "lucide-react";

interface Props {
  slug?: string;
}

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const MINI_CARDS = 3;
// Rendered instantly while /api/event is in flight (a cold serverless start
// can take a couple of seconds). Live data replaces it as soon as it lands.
const EVENT_FALLBACK: PublicEvent = {
  id: 0,
  slug: "marathon",
  isFeatured: true,
  visible: true,
  // The real event is closed; the placeholder says so rather than flashing an
  // open lineup for the second before the fetch lands.
  closed: true,
  imageUrl: "/event-marathon.jpg",
  name: "The Podcast Marathon",
  tagline: "26.2 miles of stories for National Military Podcast Day.",
  description:
    "26.2 miles of stories for National Military Podcast Day—twenty-six shows and the bonus sessions that make the point-two, back to back, special guests, and stories from the military and veteran community, streaming around the clock.",
  startAtUtc: "2026-10-05T11:00:00.000Z",
  durationHours: 24,
  slotMinutes: 30,
  onAirMinutes: 25,
  bufferMinutes: 5,
  bufferPosition: "after",
  occasion: "National Military Podcast Day",
  about: "",
  createdAt: "",
};
const HERO_IMAGES = [
  "/hero-1.jpg",
  "/hero-2.jpg",
  "/hero-3.jpg",
  "/hero-4.jpg",
  "/hero-5.jpg",
  "/hero-6.jpg",
  "/hero-7.jpg",
  "/hero-8.jpg",
  "/hero-9.jpg",
  "/hero-10.jpg",
  "/hero-11.jpg",
  "/hero-12.jpg",
];
const HERO_ROTATE_MS = 6000;
// Where every slot goes out live. Shown beside the hero waveform.
const SIMULCAST: SocialPlatform[] = ["youtube", "instagram", "linkedin", "x"];
const NAVY = "bg-[#053877] text-white";
const FADE_UP = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
};

function longDate(d: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: zone }).format(d);
}

/** Fade-up on scroll, once. */
/**
 * Sponsor logos arrive in every polarity and aspect ratio — white-on-transparent
 * wordmarks next to square colour badges. A fixed box with object-contain gives
 * them comparable optical weight, and the navy band behind keeps white marks
 * legible in either theme.
 */
function SponsorLogo({ sponsor, className }: { sponsor: PublicSponsor; className: string }) {
  const img = (
    <img
      src={sponsor.logoUrl}
      alt={sponsor.name}
      title={sponsor.name}
      loading="lazy"
      className="h-full w-full object-contain opacity-90 transition duration-300 hover:opacity-100"
    />
  );
  return (
    <div className={`flex shrink-0 items-center justify-center ${className}`}>
      {sponsor.url ? (
        <a href={sponsor.url} target="_blank" rel="noopener noreferrer" className="flex h-full w-full items-center justify-center" aria-label={sponsor.name}>
          {img}
        </a>
      ) : (
        img
      )}
    </div>
  );
}

function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, ease: "easeOut", delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export default function Landing({ slug }: Props) {
  const { data: liveEvent } = useQuery<PublicEvent>({
    queryKey: ["/api/event", slug ?? "featured"],
    queryFn: async () => {
      const res = await apiRequest("GET", slug ? `/api/event?slug=${encodeURIComponent(slug)}` : "/api/event");
      return res.json();
    },
  });
  // Featured event paints from the fallback immediately; a specific /event/:slug
  // waits for its own record.
  const event: PublicEvent | undefined = liveEvent ?? (slug ? undefined : EVENT_FALLBACK);
  const eventLoading = !event;
  const dataReady = !!liveEvent;

  // Rotating hero backdrop.
  const [heroIdx, setHeroIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setHeroIdx((i) => (i + 1) % HERO_IMAGES.length), HERO_ROTATE_MS);
    return () => clearInterval(id);
  }, []);
  const { data: signups } = useQuery<PublicSignup[]>({
    queryKey: ["/api/signups", liveEvent?.id ?? "none"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/signups?eventId=${liveEvent!.id}`);
      return res.json();
    },
    enabled: !!liveEvent,
  });
  const { data: podcasters } = useQuery<PublicPodcaster[]>({ queryKey: ["/api/podcasters"] });
  const { data: sponsors } = useQuery<PublicSponsor[]>({ queryKey: ["/api/sponsors"] });
  // Rows created before tiers existed carry no tier; they stay friends.
  const byTier = (t: string) => (sponsors ?? []).filter((s) => (s.tier || "friend") === t);
  const presentingSponsors = byTier("presenting");
  const officialSponsors = byTier("official");
  const friendSponsors = byTier("friend");
  const paidSponsors = [...presentingSponsors, ...officialSponsors];


  const zone = useMemo(detectLocalTimeZone, []);
  const countdown = useCountdown(event?.startAtUtc, event?.durationHours);

  // Same bio popup the agenda uses. A face on the lineup is the most
  // clickable thing on the page; it used to do nothing.
  const [selectedPodcaster, setSelectedPodcaster] = useState<
    { signup: PublicSignup; start: Date; end: Date } | null
  >(null);

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
        return { signup: s, start: onAir.start, end: onAir.end };
      });
  }, [booked, event]);

  // The strip is the lineup. It used to be the lineup *plus* anyone with a
  // finished profile and no slot yet, which made sense when there were five
  // shows and the row looked bare — and stopped making sense at 27, where it
  // put people under a heading that says "On the lineup" who aren't on it.
  // With nobody booked at all the heading already changes to "Joining the
  // marathon", and that is when the profiles are the right thing to show.
  // The bookings are not all shows. Two are Riccoh's ceremonies and one is a
  // held bonus slot, so counting rows said "30 shows confirmed" when there
  // were twenty-seven — an overstatement on the most public number we print.
  const markers = useMemo(() => mileMarkers(lineup.map((l) => ({ signup: l.signup }))), [lineup]);
  const showCount = useMemo(() => markers.filter((m) => m.kind === "mile").length, [markers]);

  const spotlight = useMemo<SpotlightItem[]>(() => {
    if (lineup.length > 0) return lineup.map(({ signup, start }) => spotlightFromSignup(signup, start));
    return (podcasters ?? []).map<SpotlightItem>((p) => ({
      key: `profile-${p.id}`,
      podcastName: p.podcastName,
      hostName: p.hostName,
      photoUrl: p.photoUrl,
      numPeople: p.numPeople,
      socialAccounts: p.socialAccounts,
      rssUrl: p.rssUrl,
      youtubeUrl: p.youtubeUrl,
    }));
  }, [lineup, podcasters]);

  // Before anyone is booked the strip is profiles, not shows, and there are no
  // miles to count — then the number of cards is the honest number.
  const shownCount = showCount || spotlight.length;

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
  const openSlotsHref = `${scheduleHref}#schedule`; // lands on the slot grid itself

  const steps = [
    {
      icon: MousePointerClick,
      title: "Pick an open podcast slot",
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
  ];

  const listenerSteps = [
    {
      icon: Headphones,
      title: "Browse the agenda",
      body: "See who's on and when, in your own time zone. It updates live as podcasters claim their slots.",
    },
    {
      icon: BellRing,
      title: "Tap Remind me on a show",
      body: "Your name and email, plus a mobile number if you want a text. We send add-to-calendar links for Google, Outlook, and Apple.",
    },
    {
      icon: Radio,
      title: "Tune in live",
      body: "We nudge you before the show starts. Every card also links to the podcaster's channels so you can follow them after.",
    },
  ];

  return (
    <div className="min-h-screen">
      <NavBar />

      {/* ------------------------------------------------------------ HERO */}
      <section className="relative flex min-h-[88vh] items-center overflow-hidden bg-[#000741] text-white">
        {/* rotating studio photos + navy wash (kept lighter on the right so the room reads) */}
        {HERO_IMAGES.map((src, i) => (
          <img
            key={src}
            src={src}
            alt=""
            aria-hidden="true"
            fetchPriority={i === 0 ? "high" : "low"}
            className={`absolute inset-0 h-full w-full object-cover object-[70%_center] transition-opacity duration-[1600ms] ease-in-out ${
              i === heroIdx ? "opacity-90" : "opacity-0"
            }`}
          />
        ))}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,7,65,0.93)_0%,rgba(0,7,65,0.80)_34%,rgba(5,56,119,0.48)_62%,rgba(5,56,119,0.22)_100%)]"
        />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#000741]/70 to-transparent" />
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 top-1/3 h-[26rem] w-[26rem] rounded-full bg-[#F0A71F] opacity-[0.18] blur-3xl"
          animate={{ x: [0, 30, 0], y: [0, -20, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        />

        <div className="relative mx-auto grid w-full max-w-7xl gap-12 px-4 pb-28 pt-20 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-10 lg:pb-32 lg:pt-28">
          {eventLoading || !event ? (
            <div className="space-y-4">
              <Skeleton className="h-5 w-56 bg-white/20" />
              <Skeleton className="h-14 w-full max-w-xl bg-white/20" />
              <Skeleton className="h-5 w-96 bg-white/20" />
            </div>
          ) : (
            <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}>
              <motion.div
                variants={FADE_UP}
                className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] backdrop-blur sm:text-sm"
              >
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#ED1C24] opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#ED1C24]" />
                </span>
                National Military Podcast Day
                {start && (
                  <>
                    <span className="opacity-40">·</span>
                    {longDate(start, zone)}
                  </>
                )}
              </motion.div>
              <motion.h1
                variants={FADE_UP}
                className="text-5xl font-bold leading-[0.98] tracking-tight sm:text-6xl lg:text-[5.5rem]"
                style={HEADLINE_FONT}
                data-testid="text-landing-title"
              >
                <span className="block">The Podcast</span>
                <span className="block text-[#F0A71F]">Marathon</span>
              </motion.h1>
              <motion.p variants={FADE_UP} className="mt-7 max-w-2xl text-xl leading-relaxed text-white/90 sm:text-2xl sm:leading-relaxed" data-testid="text-landing-tagline">
                {event.description || event.tagline}
              </motion.p>

              <motion.div variants={FADE_UP} className="mt-8 flex flex-wrap items-center gap-3">
                <Link href={openSlotsHref}>
                  <Button
                    size="lg"
                    className="h-14 gap-2 rounded-full bg-[#F0A71F] px-8 text-lg font-semibold text-[#1a1200] shadow-[0_10px_30px_rgba(240,167,31,0.35)] hover:bg-[#f5b944]"
                    data-testid="button-landing-claim"
                  >
                    <Mic2 className="h-4 w-4" /> Pick your slot
                  </Button>
                </Link>
                <Link href={agendaHref}>
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-14 gap-2 rounded-full border-white/30 bg-white/5 px-8 text-lg text-white backdrop-blur hover:bg-white/15 hover:text-white"
                    data-testid="button-landing-lineup"
                  >
                    See who's on <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </motion.div>

              <motion.div variants={FADE_UP} className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-base text-white/75">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-[#F0A71F]" /> {dataReady ? showCount : "…"} confirmed
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-[#F0A71F]" /> {dataReady ? `${openCount} of ${slotCount}` : "…"} slots open
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Radio className="h-4 w-4 text-[#F0A71F]" /> Free for podcasters
                </span>
              </motion.div>
            </motion.div>
          )}

          {/* Scoreboard countdown + lineup card */}
          {event && start && end && (
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.4, ease: "easeOut", delay: 0.08 }}
              className="flex flex-col gap-4"
            >
              <div
                className="relative overflow-hidden rounded-3xl border border-white/15 bg-[#000741]/75 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-7"
                data-testid="card-landing-stats"
              >
                <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[#F0A71F] opacity-20 blur-3xl" />
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/70">
                    {countdown.phase === "live" ? (
                      <>
                        <span className="h-2 w-2 animate-pulse rounded-full bg-[#ED1C24]" /> Live now
                      </>
                    ) : countdown.phase === "done" ? (
                      "That's a wrap"
                    ) : (
                      <>
                        <Radio className="h-3.5 w-3.5 text-[#F0A71F]" /> We go live in
                      </>
                    )}
                  </span>
                  <span className="tabular-nums text-[12px] uppercase tracking-wide text-white/50">{zoneLabel(zone)}</span>
                </div>

                {countdown.phase === "upcoming" ? (
                  <div className="mt-4 grid grid-cols-4 gap-2 sm:gap-3">
                    {[
                      [countdown.days, "days"],
                      [countdown.hours, "hrs"],
                      [countdown.minutes, "min"],
                      [countdown.seconds, "sec"],
                    ].map(([n, label]) => (
                      <div key={label} className="rounded-2xl border border-white/10 bg-white/5 px-1 py-3 text-center sm:px-2 sm:py-4">
                        <div className="relative h-[2.3rem] overflow-hidden sm:h-[3.8rem]">
                          <AnimatePresence mode="popLayout" initial={false}>
                            <motion.div
                              key={n as number}
                              initial={{ y: "-60%", opacity: 0 }}
                              animate={{ y: 0, opacity: 1 }}
                              exit={{ y: "60%", opacity: 0 }}
                              transition={{ duration: 0.28, ease: "easeOut" }}
                              className="text-[2rem] font-bold tabular-nums leading-none text-[#F0A71F] sm:text-6xl"
                            >
                              {String(n).padStart(2, "0")}
                            </motion.div>
                          </AnimatePresence>
                        </div>
                        <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55 sm:text-[12px]">{label}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 text-3xl font-bold" style={HEADLINE_FONT}>
                    {countdown.label}
                  </div>
                )}

                <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="inline-flex items-center gap-2 text-white/85">
                    <CalendarDays className="h-4 w-4 text-[#F0A71F]" />
                    {formatDateInZone(start, zone)} · {formatTimeInZone(start, zone)}
                    <span className="text-white/45">→ {formatDateInZone(end, zone)} · {formatTimeInZone(end, zone)}</span>
                  </span>
                </div>

                <div className="mt-4">
                  <div className="mb-1.5 flex items-center justify-between text-[12px] font-semibold uppercase tracking-wide text-white/55">
                    <span>Lineup filling</span>
                    <span className="tabular-nums">{dataReady ? `${booked.length}/${slotCount}` : "…"}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-[#F0A71F] to-[#ED1C24]"
                      initial={{ width: 0 }}
                      animate={{ width: `${slotCount ? Math.max(2, Math.round((booked.length / slotCount) * 100)) : 0}%` }}
                      transition={{ duration: 1.2, ease: "easeOut", delay: 0.6 }}
                    />
                  </div>
                </div>
              </div>

              {spotlight.length > 0 && (
                <div className="relative" data-testid="strip-mini-podcasters">
                  <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-white/70">
                    <span className="inline-flex items-center gap-1.5">
                      <Radio className="h-3.5 w-3.5 text-[#F0A71F]" />
                      {booked.length > 0 ? "On the lineup" : "Joining the marathon"}
                    </span>
                    {/* This said "4/11" — the page number — and read as
                        eleven shows when there are twenty-seven. The number
                        beside a lineup heading has to be the lineup. */}
                    <span className="tabular-nums normal-case tracking-normal text-white/55">
                      {shownCount} {shownCount === 1 ? "show" : "shows"}
                    </span>
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
                          className="flex items-center gap-3 rounded-2xl border border-white/15 bg-[#000741]/60 p-3 backdrop-blur-xl"
                          data-testid={`card-mini-${it.key}`}
                        >
                          {it.photoUrl ? (
                            <img
                              src={resolveUploadUrl(it.photoUrl)}
                              alt={it.hostName}
                              className="h-11 w-11 shrink-0 rounded-full object-cover ring-2 ring-[#F0A71F]/70"
                            />
                          ) : (
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15">
                              <Mic2 className="h-5 w-5" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold leading-tight">{it.podcastName}</div>
                            <div className="truncate text-xs text-white/70">{it.hostName}</div>
                            <div className="mt-0.5 truncate tabular-nums text-[12px] text-[#F0A71F]">
                              {it.start ? `${formatDateInZone(it.start, zone)} · ${formatTimeInZone(it.start, zone)}` : "Time coming soon"}
                            </div>
                            {it.sponsor && (
                              <a
                                href={sponsorHref(it.sponsor, "home")}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                title={`This segment is sponsored by ${it.sponsor.name}`}
                                className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#F0A71F]/60 bg-[#04102b] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#F0A71F]"
                                data-testid={`mini-sponsor-${it.key}`}
                              >
                                <Tag className="h-2.5 w-2.5 shrink-0" />
                                {it.sponsor.logoUrl ? <img src={it.sponsor.logoUrl} alt={it.sponsor.name} className="h-3 max-w-[4.5rem] object-contain" /> : <span className="truncate">{it.sponsor.name}</span>}
                              </a>
                            )}
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                  {miniPages > 1 && (
                    <div className="mt-2 flex items-center justify-center gap-1.5">
                      {Array.from({ length: miniPages }, (_, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setMiniPage(i)}
                          aria-label={`Show podcasters ${i * MINI_CARDS + 1}–${Math.min((i + 1) * MINI_CARDS, spotlight.length)}`}
                          aria-current={i === miniPage}
                          className={`h-1.5 rounded-full transition-all ${
                            i === miniPage ? "w-4 bg-[#F0A71F]" : "w-1.5 bg-white/25 hover:bg-white/45"
                          }`}
                          data-testid={`dot-mini-${i}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </div>

        {/* waveform strip along the bottom edge, flanked by where we simulcast */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-4 pb-4">
          <div className="mx-auto flex max-w-5xl items-end justify-center gap-3 sm:gap-6">
            <div className="hidden flex-1 items-center justify-end gap-3 pb-3 sm:flex">
              <span className="whitespace-nowrap text-[12px] font-semibold uppercase tracking-[0.18em] text-white/70">
                Streaming live on
              </span>
              <span aria-hidden="true" className="h-px w-6 bg-[#F0A71F]/70" />
            </div>

            <div aria-hidden="true" className="flex h-[72px] flex-none items-end justify-center gap-[3px] opacity-80">
              {Array.from({ length: 44 }).map((_, i) => {
                const base = 14 + Math.abs(Math.sin(i * 0.55)) * 58;
                return (
                  <span
                    key={i}
                    // a phone only has room for the middle of the waveform
                    className={`w-1 flex-none origin-bottom rounded-t-full bg-[#F0A71F]/75 ${
                      i >= 24 ? "hidden sm:block" : ""
                    }`}
                    style={{
                      height: `${base}px`,
                      animation: `mvwave ${1.6 + (i % 7) * 0.14}s ease-in-out ${(i % 11) * 0.09}s infinite alternate`,
                    }}
                  />
                );
              })}
            </div>

            <div
              className="flex flex-none items-center gap-1.5 pb-3 sm:flex-1 sm:justify-start sm:gap-2"
              aria-label="Streaming live on YouTube, Instagram, LinkedIn and X"
              data-testid="row-simulcast"
            >
              <span aria-hidden="true" className="hidden h-px w-6 bg-[#F0A71F]/70 sm:block" />
              {SIMULCAST.map((p) => (
                <span
                  key={p}
                  title={platformLabel(p)}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/85 ring-1 ring-white/15 backdrop-blur-sm"
                >
                  <PlatformIcon platform={p} className="h-3.5 w-3.5" />
                </span>
              ))}
            </div>
          </div>
          <style>{`@keyframes mvwave { from { transform: scaleY(0.32); opacity:.55 } to { transform: scaleY(1); opacity:1 } }`}</style>
        </div>
      </section>

      {/* ------------------------------------------------------------ HOST */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.75fr_1.25fr] lg:items-center">
          <Reveal className="relative mx-auto w-full max-w-sm">
            <div className="absolute -inset-3 -rotate-2 rounded-[2rem] bg-[#F0A71F]/80" aria-hidden="true" />
            <img
              src="/riccoh-player.jpg"
              alt="Riccoh Player in Marine Corps utilities holding his Emmy award"
              className="relative aspect-[3/4] w-full rounded-[1.75rem] object-cover object-top shadow-2xl"
              loading="lazy"
              data-testid="img-host"
            />
          </Reveal>

          <Reveal delay={0.1}>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Hosted by Emmy Winner</div>
            <h2 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl" style={HEADLINE_FONT} data-testid="text-host-name">
              Riccoh Player <span className="text-[0.5em] font-medium text-muted-foreground">(USMC, Retired)</span>
            </h2>
            <p className="mt-5 text-2xl leading-relaxed text-foreground">
              Thirty-three years in the Marine Corps. Five combat tours. An Emmy, and a seat beside a global media executive.
            </p>
            <p className="mt-4 text-xl leading-relaxed text-muted-foreground">
              He's made the transition you are in the middle of, and he wrote down what actually carried over.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {[
                ["33", "years in the Corps"],
                ["5", "combat tours"],
                ["1", "Emmy"],
              ].map(([n, label]) => (
                <div key={label} className="flex items-baseline gap-1.5 rounded-full border border-border bg-card px-4 py-2">
                  <span className="tabular-nums text-lg font-bold text-primary">{n}</span>
                  <span className="text-sm text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------ PODCASTERS */}
      <section id="podcasters" className={`relative scroll-mt-16 overflow-hidden ${NAVY}`}>
        <img
          src="/podcasters-bg.jpg"
          alt=""
          aria-hidden="true"
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover object-[65%_center] opacity-85"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,7,65,0.93)_0%,rgba(0,7,65,0.80)_36%,rgba(5,56,119,0.45)_68%,rgba(5,56,119,0.22)_100%)]"
        />
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <Reveal>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#F0A71F]">For podcasters</div>
              <h2 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl" style={HEADLINE_FONT}>
                Your story. Your slot. About two minutes to sign up.
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-white/80">
                Celebrate National Military Podcast Day on October 5. Bring a guest or share your story solo—choose a
                time and tell us about your show. One slot per show.
              </p>
              <Link href={openSlotsHref}>
                <Button
                  size="lg"
                  className="mt-6 gap-2 rounded-full bg-[#F0A71F] px-6 font-semibold text-[#1a1200] hover:bg-[#f5b944]"
                  data-testid="button-landing-claim-2"
                >
                  See open slots <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </Reveal>

            <ol className="space-y-4">
              {steps.map(({ icon: Icon, title, body }, i) => (
                <Reveal key={title} delay={i * 0.08}>
                  <li className="flex gap-4 rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F0A71F] font-mono text-sm font-bold text-[#1a1200]">
                      {i + 1}
                    </div>
                    <div>
                      <h3 className="flex items-center gap-2 text-lg font-semibold">
                        <Icon className="h-4 w-4 text-[#F0A71F]" /> {title}
                      </h3>
                      <p className="mt-1 text-base leading-relaxed text-white/80">{body}</p>
                    </div>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>

        </div>
      </section>

      {/* ---------------------------------------------------------- LINEUP */}
      <section id="lineup" className="scroll-mt-16 border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">The lineup</div>
              <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl" style={HEADLINE_FONT}>
                {showCount === 0 ? "The lineup is filling up." : `${showCount} show${showCount === 1 ? "" : "s"} confirmed so far`}
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
              <Link href={openSlotsHref}>
                <Button className="gap-2 rounded-full" data-testid="button-landing-claim-empty">
                  <Mic2 className="h-4 w-4" /> Pick a slot
                </Button>
              </Link>
            </div>
          ) : (
            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {lineup.slice(0, 12).map(({ signup, start: onAirStart, end: onAirEnd }, i) => (
                <motion.div
                  key={signup.id}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.45, delay: Math.min(i, 6) * 0.06 }}
                  className="group flex flex-col items-center overflow-hidden rounded-2xl border border-border bg-card p-5 text-center transition-shadow hover:border-primary/40 hover:shadow-md"
                  data-testid={`card-lineup-${signup.id}`}
                >
                  {signup.sponsor && (
                    <div className="-mx-5 -mt-5 mb-4 w-[calc(100%+2.5rem)]">
                      <SponsorRibbon sponsor={signup.sponsor} source="home" size="sm" testId={`lineup-sponsor-${signup.id}`} />
                    </div>
                  )}
                  {markers[i] && markers[i].kind !== "open" && (
                    <div className="mb-2 self-start">
                      <MileMarker marker={markers[i]} size={40} />
                    </div>
                  )}
                  {/* The socials below are real links, so only this part is the
                      button — an anchor inside a button is invalid markup. */}
                  <button
                    type="button"
                    onClick={() => setSelectedPodcaster({ signup, start: onAirStart, end: onAirEnd })}
                    className="flex w-full flex-col items-center rounded-xl text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    aria-label={`About ${signup.podcastName}`}
                    data-testid={`button-lineup-profile-${signup.id}`}
                  >
                    {signup.photoUrl ? (
                      <img
                        src={resolveUploadUrl(signup.photoUrl)}
                        alt={signup.hostName}
                        className="h-20 w-20 rounded-full object-cover ring-4 ring-primary/10 transition-all group-hover:ring-primary/30"
                      />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent text-accent-foreground">
                        <Mic2 className="h-7 w-7" />
                      </div>
                    )}
                    <div className="mt-3 line-clamp-2 text-sm font-semibold leading-tight group-hover:text-primary">
                      {signup.podcastName}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{signup.hostName}</div>
                    <div className="mt-2 tabular-nums text-xs text-primary">
                      {formatDateInZone(onAirStart, zone)} · {formatTimeInZone(onAirStart, zone)}
                    </div>
                    <span className="mt-2 text-[12px] font-medium text-muted-foreground group-hover:text-primary">
                      View profile
                    </span>
                  </button>
                  <SocialIconRow accounts={parseSocialAccounts(signup.socialAccounts)} variant="filled" className="mt-3 justify-center" />
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
      <section id="listeners" className={`relative scroll-mt-16 overflow-hidden ${NAVY}`}>
        <img
          src="/listeners-bg.jpg"
          alt=""
          aria-hidden="true"
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover object-[48%_30%] opacity-90"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,7,65,0.93)_0%,rgba(0,7,65,0.78)_38%,rgba(5,56,119,0.34)_72%,rgba(5,56,119,0.12)_100%)]"
        />
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <Reveal>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#F0A71F]">For listeners</div>
              <h2 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl" style={HEADLINE_FONT}>
                Follow along, pick your shows, get a nudge before they{" "}
                <span className="whitespace-nowrap">go live.</span>
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-white/80">
                Nothing to claim and nothing to install. The agenda fills in as podcasters book their times, and every
                show has a one-tap reminder that emails you before it starts.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href={agendaHref}>
                  <Button
                    size="lg"
                    className="gap-2 rounded-full bg-[#F0A71F] px-6 font-semibold text-[#1a1200] hover:bg-[#f5b944]"
                    data-testid="button-landing-listen"
                  >
                    <Headphones className="h-4 w-4" /> Browse the agenda <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/faq#listeners">
                  <Button
                    size="lg"
                    variant="outline"
                    className="gap-2 rounded-full border-white/30 bg-transparent px-6 text-white hover:bg-white/10 hover:text-white"
                  >
                    Listener FAQ
                  </Button>
                </Link>
              </div>
            </Reveal>

            <ol className="space-y-4">
              {listenerSteps.map(({ icon: Icon, title, body }, i) => (
                <Reveal key={title} delay={i * 0.08}>
                  <li className="flex gap-4 rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F0A71F] font-mono text-sm font-bold text-[#1a1200]">
                      {i + 1}
                    </div>
                    <div>
                      <h3 className="flex items-center gap-2 text-lg font-semibold">
                        <Icon className="h-4 w-4 text-[#F0A71F]" /> {title}
                      </h3>
                      <p className="mt-1 text-base leading-relaxed text-white/80">{body}</p>
                    </div>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- FINAL CTA */}
      <section className="bg-[#F0A71F] text-[#1a1200]">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-14 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl" style={HEADLINE_FONT}>
              Ready to put your show on the board?
            </h2>
            <p className="mt-2 text-[#1a1200]/75">
              {openCount > 0 ? `${openCount} slots open. ` : ""}
              {countdown.phase === "upcoming" ? countdown.label + "." : ""}
            </p>
          </div>
          <Link href={openSlotsHref}>
            <Button
              size="lg"
              className="gap-2 rounded-full bg-[#053877] px-7 text-base font-semibold text-white hover:bg-[#0a4a99]"
              data-testid="button-landing-claim-3"
            >
              <Mic2 className="h-4 w-4" /> Pick your slot
            </Button>
          </Link>
        </div>
      </section>

      {/* -------------------------------------------------------- SPONSORS */}
      {(sponsors ?? []).length > 0 && (
        <section className="overflow-hidden bg-[#000741] py-16" data-testid="section-sponsors">
          {presentingSponsors.length > 0 && (
            <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-[#F0A71F]">Presented by</div>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-x-16 gap-y-10">
                {presentingSponsors.map((sp) => (
                  <SponsorLogo key={sp.id} sponsor={sp} className="h-20 w-[260px] sm:h-24 sm:w-[320px]" />
                ))}
              </div>
            </div>
          )}

          {officialSponsors.length > 0 && (
            <div className={`mx-auto max-w-6xl px-4 text-center sm:px-6 ${presentingSponsors.length > 0 ? "mt-16" : ""}`}>
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-white/55">Official sponsors</div>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-x-14 gap-y-9">
                {officialSponsors.map((sp) => (
                  <SponsorLogo key={sp.id} sponsor={sp} className="h-16 w-[190px] sm:h-[72px] sm:w-[220px]" />
                ))}
              </div>
            </div>
          )}

          {friendSponsors.length > 0 && (
            <>
              <div className={`mx-auto max-w-6xl px-4 text-center sm:px-6 ${paidSponsors.length > 0 ? "mt-16 border-t border-white/10 pt-14" : ""}`}>
                <div className="text-xs font-semibold uppercase tracking-[0.3em] text-white/55">
                  Friends of the <span className="text-[#F0A71F]">Marathon</span>
                </div>
              </div>
              <div className="relative mt-8">
                <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-[#000741] to-transparent" />
                <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-[#000741] to-transparent" />
                <div
                  className="flex w-max items-center gap-14 px-8 [animation:mvmarquee_var(--mv-marquee-s)_linear_infinite] hover:[animation-play-state:paused]"
                  style={{ ["--mv-marquee-s" as string]: `${Math.max(18, friendSponsors.length * 6)}s` }}
                >
                  {[...friendSponsors, ...friendSponsors].map((sp, i) => (
                    <SponsorLogo key={`${sp.id}-${i}`} sponsor={sp} className="h-16 w-[190px] sm:h-[72px] sm:w-[220px]" />
                  ))}
                </div>
                <style>{`@keyframes mvmarquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }`}</style>
              </div>
            </>
          )}

          <div className="mt-12 text-center">
            <SponsorDialog>
              <button type="button" className="text-sm font-medium text-[#F0A71F] underline-offset-4 hover:underline" data-testid="button-become-sponsor">
                Become a sponsor
              </button>
            </SponsorDialog>
          </div>
        </section>
      )}

      <SiteFooter slug={slug} />

      <PodcasterDialog
        signup={selectedPodcaster?.signup ?? null}
        onAirStart={selectedPodcaster?.start}
        onAirEnd={selectedPodcaster?.end}
        zone={zone}
        shareText={
          selectedPodcaster
            ? `I'm tuning in to ${selectedPodcaster.signup.hostName} on ${selectedPodcaster.signup.podcastName} during the MilitaryVoice.ai Podcast Marathon! ${
                typeof window !== "undefined" ? window.location.href : ""
              }`
            : undefined
        }
        open={!!selectedPodcaster}
        onOpenChange={(o) => !o && setSelectedPodcaster(null)}
      />
    </div>
  );
}
