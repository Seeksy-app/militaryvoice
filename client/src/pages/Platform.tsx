import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Turnstile, useTurnstileSiteKey } from "@/components/Turnstile";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { NavBar } from "@/components/NavBar";
import { StudioDemo } from "@/components/StudioDemo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ArrowRight, Check, Mic2, Sparkles, Users, Radio, Wand2, Compass, BadgeCheck, CalendarClock, ShieldCheck } from "lucide-react";
import { SiteFooter } from "@/components/SiteFooter";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

/** What the platform is, in the order someone planning an event meets it. */
const PILLARS = [
  {
    icon: Radio,
    kicker: "Events",
    title: "Live, pre-recorded, in the room or online",
    body: "Stream a virtual event, broadcast an in-person one, or run both at once. Speakers claim their own slots in their own time zone, the public page and lineup build themselves, and the show goes out to YouTube and anywhere else your audience already watches.",
    points: ["Scheduling in every time zone", "Event pages that promote themselves", "One broadcast, every destination"],
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

const FLOW = [
  ["Plan", "Tell us the shape: a single session or a hundred across three days. The agenda builds from your lineup."],
  ["Fill", "Speakers claim their slots. Need more? Discovery finds them, measured, with a way to reach them."],
  ["Run", "The studio brings each speaker on in turn while Alex keeps the run of show and the files in order."],
  ["After", "Recordings, clips for every speaker, and the social posts to share them, ready the next morning."],
] as const;

const AUDIENCES = [
  "Veteran service organizations and their members' days",
  "Nonprofits running a fundraising broadcast",
  "Podcast networks staging a crossover",
  "Conferences with a virtual track",
  "Brands looking for military creators to sponsor",
];

/** Beta / event-registration capture. Both buttons open the same short form. */
function InterestDialog({
  trigger,
  intent,
}: {
  trigger: React.ReactNode;
  intent: "register" | "beta";
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [org, setOrg] = useState("");
  const [when, setWhen] = useState("");
  const [about, setAbout] = useState("");
  const siteKey = useTurnstileSiteKey();
  const [human, setHuman] = useState<string | null>(null);
  const [humanReset, setHumanReset] = useState(0);

  const submit = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/platform-interest", {
        intent,
        name: name.trim(),
        email: email.trim(),
        organization: org.trim(),
        eventTiming: when,
        notes: about.trim(),
        turnstileToken: human,
      }),
    onSettled: () => setHumanReset((n) => n + 1),
    onSuccess: () => {
      setOpen(false);
      setName("");
      setEmail("");
      setOrg("");
      setWhen("");
      setAbout("");
      toast({
        title: intent === "register" ? "Event registered" : "You're on the list",
        description: "We'll be in touch shortly.",
      });
    },
    onError: (e: Error) => toast({ title: "Couldn't send that", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle style={HEADLINE_FONT}>
            {intent === "register" ? "Tell us about your event" : "Get on the beta list"}
          </DialogTitle>
          <DialogDescription>
            {intent === "register"
              ? "A few details and we'll come back with what running it on MilitaryVoices.ai would look like."
              : "We're onboarding organizations in small groups. Tell us who you are and we'll be in touch."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && email.trim()) submit.mutate();
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="pi-name">Your name *</Label>
              <Input id="pi-name" className="mt-1" value={name} onChange={(e) => setName(e.target.value)} required data-testid="input-interest-name" />
            </div>
            <div>
              <Label htmlFor="pi-email">Email *</Label>
              <Input id="pi-email" type="email" className="mt-1" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="input-interest-email" />
            </div>
          </div>
          <div>
            <Label htmlFor="pi-org">Organization</Label>
            <Input id="pi-org" className="mt-1" value={org} onChange={(e) => setOrg(e.target.value)} data-testid="input-interest-org" />
          </div>
          <div>
            <Label>When's your next event?</Label>
            <Select value={when || undefined} onValueChange={setWhen}>
              <SelectTrigger className="mt-1" data-testid="select-interest-timing">
                <SelectValue placeholder="Pick a rough timeframe" />
              </SelectTrigger>
              <SelectContent>
                {["Within a month", "1–3 months", "3–6 months", "Later this year", "No date yet"].map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="pi-about">What are you planning?</Label>
            <Textarea
              id="pi-about"
              rows={3}
              className="mt-1"
              placeholder="Format, rough size, anything you already know."
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              data-testid="input-interest-notes"
            />
          </div>
          {siteKey && <Turnstile siteKey={siteKey} onToken={setHuman} resetSignal={humanReset} />}
          <Button
            type="submit"
            disabled={submit.isPending || !name.trim() || !email.trim() || (Boolean(siteKey) && !human)}
            className="rounded-full"
            data-testid="button-interest-submit"
          >
            {submit.isPending ? "Sending…" : intent === "register" ? "Register my event" : "Join the beta list"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Platform() {
  return (
    <div className="min-h-screen bg-background">
      <NavBar />

      {/* ------------------------------------------------------------- hero */}
      <section className="relative isolate overflow-hidden bg-[#030b1f] text-white">
        <img src="/podcasters-bg.jpg" alt="" aria-hidden="true" className="absolute inset-0 -z-10 h-full w-full object-cover object-[center_40%] opacity-60" />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(3,11,31,0.97)_0%,rgba(3,11,31,0.88)_45%,rgba(3,11,31,0.45)_80%,rgba(3,11,31,0.25)_100%)]" />
        <motion.div aria-hidden="true" className="pointer-events-none absolute -left-24 top-1/3 -z-10 h-96 w-96 rounded-full bg-[#F0A71F] opacity-[0.14] blur-3xl" animate={{ x: [0, 30, 0], y: [0, -20, 0] }} transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }} />

        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
          <div className="max-w-2xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#F0A71F]/30 bg-[#F0A71F]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#F0A71F]">
              <Sparkles className="h-3.5 w-3.5" /> About MilitaryVoices
            </div>
            <h1 className="text-[2.6rem] font-semibold leading-[1.04] tracking-[-0.02em] sm:text-6xl">
              Stage a live, multi-speaker event
              <span className="block text-[#F0A71F]">without running it yourself.</span>
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-white/80 sm:text-xl">
              MilitaryVoices is the platform for military and veteran voices. It runs your event, runs the show with AI, and finds and verifies the people worth putting on it.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <InterestDialog
                intent="register"
                trigger={
                  <Button size="lg" className="h-12 gap-2 rounded-full bg-[#F0A71F] px-7 text-base font-medium text-[#1a1200] shadow-[0_10px_30px_rgba(240,167,31,0.35)] hover:bg-[#f5b944]" data-testid="button-register-event">
                    <CalendarClock className="h-4 w-4" /> Plan an event with us
                  </Button>
                }
              />
              <Link href="/discover">
                <Button size="lg" variant="outline" className="h-12 gap-2 rounded-full border-white/30 bg-white/5 px-7 text-base text-white backdrop-blur hover:bg-white/15 hover:text-white" data-testid="button-try-discovery">
                  <Compass className="h-4 w-4" /> Explore Discovery
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ four pillars */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#b36b00]">What it is</div>
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
                <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[#F0A71F]/10 blur-2xl transition-opacity group-hover:opacity-100" />
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#053877] text-[#F0A71F]"><Icon className="h-5 w-5" /></span>
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{String(i + 1).padStart(2, "0")} · {kicker}</span>
                </div>
                <h3 className="mt-5 text-xl font-semibold tracking-tight">{title}</h3>
                <p className="mt-3 flex-1 text-[15px] leading-relaxed text-muted-foreground">{body}</p>
                <ul className="mt-5 flex flex-col gap-2 border-t border-border pt-4">
                  {points.map((pt) => (
                    <li key={pt} className="flex items-start gap-2 text-sm"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#F0A71F]" /> {pt}</li>
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
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#F0A71F]">The studio</div>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">A control room your whole team can run</h2>
              <p className="mt-4 text-base leading-relaxed text-white/70">
                Speakers wait in a green room where you can see their camera and hear their mic before anyone is on air. Bring them up when it's their turn, mid-broadcast, without stopping. The run of show says what's live and what's next, and one button rolls the standby clip if anything goes wrong.
              </p>
              <ul className="mt-6 grid gap-3 text-sm text-white/80">
                {[
                  ["Up to five on stage", "Add and drop people live; nobody leaves and rejoins."],
                  ["Files cued ahead", "Intros, outros, sponsor reels and images, labelled before the segment."],
                  ["In the room or online", "Put an in-person stage on the stream, or run it all virtually."],
                ].map(([t, b]) => (
                  <li key={t} className="flex gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#F0A71F]" /><span><span className="font-medium text-white">{t}.</span> {b}</span></li>
                ))}
              </ul>
            </div>
            <motion.div initial={{ opacity: 0, y: 20, scale: 0.98 }} whileInView={{ opacity: 1, y: 0, scale: 1 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.6 }} className="rounded-3xl border border-white/10 bg-white/[0.03] p-2 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.8)]">
              <StudioDemo />
            </motion.div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- how it goes */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#b36b00]">How it goes</div>
          <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">Four steps, and most of them aren't yours</h2>
          <ol className="mt-12 grid gap-6 md:grid-cols-4">
            {FLOW.map(([t, b], i) => (
              <li key={t} className="relative">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[#F0A71F]/60 text-sm font-semibold text-[#b36b00]">{i + 1}</span>
                  {i < FLOW.length - 1 && <span aria-hidden className="hidden h-px flex-1 bg-gradient-to-r from-[#F0A71F]/60 to-transparent md:block" />}
                </div>
                <h3 className="mt-4 text-lg font-semibold">{t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{b}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ----------------------------------------------------- discovery + verified */}
      <section className="border-b border-border bg-muted/40">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#b36b00]">Discovery</div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">The military voices worth working with, measured</h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Brands find creators to sponsor, shows find guests, events find speakers. Search in plain English, by the words in a bio, or by name, and open anyone to see the audience behind the number and every brand they've already worked with: the paid partnerships with dates, the sponsored posts themselves, the brands they mention, and the brands their audience follows.
            </p>
            <Link href="/discover">
              <Button size="lg" className="mt-7 gap-2 rounded-full bg-[#053877] px-7 font-medium text-white hover:bg-[#0a4a99]">
                Open Discovery <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-border bg-border">
            {[
              ["300M+", "creator profiles searched"],
              ["9", "sections of audience data on every profile"],
              ["Brand history", "paid partnerships, sponsored posts and the brands their audience follows"],
              ["Verified", "voices checked by our team, reached through us"],
            ].map(([v, l]) => (
              <div key={l} className="bg-card p-6">
                <div className="text-3xl font-semibold tracking-tight text-[#053877] dark:text-[#8fb5e8]">{v}</div>
                <div className="mt-1.5 text-sm text-muted-foreground">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- proof / who */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center">
          <div className="relative overflow-hidden rounded-3xl">
            <img src="/platform-hero.jpg" alt="An audience watching a speaker on stage" className="aspect-[4/3] w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#030b1f]/85 via-transparent to-transparent" />
            <div className="absolute inset-x-6 bottom-6 text-white">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#F0A71F]">We run our own</div>
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
      <section className="bg-[#F0A71F] text-[#1a1200]">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">Got an event coming up?</h2>
            <p className="mt-2 max-w-xl text-[#1a1200]/80">Tell us the date and roughly what you're planning. We'll show you how it runs on MilitaryVoices, and whether we're the right fit.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <InterestDialog
              intent="register"
              trigger={<Button size="lg" className="gap-2 rounded-full bg-[#053877] px-7 text-base font-medium text-white hover:bg-[#0a4a99]"><CalendarClock className="h-4 w-4" /> Plan an event with us</Button>}
            />
            <InterestDialog
              intent="beta"
              trigger={<Button size="lg" variant="outline" className="gap-2 rounded-full border-[#1a1200]/30 bg-transparent px-7 text-base text-[#1a1200] hover:bg-[#1a1200]/10">Join the beta list</Button>}
            />
          </div>
        </div>
      </section>

      <SiteFooter product="discovery" />
    </div>
  );
}
