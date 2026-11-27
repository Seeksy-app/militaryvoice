import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";

/**
 * Production Command's look, from the approved mockup (26 Nov 2026): navy #071a33, cards #0c2445, gold #e0b23a only as a
 * fill behind navy text, Barlow / Barlow Condensed / IBM Plex Mono. The client portal stays light (ClientPortal.tsx).
 */
export const C = {
  bg: "#071a33", head: "#0a2142", card: "#0c2445", line: "#1d3a63", active: "#12345f", muted: "#a9b8cf", gold: "#e0b23a", ink: "#eef2f8",
};
export const FONT_BODY = "'Barlow', system-ui, -apple-system, 'Segoe UI', sans-serif";
export const FONT_COND = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";
export const FONT_MONO = "'IBM Plex Mono', ui-monospace, Menlo, monospace";

/** The three fonts, loaded once when a LIVE screen first opens (the rest of the site doesn't use them). */
export function useLiveFonts() {
  useEffect(() => {
    if (document.getElementById("live-fonts")) return;
    const l = document.createElement("link");
    l.id = "live-fonts";
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap";
    document.head.appendChild(l);
  }, []);
}

/** Eastern time, ticking each second, as on the mockup's top bar. */
export function useEtClock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i); }, []);
  return t.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" }) + " ET";
}

