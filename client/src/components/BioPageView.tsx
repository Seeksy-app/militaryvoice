import { useCallback, useEffect, useRef, useState } from "react";
import { Calendar, Check, Copy, MessageCircle, Pause, Play, Radio, Send, Share2, Sparkles, Tag, X } from "lucide-react";
import { PlatformIcon, platformBackground } from "@/components/SocialIcons";
import type { BioPublic, BioSection, BioTheme } from "@shared/bio";
import type { SocialPlatform } from "@shared/schema";

/**
 * A podcaster's bio page, drawn from its data alone: the builder's preview
 * and the public page are this same component, so they can never disagree.
 * The show sits top and centre: the latest episode to play and share, the
 * rest below it, then their links; a chat button at the top for a message to them.
 */

type Ev = (kind: "view" | "click" | "play" | "share", label?: string) => void;

const hms = (sec: number) => { const s = Math.round(sec); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const dateOf = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
/** Black or white text, whichever reads on this colour. */
function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function onColor(hex: string): string {
  return lum(hex) > 0.45 ? "#0b1020" : "#ffffff";
}
/** Their colour, unless it would vanish into the page behind it (navy on a dark page): then white, or navy on a light one. */
function standOut(color: string, page: string, dark: boolean): string {
  const [a, b] = [lum(color), lum(page)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 2.4 ? color : dark ? "#ffffff" : "#053877";
}
const youtubeEmbed = (u: string) => {
  const m = u.match(/(?:youtu\.be\/|v=|shorts\/|embed\/|live\/)([\w-]{11})/);
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  const v = u.match(/vimeo\.com\/(\d+)/);
  return v ? `https://player.vimeo.com/video/${v[1]}` : "";
};

export type AiAnswer = { answer: string; sources: { n: number; title: string; startSec: number; audio: string; at: string }[]; unanswered: boolean };

export type ChatMsg = { token: string; question: string; reply: string; repliedAt: string; createdAt: string };
type AskInput = { name: string; email: string; question: string; episode: string; website: string };

export function BioPageView({ data, preview = false, onEvent, onAsk, onAskAi, onLoadMessages, shareBase }: {
  data: BioPublic;
  /** In the builder: nothing is counted, nothing is sent. */
  preview?: boolean;
  onEvent?: Ev;
  /** A message to the podcaster; the token is the listener's key to the conversation. */
  onAsk?: (q: AskInput) => Promise<{ token?: string; createdAt?: string }>;
  /** The listener's messages (by the keys their browser keeps) with any replies. */
  onLoadMessages?: (tokens: string[]) => Promise<ChatMsg[]>;
  /** Ask my show: the AI's answer from the episodes. */
  onAskAi?: (question: string, history: { role: "user" | "assistant"; content: string }[]) => Promise<AiAnswer>;
  /** The page's own address, for sharing an episode. */
  shareBase: string;
}) {
  const t = data.theme;
  const dark = t.shade === "dark";
  const theirs = t.color.toLowerCase() === "#ffffff" && !dark ? "#053877" : t.color;
  // Buttons, bubbles and marks sit on the page, so they take a colour that shows on it.
  const accent = standOut(theirs, dark ? "#0b1020" : "#f5f6fa", dark);
  const ink = dark ? "#ffffff" : "#0b1020";
  const sub = dark ? "rgba(255,255,255,0.68)" : "rgba(11,16,32,0.62)";
  const card = dark ? "rgba(255,255,255,0.07)" : "#ffffff";
  const line = dark ? "rgba(255,255,255,0.12)" : "rgba(11,16,32,0.10)";
  const bg = t.template === "vibrant" ? `linear-gradient(180deg, ${theirs} 0%, ${dark ? "#0b1020" : "#f7f8fb"} 70%)` : dark ? "#0b1020" : "#f5f6fa";
  const radius = t.linkShape === "pill" ? 9999 : t.linkShape === "rounded" ? 14 : 4;
  const font = t.font === "serif" ? "Georgia, 'Times New Roman', serif" : t.font === "mono" ? "'JetBrains Mono', ui-monospace, monospace" : "var(--font-sans)";
  const btn = (primary = true): React.CSSProperties => t.linkStyle === "fill" && primary
    ? { background: accent, color: onColor(accent), borderRadius: radius }
    : t.linkStyle === "outline" ? { border: `2px solid ${accent}`, color: ink, borderRadius: radius, background: "transparent" }
    : { background: card, color: ink, borderRadius: radius, border: `1px solid ${line}`, boxShadow: dark ? "none" : "0 2px 10px rgba(11,16,32,0.06)" };
  const photo = data.heroUrl || data.avatarUrl;
  const [copied, setCopied] = useState<string | null>(null);
  const ev: Ev = (k, l) => { if (!preview) onEvent?.(k, l); };
  const [chat, setChat] = useState(false);

  const share = async (title: string, id: string) => {
    const url = `${shareBase}#ep-${id}`;
    ev("share", title);
    if (!preview && typeof navigator !== "undefined" && navigator.share) { try { await navigator.share({ title, url }); return; } catch { /* fall through to copy */ } }
    await navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(null), 1600);
  };

  // Their name, handle, bio and socials: on the page, or in white over their photo (hero).
  const who = (onPhoto: boolean) => (
    <>
      <h1 className={`text-balance font-bold leading-tight tracking-tight ${onPhoto ? "text-[34px]" : "text-[26px]"}`}>{data.displayName || "Your name"}</h1>
      <p className="mt-0.5 text-sm" style={{ color: onPhoto ? "rgba(255,255,255,0.8)" : sub }}>@{data.handle}{data.branch ? ` · ${data.branch}` : ""}</p>
      {data.bio && <p className="mx-auto mt-3 max-w-md whitespace-pre-line text-[15px] leading-relaxed" style={{ color: onPhoto ? "rgba(255,255,255,0.88)" : sub }}>{data.bio}</p>}
      {data.socials.length > 0 && (
        <div className="mt-4 flex flex-wrap justify-center gap-2.5">
          {data.socials.map((s) => (
            <a key={s.platform} href={preview ? undefined : s.url} target="_blank" rel="noreferrer" onClick={() => ev("click", s.platform)} aria-label={s.platform} className="flex h-10 w-10 items-center justify-center rounded-full text-white transition-transform hover:scale-110" style={{ background: platformBackground(s.platform as SocialPlatform), boxShadow: onPhoto ? "0 0 0 2px rgba(255,255,255,0.85)" : undefined }}>
              <PlatformIcon platform={s.platform as SocialPlatform} className="h-5 w-5" />
            </a>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div style={{ background: bg, color: ink, fontFamily: font, minHeight: "100%" }} className="relative pb-10" data-testid="bio-page">
      {data.askEnabled && (
        <>
          {chat && <div className={`${preview ? "absolute" : "fixed"} inset-0 z-20`} onClick={() => setChat(false)} aria-hidden />}
          <Chat handle={data.handle} name={data.displayName} avatar={data.avatarUrl} welcome={data.welcome} accent={accent} ink={ink} sub={sub} line={line} dark={dark} preview={preview} open={chat} setOpen={setChat} onAsk={onAsk} onLoad={onLoadMessages} />
        </>
      )}
      {/* The header: a wide cover photo (blend), full-screen photo with their name on it (hero),
          a banner with the photo over it (landscape), a shaped photo (shape) or a round one (portrait). */}
      {t.layout === "hero" && photo ? (
        <div className="relative flex min-h-[600px] flex-col justify-end" style={{ background: `center 20%/cover url(${photo})` }} data-testid="bio-hero-header">
          <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 70%, ${t.template === "vibrant" ? theirs : dark ? "#0b1020" : "rgba(0,0,0,0.85)"} 100%)` }} />
          <div className="relative mx-auto w-full max-w-[560px] px-5 pb-8 text-center text-white">{who(true)}</div>
        </div>
      ) : (
        <>
          {t.layout === "blend" && photo ? (
            <div className="relative">
              <img src={photo} alt="" className="h-[340px] w-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 h-40" style={{ background: `linear-gradient(to bottom, transparent, ${t.template === "vibrant" ? theirs : dark ? "#0b1020" : "#f5f6fa"})` }} />
            </div>
          ) : t.layout === "landscape" ? (
            <div className="relative">
              <div className="h-36 w-full" style={{ background: data.heroUrl ? `center/cover url(${data.heroUrl})` : `linear-gradient(135deg, ${theirs}, #000741)` }} />
              {data.avatarUrl && <img src={data.avatarUrl} alt="" className="absolute -bottom-12 left-1/2 h-24 w-24 -translate-x-1/2 rounded-full object-cover" style={{ boxShadow: `0 0 0 4px ${dark ? "#0b1020" : "#f5f6fa"}` }} />}
            </div>
          ) : t.layout === "shape" && data.avatarUrl ? (
            <div className="flex justify-center pt-12">
              <div className="relative h-44 w-44">
                <span className="absolute -inset-3 rotate-12" style={{ background: accent, borderRadius: "58% 42% 38% 62% / 45% 55% 45% 55%", opacity: 0.9 }} />
                <img src={data.avatarUrl} alt="" className="relative h-full w-full object-cover" style={{ borderRadius: "42% 58% 63% 37% / 52% 38% 62% 48%" }} />
              </div>
            </div>
          ) : (
            data.avatarUrl && <div className="flex justify-center pt-10"><img src={data.avatarUrl} alt="" className="h-28 w-28 rounded-full object-cover" style={{ boxShadow: `0 0 0 4px ${accent}` }} /></div>
          )}
          <div className={`mx-auto max-w-[560px] px-5 text-center ${t.layout === "blend" && photo ? "-mt-12 relative" : t.layout === "landscape" ? "pt-14" : t.layout === "shape" ? "pt-7" : "pt-4"}`}>{who(false)}</div>
        </>
      )}

      <div className="mx-auto mt-6 flex max-w-[560px] flex-col gap-4 px-4">
        {data.podcast && <PodcastCard p={data.podcast} style={t.podcastStyle ?? "spotlight"} full={(t.podcastFrame ?? "full") === "full"} fallbackArt={data.avatarUrl} accent={accent} ink={ink} sub={sub} card={card} line={line} radius={radius} preview={preview} ev={ev} share={share} copied={copied} />}
        {data.ai?.enabled && <AskShow name={data.displayName} episodes={data.ai.episodes} accent={accent} ink={ink} sub={sub} card={card} line={line} radius={radius} preview={preview} onAskAi={onAskAi} onMessage={data.askEnabled ? () => setChat(true) : undefined} />}
        {data.sections.map((s) => <Section key={s.id} s={s} btn={btn} ink={ink} sub={sub} card={card} line={line} accent={accent} preview={preview} ev={ev} />)}
        <p className="mt-4 text-center text-xs" style={{ color: sub }}><a href={preview ? undefined : "https://www.militaryvoices.ai"} className="hover:underline">Made with MilitaryVoices.ai</a></p>
      </div>
    </div>
  );
}

function PodcastCard({ p, style, full, fallbackArt, accent, ink, sub, card, line, radius, preview, ev, share, copied }: {
  p: NonNullable<BioPublic["podcast"]>; style: BioTheme["podcastStyle"]; full: boolean; fallbackArt: string; accent: string; ink: string; sub: string; card: string; line: string; radius: number; preview: boolean; ev: Ev; share: (title: string, id: string) => void; copied: string | null;
}) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [first, ...rest] = p.episodes;
  const now = p.episodes.find((e) => e.id === playing);
  const play = (id: string, title: string) => {
    if (preview) return;
    if (playing === id) { setPlaying(null); return; }
    setPlaying(id);
    ev("play", title);
  };
  type E = typeof first;
  const artOf = (e: E) => e.artworkUrl || p.artworkUrl || fallbackArt;
  const when = (e: E) => `${dateOf(e.publishedAt)}${e.durationSec ? ` · ${hms(e.durationSec)}` : ""}`;
  // The episode's picture, with its play button on it.
  const thumb = (e: E, cls: string, btn: "sm" | "lg") => (
    <button type="button" onClick={() => play(e.id, e.title)} aria-label={playing === e.id ? `Pause ${e.title}` : `Play ${e.title}`} className={`group relative shrink-0 overflow-hidden ${cls}`} style={{ background: artOf(e) ? `center/cover url(${artOf(e)})` : `linear-gradient(135deg, ${accent}, #000741)` }}>
      <span className="absolute inset-0 bg-black/10 transition-colors group-hover:bg-black/25" />
      <span className={`absolute flex items-center justify-center rounded-full shadow-lg ${btn === "lg" ? "bottom-3 left-3 h-12 w-12" : "inset-0 m-auto h-8 w-8"}`} style={{ background: accent, color: onColor(accent) }}>
        {playing === e.id ? <Pause className={`${btn === "lg" ? "h-5 w-5" : "h-3.5 w-3.5"} fill-current`} /> : <Play className={`${btn === "lg" ? "h-5 w-5" : "h-3.5 w-3.5"} translate-x-px fill-current`} />}
      </span>
    </button>
  );
  const shareBtn = (e: E) => (
    <button type="button" onClick={() => share(e.title, e.id)} aria-label={`Share ${e.title}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ color: sub }}>
      {copied === e.id ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
    </button>
  );
  const row = (e: E, i: number) => (
    <div key={e.id} id={`ep-${e.id}`} className="flex items-center gap-3 py-2.5" style={i ? { borderTop: `1px solid ${line}` } : {}}>
      {thumb(e, "h-14 w-14 rounded-xl", "sm")}
      <div className="min-w-0 flex-1 text-left">
        <p className="line-clamp-2 text-sm font-semibold leading-snug">{e.title}</p>
        <p className="text-xs" style={{ color: sub }}>{when(e)}</p>
      </div>
      {shareBtn(e)}
    </div>
  );
  return (
    // Full: edge to edge on the page, the latest's picture the full width. Card: in a box with a margin.
    <section className={`text-left ${full ? "-mx-4" : "overflow-hidden rounded-3xl"}`} style={full ? {} : { background: card, border: `1px solid ${line}` }} data-testid="bio-podcast">
      <div className="flex items-center gap-3 p-4 pb-3">
        {(p.artworkUrl || fallbackArt) && <img src={p.artworkUrl || fallbackArt} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold">{p.title}</p>
          <p className="text-xs" style={{ color: sub }}>{p.episodeCount} episode{p.episodeCount === 1 ? "" : "s"}</p>
        </div>
      </div>
      {first && style === "spotlight" && (
        <div className={full ? "" : "px-4"}>
          <div id={`ep-${first.id}`}>
            {thumb(first, `aspect-square w-full ${full ? "" : "rounded-2xl"}`, "lg")}
            <div className={`mt-3 flex items-start gap-2 ${full ? "px-4" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: accent }}>Latest episode</p>
                <p className="line-clamp-2 text-base font-bold leading-snug">{first.title}</p>
                <p className="text-xs" style={{ color: sub }}>{when(first)}</p>
              </div>
              {shareBtn(first)}
            </div>
          </div>
          {rest.length > 0 && <div className={`mt-2 ${full ? "mx-4" : ""}`} style={{ borderTop: `1px solid ${line}` }}>{rest.slice(0, 4).map((e, i) => row(e, i))}</div>}
        </div>
      )}
      {first && style === "list" && <div className="px-4">{p.episodes.slice(0, 6).map((e, i) => row(e, i))}</div>}
      {first && style === "carousel" && (
        <div className="flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {p.episodes.slice(0, 10).map((e, i) => (
            <div key={e.id} id={`ep-${e.id}`} className="w-[70%] shrink-0 snap-start">
              {thumb(e, "aspect-square w-full rounded-2xl", "lg")}
              <div className="mt-2 flex items-start gap-1">
                <div className="min-w-0 flex-1">
                  {i === 0 && <p className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: accent }}>Latest</p>}
                  <p className="line-clamp-2 text-sm font-semibold leading-snug">{e.title}</p>
                  <p className="text-xs" style={{ color: sub }}>{when(e)}</p>
                </div>
                {shareBtn(e)}
              </div>
            </div>
          ))}
        </div>
      )}
      {now && (
        <div className="mx-4 mt-3 rounded-2xl p-3" style={{ border: `1px solid ${line}` }}>
          <p className="mb-1 truncate text-xs font-semibold">{now.title}</p>
          <audio key={now.id} src={now.audio} autoPlay controls preload="none" className="w-full" onEnded={() => setPlaying(null)} />
        </div>
      )}
      <div className="flex flex-wrap gap-2 p-4 pt-2">
        {p.appleUrl && <a href={preview ? undefined : p.appleUrl} target="_blank" rel="noreferrer" onClick={() => ev("click", "Apple Podcasts")} className="px-3.5 py-2 text-xs font-semibold text-white" style={{ background: "#872EC4", borderRadius: radius }}>Apple Podcasts</a>}
        {p.spotifyUrl && <a href={preview ? undefined : p.spotifyUrl} target="_blank" rel="noreferrer" onClick={() => ev("click", "Spotify")} className="px-3.5 py-2 text-xs font-semibold text-black" style={{ background: "#1DB954", borderRadius: radius }}>Spotify</a>}
        {p.pageUrl && <a href={preview ? undefined : p.pageUrl} target="_blank" rel="noreferrer" onClick={() => ev("click", "All episodes")} className="px-3.5 py-2 text-xs font-semibold" style={{ border: `1px solid ${line}`, borderRadius: radius }}>All episodes</a>}
        <button type="button" onClick={() => { void navigator.clipboard?.writeText(p.feedUrl); ev("click", "RSS"); }} className="inline-flex items-center gap-1 px-3.5 py-2 text-xs font-semibold" style={{ border: `1px solid ${line}`, borderRadius: radius }}><Radio className="h-3.5 w-3.5" /> RSS <Copy className="h-3 w-3" style={{ color: sub }} /></button>
      </div>
    </section>
  );
}

