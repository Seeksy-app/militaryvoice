import { Tv, Youtube, Headphones, Users, TrendingUp, ExternalLink } from "lucide-react";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const GOLD = "#F0A71F";

/**
 * Where podcasts are watched now — the market, not our lineup.
 *
 * The lineup's own numbers sit in the hero, where a sponsor reads them
 * first. This is the context those numbers live in: podcasts have moved to
 * the television, on YouTube, in numbers a media buyer will recognise. Every
 * figure links to where it was published; none of them is ours.
 */
const STATS = [
  {
    icon: TrendingUp,
    n: "+75%",
    label: "growth in podcast hours watched on TVs, in one year",
    note: "700M+ hours on living-room devices in Oct 2025, up from 400M",
    source: "YouTube, Dec 2025",
    href: "https://blog.youtube/news-and-events/podcasts-living-room-in-2025/",
  },
  {
    icon: Youtube,
    n: "1B+",
    label: "monthly podcast viewers on YouTube, worldwide",
    note: "a milestone YouTube reported in January 2025",
    source: "YouTube",
    href: "https://blog.youtube/news-and-events/1-billion-monthly-podcast-users/",
  },
  {
    icon: Tv,
    n: "1B+",
    label: "hours of YouTube watched on televisions every day",
    note: "TV overtook mobile for U.S. YouTube watch time",
    source: "YouTube, Feb 2025",
    href: "https://blog.youtube/inside-youtube/our-big-bets-for-2025/",
  },
  {
    icon: Headphones,
    n: "167M",
    label: "Americans 12+ who consume podcasts monthly — 58%",
    note: "130M weekly (45%), both records, listening and watching",
    source: "Edison Research / SSRS, 2026",
    href: "https://ssrs.com/insights/the-infinite-dial-2026/",
  },
  {
    icon: Users,
    n: "68%",
    label: "of Americans 35–54 consumed a podcast in the past month",
    note: "the audience is not only the young",
    source: "Edison Research / SSRS, 2026",
    href: "https://ssrs.com/insights/the-infinite-dial-2026/",
  },
] as const;

export function PodcastReach({ image = "/email/podcasters.jpg" }: { image?: string }) {
  return (
    <section className="relative overflow-hidden text-white" style={{ backgroundColor: "#000741" }} data-testid="section-podcast-reach">
      <div className="pointer-events-none absolute -left-32 top-1/2 h-[36rem] w-[36rem] -translate-y-1/2 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(240,167,31,0.18), transparent)" }} aria-hidden="true" />
      <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:py-24">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: GOLD }}>
            Where podcasts are watched now
          </div>
          <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-[1.15] tracking-tight sm:text-5xl" style={HEADLINE_FONT}>
            Podcasts moved to the <span style={{ color: GOLD }}>living-room television</span>. This one is built for it.
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/80">
            Sixteen hours of video podcasts, streamed live on YouTube and on our own site, with each show's host sending
            it to their own channel too. That is the medium the numbers below describe.
          </p>
          <div className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2">
            {STATS.map(({ icon: Icon, n, label, note, source, href }) => (
              <div key={label} className="border-l-2 pl-4" style={{ borderColor: "rgba(240,167,31,0.6)" }}>
                <Icon className="h-5 w-5" style={{ color: GOLD }} />
                <div className="mt-2 text-4xl font-bold tabular-nums tracking-tight sm:text-5xl" style={HEADLINE_FONT}>{n}</div>
                <div className="mt-1.5 text-sm leading-snug text-white/85">{label}</div>
                <div className="mt-1 text-xs text-white/50">{note}</div>
                <a href={href} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium hover:underline" style={{ color: GOLD }}>
                  {source} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ))}
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-md lg:max-w-none">
          <div className="absolute -inset-3 rotate-2 rounded-[2rem]" style={{ background: "rgba(240,167,31,0.75)" }} aria-hidden="true" />
          <img src={image} alt="A podcast being recorded on camera" loading="lazy" className="relative aspect-[4/5] w-full rounded-[1.75rem] object-cover shadow-2xl lg:aspect-[3/4]" />
          <div className="absolute -bottom-5 left-5 right-5 rounded-2xl border border-white/10 bg-[#04102b]/95 p-4 text-sm shadow-xl backdrop-blur sm:left-8 sm:right-auto sm:max-w-xs">
            <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: GOLD }}>The strongest single number</p>
            <p className="mt-1 text-white/90">Podcast viewing on TVs grew about 75% in a year. That is the trend this broadcast rides.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
