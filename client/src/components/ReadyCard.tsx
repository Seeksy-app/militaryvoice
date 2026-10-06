import { useState } from "react";
import { CheckCircle2, ListOrdered, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

/**
 * "No script, no air" (6 Oct AAR): a host or co-host reads their script and
 * the run of show, then says so here. Until they do, they can't put
 * themselves on stage — on show day they learned the order from the chat,
 * live, and it showed.
 */
export function ReadyCard({ eventId, slug, readyAt, onReady, dark = false }: { eventId: number; slug?: string; readyAt?: string; onReady?: (at: string) => void; dark?: boolean }) {
  const [at, setAt] = useState(readyAt || "");
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      const r = (await (await apiRequest("POST", "/api/host/ready", { eventId })).json()) as { readyAt: string };
      setAt(r.readyAt);
      onReady?.(r.readyAt);
    } catch { /* they can press again */ }
    setBusy(false);
  };
  const ros = slug ? `/event/${slug}/agenda` : "/agenda";
  const box = dark ? "bg-white/[0.06] ring-1 ring-white/15 text-white" : "border border-border bg-card";
  if (at) {
    return (
      <div className={`flex items-center gap-2.5 rounded-2xl px-4 py-3 text-sm ${box}`} data-testid="ready-done">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
        <span>You've read your script and the run of show. You're cleared to go on air.</span>
      </div>
    );
  }
  return (
    <div className={`rounded-2xl p-4 ${dark ? "bg-[#F0A71F]/15 ring-1 ring-[#F0A71F]/60 text-white" : "border-2 border-[#F0A71F]/60 bg-[#F0A71F]/10"}`} data-testid="ready-card">
      <p className="text-sm font-bold">Before you go on air</p>
      <p className={`mt-1 text-sm ${dark ? "text-white/80" : "text-muted-foreground"}`}>
        Read your script (your intros, sponsor reads and hand-offs) and the whole run of show, so you know what's before and after you.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a href={ros} target="_blank" rel="noreferrer" className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold ${dark ? "bg-white/10 hover:bg-white/20" : "bg-muted hover:bg-muted/70"}`} data-testid="ready-open-ros">
          <ListOrdered className="h-4 w-4" /> Read the run of show
        </a>
        <button type="button" onClick={() => void confirm()} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-full bg-[#053877] px-4 text-sm font-semibold text-white hover:bg-[#0a4a99] disabled:opacity-60" data-testid="ready-confirm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} I've read both. I'm ready.
        </button>
      </div>
    </div>
  );
}
