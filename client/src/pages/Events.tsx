import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays, Plus, ArrowRight } from "lucide-react";
import type { PublicEvent } from "@shared/schema";
import { detectLocalTimeZone, formatDateInZone, formatTimeInZone } from "@/lib/schedule";
import { SiteFooter } from "@/components/SiteFooter";
import { InterestDialog } from "@/components/InterestDialog";
import { IconTile } from "@/components/ui/icon-tile";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

/**
 * Every event on MilitaryVoices, and the way to put yours here. The Podcast
 * Marathon is the first; "Add your event" opens the same short form as
 * "Plan an event with us" on the About page.
 */
/** One card's worth: an event, or the Digital Experience's week (its days are one thing to the public). */
type Item = { key: string; title: string; tagline: string; image: string; start: Date; end: Date; when: string; href: string; cta: string; agenda?: string };

export default function Events() {
  const { data: events, isLoading } = useQuery<PublicEvent[]>({ queryKey: ["/api/events"] });
  const { data: dx } = useQuery<{ days: { startAtUtc: string }[] }>({ queryKey: ["/api/dx"] });
  const zone = detectLocalTimeZone();
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const items: Item[] = (events ?? []).map((e) => {
    const start = new Date(e.startAtUtc);
    const slug = e.isFeatured ? "" : e.slug;
    return {
      key: e.slug, title: e.name, tagline: e.tagline, image: e.imageUrl, start, end: new Date(start.getTime() + e.durationHours * 3600_000),
      when: `${formatDateInZone(start, zone)} · ${formatTimeInZone(start, zone)} · ${e.durationHours} hours, live`,
      href: slug ? `/event/${slug}` : "/marathon", cta: "See the event", agenda: slug ? `/event/${slug}/agenda` : "/agenda",
    };
  });
  if (dx?.days.length) {
    const first = new Date(dx.days[0].startAtUtc), last = new Date(dx.days[dx.days.length - 1].startAtUtc);
    items.push({
      key: "digital-experience", title: "MilitaryVoices Digital Experience", tagline: "A live channel of military and veteran voices, weekdays 7 am to 10 pm Eastern. Take 30 or 60 minutes. Free during the beta week.",
      image: "/dx/hero.jpg", start: first, end: new Date(last.getTime() + 15 * 3600_000),
      when: `${formatDateInZone(first, zone)} – ${formatDateInZone(last, zone)} · weekdays, 7 am – 10 pm ET`, href: "/digital-experience", cta: "Pick your time",
    });
  }
  const now = Date.now();
  const upcoming = items.filter((i) => i.end.getTime() >= now).sort((a, b) => a.start.getTime() - b.start.getTime());
  const past = items.filter((i) => i.end.getTime() < now).sort((a, b) => b.start.getTime() - a.start.getTime());
  const shown = tab === "upcoming" ? upcoming : past;
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
        {/* What's coming first; what's over under Past (Andrew, 20 Oct). */}
        <div className="mb-6 inline-flex gap-1 rounded-full border border-border bg-card p-1 text-sm" role="tablist" data-testid="events-when">
          {([["upcoming", "Upcoming", upcoming.length], ["past", "Past", past.length]] as const).map(([k, label, n]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`rounded-full px-5 py-2 font-semibold ${tab === k ? "bg-[#053877] text-white" : "text-muted-foreground hover:text-foreground"}`} data-testid={`events-${k}`}>
              {label} <span className="tabular-nums opacity-70">{n}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          {isLoading ? (
            <Skeleton className="h-96 w-full rounded-3xl lg:col-span-2" />
          ) : shown.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-border p-10 text-center text-muted-foreground lg:col-span-2">{tab === "upcoming" ? "Nothing scheduled yet. Check back soon." : "No past events yet."}</p>
          ) : (
            shown.map((item) => (
              <article key={item.key} className="group flex flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-sm transition-shadow hover:shadow-lg lg:col-span-2" data-testid={`event-${item.key}`}>
                <Link href={item.href} className="relative block aspect-video overflow-hidden bg-[#000741]">
                  {item.image && <img src={item.image} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" />}
                </Link>
                <div className="flex flex-1 flex-col p-6">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-[#F0A71F]" /> {item.when}</span>
                  </div>
                  <h2 className="mt-3 text-2xl font-bold tracking-tight text-card-foreground" style={HEADLINE_FONT}>{item.title}</h2>
                  {item.tagline && <p className="mt-1.5 text-muted-foreground">{item.tagline}</p>}
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Link href={item.href}>
                      <Button className="gap-2 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]">{tab === "past" ? "See how it went" : item.cta} <ArrowRight className="h-4 w-4" /></Button>
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
          {tab === "upcoming" && <InterestDialog
            intent="register"
            trigger={
              <button type="button" className="flex min-h-64 flex-col items-center justify-center rounded-3xl border-2 border-dashed border-[#053877]/30 bg-[#053877]/[0.03] p-8 text-center transition-colors hover:border-[#053877]/60 hover:bg-[#053877]/[0.06] dark:border-white/20 dark:bg-white/[0.03]" data-testid="card-add-event">
                <IconTile icon={Plus} />
                <span className="mt-4 text-xl font-bold tracking-tight text-foreground" style={HEADLINE_FONT}>Add your event</span>
                <span className="mt-2 max-w-xs text-sm text-muted-foreground">
                  Running a day for your community? Put it on MilitaryVoices, with the studio, the green room and a page like this one.
                </span>
              </button>
            }
          />}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
