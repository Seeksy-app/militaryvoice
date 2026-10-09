import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { ExternalLink, Loader2, Pause, Play, Printer } from "lucide-react";

// The keepsake magazine. Every page is drawn at US Letter, 816 × 1056 CSS
// pixels (8.5 × 11 inches at 96 dpi), so printing it to PDF is the print file
// as it is. On screen the pages are scaled down to fit. ?print=1 opens the
// print dialog as soon as the pictures have loaded.

type Show = {
  signupId: number; number: number; time: string; podcastName: string; hostName: string; branch: string; service: string;
  headshot: string; printQuality: boolean; art: string; blurb: string; quote: string; onTheDay?: string; link: string; about?: string; aboutOwn?: string; audio?: string; episodes?: Episode[]; links?: { title: string; url: string }[]; clip?: { start: number; dur: number } | null;
};
type Episode = { title: string; date: string; audioUrl: string };
type Mag = {
  event: { id?: number; name: string; day: string; occasion: string; tagline: string };
  published: boolean; admin?: boolean; welcome: string;
  host: { name: string; title: string; photo: string };
  shows: Show[]; sponsors: { name: string; logo: string; url: string; tier?: string }[];
  /** A podcaster's private review of their own page: only that page comes back. */
  review?: number;
  /** The whole draft, by its private link, for the host's suggestions. */
  reviewAll?: boolean;
  cover?: { photo: string; style?: string; locked?: boolean };
  ads?: Ad[];
  award?: { signupId: number; title: string; name: string; show: string; citation: string; quote: string; photo: string; plaque: string } | null;
};
type Ad = { id: number; name: string; headline: string; body: string; site: string; link: string; logo: string; artwork: string; after?: number };

const NAVY = "#000741";
const GOLD = "#F0A71F";
const HEAD = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const W = 816;
const H = 1056;

function Page({ children, bg = "#fff", color = "#0b1a3a", n }: { children: ReactNode; bg?: string; color?: string; n?: number }) {
  return (
    <section className="mag-page relative overflow-hidden" style={{ width: W, height: H, background: bg, color }}>
      {children}
      {!!n && <span className="absolute bottom-5 right-8 text-[11px] font-semibold tabular-nums opacity-60">{n}</span>}
    </section>
  );
}

/** Which magazine and which page we're on, so a QR can be counted (9 Oct). */
const Where = createContext<{ e: number; p: string }>({ e: 0, p: "" });
const SITE = "https://www.militaryvoices.ai";

function Qr({ url, size = 96 }: { url: string; size?: number }) {
  const at = useContext(Where);
  // Every QR goes through our counter first (/go/m), then on to where it always went.
  const go = at.e && at.p ? `${SITE}/go/m?e=${at.e}&p=${encodeURIComponent(at.p)}&u=${encodeURIComponent(url)}` : url;
  const [src, setSrc] = useState("");
  useEffect(() => { void QRCode.toDataURL(go, { margin: 1, width: size * 3, color: { dark: NAVY, light: "#ffffff" } }).then(setSrc).catch(() => {}); }, [go, size]);
  return src ? <img src={src} alt="QR code" data-qr="1" data-href={go} style={{ width: size, height: size }} /> : <span style={{ width: size, height: size }} className="block bg-slate-100" />;
}

/** A full-page ad: their own artwork edge to edge, or one we set from their logo, words and a QR. */
function AdPage({ ad, n }: { ad: Ad; n: number }) {
  // A page-shaped ad fills the page; anything else (a half-page ad, 8 Oct) sits whole, centred on navy,
  // until the full-page version arrives.
  const [shape, setShape] = useState<"page" | "other">("page");
  if (ad.artwork) {
    return (
      <Page n={n} bg={shape === "page" ? "#fff" : "#06163a"}>
        <img
          src={ad.artwork}
          alt={ad.name}
          onLoad={(e) => { const r = e.currentTarget.naturalWidth / Math.max(1, e.currentTarget.naturalHeight); setShape(Math.abs(r - W / H) < 0.04 ? "page" : "other"); }}
          className={shape === "page" ? "absolute inset-0 h-full w-full object-cover" : "absolute inset-x-0 top-1/2 w-full -translate-y-1/2 object-contain"}
        />
      </Page>
    );
  }
  return (
    <Page bg={NAVY} color="#fff" n={n}>
      <div className="absolute inset-0 flex flex-col items-center px-16 pb-16 pt-24 text-center">
        <p className="text-[12px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>{/militaryvoices/i.test(ad.name) ? "From MilitaryVoices.ai" : "A word from our sponsor"}</p>
        <div className="mt-14 flex h-40 w-full items-center justify-center">
          {ad.logo ? <img src={ad.logo} alt={ad.name} className="h-full w-auto max-w-[520px] object-contain" /> : <span className="text-[44px] font-bold" style={HEAD}>{ad.name}</span>}
        </div>
        {ad.headline && <h2 className="mt-14 text-balance text-[48px] font-bold leading-[1.05] tracking-tight" style={HEAD}>{ad.headline}</h2>}
        {ad.body && <p className="mt-6 max-w-[560px] text-pretty text-[19px] leading-[1.55] text-white/80">{ad.body}</p>}
        {ad.link && (
          <div className="mt-auto flex flex-col items-center gap-4">
            <div className="rounded-2xl bg-white p-3"><Qr url={ad.link} size={132} /></div>
            <p className="text-[18px] font-semibold" style={{ color: GOLD }}>{(ad.site || ad.link).replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</p>
          </div>
        )}
      </div>
    </Page>
  );
}

export type Face = { id: number; src: string };
export type CoverStyle = "glass" | "medallion" | "prints" | "letters";

/** A highlight across a picture, as light catches a gloss-coated print. */
const SHEEN = "linear-gradient(135deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.14) 32%, rgba(255,255,255,0) 46%)";

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
/** The same faces over and over, in an order where a face never sits beside itself, and every face comes once before any comes twice. */
const cycle = (faces: Face[], n: number) => {
  let step = 7;
  while (faces.length > 1 && gcd(step, faces.length) !== 1) step++;
  return Array.from({ length: n }, (_, i) => faces[(i * step) % faces.length]);
};
/** Repeatable "random": the same scatter every time the page is drawn. */
const rnd = (i: number, k: number) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };

/**
 * The faces inside the cover's word. Online they take turns: every so often one tile fades to
 * someone else, so the word keeps moving through everyone. Still in print, and for anyone who
 * has asked their device for less motion.
 */
function WordTiles({ faces, tiles, cols, x0, y0, w, h }: { faces: Face[]; tiles: Face[]; cols: number; x0: number; y0: number; w: number; h: number }) {
  const [shown, setShown] = useState(() => tiles.map((f) => ({ cur: f, prev: null as Face | null, n: 0 })));
  useEffect(() => setShown(tiles.map((f) => ({ cur: f, prev: null, n: 0 }))), [tiles.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const still = new URLSearchParams(window.location.search).has("print") || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (still || faces.length < 2) return;
    let k = 0;
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      k++;
      setShown((prev) => {
        const i = Math.floor(rnd(k, 5) * prev.length);
        const onScreen = new Set(prev.map((x) => x.cur.id));
        // Prefer someone not in the word right now; anyone but the face already there, otherwise.
        const pool = faces.filter((f) => !onScreen.has(f.id));
        const choices = pool.length ? pool : faces.filter((f) => f.id !== prev[i].cur.id);
        const next = choices[Math.floor(rnd(k, 6) * choices.length)];
        return prev.map((x, j) => (j === i ? { cur: next, prev: x.cur, n: x.n + 1 } : x));
      });
    }, 1100);
    return () => window.clearInterval(t);
  }, [faces]);
  return (
    <>
      {shown.map((t, i) => {
        const x = x0 + (i % cols) * w, y = y0 + Math.floor(i / cols) * h;
        return (
          <g key={`w-${i}`}>
            {t.prev && <image href={t.prev.src} x={x} y={y} width={w} height={h} preserveAspectRatio="xMidYMid slice" />}
            <image key={t.n} className={t.n ? "mag-fade-in" : undefined} href={t.cur.src} x={x} y={y} width={w} height={h} preserveAspectRatio="xMidYMid slice" />
          </g>
        );
      })}
    </>
  );
}

/**
 * The cover as a collage of everyone on the day, three ways, each made to look glossy:
 * "glass" a tilted wall of gloss tiles, "medallion" the day's badge ringed by every face as
 * glass buttons, "prints" a scatter of glossy photo prints.
 */
