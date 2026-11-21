// The studio's teleprompter (Andrew, 21 Nov: "review Streamyard and mirror the features").
//
// The script is the studio's Notes. When it's switched on, the script scrolls over YOUR OWN stage
// preview only. It's plain page content on this screen, never a track or room data, and the recorded
// and streamed picture is drawn by a different page (/room/composite), so it can't reach the
// program, the recording or anyone else's view.
import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Pause, Play, Plus, RotateCcw, X } from "lucide-react";

type Prefs = { on: boolean; size: number; speed: number };
const PREFS: Prefs = { on: false, size: 32, speed: 4 };
const SIZES = [20, 24, 28, 32, 40, 48, 56];

const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v === null ? d : (JSON.parse(v) as T); } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } window.dispatchEvent(new CustomEvent("mv-studio-store", { detail: k })); };

/** One value kept per studio on this computer, shared by every part of the page that uses the same key. */
function useStored<T>(k: string, d: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => read(k, d));
  useEffect(() => {
    setV(read(k, d));
    const on = (e: Event) => { if ((e as CustomEvent).detail === k) setV(read(k, d)); };
    window.addEventListener("mv-studio-store", on);
    return () => window.removeEventListener("mv-studio-store", on);
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = useCallback((x: T) => { setV(x); write(k, x); }, [k]);
  return [v, set];
}

export type NotesSync = "" | "saving" | "saved" | "error";
const NOTES_URL = "/api/host/my-studio/notes";

/**
 * The studio's notes, which are also the teleprompter's script. The old key held a plain string.
 * With `server` (the owner), they're saved to the studio too (PM, 21 Nov): written ahead on one
 * computer, read live on another. This computer's copy shows at once; the studio's copy wins when it
 * loads, and again whenever the window comes back into focus with nothing waiting to save.
 */
export function useStudioNotes(roomKey: string, server = false): [string, (t: string) => void, NotesSync] {
  const k = `mv-room-notes-${roomKey}`;
  const local = () => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } };
  const [v, setV] = useState(local);
  const [sync, setSync] = useState<NotesSync>("");
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keep = useCallback((t: string) => {
    setV(t);
    try { localStorage.setItem(k, t); } catch { /* private window */ }
    window.dispatchEvent(new CustomEvent("mv-studio-store", { detail: k }));
  }, [k]);

  const save = useCallback(async (t: string, keepalive = false) => {
    setSync("saving");
    try {
      const r = await fetch(NOTES_URL, { method: "PUT", credentials: "include", keepalive, headers: { "content-type": "application/json" }, body: JSON.stringify({ text: t }) });
      if (!r.ok) throw new Error(String(r.status));
      if (pending.current === t) pending.current = null;
      setSync(pending.current === null ? "saved" : "saving");
    } catch { setSync("error"); }
  }, []);

  useEffect(() => {
    setV(local());
    const on = (e: Event) => { if ((e as CustomEvent).detail === k) setV(local()); };
    window.addEventListener("mv-studio-store", on);
    return () => window.removeEventListener("mv-studio-store", on);
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps

  // The studio's copy: on open, and when the window comes back into focus.
  useEffect(() => {
    if (!server) return;
    let gone = false;
    const pull = async () => {
      if (pending.current !== null) return;
      try {
        const r = await fetch(NOTES_URL, { credentials: "include", cache: "no-store" });
        if (!r.ok || gone || pending.current !== null) return;
        const s = (await r.json()) as { text?: string; at?: string };
        const mine = local();
        if (!s.at) { if (mine.trim()) { pending.current = mine; void save(mine); } return; } // first time: this computer's notes go up
        if ((s.text ?? "") !== mine) keep(s.text ?? "");
        setSync("saved");
      } catch { /* offline: this computer's copy stands */ }
    };
    void pull();
    const focus = () => { if (document.visibilityState === "visible") void pull(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => { gone = true; window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [server, k]); // eslint-disable-line react-hooks/exhaustive-deps

  // Anything still waiting goes up when the page closes.
  useEffect(() => {
    if (!server) return;
    const flush = () => { if (pending.current !== null) { if (timer.current) clearTimeout(timer.current); void save(pending.current, true); } };
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, [server, save]);

  const set = useCallback((t: string) => {
    keep(t);
    if (!server) return;
    pending.current = t;
    setSync("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (pending.current !== null) void save(pending.current); }, 800);
  }, [k, server, keep, save]);
  return [v, set, sync];
}

export const usePrompter = (roomKey: string) => useStored<Prefs>(`mv-prompter-${roomKey}`, PREFS);

/** Speed 1–10 as words a minute: 1 is slow and careful, 10 is fast. */
const wpm = (speed: number) => 70 + speed * 20;
const words = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
export function readTime(text: string, speed: number): string {
  const min = words(text) / wpm(speed);
  if (min < 1) return "< 1 min read";
  return `About ${Math.round(min)} min read`;
}

/** The switch, tip and speed in Notes. */
export function PrompterSwitch({ roomKey, text }: { roomKey: string; text: string }) {
  const [p, setP] = usePrompter(roomKey);
  const [tip, setTip] = useState(false);
  return (
    <div className="mx-4 mt-3 rounded-xl border border-[#e4e7ec] bg-[#fcfcfd] p-3" data-testid="prompter-switch-box">
      <div className="flex items-center gap-2">
        <button type="button" role="switch" aria-checked={p.on} onClick={() => setP({ ...p, on: !p.on })} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${p.on ? "bg-[#053877]" : "bg-[#d0d5dd]"}`} data-testid="prompter-switch">
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${p.on ? "left-[22px]" : "left-0.5"}`} />
        </button>
        <span className="text-sm font-semibold">Teleprompter</span>
        <div className="relative">
          <button type="button" onClick={() => setTip(!tip)} onBlur={() => setTip(false)} aria-label="What's the teleprompter?" className="flex h-5 w-5 items-center justify-center rounded-full border border-[#98a2b3] text-[11px] font-bold text-[#475467]">?</button>
          {tip && <div className="absolute left-1/2 top-7 z-30 w-60 -translate-x-1/2 rounded-lg bg-[#101828] p-2.5 text-[12px] leading-snug text-white shadow-lg">Your notes scroll over your own stage, so you can read them while looking at the camera. Only you see them. They're never in the recording or the live show.</div>}
        </div>
        {p.on && <span className="ml-auto whitespace-nowrap text-[12px] text-[#667085]">{readTime(text, p.speed)}</span>}
      </div>
      {p.on && !text.trim() && <p className="mt-2 text-[12px] text-[#667085]">Type your script below. It shows on your stage as you go.</p>}
    </div>
  );
}

/** The script over the host's own stage, with its controls. */
export function PrompterOverlay({ roomKey, text }: { roomKey: string; text: string }) {
  const [p, setP] = usePrompter(roomKey);
  const [playing, setPlaying] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const pos = useRef(0);

  // Smooth scroll: pixels a second from words a minute and the text size, so the speed reads the same at any size.
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const tick = (t: number) => {
      const el = box.current;
      if (!el) return;
      const dt = Math.min(1, (t - last) / 1000); last = t; // a slow or hidden tab still keeps time
      const n = Math.max(1, words(text));
      const pxPerWord = Math.max(1, el.scrollHeight - el.clientHeight) / n;
      pos.current = Math.min(el.scrollHeight, pos.current + (wpm(p.speed) / 60) * pxPerWord * dt);
      el.scrollTop = pos.current;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) { setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, p.speed, text]);

  // A scroll by hand moves the reading point (and isn't fought by the auto-scroll).
  const onScroll = () => { if (!playing && box.current) pos.current = box.current.scrollTop; };
  const restart = () => { pos.current = 0; if (box.current) box.current.scrollTop = 0; };
  const size = (d: number) => { const i = SIZES.indexOf(p.size); const next = SIZES[Math.max(0, Math.min(SIZES.length - 1, (i < 0 ? 3 : i) + d))]; setP({ ...p, size: next }); };

  if (!p.on) return null;
  const btn = "flex h-8 w-8 items-center justify-center rounded-lg text-white hover:bg-white/15 disabled:opacity-40";
  return (
    <div className="pointer-events-auto absolute inset-x-0 top-0 z-20 flex h-[58%] flex-col overflow-hidden rounded-t-2xl bg-[rgba(4,12,32,0.82)] text-white backdrop-blur-[2px]" data-testid="prompter">
      <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-2.5 py-1.5">
        <span className="mr-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold" data-testid="prompter-only-you">Only visible to you</span>
        <button type="button" onClick={() => size(-1)} disabled={p.size === SIZES[0]} className={btn} aria-label="Smaller text"><span className="text-[12px] font-bold">A</span><Minus className="h-3 w-3" /></button>
        <button type="button" onClick={() => size(1)} disabled={p.size === SIZES[SIZES.length - 1]} className={btn} aria-label="Bigger text"><span className="text-[15px] font-bold">A</span><Plus className="h-3 w-3" /></button>
        <div className="mx-1 h-5 w-px bg-white/15" />
        <button type="button" onClick={() => setPlaying(!playing)} disabled={!text.trim()} className={btn} aria-label={playing ? "Pause" : "Play"} data-testid="prompter-play">{playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}</button>
        <button type="button" onClick={restart} className={btn} aria-label="Back to the start" data-testid="prompter-restart"><RotateCcw className="h-4 w-4" /></button>
        <label className="ml-1 flex min-w-0 items-center gap-2 text-[12px] text-white/80">
          <span className="hidden sm:inline">Speed</span>
          <input type="range" min={1} max={10} step={1} value={p.speed} onChange={(e) => setP({ ...p, speed: Number(e.target.value) })} className="w-20 accent-[#F0A71F] sm:w-24" aria-label="Scroll speed" data-testid="prompter-speed" />
          <span className="w-4 tabular-nums">{p.speed}</span>
        </label>
        <span className="ml-auto hidden whitespace-nowrap text-[12px] text-white/70 md:inline">{readTime(text, p.speed)}</span>
        <button type="button" onClick={() => { setPlaying(false); setP({ ...p, on: false }); }} className={btn} aria-label="Turn the teleprompter off"><X className="h-4 w-4" /></button>
      </div>
      <div ref={box} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto px-[6%] pb-[40%] pt-4" style={{ scrollbarWidth: "none" }}>
        {text.trim()
          ? <p className="whitespace-pre-wrap text-center font-semibold leading-[1.35]" style={{ fontSize: p.size }} data-testid="prompter-text">{text}</p>
          : <p className="pt-6 text-center text-[15px] text-white/70">Your script goes in Notes. Type it there and it shows here.</p>}
      </div>
    </div>
  );
}

/** "New: Teleprompter", once per computer. */
export function PrompterNews({ onOpen }: { onOpen: () => void }) {
  const [seen, setSeen] = useStored<boolean>("mv-news-teleprompter", false);
  if (seen) return null;
  return (
    <div className="mt-3 hidden w-full max-w-[768px] shrink-0 items-center gap-3 rounded-xl border border-[#c7d7fe] bg-[#eef4ff] px-4 py-2.5 lg:flex" data-testid="prompter-news">
      <span className="rounded-full bg-[#053877] px-2 py-0.5 text-[11px] font-bold text-white">New</span>
      <p className="min-w-0 flex-1 text-[13px] text-[#1d2939]"><span className="font-bold">Teleprompter.</span> Your notes scroll over your own stage while you talk. Only you see them.</p>
      <button type="button" onClick={() => { setSeen(true); onOpen(); }} className="shrink-0 text-[13px] font-bold text-[#053877] hover:underline">Try it</button>
      <button type="button" onClick={() => setSeen(true)} className="h-8 shrink-0 rounded-lg bg-white px-3 text-[13px] font-semibold text-[#344054] ring-1 ring-[#d0d5dd] hover:bg-[#f9fafb]" data-testid="prompter-news-ok">Got it</button>
    </div>
  );
}
