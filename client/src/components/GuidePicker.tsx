import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { GUIDES, DEFAULT_AGE, DEFAULT_GUIDE, guideFace, guideById, guideSample, sampleLine, type GuideAge, type GuideId } from "@shared/guides";
import type { GuideMe } from "@/components/LoriGuide";

/**
 * Pick your AI guide (Andrew, 21 Nov 2026: "let them choose their assistance during onboarding. Give them some
 * faces to choose from, a voice." Mockup approved: "Yes, build it"). Six face cards, one tap picks, "Hear me" plays
 * that guide's sample line. Used by the step after sign-up and by Settings → Your guide.
 * Always "AI guide", never a person.
 */

/** Files that aren't made yet come back as the app's page, not a picture or a sound: check the type. */
function useHasFile(url: string, kind: "audio" | "image") {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(url, { method: "HEAD" }).then((r) => { if (live) setOk(r.ok && (r.headers.get("content-type") ?? "").startsWith(kind)); }).catch(() => {});
    return () => { live = false; };
  }, [url, kind]);
  return ok;
}

const TINT: Record<GuideId, [string, string]> = {
  lori: ["#e9eef8", "#053877"], marcus: ["#e9eef8", "#3b5b8c"], rosa: ["#fbeee4", "#b4603a"],
  dan: ["#eef0ea", "#5d6b48"], mei: ["#f1ecf8", "#6a4b98"], jay: ["#e6f3f0", "#2c7a6b"],
};

function Card({ id, age, on, small, playing, onPick, onHear }: { id: GuideId; age: GuideAge; on: boolean; small: boolean; playing: boolean; onPick: () => void; onHear: () => void }) {
  const g = guideById(id)!;
  // The picture swaps in place when the age changes; its initial shows only if the file is missing.
  const [broken, setBroken] = useState<string | null>(null);
  const src = guideFace(id, age);
  const face = broken !== src;
  const sample = useHasFile(guideSample(id, age), "audio");
  const [bg, ink] = TINT[id];
  return (
    <div
      role="radio"
      aria-checked={on}
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(); } }}
      className={`relative min-w-0 cursor-pointer overflow-hidden border bg-card text-left shadow-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-[#053877] ${small ? "rounded-[14px]" : "rounded-[14px] sm:rounded-[18px]"} ${on ? "border-[#053877] shadow-[0_0_0_3px_rgba(5,56,119,0.18),0_8px_24px_rgba(5,56,119,0.12)]" : "border-border hover:border-[#053877]/40"}`}
      data-testid={`guide-${id}`}
    >
      {face ? (
        <img src={src} alt="" onError={() => setBroken(src)} className="block aspect-square w-full object-cover" />
      ) : (
        <span className="flex aspect-square w-full items-center justify-center" style={{ background: `linear-gradient(160deg, ${bg}, #fff)` }}>
          <span className={`flex items-center justify-center rounded-full font-bold text-white ${small ? "h-11 w-11 text-lg" : "h-11 w-11 text-lg sm:h-16 sm:w-16 sm:text-2xl"}`} style={{ background: ink }}>{g.name[0]}</span>
        </span>
      )}
      {on && <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#053877] text-white shadow sm:right-2 sm:top-2 sm:h-6 sm:w-6"><Check className="h-3 w-3 sm:h-3.5 sm:w-3.5" strokeWidth={3} /></span>}
      <div className={small ? "px-2.5 pb-2.5 pt-2" : "px-2 pb-2.5 pt-2 sm:px-3 sm:pb-3 sm:pt-2.5"}>
        <p className={`font-bold text-[#000741] dark:text-white ${small ? "text-sm" : "text-sm sm:text-base"}`}>{g.name}</p>
        {!small && <p className="hidden text-xs text-muted-foreground sm:block">{g.voice}</p>}
        {sample && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onHear(); }}
            className={`mt-1.5 inline-flex h-7 items-center whitespace-nowrap rounded-full border text-[11px] font-semibold ${small ? "w-full justify-center gap-1 px-1" : "gap-1.5 px-2.5 sm:mt-2 sm:px-3 sm:text-xs"} ${playing ? "border-[#053877] bg-[#053877]/[0.06] text-[#053877]" : "border-border text-[#000741] hover:bg-muted dark:text-white"}`}
            aria-label={`Hear ${g.name}`}
            data-testid={`guide-hear-${id}`}
          >
            {playing ? <span className="flex h-3 items-end gap-[2px]" aria-hidden>{[6, 12, 8, 11].map((h, i) => <i key={i} className="w-[3px] animate-pulse rounded-sm bg-[#053877]" style={{ height: h, animationDelay: `${i * 120}ms` }} />)}</span> : <span className="h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-current" aria-hidden />}
            {playing ? "Playing" : "Hear me"}
          </button>
        )}
      </div>
    </div>
  );
}

