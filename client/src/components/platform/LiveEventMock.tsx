import { useEffect, useState, type ReactNode } from "react";
import { Eye, Video } from "lucide-react";
import { PlatformIcon } from "@/components/SocialIcons";
import { CLIPS, VCAST, LoopVideo, SoonPill } from "./stockVideo";

// The hero's picture: a live event as the production team sees it. The main
// stage on air, the other feeds around it — a second stage, the expo floor,
// a camera on the audience, the control room, a guest in the green room —
// with our LIVE bar across the top. Real footage (Pexels), muted and looped.

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

/** One feed in the multiview: the clip, its name, and a tally light. */
function Feed({
  src,
  poster,
  label,
  tally,
  className = "",
  children,
}: {
  src: string;
  poster: string;
  label: string;
  tally?: "pgm" | "pvw";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-md bg-[#04102b] ${
        tally === "pgm" ? "ring-2 ring-[#ED1C24]" : tally === "pvw" ? "ring-2 ring-emerald-400" : "ring-1 ring-white/10"
      } ${className}`}
      style={{ containerType: "inline-size" }}
    >
      <LoopVideo src={src} poster={poster} className="absolute inset-0 h-full w-full object-cover" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
      <span className="absolute bottom-[5%] left-[4%] flex max-w-[92%] items-center gap-1 truncate rounded bg-black/55 px-1.5 py-0.5 text-[clamp(8px,6.5cqw,11px)] font-semibold text-white backdrop-blur-sm">
        {tally === "pvw" && <span className="rounded-sm bg-emerald-500 px-1 text-[0.85em] font-bold uppercase leading-tight">Next</span>}
        <span className="truncate">{label}</span>
      </span>
      {children}
    </div>
  );
}

export function LiveEventMock() {
  const viewers = useViewers(12480);
  const clock = useClock(2 * 3600 + 14 * 60 + 41);

  return (
    <div className="relative" aria-label="An illustration of a live event running on MilitaryVoices: two stages, the expo floor, cameras and the green room" role="img">
      {/* The glow the frame sits in. */}
      <div aria-hidden className="pointer-events-none absolute -inset-10 -z-10 rounded-[3rem] bg-[radial-gradient(60%_55%_at_55%_45%,rgba(240,167,31,0.22),transparent_70%)]" />

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#000741] shadow-[0_50px_100px_-30px_rgba(0,0,0,0.85)] ring-1 ring-black/40">
        {/* Broadcast chrome */}
        <div className="flex items-center gap-2.5 border-b border-white/10 bg-[#04102b] px-3 py-2 sm:gap-3 sm:px-4">
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[#ED1C24] px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
            </span>
            Live
          </span>
          <span className="hidden font-mono text-xs tabular-nums text-white/55 sm:inline">{clock}</span>
          <span className="min-w-0 truncate text-xs font-medium text-white/85 sm:text-sm"><span className="sm:hidden">Veterans Summit</span><span className="hidden sm:inline">Veterans Leadership Summit</span></span>
          <span className="ml-auto flex shrink-0 items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums text-white">
              <Eye className="h-3.5 w-3.5 text-[#F0A71F]" /> {viewers.toLocaleString("en-US")}
            </span>
            <span className="inline-flex items-center gap-1 text-white" title="Streaming to YouTube">
              <PlatformIcon platform="youtube" className="h-4 w-4" />
            </span>
          </span>
        </div>

        {/* The multiview */}
        <div className="grid grid-cols-3 gap-1.5 bg-black p-1.5">
          <Feed
            src={CLIPS.mainStage.src}
            poster={CLIPS.mainStage.poster}
            label="Main Stage · Camera 1"
            tally="pgm"
            className="col-span-3 aspect-video sm:col-span-2 sm:row-span-2 sm:aspect-auto"
          >
            {/* On air, the station mark, and the speaker's lower third. */}
            <span className="absolute left-[3%] top-[4%] inline-flex items-center gap-1 rounded bg-[#ED1C24] px-1.5 py-0.5 text-[clamp(8px,1.9cqw,11px)] font-bold uppercase tracking-[0.12em] text-white">On air</span>
            <img src="/logo-wave.png?v=2" alt="" className="absolute right-[3%] top-[4%] w-[9%] drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]" />
            <div className="absolute bottom-[14%] left-[3%] max-w-[70%]" style={{ fontSize: "clamp(10px, 3.2cqw, 19px)" }}>
              <div className="flex items-stretch overflow-hidden rounded-md shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
                <div className="w-[0.28em] shrink-0 bg-[#F0A71F]" />
                <div className="min-w-0 bg-[#000741]/92 px-[0.7em] py-[0.35em] backdrop-blur-sm">
                  <p className="truncate font-bold leading-tight text-white" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>James Okafor</p>
                  <p className="truncate text-[0.7em] leading-tight text-[#F0A71F]">Army veteran · Keynote: Leading after service</p>
                </div>
              </div>
            </div>
          </Feed>
          <Feed src={CLIPS.stage2.src} poster={CLIPS.stage2.poster} label="Stage 2 · Workshop" tally="pvw" className="aspect-video" />
          <Feed src={CLIPS.expo.src} poster={CLIPS.expo.poster} label="Expo floor" className="aspect-video" />
          <Feed src={CLIPS.camera.src} poster={CLIPS.camera.poster} label="Camera 3 · Audience" className="aspect-video" />
          <Feed src={CLIPS.control.src} poster={CLIPS.control.poster} label="Control room" className="hidden aspect-video sm:block" />
          <Feed src={VCAST.jordan.src} poster={VCAST.jordan.poster} label="Green room · Jordan" className="hidden aspect-video sm:block" />
        </div>

        {/* Where it's going out */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-white/10 bg-[#04102b] px-3 py-2 text-[11px] text-white/70 sm:px-4">
          <span className="inline-flex items-center gap-1.5 font-semibold text-white"><Video className="h-3.5 w-3.5 text-[#F0A71F]" /> 6 feeds · 2 stages</span>
          <span className="inline-flex items-center gap-1.5"><PlatformIcon platform="youtube" className="h-3.5 w-3.5 text-white" /> YouTube</span>
          <span className="inline-flex items-center gap-1.5 text-white/45">
            <PlatformIcon platform="linkedin" className="h-3.5 w-3.5" />
            <PlatformIcon platform="facebook" className="h-3.5 w-3.5" />
            <PlatformIcon platform="x" className="h-3.5 w-3.5" />
            <SoonPill />
          </span>
        </div>
      </div>

      {/* Alex, in the green room */}
      <div className="absolute right-5 top-full -mt-4 hidden w-64 rounded-2xl border border-white/10 bg-white/95 p-3 text-slate-900 shadow-2xl backdrop-blur xl:block">
        <div className="flex items-center gap-2.5">
          <img src="/alex.jpg" alt="" className="h-8 w-8 rounded-full object-cover ring-2 ring-[#F0A71F]" />
          <div className="min-w-0">
            <p className="text-xs font-semibold leading-tight">Alex <span className="font-normal text-slate-500">· AI producer</span></p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">In the green room</p>
          </div>
        </div>
        <p className="mt-2 text-[13px] leading-snug text-slate-700">Jordan, you're on Stage 2 after this session, about four minutes. Camera and mic look great.</p>
      </div>
    </div>
  );
}
