import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminGet, adminSend } from "@/lib/adminApi";
import { PlatformIcon } from "@/components/SocialIcons";
import type { SocialPlatform } from "@shared/schema";
import { RefreshCw, TriangleAlert, Link2Off } from "lucide-react";

// Where the lineup's follower numbers come from, and who is still missing.
//
// The plumbing for this existed for weeks and had no button, so the only way
// to look anyone up was a script — which meant the six people who signed up
// most recently had no figures at all and nothing in the product said so. The
// sponsor flyer quietly understated the lineup by however many had joined
// since somebody last remembered to run it.
//
// Two rules. Every lookup costs real money, so the button says how many it
// will make before you press it and never fires on its own. And a podcaster
// with no link to look up is a different problem from one we simply haven't
// got to — chasing them for a URL is the fix, so they are listed separately
// rather than counted as a failure.

interface Handle {
  email: string;
  platform: string;
  handle: string;
  consented: boolean;
  source: "connected" | "link";
}
interface Metric {
  id: number;
  email: string;
  platform: string;
  handle: string;
  followers: number;
  error: string;
  fetchedAt: string;
}
interface Payload {
  configured: boolean;
  handles: Handle[];
  metrics: Metric[];
  credits: unknown;
}

export interface AudienceSignup {
  id: number;
  email: string;
  podcastName: string;
  hostName: string;
}

/** Their credit object isn't documented; show whatever number is in it. */
function creditText(c: unknown): string {
  if (c == null || typeof c !== "object") return "";
  const o = c as Record<string, unknown>;
  if (typeof o.error === "string") return "";
  for (const k of ["credits", "balance", "remaining", "available", "credits_remaining"]) {
    const v = o[k];
    if (typeof v === "number") return `${v.toLocaleString()} credits left`;
    if (typeof v === "string" && v.trim()) return `${v} credits left`;
  }
  return "";
}

const norm = (s: string) => s.trim().toLowerCase();

