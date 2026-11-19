// Two people on screen, from one frame (19 Nov 2026). Conservative on purpose: "ok" only for exactly two equal panels
// side by side with a thin dark divider between them and a live picture in each. Anything else (one person, three or
// more panels, a shared screen, a dark room) is "not sure", and the worker suggests nothing.
// Pure functions on a grey frame, so they can be tested without a video.

export type FrameAnalysis =
  | { ok: true; left: number; right: number; top: number; bottom: number; divider: number }
  | { ok: false; why: string };

const DARK = 28; // a divider or border pixel, on 0..255
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export function analyzeFrame(gray: Uint8Array, w: number, h: number): FrameAnalysis {
  const px = (x: number, y: number) => gray[y * w + x];
  // The real picture: rows and columns that aren't a black border.
  const rowMean = Array.from({ length: h }, (_, y) => mean(Array.from({ length: w }, (_, x) => px(x, y))));
  let top = 0, bottom = h - 1;
  while (top < h && rowMean[top] < 10) top++;
  while (bottom > top && rowMean[bottom] < 10) bottom--;
  if (bottom - top < h * 0.4) return { ok: false, why: "no picture" };
  const colMean = Array.from({ length: w }, (_, x) => mean(Array.from({ length: bottom - top + 1 }, (_, i) => px(x, top + i))));
  let left = 0, right = w - 1;
  while (left < w && colMean[left] < 10) left++;
  while (right > left && colMean[right] < 10) right--;
  const cw = right - left + 1, ch = bottom - top + 1;
  if (cw < w * 0.6) return { ok: false, why: "narrow picture" };

  // How much of each column is dark, across the picture's height.
  const darkFrac = Array.from({ length: w }, (_, x) => {
    let n = 0;
    for (let y = top; y <= bottom; y++) if (px(x, y) < DARK) n++;
    return n / ch;
  });
  const isLine = (x: number) => darkFrac[x] >= 0.92 && (x - 6 < left || darkFrac[x - 6] < 0.4) && (x + 6 > right || darkFrac[x + 6] < 0.4);

  // One divider, near the middle.
  const lo = Math.floor(left + cw * 0.42), hi = Math.ceil(left + cw * 0.58);
  const mids: number[] = [];
  for (let x = lo; x <= hi; x++) if (isLine(x)) mids.push(x);
  if (!mids.length) return { ok: false, why: "no divider in the middle" };
  const divider = Math.round(mean(mids));

  // No other divider anywhere: that would be three or more panels.
  for (let x = left + Math.ceil(cw * 0.04); x <= right - Math.ceil(cw * 0.04); x++) {
    if (Math.abs(x - divider) > Math.max(8, cw * 0.03) && isLine(x)) return { ok: false, why: "more than two panels" };
  }

  // A live picture on each side: not flat, not black.
  const alive = (x0: number, x1: number) => {
    const vals: number[] = [];
    for (let y = top; y <= bottom; y += 3) for (let x = x0; x <= x1; x += 3) vals.push(px(x, y));
    const m = mean(vals);
    const sd = Math.sqrt(mean(vals.map((v) => (v - m) ** 2)));
    return m > 35 && sd > 18;
  };
  if (!alive(left + 4, divider - 6) || !alive(divider + 6, right - 4)) return { ok: false, why: "a panel is dark or flat" };

  // The panels are about the same size.
  const lw = divider - left, rw = right - divider;
  if (Math.min(lw, rw) / Math.max(lw, rw) < 0.82) return { ok: false, why: "panels are unequal" };
  return { ok: true, left, right, top, bottom, divider };
}
