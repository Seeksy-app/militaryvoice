import { useState } from "react";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { startPlanCheckout, startTokenCheckout, startAddonCheckout } from "@/lib/tokens";
import { PLANS, CREDIT_PACKS, ADDONS, TEST_PACK, cents, episodeCredits } from "@shared/tokens";
import { Check, Coins, Scissors, Wand2, Sparkles, Loader2, Gauge, Compass } from "lucide-react";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

// Pōstify pricing, beta. Not in the nav yet: reached from "Generate more",
// the credits chip and "Choose a plan" in Pōstify, or by link. The numbers
// live in shared/tokens.ts so the server charges exactly what this page shows.

const HOW = [
  { icon: Wand2, title: "8 credits an episode, everything included", body: "Four clips in every shape (vertical, square and wide) with animated captions that follow whoever's speaking, plus the clean episode." },
  { icon: Scissors, title: "Classic captions: 5 credits", body: "Bold captions burned in instead of animated ones: quicker, and still every shape and the clean episode." },
  { icon: Sparkles, title: "Music and edits included", body: "Add a track from our library to every clip, and fix a title or subtitle, at no extra cost. Your first episode is free." },
];

const EXAMPLES = [
  { label: "An episode, animated captions (4 clips)", credits: episodeCredits({ captions: "animated" }) },
  { label: "An episode, Classic captions (4 clips)", credits: episodeCredits({ captions: "classic" }) },
  { label: "A Pro episode, animated (6 clips)", credits: episodeCredits({ captions: "animated" }, 6) },
  { label: "A Pro episode, Classic (6 clips)", credits: episodeCredits({ captions: "classic" }, 6) },
];

/**
 * Against OpusClip, per episode — the unit a podcaster thinks in. Their
 * credit is a minute of video processed (a 60-minute episode is 60 credits);
 * ours pays for what's made. Their prices as listed on opus.pro, dated below:
 * check them again before changing anything here.
 */
const COMPARE: { row: string; cells: [string, string, string, string]; note?: string }[] = [
  { row: "Monthly price", cells: ["$15", "$29", "$19.95", "$49"] },
  { row: "A weekly 60-minute show (4 episodes a month)", cells: ["Not enough: 150 minutes is 2½ episodes", "Covered", "About $21.15 (2 extra credits)", "Covered, room for 7"], note: "Pōstify: every clip in vertical, square and wide, animated captions, 8 credits an episode (12 on Pro)." },
  { row: "Clips per episode", cells: ["As many as it finds", "As many as it finds", "4 picked, plus any you mark", "6 picked, plus any you mark"] },
  { row: "The whole episode cleaned (ums, false starts, dead air out) as MP3 and MP4", cells: ["Not listed", "Not listed", "Included", "Included"] },
  { row: "Post and schedule to your own accounts", cells: ["Auto-post", "Included", "Included", "Included"] },
  { row: "Your first episode free", cells: ["—", "—", "Yes", "Yes"] },
];

