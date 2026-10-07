import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { PreviewStack } from "@/pages/Discover";
import { Button } from "@/components/ui/button";
import { ArrowRight, BadgeCheck, BarChart3, Bookmark, Building2, CalendarDays, Clapperboard, Handshake, Link2, Megaphone, Mic, Search, Send, Users } from "lucide-react";

// /for-brands (7 Oct): the other side of the marketplace. A brand or agency
// sees why military and veteran creators, what they can do here, and starts
// free in one press; the sign-up already knows they're a brand.

const GOLD = "#F0A71F";
const NAVY = "#000741";
const HEAD = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

const WAYS = [
  { icon: Mic, title: "Sponsor a show", line: "An ad read or a segment on a military or veteran podcast, read by the host their listeners trust." },
  { icon: Megaphone, title: "Run a creator campaign", line: "Posts, videos and Shorts from creators whose audience is the one you're trying to reach." },
  { icon: Users, title: "Book a speaker or guest", line: "Veterans and military spouses with a story, for your event, your podcast or your team." },
  { icon: Handshake, title: "Find ambassadors", line: "Creators who already use what you make, for the long run rather than one post." },
];
const STEPS = [
  { icon: Search, title: "Search", line: "Find creators by topic, branch, platform and audience. Real reach, engagement and audience quality on every profile." },
  { icon: Bookmark, title: "Save and share", line: "Save the ones you like to lists your whole team sees." },
  { icon: Send, title: "Reach out", line: "Once we've approved your account, tell creators what you have in mind, the dates and the budget." },
  { icon: BarChart3, title: "See what it did", line: "Every sponsor link is counted, so you know what each mention sent you." },
];
const WHY = [
  { icon: BarChart3, title: "Measured, not guessed", line: "Followers, engagement and audience quality from the platforms themselves, not a creator's own screenshot." },
  { icon: BadgeCheck, title: "Verified by people", line: "Creators on MilitaryVoices we know personally, each one checked by our team." },
  { icon: Clapperboard, title: "Your moment, clipped", line: "Shows recorded in our studio are clipped the same day, so a sponsor read can live on as Shorts and Reels." },
  { icon: Link2, title: "Links that count", line: "Every sponsor link is counted, so you know what a mention actually sent you." },
];

/** Into sign-up, already on the brand path. */
function startAsBrand() {
  try { localStorage.setItem("mv_interests", "brand"); } catch { /* private window: they pick it on the welcome screen */ }
}

export default function ForBrands() {
  const [, go] = useLocation();
  const start = () => { startAsBrand(); go("/host/dashboard?start"); };
  return (
    <div className="min-h-screen overflow-x-clip bg-background">
      <NavBar />

      <section className="relative isolate text-white" style={{ background: "#030b1f" }}>
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-48 right-[-10%] h-[40rem] w-[40rem] rounded-full opacity-25 blur-[120px]" style={{ background: GOLD }} />
          <div className="absolute -bottom-64 -left-40 h-[36rem] w-[36rem] rounded-full bg-[#1d5cc4] opacity-30 blur-[120px]" />
        </div>
        <div className="mx-auto grid w-full max-w-[88rem] items-center gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:pb-20">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#F0A71F]/30 bg-[#F0A71F]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#F0A71F]">
              <Building2 className="h-3.5 w-3.5" /> For brands and agencies
            </p>
            <h1 className="mt-6 text-balance text-5xl font-semibold leading-[1.04] tracking-[-0.02em] sm:text-6xl" style={HEAD}>
              Reach the military community through the voices it trusts
            </h1>
            <p className="mt-6 max-w-xl text-pretty text-xl leading-relaxed text-white/75">
              Find military and veteran podcasters and creators, measured. Sponsor a show, run a campaign or book a speaker, with your team, in one place.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button size="lg" onClick={start} className="h-12 bg-[#F0A71F] px-7 text-base font-bold text-[#1a1200] hover:bg-[#e09a10]" data-testid="brands-start">Start free</Button>
              <Link href="/discover" className="inline-flex items-center gap-1.5 text-base font-semibold text-white/85 hover:text-white">See the creators <ArrowRight className="h-4 w-4" /></Link>
            </div>
            <p className="mt-4 text-sm text-white/55">Free to search. We check every brand before it can send creators requests.</p>
          </motion.div>
          <div className="hidden lg:block">
            <PreviewStack verified={[]} onOpen={() => go("/discover")} />
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a5a00] dark:text-[#F0A71F]">What you can do</p>
          <h2 className="mt-3 text-balance text-3xl font-bold text-foreground sm:text-4xl" style={HEAD}>Four ways to work with military creators</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {WAYS.map((w) => (
              <div key={w.title} className="rounded-2xl border border-border bg-card p-5">
                <w.icon className="h-6 w-6 text-[#053877] dark:text-[#9cc2ff]" />
                <h3 className="mt-3 font-semibold text-foreground">{w.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{w.line}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-[#eef2fa] dark:bg-[#07112e]">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a5a00] dark:text-[#F0A71F]">How it works</p>
          <h2 className="mt-3 text-balance text-3xl font-bold text-foreground sm:text-4xl" style={HEAD}>From search to results in four steps</h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-2xl bg-card p-5 shadow-sm">
                <span className="flex items-center gap-2 text-sm font-bold text-[#053877] dark:text-[#9cc2ff]"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#053877] text-xs text-white">{i + 1}</span>{s.title}</span>
                <p className="mt-3 text-sm text-muted-foreground">{s.line}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a5a00] dark:text-[#F0A71F]">Why MilitaryVoices</p>
          <h2 className="mt-3 max-w-3xl text-balance text-3xl font-bold text-foreground sm:text-4xl" style={HEAD}>Authentic voices, with the numbers to back them</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {WHY.map((w) => (
              <div key={w.title} className="flex gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#053877]/10 text-[#053877] dark:bg-white/10 dark:text-[#9cc2ff]"><w.icon className="h-5 w-5" /></span>
                <div><h3 className="font-semibold text-foreground">{w.title}</h3><p className="mt-1 text-sm text-muted-foreground">{w.line}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-6 px-4 py-12 sm:px-6">
          <CalendarDays className="h-8 w-8 shrink-0 text-[#053877] dark:text-[#9cc2ff]" />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-foreground" style={HEAD}>Sponsor one of our live events</h2>
            <p className="mt-1 text-sm text-muted-foreground">National Military Podcast Day and the events that follow: your brand on air, on the watch page and in the keepsake magazine.</p>
          </div>
          <Link href="/sponsor"><Button variant="outline" className="gap-1.5 rounded-full">Event sponsorship <ArrowRight className="h-4 w-4" /></Button></Link>
        </div>
      </section>

      <section className="text-white" style={{ background: `linear-gradient(180deg, #053877, ${NAVY})` }}>
        <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6">
          <h2 className="text-balance text-3xl font-bold sm:text-4xl" style={HEAD}>Start with a search. It's free.</h2>
          <p className="mx-auto mt-3 max-w-2xl text-white/75">Make your account in a minute: your name, your company and what you're here for. Your team can join you.</p>
          <Button size="lg" onClick={start} className="mt-8 h-12 bg-[#F0A71F] px-8 text-base font-bold text-[#1a1200] hover:bg-[#e09a10]" data-testid="brands-start-bottom">Start free</Button>
          <p className="mt-4 text-sm text-white/60">Questions first? <a href="mailto:hello@militaryvoices.ai" className="underline underline-offset-4">hello@militaryvoices.ai</a></p>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
