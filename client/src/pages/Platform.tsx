import { Link } from "wouter";
import { motion } from "framer-motion";
import { NavBar } from "@/components/NavBar";
import { HeroBackdrop, HeroCard } from "@/components/platform/LiveEventMock";
import { PillarArt } from "@/components/platform/PillarArt";
import { StudioConsoleMock } from "@/components/platform/StudioConsoleMock";
import { ReadyToJoinMock, WaitingRoomMock } from "@/components/platform/GreenRoomMock";
import { DiscoverySearchMock, CreatorProfileMock } from "@/components/platform/DiscoveryMock";
import { SoonPill } from "@/components/platform/stockVideo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  Check,
  Mic2,
  Sparkles,
  Users,
  Radio,
  Wand2,
  Compass,
  BadgeCheck,
  CalendarClock,
  ShieldCheck,
  Search,
  Globe2,
  TrendingUp,
  Handshake,
  UserSearch,
  ListPlus,
  Megaphone,
  Presentation,
  MessageSquareText,
  Clock3,
  LayoutGrid,
  Move,
  UserPlus,
  IdCard,
  Palette,
  Film,
} from "lucide-react";
import { SiteFooter } from "@/components/SiteFooter";
import { useAudienceSnapshot } from "@/components/AudienceReach";
import { InterestDialog } from "@/components/InterestDialog";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

/** What the platform is, in the order someone planning an event meets it. */
const PILLARS = [
  {
    icon: Radio,
    kicker: "Events",
    title: "Live, pre-recorded, in the room or online",
    body: "Stream a virtual event, broadcast an in-person one, or run both at once. Speakers claim their own slots in their own time zone, the public page and lineup build themselves, and the show goes out live on YouTube, with more destinations on the way.",
    points: ["Scheduling in every time zone", "Event pages that promote themselves", "One broadcast, every destination*"],
  },
  {
    icon: Wand2,
    kicker: "Run by AI",
    title: "The agenda and the show, handled",
    body: "Alex, our AI producer, turns your lineup into an agenda and a minute-by-minute run of show, writes the host lines and the reminders, keeps every file cued, and after the last segment cuts the clips for each speaker. Your team steers; the busywork is done.",
    points: ["Agenda and run of show from your lineup", "Host lines, reminders and follow-ups written for you", "Clips for every speaker, after the show"],
  },
  {
    icon: Compass,
    kicker: "Discovery",
    title: "Find the right voices for it",
    body: "Search over 300 million creator profiles for veterans, service members and military spouses. Every profile shows the audience behind the follower count: how much of it is real, where it lives, what it cares about, and which brands have already worked with them.",
    points: ["Over 300 million creator profiles", "Audience quality, real reach and growth", "Brand collaborations: who paid them, when, and the posts", "Email and phone where creators publish them"],
  },
  {
    icon: BadgeCheck,
    kicker: "Verified",
    title: "Every speaker becomes a verified voice",
    body: "The people who take part are checked by our team: that they are who they say they are, and that they served or serve alongside. They carry the Verified on MilitaryVoices badge in Discovery, so the brands and shows looking for them can find them, and reach them through us.",
    points: ["Identity and service checked by our team", "A badge that travels with them", "Introductions made through us, with their say-so"],
  },
];

/** What Discovery does, capability by capability. */
const DISCOVERY_FEATURES = [
  { icon: Search, title: "300M+ profiles", body: "Instagram, YouTube and TikTok, searched by name, by bio, or by what you describe." },
  { icon: Wand2, title: "AI search", body: "Ask in plain English: \"Army veterans who talk about life after service.\"" },
  { icon: BadgeCheck, title: "Verified military", body: "The gold badge means our team checked who they are and that they served or serve alongside." },
  { icon: Globe2, title: "Who's really listening", body: "Audience age, gender, country, city and language, with a credibility score and real reach." },
  { icon: TrendingUp, title: "Engagement & growth", body: "Engagement rate, six months of follower growth, and how often they post." },
  { icon: Handshake, title: "Brand history", body: "Paid partnerships with dates, the sponsored posts themselves, and the brands their audience follows." },
  { icon: UserSearch, title: "Lookalikes", body: "Found one who fits? See the creators whose audience looks like theirs." },
  { icon: ListPlus, title: "Lists you can share", body: "Save creators to lists, share a profile with a link, and reach verified voices through us." },
];

