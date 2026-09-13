import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { RecordingRow } from "@shared/schema";
import { Disc, Download, Loader2 } from "lucide-react";

// A podcaster's own sessions. The studio writes them; nothing here is uploaded
// by hand. The bucket is private, so every download is a fresh signed link.

function duration(sec: number): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function size(bytes: string): string {
  const n = Number(bytes);
  if (!n) return "";
  const mb = n / 1_048_576;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export function MyRecordings() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<RecordingRow[]>({
    queryKey: ["/api/host/recordings"],
    queryFn: async () => (await apiRequest("GET", "/api/host/recordings")).json(),
    // A session that's still being written turns up shortly after it stops.
    refetchInterval: (q) =>
      (q.state.data ?? []).some((r) => r.status === "Recording") ? 15_000 : false,
  });

  if (isLoading || !data || data.length === 0) return null;

  async function download(id: number) {
    try {
      const res = await apiRequest("GET", `/api/host/recordings/${id}/download`);
      const { url } = (await res.json()) as { url: string };
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast({ title: "Couldn't open that file", description: (err as Error).message, variant: "destructive" });
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Disc className="h-4.5 w-4.5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-card-foreground">Your recordings</h2>
          <p className="text-sm text-muted-foreground">
            Every session we record for you lands here. Yours to keep and publish wherever you like.
          </p>
        </div>
      </div>

      <ul className="mt-5 flex flex-col gap-2">
        {data.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background p-4"
            data-testid={`recording-${r.id}`}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-card-foreground">{r.title || "Your session"}</div>
              <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                {new Date(r.startedAt).toLocaleString()}
                {[duration(r.durationSec), size(r.sizeBytes)].filter(Boolean).map((v) => ` · ${v}`)}
              </div>
            </div>

            {r.status === "Recording" ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Still recording
              </span>
            ) : r.status === "Failed" ? (
              <span className="text-xs font-medium text-destructive">Didn't save — tell us and we'll look</span>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 rounded-full"
                onClick={() => void download(r.id)}
                data-testid={`button-download-recording-${r.id}`}
              >
                <Download className="h-3.5 w-3.5" /> Download
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