/** Uppercase condensed label, 13px, .08em, as every card title on the mockup. */
export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-[13px] font-semibold uppercase ${className}`} style={{ fontFamily: FONT_COND, letterSpacing: ".08em", color: C.muted }}>{children}</p>;
}

export function Card({ title, action, children, className = "", testId }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <section className={`min-w-0 rounded-lg border p-3.5 ${className}`} style={{ background: C.card, borderColor: C.line }} data-testid={testId}>
      {(title || action) && (
        <div className="mb-2 flex min-h-[24px] items-center justify-between gap-2">
          {title ? <Label>{title}</Label> : <span />}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Gold fill with navy text for the one primary action; outline otherwise. */
const btnCls = (primary?: boolean, small?: boolean) =>
  `inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${small ? "h-7 px-2.5 text-[12.5px]" : "h-9 px-3.5 text-[13.5px]"} ${primary ? "hover:brightness-105" : "border hover:bg-white/5"}`;
const btnStyle = (primary?: boolean) => (primary ? { background: C.gold, color: "#0b2447" } : { borderColor: C.line, color: C.ink });
export function Btn({ children, primary, small, className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; small?: boolean }) {
  return <button type="button" {...rest} className={`${btnCls(primary, small)} ${className}`} style={btnStyle(primary)}>{children}</button>;
}
/** The same button as a link (no button inside an anchor). */
export function LinkBtn({ href, children, primary, small, className = "", testId }: { href: string; children: ReactNode; primary?: boolean; small?: boolean; className?: string; testId?: string }) {
  return <Link href={href} className={`${btnCls(primary, small)} ${className}`} style={btnStyle(primary)} data-testid={testId}>{children}</Link>;
}

export type Tone = "muted" | "ok" | "warn" | "gold" | "bad" | "alex" | "info";
export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: Tone }) {
  const s = {
    muted: { background: "rgba(255,255,255,.08)", color: C.muted },
    bad: { background: "rgba(255,120,110,.14)", color: "#ff8a80" },
    alex: { background: "rgba(185,166,245,.16)", color: "#c4b5fd" },
    info: { background: "rgba(141,182,240,.16)", color: "#8db6f0" },
    ok: { background: "rgba(95,208,143,.14)", color: "#7fe0a6" },
    warn: { background: "rgba(240,192,80,.14)", color: "#f0c050" },
    gold: { background: C.gold, color: "#0b2447" },
  }[tone];
  return <span className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={s}>{children}</span>;
}

/** A plain "not built yet" row, never fake data. */
export function Coming({ what, phase }: { what: string; phase: number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-1.5 text-[13.5px] last:border-b-0" style={{ borderColor: C.line, color: C.muted }}>
      <span className="min-w-0">{what}</span>
      <span className="shrink-0 text-[12px]" style={{ fontFamily: FONT_MONO }}>Coming in phase {phase}</span>
    </div>
  );
}

export function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-1.5 text-[13.5px] last:border-b-0" style={{ borderColor: C.line }}>
      <span className="min-w-0 truncate" style={{ color: C.muted }}>{label}</span>
      <span className="min-w-0 truncate text-right font-medium">{children}</span>
    </div>
  );
}

const inputCls = "h-9 w-full min-w-0 rounded-md border bg-transparent px-2.5 text-[14px] outline-none focus:ring-2 focus:ring-[#e0b23a]/60";
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[12px] font-semibold uppercase" style={{ fontFamily: FONT_COND, letterSpacing: ".08em", color: C.muted }}>{label}</span>
      {children}
    </label>
  );
}
export function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={`${inputCls} ${p.className ?? ""}`} style={{ borderColor: C.line, color: C.ink, colorScheme: "dark", ...p.style }} />;
}
export function Select({ children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={`${inputCls} ${p.className ?? ""}`} style={{ borderColor: C.line, color: C.ink, background: C.bg, colorScheme: "dark" }}>{children}</select>;
}

export const fmtDay = (d: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
export const fmtRange = (a: string, b: string) => {
  if (!a) return "Dates not set";
  if (!b || a === b) return fmtDay(a);
  const [da, db] = [new Date(`${a}T12:00:00`), new Date(`${b}T12:00:00`)];
  const mon = (d: Date) => d.toLocaleDateString("en-US", { month: "short" });
  if (da.getFullYear() !== db.getFullYear()) return `${fmtDay(a)} – ${fmtDay(b)}`;
  if (da.getMonth() === db.getMonth()) return `${mon(da)} ${da.getDate()}–${db.getDate()}, ${db.getFullYear()}`;
  return `${mon(da)} ${da.getDate()} – ${mon(db)} ${db.getDate()}, ${db.getFullYear()}`;
};
export const fmtWhen = (iso: string) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

/** The client's brand colour ("#rrggbb", or "" for the MV navy), with dark or white text picked so it always reads. */
export function brand(hex?: string) {
  const bg = /^#[0-9a-f]{6}$/i.test(hex ?? "") ? hex! : "#0b2447";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return { bg, fg: 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#0d1b2e" : "#fff" };
}
export const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/* ------------------------------------------------------------------ phase 2: times in the production's zone, faces, reads */

const parts = (iso: string, tz: string) => {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const o = Object.fromEntries(f.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { day: `${o.year}-${o.month}-${o.day}`, hm: `${o.hour}:${o.minute}` };
};
/** "2027-07-25" for an instant, in the production's time zone. */
export const dayIn = (iso: string, tz: string) => parts(iso, tz).day;
/** "14:05" (24 h) for an instant, for <input type="time">. */
export const hmIn = (iso: string, tz: string) => parts(iso, tz).hm;
/** "9:00", "1:45": the run of show's clock, no AM/PM (the day reads top to bottom). */
export const clockIn = (iso: string, tz: string) => { const [h, m] = hmIn(iso, tz).split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")}`; };
/** A wall-clock day and time in a zone → ISO UTC. Two passes settle any offset, DST days included. */
export function zonedIso(day: string, hm: string, tz: string) {
  const want = Date.parse(`${day}T${hm}:00Z`);
  let t = want;
  for (let i = 0; i < 2; i++) { const p = parts(new Date(t).toISOString(), tz); t += want - Date.parse(`${p.day}T${p.hm}:00Z`); }
  return new Date(t).toISOString();
}
export const dayTab = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
/** Each day from a to b (YYYY-MM-DD), at most 14. */
export function daysBetween(a: string, b: string) {
  const out: string[] = [];
  if (!a) return out;
  for (let d = new Date(`${a}T12:00:00Z`); out.length < 14 && d.toISOString().slice(0, 10) <= (b || a); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
/** About 150 words a minute: "0:24 read". */
export function readTime(text: string) {
  const s = Math.max(1, Math.round(text.trim().split(/\s+/).filter(Boolean).length / 2.5));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} read`;
}

const FACE_BG = ["#e0b23a", "#8db6f0", "#7fe0a6", "#f2a0b5", "#b9a6f5", "#c9d3e2"];
/** A person's headshot, or their initials on a steady colour. */
export function Face({ name, photoUrl = "", size = 26, ring = C.card }: { name: string; photoUrl?: string; size?: number; ring?: string }) {
  const i = name.split("").reduce((n, ch) => n + ch.charCodeAt(0), 0) % FACE_BG.length;
  const st = { width: size, height: size, boxShadow: `0 0 0 2px ${ring}` };
  return photoUrl
    ? <img src={photoUrl} alt="" className="shrink-0 rounded-full object-cover" style={st} />
    : <span className="flex shrink-0 items-center justify-center rounded-full font-bold" style={{ ...st, background: FACE_BG[i], color: "#0b2447", fontSize: Math.round(size * 0.4) }} aria-hidden>{initials(name)}</span>;
}

/** How to say a name, with Play when there's a recording. */
export function SayIt({ text, audioUrl, light = false }: { text: string; audioUrl?: string; light?: boolean }) {
  const [a] = useState(() => (typeof Audio !== "undefined" && audioUrl ? new Audio(audioUrl) : null));
  if (!text && !audioUrl) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 text-[12.5px]" style={{ color: light ? "#4f5d72" : C.muted }}>
      <span className="whitespace-nowrap">Say it:</span> <span style={{ color: light ? "#0d1b2e" : C.ink }}>{text || "listen"}</span>
      {a && <button type="button" onClick={() => { a.currentTime = 0; void a.play(); }} className="font-semibold hover:underline" style={{ color: light ? "#1f4f8f" : "#8db6f0" }}>▶ Play</button>}
    </span>
  );
}

/** A small segmented control (stage tabs, day tabs, inbox tabs). */
export function Tabs<K extends string | number>({ items, value, onChange, testId }: { items: { key: K; label: ReactNode }[]; value: K; onChange: (k: K) => void; testId?: string }) {
  return (
    <div className="flex max-w-full shrink-0 gap-0.5 overflow-x-auto rounded-md border p-0.5" style={{ borderColor: C.line, background: C.head }} role="tablist" data-testid={testId}>
      {items.map((t) => {
        const on = t.key === value;
        return (
          <button key={String(t.key)} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.key)}
            className="h-7 whitespace-nowrap rounded px-2.5 text-[13px] font-semibold"
            style={on ? { background: C.active, color: "#fff" } : { color: C.muted }}>{t.label}</button>
        );
      })}
    </div>
  );
}

/** Filter chips (Alex's queue, approval types). */
export function Chips<K extends string>({ items, value, onChange }: { items: { key: K; label: string; n?: number }[]; value: K; onChange: (k: K) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t) => {
        const on = t.key === value;
        return (
          <button key={t.key} type="button" onClick={() => onChange(t.key)} aria-pressed={on}
            className="h-7 whitespace-nowrap rounded-full border px-2.5 text-[12.5px] font-semibold"
            style={on ? { borderColor: "#8db6f0", background: "rgba(141,182,240,.14)", color: "#fff" } : { borderColor: C.line, color: C.muted }}>
            {t.label}{t.n !== undefined && <span className="ml-1" style={{ color: on ? "#fff" : C.ink }}>{t.n}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Green Approve, as on the approved mockup (gold stays the page's one primary action). */
export function ApproveBtn({ children = "Approve", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...p} className={`inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-md px-3 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-50 ${p.className ?? ""}`} style={{ background: "#1f7a4a" }}>{children}</button>;
}

export const TextArea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...p} className={`w-full min-w-0 rounded-md border bg-transparent px-2.5 py-2 text-[14px] leading-snug outline-none focus:ring-2 focus:ring-[#e0b23a]/60 ${p.className ?? ""}`} style={{ borderColor: C.line, color: C.ink, background: C.bg, colorScheme: "dark" }} />
);
