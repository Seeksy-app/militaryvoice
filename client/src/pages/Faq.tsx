import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import type { PublicEvent } from "@shared/schema";
import { detectLocalTimeZone, formatDateInZone, formatTimeInZone, zoneLabel } from "@/lib/schedule";
import { Mic2, Headphones, HelpCircle, ArrowRight, Mail } from "lucide-react";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

interface QA {
  q: string;
  a: React.ReactNode;
}

export default function Faq() {
  const { data: event } = useQuery<PublicEvent>({ queryKey: ["/api/event"] });
  const zone = detectLocalTimeZone();
  const start = event ? new Date(event.startAtUtc) : null;
  const slotMin = event?.slotMinutes ?? 30;
  const onAir = event?.onAirMinutes ?? 25;
  const buffer = event?.bufferMinutes ?? 5;

  const general: QA[] = [
    {
      q: "What is the 24 Hour Podcastathon?",
      a: (
        <>
          Twenty-four straight hours of live veteran podcasting on National Military Podcast Day. Back-to-back shows, special
          guests, and stories from the community, streaming around the clock. Shows hand off to each other every {slotMin}{" "}
          minutes, so someone is always on the air.
        </>
      ),
    },
    {
      q: "When is it?",
      a: start ? (
        <>
          It starts {formatDateInZone(start, zone)} at {formatTimeInZone(start, zone)} {zoneLabel(zone)} and runs for{" "}
          {event?.durationHours ?? 24} hours. Every time on this site is shown in your own time zone, and you can switch zones
          on the schedule and agenda.
        </>
      ) : (
        <>October 5, 2026, running for 24 hours. Every time on this site is shown in your own time zone.</>
      ),
    },
    {
      q: "Who is hosting?",
      a: (
        <>
          Riccoh Player. Thirty-three years in the Marine Corps, five combat tours, an Emmy, and a seat beside a global media
          executive. He anchors the day and hands off to each show as it goes live.
        </>
      ),
    },
    {
      q: "Does it cost anything?",
      a: <>No. It's free for podcasters to claim a slot and free for listeners to follow along.</>,
    },
  ];

  const podcasters: QA[] = [
    {
      q: "Who can claim a slot?",
      a: (
        <>
          Veteran and military-community podcasters. If your show is by, for, or about the military community, you belong on
          the board. Solo hosts and two-person shows are both welcome.
        </>
      ),
    },
    {
      q: "How do I claim a slot?",
      a: (
        <>
          Three steps. Pick an open time on the{" "}
          <Link href="/schedule#schedule" className="text-primary underline-offset-2 hover:underline">
            schedule
          </Link>
          , enter your email and the one-time code we send you, then set up your show once with a photo, your show name, and
          your RSS feed. Your slot is confirmed the moment you save.
        </>
      ),
    },
    {
      q: "Do I need a password?",
      a: (
        <>
          No. Every sign-in uses a 6-digit code emailed to you. Your email is your account, so use the same one each time you
          come back.
        </>
      ),
    },
    {
      q: "How long is a slot, and how much of it am I on the air?",
      a: (
        <>
          Each slot is {slotMin} minutes. You're live for {onAir} of them, with a {buffer}-minute handoff{" "}
          {event?.bufferPosition === "before" ? "before" : "after"} your show for the transition to the next podcaster. Your
          confirmation email and your card on the agenda both show the exact on-air window.
        </>
      ),
    },
    {
      q: "Can I hold more than one slot?",
      a: (
        <>
          One slot per show. If you want a different time, open your dashboard, use the pencil on your slot card to release
          it, and pick another. Choosing a new time from the schedule while you hold one swaps it for you.
        </>
      ),
    },
    {
      q: "Can I change or cancel my slot?",
      a: (
        <>
          Yes, any time before the event from your dashboard. Releasing a slot puts it straight back on the open schedule for
          someone else.
        </>
      ),
    },
    {
      q: "Can I play an episode I already recorded instead of going live?",
      a: (
        <>
          Yes. In your profile, under "How your slot runs", choose <strong>Play a recorded episode</strong> and paste a link
          to the file — an unlisted YouTube or Vimeo link, or Google Drive, Dropbox, or WeTransfer all work. Set sharing so
          anyone with the link can view it. We download it and check the audio before the event. You then pick whether to
          open with a short live virtual intro on camera, or go straight into the recording with nothing needed from you on
          the day.
        </>
      ),
    },
    {
      q: "Where do I broadcast from?",
      a: (
        <>
          Your own setup. Record or stream from wherever you normally do. We give you the time block, the lineup, and the
          audience. Show-day connection details are emailed to every confirmed podcaster before the event. If you're playing
          a pre-recorded episode instead, you don't need to be anywhere unless you chose the live virtual intro.
        </>
      ),
    },
    {
      q: "Why do you ask for my RSS feed?",
      a: (
        <>
          It's how we pull your episodes so listeners can hit play right from your card on the lineup, and follow your show
          after your slot. It's optional but strongly recommended. You'll find it in your hosting platform's settings
          (Buzzsprout, Spotify for Creators, Libsyn, Transistor, Podbean, and the rest all have one).
        </>
      ),
    },
    {
      q: "What does connecting my social accounts do?",
      a: (
        <>
          Your connected accounts show on your card with your avatar and follower count, so listeners can tap straight
          through and follow you. We only read the public profile info. Nothing is ever posted on your behalf.
        </>
      ),
    },
    {
      q: "What should I have ready?",
      a: (
        <>
          A good square photo of yourself, your show name, and your RSS feed. If you're bringing a video intro or outro,
          slides, or images, tick those boxes in your profile so the production team can plan the transitions. If you'd like
          to be paired with an interviewer, say so there too and we'll line someone up before air time.
        </>
      ),
    },
  ];

  const listeners: QA[] = [
    {
      q: "Do listeners need to claim anything?",
      a: (
        <>
          No. Claiming is only for podcasters. As a listener, head to the{" "}
          <Link href="/agenda" className="text-primary underline-offset-2 hover:underline">
            agenda
          </Link>{" "}
          to see who's on and when, then pick the shows you want to catch.
        </>
      ),
    },
    {
      q: "How do I know when a show I care about is starting?",
      a: (
        <>
          Every show's card on the agenda has a Remind me button. Give us your name and email (and a mobile number if you'd
          like a text) and we'll message you before that show goes live. The confirmation email includes add-to-calendar
          links for Google, Outlook, and Apple.
        </>
      ),
    },
    {
      q: "Where do I watch or listen?",
      a: (
        <>
          On the day, the agenda is your home base. Each show's card links to the podcaster's channels, and stream details
          are posted there before the event starts.
        </>
      ),
    },
    {
      q: "I'm overseas. Will the times make sense?",
      a: (
        <>
          Yes. The schedule and agenda both show times in the zone you pick, and default to wherever your device is. Twenty-four
          hours means there's something live no matter where you are.
        </>
      ),
    },
    {
      q: "Can I share a show?",
      a: <>Every card has a Share button that copies a ready-to-post line with the show, the host, and the time.</>,
    },
  ];

  const Group = ({ id, icon: Icon, title, items }: { id: string; icon: typeof Mic2; title: string; items: QA[] }) => (
    <section id={id} className="scroll-mt-20">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-4.5 w-4.5" />
        </div>
        <h2 className="text-xl font-bold tracking-tight sm:text-2xl" style={HEADLINE_FONT}>
          {title}
        </h2>
      </div>
      <Accordion type="single" collapsible className="overflow-hidden rounded-2xl border border-border bg-card">
        {items.map((item, i) => (
          <AccordionItem key={item.q} value={`${id}-${i}`} className="border-border px-5 last:border-b-0">
            <AccordionTrigger className="py-4 text-left text-base font-semibold hover:no-underline" data-testid={`faq-${id}-${i}`}>
              {item.q}
            </AccordionTrigger>
            <AccordionContent className="pb-5 text-sm leading-relaxed text-muted-foreground">{item.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );

  return (
    <div className="min-h-screen">
      <NavBar />

      <section className="relative overflow-hidden bg-[#053877] text-white">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-[#F0A71F] opacity-[0.14] blur-3xl" />
        <div className="relative mx-auto max-w-4xl px-4 py-14 sm:px-6 lg:py-20">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest">
            <HelpCircle className="h-3.5 w-3.5 text-[#F0A71F]" /> FAQ
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl" style={HEADLINE_FONT} data-testid="text-faq-title">
            Questions, answered.
          </h1>
          <p className="mt-3 max-w-2xl text-base text-white/75 sm:text-lg">
            Everything podcasters and listeners ask about the 24 Hour Podcastathon. Jump to your section.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {[
              ["#general", "General"],
              ["#podcasters", "For podcasters"],
              ["#listeners", "For listeners"],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="rounded-full border border-white/30 px-4 py-1.5 text-sm font-medium text-white hover:bg-white/10"
              >
                {label}
              </a>
            ))}
          </div>
        </div>
      </section>

      <div className="mx-auto flex max-w-4xl flex-col gap-12 px-4 py-14 sm:px-6">
        <Group id="general" icon={HelpCircle} title="General" items={general} />
        <Group id="podcasters" icon={Mic2} title="For podcasters" items={podcasters} />
        <Group id="listeners" icon={Headphones} title="For listeners" items={listeners} />

        <section className="rounded-2xl border border-border bg-muted/40 p-6 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold tracking-tight" style={HEADLINE_FONT}>
                Still have a question?
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Email{" "}
                <a href="mailto:hello@militaryvoice.ai" className="text-primary underline-offset-2 hover:underline">
                  hello@militaryvoice.ai
                </a>{" "}
                and a human will get back to you.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href="mailto:hello@militaryvoice.ai">
                <Button variant="outline" className="gap-1.5 rounded-full">
                  <Mail className="h-4 w-4" /> Email us
                </Button>
              </a>
              <Link href="/schedule">
                <Button className="gap-1.5 rounded-full">
                  <Mic2 className="h-4 w-4" /> Pick a slot <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
