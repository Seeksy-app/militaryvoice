import { useState } from "react";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { startTokenCheckout } from "@/lib/tokens";
import { TOKEN_PACKS, TEST_PACK, EPISODE_TOKENS } from "@shared/tokens";
import { Check, Coins, Scissors, Wand2, Sparkles, Loader2 } from "lucide-react";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

// Pōstify pricing, beta. Not in the nav yet: reached from "Generate more" and
// "Get tokens" in Pōstify, or by link. The packs live in shared/tokens.ts so
// the server charges exactly what this page shows. Buying goes straight to
// Stripe Checkout; tokens land when they come back to Pōstify.

const WHAT_A_TOKEN_BUYS = [
  { icon: Scissors, title: "1 token = 1 clip", body: "Picked by AI, cut vertical, square and wide, with word-by-word captions and the camera on whoever's speaking." },
  { icon: Wand2, title: "1 token = 1 clean episode", body: "The whole episode with the ums, false starts and dead air taken out, as audio and video." },
  { icon: Sparkles, title: "Your first episode is free", body: "Every podcaster gets one episode on us during the beta: its clips and its clean episode." },
];

export default function Pricing() {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const testing = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("test");

  async function buy(key: string) {
    setBusy(key);
    try {
      await startTokenCheckout(key);
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
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl" style={HEADLINE_FONT}>Pōstify tokens</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-white/75">
            Pay for what you make. One token is one clip, or one clean episode. Beta prices, kept close to what it costs us to make them.
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6">
        <div className="grid gap-5 md:grid-cols-3">
          {TOKEN_PACKS.map((p) => {
            const popular = "popular" in p && p.popular;
            return (
              <div key={p.key} className={`relative flex flex-col rounded-3xl border bg-card p-6 shadow-sm ${popular ? "border-[#053877] ring-2 ring-[#053877]/15" : "border-border"}`} data-testid={`pack-${p.key}`}>
                {popular && <span className="absolute -top-3 left-6 rounded-full bg-[#053877] px-3 py-1 text-xs font-semibold text-white">Most popular</span>}
                <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><Coins className="h-4 w-4 text-[#F0A71F]" /> {p.tokens} tokens</p>
                <p className="mt-3 text-4xl font-bold tracking-tight text-foreground" style={HEADLINE_FONT}>${p.price}</p>
                <p className="mt-1 text-sm text-muted-foreground">${(p.price / p.tokens).toFixed(2)} a token · {p.tokens / EPISODE_TOKENS} episodes</p>
                <p className="mt-4 flex-1 text-sm text-foreground/80">{p.blurb}</p>
                <Button
                  onClick={() => void buy(p.key)}
                  disabled={busy !== null}
                  className={`mt-6 w-full gap-2 rounded-full ${popular ? "bg-[#053877] text-white hover:bg-[#0a4a99]" : ""}`}
                  variant={popular ? "default" : "outline"}
                >
                  {busy === p.key && <Loader2 className="h-4 w-4 animate-spin" />}
                  Get {p.tokens} tokens
                </Button>
              </div>
            );
          })}
        </div>

        {testing && (
          <div className="mx-auto mt-6 flex max-w-md items-center justify-between gap-4 rounded-2xl border border-dashed border-[#F0A71F] bg-[#F0A71F]/10 px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-foreground">{TEST_PACK.tokens} tokens · ${TEST_PACK.price}</p>
              <p className="text-xs text-muted-foreground">{TEST_PACK.blurb}</p>
            </div>
            <Button onClick={() => void buy(TEST_PACK.key)} disabled={busy !== null} className="gap-2 rounded-full" data-testid="pack-test">
              {busy === TEST_PACK.key && <Loader2 className="h-4 w-4 animate-spin" />} Buy test pack
            </Button>
          </div>
        )}

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
            `Each episode: 4 clips + its clean episode = ${EPISODE_TOKENS} tokens.`,
            "Secure checkout by Stripe. Tokens are added the moment it's paid.",
          ].map((t) => (
            <li key={t} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#F0A71F]" /> {t}</li>
          ))}
        </ul>
      </main>
      <SiteFooter />
    </div>
  );
}
