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

// ── Our own studio's picture (24 Nov 2026, Riccoh's recording 474) ──
// A MilitaryVoices studio room records two framed tiles on a flat background (the room's colour), each with the person's
// name card in its lower corner. analyzeFrame looks for two panels filling the frame with a dark divider, so it never saw
// these, and the vertical clips cropped to one face. findTiles finds the two tiles themselves, whole, name cards included.
export type Tile = { x: number; y: number; w: number; h: number };
export type TileAnalysis = { ok: true; left: Tile; right: Tile } | { ok: false; why: string };

/** Two framed tiles side by side on a flat background, from one RGB frame (3 bytes a pixel). Boxes are in frame pixels. */
export function findTiles(rgb: Uint8Array, w: number, h: number): TileAnalysis {
  const at = (x: number, y: number) => (y * w + x) * 3;
  // The background: the top band of the frame, which must be one flat colour.
  const top: number[][] = [[], [], []];
  for (let y = 0; y < Math.max(2, Math.round(h * 0.05)); y++) for (let x = 0; x < w; x += 2) for (let c = 0; c < 3; c++) top[c].push(rgb[at(x, y) + c]);
  const bg = top.map((v) => mean(v));
  const flat = top.every((v, c) => Math.sqrt(mean(v.map((p) => (p - bg[c]) ** 2))) < 10);
  if (!flat) return { ok: false, why: "no flat background" };
  const off = (x: number, y: number) => { const i = at(x, y); return Math.max(Math.abs(rgb[i] - bg[0]), Math.abs(rgb[i + 1] - bg[1]), Math.abs(rgb[i + 2] - bg[2])) > 24; };
  // Columns that are picture across the middle of the frame.
  const y0 = Math.round(h * 0.42), y1 = Math.round(h * 0.58);
  const isPic = Array.from({ length: w }, (_, x) => { let n = 0; for (let y = y0; y <= y1; y++) if (off(x, y)) n++; return n / (y1 - y0 + 1) >= 0.9; });
  const runs: [number, number][] = [];
  for (let x = 0; x < w; x++) {
    if (!isPic[x]) continue;
    const last = runs[runs.length - 1];
    if (last && x - last[1] <= 2) last[1] = x; else runs.push([x, x]);
  }
  const wide = runs.filter(([a, b]) => b - a + 1 >= w * 0.2);
  if (wide.length !== 2) return { ok: false, why: `${wide.length} tiles across the middle` };
  const [[la, lb], [ra, rb]] = wide;
  const lw = lb - la + 1, rw = rb - ra + 1;
  if (Math.min(lw, rw) / Math.max(lw, rw) < 0.82) return { ok: false, why: "tiles are unequal" };
  if (ra - lb > w * 0.12) return { ok: false, why: "tiles too far apart" };
  // Each tile's height: the rows (around the middle) where nearly all of its inner columns are picture.
  const rowsOf = (a: number, b: number): [number, number] | null => {
    const ia = a + Math.round((b - a) * 0.1), ib = b - Math.round((b - a) * 0.1);
    const full = (y: number) => { let n = 0, t = 0; for (let x = ia; x <= ib; x += 2) { t++; if (off(x, y)) n++; } return n / t >= 0.9; };
    const mid = Math.round(h / 2);
    if (!full(mid)) return null;
    let t = mid, bt = mid;
    while (t > 0 && full(t - 1)) t--;
    while (bt < h - 1 && full(bt + 1)) bt++;
    return bt - t + 1 >= h * 0.25 ? [t, bt] : null;
  };
  const lr = rowsOf(la, lb), rr = rowsOf(ra, rb);
  if (!lr || !rr) return { ok: false, why: "a tile has no height" };
  // Both people there: a live picture in each tile, not a flat card.
  const alive = (a: number, b: number, [t, bt]: [number, number]) => {
    const v: number[] = [];
    for (let y = t; y <= bt; y += 3) for (let x = a; x <= b; x += 3) { const i = at(x, y); v.push(0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2]); }
    const m = mean(v);
    return Math.sqrt(mean(v.map((p) => (p - m) ** 2))) > 18;
  };
  if (!alive(la, lb, lr) || !alive(ra, rb, rr)) return { ok: false, why: "a tile is flat" };
  return { ok: true, left: { x: la, y: lr[0], w: lw, h: lr[1] - lr[0] + 1 }, right: { x: ra, y: rr[0], w: rw, h: rr[1] - rr[0] + 1 } };
}
