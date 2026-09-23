import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, API_BASE } from "@/lib/queryClient";
import { slotStart, onAirWindow, formatTimeInZone } from "@/lib/schedule";
import type { PublicEvent, PublicSignup } from "@shared/schema";
import { POSTS_BEFORE_PER_SHOW, plannedPosts } from "@shared/promo";
import { Download, Copy, Check, Image as ImageIcon, CalendarDays } from "lucide-react";
import { useState } from "react";

// The pictures the host actually posts, and when to post each one.
//
// Two kinds. One poster with the whole board on it, for "look who's coming",
// and one spotlight per show, for "this is who's on at 8am". Both are rendered
// server-side from the live lineup, so a host who signed up this morning is on
// the poster this afternoon without anyone remaking anything.
//
// The schedule below is the part that makes this usable rather than just a
// folder of images: two spotlights a day, in slot order, working back from the
// event. Without dates attached these are twenty files nobody gets round to.

const ZONE = "America/New_York";

interface Props {
  event: PublicEvent;
}

function CopyLine({ text, testId }: { text: string; testId: string }) {
  const { toast } = useToast();
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7 shrink-0 gap-1.5 px-2 text-xs"
      data-testid={testId}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        } catch {
          toast({ title: "Couldn't copy", variant: "destructive" });
        }
      }}
    >
      {done ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />} {done ? "Copied" : "Copy caption"}
    </Button>
  );
}

