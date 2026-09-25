import { useState } from "react";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { startPlanCheckout, startTokenCheckout } from "@/lib/tokens";
import { PLANS, TEST_PACK, cents, episodeCredits } from "@shared/tokens";
import { Check, Coins, Scissors, Wand2, Sparkles, Loader2, Gauge } from "lucide-react";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

// Pōstify pricing, beta. Not in the nav yet: reached from "Generate more",
// the credits chip and "Choose a plan" in Pōstify, or by link. The numbers
// live in shared/tokens.ts so the server charges exactly what this page shows.

const HOW = [
  { icon: Scissors, title: "Classic captions: 1 credit a clip", body: "Bold captions burned in, framed on whoever's speaking. Vertical, square and wide all included." },
  { icon: Wand2, title: "Animated captions: 1 credit per shape", body: "Word-by-word highlight, and the picture follows each speaker. Pick just the shapes you post." },
  { icon: Sparkles, title: "Clean episode: 1 credit", body: "The whole episode with the ums, false starts and dead air taken out. Your first episode is free." },
];

const EXAMPLES = [
  { label: "4 clips, Classic, every shape", credits: episodeCredits({ formats: ["vertical", "square", "wide"], captions: "classic" }) },
  { label: "4 clips, Animated, vertical only", credits: episodeCredits({ formats: ["vertical"], captions: "animated" }) },
  { label: "4 clips, Animated, vertical + square", credits: episodeCredits({ formats: ["vertical", "square"], captions: "animated" }) },
  { label: "4 clips, Animated, every shape", credits: episodeCredits({ formats: ["vertical", "square", "wide"], captions: "animated" }) },
];

export default function Pricing() {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const testing = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("test");

  async function go(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast({ title: "Checkout didn't open", description: (e as Error).message || "Try again in a moment.", variant: "destructive" });
      setBusy(null);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NavBar />
      <header className="bg-[#000741] text-white">
        <div className="mx-auto max-w-5xl px-4 py-14 text-center sm:px-6">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F0A71F]/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-[#F0A71F]">Beta pricing</span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl" style={HEADLINE_FONT}>Pōstify plans</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-white/75">
            Credits every month for clips and clean episodes. Run out, and extra credits go on your next bill — never past the limit you set.
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6">
        <div className="mx-auto grid max-w-3xl gap-5 md:grid-cols-2">
          {Object.values(PLANS).map((p) => {
            const popular = "popular" in p && p.popular;
            return (
              <div key={p.key} className={`relative flex flex-col rounded-3xl border bg-card p-6 shadow-sm ${popular ? "border-[#053877] ring-2 ring-[#053877]/15" : "border-border"}`} data-testid={`plan-card-${p.key}`}>
                {popular && <span className="absolute -top-3 left-6 rounded-full bg-[#053877] px-3 py-1 text-xs font-semibold text-white">Best value</span>}
                <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><Coins className="h-4 w-4 text-[#F0A71F]" /> {p.name}</p>
                <p className="mt-3 text-4xl font-bold tracking-tight text-foreground" style={HEADLINE_FONT}>{cents(p.cents)}<span className="text-base font-medium text-muted-foreground"> /month</span></p>
                <p className="mt-1 text-sm font-semibold text-foreground">{p.credits} credits a month</p>
                <p className="mt-3 flex-1 text-sm text-foreground/80">{p.blurb}</p>
                <p className="mt-3 text-xs text-muted-foreground">Extra credits {cents(p.overageCents)} each, up to your limit.</p>
                <Button
                  onClick={() => void go(p.key, () => startPlanCheckout(p.key))}
                  disabled={busy !== null}
                  className={`mt-5 w-full gap-2 rounded-full ${popular ? "bg-[#053877] text-white hover:bg-[#0a4a99]" : ""}`}
                  variant={popular ? "default" : "outline"}
                >
                  {busy === p.key && <Loader2 className="h-4 w-4 animate-spin" />}
                  Choose {p.name}
                </Button>
              </div>
            );
          })}
        </div>

        {testing && (
          <div className="mx-auto mt-6 flex max-w-md items-center justify-between gap-4 rounded-2xl border border-dashed border-[#F0A71F] bg-[#F0A71F]/10 px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-foreground">{TEST_PACK.tokens} credits · ${TEST_PACK.price}</p>
              <p className="text-xs text-muted-foreground">{TEST_PACK.blurb}</p>
            </div>
            <Button onClick={() => void go(TEST_PACK.key, () => startTokenCheckout(TEST_PACK.key))} disabled={busy !== null} className="gap-2 rounded-full" data-testid="pack-test">
              {busy === TEST_PACK.key && <Loader2 className="h-4 w-4 animate-spin" />} Buy test pack
            </Button>
          </div>
        )}

        <div className="mt-12 grid gap-6 rounded-3xl border border-border bg-card p-6 sm:p-8 md:grid-cols-3">
          {HOW.map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#053877]/10 text-[#053877] dark:text-[#8fb5e8]"><Icon className="h-5 w-5" /></span>
              <p className="mt-3 font-semibold text-foreground">{title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-border bg-card p-6">
            <p className="font-semibold text-foreground">What an episode uses</p>
            <p className="mt-1 text-sm text-muted-foreground">Including its clean episode. You choose when you start Pōstify.</p>
            <ul className="mt-4 divide-y divide-border">
              {EXAMPLES.map((e) => (
                <li key={e.label} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-foreground/85">{e.label}</span>
                  <span className="font-semibold tabular-nums text-foreground">{e.credits} credits</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl border border-border bg-card p-6">
            <p className="flex items-center gap-2 font-semibold text-foreground"><Gauge className="h-4 w-4 text-[#b36b00]" /> Your limit, your call</p>
            <p className="mt-1 text-sm text-muted-foreground">
              When your month's credits run out, Pōstify keeps going with extra credits, added to your next bill. You set how far: no extras at all, or up to $10, $20, $50 or $100 a month. $20 unless you change it.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              {[
                "Unused credits carry over while you're on a plan (beta).",
                "Update your card or cancel any time, in one click.",
                "Your originals are never changed or replaced.",
                "Episodes up to 90 minutes each.",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#F0A71F]" /> {t}</li>
              ))}
            </ul>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
