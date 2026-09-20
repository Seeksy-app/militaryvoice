import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { SponsorDialog } from "@/components/SponsorDialog";
import { AudienceReach, useAudienceSnapshot } from "@/components/AudienceReach";
import { POSTS_BEFORE_PER_SHOW, POSTS_AFTER_PER_SHOW, postsLabel } from "@shared/promo";
import { apiRequest, resolveUploadUrl } from "@/lib/queryClient";
import type { PublicEvent, PublicSignup } from "@shared/schema";
import { slotStart, totalSlots, formatTimeInZone } from "@/lib/schedule";
import { Check, Radio, Clock, ArrowRight, Megaphone, Users } from "lucide-react";
import { SiteFooter } from "@/components/SiteFooter";

// The open sponsorship page, linked from the footer. /vfw is the same pitch
// addressed to one organisation; this one is for everybody else, so it names
// no prospect and carries the full tier ladder rather than a single ask.
//
// Every figure is read from the live event, so the page cannot quote a lineup
// or a slot count that has since changed.

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const GOLD = "#F0A71F";
const NAVY = "#000741";

const PARTNER_PRICE = 10000;
const LIVESTREAM_PRICE = 5000;
const SUPPORTING_PRICE = 2500;
const SLOT_PRICE = 250;

const PARTNER_BENEFITS = [
  "Title billing all day — “National Military Podcast Day, presented by you” on the stream, the site and every announcement",
  "Your logo on the broadcast lower third for all 26.2",
  "Named in the opening and closing of every show on the schedule",
  "Top placement on the homepage, the agenda and the watch page",
  "Your logo in the “coming up next” bumper that runs between every show",
  "Named in the promotional campaign across all participating podcasters' channels",
  "First right of refusal on the 2027 event",
];

const LIVESTREAM_BENEFITS = [
  "Your logo on the stream itself, on screen for all 26.2",
  "Your own thirty-second spot, played between shows through the day",
  "Named in the hourly sponsor read",
  "Your logo on the watch page and the agenda",
  "Included in the post-event thank-you across our channels",
];

const SUPPORTING_BENEFITS = [
  "Your logo on the watch page and the agenda for the whole day",
  "Named in the hourly sponsor read between shows",
  "Your logo in the “coming up next” bumper",
  "Included in the post-event thank-you across our channels",
];

const SHOW_BENEFITS = [
  "Named as the sponsor of that show, on air and on the agenda",
  "Your logo on that show's slot and its “coming up next” bumper",
  "A thank-you from the host, in their own words",
  "Pick the shows that fit — by branch, by audience, or by time of day",
];

function money(n: number) {
  return `$${n.toLocaleString("en-US")}`;
}