function Section({ s, btn, ink, sub, card, line, accent, preview, ev }: { s: BioSection; btn: (primary?: boolean) => React.CSSProperties; ink: string; sub: string; card: string; line: string; accent: string; preview: boolean; ev: Ev }) {
  const [copied, setCopied] = useState(false);
  const title = s.title ? <p className="mb-2 mt-1 text-center text-xs font-bold uppercase tracking-[0.12em]" style={{ color: sub }}>{s.title}</p> : null;
  if (s.type === "links") return (
    <section>
      {title}
      <div className="flex flex-col gap-2.5">
        {s.links.filter((l) => l.url).map((l) => (
          <a key={l.id} href={preview ? undefined : l.url} target="_blank" rel="noreferrer" onClick={() => ev("click", l.label || l.url)} className="block px-5 py-3.5 text-center text-[15px] font-semibold transition-transform hover:scale-[1.015]" style={btn()}>{l.label || l.url}</a>
        ))}
      </div>
    </section>
  );
  if (s.type === "video") {
    const src = youtubeEmbed(s.url);
    return src ? <section>{title}<div className="aspect-video overflow-hidden rounded-2xl" style={{ border: `1px solid ${line}` }}><iframe src={src} title={s.title || "Video"} className="h-full w-full" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div></section> : null;
  }
  if (s.type === "promo") return (
    <section className="rounded-2xl p-4 text-center" style={{ background: card, border: `1px dashed ${accent}` }}>
      <p className="flex items-center justify-center gap-1.5 text-sm font-semibold"><Tag className="h-4 w-4" style={{ color: accent }} /> {s.title || "Promo code"}</p>
      {s.note && <p className="mt-1 text-sm" style={{ color: sub }}>{s.note}</p>}
      {s.code && <button type="button" onClick={() => { void navigator.clipboard?.writeText(s.code); setCopied(true); setTimeout(() => setCopied(false), 1500); ev("click", `Promo ${s.code}`); }} className="mt-2 inline-flex items-center gap-2 rounded-lg px-4 py-2 font-mono text-lg font-bold tracking-widest" style={{ background: `${accent}22`, color: ink }}>{s.code} {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button>}
      {s.url && <a href={preview ? undefined : s.url} target="_blank" rel="noreferrer" onClick={() => ev("click", s.title || "Promo")} className="mt-3 block px-4 py-2.5 text-sm font-semibold" style={btn()}>Shop now</a>}
    </section>
  );
  if (s.type === "meeting") return (
    <section className="rounded-2xl p-4 text-center" style={{ background: card, border: `1px solid ${line}` }}>
      <p className="flex items-center justify-center gap-1.5 text-sm font-semibold"><Calendar className="h-4 w-4" style={{ color: accent }} /> {s.title || "Book a time with me"}</p>
      {s.note && <p className="mt-1 text-sm" style={{ color: sub }}>{s.note}</p>}
      {s.url && <a href={preview ? undefined : s.url} target="_blank" rel="noreferrer" onClick={() => ev("click", "Booking")} className="mt-3 block px-4 py-2.5 text-sm font-semibold" style={btn()}>Pick a time</a>}
    </section>
  );
  if (s.type === "text") return <section className="rounded-2xl p-4 text-left" style={{ background: card, border: `1px solid ${line}` }}>{s.title && <p className="mb-1 font-semibold">{s.title}</p>}<p className="whitespace-pre-line text-sm leading-relaxed" style={{ color: sub }}>{s.body}</p></section>;
  return null;
}

/**
 * The chat button at the top of the page: a message to the podcaster, and
 * their reply back here (a badge on the button when one comes). The listener's
 * browser keeps the keys to their messages; the reply email carries one too.
 */
export function Chat({ handle, name, avatar, welcome = "", accent, ink, sub, line, dark, preview, open, setOpen, onAsk, onLoad, corner = false }: {
  handle: string; name: string; avatar: string; welcome?: string; accent: string; ink: string; sub: string; line: string; dark: boolean; preview: boolean;
  /** A bubble in the bottom corner (a page with its own top bar), not at the top. */
  corner?: boolean;
  open: boolean; setOpen: (v: boolean) => void; onAsk?: (q: AskInput) => Promise<{ token?: string; createdAt?: string }>; onLoad?: (tokens: string[]) => Promise<ChatMsg[]>;
}) {
  type Kept = { tokens?: string[]; seen?: string; name?: string; email?: string };
  const key = `mv_chat_${handle}`;
  const [kept, setKept] = useState<Kept>(() => { if (preview) return {}; try { return JSON.parse(localStorage.getItem(key) || "{}") as Kept; } catch { return {}; } });
  const keep = (x: Kept) => setKept((k) => { const n = { ...k, ...x }; try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* this visit only */ } return n; });
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [who, setWho] = useState({ name: kept.name ?? "", email: kept.email ?? "", website: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const end = useRef<HTMLDivElement | null>(null);
  const them = name || "They";

  // From the reply email: #chat=<key> adds the conversation and opens it. From their Message me link: #message opens it.
  useEffect(() => {
    if (preview) return;
    if (window.location.hash === "#message") { setOpen(true); history.replaceState(null, "", window.location.pathname + window.location.search); return; }
    const m = window.location.hash.match(/^#chat=([A-Za-z0-9_-]{20,40})$/);
    if (!m) return;
    setKept((k) => { const n = { ...k, tokens: Array.from(new Set([...(k.tokens ?? []), m[1]])).slice(-30) }; try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* fine */ } return n; });
    setOpen(true);
    history.replaceState(null, "", window.location.pathname + window.location.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const tokens = (kept.tokens ?? []).join(",");
  const loader = useRef(onLoad);
  loader.current = onLoad;
  const load = useCallback(async () => {
    if (preview || !loader.current || !tokens) return;
    try { setMsgs(await loader.current(tokens.split(","))); } catch { /* try again later */ }
  }, [preview, tokens]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!open) return;
    void load();
    const t = setInterval(() => void load(), 20000);
    return () => clearInterval(t);
  }, [open, load]);
  const latest = msgs.reduce((m, x) => (x.repliedAt > m ? x.repliedAt : m), "");
  const unread = msgs.filter((x) => x.repliedAt && x.repliedAt > (kept.seen ?? "")).length;
  useEffect(() => { if (open && latest && latest > (kept.seen ?? "")) keep({ seen: latest }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, latest]);
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: "end" }); }, [open, msgs.length]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, setOpen]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (preview || !onAsk || busy) return;
    const q = text.trim();
    if (q.length < 5) { setErr("Write a little more first."); return; }
    setBusy(true); setErr("");
    try {
      const r = await onAsk({ name: who.name, email: who.email, question: q, episode: "", website: who.website });
      if (r.token) {
        setMsgs((m) => [...m, { token: r.token!, question: q, reply: "", repliedAt: "", createdAt: r.createdAt ?? new Date().toISOString() }]);
        keep({ tokens: [...(kept.tokens ?? []), r.token].slice(-30), name: who.name, email: who.email });
      }
      setText("");
    } catch (x) {
      setErr((x as Error).message);
    } finally { setBusy(false); }
  };

  const panel = dark ? "#151b2f" : "#ffffff";
  const field = { background: "transparent", border: `1px solid ${line}`, color: ink, borderRadius: 12 };
  const face = (size: string) => avatar
    ? <img src={avatar} alt="" className={`${size} shrink-0 rounded-full object-cover`} />
    : <span className={`${size} flex shrink-0 items-center justify-center rounded-full text-xs font-bold`} style={{ background: accent, color: onColor(accent) }}>{(name || "?").slice(0, 1)}</span>;
  return (
    <div className={corner ? "fixed bottom-5 right-5 z-40" : "sticky top-0 z-30 h-0"}>
      <div className={corner ? "relative" : "relative mx-auto flex max-w-[560px] justify-end p-3"}>
        <button type="button" onClick={() => setOpen(!open)} aria-label={unread ? `${unread} new ${unread === 1 ? "reply" : "replies"}` : "Send message"} aria-expanded={open}
          className={`group relative flex items-center justify-center rounded-full shadow-lg ring-2 transition-transform hover:scale-105 ${corner ? "h-14 w-14" : "h-11 w-11"}`}
          style={{ background: accent, color: onColor(accent), ["--tw-ring-color" as string]: dark ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.9)" }} data-testid="bio-chat">
          {open ? <X className={corner ? "h-6 w-6" : "h-5 w-5"} /> : <MessageCircle className={corner ? "h-6 w-6" : "h-5 w-5"} />}
          {unread > 0 && !open && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ef4444] px-1 text-[11px] font-bold text-white ring-2 ring-white" data-testid="bio-chat-badge">{unread}</span>}
          {!open && <span className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-full bg-[#0b1020] px-2.5 py-1 text-xs font-semibold text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100">{unread ? `${unread} new ${unread === 1 ? "reply" : "replies"}` : "Send message"}</span>}
        </button>
        {open && (
          <div className={`absolute flex max-h-[70vh] flex-col ${corner ? "bottom-[4.5rem] right-0 w-[min(22rem,calc(100vw-2.5rem))]" : "left-3 right-3 top-16 ml-auto max-w-[22rem]"} overflow-hidden rounded-3xl text-left shadow-2xl`} style={{ background: panel, color: ink, border: `1px solid ${line}` }} role="dialog" aria-label={`Message ${name}`} data-testid="bio-chat-panel">
            <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: `1px solid ${line}` }}>
              {face("h-9 w-9")}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">Message {name || "me"}</p>
                <p className="truncate text-[11px]" style={{ color: sub }}>Replies show up right here</p>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
              {welcome && (
                <div className="mr-8 flex items-end gap-2">
                  {face("h-6 w-6")}
                  <p className="whitespace-pre-line rounded-2xl rounded-bl-md px-3 py-2 text-sm" style={{ background: dark ? "rgba(255,255,255,0.08)" : "#f1f3f8" }}>{welcome}</p>
                </div>
              )}
              {msgs.length === 0 ? (
                <p className="py-1 text-[11px] leading-relaxed" style={{ color: sub }}>{them} will see your message, and the reply shows up here (and by email, if you leave yours).</p>
              ) : msgs.map((m) => (
                <div key={m.token} className="flex flex-col gap-2">
                  <p className="ml-10 self-end whitespace-pre-line rounded-2xl rounded-br-md px-3 py-2 text-sm" style={{ background: accent, color: onColor(accent) }}>{m.question}</p>
                  {m.reply ? (
                    <div className="mr-8 flex items-end gap-2">
                      {face("h-6 w-6")}
                      <p className="whitespace-pre-line rounded-2xl rounded-bl-md px-3 py-2 text-sm" style={{ background: dark ? "rgba(255,255,255,0.08)" : "#f1f3f8" }}>{m.reply}</p>
                    </div>
                  ) : <p className="self-end text-[11px]" style={{ color: sub }}>Sent. The reply shows up here.</p>}
                </div>
              ))}
              <div ref={end} />
            </div>
            <form onSubmit={send} className="flex flex-col gap-2 px-4 pb-4 pt-3" style={{ borderTop: `1px solid ${line}` }}>
              <textarea value={text} onChange={(e) => { setText(e.target.value); setErr(""); }} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(e); } }} rows={2} maxLength={1500} placeholder={msgs.length ? "Write another message" : "Write your message"} className="w-full resize-none px-3 py-2 text-sm outline-none" style={field} data-testid="bio-chat-text" />
              {!(kept.tokens?.length) && (
                <div className="grid grid-cols-2 gap-2">
                  <input value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} placeholder="Your name" autoComplete="name" className="h-10 min-w-0 px-3 text-sm outline-none" style={field} />
                  <input value={who.email} onChange={(e) => setWho({ ...who, email: e.target.value })} type="email" placeholder="Email (optional)" autoComplete="email" className="h-10 min-w-0 px-3 text-sm outline-none" style={field} />
                </div>
              )}
              <input value={who.website} onChange={(e) => setWho({ ...who, website: e.target.value })} tabIndex={-1} autoComplete="off" aria-hidden className="hidden" name="website" />
              {err && <p className="text-xs text-red-500">{err}</p>}
              <button type="submit" disabled={busy} className="inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold disabled:opacity-60" style={{ background: accent, color: onColor(accent) }} data-testid="bio-chat-send"><Send className="h-4 w-4" /> {busy ? "Sending…" : "Send"}</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Ask my show: listeners ask, the show's AI answers from what was said on it,
 * with the episode and minute to press play on. What it can't find, it points
 * to the chat button, which goes to the host.
 */
