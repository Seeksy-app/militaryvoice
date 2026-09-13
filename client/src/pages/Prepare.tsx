import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import type { PublicEvent, ProfileRow } from "@shared/schema";
import { detectLocalTimeZone, slotStart, slotEnd, formatDateInZone, formatTimeInZone, zoneLabel, onAirWindow } from "@/lib/schedule";
import {
  CalendarClock,
  Clock,
  Film,
  Users,
  MessageSquareQuote,
  Megaphone,
  Mail,
  ArrowRight,
  Mic2,
  Monitor,
  CheckCircle2,
  Flag,
} from "lucide-react";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

interface HostSignup {
  id: number;
  slotIndex: number;
  podcastName: string;
  hostName: string;
  status: string;
}
interface HostDashboardData {
  email: string;
  event: PublicEvent;
  mySignups: HostSignup[];
}

/** Studio screenshot, once one is dropped at client/public/studio-preview.jpg. */
function StudioPreview() {
  const [ok, setOk] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <img
        src="/studio-preview.jpg"
        alt="The live studio you'll join on show day"
        onLoad={() => setOk(true)}
        className={`w-full ${ok ? "" : "hidden"}`}
      />
      {!ok && (
        <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <Monitor className="h-8 w-8 text-muted-foreground/60" />
          <p className="text-sm font-medium text-muted-foreground">A look inside the studio is coming shortly.</p>
          <p className="text-xs text-muted-foreground">
            We'll add a walkthrough here before the event so nothing on the day is a surprise.
          </p>
        </div>
      )}
    </div>
  );
}

