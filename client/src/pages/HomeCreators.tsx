import { Link } from "wouter";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { ArrowRight, BookOpen, Briefcase, CalendarDays, Clapperboard, Home as HomeIcon, MonitorPlay, PlayCircle, Share2, Sparkles } from "lucide-react";

// The front door: MilitaryVoices is a platform for military and veteran
// creators (podcasts are one thing they make, beside video, social, events
// and brand work), not a page for one event. The Marathon moved to /marathon
// and comes back here as proof: real people, live on our stage, on the day.

const HEAD = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const NAVY = "#000741";
const GOLD = "#F0A71F";

// The studio photos the site has always opened on, one after another.
const HERO_IMAGES = Array.from({ length: 12 }, (_, i) => `/hero-${i + 1}.jpg`);
const HERO_ROTATE_MS = 6000;

const OFFER = [
  { icon: MonitorPlay, title: "A studio that connects to Zoom", body: "Go live or record with your guests. A green room so they arrive ready, layouts that look like TV, and every session recorded." },
  { icon: Clapperboard, title: "Clips in minutes with Pōstify", body: "Your best moments, captioned and cut in all three shapes, ready before the conversation is cold." },
  { icon: Share2, title: "Post everywhere from one place", body: "Schedule to every channel from one calendar, and see what's working in one view." },
  { icon: CalendarDays, title: "Events, run for you", body: "From a one-hour panel to a sixteen-hour marathon: hosts, run of show, simulcast and replays." },
  { icon: Briefcase, title: "Brands and sponsors", body: "A media kit that builds itself, and help finding the brands that want to reach the military community." },
  { icon: HomeIcon, title: "One home for everything you make", body: "Free podcast hosting, your SmartLink page, and Ask my show, so fans can find any moment you've recorded." },
];

const STEPS = [
  { n: "1", title: "Record", body: "In your studio, on Zoom, or upload what you already have." },
  { n: "2", title: "Pōstify", body: "Clips, captions and a clean episode, made for you in minutes." },
  { n: "3", title: "Share and grow", body: "Post everywhere, track it, and turn your audience into sponsors." },
];

function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.55, delay }} className={className}>
      {children}
    </motion.div>
  );
}

