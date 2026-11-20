import { Link } from "wouter";
import { ArrowRight, CalendarDays } from "lucide-react";
import { PLANS, FOUNDING, foundingOpen } from "@shared/tokens";

// The home page hero while Founding Members 2026 runs (Black Friday). It reuses the /black-friday page's own rendered
// art (public/bf/*.webp, made by the design session) so the home page and the offer page look like one thing.
// On from Monday 23 Nov 2026, 00:00 ET, until the offer ends (FOUNDING.endsAt); then the normal hero comes back by itself.
// ?hero=bf shows it early (for review); ?hero=default shows the normal hero.

const STARTS_AT = Date.parse("2026-11-23T05:00:00.000Z");

export function foundingHeroOn(now = Date.now()): boolean {
  if (typeof window !== "undefined") {
    const h = new URLSearchParams(window.location.search).get("hero");
    if (h === "bf") return true;
    if (h === "default") return false;
  }
  return now >= STARTS_AT && foundingOpen(now);
}

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const GOLD_TEXT = "bg-gradient-to-b from-[#fff4c2] via-[#f7c548] to-[#c98a10] bg-clip-text text-transparent";
const GOLD_FILL = "bg-gradient-to-b from-[#ffe9a0] via-[#f6b93b] to-[#d28a0c]";
const price = `$${(PLANS.creator.cents / 100).toFixed(2)}`;
const endsShort = FOUNDING.endsLabel.replace("December", "Dec");

const CSS = `
.fh-sweep{-webkit-mask:var(--m) center/contain no-repeat;mask:var(--m) center/contain no-repeat;background:linear-gradient(105deg,transparent 38%,rgba(255,255,255,.7) 50%,transparent 62%) -150% 0/250% 100% no-repeat;animation:fh-sweep 5.5s ease-in-out 1.2s infinite}
@keyframes fh-sweep{0%,55%{background-position:-150% 0}100%{background-position:250% 0}}
@keyframes fh-swing{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}
@keyframes fh-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes fh-pulse{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:.95;transform:scale(1.07)}}
.fh-swing{transform-origin:50% 6%;animation:fh-swing 4.2s ease-in-out infinite}
.fh-float{animation:fh-float 6s ease-in-out infinite}
.fh-halo{animation:fh-pulse 3.6s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.fh-sweep,.fh-swing,.fh-float,.fh-halo{animation:none!important}.fh-sweep{display:none}}
`;

