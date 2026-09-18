import { Link } from "wouter";
import { motion } from "framer-motion";
import { NavBar } from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import {
  Scissors,
  Clapperboard,
  Timer,
  Radio,
  Users,
  Disc,
  Captions,
  ShieldCheck,
  ImageIcon,
  ArrowRight,
  Check,
  Minus,
  Keyboard,
  Share2,
  CalendarClock,
} from "lucide-react";

// Why Watchfloor rather than the tool they already pay for.
//
// The pitch is not "we also have a studio". It is that the hour after a show
// is where podcasters lose their week, and this is the only control room that
// hands that hour back — because the transcript it needs already exists by the
// time the recorder stops.
//
// Everything claimed on this page is something the studio actually does. Where
// a rival does something we don't, the comparison says so.

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

const PILLARS = [
  {
    icon: Scissors,
    kicker: "The hour after",
    title: "Your clips are cut before you've closed the laptop",
    body: "The studio transcribes your show while it is going out, because the audience wants captions. So the moment you stop recording, the transcript already exists — and the clipper goes straight to work instead of uploading a file and joining a queue. Four moments, chosen for standing up cold, each rendered vertical, square and wide with the words in a subtitle file.",
    proof: "No second transcription pass. No add-on. No upload.",
  },
  {
    icon: Clapperboard,
    kicker: "During",
    title: "One rail, and it is the whole show",
    body: "Scene cards run top to bottom with the times on them. Press one and the media hits the stage, the right person comes up, everyone else steps off. Cameras, a clip, a break clock — and 1 to 9 on the keyboard cut straight to a scene, which is what you want at 3am on hour nineteen.",
    proof: "Built for 48 shows back to back, not for one webinar.",
  },
  {
    icon: Users,
    kicker: "Your guests",
    title: "Everybody leaves with their own file",
    body: "Each slot records to its own recording, not one long session somebody has to slice up later. Your guest gets theirs in their own dashboard — with their own clips — without asking you for it.",
    proof: "One session, many owners.",
  },
];

const FEATURES = [
  {
    icon: Captions,
    title: "Captions that reach everywhere",
    body: "Burned into the picture, so they arrive on YouTube, on X, on the recording and on your own watch page — not laid over one player that only your site has.",
  },
  {
    icon: Timer,
    title: "A break clock that stays in step",
    body: "The countdown travels as the moment it hits zero, not a number of seconds. Someone arriving two minutes late sees the right number, and a reconnect doesn't restart it.",
  },
  {
    icon: ShieldCheck,
    title: "Standby that can't be forgotten",
    body: "A card for before you're on and a clip for when something breaks. Which one plays is decided on the viewer's own clock, so nobody has to remember to swap them on the morning.",
  },
  {
    icon: ImageIcon,
    title: "Your mark, sized to the frame",
    body: "A logo above every scene, measured as a share of the picture rather than in pixels — so it looks the same on a 1080p stream as it does in the console.",
  },
  {
    icon: Share2,
    title: "Borrow each guest's audience, then hand it back",
    body: "A guest's own YouTube or X can be attached to the running broadcast for their slot only, and dropped after. Their followers watch them, on your show, on their own feed.",
  },
  {
    icon: CalendarClock,
    title: "The event around the studio",
    body: "Slots people claim themselves in their own time zone, an agenda that updates itself, reminders, share cards, sponsors. The studio is one room in a building the others don't have.",
  },
];

/** Only rows where the difference is real and checkable. */
const COMPARISON: { feature: string; us: string | true; restream: string | true | false; streamyard: string | true | false }[] = [
  { feature: "Live studio, multi-destination", us: true, restream: true, streamyard: true },
  { feature: "Clips cut automatically", us: "Included", restream: "Paid add-on", streamyard: "Core plan and up" },
  { feature: "Transcript captured live, not after", us: true, restream: false, streamyard: false },
  { feature: "A separate recording per guest slot", us: true, restream: false, streamyard: false },
  { feature: "Each guest gets their own dashboard", us: true, restream: false, streamyard: false },
  { feature: "Scene rail carrying the run of show", us: true, restream: false, streamyard: false },
  { feature: "Countdown scene", us: true, restream: false, streamyard: true },
  { feature: "Guest's own channels added for one segment", us: true, restream: false, streamyard: false },
  { feature: "Self-serve slot booking and a public agenda", us: true, restream: false, streamyard: false },
  { feature: "4K recording", us: "1080p", restream: "Professional plan", streamyard: "Advanced plan" },
  { feature: "Face-tracking reframe on vertical clips", us: "Letterboxed instead", restream: "Yes", streamyard: "Yes" },
];

