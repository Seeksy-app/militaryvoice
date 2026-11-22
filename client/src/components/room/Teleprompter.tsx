// The studio's teleprompter (Andrew, 21 Nov: "review Streamyard and mirror the features").
//
// The script is the studio's Notes. When it's switched on, the script scrolls in a window on YOUR screen
// only (over your stage to start; move it, resize it or fill the screen). It's plain page content on this screen, never a track or room data, and the recorded
// and streamed picture is drawn by a different page (/room/composite), so it can't reach the
// program, the recording or anyone else's view.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, FileText, GripVertical, Loader2, Maximize2, Minimize2, Minus, Pause, PictureInPicture2, Play, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** rect: where the window sits, as shares of the browser window (none = over the stage); full: fills the screen. */
type Prefs = { on: boolean; size: number; speed: number; rect?: { x: number; y: number; w: number; h: number } | null; full?: boolean };
const PREFS: Prefs = { on: false, size: 32, speed: 4 };
const SIZES = [20, 24, 28, 32, 40, 48, 56, 64, 72, 88];

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

/**
 * Saved scripts (Andrew, 22 Nov: "make sure we can save promts"). Notes is the live script; save it under a name,
 * and pick a saved one to put it back in Notes. Kept on the studio, so they're there on any computer. Owner only.
 */
export type StudioScript = { id: string; name: string; text: string; at: string };
const SCRIPTS_URL = "/api/host/my-studio/scripts";
const newId = () => Math.random().toString(36).slice(2, 10);
const firstLine = (t: string) => (t.trim().split("\n")[0] ?? "").replace(/\s+/g, " ").trim().slice(0, 40).replace(/[.,;:]$/, "");