export default function Prepare() {
  const zone = useMemo(detectLocalTimeZone, []);
  const { data: event } = useQuery<PublicEvent>({ queryKey: ["/api/event"] });

  // Signed-in podcasters see their own time; everyone else sees the general guide.
  const { data: dash } = useQuery<HostDashboardData | null>({
    queryKey: ["/api/host/dashboard"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
  });

  const mine = dash?.mySignups?.[0];
  const slot = useMemo(() => {
    if (!dash?.event || !mine) return null;
    const e = dash.event;
    const blockStart = slotStart(e.startAtUtc, e.slotMinutes, mine.slotIndex);
    const onAir = onAirWindow(blockStart, {
      onAirMinutes: e.onAirMinutes,
      bufferMinutes: e.bufferMinutes,
      bufferPosition: e.bufferPosition,
    });
    return {
      blockStart,
      blockEnd: slotEnd(e.startAtUtc, e.slotMinutes, mine.slotIndex),
      onAir,
      arriveBy: new Date(onAir.start.getTime() - 10 * 60000),
      podcastName: mine.podcastName,
    };
  }, [dash, mine]);

  const bring = [
    {
      icon: Film,
      title: "Any video or images you want on screen",
      body: "Intro, outro, mid-roll, lower thirds, photos, slides — anything you'd like us to play or show during your segment.",
      hint: 'Name each file for what it is: "intro", "outro", "mid-roll", "photo-1". Clear names are what let us cue the right thing at the right moment.',
    },
    {
      icon: Users,
      title: "Who's appearing with you",
      body: "Full names and titles for every guest and co-host, exactly as you want them read on air and shown on screen.",
    },
    {
      icon: MessageSquareQuote,
      title: "If you're being interviewed, your questions",
      body: "Send the questions you'd like to be asked and a short note on the topic. It keeps the conversation on the ground you want to cover.",
    },
    {
      icon: Megaphone,
      title: "Anything we can help promote",
      body: "Your podcast's goals or mission, a launch, a campaign, a cause. Tell us what matters and we'll work it into how we introduce and share your slot.",
    },
  ];

  return (
    <div className="min-h-screen">
      <NavBar />

      {/* ------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden bg-[#053877] text-white">
        <img
          src="/agenda-bg.jpg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover object-[center_32%]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,7,65,0.95)_0%,rgba(0,7,65,0.86)_42%,rgba(5,56,119,0.6)_72%,rgba(5,56,119,0.4)_100%)]"
        />
        <div className="relative mx-auto max-w-4xl px-4 py-14 sm:px-6 lg:py-20">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest">
            <Mic2 className="h-3.5 w-3.5 text-[#F0A71F]" /> Podcaster guide
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl" style={HEADLINE_FONT} data-testid="text-prepare-title">
            Getting ready for your slot
          </h1>
          <p className="mt-3 max-w-2xl text-base text-white/80 sm:text-lg">
            Everything you need to have in hand before you go on the air, and what happens on the day.
          </p>
        </div>
      </section>

      <div className="mx-auto flex max-w-4xl flex-col gap-12 px-4 py-14 sm:px-6">
        {/* --------------------------------------------------------- the why */}
        <section>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            <Flag className="h-3.5 w-3.5" /> Why we're doing this
          </div>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl" style={HEADLINE_FONT}>
            National Military Podcast Day
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            This is a celebration of the voices and stories of the military community: those serving now, those who
            served, and the families, organizations and supporters who stand behind them. For {event?.durationHours ?? 24}{" "}
            hours we hand the microphone from one show to the next so those stories run without a break, in every time
            zone, all day and all night.
          </p>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            Your slot is a piece of that. The better prepared you are, the more your story lands.
          </p>
        </section>

        {/* --------------------------------------------------------- your time */}
        <section>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            <CalendarClock className="h-3.5 w-3.5" /> Your time
          </div>
          {slot ? (
            <div className="overflow-hidden rounded-2xl border-2 border-primary/25 bg-card" data-testid="card-your-time">
              <div className="bg-[#053877] px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-white">
                {slot.podcastName}
              </div>
              <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">You're on air</div>
                  <div className="mt-1 font-mono text-xl font-bold text-card-foreground">
                    {formatTimeInZone(slot.onAir.start, zone)} – {formatTimeInZone(slot.onAir.end, zone)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {formatDateInZone(slot.onAir.start, zone)} · {zoneLabel(zone)}
                  </div>
                </div>
                <div className="rounded-xl bg-[#F0A71F]/15 p-4">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                    <Clock className="h-3.5 w-3.5" /> Be in the studio by
                  </div>
                  <div className="mt-1 font-mono text-xl font-bold text-card-foreground">
                    {formatTimeInZone(slot.arriveBy, zone)}
                  </div>
                  <div className="text-sm text-muted-foreground">Ten minutes before you go live.</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card p-6">
              <p className="text-base text-muted-foreground">
                Enter the studio <strong className="text-foreground">10 minutes before</strong> your on-air time. That
                gives us a moment to check your camera and sound, load anything you've sent us, and hand off cleanly from
                the show before you.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/host/dashboard">
                  <Button size="sm" className="gap-1.5 rounded-full" data-testid="button-prepare-signin">
                    Sign in to see your time <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
                <Link href="/schedule#schedule">
                  <Button size="sm" variant="outline" className="gap-1.5 rounded-full">
                    Pick a slot
                  </Button>
                </Link>
              </div>
            </div>
          )}
          {slot && (
            <p className="mt-3 text-sm text-muted-foreground">
              Your booked block runs {formatTimeInZone(slot.blockStart, zone)}–{formatTimeInZone(slot.blockEnd, zone)}.
              The few minutes either side of your on-air window are the handoff between shows.
            </p>
          )}
        </section>

        {/* ------------------------------------------------------ what to send */}
        <section>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            <Film className="h-3.5 w-3.5" /> What to send us beforehand
          </div>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl" style={HEADLINE_FONT}>
            Get your material to us early
          </h2>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            Anything you want played, shown or read out needs to reach us before show day so it's loaded and tested.
            Upload it in the <strong className="text-foreground">Show materials</strong> panel on your{" "}
            <Link href="/host/dashboard" className="text-primary underline-offset-2 hover:underline">
              dashboard
            </Link>{" "}
            and it attaches to your slot automatically. Files up to 50MB upload directly; anything larger, paste a link.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {bring.map(({ icon: Icon, title, body, hint }) => (
              <div key={title} className="flex h-full flex-col rounded-2xl border border-border bg-card p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <h3 className="mt-3 text-base font-semibold leading-snug">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
                {hint && (
                  <p className="mt-3 rounded-lg border border-dashed border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
                    {hint}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-sm leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Label everything.</span> A file called "intro" gets played as
              your intro. A file called "final_v3_REAL.mp4" gets a phone call from us on show day.
            </p>
          </div>
        </section>

        {/* ------------------------------------------------------- the studio */}
        <section>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            <Monitor className="h-3.5 w-3.5" /> The studio
          </div>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl" style={HEADLINE_FONT}>
            Where you'll actually be
          </h2>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            You join from wherever you record. We'll email you the studio link and how to sign in ahead of the event, so
            all you need on the day is that link, your microphone and your camera.
          </p>
          <div className="mt-6">
            <StudioPreview />
          </div>
        </section>

        {/* ---------------------------------------------------------- profile */}
        <section className="rounded-2xl border border-border bg-muted/40 p-6 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold tracking-tight" style={HEADLINE_FONT}>
                One thing to check now
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Make sure your profile says how you normally record or stream, and what platform you use. It tells the
                studio team what to expect from you before you ever join.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/host/dashboard">
                <Button className="gap-1.5 rounded-full" data-testid="button-prepare-profile">
                  Open your profile <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
              <a href="mailto:hello@militaryvoice.ai">
                <Button variant="outline" className="gap-1.5 rounded-full">
                  <Mail className="h-4 w-4" /> Email us
                </Button>
              </a>
            </div>
          </div>
        </section>

        <section>
          <Badge variant="outline" className="mb-3 text-primary border-primary/40">
            Still have questions?
          </Badge>
          <p className="text-sm text-muted-foreground">
            The{" "}
            <Link href="/faq" className="text-primary underline-offset-2 hover:underline">
              FAQ
            </Link>{" "}
            covers slot lengths, changing your time, pre-recorded episodes and more. Anything it doesn't answer, just
            reply to any email from us.
          </p>
        </section>
      </div>
    </div>
  );
}