export function CoverCollage({ faces, style }: { faces: Face[]; style: CoverStyle }) {
  if (!faces.length) return null;
  if (style === "letters") {
    // One giant word cut out of everyone's photos, black and white, a gold script across it.
    // Everyone in the word: enough tiles that each face appears at least once (cycle() walks them all first).
    const rows = 3, cols = Math.ceil(faces.length / rows), x0 = 30, y0 = 262, w = 756 / cols, h = 340 / rows;
    const tiles = cycle(faces, cols * rows);
    // And everyone in the crowd behind it, so nobody is lost in the gap between two letters.
    const crowdCols = 8, crowdRows = Math.ceil(faces.length / crowdCols);
    return (
      <svg className="absolute inset-0" viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
        <defs>
          <clipPath id="mag-word"><text x={W / 2} y={588} textAnchor="middle" fontFamily="Anton, Impact, sans-serif" fontSize={345} textLength={756} lengthAdjust="spacingAndGlyphs">VOICES</text></clipPath>
          <filter id="mag-bw"><feColorMatrix type="saturate" values="0" /><feComponentTransfer><feFuncR type="linear" slope="1.12" intercept="-0.04" /><feFuncG type="linear" slope="1.12" intercept="-0.04" /><feFuncB type="linear" slope="1.12" intercept="-0.04" /></feComponentTransfer></filter>
          <linearGradient id="mag-band" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c9cfdc" /><stop offset="1" stopColor="#eef1f6" /></linearGradient>
          <linearGradient id="mag-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#fff" stopOpacity="1" /></linearGradient>
        </defs>
        <rect width={W} height={H} fill="#ffffff" />
        {/* The crowd, faint, behind the word. */}
        <g opacity={0.2} filter="url(#mag-bw)">
          {cycle(faces, crowdCols * crowdRows).map((f, i) => <image key={`bg-${i}`} href={f.src} x={(i % crowdCols) * (W / crowdCols)} y={Math.floor(i / crowdCols) * 130} width={W / crowdCols} height={130} preserveAspectRatio="xMidYMid slice" />)}
        </g>
        <rect y={330} width={W} height={300} fill="url(#mag-band)" opacity={0.55} />
        <rect y={250} width={W} height={150} fill="url(#mag-fade)" opacity={0.35} />
        <g clipPath="url(#mag-word)" filter="url(#mag-bw)">
          <WordTiles faces={faces} tiles={tiles} cols={cols} x0={x0} y0={y0} w={w} h={h} />
        </g>
        <text x={W / 2} y={232} textAnchor="middle" fontFamily="'General Sans', Inter, sans-serif" fontWeight={500} fontSize={44} letterSpacing={3} fill="#0b0b12">THE PODCAST MARATHON</text>
        <text x={W / 2 + 40} y={690} textAnchor="middle" fontFamily="Yellowtail, cursive" fontSize={132} fill={GOLD} transform={`rotate(-5 ${W / 2} 690)`}>of the Military</text>
      </svg>
    );
  }
  if (style === "medallion") {
    const cx = 408, cy = 338;
    const inner = faces.slice(0, Math.min(11, faces.length));
    const outer = faces.slice(inner.length);
    const ring = (list: Face[], r: number, size: number, turn: number) => list.map((f, i) => {
      const a = (i / list.length) * Math.PI * 2 + turn;
      return (
        <div key={`${r}-${f.id}-${i}`} className="absolute rounded-full" style={{ left: cx + r * Math.cos(a) - size / 2, top: cy + r * Math.sin(a) - size / 2, width: size, height: size, padding: 3, background: `linear-gradient(145deg, #fff3c4, ${GOLD} 45%, #8a5a00)`, boxShadow: "0 10px 22px rgba(0,0,0,0.55)" }}>
          <div className="relative h-full w-full overflow-hidden rounded-full">
            <img src={f.src} alt="" className="h-full w-full object-cover" style={{ objectPosition: "50% 25%" }} />
            <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 32% 24%, rgba(255,255,255,0.7), rgba(255,255,255,0.12) 30%, rgba(255,255,255,0) 48%)", boxShadow: "inset 0 -10px 18px rgba(0,0,0,0.45)" }} />
          </div>
        </div>
      );
    });
    return (
      <div className="absolute inset-x-0 top-0" style={{ height: 720, background: `radial-gradient(circle at 50% 33%, rgba(240,167,31,0.28), rgba(0,7,65,0) 55%)` }}>
        {ring(outer, 282, 82, Math.PI / 20)}
        {ring(inner, 172, 98, 0)}
        <div className="absolute rounded-full" style={{ left: cx - 80, top: cy - 80, width: 160, height: 160, padding: 4, background: `linear-gradient(145deg, #fff3c4, ${GOLD} 45%, #8a5a00)`, boxShadow: "0 0 50px rgba(240,167,31,0.55)" }}>
          <div className="relative h-full w-full overflow-hidden rounded-full bg-white">
            <img src="/nmpd-logo.jpg" alt="" className="h-full w-full object-contain" />
            <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 32% 22%, rgba(255,255,255,0.75), rgba(255,255,255,0) 40%)" }} />
          </div>
        </div>
      </div>
    );
  }
  if (style === "prints") {
    const cols = 6, rows = 5, w = 150, h = 176;
    const tiles = cycle(faces, Math.max(faces.length, cols * rows)).slice(0, Math.max(faces.length, cols * rows));
    return (
      <div className="absolute inset-x-0 top-0 overflow-hidden" style={{ height: 760 }}>
        {tiles.map((f, i) => {
          const c = i % cols, r = Math.floor(i / cols) % rows, layer = Math.floor(i / (cols * rows));
          const x = -30 + c * 140 + (rnd(i, 1) - 0.5) * 40 + layer * 70;
          const y = -20 + r * 132 + (rnd(i, 2) - 0.5) * 36 + layer * 60;
          return (
            <div key={`${f.id}-${i}`} className="absolute bg-white" style={{ left: x, top: y, width: w, height: h, padding: "8px 8px 26px", transform: `rotate(${(rnd(i, 3) - 0.5) * 18}deg)`, boxShadow: "0 14px 26px rgba(0,0,0,0.55), 0 2px 4px rgba(0,0,0,0.35)", zIndex: Math.round(rnd(i, 4) * 100) }}>
              <div className="relative h-full w-full overflow-hidden">
                <img src={f.src} alt="" className="h-full w-full object-cover" style={{ objectPosition: "50% 25%" }} />
                <div className="absolute inset-0" style={{ background: SHEEN }} />
              </div>
            </div>
          );
        })}
        <div className="absolute inset-x-0 bottom-0" style={{ height: 340, background: `linear-gradient(to bottom, rgba(0,7,65,0), ${NAVY} 70%)`, zIndex: 200 }} />
      </div>
    );
  }
  // Glass: a tilted wall of gloss tiles, bleeding off the page, one sweep of light across it.
  const cols = 7, rows = 7;
  return (
    <div className="absolute inset-x-0 top-0 overflow-hidden" style={{ height: 720 }}>
      <div className="absolute grid gap-2.5" style={{ left: -120, top: -150, width: 1060, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, transform: "rotate(-9deg)" }}>
        {cycle(faces, cols * rows).map((f, i) => (
          <div key={`${f.id}-${i}`} className="relative overflow-hidden rounded-2xl" style={{ height: 170, boxShadow: "0 12px 24px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.25)" }}>
            <img src={f.src} alt="" className="h-full w-full object-cover" style={{ objectPosition: "50% 25%" }} />
            <div className="absolute inset-0" style={{ background: SHEEN }} />
            <div className="absolute inset-0 rounded-2xl" style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7), inset 0 -8px 16px rgba(0,0,0,0.3)" }} />
          </div>
        ))}
      </div>
      <div className="absolute inset-0" style={{ background: "linear-gradient(112deg, rgba(255,255,255,0) 28%, rgba(255,255,255,0.22) 40%, rgba(255,255,255,0) 52%)", mixBlendMode: "screen" }} />
      <div className="absolute inset-x-0 bottom-0" style={{ height: 300, background: `linear-gradient(to bottom, rgba(0,7,65,0), ${NAVY} 85%)` }} />
    </div>
  );
}

/**
 * In the digital magazine their show plays right on the page: their segment from the day once
 * we have it, their newest episode until then, or whichever episode they tap. Hidden in print,
 * where the QR does the job.
 */
