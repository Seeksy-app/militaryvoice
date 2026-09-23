import { useEffect, useState } from "react";
import { Mic, Video, ChevronDown, ArrowUp, Check, VideoOff } from "lucide-react";
import { CAST } from "./fakeCamera";
import { VCAST, LoopVideo } from "./stockVideo";

// Two sides of the green room. On the left, what a guest sees when their link
// opens — the same "Ready to join?" card as the real page, with their camera
// already on. On the right, what the producer sees: everyone waiting, checked,
// and Alex answering them while they wait. Nothing here asks for a camera.

/** A mic level that rises and falls, so the button reads as "it hears you". */
function useLevel() {
  const [v, setV] = useState(0.3);
  useEffect(() => {
    const t = setInterval(() => setV(0.15 + Math.random() * 0.6), 160);
    return () => clearInterval(t);
  }, []);
  return v;
}

export function ReadyToJoinMock() {
  const level = useLevel();
  return (
    <div className="rounded-[1.5rem] bg-white p-5 text-slate-900 shadow-2xl sm:p-6" aria-hidden="true">
      <h3 className="text-center text-xl font-bold tracking-tight text-[#000741]">Ready to join?</h3>
      <div className="relative mt-4 aspect-video overflow-hidden rounded-2xl bg-[#0b1433]">
        <LoopVideo src={VCAST.lena.src} poster={VCAST.lena.poster} className="absolute inset-0 h-full w-full scale-x-[-1] object-cover" />
        <span className="absolute bottom-2.5 left-2.5 max-w-[80%] truncate rounded-md bg-black/45 px-2 py-0.5 text-xs font-semibold text-white">
          Lena Park <span className="font-normal text-white/75">· Home Base</span>
        </span>
      </div>
      <div className="mt-4 flex items-center justify-center gap-3">
        <div className="flex items-center rounded-full bg-slate-100">
          <span className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-white text-slate-900 shadow">
            <span className="absolute inset-x-0 bottom-0 bg-emerald-400/35 transition-[height] duration-150" style={{ height: `${Math.round(level * 100)}%` }} />
            <Mic className="relative h-5 w-5" />
          </span>
          <ChevronDown className="mx-2 h-4 w-4 text-slate-500" />
        </div>
        <div className="flex items-center rounded-full bg-slate-100">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-900 shadow"><Video className="h-5 w-5" /></span>
          <ChevronDown className="mx-2 h-4 w-4 text-slate-500" />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-[1.3fr_1fr] gap-2.5">
        <div>
          <p className="text-xs font-semibold text-slate-600">Your name</p>
          <div className="mt-1 flex h-10 items-center rounded-xl border border-slate-300 px-3 text-sm">Lena Park</div>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-600">Title <span className="font-normal text-slate-400">(optional)</span></p>
          <div className="mt-1 flex h-10 items-center truncate rounded-xl border border-slate-300 px-3 text-sm">Home Base</div>
        </div>
      </div>
      <div className="mt-4 flex h-12 items-center justify-center rounded-2xl bg-[#053877] text-base font-bold text-white">Join the green room</div>
    </div>
  );
}

const WAITING = [
  { key: "daniel", name: VCAST.daniel.name, show: "Deckplate Radio", status: "Next up · 4 min", ok: true, cam: VCAST.daniel.poster, face: VCAST.daniel.face },
  { key: "lena", name: VCAST.lena.name, show: "Home Base", status: "Mic and camera OK", ok: true, cam: VCAST.lena.poster, face: VCAST.lena.face },
  { key: "andre", name: CAST.andre.name, show: "After the Uniform", status: "Camera off", ok: false, cam: "", face: CAST.andre.face },
];

export function WaitingRoomMock() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <div className="rounded-2xl border border-white/10 bg-[#0b1638] p-3.5 text-white shadow-2xl">
        <div className="flex items-center justify-between px-0.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/70">Green room <span className="ml-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-300">3 waiting</span></p>
          <p className="text-[11px] text-white/45">Not on air</p>
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {WAITING.map((w) => {
            return (
              <li key={w.key} className="flex items-center gap-3 rounded-xl bg-white/[0.04] p-2 ring-1 ring-white/5">
                <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-[#053877] sm:w-28">
                  {w.cam ? (
                    <img src={w.cam} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center">
                      <img src={w.face} alt="" className="h-9 w-9 rounded-full object-cover opacity-80 ring-2 ring-white/20" />
                      <VideoOff className="absolute bottom-1 right-1 h-3 w-3 text-white/70" />
                    </span>
                  )}
                  {w.cam && <span className="absolute bottom-1 left-1 flex h-2.5 items-end gap-[2px]">{[0.5, 0.9, 0.6, 0.3].map((h, i) => <span key={i} className="w-[2px] rounded-full bg-[#F0A71F]" style={{ height: `${h * 100}%` }} />)}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{w.name}</p>
                  <p className="truncate text-[11px] text-white/55">{w.show}</p>
                  <p className={`mt-0.5 flex items-center gap-1 truncate text-[11px] ${w.ok ? "text-emerald-300" : "text-[#F0A71F]"}`}>
                    {w.ok && <Check className="h-3 w-3 shrink-0" />} {w.status}
                  </p>
                </div>
                {w.key === "daniel" ? (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#3B82F6] text-white shadow-[0_0_0_4px_rgba(59,130,246,0.25)]" title="Bring on stage">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </span>
                ) : (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70" title="Bring on stage">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Alex, answering while they wait. */}
      <div className="rounded-2xl bg-white p-4 text-slate-900 shadow-2xl">
        <div className="flex items-center gap-2.5">
          <img src="/alex.jpg" alt="" className="h-8 w-8 rounded-full object-cover ring-2 ring-[#F0A71F]" />
          <p className="text-sm font-semibold">Alex <span className="font-normal text-slate-500">· AI producer</span></p>
          <span className="ml-auto flex items-center gap-1 text-[11px] text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> answering</span>
        </div>
        <div className="mt-3 flex flex-col gap-2 text-[13px] leading-snug">
          <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-[#053877] px-3 py-2 text-white">Is my audio OK? And when am I on?</p>
          <p className="max-w-[90%] rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2">Clear and level, Lena. You're on at 10:00, right after Deckplate Radio. Sofia will introduce you, then it's your 25 minutes.</p>
        </div>
      </div>
    </div>
  );
}
