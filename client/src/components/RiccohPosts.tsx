import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { PublicEvent } from "@shared/schema";
import { Copy, Check, Download, MessageSquare, Hash } from "lucide-react";

// Ten posts for the host to run in the weeks around the event.
//
// Written as finished copy, not prompts. A "template" with blanks in it gets
// posted with the blanks still in, or not posted at all — so the date, the
// link and the slot count are filled in from the live event before he ever
// sees them, and every one of these is ready to paste as-is.
//
// Each post comes in three parts because that's how they're actually posted:
// the caption, the hashtags, and a first comment. Hashtags in the first
// comment rather than the caption keeps the post readable and does not cost
// reach on Instagram or LinkedIn; the link goes there too, because a link in
// the caption is downranked on most of these platforms.

interface Post {
  id: string;
  /** When to run it, so ten posts read as a campaign rather than a pile. */
  when: string;
  purpose: string;
  caption: string;
  hashtags: string;
  comment: string;
}

const CORE_TAGS = "#NationalMilitaryPodcastDay #MilitaryPodcast #VeteranVoices #MilitaryVoice";

function buildPosts(dateLong: string, dateShort: string, slots: number, url: string): Post[] {
  return [
    {
      id: "announce",
      when: "Now — the announcement",
      purpose: "Says what the day is in one breath. Everything else builds on this one.",
      caption: `On ${dateLong}, we are running 26.2.

${slots} military and veteran podcasters. Back to back. One show hands to the next, all day and all night, and nobody gets skipped because their audience is small or their timeslot is 3 a.m.

That's the Podcast Marathon. National Military Podcast Day, and this year we're doing it live.

Free to watch. Free to be on.`,
      hashtags: `${CORE_TAGS} #PodcastMarathon #VeteranPodcaster #MilitaryCommunity`,
      comment: `Watch it free here → ${url}

If you host a military or veteran show and you want a slot, that link takes you there too.`,
    },
    {
      id: "why",
      when: "Now — the personal one",
      purpose: "His own why. The post that makes people care about the rest.",
      caption: `Thirty-three years in the Marine Corps. Five combat tours.

The stories I carry from those years are not the ones that made the news. They're the ones somebody told me at 2 a.m. on a flight line, and then never told anybody again.

That's what this day is for. ${slots} shows, 26.2, ${dateShort}. Every one of them hosted by somebody who served or loves somebody who did.

We are done waiting for permission to tell our own stories.`,
      hashtags: `${CORE_TAGS} #VeteranOwned #MarineCorps #TellYourStory`,
      comment: `${dateLong}. The whole day is free to watch → ${url}`,
    },
    {
      id: "recruit",
      when: "Now — until the board is full",
      purpose: "The ask to other podcasters. Run it weekly until the slots go.",
      caption: `Do you host a military or veteran podcast?

There is a slot on ${dateShort} with your name on it. Thirty minutes, live, on a stage with ${slots} other shows.

Here's what you don't need: a studio, a producer, a crew, or an audience. We run the whole broadcast. You show up and do what you already do every week.

Here's what you get: your show in front of everybody else's listeners, clips cut for you afterwards, and your name on the day.

It costs you nothing.`,
      hashtags: `${CORE_TAGS} #PodcastersOfInstagram #VeteranPodcaster #MilVet`,
      comment: `Claim a time here → ${url}

Slots go in order. The good hours go first — that's just how it works.`,
    },
    {
      id: "sponsor",
      when: "Now — for the business audience",
      purpose: "Sponsor ask. Best on LinkedIn; works on Facebook.",
      caption: `A question for the companies that say they support veterans.

On ${dateLong}, ${slots} military and veteran podcasters broadcast for 24 straight hours. Free for them, free for anyone who wants to listen.

Somebody pays for that. Right now that somebody is us.

If your company wants its name on a day built entirely around military voices — not a logo on a banner at a golf tournament, an actual day of actual veterans talking — I'd like to hear from you.

I'll take the call myself.`,
      hashtags: `#VeteranOwned #MilitaryCommunity #Sponsorship #CorporateSocialResponsibility ${CORE_TAGS}`,
      comment: `What sponsorship looks like, and what it costs → ${url}/sponsor

Or just reply here and I'll come to you.`,
    },
    {
      id: "lineup",
      when: "Two weeks out",
      purpose: "Lineup reveal. Tag every host — their audiences are the point.",
      caption: `The board for ${dateShort} is filling up.

Look at this lineup. Combat vets. Military spouses. Gold Star families. Guys who've been podcasting for eight years and one host who recorded her first episode last month.

That last part matters. This is not a curated showcase of the biggest shows. It's the community, the whole community, in the order they signed up.

26.2 miles. Nobody gets cut.`,
      hashtags: `${CORE_TAGS} #PodcastMarathon #MilitaryFamilies #VeteranVoices`,
      comment: `Full lineup and times → ${url}

Tag a show that belongs on this board.`,
    },
    {
      id: "week",
      when: "Seven days out",
      purpose: "Countdown. Short, high-energy, no new information.",
      caption: `One week.

${dateLong}. ${slots} shows. 26.2 miles of stories. One continuous broadcast.

I have done a lot of hard things in uniform. Staying awake for this one is going to be its own kind of hard, and I would not miss it.

Set a reminder. I'm serious.`,
      hashtags: `${CORE_TAGS} #OneWeek #PodcastMarathon #MilitaryPodcast`,
      comment: `Set your reminder here and we'll text you before it starts → ${url}`,
    },
    {
      id: "overnight",
      when: "Three days out",
      purpose: "The best hook of the ten. Sells the overnight hours to insomniacs and shift workers.",
      caption: `Somebody asked me who's going to be watching at 0300.

Let me tell you exactly who.

The guy on a midnight shift at a plant in Ohio. The nurse on nights. The spouse in Okinawa where 0300 here is a perfectly reasonable afternoon. The veteran who hasn't slept properly since 2011 and knows exactly why.

That is not dead air. That is the watch.

We've all stood it. On ${dateShort}, somebody will be talking the whole time.`,
      hashtags: `${CORE_TAGS} #StandingWatch #NightShift #VeteranMentalHealth #MilitaryCommunity`,
      comment: `The full route, mile by mile → ${url}

Find your 0300. Somebody will be on.`,
    },
    {
      id: "families",
      when: "Two days out",
      purpose: "Widens the audience past veterans themselves. Strong on Facebook.",
      caption: `This one is for the people who didn't wear the uniform.

The spouse who moved eleven times. The kid who started at four different high schools. The mother who learned to read a casualty notification from the way a car door closes.

You served too. Different job, same war.

There are shows on ${dateShort} hosted by you, about you, and I want you watching. All of it is free and none of it requires you to have been anywhere near a rifle range.`,
      hashtags: `${CORE_TAGS} #MilitarySpouse #MilitaryFamilies #MilitaryBrat #GoldStarFamily`,
      comment: `${dateLong}, free to watch → ${url}`,
    },
    {
      id: "live",
      when: "Morning of the event",
      purpose: "The go-live post. Pin it and re-share it through the day.",
      caption: `We're live.

26.2. ${slots} shows. Starting now and not stopping until the finish line tonight.

Drop in whenever. Leave whenever. Come back at 2 a.m. and somebody will still be talking.

This is what it sounds like when we tell our own stories.`,
      hashtags: `${CORE_TAGS} #LiveNow #PodcastMarathon #MilitaryPodcast`,
      comment: `Watching here → ${url}

Tell me in the comments where you're listening from. I'll read them on air.`,
    },
    {
      id: "thanks",
      when: "The day after",
      purpose: "Closes the loop and points at the replays, which keep earning for months.",
      caption: `We did it. 26.2, ${slots} shows, not one minute of dead air.

To every host who gave up a day to be part of this — you built something. To everyone who watched at 3 a.m. — I saw the numbers, and I see you.

Every single show is up and free to watch. Start anywhere.

Same time next year. Bring somebody.`,
      hashtags: `${CORE_TAGS} #ThankYou #PodcastMarathon #VeteranVoices`,
      comment: `Every show from the day, free → ${url}

Tell me which one you're starting with.`,
    },
  ];
}