function Listen({ s, ep, label, go }: { s: Show; ep: Episode | null; label: string; go: number }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState({ at: 0, of: 0 });
  const play = () => {
    const a = audio.current;
    if (!a) return;
    // One show at a time: starting this one stops any other.
    document.querySelectorAll("audio[data-mag]").forEach((o) => { if (o !== a) (o as HTMLAudioElement).pause(); });
    void a.play();
  };
  // Tapping an episode in the list plays it.
  useEffect(() => { if (go) { setT({ at: 0, of: 0 }); setTimeout(play, 0); } }, [go]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ep) return null;
  const mmss = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`;
  return (
    <div className="mag-listen flex items-center gap-4 rounded-2xl px-4 py-3 print:hidden" style={{ background: NAVY }}>
      <button type="button" onClick={() => (audio.current?.paused ? play() : audio.current?.pause())} aria-label={playing ? "Pause" : `Play ${s.podcastName}`} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ background: GOLD, color: NAVY }} data-testid={`mag-play-${s.signupId}`}>
        {playing ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="ml-0.5 h-5 w-5" fill="currentColor" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: GOLD }}>{label}</p>
        <p className="truncate text-[14px] font-semibold text-white">{ep.title}</p>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full" style={{ width: `${t.of ? (t.at / t.of) * 100 : 0}%`, background: GOLD }} />
        </div>
      </div>
      {t.of > 0 && <span className="shrink-0 text-[12px] tabular-nums text-white/60">{mmss(t.at)} / {mmss(t.of)}</span>}
      <audio ref={audio} key={ep.audioUrl} data-mag data-label={ep.title} src={ep.audioUrl} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(e) => setT({ at: e.currentTarget.currentTime, of: e.currentTarget.duration || 0 })} />
    </div>
  );
}

/** The award: who and why on the left, the plaque beside it, their photo small and sharp. */
function AwardPage({ a, photo, n, event }: { a: NonNullable<Mag["award"]>; photo: string; n: number; event: Mag["event"] }) {
  return (
    <Page n={n} bg={NAVY} color="#fff">
      <div className="absolute inset-0 flex flex-col px-14 pb-14 pt-16">
        <p className="text-[12px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>{event.occasion} · Award</p>
        <div className="mt-6 flex items-center gap-7">
          {/* Small on purpose: a 400px photo stretched to the page's height went soft. */}
          {photo && <img src={photo} alt={a.name} className="h-[170px] w-[170px] shrink-0 rounded-full object-cover" style={{ boxShadow: `0 0 0 5px ${GOLD}`, objectPosition: "50% 30%" }} />}
          <div className="min-w-0">
            <h2 className="text-[46px] font-bold leading-[1.02] tracking-tight" style={HEAD}>{a.title}</h2>
            <p className="mt-3 text-[28px] font-semibold" style={{ ...HEAD, color: GOLD }}>{a.name}</p>
            <p className="mt-1 text-[15px] text-white/70">{a.show}</p>
          </div>
        </div>
        <div className="mt-10 flex min-h-0 flex-1 gap-10">
          <div className="min-w-0 flex-1">
            {a.citation && <p className="text-[16px] leading-[1.7] text-white/90">{a.citation}</p>}
            {a.quote && (
              <blockquote className="mt-7 border-l-4 pl-5" style={{ borderColor: GOLD }}>
                <p className="text-[19px] font-semibold italic leading-snug" style={HEAD}>“{a.quote}”</p>
                <footer className="mt-2 text-[13px] font-semibold text-white/60">{a.name}</footer>
              </blockquote>
            )}
          </div>
          <img src={a.plaque} alt="The award plaque" className="w-[300px] shrink-0 self-start object-contain" style={{ filter: "drop-shadow(0 18px 30px rgba(0,0,0,0.45))" }} />
        </div>
        <p className="mt-6 text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-white/50">{event.name} · {event.day}</p>
      </div>
    </Page>
  );
}

/** The PodcastOne partnership (8 Oct, from LiveOne's 5 Oct release): the news on one page, the whole release a scan away. */
// The QR lands on our copy of the release (8 Oct): the text, live PODC and LVO charts, and the newswire link.
const RELEASE_URL = "https://militaryvoices.ai/podcast-one-press-release";
function NewsPage({ n, podcastOne, liveOne }: { n: number; podcastOne: string; liveOne: string }) {
  // No numbers grid (8 Oct): our counts beside PodcastOne's network undersold who they are.
  return (
    <Page n={n}>
      {/* The band: who, and the tickers. */}
      <div className="absolute inset-x-0 top-0 px-12 pb-9 pt-11" style={{ background: NAVY, color: "#fff" }}>
        <p className="text-[12px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>In the news · October 5, 2026</p>
        <h2 className="mt-3 text-balance text-[38px] font-bold leading-[1.05] tracking-tight" style={HEAD}>PodcastOne and National Military Podcast Day launch a multi-year partnership</h2>
        <div className="mt-6 flex items-center gap-6 rounded-2xl border border-white/15 bg-white/[0.06] px-6 py-4">
          <div className="flex flex-1 items-center justify-center gap-9">
            <img src="/nmpd-logo.png" alt="National Military Podcast Day" className="h-[72px] w-[72px] object-contain" />
            {podcastOne && <img src={podcastOne} alt="PodcastOne" className="h-[58px] w-auto object-contain" />}
            {liveOne && <img src={liveOne} alt="LiveOne" className="h-[34px] w-auto object-contain" />}
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            {["NASDAQ: PODC", "NASDAQ: LVO"].map((t) => <span key={t} className="rounded-full border border-white/30 px-3 py-1 text-center text-[12px] font-bold tracking-[0.08em]" style={{ color: GOLD }}>{t}</span>)}
          </div>
        </div>
      </div>
      <div className="absolute inset-x-12 flex flex-col" style={{ top: 384, bottom: 150 }}>
        <p className="text-[17px] leading-[1.6] text-slate-800">LiveOne subsidiary PodcastOne has signed a multi-year distribution, content and marketing partnership with National Military Podcast Day, founded by Colonel Riccoh Player, USMC (Ret.). It launched with the Podcast Marathon itself: sixteen hours, reveille to end of duty, with a new show on air every thirty minutes.</p>
        <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: GOLD }}>What it means</p>
        <ul className="mt-2 space-y-2 text-[15.5px] leading-[1.5] text-slate-800">
          <li className="flex gap-2"><span style={{ color: GOLD }}>■</span><span>PodcastOne streams the full Marathon live, then keeps it on demand all year.</span></li>
          <li className="flex gap-2"><span style={{ color: GOLD }}>■</span><span>The day is promoted across PodcastOne's shows, including #StillServing: The VFW Podcast, The MilSpouse Show!, The Hard to Kill Podcast and History On The Road.</span></li>
        </ul>
        {/* Who PodcastOne is (8 Oct): their network, big, in place of our own counts. */}
        <div className="mt-6 flex items-center gap-6 rounded-2xl px-7 py-5" style={{ background: NAVY, color: "#fff" }}>
          {[["1B+", "monthly impressions"], ["3.9B", "downloads to date"]].map(([v, l]) => (
            <div key={l} className="shrink-0">
              <p className="text-[40px] font-bold leading-none" style={{ ...HEAD, color: GOLD }}>{v}</p>
              <p className="mt-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/70">{l}</p>
            </div>
          ))}
          <p className="min-w-0 flex-1 text-pretty text-[14px] leading-snug text-white/85">PodcastOne's network on YouTube, Spotify, Apple Podcasts and iHeartRadio, now carrying military voices.</p>
        </div>
        <blockquote className="mt-6 border-l-4 pl-5" style={{ borderColor: GOLD }}>
          <p className="text-[20px] font-semibold italic leading-snug" style={{ ...HEAD, color: NAVY }}>“We can't think of a greater good to put our platform toward.”</p>
          <footer className="mt-1 text-[13px] font-semibold text-slate-500">Kit Gray, President, PodcastOne</footer>
        </blockquote>
        <p className="mt-4 text-[14.5px] leading-[1.55] text-slate-700">For Colonel Player, PodcastOne's national reach means the stories of military mothers, fathers, brothers and sisters can now find listeners the day could never have reached on its own.</p>
      </div>
      <footer className="absolute inset-x-0 bottom-0 flex items-center gap-4 px-12 pb-10 pt-4" style={{ borderTop: "1px solid #e5e7eb" }}>
        <Qr url={RELEASE_URL} size={84} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold" style={{ color: NAVY }}>Scan to read the full release</p>
          <p className="text-[12px] text-slate-500">Source: LiveOne, via ACCESS Newswire, October 5, 2026</p>
        </div>
      </footer>
    </Page>
  );
}

/**
 * A show that isn't one host's podcast gets a flyer instead of the standard page (8 Oct):
 * American Warriors is a documentary series, so it's their art, their veterans and their trailer.
 * Images are theirs (YouTube channel art, episode stills from americanwarriors.com), kept under /mag.
 */
type Flyer = { banner: string; strip: string; voices: { img: string; pos: string; name: string; line: string }[]; eras: string[]; trailer: string; site: string; siteLine: string };
const FLYERS: Record<number, Flyer> = {
  48: {
    banner: "/mag/aw/banner.jpg",
    strip: "Their service. In their own words.",
    voices: [
      { img: "/mag/aw/mcphail.jpg", pos: "30% 50%", name: "Joe McPhail", line: "WWII Corsair pilot, USMC" },
      { img: "/mag/aw/ray.jpg", pos: "50% 40%", name: "Col. James Ray", line: "Prisoner of war" },
      { img: "/mag/aw/ryan.jpg", pos: "62% 40%", name: "Mary Ryan", line: "Desert Storm, battlefield deception" },
      { img: "/mag/aw/holmes.jpg", pos: "70% 50%", name: "Ben Holmes", line: "Radio operator, Iraq 2009" },
    ],
    eras: ["WWII", "Korea", "Vietnam", "Cold War", "Desert Storm", "Bosnia", "Somalia", "Iraq", "Afghanistan"],
    trailer: "https://www.youtube.com/watch?v=is7LlGqTa7Y",
    site: "https://americanwarriors.com",
    siteLine: "A non-profit documentary series honoring veterans of every branch and era.",
  },
};
const STENCIL = { fontFamily: "'Saira Stencil One', 'General Sans', sans-serif" } as const;
function FlyerPage({ s, f, n }: { s: Show; f: Flyer; n: number }) {
  useEffect(() => {
    if (document.getElementById("font-stencil")) return;
    const l = document.createElement("link");
    l.id = "font-stencil";
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Saira+Stencil+One&display=swap";
    document.head.appendChild(l);
  }, []);
  const INK = "#2f2516";
  const SLATE = "#5d6866";
  const CREAM = "#f3e7c9";
  return (
    <Page n={n} bg="#e9d9b4" color={INK}>
      <div className="absolute inset-0" style={{ background: "radial-gradient(120% 70% at 50% 100%, rgba(120,80,30,.18), transparent 60%)" }} />
      <div className="absolute inset-x-0 top-0" style={{ height: 440 }}>
        <img src={f.banner} alt="American Warriors" className="h-full w-full object-cover" style={{ objectPosition: "50% 45%", WebkitMaskImage: "linear-gradient(#000 72%, transparent)", maskImage: "linear-gradient(#000 72%, transparent)" }} />
        <span className="absolute left-8 top-7 rounded-full px-3.5 py-1.5 text-[12px] font-bold uppercase tracking-[0.18em]" style={{ background: "rgba(47,37,22,.82)", color: CREAM }}>Show {s.number} · {s.time}</span>
      </div>
      <div className="absolute inset-x-12" style={{ top: 418 }}>
        <div className="mx-auto w-fit -rotate-1 px-8 py-2.5 shadow-md" style={{ background: SLATE, color: CREAM, clipPath: "polygon(1% 4%, 99% 0, 100% 92%, 0 100%)" }}>
          <p className="text-[27px] leading-none tracking-[0.04em]" style={STENCIL}>{f.strip}</p>
        </div>
        <p className="mx-auto mt-6 max-w-[660px] text-pretty text-center text-[16px] leading-[1.6]">{s.blurb}</p>
        <p className="mt-6 text-center text-[11px] font-bold uppercase tracking-[0.28em]" style={{ color: "#7a5a22" }}>Voices from the series</p>
        <div className="mt-3 grid grid-cols-4 gap-3">
          {f.voices.map((v) => (
            <figure key={v.name} className="bg-[#f6eedb] p-1.5 pb-2 shadow-[0_2px_6px_rgba(47,37,22,.25)]">
              <img src={v.img} alt={v.name} className="h-[118px] w-full object-cover" style={{ objectPosition: v.pos, filter: "sepia(.35) contrast(1.05)" }} />
              <figcaption className="px-1 pt-2">
                <p className="text-[13.5px] font-bold leading-tight" style={HEAD}>{v.name}</p>
                <p className="mt-0.5 text-[11.5px] leading-snug text-[#5b4a30]">{v.line}</p>
              </figcaption>
            </figure>
          ))}
        </div>
        <div className="mt-5 flex justify-center gap-1.5">
          {f.eras.map((e) => <span key={e} className="whitespace-nowrap border px-1.5 py-0.5 text-[11.5px] uppercase tracking-[0.04em]" style={{ ...STENCIL, borderColor: "rgba(47,37,22,.45)" }}>{e}</span>)}
        </div>
      </div>
      <footer className="absolute inset-x-0 bottom-0 flex items-center gap-5 px-12 py-6" style={{ background: SLATE, color: CREAM }}>
        <div className="bg-white p-1"><Qr url={f.trailer} size={74} /></div>
        <div className="min-w-0 flex-1">
          <p className="text-[22px] leading-none" style={STENCIL}>Watch the series trailer</p>
          <p className="mt-1.5 text-[12.5px] opacity-85">{f.siteLine}</p>
        </div>
        <div className="text-right">
          <div className="ml-auto w-fit bg-white p-1"><Qr url={f.site} size={74} /></div>
          <p className="mt-1 text-[11.5px] font-semibold tracking-[0.06em]">americanwarriors.com</p>
        </div>
      </footer>
    </Page>
  );
}

function BackCover({ podcastOne, liveOne }: { podcastOne: string; liveOne: string }) {
  return (
    <Page bg={NAVY} color="#fff">
      <div className="absolute inset-0" style={{ background: "radial-gradient(70% 45% at 50% 30%, rgba(240,167,31,.18), transparent 70%)" }} />
      <div className="absolute inset-x-14 top-0 flex flex-col items-center justify-center text-center" style={{ bottom: 230 }}>
        <img src="/nmpd-logo.png" alt="National Military Podcast Day" className="h-[210px] w-[210px] object-contain" />
        <p className="mt-8 text-[14px] font-bold uppercase tracking-[0.34em]" style={{ color: GOLD }}>See you in 2027</p>
        <h2 className="mt-3 text-balance text-[54px] font-bold leading-[1.02] tracking-tight" style={HEAD}>National Military Podcast Day</h2>
        <p className="mt-2 text-[44px] font-bold leading-none" style={{ ...HEAD, color: GOLD }}>October 2027</p>
        <p className="mt-6 max-w-[560px] text-balance text-[18px] leading-relaxed text-white/80">Sixteen hours live. Reveille to end of duty. A new military or veteran show every thirty minutes.</p>
        {(podcastOne || liveOne) && (
          <div className="mt-8 flex flex-col items-center">
            <p className="text-[12px] font-bold uppercase tracking-[0.24em] text-white/60">Streaming live and on demand with</p>
            <div className="mt-4 flex items-center justify-center gap-10">
              {podcastOne && <img src={podcastOne} alt="PodcastOne" className="h-[78px] w-auto object-contain" />}
              {liveOne && <img src={liveOne} alt="LiveOne" className="h-[40px] w-auto object-contain" />}
            </div>
          </div>
        )}
      </div>
      <footer className="absolute inset-x-14 bottom-12 flex items-center gap-6 border-t border-white/15 pt-7">
        <div className="rounded-xl bg-white p-2"><Qr url="https://www.militaryvoices.ai/2027" size={104} /></div>
        <div className="min-w-0 flex-1">
          <p className="text-[24px] font-bold leading-tight" style={HEAD}>Get on the list for next year</p>
          <p className="mt-1 text-[15px] text-white/70">The date, the lineup and how to tune in, first.</p>
          <p className="mt-2 text-[15px] font-semibold" style={{ color: GOLD }}>militaryvoices.ai/2027</p>
        </div>
        <img src="/logo-lockup-dark.png" alt="MilitaryVoices.ai" className="h-[72px] w-auto" />
      </footer>
    </Page>
  );
}

/**
 * Closing Ceremonies (9 Oct): Alex, the Marathon's SI co-host, signing off. The quote is Alex's own
 * sign-off from the day (transcribed from the closing segment), the rest is from Riccoh's closing.
 */
function ClosingPage({ s, n }: { s: Show; n: number }) {
  // Watch it right on the page (9 Oct): the day's video from the closing's start; the QR stays for print.
  const [watching, setWatching] = useState(false);
  // The cut starts 45 seconds early, on the end of the show before; Alex's introduction of the closing comes in at 0:47.
  const video = s.clip ? `${SITE}/api/magazine/segment/${s.signupId}/video#t=${s.clip.start + 45},${s.clip.start + s.clip.dur}` : "";
  const notes: [string, string][] = [
    ["Excellence in Storytelling Award", "Rachel Oswalt, for telling it unscripted, every time she's on the mic."],
    ["A first for military podcasting", "An SI co-host program built for military and veteran voices, live for sixteen hours."],
    ["Thank-you gifts", "Pōstify credits for every guest and host, and the Pro plan for every co-host."],
  ];
  return (
    <Page n={n} bg="#03051a" color="#fff">
      <div className="absolute inset-0" style={{ background: "radial-gradient(60% 45% at 25% 55%, rgba(200,16,46,.16), transparent 70%), radial-gradient(50% 40% at 85% 10%, rgba(240,167,31,.14), transparent 70%)" }} />
      <div className="absolute inset-x-12 top-12">
        <p className="text-[12px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>Closing Ceremonies · {s.time}</p>
        <h2 className="mt-3 text-balance text-[50px] font-bold leading-[1.02] tracking-tight" style={HEAD}>Alex had the last word</h2>
        <p className="mt-4 max-w-[640px] text-pretty text-[16px] leading-[1.6] text-white/80">Alex is the SI (superintelligence) co-host built into the MilitaryVoices studio. Across sixteen hours, Alex introduced the shows, handed off between them and co-hosted three-quarters of the Marathon. Then Alex welcomed Riccoh Player back to the stage for the closing ceremonies, and signed off the day.</p>
      </div>
      <img src="/mag/alex-portrait.jpg" alt="Alex, the SI co-host" className="absolute left-2 top-[468px] w-[372px]" style={{ mixBlendMode: "lighten" }} />
      <div className="absolute right-12 flex w-[400px] flex-col" style={{ top: 318 }}>
        <span className="text-[64px] font-bold leading-none" style={{ ...HEAD, color: GOLD }}>“</span>
        <blockquote className="-mt-4 text-pretty text-[20px] font-semibold italic leading-[1.45]" style={HEAD}>Thank you to every podcaster who took the stage today… But most of all, thank you, the viewer, for taking the time to listen to a military voice. For now, happy National Military Podcast Day. We'll see you soon.</blockquote>
        <p className="mt-4 text-[13px] font-bold uppercase tracking-[0.18em]" style={{ color: GOLD }}>Alex · SI co-host, signing off</p>
        <div className="mt-8 space-y-4 border-t border-white/15 pt-6">
          {notes.map(([t, d]) => (
            <div key={t}>
              <p className="text-[15px] font-bold" style={HEAD}>{t}</p>
              <p className="mt-0.5 text-pretty text-[13.5px] leading-snug text-white/70">{d}</p>
            </div>
          ))}
        </div>
      </div>
      {watching && video && (
        <div className="absolute inset-x-8 z-10 overflow-hidden rounded-2xl bg-black shadow-2xl print:hidden" style={{ top: 300 }}>
          <video src={video} data-label="Closing ceremonies video" controls autoPlay playsInline poster="/mag/alex-portrait.jpg" className="aspect-video w-full bg-black" />
          <button type="button" onClick={() => setWatching(false)} className="absolute right-3 top-3 rounded-full bg-black/70 px-3 py-1 text-[12px] font-semibold text-white">Close</button>
        </div>
      )}
      <footer className="absolute inset-x-0 bottom-0 flex items-center gap-5 px-12 pb-10 pt-5" style={{ borderTop: "1px solid rgba(255,255,255,.12)" }}>
        {video && (
          <button type="button" onClick={() => setWatching(true)} aria-label="Watch the closing ceremonies" className="flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-full shadow-lg print:hidden" style={{ background: GOLD, color: NAVY }} data-testid="closing-play">
            <Play className="ml-1 h-8 w-8" fill="currentColor" />
          </button>
        )}
        <div className="rounded-lg bg-white p-1.5"><Qr url={`https://www.militaryvoices.ai/api/magazine/segment/${s.signupId}`} size={76} /></div>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-bold" style={HEAD}>Watch the closing ceremonies</p>
          <p className="text-[13px] text-white/65">Riccoh Player's close of the day, and Alex's sign-off.</p>
        </div>
        <p className="text-right text-[12px] font-bold uppercase tracking-[0.18em] text-white/55">Bigger, better and<br />brighter in 2027</p>
      </footer>
    </Page>
  );
}

