import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";

// The "click here" pointer (7 Oct 2026, from a Mercury tour screenshot):
// a pulsing ring on the exact control, a navy callout beside it saying what
// it does, and nothing in the way of clicking it. Next steps land on it, and a
// first visit to the dashboard gets a short tour of the four things on it.
//
// One layer for the whole dashboard; anything can call showGuide().

export interface GuideStep {
  /** Where to point, best first: the first selector found on the page wins, with its own words. */
  at: { sel: string; text: string }[];
  title?: string;
}

interface Run { steps: GuideStep[]; i: number; onDone?: () => void }

const EVT = "mv-guide";
/** Point at things, one after another. A step whose control never shows up is skipped. */
export function showGuide(steps: GuideStep[], onDone?: () => void) {
  window.dispatchEvent(new CustomEvent<Run>(EVT, { detail: { steps, i: 0, onDone } }));
}
export function hideGuide() {
  window.dispatchEvent(new CustomEvent<Run | null>(EVT, { detail: null }));
}

const W = 300; // callout width
const GAP = 18; // ring to callout

type Place = "right" | "left" | "bottom" | "top";
interface Spot { r: DOMRect; text: string; place: Place }

function findTarget(step: GuideStep): { el: HTMLElement; text: string } | null {
  for (const a of step.at) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(a.sel))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return { el, text: a.text };
    }
  }
  return null;
}

/** A dialog on screen (Alex's questions, say) owns the moment: the pointer waits behind it. */
const dialogOpen = () => !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-guide-wait]');

function placeFor(r: DOMRect): Place {
  const vw = window.innerWidth, vh = window.innerHeight;
  if (vw < 640) return r.bottom + 180 < vh ? "bottom" : "top";
  if (r.right + GAP + W + 16 < vw) return "right";
  if (r.left - GAP - W - 16 > 0) return "left";
  return r.bottom + 180 < vh ? "bottom" : "top";
}

