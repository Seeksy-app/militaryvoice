import { Link } from "wouter";
import { useState } from "react";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { startPlanCheckout, startTokenCheckout, startAddonCheckout } from "@/lib/tokens";
import { PLANS, CREDIT_PACKS, ADDONS, TEST_PACK, cents, episodeCredits } from "@shared/tokens";
import { Check, Coins, Loader2, Compass, Info, ChevronDown } from "lucide-react";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

// Pricing (9 Oct 2026 redesign): one line per feature with a hover for the detail, each plan building
// on the one before, Discovery Pro addable to a plan in the same payment, and the clutter (how credits
// work, what an episode uses, the limit) folded into one "How credits work" panel.
// The numbers live in shared/tokens.ts so the server charges exactly what this page shows.

type Feature = { t: string; tip: string };

const GROWTH: Feature[] = [
  { t: "SmartLink for every bio", tip: "Your page at militaryvoices.ai/you: your show, your links, your latest episodes and a way for listeners to reach you." },
  { t: "Podcast hosting + directory", tip: "We host your show and its feed, so it plays on Apple Podcasts, Spotify and every podcast app, and it's listed in the MilitaryVoices directory." },
  { t: "SmartChat for your listeners", tip: "Listeners ask your show a question and get an answer from your own episodes, any time of day." },
  { t: "Zoom recordings, straight in", tip: "Connect Zoom once. Every cloud recording comes in on its own, ready for clips and a clean episode." },
  { t: "Discovery: 10 contacts a month", tip: "Discovery: search military and veteran creators, guests and sponsors, and reveal up to 10 contact emails a month." },
  { t: "Events with an SI co-host", tip: "Take a slot in live events like the Podcast Marathon. Alex, our SI co-host, introduces you and keeps the hand-offs moving." },
];

const PLAN_FEATURES: Record<string, Feature[]> = {
  creator: [
    { t: "30 Pōstify credits a month", tip: "About 3 episodes a month with animated captions, or 6 with Classic." },
    { t: "4 captioned clips an episode", tip: "Picked by SI from your episode, in vertical, square and wide, ready for every platform." },
    { t: "A clean episode, every time", tip: "Ums, false starts and dead air taken out, as MP3 and MP4. Your original is never changed." },
    { t: "Music and title edits included", tip: "Add a track from our library to every clip, and change a title or subtitle, at no extra cost." },
    { t: "Animated, speaker-framed captions", tip: "Word-by-word captions, framed on whoever is talking. Or Classic captions for fewer credits." },
    { t: "Extra credits 60¢, capped by you", tip: "Run out, and Pōstify keeps going. Extras go on your next bill, never past the limit you set." },
  ],
  pro: [
    { t: "90 Pōstify credits a month", tip: "About 7 episodes a month with animated captions, or 12 with Classic." },
    { t: "6 clips an episode instead of 4", tip: "Two more moments from every episode, in every shape." },
    { t: "Room for a weekly show", tip: "A weekly 60-minute show uses 48 credits a month on Pro, so you have room for more." },
    { t: "Credits at 54¢ each, not 67¢", tip: "The more you make, the less each clip costs." },
    { t: "Extra credits 50¢, capped by you", tip: "Run out, and Pōstify keeps going. Extras go on your next bill, never past the limit you set." },
    { t: "Live Studio hours (soon)", tip: "When the MilitaryVoices Studio opens to every show, Pro includes live studio hours for yours." },
  ],
};

function Line({ f }: { f: Feature }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
      <Tooltip delayDuration={150}>
        <TooltipTrigger asChild>
          <span className="cursor-help underline decoration-dotted decoration-foreground/25 underline-offset-4">{f.t}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px] text-xs leading-relaxed">{f.tip}</TooltipContent>
      </Tooltip>
    </li>
  );
}

/**
 * What a weekly show pays for hosting plus clips, a month. Their prices as listed on their own
 * pricing pages on 9 Oct 2026: Buzzsprout Audio ($15/mo billed yearly), Podbean Unlimited Audio
 * ($17/mo billed monthly), OpusClip Pro ($29/mo billed monthly). Check again before changing these.
 */
