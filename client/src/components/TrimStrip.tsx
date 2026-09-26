import { useEffect, useRef, useState } from "react";

const hms = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
};

type Drag = { kind: "start" | "end" | "move"; x0: number; s0: number; e0: number };

/**
 * A trim bar like Canva's: the episode as a strip of frames, with gold handles
 * to drag. Dragging a handle puts the player on that exact frame, so you see
 * what you're cutting to instead of guessing; dragging the middle slides the
 * whole selection. Click the strip to jump there. A focused handle nudges with
 * the arrow keys (a second, or five with Shift).
 */
export function TrimStrip({ videoRef, duration, time, start, end, onChange, minLen = 1, maxLen, ghost = false }: {
  videoRef: React.RefObject<HTMLVideoElement>;
  duration: number;
  /** Where the player is, for the line. */
  time: number;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  minLen?: number;
  maxLen?: number;
  /** A suggested selection, drawn faintly until it's touched. */
  ghost?: boolean;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const cells = useRef<(HTMLCanvasElement | null)[]>([]);
  const [count, setCount] = useState(10);
  const [drag, setDrag] = useState<Drag | null>(null);
  const frame = useRef(0);
  const d = duration || 0;
  const at = (t: number) => (d ? `${Math.min(100, Math.max(0, (t / d) * 100))}%` : "0%");

  // One frame per ~90px of width.
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const size = () => setCount(Math.max(4, Math.min(18, Math.round(el.clientWidth / 90))));
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The frames: a hidden copy of the video seeks through the episode and draws
  // each one into its cell. Drawing another origin's video onto a canvas is
  // allowed (it only can't be read back), which is all a filmstrip needs.
  const src = videoRef.current?.currentSrc || videoRef.current?.src || "";
  useEffect(() => {
    if (!src || !d) return;
    let stopped = false;
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "metadata"; // seeks fetch only what each frame needs, not the whole episode
    v.playsInline = true;
    v.src = src;
    const seekTo = (t: number) => new Promise<void>((resolve) => {
      const done = () => { v.removeEventListener("seeked", done); resolve(); };
      v.addEventListener("seeked", done);
      setTimeout(done, 4000);
      v.currentTime = t;
    });
    (async () => {
      await new Promise<void>((r) => { if (v.readyState >= 1) r(); else { v.onloadedmetadata = () => r(); setTimeout(r, 8000); } });
      for (let i = 0; i < count && !stopped; i++) {
        await seekTo(((i + 0.5) / count) * d);
        const c = cells.current[i];
        if (stopped || !c || !v.videoWidth) continue;
        // Fill the cell, cropping the middle of the frame (object-fit: cover, by hand).
        c.width = Math.max(40, c.clientWidth * 2);
        c.height = Math.max(40, c.clientHeight * 2);
        const scale = Math.max(c.width / v.videoWidth, c.height / v.videoHeight);
        const sw = c.width / scale;
        const sh = c.height / scale;
        try { c.getContext("2d")?.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, 0, 0, c.width, c.height); } catch { /* a frame it can't draw stays dark */ }
      }
    })();
    return () => { stopped = true; v.removeAttribute("src"); v.load(); };
  }, [src, d, count]);

  const timeAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.min(d, Math.max(0, ((clientX - r.left) / r.width) * d));
  };
  // The player follows the handle, a frame at a time.
  const show = (t: number) => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const v = videoRef.current;
      if (!v) return;
      if (!v.paused) v.pause();
      v.currentTime = t;
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
    } else {
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
  };
  const move = (ev: React.PointerEvent) => {
    if (!drag) return;
    const t = timeAt(ev.clientX);
    if (drag.kind === "start") apply("start", t, drag.e0);
    else if (drag.kind === "end") apply("end", drag.s0, t);
    else {
      const r = bar.current!.getBoundingClientRect();
      const dt = ((ev.clientX - drag.x0) / r.width) * d;
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

  const handle = "absolute inset-y-0 z-20 flex w-3.5 cursor-ew-resize touch-none items-center justify-center bg-[#F0A71F] outline-none focus-visible:ring-2 focus-visible:ring-[#053877] dark:focus-visible:ring-white";
  return (
    <div className="select-none" data-testid="trim-strip">
      <div
        ref={bar}
        onPointerDown={(ev) => { if (!drag) { const t = timeAt(ev.clientX); videoRef.current && (videoRef.current.currentTime = t); } }}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        className="relative h-14 cursor-pointer overflow-hidden rounded-lg bg-[#050d26]"
      >
        {/* The frames. */}
        <div className="absolute inset-0 flex">
          {Array.from({ length: count }, (_, i) => (
            <canvas key={`${count}-${i}`} ref={(c) => { cells.current[i] = c; }} className="h-full w-0 min-w-0 flex-1 border-r border-black/40" />
          ))}
        </div>
        {/* What's cut, dimmed. */}
        <div className="absolute inset-y-0 left-0 bg-black/60" style={{ width: at(start) }} />
        <div className="absolute inset-y-0 right-0 bg-black/60" style={{ left: at(end) }} />
        {/* What's kept: gold edges, drag the middle to slide it. */}
        <div
          onPointerDown={down("move")}
          className={`absolute inset-y-0 z-10 cursor-grab border-y-[3px] border-[#F0A71F] active:cursor-grabbing ${ghost ? "opacity-50" : ""}`}
          style={{ left: at(start), width: `calc(${at(end)} - ${at(start)})` }}
          aria-hidden
        />
        <div
          role="slider"
          tabIndex={0}
          aria-label="Start"
          aria-valuemin={0}
          aria-valuemax={Math.round(d)}
          aria-valuenow={Math.round(start)}
          aria-valuetext={hms(start)}
          onPointerDown={down("start")}
          onKeyDown={nudge("start")}
          className={`${handle} rounded-l-lg ${ghost ? "opacity-60" : ""}`}
          style={{ left: at(start) }}
          data-testid="trim-handle-start"
        >
          <span className="h-5 w-0.5 rounded bg-[#1a1200]/60" />
        </div>
        <div
          role="slider"
          tabIndex={0}
          aria-label="End"
          aria-valuemin={0}
          aria-valuemax={Math.round(d)}
          aria-valuenow={Math.round(end)}
          aria-valuetext={hms(end)}
          onPointerDown={down("end")}
          onKeyDown={nudge("end")}
          className={`${handle} rounded-r-lg ${ghost ? "opacity-60" : ""}`}
          style={{ left: `calc(${at(end)} - 0.875rem)` }}
          data-testid="trim-handle-end"
        >
          <span className="h-5 w-0.5 rounded bg-[#1a1200]/60" />
        </div>
        {/* Where the player is. */}
        <div className="pointer-events-none absolute -inset-y-px z-30 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" style={{ left: at(time) }} />
      </div>
      <div className="relative mt-1 h-4 text-[10px] tabular-nums text-muted-foreground">
        {d > 0 && start / d > 0.08 && <span className="absolute left-0">0:00</span>}
        <span className={`absolute rounded px-1 font-semibold ${start / (d || 1) < 0.05 ? "" : "-translate-x-1/2"} ${drag?.kind === "start" ? "bg-[#F0A71F] text-[#1a1200]" : "text-foreground"}`} style={{ left: at(start) }}>{hms(start)}</span>
        <span className={`absolute rounded px-1 font-semibold ${end / (d || 1) > 0.95 ? "-translate-x-full" : "-translate-x-1/2"} ${drag?.kind === "end" ? "bg-[#F0A71F] text-[#1a1200]" : "text-foreground"}`} style={{ left: at(end) }}>{hms(end)}</span>
        {d > 0 && end / d < 0.92 && <span className="absolute right-0">{hms(d)}</span>}
      </div>
    </div>
  );
}
