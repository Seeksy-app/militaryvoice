import { useRef, useState } from "react";
import { Calendar, Check, Copy, MessageCircleQuestion, Pause, Play, Radio, Send, Share2, Tag } from "lucide-react";
import { PlatformIcon, platformBackground } from "@/components/SocialIcons";
import type { BioPublic, BioSection } from "@shared/bio";
import type { SocialPlatform } from "@shared/schema";

/**
 * A podcaster's bio page, drawn from its data alone: the builder's preview
 * and the public page are this same component, so they can never disagree.
 * The show sits top and centre: the latest episode to play and share, the
 * rest below it, then their links, then a box for a listener's question.
 */

type Ev = (kind: "view" | "click" | "play" | "share", label?: string) => void;

const hms = (sec: number) => { const s = Math.round(sec); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const dateOf = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
/** Black or white text, whichever reads on this colour. */
function onColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? "#0b1020" : "#ffffff";
}
const youtubeEmbed = (u: string) => {
  const m = u.match(/(?:youtu\.be\/|v=|shorts\/|embed\/|live\/)([\w-]{11})/);
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  const v = u.match(/vimeo\.com\/(\d+)/);
  return v ? `https://player.vimeo.com/video/${v[1]}` : "";
};

export function BioPageView({ data, preview = false, onEvent, onAsk, shareBase }: {
  data: BioPublic;
  /** In the builder: nothing is counted, nothing is sent. */
  preview?: boolean;
  onEvent?: Ev;
  onAsk?: (q: { name: string; email: string; question: string; episode: string; website: string }) => Promise<void>;
  /** The page's own address, for sharing an episode. */
  shareBase: string;
}) {
  const t = data.theme;
  const dark = t.shade === "dark";
  const accent = t.color.toLowerCase() === "#ffffff" && !dark ? "#053877" : t.color;
  const ink = dark ? "#ffffff" : "#0b1020";
  const sub = dark ? "rgba(255,255,255,0.68)" : "rgba(11,16,32,0.62)";
  const card = dark ? "rgba(255,255,255,0.07)" : "#ffffff";
  const line = dark ? "rgba(255,255,255,0.12)" : "rgba(11,16,32,0.10)";
  const bg = t.template === "vibrant" ? `linear-gradient(180deg, ${accent} 0%, ${dark ? "#0b1020" : "#f7f8fb"} 70%)` : dark ? "#0b1020" : "#f5f6fa";
  const radius = t.linkShape === "pill" ? 9999 : t.linkShape === "rounded" ? 14 : 4;
  const font = t.font === "serif" ? "Georgia, 'Times New Roman', serif" : t.font === "mono" ? "'JetBrains Mono', ui-monospace, monospace" : "var(--font-sans)";
  const btn = (primary = true): React.CSSProperties => t.linkStyle === "fill" && primary
    ? { background: accent, color: onColor(accent), borderRadius: radius }
    : t.linkStyle === "outline" ? { border: `2px solid ${accent}`, color: ink, borderRadius: radius, background: "transparent" }
    : { background: card, color: ink, borderRadius: radius, border: `1px solid ${line}`, boxShadow: dark ? "none" : "0 2px 10px rgba(11,16,32,0.06)" };
  const photo = data.heroUrl || data.avatarUrl;
  const [copied, setCopied] = useState<string | null>(null);
  const ev: Ev = (k, l) => { if (!preview) onEvent?.(k, l); };

  const share = async (title: string, id: string) => {
    const url = `${shareBase}#ep-${id}`;
    ev("share", title);
    if (!preview && typeof navigator !== "undefined" && navigator.share) { try { await navigator.share({ title, url }); return; } catch { /* fall through to copy */ } }
    await navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(null), 1600);
  };

  return (
    <div style={{ background: bg, color: ink, fontFamily: font, minHeight: "100%" }} className="pb-10" data-testid="bio-page">
      {/* The header: their photo as a wide cover (blend), a banner with the photo over it (landscape), or a round photo (portrait). */}
      {t.layout === "blend" && photo ? (
        <div className="relative">
          <img src={photo} alt="" className="h-[340px] w-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 h-40" style={{ background: `linear-gradient(to bottom, transparent, ${t.template === "vibrant" ? accent : dark ? "#0b1020" : "#f5f6fa"})` }} />
        </div>
      ) : t.layout === "landscape" ? (
        <div className="relative">
          <div className="h-36 w-full" style={{ background: data.heroUrl ? `center/cover url(${data.heroUrl})` : `linear-gradient(135deg, ${accent}, #000741)` }} />
          {data.avatarUrl && <img src={data.avatarUrl} alt="" className="absolute -bottom-12 left-1/2 h-24 w-24 -translate-x-1/2 rounded-full object-cover" style={{ boxShadow: `0 0 0 4px ${dark ? "#0b1020" : "#f5f6fa"}` }} />}
        </div>
      ) : (
        data.avatarUrl && <div className="flex justify-center pt-10"><img src={data.avatarUrl} alt="" className="h-28 w-28 rounded-full object-cover" style={{ boxShadow: `0 0 0 4px ${accent}` }} /></div>
      )}

      <div className={`mx-auto max-w-[560px] px-5 text-center ${t.layout === "blend" && photo ? "-mt-12 relative" : t.layout === "landscape" ? "pt-14" : "pt-4"}`}>
        <h1 className="text-balance text-[26px] font-bold leading-tight tracking-tight">{data.displayName || "Your name"}</h1>
        <p className="mt-0.5 text-sm" style={{ color: sub }}>@{data.handle}{data.branch ? ` · ${data.branch}` : ""}</p>
        {data.bio && <p className="mx-auto mt-3 max-w-md whitespace-pre-line text-[15px] leading-relaxed" style={{ color: sub }}>{data.bio}</p>}
        {data.socials.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-2.5">
            {data.socials.map((s) => (
              <a key={s.platform} href={preview ? undefined : s.url} target="_blank" rel="noreferrer" onClick={() => ev("click", s.platform)} aria-label={s.platform} className="flex h-10 w-10 items-center justify-center rounded-full text-white transition-transform hover:scale-110" style={{ background: platformBackground(s.platform as SocialPlatform) }}>
                <PlatformIcon platform={s.platform as SocialPlatform} className="h-5 w-5" />
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="mx-auto mt-6 flex max-w-[560px] flex-col gap-4 px-4">
        {data.podcast && <PodcastCard p={data.podcast} accent={accent} ink={ink} sub={sub} card={card} line={line} radius={radius} preview={preview} ev={ev} share={share} copied={copied} />}
        {data.sections.map((s) => <Section key={s.id} s={s} btn={btn} ink={ink} sub={sub} card={card} line={line} accent={accent} preview={preview} ev={ev} />)}
        {data.askEnabled && <AskBox name={data.displayName} episodes={data.podcast?.episodes.map((e) => e.title) ?? []} accent={accent} ink={ink} sub={sub} card={card} line={line} radius={radius} preview={preview} onAsk={onAsk} />}
        <p className="mt-4 text-center text-xs" style={{ color: sub }}><a href={preview ? undefined : "https://www.militaryvoices.ai"} className="hover:underline">Made with MilitaryVoices.ai</a></p>
      </div>
    </div>
  );
}

function PodcastCard({ p, accent, ink, sub, card, line, radius, preview, ev, share, copied }: {
  p: NonNullable<BioPublic["podcast"]>; accent: string; ink: string; sub: string; card: string; line: string; radius: number; preview: boolean; ev: Ev; share: (title: string, id: string) => void; copied: string | null;
}) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [first, ...rest] = p.episodes;
  const audio = useRef<HTMLAudioElement | null>(null);
  const play = (id: string, title: string) => {
    if (preview) return;
    if (playing === id) { audio.current?.pause(); setPlaying(null); return; }
    setPlaying(id);
    ev("play", title);
  };
  const row = (e: typeof first, big = false) => (
    <div key={e.id} id={`ep-${e.id}`} className={`flex items-center gap-3 ${big ? "" : "py-3"}`} style={big ? {} : { borderTop: `1px solid ${line}` }}>
      <button type="button" onClick={() => play(e.id, e.title)} aria-label={playing === e.id ? `Pause ${e.title}` : `Play ${e.title}`} className={`flex shrink-0 items-center justify-center rounded-full ${big ? "h-12 w-12" : "h-9 w-9"}`} style={big ? { background: accent, color: onColor(accent) } : { border: `1.5px solid ${line}`, color: ink }}>
        {playing === e.id ? <Pause className={`${big ? "h-5 w-5" : "h-3.5 w-3.5"} fill-current`} /> : <Play className={`${big ? "h-5 w-5" : "h-3.5 w-3.5"} translate-x-px fill-current`} />}
      </button>
      <div className="min-w-0 flex-1 text-left">
        {big && <p className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: accent }}>Latest episode</p>}
        <p className={`${big ? "text-base" : "text-sm"} line-clamp-2 font-semibold leading-snug`}>{e.title}</p>
        <p className="text-xs" style={{ color: sub }}>{dateOf(e.publishedAt)}{e.durationSec ? ` · ${hms(e.durationSec)}` : ""}</p>
      </div>
      <button type="button" onClick={() => share(e.title, e.id)} aria-label={`Share ${e.title}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ color: sub }}>
        {copied === e.id ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
      </button>
    </div>
  );
  return (
    <section className="overflow-hidden rounded-3xl text-left" style={{ background: card, border: `1px solid ${line}` }} data-testid="bio-podcast">
      <div className="flex items-center gap-3 p-4" style={{ borderBottom: `1px solid ${line}` }}>
        {p.artworkUrl && <img src={p.artworkUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold">{p.title}</p>
          <p className="text-xs" style={{ color: sub }}>{p.episodeCount} episode{p.episodeCount === 1 ? "" : "s"}</p>
        </div>
      </div>
      {first && (
        <div className="p-4">
          {row(first, true)}
          {playing === first.id && <audio ref={audio} src={first.audio} autoPlay controls preload="none" className="mt-3 w-full" onEnded={() => setPlaying(null)} />}
        </div>
      )}
      {rest.length > 0 && (
        <div className="px-4 pb-2">
          {rest.slice(0, 4).map((e) => (
            <div key={e.id}>
              {row(e)}
              {playing === e.id && <audio src={e.audio} autoPlay controls preload="none" className="mb-3 w-full" onEnded={() => setPlaying(null)} />}
            </div>
          ))}
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

/** A question for the podcaster: it lands in their inbox (and their reply comes straight back). */
function AskBox({ name, episodes, accent, ink, sub, card, line, radius, preview, onAsk }: { name: string; episodes: string[]; accent: string; ink: string; sub: string; card: string; line: string; radius: number; preview: boolean; onAsk?: (q: { name: string; email: string; question: string; episode: string; website: string }) => Promise<void> }) {
  const [q, setQ] = useState({ name: "", email: "", question: "", episode: "", website: "" });
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState("");
  const field = { background: "transparent", border: `1px solid ${line}`, color: ink, borderRadius: 12 };
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (preview || !onAsk) return;
    if (q.question.trim().length < 5) { setErr("Write your question first."); return; }
    setState("sending"); setErr("");
    try { await onAsk(q); setState("sent"); } catch (x) { setState("error"); setErr((x as Error).message); }
  };
  return (
    <section className="rounded-3xl p-4 text-left" style={{ background: card, border: `1px solid ${line}` }} data-testid="bio-ask">
      <p className="flex items-center gap-2 text-base font-bold"><MessageCircleQuestion className="h-5 w-5" style={{ color: accent }} /> Ask {name || "me"} a question</p>
      {state === "sent" ? (
        <p className="mt-2 text-sm" style={{ color: sub }}>Sent. {q.email ? "You'll get the answer by email." : "Listen out for it on the show."}</p>
      ) : (
        <form onSubmit={send} className="mt-3 flex flex-col gap-2">
          <textarea value={q.question} onChange={(e) => { setQ({ ...q, question: e.target.value }); setErr(""); }} rows={3} maxLength={1500} placeholder="What would you like to know?" className="w-full resize-none px-3 py-2 text-sm outline-none" style={field} />
          {episodes.length > 0 && (
            <select value={q.episode} onChange={(e) => setQ({ ...q, episode: e.target.value })} className="h-10 w-full px-3 text-sm outline-none" style={field}>
              <option value="">About the show in general</option>
              {episodes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <div className="grid grid-cols-2 gap-2">
            <input value={q.name} onChange={(e) => setQ({ ...q, name: e.target.value })} placeholder="Your name (optional)" className="h-10 px-3 text-sm outline-none" style={field} />
            <input value={q.email} onChange={(e) => setQ({ ...q, email: e.target.value })} type="email" placeholder="Email, for a reply" className="h-10 px-3 text-sm outline-none" style={field} />
          </div>
          <input value={q.website} onChange={(e) => setQ({ ...q, website: e.target.value })} tabIndex={-1} autoComplete="off" aria-hidden className="hidden" name="website" />
          {err && <p className="text-xs text-red-500">{err}</p>}
          <button type="submit" disabled={state === "sending"} className="mt-1 inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold" style={{ background: accent, color: onColor(accent), borderRadius: radius }}><Send className="h-4 w-4" /> {state === "sending" ? "Sending…" : "Send question"}</button>
        </form>
      )}
    </section>
  );
}
