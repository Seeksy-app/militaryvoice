import { useEffect, useRef, useState } from "react";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Turnstile, useTurnstileSiteKey } from "@/components/Turnstile";
import { apiRequest } from "@/lib/queryClient";
import { PLANS, FOUNDING, CLIPS_PER_EPISODE, foundingOpen } from "@shared/tokens";
import { Link } from "wouter";
import { ArrowRight, CalendarDays, Captions, Gift, Loader2, Lock, Mic, Scissors, Sparkles, Link2, Users, Video, Coins } from "lucide-react";

// Black Friday 2026: Founding Members. Podcasters who join MilitaryVoices.ai in 2026 are its founding group; until the
// end of December 31, 2026 a first Scale plan comes with 30 days free (Stripe's own trial, card at checkout).
//
// One way in: sign in right here (email + 6-digit code, the same as the dashboard), then straight on to Stripe's
// checkout for the trial. Links in: /go/bf?src=<channel> (counted, server/promo.ts); the page reports its own steps
// so each channel has a funnel.
//
// The look is Andrew's ChatGPT banner: rendered art (public/bf/*.webp: the background plate, the 3D lettering, the
// price tag, the challenge coin) under live text, so the offer, the button and the sign-up stay sharp and real.

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const scale = PLANS.creator;
const price = `$${(scale.cents / 100).toFixed(2)}`;
const endsShort = FOUNDING.endsLabel.replace("December", "Dec");

/** Until one real test checkout has passed: a ribbon, so nobody shares it early. */
const TRIAL_DRAFT = false;

const GOLD_TEXT = "bg-gradient-to-b from-[#fff4c2] via-[#f7c548] to-[#c98a10] bg-clip-text text-transparent";
const GOLD_FILL = "bg-gradient-to-b from-[#ffe9a0] via-[#f6b93b] to-[#d28a0c]";

const CHIPS = [
  { img: "ico-hosting", t: "Free Hosting" },
  { img: "ico-studio", t: "Recording Studio" },
  { img: "ico-link", t: "Custom Bio Link" },
  { img: "ico-member", t: "Founding Member" },
];
const SCALE = [
  { i: Scissors, t: "Pōstify: clips, reels and text overlays", d: `Pōstify finds the best moments in every episode and cuts ${CLIPS_PER_EPISODE} captioned clips, in vertical, square and wide, ready to post. Add music and your own titles at no extra cost.` },
  { i: Captions, t: "Animated captions", d: "Word-by-word captions that follow whoever is talking, so your clips work with the sound off." },
  { i: Sparkles, t: "A clean episode, every time", d: "Ums, false starts and dead air taken out. Your original is never changed." },
  { i: Coins, t: `${scale.credits} Pōstify credits a month, yours on day 1`, d: "About 3 episodes a month with animated captions, or 6 with Classic captions." },
  { i: Video, t: "Your own Studio", d: "Record and go live with your guests in a studio that's yours: scenes, layouts, lower thirds and a producer console." },
];
const FREE = [
  { i: Mic, t: "Free podcast hosting", d: "Your show and its feed, listed in Apple Podcasts, Spotify and 10+ apps." },
  { i: Link2, t: "Your SmartLink", d: "One link to add to your social media profiles, with your show, your links and your latest episodes." },
  { i: Users, t: "Invite a guest", d: "Send your guest a link. They answer a few questions and add the photo they want shown, and you get it all before the interview." },
  { i: Gift, t: "Your first Pōstify episode free", d: "See what Pōstify does with one of your own episodes." },
];
const TICKER = ["Founding Members 2026", "Scale 30 days free", `Then just ${price} a month`, "Veteran-owned", `Offer ends ${endsShort}`];

type Standing = { open: boolean; endsLabel: string; member: boolean; plan: string | null; eligible: boolean; reason: string };

