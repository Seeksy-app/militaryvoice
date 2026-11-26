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

export function Field({ label, icon: Icon, className, children }: { label: string; icon: typeof MapPin; className?: string; children: React.ReactNode }) {
  return (
    <label className={`flex min-w-0 flex-col rounded-xl border border-border bg-background px-3 py-2 focus-within:border-[#053877] focus-within:ring-1 focus-within:ring-[#053877] ${className ?? ""}`}>
      <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
      <span className="mt-0.5 flex min-w-0 items-center gap-2"><Icon className="h-4 w-4 shrink-0 text-[#0b1b33] dark:text-white" />{children}</span>
    </label>
  );
}

/** A date box that reads "Dec 1, 2026"; the real date input sits on top, invisible, so any tap opens the picker. */
export function DateField({ label, aria, hint, value, min, onChange, onClear, testid }: { label: string; aria: string; hint?: string; value: string; min: string; onChange: (v: string) => void; onClear?: () => void; testid: string }) {
  return (
    <label className="relative flex min-w-0 flex-col rounded-xl border border-border bg-background px-3 py-2 focus-within:border-[#053877] focus-within:ring-1 focus-within:ring-[#053877] sm:w-[168px] sm:shrink-0">
      <span className="text-[12px] font-medium text-muted-foreground">{label}{hint && !value ? <span className="font-normal"> · {hint}</span> : null}</span>
      <span className="mt-0.5 flex items-center gap-2">
        <CalendarDays className="h-4 w-4 shrink-0 text-[#0b1b33] dark:text-white" />
        <span className={`truncate text-[16px] ${value ? "font-semibold" : "text-muted-foreground"}`}>{value ? ymdLong(value) : "Add date"}</span>
      </span>
      <input type="date" aria-label={aria} min={min} value={value} onChange={(e) => onChange(e.target.value)} onClick={(e) => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* older browsers open it themselves */ } }} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" data-testid={testid} />
      {value && onClear && <button type="button" onClick={(e) => { e.preventDefault(); onClear(); }} aria-label={`Clear ${label}`} className="absolute right-2 top-2 z-10 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
    </label>
  );
}

export function Select({ label, value, onChange, options, testid }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; testid: string }) {
  return (
    <label className="relative flex items-center rounded-lg border border-border bg-card text-[13px] font-semibold">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="appearance-none bg-transparent py-1.5 pl-3 pr-8 outline-none" data-testid={testid}>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5" />
    </label>
  );
}

/** A tag in Andrew's grey-pill style; a confirmed benefit gets a green tick, a phone-only rate a phone. */
export function Tag({ tone, children }: { tone: "green" | "grey" | "amber"; children: React.ReactNode }) {
  const c = tone === "green" ? "bg-[#ecf7f0] text-[#14532d] ring-[#bfe3cc] dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30"
    : tone === "amber" ? "bg-[#FFF3D6] text-[#7a4f00] ring-[#F0A71F]/50 dark:bg-[#F0A71F]/10 dark:text-[#F0A71F]"
    : "bg-[#f1f4f9] text-foreground/75 ring-[#e3e8f0] dark:bg-white/5 dark:ring-white/10";
  const Icon = tone === "green" ? Check : tone === "amber" ? Phone : Info;
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-medium ring-1 ${c}`}><Icon className="h-3.5 w-3.5 shrink-0" />{children}</span>;
}
