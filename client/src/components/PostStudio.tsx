import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PLANS, CREDIT_PACKS, OVERAGE_CAP_CHOICES, episodeCredits, cents, type PlanKey } from "@shared/tokens";
import { CLIP_FORMATS, DEFAULT_CLIP_OPTIONS, parseClipOptions, type ClipFormat, type ClipOptions, type EpisodeEdit } from "@shared/schema";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startPlanCheckout, openBillingPortal, startTokenCheckout } from "@/lib/tokens";
import { PostDialog } from "@/components/PostDialog";
import { durationOf, putWithProgress } from "@/lib/upload";
import { UploadRecording } from "@/components/UploadRecording";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { CleanResult, ClipProgress, ClipRow, RecordingRow } from "@shared/schema";
import { Trash2, Pencil, Coins, X, Check, Clock3, Disc, Download, FileText, Film, Loader2, Play, Pause, Music2, Scissors, Sparkles, Wand2, AlertTriangle, Crop, Send, Upload, Headphones, Video, Copy } from "lucide-react";

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
function CleanCard({ rec, clean, saved, onSaved }: { rec: Rec; clean: CleanResult; saved: Rec | null; onSaved: (id: number) => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const bits = [
    clean.fillers ? `${clean.fillers} fillers` : "",
    clean.falseStarts ? `${clean.falseStarts} false starts` : "",
    clean.pauses ? `${clean.pauses} long pauses` : "",
  ].filter(Boolean);
  const ready = clean.status === "done" && Boolean(clean.videoKey || clean.audioKey);
  const save = async () => {
    setSaving(true);
    try {
      const { id } = (await (await apiRequest("POST", `/api/host/recordings/${rec.id}/clean/save`)).json()) as { id: number };
      onSaved(id);
      toast({ title: "In your Library", description: "The clean episode sits next to your original. Nothing was replaced." });
    } catch (e) {
      toast({ title: "Couldn't save that", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className={`mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-4 ${ready ? "border-emerald-400/50 bg-emerald-500/[0.04]" : "border-border bg-card"}`} data-testid="post-clean">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${ready ? "bg-emerald-500 text-white" : "bg-[#053877]/10 text-[#053877] dark:text-[#8fb5e8]"}`}>
          {ready ? <Check className="h-5 w-5" /> : clean.status === "running" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Wand2 className="h-5 w-5" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {ready ? `Your clean episode is ready${clean.removedSec ? ` — ${mmss(clean.removedSec)} shorter` : ""}` : clean.status === "failed" ? "Clean episode" : "Cleaning your episode…"}
          </p>
          <p className="text-xs text-muted-foreground">
            {clean.status === "failed"
              ? "Couldn't clean this one. The clips are unaffected."
              : bits.length
                ? `${bits.join(", ")} taken out. Your original is untouched.`
                : clean.status === "running"
                  ? "Taking out the ums, false starts and long pauses…"
                  : "Nothing needed taking out."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {clean.audioKey && (
          <Button asChild variant="outline" size="sm" className="gap-1.5 rounded-full">
            <a href={`/api/host/recordings/${rec.id}/clean/audio`} data-testid="post-clean-audio"><Download className="h-4 w-4" /> Download audio</a>
          </Button>
        )}
        {clean.videoKey && (
          <Button asChild variant="outline" size="sm" className="gap-1.5 rounded-full">
            <a href={`/api/host/recordings/${rec.id}/clean/video`} data-testid="post-clean-video"><Download className="h-4 w-4" /> Download video</a>
          </Button>
        )}
        {clean.videoKey && (saved ? (
          <Button asChild size="sm" variant="outline" className="gap-1.5 rounded-full border-emerald-400/60 text-emerald-700 dark:text-emerald-400">
            <a href="/host/dashboard/library"><Check className="h-4 w-4" /> In your Library</a>
          </Button>
        ) : (
          <Button size="sm" onClick={() => void save()} disabled={saving} className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="post-clean-save">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Disc className="h-4 w-4" />} Add to Library
          </Button>
        ))}
        {clean.status === "running" && !clean.videoKey && (
          <Button variant="outline" size="sm" disabled className="gap-1.5 rounded-full"><Loader2 className="h-4 w-4 animate-spin" /> {clean.audioKey ? "Video" : "Audio and video"}</Button>
        )}
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

/** The render step's own line ("Clip 2 of 4 · vertical"), not one left over from the download ("611MB"). */
const renderDetail = (p: ClipProgress | null) => (p?.stage === "render" && p.detail && /\bof\b/.test(p.detail) ? p.detail : "");

function stageLabel(r: Rec, p: ClipProgress | null): string {
  if (r.clipStatus === "queued") return "Waiting for the clipper…";
  if (r.clipStatus === "failed") return "Clipping stopped";
  if (r.clipStatus === "done") return "Clips ready";
  switch (p?.stage) {
    case "download": return "Loading the recording…";
    case "transcript": return "Reading the transcript…";
    case "moments": return "Finding the moments…";
    case "render": return renderDetail(p) ? `Cutting · ${renderDetail(p)}` : "Cutting the clips…";
    case "upload": return "Saving your clips…";
    default: return "Starting…";
  }
}

// A fixed waveform, so the picture is the same every time.
const WAVE = Array.from({ length: 72 }, (_, i) => 0.22 + 0.78 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.43)));

/**
 * What the window shows while Pōstify works: a picture of the step it's
 * really on (from clip_progress), not a spinner. Loading fills the waveform
 * in; the transcript is a playhead reading across it with the word count;
 * the moments land where they really are in the episode; the cut shows the
 * three shapes and how many are finished.
 */
function WorkingScene({ rec, p, pct }: { rec: Rec; p: ClipProgress | null; pct: number }) {
  const stage = rec.clipStatus === "queued" ? "queued" : p?.stage ?? "download";
  const total = Math.max(1, rec.durationSec);
  const moments = p?.moments ?? [];
  const cutting = stage === "render" || stage === "upload";
  return (
    <div className="absolute inset-0 flex flex-col text-white">
      <div className="flex items-center justify-between px-4 pt-3 sm:px-5 sm:pt-4">
        <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold backdrop-blur">
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#F0A71F] opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#F0A71F]" /></span>
          Pōstify is working
        </span>
        <span className="text-2xl font-bold tabular-nums text-[#F0A71F] sm:text-3xl">{pct}%</span>
      </div>

      <div className="relative flex flex-1 items-center justify-center px-4 sm:px-8">
        <AnimatePresence mode="wait" initial={false}>
          {cutting ? (
            <motion.div key="cut" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-end justify-center gap-3 sm:gap-5">
              {[{ r: "16/9", w: "w-28 sm:w-44", l: "Wide" }, { r: "9/16", w: "w-14 sm:w-24", l: "Vertical" }, { r: "1/1", w: "w-20 sm:w-32", l: "Square" }].map((f, i) => (
                <motion.div key={f.l} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.25 }} className="flex flex-col items-center gap-1.5">
                  <div className={`relative overflow-hidden rounded-lg bg-white/5 ring-1 ring-white/20 ${f.w}`} style={{ aspectRatio: f.r }}>
                    <motion.div className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/15 to-transparent" animate={{ x: ["-100%", "220%"] }} transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.3, ease: "easeInOut" }} />
                    <div className="absolute inset-x-2 bottom-2 space-y-1">
                      <div className="h-1 rounded bg-[#F0A71F]/80" />
                      <div className="mx-auto h-1 w-2/3 rounded bg-white/50" />
                    </div>
                  </div>
                  <span className="text-[10px] font-medium text-white/60 sm:text-xs">{f.l}</span>
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <motion.div key="wave" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative h-24 w-full max-w-2xl sm:h-32">
              <div className="flex h-full items-center gap-[3px]">
                {/* Plain CSS, so the waveform is there even before (or without) any animation frame. */}
                {WAVE.map((h, i) => (
                  <span
                    key={i}
                    className={`flex-1 rounded-full bg-white/70 ${stage === "queued" || stage === "download" ? "animate-pulse" : "opacity-80"}`}
                    style={{ height: `${h * 100}%`, animationDelay: `${(i % 24) * 60}ms` }}
                  />
                ))}
              </div>
              {stage === "transcript" && (
                <motion.div className="absolute inset-y-[-8px] w-0.5 rounded bg-[#F0A71F] shadow-[0_0_12px_#F0A71F]" animate={{ left: ["0%", "100%"] }} transition={{ duration: 3.2, repeat: Infinity, ease: "linear" }} />
              )}
              {stage === "moments" && (
                <>
                  <motion.div className="absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-[#F0A71F]/25 to-transparent" animate={{ left: ["-10%", "100%"] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }} />
                  {moments.map((m, i) => (
                    <div
                      key={i}
                      className="absolute inset-y-[-6px] rounded-md border-2 border-[#F0A71F] bg-[#F0A71F]/25 shadow-[0_0_14px_rgba(240,167,31,0.45)]"
                      style={{ left: `${(m.startSec / total) * 100}%`, width: `${Math.max(3, ((m.endSec - m.startSec) / total) * 100)}%` }}
                    />
                  ))}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="px-4 pb-4 text-center sm:px-6 sm:pb-5">
        <p className="text-base font-semibold sm:text-lg">{stageLabel(rec, p)}</p>
        <p className="mt-0.5 text-xs text-white/60 sm:text-sm">
          {stage === "queued"
            ? "Next in line. You can leave this page; it keeps going."
            : stage === "transcript" && p?.words
              ? `${p.words.toLocaleString()} words so far`
              : stage === "moments" && moments.length
                ? `${moments.length} moment${moments.length === 1 ? "" : "s"} found: ${moments.map((m) => m.title).slice(0, 2).join(" · ")}`
                : cutting
                  ? `${p?.finished ?? 0} of ${moments.length || "?"} clips finished, each vertical, square and wide with captions`
                  : "Every step shows here as it happens. You can leave this page."}
        </p>
      </div>
    </div>
  );
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

const FORMAT_CHOICES: { f: ClipFormat; label: string; tip: string }[] = [
  { f: "vertical", label: "Vertical", tip: "9:16 — Reels, TikTok, YouTube Shorts" },
  { f: "square", label: "Square", tip: "1:1 — Instagram and Facebook feed, LinkedIn" },
  { f: "wide", label: "Wide", tip: "16:9 — YouTube, LinkedIn, X" },
];

/**
 * What to make, picked before starting: the shapes, and the caption style.
 * Not "cheap or good" — where you post, and the look you want. Only what's
 * picked is made, which is also what keeps it affordable.
 */
function ClipChoices({ opts, onChange }: { opts: ClipOptions; onChange: (o: ClipOptions) => void }) {
  // Shapes: tick any you want, untick any you don't — nothing is chosen for you.
  const toggle = (f: ClipFormat) => {
    const has = opts.formats.includes(f);
    onChange({ ...opts, formats: CLIP_FORMATS.filter((x) => (x === f ? !has : opts.formats.includes(x))) });
  };
  const glyph: Record<ClipFormat, string> = { vertical: "h-4 w-[9px]", square: "h-3.5 w-3.5", wide: "h-[9px] w-4" };
  const pill = (on: boolean) =>
    `inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
      on ? "border-[#F0A71F] bg-[#F0A71F]/15 text-white" : "border-white/20 text-white/70 hover:border-white/45 hover:text-white"
    }`;
  const box = (on: boolean, round = false) =>
    `flex h-4 w-4 shrink-0 items-center justify-center border ${round ? "rounded-full" : "rounded"} ${on ? "border-[#F0A71F] bg-[#F0A71F] text-[#1a1200]" : "border-white/40"}`;
  return (
    <div className="flex flex-col items-center gap-3" data-testid="post-choices">
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-white/55">Shapes · pick one or more</span>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {FORMAT_CHOICES.map((c) => {
            const on = opts.formats.includes(c.f);
            return (
              <Tooltip key={c.f}>
                <TooltipTrigger asChild>
                  <button type="button" onClick={() => toggle(c.f)} className={pill(on)} aria-pressed={on} data-testid={`post-format-${c.f}`}>
                    <span className={box(on)}>{on && <Check className="h-3 w-3" strokeWidth={3} />}</span>
                    <span className={`rounded-[2px] border-2 ${on ? "border-[#F0A71F]" : "border-white/50"} ${glyph[c.f]}`} aria-hidden="true" />
                    {c.label}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">{c.tip}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-white/55">Captions · pick one</span>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {([
            { v: "animated", label: "Animated", tip: "Word-by-word highlight, and the picture follows whoever's talking." },
            { v: "classic", label: "Classic", tip: "Bold captions burned in, framed on the speaker. Quicker to make." },
          ] as const).map((c) => {
            const on = opts.captions === c.v;
            return (
              <Tooltip key={c.v}>
                <TooltipTrigger asChild>
                  <button type="button" onClick={() => onChange({ ...opts, captions: c.v })} className={pill(on)} aria-pressed={on} data-testid={`post-captions-${c.v}`}>
                    <span className={box(on, true)}>{on && <span className="h-1.5 w-1.5 rounded-full bg-[#1a1200]" />}</span>
                    {c.label}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[16rem] text-xs">{c.tip}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
      <MusicPick value={opts.music ?? ""} onChange={(music) => onChange({ ...opts, music })} />
    </div>
  );
}

/** Music under the clips: none, or one of our tracks, each playable before choosing. */
function MusicPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const tracks = useQuery<{ key: string; name: string; mood: string; durationSec: number }[]>({ queryKey: ["/api/music"], queryFn: async () => (await apiRequest("GET", "/api/music")).json(), staleTime: 300_000 });
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const list = tracks.data ?? [];
  if (!list.length) return null;
  const play = (key: string) => {
    audio.current?.pause();
    if (playing === key) { setPlaying(null); return; }
    const a = new Audio(`/api/music/${key}/audio`);
    a.volume = 0.8;
    a.onended = () => setPlaying(null);
    void a.play().catch(() => setPlaying(null));
    audio.current = a;
    setPlaying(key);
  };
  const chip = (on: boolean) => `inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition-colors ${on ? "border-[#F0A71F] bg-[#F0A71F]/15 text-white" : "border-white/20 text-white/70 hover:border-white/45 hover:text-white"}`;
  return (
    <div className="flex max-w-xl flex-col items-center gap-1.5" data-testid="post-music">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-white/55">Music · optional</span>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <button type="button" onClick={() => onChange("")} className={chip(!value)} aria-pressed={!value} data-testid="post-music-none">None</button>
        {list.map((t) => (
          <span key={t.key} className={chip(value === t.key)}>
            <button type="button" onClick={() => play(t.key)} className="text-white/70 hover:text-white" aria-label={playing === t.key ? `Stop ${t.name}` : `Play ${t.name}`} title={t.mood}>
              {playing === t.key ? <Pause className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3 fill-current" />}
            </button>
            <button type="button" onClick={() => onChange(value === t.key ? "" : t.key)} aria-pressed={value === t.key} data-testid={`post-music-${t.key}`}>{t.name}</button>
          </span>
        ))}
      </div>
      {value && <p className="flex items-center gap-1 text-[11px] text-white/50"><Music2 className="h-3 w-3" /> Plays softly under talking, and full where nobody's speaking.</p>}
    </div>
  );
}

/**
 * Plans — or, on a plan, what's left this month, the limit on extra credits,
 * and Stripe's billing page. Opened from the credits chip, "Generate more",
 * and wherever an episode can't start for want of credits.
 */
function PlanDialog({ open, onOpenChange, beta, plan }: { open: boolean; onOpenChange: (v: boolean) => void; beta?: Beta; plan?: Plan | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [yearly, setYearly] = useState(false);
  const go = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
    } catch (e) {
      toast({ title: "That didn't open", description: (e as Error).message, variant: "destructive" });
      setBusy(null);
    }
  };
  const cap = useMutation({
    mutationFn: async (capCents: number) => (await apiRequest("POST", "/api/host/plan/cap", { capCents })).json(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["/api/host/features"] }),
    onError: (e: Error) => toast({ title: "Couldn't change the limit", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {plan ? (
          <>
            <DialogHeader>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#b36b00]">Your plan</p>
              <DialogTitle className="text-2xl">{plan.name}{plan.interval === "year" ? " · yearly" : ""}</DialogTitle>
              <DialogDescription>
                {plan.interval === "year" ? `${plan.credits * 12} credits a year` : `${plan.credits} credits a month`}{plan.periodEnd ? ` · next credits ${new Date(plan.periodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}.
                {plan.status === "past_due" ? " Your last payment didn't go through — update your card under Manage billing." : ""}
              </DialogDescription>
            </DialogHeader>
            <div className={`grid gap-3 ${plan.interval === "year" ? "grid-cols-1" : "grid-cols-2"}`}>
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-muted-foreground">Credits left</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{beta?.tokens ?? 0}</p>
              </div>
              {plan.interval !== "year" && <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-muted-foreground">Extra credits this month</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{cents(plan.extraCents)} <span className="text-sm font-medium text-muted-foreground">of {cents(plan.capCents)}</span></p>
              </div>}
            </div>
            {plan.interval !== "year" && <div>
              <p className="text-sm font-medium text-foreground">Your limit on extra credits a month</p>
              <p className="text-xs text-muted-foreground">When your credits run out, extras are {cents(plan.overageCents)} each and go on your next bill — never past this.</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {OVERAGE_CAP_CHOICES.map((c) => (
                  <button key={c} type="button" disabled={cap.isPending} onClick={() => cap.mutate(c)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${plan.capCents === c ? "border-[#053877] bg-[#053877] text-white" : "border-border hover:border-[#053877]/40"}`} data-testid={`plan-cap-${c}`}>
                    {c === 0 ? "No extras" : cents(c)}
                  </button>
                ))}
              </div>
            </div>}
            <Button variant="outline" onClick={() => void go("portal", openBillingPortal)} disabled={busy !== null} className="w-full gap-2 rounded-full" data-testid="plan-portal">
              {busy === "portal" && <Loader2 className="h-4 w-4 animate-spin" />} Manage billing: card, invoices, cancel
            </Button>
            <CreditPacks busy={busy} go={go} label="Need more this month? Top up once" />
          </>
        ) : (
          <>
            <DialogHeader>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#b36b00]">Beta pricing</p>
              <DialogTitle className="text-2xl">Pick a plan</DialogTitle>
              <DialogDescription>Credits every month. If you run out, extra credits go on your next bill — up to a limit you set. Cancel any time.</DialogDescription>
            </DialogHeader>
            <div className="flex justify-center">
              <div className="inline-flex rounded-full border border-border p-0.5 text-xs font-semibold">
                <button type="button" onClick={() => setYearly(false)} className={`rounded-full px-3 py-1 ${!yearly ? "bg-[#053877] text-white" : "text-muted-foreground"}`}>Monthly</button>
                <button type="button" onClick={() => setYearly(true)} className={`rounded-full px-3 py-1 ${yearly ? "bg-[#053877] text-white" : "text-muted-foreground"}`}>Yearly · 2 months free</button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.values(PLANS).map((p) => {
                const popular = "popular" in p && p.popular;
                return (
                  <div key={p.key} className={`flex flex-col rounded-2xl border p-4 ${popular ? "border-[#053877] bg-[#053877]/[0.04]" : "border-border"}`}>
                    <p className="text-sm font-semibold text-muted-foreground">{p.name}</p>
                    <p className="mt-1 text-3xl font-bold text-foreground">{cents(yearly ? Math.round(p.yearCents / 12) : p.cents)}<span className="text-sm font-medium text-muted-foreground"> /month</span></p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{yearly ? `${(p.credits * 12).toLocaleString()} credits a year, at once` : `${p.credits} credits a month`}</p>
                    <p className="mt-1 flex-1 text-xs text-muted-foreground">{p.blurb} {yearly ? `${cents(p.yearCents)} billed yearly.` : `Extra credits ${cents(p.overageCents)} each.`}</p>
                    <Button onClick={() => void go(p.key, () => startPlanCheckout(p.key, yearly ? "year" : "month"))} disabled={busy !== null} className={`mt-3 gap-2 rounded-full ${popular ? "bg-[#053877] text-white hover:bg-[#0a4a99]" : ""}`} variant={popular ? "default" : "outline"} data-testid={`plan-${p.key}`}>
                      {busy === p.key && <Loader2 className="h-4 w-4 animate-spin" />} Choose {p.name}
                    </Button>
                  </div>
                );
              })}
            </div>
            <CreditPacks busy={busy} go={go} label="Or buy credits once, no plan" />
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li><span className="font-semibold text-foreground">An episode:</span> 8 credits (12 on Pro): every clip in all three shapes with animated captions, and the clean episode.</li>
              <li><span className="font-semibold text-foreground">Classic captions:</span> 5 credits (7 on Pro).</li>
              <li><span className="font-semibold text-foreground">Music and text edits:</span> included. Your first episode is free.</li>
            </ul>
            <p className="text-center text-xs text-muted-foreground">Secure checkout by Stripe. <a href="/pricing" className="underline underline-offset-2 hover:text-foreground">All the details</a></p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Credits bought once — for anyone who'd rather not subscribe, or a subscriber topping up. */
function CreditPacks({ busy, go, label }: { busy: string | null; go: (what: string, fn: () => Promise<void>) => Promise<void>; label: string }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-foreground">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        {CREDIT_PACKS.map((p) => (
          <button
            key={p.key}
            type="button"
            disabled={busy !== null}
            onClick={() => void go(p.key, () => startTokenCheckout(p.key))}
            className="rounded-xl border border-border p-2.5 text-center transition-colors hover:border-[#053877] hover:bg-[#053877]/[0.05] disabled:opacity-60"
            data-testid={`pack-${p.key}`}
          >
            <p className="text-xs font-semibold text-muted-foreground">{p.tokens} credits</p>
            <p className="mt-0.5 text-lg font-bold text-foreground">{busy === p.key ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : `$${p.price}`}</p>
            <p className="text-[10px] text-muted-foreground">{Math.round((p.price / p.tokens) * 100)}¢ each</p>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The last card in the clips: more episodes, with the plans. */
function GenerateMore({ beta, plan }: { beta?: Beta; plan?: Plan | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[18rem] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[#053877]/25 bg-[#053877]/[0.03] p-6 text-center transition-colors hover:border-[#053877]/50 hover:bg-[#053877]/[0.06]"
        data-testid="post-generate-more"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#053877] text-[#F0A71F]"><Sparkles className="h-6 w-6" /></span>
        <span className="text-base font-semibold text-foreground">Generate more</span>
        <span className="max-w-[14rem] text-sm text-muted-foreground">Clips and a clean episode from your next one.</span>
      </button>
      <PlanDialog open={open} onOpenChange={setOpen} beta={beta} plan={plan} />
    </>
  );
}

const hms = (sec: number) => {
  const t = Math.max(0, Math.round(sec));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
};

/** An intro or outro: a short video uploaded once, remembered for next time. */
function BookendPicker({ label, value, onChange }: { label: string; value: { key: string; name: string } | null; onChange: (v: { key: string; name: string } | null) => void }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const go = async (file: File) => {
    if (!file.type.startsWith("video/")) return toast({ title: "That isn't a video", variant: "destructive" });
    if (file.size > 500 * 1024 ** 2) return toast({ title: "Keep it under 500MB", description: "An intro or outro is usually a few seconds.", variant: "destructive" });
    try {
      setPct(0);
      const { uploadUrl, storageKey } = (await (await apiRequest("POST", "/api/host/assets/upload-url", { fileName: file.name })).json()) as { uploadUrl: string; storageKey: string };
      await putWithProgress(uploadUrl, file, setPct);
      onChange({ key: storageKey, name: file.name });
    } catch (e) {
      toast({ title: "Couldn't upload that", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPct(null);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="flex min-w-0 items-center gap-2">
      <input ref={input} type="file" accept="video/*" className="hidden" onChange={(e) => e.target.files?.[0] && void go(e.target.files[0])} />
      <span className="w-12 shrink-0 text-xs font-semibold text-muted-foreground">{label}</span>
      {value ? (
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs">
          <Film className="h-3 w-3 shrink-0 text-[#053877]" /> <span className="truncate">{value.name}</span>
          <button type="button" onClick={() => onChange(null)} aria-label={`Remove ${label}`} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
        </span>
      ) : (
        <Button type="button" size="sm" variant="outline" disabled={pct !== null} onClick={() => input.current?.click()} className="h-7 gap-1.5 rounded-full text-xs">
          {pct === null ? <Upload className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />} {pct === null ? `Add ${label.toLowerCase()}` : `${pct}%`}
        </Button>
      )}
    </div>
  );
}

/**
 * Under the Viewer in Episode mode. Two things you do with a whole episode:
 * mark a moment and make it a clip; and edit the episode itself — trim the
 * ends, put an intro and outro on — into a new copy in the Library.
 */
function EpisodeTools({ rec, source, videoRef }: {
  rec: Rec; source: "clean" | "original"; videoRef: React.RefObject<HTMLVideoElement>;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const now = () => videoRef.current?.currentTime ?? 0;
  const [tab, setTab] = useState<"clip" | "edit">("clip");
  // Make a clip. Shapes start unpicked: the button counts what you choose.
  const [mark, setMark] = useState<{ in: number | null; out: number | null }>({ in: null, out: null });
  const [title, setTitle] = useState("");
  const [formats, setFormats] = useState<ClipFormat[]>([]);
  const len = mark.in !== null && mark.out !== null ? mark.out - mark.in : 0;
  const reset = () => { setMark({ in: null, out: null }); setTitle(""); setFormats([]); };
  // Where the player is, for the timeline bar; and stopping a Preview at the end mark.
  const [pos, setPos] = useState({ t: 0, d: 0 });
  const stopAt = useRef<number | null>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const tick = () => {
      setPos({ t: v.currentTime, d: Number.isFinite(v.duration) ? v.duration : 0 });
      if (stopAt.current !== null && v.currentTime >= stopAt.current) { v.pause(); stopAt.current = null; }
    };
    v.addEventListener("timeupdate", tick);
    v.addEventListener("loadedmetadata", tick);
    tick();
    return () => { v.removeEventListener("timeupdate", tick); v.removeEventListener("loadedmetadata", tick); };
  }, [videoRef, source, rec.id]);
  const seek = (t: number) => { if (videoRef.current) videoRef.current.currentTime = t; };
  const preview = () => {
    const v = videoRef.current;
    if (!v || mark.in === null) return;
    v.currentTime = mark.in;
    stopAt.current = mark.out;
    void v.play();
  };
  const pct = (t: number) => (pos.d ? `${Math.min(100, Math.max(0, (t / pos.d) * 100))}%` : "0%");
  const lengthNote = len <= 0 ? "" : len < 5 ? "Too short: at least 5 seconds" : len > 180 ? "Too long: 3 minutes at most" : `${hms(len)} long`;
  const makeClip = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/host/recordings/${rec.id}/clips`, { startSec: mark.in, endSec: mark.out, title, source: source === "clean" ? "clean" : "", formats })).json(),
    onSuccess: () => {
      reset();
      void qc.invalidateQueries({ queryKey: ["/api/host/clips"] });
      void qc.invalidateQueries({ queryKey: ["/api/host/features"] });
      toast({ title: "Making your clip", description: "It appears with your other clips in a minute or two." });
    },
    onError: (e: Error) => toast({ title: "Couldn't make that clip", description: e.message, variant: "destructive" }),
  });
  // Edit the episode
  const remember = (k: string) => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as { key: string; name: string }) : null; } catch { return null; } };
  const [intro, setIntroState] = useState(() => remember("mv_intro"));
  const [outro, setOutroState] = useState(() => remember("mv_outro"));
  const keep = (k: string, v: { key: string; name: string } | null) => { try { v ? localStorage.setItem(k, JSON.stringify(v)) : localStorage.removeItem(k); } catch { /* private mode */ } };
  const setIntro = (v: { key: string; name: string } | null) => { setIntroState(v); keep("mv_intro", v); };
  const setOutro = (v: { key: string; name: string } | null) => { setOutroState(v); keep("mv_outro", v); };
  const [trim, setTrim] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  let ed: EpisodeEdit | null = null;
  try { ed = rec.episodeEdit ? (JSON.parse(rec.episodeEdit) as EpisodeEdit) : null; } catch { ed = null; }
  const busy = ed?.status === "queued" || ed?.status === "running";
  const makeEdit = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/host/recordings/${rec.id}/episode-edit`, {
      source, trimStart: trim.start, trimEnd: trim.end, introKey: intro?.key, introName: intro?.name, outroKey: outro?.key, outroName: outro?.name,
    })).json(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/host/recordings"] });
      toast({ title: "Making your edited episode", description: "It goes into your Library as a new copy. A long episode takes a while." });
    },
    onError: (e: Error) => toast({ title: "Couldn't start that", description: e.message, variant: "destructive" }),
  });
  const tabBtn = (k: "clip" | "edit", label: string) => (
    <button type="button" onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === k ? "border-[#F0A71F] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`} data-testid={`episode-tab-${k}`}>{label}</button>
  );
  return (
    <div className="rounded-2xl border border-border bg-card" data-testid="episode-tools">
      <div className="flex gap-1 border-b border-border px-2">{tabBtn("clip", "Make a clip")}{tabBtn("edit", "Edit episode")}</div>
      {tab === "clip" ? (
        <div className="space-y-3 p-4">
          <p className="text-xs text-muted-foreground">Play or scrub the episode above. Pause where the clip should start and press <span className="font-semibold text-foreground">Set start</span>, then do the same for the end.</p>
          {/* The whole episode as a bar: your selection in gold, where you are as a line. Click to jump. */}
          <div
            role="slider"
            aria-label="Episode timeline"
            aria-valuemin={0}
            aria-valuemax={Math.round(pos.d)}
            aria-valuenow={Math.round(pos.t)}
            tabIndex={0}
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * pos.d); }}
            className="relative h-3 cursor-pointer rounded-full bg-muted"
            data-testid="clip-timeline"
          >
            {mark.in !== null && (
              <div className="absolute inset-y-0 rounded-full bg-[#F0A71F]" style={{ left: pct(mark.in), width: mark.out !== null ? `calc(${pct(mark.out)} - ${pct(mark.in)})` : "3px" }} />
            )}
            <div className="absolute -inset-y-1 w-0.5 rounded bg-[#053877] dark:bg-white" style={{ left: pct(pos.t) }} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant={mark.in === null ? "default" : "outline"} onClick={() => setMark((m) => ({ in: now(), out: m.out !== null && m.out > now() ? m.out : null }))} className={`gap-1.5 rounded-full ${mark.in === null ? "bg-[#053877] text-white hover:bg-[#0a4a99]" : ""}`} data-testid="mark-in">
              {mark.in === null ? "Set start" : `Start ${hms(mark.in)}`}
            </Button>
            <Button type="button" size="sm" variant={mark.in !== null && mark.out === null ? "default" : "outline"} onClick={() => setMark((m) => ({ ...m, out: now() }))} disabled={mark.in === null} className={`gap-1.5 rounded-full ${mark.in !== null && mark.out === null ? "bg-[#053877] text-white hover:bg-[#0a4a99]" : ""}`} data-testid="mark-out">
              {mark.out === null ? "Set end" : `End ${hms(mark.out)}`}
            </Button>
            {lengthNote && <span className={`text-xs font-semibold ${len < 5 || len > 180 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>{lengthNote}</span>}
            {mark.in !== null && mark.out !== null && (
              <Button type="button" size="sm" variant="ghost" onClick={preview} className="gap-1.5 rounded-full" data-testid="mark-preview"><Play className="h-3.5 w-3.5" /> Preview</Button>
            )}
            {(mark.in !== null || title || formats.length > 0) && (
              <button type="button" onClick={reset} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground" data-testid="mark-reset"><X className="h-3.5 w-3.5" /> Don't save this</button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={90} placeholder="Title for the clip" className="h-9 min-w-[14rem] flex-1" data-testid="mark-title" />
            <div className="flex items-center gap-1" role="group" aria-label="Shapes">
              {CLIP_FORMATS.map((f) => {
                const on = formats.includes(f);
                return (
                  <button key={f} type="button" aria-pressed={on} onClick={() => setFormats(CLIP_FORMATS.filter((x) => (x === f ? !on : formats.includes(x))))} className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize transition-colors ${on ? "border-[#053877] bg-[#053877] text-white" : "border-border bg-background text-foreground hover:border-[#053877]/50"}`} data-testid={`mark-shape-${f}`}>{f}</button>
                );
              })}
            </div>
            <Button type="button" onClick={() => makeClip.mutate()} disabled={makeClip.isPending || len < 5 || len > 180 || !title.trim() || formats.length === 0} className="gap-2 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="mark-make">
              {makeClip.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />} Make clip · {formats.length} credit{formats.length === 1 ? "" : "s"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Pick one or more shapes: 1 credit each. Animated captions, cut from the {source === "clean" ? "clean" : "original"} episode. 5 seconds to 3 minutes.</p>
        </div>
      ) : (
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-12 shrink-0 text-xs font-semibold text-muted-foreground">Trim</span>
            <Button type="button" size="sm" variant="outline" onClick={() => setTrim((t) => ({ ...t, start: now() }))} className="h-7 rounded-full text-xs" data-testid="trim-start">Start at {hms(trim.start)}</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setTrim((t) => ({ ...t, end: now() }))} className="h-7 rounded-full text-xs" data-testid="trim-end">End at {trim.end ? hms(trim.end) : "the end"}</Button>
            {(trim.start > 0 || trim.end > 0) && <button type="button" onClick={() => setTrim({ start: 0, end: 0 })} className="text-xs text-muted-foreground underline underline-offset-2">Reset</button>}
            <span className="text-[11px] text-muted-foreground">Pause where it should start or end, then press.</span>
          </div>
          <BookendPicker label="Intro" value={intro} onChange={setIntro} />
          <BookendPicker label="Outro" value={outro} onChange={setOutro} />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              {busy ? "Making your edited episode…" : ed?.status === "done" ? "Your last edit is in your Library." : ed?.status === "failed" ? `The last edit didn't work: ${ed.error || "try again"}.` : `From the ${source} episode. Saved as a new copy in your Library; nothing is replaced.`}
            </p>
            <div className="flex items-center gap-2">
              {ed?.status === "done" && <Button asChild size="sm" variant="outline" className="rounded-full"><a href="/host/dashboard/library">Open Library</a></Button>}
              <Button type="button" onClick={() => makeEdit.mutate()} disabled={busy || makeEdit.isPending || (!trim.start && !trim.end && !intro && !outro) || (trim.end > 0 && trim.end < trim.start + 5)} className="gap-2 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="edit-make">
                {busy || makeEdit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} Make edited episode
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** One button on a clip, with a hover note on where it works best. */
function Pill({ tip, children, ...rest }: { tip: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement> & { onClick?: () => void; as?: "button" }) {
  const cls = "inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-foreground hover:border-[#053877]/40 hover:bg-[#053877]/[0.04]";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {rest.href ? <a {...rest} className={cls}>{children}</a> : <button type="button" onClick={rest.onClick} className={cls}>{children}</button>}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[14rem] text-xs">{tip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A link that downloads rather than opens a tab. The clips are on Supabase's
 * public storage, a different origin, where the browser ignores `download`;
 * Supabase's own ?download= makes the file come back as an attachment.
 */
function downloadHref(url: string, name: string): string {
  if (!url || !/\/storage\/v1\/object\/public\//.test(url)) return url;
  const file = `${name.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "clip"}.${url.split("?")[0].split(".").pop() || "mp4"}`;
  return `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(file)}`;
}

/** "Edit text": the title and the gold line under it, remade in all three shapes. */
export function EditTextDialog({ c, open, onOpenChange }: { c: ClipRow; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState(c.title);
  const [subtitle, setSubtitle] = useState(c.subtitle);
  useEffect(() => {
    if (open) { setTitle(c.title); setSubtitle(c.subtitle); }
  }, [open, c.title, c.subtitle]);
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/host/clips/${c.id}/text`, { title, subtitle })).json(),
    onSuccess: () => {
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ["/api/host/clips"] });
      toast({ title: "Updating the clip", description: "All three shapes, with the new words. About a minute." });
    },
    onError: (e: Error) => toast({ title: "Couldn't update that", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit text</DialogTitle>
          <DialogDescription>The words in the band at the top of the clip. We remake the vertical, square and wide versions with them, which takes about a minute.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor={`clip-title-${c.id}`}>Title</Label>
            <Input id={`clip-title-${c.id}`} className="mt-1" value={title} maxLength={90} onChange={(e) => setTitle(e.target.value)} data-testid="input-clip-title" />
            <p className="mt-1 text-[11px] text-muted-foreground">Short reads best: six words or so.</p>
          </div>
          <div>
            <Label htmlFor={`clip-sub-${c.id}`}>Subtitle</Label>
            <Input id={`clip-sub-${c.id}`} className="mt-1" value={subtitle} maxLength={70} onChange={(e) => setSubtitle(e.target.value)} placeholder="Your show · the guest" data-testid="input-clip-subtitle" />
            <p className="mt-1 text-[11px] text-muted-foreground">The smaller gold line under the title, in capitals. Your show and the guest works well.</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !title.trim()} className="gap-2 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="button-clip-text-save">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Update clip
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ClipCard({ c, onPreview }: { c: ClipRow; onPreview: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const updating = c.editStatus === "queued" || c.editStatus === "running";
  // A clip marked in the Viewer has no files until it's made.
  const making = updating && !c.url && !c.verticalUrl && !c.squareUrl;
  const src = c.verticalUrl || c.squareUrl || c.url;
  const files = [
    { href: c.verticalUrl, label: "Vertical", tip: "9:16 — best for Instagram Reels, TikTok and YouTube Shorts." },
    { href: c.squareUrl, label: "Square", tip: "1:1 — best for the Instagram and Facebook feed, and LinkedIn." },
    { href: c.url, label: "Wide", tip: "16:9 — best for YouTube, LinkedIn and X." },
  ].filter((f) => f.href);
  return (
    <>
    <div className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm" data-testid={`post-clip-${c.id}`}>
      <button type="button" onClick={onPreview} className="relative aspect-[9/16] w-full overflow-hidden bg-black" aria-label={`Preview ${c.title}`}>
        {src && <video src={`${src}#t=1`} preload="metadata" muted playsInline className="h-full w-full object-cover" />}
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-[#000741] shadow-lg"><Play className="h-5 w-5 fill-current" /></span>
        </span>
        {updating && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#000741]/75 text-white backdrop-blur-[2px]">
            <Loader2 className="h-6 w-6 animate-spin text-[#F0A71F]" />
            <span className="text-xs font-semibold">{making ? "Making your clip…" : "Updating the text…"}</span>
          </span>
        )}
      </button>
      <div className="flex flex-1 flex-col p-3">
        <p className="mb-1 inline-flex items-center gap-1 text-[11px] font-medium tabular-nums text-muted-foreground"><Clock3 className="h-3 w-3" /> {stamp(c.startSec)}–{stamp(c.endSec)}</p>
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{updating && c.editTitle ? c.editTitle : c.title}</p>
        {c.editStatus === "failed" && <p className="mt-1 text-xs text-destructive">Couldn't update the text. Try again.</p>}
        {c.reason && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={c.reason}>{c.reason}</p>}
        <div className={`mt-auto flex flex-wrap gap-1 pt-2.5 ${making ? "hidden" : ""}`}>
          {files.map((f) => (
            <Pill key={f.label} tip={f.tip} href={downloadHref(f.href, `${c.title} ${f.label.toLowerCase()}`)} download>
              <Download className="h-3 w-3" /> {f.label}
            </Pill>
          ))}
          {c.caption && (
            <Pill
              tip="Copies the words to post with it — paste them into Instagram, TikTok or LinkedIn."
              onClick={() =>
                navigator.clipboard.writeText(c.caption).then(
                  () => toast({ title: "Caption copied", description: "Paste it in with the clip." }),
                  () => toast({ title: "Couldn't copy", description: c.caption }),
                )
              }
            >
              <Copy className="h-3 w-3" /> Caption
            </Pill>
          )}
          <Pill tip="Play it here." onClick={onPreview}>
            <Play className="h-3 w-3" /> Watch
          </Pill>
          <Pill tip="Post it to your accounts, now or later." onClick={() => setPosting(true)}>
            <Send className="h-3 w-3" /> Post it
          </Pill>
          <Pill tip="Delete this clip." onClick={() => setDeleting(true)}>
            <Trash2 className="h-3 w-3" /> Delete
          </Pill>
          {!updating && (
            <Pill tip="Change the title and the gold line under it. All three shapes are remade." onClick={() => setEditing(true)}>
              <Pencil className="h-3 w-3" /> Edit text
            </Pill>
          )}
          {c.subtitlesUrl && (
            <Pill tip="The words as a subtitle file (.srt), for uploading to YouTube or LinkedIn." href={downloadHref(c.subtitlesUrl, `${c.title} subtitles`)} download>
              <Download className="h-3 w-3" /> Subtitles
            </Pill>
          )}
        </div>
      </div>
    </div>
    <EditTextDialog c={c} open={editing} onOpenChange={setEditing} />
    <ConfirmDelete open={deleting} onOpenChange={setDeleting} title={`Delete "${c.title}"?`} description="All its shapes go for good. The episode isn't touched." url={`/api/host/clips/${c.id}`} />
    <PostDialog
      target={posting ? { kind: "clip", id: c.id, title: c.title, caption: c.caption, shapes: ([["vertical", c.verticalUrl], ["square", c.squareUrl], ["wide", c.url]] as const).filter(([, u]) => u).map(([s]) => s) } : null}
      onClose={() => setPosting(false)}
    />
    </>
  );
}

interface Beta { unlimited: boolean; used: number; limit: number; left: number | null; maxMinutes: number; tokens: number; payments: boolean }
interface Plan { key: PlanKey; name: string; interval?: "month" | "year"; credits: number; overageCents: number; capCents: number; extraCents: number; periodEnd: string; status: string }

/** Always in Pōstify's header: credits left (and the plan), and the way to more. */
function CreditBalance({ beta, plan }: { beta?: Beta; plan?: Plan | null }) {
  const [open, setOpen] = useState(false);
  if (!beta) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border border-[#F0A71F]/50 bg-[#F0A71F]/10 py-1.5 pl-3 pr-1.5 text-sm font-semibold text-foreground transition-colors hover:bg-[#F0A71F]/20"
        data-testid="post-token-balance"
      >
        <Coins className="h-4 w-4 text-[#b36b00] dark:text-[#F0A71F]" />
        <span className="tabular-nums">{beta.tokens} credit{beta.tokens === 1 ? "" : "s"}</span>
        <span className="rounded-full bg-[#053877] px-2.5 py-0.5 text-xs font-semibold text-white">{plan ? plan.name : "Get more"}</span>
      </button>
      <PlanDialog open={open} onOpenChange={setOpen} beta={beta} plan={plan} />
    </>
  );
}

/** Can't start for want of credits and no plan: pick one. */
function ChoosePlan({ beta, plan }: { beta?: Beta; plan?: Plan | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-2 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="post-get-tokens">
        <Sparkles className="h-4 w-4" /> Choose a plan
      </Button>
      <PlanDialog open={open} onOpenChange={setOpen} beta={beta} plan={plan} />
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

  const features = useQuery<{ post: boolean; beta?: Beta; plan?: Plan | null }>({
    queryKey: ["/api/host/features"],
    queryFn: async () => (await apiRequest("GET", "/api/host/features")).json(),
    staleTime: 5 * 60_000,
  });
  const recs = useQuery<Rec[]>({
    queryKey: ["/api/host/recordings"],
    queryFn: async () => (await apiRequest("GET", "/api/host/recordings")).json(),
    // Live while anything is moving; still otherwise.
    refetchInterval: (q) => ((q.state.data as Rec[] | undefined)?.some((r) => r.clipStatus === "queued" || r.clipStatus === "running" || cleanOf(r)?.status === "running" || /"status":"(queued|running)"/.test(r.episodeEdit)) ? 4000 : false),
  });
  const moving = (recs.data ?? []).some((r) => r.clipStatus === "queued" || r.clipStatus === "running");
  const clips = useQuery<ClipRow[]>({
    queryKey: ["/api/host/clips"],
    queryFn: async () => (await apiRequest("GET", "/api/host/clips")).json(),
    // Live while clips are being cut, or while any is being remade with new text.
    refetchInterval: (q) => (moving || (q.state.data as ClipRow[] | undefined)?.some((c) => c.editStatus === "queued" || c.editStatus === "running") ? 5000 : false),
  });

  // Saved clean copies are recordings (they live in Recordings), not episodes to post-produce again.
  const list = useMemo(() => (recs.data ?? []).filter((r) => r.status === "Ready" && !r.egressId.startsWith("CLEAN_")).sort((a, b) => b.id - a.id), [recs.data]);
  // Opens on what you picked (or came here with), else on anything still
  // working so its progress shows; otherwise empty, ready for an episode.
  // -1 = "Add an episode": empty on purpose.
  const rec = selected === -1 ? undefined : list.find((r) => r.id === selected) ?? list.find((r) => r.clipStatus === "queued" || r.clipStatus === "running");
  const p = progressOf(rec);
  const clean = cleanOf(rec);
  const savedCopy = rec ? (recs.data ?? []).find((r) => r.egressId === `CLEAN_${rec.id}`) ?? null : null;
  const mine = useMemo(() => (clips.data ?? []).filter((c) => c.recordingId === rec?.id).sort((a, b) => a.startSec - b.startSec), [clips.data, rec?.id]);

  useEffect(() => setPreview(null), [rec?.id]);

  // When a run finishes, the clips list needs a fresh read right away.
  useEffect(() => {
    if (rec?.clipStatus === "done") void qc.invalidateQueries({ queryKey: ["/api/host/clips"] });
  }, [rec?.clipStatus, qc]);

  // The Viewer: clips, or the whole episode (clean or original) to watch, mark and edit.
  const [view, setView] = useState<"clips" | "episode">("clips");
  const [epSource, setEpSource] = useState<"clean" | "original">("clean");
  const epRef = useRef<HTMLVideoElement>(null);
  // What to make: remembered for next time, since a show tends to want the same.
  // Shapes start empty every time (a pre-ticked one meant ticking another to untick it);
  // the caption style is remembered, since a show tends to want the same.
  const [opts, setOpts] = useState<ClipOptions>(() => {
    let saved: ClipOptions = { ...DEFAULT_CLIP_OPTIONS };
    try { saved = parseClipOptions(localStorage.getItem("mv_clip_options") ?? ""); } catch { /* private mode */ }
    return { ...saved, formats: [] };
  });
  useEffect(() => { try { localStorage.setItem("mv_clip_options", JSON.stringify(opts)); } catch { /* private mode */ } }, [opts]);
  const start = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/host/recordings/${id}/clip`, { options: opts })).json(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/host/recordings"] });
      void qc.invalidateQueries({ queryKey: ["/api/host/features"] });
    },
    onError: (e: Error) => toast({ title: "Couldn't start that", description: e.message, variant: "destructive" }),
  });

  const beta = features.data?.beta;
  const plan = features.data?.plan ?? null;
  const freeLeft = Boolean(beta && (beta.unlimited || (beta.left ?? 1) > 0));
  // What this episode will cost with the shapes and captions picked.
  const cost = episodeCredits(opts);
  const betaBadge = beta && !beta.unlimited ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F0A71F]/15 px-2.5 py-1 text-xs font-semibold text-[#8a5a00] dark:text-[#F0A71F]" data-testid="post-beta">
      Beta{freeLeft ? ` · ${beta.left} free episode${beta.left === 1 ? "" : "s"}` : ""}
    </span>
  ) : null;

  const [justPaid, setJustPaid] = useState<{ title: string; balance: number } | null>(null);
  // Stays until closed: a toast was gone before anyone could read it.
  const paidBanner = justPaid ? (
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-emerald-400/60 bg-emerald-50 px-4 py-3 text-sm dark:bg-emerald-950/30" role="status" data-testid="post-paid">
      <Check className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <p className="flex-1 text-foreground">
        <span className="font-semibold">{justPaid.title}</span> You have {justPaid.balance} credits.
      </p>
      <button type="button" onClick={() => setJustPaid(null)} aria-label="Close" className="rounded-full p-1 text-muted-foreground hover:bg-black/5 hover:text-foreground"><X className="h-4 w-4" /></button>
    </div>
  ) : null;

  // Back from Stripe Checkout: credit the tokens (the server reads the payment from Stripe).
  useEffect(() => {
    const url = new URL(window.location.href);
    const paid = url.searchParams.get("paid");
    const subscribed = url.searchParams.get("subscribed");
    if (!paid && !subscribed) return;
    url.searchParams.delete("paid");
    url.searchParams.delete("subscribed");
    window.history.replaceState(null, "", url.pathname + url.search);
    (subscribed
      ? apiRequest("POST", "/api/host/plan/confirm", { sessionId: subscribed }).then((r) => r.json()).then((d: { plan: string; credits: number; balance: number }) => ({ title: `Welcome to ${d.plan} — ${d.credits} credits added.`, balance: d.balance }))
      : apiRequest("POST", "/api/host/tokens/confirm", { sessionId: paid }).then((r) => r.json()).then((d: { tokens: number; balance: number }) => ({ title: `Payment received — ${d.tokens} credits added.`, balance: d.balance })))
      .then((d) => {
        setJustPaid(d);
        void qc.invalidateQueries({ queryKey: ["/api/host/features"] });
      })
      .catch((e: Error) => toast({ title: "Paid — your credits are on their way", description: e.message, variant: "destructive" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // In testing: only for the accounts the server says.
  if (!features.data?.post) return null;

  const episodeList = (
      <div className="rounded-2xl border border-border bg-card p-3">
        <p className="px-1.5 pb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Pick an episode</p>
        <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto lg:max-h-[22rem]">
          {list.map((r) => {
            const on = r.id === rec?.id;
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
  );

  if (!rec) {
    if (recs.isLoading) return null;
    return (
      <section className="mt-6" data-testid="post-studio">
        {paidBanner}
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#b36b00] dark:text-[#F0A71F]">Pōstify</p>
            <h2 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-bold tracking-tight text-foreground" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>From recording to clips {betaBadge}</h2>
          </div>
          <CreditBalance beta={beta} plan={plan} />
        </div>
        {/* Empty Viewer: drop an episode in (it's filed in the Library and picked), or pick one. */}
        <div className={`grid gap-4 ${list.length ? "lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]" : ""}`}>
          {list.length > 0 && episodeList}
          <div className="aspect-video min-h-[16rem]" data-testid="post-viewer-empty">
            <UploadRecording
              tall
              title="Drop an episode here, or click to browse"
              note={`${list.length ? "Or pick one on the left. " : ""}MP4, MOV or WebM, up to 2GB. It's saved to your Library too.`}
              onDone={(id) => setSelected(id)}
            />
          </div>
        </div>
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
      {paidBanner}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#b36b00] dark:text-[#F0A71F]">Pōstify</p>
          <h2 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-bold tracking-tight text-foreground" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>From recording to clips {betaBadge}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CreditBalance beta={beta} plan={plan} />
          <Button variant="outline" onClick={() => setSelected(-1)} className="gap-2 rounded-full" data-testid="post-add-episode">
            <Upload className="h-4 w-4" /> Add an episode
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,17rem)]">
        {episodeList}

        {/* Preview */}
        <div className="flex flex-col gap-3">
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-[#050d26] ring-1 ring-black/5" data-testid="post-viewer">
            {/* The Viewer: Clips, or the whole Episode (clean or original). */}
            {!running && (
              <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
                <div className="flex gap-1 rounded-full bg-black/60 p-1 text-xs font-semibold backdrop-blur">
                  {(["clips", "episode"] as const).map((v) => (
                    <button key={v} type="button" onClick={() => { setView(v); setPreview(null); }} className={`rounded-full px-3 py-1 capitalize ${view === v ? "bg-white text-[#000741]" : "text-white/80 hover:text-white"}`} data-testid={`viewer-${v}`}>{v}</button>
                  ))}
                </div>
                {view === "episode" && clean?.videoKey && (
                  <div className="flex gap-1 rounded-full bg-black/60 p-1 text-[11px] font-semibold backdrop-blur">
                    {(["clean", "original"] as const).map((v) => (
                      <button key={v} type="button" onClick={() => setEpSource(v)} className={`rounded-full px-2.5 py-0.5 capitalize ${epSource === v ? "bg-[#F0A71F] text-[#1a1200]" : "text-white/75 hover:text-white"}`} data-testid={`viewer-source-${v}`}>{v}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {view === "episode" && !running ? (
              <video
                ref={epRef}
                key={`${rec.id}-${clean?.videoKey && epSource === "clean" ? "clean" : "original"}`}
                src={clean?.videoKey && epSource === "clean" ? `/api/host/recordings/${rec.id}/clean/video` : `/api/host/recordings/${rec.id}/video`}
                controls
                playsInline
                preload="metadata"
                className="h-full w-full bg-black object-contain"
                data-testid="viewer-episode-video"
              />
            ) : preview ? (
              <video key={preview.url} src={preview.url} controls autoPlay playsInline className="h-full w-full bg-black object-contain" />
            ) : running ? (
              <WorkingScene rec={rec} p={p} pct={pct} />
            ) : failed ? (
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
              // Not started: the way in is the middle of the window.
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F0A71F] text-[#1a1200] shadow-lg shadow-[#F0A71F]/20"><Wand2 className="h-7 w-7" /></span>
                <p className="text-xl font-bold sm:text-2xl">Ready for Pōstify</p>
                <ClipChoices opts={opts} onChange={setOpts} />
                {!(beta?.unlimited || rec.postifyBeta || freeLeft || (beta?.tokens ?? 0) >= cost || plan) ? (
                  <ChoosePlan beta={beta} plan={plan} />
                ) : (
                  <Button onClick={() => start.mutate(rec.id)} disabled={start.isPending || opts.formats.length === 0} className="h-11 gap-2 rounded-full bg-[#F0A71F] px-6 text-base font-semibold text-[#1a1200] hover:bg-[#f5b94a] disabled:opacity-40" data-testid="post-start-hero">
                    {start.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />} Start Pōstify
                  </Button>
                )}
                <p className="text-xs text-white/55">
                  {opts.formats.length === 0
                    ? "Pick at least one shape to start"
                    : beta?.unlimited || rec.postifyBeta
                    ? "Included"
                    : freeLeft
                      ? "Free · your beta episode"
                      : (beta?.tokens ?? 0) >= cost
                        ? `Uses ${cost} credits · you have ${beta?.tokens}`
                        : plan
                          ? `Uses ${cost} credits: ${beta?.tokens ?? 0} left + ${cost - (beta?.tokens ?? 0)} extra at ${cents(plan.overageCents)}`
                          : `This one is ${cost} credits`}

                </p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#053877]/15 bg-[#053877]/[0.04] px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#053877]/10 text-[#053877] dark:text-[#8fb5e8]"><Sparkles className="h-4 w-4" /></span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{rec.title || "Session"}</p>
                <p className="text-xs text-muted-foreground">{done ? `${mine.length} clips with captions` : running ? stageLabel(rec, p) : opts.formats.length ? `Clips (${opts.formats.join(", ")}, ${opts.captions} captions) and a clean episode` : "Pick your shapes, then start"}</p>
              </div>
            </div>
            {done ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400"><Check className="h-4 w-4" /> Ready</span>
            ) : running ? (
              <Button disabled className="gap-2 rounded-full"><Loader2 className="h-4 w-4 animate-spin" /> {pct}%</Button>
            ) : failed ? (
              <Button onClick={() => start.mutate(rec.id)} disabled={start.isPending} className="gap-2 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="post-start">
                <Sparkles className="h-4 w-4" /> Try again
              </Button>
            ) : null /* Not started: the start is the middle of the window. */}
          </div>
          {view === "episode" && !running && (
            <EpisodeTools
              rec={rec}
              source={clean?.videoKey && epSource === "clean" ? "clean" : "original"}
              videoRef={epRef}
            />
          )}
        </div>

        {/* Pipeline */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="pb-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Pipeline</p>
          <ul className="divide-y divide-border/60">
            <PipelineRow icon={Disc} title="Recording saved" detail={`${stamp(rec.durationSec)} long`} state="done" />
            <PipelineRow icon={Film} title="Load the recording" detail={p?.stage === "download" && p.pct != null ? `${p.pct}%` : undefined} state={state("download")} />
            <PipelineRow icon={FileText} title="Transcript" detail={p?.words ? `${p.words.toLocaleString("en-US")} words · ${p.transcriptSource === "live" ? "written live" : "transcribed after"}` : p?.transcriptSource === "live" ? "Written live on air" : undefined} state={state("transcript")} />
            <PipelineRow icon={Sparkles} title="Pick the moments" detail={pickedN ? `${pickedN} that stand on their own` : undefined} state={state("moments")} />
            <PipelineRow icon={Crop} title="Cut in three shapes" detail={p?.stage === "render" ? renderDetail(p) || undefined : readyN ? "16:9 · 9:16 · 1:1 + captions" : undefined} state={state("render")} />
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

      {clean && (
        <CleanCard
          rec={rec}
          clean={clean}
          saved={savedCopy}
          onSaved={() => void qc.invalidateQueries({ queryKey: ["/api/host/recordings"] })}
        />
      )}

      {/* Clips, filling in */}
      {(mine.length > 0 || moments.length > 0) && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Scissors className="h-4 w-4 text-[#053877]" /> {done ? "Your clips" : "Clips being cut"}
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{done ? mine.length : `${readyN} of ${moments.length}`}</span>
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {done
              ? [
                  ...mine.map((c) => <ClipCard key={c.id} c={c} onPreview={() => {
                    setPreview({ kind: "clip", url: c.verticalUrl || c.url });
                    // Play it where they can see it: up at the player, not down at the card.
                    document.querySelector('[data-testid="post-viewer"]')?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }} />),
                  <GenerateMore key="more" beta={beta} plan={plan} />,
                ]
              : moments.map((m, i) => {
                  const ready = i < readyN;
                  const working = !ready && i === readyN;
                  return (
                    <div key={i} className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border ${ready ? "border-emerald-400/60" : "border-border"}`}>
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
    </section>
  );
}
