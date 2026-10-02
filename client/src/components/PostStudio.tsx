import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PLANS, CREDIT_PACKS, OVERAGE_CAP_CHOICES, episodeCredits, cents, type PlanKey } from "@shared/tokens";
import { CLIP_FORMATS, DEFAULT_CLIP_OPTIONS, parseClipOptions, parseMusicMix, parseEditSuggest, type ClipFormat, type ClipOptions, type EpisodeEdit, type EpisodeMusic, type EditSuggestion, type EditTransition } from "@shared/schema";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startPlanCheckout, openBillingPortal, startTokenCheckout } from "@/lib/tokens";
import { PostDialog } from "@/components/PostDialog";
import { durationOf, uploadToStorage } from "@/lib/upload";
import { TrimStrip, Icon, type Cut } from "@/components/TrimStrip";
import { NotifyPrompt } from "@/components/Notifications";
import { UploadRecording } from "@/components/UploadRecording";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { CleanResult, ClipProgress, ClipRow, RecordingRow } from "@shared/schema";
import { Slider } from "@/components/ui/slider";
import { Trash2, Pencil, Coins, X, Check, Clock3, Disc, Download, FileText, Film, Loader2, Play, Pause, Music2, Scissors, Sparkles, Wand2, AlertTriangle, Crop, Send, Upload, Headphones, Video, Copy, ChevronDown, Maximize2, Minimize2, Clapperboard, Plus, ArrowLeftToLine, ArrowRightToLine, MoreHorizontal, Blend, Brackets, Library } from "lucide-react";
import { IconTile } from "@/components/ui/icon-tile";

// Postify: one recording going from "the segment ended" to clips ready
// to post, as the clipper actually does it. Every step and number here is what
// the worker reported (recordings.clip_progress) or what it produced (clips) —
// nothing animates on a timer pretending to work.

