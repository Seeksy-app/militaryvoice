import { useState } from "react";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Check, Coins, Scissors, Wand2, Sparkles, Loader2 } from "lucide-react";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

// Pōstify pricing, beta. Not in the nav yet: reached from "Generate more" in
// Pōstify, or by link. Prices sit just over what a clip costs us to make
// (Creatomate render in three shapes + transcription + the model picking and
// framing ≈ $1.35 a clip), because this is a beta and the point is to learn
// what people use, not to make margin. No checkout yet: a pack is requested,
// and a payment link follows by email.

export const TOKEN_PACKS = [
  { key: "tokens-10", tokens: 10, price: 15, blurb: "Try it on a few episodes." },
  { key: "tokens-25", tokens: 25, price: 35, blurb: "A month of weekly episodes.", popular: true },
  { key: "tokens-60", tokens: 60, price: 84, blurb: "For a network, or a busy show." },
] as const;

const WHAT_A_TOKEN_BUYS = [
  { icon: Scissors, title: "1 token = 1 clip", body: "Picked by AI, cut vertical, square and wide, with word-by-word captions and the camera on whoever's speaking." },
  { icon: Wand2, title: "1 token = 1 clean episode", body: "The whole episode with the ums, false starts and dead air taken out, as audio and video." },
  { icon: Sparkles, title: "Your first episode is free", body: "Every podcaster gets one episode on us during the beta: its clips and its clean episode." },
];

export default function Pricing() {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [asked, setAsked] = useState<string[]>([]);

  async function request(key: string) {
    setBusy(key);
    try {
      await apiRequest("POST", "/api/host/pro-interest", { feature: key });
      setAsked((a) => [...a, key]);
      toast({ title: "Got it — we'll email you a payment link", description: "Your tokens are added as soon as it's paid." });
    } catch (e) {
      // Not signed in: sign in first, then come back.
      if (/401|sign/i.test((e as Error).message)) {
        window.location.href = "/host/dashboard?next=/pricing";
        return;
      }
      toast({ title: "That didn't go through", description: "Try again in a moment.", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NavBar />
      <header className="bg-[#000741] text-white">
        <div className="mx-auto max-w-5xl px-4 py-14 text-center sm:px-6">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F0A71F]/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-[#F0A71F]">Beta pricing</span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl" style={HEADLINE_FONT}>Pōstify tokens</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-white/75">
            Pay for what you make. One token is one clip, or one clean episode. Beta prices sit just above what it costs us to make them.
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6">
        <div className="grid gap-5 md:grid-cols-3">
          {TOKEN_PACKS.map((p) => {
            const done = asked.includes(p.key);
            const popular = "popular" in p && p.popular;
            return (
              <div key={p.key} className={`relative flex flex-col rounded-3xl border bg-card p-6 shadow-sm ${popular ? "border-[#053877] ring-2 ring-[#053877]/15" : "border-border"}`} data-testid={`pack-${p.key}`}>
                {popular && <span className="absolute -top-3 left-6 rounded-full bg-[#053877] px-3 py-1 text-xs font-semibold text-white">Most popular</span>}
                <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><Coins className="h-4 w-4 text-[#F0A71F]" /> {p.tokens} tokens</p>
                <p className="mt-3 text-4xl font-bold tracking-tight text-foreground" style={HEADLINE_FONT}>${p.price}</p>
                <p className="mt-1 text-sm text-muted-foreground">${(p.price / p.tokens).toFixed(2)} a token · {p.tokens} clips</p>
                <p className="mt-4 flex-1 text-sm text-foreground/80">{p.blurb}</p>
                <Button
                  onClick={() => void request(p.key)}
                  disabled={busy === p.key || done}
                  className={`mt-6 w-full gap-2 rounded-full ${popular ? "bg-[#053877] text-white hover:bg-[#0a4a99]" : ""}`}
                  variant={popular ? "default" : "outline"}
                >
                  {busy === p.key ? <Loader2 className="h-4 w-4 animate-spin" /> : done ? <Check className="h-4 w-4" /> : null}
                  {done ? "Requested — watch your email" : `Get ${p.tokens} tokens`}
                </Button>
              </div>
            );
          })}
        </div>

        <div className="mt-12 grid gap-6 rounded-3xl border border-border bg-card p-6 sm:p-8 md:grid-cols-3">
          {WHAT_A_TOKEN_BUYS.map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#053877]/10 text-[#053877] dark:text-[#8fb5e8]"><Icon className="h-5 w-5" /></span>
              <p className="mt-3 font-semibold text-foreground">{title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>

        <ul className="mx-auto mt-10 grid max-w-3xl gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          {[
            "Tokens don't expire during the beta.",
            "Episodes up to 60 minutes each.",
            "Your originals are never changed or replaced.",
            "A typical episode: 4 clips + the clean episode = 5 tokens.",
          ].map((t) => (
            <li key={t} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#F0A71F]" /> {t}</li>
          ))}
        </ul>
      </main>
      <SiteFooter />
    </div>
  );
}
