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

export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "ok" | "warn" | "gold" }) {
  const s = {
    muted: { background: "rgba(255,255,255,.08)", color: C.muted },
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
