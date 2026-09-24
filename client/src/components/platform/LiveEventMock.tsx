import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { PlatformIcon } from "@/components/SocialIcons";

// The hero's picture: a real event day, one room at a time — the keynote, a
// panel, the ballroom camera, the expo floor — crossfading slowly, with just
// enough of our product laid over it to read as "this is running on
// MilitaryVoices": the LIVE bar, a lower third for the room on screen, and the
// next room waiting in picture-in-picture. Photos in /platform/events.

const E = "/platform/events";
const ROOMS = [
  { src: `${E}/e0.jpg`, pos: "70% 45%", title: "Main stage", line: "Keynote · Leading after service" },
  { src: `${E}/e1.jpg`, pos: "55% 40%", title: "Panel · Stage 1", line: "Women who served: what comes next" },
  { src: `${E}/e2.jpg`, pos: "50% 55%", title: "Gala dinner", line: "Live to YouTube from the ballroom" },
  { src: `${E}/e3.jpg`, pos: "50% 50%", title: "Expo floor", line: "Booth tours with our sponsors" },
] as const;
const HOLD_MS = 6000;

function useRoom() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % ROOMS.length), HOLD_MS);
    return () => clearInterval(t);
  }, []);
  return i;
}

/** Every room stacked, the current one faded in and drifting slowly closer. */
function Rooms({ i }: { i: number }) {
  return (
    <>
      <style>{`@keyframes mv-drift{from{transform:scale(1)}to{transform:scale(1.08)}}@media (prefers-reduced-motion:reduce){.mv-drift{animation:none!important}}`}</style>
      {ROOMS.map((r, k) => (
        <img
          key={r.src}
          src={r.src}
          alt=""
          loading={k === 0 ? "eager" : "lazy"}
          className={`mv-drift absolute inset-0 h-full w-full object-cover transition-opacity duration-[1400ms] ease-in-out ${k === i ? "opacity-100" : "opacity-0"}`}
          style={{ objectPosition: r.pos, animation: k === i ? `mv-drift ${HOLD_MS + 1400}ms linear forwards` : undefined }}
        />
      ))}
    </>
  );
}

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

function LowerThird({ i, size = "lg" }: { i: number; size?: "lg" | "sm" }) {
  const r = ROOMS[i];
  return (
    <div key={i} className="flex items-stretch overflow-hidden rounded-md shadow-[0_8px_30px_rgba(0,0,0,0.5)] animate-in fade-in slide-in-from-left-2 duration-500">
      <div className={`shrink-0 bg-[#F0A71F] ${size === "lg" ? "w-1.5" : "w-1"}`} />
      <div className={`min-w-0 bg-[#000741]/90 backdrop-blur-sm ${size === "lg" ? "px-4 py-2.5" : "px-2.5 py-1.5"}`}>
        <p className={`truncate font-bold leading-tight text-white ${size === "lg" ? "text-lg" : "text-sm"}`} style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>
          {r.title}
        </p>
        <p className={`truncate leading-tight text-[#F0A71F] ${size === "lg" ? "text-[13px]" : "text-[11px]"}`}>{r.line}</p>
      </div>
    </div>
  );
}

function Pip({ i, className = "" }: { i: number; className?: string }) {
  const next = ROOMS[(i + 1) % ROOMS.length];
  return (
    <div className={`overflow-hidden rounded-lg bg-[#04102b] shadow-[0_12px_40px_rgba(0,0,0,0.6)] ring-1 ring-white/25 ${className}`}>
      <div className="relative aspect-video">
        <img key={next.src} src={next.src} alt="" className="absolute inset-0 h-full w-full object-cover animate-in fade-in duration-700" style={{ objectPosition: next.pos }} />
        <span className="absolute left-1.5 top-1.5 rounded bg-emerald-500 px-1 text-[9px] font-bold uppercase leading-4 tracking-wider text-white">Next</span>
      </div>
      <p className="truncate px-2 py-1 text-[11px] font-semibold text-white/90">{next.title}</p>
    </div>
  );
}

/**
 * Desktop: the event fills the right of the hero edge to edge, fading into
 * navy under the headline so the words always sit on a solid ground.
 */
export function HeroBackdrop() {
  const i = useRoom();
  return (
    <div className="absolute inset-y-0 right-0 hidden overflow-hidden w-[66%] lg:block xl:w-[68%]" aria-label="A live event on MilitaryVoices: keynote, panel, ballroom and expo floor" role="img">
      <Rooms i={i} />
      {/* Navy under the words, a little vignette everywhere else. */}
      <div aria-hidden className="absolute inset-0 bg-[linear-gradient(90deg,#030b1f_0%,rgba(3,11,31,0.92)_22%,rgba(3,11,31,0.45)_46%,rgba(3,11,31,0)_68%)]" />
      <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,11,31,0.55)_0%,rgba(3,11,31,0)_24%,rgba(3,11,31,0)_70%,rgba(3,11,31,0.85)_100%)]" />

      <div className="absolute right-8 top-8">
        <LiveBar />
      </div>
      <div className="absolute bottom-[13%] left-[38%] max-w-[46%]">
        <LowerThird i={i} />
      </div>
      <Pip i={i} className="absolute bottom-28 right-8 w-52 xl:w-56" />
    </div>
  );
}

/** Phones and tablets: the same scene as a card under the buttons. */
export function HeroCard() {
  const i = useRoom();
  return (
    <div className="relative overflow-hidden rounded-2xl ring-1 ring-white/10 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.85)] lg:hidden" aria-label="A live event on MilitaryVoices" role="img">
      <div className="relative aspect-[4/3] overflow-hidden sm:aspect-video">
        <Rooms i={i} />
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,11,31,0.45)_0%,rgba(3,11,31,0)_30%,rgba(3,11,31,0)_55%,rgba(3,11,31,0.85)_100%)]" />
        <div className="absolute left-3 top-3">
          <LiveBar compact />
        </div>
        <div className="absolute bottom-3 left-3 max-w-[64%]">
          <LowerThird i={i} size="sm" />
        </div>
        <Pip i={i} className="absolute bottom-3 right-3 w-[30%] sm:w-40" />
      </div>
    </div>
  );
}
