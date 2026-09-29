import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clapperboard, FileAudio, Film, Image as ImageIcon, Loader2, Podcast, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type Item = { id: number; kind: "recording" | "clip" | "episode" | "show" | "asset"; label: string; deletedAt: string; expiresAt: string };

const KINDS: Record<Item["kind"], { name: string; icon: typeof Film; back: string }> = {
  recording: { name: "Library episode", icon: Film, back: "Back in your Library" },
  clip: { name: "Clip", icon: Clapperboard, back: "Back with its episode" },
  episode: { name: "Podcast episode", icon: FileAudio, back: "Back in your podcast. If it was published, it's in your feed again" },
  show: { name: "Podcast", icon: Podcast, back: "Back, with its episodes, and its feed is on again" },
  asset: { name: "File", icon: ImageIcon, back: "Back in your files" },
};
const daysLeft = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86400_000));

/** Account > Recently deleted: 15 days to put anything back. */
export function RecentlyDeleted() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<number | null>(null);
  const list = useQuery<Item[]>({ queryKey: ["/api/host/trash"] });

  const restore = async (it: Item) => {
    setBusy(it.id);
    try {
      await apiRequest("POST", `/api/host/trash/${it.id}/restore`);
      for (const k of ["/api/host/trash", "/api/host/recordings", "/api/host/clips", "/api/host/hosting", "/api/host/assets"]) void qc.invalidateQueries({ queryKey: [k] });
      toast({ title: `“${it.label}” is back`, description: `${KINDS[it.kind].back}.` });
    } catch (e) {
      toast({ title: "Couldn't put it back", description: (e as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" });
    } finally { setBusy(null); }
  };
  const forever = async (it: Item) => {
    if (!window.confirm(`Delete “${it.label}” for good? This can't be undone.`)) return;
    setBusy(it.id);
    try {
      await apiRequest("DELETE", `/api/host/trash/${it.id}`);
      void qc.invalidateQueries({ queryKey: ["/api/host/trash"] });
    } finally { setBusy(null); }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4" data-testid="recently-deleted">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Recently deleted</h1>
        <p className="mt-1 text-sm text-muted-foreground">Anything you delete waits here for 15 days, so you can put it back just as it was. After that it's gone for good.</p>
      </div>
      {list.isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !list.data?.length ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">Nothing here. Things you delete show up here for 15 days.</div>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          {list.data.map((it) => {
            const K = KINDS[it.kind] ?? KINDS.asset;
            const d = daysLeft(it.expiresAt);
            return (
              <li key={it.id} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-0">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><K.icon className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{it.label}</span>
                  <span className={`block text-sm ${d <= 3 ? "text-destructive" : "text-muted-foreground"}`}>{K.name} · {d <= 1 ? "Gone for good tomorrow" : `${d} days left`}</span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => void forever(it)} disabled={busy !== null} className="gap-1.5 rounded-full text-muted-foreground hover:text-destructive" data-testid={`trash-forever-${it.id}`}><Trash2 className="h-4 w-4" />Delete now</Button>
                <Button size="sm" onClick={() => void restore(it)} disabled={busy !== null} className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid={`trash-restore-${it.id}`}>{busy === it.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}Put it back</Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
