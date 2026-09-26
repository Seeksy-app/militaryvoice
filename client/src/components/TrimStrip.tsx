import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronsLeft, ChevronsRight, Minus, Plus, Scissors } from "lucide-react";

// Whole seconds down, as the player shows them (21:59, not 22:00).
const hms = (sec: number) => {
  const s = Math.max(0, Math.floor(sec + 0.001));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
};
/** Ruler labels: "10s" under a minute, "1:30" after, like Canva's. */
const tick = (sec: number) => (sec < 60 ? `${sec}s` : hms(sec));
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];

type Drag = { kind: "start" | "end" | "move" | "head"; x0: number; s0: number; e0: number; t0?: number; knob?: boolean };

/**
 * The episode's timeline, under the player, like Canva's: a ruler, a strip of
 * frames, gold handles on what's kept, and a playhead. Drag a handle and the
 * player shows that frame; drag the playhead (or anywhere on the ruler) and it
 * scrubs; drag the middle to slide the selection. Zoom in to cut to the
 * second; the view follows the playhead while it plays. A focused handle
 * nudges with the arrow keys (a second, or five with Shift).
 */
export function TrimStrip({ videoRef, duration, time, start, end, onChange, minLen = 1, maxLen, ghost = false, tone = "gold", cut, extra, flags = true }: {
  videoRef: React.RefObject<HTMLVideoElement>;
  duration: number;
  /** Where the player is. */
  time: number;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  minLen?: number;
  maxLen?: number;
  /** A suggested selection, drawn faintly until it's touched. */
  ghost?: boolean;
  /** Gold for trimming the episode, violet for a clip: two jobs that never look alike. */
  tone?: "gold" | "violet";
  /** The ✂ on the playhead, Canva's Split: click it to cut at the playhead. */
  cut?: { before: string; after: string; onBefore: (t: number) => void; onAfter: (t: number) => void };
  /** More controls for the zoom row (Focus). */
  extra?: React.ReactNode;
  /** "Start 0:10" / "End 21:59" flags riding the edges, to grab. */
  flags?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const cells = useRef(new Map<number, HTMLCanvasElement>());
  const cache = useRef(new Map<number, HTMLCanvasElement>());
  const grabber = useRef<HTMLVideoElement | null>(null);
  const [scrollX, setScrollX] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(800);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [playing, setPlaying] = useState(false);
  const [hint, setHint] = useState<"" | "start" | "end">("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (!(e.target as HTMLElement)?.closest?.("[data-cut-menu]")) setMenu(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("pointerdown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("scroll", close, true); window.removeEventListener("keydown", esc); };
  }, [menu]);
  const color = tone === "violet" ? "#7c3aed" : "#F0A71F";
  const frame = useRef(0);
  const d = duration || 0;
  const inner = width * zoom;
  const x = (t: number) => (d ? Math.min(inner, Math.max(0, (t / d) * inner)) : 0);
  // Frames are 96px slots along the (zoomed) timeline; only those on screen are drawn.
  const CELL = 96;
  const slots = Math.max(1, Math.ceil(inner / CELL));
  const first = Math.max(0, Math.floor((scrollX - 8) / CELL) - 2);
  const last = Math.min(slots - 1, Math.ceil((scrollX + width) / CELL) + 2);
  const slotTime = (j: number) => Math.min(d, ((j + 0.5) * CELL * d) / inner);

  // The visible width, for the ruler and how many frames fit.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const size = () => setWidth((el.clientWidth || 816) - 16);
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const on = () => setPlaying(!v.paused);
    v.addEventListener("play", on);
    v.addEventListener("pause", on);
    on();
    return () => { v.removeEventListener("play", on); v.removeEventListener("pause", on); };
  }, [videoRef, d]);

  // Keep the playhead in view while it plays (not while you're dragging).
  useEffect(() => {
    const el = scroller.current;
    if (!el || drag || !playing || zoom === 1) return;
    const px = x(time);
    if (px < el.scrollLeft + 24 || px > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = px - el.clientWidth * 0.2;
  }, [time, playing, drag, zoom]);

  // The frames: a hidden copy of the video seeks to each slot on screen and
  // draws it. Drawing another origin's video onto a canvas is allowed (it just
  // can't be read back). Every frame fetched is kept (to the half second), so
  // zooming or scrolling paints the nearest one at once, then sharpens.
  const src = videoRef.current?.currentSrc || videoRef.current?.src || "";
  useEffect(() => {
    cache.current = new Map();
    if (!src) return;
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "metadata"; // seeks fetch only what each frame needs
    v.playsInline = true;
    v.src = src;
    grabber.current = v;
    return () => { v.removeAttribute("src"); v.load(); grabber.current = null; };
  }, [src]);
  useEffect(() => {
    const vid = grabber.current;
    if (!vid || !d) return;
    let stopped = false;
    const paint = (j: number, img: HTMLCanvasElement) => {
      const c = cells.current.get(j);
      if (!c || !img.width || !img.height) return;
      c.width = CELL * 2;
      c.height = Math.max(40, c.clientHeight * 2);
      const scale = Math.max(c.width / img.width, c.height / img.height);
      const sw = c.width / scale;
      const sh = c.height / scale;
      try { c.getContext("2d")?.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, c.width, c.height); } catch { /* stays dark */ }
    };
    const want = Array.from({ length: last - first + 1 }, (_, i) => first + i);
    const keys = [...cache.current.keys()];
    if (keys.length) {
      for (const j of want) {
        const t = slotTime(j);
        const k = keys.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
        paint(j, cache.current.get(k)!);
      }
    }
    const timer = setTimeout(async () => {
      const seekTo = (t: number) => new Promise<void>((resolve) => {
        const done = () => { vid.removeEventListener("seeked", done); resolve(); };
        vid.addEventListener("seeked", done);
        setTimeout(done, 5000);
        vid.currentTime = t;
      });
      if (vid.readyState < 1) await new Promise<void>((r) => { vid.addEventListener("loadedmetadata", () => r(), { once: true }); setTimeout(r, 8000); });
      // From the middle of the view outwards.
      const midJ = (first + last) / 2;
      for (const j of [...want].sort((a, b) => Math.abs(a - midJ) - Math.abs(b - midJ))) {
        if (stopped) return;
        const t = slotTime(j);
        const k = Math.round(t * 2) / 2;
        const have = cache.current.get(k);
        if (have) { paint(j, have); continue; }
        await seekTo(t);
        if (stopped) return;
        if (!vid.videoWidth) continue;
        const keep = document.createElement("canvas");
        keep.width = 192;
        keep.height = Math.round((192 * vid.videoHeight) / vid.videoWidth) || 108;
        try { keep.getContext("2d")?.drawImage(vid, 0, 0, keep.width, keep.height); } catch { continue; }
        cache.current.set(k, keep);
        paint(j, keep);
      }
    }, 200);
    return () => { stopped = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, d, first, last, inner]);

  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(d, Math.max(0, ((clientX - r.left) / r.width) * d));
  };
  // The player follows whatever you're dragging, a frame at a time.
  const show = (t: number) => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const vid = videoRef.current;
      if (!vid) return;
      if (!vid.paused) vid.pause();
      vid.currentTime = t;
    });
  };

  const apply = (kind: Drag["kind"], s: number, e: number) => {
    if (kind === "start") {
      s = Math.min(s, e - minLen);
      if (maxLen) s = Math.max(s, e - maxLen);
      s = Math.max(0, s);
      onChange(s, e);
      show(s);
    } else if (kind === "end") {
      e = Math.max(e, s + minLen);
      if (maxLen) e = Math.min(e, s + maxLen);
      e = Math.min(d, e);
      onChange(s, e);
      show(e);
    } else if (kind === "move") {
      const len = e - s;
      s = Math.min(Math.max(0, s), d - len);
      onChange(s, s + len);
      show(s);
    }
  };

  const down = (kind: Drag["kind"]) => (ev: React.PointerEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    setDrag({ kind, x0: ev.clientX, s0: start, e0: end });
    if (kind === "start" || kind === "end") setHint("");
    if (kind === "head") show(timeAt(ev.clientX));
  };
  // The knob: a click opens the ✂ menu; a drag moves the playhead from where it was (no jump).
  const downKnob = (ev: React.PointerEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    setDrag({ kind: "head", x0: ev.clientX, s0: start, e0: end, t0: time, knob: true });
  };
  const move = (ev: React.PointerEvent) => {
    if (!drag) return;
    // Dragging into either edge of a zoomed timeline scrolls it along.
    const el = scroller.current;
    if (el && zoom > 1) {
      const r = el.getBoundingClientRect();
      if (ev.clientX > r.right - 32) el.scrollLeft += 14;
      else if (ev.clientX < r.left + 32) el.scrollLeft -= 14;
    }
    const t = drag.knob && drag.t0 != null
      ? Math.min(d, Math.max(0, drag.t0 + ((ev.clientX - drag.x0) / track.current!.getBoundingClientRect().width) * d))
      : timeAt(ev.clientX);
    if (drag.kind === "head") show(t);
    else if (drag.kind === "start") apply("start", t, drag.e0);
    else if (drag.kind === "end") apply("end", drag.s0, t);
    else {
      const dt = ((ev.clientX - drag.x0) / track.current!.getBoundingClientRect().width) * d;
      apply("move", drag.s0 + dt, drag.e0 + dt);
    }
  };
  const up = (ev: React.PointerEvent) => {
    if (drag?.knob && cut && Math.abs(ev.clientX - drag.x0) < 4) {
      const r = (ev.target as HTMLElement).getBoundingClientRect();
      videoRef.current?.pause();
      setMenu({ x: r.left + r.width / 2, y: r.bottom + 6 });
    }
    setDrag(null);
  };
  // Arrow keys move the playhead: a second, or five with Shift.
  const keys = (ev: React.KeyboardEvent) => {
    const dir = ev.key === "ArrowLeft" ? -1 : ev.key === "ArrowRight" ? 1 : 0;
    if (!dir || (ev.target as HTMLElement).getAttribute("role") === "slider") return;
    ev.preventDefault();
    show(Math.min(d, Math.max(0, time + dir * (ev.shiftKey ? 5 : 1))));
  };
  const nudge = (kind: "start" | "end") => (ev: React.KeyboardEvent) => {
    const step = ev.shiftKey ? 5 : 1;
    const dir = ev.key === "ArrowLeft" ? -1 : ev.key === "ArrowRight" ? 1 : 0;
    if (!dir) return;
    ev.preventDefault();
    if (kind === "start") apply("start", start + dir * step, end);
    else apply("end", start, end + dir * step);
  };

  // Zoom goes as far as ~20 seconds across the whole width, however long the episode.
  const maxZoom = Math.max(4, d / 20);
  // Zoom around a moment (the playhead by default), so what you're looking at stays put.
  const zoomTo = (z: number, around = time, align: "center" | "left" | "right" = "center") => {
    const el = scroller.current;
    const next = Math.min(maxZoom, Math.max(1, z));
    setZoom(next);
    if (el && d) requestAnimationFrame(() => {
      const px = (around / d) * width * next + 8;
      el.scrollLeft = align === "left" ? px - 24 : align === "right" ? px - el.clientWidth + 24 : px - el.clientWidth / 2;
    });
  };
  // Dead air at either end: the first or last 30 seconds across the whole width.
  const edge = (which: "start" | "end") => {
    const z = d / 30;
    if (which === "start") { zoomTo(z, 0, "left"); show(start); }
    else { zoomTo(z, d, "right"); show(end); }
    setHint(which);
  };

  // A tick every `step` seconds, at least ~80px apart.
  const step = STEPS.find((s) => (d ? (s / d) * inner : 0) >= 80) ?? STEPS[STEPS.length - 1];
  const ticks = d ? Array.from({ length: Math.floor(d / step) + 1 }, (_, i) => i * step) : [];

  const handle = "absolute inset-y-0 z-20 flex w-4 cursor-ew-resize touch-none items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-[#053877] dark:focus-visible:ring-white";

  return (
    <div className="select-none" data-testid="trim-strip">
      {/* Just the zoom: the player above has play and the time, the mode bar says what this is. */}
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {d > 60 && tone === "gold" && (
          <>
            <button type="button" onClick={() => edge("start")} className="inline-flex h-7 items-center gap-1 rounded-full border border-border px-2.5 text-xs font-semibold hover:bg-muted" data-testid="trim-edge-start"><ChevronsLeft className="h-3.5 w-3.5" /> Zoom to start</button>
            <button type="button" onClick={() => edge("end")} className="inline-flex h-7 items-center gap-1 rounded-full border border-border px-2.5 text-xs font-semibold hover:bg-muted" data-testid="trim-edge-end">Zoom to end <ChevronsRight className="h-3.5 w-3.5" /></button>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          {extra}
          <button type="button" onClick={() => zoomTo(zoom / 2)} disabled={zoom <= 1} className="flex h-7 w-7 items-center justify-center rounded-full border border-border hover:bg-muted disabled:opacity-40" aria-label="Zoom out" data-testid="trim-zoom-out"><Minus className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => zoomTo(zoom * 2)} disabled={zoom >= maxZoom} className="flex h-7 w-7 items-center justify-center rounded-full border border-border hover:bg-muted disabled:opacity-40" aria-label="Zoom in" data-testid="trim-zoom-in"><Plus className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      <div ref={scroller} className="overflow-x-auto overflow-y-hidden px-2 pb-1" onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)} onKeyDown={keys} tabIndex={0} onScroll={(e) => setScrollX(e.currentTarget.scrollLeft)}>
        <div ref={track} className="relative" style={{ width: inner }}>
          {/* The ruler: press anywhere on it to grab the playhead. */}
          <div onPointerDown={down("head")} className={`relative cursor-ew-resize touch-none ${cut ? "h-8" : "h-6"}`} data-testid="trim-ruler">
            {ticks.map((t, i) => (
              <div key={t} className="absolute top-0 flex h-full flex-col" style={{ left: x(t) }}>
                <span className={`whitespace-nowrap text-[10px] tabular-nums text-muted-foreground ${i === 0 ? "pl-1.5" : x(t) > inner - 24 ? "-translate-x-full" : "-translate-x-1/2"}`}>{tick(t)}</span>
                <span className="mt-auto h-1.5 w-px bg-border" />
              </div>
            ))}
          </div>

          {/* The flags: the edit's two edges, labelled and easy to grab even zoomed out.
              Start reaches right from its edge and End reaches left, unless they'd meet. */}
          {flags && d > 0 && (() => {
            const close = x(end) - x(start) < 170;
            const flag = "absolute top-0.5 z-20 inline-flex h-6 cursor-ew-resize touch-none items-center gap-1 whitespace-nowrap rounded-md px-2 text-[11px] font-bold tabular-nums shadow-sm";
            const ink = tone === "violet" ? "text-white" : "text-[#1a1200]";
            return (
              <div className="relative h-7">
                <div onPointerDown={down("start")} className={`${flag} ${ink} ${close ? "-translate-x-full rounded-br-none" : "rounded-bl-none"} ${ghost ? "opacity-70" : ""}`} style={{ left: x(start), backgroundColor: color }} data-testid="trim-flag-start">
                  Start {hms(start)}
                </div>
                <div onPointerDown={down("end")} className={`${flag} ${ink} ${close ? "rounded-bl-none" : "-translate-x-full rounded-br-none"} ${ghost ? "opacity-70" : ""}`} style={{ left: x(end), backgroundColor: color }} data-testid="trim-flag-end">
                  End {hms(end)}
                </div>
              </div>
            );
          })()}

          {/* The frames. */}
          <div onPointerDown={down("head")} className="relative h-16 cursor-pointer touch-none overflow-hidden rounded-lg bg-[#050d26]">
            <div className="absolute inset-0">
              {Array.from({ length: last - first + 1 }, (_, i) => first + i).map((j) => (
                <canvas
                  key={`${Math.round(inner)}-${j}`}
                  ref={(c) => { if (c) cells.current.set(j, c); else cells.current.delete(j); }}
                  className="absolute inset-y-0 h-full border-r border-black/40"
                  style={{ left: j * CELL, width: Math.min(CELL, inner - j * CELL) }}
                />
              ))}
            </div>
            {/* What's cut, dimmed. */}
            <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/65" style={{ width: x(start) }} />
            <div className="pointer-events-none absolute inset-y-0 right-0 bg-black/65" style={{ left: x(end) }} />
            {/* What's kept: gold edges; drag the middle to slide it. */}
            <div
              onPointerDown={down("move")}
              className={`absolute inset-y-0 z-10 cursor-grab touch-none rounded-md border-y-[3px] active:cursor-grabbing ${ghost ? "opacity-50" : ""}`}
              style={{ left: x(start), width: Math.max(0, x(end) - x(start)), borderColor: color }}
              data-testid="trim-kept"
            />
            <div role="slider" tabIndex={0} aria-label="Start" aria-valuemin={0} aria-valuemax={Math.round(d)} aria-valuenow={Math.round(start)} aria-valuetext={hms(start)}
              onPointerDown={down("start")} onKeyDown={nudge("start")}
              className={`${handle} rounded-l-md ${ghost ? "opacity-60" : ""}`} style={{ left: x(start), backgroundColor: color }} data-testid="trim-handle-start">
              <span className="h-6 w-0.5 rounded bg-[#1a1200]/60" />
            </div>
            <div role="slider" tabIndex={0} aria-label="End" aria-valuemin={0} aria-valuemax={Math.round(d)} aria-valuenow={Math.round(end)} aria-valuetext={hms(end)}
              onPointerDown={down("end")} onKeyDown={nudge("end")}
              className={`${handle} rounded-r-md ${ghost ? "opacity-60" : ""}`} style={{ left: x(end) - 16, backgroundColor: color }} data-testid="trim-handle-end">
              <span className="h-6 w-0.5 rounded bg-[#1a1200]/60" />
            </div>
          </div>

          {/* The playhead, over the ruler and the frames; its knob can be dragged. */}
          <div className="pointer-events-none absolute bottom-0 top-0 z-30" style={{ left: x(time) }}>
            {cut ? (
              <button
                type="button"
                onPointerDown={downKnob}
                title="Click to cut here · drag to move"
                className="pointer-events-auto absolute top-0 flex h-6 w-6 -translate-x-1/2 cursor-pointer touch-none items-center justify-center rounded-full border-2 border-white bg-[#053877] text-white shadow-md hover:scale-110 dark:border-[#053877] dark:bg-white dark:text-[#053877]"
                data-testid="trim-playhead"
              >
                <Scissors className="h-3 w-3" />
              </button>
            ) : (
              <div onPointerDown={down("head")} className="pointer-events-auto absolute -left-[7px] top-0 h-3.5 w-3.5 cursor-ew-resize touch-none rounded-full border-2 border-white bg-[#053877] shadow dark:border-[#053877] dark:bg-white" data-testid="trim-playhead" />
            )}
            <div className={`absolute -left-px bottom-0 w-0.5 bg-[#053877] dark:bg-white ${cut ? "top-6" : "top-3"}`} />
          </div>
        </div>
      </div>
      {menu && cut && (
        <div data-cut-menu className="fixed z-[70] w-56 -translate-x-1/2 rounded-xl border border-border bg-popover p-1.5 text-sm shadow-lg" style={{ left: menu.x, top: menu.y }} data-testid="trim-cut-menu">
          <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">At {hms(time)}</p>
          <button type="button" onClick={() => { cut.onBefore(time); setMenu(null); setHint(""); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted" data-testid="trim-cut-before">
            <ChevronsLeft className="h-4 w-4" /> {cut.before}
          </button>
          <button type="button" onClick={() => { cut.onAfter(time); setMenu(null); setHint(""); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted" data-testid="trim-cut-after">
            <ChevronsRight className="h-4 w-4" /> {cut.after}
          </button>
        </div>
      )}
      {hint && (
        <p className="mt-1.5 text-xs font-semibold text-[#7a4b00] dark:text-[#F0A71F]" data-testid="trim-hint">
          {hint === "start" ? "Now drag the Start flag to where the show should begin. The player shows the frame as you drag." : "Now drag the End flag to where the show should end. The player shows the frame as you drag."}
        </p>
      )}
    </div>
  );
}
