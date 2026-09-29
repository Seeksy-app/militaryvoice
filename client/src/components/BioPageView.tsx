import { useCallback, useEffect, useRef, useState } from "react";
import { Calendar, Check, Copy, ExternalLink, Mail, MessageCircle, Music, Pause, Play, Radio, Send, Share2, Sparkles, Tag, X } from "lucide-react";
import { PlatformIcon, platformBackground } from "@/components/SocialIcons";
import { CUTOUT_LAYOUTS, DEFAULT_PODCAST, FONTS, bioPalette, musicEmbed, onColor, promoCodes, standOut, videoEmbed, type BioChatAt, type BioPodcastOptions, type BioPopup, type BioPublic, type BioSection, type BioTheme } from "@shared/bio";
import { useBioFont } from "@/lib/bioFont";
import type { SocialPlatform } from "@shared/schema";

/**
 * A podcaster's bio page, drawn from its data alone: the builder's preview
 * and the public page are this same component, so they can never disagree.
 * The show sits top and centre: the latest episode to play and share, the
 * rest below it, then their links; a chat button in the bottom corner for a
 * message to them, and on each episode one to ask the show's AI about it.
 */

/** The page's "For brands" link, off while the media kit is "Coming soon" in the builder. */
const BRANDS_LIVE = false;

type Ev = (kind: "view" | "click" | "play" | "share", label?: string) => void;

const hms = (sec: number) => { const s = Math.round(sec); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const dateOf = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
export { onColor, standOut };

export type AiAnswer = { answer: string; sources: { n: number; title: string; startSec: number; audio: string; at: string }[]; unanswered: boolean };

export type ChatMsg = { token: string; question: string; reply: string; repliedAt: string; createdAt: string };
type AskInput = { name: string; email: string; question: string; episode: string; website: string };

export function BioPageView({ data, preview = false, onEvent, onAsk, onAskAi, onLoadMessages, onSubscribe, shareBase, popupPeek = false, onPopupClose }: {
  data: BioPublic;
  /** In the builder: nothing is counted, nothing is sent. */
  preview?: boolean;
  onEvent?: Ev;
  /** A message to the podcaster; the token is the listener's key to the conversation. */
  onAsk?: (q: AskInput) => Promise<{ token?: string; createdAt?: string }>;
  /** The listener's messages (by the keys their browser keeps) with any replies. */
  onLoadMessages?: (tokens: string[]) => Promise<ChatMsg[]>;
  /** Ask my show: the AI's answer from the episodes. */
  onAskAi?: (question: string, history: { role: "user" | "assistant"; content: string }[], episode?: string) => Promise<AiAnswer>;
  /** The page's own address, for sharing an episode. */
  shareBase: string;
  /** Stay in touch: a listener's email, to the podcaster's Contacts. */
  onSubscribe?: (x: { email: string; name: string; website: string }) => Promise<void>;
  /** The builder showing their pop-up while they edit it. */
  popupPeek?: boolean;
  onPopupClose?: () => void;
}) {
  const t = data.theme;
  // The page's colours, from the theme (shade, background, their colour, the link colour); see bioPalette.
  const pal = bioPalette(t);
  const { dark, ink, sub, card, line, accent, link, font, radius } = pal;
  const bg = pal.background;
  useBioFont(t.font);
  useBioFont(t.layout === "magazine" ? "playfair" : t.font);
  const btn = (primary = true): React.CSSProperties => t.linkStyle === "fill" && primary
    ? { background: link, color: onColor(link), borderRadius: radius }
    : t.linkStyle === "outline" ? { border: `2px solid ${link}`, color: ink, borderRadius: radius, background: "transparent" }
    : t.linkStyle === "hard" ? { background: dark ? "#141a2c" : "#ffffff", color: ink, borderRadius: radius, border: `2px solid ${dark ? "rgba(255,255,255,0.85)" : "#0b1020"}`, boxShadow: `4px 4px 0 ${link}` }
    : { background: card, color: ink, borderRadius: radius, border: `1px solid ${line}`, boxShadow: dark ? "0 6px 18px rgba(0,0,0,0.35)" : "0 6px 18px rgba(11,16,32,0.10)" };
  const [copied, setCopied] = useState<string | null>(null);
  const ev: Ev = (k, l) => { if (!preview) onEvent?.(k, l); };
  const [chat, setChat] = useState(false);
  // The episode a listener is asking the show's AI about (its sheet slides up from the bottom).
  const [askEp, setAskEp] = useState<{ id: string; title: string } | null>(null);
  const noName = t.hideName ?? false;
  const chatAt = t.chatAt ?? "top-right";
  const chatTop = chatAt === "top-left" || chatAt === "top-right" || chatAt === "socials";
  // The talking intro where they put it, moved across if the chat has that corner.
  const introWant = t.introAt ?? "bottom-left";
  const introAt = data.askEnabled && introWant === chatAt ? (introWant.endsWith("left") ? introWant.replace("left", "right") : introWant.replace("right", "left")) as typeof introWant : introWant;
  const showIntro = Boolean(t.intro && data.introUrl);
  const intro = (spot: "top" | "bottom" | "bio") => showIntro && !askEp && (spot === "bio" ? introAt === "bio" : introAt.startsWith(spot)) && <IntroBubble src={data.introUrl!} name={data.displayName} handle={data.handle} says={t.introSay} back={t.introBack} accent={accent} at={introAt} preview={preview} onPlay={() => ev("play", "Talking intro")} />;

  const share = async (title: string, id: string) => {
    const url = `${shareBase}#ep-${id}`;
    ev("share", title);
    if (!preview && typeof navigator !== "undefined" && navigator.share) { try { await navigator.share({ title, url }); return; } catch { /* fall through to copy */ } }
    await navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(null), 1600);
  };


  // Their name, handle, bio and socials: on the page, or in white over their photo (hero).
  const who = (onPhoto: boolean, hideName = false) => (
    <>
      {!hideName && !noName && <h1 className="text-balance font-bold leading-tight tracking-tight" style={{ fontSize: Math.round((onPhoto ? 34 : 26) * (t.nameSize ?? 100) / 100) }}>{data.displayName || "Your name"}</h1>}
      {t.socialsFirst && <SocialRow socials={data.socials} onPhoto={onPhoto} preview={preview} onTap={(p) => ev("click", p)} onChat={data.askEnabled && chatAt === "socials" ? () => setChat(true) : undefined} chatColor={accent} />}
      {data.bio && !t.hideBio && <p className="mx-auto mt-3 max-w-md whitespace-pre-line text-[15px] leading-relaxed" style={{ color: onPhoto ? "rgba(255,255,255,0.88)" : sub }}>{styled(data.bio)}</p>}
      {intro("bio")}
      {!t.socialsFirst && <SocialRow socials={data.socials} onPhoto={onPhoto} preview={preview} onTap={(p) => ev("click", p)} onChat={data.askEnabled && chatAt === "socials" ? () => setChat(true) : undefined} chatColor={accent} />}
    </>
  );

  return (
    <div style={{ background: bg, color: ink, fontFamily: font, minHeight: "100%" }} className="relative flex flex-col pb-6" data-testid="bio-page">
      {/* The chat at the top of the page (a top corner, or opened from their social icons) rides the top of the screen. */}
      {intro("top")}
      {data.askEnabled && chatTop && <Chat handle={data.handle} name={data.displayName} avatar={data.avatarUrl} welcome={data.welcome} accent={accent} ink={ink} sub={sub} line={line} dark={dark} preview={preview} open={chat} setOpen={setChat} onAsk={onAsk} onLoad={onLoadMessages} at={chatAt} />}
      <PageTop t={t} avatar={data.avatarUrl} hero={data.heroUrl} cutoutUrl={data.cutoutUrl} living={LIVING_ON && t.living ? data.livingUrl : ""} name={noName ? "" : data.displayName || "Your name"} handle={data.handle} latest={data.podcast?.episodes[0]?.title}>{who}</PageTop>

      <div className="mx-auto mt-6 flex max-w-[560px] flex-col gap-4 px-4">
        {/* Their blocks in their order; the podcast is one of them (they add it from Content). */}
        {data.sections.map((s) => s.type === "podcast" ? (data.podcast ? <PodcastCard key={s.id} p={data.podcast} onAsk={data.ai?.enabled ? setAskEp : undefined} opts={{ ...DEFAULT_PODCAST, ...(t.podcast ?? {}) }} style={t.podcastStyle ?? "spotlight"} full={(t.podcastFrame ?? "full") === "full"} fallbackArt={data.avatarUrl} accent={accent} ink={ink} sub={sub} card={card} line={line} radius={radius} preview={preview} ev={ev} share={share} copied={copied} /> : null) : <Section key={s.id} s={s} btn={btn} ink={ink} sub={sub} card={card} line={line} accent={accent} preview={preview} ev={ev} handle={data.handle} onSubscribe={onSubscribe} />)}
        {BRANDS_LIVE && data.brandsOn && <p className="mt-2 text-center text-xs" style={{ color: sub }}><a href={preview ? undefined : `/${data.handle}/brands`} className="font-semibold hover:underline" data-testid="bio-for-brands">For brands: sponsor this show</a></p>}
      </div>
      {/* At the foot of the screen, however short the page: it reads as the page's footer, not part of their icons. */}
      {(t.branding ?? true) && <p className="mt-auto pt-12 text-center text-xs" style={{ color: sub }}><a href={preview ? undefined : "https://www.militaryvoices.ai"} className="hover:underline">Made with MilitaryVoices.ai</a></p>}
      {t.popup && t.popup.kind !== "none" && <PagePopup p={t.popup} handle={data.handle} preview={preview} peek={popupPeek} onPeekClose={onPopupClose} solid={dark ? "#141a2c" : "#ffffff"} ink={ink} sub={sub} card={card} line={line} accent={accent} btn={btn} ev={ev} onSubscribe={onSubscribe} />}
      {/* Last on the page so they stick to the foot of the screen: the chat bubble, and the sheet for asking about an episode. */}
      {(chat || askEp) && <div className={`${preview ? "absolute" : "fixed"} inset-0 z-20 ${askEp ? "bg-black/40" : ""}`} onClick={() => { setChat(false); setAskEp(null); }} aria-hidden />}
      {intro("bottom")}
      {data.askEnabled && !askEp && !chatTop && <Chat handle={data.handle} name={data.displayName} avatar={data.avatarUrl} welcome={data.welcome} accent={accent} ink={ink} sub={sub} line={line} dark={dark} preview={preview} open={chat} setOpen={setChat} onAsk={onAsk} onLoad={onLoadMessages} at={chatAt} />}
      {askEp && <AskSheet key={askEp.id} ep={askEp} name={data.displayName} accent={accent} ink={ink} sub={sub} line={line} dark={dark} preview={preview} onAskAi={onAskAi} onClose={() => setAskEp(null)} onMessage={data.askEnabled ? () => { setAskEp(null); setChat(true); } : undefined} />}
    </div>
  );
}

