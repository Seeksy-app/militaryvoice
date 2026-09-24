import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { Square, FileText, Sparkles, Crop, Send, Check, Scissors } from "lucide-react";
import { PlatformIcon } from "@/components/SocialIcons";
import { LoopVideo, SoonPill, VCAST } from "./stockVideo";

// Postify, drawn: one segment going from the moment the recording
// stops to clips ready to post, in five steps that play on their own and can
// be clicked. It follows what the clipper actually does (agent/clipper.ts):
// the transcript was written live by the captioner, Claude picks moments that
// stand up cold, and each is rendered at 16:9, 9:16 and 1:1 with the words
// burned in. Filler removal (agent/refine.ts) is built but not switched on, so
// that line carries the Coming soon pill.

const GUEST = VCAST.ray;
const STEP_MS = 3400;

const STEPS = [
  { icon: Square, title: "The segment ends", body: "The recorder stops. Nothing to upload." },
  { icon: FileText, title: "The transcript is already written", body: "Captioned live while it went out." },
  { icon: Sparkles, title: "AI picks the moments", body: "Ones that stand up on their own, 20–75 seconds." },
  { icon: Crop, title: "Cut in three shapes", body: "16:9, 9:16 and 1:1, captions burned in." },
  { icon: Send, title: "Ready to post", body: "In their dashboard, before they're home." },
] as const;

const LINES: { t: string; w: string; filler?: boolean }[][] = [
  [{ t: "0:41", w: "So" }, { t: "", w: "um,", filler: true }, { t: "", w: "the second tour was different." }],
  [{ t: "0:44", w: "I went back for my brothers," }, { t: "", w: "you know,", filler: true }, { t: "", w: "not for the mission." }],
  [{ t: "0:49", w: "And that's the part" }, { t: "", w: "uh,", filler: true }, { t: "", w: "nobody asks about." }],
  [{ t: "0:53", w: "You come home and everyone wants the war stories." }],
  [{ t: "0:57", w: "I mean," , filler: true }, { t: "", w: "nobody wants to hear about the guys you called every night." }],
];

// A fixed waveform, so the picture is the same every time it plays.
const WAVE = Array.from({ length: 64 }, (_, i) => 0.25 + 0.75 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.43)));
const MOMENTS = [
  { at: 0.12, len: 0.14, label: "0:41 · “I went back for my brothers”" },
  { at: 0.46, len: 0.1, label: "11:02 · “Coming home to a stranger”" },
  { at: 0.74, len: 0.12, label: "19:30 · “What I tell new Marines”" },
];
const CAPTION = "I went back for my brothers, not for the mission.";
const BRAND = { youtube: "#FF0000", instagram: "#E1306C", tiktok: "#000000", linkedin: "#0A66C2" } as const;

function Frame({ ratio, className = "", band = false, caption = true }: { ratio: string; className?: string; band?: boolean; caption?: boolean }) {
  return (
    <div className={`relative overflow-hidden rounded-xl bg-black ring-1 ring-white/15 ${className}`} style={{ aspectRatio: ratio }}>
      {/* Letterboxed onto a blurred copy of itself, as the clipper renders it — never cropped. */}
      <img src={GUEST.poster} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-md" />
      <img src={GUEST.poster} alt="" className="absolute inset-x-0 top-1/2 w-full -translate-y-1/2 object-contain" />
      {band && (
        <div className="absolute inset-x-0 top-0 bg-[#000741] px-2 py-1.5 text-center">
          <p className="truncate text-[9px] font-bold uppercase tracking-wider text-[#F0A71F]">Two Tours</p>
          <p className="truncate text-[8px] text-white/80">Ray Castillo</p>
        </div>
      )}
      {caption && (
        <p className="absolute inset-x-1.5 bottom-[12%] text-center text-[9px] font-bold leading-tight text-white [text-shadow:0_1px_2px_#000,0_0_3px_#000] sm:text-[10px]">
          {CAPTION}
        </p>
      )}
    </div>
  );
}

