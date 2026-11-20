import { useState } from "react";
import { Bookmark, Loader2 } from "lucide-react";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";

/**
 * "Mark a clip" (Andrew, 20 Nov: keep it): while recording, one press drops a marker at
 * this moment; Pōstify has the clip waiting after the show. Podcasting owns the API:
 * POST /api/host/my-studio/mark {} → { id, atSec, label }, 409 when not recording,
 * DELETE /api/host/my-studio/mark/:id to undo.
 */
export function MarkClip({ recording }: { recording: boolean }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const mark = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/host/my-studio/mark", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" });
      const j = (await r.json().catch(() => ({}))) as { id?: string; label?: string; message?: string };
      if (!r.ok || !j.id) throw new Error(j.message || (r.status === 409 ? "Start recording first, then mark a clip." : "Couldn't mark that. Try again."));
      const id = j.id;
      toast({
        title: `Clip marked at ${j.label}.`,
        description: "We'll have it waiting after the show.",
        action: <ToastAction altText="Undo the clip marker" onClick={() => { void fetch(`/api/host/my-studio/mark/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" }).then((x) => toast(x.ok ? { title: "Clip marker removed" } : { title: "Couldn't undo that", variant: "destructive" })); }}>Undo</ToastAction>,
      });
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  };
  return (
    <button type="button" onClick={() => void mark()} disabled={busy || !recording} title={recording ? "Mark this moment for a clip" : "Start recording first, then mark a clip."} className="hidden h-[42px] items-center gap-2 rounded-xl border border-[#f0d28a] bg-[#fff8e6] px-4 text-sm font-bold text-[#7a4e00] hover:bg-[#fff1cc] disabled:opacity-50 lg:flex" data-testid="mark-clip">
      {busy ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Bookmark className="h-[18px] w-[18px]" />}Mark a clip
    </button>
  );
}