/** Their social accounts, a row of round icons (a white ring over a photo). */
export function SocialRow({ socials, onPhoto = false, preview, onTap, onChat, chatColor = "#053877" }: { socials: { platform: string; url: string }[]; onPhoto?: boolean; preview: boolean; onTap?: (platform: string) => void; onChat?: () => void; chatColor?: string }) {
  if (!socials.length && !onChat) return null;
  return (
    <div className="mt-4 flex flex-wrap justify-center gap-2.5" data-testid="social-row">
      {socials.map((s) => (
        <a key={s.platform} href={preview ? undefined : s.url} target="_blank" rel="noreferrer" onClick={() => onTap?.(s.platform)} aria-label={s.platform} className="flex h-10 w-10 items-center justify-center rounded-full text-white transition-transform hover:scale-110" style={{ background: platformBackground(s.platform as SocialPlatform), boxShadow: onPhoto ? "0 0 0 2px rgba(255,255,255,0.85)" : undefined }}>
          <PlatformIcon platform={s.platform as SocialPlatform} className="h-5 w-5" />
        </a>
      ))}
      {/* The chat, in with their icons (their choice): opens the chat to message them. */}
      {onChat && (
        <button type="button" onClick={onChat} aria-label="Send a message" className="flex h-10 w-10 items-center justify-center rounded-full transition-transform hover:scale-110" style={{ background: chatColor, color: onColor(chatColor), boxShadow: onPhoto ? "0 0 0 2px rgba(255,255,255,0.85)" : undefined }} data-testid="bio-chat-social">
          <MessageCircle className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

/**
 * The top of a page in any of the layouts: a wide cover photo (blend), a
 * full-screen photo with their name on it (hero), a banner with the photo over
 * it (landscape), a shaped photo (shape), a round one (portrait), or one of the
 * cut-out tops. What goes under or over the photo (their name, and the rest) is
 * the caller's: children(onPhoto, hideName). The Brands and Family views use it too.
 */
export function PageTop({ t, avatar, hero, cutoutUrl, living = "", name, handle, latest, children }: { t: BioTheme; avatar: string; hero: string; cutoutUrl?: string; living?: string; name: string; handle: string; latest?: string; children: (onPhoto: boolean, hideName?: boolean) => React.ReactNode }) {
  const { theirs, paper, dark, accent } = bioPalette(t);
  const Y = Number.isFinite(t.imageY) ? t.imageY : 50;
  const photo = hero || avatar;
  // The living photo is of the top's photo (the cover, or their photo when there's no cover).
  const moving = (cls: string, style: React.CSSProperties) => <video src={living} poster={photo} autoPlay muted loop playsInline preload="auto" aria-hidden className={cls} style={style} data-testid="bio-living" />;
  const longest = Math.max(4, ...(name || "Your name").split(/\s+/).map((w) => w.length));
  // The cutout's name, filling the width behind them, then their own size on top.
  const bigName = Math.round(Math.min(104, Math.max(46, 380 / (longest * 0.62))) * (t.nameSize ?? 100) / 100);
  return (
    <>
      {CUTOUT_LAYOUTS.includes(t.layout) && cutoutUrl ? (
        <>
          <CutoutTop kind={t.layout} src={cutoutUrl} name={name} scene={t.scene ?? ""} bg={/^#[0-9a-f]{6}$/i.test(t.stickerColor ?? "") ? t.stickerColor! : theirs} paper={paper} dark={dark} bigName={bigName} nameY={t.nameY ?? 0} dy={t.cutoutY ?? 0} size={(t.cutoutSize ?? 100) / 100} latest={latest} handle={handle} />
          {/* Pop-out and Shape show the name under the photo; the others draw it big behind. */}
          <div className={`relative z-30 mx-auto max-w-[560px] px-5 text-center ${t.layout === "popout" || t.layout === "shape" ? "pt-5" : "-mt-4"}`}>{children(false, t.layout !== "popout" && t.layout !== "shape")}</div>
        </>
      ) : t.layout === "hero" && photo ? (
        <div className="relative flex min-h-[600px] flex-col justify-end" style={{ background: `center ${Y}%/cover url(${photo})` }} data-testid="bio-hero-header">
          {living && moving("absolute inset-0 h-full w-full object-cover", { objectPosition: `center ${Y}%` })}
          <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 70%, ${t.template === "vibrant" ? theirs : dark ? "#0b1020" : "rgba(0,0,0,0.85)"} 100%)` }} />
          <div className="relative mx-auto w-full max-w-[560px] px-5 pb-8 text-center text-white">{children(true)}</div>
        </div>
      ) : (
        <>
          {t.layout === "blend" && photo ? (
            <div className="relative">
              {living ? moving("h-[340px] w-full object-cover", { objectPosition: `center ${Y}%` }) : <img src={photo} alt="" className="h-[340px] w-full object-cover" style={{ objectPosition: `center ${Y}%` }} />}
              <div className="absolute inset-x-0 bottom-0 h-40" style={{ background: `linear-gradient(to bottom, transparent, ${t.template === "vibrant" && !t.background?.color ? theirs : paper})` }} />
            </div>
          ) : t.layout === "landscape" ? (
            <div className="relative">
              <div className="h-40 w-full" style={{ background: hero ? `center ${Y}%/cover url(${hero})` : `linear-gradient(135deg, ${theirs}, #000741)` }} />
              {avatar && <img src={avatar} alt="" className="absolute -bottom-12 left-1/2 h-24 w-24 -translate-x-1/2 rounded-full object-cover" style={{ boxShadow: `0 0 0 4px ${paper}`, objectPosition: `center ${Y}%` }} />}
            </div>
          ) : t.layout === "shape" && avatar ? (
            <div className="flex justify-center pt-12">
              <div className="relative" style={{ width: { s: 144, m: 176, l: 208 }[t.avatarSize ?? "m"], height: { s: 144, m: 176, l: 208 }[t.avatarSize ?? "m"] }}>
                <span className="absolute -inset-3 rotate-12" style={{ background: accent, borderRadius: "58% 42% 38% 62% / 45% 55% 45% 55%", opacity: 0.9 }} />
                <img src={avatar} alt="" className="relative h-full w-full object-cover" style={{ borderRadius: "42% 58% 63% 37% / 52% 38% 62% 48%", objectPosition: `center ${Y}%` }} />
              </div>
            </div>
          ) : (
            avatar && <div className="flex justify-center pt-10">{(() => {
              const round: React.CSSProperties = { width: { s: 88, m: 112, l: 144 }[t.avatarSize ?? "m"], height: { s: 88, m: 112, l: 144 }[t.avatarSize ?? "m"], boxShadow: `0 0 0 4px ${accent}`, objectPosition: `center ${Y}%` };
              return living && !hero ? moving("rounded-full object-cover", round) : <img src={avatar} alt="" className="rounded-full object-cover" style={round} />;
            })()}</div>
          )}
          <div className={`mx-auto max-w-[560px] px-5 text-center ${t.layout === "blend" && photo ? "-mt-12 relative" : t.layout === "landscape" ? "pt-14" : t.layout === "shape" ? "pt-7" : "pt-4"}`}>{children(false)}</div>
        </>
      )}
    </>
  );
}

/**
 * Stay in touch: an email (and a first name, if they like) to the podcaster,
 * who finds it in their Contacts. Remembered in this browser once they're in.
 */
/**
 * The page's pop-up: a few seconds after a listener arrives, once a week each. Something
 * to promote (a picture, a line, a button to it) or a sign-up (their email, to Contacts).
 * In the builder it shows while they edit it.
 */
function PagePopup({ p, handle, preview, peek, onPeekClose, solid, ink, sub, card, line, accent, btn, ev, onSubscribe }: { p: BioPopup; handle: string; preview: boolean; peek: boolean; onPeekClose?: () => void; solid: string; ink: string; sub: string; card: string; line: string; accent: string; btn: (primary?: boolean) => React.CSSProperties; ev: Ev; onSubscribe?: (x: { email: string; name: string; website: string }) => Promise<void> }) {
  const key = `mv_popup_${handle}`;
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState("");
  useEffect(() => {
    if (preview) return;
    try {
      const last = Number(localStorage.getItem(key) || 0);
      if (Date.now() - last < 7 * 86_400_000 || (p.kind === "email" && localStorage.getItem(`mv_joined_${handle}`) === "1")) return;
    } catch { /* private window: show it */ }
    const t = window.setTimeout(() => { setOpen(true); try { localStorage.setItem(key, String(Date.now())); } catch { /* fine */ } }, 4000);
    return () => clearTimeout(t);
  }, [preview, key, p.kind, handle]);
  const shown = preview ? peek : open;
  if (!shown) return null;
  const close = () => { if (preview) onPeekClose?.(); else setOpen(false); };
  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    if (preview || !onSubscribe || state === "busy") return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setErr("That email doesn't look right."); return; }
    setState("busy"); setErr("");
    try {
      await onSubscribe({ email: email.trim(), name: "", website });
      setState("done");
      try { localStorage.setItem(`mv_joined_${handle}`, "1"); } catch { /* fine */ }
    } catch (x) { setErr((x as Error).message); setState("idle"); }
  };
  // On the page: over everything, the page dimmed. In the builder's phone: pinned to the foot of
  // its screen as it scrolls, the rest dimmed by the card's own shadow.
  const box = (inner: React.ReactNode) => preview
    ? <div className="sticky bottom-0 z-40 h-0" data-testid="bio-popup"><div className="absolute inset-x-0 bottom-0 flex justify-center p-4">{inner}</div></div>
    : <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={close} data-testid="bio-popup">{inner}</div>;
  return box(
      <div role="dialog" aria-modal aria-label={p.heading || "Pop-up"} onClick={(e) => e.stopPropagation()} className={`relative w-full max-w-sm overflow-hidden rounded-3xl animate-in fade-in slide-in-from-bottom-4 duration-300 ${preview ? "shadow-[0_0_0_2000px_rgba(0,0,0,0.5)]" : "shadow-2xl"}`} style={{ background: solid, color: ink, border: `1px solid ${line}` }}>
        <button type="button" onClick={close} className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white" aria-label="Close"><X className="h-4 w-4" /></button>
        {p.kind === "promo" && p.image && <img src={p.image} alt="" className="aspect-[4/3] w-full object-cover" />}
        <div className="p-6 text-center">
          {p.pre && <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: accent }}>{p.pre}</p>}
          {p.heading && <p className="mt-1 text-balance text-2xl font-extrabold leading-tight">{p.heading}</p>}
          {p.note && <p className="mt-2 text-sm" style={{ color: sub }}>{p.note}</p>}
          {p.kind === "promo" ? (
            <a href={preview || !p.url ? undefined : p.url} target="_blank" rel="noopener noreferrer" onClick={() => { ev("click", `Pop-up: ${p.heading || p.button}`); if (!preview) setOpen(false); }} className="mt-4 flex h-11 items-center justify-center px-4 text-sm font-semibold" style={btn()} data-testid="bio-popup-go">{p.button || "Take a look"}</a>
          ) : state === "done" ? (
            <p className="mt-4 flex items-center justify-center gap-2 text-sm font-semibold"><Check className="h-4 w-4" style={{ color: accent }} /> You're in. Thanks!</p>
          ) : (
            <form onSubmit={join} className="mt-4 flex flex-col gap-2">
              <input value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }} type="email" placeholder="Your email" autoComplete="email" required maxLength={200} className="h-11 rounded-xl px-3 text-sm outline-none" style={{ background: "transparent", border: `1px solid ${line}`, color: ink }} data-testid="bio-popup-email" />
              <input value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden className="hidden" name="website" />
              <button type="submit" disabled={state === "busy"} className="h-11 px-4 text-sm font-semibold disabled:opacity-60" style={btn()}>{state === "busy" ? "One moment…" : p.button || "Sign me up"}</button>
              {err && <p className="text-xs text-red-500">{err}</p>}
            </form>
          )}
        </div>
      </div>
  );
}