function plainText(posts: Post[], dateLong: string): string {
  return [
    `NATIONAL MILITARY PODCAST DAY — ${dateLong}`,
    `Social posts for Riccoh Player`,
    ``,
    `Each post has three parts: the caption, the hashtags, and a first comment.`,
    `Post the caption on its own, then drop the hashtags and the link in the`,
    `first comment underneath. Links in the caption get downranked on most`,
    `platforms; in the first comment they do not.`,
    ``,
    ...posts.flatMap((p, i) => [
      `${"=".repeat(72)}`,
      `${i + 1}. ${p.when.toUpperCase()}`,
      `${p.purpose}`,
      `${"-".repeat(72)}`,
      `CAPTION`,
      ``,
      p.caption,
      ``,
      `HASHTAGS`,
      ``,
      p.hashtags,
      ``,
      `FIRST COMMENT`,
      ``,
      p.comment,
      ``,
      ``,
    ]),
  ].join("\n");
}

function CopyButton({ text, label, testId }: { text: string; label: string; testId: string }) {
  const { toast } = useToast();
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7 gap-1.5 px-2 text-xs"
      data-testid={testId}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 1600);
        } catch {
          toast({ title: "Couldn't copy", description: "Select the text and copy it by hand.", variant: "destructive" });
        }
      }}
    >
      {done ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />} {done ? "Copied" : label}
    </Button>
  );
}

