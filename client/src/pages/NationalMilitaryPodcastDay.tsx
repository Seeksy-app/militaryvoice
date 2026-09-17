import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { NavBar } from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { Mic2, Share2, Heart, MessageSquare, Headphones, Users, Radio } from "lucide-react";
import type { PublicEvent, PublicSignup } from "@shared/schema";
import { apiRequest, resolveUploadUrl } from "@/lib/queryClient";
import { slotStart, totalSlots, detectLocalTimeZone, formatTimeInZone } from "@/lib/schedule";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

const WAYS_TO_CELEBRATE = [
  {
    icon: Headphones,
    title: "Tune In and Listen",
    body: "Dive into a military podcast! Discover the heartfelt stories, humorous tales, and valuable lessons shared by veterans. Find a quiet spot, grab some snacks, and enjoy a marathon of your favorite military podcasts.",
  },
  {
    icon: Mic2,
    title: "Start Your Show",
    body: "Why not become a podcaster for the day? Veterans can start their own podcasts to share personal stories or interview fellow service members. Even if podcasting is new to you, it's a fun way to connect with others and create something memorable.",
  },
  {
    icon: Share2,
    title: "Spread the Word",
    body: "Share your favorite military podcast with friends and family. Post links on social media and use #MilitaryPodcastDay to join the conversation. The more people know about these podcasts, the bigger the community grows.",
  },
  {
    icon: MessageSquare,
    title: "Engage with Podcasters",
    body: "Reach out to your favorite military podcasters. Leave a comment, send an email, or write a review. Your feedback means a lot and encourages them to keep sharing their stories. Plus, it's always nice to spread some positivity!",
  },
  {
    icon: Heart,
    title: "Support Veterans",
    body: "Do something special for a veteran. Whether it's listening to their stories, helping them with a project, or just spending time together, your support can make a big difference.",
  },
  {
    icon: Users,
    title: "Join the Podcastathon",
    body: "Claim a 30-minute live slot on MilitaryVoice.ai and broadcast to the whole community on October 5th — from anywhere, free of charge. One day. Every mic. All in.",
  },
];

