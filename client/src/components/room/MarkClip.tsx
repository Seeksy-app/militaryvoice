import { useState } from "react";
import { Bookmark, Loader2 } from "lucide-react";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";

/**
 * "Mark a clip" (Andrew, 20 Nov: keep it): while recording, one press drops a marker at
 * this moment; Pōstify has the clip waiting after the show. Podcasting owns the API:
 * POST /api/host/room/mark {} → { id, atSec, label }, 409 when not recording,
 * DELETE /api/host/room/mark/:id to undo.
 */
/** onStage (Studio v2, 26 Nov): the gold button just below the host's stage, right-aligned, always with its words. */
export function MarkClip({ recording, onStage = false }: { recording: boolean; onStage?: boolean }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const mark = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/host/room/mark", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" });
      const j = (await r.json().catch(() => ({}))) as { id?: string; label?: string; message?: string };
      if (!r.ok || !j.id) throw new Error(j.message || (r.status === 409 ? "Start recording first, then mark a clip." : "Couldn't mark that. Try again."));
      const id = j.id;
      toast({
        title: `Clip marked at ${j.label}.`,
        description: "We'll have it waiting after the show.",
        action: <ToastAction altText="Undo the clip marker" onClick={() => { void fetch(`/api/host/room/mark/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" }).then((x) => toast(x.ok ? { title: "Clip marker removed" } : { title: "Couldn't undo that", variant: "destructive" })); }}>Undo</ToastAction>,
      });
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  };
  // Always there (Andrew, 24 Nov: he never noticed it while it hid until recording). Before recording it says how
  // it works, on hover and on a tap (phones have no hover); icon-only below lg so it fits the phone's top bar.
  const hint = "Start recording to mark clips";
  return (
    <button type="button" onClick={() => { if (!recording) { toast({ title: `${hint}.`, description: "Press it while you record and we'll have that moment waiting as a clip." }); return; } void mark(); }}
      disabled={busy} title={recording ? "Mark this moment for a clip" : hint} aria-label={recording ? "Mark a clip" : `Mark a clip. ${hint}`}
      className={onStage
        ? `flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] bg-[#F0A71F] px-3 text-[13px] font-bold text-[#1a1200] shadow-sm hover:bg-[#f5b43a] disabled:opacity-60 ${recording ? "" : "opacity-85"}`
        : `flex h-[42px] shrink-0 items-center gap-2 rounded-xl border border-[#f0d28a] bg-[#fff8e6] px-3 text-sm font-bold text-[#7a4e00] hover:bg-[#fff1cc] disabled:opacity-50 xl:px-4 ${recording ? "" : "opacity-75"}`} data-testid="mark-clip">
      {busy ? <Loader2 className={onStage ? "h-4 w-4 animate-spin" : "h-[18px] w-[18px] animate-spin"} /> : <Bookmark className={onStage ? "h-4 w-4" : "h-[18px] w-[18px]"} />}<span className={onStage ? "" : "hidden xl:inline"}>Mark a clip</span>
    </button>
  );
}