type Rec = RecordingRow;
type RowState = "done" | "active" | "waiting" | "soon" | "failed" | "ask";

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
  // "Ready" is news once, when it finishes: after ten minutes, or once closed,
  // the bar goes (the clean episode is in the Library, and Clean/Original is in the toolbar).
  const seenKey = `mv_clean_seen_${rec.id}`;
  const [closed, setClosed] = useState(() => { try { return localStorage.getItem(seenKey) === clean.at; } catch { return false; } });
  const close = () => { setClosed(true); try { localStorage.setItem(seenKey, clean.at); } catch { /* fine */ } };
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
  if (clean.status === "done" && (closed || Date.now() - Date.parse(clean.at) > 10 * 60_000)) return null;
  return (
    <div className={`mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-4 ${ready ? "border-emerald-400/50 bg-emerald-500/[0.04]" : "border-border bg-card"}`} data-testid="post-clean">
      <div className="flex min-w-0 items-center gap-3">
        <IconTile icon={ready ? Check : clean.status === "running" ? Loader2 : Wand2} spin={!ready && clean.status === "running"} />
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
        {clean.status === "done" && (
          <button type="button" onClick={close} aria-label="Close" className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" data-testid="post-clean-close"><X className="h-4 w-4" /></button>
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
function WorkingScene({ rec, p, pct, eta }: { rec: Rec; p: ClipProgress | null; pct: number; eta?: string }) {
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
        {eta && <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-[#F0A71F]" data-testid="post-eta"><Clock3 className="h-3.5 w-3.5" /> {eta}</p>}
        <div><NotifyPrompt /></div>
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
          state === "done" ? "bg-emerald-500 text-white" : state === "active" || state === "ask" ? "bg-[#F0A71F]/15 text-[#b36b00] ring-2 ring-[#F0A71F]" : state === "failed" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"
        }`}
      >
        {state === "done" ? <Check className="h-4 w-4" /> : state === "active" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state === "failed" ? <AlertTriangle className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-medium ${state === "active" || state === "ask" ? "text-foreground" : state === "done" ? "text-foreground" : "text-muted-foreground"}`}>{title}</span>
        {detail && <span className="block text-xs text-muted-foreground">{detail}</span>}
      </span>
      <span className={`shrink-0 text-xs font-medium ${state === "done" ? "text-emerald-600 dark:text-emerald-400" : state === "active" || state === "ask" ? "text-[#b36b00] dark:text-[#F0A71F]" : "text-muted-foreground"}`}>
        {state === "done" ? "Done" : state === "active" ? "Working" : state === "ask" ? "Your pick" : state === "soon" ? "Coming soon" : state === "failed" ? "Stopped" : ""}
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
/**
 * More clips from this episode, none overlapping the ones it has. With
 * credits (or a plan that bills extras) it just starts; without, it offers
 * a plan.
 */
function GenerateMore({ rec, beta, plan, count, captions }: { rec: Rec; beta?: Beta; plan?: Plan | null; count: number; captions: "animated" | "classic" }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const credits = captions === "classic" ? count : count * 2;
  const canPay = Boolean(beta?.unlimited || (beta?.tokens ?? 0) >= credits || plan);
  const more = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/host/recordings/${rec.id}/more-clips`, { method: "POST", credentials: "include" });
      if (r.status === 402) return { needPlan: true };
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.message || "Couldn't start that.");
      return r.json();
    },
    onSuccess: (r: { needPlan?: boolean }) => {
      if (r.needPlan) return setOpen(true);
      void qc.invalidateQueries({ queryKey: ["/api/host/recordings"] });
      void qc.invalidateQueries({ queryKey: ["/api/host/features"] });
      toast({ title: `Making ${count} more clips`, description: "Different moments from this episode. They join your clips here in a few minutes; you can close this page." });
    },
    onError: (e: Error) => toast({ title: "Couldn't make more clips", description: e.message, variant: "destructive" }),
  });
  return (
    <>
      <button
        type="button"
        onClick={() => (canPay ? more.mutate() : setOpen(true))}
        disabled={more.isPending}
        className="flex min-h-[14rem] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#053877]/25 bg-[#053877]/[0.03] p-4 text-center transition-colors hover:border-[#053877]/50 hover:bg-[#053877]/[0.06] disabled:opacity-60"
        data-testid="post-generate-more"
      >
        <IconTile icon={more.isPending ? Loader2 : Sparkles} spin={more.isPending} />
        <span className="text-sm font-semibold text-foreground">{count} more clips</span>
        <span className="max-w-[14rem] text-balance text-xs text-muted-foreground">
          Different moments from this episode, in all three shapes.{" "}
          {beta?.unlimited ? "Included." : `${credits} credits${beta?.tokens != null ? ` · you have ${beta.tokens}` : ""}.`}
        </span>
      </button>
      <PlanDialog open={open} onOpenChange={setOpen} beta={beta} plan={plan} />
    </>
  );
}

// Whole seconds down, as the player counts them.
const hms = (sec: number) => {
  const t = Math.max(0, Math.floor(sec + 0.001));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
};

type Bookend = { key: string; name: string; dur?: number };

/**
 * An intro or outro, as a block at that end of the timeline: empty, a dashed
 * "+ Intro" to upload one; set, its name and length, with ✕ to take it off.
 * Uploaded once and remembered for the next episode.
 */
function BookendTile({ label, value, onChange }: { label: "Intro" | "Outro"; value: Bookend | null; onChange: (v: Bookend | null) => void }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const go = async (file: File) => {
    if (!file.type.startsWith("video/")) return toast({ title: "That isn't a video", variant: "destructive" });
    if (file.size > 500 * 1024 ** 2) return toast({ title: "Keep it under 500MB", description: "An intro or outro is usually a few seconds.", variant: "destructive" });
    try {
      setPct(0);
      const dur = await durationOf(file).catch(() => 0);
      const storageKey = await uploadToStorage(file, setPct);
      onChange({ key: storageKey, name: file.name.replace(/\.[a-z0-9]+$/i, ""), dur: dur || undefined });
    } catch (e) {
      toast({ title: "Couldn't upload that", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPct(null);
      if (input.current) input.current.value = "";
    }
  };
  const box = "relative mb-1 flex h-14 w-24 shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg px-1.5 text-center sm:w-28";
  return (
    <>
      <input ref={input} type="file" accept="video/*" className="hidden" onChange={(e) => e.target.files?.[0] && void go(e.target.files[0])} />
      {value ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={`${box} group border-2 border-[#053877] bg-[#053877] text-white`} data-testid={`bookend-${label.toLowerCase()}`}>
              <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-[#F0A71F]"><Film className="h-3 w-3" /> {label}</span>
              <span className="w-full truncate text-[11px] font-medium">{value.name}</span>
              {value.dur ? <span className="text-[10px] tabular-nums text-white/70">{hms(value.dur)}</span> : null}
              <button type="button" onClick={() => onChange(null)} aria-label={`Take the ${label.toLowerCase()} off`} className="absolute right-0.5 top-0.5 rounded p-0.5 text-white/70 opacity-0 transition-opacity hover:bg-white/15 hover:text-white focus:opacity-100 group-hover:opacity-100" data-testid={`bookend-${label.toLowerCase()}-remove`}><X className="h-3 w-3" /></button>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[14rem] text-xs">{label === "Intro" ? "Plays before the episode" : "Plays after the episode"}. It's in the edited episode; the player above shows the episode only.</TooltipContent>
        </Tooltip>
      ) : (
        <button type="button" onClick={() => input.current?.click()} disabled={pct !== null} className={`${box} border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-[#053877]/50 hover:bg-[#053877]/[0.04] hover:text-foreground`} data-testid={`bookend-${label.toLowerCase()}-add`}>
          {pct === null ? <Plus className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
          <span className="text-xs font-semibold">{pct === null ? label : `${pct}%`}</span>
        </button>
      )}
    </>
  );
}

const TRANSITIONS: { key: EditTransition; label: string; hint: string }[] = [
  { key: "fade", label: "Fade", hint: "One blends into the other" },
  { key: "black", label: "Dip to black", hint: "Fades out to black, then in" },
  { key: "cut", label: "Cut", hint: "Straight from one to the other" },
];

/** The join between the intro (or outro) and the episode, as Canva shows it: a small button on the seam. */
function TransitionButton({ value, onChange, where }: { value: EditTransition; onChange: (t: EditTransition) => void; where: "intro" | "outro" }) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button type="button" className={`relative z-10 mb-[18px] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-background shadow-sm ${value === "cut" ? "bg-muted text-muted-foreground" : "bg-[#F0A71F] text-[#1a1200]"} ${where === "intro" ? "-mx-2" : "-mx-2"}`} aria-label={`Transition: ${TRANSITIONS.find((t) => t.key === value)?.label}`} data-testid={`transition-${where}`}>
              <Blend className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">Transition {where === "intro" ? "into the episode" : "into the outro"}: {TRANSITIONS.find((t) => t.key === value)?.label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="center" className="w-56">
        {TRANSITIONS.map((t) => (
          <DropdownMenuItem key={t.key} onSelect={() => onChange(t.key)} className="flex-col items-start gap-0" data-testid={`transition-${where}-${t.key}`}>
            <span className="flex items-center gap-2 text-sm font-medium">{value === t.key ? <Check className="h-3.5 w-3.5 text-[#053877]" /> : <span className="w-3.5" />} {t.label}</span>
            <span className="pl-5 text-xs text-muted-foreground">{t.hint}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Under the Viewer in Episode mode. Two things you do with a whole episode:
 * mark a moment and make it a clip; and edit the episode itself — trim the
 * ends, put an intro and outro on — into a new copy in the Library.
 */
function EpisodeTools({ rec, source, videoRef, tab, onTab, epSource, onSource, viewer, onMusic }: {
  rec: Rec; source: "clean" | "original"; videoRef: React.RefObject<HTMLVideoElement>;
  /** Which job: edit the episode, or make a clip. */
  tab: "edit" | "clip";
  onTab: (t: "edit" | "clip") => void;
  /** Clean or original, when there is a clean episode. */
  epSource?: "clean" | "original";
  onSource: (s: "clean" | "original") => void;
  /** The player, on the left. */
  viewer: React.ReactNode;
  /** Open the music for the clips. */
  onMusic?: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const now = () => videoRef.current?.currentTime ?? 0;
  // Make a clip. Shapes start unpicked: the button counts what you choose.
  const [mark, setMark] = useState<{ in: number | null; out: number | null }>({ in: null, out: null });
  const [title, setTitle] = useState("");
  // Vertical to start with: it's the one almost everyone posts.
  const [formats, setFormats] = useState<ClipFormat[]>(["vertical"]);
  const titleRef = useRef<HTMLInputElement>(null);
  const len = mark.in !== null && mark.out !== null ? mark.out - mark.in : 0;
  const reset = () => { setMark({ in: null, out: null }); setTitle(""); setFormats(["vertical"]); };
  // Where the player is, for the timeline bar; and stopping a Preview at the end mark.
  const [pos, setPos] = useState({ t: 0, d: 0 });
  // Before anything is marked, the strip suggests 30 seconds from where you are.
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
  const makeClip = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/host/recordings/${rec.id}/clips`, { startSec: mark.in, endSec: mark.out, title, source: source === "clean" ? "clean" : "", formats })).json(),
    onSuccess: () => {
      reset();
      void qc.invalidateQueries({ queryKey: ["/api/host/clips"] });
      void qc.invalidateQueries({ queryKey: ["/api/host/features"] });
      toast({ title: "Making your clip", description: "It appears with your other clips in a minute or two. You can close this page; it keeps going." });
    },
    onError: (e: Error) => toast({ title: "Couldn't make that clip", description: e.message, variant: "destructive" }),
  });
  // Edit the episode
  const remember = (k: string) => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as Bookend) : null; } catch { return null; } };
  // Work in progress, saved as they go (on the recording): they can close and come back to cut more.
  type Draft = { source: "clean" | "original"; trimStart: number; trimEnd: number; cuts: Cut[]; intro: Bookend | null; outro: Bookend | null; introT: EditTransition; outroT: EditTransition; music?: EpisodeMusic[]; at: string };
  const draft0 = useMemo<Draft | null>(() => { try { const d = rec.editDraft ? (JSON.parse(rec.editDraft) as Draft) : null; return d && d.source === source ? d : null; } catch { return null; } }, [rec.id, source]); // eslint-disable-line react-hooks/exhaustive-deps
  const [intro, setIntroState] = useState(() => (draft0 ? draft0.intro : remember("mv_intro")));
  const [outro, setOutroState] = useState(() => (draft0 ? draft0.outro : remember("mv_outro")));
  const keep = (k: string, v: Bookend | null) => { try { v ? localStorage.setItem(k, JSON.stringify(v)) : localStorage.removeItem(k); } catch { /* private mode */ } };
  const setIntro = (v: Bookend | null) => { setIntroState(v); keep("mv_intro", v); };
  const setOutro = (v: Bookend | null) => { setOutroState(v); keep("mv_outro", v); };
  const [introT, setIntroT] = useState<EditTransition>(() => draft0?.introT ?? "fade");
  const [outroT, setOutroT] = useState<EditTransition>(() => draft0?.outroT ?? "fade");
  const [trim, setTrim] = useState<{ start: number; end: number }>(() => ({ start: draft0?.trimStart ?? 0, end: draft0?.trimEnd ?? 0 }));
  // Sections taken out of the middle.
  const [cuts, setCuts] = useState<Cut[]>(() => draft0?.cuts ?? []);
  // Music under parts of the episode.
  const [music, setMusic] = useState<EpisodeMusic[]>(() => draft0?.music ?? []);
  const [musicDlg, setMusicDlg] = useState(false);
  // Another episode, or the other version: pick up its own draft.
  const loadedFor = useRef(`${rec.id}:${source}`);
  useEffect(() => {
    const k = `${rec.id}:${source}`;
    if (loadedFor.current === k) return;
    loadedFor.current = k;
    setTrim({ start: draft0?.trimStart ?? 0, end: draft0?.trimEnd ?? 0 });
    setCuts(draft0?.cuts ?? []);
    setMusic(draft0?.music ?? []);
    if (draft0) { setIntroState(draft0.intro); setOutroState(draft0.outro); setIntroT(draft0.introT); setOutroT(draft0.outroT); }
  }, [rec.id, source, draft0]);
  // Saved a moment after each change.
  const [draftAt, setDraftAt] = useState<string>(() => draft0?.at ?? "");
  const [draftSaving, setDraftSaving] = useState(false);
  const saveDraft = useCallback(async () => {
    setDraftSaving(true);
    try {
      await apiRequest("PUT", `/api/host/recordings/${rec.id}/edit-draft`, { source, trimStart: trim.start, trimEnd: trim.end, cuts, intro, outro, introT, outroT, music });
      setDraftAt(new Date().toISOString());
    } catch { /* the next change tries again */ } finally { setDraftSaving(false); }
  }, [rec.id, source, trim.start, trim.end, cuts, intro, outro, introT, outroT, music]);
  const firstDraftRun = useRef(true);
  useEffect(() => {
    if (firstDraftRun.current) { firstDraftRun.current = false; return; }
    const t = window.setTimeout(() => void saveDraft(), 900);
    return () => window.clearTimeout(t);
  }, [saveDraft]);
  const cutTotal = cuts.reduce((a, c) => a + (c[1] - c[0]), 0);
  // The AI's recommended edits, for this version of the episode; the ones you've answered go.
  const sug = parseEditSuggest(rec.editSuggest);
  const sugBusy = sug?.status === "queued" || sug?.status === "running";
  const [answered, setAnswered] = useState<string[]>([]);
  const sugKey = (i: number) => `${sug?.at}:${i}`;
  const pending = sug?.status === "done" && sug.source === source ? (sug.items ?? []).map((it, i) => ({ ...it, i })).filter((it) => !answered.includes(sugKey(it.i))) : [];
  const accept = (it: EditSuggestion & { i: number }) => {
    if (it.kind === "start") setTrim((t) => ({ ...t, start: it.to }));
    else if (it.kind === "end") setTrim((t) => ({ ...t, end: it.from }));
    else setCuts((c) => mergeCuts([...c, [it.from, it.to] as Cut]));
    setAnswered((a) => [...a, sugKey(it.i)]);
  };
  const suggest = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/host/recordings/${rec.id}/suggest-edits`, { source })).json(),
    onSuccess: () => { setAnswered([]); void qc.invalidateQueries({ queryKey: ["/api/host/recordings"] }); },
    onError: (e: Error) => toast({ title: "Couldn't start that", description: e.message, variant: "destructive" }),
  });
  const keepEnd = trim.end || pos.d;
  const keepLen = Math.max(0, keepEnd - trim.start);
  // An end pressed at 0:11 keeps eleven seconds, not everything after them.
  const shortKeep = pos.d > 60 && (trim.start > 0 || trim.end > 0) && keepLen < pos.d * 0.5;
  let ed: EpisodeEdit | null = null;
  try { ed = rec.episodeEdit ? (JSON.parse(rec.episodeEdit) as EpisodeEdit) : null; } catch { ed = null; }
  const busy = ed?.status === "queued" || ed?.status === "running";
  const makeEdit = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/host/recordings/${rec.id}/episode-edit`, {
      source, trimStart: trim.start, trimEnd: trim.end, cuts, introKey: intro?.key, introName: intro?.name, outroKey: outro?.key, outroName: outro?.name,
      introTransition: intro ? introT : undefined, outroTransition: outro ? outroT : undefined,
      music: music.length ? music : undefined,
    })).json(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/host/recordings"] });
      toast({ title: "Saving to your Library", description: "It takes a few minutes, and you can close this page. It lands next to your original as a new copy; to put it in your podcast, choose Add to my podcast there." });
    },
    onError: (e: Error) => toast({ title: "Couldn't start that", description: e.message, variant: "destructive" }),
  });
  // Canva's way, on the timeline where the eye already is: Trim drags the
  // two ends; Split cuts the episode at the playhead into pieces, and a piece
  // that's clicked can be deleted (the first or last trims that end; one in
  // the middle becomes a cut).
  const [trimming, setTrimming] = useState(false);
  const [splits, setSplits] = useState<number[]>([]);
  const [sel, setSel] = useState<Cut | null>(null);
  const inCut = (t: number) => cuts.some(([a, b]) => t > a && t < b);
  const bounds = [trim.start, ...splits.filter((t) => t > trim.start + 0.25 && t < keepEnd - 0.25 && !inCut(t)).sort((a, b) => a - b), keepEnd];
  const canSplit = pos.d > 0 && pos.t > trim.start + 0.5 && pos.t < keepEnd - 0.5 && !inCut(pos.t) && !bounds.some((b) => Math.abs(b - pos.t) < 0.5);
  const split = () => { if (!canSplit) return; setSplits((sp) => [...sp, pos.t]); setSel(null); };
  const pick = (t: number) => {
    const i = bounds.findIndex((b, k) => k < bounds.length - 1 && t >= b && t < bounds[k + 1]);
    // One piece is the whole episode: nothing to pick until it's split.
    setSel(bounds.length > 2 && i >= 0 && !inCut(t) ? [bounds[i], bounds[i + 1]] : null);
  };
  const del = () => {
    if (!sel) return;
    const [a, b] = sel;
    if (a <= trim.start + 0.01) setTrim((tr) => ({ ...tr, start: b }));
    else if (b >= keepEnd - 0.01) setTrim((tr) => ({ ...tr, end: a }));
    else setCuts((c) => mergeCuts([...c, [a, b]]));
    setSel(null);
  };
  // S splits, Delete deletes, as in Canva; not while typing.
  const keysRef = useRef({ split, del });
  keysRef.current = { split, del };
  useEffect(() => {
    if (tab !== "edit") return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el?.closest?.("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "s" || e.key === "S") { e.preventDefault(); keysRef.current.split(); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); keysRef.current.del(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab]);
  // What's kept, end to end: the timeline shows only this, and the player skips the rest.
  const keptSegs = useMemo<[number, number][] | undefined>(() => {
    if (!pos.d || (!trim.start && !trim.end && !cuts.length)) return undefined;
    const out: [number, number][] = [];
    let at = trim.start;
    for (const [a, b] of mergeCuts(cuts)) {
      if (b <= at || a >= keepEnd) continue;
      if (a - at > 0.05) out.push([at, a]);
      at = Math.max(at, b);
    }
    if (keepEnd - at > 0.05) out.push([at, keepEnd]);
    return out.length ? out : undefined;
  }, [pos.d, trim.start, trim.end, keepEnd, cuts]);
  const skipping = tab === "edit" && !trimming && !!keptSegs;
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !skipping || !keptSegs) return;
    let raf = 0;
    const check = () => {
      const t = v.currentTime;
      const last = keptSegs[keptSegs.length - 1][1];
      if (t >= last - 0.03) { if (!v.paused) v.pause(); if (t > last) v.currentTime = last; return; }
      const next = keptSegs.find(([a, b]) => t < b);
      if (next && t < next[0] - 0.03) v.currentTime = next[0];
    };
    const loop = () => { check(); if (!v.paused) raf = requestAnimationFrame(loop); };
    const onPlay = () => {
      // Played from the very end: start again from the top of what's kept.
      if (v.currentTime >= keptSegs[keptSegs.length - 1][1] - 0.1) v.currentTime = keptSegs[0][0];
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    v.addEventListener("play", onPlay);
    // Sitting in a part that's just been taken out: step to what's kept.
    check();
    if (!v.paused) raf = requestAnimationFrame(loop);
    return () => { v.removeEventListener("play", onPlay); cancelAnimationFrame(raf); };
  }, [videoRef, skipping, keptSegs]);
  const tip = (text: string, el: React.ReactElement) => (
    <Tooltip><TooltipTrigger asChild>{el}</TooltipTrigger><TooltipContent side="left" className="max-w-[15rem] text-xs">{text}</TooltipContent></Tooltip>
  );
  // Panel buttons: full width, icon first, the words saying exactly what happens.
  const act = "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors";

  // Everything for the job in one toolbar across the top, as in Canva: the two
  // jobs, which version, the job's tools as icons with their names on hover,
  // and the one button that makes it. The player gets the whole width.
  const seg = "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors";
  const iconBtn = "flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background transition-colors hover:bg-muted disabled:opacity-50";
  const editTools = (
    <>
      {tip(sugBusy ? "Listening to the episode…" : "Suggest edits: the SI finds tech checks, restarts and interruptions, and you decide", (
        <button type="button" onClick={() => suggest.mutate()} disabled={suggest.isPending || sugBusy} aria-label="Suggest edits" className={iconBtn} data-testid="suggest-edits">
          {suggest.isPending || sugBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-[#b7791f]" />}
        </button>
      ))}
    </>
  );
  // The foot of the timeline, where the hands already are: what's being cut, music, and the one
  // button that finishes. "Save to Library", not "Publish": it makes a copy there, and nothing
  // reaches the podcast until they add it.
  const nothingToSave = (!trim.start && !trim.end && !cuts.length && !intro && !outro && !music.length) || (trim.end > 0 && trim.end < trim.start + 5);
  // What they've done, in words, in the order it plays; each can be undone on its own.
  const words = (n: number) => { const t = Math.round(n); return t < 60 ? `${t} sec` : `${Math.floor(t / 60)} min${t % 60 ? ` ${t % 60} sec` : ""}`; };
  const log: { key: string; text: string; at?: number; undo: () => void }[] = [
    ...(intro ? [{ key: "intro", text: `Intro added: ${intro.name}`, undo: () => setIntro(null) }] : []),
    ...(trim.start > 0 ? [{ key: "start", text: `${words(trim.start)} trimmed from the beginning`, at: 0, undo: () => setTrim((t) => ({ ...t, start: 0 })) }] : []),
    ...mergeCuts(cuts).map((c, i) => ({ key: `cut${i}`, text: `${words(c[1] - c[0])} taken out at ${hms(c[0])}`, at: c[0], undo: () => setCuts((cs) => cs.filter((x) => !(x[0] === c[0] && x[1] === c[1]))) })),
    ...(trim.end > 0 ? [{ key: "end", text: `${words(pos.d - trim.end)} trimmed from the end`, at: trim.end, undo: () => setTrim((t) => ({ ...t, end: 0 })) }] : []),
    ...(outro ? [{ key: "outro", text: `Outro added: ${outro.name}`, undo: () => setOutro(null) }] : []),
    ...music.map((m, i) => ({ key: `music${i}`, text: `Music ${m.level === "full" ? "at full level" : "under"} ${hms(m.from)}–${hms(m.to)}: ${m.name}`, at: m.from, undo: () => setMusic((ms) => ms.filter((_, j) => j !== i)) })),
  ];
  const [, go] = useLocation();
  const saveAndClose = async () => { await saveDraft(); toast({ title: "Draft saved", description: "Open this episode again to carry on where you left off." }); go("/host/dashboard/library"); };
  const musicDialog = (
    <EpisodeMusicDialog
      open={musicDlg}
      onOpenChange={setMusicDlg}
      start={trim.start}
      end={keepEnd}
      picked={sel}
      onAdd={(m) => { setMusic((ms) => [...ms, m]); setSel(null); setMusicDlg(false); toast({ title: "Music added", description: `${m.name}, ${hms(m.from)}–${hms(m.to)}. It's mixed in when you save to your Library.` }); }}
    />
  );
  const footer = (
    <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-border pt-3" data-testid="edit-footer">
      {tab === "edit" && (
        <div className="min-w-0 flex-1" data-testid="edit-log">
          <p className="flex flex-wrap items-baseline gap-x-2 text-xs font-semibold text-muted-foreground">
            Your edits
            {log.length > 0 && <span className="font-normal tabular-nums">· {hms(pos.d)} → {hms(Math.max(0, keepLen - cutTotal))}</span>}
            {log.length > 1 && <button type="button" onClick={() => { setTrim({ start: 0, end: 0 }); setCuts([]); setSplits([]); setSel(null); setIntro(null); setOutro(null); setMusic([]); }} className="font-normal underline underline-offset-2 hover:text-foreground" data-testid="trim-undo">Undo all</button>}
            <span className="font-normal">{draftSaving ? "· Saving…" : draftAt ? "· Draft saved" : ""}</span>
          </p>
          {log.length ? (
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {log.map((l) => (
                <li key={l.key} className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-1 text-xs">
                  {l.at !== undefined ? <button type="button" onClick={() => seek(l.at!)} className="hover:underline" title="Play from here">{l.text}</button> : <span>{l.text}</span>}
                  <button type="button" onClick={l.undo} className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground" aria-label={`Undo: ${l.text}`} title="Undo this"><X className="h-3 w-3" /></button>
                </li>
              ))}
            </ul>
          ) : <p className="mt-1 text-xs text-muted-foreground">Nothing yet. Trim, split, or add an intro or outro. Your work saves as you go.</p>}
          {shortKeep && <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-400">That takes out most of the episode.</p>}
        </div>
      )}
      <div className="ml-auto flex items-center gap-2">
        {tab === "edit" && tip("Keeps your edits so you can come back and carry on. Nothing is made yet.", (
          <Button type="button" variant="outline" onClick={() => void saveAndClose()} className="h-10 rounded-lg" data-testid="edit-save-close">Save & close</Button>
        ))}
        {(tab === "edit" || onMusic) && tip(tab === "edit" ? "Music under part of the episode: the opening, the close, a piece you picked, or all of it" : "Music for your clips", (
          <button type="button" onClick={() => (tab === "edit" ? setMusicDlg(true) : onMusic?.())} aria-label={tab === "edit" ? "Music for the episode" : "Music for your clips"} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-semibold hover:bg-muted" data-testid="edit-music"><Music2 className="h-4 w-4" /> Music</button>
        ))}
        {tab === "edit" && tip(nothingToSave ? "Make a change first: trim, split, or add an intro or outro" : "Saves the edited episode to your Library as a new copy. Your original stays, and nothing goes to your podcast until you add it there.", (
          <span className="inline-flex">
            <Button type="button" onClick={() => { if (shortKeep && !window.confirm(`This keeps only ${hms(keepLen)} of ${hms(pos.d)}. Save it anyway?`)) return; makeEdit.mutate(); }} disabled={busy || makeEdit.isPending || nothingToSave} className="h-10 shrink-0 gap-2 rounded-lg bg-[#053877] px-5 text-white hover:bg-[#0a4a99] disabled:pointer-events-none" data-testid="edit-make">
              {busy || makeEdit.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><Library className="h-4 w-4" /> Save to Library</>}
            </Button>
          </span>
        ))}
      </div>
    </div>
  );
  // The toolbar only says where the work is: marking, naming and making all happen on the timeline, in order.
  const clipTools = (
    <>
      <span className="min-w-0 truncate text-sm text-muted-foreground">Mark the moment on the timeline below.</span>
      {mark.in !== null && <button type="button" onClick={reset} className="ml-auto text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" data-testid="mark-reset">Start over</button>}
    </>
  );
  const make = () => {
    if (!title.trim()) { titleRef.current?.focus(); return toast({ title: "Give the clip a name", description: "It's the headline across the top of the clip." }); }
    if (!formats.length) return toast({ title: "Pick at least one shape", description: "Vertical for Reels, TikTok and Shorts; square for the feed; wide for YouTube." });
    makeClip.mutate();
  };
  // Step 3, once both ends are marked: name it, pick the shapes, make it.
  const finish = (
    <>
      <TimelineButton tip="Play just the clip" onClick={preview} testid="mark-preview">
        <Play className="h-4 w-4" /> Play clip
      </TimelineButton>
      <span className="text-xs font-semibold tabular-nums text-violet-700 dark:text-violet-300">{hms(len)}</span>
      <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />
      <Input ref={titleRef} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") make(); }} maxLength={90} placeholder="3. Name the clip" className={`h-9 w-56 min-w-0 ${title.trim() ? "" : "border-violet-400 ring-2 ring-violet-200 dark:ring-violet-900"}`} data-testid="mark-title" />
      <div className="flex gap-1" role="group" aria-label="Shapes">
        {CLIP_FORMATS.map((f) => {
          const on = formats.includes(f);
          return (
            <Tooltip key={f}>
              <TooltipTrigger asChild>
                <button type="button" aria-pressed={on} onClick={() => setFormats(CLIP_FORMATS.filter((x) => (x === f ? !on : formats.includes(x))))} className={`h-9 rounded-lg border px-2.5 text-xs font-semibold capitalize transition-colors ${on ? "border-violet-600 bg-violet-600 text-white" : "border-border bg-background text-foreground hover:border-violet-400"}`} data-testid={`mark-shape-${f}`}>{f}</button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">{f === "vertical" ? "9:16, for Reels, TikTok and Shorts" : f === "square" ? "1:1, for the Instagram and Facebook feed" : "16:9, for YouTube, LinkedIn and X"}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      {tip(
        `1 credit per shape. ${source === "clean" ? "From the clean episode" : "From the original"}, with animated captions.`,
        <span className="shrink-0">
          <Button type="button" onClick={make} disabled={makeClip.isPending} className="h-9 gap-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700" data-testid="mark-make">
            {makeClip.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />} Make clip{formats.length ? ` · ${formats.length} credit${formats.length === 1 ? "" : "s"}` : ""}
          </Button>
        </span>,
      )}
    </>
  );

  return (
    <div data-testid="episode-tools">
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2" data-testid="edit-panel">
        <div className="flex gap-1 rounded-xl bg-muted/60 p-1" role="group" aria-label="What you're doing">
          {([["edit", "Edit episode", Pencil], ["clip", "Make a clip", Clapperboard]] as const).map(([k, label, I]) => (
            <button key={k} type="button" aria-pressed={tab === k} onClick={() => onTab(k)} className={`${seg} ${tab === k ? (k === "clip" ? "bg-violet-600 text-white" : "bg-[#F0A71F] text-[#1a1200]") : "text-muted-foreground hover:text-foreground"}`} data-testid={`mode-${k}`}>
              <I className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        {epSource && (
          <div className="inline-flex rounded-full border border-border p-0.5 text-xs" role="group" aria-label="Which version">
            {(["clean", "original"] as const).map((v) => (
              <Tooltip key={v}>
                <TooltipTrigger asChild>
                  <button type="button" aria-pressed={epSource === v} onClick={() => onSource(v)} className={`rounded-full px-2.5 py-1 font-semibold capitalize ${epSource === v ? "bg-[#053877] text-white dark:bg-white dark:text-[#000741]" : "text-muted-foreground hover:text-foreground"}`} data-testid={`viewer-source-${v}`}>{v}</button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[15rem] text-xs">{v === "clean" ? "The clean episode: ums, false starts and dead air taken out" : "The episode as it was recorded"}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />
        {tab === "clip" ? clipTools : editTools}
      </div>
      {/* The player as wide as the screen's height allows, centred. */}
      <div className="rounded-2xl border border-border bg-card p-3 shadow-sm" data-testid="viewer-frame">
        <div className="mx-auto w-full" style={{ maxWidth: "calc((100vh - 24rem) * 16 / 9)" }}>{viewer}</div>
      </div>
      <div className="mt-3 rounded-2xl border border-border bg-card p-3">
        {tab === "clip" ? (
          // A clip is marked with two buttons and the playhead: nothing to drag but the playhead.
          <TrimStrip
            videoRef={videoRef}
            duration={pos.d}
            time={pos.t}
            start={0}
            end={pos.d}
            trimming={false}
            tone="violet"
            marked={mark.in === null ? null : { from: mark.in, to: mark.out }}
            maxLen={180}
            actions={
              <>
                <TimelineButton tip="The clip starts where the playhead is" onClick={() => setMark({ in: now(), out: null })} testid="mark-in" tone="violet">
                  <ArrowLeftToLine className="h-4 w-4" /> Start here
                </TimelineButton>
                <TimelineButton
                  tip={mark.in === null ? "Press Start here first" : "The clip ends where the playhead is"}
                  disabled={mark.in === null}
                  onClick={() => {
                    const t = now();
                    if (mark.in === null) return;
                    if (t - mark.in < 5) return toast({ title: "Move the playhead further on", description: "The end has to be at least 5 seconds after the start.", variant: "destructive" });
                    if (t - mark.in > 180) {
                      // Past the limit: end it at 3 minutes, and show that spot, rather than refuse.
                      const end = mark.in + 180;
                      setMark((m) => ({ in: m.in, out: end }));
                      seek(end);
                      return toast({ title: `Ended at ${hms(end)}: clips are 3 minutes at most`, description: "That's the longest Shorts and Reels allow. To end it earlier, move the playhead back and press End here again." });
                    }
                    setMark((m) => ({ in: m.in, out: t }));
                  }}
                  testid="mark-out"
                  tone="violet"
                >
                  <ArrowRightToLine className="h-4 w-4" /> End here
                </TimelineButton>
                {mark.in !== null && mark.out !== null ? finish : (
                  <span className="hidden text-xs text-muted-foreground sm:inline" data-testid="mark-step">
                    {mark.in === null
                      ? "1. Move the playhead to where the clip starts, then press Start here."
                      : pos.t - mark.in > 180
                        ? <span className="font-semibold text-destructive">That's {hms(pos.t - mark.in)}. A clip is 3 minutes at most: End here ends it at {hms(mark.in + 180)}.</span>
                        : pos.t < mark.in + 5
                          ? `2. Move the playhead past ${hms(mark.in + 5)}, to where the clip ends, then press End here.`
                          : `2. ${hms(pos.t - mark.in)} so far. Press End here when the playhead is where it ends.`}
                  </span>
                )}
              </>
            }
            onChange={() => {}}
          />
        ) : (
          <TrimStrip
            videoRef={videoRef}
            duration={pos.d}
            time={pos.t}
            start={trim.start}
            end={keepEnd}
            minLen={5}
            tone="gold"
            cuts={trimming ? cuts : []}
            onCuts={(c) => setCuts(mergeCuts(c))}
            segs={trimming ? undefined : keptSegs}
            lead={<><BookendTile label="Intro" value={intro} onChange={setIntro} />{intro && <TransitionButton where="intro" value={introT} onChange={setIntroT} />}</>}
            tail={<>{outro && <TransitionButton where="outro" value={outroT} onChange={setOutroT} />}<BookendTile label="Outro" value={outro} onChange={setOutro} /></>}
            suggestions={pending}
            trimming={trimming}
            onTrimming={() => { setTrimming(true); setSel(null); }}
            splits={bounds.slice(1, -1)}
            selected={sel}
            onPick={trimming ? undefined : pick}
            onDelete={del}
            onSplit={() => { if (trimming) setTrimming(false); split(); }}
            canSplit={canSplit}
            actions={
              <>
                {/* Two jobs, named on the button: Trim is only the start and end; Split takes out a section. */}
                {/* Scissors mean "cut" to everyone, so they're on Split; Trim wears brackets, like its yellow handles. */}
                <TimelineButton tip={canSplit ? "Split: take out an unwanted section. Split at the start and end of it, click the piece, then delete it. (S)" : "Split: take out an unwanted section. Move the blue playhead to where it starts, then split."} onClick={() => { if (trimming) setTrimming(false); split(); }} disabled={!canSplit} testid="tool-split">
                  <Scissors className="h-4 w-4" /> Split
                </TimelineButton>
                <TimelineButton tip="Trim: only the start and end. Drag the yellow handles to where it should begin and finish." on={trimming} onClick={() => { setTrimming((v) => !v); setSel(null); }} testid="tool-trim">
                  <Brackets className="h-4 w-4" /> Trim start & end
                </TimelineButton>
                <span className="ml-1 text-sm tabular-nums text-muted-foreground" title="How long it will be" data-testid="tool-length">Length {hms(Math.max(0, keepLen - cutTotal))}</span>
              </>
            }
            extra={trimming || bounds.length > 2 || sel ? (
              // Done with this one edit (a trim, or a split and a delete): what was
              // cut stays cut, the split lines and the pick clear, and the next edit
              // starts clean. The blue button makes the episode once they're all done.
              <>
                {/* After a split, say the next step: pick the piece to take out. */}
                {!trimming && bounds.length > 2 && !sel && <span className="text-xs font-medium text-muted-foreground" data-testid="tool-next">Now click the piece to take out</span>}
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* A picked piece is picked to be taken out, so Done takes it out. */}
                    <button type="button" onClick={() => { if (sel) del(); setTrimming(false); setSplits([]); setSel(null); }} className="ml-1 inline-flex h-8 items-center rounded-lg bg-[#F0A71F] px-4 text-sm font-bold text-[#1a1200] hover:bg-[#f5b94a]" data-testid="tool-done">{sel ? `Take out ${hms(sel[1] - sel[0])} · Done` : "Done"}</button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[15rem] text-xs">{sel ? "Takes the picked piece out, and finishes this edit." : "Finish this edit and keep going. Make edited episode when they're all done."}</TooltipContent>
                </Tooltip>
              </>
            ) : undefined}
            onChange={(st, en) => setTrim({ start: st < 0.25 ? 0 : st, end: en >= pos.d - 0.25 ? 0 : en })}
          />
        )}
        {footer}
        {musicDialog}
      </div>
      {tab === "edit" && (ed?.status === "failed" || sug?.status === "failed" || (sug?.status === "done" && sug.source === source && !(sug.items ?? []).length)) && (
        <p className="mt-2 text-xs text-muted-foreground">
          {ed?.status === "failed" ? <span className="text-destructive">The last edit didn't work: {ed.error || "try again"}. </span> : null}
          {sug?.status === "failed" ? <span className="text-destructive">The suggestions didn't work: {sug.error || "try again"}.</span> : sug?.status === "done" && !(sug.items ?? []).length ? "The SI found nothing to cut: it starts and ends cleanly." : null}
        </p>
      )}
      {tab === "edit" && pending.length > 0 && (
        <div className="mt-3 rounded-xl border border-red-200/70 bg-red-50/40 p-3 dark:border-red-900/50 dark:bg-red-950/20" data-testid="edit-suggest">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-red-600" /> {pending.length} suggested edit{pending.length === 1 ? "" : "s"}, dotted on the timeline</p>
            <button type="button" onClick={() => pending.forEach(accept)} className="text-xs font-semibold text-red-700 underline underline-offset-2 dark:text-red-400" data-testid="suggest-accept-all">Accept all</button>
          </div>
          <ul className="space-y-1.5">
            {pending.map((it, n) => (
              <li key={sugKey(it.i)} className="flex flex-wrap items-center gap-2 text-sm">
                <button type="button" onClick={() => seek(it.from)} className="shrink-0 rounded-md bg-background px-1.5 py-0.5 text-xs font-semibold tabular-nums hover:bg-muted" title="Play from here">
                  {it.kind === "start" ? `Start at ${hms(it.to)}` : it.kind === "end" ? `End at ${hms(it.from)}` : `Cut ${hms(it.from)}–${hms(it.to)}`}
                </button>
                <span className="min-w-0 flex-1 text-muted-foreground">{it.reason}</span>
                <button type="button" onClick={() => accept(it)} className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-red-700" data-testid={`suggest-accept-${n}`}><Check className="h-3 w-3" /> Accept</button>
                <button type="button" onClick={() => setAnswered((a) => [...a, sugKey(it.i)])} className="text-xs text-muted-foreground hover:text-foreground">Dismiss</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A round icon on an episode card, its name on hover. */
function CardIcon({ tip, onClick, testid, children }: { tip: string; onClick: () => void; testid: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onClick} aria-label={tip} className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:border-[#053877]/40 hover:bg-[#053877]/[0.06]" data-testid={testid}>{children}</button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">{tip}</TooltipContent>
    </Tooltip>
  );
}

/** A timeline tool, like Canva's: icon and word, pressed while it's on. */
/** Music for the episode: a track, where it goes, and how loud. */
function EpisodeMusicDialog({ open, onOpenChange, start, end, picked, onAdd }: { open: boolean; onOpenChange: (v: boolean) => void; start: number; end: number; picked: Cut | null; onAdd: (m: EpisodeMusic) => void }) {
  const tracks = useQuery<{ key: string; name: string; mood: string; durationSec: number }[]>({ queryKey: ["/api/music"], queryFn: async () => (await apiRequest("GET", "/api/music")).json(), staleTime: 300_000, enabled: open });
  const [key, setKey] = useState("");
  const [where, setWhere] = useState<"open" | "close" | "picked" | "all">("open");
  const [level, setLevel] = useState<"under" | "full">("under");
  const [playing, setPlaying] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => { if (open) setWhere(picked ? "picked" : "open"); else { audio.current?.pause(); setPlaying(""); } }, [open, picked]);
  const play = (k: string) => {
    audio.current?.pause();
    if (playing === k) { setPlaying(""); return; }
    const a = new Audio(`/api/music/${k}/audio`);
    a.volume = 0.6;
    a.onended = () => setPlaying("");
    void a.play();
    audio.current = a;
    setPlaying(k);
  };
  const range: [number, number] = where === "open" ? [start, Math.min(end, start + 30)] : where === "close" ? [Math.max(start, end - 30), end] : where === "picked" && picked ? picked : [start, end];
  const track = tracks.data?.find((t) => t.key === key);
  const opt = (on: boolean) => `rounded-xl border px-3 py-2 text-left text-sm ${on ? "border-[#053877] bg-[#053877]/5 ring-1 ring-[#053877]/30" : "border-border hover:bg-muted"}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Music for the episode</DialogTitle>
          <DialogDescription>Our own tracks, cleared for podcasts and YouTube. It's mixed in when you save to your Library.</DialogDescription>
        </DialogHeader>
        <p className="text-xs font-semibold text-muted-foreground">Where</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setWhere("open")} className={opt(where === "open")}><span className="block font-semibold">The opening</span><span className="text-xs text-muted-foreground">First 30 seconds</span></button>
          <button type="button" onClick={() => setWhere("close")} className={opt(where === "close")}><span className="block font-semibold">The close</span><span className="text-xs text-muted-foreground">Last 30 seconds</span></button>
          <button type="button" onClick={() => picked && setWhere("picked")} disabled={!picked} className={`${opt(where === "picked")} disabled:opacity-50`}><span className="block font-semibold">The piece I picked</span><span className="text-xs text-muted-foreground">{picked ? `${hms(picked[0])}–${hms(picked[1])}` : "Split, then click a piece"}</span></button>
          <button type="button" onClick={() => setWhere("all")} className={opt(where === "all")}><span className="block font-semibold">The whole episode</span><span className="text-xs text-muted-foreground">Quietly, all the way through</span></button>
        </div>
        <p className="text-xs font-semibold text-muted-foreground">How loud</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setLevel("under")} className={opt(level === "under")}><span className="block font-semibold">Under the voices</span><span className="text-xs text-muted-foreground">Soft, while people talk</span></button>
          <button type="button" onClick={() => setLevel("full")} className={opt(level === "full")}><span className="block font-semibold">Full</span><span className="text-xs text-muted-foreground">For a part with no talking</span></button>
        </div>
        <p className="text-xs font-semibold text-muted-foreground">Track</p>
        {tracks.isLoading ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /> : (
          <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-xl border border-border">
            {(tracks.data ?? []).map((t) => (
              <li key={t.key} className={`flex items-center gap-2 px-2 py-1.5 ${key === t.key ? "bg-[#053877]/5" : ""}`}>
                <button type="button" onClick={() => play(t.key)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border hover:bg-muted" aria-label={playing === t.key ? "Stop" : `Play ${t.name}`}>{playing === t.key ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}</button>
                <button type="button" onClick={() => setKey(t.key)} className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-sm">
                  <span className="truncate font-medium">{t.name}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">{t.mood}{key === t.key && <Check className="h-4 w-4 text-[#053877] dark:text-white" />}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button onClick={() => track && onAdd({ key: track.key, name: track.name, from: range[0], to: range[1], level })} disabled={!track || range[1] - range[0] < 1} className="gap-2 bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="episode-music-add"><Music2 className="h-4 w-4" />{track ? `Add ${track.name}, ${hms(range[0])}–${hms(range[1])}` : "Choose a track"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TimelineButton({ tip, on, onClick, disabled, testid, tone, square, children }: { tip: string; on?: boolean; onClick: () => void; disabled?: boolean; testid: string; tone?: "violet"; square?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      {/* A disabled button fires no hover, so the name sits on a wrapper: it still says why. */}
      <TooltipTrigger asChild>
        <span className="inline-flex" tabIndex={disabled ? 0 : undefined}>
        <button type="button" aria-pressed={on} onClick={onClick} disabled={disabled} aria-label={tip} className={`inline-flex h-9 items-center gap-1.5 rounded-lg border ${square ? "w-9 justify-center" : "px-3"} text-sm font-semibold tabular-nums transition-colors disabled:pointer-events-none disabled:opacity-40 ${on ? "border-[#F0A71F] bg-[#F0A71F] text-[#1a1200]" : tone === "violet" ? "border-violet-300 bg-background text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950" : "border-border bg-background hover:bg-muted"}`} data-testid={testid}>
          {children}
        </button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[16rem] text-xs">{tip}</TooltipContent>
    </Tooltip>
  );
}

/** Cuts in order, with any that touch or overlap made one. */
function mergeCuts(cuts: Cut[]): Cut[] {
  const out: Cut[] = [];
  for (const c of [...cuts].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && c[0] <= last[1] + 0.05) last[1] = Math.max(last[1], c[1]);
    else out.push([c[0], c[1]]);
  }
  return out;
}

/** A row of choices, each with an icon and a hover note saying what it's for. */
function Seg<T extends string>({ value, onChange, options, testid, small = false, strong = false }: {
  value: T;
  onChange: (v: T) => void;
  options: { v: T; label: string; icon: React.ComponentType<{ className?: string }>; tip: string }[];
  testid: string;
  small?: boolean;
  /** The job switch: bigger, and the picked one in its colour. */
  strong?: boolean;
}) {
  return (
    <div className={`inline-flex rounded-full border border-border bg-card p-1 ${strong ? "shadow-sm" : ""}`} role="group">
      {options.map((o) => {
        const on = o.v === value;
        const picked = strong ? (o.v === "clip" ? "bg-violet-600 text-white" : o.v === "edit" ? "bg-[#F0A71F] text-[#1a1200]" : "bg-[#053877] text-white dark:bg-white dark:text-[#000741]") : small ? "bg-[#F0A71F] text-[#1a1200]" : "bg-[#053877] text-white dark:bg-white dark:text-[#000741]";
        return (
          <Tooltip key={o.v}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onChange(o.v)}
                className={`inline-flex items-center gap-1.5 rounded-full font-semibold transition-colors ${strong ? "px-4 py-2 text-sm" : small ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-xs"} ${on ? picked : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                data-testid={`${testid}-${o.v}`}
              >
                <o.icon className={strong ? "h-4 w-4" : "h-3.5 w-3.5"} /> {o.label}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[16rem] text-xs">{o.tip}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

const CARD_ICON = "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-foreground/80 hover:border-[#053877]/40 hover:bg-[#053877]/[0.05] hover:text-foreground";

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
/**
 * Too long? Play the clip, set where it should start and end (the buttons take the
 * playhead, the sliders fine-tune), hear it back, then we remake every shape from there.
 */
function TrimClipDialog({ c, open, onOpenChange }: { c: ClipRow; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const len = Math.max(0, c.endSec - c.startSec);
  const [range, setRange] = useState<[number, number]>([0, len]);
  const [t, setT] = useState(0);
  const vid = useRef<HTMLVideoElement>(null);
  const stopAt = useRef<number | null>(null);
  useEffect(() => { if (open) { setRange([0, len]); setT(0); } }, [open, len]);
  const src = c.verticalUrl || c.url || c.squareUrl;
  const newLen = range[1] - range[0];
  const playNew = () => { const v = vid.current; if (!v) return; v.currentTime = range[0]; stopAt.current = range[1]; void v.play(); };
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/host/clips/${c.id}/text`, { startSec: c.startSec + range[0], endSec: c.startSec + range[1] })).json(),
    onSuccess: () => {
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ["/api/host/clips"] });
      toast({ title: "Trimming the clip", description: `Now ${hms(newLen)}. Every shape is remade from the new points, with its music; about a minute.` });
    },
    onError: (e: Error) => toast({ title: "Couldn't trim that", description: e.message, variant: "destructive" }),
  });
  const changed = range[0] > 0.2 || range[1] < len - 0.2;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Trim this clip</DialogTitle>
          <DialogDescription>Play it, then set where it should start and end.</DialogDescription>
        </DialogHeader>
        {src && (
          <video
            ref={vid} src={src} controls playsInline
            onTimeUpdate={(e) => { const v = e.currentTarget; setT(v.currentTime); if (stopAt.current !== null && v.currentTime >= stopAt.current) { v.pause(); stopAt.current = null; } }}
            className="mx-auto max-h-[42vh] rounded-lg bg-black"
          />
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={() => setRange(([, b]) => [Math.min(t, b - 5), b])} className="gap-1.5 rounded-full" data-testid="clip-trim-start"><ArrowLeftToLine className="h-4 w-4" /> Start here ({hms(t)})</Button>
          <Button type="button" variant="outline" onClick={() => setRange(([a]) => [a, Math.max(t, a + 5)])} className="gap-1.5 rounded-full" data-testid="clip-trim-end"><ArrowRightToLine className="h-4 w-4" /> End here ({hms(t)})</Button>
        </div>
        <label className="block text-xs font-semibold text-muted-foreground">Starts at {hms(range[0])}
          <input type="range" min={0} max={len} step={0.1} value={range[0]} onChange={(e) => { const v = Number(e.target.value); setRange(([, b]) => [Math.min(v, b - 5), b]); if (vid.current) vid.current.currentTime = v; }} className="mt-1 w-full accent-[#053877]" />
        </label>
        <label className="block text-xs font-semibold text-muted-foreground">Ends at {hms(range[1])}
          <input type="range" min={0} max={len} step={0.1} value={range[1]} onChange={(e) => { const v = Number(e.target.value); setRange(([a]) => [a, Math.max(v, a + 5)]); if (vid.current) vid.current.currentTime = v; }} className="mt-1 w-full accent-[#053877]" />
        </label>
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{hms(len)} → {hms(newLen)}</span>
          <span className="text-muted-foreground">{changed ? ` (${Math.round(len - newLen)} sec shorter)` : ""}</span>
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={playNew} className="gap-1.5 rounded-full"><Play className="h-4 w-4" /> Play the new version</Button>
          <Button type="button" onClick={() => save.mutate()} disabled={!changed || save.isPending} className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" data-testid="clip-trim-save">{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Trim the clip</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A clip's caption look: size as a multiple of the usual, and where their middle sits (fraction of the height; null = the usual place). */
type CaptionLook = { scale: number; pos: number | null };
const readLook = (raw: string | null | undefined): CaptionLook => {
  try { const j = raw ? JSON.parse(raw) : null; return { scale: Number(j?.scale) || 1, pos: j?.pos ?? null }; } catch { return { scale: 1, pos: null }; }
};
const PLACES = [
  { label: "Top", pos: 0.24 },
  { label: "Middle", pos: 0.5 },
  { label: "Lower third", pos: null },
  { label: "Bottom", pos: 0.9 },
] as const;

/**
 * The vertical clip, drawn small, with the band and captions where the remake will put them: the
 * worker's own layout (captionLayout in agent/wordCaptions.ts) in proportion, so what you see is
 * what you get.
 */
function CaptionPreview({ c, title, subtitle, look }: { c: ClipRow; title: string; subtitle: string; look: CaptionLook }) {
  const W = 200, H = Math.round((W * 16) / 9);
  const band = Math.round((220 / 1920) * H);
  const size = 0.066 * W * Math.min(1.8, Math.max(0.6, look.scale));
  const lead = size * 1.24;
  const h = lead * 2 + size * 0.5;
  const centre = H * (look.pos ?? 0.82);
  const top = Math.max(band + H * 0.015, Math.min(H - h - H * 0.02, centre - h / 2));
  const src = c.verticalUrl || c.squareUrl || c.url;
  const word: React.CSSProperties = { WebkitTextStroke: `${Math.max(1, size * 0.12)}px #000`, paintOrder: "stroke fill" };
  return (
    <div className="relative mx-auto overflow-hidden rounded-xl bg-black shadow-lg" style={{ width: W, height: H }} data-testid="caption-preview">
      {src && <video src={`${src}#t=1`} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" />}
      <div className="absolute inset-x-0 top-0 flex flex-col items-center justify-center px-2 text-center" style={{ height: band, background: "#000741" }}>
        <p className="line-clamp-1 text-[9px] font-extrabold leading-tight text-white">{title || "Your title"}</p>
        {subtitle && <p className="line-clamp-1 text-[6px] font-bold uppercase tracking-wide" style={{ color: "#F0A71F" }}>{subtitle}</p>}
      </div>
      <div className="absolute inset-x-0 flex flex-col items-center justify-center text-center" style={{ top, height: h, fontFamily: "Montserrat, 'Arial Black', sans-serif", fontWeight: 800, fontSize: size, lineHeight: `${lead}px`, color: "#fff" }}>
        <span style={word}>That's when I knew</span>
        <span style={word}>we had to <span className="rounded px-0.5" style={{ background: "#F0A71F", WebkitTextStroke: "0" }}>keep</span> going</span>
      </div>
    </div>
  );
}

export function EditTextDialog({ c, open, onOpenChange }: { c: ClipRow; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState(c.title);
  const [subtitle, setSubtitle] = useState(c.subtitle);
  const [look, setLook] = useState<CaptionLook>(() => readLook(c.captionStyle));
  // Three better titles from what's said in it; one click puts one in the box.
  const [ideas, setIdeas] = useState<string[]>([]);
  const [thinking, setThinking] = useState(false);
  useEffect(() => {
    if (open) { setTitle(c.title); setSubtitle(c.subtitle); setIdeas([]); setLook(readLook(c.captionStyle)); }
  }, [open, c.title, c.subtitle, c.captionStyle]);
  const suggest = async () => {
    setThinking(true);
    try { setIdeas(((await (await apiRequest("POST", `/api/host/clips/${c.id}/suggest-title`)).json()) as { titles: string[] }).titles); }
    catch (e) { toast({ title: "No ideas just now", description: (e as Error).message.replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, ""), variant: "destructive" }); }
    finally { setThinking(false); }
  };
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/host/clips/${c.id}/text`, { title, subtitle, captionStyle: look })).json(),
    onSuccess: () => {
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ["/api/host/clips"] });
      toast({ title: "Updating the clip", description: "Every shape, with the new words and captions. About a minute." });
    },
    onError: (e: Error) => toast({ title: "Couldn't update that", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit text and captions</DialogTitle>
          <DialogDescription>The words in the band at the top, and how big the captions are and where they sit. We remake every shape of the clip with them, which takes about a minute.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 sm:grid-cols-[1fr_200px]">
        <div className="space-y-4">
          <div>
            <Label htmlFor={`clip-title-${c.id}`}>Title</Label>
            <Input id={`clip-title-${c.id}`} className="mt-1" value={title} maxLength={90} onChange={(e) => setTitle(e.target.value)} data-testid="input-clip-title" />
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">Short reads best: six words or so.</p>
              <button type="button" onClick={() => void suggest()} disabled={thinking} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#053877] hover:underline disabled:opacity-60 dark:text-white" data-testid="clip-title-suggest">{thinking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Suggest titles</button>
            </div>
            {ideas.length > 0 && (
              <div className="mt-2 flex flex-col gap-1.5">
                {ideas.map((t) => (
                  <button key={t} type="button" onClick={() => setTitle(t)} className={`rounded-lg border px-3 py-1.5 text-left text-sm ${title === t ? "border-[#053877] bg-[#053877]/5" : "border-border hover:bg-muted"}`}>{t}</button>
                ))}
              </div>
            )}
          </div>
          <div>
            <Label htmlFor={`clip-sub-${c.id}`}>Subtitle</Label>
            <Input id={`clip-sub-${c.id}`} className="mt-1" value={subtitle} maxLength={70} onChange={(e) => setSubtitle(e.target.value)} placeholder="Your show · the guest" data-testid="input-clip-subtitle" />
            <p className="mt-1 text-[11px] text-muted-foreground">The smaller gold line under the title, in capitals. Your show and the guest works well.</p>
          </div>
          <div className="space-y-3 rounded-xl border border-border p-3.5" data-testid="caption-controls">
            <p className="text-sm font-semibold">Captions</p>
            <div>
              <div className="flex items-center justify-between text-xs"><span className="font-medium">Size</span><span className="tabular-nums text-muted-foreground">{Math.round(look.scale * 100)}%</span></div>
              <Slider className="mt-2" min={60} max={180} step={5} value={[Math.round(look.scale * 100)]} onValueChange={([v]) => setLook((l) => ({ ...l, scale: v / 100 }))} aria-label="Caption size" data-testid="caption-size" />
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>Smaller</span><span>Bigger</span></div>
            </div>
            <div>
              <p className="text-xs font-medium">Where they sit</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {PLACES.map((p) => (
                  <button key={p.label} type="button" onClick={() => setLook((l) => ({ ...l, pos: p.pos }))} className={`rounded-full border px-3 py-1 text-xs font-medium ${(look.pos ?? null) === p.pos ? "border-[#053877] bg-[#053877] text-white" : "border-border hover:bg-muted"}`} data-testid={`caption-place-${p.label.toLowerCase().replace(/\s+/g, "-")}`}>{p.label}</button>
                ))}
              </div>
              <Slider className="mt-3" min={15} max={92} step={1} value={[Math.round((look.pos ?? 0.82) * 100)]} onValueChange={([v]) => setLook((l) => ({ ...l, pos: v / 100 }))} aria-label="Caption height on the clip" data-testid="caption-pos" />
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>Higher</span><span>Lower</span></div>
            </div>
            {(look.scale !== 1 || look.pos !== null) && <button type="button" onClick={() => setLook({ scale: 1, pos: null })} className="text-xs font-semibold text-[#053877] hover:underline dark:text-white">Back to the usual</button>}
          </div>
        </div>
        <div>
          <CaptionPreview c={c} title={title} subtitle={subtitle} look={look} />
          <p className="mt-2 text-center text-[11px] text-muted-foreground">How the vertical clip will look. Square and wide follow the same size and place.</p>
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

/** A clip in each of its sizes: a tab per shape, the video at that shape, and a download for it. */
export function ClipPreview({ c, onClose }: { c: ClipRow | null; onClose: () => void }) {
  const shapes = c ? ([
    { key: "vertical", label: "Vertical", ratio: "9:16", href: c.verticalUrl, box: "aspect-[9/16] h-[min(70vh,640px)]", tip: "Reels, TikTok and Shorts" },
    { key: "square", label: "Square", ratio: "1:1", href: c.squareUrl, box: "aspect-square h-[min(60vh,520px)]", tip: "the Instagram and Facebook feed, and LinkedIn" },
    { key: "wide", label: "Wide", ratio: "16:9", href: c.url, box: "aspect-video w-[min(80vw,760px)]", tip: "YouTube, LinkedIn and X" },
  ] as const).filter((x) => x.href) : [];
  const [pick, setPick] = useState<string>("vertical");
  useEffect(() => { if (c) setPick(shapes[0]?.key ?? "vertical"); }, [c?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = shapes.find((x) => x.key === pick) ?? shapes[0];
  return (
    <Dialog open={!!c} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-auto max-w-[95vw] p-4">
        <DialogHeader>
          <DialogTitle className="line-clamp-2 pr-8 text-base">{c?.title}</DialogTitle>
          <DialogDescription className="sr-only">The clip in each of its sizes</DialogDescription>
        </DialogHeader>
        {shapes.length > 1 && (
          <div className="flex gap-1 rounded-xl bg-muted/60 p-1" role="tablist" aria-label="Sizes">
            {shapes.map((x) => (
              <button key={x.key} type="button" role="tab" aria-selected={cur?.key === x.key} onClick={() => setPick(x.key)} className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${cur?.key === x.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`} data-testid={`clip-preview-${x.key}`}>
                {x.label} <span className="font-normal text-muted-foreground">{x.ratio}</span>
              </button>
            ))}
          </div>
        )}
        {cur && (
          <>
            <div className="flex justify-center">
              <video key={cur.href} src={cur.href} controls autoPlay playsInline className={`${cur.box} max-w-full rounded-xl bg-black object-contain`} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">Best for {cur.tip}</span>
              <Button asChild size="sm" variant="outline" className="gap-1.5 rounded-full">
                <a href={downloadHref(cur.href!, `${c!.title} ${cur.key}`)} download data-testid="clip-preview-download"><Download className="h-4 w-4" /> Download {cur.label.toLowerCase()}</a>
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ClipCard({ c, onPreview }: { c: ClipRow; onPreview: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [trimmingClip, setTrimmingClip] = useState(false);
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
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-[#000741] shadow-lg"><Play className="h-3.5 w-3.5 fill-current" /></span>
        </span>
        {updating && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#000741]/75 text-white backdrop-blur-[2px]">
            <Loader2 className="h-6 w-6 animate-spin text-[#F0A71F]" />
            <span className="text-xs font-semibold">{making ? (() => { const n = (c.editShapes || "vertical").split(",").filter(Boolean).length; return n > 1 ? `Making your clip in ${n} sizes…` : "Making your clip…"; })() : "Updating the text…"}</span>
          </span>
        )}
      </button>
      <div className="flex flex-1 flex-col p-2">
        {/* Which sizes this clip has: only what was made, never a size that isn't there. */}
        {files.length > 0 && <p className="mb-1 flex flex-wrap gap-1">{files.map((f) => <span key={f.label} className="rounded bg-muted px-1 py-px text-[10px] font-semibold tabular-nums text-muted-foreground">{f.label === "Vertical" ? "9:16" : f.label === "Square" ? "1:1" : "16:9"}</span>)}</p>}
        <p className="mb-0.5 inline-flex items-center gap-1 text-[10px] font-medium tabular-nums text-muted-foreground"><Clock3 className="h-3 w-3" /> {stamp(c.startSec)}–{stamp(c.endSec)}</p>
        <p className="line-clamp-2 text-xs font-semibold leading-snug text-foreground" title={c.reason || undefined}>{updating && c.editTitle ? c.editTitle : c.title}</p>
        {c.editStatus === "failed" && <p className="mt-1 text-xs text-destructive">Couldn't update the text. Try again.</p>}
        {/* One clear action, Post it; the rest are small icons with hover notes. */}
        <div className={`mt-auto flex items-center gap-1 pt-2 ${making ? "hidden" : ""}`}>
          <Button size="sm" onClick={() => setPosting(true)} className="h-7 min-w-0 flex-1 gap-1 rounded-full bg-[#053877] px-2 text-xs text-white hover:bg-[#0a4a99]" data-testid={`clip-post-${c.id}`}>
            <Send className="h-3 w-3" /> Post
          </Button>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={CARD_ICON} aria-label="More" data-testid={`clip-more-${c.id}`}><MoreHorizontal className="h-4 w-4" /></button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">Download, copy the caption, edit the text, or delete</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem className="gap-2" onSelect={onPreview}><Play className="h-3.5 w-3.5" /> Preview {files.length > 1 ? "each size" : "it"}</DropdownMenuItem>
              <DropdownMenuSeparator />
              {files.map((f) => (
                <DropdownMenuItem key={f.label} asChild className="flex-col items-start gap-0">
                  <a href={downloadHref(f.href, `${c.title} ${f.label.toLowerCase()}`)} download>
                    <span className="flex items-center gap-2 text-sm font-medium"><Download className="h-3.5 w-3.5" /> Download {f.label.toLowerCase()}</span>
                    <span className="pl-5 text-xs text-muted-foreground">{f.tip}</span>
                  </a>
                </DropdownMenuItem>
              ))}
              {c.subtitlesUrl && (
                <DropdownMenuItem asChild className="gap-2">
                  <a href={downloadHref(c.subtitlesUrl, `${c.title} subtitles`)} download><FileText className="h-3.5 w-3.5" /> Download subtitles (.srt)</a>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {c.caption && (
                <DropdownMenuItem
                  className="gap-2"
                  onSelect={() =>
                    navigator.clipboard.writeText(c.caption).then(
                      () => toast({ title: "Caption copied", description: "Paste it in with the clip." }),
                      () => toast({ title: "Couldn't copy", description: c.caption }),
                    )
                  }
                >
                  <Copy className="h-3.5 w-3.5" /> Copy the caption
                </DropdownMenuItem>
              )}
              {!updating && <DropdownMenuItem className="gap-2" onSelect={() => setTrimmingClip(true)} data-testid="clip-trim"><Brackets className="h-3.5 w-3.5" /> Trim this clip</DropdownMenuItem>}
              {!updating && <DropdownMenuItem className="gap-2" onSelect={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Edit text and captions</DropdownMenuItem>}
              <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive" onSelect={() => setDeleting(true)}><Trash2 className="h-3.5 w-3.5" /> Delete this clip</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
    <EditTextDialog c={c} open={editing} onOpenChange={setEditing} />
    <TrimClipDialog c={c} open={trimmingClip} onOpenChange={setTrimmingClip} />
    <ConfirmDelete open={deleting} onOpenChange={setDeleting} title={`Delete "${c.title}"?`} description="It moves to Recently deleted, where you can put it back for 15 days. The episode isn't touched." url={`/api/host/clips/${c.id}`} restorable />
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
/**
 * Their credits, on every page: at the top of the side menu (and as a coin on
 * the folded rail), opening the plan and credits dialog. Test accounts read
 * Unlimited.
 */
export function NavCredits({ variant }: { variant: "column" | "rail" | "chip" | "pill" }) {
  const [open, setOpen] = useState(false);
  const features = useQuery<{ post: boolean; beta?: Beta; plan?: Plan | null }>({ queryKey: ["/api/host/features"], queryFn: async () => (await apiRequest("GET", "/api/host/features")).json(), staleTime: 60_000 });
  const beta = features.data?.beta;
  const plan = features.data?.plan;
  if (!beta) return null;
  const n = beta.unlimited ? "Unlimited" : `${beta.tokens.toLocaleString()} credit${beta.tokens === 1 ? "" : "s"}`;
  return (
    <>
      {variant === "chip" ? (
        // The phone's header: the coin and the number, so it says what it is.
        <button type="button" onClick={() => setOpen(true)} aria-label={`${n}. Get more`} className="inline-flex items-center gap-1.5 rounded-full border border-[#F0A71F]/40 bg-[#F0A71F]/10 px-2.5 py-1 text-xs font-bold tabular-nums text-white" data-testid="phone-credits">
          <Coins className="h-3.5 w-3.5 text-[#F0A71F]" /> {beta.unlimited ? "Unlimited" : beta.tokens.toLocaleString()}
        </button>
      ) : variant === "pill" ? (
        // The light column's: a small gold chip beside the mark.
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => setOpen(true)} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#F0A71F]/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#8a5a00] transition-colors hover:bg-[#F0A71F]/25 dark:text-[#F0A71F]" data-testid="nav-credits">
              <Coins className="h-3 w-3" /> {beta.unlimited ? "Unlimited" : beta.tokens.toLocaleString()}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">{n}{plan ? ` · ${plan.name} plan` : ""}. Get more</TooltipContent>
        </Tooltip>
      ) : variant === "rail" ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => setOpen(true)} aria-label={n} className="relative flex h-10 w-10 items-center justify-center rounded-lg text-[#b36b00] hover:bg-muted dark:text-[#F0A71F]" data-testid="nav-rail-credits">
              <Coins className="h-4 w-4" />
              {!beta.unlimited && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-[#F0A71F] px-1 text-center text-[9px] font-bold leading-[16px] text-[#1a1200]">{beta.tokens > 999 ? "999+" : beta.tokens}</span>}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">{n}</TooltipContent>
        </Tooltip>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-2 rounded-xl border border-[#F0A71F]/30 bg-[#F0A71F]/10 px-3 py-2 text-left transition-colors hover:bg-[#F0A71F]/20" data-testid="nav-credits">
          <Coins className="h-5 w-5 shrink-0 text-[#F0A71F]" />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[13px] font-semibold tabular-nums text-white">{n}</span>
            <span className="block truncate text-[11px] font-semibold text-[#F0A71F]">{plan ? `${plan.name} plan · Get more` : "Get more"}</span>
          </span>
        </button>
      )}
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

/**
 * "Add music": the last step of the pipeline, asked once the clips are made.
 * Play any track first; picking one mixes it into every clip (a few seconds
 * a clip, no credits). Skip leaves them as they are; either can be changed.
 */
function PipelineMusic({ rec, onChange, tall }: { rec: Rec; onChange: () => void; tall?: boolean }) {
  const { toast } = useToast();
  const tracks = useQuery<{ key: string; name: string; mood: string; durationSec: number }[]>({ queryKey: ["/api/music"], queryFn: async () => (await apiRequest("GET", "/api/music")).json(), staleTime: 300_000 });
  const [playing, setPlaying] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
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
  const choose = async (key: string) => {
    audio.current?.pause();
    setPlaying(null);
    setBusy(key || "skip");
    try {
      await apiRequest("POST", `/api/host/recordings/${rec.id}/music`, { key });
      onChange();
    } catch (e) {
      toast({ title: "Couldn't do that", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mt-2 rounded-xl border border-[#F0A71F]/40 bg-[#F0A71F]/[0.06] p-2" data-testid="pipeline-music">
      <ul className={`flex flex-col gap-0.5 overflow-y-auto ${tall ? "max-h-[min(52vh,26rem)]" : "max-h-64"}`}>
        {(tracks.data ?? []).map((t) => (
          <li key={t.key} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-background/70">
            <button type="button" onClick={() => play(t.key)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#053877] text-white" aria-label={playing === t.key ? `Stop ${t.name}` : `Play ${t.name}`}>
              {playing === t.key ? <Pause className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3 fill-current" />}
            </button>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium text-foreground">{t.name}</span>
              <span className="block text-[11px] text-muted-foreground">{t.mood}</span>
            </span>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void choose(t.key)} className="h-7 rounded-full px-2.5 text-xs" data-testid={`music-use-${t.key}`}>
              {busy === t.key ? <Loader2 className="h-3 w-3 animate-spin" /> : "Use"}
            </Button>
          </li>
        ))}
      </ul>
      <button type="button" disabled={busy !== null} onClick={() => void choose("")} className="mt-1 w-full rounded-lg py-1.5 text-xs font-semibold text-muted-foreground hover:bg-background/70 hover:text-foreground" data-testid="music-skip">
        {busy === "skip" ? "…" : "No music, thanks"}
      </button>
    </div>
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
    refetchInterval: (q) => ((q.state.data as Rec[] | undefined)?.some((r) => r.clipStatus === "queued" || r.clipStatus === "running" || cleanOf(r)?.status === "running" || /"status":\s*"(queued|running)"/.test(r.episodeEdit) || /"status":\s*"(queued|running)"/.test(r.musicMix) || /"status":\s*"(queued|running)"/.test(r.editSuggest)) ? 4000 : false),
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

  useEffect(() => { setPreview(null); setMusicOpen(false); }, [rec?.id]);

  // When a run finishes, the clips list needs a fresh read right away.
  useEffect(() => {
    if (rec?.clipStatus === "done") void qc.invalidateQueries({ queryKey: ["/api/host/clips"] });
  }, [rec?.clipStatus, qc]);

  // The Viewer: clips, or the whole episode (clean or original) to watch, mark and edit.
  const [view, setView] = useState<"clips" | "episode">("clips");
  // What you're doing with the episode: editing it (first, the usual job) or cutting a clip.
  const [mode, setMode] = useState<"edit" | "clip">("edit");
  // While editing (the whole episode, not while it's being made), the dashboard's
  // side menu folds away for room; it listens for this. ☰ Menu brings it back.
  // A finished episode opens in the editor; the menu folds away for room.
  const editingNow = !!rec && rec.clipStatus === "done";
  // The player shows the episode once it's done (it's the editor); before that, Pōstify's own screens.
  useEffect(() => { setView(rec?.clipStatus === "done" ? "episode" : "clips"); setPreview(null); }, [rec?.id, rec?.clipStatus]);
  const [pipeDialog, setPipeDialog] = useState(false);
  // A clock for "about N minutes left", ticking only while something's being made.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const busyNow = rec?.clipStatus === "queued" || rec?.clipStatus === "running";
  useEffect(() => {
    if (!busyNow) return;
    const t = setInterval(() => setNowTick(Date.now()), 15000);
    return () => clearInterval(t);
  }, [busyNow]);
  const [clipPlay, setClipPlay] = useState<ClipRow | null>(null);
  // Editing folds the dashboard's menu to its rail, for room (HostDashboard listens).
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("mv:editing", { detail: editingNow }));
  }, [editingNow]);
  useEffect(() => () => { window.dispatchEvent(new CustomEvent("mv:editing", { detail: false })); }, []);
  // Focus: the player and its timeline alone on the screen, for fine trimming.
  const [focus, setFocus] = useState(false);
  // Once everything has run (clips, clean episode, the music answered), the pipeline folds to one line.
  const [pipeOpen, setPipeOpen] = useState(false);
  useEffect(() => {
    if (!focus) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setFocus(false); };
    window.addEventListener("keydown", esc);
    const was = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = was; };
  }, [focus]);
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
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/host/recordings/${id}/clip`, { options: { ...opts, formats: ["vertical", "square", "wide"] } })).json(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/host/recordings"] });
      void qc.invalidateQueries({ queryKey: ["/api/host/features"] });
    },
    onError: (e: Error) => toast({ title: "Couldn't start that", description: e.message, variant: "destructive" }),
  });

  const beta = features.data?.beta;
  const plan = features.data?.plan ?? null;
  const freeLeft = Boolean(beta && (beta.unlimited || (beta.left ?? 1) > 0));
  // A flat price: every clip in all three shapes; Pro makes 6 clips.
  const clipsN = plan ? PLANS[plan.key]?.clipsPerEpisode ?? 4 : 4;
  const cost = episodeCredits(opts, clipsN);
  const affordable = (r: Rec) => Boolean(beta?.unlimited || r.postifyBeta || freeLeft || (beta?.tokens ?? 0) >= cost || plan);
  const [showOptions, setShowOptions] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false);
  const musicList = useQuery<{ key: string; name: string }[]>({ queryKey: ["/api/music"], queryFn: async () => (await apiRequest("GET", "/api/music")).json(), staleTime: 300_000 });

  // A few seconds of "Recording saved" filling in before the real steps: it
  // was already done, but a start that jumps straight to step two reads as nothing happening.
  const [introUntil, setIntroUntil] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!introUntil) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.max(0, introUntil - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [introUntil]);
  const intro = introUntil > Date.now();
  const begin = (id: number) => {
    setIntroUntil(Date.now() + 3500);
    setView("clips");
    setPreview(null);
    start.mutate(id);
  };
  // From the Library's "Pōstify it": that click was the start.
  const autoGo = useRef(typeof window !== "undefined" && new URLSearchParams(window.location.search).get("go") === "1");
  const autoRec = selected != null && selected > 0 ? (recs.data ?? []).find((r) => r.id === selected) : undefined;
  useEffect(() => {
    if (!autoGo.current || !autoRec || !features.data) return;
    autoGo.current = false;
    const url = new URL(window.location.href);
    url.searchParams.delete("go");
    window.history.replaceState(null, "", url.pathname + url.search);
    if (autoRec.status === "Ready" && autoRec.clipStatus === "none" && affordable(autoRec)) begin(autoRec.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRec?.id, features.data]);

  // Music mixed in: the clips' files changed.
  const mixState = (recs.data ?? []).map((r) => `${r.id}:${/"status":\s*"(\w+)"/.exec(r.musicMix)?.[1] ?? ""}`).join(",");
  useEffect(() => { void qc.invalidateQueries({ queryKey: ["/api/host/clips"] }); }, [mixState, qc]);
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

  if (!rec) {
    if (recs.isLoading) return null;
    // Open an episode, straight into the job they chose.
    const open = (id: number, job?: "edit" | "clip") => { if (job) setMode(job); setSelected(id); };
    return (
      <section className="mt-6" data-testid="post-studio">
        {paidBanner}
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-foreground">Pick an episode</h2>
          {betaBadge}
        </div>
        {/* Episodes as the Library shows them: the picture, how long, when, and what's been done. */}
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" data-testid="post-episode-grid">
          <li className="min-h-[14rem]" data-testid="post-viewer-empty">
            <UploadRecording tall title="Add an episode" note="Drop a video here, or click to browse. MP4, MOV or WebM, up to 2GB." onDone={(id) => setSelected(id)} />
          </li>
          {list.map((r) => {
            const clipped = r.clipStatus === "done";
            const busyR = r.clipStatus === "running" || r.clipStatus === "queued";
            const chip = clipped ? { t: "Clips ready", c: "bg-[#F0A71F] text-[#1a1200]" } : busyR ? { t: "Working", c: "bg-[#053877] text-white" } : r.clipStatus === "failed" ? { t: "Stopped", c: "bg-red-600 text-white" } : { t: "Not clipped yet", c: "bg-white/90 text-[#000741]" };
            return (
              <li key={r.id} className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm" data-testid={`post-episode-${r.id}`}>
                <button type="button" onClick={() => open(r.id)} className="relative aspect-video bg-[#050d26]" aria-label={`Open ${r.title || "episode"}`}>
                  <video src={`/api/host/recordings/${r.id}/video#t=8`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                  <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${chip.c}`}>{chip.t}</span>
                  {r.durationSec > 0 && <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">{stamp(r.durationSec)}</span>}
                </button>
                <div className="flex items-start gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-semibold leading-snug text-card-foreground" title={r.title}>{r.title || "Session"}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{new Date(r.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {clipped ? (
                      <>
                        <CardIcon tip="Make a clip" onClick={() => open(r.id, "clip")} testid={`post-episode-clip-${r.id}`}><Clapperboard className="h-4 w-4" /></CardIcon>
                        <CardIcon tip="Edit episode" onClick={() => open(r.id, "edit")} testid={`post-episode-edit-${r.id}`}><Pencil className="h-4 w-4" /></CardIcon>
                      </>
                    ) : (
                      <CardIcon tip={busyR ? "See how it's going" : "Start Pōstify: clips and a clean episode"} onClick={() => open(r.id)} testid={`post-episode-start-${r.id}`}><Wand2 className="h-4 w-4" /></CardIcon>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
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
  const mixNow = parseMusicMix(rec.musicMix);
  const musicName = mixNow?.status === "done" ? musicList.data?.find((t) => t.key === mixNow.key)?.name ?? "" : "";
  const pipelineDone = done && clean?.status === "done" && (mixNow?.status === "done" || mixNow?.status === "skipped");
  // The editor, once the episode itself is in the player (its timeline hooks onto that video).
  const editing = done && !intro && view === "episode";
  const stats = [
    { n: clock(recorded), label: "Recorded", color: "text-[#053877] dark:text-[#8fb5e8]" },
    { n: removed != null ? clock(Math.max(0, recorded - removed)) : "–", label: "Clean episode", color: "text-emerald-600 dark:text-emerald-400" },
    { n: removed != null ? `−${clock(removed)}` : "–", label: "Taken out", color: "text-[#b36b00] dark:text-[#F0A71F]" },
    { n: clean?.fillers != null ? String(outCount) : "–", label: "Ums and false starts", color: "text-[#ED1C24]" },
    { n: p?.words ? p.words.toLocaleString("en-US") : "–", label: "Words transcribed", color: "text-[#053877] dark:text-[#8fb5e8]" },
    { n: readyN ? String(readyN) : "–", label: "Clips ready", color: "text-violet-600 dark:text-violet-400" },
  ];

  // About how long is left: typical times until the clips start rendering, then this run's own pace.
  const eta = (() => {
    if (!running) return "";
    const n = Math.max(1, moments.length || clipsN);
    const perClip = 60; // seconds a clip on our own renderer (4 CPUs), before any are done to measure
    const st = rec.clipStatus === "queued" ? "queued" : p?.stage ?? "download";
    let left: number;
    if ((st === "render" || st === "upload") && p?.renderAt) {
      const k = p.finished ?? 0;
      const spent = (nowTick - Date.parse(p.renderAt)) / 1000;
      left = k > 0 ? (spent / k) * (n - k) : Math.max(60, n * perClip - spent);
    } else {
      const words = st === "download" || st === "queued" ? 60 + (rec.durationSec / 60) * 5 : 0;
      const hear = st === "download" || st === "queued" || st === "transcript" ? (rec.durationSec / 60) * 4 : 0;
      const pick = st === "moments" ? 60 : 90;
      left = words + hear + pick + n * perClip;
    }
    const min = Math.ceil(left / 60);
    return min <= 1 ? "Almost done" : `About ${min} minutes left`;
  })();

  // The pieces, used by both layouts (the editor, and the pipeline while it runs).
  const viewerEl = (
    <div className="relative aspect-video overflow-hidden rounded-2xl bg-[#050d26] ring-1 ring-black/5" data-testid="post-viewer">
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
            ) : running || intro ? (
              <WorkingScene rec={rec} p={intro ? null : p} pct={intro ? 0 : pct} eta={intro ? undefined : eta} />
            ) : failed ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-white">
                <div className="relative flex items-center justify-center">
                  <div className="scale-75 sm:scale-100"><Ring pct={failed ? 0 : pct} /></div>
                  <span className="absolute text-2xl font-bold tabular-nums">{failed ? "!" : `${pct}%`}</span>
                </div>
                <p className="text-lg font-semibold">{stageLabel(rec, p)}</p>
                <p className="hidden max-w-sm px-4 text-sm text-white/65 sm:block">
                  {failed ? rec.clipError || "Something went wrong." : rec.clipStatus === "queued" ? "Next in line. This screen fills in as each step finishes." : "Every word was transcribed live, so there's no upload and no wait."}
                </p>
                {failed && (
                  <Button onClick={() => begin(rec.id)} disabled={start.isPending} className="gap-2 rounded-full bg-[#F0A71F] text-[#1a1200] hover:bg-[#f5b94a]" data-testid="post-start">
                    <Sparkles className="h-4 w-4" /> Try again
                  </Button>
                )}
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
              // Not started: one button. Every clip comes in all three shapes; captions are under Options.
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white">
                <IconTile icon={Wand2} />
                <p className="text-xl font-bold sm:text-2xl">Ready for Pōstify</p>
                <p className="max-w-md text-sm text-white/70">{clipsN} clips in vertical, square and wide, with {opts.captions === "classic" ? "Classic" : "animated"} captions, and a clean episode. You can add music at the end.</p>
                {!affordable(rec) ? (
                  <ChoosePlan beta={beta} plan={plan} />
                ) : (
                  <Button onClick={() => begin(rec.id)} disabled={start.isPending} className="h-11 gap-2 rounded-full bg-[#F0A71F] px-6 text-base font-semibold text-[#1a1200] hover:bg-[#f5b94a]" data-testid="post-start-hero">
                    {start.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />} Start Pōstify
                  </Button>
                )}
                <p className="text-xs text-white/55">
                  {beta?.unlimited || rec.postifyBeta
                    ? "Included"
                    : freeLeft
                      ? "Free · your beta episode"
                      : (beta?.tokens ?? 0) >= cost
                        ? `${cost} credits · you have ${beta?.tokens}`
                        : plan
                          ? `${cost} credits: ${beta?.tokens ?? 0} left + ${cost - (beta?.tokens ?? 0)} extra at ${cents(plan.overageCents)}`
                          : `${cost} credits`}
                  {" · "}
                  <button type="button" onClick={() => setShowOptions((v) => !v)} className="underline underline-offset-2 hover:text-white" data-testid="post-options">Options</button>
                </p>
                {showOptions && (
                  <div className="flex items-center gap-1 rounded-full bg-white/10 p-1 text-xs font-semibold" role="group" aria-label="Caption style">
                    {([["animated", "Animated captions"], ["classic", "Classic (cheaper, quicker)"]] as const).map(([v, label]) => (
                      <button key={v} type="button" onClick={() => setOpts({ ...opts, captions: v })} aria-pressed={opts.captions === v} className={`rounded-full px-3 py-1 ${opts.captions === v ? "bg-[#F0A71F] text-[#1a1200]" : "text-white/75 hover:text-white"}`} data-testid={`post-captions-${v}`}>{label}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
  );
  // The track picker: inline in the side panel, or its own column in the wide window.
  const mixParsed = parseMusicMix(rec.musicMix);
  const askingMusic = done && (!mixParsed || mixParsed.status === "failed" || musicOpen) && !(mixParsed?.status === "queued" || mixParsed?.status === "running");
  const musicPicker = askingMusic ? <PipelineMusic rec={rec} tall onChange={() => { setMusicOpen(false); void qc.invalidateQueries({ queryKey: ["/api/host/recordings"] }); }} /> : null;
  const pipeline = (inlineMusic: boolean) => (
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between pb-1">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Pipeline</p>
            {pipelineDone && <button type="button" onClick={() => setPipeOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Hide</button>}
          </div>
          <ul className="divide-y divide-border/60">
            <PipelineRow icon={Disc} title="Recording saved" detail={`${stamp(rec.durationSec)} long`} state={intro ? "active" : "done"} />
            <PipelineRow icon={Film} title="Load the recording" detail={p?.stage === "download" && p.pct != null ? `${p.pct}%` : undefined} state={state("download")} />
            <PipelineRow icon={FileText} title="Transcript" detail={p?.words ? `${p.words.toLocaleString("en-US")} words · ${p.transcriptSource === "live" ? "written live" : "transcribed after"}` : p?.transcriptSource === "live" ? "Written live on air" : undefined} state={state("transcript")} />
            <PipelineRow icon={Sparkles} title="Pick the moments" detail={pickedN ? `${pickedN} that stand on their own` : undefined} state={state("moments")} />
            <PipelineRow icon={Crop} title="Cut in three shapes" detail={p?.stage === "render" ? renderDetail(p) || undefined : readyN ? "16:9 · 9:16 · 1:1 + captions" : undefined} state={state("render")} />
            {(() => {
              const mix = parseMusicMix(rec.musicMix);
              const track = mix?.key ? musicList.data?.find((t) => t.key === mix.key)?.name ?? "the track" : "";
              return (
                <li className="py-0">
                  <ul>
                    <PipelineRow
                      icon={Music2}
                      title="Add music"
                      detail={!done ? "Optional, once the clips are made" : mix?.status === "queued" || mix?.status === "running" ? `Mixing in ${track}…` : mix?.status === "done" ? track : mix?.status === "skipped" ? "No music" : mix?.status === "failed" ? "That didn't work. Pick again" : "Pick a track, or skip"}
                      state={!done ? "waiting" : mix?.status === "queued" || mix?.status === "running" ? "active" : musicOpen ? "ask" : mix?.status === "done" || mix?.status === "skipped" ? "done" : mix?.status === "failed" ? "failed" : "ask"}
                    />
                  </ul>
                  {done && (mix?.status === "done" || mix?.status === "skipped") && !musicOpen && (
                    <button type="button" onClick={() => setMusicOpen(true)} className="-mt-1 mb-1 ml-10 text-xs font-medium text-primary hover:underline" data-testid="music-change">{mix?.status === "done" ? "Change the music" : "Add music"}</button>
                  )}
                  {inlineMusic && musicPicker}
                  {!inlineMusic && askingMusic && <p className="-mt-1 mb-1 ml-10 text-xs font-medium text-[#b36b00] dark:text-[#F0A71F]">Pick one on the right →</p>}
                </li>
              );
            })()}
            <PipelineRow icon={Send} title="Ready to post" detail={done ? "In your dashboard" : undefined} state={done ? "done" : state("upload") === "done" ? "active" : "waiting"} />
            <PipelineRow
              icon={Wand2}
              title="Clean episode"
              detail={clean?.status === "done" ? (clean.removedSec ? `${mmss(clean.removedSec)} of ums and dead air out` : "Nothing to take out") : clean?.status === "running" ? "Taking out ums and dead air" : "Ums, false starts and dead air out"}
              state={clean?.status === "done" ? "done" : clean?.status === "running" ? "active" : clean?.status === "failed" ? "failed" : "waiting"}
            />
          </ul>
        </div>
  );
  const pipelineCard = pipeline(true);
  const statsGrid = (
    <div className="grid grid-cols-2 gap-2" data-testid="post-stats">
      {stats.map((st) => (
        <div key={st.label} className="rounded-xl border border-border bg-card px-3 py-2.5">
          <p className={`text-lg font-bold tabular-nums ${st.color}`}>{st.n}</p>
          <p className="text-[11px] leading-tight text-muted-foreground">{st.label}</p>
        </div>
      ))}
    </div>
  );
  // The editor panel's foot: all done (or what's still waiting), and the three numbers that matter most.
  const waiting = !done ? "" : mixNow?.status !== "done" && mixNow?.status !== "skipped" ? "Add music to your clips" : clean?.status !== "done" ? "Clean episode on its way" : "";
  // In the editor's top row: all done (or what's still waiting) and the three numbers that matter most.
  const statusEl = (
    <button type="button" onClick={() => setPipeDialog(true)} className="flex min-w-0 items-center gap-2.5 rounded-full border border-border bg-card py-1 pl-1 pr-3 text-left hover:border-emerald-500/50" data-testid="pipeline-done">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white ${waiting ? "bg-[#F0A71F]" : "bg-emerald-500"}`}>{waiting ? <Music2 className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}</span>
      <span className="truncate text-sm font-semibold text-foreground">{waiting || "All done"}</span>
      <span className="hidden shrink-0 items-center gap-3 border-l border-border pl-3 text-xs tabular-nums md:flex">
        {stats.slice(0, 3).map((st) => (
          <span key={st.label} className="flex items-baseline gap-1"><span className={`font-bold ${st.color}`}>{st.n}</span><span className="text-muted-foreground">{st.label.toLowerCase()}</span></span>
        ))}
      </span>
    </button>
  );

  return (
    <section className="mt-2" data-testid="post-studio">
      {paidBanner}
      {/* The switcher sits above both columns, so the player and the side start level. */}
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {editing ? (
              // In the editor they're already in this episode (the Library is how to open another).
              <span className="flex min-w-0 items-center gap-2 px-1" data-testid="post-episode-title">
                <Film className="h-4 w-4 shrink-0 text-[#053877] dark:text-[#8fb5e8]" />
                <span className="truncate text-sm font-semibold">{rec.title || "Session"}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{stamp(rec.durationSec)}</span>
              </span>
            ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="flex min-w-0 items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-left hover:border-[#053877]/40" data-testid="post-episode-switcher">
                  <Film className="h-4 w-4 shrink-0 text-[#053877] dark:text-[#8fb5e8]" />
                  <span className="truncate text-sm font-semibold">{rec.title || "Session"}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{stamp(rec.durationSec)}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-80 w-80 overflow-y-auto">
                {list.map((r) => {
                  const tag = r.clipStatus === "done" ? "Clips ready" : r.clipStatus === "running" ? "Working" : r.clipStatus === "queued" ? "Queued" : r.clipStatus === "failed" ? "Stopped" : "Not clipped";
                  return (
                    <DropdownMenuItem key={r.id} onSelect={() => { setSelected(r.id); setFocus(false); }} className="flex flex-col items-start gap-0.5 py-2">
                      <span className="flex w-full items-center gap-2">
                        <span className="truncate text-sm font-medium">{r.title || "Session"}</span>
                        {r.id === rec.id && <Check className="ml-auto h-3.5 w-3.5 shrink-0" />}
                      </span>
                      <span className="flex w-full justify-between gap-2 text-xs text-muted-foreground">
                        <span>{stamp(r.durationSec)} · {new Date(r.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                        <span className={r.clipStatus === "done" ? "text-emerald-600 dark:text-emerald-400" : ""}>{tag}</span>
                      </span>
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuItem onSelect={() => { setSelected(-1); setFocus(false); }} className="gap-2 border-t border-border py-2 font-medium" data-testid="post-add-episode">
                  <Upload className="h-4 w-4" /> Add an episode
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            )}
            {/* Credits matter before a run, not after it. */}
            {!done && betaBadge && <div className="ml-auto flex items-center gap-2">{betaBadge}</div>}
            {editing && statusEl}
          </div>
        </div>
      </div>
      {editing ? (
        // The editor: the player on the left, the commands on the right, the timeline under both.
        <EpisodeTools
          rec={rec}
          source={clean?.videoKey && epSource === "clean" ? "clean" : "original"}
          videoRef={epRef}
          tab={mode}
          onTab={setMode}
          epSource={clean?.videoKey ? epSource : undefined}
          onSource={setEpSource}
          viewer={viewerEl}
          onMusic={() => { setMusicOpen(true); setPipeDialog(true); }}
        />
      ) : (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
        {/* The numbers sit under the player, in the space there; the side is just the pipeline. */}
        <div className="flex min-w-0 flex-col gap-3">
          {viewerEl}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" data-testid="post-stats">
            {stats.map((st) => (
              <div key={st.label} className="rounded-xl border border-border bg-card px-3 py-2.5">
                <p className={`text-lg font-bold tabular-nums ${st.color}`}>{st.n}</p>
                <p className="text-[11px] leading-tight text-muted-foreground">{st.label}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">{pipelineCard}</div>
      </div>
      )}

      {/* The pipeline and every number, from the panel's status line. */}
      <Dialog open={pipeDialog} onOpenChange={setPipeDialog}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{pipelineDone ? "All done" : "Almost there"}</DialogTitle>
            <DialogDescription>{rec.title || "This episode"}</DialogDescription>
          </DialogHeader>
          {/* Wide: the steps on the left; the music to pick (when it's asked for) and the numbers on the right. */}
          <div className="grid gap-4 md:grid-cols-2">
            {pipeline(false)}
            <div className="flex min-w-0 flex-col gap-3">
              {musicPicker && (
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"><Music2 className="h-4 w-4 text-[#b36b00] dark:text-[#F0A71F]" /> Music for your clips</p>
                  {musicPicker}
                </div>
              )}
              {statsGrid}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* A clip plays here, not in the editor's player. */}
      <ClipPreview c={clipPlay} onClose={() => setClipPlay(null)} />

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
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{done ? mine.length : `${readyN} of ${moments.length || clipsN}`}</span>
            {!done && eta && <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-[#b36b00] dark:text-[#F0A71F]"><Clock3 className="h-3.5 w-3.5" /> {eta}</span>}
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
            {done
              ? [
                  // A clip plays in its own pop-up; the editor's player stays on the episode.
                  ...mine.map((c) => <ClipCard key={c.id} c={c} onPreview={() => setClipPlay(c)} />),
                  <GenerateMore key="more" rec={rec} beta={beta} plan={plan} count={clipsN} captions={parseClipOptions(rec.clipOptions).captions} />,
                ]
              : moments.map((m, i) => {
                  // A clip shows the moment it's saved, playable, while the rest are cut.
                  const saved = mine.find((c) => Math.abs(c.startSec - m.startSec) < 1 && Math.abs(c.endSec - m.endSec) < 1);
                  if (saved) return <ClipCard key={`saved-${saved.id}`} c={saved} onPreview={() => setClipPlay(saved)} />;
                  // Two are cut at once: the first two not yet saved are both in hand.
                  const waiting = moments.filter((x) => !mine.some((c) => Math.abs(c.startSec - x.startSec) < 1));
                  const working = waiting.indexOf(m) > -1 && waiting.indexOf(m) < 2;
                  return (
                    <div key={i} className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border">
                      <div className="relative flex aspect-[3/4] items-center justify-center bg-gradient-to-b from-muted/60 to-muted">
                        <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white">{stamp(m.startSec)}–{stamp(m.endSec)}</span>
                        {working ? <Loader2 className="h-8 w-8 animate-spin text-[#b36b00]" /> : <Clock3 className="h-7 w-7 text-muted-foreground" />}
                      </div>
                      <div className="p-3">
                        <p className="line-clamp-2 text-sm font-semibold leading-snug">{m.title}</p>
                        <p className={`mt-1 text-xs ${working ? "text-[#b36b00]" : "text-muted-foreground"}`}>{working ? "Cutting, all three shapes" : "Up next"}</p>
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
