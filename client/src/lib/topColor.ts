import { useEffect, useState } from "react";
import type { BioPublic } from "@shared/bio";

/** The photo at the very top of a full-bleed page (Full bleed, Poster): where it is, and the box it fills at phone width. Null when the top isn't a photo. */
export function topPhotoOf(d: Pick<BioPublic, "avatarUrl" | "heroUrl" | "theme">): { src: string; y: number; w: number; h: number } | null {
  const t = d.theme;
  const src = t.topPhoto === "profile" ? d.avatarUrl || d.heroUrl : d.heroUrl || d.avatarUrl;
  if (!src) return null;
  const y = Number.isFinite(t.imageY) ? t.imageY : 50;
  if (t.layout === "blend") return { src, y, w: 402, h: 440 };
  if (t.layout === "hero") return { src, y, w: 402, h: 600 };
  return null;
}

/**
 * The colour along the top edge of that photo, as it's cropped on a phone: what the browser's bar should be tinted
 * (theme-color), so the photo runs on into it instead of stopping at a band. Null while loading, or if the picture can't be read.
 */
export function useTopColor(top: ReturnType<typeof topPhotoOf>): string | null {
  const [color, setColor] = useState<string | null>(null);
  const src = top?.src ?? "";
  const y = top?.y ?? 50, w = top?.w ?? 0, h = top?.h ?? 0;
  useEffect(() => {
    setColor(null);
    if (!src) return;
    let dead = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const nw = img.naturalWidth, nh = img.naturalHeight;
        if (!nw || !nh) return;
        // "cover": the photo scaled to fill the box; the part shown starts a share (y%) of the overflow down.
        const scale = Math.max(w / nw, h / nh);
        const row = Math.max(0, ((nh * scale - h) * (y / 100)) / scale);
        const strip = Math.max(2, Math.round(nh * 0.015));
        const c = document.createElement("canvas");
        c.width = 24; c.height = 2;
        const g = c.getContext("2d");
        if (!g) return;
        g.drawImage(img, 0, Math.min(row, nh - strip), nw, strip, 0, 0, 24, 2);
        const d = g.getImageData(0, 0, 24, 2).data;
        let r = 0, gr = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; n++; }
        if (!dead && n) setColor(`#${[r, gr, b].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("")}`);
      } catch { /* a picture we can't read: the bar keeps the page's own colour */ }
    };
    img.src = src;
    return () => { dead = true; };
  }, [src, y, w, h]);
  return color;
}
