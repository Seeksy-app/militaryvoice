import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Check, Download, Loader2, Video } from "lucide-react";

interface ZoomState { configured: boolean; connected: boolean; zoomEmail: string; autoImport: boolean }
interface ZoomRec { meetingId: string; uuid: string; topic: string; startTime: string; durationMin: number; sizeBytes: number; importable: boolean; imported: boolean }

/**
 * Integrations → Zoom: connect it, and their cloud recordings come into the
 * Library — new ones on their own, past ones from a list.
 */
export function ZoomConnect() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const zoom = useQuery<ZoomState>({ queryKey: ["/api/host/zoom"], queryFn: async () => (await apiRequest("GET", "/api/host/zoom")).json() });
  const [picking, setPicking] = useState(false);

  // Back from Zoom's approval page.
  useEffect(() => {
    const url = new URL(window.location.href);
    const z = url.searchParams.get("zoom");
    if (!z) return;
    url.searchParams.delete("zoom");
    window.history.replaceState(null, "", url.pathname + url.search);
    const said: Record<string, { title: string; description?: string; variant?: "destructive" }> = {
      connected: { title: "Zoom is connected", description: "New cloud recordings will come into your Library." },
      declined: { title: "Zoom wasn't connected", description: "You can connect it any time." },
      expired: { title: "That took too long", description: "Press Connect Zoom again.", variant: "destructive" },
      failed: { title: "Zoom didn't connect", description: "Try again in a moment.", variant: "destructive" },
    };
    if (said[z]) toast(said[z]);
    if (z === "connected") void qc.invalidateQueries({ queryKey: ["/api/host/zoom"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const auto = useMutation({
    mutationFn: async (on: boolean) => apiRequest("POST", "/api/host/zoom/auto", { on }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["/api/host/zoom"] }),
  });
  const disconnect = useMutation({
    mutationFn: async () => apiRequest("DELETE", "/api/host/zoom"),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["/api/host/zoom"] }); toast({ title: "Zoom disconnected" }); },
  });

  if (!zoom.data) return null;
  const z = zoom.data;
  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-5" data-testid="zoom-connect">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0B5CFF] text-white"><Video className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">Zoom</p>
          <p className="text-sm text-muted-foreground">
            {z.connected ? <>Connected as <span className="font-medium text-foreground">{z.zoomEmail || "your Zoom"}</span>. Cloud recordings come into your Library.</> : "Connect Zoom and your cloud recordings come into your Library, ready for Pōstify."}
          </p>
        </div>
        {z.connected ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5 rounded-full" onClick={() => setPicking(true)} data-testid="zoom-import-past"><Download className="h-3.5 w-3.5" /> Import past recordings</Button>
            <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>Disconnect</Button>
          </div>
        ) : z.configured ? (
          <Button asChild className="gap-2 rounded-full bg-[#0B5CFF] text-white hover:bg-[#0a4fe0]" data-testid="zoom-connect-button">
            <a href="/api/host/zoom/connect">Connect Zoom</a>
          </Button>
        ) : (
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">Coming soon</span>
        )}
      </div>
      {z.connected && (
        <label className="mt-4 flex cursor-pointer items-center gap-3 border-t border-border pt-4 text-sm">
          <Switch checked={z.autoImport} onCheckedChange={(v) => auto.mutate(v)} data-testid="zoom-auto" />
          Bring each new cloud recording into my Library on its own
        </label>
      )}
      <ZoomPicker open={picking} onOpenChange={setPicking} />
    </div>
  );
}

function ZoomPicker({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const recs = useQuery<ZoomRec[]>({ queryKey: ["/api/host/zoom/recordings"], queryFn: async () => (await apiRequest("GET", "/api/host/zoom/recordings")).json(), enabled: open });
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const bring = async (r: ZoomRec) => {
    setBusy(r.uuid);
    try {
      await apiRequest("POST", "/api/host/zoom/import", { uuid: r.uuid, meetingId: r.meetingId });
      setDone((d) => [...d, r.uuid]);
      void qc.invalidateQueries({ queryKey: ["/api/host/recordings"] });
      toast({ title: "Bringing it in", description: "It shows in your Library now and is ready in a few minutes." });
    } catch (e) {
      toast({ title: "Couldn't import that", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import from Zoom</DialogTitle>
          <DialogDescription>Your cloud recordings from the last 30 days. Each comes into your Library as its own episode.</DialogDescription>
        </DialogHeader>
        {recs.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : recs.error ? (
          <p className="text-sm text-destructive">{(recs.error as Error).message}</p>
        ) : !recs.data?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No cloud recordings in the last 30 days.</p>
        ) : (
          <ul className="divide-y divide-border">
            {recs.data.map((r) => {
              const inLib = r.imported || done.includes(r.uuid);
              return (
                <li key={r.uuid} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{r.topic || "Zoom meeting"}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(r.startTime).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · {r.durationMin} min{r.sizeBytes ? ` · ${Math.round(r.sizeBytes / 1048576)} MB` : ""}
                    </p>
                  </div>
                  {inLib ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600"><Check className="h-3.5 w-3.5" /> In your Library</span>
                  ) : r.importable ? (
                    <Button size="sm" variant="outline" className="rounded-full" disabled={busy !== null} onClick={() => void bring(r)}>
                      {busy === r.uuid ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Import"}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">No video</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
