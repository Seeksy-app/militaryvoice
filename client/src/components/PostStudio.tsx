import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { MyClips } from "@/components/MyClips";
import type { CleanResult, ClipProgress, ClipRow, RecordingRow } from "@shared/schema";
import { Check, Clock3, Disc, Download, FileText, Film, Loader2, Play, Scissors, Sparkles, Wand2, AlertTriangle, Crop, Send, Upload, Headphones, Video } from "lucide-react";

// Postify: one recording going from "the segment ended" to clips ready
// to post, as the clipper actually does it. Every step and number here is what
// the worker reported (recordings.clip_progress) or what it produced (clips) —
// nothing animates on a timer pretending to work.

type Rec = RecordingRow;
type RowState = "done" | "active" | "waiting" | "soon" | "failed";

const stamp = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

function cleanOf(r: Rec | undefined): CleanResult | null {
  if (!r?.clean) return null;
  try {
    return JSON.parse(r.clean) as CleanResult;
  } catch {
    return null;
  }
}

const mmss = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s` : `${Math.round(sec)}s`);

/** The episode with the ums, false starts and dead air out — audio and video downloads. */
function CleanCard({ rec, clean }: { rec: Rec; clean: CleanResult }) {
  const bits = [
    clean.fillers ? `${clean.fillers} fillers` : "",
    clean.falseStarts ? `${clean.falseStarts} false starts` : "",
    clean.pauses ? `${clean.pauses} long pauses` : "",
  ].filter(Boolean);
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-4" data-testid="post-clean">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#053877]/10 text-[#053877] dark:text-[#8fb5e8]"><Wand2 className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Clean episode</p>
          <p className="text-xs text-muted-foreground">
            {clean.status === "failed"
              ? "Couldn't clean this one. The clips are unaffected."
              : bits.length
                ? `${bits.join(", ")} taken out${clean.removedSec ? ` — ${mmss(clean.removedSec)} shorter` : ""}.`
                : clean.status === "running"
                  ? "Taking out the ums, false starts and long pauses…"
                  : "Nothing needed taking out."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {clean.audioKey ? (
          <Button asChild variant="outline" size="sm" className="gap-1.5 rounded-full">
            <a href={`/api/host/recordings/${rec.id}/clean/audio`} data-testid="post-clean-audio"><Headphones className="h-4 w-4" /> Clean audio (MP3)</a>
          </Button>
        ) : clean.status === "running" ? (
          <Button variant="outline" size="sm" disabled className="gap-1.5 rounded-full"><Loader2 className="h-4 w-4 animate-spin" /> Audio</Button>
        ) : null}
        {clean.videoKey ? (
          <Button asChild variant="outline" size="sm" className="gap-1.5 rounded-full">
            <a href={`/api/host/recordings/${rec.id}/clean/video`} data-testid="post-clean-video"><Video className="h-4 w-4" /> Clean video (MP4)</a>
          </Button>
        ) : clean.status === "running" ? (
          <Button variant="outline" size="sm" disabled className="gap-1.5 rounded-full"><Loader2 className="h-4 w-4 animate-spin" /> Video</Button>
        ) : null}
      </div>
    </div>
  );
}

function progressOf(r: Rec | undefined): ClipProgress | null {
  if (!r?.clipProgress) return null;
  try {
    return JSON.parse(r.clipProgress) as ClipProgress;
  } catch {
    return null;
  }
}

const ORDER = ["download", "transcript", "moments", "render", "upload", "done"] as const;
const WEIGHT: Record<string, [number, number]> = { download: [0, 10], transcript: [10, 20], moments: [20, 35], render: [35, 95], upload: [95, 99], done: [100, 100] };

function overall(r: Rec, p: ClipProgress | null): number {
  if (r.clipStatus === "done") return 100;
  if (!p) return r.clipStatus === "running" ? 2 : 0;
  const [a, b] = WEIGHT[p.stage] ?? [0, 0];
  return Math.round(a + ((b - a) * (p.pct ?? 0)) / 100);
}

function stageLabel(r: Rec, p: ClipProgress | null): string {
  if (r.clipStatus === "queued") return "Waiting for the clipper…";
  if (r.clipStatus === "failed") return "Clipping stopped";
  if (r.clipStatus === "done") return "Clips ready";
  switch (p?.stage) {
    case "download": return "Loading the recording…";
    case "transcript": return "Reading the transcript…";
    case "moments": return "Finding the moments…";
    case "render": return p.detail ? `Cutting · ${p.detail}` : "Cutting the clips…";
    case "upload": return "Saving your clips…";
    default: return "Starting…";
  }
}

function Ring({ pct }: { pct: number }) {
  const R = 44, C = 2 * Math.PI * R;
  return (
    <svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90">
      <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="6" />
      <circle cx="50" cy="50" r={R} fill="none" stroke="#F0A71F" strokeWidth="6" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} style={{ transition: "stroke-dashoffset .8s ease" }} />
    </svg>
  );
}

function PipelineRow({ icon: Icon, title, detail, state }: { icon: typeof Check; title: string; detail?: string; state: RowState }) {
  return (
    <li className={`flex items-start gap-3 py-2 ${state === "soon" ? "opacity-55" : ""}`}>
      <span
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          state === "done" ? "bg-emerald-500 text-white" : state === "active" ? "bg-[#F0A71F]/15 text-[#b36b00] ring-2 ring-[#F0A71F]" : state === "failed" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"
        }`}
      >
        {state === "done" ? <Check className="h-4 w-4" /> : state === "active" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state === "failed" ? <AlertTriangle className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-medium ${state === "active" ? "text-foreground" : state === "done" ? "text-foreground" : "text-muted-foreground"}`}>{title}</span>
        {detail && <span className="block text-xs text-muted-foreground">{detail}</span>}
      </span>
      <span className={`shrink-0 text-xs font-medium ${state === "done" ? "text-emerald-600 dark:text-emerald-400" : state === "active" ? "text-[#b36b00] dark:text-[#F0A71F]" : "text-muted-foreground"}`}>
        {state === "done" ? "Done" : state === "active" ? "Working" : state === "soon" ? "Coming soon" : state === "failed" ? "Stopped" : ""}
      </span>
    </li>
  );
}

function ClipCard({ c, onPreview }: { c: ClipRow; onPreview: () => void }) {
  const src = c.verticalUrl || c.squareUrl || c.url;
  const files = [
    { href: c.verticalUrl, label: "9:16" },
    { href: c.squareUrl, label: "1:1" },
    { href: c.url, label: "16:9" },
    { href: c.subtitlesUrl, label: "SRT" },
  ].filter((f) => f.href);
  return (
    <div className="group flex w-44 shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm sm:w-48" data-testid={`post-clip-${c.id}`}>
      <button type="button" onClick={onPreview} className="relative aspect-[9/16] w-full overflow-hidden bg-black" aria-label={`Preview ${c.title}`}>
        {src && <video src={`${src}#t=1`} preload="metadata" muted playsInline className="h-full w-full object-cover" />}
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-[#000741] shadow-lg"><Play className="h-5 w-5 fill-current" /></span>
        </span>
      </button>
      <div className="flex flex-1 flex-col p-3">
        <p className="mb-1 inline-flex items-center gap-1 text-[11px] font-medium tabular-nums text-muted-foreground"><Clock3 className="h-3 w-3" /> {stamp(c.startSec)}–{stamp(c.endSec)}</p>
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{c.title}</p>
        {c.reason && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={c.reason}>{c.reason}</p>}
        <div className="mt-auto flex flex-wrap gap-1 pt-2.5">
          {files.map((f) => (
            <a key={f.label} href={f.href} target="_blank" rel="noopener noreferrer" download className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-foreground hover:border-[#053877]/40">
              <Download className="h-3 w-3" /> {f.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

/** How long a video runs, read in the browser before it's sent. */
function durationOf(file: File): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => { URL.revokeObjectURL(v.src); resolve(Number.isFinite(v.duration) ? v.duration : 0); };
    v.onerror = () => resolve(0);
    v.src = URL.createObjectURL(file);
  });
}

/** PUT with progress — fetch can't report upload progress, and an episode is hundreds of MB. */
function putWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type || "video/mp4");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload refused (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("The upload was interrupted. Check your connection and try again."));
    xhr.send(file);
  });
}