export default function HomeCreators() {
  const [heroIdx, setHeroIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setHeroIdx((i) => (i + 1) % HERO_IMAGES.length), HERO_ROTATE_MS);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="min-h-screen overflow-x-clip bg-background">
      {/* The day that just happened, one line above everything. */}
      <div className="bg-[#F0A71F] text-[#1a1200]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-2 text-center text-sm font-semibold">
          <span>National Military Podcast Day 2026</span>
          <Link href="/marathon" className="inline-flex items-center gap-1 underline-offset-4 hover:underline" data-testid="ribbon-replay">Watch the replay <ArrowRight className="h-3.5 w-3.5" /></Link>
          <Link href="/keepsake" className="inline-flex items-center gap-1 underline-offset-4 hover:underline" data-testid="ribbon-keepsake">Keepsake magazine out Friday <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
      </div>
      <NavBar />

      {/* ------------------------------------------------------------- hero */}
      <section className="relative isolate overflow-hidden bg-[#000741] text-white">
        {HERO_IMAGES.map((src, i) => (
          <img key={src} src={src} alt="" aria-hidden="true" fetchPriority={i === 0 ? "high" : "low"}
            className={`absolute inset-0 -z-10 h-full w-full object-cover object-[70%_center] transition-opacity duration-[1600ms] ease-in-out ${i === heroIdx ? "opacity-90" : "opacity-0"}`} />
        ))}
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(0,7,65,0.93)_0%,rgba(0,7,65,0.80)_38%,rgba(5,56,119,0.45)_66%,rgba(5,56,119,0.2)_100%)]" />
        <div className="mx-auto flex min-h-[72vh] max-w-6xl items-center px-4 py-16 sm:px-6 md:py-24">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.25em]" style={{ color: GOLD }}>For military and veteran creators</p>
            <h1 className="mt-4 text-balance text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl" style={HEAD}>
              Where military and veteran voices grow.
            </h1>
            <p className="mt-5 max-w-xl text-pretty text-lg text-white/85">
              Podcasts, video, social, events and brand partnerships, all in one place. A studio that connects to Zoom, clips in minutes, and an SI co-host in every studio. You only pay for what you need.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link href="/host/dashboard">
                <Button size="lg" className="h-12 bg-[#F0A71F] px-7 text-base font-bold text-[#1a1200] hover:bg-[#e09a10]" data-testid="button-start-free">Start free</Button>
              </Link>
              <Link href="/marathon" className="inline-flex items-center gap-2 font-semibold text-white/90 hover:text-white" data-testid="link-hero-replay">
                <PlayCircle className="h-5 w-5" /> Watch the Marathon replay
              </Link>
            </div>
          </motion.div>
        </div>
        <div className="border-t border-white/10 bg-black/15">
          <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-y-4 px-4 py-6 text-center sm:px-6 md:grid-cols-4">
            {[["29", "shows, back to back"], ["16 hours", "live in one day"], ["LiveOne", "and PodcastOne simulcast"], ["Minutes", "from conversation to clips"]].map(([v, l]) => (
              <li key={v}><div className="text-2xl font-bold" style={HEAD}>{v}</div><div className="text-sm text-white/65">{l}</div></li>
            ))}
          </ul>
        </div>
      </section>

      {/* ----------------------------------------------------- meet Alex (video) */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.15fr_1fr]">
          <Reveal>
            <div className="overflow-hidden rounded-2xl bg-black shadow-xl ring-1 ring-black/10">
              <video controls playsInline preload="none" poster="/home/alex-video-poster.jpg" className="aspect-video w-full" data-testid="home-alex-video">
                <source src="/api/studio/media/162" type="video/mp4" />
              </video>
            </div>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#8a5a00]">Meet Alex</p>
            <h2 className="mt-3 text-balance text-3xl font-bold text-foreground sm:text-4xl" style={HEAD}>An SI co-host in every studio</h2>
            <p className="mt-4 text-pretty text-lg text-muted-foreground">
              Alex is our superintelligence, or SI. She produces the show beside you: checks your guests in, keeps the run of show, introduces your segments and answers your questions, so you can focus on the conversation.
            </p>
            <p className="mt-3 text-pretty text-muted-foreground">Watch her walk through everything MilitaryVoices does in one minute.</p>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------- past events */}
      <section className="border-b border-border bg-[#eef2fa] dark:bg-[#07112e]" id="events">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <Reveal>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#8a5a00]">Past events</p>
            <h2 className="mt-3 text-balance text-3xl font-bold text-foreground sm:text-4xl" style={HEAD}>National Military Podcast Day 2026</h2>
            <p className="mt-3 max-w-2xl text-pretty text-lg text-muted-foreground">Twenty-nine military and veteran shows, back to back, live for sixteen hours on October 5. Every show got its own clips by the next morning.</p>
          </Reveal>
          <div className="mt-8 grid gap-6 md:grid-cols-[1.4fr_1fr]">
            <Reveal className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5 dark:bg-[#0d1838]">
              <img src="/home/replay-console.jpg" alt="The MilitaryVoices studio console live on National Military Podcast Day, with VET S.O.S. on stage" className="aspect-[1668/991] w-full object-cover object-top" loading="lazy" />
              <div className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div>
                  <p className="font-semibold text-foreground">The Podcast Marathon, hosted by Riccoh Player</p>
                  <p className="text-sm text-muted-foreground">Monday, October 5, 2026 · 7 AM to 10:30 PM Eastern</p>
                </div>
                <Link href="/marathon"><Button className="bg-[#000741] text-white hover:bg-[#053877]" data-testid="button-watch-replay"><PlayCircle className="mr-2 h-4 w-4" />Watch the replay</Button></Link>
              </div>
            </Reveal>
            <Reveal delay={0.08} className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5 dark:bg-[#0d1838]">
              <div className="flex flex-1 items-center justify-center bg-[#000741] p-6">
                <img src="/home/voices-cover.jpg" alt="VOICES of the Military, the keepsake magazine cover" className="max-h-72 w-auto -rotate-2 rounded-md shadow-2xl" loading="lazy" />
              </div>
              <div className="p-5">
                <p className="font-semibold text-foreground">VOICES of the Military, the keepsake magazine</p>
                <p className="text-sm text-muted-foreground">Every show from the day in one edition. Out this Friday.</p>
                <Link href="/keepsake"><Button variant="outline" className="mt-3 w-full" data-testid="button-get-keepsake"><BookOpen className="mr-2 h-4 w-4" />Get your free digital copy</Button></Link>
              </div>
            </Reveal>
          </div>

        </div>
      </section>

      {/* ---------------------------------------------------------- the offer */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <Reveal>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#8a5a00]">What you get</p>
            <h2 className="mt-3 text-balance text-3xl font-bold text-foreground sm:text-4xl" style={HEAD}>Everything a creator needs, in one place</h2>
          </Reveal>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {OFFER.map((o, i) => (
              <Reveal key={o.title} delay={(i % 3) * 0.06} className="rounded-2xl border border-border bg-card p-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#000741] text-[#F0A71F]"><o.icon className="h-5 w-5" /></div>
                <h3 className="mt-4 text-lg font-semibold text-foreground">{o.title}</h3>
                <p className="mt-2 text-pretty text-sm text-muted-foreground">{o.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- how it works */}
      <section className="border-b border-border bg-[#eef2fa] dark:bg-[#07112e]">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <Reveal><h2 className="text-balance text-3xl font-bold text-foreground sm:text-4xl" style={HEAD}>How it works</h2></Reveal>
          <ol className="mt-8 grid gap-5 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 0.06} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5 dark:bg-[#0d1838]">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F0A71F] font-bold text-[#1a1200]">{s.n}</span>
                <h3 className="mt-4 text-lg font-semibold text-foreground">{s.title}</h3>
                <p className="mt-1 text-pretty text-sm text-muted-foreground">{s.body}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* -------------------------------------------------------------- close */}
      <section className="text-white" style={{ background: `linear-gradient(180deg, #053877, ${NAVY})` }}>
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-balance text-3xl font-bold sm:text-4xl" style={HEAD}>Start free. Pay only for what you need.</h2>
            <p className="mt-3 max-w-2xl text-pretty text-white/75">Your page, podcast hosting and Ask my show are free. Pōstify plans start at $19.95 a month. <span className="inline-flex items-center gap-1 font-semibold text-[#F0A71F]"><Sparkles className="h-4 w-4" />The beta opens Friday.</span></p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/host/dashboard"><Button size="lg" className="h-12 bg-[#F0A71F] px-7 text-base font-bold text-[#1a1200] hover:bg-[#e09a10]" data-testid="button-close-start">Start free</Button></Link>
            <Link href="/platform"><Button size="lg" variant="outline" className="h-12 border-white/40 bg-transparent text-white hover:bg-white/10" data-testid="button-plan-event">Plan an event with us</Button></Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