function Cell({ value, strong }: { value: string | true | false; strong?: boolean }) {
  if (value === true)
    return (
      <span className={`inline-flex items-center justify-center rounded-full p-1 ${strong ? "bg-[#F0A71F]/25 text-[#7a5200]" : "bg-muted text-muted-foreground"}`}>
        <Check className="h-3.5 w-3.5" />
      </span>
    );
  if (value === false) return <Minus className="mx-auto h-3.5 w-3.5 text-muted-foreground/50" aria-label="No" />;
  return <span className={`text-xs ${strong ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{value}</span>;
}

export default function Watchfloor() {
  return (
    <div className="min-h-screen">
      <NavBar />

      {/* ------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden bg-[#000741] text-white">
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-24 h-[28rem] w-[28rem] rounded-full bg-[#F0A71F] opacity-[0.14] blur-3xl"
          animate={{ x: [0, -24, 0], y: [0, 24, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
          <div className="max-w-3xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] backdrop-blur">
              <Radio className="h-3.5 w-3.5 text-[#F0A71F]" /> Watchfloor · the MilitaryVoice.ai studio
            </div>
            <h1 className="text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl" style={HEADLINE_FONT}>
              The show takes an hour.
              <br />
              <span className="text-[#F0A71F]">Everything after it takes a week.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/80">
              Watchfloor is a control room that gives that week back. It captions your show while it airs — so by the
              time you stop recording, it already knows what was said, and the clips are cut before you've closed the
              laptop.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/host/dashboard">
                <Button size="lg" className="gap-2 rounded-full bg-[#F0A71F] text-[#1a1200] hover:bg-[#f7b73a]" data-testid="button-watchfloor-start">
                  Take a slot and try it <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/platform">
                <Button
                  size="lg"
                  variant="outline"
                  className="rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                >
                  Run your own event on it
                </Button>
              </Link>
            </div>
            <p className="mt-5 text-sm text-white/45">
              Every podcaster on the 24 Hour Podcastathon gets the whole thing for their slot. Nothing to install.
            </p>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- the name */}
      <section className="border-b border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Why "Watchfloor".</span> A watch is a span of time somebody
            is responsible for, and the watchfloor is where that responsibility sits. A watch bill says who has which
            hours; relieving the watch is the handover. That is the whole shape of a 24-hour marathon, and of a weekly
            show: a schedule, a handoff, and somebody awake at the desk.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------- pillars */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        <div className="flex flex-col gap-10">
          {PILLARS.map((p, i) => (
            <div key={p.title} className="grid items-start gap-6 md:grid-cols-[auto_1fr] md:gap-10">
              <div className="flex items-center gap-4 md:flex-col md:items-start md:gap-3">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#053877] text-white">
                  <p.icon className="h-6 w-6 text-[#F0A71F]" />
                </span>
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground md:w-14">
                  {p.kicker}
                </span>
              </div>
              <div className="min-w-0">
                <h2 className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl sm:leading-[1.2]" style={HEADLINE_FONT}>
                  {p.title}
                </h2>
                <p className="mt-3 max-w-3xl text-base leading-relaxed text-muted-foreground">{p.body}</p>
                <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#F0A71F]/15 px-3 py-1 text-xs font-semibold text-[#7a5200]">
                  {p.proof}
                </p>
              </div>
              {i < PILLARS.length - 1 && <div className="col-span-full h-px bg-border" />}
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------- the hour after */}
      <section className="bg-[#053877] py-16 text-white lg:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="max-w-2xl text-3xl font-bold leading-[1.15] tracking-tight sm:text-4xl" style={HEADLINE_FONT}>
            What normally happens after a show
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/15 bg-white/[0.06] p-6">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/50">Everywhere else</p>
              <ol className="mt-4 flex flex-col gap-3 text-sm text-white/75">
                {[
                  "Export the recording. Wait.",
                  "Upload it somewhere that makes clips. Wait again.",
                  "Pay for the transcription you already sat through.",
                  "Pick moments yourself, or accept whatever a tool grabbed.",
                  "Crop each one to vertical. Hope nobody got cut out of frame.",
                  "Write the captions. Post on Thursday, if at all.",
                ].map((t, i) => (
                  <li key={t} className="flex gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold tabular-nums">
                      {i + 1}
                    </span>
                    <span>{t}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-2xl border-2 border-[#F0A71F] bg-[#F0A71F]/10 p-6">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#F0A71F]">On Watchfloor</p>
              <ol className="mt-4 flex flex-col gap-3 text-sm text-white/85">
                {[
                  "You stop recording.",
                  "The transcript is already there — it was captioning you live.",
                  "The clips are in your dashboard, three shapes each, subtitles attached.",
                ].map((t, i) => (
                  <li key={t} className="flex gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F0A71F] text-[11px] font-bold tabular-nums text-[#1a1200]">
                      {i + 1}
                    </span>
                    <span>{t}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-6 border-t border-white/15 pt-4 text-sm text-white/60">
                And the reason each moment was picked is written on it, so you can disagree with one.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- features */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl" style={HEADLINE_FONT}>
          The rest of the room
        </h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex flex-col rounded-2xl border border-border bg-card p-5">
              <f.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 font-semibold leading-tight text-card-foreground">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------ comparison */}
      <section className="border-y border-border bg-muted/30 py-16 lg:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl" style={HEADLINE_FONT}>
            Against what you're probably paying for
          </h2>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            Both of these are good tools for one show at a time. The last two rows are things they do better than we
            do; they're here because a comparison that only runs one way isn't worth reading.
          </p>

          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[40rem] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-muted/30 pb-3 pr-4 text-left text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    &nbsp;
                  </th>
                  <th className="w-40 rounded-t-xl bg-[#053877] px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.12em] text-white">
                    Watchfloor
                  </th>
                  <th className="w-36 px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    Restream
                  </th>
                  <th className="w-36 px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    StreamYard
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row, i) => (
                  <tr key={row.feature}>
                    <td className={`py-3 pr-4 align-middle ${i > 0 ? "border-t border-border" : ""}`}>{row.feature}</td>
                    <td className={`bg-[#053877]/[0.06] px-3 py-3 text-center align-middle ${i > 0 ? "border-t border-[#053877]/15" : ""}`}>
                      <Cell value={row.us} strong />
                    </td>
                    <td className={`px-3 py-3 text-center align-middle ${i > 0 ? "border-t border-border" : ""}`}>
                      <Cell value={row.restream} />
                    </td>
                    <td className={`px-3 py-3 text-center align-middle ${i > 0 ? "border-t border-border" : ""}`}>
                      <Cell value={row.streamyard} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Plan details taken from each company's published pricing, September 2026.
          </p>
        </div>
      </section>

      {/* -------------------------------------------------------- for whom */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            {
              icon: Keyboard,
              title: "If you host one show",
              body: "Record it here, and stop thinking about the clips. Your guest gets their own copy without asking. Your captions go out with the stream, not after it.",
            },
            {
              icon: Disc,
              title: "If you run a network",
              body: "Every show gets its own recording and its own dashboard. One control room, one agenda, and each host sees only their own.",
            },
            {
              icon: Radio,
              title: "If you run an event",
              body: "Slots people claim themselves, an agenda that stays true, a rail your producer works down, and a clip package for every speaker by the time they're home.",
            },
          ].map((c) => (
            <div key={c.title} className="rounded-2xl border border-border bg-card p-6">
              <c.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 text-lg font-semibold leading-tight" style={HEADLINE_FONT}>
                {c.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------------- cta */}
      <section className="bg-[#000741] py-16 text-white lg:py-20">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl" style={HEADLINE_FONT}>
            The fastest way to see it is to be on it
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-white/70">
            Take a slot on the 24 Hour Podcastathon. You get the studio, your own recording and your clips — and
            twenty-four hours of this community listening.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/host/dashboard">
              <Button size="lg" className="gap-2 rounded-full bg-[#F0A71F] text-[#1a1200] hover:bg-[#f7b73a]" data-testid="button-watchfloor-cta">
                Claim a slot <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/agenda">
              <Button
                size="lg"
                variant="outline"
                className="rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              >
                See who's on
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
