// Blur my background (Andrew, 27 Nov: "the background where it's kind of blurred? Is that a setting?"). LiveKit's own
// background processor, loaded only when someone turns it on. It works on the camera before it's sent, so the room, the
// recording and the live stream all get the blurred picture. The choice is kept on this computer, because whether a
// computer can keep up with it depends on the computer. If it can't keep up, the blur turns itself off and says so.
import { useEffect, useRef, useState } from "react";
import type { LocalVideoTrack } from "livekit-client";

const KEY = "mv-studio-blur";
export function readBlur(): boolean {
  try { return window.localStorage.getItem(KEY) === "1"; } catch { return false; }
}
export function saveBlur(on: boolean) {
  try { window.localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* private window: it still works for this visit */ }
}

export const BLUR_SLOW = "Blur is off. This computer couldn't keep up with it.";
export const BLUR_UNSUPPORTED = "This browser can't blur your background. Chrome, Edge or Safari can.";

/** `starting` while the model loads; `slow` and `unsupported` mean it's off and the note says why. */
export type BlurState = "off" | "starting" | "on" | "slow" | "unsupported";

const RADIUS = 14;
/** Frames to skip while it warms up, then the average over this many frames decides whether it keeps up. */
const WARM = 45, WINDOW = 60;
/** Over this many milliseconds a frame on average, the picture would stutter (it can't hold 24 frames a second). */
const SLOW_MS = 42;

/** The latest average frame time while blurring, for the CPU check. */
export const blurStats: { avgMs: number; frames: number } = { avgMs: 0, frames: 0 };

/**
 * Blurs `track`'s background while `on`. Calls `onSlow` once if this computer can't keep up, after taking the blur off.
 * The track keeps the blur through camera switches and turning the camera off and on (LiveKit restarts the processor).
 */
export function useBlur(track: LocalVideoTrack | null | undefined, on: boolean, onSlow?: () => void): BlurState {
  const [state, setState] = useState<BlurState>("off");
  const slow = useRef(onSlow);
  slow.current = onSlow;
  useEffect(() => {
    if (!on) {
      setState((s) => (s === "slow" || s === "unsupported" ? s : "off"));
      if (track?.getProcessor()) void track.stopProcessor().catch(() => {});
      return;
    }
    if (!track) { setState("starting"); return; }
    let stop = false;
    setState("starting");
    void (async () => {
      try {
        const m = await import("@livekit/track-processors");
        if (stop) return;
        if (!m.supportsBackgroundProcessors()) { setState("unsupported"); return; }
        if (track.getProcessor()) { setState("on"); return; }
        const times: number[] = [];
        let seen = 0, gaveUp = false;
        const p = m.BackgroundProcessor({
          mode: "background-blur",
          blurRadius: RADIUS,
          onFrameProcessed: ({ processingTimeMs }) => {
            if (gaveUp || ++seen <= WARM) return;
            times.push(processingTimeMs);
            if (times.length > WINDOW) times.shift();
            blurStats.avgMs = times.reduce((a, b) => a + b, 0) / times.length;
            blurStats.frames = seen;
            if (times.length === WINDOW && blurStats.avgMs > SLOW_MS) {
              gaveUp = true;
              void track.stopProcessor().catch(() => {});
              setState("slow");
              slow.current?.();
            }
          },
        });
        await track.setProcessor(p);
        if (stop) { await track.stopProcessor().catch(() => {}); return; }
        setState("on");
      } catch {
        if (!stop) setState("unsupported");
      }
    })();
    return () => { stop = true; };
  }, [track, on]);
  return state;
}
