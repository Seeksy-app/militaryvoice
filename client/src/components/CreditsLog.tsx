import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

/** One ledger row as GET /api/postify/credits/history returns it (server/postifyCredits.ts). */
type CreditRow = { id: number; at: string; delta: number; kind: string; reason: string; episode: { id: number; title: string } | null; extra: number; balanceAfter: number };
type Page = { balance: number; next: number | null; rows: CreditRow[] };

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * Where their credits went (Andrew, 26 Nov: "a log they can look at for their credits to see exactly what they've
 * spent it on"). Newest first, one tight line each: date, what for, the change, what was left.
 */
export function CreditsLog({ className = "" }: { className?: string }) {
  const q = useInfiniteQuery<Page>({
    queryKey: ["/api/postify/credits/history"],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => (await apiRequest("GET", `/api/postify/credits/history?limit=25${pageParam ? `&before=${pageParam}` : ""}`)).json(),
    getNextPageParam: (last) => last.next ?? undefined,
    staleTime: 30_000,
  });
  if (q.isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (q.isError) return <p className="py-6 text-center text-sm text-muted-foreground">Your credits didn't load. Try again in a minute.</p>;
  const rows = q.data?.pages.flatMap((p) => p.rows) ?? [];
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">Nothing yet. Credits you get and spend show here.</p>;
  return (
    <div className={className} data-testid="credits-log">
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {rows.map((r) => (
          <li key={r.id} className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2 text-sm sm:grid-cols-[3.5rem_minmax(0,1fr)_3.5rem_4.5rem]" data-testid={`credit-row-${r.id}`}>
            <span className="text-xs tabular-nums text-muted-foreground">{day(r.at)}</span>
            <span className="min-w-0">
              <span className="line-clamp-2 text-foreground sm:line-clamp-none sm:truncate" title={r.reason}>{r.reason}</span>
              {r.episode && <a href={`/host/dashboard/postify?rec=${r.episode.id}`} className="text-xs font-medium text-[#053877] hover:underline dark:text-sky-300">Open the episode</a>}
              {r.extra > 0 && <span className="block text-xs text-muted-foreground">{r.extra} went on your bill as extras</span>}
            </span>
            <span className={`text-right font-semibold tabular-nums ${r.delta > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-foreground"}`}>{r.delta > 0 ? `+${r.delta}` : `−${Math.abs(r.delta)}`}</span>
            <span className="hidden text-right text-xs tabular-nums text-muted-foreground sm:block">{r.balanceAfter} left</span>
          </li>
        ))}
      </ul>
      {q.hasNextPage && (
        <button type="button" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} className="mx-auto mt-2 flex min-h-9 items-center gap-2 rounded-full border border-border px-4 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60" data-testid="credits-log-older">
          {q.isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Show older
        </button>
      )}
    </div>
  );
}