/** The six cards, with Younger · Older above them (Andrew, 21 Nov: "can we ask the user the age they want"); one tap swaps all six. Picking plays nothing by itself (sound only on Hear me). */
export function GuidePicker({ value, onChange, age, onAge, small = false }: { value: GuideId; onChange: (id: GuideId) => void; age: GuideAge; onAge: (a: GuideAge) => void; small?: boolean }) {
  const [playing, setPlaying] = useState<GuideId | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  // A new age is a new voice: stop the old one.
  useEffect(() => { audio.current?.pause(); setPlaying(null); }, [age]);
  const hear = (id: GuideId) => {
    audio.current?.pause();
    if (playing === id) { setPlaying(null); return; }
    const a = new Audio(guideSample(id, age));
    audio.current = a;
    a.onended = a.onerror = () => setPlaying((p) => (p === id ? null : p));
    setPlaying(id);
    void a.play().catch(() => setPlaying(null));
  };
  return (
    <div>
      <div role="radiogroup" aria-label="Age" className="mb-3 inline-flex rounded-full border border-border bg-card p-1" data-testid="guide-age">
          {(["younger", "older"] as const).map((a) => (
            <button key={a} type="button" role="radio" aria-checked={age === a} onClick={() => onAge(a)} className={`h-8 rounded-full px-4 text-[13px] font-semibold ${age === a ? "bg-[#000741] text-white dark:bg-white dark:text-[#000741]" : "text-muted-foreground hover:text-foreground"}`} data-testid={`guide-age-${a}`}>
              {a === "younger" ? "Younger" : "Older"}
            </button>
          ))}
      </div>
      <div role="radiogroup" aria-label="Your guide" className={`grid gap-2 ${small ? "grid-cols-3 sm:grid-cols-6 sm:gap-2.5" : "grid-cols-3 sm:gap-3.5 lg:grid-cols-6"}`}>
        {GUIDES.map((g) => <Card key={g.id} id={g.id} age={age} on={value === g.id} small={small} playing={playing === g.id} onPick={() => onChange(g.id)} onHear={() => hear(g.id)} />)}
      </div>
    </div>
  );
}

/** Save a pick (or switch the guide off). The server sets name, voice and face from shared/guides.ts. */
export function useSaveGuide() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async (body: { guideId: GuideId; age: GuideAge } | { enabled: false }) => {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/guide/me", { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { message?: string }).message || "That didn't save. Try again.");
      await qc.invalidateQueries({ queryKey: ["/api/guide/me"] });
      return true;
    } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(false); }
  };
  return { save, busy, err };
}

/** The step after sign-up (only while GET /api/guide/me says offer). Pre-picked, so Continue always works. */
export function GuideStep() {
  const [pick, setPick] = useState<GuideId>(DEFAULT_GUIDE);
  const [age, setAge] = useState<GuideAge>(DEFAULT_AGE);
  const { save, busy, err } = useSaveGuide();
  const g = guideById(pick)!;
  return (
    <section className="mx-auto max-w-[1100px] pb-8 pt-2" data-testid="guide-step">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#b36b00] dark:text-[#F0A71F]">Last step</p>
      <h1 className="mt-1.5 text-[28px] font-bold leading-tight text-[#000741] dark:text-white sm:text-4xl">Pick your guide</h1>
      <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground sm:text-[15px]">Your guide is an AI that shows you around. Ask it how to do something and it points to the right place. You make every click.</p>
      <div className="mt-4 sm:mt-6"><GuidePicker value={pick} onChange={setPick} age={age} onAge={setAge} /></div>
      <p className="mt-3 flex max-w-3xl items-center gap-2.5 rounded-2xl border border-[#053877]/15 bg-[#053877]/[0.05] px-3.5 py-2.5 text-[13px] sm:mt-4 sm:text-sm" data-testid="guide-step-line">
        <span><b>{g.name}</b> <span className="ml-1 rounded-full bg-[#eef2fa] px-1.5 py-0.5 align-[1px] text-[10px] font-bold uppercase tracking-wide text-[#053877]">AI guide</span>{" "}&ldquo;{sampleLine(g.name)}&rdquo;</span>
      </p>
      {/* Under the line, on the first screen at 390 too (three across keeps the cards short). */}
      <div className="mt-4 sm:mt-6">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <button type="button" disabled={busy} onClick={() => void save({ guideId: pick, age })} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#000741] px-6 text-[15px] font-semibold text-white hover:bg-[#053877] disabled:opacity-60 sm:w-auto" data-testid="guide-step-continue">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Continue with {g.name} →
          </button>
          <button type="button" disabled={busy} onClick={() => void save({ enabled: false })} className="text-sm text-muted-foreground underline underline-offset-[3px] hover:text-foreground" data-testid="guide-step-skip">No thanks, skip</button>
          <span className="text-[13px] text-muted-foreground">You can change your guide any time in Settings.</span>
        </div>
        {err && <p className="mt-2 text-sm text-[#b42318]">{err}</p>}
      </div>
    </section>
  );
}

/** What's offered: the step (offer) and Settings → Your guide (canPick, or a guide already on). */
export const guideOffered = (g?: GuideMe) => !!g && !g.enabled && !!g.offer;
export const guidePickable = (g?: GuideMe) => !!g && (g.enabled || !!g.canPick);