function ShowPage({ s, n, event }: { s: Show; n: number; event: Mag["event"] }) {
  const who = [s.branch, s.service].filter(Boolean).join(" · ");
  const eps = s.episodes ?? [];
  // Every show page the same shape (8 Oct): description, quote, On the day, two episodes, the player.
  // When the words run long it fits itself (smaller type, then fewer episodes), never cutting anything off.
  const body = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState(0);
  useLayoutEffect(() => {
    const el = body.current;
    if (el && el.scrollHeight > el.clientHeight + 1 && fit < 4) setFit((f) => f + 1);
  });
  // One type size on every page; a page that still runs long shows one episode, then (rarely) smaller type.
  const rows = fit >= 1 ? 1 : 2;
  const size = fit >= 2 ? (fit >= 3 ? 0.9 : 0.95) : 1;
  const [pick, setPick] = useState(-1);
  const [go, setGo] = useState(0);
  const segment: Episode | null = s.audio ? { title: "Their segment from the Marathon", audioUrl: s.audio, date: "" } : null;
  const current = pick >= 0 ? eps[pick] : segment ?? eps[0] ?? null;
  const label = pick < 0 && segment ? "Listen to their segment" : pick < 0 ? "Listen to their latest episode" : "Now playing";
  const first = s.hostName.replace(/^(dr|mr|mrs|ms|sgt|sergeant major)\.?\s+(\(ret\.\)\s+)?/i, "").trim().split(/\s+/)[0];
  return (
    <Page n={n}>
      <div className="absolute inset-x-0 top-0 flex flex-col px-12 pb-36 pt-12" style={{ height: H }}>
        {/* Who they are: their photo beside the show, not across the page. */}
        <div className="flex gap-7">
          <div className="relative shrink-0" style={{ width: 230, height: 288 }}>
            {s.headshot ? <img src={s.headshot} alt={`${s.hostName} photo`} className="h-full w-full rounded-2xl object-cover" style={{ objectPosition: "50% 22%" }} /> : <div className="h-full w-full rounded-2xl" style={{ background: NAVY }} />}
            {s.art && <img src={s.art} alt={`${s.podcastName} art`} className="absolute -bottom-4 -right-4 rounded-xl object-cover shadow-lg" style={{ width: 92, height: 92, border: "4px solid #fff" }} />}
          </div>
          <div className="flex min-w-0 flex-1 flex-col pt-1">
            <span className="self-start rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ background: GOLD, color: "#1a1200" }}>Show {s.number} · {s.time}</span>
            <h2 className="mt-4 text-balance text-[36px] font-bold leading-[1.04] tracking-tight" style={{ ...HEAD, color: NAVY }}>{s.podcastName}</h2>
            <p className="mt-2 text-[16px] font-semibold text-slate-700">with {s.hostName}</p>
            {who && <p className="mt-0.5 text-[14px] text-slate-500">{who}</p>}
          </div>
        </div>

        <div ref={body} className="mt-8 flex min-h-0 flex-1 flex-col gap-5 overflow-hidden">
          {s.blurb && <p className="leading-[1.6] text-slate-800" style={{ fontSize: 14.5 * size }}>{s.blurb}</p>}
          {s.quote && (
            <blockquote className="border-l-4 pl-5" style={{ borderColor: GOLD }}>
              <p className="font-semibold italic leading-snug" style={{ ...HEAD, color: NAVY, fontSize: 19 * size }}>“{s.quote}”</p>
              <footer className="mt-1.5 text-[13px] font-semibold text-slate-500">{s.hostName}</footer>
            </blockquote>
          )}
          {s.onTheDay && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: GOLD }}>On the day</p>
              <p className="mt-2 leading-[1.6] text-slate-800" style={{ fontSize: 14 * size }}>{s.onTheDay}</p>
            </div>
          )}
          {s.about && !s.onTheDay && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: GOLD }}>{s.aboutOwn ? `About ${first}` : `About ${first}, in their words`}</p>
              <p className="mt-2 leading-[1.6] text-slate-700" style={{ fontSize: 14 * size }}>{s.about}</p>
            </div>
          )}
          {!!s.links?.length && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: GOLD }}>Watch and listen</p>
              <ol className="mt-2 divide-y divide-slate-200 border-y border-slate-200">
                {s.links.slice(0, rows).map((l) => (
                  <li key={l.url}>
                    <a href={l.url} target="_blank" rel="noreferrer" className="group flex w-full items-baseline gap-3 py-2 text-left">
                      <ExternalLink className="relative top-0.5 h-3.5 w-3.5 shrink-0" style={{ color: GOLD }} />
                      <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-slate-800 group-hover:underline">{l.title}</span>
                      <span className="shrink-0 text-[12px] text-slate-400">{l.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {!s.links?.length && eps.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: GOLD }}>Start with these episodes</p>
              <ol className="mt-2 divide-y divide-slate-200 border-y border-slate-200">
                {eps.slice(0, rows).map((e, i) => (
                  <li key={e.audioUrl}>
                    <button type="button" onClick={() => { setPick(i); setGo((g) => g + 1); }} className="group flex w-full items-baseline gap-3 py-2 text-left">
                      <Play className="relative top-0.5 h-3.5 w-3.5 shrink-0 print:hidden" style={{ color: GOLD }} fill="currentColor" />
                      <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-slate-800 group-hover:underline">{e.title}</span>
                      {e.date && <span className="shrink-0 text-[12px] tabular-nums text-slate-400">{e.date}</span>}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <Listen s={s} ep={current} label={label} go={go} />
        </div>
      </div>
      <footer className="absolute inset-x-0 bottom-0 flex items-center gap-4 px-12 pb-10 pt-4" style={{ borderTop: "1px solid #e5e7eb" }}>
        <Qr url={s.link} size={84} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold" style={{ color: NAVY }}>Scan to listen and follow {s.podcastName}</p>
          <p className="truncate text-[12px] text-slate-500">{s.link.replace(/^https?:\/\/(www\.)?/, "")}</p>
        </div>
        <p className="text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{event.name}<br />{event.day}</p>
      </footer>
    </Page>
  );
}

export default function Magazine({ slug }: { slug?: string }) {
  const printing = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("print");
  const q = useQuery<Mag>({
    queryKey: ["/api/magazine", slug ?? ""],
    queryFn: async () => {
      // A podcaster's private review link carries ?review=<signupId>.<token> through to the API.
      const review = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("review") : null;
      const r = await fetch(`${slug ? `/api/magazine/${encodeURIComponent(slug)}` : "/api/magazine"}${review ? `?review=${encodeURIComponent(review)}` : ""}`, { credentials: "include" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "The magazine isn't out yet.");
      return r.json();
    },
  });
  // Scaled to the screen; printed at full size.
  const box = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(1, ((box.current?.clientWidth ?? W) - 0) / W));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [q.data]);
  // A link to someone's page (#show-42, from the email) opens on it.
  useEffect(() => {
    if (!q.data || !window.location.hash.startsWith("#show-")) return;
    const t = setTimeout(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "start" }), 400);
    return () => clearTimeout(t);
  }, [q.data]);
  useEffect(() => {
    if (!printing || !q.data) return;
    document.title = `${q.data.event.name} — Keepsake Magazine`;
    // Wait for every picture, then print.
    const imgs = Array.from(document.images);
    void Promise.all([document.fonts?.ready, ...imgs.map((i) => (i.complete ? Promise.resolve() : new Promise((r) => { i.onload = i.onerror = () => r(null); })))]).then(() => setTimeout(() => window.print(), 600));
  }, [printing, q.data]);

  // Every picture is a link, and every picture click, link click and play is counted (9 Oct).
  useEffect(() => {
    const e = q.data?.event.id;
    if (!e || printing) return;
    const send = (frame: HTMLElement, k: string, l: string) => {
      const body = JSON.stringify({ e, p: frame.dataset.pk, k, l: l.slice(0, 90) });
      try { if (!navigator.sendBeacon?.("/api/magazine/track", new Blob([body], { type: "application/json" }))) throw new Error("no beacon"); }
      catch { void fetch("/api/magazine/track", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {}); }
    };
    const onClick = (ev: MouseEvent) => {
      const el = ev.target as HTMLElement | null;
      const frame = el?.closest<HTMLElement>("[data-pk]");
      if (!el || !frame) return;
      const a = el.closest("a");
      if (a) { send(frame, "link", (a.textContent || a.getAttribute("href") || "Link").trim()); return; }
      const img = el.closest("img");
      if (!img || el.closest("button")) return;
      // A QR's own link counts it (/go/m); a picture is counted here, then opens its link.
      const href = img.dataset.href || frame.dataset.link || "";
      if (!img.dataset.qr) send(frame, "image", img.alt || `${frame.dataset.pl ?? "Page"} picture`);
      if (!href) return;
      if (href.startsWith("#")) document.getElementById(href.slice(1))?.scrollIntoView({ block: "start", behavior: "smooth" });
      else window.open(href, "_blank", "noopener");
    };
    const onPlay = (ev: Event) => {
      const audio = ev.target as HTMLElement;
      const frame = audio?.closest?.<HTMLElement>("[data-pk]");
      if (frame && (audio.tagName === "AUDIO" || audio.tagName === "VIDEO")) send(frame, "play", audio.dataset.label || frame.dataset.pl || "Audio");
    };
    document.addEventListener("click", onClick);
    document.addEventListener("play", onPlay, true);
    return () => { document.removeEventListener("click", onClick); document.removeEventListener("play", onPlay, true); };
  }, [q.data, printing]);
  // An admin opening the whole magazine sends the page list, so Admin → Magazine can show every item.
  useEffect(() => {
    const d = q.data;
    if (!d?.admin || d.review || d.reviewAll || printing || !d.event.id) return;
    const t = setTimeout(() => {
      const pages = Array.from(document.querySelectorAll<HTMLElement>("[data-pk]")).map((f) => {
        const items: { k: string; l: string }[] = [];
        f.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
          if (img.dataset.qr) {
            try { const u = new URL(new URL(img.dataset.href || "").searchParams.get("u") || ""); items.push({ k: "qr", l: `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`.slice(0, 90) }); } catch { /* not ours */ }
          } else items.push({ k: "image", l: img.alt || `${f.dataset.pl ?? "Page"} picture` });
        });
        f.querySelectorAll<HTMLAudioElement>("audio[data-mag]").forEach((a) => items.push({ k: "play", l: a.dataset.label || f.dataset.pl || "Audio" }));
        f.querySelectorAll("a").forEach((a) => items.push({ k: "link", l: (a.textContent || a.getAttribute("href") || "Link").trim() }));
        const seen = new Set<string>();
        return { p: f.dataset.pk, n: Number(f.dataset.pn), label: f.dataset.pl, items: items.filter((i) => { const key = `${i.k}|${i.l}`; if (seen.has(key)) return false; seen.add(key); return true; }) };
      });
      void fetch(`/api/admin/magazine/${d.event.id}/manifest`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pages }) }).catch(() => {});
    }, 3000);
    return () => clearTimeout(t);
  }, [q.data, printing]);

  if (q.isLoading) return <div className="flex min-h-screen items-center justify-center bg-slate-200"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>;
  if (q.isError || !q.data) return <div className="flex min-h-screen items-center justify-center bg-slate-200 p-6 text-center text-slate-600">{(q.error as Error)?.message ?? "The magazine isn't out yet."}</div>;
  const m = q.data;
  // Every show on the cover: their photo, or their show's art when we haven't got one.
  // (Each person once: Riccoh opens and closes the day but is one face.)
  const faces = m.shows.map((s) => ({ id: s.signupId, src: s.headshot || s.art, who: s.hostName.trim().toLowerCase() })).filter((f, i, all) => f.src && all.findIndex((x) => x.src === f.src || x.who === f.who) === i);
  const cols = faces.length > 24 ? 8 : 6;
  // A full last row: any gap gets the day's own badge.
  const fill = (cols - (faces.length % cols)) % cols;
  // The cover: a collage style, or their photo (?cover= previews one without saving it).
  const asked = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("cover") : null;
  const coverStyle: CoverStyle | "photo" = (["glass", "medallion", "prints", "letters", "photo"] as const).find((x) => x === asked) ?? (m.cover?.style as CoverStyle | "photo" | undefined) ?? (m.cover?.photo ? "photo" : "glass");
  // The faces page is portrait: fewer across, so each face stays a face.
  // The podcasters only: Riccoh hosts (and has his own welcome page), so the rows come out even.
  const pageFaces = faces.filter((f) => !m.shows.some((x) => x.signupId === f.id && /ceremon/i.test(x.podcastName)));
  const pageCols = 6;
  const pageBadge = pageFaces.length % pageCols !== 0;
  const pageRows = Math.ceil((pageFaces.length + (pageBadge ? 1 : 0)) / pageCols);
  const pageTileW = Math.floor((W - 80 - (pageCols - 1) * 6) / pageCols);
  const pageTileH = Math.min(Math.round(pageTileW * 1.25), Math.floor((H - 190 - 48 - (pageRows - 1) * 6) / pageRows));
  const half = Math.ceil(m.shows.length / 2);
  const ads = m.ads ?? [];
  // The first ad faces the welcome; the rest are spread evenly through the show pages.
  const after = new Map<number, Ad[]>();
  // An ad pinned after a show goes there (9 Oct: Zoom beside Frank Zaccari); the rest spread evenly.
  // Every ad gets an evenly spaced slot (about one every few shows); a pinned ad takes the slot
  // nearest its show and moves it onto that show, so the rest stay evenly spaced.
  const rest = ads.slice(1);
  const slots = rest.map((_, k) => Math.max(0, Math.round(((k + 1) * m.shows.length) / (rest.length + 1)) - 1));
  const taken = new Set<number>();
  const placed = new Map<Ad, number>();
  for (const ad of rest.filter((a) => a.after && m.shows.some((x) => x.signupId === a.after))) {
    const target = m.shows.findIndex((x) => x.signupId === ad.after);
    let best = -1;
    slots.forEach((pos, k) => { if (!taken.has(k) && (best < 0 || Math.abs(pos - target) < Math.abs(slots[best] - target))) best = k; });
    if (best < 0) continue;
    taken.add(best);
    slots[best] = target;
    placed.set(ad, best);
  }
  const free = slots.map((_, k) => k).filter((k) => !taken.has(k));
  rest.filter((a) => !placed.has(a)).forEach((ad, i) => placed.set(ad, free[i]));
  for (const [ad, k] of Array.from(placed.entries()).sort((a, b) => slots[a[1]] - slots[b[1]])) after.set(slots[k], [...(after.get(slots[k]) ?? []), ad]);
  let n = 1;
  // The sponsors in Andrew's order (8 Oct): PodcastOne, LiveOne, Genius, Tarver; anyone new after them.
  const rank = (name: string) => { const i = [/podcastone/i, /liveone/i, /genius/i, /tarver/i].findIndex((r) => r.test(name)); return i < 0 ? 99 : i; };

  const pages: ReactNode[] = [
    // Cover
    <Page key="cover" bg={NAVY} color="#fff">
      {coverStyle !== "photo" ? (
        <CoverCollage faces={faces} style={coverStyle} />
      ) : m.cover?.photo ? (
        <>
          <img src={m.cover.photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-x-0 bottom-0" style={{ height: 620, background: `linear-gradient(to bottom, transparent, ${NAVY} 62%)` }} />
        </>
      ) : (
        <>
          <div className="absolute inset-x-0 top-0 grid gap-1 p-1" style={{ height: 620, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {faces.map((f) => <img key={f.id} src={f.src} alt="" className="h-full w-full object-cover" style={{ objectPosition: "50% 25%" }} />)}
            {Array.from({ length: fill }, (_, i) => <div key={`fill-${i}`} className="flex items-center justify-center bg-white p-2"><img src="/nmpd-logo.jpg" alt="" className="max-h-full max-w-full object-contain" /></div>)}
          </div>
          <div className="absolute inset-x-0" style={{ top: 440, height: 200, background: `linear-gradient(to bottom, transparent, ${NAVY})` }} />
        </>
      )}
      {coverStyle === "letters" ? (
        <div className="absolute inset-x-12 text-center" style={{ top: 800, zIndex: 300 }}>
          <p className="text-[13px] font-bold uppercase tracking-[0.3em]" style={{ color: "#8a5a00" }}>Keepsake edition · {m.event.occasion}</p>
          <p className="mt-3 text-[22px] font-semibold" style={{ ...HEAD, color: NAVY }}>{m.event.day}</p>
          <p className="mt-1.5 text-[16px] text-slate-600">{m.shows.length} military and veteran shows, back to back, one day.</p>
          <p className="mt-8 text-[14px] font-bold tracking-wide" style={{ color: NAVY }}>MILITARYVOICES.AI</p>
        </div>
      ) : <>
      <div className="absolute inset-x-12" style={{ top: coverStyle === "medallion" ? 690 : 640, zIndex: 300 }}>
        <p className="text-[13px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>Keepsake edition · {m.event.occasion}</p>
        <h1 className="mt-3 text-[76px] font-bold leading-[0.95] tracking-tight" style={HEAD}>{m.event.name}</h1>
        <p className="mt-5 text-[20px] font-medium text-white/80">{m.event.day}</p>
        <p className="mt-2 text-[16px] text-white/60">{m.shows.length} military and veteran shows, back to back, one day.</p>
      </div>
      <p className="absolute bottom-10 left-12 text-[14px] font-bold tracking-wide" style={{ color: GOLD }}>MILITARYVOICES.AI</p>
      </>}
    </Page>,
    // The news, second (8 Oct): the PodcastOne partnership, when PodcastOne is one of the sponsors.
    ...(m.sponsors.some((sp) => /podcastone/i.test(sp.name)) ? [<NewsPage key="news" n={++n} podcastOne={m.sponsors.find((sp) => /podcastone/i.test(sp.name))?.logo ?? ""} liveOne={m.sponsors.find((sp) => /liveone/i.test(sp.name))?.logo ?? ""} />] : []),
    // Welcome
    <Page key="welcome" n={++n}>
      <div className="absolute inset-x-14 top-16">
        <p className="text-[12px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>Welcome</p>
        <div className="mt-6 flex items-start gap-8">
          <img src="/nmpd-logo.png" alt="National Military Podcast Day" className="h-44 w-44 shrink-0 object-contain" />
          <h2 className="text-[40px] font-bold leading-[1.05] tracking-tight" style={{ ...HEAD, color: NAVY }}>Thank you for being part of the day.</h2>
        </div>
        <div className="mt-8 space-y-4 text-[16px] leading-[1.65] text-slate-800">
          {(m.welcome || "Welcome letter to come.").split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
        </div>
        <div className="mt-8 flex items-center gap-4">
          <img src={m.shows.find((x) => /ceremon/i.test(x.podcastName) && x.headshot)?.headshot || "/riccoh.jpeg"} alt={m.host.name} className="h-16 w-16 shrink-0 rounded-full object-cover" style={{ objectPosition: "50% 22%", boxShadow: `0 0 0 3px ${GOLD}` }} />
          <div>
            <p className="text-[18px] font-bold" style={{ ...HEAD, color: NAVY }}>{m.host.name}</p>
            <p className="text-[14px] text-slate-500">{m.host.title}</p>
          </div>
        </div>
      </div>
    </Page>,
    ...(ads[0] ? [<AdPage key={`ad-${ads[0].id}`} ad={ads[0]} n={++n} />] : []),
    // The lineup
    <Page key="lineup" n={++n}>
      <div className="absolute inset-x-14 top-16">
        <p className="text-[12px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>The lineup · {m.event.day}</p>
        <h2 className="mt-3 text-[40px] font-bold tracking-tight" style={{ ...HEAD, color: NAVY }}>Who's on, and when</h2>
        <div className="mt-8 grid grid-cols-2 gap-x-10">
          {[m.shows.slice(0, half), m.shows.slice(half)].map((col, c) => (
            <ol key={c} className="space-y-2.5">
              {col.map((s) => (
                <li key={s.signupId} className="flex gap-3 text-[13px] leading-tight">
                  <span className="w-[74px] shrink-0 font-bold tabular-nums" style={{ color: GOLD }}>{s.time.replace(" ET", "")}</span>
                  <span className="min-w-0"><span className="block font-semibold text-slate-900">{s.podcastName}</span><span className="block text-slate-500">{s.hostName}</span></span>
                </li>
              ))}
            </ol>
          ))}
        </div>
        <p className="mt-6 text-[12px] text-slate-400">All times Eastern.</p>
      </div>
    </Page>,
    // Faces of the Marathon: everyone who's on, one page (each person once).
    <Page key="faces" bg={NAVY} color="#fff" n={++n}>
      <div className="absolute inset-x-10 top-12">
        <p className="text-[12px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>The voices of the day</p>
        <h2 className="mt-3 text-[40px] font-bold tracking-tight" style={HEAD}>Faces of the Marathon</h2>
      </div>
      {/* Every face the same size, rows that fit the page, the last row centred (with the day's badge). */}
      <div className="absolute inset-x-10 flex flex-wrap content-start justify-center gap-1.5" style={{ top: 190, bottom: 48 }}>
        {[...pageFaces.map((f) => ({ id: String(f.id), src: f.src, badge: false })), ...(pageBadge ? [{ id: "badge", src: "/nmpd-logo.png", badge: true }] : [])].map((t) => (
          <div key={t.id} className={`overflow-hidden rounded-md ${t.badge ? "flex items-center justify-center p-1" : ""}`} style={{ width: pageTileW, height: pageTileH }}>
            <img src={t.src} alt={t.badge ? "National Military Podcast Day" : `${m.shows.find((x) => String(x.signupId) === t.id)?.podcastName ?? "Podcaster"} (faces page)`} data-href={t.badge ? undefined : `#show-${t.id}`} className={t.badge ? "max-h-full max-w-full object-contain" : "h-full w-full object-cover"} style={t.badge ? undefined : { objectPosition: "50% 25%" }} />
          </div>
        ))}
      </div>
    </Page>,
    ...(m.award?.citation ? [<AwardPage key="award" a={m.award} n={++n} event={m.event} photo={m.award.photo || m.shows.find((x) => x.signupId === m.award!.signupId)?.headshot || ""} />] : []),
    ...m.shows.flatMap((s, i) => [
      /closing ceremon/i.test(s.podcastName) ? <ClosingPage key={s.signupId} s={s} n={++n} /> : FLYERS[s.signupId] ? <FlyerPage key={s.signupId} s={s} f={FLYERS[s.signupId]} n={++n} /> : <ShowPage key={s.signupId} s={s} n={++n} event={m.event} />,
      ...(after.get(i) ?? []).map((ad) => <AdPage key={`ad-${ad.id}`} ad={ad} n={++n} />),
    ]),
    // The Marathon's sponsors, then its friends: a page each (8 Oct).
    ...([
      { key: "sponsors", kicker: "Thank you to our sponsors", title: "Sponsors of the Marathon", line: "The Podcast Marathon happened because they believed in it.", list: m.sponsors.filter((sp) => sp.tier !== "friend").sort((a, b) => rank(a.name) - rank(b.name)) },
      { key: "friends", kicker: "With thanks", title: "Friends of the Marathon", line: "The day is free for every podcaster and every listener because of them.", list: m.sponsors.filter((sp) => sp.tier === "friend") },
    ].filter((g) => g.list.length).map((g) => (
      <Page key={g.key} n={++n}>
        <div className="absolute inset-x-14 top-16">
          <p className="text-[12px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>{g.kicker}</p>
          <h2 className="mt-3 text-[40px] font-bold tracking-tight" style={{ ...HEAD, color: NAVY }}>{g.title}</h2>
          <p className="mt-3 text-[16px] text-slate-600">{g.line}</p>
          <div className={`mt-12 grid gap-8 ${g.list.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
            {g.list.map((sp, i) => (
              <div key={sp.name} className={`flex flex-col items-center justify-center gap-3 rounded-2xl p-6 ${g.list.length % 2 === 1 && i === g.list.length - 1 && g.list.length > 1 ? "col-span-2 mx-auto w-1/2" : ""}`} style={{ background: NAVY, height: g.list.length <= 4 ? 200 : 160 }}>
                {sp.logo ? <img src={sp.logo} alt={sp.name} data-href={sp.url || undefined} className="max-h-[120px] max-w-full object-contain" /> : <span className="text-[24px] font-bold text-white">{sp.name}</span>}
              </div>
            ))}
          </div>
        </div>
      </Page>
    ))),
    // Back cover (8 Oct): see you in 2027, and the list to hear first.
    <BackCover key="back" podcastOne={m.sponsors.find((sp) => /podcastone/i.test(sp.name))?.logo ?? ""} liveOne={m.sponsors.find((sp) => /liveone/i.test(sp.name))?.logo ?? ""} />,
  ];

  // A podcaster's review link: their page alone, and what to do about it.
  // Each page's name and where its pictures go, for the counts (9 Oct).
  const pageMeta = (key: string): { label: string; link: string } => {
    const show = m.shows.find((x) => String(x.signupId) === key);
    if (show) return { label: show.podcastName, link: /closing ceremon/i.test(show.podcastName) ? `${SITE}/api/magazine/segment/${show.signupId}` : FLYERS[show.signupId]?.site ?? show.link };
    const ad = ads.find((x) => `ad-${x.id}` === key);
    if (ad) return { label: `Ad: ${ad.headline || ad.name}`, link: ad.link };
    const fixed: Record<string, { label: string; link: string }> = {
      cover: { label: "Cover", link: "" }, news: { label: "PodcastOne news", link: RELEASE_URL }, welcome: { label: "Welcome", link: "" },
      lineup: { label: "The lineup", link: "" }, faces: { label: "Faces of the Marathon", link: "" }, award: { label: "Award", link: "" },
      sponsors: { label: "Sponsors of the Marathon", link: "" }, friends: { label: "Friends of the Marathon", link: "" }, back: { label: "Back cover", link: `${SITE}/2027` },
    };
    return fixed[key] ?? { label: key, link: "" };
  };
  const frameData = (p: ReactNode, i: number) => {
    const key = String((p as ReactElement)?.key ?? i);
    const meta = pageMeta(key);
    return { "data-pk": key, "data-pn": i + 1, "data-pl": meta.label, "data-link": meta.link || undefined };
  };
  const shown = m.review ? [/closing ceremon/i.test(m.shows[0].podcastName) ? <ClosingPage key={m.shows[0].signupId} s={m.shows[0]} n={0} /> : FLYERS[m.shows[0].signupId] ? <FlyerPage key={m.shows[0].signupId} s={m.shows[0]} f={FLYERS[m.shows[0].signupId]} n={0} /> : <ShowPage key={m.shows[0].signupId} s={m.shows[0]} n={0} event={m.event} />] : pages;

  return (
    <div className="min-h-screen bg-slate-200 print:bg-white">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Anton&family=Yellowtail&display=block'); @page { size: 8.5in 11in; margin: 0; } @keyframes magFadeIn { from { opacity: 0 } to { opacity: 1 } } .mag-fade-in { animation: magFadeIn 900ms ease-in-out both; } @media print { .mag-fade-in { animation: none !important; } } @media screen { .mag-sheet img { cursor: pointer; } } @media print { .mag-bar { display: none !important; } .mag-sheet { transform: none !important; } .mag-frame { width: auto !important; height: auto !important; margin: 0 !important; } .mag-page { break-after: page; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      <div className="mag-bar sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-300 bg-white/95 px-4 py-2.5 backdrop-blur">
        <p className="truncate text-sm font-semibold text-slate-800">{m.event.name} · Keepsake magazine{m.review ? " · your page, for your review" : m.reviewAll ? " · draft, for your review" : !m.published ? " · draft (admins only)" : ""}</p>
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-full bg-[#053877] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0a4a99]" data-testid="magazine-print">
          <Printer className="h-4 w-4" /> Print / save as PDF
        </button>
      </div>
      {m.reviewAll && (
        <div className="mag-bar mx-auto mt-6 max-w-[816px] rounded-2xl border border-[#F0A71F]/60 bg-[#F0A71F]/10 px-5 py-4 text-[15px] text-slate-800" data-testid="magazine-review-all-note">
          <p className="font-semibold">This is the draft of the Podcast Marathon keepsake magazine, for your review.</p>
          <p className="mt-1">Reply to our email with any suggestions: a page, a word, a photo, the order. It isn't out yet, so please don't share this link.</p>
        </div>
      )}
      {m.review && (
        <div className="mag-bar mx-auto mt-6 max-w-[816px] rounded-2xl border border-[#F0A71F]/60 bg-[#F0A71F]/10 px-5 py-4 text-[15px] text-slate-800" data-testid="magazine-review-note">
          <p className="font-semibold">This is your page in the Podcast Marathon keepsake magazine.</p>
          <p className="mt-1">If it all looks right, reply to our email with "Approved". Anything to change (a word, your photo, your quote), reply with it by <b>6 pm Eastern today</b> and we'll fix it.</p>
        </div>
      )}
      <div ref={box} className="mx-auto max-w-[816px] px-0 py-6 sm:py-10 print:max-w-none print:p-0">
        {shown.map((p, i) => (
          <div key={i} {...frameData(p, i)} id={typeof (p as ReactElement)?.key === "string" && /^\d+$/.test((p as ReactElement).key as string) ? `show-${(p as ReactElement).key}` : undefined} className="mag-frame mx-auto mb-8 overflow-hidden shadow-xl print:mb-0 print:overflow-visible print:shadow-none" style={{ width: W * scale, height: H * scale }}>
            <div className="mag-sheet origin-top-left" style={{ width: W, height: H, transform: `scale(${scale})` }}><Where.Provider value={{ e: m.event.id ?? 0, p: String((p as ReactElement)?.key ?? i) }}>{p}</Where.Provider></div>
          </div>
        ))}
      </div>
    </div>
  );
}
