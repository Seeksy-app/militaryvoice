import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { apiRequest, resolveUploadUrl } from "@/lib/queryClient";
import type { PublicEvent, PublicSignup } from "@shared/schema";
import { slotStart, totalSlots, formatTimeInZone } from "@/lib/schedule";
import { Check, Mic2, Radio, Clock, Users, ArrowRight } from "lucide-react";

// A one-page sponsorship proposal, addressed to a single organisation. It is
// deliberately not linked from the nav — the URL is the delivery mechanism.
//
// Every number on this page is read from the live event, so the proposal can
// never quote a lineup that has since changed.

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const GOLD = "#F0A71F";
const NAVY = "#000741";

const PARTNER_PRICE = 10000;
const SLOT_PRICE = 250;

const PARTNER_BENEFITS = [
  "Title billing all day — “National Military Podcast Day, presented by the VFW” on the stream, the site and every announcement",
  "Your logo on the broadcast lower third for all 24 hours",
  "Named in the opening and closing of every show on the schedule",
  "Top placement on the homepage, the agenda and the watch page",
  "Your logo in the “coming up next” bumper that runs between every show",
  "Named in the promotional campaign across all participating podcasters' channels",
  "First right of refusal on the 2027 event",
];

function money(n: number) {
  return `$${n.toLocaleString("en-US")}`;
}

