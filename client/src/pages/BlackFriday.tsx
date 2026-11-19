import { useEffect } from "react";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { PLANS } from "@shared/tokens";
import { ArrowRight, Check, Mic, Scissors, Link2, Users, Video, MessageCircle } from "lucide-react";

// Black Friday 2026: Founding Members. Podcasters who join MilitaryVoices.ai in 2026 are its founding group;
// the offer is Scale with the first 30 days free. Unlinked until Andrew approves the exact words.
//
// Links in: /go/bf?src=<channel> (counted, server/promo.ts). The button: /go/bf/start?src=<channel> (counted, then
// sign-up). The 30-day trial checkout isn't built yet (Stripe trial_period_days on Scale), so for now the button
// starts a free Growth account and the trial lines are marked as a draft.

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const scale = PLANS.creator;
const price = `$${(scale.cents / 100).toFixed(2)}`;

/** Draft until the Stripe answer is in and Andrew approves the wording. */
const TRIAL_DRAFT = true;
const TRIAL_LINE = `Scale free for 30 days, then ${price} a month. Cancel before day 30 and you pay nothing.`;

const SCALE = [
  { i: Scissors, t: `${scale.credits} Pōstify credits a month`, d: "About 3 episodes a month of captioned clips and a clean episode." },
  { i: Video, t: "Your own Studio", d: "Record and go live with your guests in a studio that's yours." },
  { i: Users, t: "Invite a guest", d: "Your guest answers a few questions and sends their photo before the interview." },
];
const FREE = [
  { i: Mic, t: "Podcast hosting", d: "Your feed, listed in Apple Podcasts, Spotify and 10+ apps." },
  { i: Link2, t: "Your SmartLink page", d: "One link for your show, your socials and your latest episodes." },
  { i: MessageCircle, t: "SmartChat for listeners", d: "Listeners ask your show a question and get an answer from your episodes." },
];

export default function BlackFriday() {
  const src = typeof window !== "undefined" ? (new URLSearchParams(window.location.search).get("src") || "page").replace(/[^a-z0-9-]/gi, "").slice(0, 20) : "page";
  const start = `/go/bf/start?src=${encodeURIComponent(src || "page")}`;

  // Unlinked and a draft: keep it out of search until it's approved.
  useEffect(() => {
    const m = document.createElement("meta");
    m.name = "robots";
    m.content = "noindex, nofollow";
    document.head.appendChild(m);
    const before = document.title;
    document.title = "Founding Members 2026 · MilitaryVoices.ai";
    return () => { m.remove(); document.title = before; };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NavBar />
      {TRIAL_DRAFT && (
        <div className="bg-[#F0A71F] px-4 py-2 text-center text-xs font-semibold text-[#1a1200]" data-testid="bf-draft">
          Draft: the 30-day trial isn't switched on yet. For now the button starts a free account.
        </div>
      )}

      <header className="bg-[#000741] text-white">
        <div className="mx-auto max-w-4xl px-4 py-14 text-center sm:px-6 sm:py-20">
          <p className="inline-flex items-center gap-2 rounded-full border border-[#F0A71F]/40 bg-[#F0A71F]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#F0A71F]">
            Black Friday · Founding Members 2026
          </p>
          <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.02em] sm:text-6xl" style={HEADLINE_FONT}>
            Be one of the founding group that joins in 2026.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-white/75">
            MilitaryVoices.ai is veteran-owned and built for military and veteran podcasters. The podcasters who join this year are our Founding Members.
          </p>
          <div className="mt-9 flex flex-col items-center gap-3">
            <a href={start} data-testid="bf-join">
              <Button size="lg" className="h-12 gap-2 rounded-full bg-[#F0A71F] px-8 text-base font-semibold text-[#1a1200] shadow-[0_10px_30px_rgba(240,167,31,0.35)] hover:bg-[#f5b944]">
                Join the Founding Members <ArrowRight className="h-4 w-4" />
              </Button>
            </a>
            <p className="text-pretty text-sm text-white/70" data-testid="bf-trial-line">{TRIAL_LINE}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6">
        <div className="grid gap-5 md:grid-cols-2">
          <section className="rounded-3xl border-2 border-[#053877] bg-card p-6 shadow-sm" data-testid="bf-scale">
            <p className="text-sm font-semibold text-muted-foreground">{scale.name}</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-foreground" style={HEADLINE_FONT}>
              30 days free<span className="text-base font-medium text-muted-foreground">, then {price} a month</span>
            </p>
            <ul className="mt-5 space-y-4">
              {SCALE.map(({ i: I, t, d }) => (
                <li key={t} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#053877]/10 text-[#053877]"><I className="h-4 w-4" /></span>
                  <span><span className="block font-semibold text-foreground">{t}</span><span className="block text-sm text-muted-foreground">{d}</span></span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-3xl border border-border bg-card p-6 shadow-sm" data-testid="bf-free">
            <p className="text-sm font-semibold text-muted-foreground">On every plan, free</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-foreground" style={HEADLINE_FONT}>Free to keep</p>
            <ul className="mt-5 space-y-4">
              {FREE.map(({ i: I, t, d }) => (
                <li key={t} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600/10 text-emerald-700"><I className="h-4 w-4" /></span>
                  <span><span className="block font-semibold text-foreground">{t}</span><span className="block text-sm text-muted-foreground">{d}</span></span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="mt-10 rounded-3xl bg-[#000741] px-6 py-10 text-center text-white">
          <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl" style={HEADLINE_FONT}>Founding Members join in 2026.</h2>
          <ul className="mx-auto mt-5 flex max-w-xl flex-col gap-2 text-left text-sm text-white/80 sm:items-center">
            {["Sign up with your email and a 6-digit code.", "Connect your show, or start one here.", "Make your first clips with Pōstify."].map((t) => (
              <li key={t} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#F0A71F]" /> {t}</li>
            ))}
          </ul>
          <a href={start} className="mt-7 inline-block" data-testid="bf-join-bottom">
            <Button size="lg" className="h-12 gap-2 rounded-full bg-[#F0A71F] px-8 text-base font-semibold text-[#1a1200] hover:bg-[#f5b944]">
              Join the Founding Members <ArrowRight className="h-4 w-4" />
            </Button>
          </a>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