export function RiccohPosts({ event }: { event: PublicEvent }) {
  const { toast } = useToast();
  const zone = "America/New_York";
  const start = new Date(event.startAtUtc);
  const dateLong = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: zone }).format(start);
  const dateShort = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: zone }).format(start);
  const slots = Math.max(1, Math.floor((event.durationHours * 60) / event.slotMinutes));
  const url = typeof window !== "undefined" ? window.location.origin : "https://militaryvoice.ai";

  const posts = useMemo(() => buildPosts(dateLong, dateShort, slots, url), [dateLong, dateShort, slots, url]);

  function downloadAll() {
    const blob = new Blob([plainText(posts, dateLong)], { type: "text/plain;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `riccoh-social-posts-${start.toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
    toast({ title: "Downloaded", description: "All ten, with hashtags and first comments." });
  }

  return (
    <section data-testid="section-riccoh-posts">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-foreground">Posts for Riccoh</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Ten finished posts, in order, from the announcement to the day after. Dates and the link are already filled
            in. Post the caption on its own, then paste the hashtags and the link into the first comment underneath —
            that keeps the post readable and stops the platform burying it for carrying a link.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadAll} data-testid="button-download-posts">
          <Download className="h-3.5 w-3.5" /> Download all ten
        </Button>
      </div>

      <div className="flex flex-col gap-4">
        {posts.map((p, i) => (
          <article key={p.id} className="overflow-hidden rounded-2xl border border-border bg-card" data-testid={`post-${p.id}`}>
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-5 py-3">
              <div className="flex items-baseline gap-3">
                <span className="text-xs font-bold tabular-nums text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <div className="text-sm font-semibold text-foreground">{p.when}</div>
                  <div className="text-xs text-muted-foreground">{p.purpose}</div>
                </div>
              </div>
              <CopyButton
                text={`${p.caption}\n\n${p.hashtags}`}
                label="Copy caption + tags"
                testId={`copy-all-${p.id}`}
              />
            </header>

            <div className="px-5 py-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Caption</span>
                <CopyButton text={p.caption} label="Copy" testId={`copy-caption-${p.id}`} />
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-card-foreground">{p.caption}</p>
            </div>

            <div className="border-t border-border px-5 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <Hash className="h-3 w-3" /> Hashtags
                </span>
                <CopyButton text={p.hashtags} label="Copy" testId={`copy-tags-${p.id}`} />
              </div>
              <p className="mt-1 text-sm text-[#053877] dark:text-[#8ab4f8]">{p.hashtags}</p>
            </div>

            <div className="border-t border-border bg-muted/20 px-5 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <MessageSquare className="h-3 w-3" /> First comment
                </span>
                <CopyButton text={p.comment} label="Copy" testId={`copy-comment-${p.id}`} />
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-card-foreground">{p.comment}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
