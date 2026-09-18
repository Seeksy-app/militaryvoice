import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays, Radio, ArrowRight } from "lucide-react";
import type { PublicEvent } from "@shared/schema";
import { detectLocalTimeZone, formatDateInZone, formatTimeInZone } from "@/lib/schedule";
import { SiteFooter } from "@/components/SiteFooter";

export default function Events() {
  const { data: events, isLoading } = useQuery<PublicEvent[]>({ queryKey: ["/api/events"] });
  const zone = detectLocalTimeZone();

  return (
    <div className="min-h-screen">
      <NavBar />
      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <h1
          className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
          style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}
          data-testid="text-events-title"
        >
          Choose Your Event
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Pick a marathon to view its schedule, claim a slot, or drop your email for a reminder.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {isLoading
            ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)
            : (events ?? []).map((event) => {
                const start = new Date(event.startAtUtc);
                return (
                  <Link key={event.id} href={`/event/${event.slug}`} data-testid={`link-event-${event.slug}`}>
                    <Card className="flex h-full flex-col gap-3 p-5 transition-colors hover-elevate">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant={event.isFeatured ? "default" : "outline"} className="w-fit gap-1 text-xs font-medium">
                          <Radio className="h-3 w-3" /> {event.isFeatured ? "Featured" : "Upcoming"}
                        </Badge>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold leading-tight text-card-foreground">{event.name}</h2>
                        {event.tagline && <p className="mt-1 text-sm text-muted-foreground">{event.tagline}</p>}
                      </div>
                      <div className="mt-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CalendarDays className="h-3.5 w-3.5" />
                        {formatDateInZone(start, zone)} · {formatTimeInZone(start, zone)}
                      </div>
                    </Card>
                  </Link>
                );
              })}
        </div>

        {!isLoading && (events ?? []).length === 0 && (
          <div className="mt-8 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
            No events are scheduled yet — check back soon.
          </div>
        )}
      </section>
    <SiteFooter />
    </div>
  );
}
