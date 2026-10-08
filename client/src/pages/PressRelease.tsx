import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";

// /podcast-one-press-release (8 Oct 2026): the PodcastOne partnership on our own
// site, with live PODC and LVO charts. The release text is LiveOne's: an admin
// pastes the copy they sent (Admin → Magazine); until then it's our summary and
// a link to the newswire. The magazine's news page QR lands here.

const NAVY = "#000741";
const GOLD = "#F0A71F";
const HEAD = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
export const RELEASE_URL = "https://www.tradingview.com/news/acceswire:04c71c9d0094b:0-liveone-nasdaq-lvo-subsidiary-podcastone-nasdaq-podc-launches-multi-year-distribution-content-and-marketing-partnership-with-national-military-podcast-day/";

/** TradingView's mini chart for one symbol: price, change and a month's line. */
function Ticker({ symbol, name }: { symbol: string; name: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
    const s = document.createElement("script");
    s.src = "https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js";
    s.async = true;
    s.innerHTML = JSON.stringify({ symbol, width: "100%", height: "100%", locale: "en", dateRange: "1M", colorTheme: "light", isTransparent: true, autosize: true, chartOnly: false, noTimeScale: false });
    el.appendChild(s);
    return () => { el.innerHTML = ""; };
  }, [symbol]);
  return (
    <figure className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <figcaption className="px-1 text-[12px] font-bold uppercase tracking-[0.16em] text-slate-500">{name}</figcaption>
      <div ref={box} className="tradingview-widget-container mt-1 h-[200px]" />
    </figure>
  );
}

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
            <img src="/nmpd-logo.png" alt="National Military Podcast Day" className="h-16 w-16 object-contain sm:h-20 sm:w-20" />
            {data?.podcastOne && <img src={data.podcastOne} alt="PodcastOne" className="h-12 w-auto object-contain brightness-0 invert sm:h-14" />}
            {data?.liveOne && <img src={data.liveOne} alt="LiveOne" className="h-7 w-auto object-contain sm:h-8" />}
            <div className="flex gap-2">
              {["NASDAQ: PODC", "NASDAQ: LVO"].map((t) => <span key={t} className="rounded-full border border-white/30 px-3 py-1 text-[12px] font-bold tracking-[0.08em]" style={{ color: GOLD }}>{t}</span>)}
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto -mt-1 grid max-w-4xl gap-4 px-4 pt-8 sm:grid-cols-2 sm:px-8" aria-label="Share prices">
        <Ticker symbol="NASDAQ:PODC" name="PodcastOne · NASDAQ: PODC" />
        <Ticker symbol="NASDAQ:LVO" name="LiveOne · NASDAQ: LVO" />
      </section>

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
        <p className="mt-6 text-center text-[13px] text-slate-500">Share prices from TradingView, delayed. Not investment advice.</p>
      </article>
    </main>
  );
}