/** Who Discovery is for, and the question each of them asks it. */
const DISCOVERY_FOR = [
  { icon: Megaphone, who: "Brands & sponsors", body: "Sponsor military creators whose audience is real, and see who else has paid them.", ask: "Military spouse creators with a US audience" },
  { icon: Mic2, who: "Podcasters", body: "Book guests with a story, a following and a reason to come on your show.", ask: "Marine Corps veterans who talk about transition" },
  { icon: Presentation, who: "Event organisers", body: "Fill the stage, the panel and the keynote with voices your audience knows.", ask: "Veteran keynote speakers on leadership" },
];

const AUDIENCES = [
  "Veteran service organizations and their members' days",
  "Nonprofits running a fundraising broadcast",
  "Podcast networks staging a crossover",
  "Conferences with a virtual track",
  "Brands looking for military creators to sponsor",
];

/**
 * The sponsor card Riccoh posted, as a hero: the day, the numbers, the host and
 * the ask. The figures are live (the same audience count the Sponsor page reads),
 * so the pitch never goes stale.
 */
function PitchHero() {
  const { data: a } = useAudienceSnapshot();
  const shows = a?.showsTotal ?? 32;
  const following = a?.followers ? `${Math.floor(a.followers / 1000).toLocaleString("en-US")},000+` : "234,000+";
  const channels = a?.channels ?? 56;
  const episodes = a?.catalogue?.episodes ? a.catalogue.episodes.toLocaleString("en-US") : "4,491";
  const since = a?.catalogue?.sinceYear ?? 2016;
  const words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  const spell = (n: number) => (n <= 10 ? words[n] : n < 100 ? `${["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"][Math.floor(n / 10)]}${n % 10 ? `-${words[n % 10].toLowerCase()}` : ""}` : String(n));
  return (
    <section className="relative isolate overflow-hidden bg-[#000741] text-white" data-testid="pitch-hero">
      <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 -z-10 h-[40rem] w-[40rem] rounded-full bg-[#F0A71F]/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-48 -left-40 -z-10 h-[36rem] w-[36rem] rounded-full bg-[#2563eb]/20 blur-3xl" />
      {/* Riccoh with the Emmy, fading into the navy behind the words. */}
      <div className="absolute inset-y-0 right-0 -z-10 hidden w-[44%] lg:block">
        <img src="/riccoh-player.jpg" alt="Riccoh Player, USMC (Ret.), holding his Emmy" className="h-full w-full object-cover object-[50%_20%]" />
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(90deg,#000741_0%,rgba(0,7,65,0.55)_35%,rgba(0,7,65,0)_70%)]" />
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,7,65,0)_60%,#000741_100%)]" />
      </div>
      <div className="mx-auto max-w-7xl px-4 pb-16 pt-14 sm:px-6 lg:pb-24 lg:pt-20">
        <div className="max-w-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[#F0A71F] sm:whitespace-nowrap sm:text-base sm:tracking-[0.16em] lg:text-lg">National Military Podcast Day<span className="hidden sm:inline"> · </span><span className="block sm:inline">5 October 2026</span></p>
          <h1 className="mt-6 text-5xl font-bold leading-[0.95] tracking-tight sm:text-7xl" style={HEADLINE_FONT}>
            26.2 miles of military podcasts.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/85 sm:text-xl">
            {spell(shows)} shows, back to back, in one broadcast day. Your name on it, from the first show to the last.
          </p>
          <div className="mt-10 h-1 w-24 rounded-full bg-[#F0A71F]" aria-hidden />
          <dl className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-[auto_auto_auto] sm:justify-start sm:gap-x-12">
            <div className="flex items-baseline gap-3 sm:block">
              <dt className="sr-only">Shows</dt>
              <dd className="text-4xl font-bold tabular-nums text-[#F0A71F] lg:text-5xl" style={HEADLINE_FONT}>{shows}</dd>
              <dd className="text-balance text-sm leading-snug text-white/70 sm:mt-1 sm:max-w-[12rem]">shows on the starting line</dd>
            </div>
            <div className="flex items-baseline gap-3 sm:block">
              <dt className="sr-only">Combined following</dt>
              <dd className="text-4xl font-bold tabular-nums lg:text-5xl" style={HEADLINE_FONT}>{following}</dd>
              <dd className="text-balance text-sm leading-snug text-white/70 sm:mt-1 sm:max-w-[12rem]">combined following across {channels} channels</dd>
            </div>
            <div className="flex items-baseline gap-3 sm:block">
              <dt className="sr-only">Episodes</dt>
              <dd className="text-4xl font-bold tabular-nums lg:text-5xl" style={HEADLINE_FONT}>{episodes}</dd>
              <dd className="text-balance text-sm leading-snug text-white/70 sm:mt-1 sm:max-w-[12rem]">episodes already published, since {since}</dd>
            </div>
          </dl>
        </div>

        <div className="mt-12 flex flex-col gap-6 border-t border-white/15 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <img src="/riccoh-player.jpg" alt="" aria-hidden className="h-14 w-14 rounded-full object-cover object-[50%_15%] ring-2 ring-[#F0A71F] lg:hidden" />
            <p className="text-base leading-snug text-white/75">
              Hosted by Emmy winner
              <br />
              <span className="font-semibold text-white">Riccoh Player</span> (USMC, Retired)
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <p className="text-sm text-white/80 sm:text-right">Segments from <span className="font-bold text-[#F0A71F]">$250</span></p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/agenda">
                <Button size="lg" variant="outline" className="h-12 w-full rounded-full bg-transparent px-6 text-base text-white [border-color:rgba(255,255,255,0.45)] hover:bg-white/10 hover:text-white sm:w-auto">
                  See the lineup
                </Button>
              </Link>
              <Link href="/sponsor?apply=1">
                <Button size="lg" className="h-12 w-full gap-2 rounded-full bg-[#F0A71F] px-7 text-base font-semibold text-[#1a1200] hover:bg-[#f5b94a] sm:w-auto" data-testid="pitch-sponsor">
                  Sponsor a segment <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** A section's kicker and heading, in one voice across the page. */
function Kicker({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <div className={`text-xs font-semibold uppercase tracking-[0.16em] ${dark ? "text-[#F0A71F]" : "text-[#b36b00] dark:text-[#F0A71F]"}`}>{children}</div>;
}

const reveal = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.55 },
} as const;

/** Under the studio console: what the layouts sit inside. */
const STUDIO_FEATURES = [
  { icon: LayoutGrid, title: "Change the layout live", body: "Showtime, Sidebar, Picture-in-Picture and three more. Press one, or Shift+1 to 6, mid-show." },
  { icon: Move, title: "Drag to rearrange", body: "Drop a guest onto the big frame and they swap places with whoever was there." },
  { icon: UserPlus, title: "Bring guests on", body: "Everyone backstage sits along the top, green on stage and red off. One click brings them up." },
  { icon: IdCard, title: "Names on screen", body: "The name and title each guest typed in the green room sit on their own frame." },
  { icon: Palette, title: "Your colours", body: "Pick a brand colour, type any hex, or upload your own background." },
  { icon: Film, title: "Video with people in shot", body: "Roll a clip or sponsor reel with the speakers still beside it; the next scene starts when it ends." },
] as const;

/**
 * The About page with a sponsor hero, for a pitch sent to a named group
 * (/podcast-one-pitch). Everything under the hero is the About page as is.
 */
export default function Platform({ pitch = false }: { pitch?: boolean } = {}) {
  return (
    <div className="min-h-screen overflow-x-clip bg-background">
      <NavBar />

      {pitch ? (
        <PitchHero />
      ) : (
        <>
      {/* ------------------------------------------------------------- hero */}
      <section className="relative isolate overflow-hidden bg-[#030b1f] text-white">
        {/* A room full of people, far back, so the page opens on an event. */}
        <img src="/platform-hero.jpg" alt="" aria-hidden="true" className="absolute inset-0 -z-20 h-full w-full object-cover object-[center_60%] opacity-[0.16] lg:hidden" />
        <div aria-hidden="true" className="absolute inset-0 -z-10 lg:hidden bg-[radial-gradient(90%_70%_at_75%_40%,rgba(5,56,119,0.55),transparent_70%),linear-gradient(180deg,rgba(3,11,31,0.55)_0%,rgba(3,11,31,0.92)_70%,#030b1f_100%)]" />
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-40 lg:hidden" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)", backgroundSize: "48px 48px", maskImage: "radial-gradient(ellipse 60% 70% at 70% 40%, black, transparent 80%)", WebkitMaskImage: "radial-gradient(ellipse 60% 70% at 70% 40%, black, transparent 80%)" }} />
        <motion.div aria-hidden="true" className="pointer-events-none absolute -left-24 top-1/3 -z-10 h-96 w-96 rounded-full bg-[#F0A71F] opacity-[0.12] blur-3xl" animate={{ x: [0, 30, 0], y: [0, -20, 0] }} transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }} />

        <HeroBackdrop />

        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 pb-16 pt-14 sm:px-6 lg:min-h-[660px] lg:pb-24 lg:pt-20">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="text-center lg:max-w-[31rem] lg:text-left xl:max-w-[34rem]">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#F0A71F]/30 bg-[#F0A71F]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#F0A71F]">
              <Sparkles className="h-3.5 w-3.5" /> About MilitaryVoices
            </div>
            <h1 className="text-[2.4rem] font-semibold leading-[1.04] tracking-[-0.02em] sm:text-5xl xl:text-[3.3rem]" style={HEADLINE_FONT}>
              Stage a live or virtual, <span className="whitespace-nowrap">multi‑speaker</span> event
              <span className="block text-[#F0A71F]">without running it yourself.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-white/75 lg:mx-0">
              MilitaryVoices is the platform for military and veteran voices. It runs your event, runs the show with AI, and finds and verifies the people worth putting on it.
            </p>
            <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center lg:justify-start">
              <InterestDialog
                intent="register"
                trigger={
                  <Button size="lg" className="h-12 gap-2 rounded-full bg-[#F0A71F] px-7 text-base font-medium text-[#1a1200] shadow-[0_10px_30px_rgba(240,167,31,0.35)] hover:bg-[#f5b944]" data-testid="button-register-event">
                    <CalendarClock className="h-4 w-4" /> Plan an event with us
                  </Button>
                }
              />
              <Link href="/discover">
                <Button size="lg" variant="outline" className="h-12 w-full gap-2 rounded-full border-white/30 bg-white/5 px-7 text-base text-white backdrop-blur hover:bg-white/15 hover:text-white sm:w-auto" data-testid="button-try-discovery">
                  <Compass className="h-4 w-4" /> Explore Discovery
                </Button>
              </Link>
            </div>
            <ul className="mx-auto mt-10 hidden max-w-md grid-cols-3 gap-4 border-t border-white/10 pt-6 text-left sm:grid lg:mx-0">
              {[
                ["Live", "to YouTube · more platforms soon"],
                ["AI", "producer in the green room"],
                ["300M+", "creators in Discovery"],
              ].map(([v, l]) => (
                <li key={v}>
                  <div className="text-xl font-semibold text-white" style={HEADLINE_FONT}>{v}</div>
                  <div className="mt-0.5 text-xs leading-snug text-white/55">{l}</div>
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.7, delay: 0.1 }} className="min-w-0 lg:hidden">
            <HeroCard />
          </motion.div>
        </div>
      </section>

        </>
      )}

      {/* ---------------------------------------------------------- discovery */}
      <section id="discovery" className="relative isolate overflow-hidden border-b border-border">
        <div aria-hidden className="pointer-events-none absolute -right-40 top-10 -z-10 h-[30rem] w-[30rem] rounded-full bg-[#F0A71F]/10 blur-3xl" />
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-24">
          <div className="mx-auto max-w-4xl text-center">
            <Kicker>Discovery</Kicker>
            <h2 className="mt-2 text-3xl font-semibold leading-[1.1] tracking-tight sm:text-[2.75rem]">Find the mil/vet voices worth working with, and see who's really listening</h2>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Discovery searches over 300 million creator profiles for veterans, service members and military spouses — creators, podcasters, speakers — and opens each one to the audience behind the number and every brand that has already paid them.
            </p>
            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <Link href="/discover">
                <Button size="lg" className="h-12 w-full gap-2 rounded-full bg-[#053877] px-7 text-base font-medium text-white hover:bg-[#0a4a99] sm:w-auto" data-testid="button-open-discovery">
                  <Compass className="h-4 w-4" /> Explore Discovery <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>

          {/* The product, with one profile opened over the results. */}
          <motion.div {...reveal} className="relative mx-auto mt-14 max-w-6xl lg:pr-[17rem] xl:pr-[18.5rem]">
            <DiscoverySearchMock />
            <div className="mx-auto mt-5 max-w-sm lg:absolute lg:right-0 lg:top-36 lg:mt-0 lg:w-80 xl:w-[21rem]">
              <CreatorProfileMock />
            </div>
          </motion.div>
          <p className="mt-4 text-center text-xs text-muted-foreground lg:mt-20">Sample profiles and figures, for illustration.</p>

          {/* What it does */}
          <div className="mt-16 grid grid-cols-2 gap-x-5 gap-y-9 sm:mt-20 sm:gap-x-8 sm:gap-y-10 lg:grid-cols-4">
            {DISCOVERY_FEATURES.map(({ icon: Icon, title, body }, i) => (
              <motion.div key={title} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.4, delay: (i % 4) * 0.06 }}>
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${title === "Verified military" ? "bg-[#F0A71F] text-[#1a1200]" : "bg-[#053877]/10 text-[#053877] dark:bg-white/10 dark:text-[#8fb5e8]"}`}><Icon className="h-5 w-5" /></span>
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground sm:text-sm">{body}</p>
              </motion.div>
            ))}
          </div>

          {/* Who it's for */}
          <div className="mt-20 grid gap-5 md:grid-cols-3">
            {DISCOVERY_FOR.map(({ icon: Icon, who, body, ask }) => (
              <Link key={who} href="/discover" className="group flex h-full flex-col rounded-3xl border border-border bg-card p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
                  <span className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#053877] text-[#F0A71F]"><Icon className="h-5 w-5" /></span>
                    <span className="text-lg font-semibold">{who}</span>
                  </span>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
                  <span className="mt-5 flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-sm">
                    <Wand2 className="h-4 w-4 shrink-0 text-[#b36b00] dark:text-[#F0A71F]" />
                    <span className="min-w-0 flex-1 italic leading-snug text-foreground/80">"{ask}"</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ four pillars */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <div className="max-w-2xl">
            <Kicker>What it is</Kicker>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">One platform, from the first speaker to the last clip</h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Most events are held together by a spreadsheet, a group chat and somebody's memory. Here the event, the show and the people in it live in one place, and the work that used to eat the week is done for you.
            </p>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-2">
            {PILLARS.map(({ icon: Icon, kicker, title, body, points }, i) => (
              <motion.div
                key={kicker}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.45, delay: i * 0.07 }}
                className="group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-card p-7 shadow-sm transition-shadow hover:shadow-lg"
              >
                <PillarArt kicker={kicker} />
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#053877] text-[#F0A71F]"><Icon className="h-5 w-5" /></span>
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{String(i + 1).padStart(2, "0")} · {kicker}</span>
                </div>
                <h3 className="mt-5 text-xl font-semibold tracking-tight">{title}</h3>
                <p className="mt-3 flex-1 text-[15px] leading-relaxed text-muted-foreground">{body}</p>
                <ul className="mt-5 flex flex-col gap-2 border-t border-border pt-4">
                  {points.map((pt) => (
                    <li key={pt} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#F0A71F]" />
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">{pt.replace(/\*$/, "")}{pt.endsWith("*") && <SoonPill tone="light" />}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- the studio */}
      <section className="relative isolate overflow-hidden border-b border-border bg-[#030b1f] text-white">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-40" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)", backgroundSize: "44px 44px", maskImage: "radial-gradient(ellipse 70% 60% at 50% 40%, black, transparent 80%)", WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 40%, black, transparent 80%)" }} />
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[36rem] w-[60rem] -translate-x-1/2 rounded-full bg-[#053877] opacity-40 blur-3xl" />
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-24">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end lg:gap-16">
            <div>
              <Kicker dark>The studio</Kicker>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">A control room your whole team can run</h2>
              <p className="mt-4 text-base leading-relaxed text-white/70">
                Every scene of the day down the left, the programme in the middle, one press to cut. Bring speakers up mid-broadcast without stopping, change how they share the frame, and put a lower third, a ticker or a sponsor reel on air from the same screen.
              </p>
            </div>
            <ul className="grid gap-3 text-sm text-white/80 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {[
                ["Up to five on stage", "Add and drop people live; nobody leaves and rejoins."],
                ["The whole day, queued", "Every segment is a scene down the left; press it to cut."],
                ["Files cued ahead", "Intros, outros, sponsor reels and images, labelled before the segment."],
                ["In the room or online", "Put an in-person stage on the stream, or run it all virtually."],
              ].map(([t, b]) => (
                <li key={t} className="flex gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#F0A71F]" /><span><span className="font-medium text-white">{t}.</span> {b}</span></li>
              ))}
            </ul>
          </div>
          {/* The console, drawn live, stepping through the layouts. */}
          <div className="mt-16">
            <h3 className="text-2xl font-semibold tracking-tight sm:text-3xl">Six layouts, one press</h3>
            <motion.div {...reveal} className="mt-8">
              <StudioConsoleMock />
            </motion.div>
            <ul className="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
              {STUDIO_FEATURES.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-3.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#F0A71F]"><Icon className="h-5 w-5" /></span>
                  <span>
                    <span className="block font-semibold text-white">{title}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-white/70">{body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- green room */}
      <section className="relative isolate overflow-hidden border-b border-border bg-[#eef2fa] dark:bg-[#07112e]">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-14 lg:py-24">
          <div>
            <Kicker>The green room</Kicker>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl"><span className="block">Guests wait backstage.</span> <span className="block">Alex keeps them company.</span></h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              A guest opens their link, sees their own camera and mic, types the name and title that go under their picture, and walks into the green room. Nothing there is on air. You see and hear every one of them before they're live, and bring them up when it's their turn.
            </p>
            <ul className="mt-6 flex flex-col gap-3 text-sm">
              {[
                [Check, "No download, no account", "One link, in the browser, on a laptop or a phone."],
                [MessageSquareText, "Alex answers while they wait", "When am I on, is my audio OK, who's introducing me."],
                [Clock3, "Called in on time", "Reminders before their slot and a nudge when they're next."],
              ].map(([Icon, t, b]) => {
                const I = Icon as typeof Check;
                return (
                  <li key={t as string} className="flex gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#053877] text-[#F0A71F]"><I className="h-4 w-4" /></span>
                    <span><span className="font-medium text-foreground">{t as string}.</span> <span className="text-muted-foreground">{b as string}</span></span>
                  </li>
                );
              })}
            </ul>
          </div>
          <motion.div {...reveal} className="relative rounded-[2rem] bg-[#04102b] p-3 shadow-[0_50px_100px_-40px_rgba(3,11,31,0.7)] sm:p-5">
            <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[2rem] bg-[radial-gradient(70%_60%_at_20%_0%,rgba(240,167,31,0.18),transparent_70%)]" />
            <div className="relative grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] md:items-start">
              <div>
                <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">What your guest sees</p>
                <ReadyToJoinMock />
              </div>
              <div>
                <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">What your producer sees</p>
                <WaitingRoomMock />
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* -------------------------------------------------------- proof / who */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center">
          <div className="relative overflow-hidden rounded-3xl">
            <img src="/platform-hero.jpg" alt="An audience watching a speaker on stage" loading="lazy" className="aspect-[4/3] w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#030b1f]/90 via-[#030b1f]/35 to-transparent" />
            <div className="absolute inset-x-6 bottom-6 text-white">
              <Kicker dark>We run our own</Kicker>
              <p className="mt-1.5 text-lg font-medium">Our own events run on the platform, in public.</p>
            </div>
          </div>
          <div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Built by people who put shows on the air</h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              We use MilitaryVoices for our own events. The Podcast Marathon for National Military Podcast Day is one of them: dozens of shows, speakers in every time zone, live and pre-recorded side by side.
            </p>
            <div className="mt-7 rounded-2xl border border-border bg-card p-6">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Users className="h-3.5 w-3.5 text-[#F0A71F]" /> Who it's for</div>
              <ul className="mt-4 flex flex-col gap-3">
                {AUDIENCES.map((a) => (
                  <li key={a} className="flex items-start gap-2.5 text-sm"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#F0A71F]" /> {a}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- close */}
      <section className="bg-[#053877] text-white">
        <div className="mx-auto flex max-w-7xl flex-col items-start gap-6 px-4 py-16 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">Got an event coming up?</h2>
            <p className="mt-2 max-w-xl text-white/80">Tell us the date and roughly what you're planning. We'll show you how it runs on MilitaryVoices, and whether we're the right fit.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <InterestDialog
              intent="register"
              trigger={<Button size="lg" className="gap-2 rounded-full bg-[#F0A71F] px-7 text-base font-medium text-[#1a1200] hover:bg-[#f5b94a]"><CalendarClock className="h-4 w-4" /> Plan an event with us</Button>}
            />
            <InterestDialog
              intent="beta"
              trigger={<Button size="lg" variant="outline" className="gap-2 rounded-full [border-color:rgba(255,255,255,0.45)] bg-transparent px-7 text-base text-white hover:bg-white/10 hover:text-white">Join the beta list</Button>}
            />
          </div>
        </div>
      </section>

      <SiteFooter note="Some features shown are on our roadmap." />
    </div>
  );
}
