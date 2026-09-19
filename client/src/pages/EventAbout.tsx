import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import type { PublicEvent } from "@shared/schema";
import { CalendarDays, Radio } from "lucide-react";
import { SiteFooter } from "@/components/SiteFooter";

// The event's own About page — about the day, not about us. One per event,
// so a second tenant gets theirs by filling in a field, and the "What is
// the day?" campaign post has somewhere real to send people.

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

const DEFAULT_ABOUT = `## What it is

National Military Podcast Day is a day set aside for the shows made by and for the military and veteran community — the hosts who talk about service, transition, family, business, humour and everything after the uniform.

On MilitaryVoice.ai we mark it with a marathon: 26.2 — twenty-six shows and the bonus sessions that make up the point-two — back to back from breakfast to late evening, one stage, dozens of podcasters, each bringing their own audience to everyone else's.

## Why it matters

Military and veteran podcasts are one of the most honest records of service life there is. They rarely get a stage together. For one day a year they do.

## How to take part

**If you make a podcast:** book a slot, set your show up once, and we handle the studio, the stream and the promotion. Your segment goes out on our channel and, if you connect it, your own.

**If you listen:** open the agenda, set a reminder for the shows you care about, and share the day with someone who'd want to hear it.

**If you'd like to support it:** sponsors keep the day free for every podcaster on it. Get in touch from the Sponsors link above.`;

function render(body: string) {
  return body
    .trim()
    .split(/\n\s*\n/)
    .map((block, i) => {
      const t = block.trim();
      if (t.startsWith("## ")) {
        return (
          <h2 key={i} className="mt-4 text-xl font-semibold tracking-tight text-foreground" style={HEADLINE_FONT}>
            {t.slice(3)}
          </h2>
        );
      }
      // **bold** inline, nothing else.
      const parts = t.split(/(\*\*[^*]+\*\*)/g).map((seg, j) =>
        seg.startsWith("**") && seg.endsWith("**") ? (
          <strong key={j} className="font-semibold text-foreground">
            {seg.slice(2, -2)}
          </strong>
        ) : (
          seg
        ),
      );
      return (
        <p key={i} className="text-base leading-relaxed text-muted-foreground">
          {parts}
        </p>
      );
    });
}

export default function EventAbout({ slug }: { slug?: string }) {
  const { data: event } = useQuery<PublicEvent>({
    queryKey: ["/api/event", slug ?? "featured"],
    queryFn: async () =>
      (await apiRequest("GET", slug ? `/api/event?slug=${encodeURIComponent(slug)}` : "/api/event")).json(),
  });

  const occasion = event?.occasion || "National Military Podcast Day";
  useEffect(() => {
    document.title = `About ${occasion} — MilitaryVoice.ai`;
  }, [occasion]);

  const when = event
    ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" }).format(new Date(event.startAtUtc))
    : "";
  const agendaHref = slug ? `/event/${slug}/agenda` : "/agenda";
  const scheduleHref = slug ? `/event/${slug}/schedule` : "/schedule";

  return (
    <div className="min-h-screen">
      <NavBar />
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">About the day</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl" style={HEADLINE_FONT}>
          {occasion}
        </h1>
        {event && (
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4" /> {when}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Radio className="h-4 w-4" /> {event.name} · {event.durationHours} hours live
            </span>
          </p>
        )}

        <div className="mt-8 flex flex-col gap-4">{render(event?.about?.trim() ? event.about : DEFAULT_ABOUT)}</div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Button asChild className="rounded-full">
            <Link href={agendaHref}>See who's on</Link>
          </Button>
          <Button asChild variant="outline" className="rounded-full">
            <Link href={scheduleHref}>Book a slot</Link>
          </Button>
        </div>
      </div>
    <SiteFooter />
    </div>
  );
}