function Stage({ step }: { step: number }) {
  const fade = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 }, transition: { duration: 0.45 } };
  return (
    <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl bg-[#050d26] ring-1 ring-white/10 sm:aspect-[16/10]">
      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.div key="s0" {...fade} className="absolute inset-0">
            <LoopVideo src={GUEST.src} poster={GUEST.poster} className="absolute inset-0 h-full w-full object-cover" />
            <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" />
            <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
              <motion.span className="h-2 w-2 rounded-full bg-[#ED1C24]" animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 1, repeat: 1 }} />
              <motion.span initial={{ opacity: 1 }} animate={{ opacity: 1 }}>REC 24:58</motion.span>
            </div>
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1.6, duration: 0.4 }}
              className="absolute inset-x-0 bottom-5 mx-auto w-fit rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#000741] shadow-xl"
            >
              <Square className="mr-1.5 inline h-3.5 w-3.5 fill-[#ED1C24] text-[#ED1C24]" /> Segment ended · 25:00
            </motion.div>
            <p className="absolute bottom-5 left-4 hidden text-xs text-white/80 sm:block">{GUEST.name} · {GUEST.title}</p>
          </motion.div>
        )}

        {step === 1 && (
          <motion.div key="s1" {...fade} className="absolute inset-0 grid grid-rows-[0.7fr_1.3fr] gap-3 p-3 sm:grid-cols-[0.9fr_1.1fr] sm:grid-rows-1 sm:gap-4 sm:p-4">
            <div className="relative overflow-hidden rounded-xl">
              <img src={GUEST.poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">Segment · 25:00</span>
            </div>
            <div className="flex min-w-0 flex-col rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/10 sm:p-4">
              <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">
                <FileText className="h-3.5 w-3.5 text-[#F0A71F]" /> Live transcript
              </p>
              <div className="mt-3 flex flex-col gap-2.5 text-[11px] leading-snug text-white/85 sm:text-[13px] lg:gap-3 lg:text-sm">
                {LINES.map((line, li) => (
                  <motion.p key={li} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + li * 0.25 }} className={li > 3 ? "hidden sm:block" : ""}>
                    <span className="mr-2 font-mono text-[10px] text-white/40">{line[0].t}</span>
                    {line.map((w, wi) =>
                      w.filler ? (
                        <motion.span
                          key={wi}
                          className="mx-0.5 rounded px-0.5"
                          initial={{ backgroundColor: "rgba(237,28,36,0)", textDecorationColor: "rgba(237,28,36,0)" }}
                          animate={{ backgroundColor: "rgba(237,28,36,0.22)", textDecorationColor: "rgba(237,28,36,1)" }}
                          transition={{ delay: 1.4 + li * 0.15, duration: 0.3 }}
                          style={{ textDecorationLine: "line-through", textDecorationThickness: 2 }}
                        >
                          {w.w}
                        </motion.span>
                      ) : (
                        <span key={wi}>{w.w} </span>
                      ),
                    )}
                  </motion.p>
                ))}
              </div>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2 }} className="mt-auto flex flex-wrap items-center gap-1.5 pt-3 text-[10px] text-white/55">
                <Scissors className="h-3 w-3 text-[#ED1C24]" /> Filler words marked for the cut <SoonPill />
              </motion.p>
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div key="s2" {...fade} className="absolute inset-0 flex flex-col justify-center gap-4 p-4 sm:p-6">
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">
              <Sparkles className="h-3.5 w-3.5 text-[#F0A71F]" /> Reading all 25 minutes
            </p>
            <div className="relative h-20 sm:h-28">
              <div className="absolute inset-0 flex items-center gap-[2px]">
                {WAVE.map((h, i) => (
                  <motion.span
                    key={i}
                    className="flex-1 rounded-full bg-white/25"
                    initial={{ scaleY: 0.1 }}
                    animate={{ scaleY: h }}
                    transition={{ delay: i * 0.008, duration: 0.3 }}
                    style={{ height: "100%", transformOrigin: "center" }}
                  />
                ))}
              </div>
              <motion.div className="absolute inset-y-0 w-0.5 bg-[#F0A71F]" initial={{ left: "0%" }} animate={{ left: "100%" }} transition={{ duration: 2.4, ease: "linear" }} />
              {MOMENTS.map((m, i) => (
                <motion.div
                  key={i}
                  className="absolute inset-y-0 rounded-md bg-[#F0A71F]/30 ring-2 ring-[#F0A71F]"
                  style={{ left: `${m.at * 100}%`, width: `${m.len * 100}%` }}
                  initial={{ opacity: 0, scaleY: 0.6 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  transition={{ delay: 0.4 + m.at * 2.4, duration: 0.3 }}
                />
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {MOMENTS.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 + m.at * 2.4 }}
                  className="flex items-center gap-2 rounded-lg bg-white/[0.06] px-3 py-2 text-[11px] text-white/85 ring-1 ring-white/10"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F0A71F] text-[10px] font-bold text-[#1a1200]">{i + 1}</span>
                  <span className="truncate">{m.label}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {step === 3 && (
          <motion.div key="s3" {...fade} className="absolute inset-0 flex flex-wrap content-center items-end justify-center gap-x-4 gap-y-3 p-4 sm:flex-nowrap sm:items-center sm:gap-5 sm:p-6">
            {[
              { ratio: "16 / 9", w: "w-[92%] sm:w-[44%]", label: "16:9 · YouTube" },
              { ratio: "9 / 16", w: "w-[34%] sm:w-[19%]", label: "9:16 · Shorts, Reels, TikTok", band: true },
              { ratio: "1 / 1", w: "w-[48%] sm:w-[27%]", label: "1:1 · Feed", band: true },
            ].map((f, i) => (
              <motion.div
                key={f.label}
                className={`${f.w} shrink-0`}
                initial={{ opacity: 0, scale: 0.85, y: 14 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.25, type: "spring", stiffness: 220, damping: 22 }}
              >
                <Frame ratio={f.ratio} band={f.band} />
                <p className="mt-2 text-center text-[10px] leading-tight text-white/60 sm:text-[11px]">{f.label}</p>
              </motion.div>
            ))}
          </motion.div>
        )}

        {step === 4 && (
          <motion.div key="s4" {...fade} className="absolute inset-0 flex flex-col justify-center gap-3 p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">
                <Check className="h-3.5 w-3.5 text-emerald-400" /> Your clips<span className="hidden sm:inline"> · Two Tours</span>
              </p>
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-400/30">
                <span className="sm:hidden">Ready in minutes</span><span className="hidden sm:inline">Ready minutes after the segment</span>
              </motion.span>
            </div>
            {MOMENTS.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.22 }}
                className="flex items-center gap-3 rounded-xl bg-white/[0.05] p-2 ring-1 ring-white/10 sm:p-2.5"
              >
                <div className="w-8 shrink-0 sm:w-9"><Frame ratio="9 / 16" caption={false} /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-white sm:text-[13px]">{m.label.split(" · ")[1]}</p>
                  <p className="text-[10px] text-white/50">16:9 · 9:16 · 1:1 · captions .srt</p>
                </div>
                <div className="hidden items-center gap-2 rounded-full bg-white px-2.5 py-1.5 sm:flex">
                  {(["youtube", "instagram", "tiktok", "linkedin"] as const).map((p) => (
                    <span key={p} style={{ color: BRAND[p] }}><PlatformIcon platform={p} className="h-4 w-4" /></span>
                  ))}
                </div>
                <span className="shrink-0 rounded-full bg-[#F0A71F] px-2.5 py-1 text-[10px] font-bold text-[#1a1200]">Post</span>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function RealTimePostMock() {
  const box = useRef<HTMLDivElement | null>(null);
  const inView = useInView(box, { amount: 0.4 });
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const [held, setHeld] = useState(false);
  const [tick, setTick] = useState(0); // restarts the bar when a step is picked

  useEffect(() => {
    if (!inView || held || reduce) return;
    const t = window.setTimeout(() => setStep((s) => (s + 1) % STEPS.length), STEP_MS);
    return () => clearTimeout(t);
  }, [step, inView, held, reduce, tick]);

  return (
    <div ref={box} className="grid gap-5 rounded-[1.75rem] bg-[#000741] p-4 text-white shadow-[0_50px_100px_-40px_rgba(3,11,31,0.8)] sm:p-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)] lg:gap-8 lg:p-8">
      <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0" aria-label="From recording to clips">
        {STEPS.map((s, i) => {
          const on = i === step;
          const done = i < step;
          const Icon = s.icon;
          return (
            <li key={s.title} className="shrink-0 lg:shrink">
              <button
                type="button"
                onClick={() => { setStep(i); setHeld(true); setTick((n) => n + 1); }}
                className={`relative flex w-full items-start gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-left transition-colors ${on ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"}`}
                aria-current={on ? "step" : undefined}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${on ? "bg-[#F0A71F] text-[#1a1200]" : done ? "bg-white/15 text-[#F0A71F]" : "bg-white/[0.07] text-white/60"}`}>
                  {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </span>
                <span className="min-w-0">
                  <span className={`block whitespace-nowrap text-sm font-semibold lg:whitespace-normal ${on ? "text-white" : "text-white/70"}`}>{s.title}</span>
                  <span className="hidden text-xs leading-snug text-white/55 lg:block">{s.body}</span>
                </span>
                {on && !held && !reduce && (
                  <motion.span
                    key={`${step}-${tick}`}
                    className="absolute bottom-0 left-0 h-0.5 bg-[#F0A71F]"
                    initial={{ width: "0%" }}
                    animate={{ width: inView ? "100%" : "0%" }}
                    transition={{ duration: STEP_MS / 1000, ease: "linear" }}
                  />
                )}
              </button>
            </li>
          );
        })}
        {held && (
          <li className="hidden lg:block">
            <button type="button" onClick={() => setHeld(false)} className="px-3 pt-2 text-xs font-medium text-[#F0A71F] hover:underline">
              Play it through
            </button>
          </li>
        )}
      </ol>
      <Stage step={step} />
    </div>
  );
}
