import { useEffect, useState } from "react";
import { Check, Mail, Contact, MonitorPlay, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

const FEATURES = [
  {
    key: "campaigns",
    title: "Email campaigns",
    icon: Mail,
    image: "/pro/campaigns.jpg",
    lead: "Write to the people who found you — once, or on a schedule.",
    points: ["One email, one send, with opens and clicks the next morning", "Automations: welcome, reminder, follow-up — written once", "Templates you keep, in your voice"],
  },
  {
    key: "crm",
    title: "Contacts CRM",
    icon: Contact,
    image: "/pro/crm.jpg",
    lead: "Everyone who asked for a reminder, listened, or clicked — in one list that is yours.",
    points: ["Lists and segments: who opened, who didn't, who's new", "Import your own list; export any time", "Every contact's history, email by email"],
  },
  {
    key: "studio",
    title: "Your own studio",
    icon: MonitorPlay,
    image: "/pro/studio.jpg",
    lead: "The studio that runs the marathon, on any day you like.",
    points: ["Green room, scenes and a producer — for your show, on your schedule", "Stream to your YouTube; record in the cloud; clips cut for you", "Guests join from a link. No software."],
  },
] as const;

/**
 * What is behind the locked doors in the nav — shown, not built.
 *
 * Static pictures of the real thing (the tools this event runs on), a line
 * on what each does, and one button: tell us you want it. No pricing, no
 * promises on dates; a name on a list is the whole ask, and it is what
 * decides whether these get built for podcasters at all.
 */
export function ProScreen({ feature }: { feature?: string }) {
  const { toast } = useToast();
  const [asked, setAsked] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const f = FEATURES.find((x) => x.key === feature) ?? FEATURES[0];
  const Icon = f.icon;
  const done = asked.includes(f.key);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [f.key]);

  async function interested(key: string) {
    setBusy(key);
    try {
      await apiRequest("POST", "/api/host/pro-interest", { feature: key });
      setAsked((a) => [...a, key]);
      toast({ title: "Noted — you're on the list", description: "We'll tell you first when it's ready." });
    } catch {
      toast({ title: "That didn't go through", description: "Try again in a moment.", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-2" id={`pro-${f.key}`} data-testid={`pro-${f.key}`}>
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#F0A71F]">
        <Lock className="h-3.5 w-3.5" /> Pro · coming after the Marathon
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl" style={HEADLINE_FONT}>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#053877]/10 text-[#053877]"><Icon className="h-5 w-5" /></span>
            {f.title}
          </h2>
          <p className="mt-2 max-w-2xl text-lg text-foreground/90">{f.lead}</p>
        </div>
        {done ? (
          <p className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400"><Check className="h-4 w-4" /> You're on the list for this one.</p>
        ) : (
          <Button className="rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" disabled={busy === f.key} onClick={() => interested(f.key)} data-testid={`pro-interested-${f.key}`}>
            I'd use this
          </Button>
        )}
      </div>

      <div className="relative mt-6 overflow-hidden rounded-2xl border border-border bg-muted/40 shadow-sm">
        <img src={f.image} alt={`${f.title} — the real thing`} className="block w-full" />
        <span className="absolute left-3 top-3 rounded-full bg-[#04102b]/85 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">Preview</span>
      </div>

      <ul className="mt-6 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
        {f.points.map((p) => (
          <li key={p} className="flex items-start gap-2 rounded-xl border border-border bg-card p-4"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#F0A71F]" /> {p}</li>
        ))}
      </ul>
      <p className="mt-6 max-w-2xl text-sm text-muted-foreground">
        Everything the event uses to reach people, write to them and go on air is being made available to podcasters on
        the lineup first. If you want one, say so — that's what decides the order we build them in.
      </p>
    </section>
  );
}
