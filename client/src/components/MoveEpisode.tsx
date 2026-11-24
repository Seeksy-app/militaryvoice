import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";

/** What a move needs to know about the episode and where it's going. */
export type MoveAsk = { epId: number; title: string; live: boolean; from: string; to: { id: number; title: string } };

/**
 * Moving an episode to another of your shows (Andrew, 24 Nov 2026), from the Library's menu or the episode's page.
 * A draft just moves. A published one asks once first, because it leaves one feed and turns up in the other.
 */
export function useMoveEpisode(onMoved?: (showId: number) => void) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [ask, setAsk] = useState<MoveAsk | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (m: MoveAsk) => {
    setBusy(true);
    try {
      await apiRequest("POST", `/api/host/hosting/episodes/${m.epId}/move`, { showId: m.to.id });
      await qc.invalidateQueries({ queryKey: ["/api/host/hosting"] });
      toast({ title: `Moved to ${m.to.title || "your other show"}`, description: m.live ? "It's in that show's feed now. The apps pick it up within the hour." : undefined });
      setAsk(null);
      onMoved?.(m.to.id);
    } catch (e) {
      toast({ title: "Couldn't move it", description: (e as Error).message.replace(/^\d+:\s*/, ""), variant: "destructive" });
    } finally { setBusy(false); }
  };
  const move = (m: MoveAsk) => (m.live ? setAsk(m) : void run(m));
  const dialog = (
    <Dialog open={!!ask} onOpenChange={(o) => { if (!o && !busy) setAsk(null); }}>
      <DialogContent className="max-w-md" data-testid="move-episode-confirm">
        <DialogHeader>
          <DialogTitle className="text-balance">Move "{ask?.title || "this episode"}"?</DialogTitle>
          <DialogDescription className="text-foreground">It leaves {ask?.from || "this show"} in podcast apps and shows up in {ask?.to.title || "the other show"}.</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => setAsk(null)} disabled={busy}>Cancel</Button>
          <Button onClick={() => ask && void run(ask)} disabled={busy} className="gap-1.5 bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="move-episode-go">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Move</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { move, busy, dialog };
}