export default function NationalMilitaryPodcastDay() {
  const { data: event } = useQuery<PublicEvent>({
    queryKey: ["/api/event"],
    queryFn: async () => (await apiRequest("GET", "/api/event")).json(),
  });
  const { data: signups } = useQuery<PublicSignup[]>({
    queryKey: ["/api/signups", event?.id ?? "none"],
    queryFn: async () => (await apiRequest("GET", `/api/signups?eventId=${event!.id}`)).json(),
    enabled: !!event,
  });
  const zone = useMemo(detectLocalTimeZone, []);

  const confirmedSlots = useMemo(() => {
    if (!event || !signups) return [];
    const n = totalSlots(event.durationHours, event.slotMinutes);
    return Array.from({ length: n }, (_, i) => {
      const signup = signups.find((s) => s.slotIndex === i && s.status !== "cancelled");
      if (!signup) return null;
      const start = slotStart(event.startAtUtc, event.slotMinutes, i);
      return { signup, start, index: i };
    }).filter(Boolean) as { signup: PublicSignup; start: Date; index: number }[];
  }, [event, signups]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NavBar />

      {/* ── HERO ── */}
      <section className="relative overflow-hidden bg-[#0c1221] pt-16">
        {/* hero photo */}
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/podcasters-bg.jpg')" }}
        />
        {/* dark overlay so text stays readable */}
        <div className="absolute inset-0 bg-[#0c1221]/80" />

        {/* gold stripe top */}
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#c9922a] via-[#F0A71F] to-[#c9922a]" />

        <div className="relative mx-auto max-w-4xl px-6 pb-20 pt-12 text-center">
          <style>{`
            @keyframes nmpd-glow {
              0%, 100% { box-shadow: 0 0 30px 8px rgba(240,167,31,0.35), 0 0 60px 16px rgba(240,167,31,0.15); transform: scale(1); }
              50% { box-shadow: 0 0 50px 18px rgba(240,167,31,0.55), 0 0 90px 30px rgba(240,167,31,0.25); transform: scale(1.04); }
            }
            .nmpd-badge { animation: nmpd-glow 3s ease-in-out infinite; border-radius: 50%; }
          `}</style>
          <img
            src="/nmpd-logo.jpg"
            alt="National Military Podcast Day seal"
            className="nmpd-badge mx-auto mb-8 w-44"
          />

          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#F0A71F]/30 bg-[#F0A71F]/10 px-4 py-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#F0A71F]" />
            <span className="text-xs font-bold uppercase tracking-[0.15em] text-[#F0A71F]">October 5, 2026</span>
          </div>

          <h1
            className="mt-4 text-4xl font-black leading-tight text-white sm:text-5xl md:text-6xl"
            style={HEADLINE_FONT}
          >
            National Military
            <br />
            <span className="text-[#F0A71F]">Podcast Day</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-white/70 leading-relaxed">
            National Military Podcast Day 2026 falls on <strong className="text-white">Monday, October 5</strong>,
            providing a dedicated start to the week for honoring the mil/vet voice.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link href="/">
              <Button
                size="lg"
                className="rounded-full bg-[#F0A71F] px-8 font-bold text-[#1a1200] hover:bg-[#f7b73a]"
                style={HEADLINE_FONT}
              >
                <Mic2 className="mr-2 h-4 w-4" /> Join the Podcastathon
              </Button>
            </Link>
            <a
              href="https://twitter.com/intent/tweet?text=National+Military+Podcast+Day+is+October+5%2C+2026.+Honor+the+mil%2Fvet+voice.+%23MilitaryPodcastDay+%23MilVet"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                size="lg"
                variant="outline"
                className="rounded-full border-white/20 px-8 font-bold text-white hover:bg-white/10"
                style={HEADLINE_FONT}
              >
                <Share2 className="mr-2 h-4 w-4" /> Share the Day
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* ── LINEUP ── */}
      {confirmedSlots.length > 0 && (
        <section className="bg-background py-16">
          <div className="mx-auto max-w-6xl px-6">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-[#F0A71F]">On the lineup</p>
                <h2 className="text-2xl font-black text-foreground sm:text-3xl" style={HEADLINE_FONT}>
                  {confirmedSlots.length} podcasters confirmed
                </h2>
              </div>
              <Link href="/agenda">
                <Button variant="outline" size="sm" className="rounded-full">
                  Full schedule →
                </Button>
              </Link>
            </div>

            {/* Horizontally scrolling card row */}
            <div className="flex gap-4 overflow-x-auto pb-4" style={{ scrollbarWidth: "none" }}>
              {confirmedSlots.map(({ signup, start }) => (
                <Link key={signup.id} href={`/agenda?slot=${signup.slotIndex}`}>
                  <div className="group flex w-36 shrink-0 flex-col items-center rounded-2xl border border-border bg-muted/30 p-4 text-center transition-colors hover:border-[#F0A71F]/40 hover:bg-[#F0A71F]/5">
                    {signup.photoUrl ? (
                      <img
                        src={resolveUploadUrl(signup.photoUrl)}
                        alt={signup.hostName}
                        className="mb-3 h-16 w-16 rounded-full object-cover ring-2 ring-border group-hover:ring-[#F0A71F]/50"
                      />
                    ) : (
                      <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-muted text-2xl font-black text-muted-foreground ring-2 ring-border">
                        {signup.hostName.charAt(0)}
                      </div>
                    )}
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#F0A71F]">
                      {formatTimeInZone(start, zone)}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs font-semibold leading-tight text-foreground">
                      {signup.podcastName}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground w-full">
                      {signup.hostName}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── WATCH LIVE ── */}
      <section className="bg-[#080f1c] py-16">
        <div className="mx-auto max-w-4xl px-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-[#F0A71F]">Live stream</p>
              <h2 className="text-2xl font-black text-white sm:text-3xl" style={HEADLINE_FONT}>
                Watch the Podcastathon
              </h2>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-[#ED1C24]/40 bg-[#ED1C24]/10 px-4 py-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#ED1C24]" />
              <Radio className="h-3.5 w-3.5 text-[#ED1C24]" />
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-[#ED1C24]">Live on Oct 5</span>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-black" style={{ aspectRatio: "16/9" }}>
            <iframe
              src="/watch?embed=1"
              className="h-full w-full border-0"
              allow="autoplay; camera; microphone"
              scrolling="no"
              title="MilitaryVoice.ai Live Stream"
            />
          </div>
          <p className="mt-3 text-center text-xs text-white/40">
            On-air October 5, 2026 · 7:00 AM – 7:00 AM ET · Free to watch, no login required
          </p>
        </div>
      </section>

      {/* ── WHY IT MATTERS ── */}
      <section className="bg-background py-20">
        <div className="mx-auto max-w-3xl px-6">
          <p className="mb-3 text-center text-xs font-bold uppercase tracking-[0.18em] text-[#F0A71F]">Why it matters</p>
          <h2 className="mb-8 text-center text-3xl font-black text-foreground sm:text-4xl" style={HEADLINE_FONT}>
            The Importance of National Military Podcast Day
          </h2>
          <div className="space-y-5 text-lg leading-relaxed text-muted-foreground">
            <p>
              This day is celebrated for several reasons. First, it honors the courage and resilience of those who have served
              by providing them with a platform to express their thoughts and experiences.
            </p>
            <p>
              Many veterans find healing and support through these podcasts, which help them cope with the aftermath of their
              service, including PTSD and other mental health challenges. By encouraging veterans to share their stories, the
              day fosters a sense of community and understanding among listeners.
            </p>
            <p>
              Additionally, National Military Podcast Day draws attention to the creative ways veterans are using modern
              technology. Podcasts have become a popular medium for discussing not only military life but also personal growth,
              leadership, and other topics relevant to both military and civilian audiences.
            </p>
            <p>
              Celebrating this day helps to amplify these important voices, ensuring that the experiences of those who have
              served are heard and appreciated.
            </p>
          </div>
        </div>
      </section>

      {/* ── HISTORY ── */}
      <section className="bg-muted/30 py-20">
        <div className="mx-auto max-w-3xl px-6">
          <p className="mb-3 text-center text-xs font-bold uppercase tracking-[0.18em] text-[#F0A71F]">The history</p>
          <h2 className="mb-12 text-center text-3xl font-black text-foreground sm:text-4xl" style={HEADLINE_FONT}>
            How it started
          </h2>

          {/* Founders callout */}
          <div className="mb-10 rounded-2xl border border-[#F0A71F]/25 bg-[#F0A71F]/5 p-8 text-center">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#F0A71F]/15">
              <Mic2 className="h-6 w-6 text-[#F0A71F]" />
            </div>
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#F0A71F] mb-2">Founded 2021</p>
            <h3 className="text-xl font-black text-foreground mb-1" style={HEADLINE_FONT}>
              Shane Cunningham &amp; Nick Nickerson
            </h3>
            <p className="text-sm text-muted-foreground italic mb-4">"Broken Jarhead: The Broken Podcast"</p>
            <p className="text-muted-foreground leading-relaxed">
              Both veterans, they wanted to create a platform for military members to share their experiences and find healing
              through storytelling. The founders saw podcasting as a therapeutic outlet, especially for those dealing with
              PTSD and other challenges related to military service.
            </p>
          </div>

          <div className="space-y-5 text-lg leading-relaxed text-muted-foreground">
            <p>
              National Military Podcast Day began in 2021. It was established by Shane Cunningham and Nick Nickerson, the
              team behind <em>"Broken Jarhead: The Broken Podcast."</em>
            </p>
            <p>
              They chose this medium to help veterans express themselves and connect with others who understand their journey.
              Their initiative quickly grew, resonating with many in the military community and beyond.
            </p>
            <p>
              National Military Podcast Day recognizes the valuable contributions of military podcasters. It encourages
              veterans to start their podcasts, fostering a supportive environment for sharing stories and promoting mental health.
            </p>
          </div>
        </div>
      </section>

      {/* ── HOW TO CELEBRATE ── */}
      <section className="bg-background py-20">
        <div className="mx-auto max-w-5xl px-6">
          <p className="mb-3 text-center text-xs font-bold uppercase tracking-[0.18em] text-[#F0A71F]">Get involved</p>
          <h2 className="mb-3 text-center text-3xl font-black text-foreground sm:text-4xl" style={HEADLINE_FONT}>
            How to celebrate the day
          </h2>
          <p className="mb-12 text-center text-muted-foreground">
            You don't need a massive audience. You just need to show up.
          </p>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {WAYS_TO_CELEBRATE.map((w, i) => (
              <div
                key={i}
                className="group rounded-2xl border border-border bg-muted/20 p-6 transition-colors hover:border-[#F0A71F]/40 hover:bg-[#F0A71F]/5"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#F0A71F]/10">
                  <w.icon className="h-5 w-5 text-[#F0A71F]" />
                </div>
                <h3 className="mb-2 font-bold text-foreground" style={HEADLINE_FONT}>{w.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{w.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HASHTAG CTA ── */}
      <section className="bg-[#0c1221] py-20 text-center">
        <div className="mx-auto max-w-2xl px-6">
          <img
            src="/nmpd-logo.jpg"
            alt="National Military Podcast Day seal"
            className="mx-auto mb-6 w-28 opacity-90"
            style={{ borderRadius: "50%" }}
          />
          <p className="text-3xl font-black text-[#F0A71F] sm:text-4xl" style={HEADLINE_FONT}>#MilitaryPodcastDay</p>
          <p className="mt-4 text-white/60 leading-relaxed max-w-lg mx-auto">
            Use the hashtag on social. Share your episode. Tag a show that deserves more listeners — the bigger the community grows, the louder the mil/vet voice gets.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link href="/">
              <Button
                size="lg"
                className="rounded-full bg-[#F0A71F] px-8 font-bold text-[#1a1200] hover:bg-[#f7b73a]"
                style={HEADLINE_FONT}
              >
                <Mic2 className="mr-2 h-4 w-4" /> Claim your slot
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-border bg-background py-8 text-center">
        <p className="text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} MilitaryVoice.ai &middot;{" "}
          <Link href="/policy" className="hover:text-foreground">Privacy</Link>
          {" · "}
          <Link href="/terms" className="hover:text-foreground">Terms</Link>
        </p>
      </footer>
    </div>
  );
}
