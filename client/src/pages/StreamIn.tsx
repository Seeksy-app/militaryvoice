import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Cable, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandMark, BrandStack, type Brand } from "@/components/BrandMark";
import { CopyField } from "@/components/OwnEncoder";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

/**
 * Stream in: produce your show in StreamYard, Restream, OBS or anything with a
 * "custom RTMP" destination, and send it here. It records into your Library,
 * ready for clips. One key, reused for every show.
 */
type Payload = {
  configured: boolean;
  key: { url: string; streamKey: string; status: "idle" | "live" | "paused"; arriving: boolean; liveSince: string; pausedWhy: string; problem: string } | null;
  usage: { usedMin: number; capMin: number };
};

const hours = (min: number) => (min >= 60 ? `${Math.round((min / 60) * 10) / 10} hours` : `${min} minutes`);
const say = (e: unknown) => ((e as Error).message ?? "").replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "") || "Try again in a moment.";

const TOOLS: { name: string; brand: Brand; steps: string[] }[] = [
  { name: "StreamYard", brand: "streamyard", steps: ["In StreamYard, open your broadcast and choose Destinations, then Add a destination, then Custom RTMP.", "Paste the Server URL and the Stream key from this page, and save.", "Turn MilitaryVoices on, and go live as you always do."] },
  { name: "Restream", brand: "restream", steps: ["In Restream, open Channels and choose Add Channel, then Custom RTMP.", "Paste the Server URL and the Stream key from this page, and save.", "Switch the channel on, and go live as you always do."] },
  { name: "OBS or another encoder", brand: "obs", steps: ["In OBS, open Settings, then Stream, and set Service to Custom.", "Paste the Server URL and the Stream key from this page.", "Press Start Streaming. 1920×1080 at 30 frames a second is right."] },
];

export default function StreamIn() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tool, setTool] = useState(0);
  const key = ["/api/host/stream-in"];
  const { data, error, isLoading } = useQuery<Payload>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", "/api/host/stream-in")).json(),
    retry: false,
    refetchInterval: 6000,
  });
  const done = (r: Response) => r.json().then((j) => queryClient.setQueryData(key, j));
  const fail = (e: unknown) => toast({ title: "That didn't work", description: say(e), variant: "destructive" });
  const create = useMutation({ mutationFn: async () => apiRequest("POST", "/api/host/stream-in"), onSuccess: done, onError: fail });
  const renew = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/host/stream-in/new-key"),
    onSuccess: (r) => { done(r); toast({ title: "New key ready", description: "Paste it into your software. The old one has stopped working." }); },
    onError: fail,
  });

  const signedOut = (error as { status?: number } | null)?.status === 401;
  const k = data?.key ?? null;
  const pct = data && data.usage.capMin > 0 ? Math.min(100, Math.round((data.usage.usedMin / data.usage.capMin) * 100)) : 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <a href="/host/dashboard" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Your dashboard</a>

        <div className="flex items-start gap-4">
          <BrandStack brands={["streamyard", "restream", "obs"]} className="h-6 w-6" tileClassName="h-12 w-12 rounded-2xl" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Stream in</h1>
            <p className="mt-1 text-muted-foreground">Make your show in StreamYard, Restream or OBS the way you always do. Send it here too, and it lands in your Library, ready for clips.</p>
          </div>
        </div>

        {signedOut && (
          <div className="mt-8 rounded-2xl border border-border bg-card p-6">
            <p className="font-semibold text-card-foreground">Sign in to get your stream key.</p>
            <Button className="mt-3 rounded-full" asChild><a href="/host/dashboard">Sign in</a></Button>
          </div>
        )}

        {!signedOut && !isLoading && data && !data.configured && (
          <div className="mt-8 rounded-2xl border border-border bg-card p-6 text-muted-foreground">Streaming in isn't switched on yet. We'll tell you when it is.</div>
        )}

        {!signedOut && data?.configured && !k && (
          <div className="mt-8 rounded-2xl border border-border bg-card p-6">
            <p className="font-semibold text-card-foreground">One key, for every show.</p>
            <p className="mt-1 text-sm text-muted-foreground">It takes a second, and it's yours alone.</p>
            <Button className="mt-4 gap-1.5 rounded-full" disabled={create.isPending} onClick={() => create.mutate()} data-testid="button-get-stream-key">
              <Cable className="h-4 w-4" /> {create.isPending ? "Setting up…" : "Get my stream key"}
            </Button>
          </div>
        )}

        {!signedOut && k && (
          <>
            <div className="mt-8 rounded-2xl border border-border bg-card p-6" data-testid="stream-in-card">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${k.status === "live" ? "bg-red-600 text-white" : k.status === "paused" ? "bg-amber-100 text-amber-900" : "bg-muted text-muted-foreground"}`} data-testid="stream-in-status">
                  <span className={`h-2 w-2 rounded-full ${k.status === "live" ? "bg-white" : k.status === "paused" ? "bg-amber-600" : "bg-muted-foreground/60"}`} />
                  {k.status === "live" ? "Live, and recording" : k.status === "paused" ? "Paused" : k.arriving ? "Your stream is arriving" : "Waiting for your stream"}
                </span>
              </div>

              {k.problem && <p className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900" data-testid="stream-in-problem">{k.problem}</p>}
              {k.status === "paused" && k.pausedWhy && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{k.pausedWhy}</p>}

              <div className="grid gap-4 sm:grid-cols-2">
                <CopyField label="Server URL" value={k.url} />
                <CopyField label="Stream key" value={k.streamKey} secret />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Treat the key like a password. Anyone with it can stream as you.</p>

              {data && data.usage.capMin > 0 && (
                <div className="mt-5">
                  <div className="flex justify-between text-xs text-muted-foreground"><span>This month</span><span>{hours(data.usage.usedMin)} of {hours(data.usage.capMin)}</span></div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
                </div>
              )}
            </div>

            <div className="mt-6 rounded-2xl border border-border bg-card p-6">
              <h2 className="text-base font-semibold text-card-foreground">Add it to your software</h2>
              <div className="mt-3 flex flex-wrap gap-2" role="tablist">
                {TOOLS.map((t, i) => (
                  <button key={t.name} type="button" role="tab" aria-selected={i === tool} onClick={() => setTool(i)} className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium ${i === tool ? "border-[#053877] bg-[#053877]/5 text-foreground ring-1 ring-[#053877] dark:border-[#8ab4f8] dark:bg-[#8ab4f8]/10 dark:ring-[#8ab4f8]" : "border-border text-muted-foreground hover:text-foreground"}`} data-testid={`stream-in-tool-${t.brand}`}><BrandMark brand={t.brand} className="h-4 w-4" />{t.name}</button>
                ))}
              </div>
              <ol className="mt-4 flex list-decimal flex-col gap-2 pl-5 text-sm text-muted-foreground">
                {TOOLS[tool].steps.map((s) => <li key={s}>{s}</li>)}
              </ol>
              <p className="mt-4 text-sm text-muted-foreground">When you stop, the recording appears in your <a className="font-medium text-primary hover:underline" href="/host/dashboard/library">Library</a>. StreamYard lists Custom RTMP on its paid plans.</p>
            </div>

            <div className="mt-6">
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" disabled={renew.isPending} onClick={() => { if (window.confirm("Make a new key? The old one stops working, so you'll need to paste the new one into your software.")) renew.mutate(); }} data-testid="button-new-stream-key">
                <RefreshCw className="h-3.5 w-3.5" /> Make a new key
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
