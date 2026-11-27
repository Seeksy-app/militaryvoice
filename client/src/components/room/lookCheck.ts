// "Look your best" on the studio entry screen (Andrew, 24 Nov, from the mockup; honest framing 27 Nov). It works in the
// browser and sends nothing anywhere. A short scan runs first. Then it gives one plain tip at a time, or "You look great"
// when none apply. It's only a suggestion and never stops anyone going in. Face detection is MediaPipe's short-range face
// detector, loaded only here. If that can't load, the entry screen just shows the framing guide.
import { useEffect, useRef, useState } from "react";
import type { FaceDetector } from "@mediapipe/tasks-vision";

const VERSION = "1.1.1"; // keep in step with package.json
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

/** In the order they're given: only the first that applies shows. */
export type LookTip = "face" | "back" | "closer" | "top" | "raise" | "right" | "left" | "light";
export const TIP_TEXT: Record<LookTip, string> = {
  face: "Face the camera and move a little closer.",
  back: "Sit back a little. That leaves room above your head.",
  closer: "Move a little closer.",
  top: "Tilt your camera up a little. Your head is near the top.",
  raise: "Raise your camera to eye level. You're low in the frame.",
  right: "Move a little to your right.",
  left: "Move a little to your left.",
  light: "A light in front of you would help. Your face is darker than the background.",
};
/** `scanning`: the scan is running. `ok`: `tip` is the one tip, or null when they look great. */
export type LookState = { status: "off" | "scanning" | "ok"; tip: LookTip | null };

/** How long the scan runs before the verdict shows (Andrew, 27 Nov: "a little scanning animation for 3 seconds"). */
export const SCAN_MS = 3000;
/** The longest the scan waits for the face detector to load before giving up quietly. */
const SCAN_MAX_MS = 9000;

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

/**
 * Where the head sits, as shares of the frame (0 at the top). The detector's box runs from the brow to the chin, and the
 * eyes sit about halfway down a head, so the top of the head is about as far above the eyes as the chin is below them.
 * Calibrated on Andrew's own camera check (27 Nov): sitting close, his head came to three quarters of the frame's height,
 * so no line could give him both headroom and eyes a third of the way down.
 */
export type Head = { top: number; eyes: number; chin: number; height: number; x: number };
export function headFrom(eyeY: number, chinY: number, centerX: number): Head {
  const half = Math.max(0, chinY - eyeY);
  return { top: eyeY - half, eyes: eyeY, chin: chinY, height: 2 * half, x: centerX };
}

/** The one tip for this picture (Andrew, 27 Nov: honest framing, one plain tip at a time), or null when it's good. */
export function tipFor(h: Head, lum: { face: number; back: number } | null): LookTip | null {
  if (h.height > 0.62) return "back"; // too close: no room above the head with the eyes in the top third
  if (h.height < 0.3) return "closer";
  if (h.top < 0.04) return "top";
  if (h.eyes > 0.46) return "raise";
  // The preview is a mirror, so the side they see themselves on is the side they're on.
  if (h.x < 0.36) return "right";
  if (h.x > 0.64) return "left";
  if (lum && (lum.face < 60 || lum.face < lum.back * 0.6)) return "light";
  return null;
}

/** One look at the frame: the tip that applies now ("face" when there's no face), and the head as the preview shows it. */
export function readLook(d: FaceDetector, v: HTMLVideoElement, canvas: HTMLCanvasElement): { tip: LookTip | null; head: Head | null } {
  const f = d.detectForVideo(v, performance.now()).detections[0];
  const bb = f?.boundingBox;
  if (!f || !bb) return { tip: "face", head: null };
  const box = { x: bb.originX / v.videoWidth, y: bb.originY / v.videoHeight, w: bb.width / v.videoWidth, h: bb.height / v.videoHeight };
  const eyes = f.keypoints.slice(0, 2);
  const eyeY = eyes.length === 2 ? (eyes[0].y + eyes[1].y) / 2 : box.y + box.h * 0.27;
  // Mirrored, like the preview.
  const head = headFrom(eyeY, box.y + box.h, 1 - (box.x + box.w / 2));
  return { tip: tipFor(head, light(v, canvas, box)), head };
}

/**
 * Scans the preview while `on`, again each time `scanKey` changes (a new camera), then checks it about once a second.
 * A new tip shows once it holds for two checks in a row, so it doesn't flicker while they move.
 */
export function useLookCheck(video: React.RefObject<HTMLVideoElement | null>, on: boolean, scanKey = ""): LookState {
  const [state, setState] = useState<LookState>({ status: "off", tip: null });
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!on) { setState({ status: "off", tip: null }); return; }
    let stop = false, timer = 0;
    const started = performance.now();
    let read = false, shown: LookTip | null = null, last: LookTip | null | undefined;
    setState({ status: "scanning", tip: null });
    canvas.current ??= document.createElement("canvas");
    const giveUp = window.setTimeout(() => { if (!stop && !read) { stop = true; setState({ status: "off", tip: null }); } }, SCAN_MAX_MS);
    loadDetector().then((d) => {
      const check = () => {
        if (stop) return;
        const v = video.current;
        if (v && v.readyState >= 2 && v.videoWidth) {
          try {
            const now = readLook(d, v, canvas.current!).tip;
            if (!read) { shown = now; read = true; } // the scan's own reading
            else if (now === last && now !== shown) shown = now;
            last = now;
          } catch { /* a frame it couldn't read; try the next one */ }
        }
        const scanning = performance.now() - started < SCAN_MS || !read;
        setState(scanning ? { status: "scanning", tip: null } : { status: "ok", tip: shown });
        timer = window.setTimeout(check, scanning ? 300 : 900);
      };
      check();
    }).catch(() => { if (!stop) setState({ status: "off", tip: null }); });
    return () => { stop = true; clearTimeout(timer); clearTimeout(giveUp); };
  }, [on, video, scanKey]);
  return state;
}
