import { useEffect, useRef, useState } from "react";
import type { RoomLive, RoomLook, RoomScene } from "@shared/roomLook";

/** A media scene's video (not a picture), or "". */
const videoOf = (s?: RoomScene | null): string =>
  s?.type === "media" && s.media?.url && !(s.media.mime ?? "").startsWith("image") ? s.media.url : "";

/** Longest the stage waits for a clip's first frame before switching anyway. */
const HOLD_MS = 3000;

/**
 * The scene to draw: the one on air, except that a switch to a video scene waits (up to 3 s) until the clip's
 * first frame is ready, so the stage goes straight from the scene before it to the clip with no black between
 * them (PM, 24 Nov: Riccoh's recording 474 had 2 s of black before his clip).
 *
 * Every media scene's clip in the look is loaded ahead in a hidden, muted <video>, so the stage's own copy finds it in
 * the browser's cache and the wait is usually nothing. A clip added just now waits for its load.
 */
export function useReadyScene(look: RoomLook | null, live: RoomLive): string | null | undefined {
  const els = useRef(new Map<string, HTMLVideoElement>());
  const [ready, setReady] = useState<ReadonlySet<string>>(() => new Set());
  const urls = look ? Array.from(new Set(look.scenes.map(videoOf).filter(Boolean))).slice(0, 6) : [];
  const key = urls.join("|");

  useEffect(() => {
    const m = els.current;
    for (const [u, v] of Array.from(m)) if (!urls.includes(u)) { v.removeAttribute("src"); v.load(); m.delete(u); }
    for (const u of urls) {
      if (m.has(u)) continue;
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      const done = () => setReady((r) => (r.has(u) ? r : new Set(r).add(u)));
      v.addEventListener("loadeddata", done, { once: true });
      v.addEventListener("error", done, { once: true });
      v.src = u;
      m.set(u, v);
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { for (const v of Array.from(els.current.values())) { v.removeAttribute("src"); v.load(); } els.current.clear(); }, []);

  const want = live.activeScene ?? null;
  const [shown, setShown] = useState<string | null>(want);
  const url = videoOf(look?.scenes.find((s) => s.id === want));
  const ok = !url || ready.has(url);
  useEffect(() => {
    if (ok) { setShown(want); return; }
    const t = window.setTimeout(() => setShown(want), HOLD_MS);
    return () => window.clearTimeout(t);
  }, [want, ok]);
  return ok ? want : shown;
}
