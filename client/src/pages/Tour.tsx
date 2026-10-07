import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { LogoLockup } from "@/components/Logo";
import { IntentPicker } from "@/components/IntentPicker";
import { ProfileForm } from "@/components/ProfileForm";
import { BrandSetup } from "@/components/BrandHome";
import { Button } from "@/components/ui/button";
import { pathOf } from "@shared/schema";

// /tour (7 Oct): the real sign-up screens, in practice mode: pick a path, fill
// the form, see where it lands, and nothing is ever saved. For recording demo
// videos and for showing anyone how it works (a link we can send).

export default function Tour() {
  const clean = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("clean");
  const [interests, setInterests] = useState("");
  const [done, setDone] = useState(false);
  const path = interests ? pathOf(interests) : null;

  return (
    <div className="min-h-screen bg-background">
      {!clean && <div className="bg-[#F0A71F] px-4 py-1.5 text-center text-xs font-semibold text-[#1a1200]">Practice mode: the real sign-up screens, and nothing is saved</div>}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <LogoLockup className="h-9 w-auto" />
          {(interests || done) && <button type="button" onClick={() => { setInterests(""); setDone(false); }} className="text-sm text-muted-foreground hover:text-foreground">Start over</button>}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {!interests ? (
          <IntentPicker onDone={(picked) => setInterests(picked.join(","))} />
        ) : done ? (
          <section className="mx-auto max-w-xl rounded-3xl border border-border bg-card p-8 text-center" data-testid="tour-done">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
            <h1 className="mt-4 text-2xl font-bold tracking-tight">{path === "brand" ? "You're in Discovery" : "You're in"}</h1>
            <p className="mt-2 text-muted-foreground">{path === "brand"
              ? "Your brand home opens next: find creators, save them to lists your team shares, and send requests once we've approved you."
              : path === "planner" ? "Next: create your first event." : "Your dashboard opens next, with your next steps for the path you picked."}</p>
            <Link href="/host/dashboard?start"><Button className="mt-6 gap-2 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]">Start for real <ArrowRight className="h-4 w-4" /></Button></Link>
          </section>
        ) : path === "brand" ? (
          <BrandSetup demo onDone={() => setDone(true)} />
        ) : (
          <section>
            <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
              {path === "podcaster"
                ? "Tell us about you and your show once. Your directory card is built from these details, and it goes with you to every event you join."
                : "Tell us about you once. Your directory card is built from these details — it's how organizers find you and invite you."}
            </p>
            <ProfileForm demo eventOpen={false} email="you@example.com" profile={null} variant="setup" interests={interests} onSaved={() => setDone(true)} />
          </section>
        )}
      </main>
    </div>
  );
}
