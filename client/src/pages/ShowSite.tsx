import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, FileText, Handshake, Loader2, Mic, Pause, Play, Rss, Search, X } from "lucide-react";
import NotFound from "@/pages/not-found";
import { PlatformIcon, platformLabel } from "@/components/SocialIcons";
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

// ---- Shared frame: top bar and footer -----------------------------------------------------
function Frame({ data, accent, children, home }: { data: { handle: string; name: string; artworkUrl: string; title: string; brandsOn: boolean }; accent: string; children: ReactNode; home: boolean }) {
  const base = `/${data.handle}/show`;
  const links: [string, string][] = [["episodes", "Episodes"], ["clips", "Clips"], ["about", "About"], ["guest", "Be a guest"], ...(data.brandsOn ? [["sponsors", "Sponsors"] as [string, string]] : [])];
  return (
    <div className="min-h-screen pb-24" style={{ background: PAGE, color: INK }}>
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
  const list = useMemo(() => {
    const f = find.trim().toLowerCase();
    return f ? d.episodes.filter((e) => `${e.title} ${e.summary}`.toLowerCase().includes(f)) : d.episodes;
  }, [find, d.episodes]);
  const listen: [string, string, ReactNode][] = [
    ...(show?.appleUrl ? [["Apple Podcasts", show.appleUrl, <Mic key="a" className="h-4 w-4" />] as [string, string, ReactNode]] : []),
    ...(show?.spotifyUrl ? [["Spotify", show.spotifyUrl, <PlatformIcon key="s" platform={"spotify" as SocialPlatform} className="h-4 w-4" />] as [string, string, ReactNode]] : []),
    ...(d.youtubeUrl ? [["YouTube", d.youtubeUrl, <PlatformIcon key="y" platform={"youtube" as SocialPlatform} className="h-4 w-4" />] as [string, string, ReactNode]] : []),
    ...(show?.feedUrl ? [["RSS", show.feedUrl, <Rss key="r" className="h-4 w-4" />] as [string, string, ReactNode]] : []),
  ];
  return (
    <Frame data={{ handle: d.handle, name: d.name, artworkUrl: art, title, brandsOn: d.brandsOn }} accent={accent} home>
      {/* The show */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ background: `radial-gradient(1200px 400px at 20% 0%, ${accent}, transparent)` }} />
        <div className="relative mx-auto grid max-w-5xl gap-8 px-4 pb-10 pt-8 sm:pt-12 md:grid-cols-[300px_1fr] md:items-center">
          {art && <img src={art} alt={title} className="mx-auto aspect-square w-56 rounded-3xl object-cover shadow-xl sm:w-72 md:w-full" />}
          <div className="min-w-0">
            {d.branch && <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: accent }}>{d.branch}</p>}
            <h1 className="mt-2 text-balance text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl" style={{ color: INK }}>{title}</h1>
            <p className="mt-2 text-sm font-semibold" style={{ color: SUB }}>Hosted by {d.name || show?.author}</p>
            {show?.description && <p className="mt-4 line-clamp-4 text-pretty text-[15px] leading-relaxed" style={{ color: SUB }}>{show.description}</p>}
            {listen.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {listen.map(([label, href, icon]) => (
                  <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold hover:bg-black/5" style={{ borderColor: LINE, color: INK }}>{icon}{label}</a>
                ))}
              </div>
            )}
          </div>
        </div>
        {latest && (
          <div className="relative mx-auto max-w-5xl px-4">
            <div className="flex items-center gap-4 rounded-2xl p-4 sm:p-5" style={{ background: SOFT }}>
              <PlayButton ep={latest} accent={accent} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: accent }}>Latest episode</p>
                <Link href={`/${d.handle}/show/${latest.slug}`} className="mt-0.5 line-clamp-2 text-balance text-lg font-bold leading-snug hover:underline" style={{ color: INK }}>{latest.title}</Link>
                <p className="mt-0.5 text-xs" style={{ color: SUB }}>{[dateOf(latest.publishedAt), mins(latest.durationSec)].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
          </div>
        )}
      </section>

      <main className="mx-auto max-w-5xl space-y-16 px-4 pt-12">
        {/* Episodes */}
        <section>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SectionTitle id="episodes" accent={accent}>Episodes</SectionTitle>
            {d.episodes.length > 8 && (
              <label className="flex w-full items-center gap-2 rounded-full border px-3 py-2 text-sm sm:w-64" style={{ borderColor: LINE }}>
                <Search className="h-4 w-4 shrink-0" style={{ color: SUB }} />
                <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={`Search ${d.episodes.length} episodes`} className="min-w-0 flex-1 bg-transparent outline-none" aria-label="Search episodes" />
                {find && <button type="button" onClick={() => setFind("")} aria-label="Clear"><X className="h-4 w-4" style={{ color: SUB }} /></button>}
              </label>
            )}
          </div>
          {d.episodes.length === 0 ? (
            <p className="mt-4 text-sm" style={{ color: SUB }}>Episodes will show here as soon as they're out.</p>
          ) : (
            <ul className="mt-5 divide-y" style={{ borderColor: LINE }}>
              {list.slice(0, shown).map((e) => (
                <li key={e.key} className="flex items-start gap-4 py-4" style={{ borderColor: LINE }}>
                  <PlayButton ep={e} accent={accent} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/${d.handle}/show/${e.slug}`} className="text-balance text-[16px] font-bold leading-snug hover:underline" style={{ color: INK }}>{e.title}</Link>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs" style={{ color: SUB }}>
                      {[e.episodeNumber ? `Ep ${e.episodeNumber}` : "", dateOf(e.publishedAt), mins(e.durationSec)].filter(Boolean).join(" · ")}
                      {e.hasTranscript && <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" /> Transcript</span>}
                    </p>
                    {e.summary && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed" style={{ color: SUB }}>{e.summary}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {list.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + 20)} className="mt-2 inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold hover:bg-black/5" style={{ borderColor: LINE }}>
              More episodes <ChevronDown className="h-4 w-4" />
            </button>
          )}
          {find && list.length === 0 && <p className="mt-4 text-sm" style={{ color: SUB }}>No episodes match "{find}".</p>}
        </section>

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
          {e.newer ? <Link href={`/${d.handle}/show/${e.newer.slug}`} className="rounded-2xl p-4 hover:bg-black/5" style={{ background: SOFT }}><span className="text-xs font-semibold" style={{ color: SUB }}>← Newer</span><span className="mt-1 line-clamp-2 block font-bold" style={{ color: INK }}>{e.newer.title}</span></Link> : <span />}
          {e.older && <Link href={`/${d.handle}/show/${e.older.slug}`} className="rounded-2xl p-4 text-right hover:bg-black/5" style={{ background: SOFT }}><span className="text-xs font-semibold" style={{ color: SUB }}>Older →</span><span className="mt-1 line-clamp-2 block font-bold" style={{ color: INK }}>{e.older.title}</span></Link>}
        </nav>

        <div className="mt-8 flex flex-col items-start gap-3 rounded-2xl p-6 sm:flex-row sm:items-center" style={{ background: SOFT }}>
          <p className="flex-1 text-pretty text-[15px]" style={{ color: SUB }}>Have a story the audience should hear?</p>
          <a href={`/${d.handle}/show#guest`} className="inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-bold" style={{ background: accent, color: onColor(accent) }}>Be a guest <ArrowRight className="h-4 w-4" /></a>
        </div>
      </main>
    </Frame>
  );
}
