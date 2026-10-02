import { useState } from "react";
import { Coins, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { adminSend } from "@/lib/adminApi";

const AMOUNTS = [10, 25, 50, 100];

/**
 * Admin: give someone bonus Pōstify credits. They go on their ledger with the note, and (unless
 * switched off) the person gets a pop-up with confetti in their dashboard within 30 seconds.
 * `icon` is the small row button (the Podcasters list); otherwise a labelled button.
 */
export function BonusCreditsButton({ email, name, icon = false }: { email: string; name?: string; icon?: boolean }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [credits, setCredits] = useState(50);
  const [note, setNote] = useState("");
  const [celebrate, setCelebrate] = useState(true);
  const [busy, setBusy] = useState(false);
  const who = name || email;
  const give = async () => {
    setBusy(true);
    try {
      const r = (await (await adminSend("POST", "/api/admin/postify/bonus", { email, credits, note: note.trim(), celebrate })).json()) as { balance: number };
      setOpen(false);
      setNote("");
      toast({ title: `${credits} credits for ${who}`, description: `Their balance is ${r.balance}.${celebrate ? " They'll get the pop-up with confetti in their dashboard." : ""}` });
    } catch (e) {
      toast({ title: "Couldn't add the credits", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {icon ? (
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(true)} aria-label={`Give ${who} bonus credits`} title="Bonus credits" data-testid="bonus-credits-open">
          <Coins className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)} className="h-9 gap-1.5 rounded-full" data-testid="bonus-credits-open">
          <Coins className="h-4 w-4" /> Bonus credits
        </Button>
      )}
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-sm" data-testid="bonus-credits-dialog">
          <DialogHeader>
            <DialogTitle>Bonus credits for {who}</DialogTitle>
            <DialogDescription>They go straight into their Pōstify balance.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {AMOUNTS.map((a) => (
                <button key={a} type="button" onClick={() => setCredits(a)} className={`rounded-full border px-4 py-1.5 text-sm font-semibold tabular-nums ${credits === a ? "border-[#053877] bg-[#053877] text-white" : "border-border hover:bg-muted"}`}>{a}</button>
              ))}
              <Input type="number" min={1} max={1000} value={credits} onChange={(e) => setCredits(Math.max(1, Math.min(1000, Math.round(Number(e.target.value) || 1))))} className="h-9 w-24" aria-label="Credits" data-testid="bonus-credits-amount" />
            </div>
            <div>
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="A note for them (optional)" data-testid="bonus-credits-note" />
              <p className="mt-1 text-[11px] text-muted-foreground">Shown in their pop-up. Empty says it's a thank-you from the team.</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={celebrate} onChange={(e) => setCelebrate(e.target.checked)} className="h-4 w-4 accent-[#053877]" />
              Surprise them with a pop-up and confetti
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void give()} disabled={busy} className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="bonus-credits-give">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />} Give {credits} credits
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
