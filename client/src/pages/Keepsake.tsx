import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2 } from "lucide-react";

// Where the QR code on the show's magazine slide lands: one job, ask for a
// digital copy of the keepsake magazine. No sign-in; they're watching on a
// phone, so it's a first name, an email and one button.

const HEAD = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

// /2027 (8 Oct): the same one job for next year. The magazine's back cover QR lands here:
// a name and an email, and they hear when National Military Podcast Day 2027 is set.
const COPY = {
  copy: {
    kicker: "The keepsake magazine",
    title: "Get your digital copy of VOICES of the Military",
    lead: "Every show from the 2026 Podcast Marathon in one keepsake edition. It comes out Friday, and we'll email it to you.",
    button: "Send me my copy",
    done: (email: string) => `The magazine comes out Friday, and we'll email your copy to ${email}.`,
    note: "We'll only use your email to send the magazine and news from MilitaryVoices.ai. You can unsubscribe anytime.",
  },
  next: {
    kicker: "National Military Podcast Day · October 2027",
    title: "See you in 2027",
    lead: "Sixteen hours live, reveille to end of duty, with a new military or veteran show every thirty minutes. Get on the list and we'll email you the date, the lineup and how to tune in.",
    button: "Put me on the list",
    done: (email: string) => `We'll email ${email} when the date and the lineup are set.`,
    note: "We'll only use your email for National Military Podcast Day news from MilitaryVoices.ai. You can unsubscribe anytime.",
  },
};

export default function Keepsake({ next = false }: { next?: boolean }) {
  const c = next ? COPY.next : COPY.copy;
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/magazine/copy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ firstName, email, website, list: next ? "nmpd-2027" : "magazine-copy" }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "That didn't go through. Please try again.");
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10" style={{ background: "linear-gradient(180deg, #000741, #053877)" }}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
        <img src="/nmpd-logo.png" alt="National Military Podcast Day" className="mx-auto h-24 w-24" />
        <p className="mt-4 text-balance text-center text-[12px] font-bold uppercase tracking-[0.25em] text-[#8a5a00]">{c.kicker}</p>
        <h1 className="mt-2 text-balance text-center text-3xl font-bold text-[#000741]" style={HEAD}>{c.title}</h1>
        {done ? (
          <div className="mt-6 rounded-xl bg-emerald-50 p-5 text-center" data-testid="keepsake-done">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
            <p className="mt-2 text-lg font-semibold text-emerald-900">You're on the list.</p>
            <p className="mt-1 text-pretty text-sm text-emerald-800">{c.done(email)}</p>
          </div>
        ) : (
          <form onSubmit={send} className="mt-6 space-y-4">
            <p className="text-pretty text-center text-[15px] text-slate-600">{c.lead}</p>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">First name</span>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-base focus:border-[#000741] focus:outline-none" data-testid="keepsake-first-name" />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Email</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-base focus:border-[#000741] focus:outline-none" data-testid="keepsake-email" />
            </label>
            <input value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={busy || !email} className="h-12 w-full bg-[#F0A71F] text-base font-bold text-[#000741] hover:bg-[#e09a10]" data-testid="keepsake-send">
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : c.button}
            </Button>
            <p className="text-center text-xs text-slate-500">{c.note}</p>
          </form>
        )}
      </div>
    </main>
  );
}
