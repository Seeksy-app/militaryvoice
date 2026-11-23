import { useState } from "react";
import { ArrowRight, Check, Loader2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";

/**
 * Admin: move one hosted show to another account (Andrew, 23 Nov 2026: "Yes, build Move"). Type the account,
 * see everything that goes with it, then move. The feed address never changes; the counts before and after are shown.
 */
type Preview = {
  show: { id: number; title: string; slug: string; feed: string; artworkUrl: string; ownerEmail: string };
  from: string; to: string; toName: string;
  episodes: number; published: number; downloads: number; feedApps: number; spots: number;
  posts: number; transcripts: number; chunks: number;
  smartlink: { handle: string; moves: boolean; why: string } | null;
  stats: { id: number; source: string; moves: boolean }[];
  notes: string[];
  feed: { status: number; items: number };
};
type Done = { move: { id: string }; feed: { before: { items: number }; after: { status: number; items: number }; same: boolean } };

const msg = async (e: unknown) => { const m = (e as Error).message ?? ""; return m.replace(/^\d+:\s*/, "").replace(/^\{"message":"(.*)"\}$/, "$1"); };

export function MoveShowButton({ showId, title, onMoved, startOpen = false, to = "" }: { showId: number; title: string; onMoved: () => void; startOpen?: boolean; to?: string }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:border-[#053877]/40 hover:text-foreground" data-testid={`move-show-${showId}`}>Move</button>
      {open && <MoveShow showId={showId} title={title} initialTo={to} onClose={() => setOpen(false)} onMoved={onMoved} />}
    </>
  );
}

export function MoveShow({ showId, title, onClose, onMoved, initialTo = "" }: { showId: number; title: string; onClose: () => void; onMoved: () => void; initialTo?: string }) {
  const [to, setTo] = useState(initialTo);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [p, setP] = useState<Preview | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [undone, setUndone] = useState(false);

  const preview = async () => {
    setBusy(true); setErr(""); setP(null);
    try { setP(await (await apiRequest("GET", `/api/admin/show-move/preview?showId=${showId}&to=${encodeURIComponent(to.trim())}`)).json()); }
    catch (e) { setErr(await msg(e)); }
    setBusy(false);
  };
  const move = async () => {
    if (!p) return;
    setBusy(true); setErr("");
    try { setDone(await (await apiRequest("POST", "/api/admin/show-move", { showId, to: p.to, confirm: true })).json()); onMoved(); }
    catch (e) { setErr(await msg(e)); }
    setBusy(false);
  };
  const undo = async () => {
    if (!done) return;
    setBusy(true); setErr("");
    try { await apiRequest("POST", `/api/admin/show-moves/${encodeURIComponent(done.move.id)}/undo`); setUndone(true); onMoved(); }
    catch (e) { setErr(await msg(e)); }
    setBusy(false);
  };

  const row = (label: string, value: string | number, sub?: string) => (
    <li className="flex items-baseline justify-between gap-3 py-1.5"><span>{label}{sub && <span className="block text-xs text-muted-foreground">{sub}</span>}</span><span className="shrink-0 font-semibold tabular-nums">{value}</span></li>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose} data-testid="move-show">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-background p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-balance text-lg font-semibold">Move this show to another account</h3>
            <p className="truncate text-sm text-muted-foreground">{title}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        {!done && (
          <form onSubmit={(e) => { e.preventDefault(); void preview(); }} className="mt-4 flex gap-2">
            <Input value={to} onChange={(e) => { setTo(e.target.value); setP(null); }} placeholder="Email of the account it goes to" type="email" className="h-10" autoFocus data-testid="move-show-to" />
            <Button type="submit" disabled={busy || !to.includes("@")} className="h-10 bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="move-show-preview">{busy && !p ? <Loader2 className="h-4 w-4 animate-spin" /> : "Preview"}</Button>
          </form>
        )}
        {err && <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="move-show-error">{err}</p>}

        {p && !done && (
          <div className="mt-4 space-y-3" data-testid="move-show-plan">
            <div className="flex items-center gap-2 rounded-xl bg-muted/60 p-3 text-sm">
              <span className="min-w-0 flex-1 truncate">{p.from}</span>
              <ArrowRight className="h-4 w-4 shrink-0 text-[#053877]" />
              <span className="min-w-0 flex-1 truncate text-right font-semibold">{p.to}{p.toName && <span className="block text-xs font-normal text-muted-foreground">{p.toName}</span>}</span>
            </div>
            <ul className="divide-y rounded-xl border px-3 text-sm">
              {row("Episodes", p.episodes, `${p.published} published`)}
              {row("Feed address", "Unchanged", p.show.feed.replace(/^https?:\/\//, ""))}
              {row("Episodes in the feed now", p.feed.status === 200 ? p.feed.items : `Feed answered ${p.feed.status || "nothing"}`)}
              {row("Download history", p.downloads, "Every counted download, by day")}
              {row("Apps reading the feed", p.feedApps)}
              {p.spots > 0 && row("Sponsor spots", p.spots)}
              {row("Transcripts", p.transcripts, p.chunks ? `${p.chunks} passages for Ask my show` : undefined)}
              {p.posts > 0 && row("YouTube posting history", p.posts)}
              {p.smartlink && row(`SmartLink /${p.smartlink.handle}`, p.smartlink.moves ? "Moves" : "Stays", p.smartlink.why || "With its subscribers, visits and listener questions")}
              {p.stats.map((s) => row(`${s.source[0].toUpperCase()}${s.source.slice(1)} stats connection`, s.moves ? "Moves" : "Stays"))}
              {row("Apple and Spotify listings", "Move", "Links, directory status and the owner email stay on the show")}
            </ul>
            {p.notes.length > 0 && <ul className="space-y-1.5 text-xs text-muted-foreground">{p.notes.map((n) => <li key={n} className="rounded-lg bg-[#F0A71F]/10 px-3 py-2 text-[#8a5a00] dark:text-[#F0A71F]">{n}</li>)}</ul>}
            <Button onClick={() => void move()} disabled={busy} className="h-11 w-full gap-2 bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="move-show-go">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Move it to {p.to}
            </Button>
            <p className="text-center text-xs text-muted-foreground">You can undo it from here straight after.</p>
          </div>
        )}

        {done && (
          <div className="mt-4 space-y-3" data-testid="move-show-done">
            <p className={`flex items-center gap-2 rounded-xl p-3 text-sm font-semibold ${done.feed.same ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-destructive/10 text-destructive"}`}>
              <Check className="h-4 w-4" />
              {undone ? "Moved back." : done.feed.same ? `Moved. The feed still has ${done.feed.after.items} episodes.` : `Moved, but the feed now answers ${done.feed.after.status} with ${done.feed.after.items} episodes (was ${done.feed.before.items}). Check it.`}
            </p>
            {!undone && <Button variant="outline" onClick={() => void undo()} disabled={busy} className="w-full gap-2" data-testid="move-show-undo">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Undo</Button>}
            <Button onClick={onClose} className="w-full bg-[#053877] text-white hover:bg-[#0a4a99]">Done</Button>
          </div>
        )}
      </div>
    </div>
  );
}