const srcOf = () => (typeof window === "undefined" ? "page" : (new URLSearchParams(window.location.search).get("src") || "page").replace(/[^a-z0-9-]/gi, "").slice(0, 20) || "page");
const track = (step: string, src: string) => { void fetch("/api/promo/bf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step, src }), keepalive: true }).catch(() => {}); };

const CSS = `
.bf-sweep{-webkit-mask:var(--m) center/contain no-repeat;mask:var(--m) center/contain no-repeat;background:linear-gradient(105deg,transparent 38%,rgba(255,255,255,.7) 50%,transparent 62%) -150% 0/250% 100% no-repeat;animation:bf-sweep 5.5s ease-in-out 1.2s infinite}
@keyframes bf-sweep{0%,55%{background-position:-150% 0}100%{background-position:250% 0}}
@keyframes bf-swing{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}
@keyframes bf-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes bf-pulse{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:.95;transform:scale(1.07)}}
@keyframes bf-ticker{to{transform:translateX(-50%)}}
@keyframes bf-in{from{transform:translateY(14px) scale(.97)}to{transform:none}}
.bf-swing{transform-origin:50% 6%;animation:bf-swing 4.2s ease-in-out infinite}
.bf-float{animation:bf-float 6s ease-in-out infinite}
.bf-halo{animation:bf-pulse 3.6s ease-in-out infinite}
.bf-ticker{animation:bf-ticker 28s linear infinite}
.bf-in{animation:bf-in .7s cubic-bezier(.2,.8,.2,1) both}
@media (prefers-reduced-motion:reduce){.bf-sweep,.bf-swing,.bf-float,.bf-halo,.bf-ticker,.bf-in{animation:none!important}.bf-sweep{display:none}}
`;

export default function BlackFriday() {
  const src = useRef(srcOf()).current;
  const box = useRef<HTMLDivElement>(null);

  // Open to search while the offer runs (Andrew, 20 Nov 2026: "let Google index the Black Friday page until Dec 31").
  // REMINDER: the offer ends Dec 31, 2026. From then on this page keeps itself out of search (the noindex below),
  // and it should be retired or redirected; also drop it from the sitemap in server/routes.ts (that's automatic too).
  useEffect(() => {
    const before = document.title;
    document.title = "Founding Members 2026 · MilitaryVoices.ai";
    let m: HTMLMetaElement | null = null;
    if (!foundingOpen()) {
      m = document.createElement("meta");
      m.name = "robots";
      m.content = "noindex, nofollow";
      document.head.appendChild(m);
    }
    return () => { m?.remove(); document.title = before; };
  }, []);

  const toBox = () => {
    track("join", src);
    box.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => box.current?.querySelector<HTMLElement>("input,button")?.focus(), 400);
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#000741]">
      <style>{CSS}</style>
      <NavBar />
      {TRIAL_DRAFT && (
        <div className="bg-[#F0A71F] px-4 py-2 text-center text-xs font-semibold text-[#1a1200]" data-testid="bf-draft">
          Draft: this offer is being tested. Please don't share this page yet.
        </div>
      )}

      <header className="relative isolate overflow-hidden bg-[#000741] text-white">
        {/* The rendered plate: velvet, flag, satin ribbons, gift boxes. No text in it. */}
        <img src="/bf/plate-wide.webp" alt="" aria-hidden="true" width={1536} height={672} fetchPriority="high"
          className="absolute inset-x-0 top-0 -z-20 h-[21rem] w-full object-cover object-[28%_center] [mask-image:linear-gradient(to_bottom,#000_62%,transparent)] md:inset-0 md:h-full md:[mask-image:none]" />
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_32%_42%,rgba(0,7,65,0.35),rgba(0,7,65,0.0)_62%),linear-gradient(to_bottom,rgba(0,7,65,0.0)_70%,#000741)]" aria-hidden="true" />

        <div className="mx-auto max-w-6xl px-4 pb-10 pt-6 sm:px-6 lg:pb-14 lg:pt-10">
          <h1 className="sr-only">Black Friday Special: Founding Members 2026. 30 days free.</h1>
          <div className="grid items-start gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_25rem]">

            {/* The lockup: LIMITED-TIME, BLACK FRIDAY, SPECIAL, and the swinging 30 DAYS FREE tag. */}
            <div className="bf-in relative mx-auto w-full max-w-[22rem] sm:max-w-[34rem] lg:col-start-1 lg:row-start-1 lg:mx-0 lg:max-w-[40rem]">
              <div className="relative w-[76%] sm:w-[78%]">
                <div className="absolute -inset-6 -z-10 rounded-full bg-[#F0A71F]/20 blur-3xl" aria-hidden="true" />
                <img src="/bf/letters.webp" alt="" aria-hidden="true" width={1100} height={708} className="w-full drop-shadow-[0_10px_30px_rgba(0,0,0,0.6)]" />
                <div className="bf-sweep absolute inset-0" style={{ ["--m" as string]: "url(/bf/letters.webp)" }} aria-hidden="true" />
              </div>
              <div className="bf-swing absolute -right-1 top-[2%] w-[31%] sm:right-0 sm:w-[30%]">
                <img src="/bf/tag.webp" alt="" aria-hidden="true" width={520} height={826} className="w-full drop-shadow-[0_14px_24px_rgba(0,0,0,0.65)]" />
                <span className="sr-only">30 days free</span>
              </div>
            </div>

            {/* The sign-up: the coin is its seal. */}
            <div className="relative mt-4 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:mt-0 lg:self-center">
              <div className="pointer-events-none absolute -top-16 right-2 z-10 w-20 sm:-top-[4.5rem] sm:w-24 lg:relative lg:top-0 lg:right-auto lg:mx-auto lg:mb-1 lg:w-52">
                <div className="bf-halo absolute -inset-5 rounded-full bg-[#F0A71F]/45 blur-2xl" aria-hidden="true" />
                <div className="bf-float relative">
                  <img src="/bf/coin.webp" alt="Founding Member 2026, Veteran-Owned" width={640} height={640} className="relative w-full drop-shadow-[0_0_18px_rgba(240,167,31,0.85)]" />
                  <div className="bf-sweep absolute inset-0" style={{ ["--m" as string]: "url(/bf/coin.webp)" }} aria-hidden="true" />
                </div>
              </div>
              <div ref={box} id="join" className="scroll-mt-24">
                <JoinBox src={src} />
              </div>
            </div>

            {/* The offer bar: the facts, exactly. */}
            <div className="lg:col-start-1 lg:row-start-2" data-testid="bf-offer">
              <div className={`rounded-2xl p-[2px] shadow-[0_0_40px_rgba(240,167,31,0.45)] ${GOLD_FILL}`}>
                <div className="grid overflow-hidden rounded-[14px] bg-[#020a38] sm:grid-cols-[auto_1fr_auto] sm:items-center">
                  <div className="flex items-center p-2.5 sm:pr-0">
                    <span className={`-skew-x-6 rounded-md px-4 py-2.5 text-center text-lg font-black uppercase italic leading-[1.05] tracking-tight text-[#1a1000] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] sm:text-xl ${GOLD_FILL}`} style={HEADLINE_FONT}>
                      Black Friday<br className="hidden sm:block" /> Offer
                    </span>
                  </div>
                  <div className="px-4 pb-3 text-center sm:py-3 sm:text-left">
                    <p className="whitespace-nowrap text-3xl font-black uppercase italic leading-none tracking-tight text-white sm:text-[2rem]" style={HEADLINE_FONT}>30 days free</p>
                    <p className="mt-1.5 whitespace-nowrap text-xs font-bold uppercase tracking-wide text-white/90 sm:text-[13px]">
                      Then just <span className={`text-base font-black italic ${GOLD_TEXT}`}>{price}</span> / month
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-3 border-t border-[#F0A71F]/40 px-4 py-3 sm:border-l sm:border-t-0">
                    <CalendarDays className="h-9 w-9 shrink-0 text-[#F0A71F]" strokeWidth={1.6} aria-hidden="true" />
                    <p className="whitespace-nowrap text-xs font-bold uppercase leading-tight tracking-wide text-white">
                      Offer ends<br /><span className="text-sm">{endsShort}</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* What's in it. Plain icons, not buttons. */}
            <ul className="grid grid-cols-4 gap-x-2 lg:col-start-1 lg:row-start-3" aria-label="What Founding Members get">
              {CHIPS.map(({ img, t }) => (
                <li key={t} className="flex flex-col items-center gap-1.5 text-center">
                  <img src={`/bf/${img}.webp`} alt="" aria-hidden="true" width={176} height={171} className="h-11 w-11 shrink-0 drop-shadow-[0_0_10px_rgba(240,167,31,0.55)] sm:h-14 sm:w-14" />
                  <span className="text-balance text-[13px] font-bold leading-tight text-white sm:whitespace-nowrap sm:text-sm" style={HEADLINE_FONT}>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Ticker. Decoration only. */}
        <div className="overflow-hidden border-y border-[#F0A71F]/50 bg-[#F0A71F] py-2 text-[#1a1000]" aria-hidden="true">
          <div className="bf-ticker flex w-max whitespace-nowrap text-sm font-black uppercase italic tracking-wider">
            {[0, 1, 2, 3].map((k) => (
              <span key={k} className="flex">{TICKER.map((t) => <span key={t} className="px-5">{t} <span className="px-2">★</span></span>)}</span>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6">
        <div className="grid gap-5 md:grid-cols-2">
          <section className="flex flex-col rounded-3xl border-2 border-[#F0A71F]/70 bg-[#050d56] p-6 text-white shadow-[0_0_30px_rgba(240,167,31,0.18)]" data-testid="bf-scale">
            <p className="text-sm font-semibold text-[#F0A71F]">{scale.name} · Founding Members</p>
            <p className="mt-2 text-3xl font-bold tracking-tight" style={HEADLINE_FONT}>
              30 days free<span className="block whitespace-nowrap text-base font-medium text-white/70 sm:inline">{" "}then {price} a month</span>
            </p>
            <ul className="mt-5 flex-1 space-y-4">
              {SCALE.map(({ i: I, t, d }) => (
                <li key={t} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F0A71F]/15 text-[#F0A71F]"><I className="h-4 w-4" /></span>
                  <span><span className="block font-semibold">{t}</span><span className="block text-sm text-white/70">{d}</span></span>
                </li>
              ))}
            </ul>
            <Button onClick={toBox} className={`mt-7 h-12 w-full gap-2 rounded-full text-[15px] font-extrabold uppercase italic tracking-tight text-[#2a1800] shadow-[0_0_26px_rgba(240,167,31,0.5),inset_0_2px_0_rgba(255,255,255,0.6)] hover:brightness-110 ${GOLD_FILL}`} data-testid="bf-scale-cta">
              Start 30 days free <ArrowRight className="h-4 w-4" />
            </Button>
            <p className="mt-3 text-center text-xs text-white/60">Card needed. Cancel before day 30 and you won't pay for the plan.</p>
          </section>

          <section className="flex flex-col rounded-3xl border border-white/20 bg-[#050d56]/60 p-6 text-white" data-testid="bf-free">
            <p className="text-sm font-semibold text-white/60">Free, always</p>
            <p className="mt-2 text-3xl font-bold tracking-tight" style={HEADLINE_FONT}>Join free</p>
            <ul className="mt-5 flex-1 space-y-4">
              {FREE.map(({ i: I, t, d }) => (
                <li key={t} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300"><I className="h-4 w-4" /></span>
                  <span><span className="block font-semibold">{t}</span><span className="block text-sm text-white/70">{d}</span></span>
                </li>
              ))}
            </ul>
            <Link href="/host/dashboard" onClick={() => track("free", src)} className="mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-full border-2 border-white/70 text-[15px] font-extrabold uppercase italic tracking-tight text-white transition hover:bg-white hover:text-[#000741]" data-testid="bf-free-cta">
              Join free <ArrowRight className="h-4 w-4" />
            </Link>
            <p className="mt-3 text-center text-xs text-white/60">Just your email and a 6-digit code.</p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

/** Sign in, then the trial: one card, every state. */
const proPlan = PLANS.pro;
const proPrice = `$${(proPlan.quarterCents / 100).toFixed(2)}`;
type FoundingPlan = "creator" | "pro";
/** Pro in the offer (Andrew, 21 Nov). Flip to true after his own Pro trial checkout passes. */
const PRO_LIVE = false;
const PLAN_CHOICE: { key: FoundingPlan; name: string; price: string; credits: string }[] = [
  { key: "creator", name: "Scale", price: `then ${price} a month`, credits: `${scale.credits} credits today` },
  { key: "pro", name: "Pro", price: `then ${proPrice} every 3 months`, credits: `${proPlan.credits} credits today` },
];

/** Scale or Pro: both have the first 30 days free (Andrew, 21 Nov 2026). ?plan=pro picks Pro on arrival. */
function PlanPick({ plan, setPlan }: { plan: FoundingPlan; setPlan: (p: FoundingPlan) => void }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Pick a plan">
      {PLAN_CHOICE.map((c) => (
        <button key={c.key} type="button" role="radio" aria-checked={plan === c.key} onClick={() => setPlan(c.key)} data-testid={`bf-plan-${c.key}`}
          className={`rounded-2xl border-2 px-3 py-2.5 text-left transition ${plan === c.key ? "border-[#F0A71F] bg-[#fff7e0]" : "border-[#cbd5e1] bg-white hover:border-[#F0A71F]/60"}`}>
          <span className="block text-[15px] font-bold leading-tight">{c.name}</span>
          <span className="mt-0.5 block text-xs leading-snug text-[#4a5568]">30 days free, {c.price}</span>
        </button>
      ))}
    </div>
  );
}

function JoinBox({ src }: { src: string }) {
  const [plan, setPlan] = useState<FoundingPlan>(() => (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("plan") === "pro" ? "pro" : "creator"));
  const chosen = PLAN_CHOICE.find((c) => c.key === plan)!;
  // Pro shows for everyone once Andrew's own Pro trial checkout passes (PRO_LIVE); until then only with ?plan=pro.
  const proOn = PRO_LIVE || plan === "pro";
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [standing, setStanding] = useState<Standing | null>(null);
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const siteKey = useTurnstileSiteKey();
  const [human, setHuman] = useState<string | null>(null);
  const [humanReset, setHumanReset] = useState(0);

  const loadStanding = async (): Promise<Standing | null> => {
    const r = await fetch("/api/host/founding", { cache: "no-store" });
    if (!r.ok) return null;
    const s = (await r.json()) as Standing;
    setStanding(s);
    return s;
  };

  useEffect(() => {
    void fetch("/api/host/session", { cache: "no-store" }).then(async (r) => {
      setSignedIn(r.ok);
      if (r.ok) await loadStanding();
    }).catch(() => setSignedIn(false));
  }, []);

  const checkout = async () => {
    setBusy(true);
    setError("");
    try {
      const { url } = await (await apiRequest("POST", "/api/host/founding/checkout", { src, plan })).json();
      window.location.href = url;
    } catch (e) {
      setError((e as Error).message || "Checkout didn't open. Try again in a moment.");
      setBusy(false);
      await loadStanding();
    }
  };

  const sendCode = async () => {
    setBusy(true);
    setError("");
    try {
      await apiRequest("POST", "/api/host/request-code", { email, turnstileToken: human, context: "bf" });
      track("code", src);
      setStep("code");
    } catch (e) {
      setError((e as Error).message || "Couldn't send that. Try again.");
    } finally {
      setBusy(false);
      setHumanReset((n) => n + 1);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError("");
    try {
      await apiRequest("POST", "/api/host/verify-code", { email, code, remember: true });
      track("signedin", src);
      setSignedIn(true);
      const s = (await (await apiRequest("POST", "/api/host/founding/join", {})).json()) as Standing;
      setStanding(s);
      // They came to start the 30 days: go straight on to checkout when they can have it.
      if (s.eligible) return void (await checkout());
      setBusy(false);
    } catch (e) {
      setError((e as Error).message || "That didn't work. Try again.");
      setBusy(false);
    }
  };

  // Signed in but not yet marked (they arrived already signed in): mark them once the standing loads. Once only.
  const marked = useRef(false);
  useEffect(() => {
    if (signedIn && standing && !standing.member && standing.open && !marked.current) {
      marked.current = true;
      void apiRequest("POST", "/api/host/founding/join", {}).then((r) => r.json()).then((s: Standing) => setStanding(s)).catch(() => {});
    }
  }, [signedIn, standing]);

  const shell = "relative rounded-3xl bg-white p-5 text-left text-[#0b1530] ring-[3px] ring-[#F0A71F] shadow-[0_0_0_6px_rgba(240,167,31,0.25),0_0_60px_rgba(240,167,31,0.5),0_24px_60px_rgba(0,0,0,0.45)] sm:p-6";
  const gold = `h-14 w-full gap-2 disabled:opacity-100 rounded-full px-3 text-[15px] font-extrabold uppercase italic tracking-tight text-[#2a1800] shadow-[0_0_26px_rgba(240,167,31,0.55),inset_0_2px_0_rgba(255,255,255,0.6)] enabled:hover:brightness-110 sm:text-base ${GOLD_FILL}`;
  const fine = "mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-[#4a5568]";
  const err = error ? <p className="mt-3 text-sm font-medium text-red-600" role="alert">{error}</p> : null;

  if (signedIn === null) return <div className={`${shell} flex h-48 items-center justify-center`}><Loader2 className="h-5 w-5 animate-spin text-[#4a5568]" /></div>;

  if (signedIn && !standing) return <div className={`${shell} flex h-48 items-center justify-center`}><Loader2 className="h-5 w-5 animate-spin text-[#4a5568]" /></div>;

  if (signedIn && standing) {
    if (standing.eligible) {
      return (
        <div className={shell} data-testid="bf-box-eligible">
          <p className="text-lg font-bold">Start your 30 days free</p>
          {proOn && <PlanPick plan={plan} setPlan={setPlan} />}
          <p className="mt-3 text-sm text-[#4a5568]">{chosen.name}, {chosen.price}. {chosen.credits}.</p>
          <Button onClick={() => void checkout()} disabled={busy} className={`mt-5 ${gold}`} data-testid="bf-checkout">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Start my 30 days free <ArrowRight className="h-4 w-4" /></>}
          </Button>
          <p className={fine}><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Your card goes in on Stripe's secure page. The plan isn't charged for 30 days; cancel before then and you won't pay for it.</p>
          {err}
        </div>
      );
    }
    const done = standing.reason === "plan";
    return (
      <div className={shell} data-testid={`bf-box-${standing.reason || "member"}`}>
        <p className="text-lg font-bold">{standing.member ? "You're a Founding Member." : standing.reason === "closed" ? `The offer ended on ${standing.endsLabel}.` : "Welcome back."}</p>
        <p className="mt-1 text-sm text-[#4a5568]">
          {done ? `You're on ${standing.plan}. Everything's ready in your dashboard.` : standing.reason === "had-plan" ? "The 30 days free is for a first plan, and you've had one before. Scale and Pro are on the Pricing page." : "Scale and Pro are on the Pricing page."}
        </p>
        <a href={done ? "/host/dashboard" : "/pricing"} className="mt-5 block">
          <Button className={gold}>{done ? "Open my dashboard" : "See plans"} <ArrowRight className="h-4 w-4" /></Button>
        </a>
        {err}
      </div>
    );
  }

  return (
    <div className={shell} data-testid="bf-box-signin">
      <p className="text-lg font-bold">Join the Founding Members</p>
      {step === "email" ? (
        <form onSubmit={(e) => { e.preventDefault(); if (email.includes("@") && (!siteKey || human)) void sendCode(); }}>
          <p className="mt-1 text-sm text-[#4a5568]">{proOn ? "Scale or Pro, 30 days free." : `30 days free, then ${price} a month.`}</p>
          {proOn && <PlanPick plan={plan} setPlan={setPlan} />}
          <Input type="email" required autoComplete="email" placeholder="you@yourshow.com" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-4 h-12 rounded-xl border-[#cbd5e1] bg-white text-base text-[#0b1530]" data-testid="bf-email" />
          {siteKey && <div className="mt-3"><Turnstile siteKey={siteKey} onToken={setHuman} resetSignal={humanReset} appearance="interaction-only" theme="light" /></div>}
          <Button type="submit" disabled={busy || !email.includes("@") || (Boolean(siteKey) && !human)} className={`mt-4 ${gold}`} data-testid="bf-send-code">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Become a Founding Member <ArrowRight className="h-5 w-5" /></>}
          </Button>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (code.trim().length >= 6) void verify(); }}>
          <p className="mt-1 text-sm text-[#4a5568]">We sent a 6-digit code to <b>{email}</b>.</p>
          <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="mt-4 h-12 rounded-xl border-[#cbd5e1] bg-white text-center text-lg tracking-[0.4em] text-[#0b1530]" data-testid="bf-code" />
          <Button type="submit" disabled={busy || code.length < 6} className={`mt-4 ${gold}`} data-testid="bf-verify">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue <ArrowRight className="h-4 w-4" /></>}
          </Button>
          <button type="button" onClick={() => { setStep("email"); setCode(""); setError(""); }} className="mt-3 text-xs font-semibold text-[#4a5568] underline underline-offset-4">Use a different email</button>
        </form>
      )}
      <p className={fine}><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> We'll email you a 6-digit code, then on to checkout. Card needed; cancel before day 30 and you won't pay for the plan.</p>
      {err}
    </div>
  );
}
