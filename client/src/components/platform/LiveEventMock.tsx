import { useEffect, useState } from "react";
import { Eye, Radio, Users } from "lucide-react";
import { StageGrid, type RoomMeta } from "@/components/StageView";
import { PlatformIcon } from "@/components/SocialIcons";
import { CAST, castTile, useFakeCamera, useTicker } from "./fakeCamera";

// The hero's picture: the programme as the audience sees it, drawn by the real
// stage component, inside the frame of a broadcast — LIVE, who's watching,
// where it's going out, and the scenes queued under it.

const META: RoomMeta = {
  stageLayout: "showtime",
  backgroundUrl: "/agenda-bg.jpg",
  logoUrl: "/logo-wave.png?v=2",
  logoCorner: "top-right",
  logoSize: 120,
};

const SCENES = [
  { title: "Pre-show", time: "6:45", thumb: "/scenes/pre-show.jpg" },
  { title: "The Long Watch", time: "9:00", thumb: CAST.marcus.cam, live: true },
  { title: "Sponsor reel", time: "9:25", thumb: "/scenes/sponsor-reel.jpg" },
  { title: "Homefront Hour", time: "9:30", thumb: CAST.dana.cam },
  { title: "Break", time: "9:55", thumb: "/scenes/desk-break.jpg" },
];

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

export function LiveEventMock() {
  const marcus = useFakeCamera(CAST.marcus.cam);
  const riccoh = useFakeCamera(CAST.riccoh.cam);
  const talking = useTicker(2, 4200);
  const viewers = useViewers(12480);
  const clock = useClock(7 * 3600 + 12 * 60 + 41);

  const tiles = [castTile("marcus", marcus, talking === 0), castTile("riccoh", riccoh, talking === 1, true)];

  return (
    <div className="relative" aria-label="An illustration of a live MilitaryVoices broadcast" role="img">
      {/* The glow the frame sits in. */}
      <div aria-hidden className="pointer-events-none absolute -inset-10 -z-10 rounded-[3rem] bg-[radial-gradient(60%_55%_at_55%_45%,rgba(240,167,31,0.22),transparent_70%)]" />

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#000741] shadow-[0_50px_100px_-30px_rgba(0,0,0,0.85)] ring-1 ring-black/40">
        {/* Broadcast chrome */}
        <div className="flex items-center gap-3 border-b border-white/10 bg-[#04102b] px-3 py-2 sm:px-4">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
            </span>
            Live
          </span>
          <span className="hidden font-mono text-xs tabular-nums text-white/55 sm:inline">{clock}</span>
          <span className="min-w-0 truncate text-xs font-medium text-white/80 sm:text-sm">National Military Podcast Day</span>
          <span className="ml-auto flex shrink-0 items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums text-white">
              <Eye className="h-3.5 w-3.5 text-[#F0A71F]" /> {viewers.toLocaleString("en-US")}
            </span>
            <span className="hidden items-center gap-1.5 text-white/70 sm:flex">
              {(["youtube", "linkedin", "facebook", "x"] as const).map((p) => (
                <PlatformIcon key={p} platform={p} className="h-3.5 w-3.5" />
              ))}
            </span>
          </span>
        </div>

        {/* The programme */}
        <div className="relative aspect-video overflow-hidden bg-[#04102b]" style={{ containerType: "inline-size" }}>
          <StageGrid tiles={tiles} meta={META} muted />
          {/* The show bug: what's on, and what's next. */}
          <div className="pointer-events-none absolute left-[3%] top-[5%] z-30 flex items-stretch overflow-hidden rounded-md text-[clamp(8px,1.5cqw,12px)] font-semibold shadow-lg" style={{ containerType: "normal" }}>
            <span className="bg-[#F0A71F] px-2 py-1 uppercase tracking-[0.14em] text-[#1a1200]">Now</span>
            <span className="bg-[#000741]/90 px-2 py-1 text-white backdrop-blur-sm">The Long Watch</span>
            <span className="hidden bg-[#000741]/70 px-2 py-1 text-white/70 backdrop-blur-sm sm:inline">Next · Homefront Hour, 9:30</span>
          </div>
        </div>

        {/* The scenes queued under it */}
        <div className="flex items-center gap-2 border-t border-white/10 bg-[#04102b] px-3 py-2.5 sm:gap-2.5 sm:px-4">
          <span className="hidden shrink-0 flex-col pr-1 text-[10px] font-bold uppercase leading-tight tracking-[0.16em] text-white/45 md:flex">
            <span>Scenes</span>
            <span className="text-[#F0A71F]">Run by Alex</span>
          </span>
          <div className="grid min-w-0 flex-1 grid-cols-3 gap-2 sm:grid-cols-5">
            {SCENES.map((s, i) => (
              <div
                key={s.title}
                className={`relative overflow-hidden rounded-md ${i > 2 ? "hidden sm:block" : ""} ${s.live ? "ring-2 ring-[#ED1C24]" : "ring-1 ring-white/10"}`}
              >
                <img src={s.thumb} alt="" loading="lazy" className="aspect-video w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                {s.live && <span className="absolute left-1 top-1 rounded bg-[#ED1C24] px-1 text-[8px] font-bold uppercase tracking-wider text-white">On air</span>}
                <div className="absolute inset-x-1.5 bottom-1 min-w-0">
                  <p className="truncate text-[10px] font-semibold leading-tight text-white">{s.title}</p>
                  <p className="text-[9px] leading-tight text-[#F0A71F]">{s.time} AM</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Alex, in the green room */}
      <div className="absolute -bottom-9 -left-16 hidden w-60 rounded-2xl border border-white/10 bg-white/95 p-3 text-slate-900 shadow-2xl backdrop-blur xl:block">
        <div className="flex items-center gap-2.5">
          <img src="/alex.jpg" alt="" className="h-8 w-8 rounded-full object-cover ring-2 ring-[#F0A71F]" />
          <div className="min-w-0">
            <p className="text-xs font-semibold leading-tight">Alex <span className="font-normal text-slate-500">· AI producer</span></p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">In the green room</p>
          </div>
        </div>
        <p className="mt-2 text-[13px] leading-snug text-slate-700">Dana, you're on after Marcus — about four minutes. Camera and mic look great.</p>
      </div>

      {/* Who's waiting */}
      <div className="absolute -bottom-7 right-6 hidden items-center gap-3 rounded-2xl border border-white/10 bg-[#0b1638]/95 px-3.5 py-2.5 text-white shadow-2xl backdrop-blur lg:flex">
        <Users className="h-4 w-4 text-[#F0A71F]" />
        <span className="text-xs font-semibold">Green room</span>
        <span className="flex -space-x-2">
          {[CAST.dana.face, CAST.kim.face, CAST.andre.face].map((f) => (
            <img key={f} src={f} alt="" className="h-7 w-7 rounded-full object-cover ring-2 ring-emerald-400" />
          ))}
        </span>
        <span className="text-xs text-white/60">3 ready</span>
        <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/80"><Radio className="h-3 w-3 text-[#ED1C24]" /> 4 destinations</span>
      </div>
    </div>
  );
}