const STACKS = [
  { name: "Buzzsprout + OpusClip", lines: [["Hosting (Buzzsprout Audio)", "$15"], ["Clips (OpusClip Pro)", "$29"]], total: "$44", ours: false },
  { name: "Podbean + OpusClip", lines: [["Hosting (Podbean Unlimited Audio)", "$17"], ["Clips (OpusClip Pro)", "$29"]], total: "$46", ours: false },
  { name: "MilitaryVoices Scale", lines: [["Hosting, SmartLink and SmartChat", "Free"], ["Clips and a clean episode (Pōstify)", "$19.95"]], total: "$19.95", ours: true },
];

function Comparison() {
  return (
    <section className="mt-14" data-testid="pricing-compare">
      <h2 className="text-center text-2xl font-bold tracking-tight text-foreground" style={HEADLINE_FONT}>What a weekly show pays</h2>
      <p className="mx-auto mt-1 max-w-xl text-center text-sm text-muted-foreground">Hosting plus clips, every month. Elsewhere that's two bills.</p>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {STACKS.map((s) => (
          <div key={s.name} className={`flex flex-col rounded-3xl border p-5 ${s.ours ? "border-[#053877] bg-[#053877] text-white shadow-lg" : "border-border bg-card"}`}>
            <p className={`text-sm font-bold ${s.ours ? "text-[#F0A71F]" : "text-foreground"}`}>{s.name}</p>
            <ul className="mt-3 flex-1 space-y-2 text-sm">
              {s.lines.map(([l, v]) => (
                <li key={l} className="flex items-baseline justify-between gap-3">
                  <span className={s.ours ? "text-white/80" : "text-muted-foreground"}>{l}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{v}</span>
                </li>
              ))}
            </ul>
            <div className={`mt-4 flex items-baseline justify-between border-t pt-3 ${s.ours ? "border-white/20" : "border-border"}`}>
              <span className="text-sm font-semibold">A month</span>
              <span className="text-2xl font-bold tabular-nums" style={HEADLINE_FONT}>{s.total}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-center text-[11px] text-muted-foreground">A weekly show: 4 episodes a month. Prices as listed on buzzsprout.com, podbean.com and opus.pro on 9 October 2026. On Scale, a fourth animated episode uses 2 extra credits ($1.20). Buzzsprout, Podbean and OpusClip are trademarks of their owners.</p>
    </section>
  );
}

const EXAMPLES = [
  { label: "An episode, animated captions (4 clips)", credits: episodeCredits({ captions: "animated" }) },
  { label: "An episode, Classic captions (4 clips)", credits: episodeCredits({ captions: "classic" }) },
  { label: "A Pro episode, animated (6 clips)", credits: episodeCredits({ captions: "animated" }, 6) },
  { label: "A Pro episode, Classic (6 clips)", credits: episodeCredits({ captions: "classic" }, 6) },
];

