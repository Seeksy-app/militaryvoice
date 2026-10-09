import { useQuery } from "@tanstack/react-query";
import { Compass, ExternalLink } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { adminGet } from "@/lib/adminApi";

const LABELS: Record<string, string> = { "sponsor-page": "Sponsor page", home: "Homepage", "studio-slide": "Studio slide", "on-air": "On air", "watch-page": "Watch page", "existing-account": "Existing podcaster", admin: "Admin", direct: "Direct" };

const whoLabel = (w: string) => (w === "visitor" ? "A visitor (not signed in)" : w.startsWith("admin:") ? `${w.slice(6)} (admin)` : w);
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** Discovery: where visitors came from, and who's searching for what. */
export function DiscoveryStats() {
  const { data } = useQuery<{ visits: number; members: number; bySource: Record<string, { visits: number; joins: number }>; byRole: Record<string, number>; recent: { email: string; role: string; orgName: string; source: string; createdAt: string }[]; searches?: { who: string; kind: string; mode: string; q: string; platform: string; results: number; at: string }[]; searchers?: { who: string; n: number; last: string }[]; searchCount?: number }>({
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
          Where visitors came from, and who's searching for what.{" "}
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
          {/* Who's searching (9 Oct): the people, then what they asked for. */}
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Who's searching · {data?.searchCount ?? 0} searches</p>
          <ul className="mt-2 divide-y divide-border text-sm">
            {(data?.searchers ?? []).length === 0 ? <li className="py-2 text-muted-foreground">No searches logged yet. They're counted from 9 Oct.</li> : data!.searchers!.slice(0, 8).map((p) => (
              <li key={p.who} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate">{whoLabel(p.who)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{p.n} {p.n === 1 ? "search" : "searches"} · {ago(p.last)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Latest searches</p>
          <ul className="mt-2 max-h-80 divide-y divide-border overflow-y-auto text-sm">
            {(data?.searches ?? []).length === 0 ? <li className="py-2 text-muted-foreground">None yet.</li> : data!.searches!.map((x, i) => (
              <li key={i} className="py-1.5">
                <span className="flex items-baseline justify-between gap-2"><span className="min-w-0 truncate font-medium">"{x.q || "(everyone)"}"</span><span className="shrink-0 text-xs tabular-nums text-muted-foreground">{x.results} found</span></span>
                <span className="block truncate text-xs text-muted-foreground">{whoLabel(x.who)} · {x.kind === "creators" ? `creators on ${x.platform}` : x.kind === "people" ? "hosts & guests" : "podcasts"} · {ago(x.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
