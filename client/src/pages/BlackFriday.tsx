import { useEffect, useRef, useState } from "react";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Turnstile, useTurnstileSiteKey } from "@/components/Turnstile";
import { apiRequest } from "@/lib/queryClient";
import { PLANS, FOUNDING } from "@shared/tokens";
import { ArrowRight, Check, Loader2, Lock, Mic, Scissors, Link2, Users, Video, MessageCircle } from "lucide-react";

// Black Friday 2026: Founding Members. Podcasters who join MilitaryVoices.ai in 2026 are its founding group; until the
// end of December 31, 2026 a first Scale plan comes with 30 days free (Stripe's own trial, card at checkout).
//
// One way in: sign in right here (email + 6-digit code, the same as the dashboard), then straight on to Stripe's
// checkout for the trial. Links in: /go/bf?src=<channel> (counted, server/promo.ts); the page reports its own steps
// so each channel has a funnel.

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const scale = PLANS.creator;
const price = `$${(scale.cents / 100).toFixed(2)}`;

/** Until one real test checkout has passed: a ribbon, so nobody shares it early. */
const TRIAL_DRAFT = true;

const SCALE = [
  { i: Scissors, t: `${scale.credits} Pōstify credits a month`, d: "About 3 episodes a month of captioned clips and a clean episode. Yours on day 1." },
  { i: Video, t: "Your own Studio", d: "Record and go live with your guests in a studio that's yours." },
  { i: Users, t: "Invite a guest", d: "Your guest answers a few questions and sends their photo before the interview." },
];
const FREE = [
  { i: Mic, t: "Podcast hosting", d: "Your feed, listed in Apple Podcasts, Spotify and 10+ apps." },
  { i: Link2, t: "Your SmartLink page", d: "One link for your show, your socials and your latest episodes." },
  { i: MessageCircle, t: "SmartChat for listeners", d: "Listeners ask your show a question and get an answer from your episodes." },
];

type Standing = { open: boolean; endsLabel: string; member: boolean; plan: string | null; eligible: boolean; reason: string };

