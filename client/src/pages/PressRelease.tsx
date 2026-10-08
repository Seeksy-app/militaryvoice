import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";

// /podcast-one-press-release (8 Oct 2026): the PodcastOne partnership on our own
// site (no share-price charts since 8 Oct: the page is about the partnership). The release text is LiveOne's: an admin
// pastes the copy they sent (Admin → Magazine); until then it's our summary and
// a link to the newswire. The magazine's news page QR lands here.

const NAVY = "#000741";
const GOLD = "#F0A71F";
const HEAD = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
export const RELEASE_URL = "https://www.tradingview.com/news/acceswire:04c71c9d0094b:0-liveone-nasdaq-lvo-subsidiary-podcastone-nasdaq-podc-launches-multi-year-distribution-content-and-marketing-partnership-with-national-military-podcast-day/";

export default function PressRelease() {
  const { data } = useQuery<{ body: string; podcastOne: string; liveOne: string }>({
    queryKey: ["/api/press/podcast-one"],
    queryFn: () => fetch("/api/press/podcast-one").then((r) => r.json()),
  });
  useEffect(() => { document.title = "PodcastOne and National Military Podcast Day · Press release"; }, []);
  const paras = (data?.body ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  return (
    <main className="min-h-screen bg-[#f5f7fb] text-slate-800">
      <header style={{ background: NAVY }} className="px-4 pb-10 pt-8 text-white sm:px-8">
        <div className="mx-auto max-w-4xl">
          <a href="/" className="text-[13px] font-semibold text-white/70 hover:text-white">MilitaryVoices.ai</a>
          <p className="mt-8 text-[12px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>Press release · October 5, 2026</p>
          <h1 className="mt-3 text-balance text-3xl font-bold leading-[1.08] tracking-tight sm:text-5xl" style={HEAD}>PodcastOne launches a multi-year partnership with National Military Podcast Day</h1>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-5 rounded-2xl border border-white/15 bg-white/[0.06] px-6 py-5">
            <img src="/nmpd-logo.png" alt="National Military Podcast Day" className="h-24 w-24 object-contain sm:h-32 sm:w-32" />
            {data?.podcastOne && <img src={data.podcastOne} alt="PodcastOne" className="h-16 w-auto object-contain sm:h-24" />}
            {data?.liveOne && <img src={data.liveOne} alt="LiveOne" className="h-9 w-auto object-contain sm:h-12" />}
            <div className="flex gap-2">
              {["NASDAQ: PODC", "NASDAQ: LVO"].map((t) => <span key={t} className="whitespace-nowrap rounded-full border border-white/30 px-3 py-1 text-[12px] font-bold tracking-[0.08em]" style={{ color: GOLD }}>{t}</span>)}
            </div>
          </div>
        </div>
      </header>

      <article className="mx-auto max-w-4xl px-4 py-10 sm:px-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
          {paras.length ? (
            <div className="space-y-5 text-[16.5px] leading-[1.7]">
              {paras.map((p, i) => {
                const heading = p.length < 90 && !/[.!?:"”)]$/.test(p);
                return heading
                  ? <h2 key={i} className="pt-3 text-xl font-bold text-balance" style={{ ...HEAD, color: NAVY }}>{p}</h2>
                  : <p key={i} className="whitespace-pre-line text-pretty">{p}</p>;
              })}
            </div>
          ) : (
            <div className="space-y-5 text-[16.5px] leading-[1.7]">
              <p className="text-pretty">LiveOne subsidiary PodcastOne has signed a multi-year distribution, content and marketing partnership with National Military Podcast Day, founded by Colonel Riccoh Player, USMC (Ret.). It launched with the Podcast Marathon on October 5: sixteen hours, reveille to end of duty, with a new show on air every thirty minutes.</p>
              <h2 className="pt-3 text-xl font-bold" style={{ ...HEAD, color: NAVY }}>What it means</h2>
              <ul className="space-y-3">
                <li className="flex gap-3"><span style={{ color: GOLD }}>■</span><span>PodcastOne streams the full Marathon live, then keeps it on demand all year.</span></li>
                <li className="flex gap-3"><span style={{ color: GOLD }}>■</span><span>The day is promoted across PodcastOne's shows, including #StillServing: The VFW Podcast, The MilSpouse Show!, The Hard to Kill Podcast and History On The Road.</span></li>
                <li className="flex gap-3"><span style={{ color: GOLD }}>■</span><span>Military voices reach a network of more than a billion monthly impressions on YouTube, Spotify, Apple Podcasts and iHeartRadio, with 3.9 billion downloads to date.</span></li>
              </ul>
              <blockquote className="border-l-4 pl-5" style={{ borderColor: GOLD }}>
                <p className="text-xl font-semibold italic" style={{ ...HEAD, color: NAVY }}>“We can't think of a greater good to put our platform toward.”</p>
                <footer className="mt-1 text-sm font-semibold text-slate-500">Kit Gray, President, PodcastOne</footer>
              </blockquote>
            </div>
          )}
          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-6">
            <p className="text-sm text-slate-500">Source: LiveOne, via ACCESS Newswire, October 5, 2026</p>
            <a href={RELEASE_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold text-white" style={{ background: NAVY }}>
              {paras.length ? "Read it on the newswire" : "Read the full release"} <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      </article>
    </main>
  );
}
