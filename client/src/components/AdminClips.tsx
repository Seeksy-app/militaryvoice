import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Film, RefreshCw, Download, Clock, AlertTriangle, Loader2, Play, Sparkles, ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

// What the clipper produced, where a producer can actually look at it.
//
// The endpoint for this existed for weeks and nothing rendered it, so the only
// way to see a clip was to call the API by hand. That is survivable while one
// person is testing one recording. On the day it is forty-eight segments
// finishing across one long day with no way to tell a good pick from a
// bad one, and no way to ask for another pass.

interface Clip {
  id: number;
  title: string;
  caption: string;
  reason: string;
  startSec: number;
  endSec: number;
  url: string;
  verticalUrl: string;
  squareUrl: string;
  subtitlesUrl: string;
}

interface RecordingWithClips {
  id: number;
  title: string;
  status: string;
  durationSec: number;
  sizeBytes: string;
  startedAt: string;
  email: string;
  clipStatus: string;
  clipError: string;
  clipClaimedAt: string;
  /** A podcaster's own segment, cut from the day and filed in their Library. */
  segment?: boolean;
  clips: Clip[];
}

interface PostifyRow {
  id: number;
  title: string;
  email: string;
  at: string;
  marathon: boolean;
  durationSec: number;
  clips: number;
  cleaned: boolean;
  fillers: number;
  falseStarts: number;
  pauses: number;
  removedSec: number;
  tookSec: number;
}

