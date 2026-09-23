import { Link } from "wouter";
import { ArrowRight, BadgeCheck, Mic2, Megaphone, CalendarDays, Sparkles } from "lucide-react";

const HEADLINE = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

/**
 * The band that sends people to Discovery. The same message wherever it sits,
 * worded for who's reading: brands on the sponsor page, everyone on the home
 * page. `src` rides along so the admin can see which band brought them.
 */
export function DiscoveryPromo({ src, audience = "everyone" }: { src: string; audience?: "brands" | "everyone" }) {
  const href = `/discover?src=${encodeURIComponent(src)}`;
  const doors = [
    { icon: Megaphone, t: "Sponsor creators", b: "Veterans and military families with the audience you want." },
    { icon: Mic2, t: "Book guests", b: "Veterans with a story and a reason to come on your show." },
    { icon: CalendarDays, t: "Find speakers", b: "Voices for the stage, the panel and the keynote." },
  ];
  return (
    <section className="relative overflow-hidden bg-[#04102b] text-white" data-testid={`discovery-promo-${src}`}>
      <div aria-hidden className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-[#F0A71F] opacity-[0.14] blur-3xl" />
      <div className="relative mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:py-16">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#F0A71F]">
            <Sparkles className="h-3.5 w-3.5" /> New · MilitaryVoices Discovery
          </p>
          <h2 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl" style={HEADLINE}>
            {audience === "brands" ? "Beyond one day: find the military and veteran creators your brand should work with." : "Find the military and veteran voices worth working with."}
          </h2>
          <p className="mt-3 max-w-xl text-lg text-white/70">
            Search creators across Instagram, YouTube, TikTok, X and Twitch in plain English. See who's real, who's watching and which brands they've worked with. Free account.
          </p>
          <Link href={href}>
            <span className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-full bg-[#F0A71F] px-6 py-3 text-base font-semibold text-[#1a1200] transition hover:brightness-105" data-testid={`discovery-promo-cta-${src}`}>
              Try Discovery free <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
          <p className="mt-3 flex items-center gap-1.5 text-sm text-white/60"><BadgeCheck className="h-4 w-4 text-[#F0A71F]" /> Every podcaster on today's lineup is in it, verified.</p>
        </div>
        <ul className="grid gap-3">
          {doors.map(({ icon: Icon, t, b }) => (
            <li key={t}>
              <Link href={href}>
                <span className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition hover:border-white/25 hover:bg-white/[0.08]">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#F0A71F]"><Icon className="h-5 w-5" /></span>
                  <span>
                    <span className="block font-bold" style={HEADLINE}>{t}</span>
                    <span className="block text-sm text-white/60">{b}</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
