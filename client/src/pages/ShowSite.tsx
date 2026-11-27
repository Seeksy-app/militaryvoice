import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, FileText, Handshake, Loader2, Pause, Play, Rss, Search, X } from "lucide-react";
import NotFound from "@/pages/not-found";
import { PlatformIcon, platformLabel } from "@/components/SocialIcons";
import { BrandMark } from "@/components/BrandMark";
import { onColor, standOut } from "@shared/bio";
import type { SocialPlatform } from "@shared/schema";
import type { SiteEpisode, SiteEpisodeFull, SitePublic } from "@shared/site";

/**
 * The free podcast website (12 Oct 2026): militaryvoices.ai/<handle>/show, and a page for
 * every episode at /<handle>/show/<slug>. Their show, in their colour, built from their
 * SmartLink, their feed, their clips and their transcripts. One player follows them around.
 */

const PAGE = "#ffffff";
const INK = "#0b1020";
const SUB = "#5b6475";
const LINE = "rgba(11,16,32,0.10)";
const SOFT = "#f5f7fb";

const hms = (sec: number) => { const s = Math.max(0, Math.round(sec)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const mins = (sec: number) => (sec >= 60 ? `${Math.round(sec / 60)} min` : sec ? `${sec} sec` : "");
const dateOf = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""; };

/** Links in notes, clickable. */
function Linked({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g);
  return <>{parts.map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow" className="break-words underline underline-offset-2">{p}</a> : p))}</>;
}

// ---- One player for the whole site --------------------------------------------------------
// Kept outside React so it keeps playing as listeners move between the home page and episodes.
type Track = { slug: string; title: string; audio: string; artworkUrl: string };
type Snap = { track: Track | null; playing: boolean; at: number; dur: number };
type Player = Snap & { play: (t: Track, from?: number) => void; toggle: () => void; seek: (s: number) => void };
let snap: Snap = { track: null, playing: false, at: 0, dur: 0 };
const subs = new Set<() => void>();
let audio: HTMLAudioElement | null = null;
const emit = (next: Partial<Snap>) => { snap = { ...snap, ...next }; subs.forEach((f) => f()); };
function el(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = "metadata";
  a.addEventListener("play", () => emit({ playing: true }));
  a.addEventListener("pause", () => emit({ playing: false }));
  a.addEventListener("ended", () => emit({ playing: false }));
  a.addEventListener("timeupdate", () => emit({ at: a.currentTime }));
  a.addEventListener("loadedmetadata", () => emit({ dur: Number.isFinite(a.duration) ? a.duration : 0 }));
  audio = a;
  return a;
}
const actions = {
  play: (t: Track, from?: number) => {
    const a = el();
    if (snap.track?.audio !== t.audio) { a.src = t.audio; emit({ track: t, at: 0, dur: 0 }); }
    if (typeof from === "number") a.currentTime = from;
    void a.play().catch(() => {});
  },
  toggle: () => { const a = el(); if (!snap.track) return; if (a.paused) void a.play().catch(() => {}); else a.pause(); },
  seek: (s: number) => { el().currentTime = s; },
};
function usePlayer(): Player {
  const s = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => snap, () => snap);
  return { ...s, ...actions };
}
const PlayerProvider = ({ children }: { children: ReactNode }) => <>{children}</>;

function PlayerBar({ accent, handle }: { accent: string; handle: string }) {
  const p = usePlayer();
  if (!p.track) return null;
  const pct = p.dur ? (p.at / p.dur) * 100 : 0;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 backdrop-blur" style={{ borderColor: LINE }} data-testid="site-player">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
        {p.track.artworkUrl && <img src={p.track.artworkUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />}
        <button type="button" onClick={p.toggle} aria-label={p.playing ? "Pause" : "Play"} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: accent, color: onColor(accent) }}>
          {p.playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <Link href={`/${handle}/show/${p.track.slug}`} className="block truncate text-sm font-semibold" style={{ color: INK }}>{p.track.title}</Link>
          <div className="mt-1 flex items-center gap-2 text-[11px] tabular-nums" style={{ color: SUB }}>
            <span>{hms(p.at)}</span>
            <input type="range" min={0} max={p.dur || 0} step={1} value={p.at} onChange={(e) => p.seek(Number(e.target.value))} aria-label="Seek" className="h-1 flex-1 cursor-pointer" style={{ accentColor: accent, background: `linear-gradient(to right, ${accent} ${pct}%, ${LINE} ${pct}%)` }} />
            <span>{hms(p.dur)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayButton({ ep, accent, size = "md" }: { ep: SiteEpisode; accent: string; size?: "md" | "lg" }) {
  const p = usePlayer();
  const mine = p.track?.audio === ep.audio;
  const on = mine && p.playing;
  const big = size === "lg";
  return (
    <button
      type="button"
      onClick={() => (mine ? p.toggle() : p.play({ slug: ep.slug, title: ep.title, audio: ep.audio, artworkUrl: ep.artworkUrl }))}
      aria-label={on ? `Pause ${ep.title}` : `Play ${ep.title}`}
      className={`flex shrink-0 items-center justify-center rounded-full transition-transform hover:scale-105 ${big ? "h-14 w-14" : "h-11 w-11"}`}
      style={{ background: accent, color: onColor(accent) }}
      data-testid={`play-${ep.key}`}
    >
      {on ? <Pause className={big ? "h-6 w-6" : "h-4 w-4"} /> : <Play className={`${big ? "h-6 w-6" : "h-4 w-4"} ml-0.5`} />}
    </button>
  );
}

/** The play button on a navy episode row: quiet until it's the one playing, then gold. */
function NavyPlay({ ep }: { ep: SiteEpisode }) {
  const p = usePlayer();
  const mine = p.track?.audio === ep.audio;
  const on = mine && p.playing;
  return (
    <button
      type="button"
      onClick={() => (mine ? p.toggle() : p.play({ slug: ep.slug, title: ep.title, audio: ep.audio, artworkUrl: ep.artworkUrl }))}
      aria-label={on ? `Pause ${ep.title}` : `Play ${ep.title}`}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${mine ? "bg-[#F0A71F] text-[#1a1200]" : "bg-white/10 text-white hover:bg-[#F0A71F] hover:text-[#1a1200]"}`}
      data-testid={`play-${ep.key}`}
    >
      {on ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 translate-x-px fill-current" />}
    </button>
  );
}

// ---- Shared frame: top bar and footer -----------------------------------------------------
// Phone sweep (27 Nov): every link and button on the show site gets a 44px tap area without changing its look (as .tap-44).
const TAP44 = "[&_:is(button,a[href]):not(.absolute,.fixed,.sticky)]:relative [&_:is(button,a[href])]:before:absolute [&_:is(button,a[href])]:before:content-[''] [&_:is(button,a[href])]:before:[inset:min(0px,calc((100%_-_44px)/2))]";
function Frame({ data, accent, children, home }: { data: { handle: string; name: string; artworkUrl: string; title: string; brandsOn: boolean }; accent: string; children: ReactNode; home: boolean }) {
  const base = `/${data.handle}/show`;
  const links: [string, string][] = [["episodes", "Episodes"], ["clips", "Clips"], ["about", "About"], ["guest", "Be a guest"], ...(data.brandsOn ? [["sponsors", "Sponsors"] as [string, string]] : [])];
  return (
    <div className={`min-h-screen pb-24 ${TAP44}`} style={{ background: PAGE, color: INK }}>
      <header className="sticky top-0 z-30 border-b bg-white/90 backdrop-blur" style={{ borderColor: LINE }}>
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Link href={base} className="flex min-w-0 items-center gap-2.5">
            {data.artworkUrl && <img src={data.artworkUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />}
            <span className="truncate text-[15px] font-bold" style={{ color: INK }}>{data.title}</span>
          </Link>
          <nav className="ml-auto hidden items-center gap-1 text-sm font-semibold md:flex" aria-label="Site">
            {links.map(([id, label]) => (
              <a key={id} href={home ? `#${id}` : `${base}#${id}`} className="rounded-full px-3 py-1.5 hover:bg-black/5" style={{ color: SUB }}>{label}</a>
            ))}
          </nav>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 text-sm font-semibold md:hidden" aria-label="Site">
          {links.map(([id, label]) => (
            <a key={id} href={home ? `#${id}` : `${base}#${id}`} className="shrink-0 rounded-full px-3 py-1" style={{ color: SUB, background: SOFT }}>{label}</a>
          ))}
        </nav>
      </header>
      {children}
      <footer className="mx-auto mt-16 max-w-5xl border-t px-4 py-8 text-center text-sm" style={{ borderColor: LINE, color: SUB }}>
        <p>© {new Date().getFullYear()} {data.name || data.title}</p>
        <p className="mt-2">
          <a href="https://www.militaryvoices.ai/host" className="font-semibold underline-offset-2 hover:underline" style={{ color: standOut(accent, PAGE, false) }}>Free podcast website by MilitaryVoices.ai</a>
        </p>
      </footer>
      <PlayerBar accent={accent} handle={data.handle} />
    </div>
  );
}

