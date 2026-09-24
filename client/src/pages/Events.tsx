import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays, Clock3, Plus, ArrowRight } from "lucide-react";
import type { PublicEvent } from "@shared/schema";
import { detectLocalTimeZone, formatDateInZone, formatTimeInZone } from "@/lib/schedule";
import { SiteFooter } from "@/components/SiteFooter";
import { InterestDialog } from "@/components/InterestDialog";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

/**
 * Every event on MilitaryVoices, and the way to put yours here. The Podcast
 * Marathon is the first; "Add your event" opens the same short form as
 * "Plan an event with us" on the About page.
 */
export default function Events() {
  const { data: events, isLoading } = useQuery<PublicEvent[]>({ queryKey: ["/api/events"] });
  const zone = detectLocalTimeZone();
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
              Live days for military and veteran voices
            </h1>
            <p className="mt-3 max-w-xl text-white/70">Watch one, take part in one, or put on your own.</p>
          </div>
          <InterestDialog intent="register" trigger={addButton} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-3">
          {isLoading ? (
            <Skeleton className="h-96 w-full rounded-3xl lg:col-span-2" />
          ) : (
            (events ?? []).map((event) => {
              const start = new Date(event.startAtUtc);
              const href = event.isFeatured ? "/" : `/event/${event.slug}`;
              const agenda = event.isFeatured ? "/agenda" : `/event/${event.slug}/agenda`;
              return (
                <article key={event.id} className="group flex flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-sm transition-shadow hover:shadow-lg lg:col-span-2" data-testid={`event-${event.slug}`}>
                  <Link href={href} className="relative block aspect-[16/7] overflow-hidden bg-[#000741]">
                    {event.imageUrl && <img src={event.imageUrl} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" />}
                  </Link>
                  <div className="flex flex-1 flex-col p-6">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-[#F0A71F]" /> {formatDateInZone(start, zone)}</span>
                      <span className="inline-flex items-center gap-1.5"><Clock3 className="h-4 w-4 text-[#F0A71F]" /> {formatTimeInZone(start, zone)} · {event.durationHours} hours, live</span>
                    </div>
                    <h2 className="mt-3 text-2xl font-bold tracking-tight text-card-foreground" style={HEADLINE_FONT}>{event.name}</h2>
                    {event.tagline && <p className="mt-1.5 text-muted-foreground">{event.tagline}</p>}
                    <div className="mt-6 flex flex-wrap gap-3">
                      <Link href={href}>
                        <Button className="gap-2 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]">See the event <ArrowRight className="h-4 w-4" /></Button>
                      </Link>
                      <Link href={agenda}>
                        <Button variant="outline" className="rounded-full">Agenda</Button>
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })
          )}

          {/* Always last: the way in for the next one. */}
          <InterestDialog
            intent="register"
            trigger={
              <button type="button" className="flex min-h-64 flex-col items-center justify-center rounded-3xl border-2 border-dashed border-[#053877]/30 bg-[#053877]/[0.03] p-8 text-center transition-colors hover:border-[#053877]/60 hover:bg-[#053877]/[0.06] dark:border-white/20 dark:bg-white/[0.03]" data-testid="card-add-event">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#053877] text-[#F0A71F]"><Plus className="h-6 w-6" /></span>
                <span className="mt-4 text-xl font-bold tracking-tight text-foreground" style={HEADLINE_FONT}>Add your event</span>
                <span className="mt-2 max-w-xs text-sm text-muted-foreground">
                  Running a day for your community? Put it on MilitaryVoices, with the studio, the green room and a page like this one.
                </span>
              </button>
            }
          />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