function SignupBlock({ s, btn, ink, sub, card, line, accent, preview, handle, onSubscribe }: { s: Extract<BioSection, { type: "signup" }>; btn: (primary?: boolean) => React.CSSProperties; ink: string; sub: string; card: string; line: string; accent: string; preview: boolean; handle: string; onSubscribe?: (x: { email: string; name: string; website: string }) => Promise<void> }) {
  const key = `mv_joined_${handle}`;
  const [done, setDone] = useState(() => { if (preview) return false; try { return localStorage.getItem(key) === "1"; } catch { return false; } });
  const [f, setF] = useState({ email: "", name: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const field = { background: "transparent", border: `1px solid ${line}`, color: ink, borderRadius: 12 };
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (preview || !onSubscribe || busy) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) { setErr("That email doesn't look right."); return; }
    setBusy(true); setErr("");
    try {
      await onSubscribe({ email: f.email.trim(), name: f.name.trim(), website: f.website });
      setDone(true);
      try { localStorage.setItem(key, "1"); } catch { /* this visit only */ }
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="rounded-3xl p-5 text-center" style={{ background: card, border: `1px solid ${line}` }} data-testid="bio-signup">
      <p className="flex items-center justify-center gap-2 text-base font-bold"><Mail className="h-4 w-4" style={{ color: accent }} /> {s.title || "Stay in touch"}</p>
      {s.note && <p className="mx-auto mt-1 max-w-sm text-sm" style={{ color: sub }}>{s.note}</p>}
      {done ? (
        <p className="mt-3 flex items-center justify-center gap-2 text-sm font-semibold" data-testid="bio-signup-done"><Check className="h-4 w-4" style={{ color: accent }} /> You're in. Thanks!</p>
      ) : (
        <form onSubmit={go} className="mx-auto mt-3 flex max-w-sm flex-col gap-2">
          <div className="flex gap-2">
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="First name" autoComplete="given-name" maxLength={80} className="h-11 w-[38%] min-w-0 px-3 text-sm outline-none" style={field} />
            <input value={f.email} onChange={(e) => { setF({ ...f, email: e.target.value }); setErr(""); }} type="email" placeholder="Your email" autoComplete="email" required maxLength={200} className="h-11 min-w-0 flex-1 px-3 text-sm outline-none" style={field} data-testid="bio-signup-email" />
          </div>
          <input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} tabIndex={-1} autoComplete="off" aria-hidden className="hidden" name="website" />
          <button type="submit" disabled={busy} className="h-11 px-4 text-sm font-semibold disabled:opacity-60" style={btn()} data-testid="bio-signup-go">{busy ? "One moment…" : s.button || "Sign me up"}</button>
          {err && <p className="text-xs text-red-500">{err}</p>}
          <p className="text-[11px]" style={{ color: sub }}>Only they see your email. No spam.</p>
        </form>
      )}
    </section>
  );
}