const srcOf = () => (typeof window === "undefined" ? "page" : (new URLSearchParams(window.location.search).get("src") || "page").replace(/[^a-z0-9-]/gi, "").slice(0, 20) || "page");
const track = (step: string, src: string) => { void fetch("/api/promo/bf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step, src }), keepalive: true }).catch(() => {}); };

export default function BlackFriday() {
  const src = useRef(srcOf()).current;
  const box = useRef<HTMLDivElement>(null);

  // Not shared yet: keep it out of search until it's approved.
  useEffect(() => {
    const m = document.createElement("meta");
    m.name = "robots";
    m.content = "noindex, nofollow";
    document.head.appendChild(m);
    const before = document.title;
    document.title = "Founding Members 2026 · MilitaryVoices.ai";
    return () => { m.remove(); document.title = before; };
  }, []);

  const toBox = () => {
    track("join", src);
    box.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => box.current?.querySelector<HTMLElement>("input,button")?.focus(), 400);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NavBar />
      {TRIAL_DRAFT && (
        <div className="bg-[#F0A71F] px-4 py-2 text-center text-xs font-semibold text-[#1a1200]" data-testid="bf-draft">
          Draft: this offer is being tested. Please don't share this page yet.
        </div>
      )}

      <header className="bg-[#000741] text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_26rem] lg:py-16">
          <div className="text-center lg:text-left">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#F0A71F]/40 bg-[#F0A71F]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#F0A71F]">
              Black Friday · Founding Members 2026
            </p>
            <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.02em] sm:text-5xl xl:text-6xl" style={HEADLINE_FONT}>
              Be one of the founding group that joins in 2026.
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-pretty text-lg leading-relaxed text-white/75 lg:mx-0">
              MilitaryVoices.ai is veteran-owned and built for military and veteran podcasters. The podcasters who join this year are our Founding Members.
            </p>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-base font-semibold text-[#F0A71F] lg:mx-0" data-testid="bf-offer">
              Scale free for 30 days, then {price} a month. Open until {FOUNDING.endsLabel}.
            </p>
          </div>
          <div ref={box} id="join" className="scroll-mt-24">
            <JoinBox src={src} />
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
          <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl" style={HEADLINE_FONT}>Founding Members join by {FOUNDING.endsLabel}.</h2>
          <ul className="mx-auto mt-5 flex max-w-md flex-col gap-2 text-left text-sm text-white/80">
            {["Sign in with your email and a 6-digit code.", "Add your card on Stripe's secure page. Nothing is charged for 30 days.", "Cancel before day 30 under Manage billing and you pay nothing."].map((t) => (
              <li key={t} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#F0A71F]" /> {t}</li>
            ))}
          </ul>
          <Button size="lg" onClick={toBox} className="mt-7 h-12 gap-2 rounded-full bg-[#F0A71F] px-8 text-base font-semibold text-[#1a1200] hover:bg-[#f5b944]" data-testid="bf-join-bottom">
            Join the Founding Members <ArrowRight className="h-4 w-4" />
          </Button>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

/** Sign in, then the trial: one card, every state. */
function JoinBox({ src }: { src: string }) {
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
      const { url } = await (await apiRequest("POST", "/api/host/founding/checkout", { src })).json();
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
      await apiRequest("POST", "/api/host/request-code", { email, turnstileToken: human });
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

  const shell = "rounded-3xl bg-white p-6 text-left text-[#0b1530] shadow-[0_20px_60px_rgba(0,0,0,0.35)]";
  const gold = "h-12 w-full gap-2 rounded-full bg-[#F0A71F] text-base font-semibold text-[#1a1200] hover:bg-[#f5b944]";
  const fine = "mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-[#4a5568]";
  const err = error ? <p className="mt-3 text-sm font-medium text-red-600" role="alert">{error}</p> : null;

  if (signedIn === null) return <div className={`${shell} flex h-48 items-center justify-center`}><Loader2 className="h-5 w-5 animate-spin text-[#4a5568]" /></div>;

  if (signedIn && !standing) return <div className={`${shell} flex h-48 items-center justify-center`}><Loader2 className="h-5 w-5 animate-spin text-[#4a5568]" /></div>;

  if (signedIn && standing) {
    if (standing.eligible) {
      return (
        <div className={shell} data-testid="bf-box-eligible">
          <p className="text-lg font-bold">Start your 30 days free</p>
          <p className="mt-1 text-sm text-[#4a5568]">Scale, then {price} a month. {scale.credits} credits today.</p>
          <Button onClick={() => void checkout()} disabled={busy} className={`mt-5 ${gold}`} data-testid="bf-checkout">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Start my 30 days free <ArrowRight className="h-4 w-4" /></>}
          </Button>
          <p className={fine}><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Your card goes in on Stripe's secure page. Nothing is charged for 30 days; cancel before then and you pay nothing.</p>
          {err}
        </div>
      );
    }
    const done = standing.reason === "plan";
    return (
      <div className={shell} data-testid={`bf-box-${standing.reason || "member"}`}>
        <p className="text-lg font-bold">{standing.member ? "You're a Founding Member." : standing.reason === "closed" ? `The offer ended on ${standing.endsLabel}.` : "Welcome back."}</p>
        <p className="mt-1 text-sm text-[#4a5568]">
          {done ? `You're on ${standing.plan}. Everything's ready in your dashboard.` : standing.reason === "had-plan" ? "The 30 days free is for a first plan, and you've had one before. Scale is on the Pricing page." : "Scale is on the Pricing page."}
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
          <p className="mt-1 text-sm text-[#4a5568]">Your email, and we'll send a 6-digit code. New or returning, the same way.</p>
          <Input type="email" required autoComplete="email" placeholder="you@yourshow.com" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-4 h-12 rounded-xl border-[#cbd5e1] bg-white text-base text-[#0b1530]" data-testid="bf-email" />
          {siteKey && <div className="mt-3"><Turnstile siteKey={siteKey} onToken={setHuman} resetSignal={humanReset} /></div>}
          <Button type="submit" disabled={busy || !email.includes("@") || (Boolean(siteKey) && !human)} className={`mt-4 ${gold}`} data-testid="bf-send-code">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Send my code <ArrowRight className="h-4 w-4" /></>}
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
      <p className={fine}><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Next, your card on Stripe's secure page. Nothing is charged for 30 days.</p>
      {err}
    </div>
  );
}
