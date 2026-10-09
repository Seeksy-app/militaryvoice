import { useEffect, useState } from "react";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, Mic, Handshake, CalendarDays } from "lucide-react";

// /rethink (9 Oct 2026): Rethink the Military & Veteran Economy, 2027. The "Re:" identity
// (gold field, navy "Re", white colon) as a page, with a list to join. Not in the nav yet.

const GOLD = "#F0A71F";
const NAVY = "#000741";

const PILLARS = [
  { icon: Mic, title: "Creators", body: "Military and veteran podcasters, YouTubers and writers are running real businesses. They get the tools to grow them: a SmartLink, hosting, and clips from every episode." },
  { icon: Handshake, title: "Brands", body: "Reach the community through the voices it already trusts. Discovery finds the right military and veteran creators, and sponsorships put you in front of their audiences." },
  { icon: CalendarDays, title: "Events", body: "National Military Podcast Day returns in October 2027: sixteen hours live, reveille to end of duty, with a new show every thirty minutes." },
];

export default function Rethink() {
  useEffect(() => { document.title = "Rethink the Military & Veteran Economy · 2027 · MilitaryVoices.ai"; }, []);
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/magazine/copy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ firstName, email, website, list: "rethink-2027" }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "That didn't go through. Please try again.");
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NavBar />
      {/* The Re: mark, as on the launch graphic. */}
      <header style={{ background: GOLD, color: NAVY }}>
        <div className="mx-auto max-w-6xl px-4 pb-12 pt-10 sm:px-8 sm:pb-16 sm:pt-14">
          <p className="text-right text-sm font-bold sm:text-base">militaryvoices.ai</p>
          <p className="mt-2 select-none font-extrabold leading-[0.78] tracking-[-0.07em]" style={{ fontSize: "clamp(9rem, 30vw, 24rem)" }} aria-hidden="true">
            Re<span className="text-white">:</span>
          </p>
          <div className="mt-8 flex items-end justify-between gap-6 border-t-4 pt-6 sm:mt-10" style={{ borderColor: NAVY }}>
            <h1 className="min-w-0 text-balance text-3xl font-bold leading-[1.05] tracking-[0.01em] sm:text-5xl">
              <span className="text-white">Rethink</span> the Military <br className="hidden sm:inline" />&amp; Veteran Economy
            </h1>
            <p className="text-5xl font-extrabold leading-none tracking-tight text-white sm:text-7xl">2027</p>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section style={{ background: NAVY }} className="text-white">
          <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-8 sm:py-20">
            <p className="text-balance text-2xl font-bold leading-snug sm:text-4xl">The people who served are building shows, businesses and audiences. It's time to see that as an economy.</p>
            <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-white/75">Rethink is how MilitaryVoices.ai is heading into 2027: putting military and veteran creators, the businesses they build and the brands that back them at the center of the conversation.</p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-8">
          <div className="grid gap-5 md:grid-cols-3">
            {PILLARS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-3xl border border-border bg-card p-6 shadow-sm">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: GOLD, color: NAVY }}><Icon className="h-5 w-5" /></span>
                <h2 className="mt-4 text-xl font-bold" style={{ color: NAVY }}>{title}</h2>
                <p className="mt-2 text-pretty text-[15px] leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="px-4 pb-20 sm:px-8">
          <div className="mx-auto max-w-xl rounded-3xl p-6 text-center sm:p-10" style={{ background: GOLD, color: NAVY }}>
            <h2 className="text-balance text-3xl font-extrabold tracking-tight">Be part of <span className="text-white">Re:</span></h2>
            {done ? (
              <p className="mt-4 flex items-center justify-center gap-2 text-lg font-semibold"><CheckCircle2 className="h-5 w-5" /> You're on the list. We'll be in touch as 2027 comes together.</p>
            ) : (
              <form onSubmit={join} className="mt-6 space-y-3 text-left">
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" autoComplete="given-name" className="h-12 w-full rounded-xl border-0 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#000741]" data-testid="rethink-first-name" />
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="email" inputMode="email" className="h-12 w-full rounded-xl border-0 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#000741]" data-testid="rethink-email" />
                <input value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
                {error && <p className="text-sm font-semibold text-red-800">{error}</p>}
                <Button type="submit" disabled={busy || !email} className="h-12 w-full rounded-xl text-base font-bold text-white hover:opacity-90" style={{ background: NAVY }} data-testid="rethink-join">
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Get on the list"}
                </Button>
                <p className="text-center text-xs" style={{ color: `${NAVY}b3` }}>Creators, brands and partners welcome. We'll only use your email for Rethink news from MilitaryVoices.ai.</p>
              </form>
            )}
          </div>
          <p className="mt-6 text-center text-sm text-muted-foreground">A brand or partner? <Link href="/for-brands" className="font-semibold text-[#053877] hover:underline">See what we do for brands</Link></p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