/**
 * The tops made from their cut-out photo: in front of their name (cutout),
 * breaking out of a circle (popout), a sticker on stripes (sticker), or on a
 * magazine cover under a masthead (magazine). dy and size are their adjusters.
 */
/** The living photo is off for now (29 Sep 2026): pages show the still. */
const LIVING_ON = false;

function CutoutTop({ kind, src, name, bg, scene, paper, dark, bigName, nameY = 0, dy, size, latest, handle }: { kind: string; src: string; name: string; bg: string; scene: string; paper: string; dark: boolean; bigName: number; nameY?: number; dy: number; size: number; latest?: string; handle: string }) {
  const move: React.CSSProperties = { transform: `translateY(${dy}px) scale(${size})`, transformOrigin: "bottom center" };
  // A scene behind them (an image) in place of the colour: the background, the circle, the blob, the cover.
  const fill = (fallback: string) => (scene ? `center/cover url(${scene})` : fallback);
  const onScene: React.CSSProperties = scene ? { color: "#ffffff", textShadow: "0 4px 24px rgba(0,0,0,0.45)" } : {};
  const fade = <div className="absolute inset-x-0 bottom-0 z-20 h-24" style={{ background: `linear-gradient(to bottom, transparent, ${paper})` }} />;
  if (kind === "popout") {
    // The head breaks out over the circle's top edge (a window 60% wide, 50px into the circle);
    // everything else, the shoulders included, shows only inside the circle.
    const mask = "linear-gradient(#000, #000) top center / 60% 190px no-repeat, radial-gradient(circle 140px at 50% calc(100% - 140px), #000 99%, transparent 100%)";
    return (
      <div className="flex justify-center pt-12" data-testid="bio-popout-header">
        <div className="relative h-[420px] w-[280px]">
          <div className="absolute bottom-0 left-0 h-[280px] w-[280px] rounded-full" style={{ background: fill(`radial-gradient(circle at 35% 30%, ${bg}, ${bg}e6)`), boxShadow: `0 20px 50px -20px ${scene ? "rgba(0,0,0,0.6)" : bg}` }} />
          <div className="absolute inset-0" style={{ WebkitMask: mask, mask }}>
            <img src={src} alt="" className="absolute bottom-0 left-1/2 h-[400px] max-w-none -translate-x-1/2 object-contain object-bottom" style={{ ...move, transform: `translateX(-50%) ${move.transform}` }} />
          </div>
        </div>
      </div>
    );
  }
  if (kind === "shape") {
    // Them standing on a blob of colour: the head and shoulders rise out of its top.
    const blob = "M152 4c52-4 104 18 130 62 25 42 22 98-4 138-27 41-78 58-128 56-50-1-100-22-125-63C0 156 2 102 26 63 51 24 101 8 152 4z";
    const svg = (fill: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 260'><path d='${blob}' fill='${fill}'/></svg>`)}")`;
    const mask = `linear-gradient(#000, #000) top center / 56% 190px no-repeat, ${svg("#000")} bottom center / 300px 260px no-repeat`;
    return (
      <div className="flex justify-center pt-10" data-testid="bio-shape-header">
        <div className="relative h-[400px] w-[300px]">
          <svg viewBox="0 0 300 260" className="absolute bottom-0 left-0 h-[260px] w-[300px] -rotate-3 drop-shadow-[0_18px_30px_rgba(0,0,0,0.3)]" aria-hidden>
            {scene && <defs><pattern id="bio-scene" patternUnits="userSpaceOnUse" width="300" height="260"><image href={scene} width="300" height="260" preserveAspectRatio="xMidYMid slice" /></pattern></defs>}
            <path d={blob} fill={scene ? "url(#bio-scene)" : bg} />
          </svg>
          <div className="absolute inset-0" style={{ WebkitMask: mask, mask }}>
            <img src={src} alt="" className="absolute bottom-0 left-1/2 h-[330px] max-w-none -translate-x-1/2 object-contain object-bottom" style={{ ...move, transform: `translateX(-50%) ${move.transform}` }} />
          </div>
        </div>
      </div>
    );
  }
  if (kind === "sticker") {
    const edge = "drop-shadow(4px 0 0 #fff) drop-shadow(-4px 0 0 #fff) drop-shadow(0 4px 0 #fff) drop-shadow(0 -4px 0 #fff) drop-shadow(0 14px 18px rgba(0,0,0,0.35))";
    return (
      <div className="relative flex min-h-[470px] flex-col justify-end overflow-hidden" style={{ background: `repeating-linear-gradient(135deg, ${bg} 0 26px, ${bg}d9 26px 52px)` }} data-testid="bio-sticker-header">
        {name && <h1 className="absolute inset-x-0 top-14 z-0 -rotate-6 break-words px-4 text-center font-black uppercase leading-[0.86] tracking-tight" style={{ fontSize: bigName * 0.9, translate: `0 ${nameY}px`, color: onColor(bg), textShadow: onColor(bg) === "#ffffff" ? "0 4px 0 rgba(0,0,0,0.25)" : "0 3px 0 rgba(255,255,255,0.5)" }}>{name}</h1>}
        <img src={src} alt="" className="relative z-10 mx-auto block h-[380px] w-auto max-w-[90%] object-contain object-bottom" style={{ ...move, filter: edge }} />
        {fade}
      </div>
    );
  }
  if (kind === "magazine") {
    const ink = onColor(bg);
    return (
      <div className="relative flex min-h-[520px] flex-col overflow-hidden" style={{ background: scene ? `linear-gradient(180deg, transparent 60%, ${paper} 100%), center/cover url(${scene})` : `linear-gradient(180deg, ${bg} 0%, ${bg} 70%, ${paper} 100%)` }} data-testid="bio-magazine-header">
        {name ? <h1 className="z-0 break-words px-3 pt-7 text-center font-black uppercase leading-[0.82] tracking-tight" style={{ fontSize: bigName * 1.05, translate: `0 ${nameY}px`, color: ink, fontFamily: FONTS.playfair.css, ...onScene }}>{name}</h1> : <div className="h-20" />}
        <img src={src} alt="" className="relative z-10 mx-auto -mt-12 block h-[400px] w-auto max-w-[94%] object-contain object-bottom drop-shadow-[0_18px_30px_rgba(0,0,0,0.35)]" style={move} />
        {fade}
      </div>
    );
  }
  return (
    <div className="relative flex min-h-[470px] flex-col justify-end overflow-hidden" style={{ background: scene ? `linear-gradient(180deg, transparent 55%, ${paper} 100%), center/cover url(${scene})` : `radial-gradient(120% 80% at 50% 30%, ${bg} 0%, ${bg} 45%, ${paper} 100%)` }} data-testid="bio-cutout-header">
      {name && <h1 className="absolute inset-x-0 top-16 z-0 break-words px-4 text-center font-black uppercase leading-[0.86] tracking-tight" style={{ fontSize: bigName, translate: `0 ${nameY}px`, color: onColor(bg), opacity: 0.92, ...onScene }}>{name}</h1>}
      <img src={src} alt="" className="relative z-10 mx-auto block h-[400px] w-auto max-w-[94%] object-contain object-bottom drop-shadow-[0_18px_30px_rgba(0,0,0,0.35)]" style={move} />
      {fade}
    </div>
  );
}

function PodcastCard({ p, onAsk, opts, style, full, fallbackArt, accent, ink, sub, card, line, radius, preview, ev, share, copied }: {
  p: NonNullable<BioPublic["podcast"]>; onAsk?: (e: { id: string; title: string }) => void; opts: BioPodcastOptions; style: BioTheme["podcastStyle"]; full: boolean; fallbackArt: string; accent: string; ink: string; sub: string; card: string; line: string; radius: number; preview: boolean; ev: Ev; share: (title: string, id: string) => void; copied: string | null;
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
  // Ask the show's AI about this episode (when it has learned the show).
  const askBtn = (e: E) => onAsk && (
    <button type="button" onClick={() => onAsk({ id: e.id, title: e.title })} aria-label={`Ask about ${e.title}`} title="Ask about this episode" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-110" style={{ background: `${accent}22`, color: accent }} data-testid="bio-ep-ask">
      <MessageCircle className="h-4 w-4" />
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
      {askBtn(e)}
      {shareBtn(e)}
    </div>
  );
  return (
    // Full: edge to edge on the page, the latest's picture the full width. Card: in a box with a margin.
    <section className={`text-left ${full ? "-mx-4" : "overflow-hidden rounded-3xl"}`} style={full ? {} : { background: card, border: `1px solid ${line}` }} data-testid="bio-podcast">
      {/* No title or count on top (it's their page, and room is short): only a heading they wrote. */}
      {opts.heading.trim()
        ? <p className="truncate px-4 pb-1 pt-3 text-xs font-bold uppercase tracking-[0.12em]" style={{ color: sub }}>{opts.heading.trim()}</p>
        : <div className={full ? "" : style === "list" ? "h-1" : "h-4"} />}
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
              {askBtn(first)}
              {shareBtn(first)}
            </div>
          </div>
          {rest.length > 0 && <div className={`mt-2 ${full ? "mx-4" : ""}`} style={{ borderTop: `1px solid ${line}` }}>{rest.slice(0, Math.max(0, opts.count - 1)).map((e, i) => row(e, i))}</div>}
        </div>
      )}
      {first && style === "list" && <div className="px-4">{p.episodes.slice(0, opts.count).map((e, i) => row(e, i))}</div>}
      {first && style === "carousel" && (
        <div className="flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {p.episodes.slice(0, opts.count).map((e, i) => (
            <div key={e.id} id={`ep-${e.id}`} className="w-[70%] shrink-0 snap-start">
              {thumb(e, "aspect-square w-full rounded-2xl", "lg")}
              <div className="mt-2 flex items-start gap-1">
                <div className="min-w-0 flex-1">
                  {i === 0 && <p className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: accent }}>Latest</p>}
                  <p className="line-clamp-2 text-sm font-semibold leading-snug">{e.title}</p>
                  <p className="text-xs" style={{ color: sub }}>{when(e)}</p>
                </div>
                {askBtn(e)}
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
      <div className="flex flex-wrap gap-2 px-4 pb-3 pt-1.5">
        {opts.apple && p.appleUrl && <a href={preview ? undefined : p.appleUrl} target="_blank" rel="noreferrer" onClick={() => ev("click", "Apple Podcasts")} className="px-3.5 py-2 text-xs font-semibold text-white" style={{ background: "#872EC4", borderRadius: radius }}>Apple Podcasts</a>}
        {opts.spotify && p.spotifyUrl && <a href={preview ? undefined : p.spotifyUrl} target="_blank" rel="noreferrer" onClick={() => ev("click", "Spotify")} className="px-3.5 py-2 text-xs font-semibold text-black" style={{ background: "#1DB954", borderRadius: radius }}>Spotify</a>}
        {opts.all && p.pageUrl && <a href={preview ? undefined : p.pageUrl} target="_blank" rel="noreferrer" onClick={() => ev("click", "All episodes")} className="px-3.5 py-2 text-xs font-semibold" style={{ border: `1px solid ${line}`, borderRadius: radius }}>All episodes</a>}
        {opts.rss && <button type="button" onClick={() => { void navigator.clipboard?.writeText(p.feedUrl); ev("click", "RSS"); }} className="inline-flex items-center gap-1 px-3.5 py-2 text-xs font-semibold" style={{ border: `1px solid ${line}`, borderRadius: radius }}><Radio className="h-3.5 w-3.5" /> RSS <Copy className="h-3 w-3" style={{ color: sub }} /></button>}
      </div>
    </section>
  );
}