function Comparison() {
  return (
    <section className="mt-12" data-testid="pricing-compare">
      <h2 className="text-center text-2xl font-bold tracking-tight text-foreground" style={HEADLINE_FONT}>What a weekly show pays</h2>
      <p className="mx-auto mt-1 max-w-2xl text-center text-sm text-muted-foreground">OpusClip charges by the minute of video; Pōstify by what it makes. So here's the same month, per episode.</p>
      <div className="mt-5 overflow-x-auto rounded-3xl border border-border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="p-4 font-semibold text-muted-foreground" />
              <th className="p-4 font-semibold text-muted-foreground">OpusClip Starter</th>
              <th className="p-4 font-semibold text-muted-foreground">OpusClip Pro</th>
              <th className="bg-[#053877]/[0.05] p-4 font-bold text-foreground">Pōstify Creator</th>
              <th className="bg-[#053877]/[0.05] p-4 font-bold text-foreground">Pōstify Pro</th>
            </tr>
          </thead>
          <tbody>
            {COMPARE.map((r) => (
              <tr key={r.row} className="border-b border-border last:border-0 align-top">
                <td className="p-4 font-medium text-foreground">{r.row}{r.note && <span className="mt-1 block text-xs font-normal text-muted-foreground">{r.note}</span>}</td>
                {r.cells.map((c, i) => (
                  <td key={i} className={`p-4 ${i >= 2 ? "bg-[#053877]/[0.05] font-semibold text-foreground" : "text-muted-foreground"}`}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">OpusClip prices and plans as listed on opus.pro/pricing on 25 September 2026 (monthly billing). OpusClip is a trademark of its owner.</p>
    </section>
  );
}

export default function Pricing() {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [yearly, setYearly] = useState(false);
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
        <div className="mb-8 flex justify-center">
          <div className="inline-flex rounded-full border border-border bg-card p-1 text-sm font-semibold" role="tablist" aria-label="Billing">
            <button type="button" role="tab" aria-selected={!yearly} onClick={() => setYearly(false)} className={`rounded-full px-4 py-1.5 ${!yearly ? "bg-[#053877] text-white" : "text-muted-foreground hover:text-foreground"}`} data-testid="billing-monthly">Monthly</button>
            <button type="button" role="tab" aria-selected={yearly} onClick={() => setYearly(true)} className={`rounded-full px-4 py-1.5 ${yearly ? "bg-[#053877] text-white" : "text-muted-foreground hover:text-foreground"}`} data-testid="billing-yearly">
              Yearly <span className={yearly ? "text-[#F0A71F]" : "text-emerald-600"}>2 months free</span>
            </button>
          </div>
        </div>
        <div className="mx-auto grid max-w-3xl gap-5 md:grid-cols-2">
          {Object.values(PLANS).map((p) => {
            const popular = "popular" in p && p.popular;
            return (
              <div key={p.key} className={`relative flex flex-col rounded-3xl border bg-card p-6 shadow-sm ${popular ? "border-[#053877] ring-2 ring-[#053877]/15" : "border-border"}`} data-testid={`plan-card-${p.key}`}>
                {popular && <span className="absolute -top-3 left-6 rounded-full bg-[#053877] px-3 py-1 text-xs font-semibold text-white">Best value</span>}
                <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><Coins className="h-4 w-4 text-[#F0A71F]" /> {p.name}</p>
                {yearly ? (
                  <>
                    <p className="mt-3 text-4xl font-bold tracking-tight text-foreground" style={HEADLINE_FONT}>{cents(Math.round(p.yearCents / 12))}<span className="text-base font-medium text-muted-foreground"> /month</span></p>
                    <p className="text-xs text-muted-foreground"><span className="line-through">{cents(p.cents * 12)}</span> {cents(p.yearCents)} billed yearly</p>
                    <p className="mt-2 text-sm font-semibold text-foreground">{(p.credits * 12).toLocaleString()} credits a year, all at once</p>
                  </>
                ) : (
                  <>
                    <p className="mt-3 text-4xl font-bold tracking-tight text-foreground" style={HEADLINE_FONT}>{cents(p.cents)}<span className="text-base font-medium text-muted-foreground"> /month</span></p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{p.credits} credits a month</p>
                  </>
                )}
                <p className="mt-3 flex-1 text-sm text-foreground/80">{p.blurb}</p>
                <p className="mt-3 text-xs text-muted-foreground">{yearly ? "Top up with a credit pack any time." : `Extra credits ${cents(p.overageCents)} each, up to your limit.`}</p>
                <Button
                  onClick={() => void go(p.key, () => startPlanCheckout(p.key, yearly ? "year" : "month"))}
                  disabled={busy !== null}
                  className={`mt-5 w-full gap-2 rounded-full ${popular ? "bg-[#053877] text-white hover:bg-[#0a4a99]" : ""}`}
                  variant={popular ? "default" : "outline"}
                >
                  {busy === p.key && <Loader2 className="h-4 w-4 animate-spin" />}
                  Choose {p.name}{yearly ? " yearly" : ""}
                </Button>
              </div>
            );
          })}
        </div>

        {/* No subscription: credits bought once. */}
        <div className="mx-auto mt-10 max-w-3xl">
          <p className="text-center text-sm font-semibold text-foreground">Rather not subscribe? Buy credits once.</p>
          <p className="mt-1 text-center text-xs text-muted-foreground">No plan, nothing monthly. They don't run out during the beta.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {CREDIT_PACKS.map((p) => (
              <div key={p.key} className="flex flex-col items-center rounded-2xl border border-border bg-card p-4 text-center" data-testid={`pack-card-${p.key}`}>
                <p className="text-sm font-semibold text-muted-foreground">{p.tokens} credits</p>
                <p className="mt-1 text-2xl font-bold text-foreground" style={HEADLINE_FONT}>${p.price}</p>
                <p className="text-xs text-muted-foreground">{Math.round((p.price / p.tokens) * 100)}¢ a credit · {p.blurb}</p>
                <Button variant="outline" onClick={() => void go(p.key, () => startTokenCheckout(p.key))} disabled={busy !== null} className="mt-3 w-full gap-2 rounded-full">
                  {busy === p.key && <Loader2 className="h-4 w-4 animate-spin" />} Buy {p.tokens}
                </Button>
              </div>
            ))}
          </div>
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

        {/* Add-ons: their own subscriptions, with or without a plan. */}
        <section id="discovery" className="mx-auto mt-12 max-w-3xl scroll-mt-24">
          <p className="text-center text-xs font-bold uppercase tracking-[0.16em] text-[#b36b00]">Add-on</p>
          <div className="mt-3 flex flex-col gap-5 rounded-3xl border border-border bg-card p-6 sm:flex-row sm:items-center" data-testid="addon-discovery">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#053877] text-[#F0A71F]"><Compass className="h-6 w-6" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold text-foreground" style={HEADLINE_FONT}>{ADDONS.discovery.name} <span className="text-base font-semibold text-muted-foreground">· {cents(ADDONS.discovery.cents)}/month</span></p>
              <p className="text-sm text-muted-foreground">{ADDONS.discovery.blurb} Works with or without a Pōstify plan.</p>
              <ul className="mt-2 space-y-1 text-sm text-foreground/85">
                {ADDONS.discovery.features.map((f) => <li key={f} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#F0A71F]" /> {f}</li>)}
              </ul>
            </div>
            <Button onClick={() => void go("discovery", () => startAddonCheckout("discovery"))} disabled={busy !== null} className="shrink-0 gap-2 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="addon-discovery-buy">
              {busy === "discovery" && <Loader2 className="h-4 w-4 animate-spin" />} Add Discovery Pro
            </Button>
          </div>
        </section>

        <Comparison />

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
