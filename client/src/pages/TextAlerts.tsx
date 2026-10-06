import { useState } from "react";
import { Check, Loader2, MessageSquareText } from "lucide-react";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { SMS_CONSENT } from "@shared/sms";

// /text-alerts: the public page where someone signs up for show-day texts.
// It has to be public (the carriers' reviewers can't sign in), so it stands on
// its own: what the texts are, the form, an unticked box, the full words they
// agree to, and the links. Profile mobile numbers carry the same words.

export default function TextAlerts() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await apiRequest("POST", "/api/sms/opt-in", { name, email, phone, consent });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NavBar />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-12 sm:px-6">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#8a5a00]"><MessageSquareText className="h-4 w-4" /> Text alerts</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Get show-day texts from MilitaryVoices.ai</h1>
        <p className="mt-3 text-base text-muted-foreground">
          For podcasters, co-hosts and guests taking part in our live events. We text you when you're on in a few minutes, the
          green room link, and if the schedule changes. A few texts around your slot, nothing else, and never marketing.
        </p>

        {done ? (
          <div className="mt-8 flex gap-3 rounded-2xl border border-emerald-600/30 bg-emerald-50 p-5 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200" data-testid="text-alerts-done">
            <Check className="mt-0.5 h-5 w-5 shrink-0" />
            <p>You're signed up. We'll only text you about events you're part of. Reply STOP at any time to stop.</p>
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="mt-8 space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6" data-testid="text-alerts-form">
            <div>
              <Label htmlFor="ta-name">Your name</Label>
              <Input id="ta-name" className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
            <div>
              <Label htmlFor="ta-email">Email you booked with</Label>
              <Input id="ta-email" className="mt-1.5" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />
            </div>
            <div>
              <Label htmlFor="ta-phone">Mobile number</Label>
              <Input id="ta-phone" className="mt-1.5" type="tel" inputMode="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="(555) 555-5555" />
            </div>
            {/* Not ticked until they tick it: that's the consent. */}
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-muted/30 p-3.5 text-sm leading-relaxed" data-testid="text-alerts-consent">
              <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[#053877]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>
                {SMS_CONSENT.replace(" See the Terms and Privacy Policy.", "")} See our{" "}
                <a href="/terms" target="_blank" rel="noreferrer" className="font-medium text-[#053877] underline underline-offset-2 dark:text-[#9cc2ff]">Terms</a> and{" "}
                <a href="/privacy" target="_blank" rel="noreferrer" className="font-medium text-[#053877] underline underline-offset-2 dark:text-[#9cc2ff]">Privacy Policy</a>.
              </span>
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={busy || !consent || !email.trim() || !phone.trim()} data-testid="text-alerts-submit">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Sign me up for text alerts
            </Button>
            <p className="text-xs text-muted-foreground">
              We never sell or share your mobile number. Texts come from MilitaryVoices.ai, operated by Applied Growth Technologies LLC.
              Help: hello@militaryvoices.ai.
            </p>
          </form>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