export function ScriptsBar({ roomKey, text, setText }: { roomKey: string; text: string; setText: (t: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery<{ scripts: StudioScript[] }>({
    queryKey: [SCRIPTS_URL],
    queryFn: async () => { const r = await fetch(SCRIPTS_URL, { credentials: "include", cache: "no-store" }); if (!r.ok) throw new Error(String(r.status)); return r.json(); },
  });
  const list = q.data?.scripts ?? [];
  const [currentId, setCurrentId] = useStored<string>(`mv-prompter-script-${roomKey}`, "");
  const current = list.find((x) => x.id === currentId);
  const [naming, setNaming] = useState<string | null>(null); // the name being typed, when saving a new one
  const [asking, setAsking] = useState<StudioScript | null>(null); // "Replace your notes?" for this script
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sure, setSure] = useState<string>(""); // the script a Delete is waiting to be confirmed for
  const [then, setThen] = useState<StudioScript | null>(null); // put this in Notes once the new one is saved

  const put = async (next: StudioScript[]) => {
    setBusy(true); setErr("");
    try {
      const r = await fetch(SCRIPTS_URL, { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ scripts: next }) });
      const j = (await r.json().catch(() => ({}))) as { scripts?: StudioScript[]; message?: string };
      if (!r.ok || !j.scripts) throw new Error(j.message || "That didn't save. Try again.");
      qc.setQueryData([SCRIPTS_URL], { scripts: j.scripts });
      return j.scripts;
    } catch (e) { setErr((e as Error).message); return null; } finally { setBusy(false); }
  };
  const saveNew = async () => {
    const name = (naming ?? "").trim() || firstLine(text) || "Untitled script";
    const x: StudioScript = { id: newId(), name, text, at: new Date().toISOString() };
    if (await put([x, ...list])) { setCurrentId(x.id); setNaming(null); if (then) { use(then); setThen(null); } }
  };
  const saveChanges = async () => !!current && !!(await put(list.map((x) => (x.id === current.id ? { ...x, text, at: new Date().toISOString() } : x))));
  const use = (x: StudioScript) => { setText(x.text); setCurrentId(x.id); setAsking(null); };
  const pick = (x: StudioScript) => {
    const kept = !text.trim() || text === x.text || list.some((y) => y.text === text);
    if (kept) use(x); else setAsking(x);
  };
  const remove = async (x: StudioScript) => { if (await put(list.filter((y) => y.id !== x.id)) && currentId === x.id) setCurrentId(""); setSure(""); };

  const changed = !!current && text !== current.text;
  const ghost = "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold";
  return (
    <div className="mx-4 mt-3" data-testid="scripts-bar">
      {naming !== null ? (
        <form onSubmit={(e) => { e.preventDefault(); void saveNew(); }} className="flex items-center gap-2">
          <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} maxLength={60} placeholder="Name this script" aria-label="Script name" className="h-9 min-w-0 flex-1 rounded-lg border border-[#d0d5dd] px-3 text-[14px] outline-none focus:border-[#053877] focus:ring-2 focus:ring-[#053877]/15" data-testid="script-name" />
          <button type="submit" disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#053877] px-3.5 text-[13px] font-bold text-white disabled:opacity-60" data-testid="script-save-new">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save</button>
          <button type="button" onClick={() => { setNaming(null); setThen(null); }} className="h-9 px-1.5 text-[13px] font-semibold text-[#475467] hover:text-[#101828]">Cancel</button>
        </form>
      ) : asking ? (
        <div className="rounded-xl border border-[#fedf89] bg-[#fffaeb] p-3 text-[13px] text-[#7a2e0e]" data-testid="script-replace-ask">
          <p>Put <b>{asking.name}</b> in Notes? What's there now isn't saved as a script.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => use(asking)} className="h-8 rounded-lg bg-[#053877] px-3 text-[13px] font-bold text-white" data-testid="script-replace">Replace my notes</button>
            <button type="button" onClick={() => { const x = asking; setAsking(null); if (current) void saveChanges().then((ok) => { if (ok) use(x); }); else { setThen(x); setNaming(firstLine(text)); } }} className="h-8 rounded-lg bg-white px-3 text-[13px] font-semibold text-[#344054] ring-1 ring-[#d0d5dd]">Save mine first</button>
            <button type="button" onClick={() => setAsking(null)} className="h-8 px-1.5 text-[13px] font-semibold text-[#475467]">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          {list.length > 0 && (
            <DropdownMenu onOpenChange={(o) => { if (!o) setSure(""); }}>
              <DropdownMenuTrigger asChild>
                <button type="button" className={`${ghost} min-w-0 border border-[#d0d5dd] bg-white text-[#344054] hover:bg-[#f9fafb]`} data-testid="scripts-open">
                  <FileText className="h-4 w-4 shrink-0" />
                  <span className="truncate">{current ? current.name : "Saved scripts"}</span>
                  {!current && <span className="text-[#667085]">{list.length}</span>}
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72" data-testid="scripts-menu">
                <DropdownMenuLabel className="text-[12px] font-semibold text-[#667085]">Pick a script to put it in Notes</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {list.map((x) => (
                  <DropdownMenuItem key={x.id} onSelect={() => pick(x)} className="group gap-2 pr-1" data-testid={`script-${x.id}`}>
                    {x.id === currentId ? <Check className="h-4 w-4 shrink-0 text-[#053877]" /> : <FileText className="h-4 w-4 shrink-0 text-[#98a2b3]" />}
                    <span className="min-w-0 flex-1 truncate">{x.name}</span>
                    {sure === x.id ? (
                      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void remove(x); }} className="rounded-md bg-[#d92d20] px-2 py-0.5 text-[12px] font-bold text-white" data-testid={`script-delete-yes-${x.id}`}>Delete</button>
                    ) : (
                      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSure(x.id); }} aria-label={`Delete ${x.name}`} className="rounded-md p-1 text-[#98a2b3] hover:bg-[#fef3f2] hover:text-[#b42318]" data-testid={`script-delete-${x.id}`}><Trash2 className="h-3.5 w-3.5" /></button>
                    )}
                  </DropdownMenuItem>
                ))}
                {(current || (text.trim() && !current)) && <DropdownMenuSeparator />}
                {text.trim() && current && <DropdownMenuItem onSelect={() => setNaming("")} className="gap-2" data-testid="script-save-as-new"><Plus className="h-4 w-4" /> Save as a new script</DropdownMenuItem>}
                {text.trim() && !current && <DropdownMenuItem onSelect={() => setNaming(firstLine(text))} className="gap-2" data-testid="script-save-as-menu"><Plus className="h-4 w-4" /> Save what's in Notes</DropdownMenuItem>}
                {current && !changed && <DropdownMenuItem onSelect={() => { setCurrentId(""); setText(""); }} className="gap-2" data-testid="script-new"><FileText className="h-4 w-4" /> Start a blank script</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {changed ? (
            <button type="button" disabled={busy} onClick={() => void saveChanges()} className={`${ghost} shrink-0 whitespace-nowrap bg-[#053877] text-white disabled:opacity-60`} data-testid="script-save-changes">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Save changes</button>
          ) : current ? (
            <span className="inline-flex shrink-0 items-center gap-1 px-1 text-[12px] text-[#667085]" data-testid="script-saved"><Check className="h-3.5 w-3.5" />Saved</span>
          ) : text.trim() ? (
            <button type="button" onClick={() => setNaming(firstLine(text))} className={`${ghost} shrink-0 whitespace-nowrap border border-[#d0d5dd] bg-white text-[#344054] hover:bg-[#f9fafb]`} data-testid="script-save-as">
              <Plus className="h-3.5 w-3.5" />Save as script
            </button>
          ) : null}
        </div>
      )}
      {err && <p className="mt-1.5 text-[12px] text-[#b42318]">{err}</p>}
    </div>
  );
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

