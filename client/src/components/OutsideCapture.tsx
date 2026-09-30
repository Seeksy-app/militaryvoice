import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Circle, Copy, Loader2, Radio, Square, Trash2 } from "lucide-react";
import { adminGet, adminSend } from "@/lib/adminApi";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Record an outside show (Riverside, StreamYard, OBS): a stream address and
 * key for that show's host to add as a custom RTMP destination. When their
 * stream arrives it records by itself, and the file goes to the owner's
 * Library (clips and all). Keys can be removed once it's done.
 */

type Capture = { id: number; title: string; ownerEmail: string; url: string; streamKey: string; status: string; recordingId: number | null; createdAt: string; live: string };

export function OutsideCapture() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["/api/admin/captures"];
  const { data } = useQuery<{ captures: Capture[]; ready: boolean }>({ queryKey: key, queryFn: () => adminGet("/api/admin/captures"), refetchInterval: 10_000 });
  const [f, setF] = useState({ title: "", ownerEmail: "" });
  const [busy, setBusy] = useState(false);
  const say = (e: unknown) => (e as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "");
  const make = async () => {
    setBusy(true);
    try {
      await adminSend("POST", "/api/admin/captures", f);
      setF({ title: "", ownerEmail: f.ownerEmail });
      await qc.invalidateQueries({ queryKey: key });
      toast({ title: "Stream key made", description: "Send the address and key to the show's host." });
    } catch (e) {
      toast({ title: "Couldn't make it", description: say(e), variant: "destructive" });
    } finally { setBusy(false); }
  };
  const act = async (c: Capture, what: "start" | "stop" | "remove") => {
    try {
      if (what === "remove") { if (!window.confirm(`Remove the key for "${c.title}"? It stops working. Any recording stays in the Library.`)) return; await adminSend("DELETE", `/api/admin/captures/${c.id}`); }
      else await adminSend("POST", `/api/admin/captures/${c.id}/record`, { action: what });
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) { toast({ title: "Didn't work", description: say(e), variant: "destructive" }); }
  };
  const copy = (v: string, what: string) => void navigator.clipboard.writeText(v).then(() => toast({ title: `${what} copied` }));
  const receiving = (c: Capture) => /PUBLISHING|^2$|BUFFERING|^1$/.test(c.live);
  return (
    <section className="mb-8 rounded-2xl border border-border bg-card p-5 shadow-sm" data-testid="outside-capture">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#053877] text-[#F0A71F]"><Radio className="h-5 w-5" /></span>
        <div>
          <h2 className="text-lg font-bold">Record an outside show</h2>
          <p className="text-sm text-muted-foreground">On someone else's show (Riverside, StreamYard, OBS)? Make a stream key, and the host adds it as a <b>custom RTMP</b> live-stream destination. When they go live it records here by itself, and the file goes to the Library you pick, clips and all.</p>
        </div>
      </div>
      {data && !data.ready && <p className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">The studio's recording storage isn't switched on, so this can't record yet.</p>}
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="The show: e.g. Riccoh on The Vet Life" maxLength={160} data-testid="capture-title" />
        <Input type="email" value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} placeholder="Email" data-testid="capture-owner" />
        <Button onClick={() => void make()} disabled={busy || !f.title.trim() || !f.ownerEmail.includes("@")} className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="capture-make">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />} Make a stream key</Button>
      </div>
      {(data?.captures ?? []).length > 0 && (
        <div className="mt-4 space-y-3">
          {data!.captures.map((c) => (
            <div key={c.id} className="rounded-xl border border-border p-3.5" data-testid="capture-row">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 font-semibold">{c.title} <span className="text-xs font-normal text-muted-foreground">→ {c.ownerEmail}'s Library</span></p>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${c.status === "recording" ? "bg-red-500/15 text-red-600" : c.status === "done" ? "bg-emerald-500/15 text-emerald-700" : receiving(c) ? "bg-[#F0A71F]/20 text-[#8a5300]" : "bg-muted text-muted-foreground"}`}>
                  {c.status === "recording" ? <><Circle className="h-2.5 w-2.5 animate-pulse fill-current" /> Recording</> : c.status === "done" ? <><Check className="h-3 w-3" /> Recorded: in the Library</> : receiving(c) ? "Stream arriving" : "Waiting for their stream"}
                </span>
              </div>
              {c.status !== "done" && (
                <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                  {([["Stream URL (server)", c.url], ["Stream key", c.streamKey]] as const).map(([l, v]) => (
                    <button key={l} type="button" onClick={() => copy(v, l)} className="group flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-left hover:bg-muted" data-testid={`capture-copy-${l.startsWith("Stream key") ? "key" : "url"}`}>
                      <span className="min-w-0 flex-1"><span className="block text-[11px] font-semibold text-muted-foreground">{l}</span><span className="block truncate font-mono text-xs">{v}</span></span>
                      <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {c.status === "recording"
                  ? <Button size="sm" variant="outline" onClick={() => void act(c, "stop")} className="gap-1.5 rounded-full"><Square className="h-3.5 w-3.5 fill-current" /> Stop recording</Button>
                  : c.status !== "done" && <Button size="sm" variant="outline" onClick={() => void act(c, "start")} className="gap-1.5 rounded-full"><Circle className="h-3.5 w-3.5 fill-red-500 text-red-500" /> Start recording now</Button>}
                <span className="text-[11px] text-muted-foreground">{c.status === "waiting" ? "It starts by itself when their stream arrives." : ""}</span>
                <button type="button" onClick={() => void act(c, "remove")} className="ml-auto rounded-full p-1.5 text-muted-foreground hover:bg-red-50 hover:text-destructive dark:hover:bg-red-950" aria-label="Remove the key"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