interface Beta { unlimited: boolean; used: number; limit: number; left: number | null; maxMinutes: number }

/** Once the free beta episode is used: say so, and let them ask for more. */
function WantMore() {
  const { toast } = useToast();
  const [asked, setAsked] = useState(false);
  return asked ? (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400"><Check className="h-4 w-4" /> You're on the list</span>
  ) : (
    <Button
      variant="outline"
      className="gap-2 rounded-full"
      onClick={async () => {
        try {
          await apiRequest("POST", "/api/host/pro-interest", { feature: "postify" });
          setAsked(true);
          toast({ title: "Noted — you're on the list", description: "We'll tell you first when more episodes open up." });
        } catch {
          toast({ title: "That didn't go through", description: "Try again in a moment.", variant: "destructive" });
        }
      }}
      data-testid="post-want-more"
    >
      <Sparkles className="h-4 w-4" /> Want more? Tell us
    </Button>
  );
}

/** Upload an episode and get clips back: it's filed as a recording and queued. */
function UploadEpisode({ onQueued, variant = "button", beta }: { onQueued: (id: number) => void; variant?: "button" | "card"; beta?: Beta }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  async function go(file: File) {
    if (!file.type.startsWith("video/") && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) {
      toast({ title: "That isn't a video", description: "Upload an MP4, MOV or WebM of your episode.", variant: "destructive" });
      return;
    }
    if (file.size > 2 * 1024 ** 3) {
      toast({ title: "That file is over 2GB", description: "Export a smaller copy (1080p is plenty) and try again.", variant: "destructive" });
      return;
    }
    try {
      setPct(0);
      const durationSec = await durationOf(file);
      if (beta && !beta.unlimited && durationSec > beta.maxMinutes * 60) {
        toast({ title: `The beta takes episodes up to ${beta.maxMinutes} minutes`, description: "Export a shorter cut and try again.", variant: "destructive" });
        return;
      }
      const { uploadUrl, storageKey } = (await (await apiRequest("POST", "/api/host/assets/upload-url", { fileName: file.name })).json()) as { uploadUrl: string; storageKey: string };
      await putWithProgress(uploadUrl, file, setPct);
      const { id } = (await (await apiRequest("POST", "/api/host/uploads/clip", { storageKey, fileName: file.name, durationSec, sizeBytes: file.size })).json()) as { id: number };
      toast({ title: "Got it — clipping now", description: "Watch it go below. You can leave this page; the clips will be here." });
      onQueued(id);
    } catch (e) {
      toast({ title: "Couldn't upload that", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPct(null);
      if (input.current) input.current.value = "";
    }
  }
  const picker = <input ref={input} type="file" accept="video/*" className="hidden" onChange={(e) => e.target.files?.[0] && void go(e.target.files[0])} data-testid="post-upload-input" />;
  const label = pct === null ? "Upload an episode" : pct < 100 ? `Uploading… ${pct}%` : "Queuing…";
  if (variant === "card") {
    return (
      <div className="rounded-2xl border-2 border-dashed border-[#053877]/25 bg-[#053877]/[0.03] p-8 text-center">
        {picker}
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#053877] text-[#F0A71F]"><Upload className="h-6 w-6" /></span>
        <p className="mt-3 text-lg font-semibold text-foreground">Turn an episode into clips</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Upload a video episode. We transcribe it, pick the moments that stand on their own, and cut each one vertical, square and wide with captions.</p>
        <Button onClick={() => input.current?.click()} disabled={pct !== null} className="mt-4 gap-2 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="post-upload">
          {pct === null ? <Upload className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />} {label}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">MP4 or MOV, up to 2GB{beta && !beta.unlimited ? ` and ${beta.maxMinutes} minutes · 1 free episode in the beta` : ""}.</p>
      </div>
    );
  }
  return (
    <>
      {picker}
      <Button variant="outline" onClick={() => input.current?.click()} disabled={pct !== null} className="gap-2 rounded-full" data-testid="post-upload">
        {pct === null ? <Upload className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />} {label}
      </Button>
    </>
  );
}

export function PostStudio() {
  const { toast } = useToast();
  const qc = useQueryClient();
  // ?rec=<id> from a Recordings row opens that recording here.
  const [selected, setSelected] = useState<number | null>(() => {
    const v = Number(new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("rec"));
    return Number.isFinite(v) && v > 0 ? v : null;
  });
  const [preview, setPreview] = useState<{ kind: "clip"; url: string } | { kind: "recording"; url: string } | null>(null);

  const features = useQuery<{ post: boolean; beta?: Beta }>({
    queryKey: ["/api/host/features"],
    queryFn: async () => (await apiRequest("GET", "/api/host/features")).json(),
    staleTime: 5 * 60_000,
  });
  const recs = useQuery<Rec[]>({
    queryKey: ["/api/host/recordings"],
    queryFn: async () => (await apiRequest("GET", "/api/host/recordings")).json(),
    // Live while anything is moving; still otherwise.
    refetchInterval: (q) => ((q.state.data as Rec[] | undefined)?.some((r) => r.clipStatus === "queued" || r.clipStatus === "running" || cleanOf(r)?.status === "running") ? 4000 : false),
  });
  const moving = (recs.data ?? []).some((r) => r.clipStatus === "queued" || r.clipStatus === "running");
  const clips = useQuery<ClipRow[]>({
    queryKey: ["/api/host/clips"],
    queryFn: async () => (await apiRequest("GET", "/api/host/clips")).json(),
    refetchInterval: moving ? 5000 : false,
  });

  const list = useMemo(() => (recs.data ?? []).filter((r) => r.status === "Ready").sort((a, b) => b.id - a.id), [recs.data]);
  const rec = list.find((r) => r.id === selected) ?? list[0];
  const p = progressOf(rec);
  const clean = cleanOf(rec);
  const mine = useMemo(() => (clips.data ?? []).filter((c) => c.recordingId === rec?.id).sort((a, b) => a.startSec - b.startSec), [clips.data, rec?.id]);

  useEffect(() => setPreview(null), [rec?.id]);

  // When a run finishes, the clips list needs a fresh read right away.
  useEffect(() => {
    if (rec?.clipStatus === "done") void qc.invalidateQueries({ queryKey: ["/api/host/clips"] });
  }, [rec?.clipStatus, qc]);

  const start = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/host/recordings/${id}/clip`)).json(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/host/recordings"] });
      void qc.invalidateQueries({ queryKey: ["/api/host/features"] });
    },
    onError: (e: Error) => toast({ title: "Couldn't start that", description: e.message, variant: "destructive" }),
  });

  const beta = features.data?.beta;
  const outOfBeta = Boolean(beta && !beta.unlimited && (beta.left ?? 1) <= 0);
  const betaBadge = beta && !beta.unlimited ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F0A71F]/15 px-2.5 py-1 text-xs font-semibold text-[#8a5a00] dark:text-[#F0A71F]" data-testid="post-beta">
      Beta · {outOfBeta ? "free episode used" : `${beta.left} free episode${beta.left === 1 ? "" : "s"}`}
    </span>
  ) : null;
  const queued = (id: number) => {
    void qc.invalidateQueries({ queryKey: ["/api/host/features"] });
    setSelected(id);
    void qc.invalidateQueries({ queryKey: ["/api/host/recordings"] });
  };

  // In testing: only for the accounts the server says.
  if (!features.data?.post) return null;

  if (!rec) {
    if (recs.isLoading) return null;
    return (
      <section className="mt-6" data-testid="post-studio">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#b36b00] dark:text-[#F0A71F]">Pōstify</p>
        <h2 className="mb-4 mt-1 flex flex-wrap items-center gap-3 text-2xl font-bold tracking-tight text-foreground" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>From recording to clips {betaBadge}</h2>
        {outOfBeta ? <WantMore /> : <UploadEpisode variant="card" onQueued={queued} beta={beta} />}
      </section>
    );
  }

  const at = p ? ORDER.indexOf(p.stage) : -1;
  const done = rec.clipStatus === "done";
  const running = rec.clipStatus === "running" || rec.clipStatus === "queued";
  const failed = rec.clipStatus === "failed";
  const state = (stage: (typeof ORDER)[number]): RowState => {
    if (done) return "done";
    const i = ORDER.indexOf(stage);
    if (failed) return at > i ? "done" : at === i ? "failed" : "waiting";
    if (!running) return "waiting";
    if (at > i) return "done";
    if (at === i) return "active";
    return "waiting";
  };
  const pct = overall(rec, p);
  const moments = p?.moments ?? [];
  const pickedN = done ? mine.length : moments.length;
  const readyN = done ? mine.length : p?.finished ?? 0;

  async function showRecording() {
    try {
      const { url } = (await (await apiRequest("GET", `/api/host/recordings/${rec!.id}/download`)).json()) as { url: string };
      setPreview({ kind: "recording", url });
    } catch (e) {
      toast({ title: "Couldn't open the recording", description: (e as Error).message, variant: "destructive" });
    }
  }

  // The times side by side: what was recorded, what the clean episode runs,
  // and what came out of it.
  const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
  const recorded = clean?.durationSec || rec.durationSec;
  const removed = clean?.status === "done" || clean?.removedSec ? clean?.removedSec ?? 0 : null;
  const outCount = (clean?.fillers ?? 0) + (clean?.falseStarts ?? 0);
  const stats = [
    { n: clock(recorded), label: "Recorded", color: "text-[#053877] dark:text-[#8fb5e8]" },
    { n: removed != null ? clock(Math.max(0, recorded - removed)) : "–", label: "Clean episode", color: "text-emerald-600 dark:text-emerald-400" },
    { n: removed != null ? `−${clock(removed)}` : "–", label: "Taken out", color: "text-[#b36b00] dark:text-[#F0A71F]" },
    { n: clean?.fillers != null ? String(outCount) : "–", label: "Ums and false starts", color: "text-[#ED1C24]" },
    { n: p?.words ? p.words.toLocaleString("en-US") : "–", label: "Words transcribed", color: "text-[#053877] dark:text-[#8fb5e8]" },
    { n: readyN ? String(readyN) : "–", label: "Clips ready", color: "text-violet-600 dark:text-violet-400" },
  ];

  return (
    <section className="mt-6" data-testid="post-studio">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#b36b00] dark:text-[#F0A71F]">Pōstify</p>
          <h2 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-bold tracking-tight text-foreground" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>From recording to clips {betaBadge}</h2>
        </div>
        {outOfBeta ? <WantMore /> : <UploadEpisode onQueued={queued} beta={beta} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,17rem)]">
        {/* Recordings */}
        <div className="rounded-2xl border border-border bg-card p-3">
          <p className="px-1.5 pb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Your recordings</p>
          <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto lg:max-h-[22rem]">
            {list.map((r) => {
              const on = r.id === rec.id;
              const tag = r.clipStatus === "done" ? "Clips ready" : r.clipStatus === "running" ? "Working" : r.clipStatus === "queued" ? "Queued" : r.clipStatus === "failed" ? "Stopped" : "Not clipped";
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => setSelected(r.id)} className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${on ? "border-[#053877] bg-[#053877]/[0.05]" : "border-transparent hover:bg-muted/60"}`}>
                    <span className="block truncate text-sm font-medium text-foreground">{r.title || "Session"}</span>
                    <span className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{stamp(r.durationSec)} · {new Date(r.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                      <span className={r.clipStatus === "done" ? "text-emerald-600 dark:text-emerald-400" : r.clipStatus === "running" ? "text-[#b36b00]" : ""}>{tag}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Preview */}
        <div className="flex flex-col gap-3">
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-[#050d26] ring-1 ring-black/5">
            {preview ? (
              <video key={preview.url} src={preview.url} controls autoPlay playsInline className="h-full w-full bg-black object-contain" />
            ) : running || failed ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-white">
                <div className="relative flex items-center justify-center">
                  <div className="scale-75 sm:scale-100"><Ring pct={failed ? 0 : pct} /></div>
                  <span className="absolute text-2xl font-bold tabular-nums">{failed ? "!" : `${pct}%`}</span>
                </div>
                <p className="text-lg font-semibold">{stageLabel(rec, p)}</p>
                <p className="hidden max-w-sm px-4 text-sm text-white/65 sm:block">
                  {failed ? rec.clipError || "Something went wrong. Try again below." : rec.clipStatus === "queued" ? "Next in line. This screen fills in as each step finishes." : "Every word was transcribed live, so there's no upload and no wait."}
                </p>
              </div>
            ) : done && mine[0] ? (
              <button type="button" onClick={() => setPreview({ kind: "clip", url: mine[0].url || mine[0].verticalUrl })} className="absolute inset-0">
                <video src={`${mine[0].url || mine[0].verticalUrl}#t=1`} preload="metadata" muted playsInline className="h-full w-full object-cover opacity-80" />
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/35 text-white">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 text-[#000741]"><Play className="h-6 w-6 fill-current" /></span>
                  <span className="text-sm font-medium">Play the first clip</span>
                </span>
              </button>
            ) : (
              <button type="button" onClick={() => void showRecording()} className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20"><Play className="h-6 w-6" /></span>
                <span className="text-sm text-white/75">Play the recording</span>
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#053877]/15 bg-[#053877]/[0.04] px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#053877]/10 text-[#053877] dark:text-[#8fb5e8]"><Sparkles className="h-4 w-4" /></span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{rec.title || "Session"}</p>
                <p className="text-xs text-muted-foreground">{done ? `${mine.length} clips, each in three shapes with captions` : running ? stageLabel(rec, p) : "Transcribe, pick the moments, and cut them in three shapes"}</p>
              </div>
            </div>
            {done ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400"><Check className="h-4 w-4" /> Ready</span>
            ) : running ? (
              <Button disabled className="gap-2 rounded-full"><Loader2 className="h-4 w-4 animate-spin" /> {pct}%</Button>
            ) : outOfBeta && !rec.postifyBeta ? (
              <WantMore />
            ) : (
              <Button onClick={() => start.mutate(rec.id)} disabled={start.isPending} className="gap-2 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="post-start">
                <Scissors className="h-4 w-4" /> {failed ? "Try again" : "Make clips"}
              </Button>
            )}
          </div>
        </div>

        {/* Pipeline */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="pb-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Pipeline</p>
          <ul className="divide-y divide-border/60">
            <PipelineRow icon={Disc} title="Recording saved" detail={`${stamp(rec.durationSec)} long`} state="done" />
            <PipelineRow icon={Film} title="Load the recording" detail={p?.stage === "download" && p.pct != null ? `${p.pct}%` : undefined} state={state("download")} />
            <PipelineRow icon={FileText} title="Transcript" detail={p?.words ? `${p.words.toLocaleString("en-US")} words · ${p.transcriptSource === "live" ? "written live" : "transcribed after"}` : p?.transcriptSource === "live" ? "Written live on air" : undefined} state={state("transcript")} />
            <PipelineRow icon={Sparkles} title="Pick the moments" detail={pickedN ? `${pickedN} that stand on their own` : undefined} state={state("moments")} />
            <PipelineRow icon={Crop} title="Cut in three shapes" detail={p?.stage === "render" ? p.detail : readyN ? "16:9 · 9:16 · 1:1 + captions" : undefined} state={state("render")} />
            <PipelineRow icon={Send} title="Ready to post" detail={done ? "In your dashboard" : undefined} state={done ? "done" : state("upload") === "done" ? "active" : "waiting"} />
            <PipelineRow
              icon={Wand2}
              title="Clean episode"
              detail={clean?.status === "done" ? (clean.removedSec ? `${mmss(clean.removedSec)} of ums and dead air out` : "Nothing to take out") : clean?.status === "running" ? "Taking out ums and dead air" : "Ums, false starts and dead air out"}
              state={clean?.status === "done" ? "done" : clean?.status === "running" ? "active" : clean?.status === "failed" ? "failed" : "waiting"}
            />
          </ul>
        </div>
      </div>

      {/* Results */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card px-3 py-4 text-center">
            <p className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.n}</p>
            <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {clean && <CleanCard rec={rec} clean={clean} />}

      {/* Clips, filling in */}
      {(mine.length > 0 || moments.length > 0) && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Scissors className="h-4 w-4 text-[#053877]" /> {done ? "Your clips" : "Clips being cut"}
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{done ? mine.length : `${readyN} of ${moments.length}`}</span>
          </p>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {done
              ? mine.map((c) => <ClipCard key={c.id} c={c} onPreview={() => setPreview({ kind: "clip", url: c.verticalUrl || c.url })} />)
              : moments.map((m, i) => {
                  const ready = i < readyN;
                  const working = !ready && i === readyN;
                  return (
                    <div key={i} className={`flex w-44 shrink-0 flex-col overflow-hidden rounded-2xl border sm:w-48 ${ready ? "border-emerald-400/60" : "border-border"}`}>
                      <div className="relative flex aspect-[3/4] items-center justify-center bg-gradient-to-b from-muted/60 to-muted">
                        <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white">{stamp(m.startSec)}–{stamp(m.endSec)}</span>
                        {ready ? <Check className="h-8 w-8 text-emerald-500" /> : working ? <Loader2 className="h-8 w-8 animate-spin text-[#b36b00]" /> : <Clock3 className="h-7 w-7 text-muted-foreground" />}
                      </div>
                      <div className="p-3">
                        <p className="line-clamp-2 text-sm font-semibold leading-snug">{m.title}</p>
                        <p className={`mt-1 text-xs ${ready ? "text-emerald-600" : working ? "text-[#b36b00]" : "text-muted-foreground"}`}>{ready ? "Ready" : working ? p?.detail ?? "Cutting…" : "Up next"}</p>
                      </div>
                    </div>
                  );
                })}
          </div>
        </div>
      )}
      {/* Every clip, from every recording and sent-in episode, in one place. */}
      {(clips.data?.length ?? 0) > 0 && (
        <div className="mt-10">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
            <Scissors className="h-4 w-4" /> All your clips
          </h3>
          <MyClips />
        </div>
      )}
    </section>
  );
}