/**
 * The script in its own window, only on this screen (Andrew, 22 Nov: "make the teleprompt more screen? And or let the
 * user pull the corners to resize"). It opens over the whole stage; drag its top bar to move it, pull any corner or
 * edge to resize it, or fill the screen. Where it sits is kept as a share of the window, so it survives a resize.
 */
type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const MIN_W = 300, MIN_H = 180, GAP = 12;
type Px = { x: number; y: number; w: number; h: number };
const clampPx = (r: Px, vw: number, vh: number): Px => {
  const w = Math.min(vw, Math.max(MIN_W, r.w)), h = Math.min(vh, Math.max(MIN_H, r.h));
  return { w, h, x: Math.min(vw - w, Math.max(0, r.x)), y: Math.min(vh - h, Math.max(0, r.y)) };
};

export function PrompterOverlay({ roomKey, text }: { roomKey: string; text: string }) {
  const [p, setP] = usePrompter(roomKey);
  const [playing, setPlaying] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const anchor = useRef<HTMLDivElement | null>(null);
  const pos = useRef(0);
  const [stage, setStage] = useState<Px | null>(null);
  const [view, setView] = useState({ w: typeof window === "undefined" ? 1280 : window.innerWidth, h: typeof window === "undefined" ? 800 : window.innerHeight });
  const [live, setLive_] = useState<Px | null>(null); // while dragging or resizing
  const liveRef = useRef<Px | null>(null);
  const setLive = (r: Px | null) => { liveRef.current = r; setLive_(r); };
  const drag = useRef<{ edge: Edge | "move"; sx: number; sy: number; from: Px } | null>(null);

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

  // Where the stage is, so the window opens over it; and the window's size, for the saved place.
  useEffect(() => {
    if (!p.on) return;
    const measure = () => {
      setView({ w: window.innerWidth, h: window.innerHeight });
      const r = anchor.current?.getBoundingClientRect();
      if (r) setStage({ x: r.left, y: r.top, w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (anchor.current) ro.observe(anchor.current);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [p.on]);

  // Esc leaves full screen.
  useEffect(() => {
    if (!p.on || !p.full) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setP({ ...p, full: false }); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [p, setP]);

  // A scroll by hand moves the reading point (and isn't fought by the auto-scroll).
  const onScroll = () => { if (!playing && box.current) pos.current = box.current.scrollTop; };
  const restart = () => { pos.current = 0; if (box.current) box.current.scrollTop = 0; };
  const size = (d: number) => { const i = SIZES.indexOf(p.size); const next = SIZES[Math.max(0, Math.min(SIZES.length - 1, (i < 0 ? 3 : i) + d))]; setP({ ...p, size: next }); };

  const anchorEl = <div ref={anchor} className="pointer-events-none absolute inset-0" aria-hidden />;
  if (!p.on) return anchorEl;

  const vw = view.w, vh = view.h;
  const saved: Px | null = p.rect ? { x: p.rect.x * vw, y: p.rect.y * vh, w: p.rect.w * vw, h: p.rect.h * vh } : null;
  const at: Px = clampPx(
    live ?? (p.full ? { x: GAP, y: GAP, w: vw - GAP * 2, h: vh - GAP * 2 } : saved ?? stage ?? { x: GAP, y: GAP, w: Math.min(768, vw - GAP * 2), h: 432 }),
    vw, vh,
  );
  const moved = !!p.rect && !p.full;

  const start = (edge: Edge | "move") => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (edge === "move" && (e.target as HTMLElement).closest("button,input,label")) return;
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* not a live pointer */ }
    drag.current = { edge, sx: e.clientX, sy: e.clientY, from: at };
    setLive(at);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy, f = d.from;
    let r: Px = { ...f };
    if (d.edge === "move") r = { ...f, x: f.x + dx, y: f.y + dy };
    else {
      if (d.edge.includes("e")) r.w = f.w + dx;
      if (d.edge.includes("s")) r.h = f.h + dy;
      if (d.edge.includes("w")) { r.w = Math.max(MIN_W, f.w - dx); r.x = f.x + f.w - r.w; }
      if (d.edge.includes("n")) { r.h = Math.max(MIN_H, f.h - dy); r.y = f.y + f.h - r.h; }
    }
    setLive(clampPx(r, vw, vh));
  };
  const end = () => {
    const d = drag.current, r = liveRef.current;
    drag.current = null;
    if (d && r) setP({ ...p, full: false, rect: { x: r.x / vw, y: r.y / vh, w: r.w / vw, h: r.h / vh } });
    setLive(null);
  };
  const handle = (edge: Edge, cls: string) => (
    <div onPointerDown={start(edge)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} className={`absolute z-10 touch-none ${cls}`} data-testid={`prompter-resize-${edge}`} aria-hidden />
  );

  const btn = "flex h-8 w-8 items-center justify-center rounded-lg text-white hover:bg-white/15 disabled:opacity-40";
  return (<>
    {anchorEl}
    {createPortal(
      <div className={`fixed ${p.full ? "z-[60]" : "z-[45]"} flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[rgba(4,12,32,0.84)] text-white shadow-[0_18px_48px_rgba(0,0,0,0.35)] backdrop-blur-[2px]`} style={{ left: at.x, top: at.y, width: at.w, height: at.h }} data-testid="prompter" role="dialog" aria-label="Teleprompter">
        <div onPointerDown={start("move")} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onDoubleClick={() => setP({ ...p, full: false, rect: null })} className={`flex shrink-0 touch-none flex-wrap items-center gap-x-1 gap-y-0.5 border-b border-white/10 px-2.5 py-1.5 ${live && drag.current?.edge === "move" ? "cursor-grabbing" : "cursor-grab"}`} data-testid="prompter-bar" title="Drag to move. Pull a corner to resize.">
          <GripVertical className="h-4 w-4 shrink-0 text-white/45" aria-hidden />
          <span className="mr-1 whitespace-nowrap rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold" data-testid="prompter-only-you">{at.w >= 480 ? "Only visible to you" : "Only you"}</span>
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
          <span className="ml-auto hidden whitespace-nowrap pl-2 text-[12px] text-white/70 md:inline">{at.w >= 640 ? readTime(text, p.speed) : ""}</span>
          {moved && <button type="button" onClick={() => setP({ ...p, rect: null, full: false })} className={`${btn} ml-auto md:ml-0`} aria-label="Back over my stage" title="Back over my stage" data-testid="prompter-reset"><PictureInPicture2 className="h-4 w-4" /></button>}
          <button type="button" onClick={() => setP({ ...p, full: !p.full })} className={`${btn} ${moved ? "" : "ml-auto md:ml-0"}`} aria-label={p.full ? "Smaller" : "Fill the screen"} title={p.full ? "Smaller (Esc)" : "Fill the screen"} data-testid="prompter-full">{p.full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
          <button type="button" onClick={() => { setPlaying(false); setP({ ...p, on: false }); }} className={btn} aria-label="Turn the teleprompter off"><X className="h-4 w-4" /></button>
        </div>
        <div ref={box} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto px-[6%] pb-[40%] pt-4" style={{ scrollbarWidth: "none" }}>
          {text.trim()
            ? <p className="whitespace-pre-wrap text-center font-semibold leading-[1.35]" style={{ fontSize: p.size }} data-testid="prompter-text">{text}</p>
            : <p className="pt-6 text-center text-[15px] text-white/70">Your script goes in Notes. Type it there and it shows here.</p>}
        </div>
        {/* Pull any corner or edge to resize. The corners show a small mark so they're easy to find. */}
        {handle("n", "inset-x-4 top-0 h-1.5 cursor-ns-resize")}
        {handle("s", "inset-x-4 bottom-0 h-2 cursor-ns-resize")}
        {handle("w", "inset-y-4 left-0 w-2 cursor-ew-resize")}
        {handle("e", "inset-y-4 right-0 w-2 cursor-ew-resize")}
        {handle("nw", "left-0 top-0 h-4 w-4 cursor-nwse-resize")}
        {handle("ne", "right-0 top-0 h-4 w-4 cursor-nesw-resize")}
        {handle("sw", "bottom-0 left-0 h-5 w-5 cursor-nesw-resize")}
        {handle("se", "bottom-0 right-0 h-5 w-5 cursor-nwse-resize")}
        <span className="pointer-events-none absolute bottom-1.5 right-1.5 h-3 w-3 border-b-2 border-r-2 border-white/50" aria-hidden />
        <span className="pointer-events-none absolute bottom-1.5 left-1.5 h-3 w-3 border-b-2 border-l-2 border-white/50" aria-hidden />
      </div>,
      document.body,
    )}
  </>);
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
