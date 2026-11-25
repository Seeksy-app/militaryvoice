import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays, MapPin, Plus, ArrowRight } from "lucide-react";
import type { PublicEvent } from "@shared/schema";
import { detectLocalTimeZone, formatDateInZone, formatTimeInZone } from "@/lib/schedule";
import { SiteFooter } from "@/components/SiteFooter";
import { eventDay, eventTimes } from "@shared/eventTime";
import { InterestDialog } from "@/components/InterestDialog";
import { IconTile } from "@/components/ui/icon-tile";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

/**
 * Every event on MilitaryVoices, and the way to put yours here. The Podcast
 * Marathon is the first; "Add your event" opens the same short form as
 * "Plan an event with us" on the About page.
 */
/** One card's worth: an event, or MilitaryVoices Radio's week (its days are one thing to the public). */
type Item = { key: string; title: string; tagline: string; image: string; start: Date; end: Date; when: string; href: string; cta: string; agenda?: string;
  /** The date alone, for a past event's small card. */
  short?: string;
  /** A member's own event (24 Nov): its tag, where, and how to get in, in its own zone. */
  tag?: string; where?: string; entry?: string; zone?: string };

/** The next week MilitaryVoices Radio is on air (Andrew, 21 Nov 2026): Mon 7 – Fri 11 Dec, 7 am – 10 pm ET. Shown until its days are in the schedule. */
/** Radio launch week, Mon 16 – Fri 20 Nov 2026 (never "the Marathon"). */
const RADIO_LAUNCH_WEEK = "2026-11-16";
const NEXT_RADIO = { week: "2026-12-07", firstUtc: "2026-12-07T12:00:00.000Z", lastUtc: "2026-12-11T12:00:00.000Z" } as const;

