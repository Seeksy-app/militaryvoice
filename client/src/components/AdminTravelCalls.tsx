import { useQuery } from "@tanstack/react-query";
import { Check, Plane, X } from "lucide-react";
import { airportName } from "@/lib/travelPerks";
import { callLine, ymdNice, type CallView } from "@/components/Travel";

// Admin → Travel calls (26 Nov 2026): what the Travel page is doing today and every "Have us call" request, read from
// GET /api/admin/travel (server/creatorTravel.ts). Read-only on purpose: placing a call is gated on the server
// (setting travel:calls = "on" plus the Synthflow keys), and the first test call is Andrew's to OK.

type Row = CallView & { who: string; durationSec: number | null; calledNumber: string };
type AdminTravel = {
  callsOn: boolean;
  testNumber: string;
  configured: { parallel: boolean; agentsKey: boolean; travelAgent: boolean; travelPhone: boolean };
  today: { searches: number; paidSearches: number };
  calls: Row[];
};

const STATUS: Record<Row["status"], { label: string; cls: string }> = {
  waiting: { label: "Saved", cls: "bg-[#FFF8E8] text-[#8a5a00] dark:bg-[#F0A71F]/15 dark:text-[#F0A71F]" },
  calling: { label: "Calling", cls: "bg-blue-50 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300" },
  done: { label: "Answered", cls: "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
  failed: { label: "No answer", cls: "bg-muted text-muted-foreground" },
};

export function AdminTravelCalls() {
  const { data, isLoading, error } = useQuery<AdminTravel>({
    queryKey: ["/api/admin/travel"],
    queryFn: async () => {
      const r = await fetch("/api/admin/travel", { credentials: "include" });
      if (!r.ok) throw new Error("Couldn't load Travel.");
      return r.json();
    },
    refetchInterval: 60_000,
  });
  const c = data?.configured;
  const ready = !!c && c.agentsKey && c.travelAgent && c.travelPhone;
  return (
    <div className="flex max-w-4xl flex-col gap-5" data-testid="admin-travel-calls">
      <div>
        <h2 className="text-xl font-semibold">Travel calls</h2>
        <p className="text-sm text-muted-foreground text-balance">Creators on active duty asking us to get a phone-only military fare. Our automated caller asks the airline and the answer shows on their Travel page. We never book or&nbsp;pay.</p>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-[#b42318]">{(error as Error).message}</p>}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground">Calls</p>
              <p className={`text-lg font-semibold ${data.callsOn && ready ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{data.callsOn && ready ? "On" : "Off"}</p>
              <p className="text-xs text-muted-foreground text-balance">{data.callsOn && ready ? (data.testNumber ? "Every call goes to the rehearsal number." : "Calls go to the airlines.") : "Requests are saved. Nothing is called until the first test call is OK'd."}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground">Set up</p>
              <ul className="mt-1 space-y-0.5 text-[13px]">
                {([["Flight search (Parallel)", c!.parallel], ["Agents key", c!.agentsKey], ["Travel agent", c!.travelAgent], ["Phone number", c!.travelPhone]] as const).map(([k, v]) => (
                  <li key={k} className="flex items-center gap-1.5">{v ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <X className="h-3.5 w-3.5 text-muted-foreground" />}<span className={v ? "" : "text-muted-foreground"}>{k}</span></li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground">Today</p>
              <p className="text-lg font-semibold">{data.today.searches} {data.today.searches === 1 ? "search" : "searches"}</p>
              <p className="text-xs text-muted-foreground">{data.today.paidSearches} new, {data.today.searches - data.today.paidSearches} from the 30-minute store</p>
            </div>
          </div>

          {data.calls.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No call requests yet.</p>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {data.calls.map((r) => {
                const s = STATUS[r.status];
                return (
                  <div key={r.id} className="flex flex-col gap-1 px-4 py-3 text-sm" data-testid={`travel-call-${r.id}`}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Plane className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold">{airportName(r.flight.from)} → {airportName(r.flight.to)}</span>
                      <span className="text-muted-foreground">{ymdNice(r.flight.depart)}{r.flight.return ? ` – ${ymdNice(r.flight.return)}` : ", one way"}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}>{s.label}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{r.who} · {new Date(r.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                    <p className="text-muted-foreground">
                      {r.airline} {r.flight.flights.join(", ") || ""}{r.webPrice != null ? ` · web $${Math.round(r.webPrice).toLocaleString()}` : ""}{r.durationSec ? ` · call ${Math.round(r.durationSec / 60)} min` : ""}
                    </p>
                    {(r.status === "done" || r.status === "failed") && <p>{callLine(r)}</p>}
                    {r.report?.summary && <p className="text-xs text-muted-foreground">{r.report.summary}</p>}
                    {r.error && <p className="text-xs text-[#b42318]">{r.error}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
