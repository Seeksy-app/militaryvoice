import { useRef, useState } from "react";
import { Heart, Lock, Pause, Play, X } from "lucide-react";
import { Chat, onColor, styled, type ChatMsg } from "@/components/BioPageView";
import { useBioFont } from "@/lib/bioFont";
import { bioPalette, videoEmbed, type BioFamilyPublic } from "@shared/bio";

/**
 * The Family view (militaryvoices.ai/<handle>/family/<key>): a private page for
 * the people closest to them. Their note, a voice message and a video from
 * them, the milestones along the way, photos, and a way to leave a note. No
 * podcast, no stats for brands, no sponsor talk.
 */

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n)));

type AskInput = { name: string; email: string; question: string; episode: string; website: string };

export function BioFamilyView({ data, preview = false, onAsk, onLoadMessages }: {
  data: BioFamilyPublic;
  preview?: boolean;
  onAsk?: (q: AskInput) => Promise<{ token?: string; createdAt?: string }>;
  onLoadMessages?: (tokens: string[]) => Promise<ChatMsg[]>;
}) {
  const t = data.theme;
  const pal = bioPalette(t);
  const { theirs, paper, dark, ink, sub, card, line, accent, font } = pal;
  useBioFont(t.font);
  const f = data.family;
  const first = f.name?.trim() ? f.name.trim().split(/\s+/)[0] : data.firstName || (data.displayName || "me").split(" ")[0];
  const photo = data.family.photo || data.heroUrl || data.avatarUrl;
  const face = data.family.photo || data.avatarUrl;
  const [big, setBig] = useState<number | null>(null);
  const [chat, setChat] = useState(false);
  const name = f.name?.trim() || data.displayName || "Your name";
  // Their voice message, from our copy.
  const voice = f.audio && data.media?.audio?.from === f.audio ? data.media.audio.url : "";
  const voiceEl = useRef<HTMLAudioElement | null>(null);
  const [hearing, setHearing] = useState(false);
  const [heard, setHeard] = useState(0);
  const fv = f.video ?? "";
  const video = fv.startsWith("r2:") ? (data.media?.video?.from === fv ? { kind: "file" as const, src: data.media.video.url, tall: false } : null) : videoEmbed(fv);
  const n = data.numbers;
  const proud = [
    n.followers ? { big: compact(n.followers), label: "people following along" } : null,
  ].filter(Boolean) as { big: string; label: string }[];

  const section = (title: string, body: React.ReactNode) => (
    <section className="rounded-3xl p-5 text-left" style={{ background: card, border: `1px solid ${line}` }}>
      <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em]" style={{ color: sub }}>{title}</p>
      {body}
    </section>
  );

  return (
    <div style={{ background: pal.background, color: ink, fontFamily: font, minHeight: "100%" }} className="relative pb-10" data-testid="bio-family">

      {/* The top: their photo, warm, and who it's for. */}
      <div className="relative flex min-h-[420px] flex-col justify-end text-center text-white" style={{ background: photo ? `center 25%/cover url(${photo})` : `linear-gradient(145deg, ${theirs}, #000741)` }}>
        <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, rgba(0,0,0,0) 30%, rgba(0,0,0,0.6) 75%, ${dark ? "#0b1020" : "rgba(0,0,0,0.85)"} 100%)` }} />
        <div className="relative px-5 pb-8">
          <p className="mx-auto flex w-fit items-center gap-1.5 rounded-full bg-black/30 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em]"><Heart className="h-3 w-3 fill-current" /> For family</p>
          <h1 className="mt-2 text-balance text-[32px] font-bold leading-tight tracking-tight">{name}</h1>
          {data.branch && <p className="mt-0.5 text-sm text-white/80">{data.branch}</p>}
        </div>
      </div>

      <div className="mx-auto flex max-w-[560px] flex-col gap-4 px-4 pt-5">
        {f.note && (
          <section className="relative rounded-3xl p-6 text-left" style={{ background: dark ? "rgba(240,167,31,0.10)" : "#fff8ea", border: `1px solid ${dark ? "rgba(240,167,31,0.25)" : "#f3dfb3"}` }}>
            <p className="whitespace-pre-line text-[17px] leading-relaxed" style={{ fontFamily: "Georgia, 'Times New Roman', serif", textAlign: f.noteAlign ?? "left" }}>{styled(f.note)}</p>
            <div className="mt-4 flex items-center gap-2.5">
              {face && <img src={face} alt="" className="h-9 w-9 rounded-full object-cover" />}
              <p className="text-sm font-semibold" style={{ fontFamily: "Georgia, serif", fontStyle: "italic" }}>{first}</p>
            </div>
          </section>
        )}

        {voice && (
          <section className="flex items-center gap-3 rounded-3xl p-4 text-left" style={{ background: card, border: `1px solid ${line}` }} data-testid="family-voice">
            <button type="button" onClick={() => { const a = voiceEl.current; if (!a || preview) return; if (a.paused) void a.play(); else a.pause(); }} aria-label={hearing ? "Pause the message" : "Play the message"} className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full shadow-lg" style={{ background: accent, color: onColor(accent) }}>
              {face && <img src={face} alt="" className="absolute inset-0 h-full w-full rounded-full object-cover opacity-25" />}
              {hearing ? <Pause className="relative h-6 w-6 fill-current" /> : <Play className="relative h-6 w-6 translate-x-0.5 fill-current" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: accent }}>A message from {first}</p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: line }}><div className="h-full rounded-full transition-[width]" style={{ width: `${Math.round(heard * 100)}%`, background: accent }} /></div>
            </div>
            <audio ref={voiceEl} src={voice} preload="none" onPlay={() => setHearing(true)} onPause={() => setHearing(false)} onEnded={() => { setHearing(false); setHeard(0); }} onTimeUpdate={(e) => { const a = e.currentTarget; setHeard(a.duration ? a.currentTime / a.duration : 0); }} />
          </section>
        )}

        {video && (
          <section className="overflow-hidden rounded-3xl bg-black" style={{ border: `1px solid ${line}` }} data-testid="family-video">
            {video.kind === "file"
              ? <video src={video.src} controls playsInline preload="metadata" className="max-h-[640px] w-full bg-black" />
              : <iframe src={video.src} title="Video" loading="lazy" className={`w-full ${video.tall ? "h-[620px]" : "aspect-video"}`} style={{ border: 0 }} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />}
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
      {data.askEnabled && (
        <>
          {chat && <div className={`${preview ? "absolute" : "fixed"} inset-0 z-20`} onClick={() => setChat(false)} aria-hidden />}
          <Chat handle={data.handle} name={data.displayName} avatar={face} welcome={`Leave ${first} a note. Only ${first} sees it.`} accent={accent} ink={ink} sub={sub} line={line} dark={dark} preview={preview} open={chat} setOpen={setChat}
            onAsk={onAsk ? (x) => onAsk({ ...x, episode: "From the family page" }) : undefined} onLoad={onLoadMessages} />
        </>
      )}
    </div>
  );
}
