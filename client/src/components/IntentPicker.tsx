import { CalendarDays, Mic, Clapperboard, Check, ArrowRight, Building2 } from "lucide-react";
import type { Interest } from "@shared/schema";
import { IconTile } from "@/components/ui/icon-tile";

/**
 * "Which one sounds like you?" — the first thing a new account sees.
 *
 * Three paths (6 Oct): a podcaster, a content creator, or an event planner.
 * One tap picks the path and carries on; it decides what the profile asks,
 * where they land, and what the dashboard's checklist puts first. The two
 * creator paths share most of the platform; the event planner goes to their
 * own events.
 */
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
  return (
    <section className="mx-auto max-w-6xl" data-testid="intent-picker">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#F0A71F]">Welcome</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>
        Which one sounds like you?
      </h1>
      <p className="mt-2 text-muted-foreground">We'll set your account up for it. Everything else on the platform is still yours to use.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PATHS.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => onDone(o.interests)}
            className="group flex flex-col rounded-2xl border-2 border-border bg-card p-5 text-left transition hover:border-[#053877] hover:shadow-md focus-visible:border-[#053877] focus-visible:outline-none"
            data-testid={`intent-${o.key}`}
          >
            <IconTile icon={o.icon} />
            <span className="mt-3 block text-lg font-bold text-foreground">{o.title}</span>
            <span className="mt-1 block text-sm text-muted-foreground">{o.line}</span>
            <ul className="mt-3 flex-1 space-y-1 text-sm text-foreground/80">
              {o.points.map((p) => <li key={p} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> {p}</li>)}
            </ul>
            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#053877] group-hover:gap-2.5 dark:text-[#9cc2ff]">That's me <ArrowRight className="h-4 w-4" /></span>
          </button>
        ))}
      </div>
    </section>
  );
}
