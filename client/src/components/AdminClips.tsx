import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Film, RefreshCw, Download, Clock, AlertTriangle, Loader2 } from "lucide-react";

// What the clipper produced, where a producer can actually look at it.
//
// The endpoint for this existed for weeks and nothing rendered it, so the only
// way to see a clip was to call the API by hand. That is survivable while one
// person is testing one recording. On the day it is forty-eight segments
// finishing across one long day with no way to tell a good pick from a
// bad one, and no way to ask for another pass.

interface Clip {
  id: number;
  title: string;
  caption: string;
  reason: string;
  startSec: number;
  endSec: number;
  url: string;
  verticalUrl: string;
  squareUrl: string;
  subtitlesUrl: string;
}

interface RecordingWithClips {
  id: number;
  title: string;
  status: string;
  durationSec: number;
  sizeBytes: string;
  startedAt: string;
  email: string;
  clipStatus: string;
  clipError: string;
  clipClaimedAt: string;
  clips: Clip[];
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Colour carries the state, so a failed job is visible without reading. */
function StatusBadge({ status, claimedAt }: { status: string; claimedAt: string }) {
  if (status === "running") {
    // How long it has been held matters: past ten minutes the claim goes
    // stale and another worker takes it, and knowing that stops you killing
    // something that is about to recover on its own.
    const mins = claimedAt ? Math.round((Date.now() - Date.parse(claimedAt)) / 60000) : 0;
    return (
      <Badge className="gap-1.5 bg-[#F0A71F] text-[#1a1200] hover:bg-[#F0A71F]">
        <Loader2 className="h-3 w-3 animate-spin" /> Running{mins > 0 ? ` · ${mins}m` : ""}
      </Badge>
    );
  }
  if (status === "queued") return <Badge variant="secondary" className="gap-1.5"><Clock className="h-3 w-3" /> Queued</Badge>;
  if (status === "failed") return <Badge variant="destructive" className="gap-1.5"><AlertTriangle className="h-3 w-3" /> Failed</Badge>;
  if (status === "done") return <Badge variant="outline">Done</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Not clipped</Badge>;
}

export function AdminClips({
  eventId,
  adminGet,
  adminSend,
}: {
  eventId?: number;
  adminGet: <T>(path: string) => Promise<T>;
  adminSend: (method: string, path: string, body?: unknown) => Promise<unknown>;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<number | null>(null);
  const qKey = ["/api/admin/clips", eventId];

  const { data: rows = [], isLoading } = useQuery<RecordingWithClips[]>({
    queryKey: qKey,
    queryFn: () => adminGet<RecordingWithClips[]>(`/api/admin/clips?eventId=${eventId ?? ""}`),
    enabled: eventId !== undefined,
    // Only while there is something to watch. Polling a finished board every
    // few seconds is a request nobody reads.
    refetchInterval: (q) =>
      (q.state.data ?? []).some((r) => r.clipStatus === "running" || r.clipStatus === "queued") ? 8000 : false,
  });

  const totals = useMemo(() => {
    const clips = rows.reduce((n, r) => n + r.clips.length, 0);
    const working = rows.filter((r) => r.clipStatus === "running" || r.clipStatus === "queued").length;
    return { clips, working, failed: rows.filter((r) => r.clipStatus === "failed").length };
  }, [rows]);

  async function reclip(id: number) {
    setBusy(id);
    try {
      await adminSend("POST", `/api/admin/recordings/${id}/reclip`);
      await queryClient.invalidateQueries({ queryKey: qKey });
      toast({ title: "Queued", description: "The next free worker will pick it up." });
    } catch (err) {
      toast({ title: "Couldn't queue that", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;

  return (
    <section className="flex flex-col gap-4" data-testid="section-admin-clips">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em]">
          <Film className="h-4 w-4 text-primary" /> Recordings &amp; clips
        </h3>
        <p className="text-xs text-muted-foreground">
          {rows.length} recordings · {totals.clips} clips
          {totals.working > 0 ? ` · ${totals.working} in progress` : ""}
          {totals.failed > 0 ? ` · ${totals.failed} failed` : ""}
        </p>
      </div>

      {rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nothing recorded yet. Segments appear here as soon as a slot finishes.
        </p>
      )}

      {rows.map((r) => (
        <div key={r.id} className="rounded-xl border border-border" data-testid={`row-recording-${r.id}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold">{r.title || `Recording #${r.id}`}</span>
                <StatusBadge status={r.clipStatus} claimedAt={r.clipClaimedAt} />
              </div>
              <div className="text-xs text-muted-foreground">
                {r.id < 0
                  ? `${r.clips.length} clips · on ${r.email}'s dashboard`
                  : <>{mmss(r.durationSec)} · {(Number(r.sizeBytes) / 1048576).toFixed(1)}MB · {new Date(r.startedAt).toLocaleString()}{r.email ? ` · ${r.email}` : ""}</>}
              </div>
            </div>
            {r.id > 0 && <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 rounded-full text-xs"
              disabled={busy === r.id || r.status !== "Ready"}
              title={r.status !== "Ready" ? "The recording itself didn't finish" : "Cut it again"}
              onClick={() => reclip(r.id)}
              data-testid={`button-reclip-${r.id}`}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy === r.id ? "animate-spin" : ""}`} />
              {r.clips.length ? "Clip again" : "Clip it"}
            </Button>}
          </div>

          {/* The error is the useful part of a failed job, so it is shown, not
              hidden behind a hover. */}
          {r.clipError && (
            <p className="border-b border-border bg-destructive/5 px-3 py-2 text-xs text-destructive">{r.clipError}</p>
          )}

          {r.clips.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              {r.clipStatus === "done" ? "Nothing in it stood alone — no clips." : "No clips yet."}
            </p>
          ) : (
            <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-4">
              {r.clips.map((c) => (
                <div key={c.id} className="flex flex-col gap-2" data-testid={`clip-${c.id}`}>
                  {/* The vertical, because it is the one that gets posted and
                      the one whose framing is worth checking at a glance. */}
                  <video
                    src={c.verticalUrl}
                    controls
                    preload="metadata"
                    className="aspect-[9/16] w-full rounded-lg bg-black object-contain"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold" title={c.title}>{c.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {mmss(c.startSec)}–{mmss(c.endSec)} · {Math.round(c.endSec - c.startSec)}s
                    </p>
                    {/* Why the picker chose it. Shown so a bad pick is legible
                        as a bad reason rather than as bad luck. */}
                    {c.reason && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{c.reason}</p>}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {([["Wide", c.url], ["Vertical", c.verticalUrl], ["Square", c.squareUrl], ["SRT", c.subtitlesUrl]] as const)
                      .filter(([, href]) => href)
                      .map(([label, href]) => (
                        <a key={label} href={href} target="_blank" rel="noreferrer" download>
                          <Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[11px]">
                            <Download className="h-3 w-3" /> {label}
                          </Button>
                        </a>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
