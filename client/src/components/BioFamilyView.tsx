import { useState } from "react";
import { Heart, Lock, Pause, Play, X } from "lucide-react";
import { Chat, onColor, standOut, type ChatMsg } from "@/components/BioPageView";
import type { BioFamilyPublic } from "@shared/bio";

/**
 * The Family view (militaryvoices.ai/<handle>/family/<key>): a private page for
 * the people closest to them. Their note, what they've made, the episodes to
 * start with, their story and its milestones, photos, and a way to leave a
 * note. No stats for brands, no sponsor talk.
 */

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n)));
const dateOf = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

type AskInput = { name: string; email: string; question: string; episode: string; website: string };

export function BioFamilyView({ data, preview = false, onAsk, onLoadMessages }: {
  data: BioFamilyPublic;
  preview?: boolean;
  onAsk?: (q: AskInput) => Promise<{ token?: string; createdAt?: string }>;
  onLoadMessages?: (tokens: string[]) => Promise<ChatMsg[]>;
}) {
  const t = data.theme;
  const dark = t.shade === "dark";
  const theirs = t.color.toLowerCase() === "#ffffff" && !dark ? "#053877" : t.color;
  const accent = standOut(theirs, dark ? "#0b1020" : "#f5f6fa", dark);
  const ink = dark ? "#ffffff" : "#0b1020";
  const sub = dark ? "rgba(255,255,255,0.68)" : "rgba(11,16,32,0.62)";
  const card = dark ? "rgba(255,255,255,0.07)" : "#ffffff";
  const line = dark ? "rgba(255,255,255,0.12)" : "rgba(11,16,32,0.10)";
  const font = t.font === "serif" ? "Georgia, 'Times New Roman', serif" : t.font === "mono" ? "'JetBrains Mono', ui-monospace, monospace" : "var(--font-sans)";
  const f = data.family;
  const first = data.firstName || (data.displayName || "me").split(" ")[0];
  const photo = data.family.photo || data.heroUrl || data.avatarUrl;
  const face = data.family.photo || data.avatarUrl;
  const [playing, setPlaying] = useState<string | null>(null);
  const [big, setBig] = useState<number | null>(null);
  const [chat, setChat] = useState(false);
  const eps = data.podcast?.episodes ?? [];
  const picks = (f.favorites.length ? f.favorites.map((id) => eps.find((e) => e.id === id)).filter(Boolean) : eps.slice(0, 3)) as typeof eps;
  const n = data.numbers;
  const proud = [
    n.episodes ? { big: String(n.episodes), label: n.episodes === 1 ? "episode made" : "episodes made" } : null,
    n.listens ? { big: compact(n.listens), label: "listens" } : null,
    n.followers ? { big: compact(n.followers), label: "people following along" } : null,
  ].filter(Boolean) as { big: string; label: string }[];

  const section = (title: string, body: React.ReactNode) => (
    <section className="rounded-3xl p-5 text-left" style={{ background: card, border: `1px solid ${line}` }}>
      <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em]" style={{ color: sub }}>{title}</p>
      {body}
    </section>
  );

  return (
    <div style={{ background: dark ? "#0b1020" : "#f5f6fa", color: ink, fontFamily: font, minHeight: "100%" }} className="relative pb-10" data-testid="bio-family">
      {data.askEnabled && (
        <>
          {chat && <div className={`${preview ? "absolute" : "fixed"} inset-0 z-20`} onClick={() => setChat(false)} aria-hidden />}
          <Chat handle={data.handle} name={data.displayName} avatar={face} welcome={`Leave ${first} a note. Only ${first} sees it.`} accent={accent} ink={ink} sub={sub} line={line} dark={dark} preview={preview} open={chat} setOpen={setChat}
            onAsk={onAsk ? (x) => onAsk({ ...x, episode: "From the family page" }) : undefined} onLoad={onLoadMessages} />
        </>
      )}

      {/* The top: their photo, warm, and who it's for. */}
      <div className="relative flex min-h-[420px] flex-col justify-end text-center text-white" style={{ background: photo ? `center 25%/cover url(${photo})` : `linear-gradient(145deg, ${theirs}, #000741)` }}>
        <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, rgba(0,0,0,0) 30%, rgba(0,0,0,0.6) 75%, ${dark ? "#0b1020" : "rgba(0,0,0,0.85)"} 100%)` }} />
        <div className="relative px-5 pb-8">
          <p className="mx-auto flex w-fit items-center gap-1.5 rounded-full bg-black/30 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em]"><Heart className="h-3 w-3 fill-current" /> For family</p>
          <h1 className="mt-2 text-balance text-[32px] font-bold leading-tight tracking-tight">{data.displayName || "Your name"}</h1>
          {data.branch && <p className="mt-0.5 text-sm text-white/80">{data.branch}</p>}
        </div>
      </div>

      <div className="mx-auto flex max-w-[560px] flex-col gap-4 px-4 pt-5">
        {f.note && (
          <section className="relative rounded-3xl p-6 text-left" style={{ background: dark ? "rgba(240,167,31,0.10)" : "#fff8ea", border: `1px solid ${dark ? "rgba(240,167,31,0.25)" : "#f3dfb3"}` }}>
            <p className="whitespace-pre-line text-[17px] leading-relaxed" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>{f.note}</p>
            <div className="mt-4 flex items-center gap-2.5">
              {face && <img src={face} alt="" className="h-9 w-9 rounded-full object-cover" />}
              <p className="text-sm font-semibold" style={{ fontFamily: "Georgia, serif", fontStyle: "italic" }}>{first}</p>
            </div>
          </section>
        )}

        {proud.length > 0 && (
          <div className={`grid gap-3 ${proud.length === 3 ? "grid-cols-3" : proud.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
            {proud.map((p) => (
              <div key={p.label} className="rounded-3xl p-4 text-center" style={{ background: card, border: `1px solid ${line}` }}>
                <p className="text-[26px] font-bold leading-none tabular-nums" style={{ color: accent }}>{p.big}</p>
                <p className="mt-1.5 text-[11px] leading-snug" style={{ color: sub }}>{p.label}</p>
              </div>
            ))}
          </div>
        )}

        {picks.length > 0 && section(f.favorites.length ? `Start with these` : `Latest from ${data.podcast?.title ?? "the show"}`, (
          <div className="flex flex-col">
            {picks.map((e, i) => (
              <div key={e.id} style={i ? { borderTop: `1px solid ${line}` } : {}} className="py-2.5">
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => !preview && setPlaying(playing === e.id ? null : e.id)} aria-label={playing === e.id ? `Pause ${e.title}` : `Play ${e.title}`} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl" style={{ background: e.artworkUrl ? `center/cover url(${e.artworkUrl})` : data.avatarUrl ? `center/cover url(${data.avatarUrl})` : theirs }}>
                    <span className="absolute inset-0 m-auto flex h-8 w-8 items-center justify-center rounded-full shadow" style={{ background: accent, color: onColor(accent) }}>{playing === e.id ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 translate-x-px fill-current" />}</span>
                  </button>
                  <span className="min-w-0 flex-1"><span className="line-clamp-2 block text-sm font-semibold leading-snug">{e.title}</span><span className="text-xs" style={{ color: sub }}>{dateOf(e.publishedAt)}</span></span>
                </div>
                {playing === e.id && <audio src={e.audio} autoPlay controls preload="none" className="mt-2 w-full" onEnded={() => setPlaying(null)} />}
              </div>
            ))}
          </div>
        ))}

        {f.story && section("My story", <p className="whitespace-pre-line text-[15px] leading-relaxed">{f.story}</p>)}

        {f.milestones.length > 0 && section("Along the way", (
          <ol className="relative ml-2 border-l-2 pl-5" style={{ borderColor: `${accent}55` }}>
            {f.milestones.map((m) => (
              <li key={m.id} className="relative pb-5 last:pb-0">
                <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4" style={{ background: accent, ["--tw-ring-color" as string]: dark ? "#141a2c" : "#ffffff" }} />
                {m.when && <p className="text-xs font-bold uppercase tracking-wider" style={{ color: accent }}>{m.when}</p>}
                {m.title && <p className="text-[15px] font-semibold leading-snug">{m.title}</p>}
                {m.note && <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed" style={{ color: sub }}>{m.note}</p>}
              </li>
            ))}
          </ol>
        ))}

        {f.photos.length > 0 && section("Photos", (
          <div className="grid grid-cols-2 gap-2">
            {f.photos.map((p, i) => (
              <button key={p.id} type="button" onClick={() => setBig(i)} className={`group relative overflow-hidden rounded-2xl ${i === 0 && f.photos.length % 2 === 1 ? "col-span-2 aspect-[16/10]" : "aspect-square"}`}>
                <img src={p.url} alt={p.caption} className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" />
                {p.caption && <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-2 pt-6 text-left text-xs font-medium text-white">{p.caption}</span>}
              </button>
            ))}
          </div>
        ))}

        {data.askEnabled && (
          <button type="button" onClick={() => setChat(true)} className="inline-flex items-center justify-center gap-2 rounded-full px-5 py-3.5 text-sm font-bold" style={{ background: accent, color: onColor(accent) }} data-testid="family-note"><Heart className="h-4 w-4" /> Leave {first} a note</button>
        )}

        <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs" style={{ color: sub }}><Lock className="h-3 w-3" /> A private page for family. Please keep this link to yourselves.</p>
      </div>

      {big != null && f.photos[big] && (
        <div className={`${preview ? "absolute" : "fixed"} inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4`} onClick={() => setBig(null)} role="dialog" aria-label="Photo">
          <button type="button" className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white" aria-label="Close"><X className="h-5 w-5" /></button>
          <img src={f.photos[big].url} alt={f.photos[big].caption} className="max-h-[80%] max-w-full rounded-xl object-contain" />
          {f.photos[big].caption && <p className="mt-3 text-center text-sm text-white/85">{f.photos[big].caption}</p>}
        </div>
      )}
    </div>
  );
}