export default function Sponsor() {
  const { data: event } = useQuery<PublicEvent>({
    queryKey: ["/api/event", "featured"],
    queryFn: async () => (await apiRequest("GET", "/api/event")).json(),
  });

  const { data: signups } = useQuery<PublicSignup[]>({
    queryKey: ["/api/signups", event?.id ?? "none"],
    queryFn: async () => (await apiRequest("GET", `/api/signups?eventId=${event!.id}`)).json(),
    enabled: !!event,
  });

  const { data: audience } = useAudienceSnapshot();

  const zone = "America/New_York";

  // Confirmed shows only — a sponsor pitch should never show empty slots.
  const lineup = useMemo(() => {
    if (!event || !signups) return [];
    return signups
      .filter((s) => s.status !== "cancelled")
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map((s) => ({ signup: s, start: slotStart(event.startAtUtc, event.slotMinutes, s.slotIndex) }));
  }, [event, signups]);

  const slotCount = event ? totalSlots(event.durationHours, event.slotMinutes) : 0;
  const eventDate = event
    ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: zone }).format(
        new Date(event.startAtUtc),
      )
    : "October 5, 2026";

  const dialogCopy = {
    eyebrow: "Sponsorship",
    title: "Leave your details and Riccoh will follow up.",
    description:
      "Your name, title and the best way to reach you is all we need. Riccoh Player — who hosts the day — will be in touch shortly to talk it through.",
    sentTitle: "Thanks — Riccoh will be in touch",
    sentDescription: "Your details are with him now. Expect to hear back shortly.",
    footNote: "Goes straight to Riccoh. No list, no spam.",
    showNotes: false,
  } as const;

  return (
    <div className="min-h-screen bg-background">
      <NavBar />

      {/* ------------------------------------------------------------- HERO */}
      <section className="relative overflow-hidden text-white">
        <img
          src="/podcasters-bg.jpg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover object-[60%_center]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(100deg, rgba(0,7,65,0.96) 0%, rgba(0,7,65,0.90) 42%, rgba(5,56,119,0.62) 74%, rgba(5,56,119,0.38) 100%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
          <div className="flex items-center gap-4">
            <img src="/nmpd-logo.jpg" alt="" className="h-14 w-14 rounded-full ring-2 ring-[#F0A71F]/60" />
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-[#F0A71F]">
              Sponsorship · {eventDate}
            </div>
          </div>

          <h1 className="mt-8 max-w-4xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl" style={HEADLINE_FONT}>
            Put your brand at the center of{" "}
            <span className="text-[#F0A71F]">National Military Podcast Day.</span>
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/80">
            On {eventDate} we broadcast for {event?.durationHours ?? 24} hours straight — back-to-back shows hosted by
            military and veteran podcasters, streamed live and free to anyone who wants to listen. There are three ways
            to put your name on the day.
          </p>

          {/* The fourth figure is the promotional commitment, not a forecast.
              Every number here is countable: hours on the clock, slots on the
              board, posts the lineup has agreed to run, and followers read
              from their own accounts. Nothing is multiplied into an
              "impressions" figure we cannot evidence. */}
          <div className="mt-12 grid grid-cols-2 gap-y-8 border-t border-white/15 pt-10 lg:grid-cols-4">
            {[
              { icon: Clock, n: String(event?.durationHours ?? 24), label: "hours, continuous", note: "no dead air" },
              { icon: Radio, n: String(slotCount || 48), label: "broadcast slots", note: `${event?.slotMinutes ?? 30} minutes each` },
              {
                icon: Megaphone,
                n: postsLabel(lineup.length || 17),
                label: "promotional posts",
                note: `${POSTS_BEFORE_PER_SHOW} before and ${POSTS_AFTER_PER_SHOW} after, per show`,
              },
              {
                icon: Users,
                n: audience ? audience.followers.toLocaleString("en-US") : "—",
                label: "combined following",
                note: audience ? `across ${audience.channels} connected channels` : "being counted",
              },
            ].map(({ icon: Icon, n, label, note }) => (
              <div key={label} className="px-2 lg:px-0">
                <Icon className="h-5 w-5" style={{ color: GOLD }} />
                <div className="mt-2.5 text-4xl font-bold tabular-nums tracking-tight text-white sm:text-5xl" style={HEADLINE_FONT}>
                  {n}
                </div>
                <div className="mt-1 text-sm text-white/60">{label}</div>
                <div className="text-xs text-white/40">{note}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- THE DAY */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F0A71F]">The day</div>
            <h2 className="mt-3 text-3xl font-bold leading-[1.25] tracking-tight sm:text-4xl sm:leading-[1.25]" style={HEADLINE_FONT}>
              One day that brings the whole mil/vet podcast community together.
            </h2>
          </div>
          <div className="space-y-5 text-lg leading-relaxed text-muted-foreground">
            <p>
              National Military Podcast Day was created in 2021 by two Marine veterans, to recognize the podcasters
              telling military stories in their own words.
            </p>
            <p>
              The Marathon is how we mark it: {slotCount || 32} half-hour slots running back to back for a full day,
              each one hosted by a different show. Hosts broadcast from wherever they are, we handle the production, and
              the whole thing streams free on our own watch page and out to every host's channels at the same time.
            </p>
            <p className="text-foreground">
              Sponsors are what keep it free for the podcasters and free for the audience.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- HOSTED BY */}
      <section className="text-white" style={{ backgroundColor: NAVY }}>
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.62fr_1.38fr] lg:items-center lg:py-20">
          <div className="relative mx-auto w-full max-w-[280px]">
            <div className="absolute -inset-3 -rotate-2 rounded-[2rem] bg-[#F0A71F]/80" aria-hidden="true" />
            <img
              src="/riccoh-player.jpg"
              alt="Riccoh Player in Marine Corps utilities holding his Emmy award"
              loading="lazy"
              className="relative aspect-[3/4] w-full rounded-[1.75rem] object-cover object-top shadow-2xl"
            />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: GOLD }}>
              Hosted by
            </div>
            <h2 className="mt-3 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl" style={HEADLINE_FONT}>
              Riccoh Player
            </h2>
            <p className="mt-5 text-xl leading-relaxed text-white/90 sm:text-2xl">
              Thirty-three years in the Marine Corps. Five combat tours. An Emmy, and a seat beside a global media
              executive.
            </p>
            <p className="mt-4 text-lg leading-relaxed text-white/70">
              Riccoh runs the day from the studio and hosts a slot of his own. He is the person you would be working
              with, start to finish.
            </p>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- LINEUP */}
      {lineup.length > 0 && (
        <section id="lineup" className="scroll-mt-16 border-y border-border bg-muted/30 py-16 lg:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F0A71F]">The lineup so far</div>
            <h2 className="mt-3 max-w-3xl text-3xl font-bold leading-[1.25] tracking-tight sm:text-4xl sm:leading-[1.25]" style={HEADLINE_FONT}>
              Shows already on the board.
            </h2>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              Every one of these hosts introduces the day's sponsors at the top and bottom of their show.
            </p>

            <div className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
              {lineup.map(({ signup, start }) => (
                <div
                  key={signup.id}
                  className="flex flex-col items-center rounded-2xl border border-border bg-background p-5 text-center"
                  data-testid={`card-sponsor-podcaster-${signup.slotIndex}`}
                >
                  {signup.photoUrl ? (
                    <img
                      src={resolveUploadUrl(signup.photoUrl)}
                      alt={signup.hostName}
                      loading="lazy"
                      className="h-20 w-20 rounded-full object-cover ring-2 ring-[#F0A71F]/40"
                    />
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted text-xl font-bold text-muted-foreground">
                      {signup.hostName.charAt(0)}
                    </div>
                  )}
                  <div className="mt-3 text-[11px] font-bold uppercase tracking-wide tabular-nums text-[#F0A71F]">
                    {formatTimeInZone(start, zone)} ET
                  </div>
                  <div className="mt-1.5 text-sm font-semibold leading-snug text-foreground">{signup.podcastName}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{signup.hostName}</div>
                  {signup.branch && (
                    <div className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground/80">{signup.branch}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* --------------------------------------------------- AUDIENCE REACH */}
      <AudienceReach />

      {/* ------------------------------------------------------------ TIERS */}
      {/* Inverted against the navy reach band above it, so the page alternates
          rather than running two dark sections together. */}
      <section id="tiers" className="scroll-mt-16 border-b border-border bg-background py-16 lg:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.28em]" style={{ color: GOLD }}>
              Sponsorship
            </div>
            <h2 className="mt-3 text-3xl font-bold leading-[1.25] tracking-tight text-foreground sm:text-4xl sm:leading-[1.25]" style={HEADLINE_FONT}>
              Four ways in. All start on {eventDate}.
            </h2>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            {[
              {
                name: "Partner sponsor",
                price: PARTNER_PRICE,
                note: "one available",
                blurb: "Your name on the whole day, from the first show to the last.",
                benefits: PARTNER_BENEFITS,
                featured: true,
              },
              {
                name: "Live stream sponsor",
                price: LIVESTREAM_PRICE,
                note: "four available",
                blurb: "Your name on the stream itself, every mile of the way.",
                benefits: LIVESTREAM_BENEFITS,
                featured: false,
              },
              {
                name: "Supporting sponsor",
                price: SUPPORTING_PRICE,
                note: "limited",
                blurb: "A presence across the whole marathon, without taking the title.",
                benefits: SUPPORTING_BENEFITS,
                featured: false,
              },
              {
                name: "Show sponsor",
                price: SLOT_PRICE,
                note: `per show · ${slotCount || 48} slots`,
                blurb: "Back the shows that fit, one at a time.",
                benefits: SHOW_BENEFITS,
                featured: false,
              },
            ].map((tier) => (
              <div
                key={tier.name}
                className={`relative flex flex-col rounded-3xl p-8 ${
                  tier.featured ? "border-2 bg-[#F0A71F]/[0.07]" : "border border-border bg-card"
                }`}
                style={{ borderColor: tier.featured ? GOLD : undefined }}
                data-testid={`card-tier-${tier.name.split(" ")[0].toLowerCase()}`}
              >
                {tier.featured && (
                  <div
                    className="absolute -top-3.5 left-8 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#1a1200]"
                    style={{ backgroundColor: GOLD }}
                  >
                    Most visible
                  </div>
                )}
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">{tier.name}</div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-5xl font-bold tabular-nums tracking-tight text-foreground" style={HEADLINE_FONT}>
                    {money(tier.price)}
                  </span>
                </div>
                <div className="mt-1 text-sm text-muted-foreground">{tier.note}</div>
                <p className="mt-4 text-muted-foreground">{tier.blurb}</p>
                <ul className="mt-7 flex-1 space-y-3.5">
                  {tier.benefits.map((b) => (
                    <li key={b} className="flex gap-3 text-sm leading-relaxed text-foreground">
                      <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: GOLD }} />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-8">
                  <SponsorDialog {...dialogCopy}>
                    <Button
                      className={`w-full rounded-full font-semibold ${
                        tier.featured
                          ? "bg-[#F0A71F] text-[#1a1200] hover:bg-[#ffb92e]"
                          : "bg-[#053877] text-white hover:bg-[#064391]"
                      }`}
                      data-testid={`button-tier-${tier.name.split(" ")[0].toLowerCase()}`}
                    >
                      Start the conversation
                    </Button>
                  </SponsorDialog>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------- CTA */}
      <section className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6">
        <h2 className="text-3xl font-bold leading-[1.25] tracking-tight sm:text-4xl sm:leading-[1.25]" style={HEADLINE_FONT}>
          Let's get your name on the air.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Happy to walk through any of this on a call, build a package that fits, or send a formal agreement —
          whichever is easiest on your end.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <SponsorDialog {...dialogCopy}>
            <Button size="lg" className="gap-2 rounded-full bg-[#053877] px-7 text-base font-semibold text-white hover:bg-[#0a4a99]">
              Start the conversation <ArrowRight className="h-4 w-4" />
            </Button>
          </SponsorDialog>
          <Link href="/agenda">
            <Button size="lg" variant="outline" className="rounded-full px-7 text-base">
              See the full agenda
            </Button>
          </Link>
        </div>
      </section>
    <SiteFooter />
    </div>
  );
}
