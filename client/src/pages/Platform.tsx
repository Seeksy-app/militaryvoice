import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { NavBar } from "@/components/NavBar";
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
import {
  Megaphone,
  ListOrdered,
  CalendarClock,
  MonitorPlay,
  Plug,
  ArrowRight,
  Check,
  Mic2,
  Sparkles,
  Users,
  Radio,
} from "lucide-react";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

const CAPABILITIES = [
  {
    icon: Megaphone,
    title: "Promotion",
    body: "A public event page, a live lineup, and a speaker card for everyone taking part — each with their own links, socials and episode player. Reminder sign-ups and share text are built in, so your speakers do the promoting for you.",
  },
  {
    icon: ListOrdered,
    title: "Run of show",
    body: "A minute-by-minute plan generated from your schedule: pre-roll, sponsor reads, intros, every segment and every handoff. Edit any line, add your own, export it for the control room. Rebuild when the lineup changes and your edits stay put.",
  },
  {
    icon: CalendarClock,
    title: "Scheduling",
    body: "Publish open slots and let speakers claim their own time in their own zone. Profiles are entered once and reused, cancellations return the slot to the board, and the public agenda updates itself.",
  },
  {
    icon: MonitorPlay,
    title: "Studio",
    body: "A place for speakers to arrive, get checked and go live. They upload intros, outros, mid-rolls and images ahead of time, labelled, so the operator has everything cued before the segment starts.",
  },
  {
    icon: Plug,
    title: "Integrations",
    body: "Zoom, and any RTMP destination you already stream to. Bring the tools your team knows rather than learning ours.",
  },
];

