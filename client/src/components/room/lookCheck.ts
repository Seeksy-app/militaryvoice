// "Look your best" on the studio entry screen (Andrew, 24 Nov, from the mockup): up to three plain tips about the
// camera picture, worked out in the browser (nothing is sent anywhere), and "You look great" when none apply. Only
// a suggestion: it never stops anyone going in. Face detection is MediaPipe's short-range face detector, loaded
// only here; if it can't load, the entry screen just shows the framing guide.
import { useEffect, useRef, useState } from "react";
import type { FaceDetector } from "@mediapipe/tasks-vision";

const VERSION = "1.1.1"; // keep in step with package.json
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

export type LookTip = "raise" | "lower" | "light" | "closer" | "face";
export const TIP_TEXT: Record<LookTip, string> = {
  raise: "Raise your camera to eye level. You're low in the frame.",
  lower: "Lower your camera a little. Your head is near the top.",
  light: "A light in front of you would help. Your face is darker than the background.",
  closer: "Move a little closer.",
  face: "Face the camera and move a little closer.",
};
export type LookState = { status: "off" | "loading" | "noface" | "ok"; tips: LookTip[] };

let detector: Promise<FaceDetector> | null = null;
export function loadDetector(): Promise<FaceDetector> {
  detector ??= (async () => {
    const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const files = await FilesetResolver.forVisionTasks(WASM);
    return FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate: "CPU" }, runningMode: "VIDEO", minDetectionConfidence: 0.5 });
  })();
  detector.catch(() => { detector = null; });
  return detector;
}

/** Average brightness (0–255) of a small copy of the frame, inside and outside the face box. */
function light(video: HTMLVideoElement, canvas: HTMLCanvasElement, box: { x: number; y: number; w: number; h: number }) {
  const W = 64, H = 36;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  let fin = 0, nin = 0, fout = 0, nout = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    const u = x / W, v = y / H;
    if (u >= box.x && u <= box.x + box.w && v >= box.y && v <= box.y + box.h) { fin += l; nin++; } else { fout += l; nout++; }
  }
  return nin && nout ? { face: fin / nin, back: fout / nout } : null;
}

/** The tips for one look at the picture (positions are shares of the frame, 0 at the top). */
// Tuned on test clips (24 Nov): a usual head-and-shoulders shot has the face box about a quarter of the frame's height;
// a face under a sixth of it reads as far away. Backlit means the face well under the room's brightness, not a shade off.
function tipsFor(eyeY: number, faceH: number, lum: { face: number; back: number } | null): LookTip[] {
  const out: LookTip[] = [];
  if (eyeY > 0.45) out.push("raise");
  else if (eyeY < 0.2) out.push("lower");
  if (lum && (lum.face < 60 || lum.face < lum.back * 0.6)) out.push("light");
  if (faceH < 0.17) out.push("closer");
  return out.slice(0, 3);
}

/** One look at the frame: the tips that apply now, or null when there's no face in it. */
export function readLook(d: FaceDetector, v: HTMLVideoElement, canvas: HTMLCanvasElement): LookTip[] | null {
  const f = d.detectForVideo(v, performance.now()).detections[0];
  const bb = f?.boundingBox;
  if (!f || !bb) return null;
  const eyes = f.keypoints.slice(0, 2);
  const eyeY = eyes.length === 2 ? (eyes[0].y + eyes[1].y) / 2 : (bb.originY + bb.height * 0.4) / v.videoHeight;
  const box = { x: bb.originX / v.videoWidth, y: bb.originY / v.videoHeight, w: bb.width / v.videoWidth, h: bb.height / v.videoHeight };
  return tipsFor(eyeY, box.h, light(v, canvas, box));
}

/**
 * Checks the preview about once a second while `on`. A tip shows once it holds for two checks in a row and goes once
 * it's gone for two, so it doesn't flicker while they move.
 */
export function useLookCheck(video: React.RefObject<HTMLVideoElement | null>, on: boolean): LookState {
  const [state, setState] = useState<LookState>({ status: "off", tips: [] });
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!on) { setState({ status: "off", tips: [] }); return; }
    let stop = false, timer = 0, misses = 0;
    let last: LookTip[] = [], shown: LookTip[] = [];
    setState({ status: "loading", tips: [] });
    canvas.current ??= document.createElement("canvas");
    loadDetector().then((d) => {
      const check = () => {
        if (stop) return;
        const v = video.current;
        if (v && v.readyState >= 2 && v.videoWidth) {
          try {
            const now = readLook(d, v, canvas.current!);
            if (!now) {
              // No face found (too far, turned away, very dark): one gentle tip.
              if (++misses >= 2) { shown = []; last = []; setState({ status: "ok", tips: ["face"] }); }
            } else {
              misses = 0;
              // A tip shows after two checks in a row, and goes after two without it.
              shown = [...shown.filter((t) => now.includes(t) || last.includes(t)), ...now.filter((t) => last.includes(t) && !shown.includes(t))].slice(0, 3);
              last = now;
              setState({ status: "ok", tips: shown });
            }
          } catch { /* a frame it couldn't read; try the next one */ }
        }
        timer = window.setTimeout(check, 900);
      };
      check();
    }).catch(() => { if (!stop) setState({ status: "off", tips: [] }); });
    return () => { stop = true; clearTimeout(timer); };
  }, [on, video]);
  return state;
}