// The estimate, stated where it's shown: cleaning an hour of talk by hand
// takes about three hours, and finding, cutting and captioning a clip in three
// shapes about thirty minutes.
const EDIT_HOURS_PER_HOUR = 3;
const MIN_PER_CLIP = 30;
const savedMin = (r: PostifyRow) => (r.cleaned ? (r.durationSec / 60) * EDIT_HOURS_PER_HOUR : 0) + r.clips * MIN_PER_CLIP;
const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m` : `${Math.round(min)}m`);

/** What Pōstify did, as numbers worth putting in a post: the totals first, every episode under them. */
function PostifyStats({ adminGet }: { adminGet: <T>(path: string) => Promise<T> }) {
  const [scope, setScope] = useState<"marathon" | "all">("marathon");
  const [open, setOpen] = useState(false);
  const { data = [] } = useQuery<PostifyRow[]>({
    queryKey: ["/api/admin/postify/stats"],
    queryFn: () => adminGet<PostifyRow[]>("/api/admin/postify/stats"),
    refetchInterval: 60_000,
  });
  const rows = data.filter((r) => scope === "all" || r.marathon);
  const cleaned = rows.filter((r) => r.cleaned);
  const sum = (list: PostifyRow[], f: (r: PostifyRow) => number) => list.reduce((n, r) => n + f(r), 0);
  const hours = sum(rows, (r) => r.durationSec) / 3600;
  const cleanedHours = sum(cleaned, (r) => r.durationSec) / 3600;
  const fillers = sum(cleaned, (r) => r.fillers);
  const timed = rows.filter((r) => r.tookSec > 0);
  const tiles: [string, string, string][] = [
    ["Episodes", String(rows.length), `${hours.toFixed(1)} hours of talk`],
    ["Clips made", String(sum(rows, (r) => r.clips)), rows.length ? `${(sum(rows, (r) => r.clips) / rows.length).toFixed(1)} per episode` : ""],
    ["Filler words out", fillers.toLocaleString(), cleanedHours ? `${Math.round(fillers / cleanedHours)} an hour` : "no clean episodes yet"],
    ["False starts out", sum(cleaned, (r) => r.falseStarts).toLocaleString(), `${sum(cleaned, (r) => r.pauses).toLocaleString()} long pauses too`],
    ["Minutes trimmed", hm(sum(cleaned, (r) => r.removedSec) / 60), cleaned.length ? `${(sum(cleaned, (r) => r.removedSec) / 60 / cleaned.length).toFixed(1)} min per episode` : ""],
    ["Editing time saved", hm(sum(rows, savedMin)), rows.length ? `${hm(sum(rows, savedMin) / rows.length)} per episode (est.)` : ""],
    ["Ready in", timed.length ? hm(sum(timed, (r) => r.tookSec) / 60 / timed.length) : "—", "average, start to finished clips"],
  ];
  return (
    <div className="rounded-xl border border-border bg-card p-4" data-testid="postify-stats">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em]">
          <Sparkles className="h-4 w-4 text-primary" /> What Pōstify did
        </h3>
        <div className="flex gap-1 rounded-full border border-border p-0.5 text-xs">
          {(["marathon", "all"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setScope(k)} className={`rounded-full px-3 py-1 font-semibold ${scope === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`} data-testid={`postify-scope-${k}`}>
              {k === "marathon" ? "The Marathon" : "Everyone"}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {tiles.map(([label, value, sub]) => (
          <div key={label} className="rounded-lg bg-muted/50 px-3 py-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="text-xl font-bold tabular-nums">{value}</div>
            <div className="text-[11px] text-muted-foreground">{sub}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Editing time saved is an estimate: about {EDIT_HOURS_PER_HOUR} hours to clean an hour of talk by hand, and {MIN_PER_CLIP} minutes to find, cut and caption each clip in three shapes. The clean-up numbers count episodes whose clean version has finished.
      </p>
      <button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 text-xs font-semibold text-primary hover:underline" data-testid="postify-stats-toggle">
        {open ? "Hide each episode" : `Show each episode (${rows.length})`}
      </button>
      {open && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>{["Episode", "Length", "Clips", "Fillers", "False starts", "Pauses", "Trimmed", "Ready in", "Saved (est.)"].map((h) => <th key={h} className="py-1.5 pr-3 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="max-w-[280px] py-1.5 pr-3"><div className="truncate font-semibold" title={r.title}>{r.title || `Recording #${r.id}`}</div><div className="truncate text-muted-foreground">{r.email}</div></td>
                  <td className="pr-3 tabular-nums">{mmss(r.durationSec)}</td>
                  <td className="pr-3 tabular-nums">{r.clips}</td>
                  <td className="pr-3 tabular-nums">{r.cleaned ? r.fillers : "—"}</td>
                  <td className="pr-3 tabular-nums">{r.cleaned ? r.falseStarts : "—"}</td>
                  <td className="pr-3 tabular-nums">{r.cleaned ? r.pauses : "—"}</td>
                  <td className="pr-3 tabular-nums">{r.cleaned ? mmss(r.removedSec) : "—"}</td>
                  <td className="pr-3 tabular-nums">{r.tookSec ? hm(r.tookSec / 60) : "—"}</td>
                  <td className="pr-3 tabular-nums">{hm(savedMin(r))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Colour carries the state, so a failed job is visible without reading. */
function StatusBadge({ status, claimedAt }: { status: string; claimedAt: string }) {
  if (status === "running") {
    // How long it has been held matters: past ten minutes the claim goes
    // stale and another worker takes it, and knowing that stops you killing
    // something that is about to recover on its own.
    const mins = claimedAt ? Math.round((Date.now() - Date.parse(claimedAt)) / 60000) : 0;
    return (
      <Badge className="gap-1.5 bg-[#F0A71F] text-[#1a1200] hover:bg-[#F0A71F]">
        <Loader2 className="h-3 w-3 animate-spin" /> Running{mins > 0 ? ` · ${mins}m` : ""}
      </Badge>
    );
  }
  if (status === "queued") return <Badge variant="secondary" className="gap-1.5"><Clock className="h-3 w-3" /> Queued</Badge>;
  if (status === "failed") return <Badge variant="destructive" className="gap-1.5"><AlertTriangle className="h-3 w-3" /> Failed</Badge>;
  if (status === "done") return <Badge variant="outline">Done</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Not clipped</Badge>;
}

export function AdminClips({
  eventId,
  adminGet,
  adminSend,
}: {
  eventId?: number;
  adminGet: <T>(path: string) => Promise<T>;
  adminSend: (method: string, path: string, body?: unknown) => Promise<unknown>;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<number | null>(null);
  // The recording that's open in the player.
  const [watching, setWatching] = useState<{ id: number; title: string } | null>(null);
  // Each recording is one compact row; its clips open under it on a click.
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setOpenIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const qKey = ["/api/admin/clips", eventId];

  const { data: rows = [], isLoading } = useQuery<RecordingWithClips[]>({
    queryKey: qKey,
    queryFn: () => adminGet<RecordingWithClips[]>(`/api/admin/clips?eventId=${eventId ?? ""}`),
    enabled: eventId !== undefined,
    // Only while there is something to watch. Polling a finished board every
    // few seconds is a request nobody reads.
    refetchInterval: (q) =>
      (q.state.data ?? []).some((r) => r.clipStatus === "running" || r.clipStatus === "queued") ? 8000 : false,
  });

  const totals = useMemo(() => {
    const clips = rows.reduce((n, r) => n + r.clips.length, 0);
    const working = rows.filter((r) => r.clipStatus === "running" || r.clipStatus === "queued").length;
    return { clips, working, failed: rows.filter((r) => r.clipStatus === "failed").length };
  }, [rows]);

  async function reclip(id: number) {
    setBusy(id);
    try {
      await adminSend("POST", `/api/admin/recordings/${id}/reclip`);
      await queryClient.invalidateQueries({ queryKey: qKey });
      toast({ title: "Queued", description: "The next free worker will pick it up." });
    } catch (err) {
      toast({ title: "Couldn't queue that", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;

  return (
    <section className="flex flex-col gap-4" data-testid="section-admin-clips">
      <PostifyStats adminGet={adminGet} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em]">
          <Film className="h-4 w-4 text-primary" /> Recordings &amp; clips
        </h3>
        <p className="text-xs text-muted-foreground">
          {rows.length} recordings · {totals.clips} clips
          {totals.working > 0 ? ` · ${totals.working} in progress` : ""}
          {totals.failed > 0 ? ` · ${totals.failed} failed` : ""}
        </p>
      </div>

      {rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nothing recorded yet. Segments appear here as soon as a slot finishes.
        </p>
      )}

      <Dialog open={!!watching} onOpenChange={(o) => !o && setWatching(null)}>
        <DialogContent className="max-w-4xl overflow-hidden p-0">
          <DialogTitle className="px-5 pt-4 text-base">{watching?.title}</DialogTitle>
          {watching && <video controls autoPlay playsInline src={`/api/admin/recordings/${watching.id}/video`} className="aspect-video w-full bg-black" data-testid="admin-recording-player" />}
          {watching && (
            <div className="flex justify-end px-5 pb-4">
              <a href={`/api/admin/recordings/${watching.id}/video`} download className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"><Download className="h-3.5 w-3.5" /> Download</a>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {rows.map((r) => (
        <div key={r.id} className="rounded-xl border border-border" data-testid={`row-recording-${r.id}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
            {/* A frame of the recording, as in the Library: click it to watch. */}
            {r.id > 0 && r.status === "Ready" && (
              <button
                type="button"
                onClick={() => setWatching({ id: r.id, title: r.title || `Recording #${r.id}` })}
                className="group relative h-16 w-28 shrink-0 overflow-hidden rounded-lg bg-black"
                aria-label={`Watch ${r.title || "the recording"}`}
                data-testid={`button-watch-${r.id}`}
              >
                <video src={`/api/admin/recordings/${r.id}/video#t=8`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                <span className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-80 transition-opacity group-hover:opacity-100">
                  <Play className="h-5 w-5 fill-white text-white" />
                </span>
              </button>
            )}
            <button type="button" onClick={() => toggle(r.id)} className="min-w-0 flex-1 text-left" aria-expanded={openIds.has(r.id)} data-testid={`button-open-${r.id}`}>
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold">{r.title || `Recording #${r.id}`}</span>
                <StatusBadge status={r.clipStatus} claimedAt={r.clipClaimedAt} />
              </div>
              <div className="text-xs text-muted-foreground">
                {r.segment && <span className="mr-1 font-semibold text-foreground">Segment · in {r.email}'s Library ·</span>}
                {r.id < 0
                  ? `${r.clips.length} clips · on ${r.email}'s dashboard`
                  : <>{mmss(r.durationSec)} · {(Number(r.sizeBytes) / 1048576).toFixed(1)}MB · {new Date(r.startedAt).toLocaleString()}{r.email && !r.segment ? ` · ${r.email}` : ""}</>}
              </div>
            </button>
            <button type="button" onClick={() => toggle(r.id)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-primary hover:bg-muted" data-testid={`button-clips-${r.id}`}>
              {r.clips.length ? `${r.clips.length} clip${r.clips.length === 1 ? "" : "s"}` : "Clips"}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${openIds.has(r.id) ? "rotate-180" : ""}`} />
            </button>
            {r.id > 0 && <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 rounded-full text-xs"
              disabled={busy === r.id || r.status !== "Ready"}
              title={r.status !== "Ready" ? "The recording itself didn't finish" : "Cut it again"}
              onClick={() => reclip(r.id)}
              data-testid={`button-reclip-${r.id}`}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy === r.id ? "animate-spin" : ""}`} />
              {r.clips.length ? "Clip again" : "Clip it"}
            </Button>}
          </div>

          {/* The error is the useful part of a failed job, so it is shown, not
              hidden behind a hover. */}
          {r.clipError && (
            <p className="border-b border-border bg-destructive/5 px-3 py-2 text-xs text-destructive">{r.clipError}</p>
          )}

          {!openIds.has(r.id) ? null : r.clips.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              {r.clipStatus === "done" ? "Nothing in it stood alone — no clips." : "No clips yet."}
            </p>
          ) : (
            <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-4">
              {r.clips.map((c) => (
                <div key={c.id} className="flex flex-col gap-2" data-testid={`clip-${c.id}`}>
                  {/* The vertical, because it is the one that gets posted and
                      the one whose framing is worth checking at a glance. */}
                  <video
                    src={c.verticalUrl}
                    controls
                    preload="metadata"
                    className="aspect-[9/16] w-full rounded-lg bg-black object-contain"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold" title={c.title}>{c.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {mmss(c.startSec)}–{mmss(c.endSec)} · {Math.round(c.endSec - c.startSec)}s
                    </p>
                    {/* Why the picker chose it. Shown so a bad pick is legible
                        as a bad reason rather than as bad luck. */}
                    {c.reason && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{c.reason}</p>}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {([["Wide", c.url], ["Vertical", c.verticalUrl], ["Square", c.squareUrl], ["SRT", c.subtitlesUrl]] as const)
                      .filter(([, href]) => href)
                      .map(([label, href]) => (
                        <a key={label} href={href} target="_blank" rel="noreferrer" download>
                          <Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[11px]">
                            <Download className="h-3 w-3" /> {label}
                          </Button>
                        </a>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