const AUDIENCES = [
  "Associations running a members' day",
  "Nonprofits with a fundraising telethon",
  "Podcast networks staging a crossover",
  "Conferences with a virtual track",
  "Brands running an always-on broadcast",
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

  const submit = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/platform-interest", {
        intent,
        name: name.trim(),
        email: email.trim(),
        organization: org.trim(),
        eventTiming: when,
        notes: about.trim(),
      }),
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
              ? "A few details and we'll come back with what running it on MilitaryVoice.ai would look like."
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
          <Button type="submit" disabled={submit.isPending || !name.trim() || !email.trim()} className="rounded-full" data-testid="button-interest-submit">
            {submit.isPending ? "Sending…" : intent === "register" ? "Register my event" : "Join the beta list"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Platform() {
  return (
    <div className="min-h-screen">
      <NavBar />

      {/* ------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden bg-[#053877] text-white">
        <img
          src="/hero-2.jpg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover object-[65%_center] opacity-90"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,7,65,0.95)_0%,rgba(0,7,65,0.84)_40%,rgba(5,56,119,0.5)_70%,rgba(5,56,119,0.28)_100%)]"
        />
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 top-1/4 h-96 w-96 rounded-full bg-[#F0A71F] opacity-[0.16] blur-3xl"
          animate={{ x: [0, 30, 0], y: [0, -20, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        />

        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
          <div className="max-w-2xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] backdrop-blur">
              <Sparkles className="h-3.5 w-3.5 text-[#F0A71F]" /> The platform behind the Podcastathon
            </div>
            <h1 className="text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl" style={HEADLINE_FONT}>
              Run a live, multi-speaker event
              <span className="block text-[#F0A71F]">without running it yourself</span>
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-white/85">
              MilitaryVoice.ai is the software we built to put twenty-four hours of back-to-back shows on the air with one
              small team. Scheduling, promotion, a studio, and a run of show the control room can actually follow. Now
              any organization can use it for their own event.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <InterestDialog
                intent="register"
                trigger={
                  <Button
                    size="lg"
                    className="h-12 gap-2 rounded-full bg-[#F0A71F] px-7 text-base font-semibold text-[#1a1200] shadow-[0_10px_30px_rgba(240,167,31,0.35)] hover:bg-[#f5b944]"
                    data-testid="button-register-event"
                  >
                    <CalendarClock className="h-4 w-4" /> Register your upcoming event
                  </Button>
                }
              />
              <InterestDialog
                intent="beta"
                trigger={
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-12 gap-2 rounded-full border-white/30 bg-white/5 px-7 text-base text-white backdrop-blur hover:bg-white/15 hover:text-white"
                    data-testid="button-join-beta"
                  >
                    Get on the beta list <ArrowRight className="h-4 w-4" />
                  </Button>
                }
              />
            </div>
            <p className="mt-5 text-sm text-white/60">In private beta. No card, no commitment — we onboard in small groups.</p>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- the pitch */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">What it is</div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl" style={HEADLINE_FONT}>
              One place for everyone taking part, and everyone watching
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Most live events are held together by a spreadsheet, a group chat and someone's memory. Speakers email
              their files. Times get confused across zones. The person in the control room is reading a document that
              went out of date two days ago.
            </p>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              This replaces that. Speakers claim their own slot and fill in their own details. The public page builds
              itself as they do. The run of show is generated from the real schedule, and it changes when the schedule
              changes.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex h-full flex-col rounded-2xl border border-border bg-card p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- proof / who */}
      <section className="bg-[#053877] text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center lg:py-20">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#F0A71F]">Built in the open</div>
            <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl" style={HEADLINE_FONT}>
              We use it ourselves, in public
            </h2>
            <p className="mt-4 text-base leading-relaxed text-white/75">
              The 24 Hour Podcastathon runs on this platform: forty-eight slots, speakers in every time zone, live shows
              and pre-recorded episodes side by side, all of it visible to anyone who visits. If you want to know whether
              it works, go and look at it.
            </p>
            <Link href="/">
              <Button
                size="lg"
                className="mt-6 gap-2 rounded-full bg-[#F0A71F] px-6 font-semibold text-[#1a1200] hover:bg-[#f5b944]"
                data-testid="button-see-live-event"
              >
                <Radio className="h-4 w-4" /> See it running
              </Button>
            </Link>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/[0.06] p-6 backdrop-blur">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/70">
              <Users className="h-3.5 w-3.5 text-[#F0A71F]" /> Who it's for
            </div>
            <ul className="mt-4 flex flex-col gap-3">
              {AUDIENCES.map((a) => (
                <li key={a} className="flex items-start gap-2.5 text-sm text-white/85">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#F0A71F]" />
                  {a}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-sm text-white/60">
              If it has a schedule, speakers and an audience, it fits. One slot or two hundred.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- close */}
      <section className="bg-[#F0A71F] text-[#1a1200]">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-14 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl" style={HEADLINE_FONT}>
              Got an event coming up?
            </h2>
            <p className="mt-2 max-w-xl text-[#1a1200]/80">
              Tell us the date and roughly what you're planning. We'll show you what it looks like on the platform, and
              whether we're the right fit.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <InterestDialog
              intent="register"
              trigger={
                <Button size="lg" className="gap-2 rounded-full bg-[#053877] px-7 text-base font-semibold text-white hover:bg-[#0a4a99]">
                  <CalendarClock className="h-4 w-4" /> Register your event
                </Button>
              }
            />
            <InterestDialog
              intent="beta"
              trigger={
                <Button size="lg" variant="outline" className="gap-2 rounded-full border-[#1a1200]/30 bg-transparent px-7 text-base text-[#1a1200] hover:bg-[#1a1200]/10">
                  Join the beta list
                </Button>
              }
            />
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2">
            <Mic2 className="h-4 w-4 text-primary" />
            <Badge variant="outline" className="border-primary/40 text-primary">
              Private beta
            </Badge>
          </div>
          <a href="mailto:hello@militaryvoice.ai" className="hover:text-foreground">
            hello@militaryvoice.ai
          </a>
        </div>
      </footer>
    </div>
  );
}
