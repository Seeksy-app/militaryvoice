import { useEffect, useState } from "react";
import { Check, Copy, Download, Loader2 } from "lucide-react";

// A booking's share kit for the Digital Experience: their link (the schedule
// opened on their show), ready-made graphics with their photo and time, a
// caption to paste, and one-click posts. The graphics are drawn here in the
// browser (canvas), in the week's look (client/public/dx), so there's nothing
// to render on the server and nothing to wait for.

export type DxShareBooking = { id: number; show: string; host: string; photo: string; startAtUtc: string; endAtUtc: string };

const ET = "America/New_York";
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: ET, weekday: "long", month: "long", day: "numeric" });

export const dxShareUrl = (id: number) => `${window.location.origin}/digital-experience?show=${id}`;
export const dxCaption = (b: DxShareBooking) =>
  `I'm going live on the MilitaryVoices Digital Experience: ${b.show}, ${day(b.startAtUtc)} at ${time(b.startAtUtc)} ET. A live channel of military and veteran voices. Tune in: ${dxShareUrl(b.id)}`;

function loadImage(src: string, cors = true): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    if (cors) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Wrap text to a width, at most `lines` lines (the last one ellipsed). */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, lines: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= width) { line = test; continue; }
    if (line) out.push(line);
    line = w;
    if (out.length === lines) break;
  }
  if (out.length < lines && line) out.push(line);
  if (out.length === lines && words.join(" ") !== out.join(" ")) {
    let last = out[lines - 1];
    while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    out[lines - 1] = `${last.trimEnd()}…`;
  }
  return out;
}

/** One graphic: square (posts) or tall (stories). */
async function draw(b: DxShareBooking, shape: "square" | "story"): Promise<string> {
  await document.fonts.load("900 80px Inter").catch(() => {});
  const W = 1080, H = shape === "square" ? 1080 : 1920;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(W * 0.75, H * 0.35, 40, W * 0.6, H * 0.45, H * 0.9);
  g.addColorStop(0, "#0d3a8a"); g.addColorStop(0.45, "#05175a"); g.addColorStop(1, "#000741");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // Broadcast rings behind the photo.
  const cy = shape === "square" ? 535 : 900, cx = W / 2, r = shape === "square" ? 160 : 250;
  [1.35, 1.7, 2.05, 2.4].forEach((k, i) => { x.beginPath(); x.arc(cx, cy, r * k, 0, Math.PI * 2); x.strokeStyle = `rgba(240,167,31,${0.7 - i * 0.16})`; x.lineWidth = 4; x.stroke(); });
  const font = (w: number, s: number) => `${w} ${s}px Inter, Arial, sans-serif`;
  // Brand line and LIVE pill.
  const logo = await loadImage("/logo-wave.png", false);
  if (logo) x.drawImage(logo, 70, 70, 120, 120 * (logo.height / logo.width));
  x.fillStyle = "#fff"; x.font = font(800, 30); x.fillText("MILITARYVOICES", 210, 112);
  x.fillStyle = "#ED1C24"; x.beginPath(); x.roundRect(W - 230, 70, 160, 60, 30); x.fill();
  x.fillStyle = "#fff"; x.font = font(900, 28); x.fillText("● LIVE", W - 205, 111);
  // Headline.
  x.textAlign = "center";
  x.fillStyle = "#fff"; x.font = font(900, shape === "square" ? 64 : 80);
  x.fillText("I'm going live on the", cx, shape === "square" ? 235 : 360);
  x.fillStyle = "#F0A71F"; x.font = font(900, shape === "square" ? 70 : 88);
  x.fillText("Digital Experience", cx, shape === "square" ? 312 : 460);
  // Photo in a gold ring.
  const photo = await loadImage(b.photo);
  x.save(); x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.closePath(); x.clip();
  if (photo) {
    const s = Math.max((2 * r) / photo.width, (2 * r) / photo.height);
    x.drawImage(photo, cx - (photo.width * s) / 2, cy - (photo.height * s) / 2, photo.width * s, photo.height * s);
  } else { x.fillStyle = "#0a2a6b"; x.fillRect(cx - r, cy - r, 2 * r, 2 * r); }
  x.restore();
  x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.strokeStyle = "#F0A71F"; x.lineWidth = 12; x.stroke();
  // Show, host, time.
  let y = cy + r + (shape === "square" ? 78 : 140);
  x.fillStyle = "#fff"; x.font = font(900, shape === "square" ? 54 : 68);
  for (const l of wrap(x, b.show, W - 160, 2)) { x.fillText(l, cx, y); y += shape === "square" ? 62 : 80; }
  x.fillStyle = "rgba(255,255,255,0.8)"; x.font = font(600, shape === "square" ? 34 : 42);
  x.fillText(`with ${b.host}`, cx, y + 4); y += shape === "square" ? 82 : 110;
  // The time, in the gold box.
  const when = `${day(b.startAtUtc).toUpperCase()} · ${time(b.startAtUtc)} ET`;
  x.font = font(900, shape === "square" ? 36 : 46);
  const bw = x.measureText(when).width + 70, bh = shape === "square" ? 72 : 92;
  x.strokeStyle = "#F0A71F"; x.lineWidth = 4; x.beginPath(); x.roundRect(cx - bw / 2, y - bh + 22, bw, bh, 18); x.stroke();
  x.fillStyle = "#F0A71F"; x.fillText(when, cx, y);
  x.fillStyle = "rgba(255,255,255,0.65)"; x.font = font(700, shape === "square" ? 26 : 32);
  x.fillText("militaryvoices.ai/digital-experience", cx, H - (shape === "square" ? 50 : 90));
  try { return c.toDataURL("image/png"); } catch { return ""; }
}

