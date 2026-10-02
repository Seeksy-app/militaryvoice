import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { adminSend } from "@/lib/adminApi";

const AMOUNTS = [10, 25, 50, 100];

type Bonus = { credits: number; total: number; at: string; popup: "waiting" | "seen" | "none"; seenAt: string };
const day = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
const time = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** "50 credits on Oct 2 · pop-up seen Oct 2, 3:10 PM", or "· pop-up waiting". */
export function bonusLine(b: Bonus): string {
  const what = `${b.credits} credits on ${day(b.at)}${b.total !== b.credits ? ` (${b.total} in all)` : ""}`;
  return b.popup === "waiting" ? `${what} · pop-up waiting` : b.popup === "seen" ? `${what} · pop-up seen${b.seenAt ? ` ${time(b.seenAt)}` : ""}` : what;
}

/**
 * Admin: give someone bonus Pōstify credits. They go on their ledger with the note, and (unless
 * switched off) the person gets a pop-up with confetti in their dashboard within 30 seconds.
 * `icon` is the small row button (the Podcasters list); otherwise a labelled button.
 */
export function BonusCreditsButton({ email, name, icon = false }: { email: string; name?: string; icon?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  // Every bonus given, so this button can say whether their pop-up is waiting or was seen.
  const bonuses = useQuery<Record<string, Bonus>>({ queryKey: ["/api/admin/postify/bonuses"], queryFn: async () => (await fetch("/api/admin/postify/bonuses", { credentials: "include" })).json(), staleTime: 60_000, refetchInterval: 60_000 });
  const last = bonuses.data?.[email.trim().toLowerCase()];
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
      void qc.invalidateQueries({ queryKey: ["/api/admin/postify/bonuses"] });
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
        <Button variant="ghost" size="icon" className="relative h-7 w-7" onClick={() => setOpen(true)} aria-label={`Give ${who} bonus credits`} title={last ? `Bonus credits: ${bonusLine(last)}` : "Bonus credits"} data-testid="bonus-credits-open">
          <Coins className="h-3.5 w-3.5" />
          {last && last.popup !== "none" && <span className={`absolute right-0.5 top-0.5 h-2 w-2 rounded-full ring-2 ring-card ${last.popup === "waiting" ? "bg-[#F0A71F]" : "bg-emerald-500"}`} aria-hidden="true" />}
        </Button>
      ) : (
        <span className="flex flex-col items-end">
          <Button variant="outline" onClick={() => setOpen(true)} className="h-9 gap-1.5 rounded-full" data-testid="bonus-credits-open">
            <Coins className="h-4 w-4" /> Bonus credits
          </Button>
          {last && <span className={`mt-1 text-[11px] font-medium ${last.popup === "waiting" ? "text-[#8a5a00] dark:text-[#F0A71F]" : "text-muted-foreground"}`} data-testid="bonus-credits-status">{bonusLine(last)}</span>}
        </span>
      )}
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-sm" data-testid="bonus-credits-dialog">
          <DialogHeader>
            <DialogTitle>Bonus credits for {who}</DialogTitle>
            <DialogDescription>They go straight into their Pōstify balance.</DialogDescription>
          </DialogHeader>
          {last && (
            <p className={`rounded-lg px-3 py-2 text-xs font-medium ${last.popup === "waiting" ? "bg-[#F0A71F]/15 text-[#8a5a00] dark:text-[#F0A71F]" : last.popup === "seen" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`} data-testid="bonus-credits-last">
              Last bonus: {bonusLine(last)}
            </p>
          )}
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
