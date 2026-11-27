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
export const BLUR_FAILED = "Blur couldn't start, so your camera is on without it.";
const NOTE = { slow: BLUR_SLOW, unsupported: BLUR_UNSUPPORTED, failed: BLUR_FAILED } as const;
export type BlurProblem = keyof typeof NOTE;
export const blurNote = (s: BlurState) => (s in NOTE ? NOTE[s as BlurProblem] : "");

/** Blur starts off for everyone (PM, 27 Nov). `starting` while the model loads. `slow`, `unsupported` and `failed` mean
 *  it's off, the plain camera is back, and the note says why. */
export type BlurState = "off" | "starting" | "on" | BlurProblem;

const RADIUS = 14;
/** Frames to skip while it warms up, then the average over this many frames decides whether it keeps up. */
const WARM = 45, WINDOW = 60;
/** Over this many milliseconds a frame on average, the picture would stutter (it can't hold 24 frames a second). */
const SLOW_MS = 42;
/** With the camera on and the tab in view, no blurred frame for this long means it has stalled. */
const STALL_MS = 5000;

/** The latest average frame time while blurring, for the CPU check. */
export const blurStats: { avgMs: number; frames: number } = { avgMs: 0, frames: 0 };

/**
 * Blurs `track`'s background while `on`. The camera is always sent plain first, and the blur goes on after. If the blur
 * can't start, stalls, or can't keep up, it comes off again so the plain camera carries on (PM, 27 Nov: a guest must
 * never be left with no camera), and `onOff` is called once with the reason. The track keeps the blur through camera
 * switches and turning the camera off and on (LiveKit restarts the processor).
 */
export function useBlur(track: LocalVideoTrack | null | undefined, on: boolean, onOff?: (why: BlurProblem) => void): BlurState {
  const [state, setState] = useState<BlurState>("off");
  const off = useRef(onOff);
  off.current = onOff;
  useEffect(() => {
    if (!on) {
      setState((s) => (s in NOTE ? s : "off"));
      if (track?.getProcessor()) void track.stopProcessor().catch(() => {});
      return;
    }
    if (!track) { setState("starting"); return; }
    let stop = false, done = false, watch = 0;
    // Back to the plain camera, once, with the reason.
    const fallBack = (why: BlurProblem) => {
      if (done || stop) return;
      done = true;
      window.clearInterval(watch);
      void track.stopProcessor().catch(() => {});
      setState(why);
      off.current?.(why);
    };
    setState("starting");
    void (async () => {
      try {
        const m = await import("@livekit/track-processors");
        if (stop) return;
        if (!m.supportsBackgroundProcessors()) { fallBack("unsupported"); return; }
        if (track.getProcessor()) { setState("on"); return; }
        const times: number[] = [];
        let seen = 0, last = performance.now();
        const p = m.BackgroundProcessor({
          mode: "background-blur",
          blurRadius: RADIUS,
          onFrameProcessed: ({ processingTimeMs }) => {
            last = performance.now();
            if (done || ++seen <= WARM) return;
            times.push(processingTimeMs);
            if (times.length > WINDOW) times.shift();
            blurStats.avgMs = times.reduce((a, b) => a + b, 0) / times.length;
            blurStats.frames = seen;
            if (times.length === WINDOW && blurStats.avgMs > SLOW_MS) fallBack("slow");
          },
        });
        await track.setProcessor(p);
        if (stop) { await track.stopProcessor().catch(() => {}); return; }
        setState("on");
        // A blur that stops making frames would freeze the picture: take it off. A camera that's off, or a tab out of
        // view (Chrome holds its frames back), isn't a stall.
        last = performance.now();
        watch = window.setInterval(() => {
          if (track.isMuted || document.visibilityState !== "visible") { last = performance.now(); return; }
          if (performance.now() - last > STALL_MS) fallBack("failed");
        }, 1000);
      } catch {
        fallBack("failed");
      }
    })();
    return () => { stop = true; window.clearInterval(watch); };
  }, [track, on]);
  return state;
}
