import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronsLeft, ChevronsRight, Minus, Pause, Play, Plus } from "lucide-react";

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

type Drag = { kind: "start" | "end" | "move" | "head"; x0: number; s0: number; e0: number };

/**
 * The episode's timeline, under the player, like Canva's: a ruler, a strip of
 * frames, gold handles on what's kept, and a playhead. Drag a handle and the
 * player shows that frame; drag the playhead (or anywhere on the ruler) and it
 * scrubs; drag the middle to slide the selection. Zoom in to cut to the
 * second; the view follows the playhead while it plays. A focused handle
 * nudges with the arrow keys (a second, or five with Shift).
 */
export function TrimStrip({ videoRef, duration, time, start, end, onChange, minLen = 1, maxLen, ghost = false, label }: {
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
  /** What the gold part is: "Keeps", "Clip". */
  label?: string;
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
  const move = (ev: React.PointerEvent) => {
    if (!drag) return;
    // Dragging into either edge of a zoomed timeline scrolls it along.
    const el = scroller.current;
    if (el && zoom > 1) {
      const r = el.getBoundingClientRect();
      if (ev.clientX > r.right - 32) el.scrollLeft += 14;
      else if (ev.clientX < r.left + 32) el.scrollLeft -= 14;
    }
    const t = timeAt(ev.clientX);
    if (drag.kind === "head") show(t);
    else if (drag.kind === "start") apply("start", t, drag.e0);
    else if (drag.kind === "end") apply("end", drag.s0, t);
    else {
      const dt = ((ev.clientX - drag.x0) / track.current!.getBoundingClientRect().width) * d;
      apply("move", drag.s0 + dt, drag.e0 + dt);
    }
  };
  const up = () => setDrag(null);
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
  // The slider is logarithmic: each step of it doubles or halves the view.
  const sliderValue = Math.round((Math.log(zoom) / Math.log(maxZoom)) * 100) || 0;
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

  const togglePlay = () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) void vid.play(); else vid.pause();
  };
  const handle = "absolute inset-y-0 z-20 flex w-4 cursor-ew-resize touch-none items-center justify-center bg-[#F0A71F] outline-none focus-visible:ring-2 focus-visible:ring-[#053877] dark:focus-visible:ring-white";

  return (
    <div className="select-none" data-testid="trim-strip">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={togglePlay} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" aria-label={playing ? "Pause" : "Play"} data-testid="trim-play">
          {playing ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
        </button>
        <span className="text-sm font-semibold tabular-nums">{hms(time)} <span className="font-normal text-muted-foreground">/ {hms(d)}</span></span>
        {label && d > 0 && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${ghost ? "bg-muted text-muted-foreground" : "bg-[#F0A71F]/20 text-[#7a4b00] dark:text-[#F0A71F]"}`} data-testid="trim-label">
            {label} {hms(start)} → {hms(end)} · {hms(end - start)}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {d > 60 && (
            <>
              <button type="button" onClick={() => edge("start")} className="inline-flex h-7 items-center gap-1 rounded-full border border-border px-2.5 text-xs font-semibold hover:bg-muted" data-testid="trim-edge-start"><ChevronsLeft className="h-3.5 w-3.5" /> Zoom to start</button>
              <button type="button" onClick={() => edge("end")} className="mr-2 inline-flex h-7 items-center gap-1 rounded-full border border-border px-2.5 text-xs font-semibold hover:bg-muted" data-testid="trim-edge-end">Zoom to end <ChevronsRight className="h-3.5 w-3.5" /></button>
            </>
          )}
          <button type="button" onClick={() => zoomTo(zoom / 2)} disabled={zoom <= 1} className="flex h-7 w-7 items-center justify-center rounded-full border border-border hover:bg-muted disabled:opacity-40" aria-label="Zoom out"><Minus className="h-3.5 w-3.5" /></button>
          <input type="range" min={0} max={100} step={1} value={sliderValue} onChange={(e) => zoomTo(Math.pow(maxZoom, Number(e.target.value) / 100))} className="w-24 accent-[#053877]" aria-label="Zoom" data-testid="trim-zoom" />
          <button type="button" onClick={() => zoomTo(zoom * 2)} disabled={zoom >= maxZoom} className="flex h-7 w-7 items-center justify-center rounded-full border border-border hover:bg-muted disabled:opacity-40" aria-label="Zoom in"><Plus className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      <div ref={scroller} className="overflow-x-auto overflow-y-hidden px-2 pb-1" onPointerMove={move} onPointerUp={up} onPointerCancel={up} onScroll={(e) => setScrollX(e.currentTarget.scrollLeft)}>
        <div ref={track} className="relative" style={{ width: inner }}>
          {/* The ruler: press anywhere on it to grab the playhead. */}
          <div onPointerDown={down("head")} className="relative h-6 cursor-ew-resize touch-none" data-testid="trim-ruler">
            {ticks.map((t, i) => (
              <div key={t} className="absolute top-0 flex h-full flex-col" style={{ left: x(t) }}>
                <span className={`whitespace-nowrap text-[10px] tabular-nums text-muted-foreground ${i === 0 ? "pl-1.5" : x(t) > inner - 24 ? "-translate-x-full" : "-translate-x-1/2"}`}>{tick(t)}</span>
                <span className="mt-auto h-1.5 w-px bg-border" />
              </div>
            ))}
          </div>

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
              className={`absolute inset-y-0 z-10 cursor-grab touch-none rounded-md border-y-[3px] border-[#F0A71F] active:cursor-grabbing ${ghost ? "opacity-50" : ""}`}
              style={{ left: x(start), width: Math.max(0, x(end) - x(start)) }}
              data-testid="trim-kept"
            />
            <div role="slider" tabIndex={0} aria-label="Start" aria-valuemin={0} aria-valuemax={Math.round(d)} aria-valuenow={Math.round(start)} aria-valuetext={hms(start)}
              onPointerDown={down("start")} onKeyDown={nudge("start")}
              className={`${handle} rounded-l-md ${ghost ? "opacity-60" : ""}`} style={{ left: x(start) }} data-testid="trim-handle-start">
              <span className="h-6 w-0.5 rounded bg-[#1a1200]/60" />
            </div>
            <div role="slider" tabIndex={0} aria-label="End" aria-valuemin={0} aria-valuemax={Math.round(d)} aria-valuenow={Math.round(end)} aria-valuetext={hms(end)}
              onPointerDown={down("end")} onKeyDown={nudge("end")}
              className={`${handle} rounded-r-md ${ghost ? "opacity-60" : ""}`} style={{ left: x(end) - 16 }} data-testid="trim-handle-end">
              <span className="h-6 w-0.5 rounded bg-[#1a1200]/60" />
            </div>
          </div>

          {/* The playhead, over the ruler and the frames; its knob can be dragged. */}
          <div className="pointer-events-none absolute bottom-0 top-0 z-30" style={{ left: x(time) }}>
            <div onPointerDown={down("head")} className="pointer-events-auto absolute -left-[7px] top-0 h-3.5 w-3.5 cursor-ew-resize touch-none rounded-full border-2 border-white bg-[#053877] shadow dark:border-[#053877] dark:bg-white" data-testid="trim-playhead" />
            <div className="absolute -left-px bottom-0 top-3 w-0.5 bg-[#053877] dark:bg-white" />
          </div>
        </div>
      </div>
      {hint && (
        <p className="mt-1.5 text-xs font-semibold text-[#7a4b00] dark:text-[#F0A71F]" data-testid="trim-hint">
          {hint === "start" ? "Now drag the gold handle on the left to where the show should begin. The player shows the frame." : "Now drag the gold handle on the right to where the show should end. The player shows the frame."}
        </p>
      )}
    </div>
  );
}