function AskShow({ name, episodes, accent, ink, sub, card, line, radius, preview, onAskAi, onMessage }: { name: string; episodes: number; accent: string; ink: string; sub: string; card: string; line: string; radius: number; preview: boolean; onAskAi?: (q: string, h: { role: "user" | "assistant"; content: string }[]) => Promise<AiAnswer>; onMessage?: () => void }) {
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<({ role: "user"; content: string } | ({ role: "assistant"; content: string } & Partial<AiAnswer>))[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const player = useRef<HTMLAudioElement | null>(null);
  const [src, setSrc] = useState<{ url: string; at: number; title: string } | null>(null);
  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = q.trim();
    if (preview || !onAskAi || text.length < 4 || busy) return;
    setBusy(true); setErr(""); setQ("");
    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((x) => [...x, { role: "user", content: text }]);
    try {
      const a = await onAskAi(text, history);
      setTurns((x) => [...x, { role: "assistant", content: a.answer, ...a }]);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const playAt = (url: string, at: number, title: string) => {
    setSrc({ url, at, title });
    setTimeout(() => { const a = player.current; if (!a) return; a.currentTime = at; void a.play().catch(() => {}); }, 150);
  };
  const clean = (s: string) => s.replace(/\s*\[\d+\]/g, "");
  return (
    <section className="rounded-3xl p-4 text-left" style={{ background: card, border: `1px solid ${line}` }} data-testid="bio-ask-ai">
      <p className="flex items-center gap-2 text-base font-bold"><Sparkles className="h-5 w-5" style={{ color: accent }} /> Ask the show</p>
      <p className="mt-0.5 text-xs" style={{ color: sub }}>An AI that has listened to {episodes} episode{episodes === 1 ? "" : "s"} of {name || "this show"}. It answers from what was said, and shows you where.</p>
      {turns.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {turns.map((t, i) => t.role === "user" ? (
            <p key={i} className="ml-8 self-end rounded-2xl px-3 py-2 text-sm" style={{ background: `${accent}26`, color: ink }}>{t.content}</p>
          ) : (
            <div key={i} className="mr-4 rounded-2xl px-3 py-2 text-sm leading-relaxed" style={{ border: `1px solid ${line}` }}>
              <p className="whitespace-pre-line">{clean(t.content)}</p>
              {t.unanswered && onMessage && (
                <button type="button" onClick={onMessage} className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold" style={{ background: accent, color: onColor(accent) }}><MessageCircle className="h-3.5 w-3.5" /> Send {name || "them"} a message</button>
              )}
              {(t.sources?.length ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {t.sources!.map((s) => (
                    <button key={s.n} type="button" onClick={() => playAt(s.audio, s.startSec, s.title)} className="inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: `${accent}22`, color: ink }}>
                      <Play className="h-3 w-3 shrink-0 fill-current" /> <span className="truncate">{s.title}</span> <span style={{ color: sub }}>{s.at}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && <p className="text-xs" style={{ color: sub }}>Listening back…</p>}
        </div>
      )}
      {src && (
        <div className="mt-3">
          <p className="mb-1 truncate text-xs font-semibold">{src.title}</p>
          <audio ref={player} src={src.url} controls preload="none" className="w-full" />
        </div>
      )}
      <form onSubmit={ask} className="mt-3 flex gap-2">
        <input value={q} onChange={(e) => { setQ(e.target.value); setErr(""); }} maxLength={500} placeholder={turns.length ? "Ask a follow-up" : "What did they say about…?"} className="h-11 min-w-0 flex-1 px-3 text-sm outline-none" style={{ background: "transparent", border: `1px solid ${line}`, color: ink, borderRadius: 12 }} />
        <button type="submit" disabled={busy || q.trim().length < 4} aria-label="Ask" className="flex h-11 w-11 shrink-0 items-center justify-center disabled:opacity-50" style={{ background: accent, color: onColor(accent), borderRadius: Math.min(radius, 14) }}><Send className="h-4 w-4" /></button>
      </form>
      {err && <p className="mt-1 text-xs text-red-500">{err}</p>}
    </section>
  );
}