export function GuideLayer() {
  const [run, setRun] = useState<Run | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  const target = useRef<HTMLElement | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [boxH, setBoxH] = useState(120);

  useEffect(() => {
    const on = (e: Event) => setRun((e as CustomEvent<Run | null>).detail);
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);

  const finish = () => { const done = run?.onDone; setRun(null); setSpot(null); target.current = null; done?.(); };
  const next = () => {
    if (!run) return;
    if (run.i + 1 >= run.steps.length) return finish();
    setSpot(null); target.current = null;
    setRun({ ...run, i: run.i + 1 });
  };

  // Find the control (the screen may still be rendering), bring it into view,
  // then follow it as the page scrolls or reflows.
  useEffect(() => {
    if (!run) return;
    const step = run.steps[run.i];
    let raf = 0, scrolled = false;
    const started = Date.now();
    const tick = () => {
      if (!target.current || !target.current.isConnected) {
        target.current = null;
        const hit = findTarget(step);
        if (!hit) {
          // Never appeared: move on rather than point at nothing.
          if (Date.now() - started > 6000) { next(); return; }
          raf = requestAnimationFrame(tick);
          return;
        }
        target.current = hit.el;
        (target.current as HTMLElement & { _guideText?: string })._guideText = hit.text;
      }
      const el = target.current as HTMLElement & { _guideText?: string };
      if (dialogOpen()) { setSpot(null); raf = requestAnimationFrame(tick); return; }
      if (!scrolled) {
        scrolled = true;
        const r0 = el.getBoundingClientRect();
        if (r0.top < 80 || r0.bottom > window.innerHeight - 40) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      const r = el.getBoundingClientRect();
      setSpot((s) => (s && s.r.x === r.x && s.r.y === r.y && s.r.width === r.width && s.r.height === r.height ? s : { r, text: el._guideText ?? "", place: placeFor(r) }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  // Clicking the control itself is doing the step: the pointer moves on.
  useEffect(() => {
    if (!run) return;
    const on = (e: PointerEvent) => {
      const t = target.current;
      if (t && e.target instanceof Node && t.contains(e.target)) next();
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") finish(); };
    document.addEventListener("pointerdown", on, true);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", on, true); document.removeEventListener("keydown", key); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  useLayoutEffect(() => { if (box.current) setBoxH(box.current.offsetHeight); }, [spot?.text, run?.i]);

  if (!run || !spot) return null;
  const { r, place } = spot;
  const vw = window.innerWidth;
  const small = r.width < 140;
  // The ring sits on the control, toward the callout (on a wide row, near its end).
  const inset = Math.min(30, r.width / 2);
  const ring = {
    x: small || place === "bottom" || place === "top" ? r.left + r.width / 2 : place === "right" ? r.right - inset : r.left + inset,
    y: small || place === "right" || place === "left" ? r.top + r.height / 2 : place === "bottom" ? r.bottom - Math.min(18, r.height / 2) : r.top + Math.min(18, r.height / 2),
  };
  const width = Math.min(W, vw - 32);
  let left: number, top: number;
  if (place === "right") { left = ring.x + GAP + 14; top = ring.y - boxH / 2; }
  else if (place === "left") { left = ring.x - GAP - 14 - width; top = ring.y - boxH / 2; }
  else if (place === "bottom") { left = ring.x - width / 2; top = ring.y + GAP + 14; }
  else { left = ring.x - width / 2; top = ring.y - GAP - 14 - boxH; }
  left = Math.max(16, Math.min(left, vw - width - 16));
  top = Math.max(16, Math.min(top, window.innerHeight - boxH - 16));
  // The arrow on the callout's edge, lined up with the ring.
  const arrow = place === "right" || place === "left"
    ? { top: Math.max(14, Math.min(boxH - 14, ring.y - top)) - 7, [place === "right" ? "left" : "right"]: -7 }
    : { left: Math.max(14, Math.min(width - 14, ring.x - left)) - 7, [place === "bottom" ? "top" : "bottom"]: -7 };
  const many = run.steps.length > 1;
  const step = run.steps[run.i];

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" aria-live="polite" data-testid="guide">
      {/* A soft outline round the control, so it's clear what the ring is on. */}
      <div className="absolute rounded-xl ring-2 ring-[#053877]/35 transition-all duration-200" style={{ left: r.left - 4, top: r.top - 4, width: r.width + 8, height: r.height + 8 }} />
      <span className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: ring.x, top: ring.y }}>
        <span className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#053877]/15 motion-safe:animate-ping" />
        <span className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#053877]/10 ring-1 ring-[#053877]/20" />
        <span className="relative block h-7 w-7 rounded-full border-[5px] border-[#053877] bg-white/70 shadow-[0_0_0_4px_rgba(255,255,255,0.6)]" />
      </span>
      <div
        ref={box}
        role="dialog"
        aria-label={step.title ?? "Here's how"}
        className="pointer-events-auto absolute rounded-2xl bg-[#053877] p-4 text-white shadow-2xl shadow-[#053877]/30"
        style={{ left, top, width }}
        data-testid="guide-callout"
      >
        <span className="absolute h-3.5 w-3.5 rotate-45 bg-[#053877]" style={arrow} />
        <button type="button" onClick={finish} className="absolute right-2 top-2 rounded-full p-1 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close" data-testid="guide-close"><X className="h-4 w-4" /></button>
        {step.title && <p className="pr-6 text-xs font-bold uppercase tracking-[0.14em] text-[#F0A71F]">{step.title}</p>}
        <p className={`pr-6 text-[15px] font-semibold leading-snug ${step.title ? "mt-1" : ""}`}>{spot.text}</p>
        <div className="mt-3 flex items-center gap-2">
          {many && <span className="text-xs text-white/60">{run.i + 1} of {run.steps.length}</span>}
          <span className="flex-1" />
          {many && run.i + 1 < run.steps.length && <button type="button" onClick={finish} className="rounded-full px-3 py-1.5 text-sm text-white/70 hover:text-white" data-testid="guide-skip">Skip</button>}
          <button type="button" onClick={next} className="rounded-full bg-[#F0A71F] px-4 py-1.5 text-sm font-semibold text-[#1a1200] hover:bg-[#f5b944]" data-testid="guide-next">
            {many && run.i + 1 < run.steps.length ? "Next" : "Got it"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The first visit to the dashboard home: what the four things on it are. Once per browser. */
export const HOME_TOUR: GuideStep[] = [
  { title: "Start here", at: [{ sel: '[data-testid="todo-strip"]', text: "Your next steps. We keep this list up to date for you: work down it and each one shows you where to click." }] },
  { title: "Your SmartLink", at: [{ sel: '[data-testid="dashboard-smartlink"]', text: "One link for every bio: your show, your videos and a way to collect emails. Free." }] },
  { title: "Your podcast", at: [
    { sel: '[data-testid="dashboard-podcast"]', text: "Host your podcast free, or bring it over. Alex, your podcast producer, walks you through it." },
  ] },
  { title: "Create", at: [{ sel: '[data-testid="door-create"]', text: "Make a post, turn a video into clips, or add an episode. It all starts here." }] },
];

const HOME_KEY = "mv_tour_home";
/** Runs the home tour on someone's first visit; renders nothing. */
export function HomeTour({ ready }: { ready: boolean }) {
  useEffect(() => {
    if (!ready) return;
    let seen = false;
    try { seen = localStorage.getItem(HOME_KEY) === "1"; } catch { /* private window: show it */ }
    if (seen) return;
    const t = window.setTimeout(() => {
      try { localStorage.setItem(HOME_KEY, "1"); } catch { /* fine */ }
      showGuide(HOME_TOUR);
    }, 900);
    return () => window.clearTimeout(t);
  }, [ready]);
  return null;
}
