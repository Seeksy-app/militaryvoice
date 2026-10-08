import { CalendarDays, Mic, Clapperboard, Check, ArrowRight, Building2 } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import type { Interest } from "@shared/schema";

/**
 * "Which one sounds like you?" — the first thing a new account sees.
 *
 * Three paths (6 Oct): a podcaster, a content creator, or an event planner.
 * One tap picks the path and carries on; it decides what the profile asks,
 * where they land, and what the dashboard's checklist puts first. The two
 * creator paths share most of the platform; the event planner goes to their
 * own events.
 */
// Each path its own colour band (8 Oct, "make it flashier"): the card reads at a glance, and the
// hover says which one you're about to pick.
const LOOK: Record<string, { band: string; ring: string }> = {
  podcaster: { band: "linear-gradient(135deg,#03204a 0%,#053877 55%,#0d5bb8 100%)", ring: "#053877" },
  creator: { band: "linear-gradient(135deg,#2a1450 0%,#4c2a8a 55%,#7a4fd0 100%)", ring: "#6a43bf" },
  planner: { band: "linear-gradient(135deg,#0b3a24 0%,#15834f 60%,#22a866 100%)", ring: "#15834f" },
  brand: { band: "linear-gradient(135deg,#5c3b00 0%,#b36b00 50%,#F0A71F 100%)", ring: "#c98a14" },
};
const PATHS: { key: "podcaster" | "creator" | "planner" | "brand"; interests: Interest[]; title: string; line: string; points: string[]; icon: typeof CalendarDays }[] = [
  {
    key: "podcaster", interests: ["grow", "events"], title: "I'm a podcaster", icon: Mic,
    line: "Host your show, get clips from every episode, and get booked on live events.",
    points: ["Podcast hosting on every app", "Pōstify clips, first episode free", "A SmartLink for your bio"],
  },
  {
    key: "creator", interests: ["create"], title: "I'm a content creator", icon: Clapperboard,
    line: "Turn your videos into clips, post everywhere, and grow an audience you own.",
    points: ["Pōstify clips and posting", "A SmartLink that collects emails", "Discovery to find collaborators"],
  },
  {
    key: "planner", interests: ["host"], title: "I'm an event planner", icon: CalendarDays,
    line: "Run a live event with our studio, an SI co-host and your own lineup.",
    points: ["Your own event page and booking", "A studio and run of show", "Speakers' clips the same day"],
  },
  {
    // The fourth path (7 Oct): the other side of the marketplace.
    key: "brand", interests: ["brand"], title: "I'm a brand or agency", icon: Building2,
    line: "Find military and veteran creators, and sponsor their shows.",
    points: ["Search creators, measured", "Saved lists your team shares", "Sponsor shows and campaigns"],
  },
];

export function IntentPicker({ onDone }: { onDone: (interests: Interest[]) => void }) {
  const still = useReducedMotion();
  return (
    <section className="mx-auto max-w-6xl" data-testid="intent-picker">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#F0A71F]">Welcome</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground sm:text-4xl" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>
        Which one sounds like you?
      </h1>
      <p className="mt-2 text-muted-foreground">We'll set your account up for it, in about two minutes. Everything else on the platform is still yours to use.</p>

      <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PATHS.map((o, i) => {
          const look = LOOK[o.key];
          return (
            <motion.button
              key={o.key}
              type="button"
              onClick={() => onDone(o.interests)}
              initial={still ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: still ? 0 : 0.06 * i }}
              className="group relative flex flex-col overflow-hidden rounded-2xl border-2 border-border bg-card text-left shadow-sm transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-1 hover:shadow-xl focus-visible:outline-none motion-reduce:hover:translate-y-0"
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = look.ring; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = ""; }}
              onFocus={(e) => { e.currentTarget.style.borderColor = look.ring; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = ""; }}
              data-testid={`intent-${o.key}`}
            >
              {/* The band: the path's colour, its mark, and two rings for depth. */}
              <span className="relative block h-24 overflow-hidden" style={{ background: look.band }} aria-hidden="true">
                <span className="absolute -right-10 -top-12 h-40 w-40 rounded-full border border-white/15" />
                <span className="absolute -right-2 -top-6 h-40 w-40 rounded-full border border-white/10" />
                <span className="absolute bottom-0 left-5 flex h-14 w-14 translate-y-1/2 items-center justify-center rounded-2xl bg-white shadow-lg ring-4 ring-card transition-transform duration-200 group-hover:scale-105">
                  <o.icon className="h-7 w-7" style={{ color: look.ring }} />
                </span>
              </span>
              <span className="flex flex-1 flex-col px-5 pb-5 pt-10">
                <span className="block text-lg font-bold text-foreground">{o.title}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{o.line}</span>
                <ul className="mt-3 flex-1 space-y-1.5 text-sm text-foreground/85">
                  {o.points.map((p) => <li key={p} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> {p}</li>)}
                </ul>
                {/* Fills with the path's colour on hover. */}
                <span className="relative mt-5 inline-flex items-center justify-center overflow-hidden rounded-full border-2 px-4 py-2 text-sm font-semibold" style={{ borderColor: look.ring }}>
                  <span className="absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" style={{ background: look.ring }} aria-hidden="true" />
                  <span className="relative flex items-center gap-1.5 text-foreground transition-colors group-hover:text-white group-focus-visible:text-white">That's me <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></span>
                </span>
              </span>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}
