import { Youtube, Headphones, Users, TrendingUp, ExternalLink } from "lucide-react";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const GOLD = "#F0A71F";

/**
 * How strong podcasting is now — the market, not our lineup.
 *
 * The lineup's own numbers sit in the hero, where a sponsor reads them
 * first. This is a short band of context on the way to the pricing: four
 * figures, each linked to where it was published; none of them is ours.
 */
const STATS = [
  {
    icon: Headphones,
    n: "167M",
    label: "Americans listen or watch every month",
    source: "Edison Research, 2026",
    href: "https://ssrs.com/insights/the-infinite-dial-2026/",
  },
  {
    icon: Youtube,
    n: "1B+",
    label: "monthly podcast viewers on YouTube",
    source: "YouTube",
    href: "https://blog.youtube/news-and-events/1-billion-monthly-podcast-users/",
  },
  {
    icon: TrendingUp,
    n: "+75%",
    label: "more podcast hours watched on TVs, in one year",
    source: "YouTube, Dec 2025",
    href: "https://blog.youtube/news-and-events/podcasts-living-room-in-2025/",
  },
  {
    icon: Users,
    n: "68%",
    label: "of Americans 35–54 tuned in last month",
    source: "Edison Research, 2026",
    href: "https://ssrs.com/insights/the-infinite-dial-2026/",
  },
] as const;

export function PodcastReach({ image = "/email/podcasters.jpg" }: { image?: string }) {
  return (
    <section className="relative overflow-hidden text-white" style={{ backgroundColor: "#000741" }} data-testid="section-podcast-reach">
      <div className="pointer-events-none absolute -left-32 top-1/2 h-[28rem] w-[28rem] -translate-y-1/2 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(240,167,31,0.18), transparent)" }} aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:py-12">
        <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: GOLD }}>
              Podcasting today
            </div>
            <h2 className="mt-2 max-w-2xl text-2xl font-bold leading-[1.15] tracking-tight sm:text-4xl" style={HEADLINE_FONT}>
              Podcasting has moved to the <span style={{ color: GOLD }}>main stage</span>.
            </h2>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/80">
              More Americans listen and watch than ever, and this is sixteen hours of it, live.
            </p>
          </div>
          <div className="relative mx-auto w-40 shrink-0 sm:w-44 lg:mx-0">
            <div className="absolute -inset-2 rotate-2 rounded-[1.25rem]" style={{ background: "rgba(240,167,31,0.75)" }} aria-hidden="true" />
            <img src={image} alt="A podcast being recorded on camera" loading="lazy" className="relative aspect-square w-full rounded-[1rem] object-cover shadow-2xl" />
          </div>
        </div>
        <div className="mt-8 grid gap-x-6 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map(({ icon: Icon, n, label, source, href }) => (
            <div key={label} className="border-l-2 pl-4" style={{ borderColor: "rgba(240,167,31,0.6)" }}>
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4" style={{ color: GOLD }} />
                <div className="text-3xl font-bold tabular-nums tracking-tight sm:text-4xl" style={HEADLINE_FONT}>{n}</div>
              </div>
              <div className="mt-1 text-sm leading-snug text-white">{label}</div>
              <a href={href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium hover:underline" style={{ color: GOLD }}>
                {source} <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