export default function Events() {
  const { data: events, isLoading } = useQuery<PublicEvent[]>({ queryKey: ["/api/events"] });
  const { data: dx } = useQuery<{ days: { startAtUtc: string }[] }>({ queryKey: ["/api/dx"] });
  const zone = detectLocalTimeZone();
  const items: Item[] = (events ?? []).map((e) => {
    const start = new Date(e.startAtUtc);
    const slug = e.isFeatured ? "" : e.slug;
    if (e.kind) {
      const tz = e.timezone || "America/New_York";
      const endIso = e.endAtUtc || new Date(start.getTime() + e.durationHours * 3600_000).toISOString();
      const city = (e.venueAddress.split(",").slice(-2).join(",").trim() || e.venueName);
      return {
        key: e.slug, title: e.name, tagline: e.tagline || e.description.split("\n")[0].slice(0, 180), image: e.imageUrl, start, end: new Date(endIso),
        when: `${eventDay(e.startAtUtc, tz)} · ${eventTimes(e.startAtUtc, endIso, tz)}`, short: eventDay(e.startAtUtc, tz), zone: tz,
        href: `/event/${e.slug}`, cta: e.signupMode === "free" ? "Register" : "See the event",
        tag: e.kind === "me" ? "" : "Lineup", where: e.mode === "person" ? `In person${city ? ` · ${city}` : ""}` : "Online",
        entry: e.signupMode === "free" ? "Free · Register to attend" : "Free · No sign-up needed",
      };
    }
    return {
      key: e.slug, title: e.name, tagline: e.tagline, image: e.imageUrl, start, end: new Date(start.getTime() + e.durationHours * 3600_000),
      when: `${formatDateInZone(start, zone)} · ${formatTimeInZone(start, zone)} · ${e.durationHours} hours, live`, short: formatDateInZone(start, zone),
      href: slug ? `/event/${slug}` : "/marathon", cta: "See the event", agenda: slug ? `/event/${slug}/agenda` : "/agenda",
    };
  });
  // Radio: one card per week on air. Only weekdays count (a weekend rehearsal day, like Sun 15 Nov, made the
  // card read "Mon, Nov 16 – Sun, Nov 15"), in order, grouped by the Monday of their week in Eastern time.
  const ET = "America/New_York";
  const weeks = new Map<string, Date[]>();
  for (const d of (dx?.days ?? []).map((x) => new Date(x.startAtUtc)).sort((x, y) => x.getTime() - y.getTime())) {
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: ET, weekday: "short" }).format(d);
    if (wd === "Sat" || wd === "Sun") continue;
    const monday = new Date(d.getTime() - (["Mon", "Tue", "Wed", "Thu", "Fri"].indexOf(wd)) * 86_400_000);
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: ET }).format(monday);
    weeks.set(key, [...(weeks.get(key) ?? []), d]);
  }
  // The next week on air (Andrew, 21 Nov: the week of Mon 7 Dec), shown before its days are in the schedule.
  if (!weeks.has(NEXT_RADIO.week)) weeks.set(NEXT_RADIO.week, [new Date(NEXT_RADIO.firstUtc), new Date(NEXT_RADIO.lastUtc)]);
  for (const [week, days] of Array.from(weeks.entries())) {
    const first = days[0], last = days[days.length - 1];
    // Each date stays on one line ("Fri, Nov 20", never "Nov / 20").
    const day = (d: Date) => formatDateInZone(d, ET).replace(/ /g, "\u00a0");
    const range = `${day(first)} – ${day(last)}`;
    const ahead = last.getTime() + 15 * 3600_000 >= Date.now();
    items.push({
      key: `radio-${week}`, title: week === RADIO_LAUNCH_WEEK ? "MilitaryVoices Radio launch week" : "MilitaryVoices Radio",
      tagline: "The live station for military and veteran voices: shows live from wherever their hosts are, weekdays 7\u00a0am to 10\u00a0pm Eastern.",
      // The launch art has "Nov 16 – 20 · free beta" on it, so it stays with that week.
      image: week === RADIO_LAUNCH_WEEK ? "/dx/hero.jpg?v=nov" : "/dx/onair.jpg", start: first, end: new Date(last.getTime() + 15 * 3600_000),
      when: ahead && week === NEXT_RADIO.week ? `Starting Monday, December 7 · weekdays, 7\u00a0am – 10\u00a0pm ET` : `${range} · weekdays, 7\u00a0am – 10\u00a0pm ET`,
      short: range, href: "/radio", cta: "Tune in",
    });
  }
  const now = Date.now();
  const upcoming = items.filter((i) => i.end.getTime() >= now).sort((a, b) => a.start.getTime() - b.start.getTime());
  const past = items.filter((i) => i.end.getTime() < now).sort((a, b) => b.start.getTime() - a.start.getTime());
  const addButton = (
    <Button size="lg" className="gap-2 rounded-full bg-[#F0A71F] px-6 font-medium text-[#1a1200] hover:bg-[#f5b94a]" data-testid="button-add-event">
      <Plus className="h-4 w-4" /> Add your event
    </Button>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NavBar />
      <header className="bg-[#000741] text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12 sm:px-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#F0A71F]">Events</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl" style={HEADLINE_FONT} data-testid="text-events-title">
              Military and veteran voices
            </h1>
            <p className="mt-3 max-w-xl text-white/70">Watch one, take part in one, or put on your own.</p>
          </div>
          <InterestDialog intent="register" trigger={addButton} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        {/* What's coming, big; what's over, small along the bottom (Andrew, 25 Nov: no Upcoming/Past tabs). */}
        <div className="grid gap-6 lg:grid-cols-3">
          {isLoading ? (
            <Skeleton className="h-96 w-full rounded-3xl lg:col-span-2" />
          ) : upcoming.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-border p-10 text-center text-muted-foreground lg:col-span-2">Nothing scheduled yet. Check back soon.</p>
          ) : (
            upcoming.map((item) => (
              <article key={item.key} className="group flex flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-sm transition-shadow hover:shadow-lg lg:col-span-2" data-testid={`event-${item.key}`}>
                <Link href={item.href} className="relative block aspect-video overflow-hidden bg-[#000741]">
                  {item.image ? <img src={item.image} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" /> : item.zone ? (
                    // No artwork: the date, big, in the event's own zone.
                    <span className="flex h-full w-full flex-col items-center justify-center text-white" style={{ background: "radial-gradient(ellipse 70% 120% at 82% 50%, #0d3a8a 0%, #05175a 40%, #000741 75%)" }}>
                      <span className="text-sm font-bold uppercase tracking-[0.2em] text-[#F0A71F]">{item.start.toLocaleDateString("en-US", { timeZone: item.zone, month: "short" })}</span>
                      <span className="text-7xl font-bold leading-none" style={HEADLINE_FONT}>{item.start.toLocaleDateString("en-US", { timeZone: item.zone, day: "numeric" })}</span>
                      <span className="mt-1 text-sm text-white/70">{item.start.toLocaleDateString("en-US", { timeZone: item.zone, weekday: "long" })}</span>
                    </span>
                  ) : null}
                </Link>
                <div className="flex flex-1 flex-col p-6">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-[#F0A71F]" /> {item.when}</span>
                    {item.where && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-[#F0A71F]" /> {item.where}</span>}
                    {item.tag && <span className="rounded-full bg-[#F0A71F]/20 px-2 py-0.5 text-xs font-semibold text-[#8a5a00] dark:text-[#F0A71F]">{item.tag}</span>}
                  </div>
                  <h2 className="mt-3 text-balance text-2xl font-bold tracking-tight text-card-foreground" style={HEADLINE_FONT}>{item.title}</h2>
                  {item.tagline && <p className="mt-1.5 text-muted-foreground">{item.tagline}</p>}
                  {item.entry && <p className="mt-2 text-sm font-semibold text-[#053877] dark:text-[#8ab4f8]">{item.entry}</p>}
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Link href={item.href}>
                      <Button className="gap-2 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]">{item.cta} <ArrowRight className="h-4 w-4" /></Button>
                    </Link>
                    {item.agenda && (
                      <Link href={item.agenda}>
                        <Button variant="outline" className="rounded-full">Agenda</Button>
                      </Link>
                    )}
                  </div>
                </div>
              </article>
            ))
          )}

          {/* Always last: the way in for the next one. */}
          <InterestDialog
            intent="register"
            trigger={
              <button type="button" className="flex min-h-64 flex-col items-center justify-center rounded-3xl border-2 border-dashed border-[#053877]/30 bg-[#053877]/[0.03] p-8 text-center transition-colors hover:border-[#053877]/60 hover:bg-[#053877]/[0.06] dark:border-white/20 dark:bg-white/[0.03]" data-testid="card-add-event">
                <IconTile icon={Plus} art="calendar" />
                <span className="mt-4 text-xl font-bold tracking-tight text-foreground" style={HEADLINE_FONT}>Add your event</span>
                <span className="mt-2 max-w-xs text-sm text-muted-foreground">
                  Running a day for your community? Put it on MilitaryVoices, with the studio, the green room and a page like this one.
                </span>
              </button>
            }
          />
        </div>

        {past.length > 0 && (
          <section className="mt-12" data-testid="events-past">
            <h2 className="text-lg font-bold tracking-tight text-foreground" style={HEADLINE_FONT}>Past events</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              {past.map((item) => (
                <Link key={item.key} href={item.href} className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-shadow hover:shadow-md" data-testid={`past-${item.key}`}>
                  <span className="block aspect-video overflow-hidden bg-[#000741]">
                    {item.image && <img src={item.image} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />}
                  </span>
                  <span className="flex flex-1 flex-col p-3 sm:p-4">
                    <span className="text-xs text-muted-foreground">{item.short ?? item.when}</span>
                    <span className="mt-1 text-balance font-semibold leading-snug text-card-foreground">{item.title}</span>
                    <span className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-semibold text-[#053877] group-hover:underline dark:text-[#8ab4f8]">See how it went <ArrowRight className="h-3.5 w-3.5" /></span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
