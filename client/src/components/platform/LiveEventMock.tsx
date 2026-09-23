import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { PlatformIcon } from "@/components/SocialIcons";
import { CLIPS, LoopVideo } from "./stockVideo";

// The hero's picture: one big, immersive keynote — a speaker at a lectern
// facing a full hall — with just enough of our product laid over it to read
// as "this is running on MilitaryVoices": the LIVE bar, a lower third, and a
// second stage in picture-in-picture. Real footage (Pexels), muted, looped.

function useViewers(start: number) {
  const [n, setN] = useState(start);
  useEffect(() => {
    const t = setInterval(() => setN((v) => v + Math.round(Math.random() * 9) - 2), 1800);
    return () => clearInterval(t);
  }, []);
  return n;
}

function useClock(startSeconds: number) {
  const [s, setS] = useState(startSeconds);
  useEffect(() => {
    const t = setInterval(() => setS((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function LiveBar({ compact = false }: { compact?: boolean }) {
  const viewers = useViewers(12480);
  const clock = useClock(1 * 3600 + 14 * 60 + 41);
  return (
    <div className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-[#000741]/70 py-1 pl-1 pr-3 text-white shadow-lg backdrop-blur-md">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ED1C24] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] sm:text-[11px]">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
        </span>
        Live
      </span>
      {!compact && <span className="font-mono text-xs tabular-nums text-white/70">{clock}</span>}
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums">
        <Eye className="h-3.5 w-3.5 text-[#F0A71F]" /> {viewers.toLocaleString("en-US")}
      </span>
      <span className="inline-flex items-center" title="Streaming to YouTube">
        <PlatformIcon platform="youtube" className="h-4 w-4" />
      </span>
    </div>
  );
}

function LowerThird({ size = "lg" }: { size?: "lg" | "sm" }) {
  return (
    <div className="flex items-stretch overflow-hidden rounded-md shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
      <div className={`shrink-0 bg-[#F0A71F] ${size === "lg" ? "w-1.5" : "w-1"}`} />
      <div className={`min-w-0 bg-[#000741]/90 backdrop-blur-sm ${size === "lg" ? "px-4 py-2.5" : "px-2.5 py-1.5"}`}>
        <p className={`truncate font-bold leading-tight text-white ${size === "lg" ? "text-lg" : "text-sm"}`} style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>
          James Okafor
        </p>
        <p className={`truncate leading-tight text-[#F0A71F] ${size === "lg" ? "text-[13px]" : "text-[11px]"}`}>{size === "lg" ? "Army veteran · Keynote: Leading after service" : "Keynote · Leading after service"}</p>
      </div>
    </div>
  );
}

function Pip({ className = "" }: { className?: string }) {
  return (
    <div className={`overflow-hidden rounded-lg bg-[#04102b] shadow-[0_12px_40px_rgba(0,0,0,0.6)] ring-1 ring-white/25 ${className}`}>
      <div className="relative aspect-video">
        <LoopVideo src={CLIPS.stage2.src} poster={CLIPS.stage2.poster} className="absolute inset-0 h-full w-full object-cover" />
        <span className="absolute left-1.5 top-1.5 rounded bg-emerald-500 px-1 text-[9px] font-bold uppercase leading-4 tracking-wider text-white">Next</span>
      </div>
      <p className="truncate px-2 py-1 text-[11px] font-semibold text-white/90">Stage 2<span className="hidden sm:inline"> · Workshop</span></p>
    </div>
  );
}

/**
 * Desktop: the keynote fills the right of the hero edge to edge, fading into
 * navy under the headline so the words always sit on a solid ground.
 */
export function HeroBackdrop() {
  return (
    <div className="absolute inset-y-0 right-0 hidden w-[66%] lg:block xl:w-[68%]" aria-label="A keynote speaker at a lectern, live on MilitaryVoices, with a second stage in picture-in-picture" role="img">
      <LoopVideo src={CLIPS.keynote.src} poster={CLIPS.keynote.poster} className="absolute inset-0 h-full w-full object-cover object-[60%_50%]" />
      {/* Navy under the words, a little vignette everywhere else. */}
      <div aria-hidden className="absolute inset-0 bg-[linear-gradient(90deg,#030b1f_0%,rgba(3,11,31,0.92)_22%,rgba(3,11,31,0.45)_46%,rgba(3,11,31,0)_68%)]" />
      <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,11,31,0.55)_0%,rgba(3,11,31,0)_24%,rgba(3,11,31,0)_70%,rgba(3,11,31,0.85)_100%)]" />

      <div className="absolute right-8 top-8">
        <LiveBar />
      </div>
      <div className="absolute bottom-[13%] left-[38%] max-w-[46%]">
        <LowerThird />
      </div>
      <Pip className="absolute bottom-28 right-8 w-52 xl:w-56" />
    </div>
  );
}

/** Phones and tablets: the same scene as a card under the buttons. */
export function HeroCard() {
  return (
    <div className="relative overflow-hidden rounded-2xl ring-1 ring-white/10 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.85)] lg:hidden" aria-label="A keynote speaker at a lectern, live on MilitaryVoices" role="img">
      <div className="relative aspect-[4/3] sm:aspect-video">
        <LoopVideo src={CLIPS.keynote.src} poster={CLIPS.keynote.poster} className="absolute inset-0 h-full w-full object-cover object-[62%_50%]" />
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,11,31,0.45)_0%,rgba(3,11,31,0)_30%,rgba(3,11,31,0)_55%,rgba(3,11,31,0.85)_100%)]" />
        <div className="absolute left-3 top-3">
          <LiveBar compact />
        </div>
        <div className="absolute bottom-3 left-3 max-w-[64%]">
          <LowerThird size="sm" />
        </div>
        <Pip className="absolute bottom-3 right-3 w-[30%] sm:w-40" />
      </div>
    </div>
  );
}
