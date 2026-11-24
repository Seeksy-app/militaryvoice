import { useEffect, useState } from "react";
import type { Asset } from "./look";

/**
 * A picture for a media scene's card and the "What does this scene show?" list (Andrew, 24 Nov: "we
 * need to be able to see the video thumbnail in the scene"). A picture is itself; a video's is a
 * frame grabbed here, about 1 s in, from its own address (same-origin, then R2, which sends CORS for
 * the site, so the canvas can be read). No server poster is needed. Kept in this browser by asset id
 * (a small JPEG), so each clip is grabbed once.
 */
export type Thumb = { src: string; sec?: number } | null;

const KEY = (id: string) => `mv-thumb:${id}`;
const memory = new Map<string, Thumb>();
const waiting = new Map<string, Promise<Thumb>>();
let running = 0;
const queue: (() => void)[] = [];
const slot = () => new Promise<void>((go) => { if (running < 2) { running++; go(); } else queue.push(() => { running++; go(); }); });
const done = () => { running--; queue.shift()?.(); };

function stored(id: string): Thumb | undefined {
  if (memory.has(id)) return memory.get(id);
  try { const v = window.localStorage.getItem(KEY(id)); if (v) { const t = JSON.parse(v) as Thumb; memory.set(id, t); return t; } } catch { /* no storage */ }
  return undefined;
}
function keep(id: string, t: Thumb) {
  memory.set(id, t);
  if (t) try { window.localStorage.setItem(KEY(id), JSON.stringify(t)); } catch { /* full or private: memory only */ }
}

/** One frame of a video, 192×108, as a JPEG data URL; null when the file won't give one. */
function grab(url: string): Promise<Thumb> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    let settled = false;
    const finish = (t: Thumb) => { if (settled) return; settled = true; window.clearTimeout(timer); v.removeAttribute("src"); v.load(); resolve(t); };
    const timer = window.setTimeout(() => finish(null), 15_000);
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.addEventListener("loadedmetadata", () => { v.currentTime = Math.min(1, (v.duration || 2) / 2); });
    v.addEventListener("seeked", () => {
      try {
        const c = document.createElement("canvas");
        c.width = 192; c.height = 108;
        const g = c.getContext("2d")!;
        g.fillStyle = "#000"; g.fillRect(0, 0, 192, 108);
        // Contain: the whole frame, letterboxed, as the stage shows it.
        const r = Math.min(192 / (v.videoWidth || 192), 108 / (v.videoHeight || 108));
        const w = (v.videoWidth || 192) * r, h = (v.videoHeight || 108) * r;
        g.drawImage(v, (192 - w) / 2, (108 - h) / 2, w, h);
        finish({ src: c.toDataURL("image/jpeg", 0.72), sec: Number.isFinite(v.duration) ? Math.round(v.duration) : undefined });
      } catch { finish(null); }
    }, { once: true });
    v.addEventListener("error", () => finish(null));
    v.src = url;
  });
}

export const isVideo = (a?: Asset | null) => !!a && ((a.mime ?? "").startsWith("video") || a.kind === "video" || a.kind === "intro" || a.kind === "outro");
export const mmss = (sec?: number) => (sec ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}` : "");

export function thumbOf(a: Asset): Promise<Thumb> {
  if (!isVideo(a)) return Promise.resolve({ src: a.url });
  const have = stored(a.id);
  if (have !== undefined) return Promise.resolve(have);
  let p = waiting.get(a.id);
  if (!p) {
    p = slot().then(() => grab(a.url)).then((t) => { done(); keep(a.id, t); waiting.delete(a.id); return t; });
    waiting.set(a.id, p);
  }
  return p;
}

/** The asset's picture (a video's first-second frame), and its length for a video. */
export function useThumb(a: Asset | null | undefined): Thumb {
  const [t, setT] = useState<Thumb>(() => (!a ? null : !isVideo(a) ? { src: a.url } : stored(a.id) ?? null));
  useEffect(() => {
    if (!a) { setT(null); return; }
    let alive = true;
    void thumbOf(a).then((x) => { if (alive) setT(x); });
    return () => { alive = false; };
  }, [a?.id, a?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  return t;
}