export function AudienceFigures({ signups }: { signups: AudienceSignup[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState("");

  const { data, isLoading } = useQuery<Payload>({
    queryKey: ["/api/admin/audience"],
    queryFn: () => adminGet<Payload>("/api/admin/audience"),
  });

  const rows = useMemo(() => {
    const byEmail = new Map<string, { got: Metric[]; todo: Handle[]; failed: Metric[] }>();
    const slot = (e: string) => {
      const k = norm(e);
      if (!byEmail.has(k)) byEmail.set(k, { got: [], todo: [], failed: [] });
      return byEmail.get(k)!;
    };
    for (const m of data?.metrics ?? []) {
      if (m.error) slot(m.email).failed.push(m);
      else if (m.followers > 0) slot(m.email).got.push(m);
    }
    // A handle counts as outstanding only when nothing has answered for that
    // platform yet — the same rule the server applies when it decides what a
    // refresh would actually fetch, so the count on the button is the truth.
    for (const h of data?.handles ?? []) {
      const s = slot(h.email);
      if (!s.got.some((m) => norm(m.platform) === norm(h.platform))) s.todo.push(h);
    }
    return signups.map((sg) => {
      const s = byEmail.get(norm(sg.email)) ?? { got: [], todo: [], failed: [] };
      return { ...sg, ...s, total: s.got.reduce((n, m) => n + m.followers, 0) };
    });
  }, [data, signups]);

  const outstanding = rows.reduce((n, r) => n + r.todo.length, 0);
  const noLink = rows.filter((r) => r.got.length === 0 && r.todo.length === 0);
  const withFigures = rows.filter((r) => r.got.length > 0);
  const credit = creditText(data?.credits);

  const refresh = useMutation({
    mutationFn: async (handle?: string) =>
      (await adminSend("POST", "/api/admin/audience/refresh", handle ? { handle } : {})).json() as Promise<{
        read: number;
        results: { handle: string; platform: string; error: string }[];
      }>,
    onSuccess: (r) => {
      const failed = r.results.filter((x) => x.error).length;
      toast({
        title: `Looked up ${r.read} ${r.read === 1 ? "handle" : "handles"}`,
        description: failed ? `${failed} came back with nothing — see the rows marked below.` : "Figures updated.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audience"] });
      queryClient.invalidateQueries({ queryKey: ["/api/audience/summary"] });
    },
    onError: (e: Error) => toast({ title: "Lookup failed", description: e.message, variant: "destructive" }),
    onSettled: () => setBusy(""),
  });

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;

  if (!data?.configured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audience figures</CardTitle>
          <CardDescription>
            No influencers.club key on this deployment, so the only follower numbers we have are from podcasters who
            connected an account themselves.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Audience figures</CardTitle>
            <CardDescription>
              Followers for the sponsor pages. Connected accounts answer for themselves; for everyone else we look up
              the link they gave us — a YouTube URL is enough, and one lookup usually comes back with their Instagram
              and X as well.
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {credit && <span className="text-xs tabular-nums text-muted-foreground">{credit}</span>}
            <Button
              size="sm"
              className="gap-1.5 rounded-full"
              disabled={outstanding === 0 || refresh.isPending}
              onClick={() => {
                setBusy("all");
                refresh.mutate(undefined);
              }}
              data-testid="button-audience-refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refresh.isPending && busy === "all" ? "animate-spin" : ""}`} />
              {outstanding === 0 ? "Nothing to look up" : `Look up ${outstanding}`}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{withFigures.length}</span> of {rows.length} shows have
          figures
          {outstanding > 0 && (
            <>
              {" · "}
              <span className="font-semibold text-foreground">{outstanding}</span> handles not looked up yet
            </>
          )}
          {noLink.length > 0 && (
            <>
              {" · "}
              <span className="font-semibold text-foreground">{noLink.length}</span> gave us no link at all
            </>
          )}
          . Each lookup spends a credit, so nothing here runs on its own.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border px-3 py-2"
            data-testid={`audience-row-${r.id}`}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{r.podcastName}</div>
              <div className="truncate text-xs text-muted-foreground">{r.hostName}</div>
            </div>

            {r.got.map((m) => (
              <span
                key={m.id}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-xs"
                title={`@${m.handle}`}
              >
                <PlatformIcon platform={m.platform as SocialPlatform} className="h-3 w-3" />
                <span className="tabular-nums font-medium">{m.followers.toLocaleString()}</span>
              </span>
            ))}

            {r.got.length > 0 && r.todo.length === 0 && (
              <span className="shrink-0 text-xs font-semibold tabular-nums">{r.total.toLocaleString()}</span>
            )}

            {r.todo.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 gap-1.5 rounded-full px-2.5 text-xs"
                disabled={refresh.isPending}
                onClick={() => {
                  setBusy(r.todo[0].handle);
                  refresh.mutate(r.todo[0].handle);
                }}
                data-testid={`button-audience-one-${r.id}`}
              >
                <RefreshCw className={`h-3 w-3 ${refresh.isPending && busy === r.todo[0].handle ? "animate-spin" : ""}`} />
                Look up @{r.todo[0].handle}
              </Button>
            )}

            {/* Nothing to look up is a different problem: chase them for a
                link rather than pressing a button that cannot help. */}
            {r.got.length === 0 && r.todo.length === 0 && (
              <Badge variant="outline" className="shrink-0 gap-1 text-[11px] text-muted-foreground">
                <Link2Off className="h-3 w-3" /> No link on file
              </Badge>
            )}

            {r.failed.length > 0 && r.got.length === 0 && (
              <span
                className="flex shrink-0 items-center gap-1 text-[11px] text-[#F0A71F]"
                title={r.failed[0].error}
              >
                <TriangleAlert className="h-3 w-3" /> came back empty
              </span>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
