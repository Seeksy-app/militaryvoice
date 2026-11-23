import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Compass } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { MyAnalytics } from "@/components/MyAnalytics";
import { FreeCounter, type FreeState } from "@/components/DiscoverFree";
import type { Shortcut } from "@/components/Shortcuts";

/**
 * "Your Discovery", the first card on the dashboard (Andrew, 23 Nov 2026: "put each user's discovery results as the
 * first pill, before New Episode"). Their own profile, the way a brand sees it in Discovery: free on every plan and
 * never one of the free look-ups.
 *
 * The card reads only what's already held (the peek never asks the index: a fresh profile costs real credits and the
 * site has a small daily budget), so a dashboard load costs nothing. The first full read happens when they open it.
 */
type Peek = { none?: boolean; cached?: boolean; platform?: string; handle?: string; credibility?: number | null; followers?: number | null };

const PEEK_KEY = ["/api/host/my-analytics", "peek"];
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n)).replace(".0", "");

export function useYourDiscoveryCard({ enabled, onOpen, onConnect }: { enabled: boolean; onOpen: () => void; onConnect: () => void }): Shortcut | null {
  const q = useQuery<Peek>({
    queryKey: PEEK_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/host/my-analytics?peek=1")).json(),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (!enabled) return null;
  const d = q.data;
  const base = { key: "your-discovery", art: "compass" as const, title: "Your Discovery" };
  if (d?.none) return { ...base, art: "link", hint: "Connect to see yours", go: onConnect };
  if (d?.cached && d.credibility != null) {
    const f = d.followers != null ? compact(d.followers) : "";
    return { ...base, score: d.credibility, hint: f ? `${f} followers` : "How brands see you", go: onOpen };
  }
  return { ...base, hint: "See how you measure up", go: onOpen };
}

/** Their own nine-section profile, in a sheet over the dashboard. */
export function YourDiscoverySheet({ open, onOpenChange, free, onFind, onConnect }: { open: boolean; onOpenChange: (o: boolean) => void; free: FreeState | null | undefined; onFind: () => void; onConnect: () => void }) {
  const qc = useQueryClient();
  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) void qc.invalidateQueries({ queryKey: PEEK_KEY, exact: true }); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[min(1120px,calc(100vw-3rem))]" data-testid="your-discovery-sheet">
        <div className="border-b border-border px-5 pb-3 pt-5 pr-12 sm:px-6">
          <SheetTitle className="text-lg font-bold">Your Discovery</SheetTitle>
          <SheetDescription asChild>
            <p className="mt-2 flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-100">
              <Compass className="h-4 w-4 shrink-0" />
              <span>This is <b>how brands see you</b> in Discovery. Free on every plan, refreshed every 30&nbsp;days.</span>
            </p>
          </SheetDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {open && <MyAnalytics onConnect={onConnect} />}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border bg-background px-5 py-3 sm:px-6">
          {free && <FreeCounter free={free} />}
          <Button onClick={onFind} className="ml-auto w-full rounded-full bg-[#053877] text-white hover:bg-[#0a4a99] sm:w-auto" data-testid="your-discovery-find">Find creators like you</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