export default function Pricing() {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [yearly, setYearly] = useState(false);
  const [withDiscovery, setWithDiscovery] = useState<Record<string, boolean>>({});
  const testing = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("test");
  const disc = ADDONS.discovery;

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
        <div className="mx-auto max-w-5xl px-4 py-12 text-center sm:px-6">
          <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl" style={HEADLINE_FONT}>Military and veteran plans</h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
        <div className="mb-8 flex justify-center">
          <div className="inline-flex rounded-full border border-border bg-card p-1 text-sm font-semibold" role="tablist" aria-label="Billing">
            <button type="button" role="tab" aria-selected={!yearly} onClick={() => setYearly(false)} className={`rounded-full px-4 py-1.5 ${!yearly ? "bg-[#053877] text-white" : "text-muted-foreground hover:text-foreground"}`} data-testid="billing-monthly">Monthly</button>
            <button type="button" role="tab" aria-selected={yearly} onClick={() => setYearly(true)} className={`rounded-full px-4 py-1.5 ${yearly ? "bg-[#053877] text-white" : "text-muted-foreground hover:text-foreground"}`} data-testid="billing-yearly">
              Yearly <span className={yearly ? "text-[#F0A71F]" : "text-emerald-600"}>2 months free</span>
            </button>
          </div>
        </div>

        <div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-3">
          {/* Growth: everything that costs us pennies, free for good. */}
          <div className="relative flex flex-col rounded-3xl border border-border bg-card p-6 shadow-sm" data-testid="plan-card-growth">
            <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><Coins className="h-4 w-4 text-emerald-600" /> Growth</p>
            <p className="mt-3 text-4xl font-bold tracking-tight text-foreground" style={HEADLINE_FONT}>Free<span className="text-base font-medium text-muted-foreground"> forever</span></p>
            <p className="mt-1 text-sm font-semibold text-foreground">Your first episode of clips on us</p>
            <ul className="mt-4 flex-1 space-y-2 text-sm text-foreground/85">{GROWTH.map((f) => <Line key={f.t} f={f} />)}</ul>
            <Link href="/host/dashboard?start">
              <Button variant="outline" className="mt-6 w-full gap-2 rounded-full" data-testid="plan-growth-start">Start with Growth</Button>
            </Link>
          </div>

          {Object.values(PLANS).map((p) => {
            const popular = "popular" in p && p.popular;
            const addDisc = !yearly && !!withDiscovery[p.key];
            return (
              <div key={p.key} className={`relative flex flex-col rounded-3xl border bg-card p-6 shadow-sm ${popular ? "border-[#053877] ring-2 ring-[#053877]/15" : "border-border"}`} data-testid={`plan-card-${p.key}`}>
                {popular && <span className="absolute -top-3 left-6 rounded-full bg-[#053877] px-3 py-1 text-xs font-semibold text-white">Best value</span>}
                <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><Coins className="h-4 w-4 text-[#F0A71F]" /> {p.name}</p>
                {yearly ? (
                  <>
                    <p className="mt-3 text-4xl font-bold tracking-tight text-foreground" style={HEADLINE_FONT}>{cents(Math.round(p.yearCents / 12))}<span className="text-base font-medium text-muted-foreground"> /month</span></p>
                    <p className="mt-1 text-xs text-muted-foreground"><span className="line-through">{cents(p.cents * 12)}</span> {cents(p.yearCents)} billed yearly, all {(p.credits * 12).toLocaleString()} credits at once</p>
                  </>
                ) : (
                  <>
                    <p className="mt-3 text-4xl font-bold tracking-tight text-foreground" style={HEADLINE_FONT}>{cents(p.cents)}<span className="text-base font-medium text-muted-foreground"> /month</span></p>
                    <p className="mt-1 text-sm font-semibold text-foreground">Everything in {p.key === "pro" ? "Scale" : "Growth"}, plus</p>
                  </>
                )}
                <ul className="mt-4 flex-1 space-y-2 text-sm text-foreground/85">{(PLAN_FEATURES[p.key] ?? []).map((f) => <Line key={f.t} f={f} />)}</ul>

                {/* Discovery Pro in the same payment (monthly plans). */}
                <label className={`mt-5 flex items-start gap-2.5 rounded-2xl border p-3 text-sm ${yearly ? "border-dashed border-border opacity-70" : "cursor-pointer border-[#F0A71F]/60 bg-[#F0A71F]/[0.08]"}`} data-testid={`plan-${p.key}-discovery`}>
                  <Checkbox checked={addDisc} disabled={yearly} onCheckedChange={(v) => setWithDiscovery((w) => ({ ...w, [p.key]: v === true }))} className="mt-0.5 border-[#b36b00] data-[state=checked]:bg-[#b36b00] data-[state=checked]:text-white" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-semibold text-[#8a5200]"><Compass className="h-3.5 w-3.5 shrink-0" /> + Discovery Pro {cents(disc.cents)}/mo</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{yearly ? "Monthly only: add it on a monthly plan, or later." : `${disc.reveals} contacts and ${disc.lookups.toLocaleString()} profile look-ups a month.`}</span>
                  </span>
                </label>

                <Button
                  onClick={() => void go(p.key, () => startPlanCheckout(p.key, yearly ? "year" : "month", addDisc ? ["discovery"] : []))}
                  disabled={busy !== null}
                  className={`mt-4 w-full gap-2 rounded-full ${popular ? "bg-[#053877] text-white hover:bg-[#0a4a99]" : ""}`}
                  variant={popular ? "default" : "outline"}
                >
                  {busy === p.key && <Loader2 className="h-4 w-4 animate-spin" />}
                  Choose {p.name}{yearly ? " yearly" : ""}{addDisc ? ` + Discovery Pro · ${cents(p.cents + disc.cents)}/mo` : ""}
                </Button>
              </div>
            );
          })}
        </div>

        {/* No subscription: credits bought once, in one line. */}
        <div className="mx-auto mt-8 flex max-w-4xl flex-wrap items-center justify-center gap-2 text-sm">
          <span className="mr-1 font-semibold text-foreground">Rather not subscribe? Buy credits once:</span>
          {CREDIT_PACKS.map((p) => (
            <Button key={p.key} variant="outline" size="sm" onClick={() => void go(p.key, () => startTokenCheckout(p.key))} disabled={busy !== null} className="gap-1.5 rounded-full" data-testid={`pack-card-${p.key}`}>
              {busy === p.key && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {p.tokens} for ${p.price}
            </Button>
          ))}
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

        <Comparison />

        {/* Discovery Pro on its own. */}
        <section id="discovery" className="mx-auto mt-14 max-w-3xl scroll-mt-24">
          <div className="flex flex-col gap-4 rounded-3xl border border-[#F0A71F]/50 bg-[#F0A71F]/[0.06] p-6 sm:flex-row sm:items-center" data-testid="addon-discovery">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-lg font-bold text-foreground" style={HEADLINE_FONT}><Compass className="h-5 w-5 text-[#b36b00]" /> {disc.name} <span className="text-base font-semibold text-muted-foreground">· {cents(disc.cents)}/month</span></p>
              <p className="mt-1 text-sm text-muted-foreground">{disc.blurb} Add it with Scale or Pro above in one payment, or here.</p>
              <ul className="mt-2 space-y-1 text-sm text-foreground/85">
                {disc.features.map((f) => <li key={f} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#b36b00]" /> {f}</li>)}
              </ul>
            </div>
            <Button onClick={() => void go("discovery", () => startAddonCheckout("discovery"))} disabled={busy !== null} variant="outline" className="shrink-0 gap-2 rounded-full border-[#b36b00]/50" data-testid="addon-discovery-buy">
              {busy === "discovery" && <Loader2 className="h-4 w-4 animate-spin" />} Add Discovery Pro
            </Button>
          </div>
        </section>

        {/* Everything about credits, folded away until someone wants it. */}
        <details className="group mx-auto mt-10 max-w-3xl rounded-3xl border border-border bg-card p-6" data-testid="pricing-how-credits">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold text-foreground">
            <span className="flex items-center gap-2"><Info className="h-4 w-4 text-[#053877]" /> How credits work</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-4 grid gap-6 text-sm md:grid-cols-2">
            <div>
              <p className="font-semibold text-foreground">What an episode uses</p>
              <p className="mt-1 text-muted-foreground">Every clip in every shape, plus the clean episode. You choose when you start Pōstify.</p>
              <ul className="mt-3 divide-y divide-border">
                {EXAMPLES.map((e) => (
                  <li key={e.label} className="flex items-center justify-between py-2">
                    <span className="text-foreground/85">{e.label}</span>
                    <span className="font-semibold tabular-nums text-foreground">{e.credits} credits</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-semibold text-foreground">Your limit, your call</p>
              <p className="mt-1 text-muted-foreground">When your month's credits run out, Pōstify keeps going with extra credits on your next bill. You choose how far: no extras, or up to $10, $20, $50 or $100 a month ($20 unless you change it).</p>
              <ul className="mt-3 space-y-1.5 text-muted-foreground">
                {["Unused credits carry over while you're on a plan (beta).", "Update your card or cancel any time, in one click.", "Your originals are never changed or replaced.", "Episodes up to 90 minutes each."].map((t) => (
                  <li key={t} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> {t}</li>
                ))}
              </ul>
            </div>
          </div>
        </details>
      </main>
      <SiteFooter />
    </div>
  );
}