/** A text block's **bold**, *italic* and __underline__, drawn (nothing else is read as markup). */
export function styled(body: string): React.ReactNode[] {
  return body.split(/(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*)/g).map((part, i) =>
    /^\*\*.+\*\*$/.test(part) ? <strong key={i} className="font-bold">{part.slice(2, -2)}</strong>
      : /^__.+__$/.test(part) ? <u key={i}>{part.slice(2, -2)}</u>
      : /^\*.+\*$/.test(part) ? <em key={i}>{part.slice(1, -1)}</em>
      : part);
}

function Section({ s, btn, ink, sub, card, line, accent, preview, ev, handle = "", onSubscribe }: { s: BioSection; btn: (primary?: boolean) => React.CSSProperties; ink: string; sub: string; card: string; line: string; accent: string; preview: boolean; ev: Ev; handle?: string; onSubscribe?: (x: { email: string; name: string; website: string }) => Promise<void> }) {
  // Space, with a line across the middle of it (or not).
  if (s.type === "divider") return (
    <div className="flex items-center justify-center" style={{ minHeight: Math.max(1, s.space), marginTop: -8, marginBottom: -8 }} aria-hidden data-testid="bio-divider">
      {s.line === "dots" ? <span className="text-lg leading-none tracking-[0.5em]" style={{ color: sub }}>•••</span>
        : s.line !== "none" && <span className="w-full" style={{ borderTop: `${s.line === "thick" ? 3 : 1}px ${s.line === "dashed" ? "dashed" : "solid"} ${line}`, opacity: s.line === "thick" ? 1 : 0.9 }} />}
    </div>
  );
  if (s.type === "signup") return <SignupBlock s={s} btn={btn} ink={ink} sub={sub} card={card} line={line} accent={accent} preview={preview} handle={handle} onSubscribe={onSubscribe} />;
  const [copied, setCopied] = useState<string | null>(null);
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
    // Uploaded (played from its signed address) or a link: YouTube, Vimeo, an Instagram reel, TikTok.
    if (s.url.startsWith("r2:")) {
      return <section>{title}{s.file
        ? <video src={s.file} controls playsInline preload="metadata" className="max-h-[640px] w-full overflow-hidden rounded-2xl bg-black" style={{ border: `1px solid ${line}` }} />
        : <div className="flex aspect-video items-center justify-center rounded-2xl text-sm" style={{ border: `1px solid ${line}`, color: sub, background: card }}>Your video plays here</div>}</section>;
    }
    const v = videoEmbed(s.url);
    if (!v) return null;
    return <section>{title}{v.kind === "file"
      ? <video src={v.src} controls playsInline preload="metadata" className="max-h-[640px] w-full overflow-hidden rounded-2xl bg-black" style={{ border: `1px solid ${line}` }} />
      : <div className={`overflow-hidden rounded-2xl ${v.tall ? "h-[620px]" : "aspect-video"}`} style={{ border: `1px solid ${line}` }}><iframe src={v.src} title={s.title || "Video"} loading="lazy" className="h-full w-full" allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /></div>}</section>;
  }
  if (s.type === "promo") {
    // Each code a ticket: whose it is and what it saves, the code to tap and copy, and their shop.
    const codes = promoCodes(s).filter((c) => c.code || c.url || c.brand);
    if (!codes.length) return null;
    return (
      <section data-testid="bio-promos">
        <p className="mb-2 mt-1 flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em]" style={{ color: sub }}><Tag className="h-3.5 w-3.5" style={{ color: accent }} /> {s.title || "Promo codes"}</p>
        <div className="flex flex-col gap-2.5">
          {codes.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-2xl p-3 text-left" style={{ background: card, border: `1px dashed ${accent}` }}>
              <div className="min-w-0 flex-1">
                {c.brand && <p className="truncate text-sm font-bold">{c.brand}</p>}
                {c.note && <p className="text-xs leading-snug" style={{ color: sub }}>{c.note}</p>}
                {c.url && <a href={preview ? undefined : c.url} target="_blank" rel="noreferrer" onClick={() => ev("click", c.brand || "Promo")} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold hover:underline" style={{ color: accent }}>Shop now <ExternalLink className="h-3 w-3" /></a>}
              </div>
              {c.code && <button type="button" onClick={() => { void navigator.clipboard?.writeText(c.code); setCopied(c.id); setTimeout(() => setCopied(null), 1500); ev("click", `Promo ${c.code}`); }} aria-label={`Copy ${c.code}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 font-mono text-sm font-bold tracking-widest" style={{ background: `${accent}22`, color: ink }}>{copied === c.id ? <>Copied <Check className="h-3.5 w-3.5" /></> : <>{c.code} <Copy className="h-3.5 w-3.5" /></>}</button>}
            </div>
          ))}
        </div>
      </section>
    );
  }
  if (s.type === "music") {
    const tracks = s.tracks.filter((x) => x.url);
    if (!tracks.length) return null;
    return (
      <section data-testid="bio-music">
        <p className="mb-2 mt-1 flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em]" style={{ color: sub }}><Music className="h-3.5 w-3.5" style={{ color: accent }} /> {s.title || "Music"}</p>
        <div className="flex flex-col gap-2.5">
          {tracks.map((x) => {
            const m = musicEmbed(x.url);
            return m
              ? <iframe key={x.id} src={m.src} title="Music" loading="lazy" className={`w-full overflow-hidden rounded-2xl ${m.h ? "" : "aspect-video"}`} style={m.h ? { height: m.h, border: 0 } : { border: 0 }} allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" />
              : <a key={x.id} href={preview ? undefined : x.url} target="_blank" rel="noreferrer" onClick={() => ev("click", "Music")} className="flex items-center justify-center gap-2 px-5 py-3.5 text-[15px] font-semibold" style={btn()}><Music className="h-4 w-4" /> Listen</a>;
          })}
        </div>
      </section>
    );
  }
  if (s.type === "meeting") return (
    <section className="rounded-2xl p-4 text-center" style={{ background: card, border: `1px solid ${line}` }}>
      <p className="flex items-center justify-center gap-1.5 text-sm font-semibold"><Calendar className="h-4 w-4" style={{ color: accent }} /> {s.title || "Book a time with me"}</p>
      {s.note && <p className="mt-1 text-sm" style={{ color: sub }}>{s.note}</p>}
      {s.url && <a href={preview ? undefined : s.url} target="_blank" rel="noreferrer" onClick={() => ev("click", "Booking")} className="mt-3 block px-4 py-2.5 text-sm font-semibold" style={btn()}>Pick a time</a>}
    </section>
  );
  if (s.type === "text") {
    if (!s.title.trim() && !s.body.trim()) return null;
    return <section className="rounded-2xl p-4" style={{ background: card, border: `1px solid ${line}`, textAlign: s.align ?? "left" }}>{s.title && <p className="mb-1 font-semibold">{s.title}</p>}{s.body && <p className="whitespace-pre-line text-sm leading-relaxed" style={{ color: sub }}>{styled(s.body)}</p>}</section>;
  }
  return null;
}

/**
 * Their talking intro: a round bubble in the bottom left with them moving in it
 * (silent). Tap it and it opens and they say hello, with sound.
 */
function IntroBubble({ src, name, handle, says, back, accent, preview, onPlay, at = "bottom-left" }: { src: string; name: string; handle: string; says?: string[]; back?: string; accent: string; preview: boolean; onPlay: () => void; at?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "bio" }) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  // What the bubble says: their line for someone who's been before, else one of theirs at random
  // (the builder's preview shows their first, so it holds still while they edit).
  const lines = says?.length ? says : ["Say hi 👋"];
  const [say] = useState(() => {
    if (preview) return lines[0];
    let been = false;
    try { const k = `mv_been_${handle}`; been = Boolean(localStorage.getItem(k)); localStorage.setItem(k, "1"); } catch { /* private window: a first visit every time */ }
    return been && back ? back : lines[Math.floor(Math.random() * lines.length)];
  });
  const shown = preview ? lines[0] : say;
  const first = (name || "").split(/\s+/)[0];
  const top = at.startsWith("top");
  const right = at.endsWith("right");
  const play = () => { setOpen(true); setSeen(true); if (!preview) onPlay(); };
  const player = (cls: string) => (
    <div className={`overflow-hidden rounded-3xl bg-black shadow-2xl ring-2 ring-white/70 ${cls}`} role="dialog" aria-label={`${first || "Their"} hello`} data-testid="bio-intro-player">
      <video src={src} autoPlay playsInline controls className="aspect-square w-full object-cover" onEnded={() => setOpen(false)} />
      <button type="button" onClick={() => setOpen(false)} className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white" aria-label="Close"><X className="h-4 w-4" /></button>
    </div>
  );
  const face = (size: string) => (
    <span className={`relative block ${size} overflow-hidden rounded-full shadow-xl ring-[3px] transition-transform group-hover:scale-105`} style={{ ["--tw-ring-color" as string]: accent }}>
      <video src={src} autoPlay muted loop playsInline preload="metadata" className="h-full w-full object-cover" />
      <span className="absolute inset-0 flex items-center justify-center bg-black/15"><Play className="h-5 w-5 translate-x-px fill-white text-white drop-shadow" /></span>
    </span>
  );
  // Under their bio: in the page, a face and a line to press.
  if (at === "bio") return (
    <div className="mt-4 flex justify-center">
      {open ? <div className="relative w-full max-w-[18rem]">{player("relative")}</div> : (
        <button type="button" onClick={play} className="group inline-flex items-center gap-2.5 rounded-full py-1 pl-1 pr-4 text-sm font-bold shadow-lg" style={{ background: accent, color: onColor(accent) }} aria-label={`Play ${first || "their"} hello`} data-testid="bio-intro">
          {face("h-10 w-10")} {shown}
        </button>
      )}
    </div>
  );
  // In a corner: rides the top or the foot of the screen.
  return (
    <div className={`sticky ${top ? "top-0" : "bottom-0"} z-30 h-0`}>
      <div className="relative mx-auto h-0 max-w-[560px]">
        {open ? player(`absolute ${top ? "top-3" : "bottom-4"} ${right ? "right-3" : "left-3"} w-[min(17rem,calc(100%-5.5rem))]`) : (
          <button type="button" onClick={play} className={`group absolute flex items-center gap-2 ${top ? "top-3" : "bottom-4"} ${right ? "right-4 flex-row-reverse" : "left-4"}`} aria-label={`Play ${first || "their"} hello`} data-testid="bio-intro">
            {face("h-16 w-16")}
            {!seen && <span className="rounded-full px-3 py-1.5 text-xs font-bold shadow-lg" style={{ background: accent, color: onColor(accent) }}>{shown}</span>}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The chat button in the bottom corner of the page: a message to the podcaster, and
 * their reply back here (a badge on the button when one comes). The listener's
 * browser keeps the keys to their messages; the reply email carries one too.
 */
export function Chat({ handle, name, avatar, welcome = "", accent, ink, sub, line, dark, preview, open, setOpen, onAsk, onLoad, corner = false, at = "bottom-right" }: {
  handle: string; name: string; avatar: string; welcome?: string; accent: string; ink: string; sub: string; line: string; dark: boolean; preview: boolean;
  /** Fixed to the window's corner (a page with its own layout); otherwise it rides the page. */
  corner?: boolean;
  /** Which corner it rides (a top one goes first on the page, a bottom one last), or no button of its own: in their social icons. */
  at?: BioChatAt;
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

  const top = at === "top-left" || at === "top-right" || at === "socials";
  const left = at === "top-left" || at === "bottom-left";
  const panel = dark ? "#151b2f" : "#ffffff";
  const field = { background: "transparent", border: `1px solid ${line}`, color: ink, borderRadius: 12 };
  const face = (size: string) => avatar
    ? <img src={avatar} alt="" className={`${size} shrink-0 rounded-full object-cover`} />
    : <span className={`${size} flex shrink-0 items-center justify-center rounded-full text-xs font-bold`} style={{ background: accent, color: onColor(accent) }}>{(name || "?").slice(0, 1)}</span>;
  return (
    <div className={corner ? "fixed bottom-5 right-5 z-40" : `sticky ${top ? "top-0" : "bottom-0"} z-30 h-0`}>
      <div className={corner ? "relative" : "relative mx-auto h-0 max-w-[560px]"}>
        {at !== "socials" && <button type="button" onClick={() => setOpen(!open)} aria-label={unread ? `${unread} new ${unread === 1 ? "reply" : "replies"}` : "Send message"} aria-expanded={open}
          className={`group flex items-center justify-center rounded-full shadow-lg ring-2 transition-transform hover:scale-105 ${corner ? "relative h-14 w-14" : `absolute h-12 w-12 ${top ? "top-3" : "bottom-4"} ${left ? "left-4" : "right-4"}`}`}
          style={{ background: accent, color: onColor(accent), ["--tw-ring-color" as string]: dark ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.9)" }} data-testid="bio-chat">
          {open ? <X className={corner ? "h-6 w-6" : "h-5 w-5"} /> : <MessageCircle className={corner ? "h-6 w-6" : "h-5 w-5"} />}
          {unread > 0 && !open && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ef4444] px-1 text-[11px] font-bold text-white ring-2 ring-white" data-testid="bio-chat-badge">{unread}</span>}
          {!open && <span className={`pointer-events-none absolute top-1/2 -translate-y-1/2 ${left && !corner ? "left-full ml-2" : "right-full mr-2"}  whitespace-nowrap rounded-full bg-[#0b1020] px-2.5 py-1 text-xs font-semibold text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100`}>{unread ? `${unread} new ${unread === 1 ? "reply" : "replies"}` : "Send message"}</span>}
        </button>}
        {open && (
          <div className={`absolute flex max-h-[min(70vh,600px)] flex-col ${corner ? "bottom-[4.5rem] right-0 w-[min(22rem,calc(100vw-2.5rem))]" : `${top ? (at === "socials" ? "top-3" : "top-[4.25rem]") : "bottom-[4.75rem]"} left-3 right-3 max-w-[22rem] ${at === "socials" ? "mx-auto" : left ? "mr-auto" : "ml-auto"}`} overflow-hidden rounded-3xl text-left shadow-2xl`} style={{ background: panel, color: ink, border: `1px solid ${line}` }} role="dialog" aria-label={`Message ${name}`} data-testid="bio-chat-panel">
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
 * Ask about an episode: a sheet that slides up from the foot of the page, where
 * the show's AI (it has listened to the show) answers from what was said in
 * that episode, with the minute to press play on. What it can't find, it
 * offers to send to the host.
 */
function AskSheet({ ep, name, accent, ink, sub, line, dark, preview, onAskAi, onClose, onMessage }: { ep: { id: string; title: string }; name: string; accent: string; ink: string; sub: string; line: string; dark: boolean; preview: boolean; onAskAi?: (q: string, h: { role: "user" | "assistant"; content: string }[], episode?: string) => Promise<AiAnswer>; onClose: () => void; onMessage?: () => void }) {
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<({ role: "user"; content: string } | ({ role: "assistant"; content: string } & Partial<AiAnswer>))[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const player = useRef<HTMLAudioElement | null>(null);
  const end = useRef<HTMLDivElement | null>(null);
  const [src, setSrc] = useState<{ url: string; at: number; title: string } | null>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [turns.length, busy]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const ask = async (question: string) => {
    const text = question.trim();
    if (preview || !onAskAi || text.length < 4 || busy) return;
    setBusy(true); setErr(""); setQ("");
    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((x) => [...x, { role: "user", content: text }]);
    try {
      const a = await onAskAi(text, history, ep.title);
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
  const bubble = dark ? "rgba(255,255,255,0.08)" : "#f1f3f8";
  return (
    <div className="sticky bottom-0 z-40 h-0">
      <div className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[min(78vh,640px)] max-w-[560px] flex-col overflow-hidden rounded-t-3xl text-left shadow-[0_-12px_40px_rgba(0,0,0,0.35)] animate-in slide-in-from-bottom duration-300" style={{ background: dark ? "#151b2f" : "#ffffff", color: ink }} role="dialog" aria-label={`Ask about ${ep.title}`} data-testid="bio-ask-sheet">
        <span className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full" style={{ background: line }} />
        <div className="flex items-start gap-2.5 px-4 pb-3 pt-2" style={{ borderBottom: `1px solid ${line}` }}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: `${accent}22`, color: accent }}><Sparkles className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">Ask about this episode</p>
            <p className="line-clamp-1 text-xs" style={{ color: sub }}>{ep.title}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: bubble }}><X className="h-4 w-4" /></button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
          <p className="mr-8 self-start rounded-2xl rounded-bl-md px-3 py-2 text-sm" style={{ background: bubble }}>What would you like to know about this episode? I've listened to it, and I'll show you the minute it was said.</p>
          {turns.length === 0 && (
            <div className="flex flex-wrap gap-1.5">
              {["What's it about?", "The key takeaways", "The best advice in it"].map((x) => (
                <button key={x} type="button" onClick={() => void ask(x)} className="rounded-full px-3 py-1.5 text-xs font-semibold" style={{ border: `1px solid ${accent}`, color: ink }}>{x}</button>
              ))}
            </div>
          )}
          {turns.map((t, i) => t.role === "user" ? (
            <p key={i} className="ml-10 self-end rounded-2xl rounded-br-md px-3 py-2 text-sm" style={{ background: accent, color: onColor(accent) }}>{t.content}</p>
          ) : (
            <div key={i} className="mr-6 self-start rounded-2xl rounded-bl-md px-3 py-2 text-sm leading-relaxed" style={{ background: bubble }}>
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
          <div ref={end} />
        </div>
        {src && (
          <div className="px-4 pb-2">
            <p className="mb-1 truncate text-xs font-semibold">{src.title}</p>
            <audio ref={player} src={src.url} controls preload="none" className="w-full" />
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); void ask(q); }} className="flex gap-2 px-4 pb-5 pt-3" style={{ borderTop: `1px solid ${line}` }}>
          <input value={q} onChange={(e) => { setQ(e.target.value); setErr(""); }} maxLength={500} placeholder={turns.length ? "Ask a follow-up" : "Ask anything about it"} className="h-11 min-w-0 flex-1 rounded-full px-4 text-sm outline-none" style={{ background: "transparent", border: `1px solid ${line}`, color: ink }} data-testid="bio-ask-input" />
          <button type="submit" disabled={busy || q.trim().length < 4} aria-label="Ask" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50" style={{ background: accent, color: onColor(accent) }}><Send className="h-4 w-4" /></button>
        </form>
        {err && <p className="px-4 pb-3 text-xs text-red-500">{err}</p>}
      </div>
    </div>
  );
}