export function RiccohImages({ event }: Props) {
  const { data: signups } = useQuery<PublicSignup[]>({
    queryKey: ["/api/signups", event.id],
    queryFn: async () => (await apiRequest("GET", `/api/signups?eventId=${event.id}`)).json(),
  });

  const shows = useMemo(
    () => (signups ?? []).filter((s) => s.status !== "cancelled").sort((a, b) => a.slotIndex - b.slotIndex),
    [signups],
  );

  const eventDate = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: ZONE }).format(
    new Date(event.startAtUtc),
  );

  /**
   * Two spotlights a day, finishing the day before the event.
   *
   * Working backwards from the event rather than forwards from today means the
   * last show posted is the one going out first on the day, and adding another
   * host tomorrow shifts the start earlier instead of pushing anyone past the
   * finish line.
   */
  const schedule = useMemo(() => {
    const perDay = 2;
    const days = Math.ceil(shows.length / perDay);
    const lastDay = new Date(event.startAtUtc);
    lastDay.setDate(lastDay.getDate() - 1);
    return shows.map((s, i) => {
      const dayOffset = days - 1 - Math.floor(i / perDay);
      const when = new Date(lastDay);
      when.setDate(when.getDate() - dayOffset);
      return { signup: s, postOn: when, slot: i % perDay === 0 ? "morning" : "afternoon" };
    });
  }, [shows, event.startAtUtc]);

  function airLabel(s: PublicSignup) {
    const air = onAirWindow(slotStart(event.startAtUtc, event.slotMinutes, s.slotIndex), {
      onAirMinutes: event.onAirMinutes,
      bufferMinutes: event.bufferMinutes,
      bufferPosition: event.bufferPosition,
    });
    return formatTimeInZone(air.start, ZONE);
  }

  function spotlightCaption(s: PublicSignup) {
    return `IN THE SPOTLIGHT 🎙️

${s.podcastName}${s.hostName ? ` — with ${s.hostName}` : ""} is on at ${airLabel(s)} on ${eventDate}.

26.2 miles of military and veteran stories, back to back, free to watch. Who's tuning in for this one?

Register to watch → militaryvoices.ai/watch`;
  }

  /**
   * The names live here, not on the poster.
   *
   * Setting twenty-nine show names under twenty-nine faces meant wrapping,
   * truncating, and faces half the size they should be — all to render text
   * nobody can read at thumbnail size anyway. In the caption they are
   * searchable, they are taggable, and every host can find their own show,
   * which is the thing that actually gets a lineup post reshared.
   */
  const posterCaption = `${shows.length} shows. One day. ${eventDate}.

This is the start line for the Mil/Vet Podcast Marathon. Combat vets, military spouses, Gold Star families — going out back to back for a full day and night.

${shows.map((s) => `• ${s.podcastName}`).join("\n")}

Every one of them is free to watch, and so is the whole day.

Register → militaryvoices.ai/watch`;

  const sizes = [
    { key: "square", label: "Square 1080", hint: "Instagram, LinkedIn, Facebook" },
    { key: "story", label: "Story 1080×1920", hint: "Stories and Reels covers" },
    { key: "wide", label: "Wide 1200×630", hint: "X, link previews" },
  ] as const;

  if (shows.length === 0) {
    return <p className="text-sm text-muted-foreground">No confirmed shows yet — the images build themselves once the board fills.</p>;
  }

  return (
    <section className="flex flex-col gap-8" data-testid="section-riccoh-images">
      {/* ------------------------------------------------------- the poster */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-foreground">The whole board</h3>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Everyone who has signed up, on one image. It rebuilds itself from the live lineup, so post it again whenever
          the board grows — it will have the new hosts on it.
        </p>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
          <img
            src={`${API_BASE}/og/lineup.jpg?size=square`}
            alt={`All ${shows.length} shows on the lineup`}
            className="h-auto w-full self-start rounded-xl border border-border"
            data-testid="img-lineup-poster"
          />
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {sizes.map((sz) => (
                <a
                  key={sz.key}
                  href={`${API_BASE}/og/lineup.jpg?size=${sz.key}`}
                  download={`lineup-${sz.key}.jpg`}
                  target="_blank"
                  rel="noreferrer"
                  data-testid={`download-lineup-${sz.key}`}
                >
                  <Button size="sm" variant="outline" className="gap-1.5">
                    <Download className="h-3.5 w-3.5" /> {sz.label}
                  </Button>
                </a>
              ))}
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Caption</span>
                <CopyLine text={posterCaption} testId="copy-poster-caption" />
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-card-foreground">{posterCaption}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------- the spotlights */}
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
            Spotlights — one per show
          </h3>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" /> two a day, finishing the day before
          </span>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Each one names the show, the host and their time, and asks people to register. Posted on the dates below they
          fill the {Math.ceil(shows.length / 2)} days before the event — {POSTS_BEFORE_PER_SHOW} posts per show across
          the run-up and the clips afterwards comes to {plannedPosts(shows.length).toLocaleString()} in all.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          {schedule.map(({ signup, postOn, slot }) => (
            <article
              key={signup.id}
              className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row"
              data-testid={`spotlight-${signup.slotIndex}`}
            >
              <img
                src={`${API_BASE}/og/spotlight/${signup.id}.jpg?size=square`}
                alt={`Spotlight card for ${signup.podcastName}`}
                loading="lazy"
                className="h-auto w-full shrink-0 self-start rounded-lg border border-border sm:w-[200px]"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="rounded-full bg-[#053877]/10 px-2.5 py-0.5 text-xs font-semibold text-[#053877] dark:bg-[#F0A71F]/15 dark:text-[#F0A71F]">
                    Post {new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(postOn)}
                    {" · "}
                    {slot}
                  </span>
                  <span className="text-sm font-semibold text-foreground">{signup.podcastName}</span>
                  <span className="text-xs text-muted-foreground">on air {airLabel(signup)}</span>
                </div>

                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {spotlightCaption(signup)}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <CopyLine text={spotlightCaption(signup)} testId={`copy-spotlight-${signup.id}`} />
                  {sizes.map((sz) => (
                    <a
                      key={sz.key}
                      href={`${API_BASE}/og/spotlight/${signup.id}.jpg?size=${sz.key}`}
                      download={`spotlight-${signup.podcastName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${sz.key}.jpg`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs">
                        <ImageIcon className="h-3 w-3" /> {sz.key}
                      </Button>
                    </a>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
