import { useState } from "react";
import { CalendarDays, TrendingUp, Compass, Flag, Check, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Interest } from "@shared/schema";

/**
 * "What brings you to MilitaryVoices?" — the first thing a new account sees.
 *
 * The account comes first now and events are one thing you can do with it,
 * so the way in can't assume a show. Somebody here for Discovery or their
 * analytics was being asked to "Set up your show" before anything else. This
 * asks, lets them pick more than one, and the answer decides which questions
 * the profile asks and where they land.
 */
const OPTIONS: { key: Interest; title: string; line: string; icon: typeof CalendarDays }[] = [
  { key: "events", title: "Get booked on events", line: "Podcasters and speakers — take a slot on a live event like the Podcast Marathon.", icon: CalendarDays },
  { key: "grow", title: "Grow my show", line: "Post clips to your channels, see your analytics, and bring your audience with you.", icon: TrendingUp },
  { key: "discover", title: "Find guests, creators and sponsors", line: "Search military and veteran voices with Discovery.", icon: Compass },
  { key: "host", title: "Run my own event", line: "Put on your own live day with our studio and your own lineup.", icon: Flag },
];

export function IntentPicker({ onDone }: { onDone: (interests: Interest[]) => void }) {
  const [picked, setPicked] = useState<Interest[]>([]);
  const toggle = (k: Interest) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  return (
    <section className="mx-auto max-w-3xl" data-testid="intent-picker">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#F0A71F]">Welcome</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>
        What brings you to MilitaryVoices?
      </h1>
      <p className="mt-2 text-muted-foreground">Pick as many as fit. We'll set up your account around them — you can do the rest any time.</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((o) => {
          const on = picked.includes(o.key);
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => toggle(o.key)}
              aria-pressed={on}
              className={`relative flex items-start gap-3.5 rounded-2xl border-2 p-4 text-left transition-colors ${
                on ? "border-[#053877] bg-[#053877]/[0.05]" : "border-border bg-card hover:border-[#053877]/40"
              }`}
              data-testid={`intent-${o.key}`}
            >
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${on ? "bg-[#053877] text-white" : "bg-[#053877]/10 text-[#053877]"}`}>
                <o.icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-foreground">{o.title}</span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{o.line}</span>
              </span>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-[#053877] bg-[#053877] text-white" : "border-border"}`}>
                {on && <Check className="h-3 w-3" />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <Button size="lg" className="gap-2 rounded-full" disabled={picked.length === 0} onClick={() => onDone(picked)} data-testid="button-intent-continue">
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
        {picked.length === 0 && <span className="text-sm text-muted-foreground">Pick at least one.</span>}
      </div>
    </section>
  );
}