function SectionTitle({ id, children, accent }: { id: string; children: ReactNode; accent: string }) {
  return (
    <div id={id} className="scroll-mt-28">
      <div className="mb-1 h-1 w-10 rounded-full" style={{ background: accent }} />
      <h2 className="text-balance text-2xl font-extrabold tracking-tight sm:text-3xl" style={{ color: INK }}>{children}</h2>
    </div>
  );
}

// ---- Home -----------------------------------------------------------------------------
export default function ShowSite({ handle }: { handle: string }) {
  const h = handle.toLowerCase();
  const q = useQuery<SitePublic | null>({
    queryKey: ["/api/public/site", h],
    queryFn: async () => { const r = await fetch(`/api/public/site/${encodeURIComponent(h)}`); return r.ok ? r.json() : null; },
    retry: false,
  });
  const d = q.data;
  useEffect(() => { if (d) document.title = `${d.show?.title || d.name} · Podcast`; }, [d?.handle]);
  if (q.isLoading) return <div className="flex min-h-screen items-center justify-center bg-white"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  if (!d) return <NotFound />;
  return <PlayerProvider><Home d={d} /></PlayerProvider>;
}

function Home({ d }: { d: SitePublic }) {
  const accent = standOut(d.color || "#053877", PAGE, false);
  const show = d.show;
  const title = show?.title || d.name;
  const art = show?.artworkUrl || d.avatarUrl;
  const latest = d.episodes[0];
  const [shown, setShown] = useState(12);
  const [find, setFind] = useState("");
  const [about, setAbout] = useState(false);
  const list = useMemo(() => {
    const f = find.trim().toLowerCase();
    return f ? d.episodes.filter((e) => `${e.title} ${e.summary}`.toLowerCase().includes(f)) : d.episodes;
  }, [find, d.episodes]);
  const listen: [string, string, ReactNode][] = [
    ...(show?.appleUrl ? [["Apple Podcasts", show.appleUrl, <BrandMark key="a" brand="apple-podcasts" className="h-4 w-4" />] as [string, string, ReactNode]] : []),
    ...(show?.spotifyUrl ? [["Spotify", show.spotifyUrl, <BrandMark key="s" brand="spotify" className="h-4 w-4" />] as [string, string, ReactNode]] : []),
    ...(d.youtubeUrl ? [["YouTube", d.youtubeUrl, <BrandMark key="y" brand="youtube" className="h-4 w-4" />] as [string, string, ReactNode]] : []),
    ...(show?.feedUrl ? [["RSS", show.feedUrl, <Rss key="r" className="h-4 w-4" />] as [string, string, ReactNode]] : []),
  ];
  const p = usePlayer();
  const latestOn = !!latest && p.track?.audio === latest.audio && p.playing;
  return (
    <Frame data={{ handle: d.handle, name: d.name, artworkUrl: art, title, brandsOn: d.brandsOn }} accent={accent} home>
      {/* 20 Nov 2026 (Andrew): the same navy Featured look as /podcast/<slug>. A smaller cover
          beside the title, a short description and a gold Play latest, then the episodes as navy rows. */}
      <div className="bg-[#04102b] pb-12 text-white">
        <div className="mx-auto max-w-5xl px-4 pt-6 sm:pt-8">
          <section className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-4 rounded-3xl bg-gradient-to-br from-[#0a2350] to-[#071a3d] p-5 ring-1 ring-white/10 sm:grid-cols-[240px_minmax(0,1fr)] sm:grid-rows-[auto_auto] sm:gap-x-8 sm:gap-y-0 sm:p-7" data-testid="site-hero">
            {art && <img src={art} alt={title} className="h-24 w-24 shrink-0 rounded-xl object-cover shadow-xl ring-1 ring-white/10 sm:row-span-2 sm:h-[240px] sm:w-[240px] sm:rounded-2xl" />}
            <div className={`min-w-0 sm:self-end ${art ? "" : "col-span-2"}`}>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#F0A71F]">{d.branch || "Podcast"}</p>
              <h1 className="mt-1.5 text-balance text-2xl font-bold leading-tight tracking-tight sm:text-4xl">{title}</h1>
              {(d.name || show?.author) && <p className="mt-1 text-[15px] text-white/75">Hosted by <span className="inline-block font-semibold text-white">{d.name || show?.author}</span></p>}
            </div>
            <div className="col-span-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:self-start">
              {show?.description && (
                <>
                  <p className={`max-w-2xl text-pretty text-[15px] leading-relaxed text-white/80 sm:mt-3 ${about ? "whitespace-pre-line" : "line-clamp-3"}`}>{about ? show.description : show.description.replace(/\s*\n+\s*/g, " ")}</p>
                  {show.description.length > 220 && <button type="button" onClick={() => setAbout((v) => !v)} className="mt-1 text-sm font-semibold text-[#F0A71F] hover:underline">{about ? "Less" : "More about the show"}</button>}
                </>
              )}
              <div className="mt-5 flex flex-wrap items-center gap-2.5">
                {latest && (
                  <button type="button" onClick={() => (p.track?.audio === latest.audio ? p.toggle() : p.play({ slug: latest.slug, title: latest.title, audio: latest.audio, artworkUrl: latest.artworkUrl }))} className="inline-flex h-11 items-center gap-2 rounded-full bg-[#F0A71F] pl-2 pr-5 text-sm font-bold text-[#1a1200] shadow-lg shadow-black/20 hover:bg-[#f5b840]" data-testid="site-play-latest">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1a1200]/10">{latestOn ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 translate-x-px fill-current" />}</span>
                    {latestOn ? "Pause" : "Play latest"}
                  </button>
                )}
                {listen.map(([label, href, icon]) => (
                  <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-semibold text-white hover:bg-white/15">{icon}{label}</a>
                ))}
              </div>
            </div>
          </section>

          {/* Episodes */}
          <section className="mt-10">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div id="episodes" className="scroll-mt-28">
                <div className="mb-1 h-1 w-10 rounded-full bg-[#F0A71F]" />
                <h2 className="text-balance text-2xl font-extrabold tracking-tight sm:text-3xl">Episodes</h2>
              </div>
              {d.episodes.length > 8 && (
                <label className="flex w-full items-center gap-2 rounded-full bg-white/[0.07] px-3 py-2 text-sm ring-1 ring-white/15 sm:w-64">
                  <Search className="h-4 w-4 shrink-0 text-white/60" />
                  <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={`Search ${d.episodes.length} episodes`} className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-white/50" aria-label="Search episodes" />
                  {find && <button type="button" onClick={() => setFind("")} aria-label="Clear"><X className="h-4 w-4 text-white/60" /></button>}
                </label>
              )}
            </div>
            {d.episodes.length === 0 ? (
              <p className="mt-4 text-sm text-white/70">Episodes will show here as soon as they're out.</p>
            ) : (
              <ul className="mt-5 space-y-2.5">
                {list.slice(0, shown).map((e) => {
                  const on = p.track?.audio === e.audio;
                  return (
                    <li key={e.key} className={`rounded-2xl p-4 ring-1 transition-colors ${on ? "bg-white/[0.09] ring-[#F0A71F]/50" : "bg-white/[0.05] ring-white/10 hover:bg-white/[0.07]"}`}>
                      <div className="flex items-start gap-3.5">
                        {(e.artworkUrl || art) && <img src={e.artworkUrl || art} alt="" loading="lazy" className="hidden h-16 w-16 shrink-0 rounded-xl object-cover sm:block" />}
                        <div className="min-w-0 flex-1">
                          <Link href={`/${d.handle}/show/${e.slug}`} className="text-balance font-semibold leading-snug text-white hover:underline">{e.title}</Link>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-white/60">
                            {[e.episodeNumber ? `Ep ${e.episodeNumber}` : "", dateOf(e.publishedAt), mins(e.durationSec)].filter(Boolean).join(" · ")}
                            {e.hasTranscript && <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" /> Transcript</span>}
                          </p>
                          {e.summary && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-white/75">{e.summary}</p>}
                        </div>
                        <NavyPlay ep={e} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {list.length > shown && (
              <button type="button" onClick={() => setShown((n) => n + 20)} className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/25 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10">
                More episodes <ChevronDown className="h-4 w-4" />
              </button>
            )}
            {find && list.length === 0 && <p className="mt-4 text-sm text-white/70">No episodes match "{find}".</p>}
          </section>
        </div>
      </div>

      <main className="mx-auto max-w-5xl space-y-16 px-4 pt-12">

        {/* Clips */}
        {d.clips.length > 0 && (
          <section>
            <SectionTitle id="clips" accent={accent}>Clips</SectionTitle>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {d.clips.slice(0, 8).map((c) => <Clip key={c.id} c={c} />)}
            </div>
          </section>
        )}

        {/* The host */}
        <section>
          <SectionTitle id="about" accent={accent}>About the host</SectionTitle>
          <div className="mt-5 grid gap-6 sm:grid-cols-[160px_1fr] sm:items-start">
            {d.avatarUrl && <img src={d.avatarUrl} alt={d.name} className="h-40 w-40 rounded-3xl object-cover" />}
            <div className="min-w-0">
              <h3 className="text-xl font-bold" style={{ color: INK }}>{d.name}</h3>
              {d.bio && <p className="mt-2 whitespace-pre-line text-pretty text-[15px] leading-relaxed" style={{ color: SUB }}>{d.bio}</p>}
              {d.socials.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {d.socials.map((s) => (
                    <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" aria-label={platformLabel(s.platform as SocialPlatform)} title={platformLabel(s.platform as SocialPlatform)} className="flex h-10 w-10 items-center justify-center rounded-full border hover:bg-black/5" style={{ borderColor: LINE, color: INK }}>
                      <PlatformIcon platform={s.platform as SocialPlatform} className="h-4 w-4" />
                    </a>
                  ))}
                </div>
              )}
              <a href={`/${d.handle}`} className="mt-4 inline-block text-sm font-semibold underline-offset-2 hover:underline" style={{ color: accent }}>All my links →</a>
            </div>
          </div>
        </section>

        {/* Be a guest */}
        <section>
          <SectionTitle id="guest" accent={accent}>Be a guest</SectionTitle>
          <p className="mt-2 max-w-2xl text-pretty text-[15px]" style={{ color: SUB }}>Have a story this audience should hear? Tell us a little about you and what you'd talk about, and you'll hear back by email.</p>
          <GuestForm handle={d.handle} accent={accent} />
        </section>

        {/* Sponsors */}
        {d.brandsOn && (
          <section>
            <SectionTitle id="sponsors" accent={accent}>Sponsor the show</SectionTitle>
            <div className="mt-5 flex flex-col gap-4 rounded-2xl p-6 sm:flex-row sm:items-center" style={{ background: SOFT }}>
              <Handshake className="h-8 w-8 shrink-0" style={{ color: accent }} />
              <p className="flex-1 text-pretty text-[15px]" style={{ color: SUB }}>Reach the military and veteran community through a voice they trust. See the audience, the numbers and the ways to work together.</p>
              <a href={`/${d.handle}/brands`} className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-bold" style={{ background: accent, color: onColor(accent) }}>See the media kit <ArrowRight className="h-4 w-4" /></a>
            </div>
          </section>
        )}
      </main>
    </Frame>
  );
}

function Clip({ c }: { c: SitePublic["clips"][number] }) {
  const v = useRef<HTMLVideoElement | null>(null);
  const [on, setOn] = useState(false);
  const src = c.verticalUrl || c.squareUrl || c.url;
  const tall = Boolean(c.verticalUrl);
  return (
    <figure className="group relative overflow-hidden rounded-2xl bg-black">
      <video
        ref={v}
        src={`${src}#t=3`}
        className={`w-full object-cover ${tall ? "aspect-[9/16]" : "aspect-square"}`}
        preload="metadata"
        playsInline
        controls={on}
        onClick={() => { const el = v.current; if (!el) return; if (!on) { setOn(true); el.muted = false; void el.play().catch(() => {}); } }}
      />
      {!on && (
        <button type="button" onClick={() => { const el = v.current; if (!el) return; setOn(true); el.muted = false; void el.play().catch(() => {}); }} className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors hover:bg-black/0" aria-label={`Play clip: ${c.title}`}>
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg transition-transform group-hover:scale-110"><Play className="ml-0.5 h-5 w-5" /></span>
        </button>
      )}
    </figure>
  );
}

function GuestForm({ handle, accent }: { handle: string; accent: string }) {
  const [f, setF] = useState({ name: "", email: "", topic: "", about: "", links: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const field = "w-full rounded-xl border bg-white px-3.5 py-3 text-[15px] outline-none focus:ring-2";
  if (done) return <p className="mt-5 flex items-center gap-2 rounded-2xl p-5 text-[15px] font-semibold" style={{ background: SOFT, color: INK }}><CheckCircle2 className="h-5 w-5" style={{ color: accent }} /> Thanks! Your note is on its way, and you'll hear back by email.</p>;
  return (
    <form
      className="mt-5 grid max-w-2xl gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setErr("");
        try {
          const r = await fetch(`/api/public/site/${encodeURIComponent(handle)}/guest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
          if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { message?: string }).message || "That didn't send. Try again.");
          setDone(true);
        } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
      }}
      data-testid="guest-form"
    >
      <input required value={f.name} onChange={set("name")} placeholder="Your name" autoComplete="name" className={field} style={{ borderColor: LINE }} />
      <input required type="email" value={f.email} onChange={set("email")} placeholder="Email" autoComplete="email" inputMode="email" className={field} style={{ borderColor: LINE }} />
      <input required value={f.topic} onChange={set("topic")} placeholder="What would you talk about?" className={`${field} sm:col-span-2`} style={{ borderColor: LINE }} />
      <textarea value={f.about} onChange={set("about")} placeholder="A little about you (your service, your story)" rows={4} className={`${field} sm:col-span-2`} style={{ borderColor: LINE }} />
      <input value={f.links} onChange={set("links")} placeholder="Links (website, LinkedIn, past interviews)" className={`${field} sm:col-span-2`} style={{ borderColor: LINE }} />
      <input value={f.website} onChange={set("website")} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
      {err && <p className="text-sm font-semibold text-red-700 sm:col-span-2">{err}</p>}
      <button type="submit" disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-[15px] font-bold disabled:opacity-60 sm:col-span-2 sm:w-fit" style={{ background: accent, color: onColor(accent) }}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Send my pitch
      </button>
    </form>
  );
}

// ---- One episode ------------------------------------------------------------------------
export function ShowEpisode({ handle, slug }: { handle: string; slug: string }) {
  const h = handle.toLowerCase();
  const site = useQuery<SitePublic | null>({
    queryKey: ["/api/public/site", h],
    queryFn: async () => { const r = await fetch(`/api/public/site/${encodeURIComponent(h)}`); return r.ok ? r.json() : null; },
    retry: false,
  });
  const q = useQuery<SiteEpisodeFull | null>({
    queryKey: ["/api/public/site", h, "episode", slug],
    queryFn: async () => { const r = await fetch(`/api/public/site/${encodeURIComponent(h)}/episode/${encodeURIComponent(slug)}`); return r.ok ? r.json() : null; },
    retry: false,
  });
  useEffect(() => { if (q.data) document.title = `${q.data.title} · ${q.data.show?.title || q.data.name}`; }, [q.data?.key]);
  useEffect(() => { window.scrollTo(0, 0); }, [slug]);
  if (q.isLoading || site.isLoading) return <div className="flex min-h-screen items-center justify-center bg-white"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  if (!q.data || !site.data) return <NotFound />;
  return <PlayerProvider><Episode e={q.data} d={site.data} /></PlayerProvider>;
}

function Episode({ e, d }: { e: SiteEpisodeFull; d: SitePublic }) {
  const accent = standOut(d.color || "#053877", PAGE, false);
  const p = usePlayer();
  const title = d.show?.title || d.name;
  const art = d.show?.artworkUrl || d.avatarUrl;
  const [full, setFull] = useState(false);
  const mine = p.track?.audio === e.audio;
  const lines = e.transcript ?? [];
  const jump = (s: number) => p.play({ slug: e.slug, title: e.title, audio: e.audio, artworkUrl: e.artworkUrl }, s);
  return (
    <Frame data={{ handle: d.handle, name: d.name, artworkUrl: art, title, brandsOn: d.brandsOn }} accent={accent} home={false}>
      <main className="mx-auto max-w-3xl px-4 pt-8">
        <Link href={`/${d.handle}/show#episodes`} className="inline-flex items-center gap-1.5 text-sm font-semibold hover:underline" style={{ color: SUB }}><ArrowLeft className="h-4 w-4" /> All episodes</Link>
        <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-start">
          {e.artworkUrl && <img src={e.artworkUrl} alt="" className="h-36 w-36 shrink-0 rounded-2xl object-cover shadow-md" />}
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: accent }}>{[e.season ? `Season ${e.season}` : "", e.episodeNumber ? `Episode ${e.episodeNumber}` : ""].filter(Boolean).join(" · ") || title}</p>
            <h1 className="mt-1.5 text-balance text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl" style={{ color: INK }}>{e.title}</h1>
            <p className="mt-2 text-sm" style={{ color: SUB }}>{[dateOf(e.publishedAt), mins(e.durationSec)].filter(Boolean).join(" · ")}</p>
            <div className="mt-4 flex items-center gap-3">
              <PlayButton ep={e} accent={accent} size="lg" />
              <span className="text-sm font-semibold" style={{ color: INK }}>{mine && p.playing ? "Playing" : mine ? "Paused" : "Play episode"}</span>
            </div>
          </div>
        </div>

        {e.notes && (
          <section className="mt-10">
            <h2 className="text-lg font-bold" style={{ color: INK }}>Show notes</h2>
            <div className="mt-3 whitespace-pre-line text-pretty text-[15px] leading-relaxed" style={{ color: SUB }}><Linked text={e.notes} /></div>
          </section>
        )}

        {lines.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-bold" style={{ color: INK }}>Transcript</h2>
            <p className="mt-1 text-xs" style={{ color: SUB }}>Tap a time to listen from there. Made automatically, so a few words may be off.</p>
            <ol className="relative mt-4 space-y-3">
              {(full ? lines : lines.slice(0, 18)).map((l, i) => (
                <li key={i} className="grid grid-cols-[52px_1fr] gap-3 text-[15px] leading-relaxed">
                  <button type="button" onClick={() => jump(l.at)} className="h-fit rounded-md px-1.5 py-0.5 text-left text-xs font-semibold tabular-nums hover:bg-black/5" style={{ color: accent }}>{hms(l.at)}</button>
                  <p style={{ color: INK }}>{l.who && <span className="mr-1.5 font-semibold" style={{ color: SUB }}>{l.who}:</span>}{l.text}</p>
                </li>
              ))}
            </ol>
            {lines.length > 18 && !full && (
              <button type="button" onClick={() => setFull(true)} className="mt-4 inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold hover:bg-black/5" style={{ borderColor: LINE }}>Read the whole transcript <ChevronDown className="h-4 w-4" /></button>
            )}
          </section>
        )}

        <nav className="mt-12 grid gap-3 border-t pt-6 sm:grid-cols-2" style={{ borderColor: LINE }} aria-label="More episodes">
          {e.newer ? <Link href={`/${d.handle}/show/${e.newer.slug}`} className="rounded-2xl p-4 hover:bg-black/5" style={{ background: SOFT }}><span className="text-xs font-semibold" style={{ color: SUB }}>← Newer</span><span className="mt-1 line-clamp-2 block text-balance font-bold" style={{ color: INK }}>{e.newer.title}</span></Link> : <span />}
          {e.older && <Link href={`/${d.handle}/show/${e.older.slug}`} className="rounded-2xl p-4 text-right hover:bg-black/5" style={{ background: SOFT }}><span className="text-xs font-semibold" style={{ color: SUB }}>Older →</span><span className="mt-1 line-clamp-2 block text-balance font-bold" style={{ color: INK }}>{e.older.title}</span></Link>}
        </nav>

        <div className="mt-8 flex flex-col items-start gap-3 rounded-2xl p-6 sm:flex-row sm:items-center" style={{ background: SOFT }}>
          <p className="flex-1 text-pretty text-[15px]" style={{ color: SUB }}>Have a story the audience should hear?</p>
          <a href={`/${d.handle}/show#guest`} className="inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-bold" style={{ background: accent, color: onColor(accent) }}>Be a guest <ArrowRight className="h-4 w-4" /></a>
        </div>
      </main>
    </Frame>
  );
}