export function DxShare({ b }: { b: DxShareBooking }) {
  const [art, setArt] = useState<{ square: string; story: string } | null>(null);
  const [copied, setCopied] = useState<"" | "link" | "caption">("");
  useEffect(() => { let on = true; void Promise.all([draw(b, "square"), draw(b, "story")]).then(([square, story]) => on && setArt({ square, story })); return () => { on = false; }; }, [b.id, b.photo, b.show]); // eslint-disable-line react-hooks/exhaustive-deps
  const link = dxShareUrl(b.id);
  const caption = dxCaption(b);
  const copy = (what: "link" | "caption", text: string) => void navigator.clipboard.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(""), 2000); });
  const file = b.show.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "my-show";
  const pill = "inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-background px-3.5 text-sm font-semibold hover:bg-muted";
  return (
    <div className="space-y-3" data-testid={`dx-share-${b.id}`}>
      <div className="grid grid-cols-[1fr_auto] gap-3 sm:grid-cols-[auto_auto_1fr]">
        {art ? (
          <>
            <a href={art.square} download={`${file}-square.png`} className="group relative block w-24 overflow-hidden rounded-lg border border-border sm:w-28" title="Download the square graphic">
              <img src={art.square} alt="Square graphic for posts" className="aspect-square w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 bg-black/70 py-0.5 text-center text-[10px] font-semibold text-white">Post · download</span>
            </a>
            <a href={art.story} download={`${file}-story.png`} className="group relative block w-14 overflow-hidden rounded-lg border border-border sm:w-16" title="Download the story graphic">
              <img src={art.story} alt="Tall graphic for stories" className="aspect-[9/16] w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 bg-black/70 py-0.5 text-center text-[10px] font-semibold text-white">Story</span>
            </a>
          </>
        ) : <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-border"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <p className="line-clamp-3 text-xs text-muted-foreground">{caption}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={pill} onClick={() => copy("caption", caption)}>{copied === "caption" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied === "caption" ? "Copied" : "Copy caption"}</button>
            <button type="button" className={pill} onClick={() => copy("link", link)}>{copied === "link" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied === "link" ? "Copied" : "Copy link"}</button>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <a className={pill} href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`} target="_blank" rel="noreferrer">LinkedIn</a>
        <a className={pill} href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`} target="_blank" rel="noreferrer">Facebook</a>
        <a className={pill} href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(caption)}`} target="_blank" rel="noreferrer">X</a>
        {art && <a className={pill} href={art.square} download={`${file}-square.png`}><Download className="h-4 w-4" /> Graphics</a>}
      </div>
    </div>
  );
}