export function FoundingHero() {
  return (
    <section className="relative isolate overflow-hidden bg-[#000741] text-white" data-testid="founding-hero">
      <style>{CSS}</style>
      <img src="/bf/plate-wide.webp" alt="" aria-hidden="true" width={1536} height={672} fetchPriority="high"
        className="absolute inset-x-0 top-0 -z-20 h-[20rem] w-full object-cover object-[28%_center] [mask-image:linear-gradient(to_bottom,#000_62%,transparent)] md:inset-0 md:h-full md:[mask-image:none]" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_32%_42%,rgba(0,7,65,0.35),rgba(0,7,65,0.0)_62%),linear-gradient(to_bottom,rgba(0,7,65,0.0)_70%,#000741)]" aria-hidden="true" />

      <div className="mx-auto grid max-w-6xl items-center gap-x-10 gap-y-7 px-4 pb-14 pt-8 sm:px-6 lg:min-h-[600px] lg:grid-cols-[minmax(0,1fr)_20rem] lg:pb-16 lg:pt-12">
        <h1 className="sr-only">Black Friday Special: become a MilitaryVoices.ai Founding Member. Scale free for 30 days.</h1>

        <div className="min-w-0">
          {/* The lockup from /black-friday: LIMITED-TIME, BLACK FRIDAY, SPECIAL, and the swinging 30 DAYS FREE tag. */}
          <div className="relative mx-auto w-full max-w-[22rem] sm:max-w-[32rem] lg:mx-0 lg:max-w-[36rem]">
            <div className="relative w-[76%] sm:w-[78%]">
              <div className="absolute -inset-6 -z-10 rounded-full bg-[#F0A71F]/20 blur-3xl" aria-hidden="true" />
              <img src="/bf/letters.webp" alt="" aria-hidden="true" width={1100} height={708} className="w-full drop-shadow-[0_10px_30px_rgba(0,0,0,0.6)]" />
              <div className="fh-sweep absolute inset-0" style={{ ["--m" as string]: "url(/bf/letters.webp)" }} aria-hidden="true" />
            </div>
            <div className="fh-swing absolute -right-1 top-[2%] w-[31%] sm:right-0 sm:w-[30%]">
              <img src="/bf/tag.webp" alt="" aria-hidden="true" width={520} height={826} className="w-full drop-shadow-[0_14px_24px_rgba(0,0,0,0.65)]" />
            </div>
          </div>

          <p className="mx-auto mt-6 max-w-xl text-balance text-center text-lg leading-relaxed text-white/85 lg:mx-0 lg:text-left" style={HEADLINE_FONT}>
            Military and veteran podcasters who join in 2026 become our Founding Members. Get Scale free for your first 30 days.
          </p>

          {/* The offer bar: the facts, exactly as on /black-friday. */}
          <div className={`mx-auto mt-6 max-w-xl rounded-2xl p-[2px] shadow-[0_0_40px_rgba(240,167,31,0.45)] lg:mx-0 ${GOLD_FILL}`}>
            <div className="grid overflow-hidden rounded-[14px] bg-[#020a38] sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="px-5 py-3 text-center sm:text-left">
                <p className="whitespace-nowrap text-3xl font-black uppercase italic leading-none tracking-tight text-white sm:text-[2rem]" style={HEADLINE_FONT}>30 days free</p>
                <p className="mt-1.5 whitespace-nowrap text-xs font-bold uppercase tracking-wide text-white/90 sm:text-[13px]">
                  Then just <span className={`text-base font-black italic ${GOLD_TEXT}`}>{price}</span> / month · card needed
                </p>
              </div>
              <div className="flex items-center justify-center gap-3 border-t border-[#F0A71F]/40 px-5 py-3 sm:border-l sm:border-t-0">
                <CalendarDays className="h-9 w-9 shrink-0 text-[#F0A71F]" strokeWidth={1.6} aria-hidden="true" />
                <p className="whitespace-nowrap text-xs font-bold uppercase leading-tight tracking-wide text-white">
                  Offer ends<br /><span className="text-sm">{endsShort}</span>
                </p>
              </div>
            </div>
          </div>

          <div className="mx-auto mt-7 flex max-w-xl flex-col items-stretch gap-3 sm:flex-row sm:items-center lg:mx-0">
            {/* A plain link through the counted /go/bf, so home page visits show in the funnel as src=home. */}
            <a href="/go/bf?src=home" className={`flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full px-7 text-base font-extrabold uppercase italic tracking-tight text-[#1a1000] shadow-[0_10px_30px_rgba(240,167,31,0.45)] transition hover:brightness-110 ${GOLD_FILL}`} style={HEADLINE_FONT} data-testid="button-founding">
              Become a Founding Member <ArrowRight className="h-4 w-4" />
            </a>
            <Link href="/host/dashboard?start" className="flex h-12 items-center justify-center whitespace-nowrap rounded-full border border-white/40 bg-white/5 px-6 text-base font-semibold text-white backdrop-blur transition hover:bg-white/15" data-testid="button-start-free">
              Or start free
            </Link>
          </div>
        </div>

        {/* The coin is the seal. */}
        <div className="pointer-events-none relative mx-auto hidden w-64 lg:block lg:w-72">
          <div className="fh-halo absolute -inset-6 rounded-full bg-[#F0A71F]/45 blur-2xl" aria-hidden="true" />
          <div className="fh-float relative">
            <img src="/bf/coin.webp" alt="Founding Member 2026, Veteran-Owned" width={640} height={640} className="relative w-full drop-shadow-[0_0_18px_rgba(240,167,31,0.85)]" />
            <div className="fh-sweep absolute inset-0" style={{ ["--m" as string]: "url(/bf/coin.webp)" }} aria-hidden="true" />
          </div>
        </div>
      </div>
    </section>
  );
}
