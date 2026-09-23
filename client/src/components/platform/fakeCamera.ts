import { useEffect, useState } from "react";
import type { Track } from "livekit-client";
import type { StageTile } from "@/components/StageView";

// A camera without a camera. The About page shows the real stage component,
// and the stage wants something it can attach to a <video>. A canvas drawing a
// still with a slow, uneven drift — the way a webcam on a desk is never quite
// still — and handed over as a MediaStream reads as live video at a glance.
//
// No permission prompt, no network, no LiveKit. Where a browser can't capture a
// canvas the hook returns null and the stage falls back to its camera-off card.

const W = 640;
const H = 360;

function seedOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1000) / 159;
}

export function useFakeCamera(src: string, fps = 12): Track | null {
  const [track, setTrack] = useState<Track | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    if (typeof canvas.captureStream !== "function") return;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.decoding = "async";
    img.src = src;

    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seed = seedOf(src);
    const t0 = performance.now();
    let raf = 0;
    let last = 0;
    let stopped = false;

    const draw = (now: number) => {
      if (stopped) return;
      raf = requestAnimationFrame(draw);
      if (now - last < 1000 / fps) return;
      if (!img.complete || !img.naturalWidth) return;
      last = now;
      const t = reduce ? 0 : (now - t0) / 1000;
      // A slow breathe in scale, a lazy sway, and a hair of hand-held jitter.
      const s = 1.07 + 0.015 * Math.sin(t * 0.31 + seed);
      const dx = Math.sin(t * 0.21 + seed) * 7 + Math.sin(t * 1.3 + seed * 2) * 0.5;
      const dy = Math.cos(t * 0.27 + seed) * 4 + Math.sin(t * 1.7 + seed) * 0.5;
      const w = W * s;
      const h = H * s;
      ctx.drawImage(img, (W - w) / 2 + dx, (H - h) / 2 + dy, w, h);
      // Webcams breathe in exposure too.
      const e = 0.035 + 0.025 * Math.sin(t * 0.9 + seed);
      ctx.fillStyle = `rgba(4,16,43,${e.toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    };

    const stream = canvas.captureStream(fps);
    raf = requestAnimationFrame(draw);

    const fake = {
      attach(el: HTMLMediaElement) {
        el.srcObject = stream;
        void el.play?.().catch(() => {});
        return el;
      },
      detach(el: HTMLMediaElement) {
        if (el.srcObject === stream) el.srcObject = null;
        return el;
      },
    };
    setTrack(fake as unknown as Track);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      setTrack(null);
    };
  }, [src, fps]);

  return track;
}

/** The cast of the illustrations: fictional people on stock photos, host included. */
export const CAST = {
  marcus: { name: "Marcus Hale", title: "Army veteran · The Long Watch", cam: "/platform/cam-marcus.jpg", face: "/platform/face-marcus.jpg" },
  dana: { name: "Dana Ortiz", title: "Navy spouse · Homefront Hour", cam: "/platform/cam-dana.jpg", face: "/platform/face-dana.jpg" },
  sofia: { name: "Sofia Reyes", title: "Host", cam: "/platform/cam-sofia.jpg", face: "/platform/face-sofia.jpg" },
  kim: { name: "Kim Rowe", title: "Air Force veteran · Squad Bay Radio", cam: "/platform/cam-kim.jpg", face: "/platform/face-kim.jpg" },
  andre: { name: "Andre Mills", title: "Marine veteran · After the Uniform", cam: "/platform/cam-andre.jpg", face: "/platform/face-andre.jpg" },
} as const;
export type CastKey = keyof typeof CAST;

/** A stage tile for one of the cast, fed by a fake camera (or their photo while it starts). */
export function castTile(key: CastKey, video: Track | null, speaking: boolean, host = false): StageTile {
  const p = CAST[key];
  return { identity: key, name: p.name, displayTitle: p.title, video, audio: null, speaking, photoUrl: p.face, host };
}

/** Cycles an index every `ms`, for whoever is talking or which layout is up. */
export function useTicker(count: number, ms: number): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (count < 2) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const t = setInterval(() => setI((v) => (v + 1) % count), ms);
    return () => clearInterval(t);
  }, [count, ms]);
  return i;
}
