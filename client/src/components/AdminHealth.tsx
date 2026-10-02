import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Activity, CheckCircle2, CircleDashed, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/icon-tile";

type Check = { key: string; name: string; group: string; powers: string; state: "ok" | "down" | "off"; detail: string; ms: number };
type Health = { checkedAt: string; checks: Check[]; ok: number; down: number; off: number };

/**
 * Admin → System health: every service the site depends on, asked live. Checks
 * again every minute while it's open; Slack hears about an outage within ten
 * minutes whether or not anyone is looking (the health cron).
 */
export function AdminHealth() {
  const q = useQuery<Health>({
    queryKey: ["/api/admin/health"],
    queryFn: async () => {
      const r = await fetch("/api/admin/health", { credentials: "include" });
      if (!r.ok) throw new Error(`Couldn't run the checks (${r.status}).`);
      return r.json();
    },
    refetchInterval: 60_000,
  });
  const d = q.data;
  const counted = d ? d.ok + d.down : 0;
  const pct = d && counted ? Math.round((d.ok / counted) * 100) : 0;
  const groups = d ? Array.from(new Set(d.checks.map((c) => c.group))) : [];

  return (
    <div className="space-y-6" data-testid="admin-health">
      <section className={`flex flex-wrap items-center gap-4 rounded-2xl border p-5 ${!d ? "border-border bg-card" : d.down ? "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10" : "border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10"}`}>
        <IconTile icon={q.isLoading ? Loader2 : Activity} spin={q.isLoading} />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold tracking-tight">
            {!d ? "Checking every service…" : d.down ? `${d.down} ${d.down === 1 ? "service needs" : "services need"} attention` : "All systems normal"}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {d ? `${pct}% · ${d.ok} of ${counted} answering${d.off ? ` · ${d.off} not set up here` : ""} · checked ${new Date(d.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : q.isError ? (q.error as Error).message : "Asking each one now."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Checked every five minutes around the clock. If anything goes down, Slack hears within ten minutes, and again when it's back.</p>
        </div>
        <Button variant="outline" className="gap-1.5 rounded-full" disabled={q.isFetching} onClick={() => void fetch("/api/admin/health?fresh=1", { credentials: "include" }).then(() => q.refetch())} data-testid="health-recheck">
          {q.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Check now
        </Button>
      </section>

      {groups.map((g) => (
        <section key={g} className="rounded-2xl border border-border bg-card">
          <h3 className="border-b border-border px-5 py-3 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{g}</h3>
          <ul className="divide-y divide-border">
            {d!.checks.filter((c) => c.group === g).map((c) => (
              <li key={c.key} className="flex items-start gap-3 px-5 py-3.5" data-testid={`health-${c.key}`}>
                {c.state === "ok" ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-label="Answering" /> : c.state === "down" ? <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-label="Down" /> : <CircleDashed className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-label="Not set up" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.powers}</p>
                </div>
                <div className="max-w-[45%] text-right">
                  <p className={`text-sm ${c.state === "down" ? "font-semibold text-red-700 dark:text-red-400" : "text-foreground"}`}>{c.detail}</p>
                  {c.state !== "off" && <p className="text-[11px] tabular-nums text-muted-foreground">{c.ms} ms</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The admin top bar's status light: green when everything answers, red with a count when not. Opens System health. */
export function HealthLight() {
  const [, navigate] = useLocation();
  const q = useQuery<Health>({
    queryKey: ["/api/admin/health"],
    queryFn: async () => (await fetch("/api/admin/health", { credentials: "include" })).json(),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
  const d = q.data;
  const down = d?.down ?? 0;
  return (
    <button type="button" onClick={() => navigate("/admin/health")} title={d ? (down ? `${down} down: ${d.checks.filter((c) => c.state === "down").map((c) => c.name).join(", ")}` : "All systems normal") : "Checking…"} className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-semibold hover:bg-muted" data-testid="health-light">
      <span className={`h-2.5 w-2.5 rounded-full ${!d ? "bg-muted-foreground/40" : down ? "bg-red-500" : "bg-emerald-500"}`} />
      <span className="hidden md:inline">{!d ? "Checking" : down ? `${down} down` : "All systems normal"}</span>
    </button>
  );
}
