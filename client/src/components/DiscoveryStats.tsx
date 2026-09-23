import { useQuery } from "@tanstack/react-query";
import { Compass, ExternalLink } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { adminGet } from "@/lib/adminApi";

const LABELS: Record<string, string> = { "sponsor-page": "Sponsor page", home: "Homepage", "studio-slide": "Studio slide", "on-air": "On air", "watch-page": "Watch page", "existing-account": "Existing podcaster", admin: "Admin", direct: "Direct" };

/** Discovery, promoted at the event: where visitors and new accounts came from. */
export function DiscoveryStats() {
  const { data } = useQuery<{ visits: number; members: number; bySource: Record<string, { visits: number; joins: number }>; byRole: Record<string, number>; recent: { email: string; role: string; orgName: string; source: string; createdAt: string }[] }>({
    queryKey: ["/api/admin/discover/stats"],
    queryFn: () => adminGet("/api/admin/discover/stats"),
    refetchInterval: 60_000,
  });
  const rows = Object.entries(data?.bySource ?? {}).sort((a, b) => b[1].visits - a[1].visits);
  return (
    <Card data-testid="discovery-stats">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Compass className="h-4 w-4 text-primary" /> Discovery</CardTitle>
        <CardDescription>
          Promoted on the sponsor page, the homepage, a studio slide and the on-the-hour read. Where people came from, and who signed up.{" "}
          <a href="/discover" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">Open Discovery <ExternalLink className="h-3 w-3" /></a>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="flex gap-6">
            <div><div className="text-2xl font-bold tabular-nums">{data?.visits ?? 0}</div><div className="text-xs text-muted-foreground">visits</div></div>
            <div><div className="text-2xl font-bold tabular-nums">{data?.members ?? 0}</div><div className="text-xs text-muted-foreground">accounts</div></div>
            {Object.entries(data?.byRole ?? {}).map(([r, n]) => <div key={r}><div className="text-2xl font-bold tabular-nums">{n}</div><div className="text-xs capitalize text-muted-foreground">{r}s</div></div>)}
          </div>
          <table className="mt-4 w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground"><th className="py-1 font-medium">From</th><th className="py-1 text-right font-medium">Visits</th><th className="py-1 text-right font-medium">Sign-ups</th></tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={3} className="py-2 text-muted-foreground">No visits yet.</td></tr> : rows.map(([k, v]) => (
                <tr key={k} className="border-t border-border"><td className="py-1.5">{LABELS[k] ?? k}</td><td className="py-1.5 text-right tabular-nums">{v.visits}</td><td className="py-1.5 text-right tabular-nums">{v.joins}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Newest accounts</p>
          <ul className="mt-2 divide-y divide-border text-sm">
            {(data?.recent ?? []).length === 0 ? <li className="py-2 text-muted-foreground">None yet.</li> : data!.recent.map((m) => (
              <li key={m.email} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate">{m.orgName || m.email}<span className="block truncate text-xs text-muted-foreground">{m.email}</span></span>
                <span className="shrink-0 text-xs capitalize text-muted-foreground">{m.role} · {LABELS[m.source] ?? (m.source || "direct")}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
