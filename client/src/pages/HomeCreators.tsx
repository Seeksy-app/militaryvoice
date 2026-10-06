import { Link } from "wouter";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { PreviewStack } from "@/pages/Discover";
import { Button } from "@/components/ui/button";
import { ArrowRight, BookOpen, Clapperboard, Handshake, Megaphone, PlayCircle, Sparkles, Users } from "lucide-react";

// The front door: MilitaryVoices is a platform for military and veteran
// creators (podcasts are one thing they make, beside video, social, events
// and brand work), not a page for one event. The Marathon moved to /marathon
// and comes back here as proof: real people, live on our stage, on the day.

const HEAD = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const NAVY = "#000741";
const GOLD = "#F0A71F";

// Andrew's four pillars (4 Oct 2026): every moment a creator has is an opportunity.
const PILLARS = [
  { icon: Clapperboard, title: "Create", body: "An episode, video or live stream doesn't end when it's published. We find the moments that become clips, posts, newsletter content, sponsor inventory and speaking topics.", today: "Pōstify · Social" },
  { icon: Users, title: "Connect", body: "Find another creator for a guest swap, an expert for an episode, a collaborator, or get discovered by organizations looking for military and veteran voices.", today: "Discovery · Directory · Verified" },
  { icon: Megaphone, title: "Audience", body: "Own your audience and earn from it: email, followers, community, events, courses and affiliate offers.", today: "SmartLink · media kit · analytics" },
  { icon: Handshake, title: "Earn", body: "An Opportunity Marketplace, not an ad marketplace: sponsorships, paid UGC, ambassador campaigns, speaking, guest spots and event appearances.", today: "Sponsors · counted links" },
];
const MORNING = [
  "Your latest episode has 4 strong social clips.",
  "A brand is looking for veteran creators in your category.",
  "Two podcasts are looking for guests with your expertise.",
  "Your audience engagement suggests a follow-up episode.",
  "You have an unused sponsorship slot next week.",
];
const FLOW = ["Moment", "Intelligence", "Match", "Action", "Revenue and reach"];

function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.55, delay }} className={className}>
      {children}
    </motion.div>
  );
}

export default function HomeCreators() {
  const [, go] = useLocation();
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
      {/* Discovery's hero, made the front door: a real creator's card, measured. */}
      <section className="relative isolate text-white" style={{ background: "#030b1f" }}>
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute inset-0 opacity-[0.55]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)", backgroundSize: "44px 44px", maskImage: "radial-gradient(ellipse 80% 70% at 70% 30%, black 20%, transparent 75%)", WebkitMaskImage: "radial-gradient(ellipse 80% 70% at 70% 30%, black 20%, transparent 75%)" }} />
          <div className="absolute -top-48 right-[-10%] h-[40rem] w-[40rem] rounded-full opacity-25 blur-[120px]" style={{ background: GOLD }} />
          <div className="absolute -bottom-64 -left-40 h-[36rem] w-[36rem] rounded-full bg-[#1d5cc4] opacity-30 blur-[120px]" />
        </div>
        <div className="mx-auto grid w-full max-w-[88rem] items-center gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:pb-20 lg:pt-20">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#F0A71F]/30 bg-[#F0A71F]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#F0A71F]">
              <Sparkles className="h-3.5 w-3.5" /> For military and veteran creators
            </p>
            <h1 className="mt-6 text-5xl font-semibold leading-[1.02] tracking-[-0.02em] sm:text-[4.25rem] lg:text-[3.9rem] xl:text-[4.25rem]">
              <span className="whitespace-nowrap">Military creators,</span>
              <br />
              <span className="bg-gradient-to-r from-[#F0A71F] via-[#ffd27a] to-[#F0A71F] bg-clip-text text-transparent">measured.</span>
            </h1>
            <p className="mt-6 max-w-xl text-pretty text-xl leading-relaxed text-white/75">
              <span className="font-semibold text-white">Every Moment Is an Opportunity™.</span> We help military and veteran creators find it, in every episode, post, relationship and audience you already have.
            </p>
            <ul className="mt-7 flex flex-wrap gap-2" aria-label="What we help you do">
              {PILLARS.map((p) => (
                <li key={p.title} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2 text-sm font-medium text-white/85"><p.icon className="h-4 w-4 text-[#F0A71F]" />{p.title} <ArrowRight className="h-3.5 w-3.5 text-white/40" /> Opportunity</li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link href="/host/dashboard">
                <Button size="lg" className="h-12 bg-[#F0A71F] px-7 text-base font-bold text-[#1a1200] hover:bg-[#e09a10]" data-testid="button-start-free">Start free</Button>
              </Link>
              <Link href="/marathon" className="inline-flex items-center gap-2 font-semibold text-white/90 hover:text-white" data-testid="link-hero-replay">
                <PlayCircle className="h-5 w-5" /> Watch the Marathon replay
              </Link>
            </div>
          </motion.div>
          <div className="hidden lg:block">
            <PreviewStack verified={[]} onOpen={() => go("/discover")} />
          </div>
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

      {/* ------------------------------------------------- opportunity engine */}
      <section className="border-b border-border" id="opportunity">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <Reveal>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#8a5a00]">The Opportunity Engine</p>
            <h2 className="mt-3 max-w-3xl text-balance text-3xl font-bold text-foreground sm:text-4xl" style={HEAD}>Not just tools to make content. Technology that finds what it becomes next.</h2>
            <ol className="mt-6 flex flex-wrap items-center gap-2 text-sm font-semibold text-[#053877] dark:text-white/80" aria-label="How a moment becomes an opportunity">
              {FLOW.map((f, i) => (
                <li key={f} className="inline-flex items-center gap-2"><span className="rounded-full bg-[#eef2fa] px-3 py-1 dark:bg-white/10">{f}</span>{i < FLOW.length - 1 && <ArrowRight className="h-4 w-4 text-[#F0A71F]" />}</li>
              ))}
            </ol>
          </Reveal>
          <div className="mt-10 grid gap-8 lg:grid-cols-[1.25fr_1fr] lg:items-start">
            <div className="grid gap-5 sm:grid-cols-2">
              {PILLARS.map((p, i) => (
                <Reveal key={p.title} delay={(i % 2) * 0.06} className="rounded-2xl border border-border bg-card p-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#000741] text-[#F0A71F]"><p.icon className="h-5 w-5" /></div>
                    <h3 className="text-lg font-semibold text-foreground">{p.title} <span className="text-[#F0A71F]">→</span> Opportunity</h3>
                  </div>
                  <p className="mt-3 text-pretty text-sm text-muted-foreground">{p.body}</p>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-[#053877]/70 dark:text-white/50">Today: {p.today}</p>
                </Reveal>
              ))}
            </div>
            {/* The idea working as software: a creator's morning. */}
            <Reveal delay={0.1} className="rounded-2xl bg-[#000741] p-6 text-white shadow-xl">
              <p className="text-xs font-bold uppercase tracking-[0.25em]" style={{ color: GOLD }}>Your dashboard</p>
              <p className="mt-3 text-2xl font-bold" style={HEAD}>Good morning, Andrew.</p>
              <p className="text-white/70">Here are your opportunities today.</p>
              <ul className="mt-5 space-y-3">
                {MORNING.map((m) => (
                  <li key={m} className="flex gap-3 rounded-xl bg-white/[0.06] p-3 text-sm"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#F0A71F]" />{m}</li>
                ))}
              </ul>
            </Reveal>
          </div>
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
