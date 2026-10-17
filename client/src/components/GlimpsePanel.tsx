import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Eye, Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import { GLIMPSE_TYPICAL_MICRO, type GlimpseState } from "@shared/glimpse";

// The Glimpse pilot (server/glimpse.ts): an outside model watches each clip
// and says what it sees, so a person can judge whether that helps framing.
// Off by default; pressing Review is the approval for that recording.

type Data = {
  on: boolean;
  capMicro: number;
  spend: { reserved: number; actual: number };
  stopped: string;
  worker: { at: string; hasKey: boolean } | null;
  recording: { id: number; title: string; email: string; durationSec: number } | null;
  clips: { id: number; title: string; reason: string; startSec: number; endSec: number; verticalUrl: string; source: string }[];
  reviews: Record<number, GlimpseState>;
  recent: { id: number; title: string }[];
};

const usd = (micro: number) => `$${(micro / 1e6).toFixed(micro < 100_000 ? 3 : 2)}`;
const t = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

function Review({ s, onVerdict }: { s: GlimpseState; onVerdict: (useful: boolean) => void }) {
  const [more, setMore] = useState(false);
  if (s.status === "queued") return <p className="text-xs text-muted-foreground">Waiting for the worker…</p>;
  if (s.status === "running") return <p className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Glimpse is watching it…</p>;
  if (s.status === "skipped") return <p className="text-xs text-muted-foreground">Skipped: {s.error}</p>;
  if (s.status === "failed") return <p className="text-xs text-destructive">{s.error}</p>;
  const o = s.observations!;
  const verdictColour = o.crop916.verdict === "yes" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : o.crop916.verdict === "no" ? "bg-destructive/10 text-destructive" : "bg-[#F0A71F]/20 text-[#8a5a00] dark:text-[#F0A71F]";
  const sections: [string, { when: string; text: string }[]][] = [
    ["Crop problems", o.crop916.problems.map((x) => ({ when: `${t(x.from)}–${t(x.to)}`, text: x.note }))],
    ["In the way", o.obstructions.map((x) => ({ when: `${t(x.from)}–${t(x.to)}`, text: x.note }))],
    ["Speaker", o.subject.map((x) => ({ when: `${t(x.from)}–${t(x.to)}`, text: x.note }))],
    ["Cuts", o.shots.map((x) => ({ when: t(x.at), text: x.note }))],
    ["On screen", o.onScreenText.map((x) => ({ when: t(x.at), text: `“${x.text}”` }))],
  ];
  const counts = sections.filter(([, v]) => v.length).map(([k, v]) => `${v.length} ${k.toLowerCase()}`).join(" · ");
  return (
    <div className="space-y-2 text-xs leading-snug">
      <div>
        <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${verdictColour}`}>Vertical crop: {o.crop916.verdict}</span>
        {o.crop916.note && <p className="mt-1 line-clamp-3 text-muted-foreground" title={o.crop916.note}>{o.crop916.note}</p>}
      </div>
      <p className="text-[11px] text-muted-foreground">{counts || "Nothing else noted"}</p>
      <button type="button" onClick={() => setMore((m) => !m)} className="text-[11px] font-semibold text-primary hover:underline">{more ? "Hide what it saw" : "Show what it saw"}</button>
      {more && (
        <div className="max-h-80 space-y-2 overflow-y-auto rounded-md bg-muted/40 p-2">
          {sections.filter(([, v]) => v.length).map(([k, v]) => (
            <div key={k}>
              <p className="font-semibold">{k}</p>
              <ul className="mt-0.5 space-y-1">
                {v.map((x, i) => <li key={i} className="flex gap-2"><span className="w-20 shrink-0 tabular-nums text-muted-foreground">{x.when}</span><span className="min-w-0">{x.text}</span></li>)}
              </ul>
            </div>
          ))}
          {o.uncertainty && <p><span className="font-semibold">Not sure of</span> <span className="text-muted-foreground">{o.uncertainty}</span></p>}
          {!!s.warnings?.length && <p className="text-amber-700 dark:text-amber-400">{s.warnings.join(" ")}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
        <span className="font-semibold">Useful?</span>
        <Button size="sm" variant={s.review?.useful === true ? "default" : "outline"} className="h-6 gap-1 px-2 text-[11px]" onClick={() => onVerdict(true)}><ThumbsUp className="h-3 w-3" /> Yes</Button>
        <Button size="sm" variant={s.review?.useful === false ? "default" : "outline"} className="h-6 gap-1 px-2 text-[11px]" onClick={() => onVerdict(false)}><ThumbsDown className="h-3 w-3" /> No</Button>
        <span className="ml-auto text-[11px] text-muted-foreground">{s.usage ? usd(s.usage.costMicro) : ""}</span>
      </div>
    </div>
  );
}

export function GlimpsePanel({ adminGet, adminSend }: { adminGet: <T>(path: string) => Promise<T>; adminSend: (method: string, path: string, body?: unknown) => Promise<unknown> }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [rec, setRec] = useState<number>(() => Number(new URLSearchParams(window.location.search).get("glimpse")) || 0);
  const [typed, setTyped] = useState(rec ? String(rec) : "");
  const [busy, setBusy] = useState(false);
  const key = ["/api/admin/glimpse", rec];
  const { data } = useQuery<Data>({
    queryKey: key,
    queryFn: () => adminGet<Data>(`/api/admin/glimpse?rec=${rec}`),
    refetchInterval: (q) => (Object.values(q.state.data?.reviews ?? {}).some((s) => s.status === "queued" || s.status === "running") ? 10_000 : false),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/admin/glimpse"] });
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); await refresh(); if (ok) toast({ title: ok }); }
    catch (e) { toast({ title: "Couldn't do that", description: (e as Error).message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  if (!data) return null;
  const used = data.spend.actual + data.spend.reserved;
  const workerLine = !data.worker ? "The clip worker hasn't checked in yet." : !data.worker.hasKey ? `The clip worker has no ELORIAN_API_KEY (checked ${ago(data.worker.at)}). Add it on Render.` : `Clip worker ready, checked ${ago(data.worker.at)}.`;
  const pending = data.clips.filter((c) => !data.reviews[c.id] || data.reviews[c.id].status === "failed").length;

  return (
    <div className="rounded-xl border border-border bg-card p-4" data-testid="glimpse-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em]"><Eye className="h-4 w-4 text-primary" /> Glimpse visual review · pilot</h3>
        <label className="flex items-center gap-2 text-xs font-semibold">
          {data.on ? "On" : "Off"}
          <Switch checked={data.on} disabled={busy} onCheckedChange={(on) => act(() => adminSend("POST", "/api/admin/glimpse/switch", { on }), on ? "Glimpse is on" : "Glimpse is off")} data-testid="glimpse-switch" />
        </label>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Today {usd(used)} of {usd(data.capMicro)} · {workerLine}
      </p>
      {data.stopped && <p className="mt-1 text-xs text-destructive">{data.stopped}</p>}

      <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); setRec(Number(typed) || 0); }}>
        <Input value={typed} onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))} placeholder="Recording #" className="h-8 w-32 text-xs" data-testid="glimpse-rec" />
        <Button type="submit" size="sm" variant="outline" className="h-8 text-xs">Open</Button>
        {data.recent.filter((r) => r.id !== rec).map((r) => (
          <button key={r.id} type="button" onClick={() => { setRec(r.id); setTyped(String(r.id)); }} className="rounded-full border border-border px-2.5 py-1 text-[11px] hover:bg-muted">{r.title}</button>
        ))}
      </form>

      {data.recording && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm"><span className="font-semibold">{data.recording.title}</span> <span className="text-muted-foreground">· {data.recording.email} · {data.clips.length} clips</span></p>
            <Button size="sm" className="h-8 text-xs" disabled={busy || !data.on || pending === 0} title={data.on ? "" : "Switch Glimpse on first"}
              onClick={() => act(() => adminSend("POST", "/api/admin/glimpse/review", { recordingId: data.recording!.id }), "Sent to the worker")} data-testid="glimpse-review">
              {pending ? `Review ${pending} clip${pending === 1 ? "" : "s"} (about ${usd(pending * GLIMPSE_TYPICAL_MICRO)})` : "All reviewed"}
            </Button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.clips.map((c) => (
              <div key={c.id} className="flex items-start gap-3 rounded-lg border border-border p-3" data-testid={`glimpse-clip-${c.id}`}>
                <video src={`${c.verticalUrl}#t=3`} controls preload="metadata" playsInline className="h-56 w-[7.9rem] shrink-0 rounded-md bg-black object-contain" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-snug [text-wrap:balance]">{c.title}</p>
                  <p className="mb-2 text-[11px] text-muted-foreground">{t(c.startSec)}–{t(c.endSec)}</p>
                  {data.reviews[c.id] ? (
                    <Review s={data.reviews[c.id]} onVerdict={(useful) => act(() => adminSend("POST", `/api/admin/glimpse/${c.id}/verdict`, { useful }))} />
                  ) : <p className="text-[11px] text-muted-foreground">Not reviewed.</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