export default function SponsorVFW() {
  const { data: event } = useQuery<PublicEvent>({
    queryKey: ["/api/event", "featured"],
    queryFn: async () => (await apiRequest("GET", "/api/event")).json(),
  });

  const { data: signups } = useQuery<PublicSignup[]>({
    queryKey: ["/api/signups", event?.id ?? "none"],
    queryFn: async () => (await apiRequest("GET", `/api/signups?eventId=${event!.id}`)).json(),
    enabled: !!event,
  });

  const zone = "America/New_York";

  // Confirmed shows only — a proposal should never show empty slots.
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

  return (
    <div className="min-h-screen bg-background">
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
        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
          <div className="flex items-center gap-4">
            <img src="/nmpd-logo.jpg" alt="" className="h-14 w-14 rounded-full ring-2 ring-[#F0A71F]/60" />
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-[#F0A71F]">
              Sponsorship proposal · Prepared for the VFW
            </div>
          </div>

          <h1 className="mt-8 max-w-4xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl" style={HEADLINE_FONT}>
            Put the VFW at the center of{" "}
            <span className="text-[#F0A71F]">National Military Podcast Day.</span>
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/80">
            On {eventDate} we broadcast for {event?.durationHours ?? 24} hours straight — back-to-back shows hosted by
            military and veteran podcasters, streamed live and free to anyone who wants to listen. We are offering the
            VFW the partner sponsorship of the entire day — including two slots on the schedule for #StillServing.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <a href="#offer">
              <Button size="lg" className="gap-2 rounded-full bg-[#F0A71F] px-7 text-base font-semibold text-[#1a1200] hover:bg-[#ffb92e]">
                See the offer <ArrowRight className="h-4 w-4" />
              </Button>
            </a>
            <a href="#lineup" className="text-sm font-medium text-white/80 underline-offset-4 hover:text-white hover:underline">
              Meet the lineup
            </a>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ STATS */}
      <section className="border-b border-border bg-background">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px overflow-hidden px-4 py-12 sm:px-6 lg:grid-cols-4">
          {[
            { icon: Clock, n: String(event?.durationHours ?? 24), label: "hours, continuous" },
            { icon: Radio, n: String(slotCount || 48), label: "broadcast slots" },
            { icon: Mic2, n: String(event?.slotMinutes ?? 30), label: "minutes per show" },
            { icon: Users, n: "1", label: "partner sponsorship available" },
          ].map(({ icon: Icon, n, label }) => (
            <div key={label} className="px-2 text-center lg:px-4">
              <Icon className="mx-auto h-5 w-5 text-[#F0A71F]" />
              <div className="mt-3 text-4xl font-bold tabular-nums tracking-tight text-foreground sm:text-5xl" style={HEADLINE_FONT}>
                {n}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------------- THE DAY */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F0A71F]">The day</div>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl" style={HEADLINE_FONT}>
              One day that brings the whole mil/vet podcast community together.
            </h2>
          </div>
          <div className="space-y-5 text-lg leading-relaxed text-muted-foreground">
            <p>
              National Military Podcast Day was created in 2021 by two Marine veterans, to recognize the podcasters
              telling military stories in their own words.
            </p>
            <p>
              The Podcastathon is how we mark it: {slotCount || 48} half-hour slots running back to back for a full day,
              each one hosted by a different show. Hosts broadcast from wherever they are, we handle the production, and
              the whole thing streams free on our own watch page and out to every host's channels at the same time.
            </p>
            <p className="text-foreground">
              There is one partner sponsorship, and we would like it to be the VFW.
            </p>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- LINEUP */}
      {lineup.length > 0 && (
        <section id="lineup" className="scroll-mt-16 border-y border-border bg-muted/30 py-16 lg:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F0A71F]">The lineup so far</div>
            <h2 className="mt-3 max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl" style={HEADLINE_FONT}>
              Shows already on the board.
            </h2>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              Every one of these hosts introduces the day's partner sponsor at the top and bottom of their show.
            </p>

            <div className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
              {lineup.map(({ signup, start }) => (
                <div
                  key={signup.id}
                  className="flex flex-col items-center rounded-2xl border border-border bg-background p-5 text-center"
                  data-testid={`card-vfw-podcaster-${signup.slotIndex}`}
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

      {/* ------------------------------------------------------------ OFFER */}
      <section id="offer" className="scroll-mt-16 py-16 lg:py-20" style={{ backgroundColor: NAVY }}>
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.28em]" style={{ color: GOLD }}>
              The offer
            </div>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl" style={HEADLINE_FONT}>
              Two ways in. Both start on {eventDate}.
            </h2>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            {/* Partner sponsorship — the ask */}
            <div className="relative rounded-3xl border-2 p-8 sm:p-10" style={{ borderColor: GOLD, backgroundColor: "rgba(255,255,255,0.04)" }}>
              <div className="absolute -top-3.5 left-8 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[#1a1200]" style={{ backgroundColor: GOLD }}>
                Our recommendation
              </div>
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-white/60">Partner sponsor</div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-6xl font-bold tabular-nums tracking-tight text-white" style={HEADLINE_FONT}>
                  {money(PARTNER_PRICE)}
                </span>
                <span className="text-white/55">· one available</span>
              </div>
              <p className="mt-4 text-white/75">
                The VFW name on the whole day, from the first show to the last — and a place on the schedule of your
                own.
              </p>

              {/* The airtime is what makes this a partnership rather than a logo
                  placement, so it gets its own frame instead of a bullet. */}
              <div className="mt-6 rounded-2xl border p-5" style={{ borderColor: "rgba(240,167,31,0.45)", backgroundColor: "rgba(240,167,31,0.08)" }}>
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: GOLD }}>
                  <Mic2 className="h-3.5 w-3.5" /> Two slots on the schedule
                </div>
                <div className="mt-2 text-lg font-semibold leading-snug text-white">
                  #StillServing: The VFW Podcast<span className="align-super text-xs">®</span>
                </div>
                <div className="mt-1 text-sm text-white/70">
                  Two {event?.slotMinutes ?? 30}-minute slots of your own, in prime positions on the day.
                </div>
              </div>

              <ul className="mt-7 space-y-3.5">
                {PARTNER_BENEFITS.map((b) => (
                  <li key={b} className="flex gap-3 text-sm leading-relaxed text-white/85">
                    <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: GOLD }} />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Per-slot — the low-friction add-on */}
            <div className="rounded-3xl border border-white/15 bg-white/[0.03] p-8 sm:p-10">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-white/60">Show sponsorship</div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-6xl font-bold tabular-nums tracking-tight text-white" style={HEADLINE_FONT}>
                  {money(SLOT_PRICE)}
                </span>
                <span className="text-white/55">per show · {slotCount || 48} slots</span>
              </div>
              <p className="mt-4 text-white/75">
                Back individual shows instead of the whole day — or add them on top of the partnership.
              </p>
              <ul className="mt-7 space-y-3.5">
                {[
                  "Named as the sponsor of that show, on air and on the agenda",
                  "Your logo on that show's slot and its “coming up next” bumper",
                  "A thank-you from the host, in their own words",
                  "Pick the shows that fit — by branch, by audience, or by time of day",
                  "Take as few or as many slots as you want, right up to the full day",
                ].map((b) => (
                  <li key={b} className="flex gap-3 text-sm leading-relaxed text-white/85">
                    <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: GOLD }} />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------- CTA */}
      <section className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl" style={HEADLINE_FONT}>
          Let's put the VFW on the air.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Happy to walk through any of this on a call, adjust the package, or send a formal agreement — whichever is
          easiest on your end.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a href="mailto:andrew@podlogix.co?subject=VFW%20title%20sponsorship%20%E2%80%94%20National%20Military%20Podcast%20Day">
            <Button size="lg" className="gap-2 rounded-full bg-[#053877] px-7 text-base font-semibold text-white hover:bg-[#0a4a99]">
              Start the conversation <ArrowRight className="h-4 w-4" />
            </Button>
          </a>
          <Link href="/agenda">
            <Button size="lg" variant="outline" className="rounded-full px-7 text-base">
              See the full agenda
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
