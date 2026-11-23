/**
 * A still from a video, for its post's thumbnail.
 *
 * A whole episode opens on a black frame (the recording starts before the
 * picture does), and LinkedIn uses the first frame as the cover, so Frank's
 * talk went up as a black box (Andrew, 23 Nov: "Please ensure each video post
 * has a thumbnail"). This seeks to a moment a little way in, skips anything
 * dark, and hands back a 1280-wide JPEG. Never throws: null when the browser
 * can't read the frame (an unreachable file, a storage without CORS).
 */
export async function videoFrame(src: string, opts: { timeoutMs?: number; /** Which good moment to start from ("Another frame" steps on). */ start?: number; /** A clip: its titled opening frame first. */ clip?: boolean } = {}): Promise<Blob | null> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const done = (b: Blob | null) => {
    video.removeAttribute("src");
    video.load();
    return b;
  };
  const wait = (ev: string, ms: number) =>
    new Promise<boolean>((resolve) => {
      const t = setTimeout(() => { cleanup(); resolve(false); }, ms);
      const ok = () => { cleanup(); resolve(true); };
      const bad = () => { cleanup(); resolve(false); };
      const cleanup = () => { clearTimeout(t); video.removeEventListener(ev, ok); video.removeEventListener("error", bad); };
      video.addEventListener(ev, ok, { once: true });
      video.addEventListener("error", bad, { once: true });
    });
  try {
    const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
    video.src = src;
    if (!(await wait("loadedmetadata", 15_000))) return done(null);
    const d = Number.isFinite(video.duration) ? video.duration : 0;
    // The good moments: about two minutes in on an episode (well past any intro), a tenth of the way in on a short
    // video, then on through it. "Another frame" starts further along the list and wraps.
    const moments = goodMoments(d, opts.clip);
    const from = ((opts.start ?? 0) % moments.length + moments.length) % moments.length;
    const tries = [...moments.slice(from), ...moments.slice(0, from)];
    const w = Math.min(1280, video.videoWidth || 1280);
    const h = Math.round((w * (video.videoHeight || 720)) / (video.videoWidth || 1280));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return done(null);
    let fallback: Blob | null = null;
    for (const t of tries) {
      if (Date.now() > deadline) break;
      video.currentTime = t;
      if (!(await wait("seeked", Math.max(1000, deadline - Date.now())))) break;
      ctx.drawImage(video, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.86));
      if (!blob) return done(null);
      if (brightness(ctx, w, h) > 40) return done(blob);
      fallback = fallback ?? blob;
    }
    return done(fallback);
  } catch {
    // A tainted canvas (no CORS) throws on read: no thumbnail rather than a broken post.
    return done(null);
  }
}

/** Where to look in a video `d` seconds long, best first. */
export function goodMoments(d: number, clip = false): number[] {
  const at = clip ? [Math.min(0.6, d * 0.1), d * 0.25, d * 0.5, d * 0.75] : [Math.min(120, d * 0.1), d * 0.25, d * 0.4, d * 0.55, d * 0.7, d * 0.85, Math.min(2, d * 0.5)];
  return Array.from(new Set(at.map((t) => Math.max(0, Math.round(t * 10) / 10))));
}

/** Average brightness 0–255 over a coarse grid: black and near-black frames come out under ~25. */
function brightness(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const { data } = ctx.getImageData(0, 0, w, h);
  const step = Math.max(1, Math.floor((w * h) / 4000)) * 4;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += step) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    n++;
  }
  return n ? sum / n : 0;
}
