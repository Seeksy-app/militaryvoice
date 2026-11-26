import { useState } from "react";
import { CalendarDays, Check, ChevronDown, Info, MapPin, Phone, X } from "lucide-react";

/** The pieces Travel's Flights and Hotels tabs share (26 Nov 2026): the look of Andrew's target, one place. */
export const HEAD = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
export const GOLD = "#F0A71F";

export const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
export const ymdLong = (d: string) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
export const todayEt = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
export const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
/** "+18004458667" → "800-445-8667"; anything else as given. */
export const phoneText = (e164?: string | null) => {
  const n = (e164 ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return n.length === 10 ? `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}` : e164 ?? "";
};
export const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

export async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "include" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { message?: string }).message || "Something went wrong. Try again.");
  return j as T;
}

// Field look from the target: small grey label over a large bold value, 54px tall, soft border.
const BOX = "flex min-w-0 flex-col justify-center rounded-xl border border-[#d5dce8] bg-white px-3.5 py-1.5 focus-within:border-[#053877] focus-within:ring-1 focus-within:ring-[#053877] sm:min-h-[56px] dark:border-white/15 dark:bg-background";
export const LABEL = "text-[13.5px] font-medium leading-tight text-[#5b6678] dark:text-white/60";
export const VALUE = "text-[17px] font-bold sm:text-[18px]";

export function Field({ label, icon: Icon, className, children }: { label: string; icon: typeof MapPin; className?: string; children: React.ReactNode }) {
  return (
    <label className={`${BOX} ${className ?? ""}`}>
      <span className={LABEL}>{label}</span>
      <span className="mt-0.5 flex min-w-0 items-center gap-2"><Icon className="h-[18px] w-[18px] shrink-0 text-[#0b1b33] dark:text-white" />{children}</span>
    </label>
  );
}

/** A date box that reads "Dec 1, 2026"; the real date input sits on top, invisible, so any tap opens the picker. */
export function DateField({ label, aria, hint, value, min, onChange, onClear, testid }: { label: string; aria: string; hint?: string; value: string; min: string; onChange: (v: string) => void; onClear?: () => void; testid: string }) {
  return (
    <label className={`relative ${BOX} sm:w-[172px] sm:shrink-0`}>
      <span className={LABEL}>{label}{hint && !value ? <span className="font-normal"> · {hint}</span> : null}</span>
      <span className="mt-0.5 flex items-center gap-2">
        <CalendarDays className="h-[18px] w-[18px] shrink-0 text-[#0b1b33] dark:text-white" />
        <span className={`truncate ${value ? VALUE : "text-[17px] text-muted-foreground"}`}>{value ? ymdLong(value) : "Add date"}</span>
      </span>
      <input type="date" aria-label={aria} min={min} value={value} onChange={(e) => onChange(e.target.value)} onClick={(e) => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* older browsers open it themselves */ } }} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" data-testid={testid} />
      {value && onClear && <button type="button" onClick={(e) => { e.preventDefault(); onClear(); }} aria-label={`Clear ${label}`} className="absolute right-2 top-2 z-10 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
    </label>
  );
}

export function Select({ label, value, onChange, options, testid }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; testid: string }) {
  return (
    <label className="relative flex items-center rounded-lg border border-[#d5dce8] bg-card text-[14.5px] font-medium dark:border-white/15">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="appearance-none bg-transparent py-2 pl-3.5 pr-10 outline-none" data-testid={testid}>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4" />
    </label>
  );
}

/** A tag in Andrew's grey-pill style; a confirmed benefit gets a green tick, a phone-only rate a phone. */
export function Tag({ tone, children }: { tone: "green" | "grey" | "amber"; children: React.ReactNode }) {
  const c = tone === "green" ? "bg-[#ecf7f0] text-[#14532d] ring-[#bfe3cc] dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30"
    : tone === "amber" ? "bg-[#FFF3D6] text-[#7a4f00] ring-[#F0A71F]/50 dark:bg-[#F0A71F]/10 dark:text-[#F0A71F]"
    : "bg-[#eef1f6] text-[#2a3547] ring-[#e1e6ee] dark:bg-white/5 dark:text-white/80 dark:ring-white/10";
  const Icon = tone === "green" ? Check : tone === "amber" ? Phone : Info;
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium ring-1 ${c}`}><Icon className="h-4 w-4 shrink-0" />{children}</span>;
}

/** The full-width light-blue band under the search card: a circled "i" and one bold navy line. */
export function Banner({ children, testid }: { children: React.ReactNode; testid: string }) {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-xl border border-[#c9d9f4] bg-[#dfe9fa] px-4 py-2.5 sm:px-5 dark:border-white/10 dark:bg-white/5" data-testid={testid}>
      <Info className="h-[22px] w-[22px] shrink-0 text-[#0b1b33] dark:text-white" strokeWidth={2} />
      <p className="text-[14.5px] font-bold leading-snug text-[#0b1b33] text-balance sm:text-[16.5px] dark:text-white">{children}</p>
    </div>
  );
}

/**
 * A brand's own logo, a local file beside factual perk info (Andrew, 26 Nov: real logos, as in his image). When the
 * file isn't there or won't load, the name in the brand's colour stands in, as before. Several logos are black or navy,
 * so in dark mode they sit on a small white chip.
 */
export function BrandLogo({ src, name, color, className, textClass }: { src: string | null; name: string; color: string; className?: string; textClass?: string }) {
  const [bad, setBad] = useState(false);
  if (src && !bad) return <img src={src} alt={name} loading="lazy" decoding="async" onError={() => setBad(true)} className={`object-contain dark:rounded-md dark:bg-white dark:px-1.5 dark:py-1 ${className ?? ""}`} />;
  return <span className={textClass ?? "text-center text-[18px] font-extrabold leading-[1.05] tracking-tight"} style={{ color, ...HEAD }}>{name}</span>;
}
