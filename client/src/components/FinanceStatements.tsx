import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adminGet, adminSend } from "@/lib/adminApi";
import { EXPENSE_CATEGORIES, periodMonths, type FinRow, type SortKind } from "@shared/finance";

// Admin → Finances → Statements (Andrew approved the mockup, 27 Nov 2026): income statement, cash in and
// out by month, and owner contributions below, for a month, a quarter or the year to date. Every line
// comes from the server (Stripe, Mercury, the bills list); this page only adds them up.

type Data = {
  months: string[];
  rows: FinRow[];
  recurring: { mrrCents: number; plans: { name: string; interval: string; n: number; comped?: boolean }[]; addons: { name: string; n: number }[] };
  sources: { stripe: "ok" | "off" | "error"; mercury: "ok" | "off" | "error" };
  errors: string[];
  at: string;
};
type Period = "month" | "quarter" | "ytd";

const usd = (c: number) => `${c < 0 ? "−" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usd0 = (c: number) => `${c < 0 ? "−" : ""}$${Math.round(Math.abs(c) / 100).toLocaleString("en-US")}`;
const MONTH = (m: string, style: "long" | "short" = "long") => new Date(`${m}-15T12:00:00Z`).toLocaleString("en-US", { month: style, ...(style === "long" ? { year: "numeric" } : {}), timeZone: "UTC" });
const quarterOf = (m: string) => `Q${Math.floor((Number(m.slice(5)) - 1) / 3) + 1} ${m.slice(0, 4)}`;
const net = (r: FinRow) => r.cents - r.refundCents;
const SORT_LABEL: Record<Exclude<SortKind, "unsorted">, string> = { plans: "Subscribers", credits: "Pōstify credits", sponsorship: "Sponsorship", owner: "Owner contribution", ignore: "Not ours (leave out)" };

function sums(rows: FinRow[]) {
  const of = (f: (r: FinRow) => boolean, v: (r: FinRow) => number = (r) => r.cents) => rows.filter(f).reduce((n, r) => n + v(r), 0);
  const isRev = (r: FinRow) => r.kind === "plans" || r.kind === "credits" || r.kind === "sponsorship";
  const plans = of((r) => r.kind === "plans");
  const credits = of((r) => r.kind === "credits");
  const sponsorship = of((r) => r.kind === "sponsorship");
  const refunds = of(isRev, (r) => r.refundCents);
  const revenue = plans + credits + sponsorship - refunds;
  const expenses = of((r) => r.kind === "expense");
  const owner = of((r) => r.kind === "owner", net);
  return { plans, credits, sponsorship, refunds, revenue, expenses, owner, net: revenue - expenses };
}

/** `lead`: the section title and tabs, on the same line as the period picker. */
export function FinanceStatements({ lead }: { lead?: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery<Data>({ queryKey: ["/api/admin/finance-statements"], queryFn: () => adminGet("/api/admin/finance-statements"), refetchInterval: 10 * 60_000 });
  const d = q.data;
  const [period, setPeriod] = useState<Period>("month");
  const [month, setMonth] = useState("");
  const [sorting, setSorting] = useState(false);
  useEffect(() => { if (d && !month) setMonth(d.months[d.months.length - 1]); }, [d, month]);

  // The choices for each kind of period, newest first, each named by the last month it covers.
  const options = useMemo(() => {
    const ms = [...(d?.months ?? [])].reverse();
    if (period === "month") return ms.map((m) => [m, MONTH(m)] as const);
    const seen = new Map<string, string>();
    for (const m of ms) { const k = period === "quarter" ? quarterOf(m) : m.slice(0, 4); if (!seen.has(k)) seen.set(k, m); }
    return Array.from(seen, ([label, m]) => [m, period === "quarter" ? label : `${label} to ${MONTH(m, "short")}`] as const);
  }, [d, period]);
  useEffect(() => { if (options.length && !options.some(([m]) => m === month)) setMonth(options[0][0]); }, [options, month]);

  if (!d) return <div className="flex flex-col gap-3">{lead}<p className="text-sm text-muted-foreground">{q.isError ? "Couldn't load the statements. Try again in a minute." : "Reading Stripe and Mercury…"}</p></div>;
  const inPeriod = new Set(periodMonths(period, month || d.months[d.months.length - 1]).filter((m) => d.months.includes(m)));
  const rows = d.rows.filter((r) => inPeriod.has(r.month));
  const s = sums(rows);
  const last = Array.from(inPeriod).pop() ?? "";
  const span = Array.from(inPeriod);
  const rangeLabel = span.length === 1 ? MONTH(span[0]) : `${MONTH(span[0], "short")} – ${MONTH(last)}`;
  // Cash by month: the period's months, and at least the three to its last month, so a month has something to compare with.
  const cashMonths = (span.length >= 3 ? span : d.months.slice(Math.max(0, d.months.indexOf(last) - 2), d.months.indexOf(last) + 1));
  const cash = cashMonths.map((m) => { const x = sums(d.rows.filter((r) => r.month === m)); return { m, rev: x.revenue, owner: x.owner, out: x.expenses, net: x.revenue + x.owner - x.expenses }; });
  const peak = Math.max(1, ...cash.flatMap((c) => [c.rev + c.owner, c.out]));
  const owners = Array.from(rows.filter((r) => r.kind === "owner").reduce((m, r) => { const k = ownerName(r.who); const e = m.get(k) ?? { n: 0, c: 0, rows: [] as FinRow[] }; e.n++; e.c += net(r); e.rows.push(r); return m.set(k, e); }, new Map<string, { n: number; c: number; rows: FinRow[] }>()));
  const toSort = d.rows.filter((r) => r.kind === "unsorted");
  const paidPlans = d.recurring.plans.filter((p) => !p.comped).reduce((n, p) => n + p.n, 0) + d.recurring.addons.reduce((n, a) => n + a.n, 0);
  const sort = async (id: string, kind: SortKind | "") => {
    await adminSend("PUT", "/api/admin/finance-sort", { id, kind });
    await qc.fetchQuery({ queryKey: ["/api/admin/finance-statements"], queryFn: () => adminGet("/api/admin/finance-statements?fresh=1") });
  };

  return (
    <section className="flex flex-col gap-3" data-testid="finance-statements">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {lead ?? <span />}
        <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs font-medium" role="tablist" aria-label="Period">
          {([["month", "Month"], ["quarter", "Quarter"], ["ytd", "Year to date"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={period === k} onClick={() => setPeriod(k)} className={`rounded-md px-3 py-1 ${period === k ? "bg-card font-semibold text-[#000741] shadow-sm dark:text-white" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
          ))}
        </div>
        <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-border bg-card px-2 py-1 text-xs" aria-label="Which period" data-testid="finance-period">
          {options.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
        </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-5">
        {[
          ["Revenue", usd(s.revenue), "after refunds", ""],
          ["Expenses", usd(s.expenses), "Mercury + bills paid elsewhere", ""],
          ["Net", usd(s.net), "revenue less expenses", s.net < 0 ? "text-red-700 dark:text-red-400" : ""],
          ["Monthly recurring", usd(d.recurring.mrrCents), `${paidPlans} paid plan${paidPlans === 1 ? "" : "s"} and add-ons, now`, ""],
          ["Owner money in", usd(s.owner), "not revenue", ""],
        ].map(([l, v, n, cls], i) => (
          <div key={l} className={`bg-card px-3 py-2.5 ${i === 4 ? "col-span-2 lg:col-span-1" : ""}`}>
            <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{l}</div>
            <div className={`text-lg font-bold tabular-nums ${cls}`} data-testid={`finance-kpi-${l.toLowerCase().replace(/\s+/g, "-")}`}>{v}</div>
            <div className="text-[11px] text-muted-foreground">{n}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.15fr_1fr] lg:items-start">
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <CardTitle title="Income statement" note={rangeLabel} />
          <table className="mt-1.5 w-full text-[13px] tabular-nums">
            <tbody>
              <Sec>Revenue</Sec>
              <Line label="Subscribers" src="Stripe" v={s.plans + s.credits} />
              <Line label="Plans and add-ons" v={s.plans} sub />
              {s.credits > 0 && <Line label="Pōstify credits" v={s.credits} sub />}
              <Line label="Sponsorship" src="Stripe" v={s.sponsorship} />
              {s.refunds > 0 && <Line label="Less refunds" v={-s.refunds} />}
              <Total label="Total revenue" v={s.revenue} />
              <Sec>Expenses</Sec>
              {EXPENSE_CATEGORIES.map((c) => <Expense key={c} cat={c} rows={rows.filter((r) => r.kind === "expense" && r.category === c)} />)}
              <Total label="Total expenses" v={s.expenses} />
              <tr className="border-t-2 border-foreground"><td className="pt-1.5 text-sm font-bold">Net income</td><td className={`pt-1.5 text-right text-sm font-bold ${s.net < 0 ? "text-red-700 dark:text-red-400" : ""}`} data-testid="finance-net">{usd(s.net)}</td></tr>
            </tbody>
          </table>
          {(d.recurring.plans.length > 0 || d.recurring.addons.length > 0) && (
            <p className="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
              Plans now: {[...d.recurring.plans.map((p) => `${p.name}${p.interval === "year" ? " yearly" : p.interval === "quarter" ? " quarterly" : ""}${p.comped ? " (comped)" : ""} × ${p.n}`), ...d.recurring.addons.map((a) => `${a.name} × ${a.n}`)].join(" · ")}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <CardTitle title="Cash in and out" note="by month" />
            <div className="mt-2 flex h-24 items-end gap-4 border-b border-border px-1">
              {cash.map((c) => (
                <div key={c.m} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-20 items-end gap-[3px]">
                    <i className="block w-3.5 rounded-t-sm bg-[#053877] dark:bg-[#5b8fd6]" style={{ height: `${Math.max(2, ((c.rev + c.owner) / peak) * 100)}%` }} title={`In ${usd(c.rev + c.owner)}`} />
                    <i className="block w-3.5 rounded-t-sm bg-muted-foreground/30" style={{ height: `${Math.max(2, (c.out / peak) * 100)}%` }} title={`Out ${usd(c.out)}`} />
                  </div>
                  <span className="text-[11px] text-muted-foreground">{MONTH(c.m, "short")}</span>
                </div>
              ))}
            </div>
            <table className="mt-1 w-full text-xs tabular-nums">
              <tbody>
                <tr className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground"><td className="py-1" />{cash.map((c) => <td key={c.m} className="py-1 text-right">{MONTH(c.m, "short")}</td>)}</tr>
                {([["Revenue in", "rev"], ["Owner money in", "owner"], ["Spent", "out"]] as const).map(([l, k]) => (
                  <tr key={k}><td className="py-0.5">{l}</td>{cash.map((c) => <td key={c.m} className="py-0.5 text-right">{usd0(c[k])}</td>)}</tr>
                ))}
                <tr className="border-t border-border font-semibold"><td className="pt-1">Net cash</td>{cash.map((c) => <td key={c.m} className={`pt-1 text-right ${c.net < 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>{usd0(c.net)}</td>)}</tr>
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-border bg-card px-4 py-3" data-testid="finance-owner">
            <CardTitle title="Owner contributions" note="equity, outside revenue" />
            <table className="mt-1.5 w-full text-[13px] tabular-nums">
              <tbody>
                {owners.length === 0 && <tr><td className="py-1 text-muted-foreground">None in this period.</td></tr>}
                {owners.map(([who, e]) => (
                  <tr key={who}><td className="py-1" colSpan={2}>
                    <details>
                      <summary className="flex cursor-pointer list-none justify-between gap-3"><span>{who} · {e.n} payment{e.n === 1 ? "" : "s"}</span><span>{usd(e.c)}</span></summary>
                      <ul className="mt-1 space-y-0.5 pl-3 text-[11px] text-muted-foreground">
                        {e.rows.map((r, i) => <li key={r.id ?? i} className="flex justify-between gap-3"><span>{r.date} · {r.who} · {SRC[r.source]}</span><span>{usd(net(r))}</span></li>)}
                      </ul>
                    </details>
                  </td></tr>
                ))}
                <Total label={span.length === 1 ? "Total this month" : "Total this period"} v={s.owner} />
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>{sourceLine(d)}</span>
            {toSort.length > 0 && <button type="button" onClick={() => setSorting((v) => !v)} className="font-semibold text-[#053877] hover:underline dark:text-[#9cc2ff]" data-testid="finance-to-sort">{toSort.length} payment{toSort.length === 1 ? "" : "s"} to sort →</button>}
          </div>
          {d.errors.length > 0 && <p className="text-[11px] text-red-700 dark:text-red-400">{d.errors.join(" · ")}</p>}
        </div>
      </div>

      {sorting && toSort.length > 0 && (
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <CardTitle title="To sort" note="kept out of the statements until sorted" />
          <table className="mt-1.5 w-full text-[13px] tabular-nums">
            <tbody>
              {toSort.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="py-1.5">{r.who}<span className="block text-[11px] text-muted-foreground">{r.date} · {SRC[r.source]}{r.note ? ` · ${r.note}` : ""}</span></td>
                  <td className="py-1.5 text-right">{usd(net(r))}</td>
                  <td className="py-1.5 pl-3 text-right">
                    <select defaultValue="" onChange={(e) => e.target.value && void sort(r.id!, e.target.value as SortKind)} className="rounded-lg border border-border bg-background px-2 py-1 text-xs" aria-label={`What ${r.who}'s payment is`}>
                      <option value="" disabled>Sort as…</option>
                      {Object.entries(SORT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const SRC: Record<FinRow["source"], string> = { stripe: "Stripe", mercury: "Mercury", bills: "bills list", hand: "entered by hand" };
const ownerName = (who: string) => (/riccoh|ohiowa/i.test(who) ? "OHIOWA (Riccoh)" : /^Applied Growth Technologies/.test(who) ? "Applied Growth Technologies" : who);

function sourceLine(d: Data) {
  const st = (n: string, v: string) => (v === "ok" ? n : v === "off" ? `${n} not connected` : `${n} didn't answer`);
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(d.at)) / 60_000));
  return `Live from ${st("Stripe", d.sources.stripe)} and ${st("Mercury", d.sources.mercury)} · updated ${mins < 1 ? "just now" : `${mins} min ago`}`;
}

function CardTitle({ title, note }: { title: string; note: string }) {
  return <h3 className="flex items-baseline justify-between gap-3 text-xs font-bold uppercase tracking-[0.06em] text-[#000741] dark:text-white">{title}<small className="text-[11px] font-medium normal-case tracking-normal text-muted-foreground">{note}</small></h3>;
}
function Sec({ children }: { children: string }) {
  return <tr><td colSpan={2} className="pt-2.5 text-[10px] uppercase tracking-[0.09em] text-muted-foreground">{children}</td></tr>;
}
function Line({ label, v, src, sub }: { label: string; v: number; src?: string; sub?: boolean }) {
  return <tr><td className={`py-[3px] ${sub ? "pl-3.5 text-xs text-muted-foreground" : ""}`}>{label}{src && <span className="ml-1 text-[10px] text-muted-foreground">{src}</span>}</td><td className={`py-[3px] text-right ${sub ? "text-xs text-muted-foreground" : ""}`}>{usd(v)}</td></tr>;
}
function Total({ label, v }: { label: string; v: number }) {
  return <tr className="border-t border-border font-semibold"><td className="py-1">{label}</td><td className="py-1 text-right">{usd(v)}</td></tr>;
}
/** One expense group; opens to its vendors, each marked when it's an estimate from the bills list. */
function Expense({ cat, rows }: { cat: string; rows: FinRow[] }) {
  const total = rows.reduce((n, r) => n + r.cents, 0);
  const byVendor = Array.from(rows.reduce((m, r) => { const k = `${r.who}|${r.estimate ? 1 : 0}`; const e = m.get(k) ?? { who: r.who, est: !!r.estimate, c: 0, n: 0 }; e.c += r.cents; e.n++; return m.set(k, e); }, new Map<string, { who: string; est: boolean; c: number; n: number }>()).values()).sort((a, b) => b.c - a.c);
  const allEst = rows.length > 0 && rows.every((r) => r.estimate);
  return (
    <tr><td colSpan={2} className="py-[3px]">
      <details>
        <summary className="flex cursor-pointer list-none justify-between gap-3"><span>{cat}{allEst && <span className="ml-1.5 rounded bg-[#F0A71F]/15 px-1.5 text-[10px] text-[#8a5f00] dark:text-[#F0A71F]">estimate</span>}</span><span>{usd(total)}</span></summary>
        {byVendor.length > 0 && (
          <ul className="mb-1 mt-0.5 space-y-0.5 pl-3.5 text-[11px] text-muted-foreground">
            {byVendor.map((v) => <li key={`${v.who}${v.est}`} className="flex justify-between gap-3"><span>{v.who}{v.n > 1 ? ` × ${v.n}` : ""}{v.est ? " · estimate, bills list" : " · Mercury"}</span><span>{usd(v.c)}</span></li>)}
          </ul>
        )}
      </details>
    </td></tr>
  );
}
