import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, resolveUploadUrl } from "@/lib/queryClient";
import { detectLocalTimeZone, formatDateInZone, formatTimeInZone } from "@/lib/schedule";
import type { SceneRow } from "@shared/schema";
import { describeDrift, type ShowClock } from "@shared/showClock";
import { Headphones, Play, Square, RotateCcw, Radio, Clapperboard, Image as ImageIcon, Clock } from "lucide-react";

// What a podcaster waiting in the green room actually needs above the fold.
//
// This was four boxes — check yourself, talking in here, your connection, when
// you're on — and between them they took the whole width to answer questions
// nobody was asking. Two of them restated what the buttons under your own
// picture already say: a muted mic and a dark camera are not facts you learn
// from a card. What they did not answer is the only question anybody in a
// green room has, which is "how long have I got".
//
// So the strip is now the running order: what is on air, what is on deck, what
// follows, each with the picture and a countdown. The connection reading and
// your own slot moved onto your own card, where the rest of your personal
// state already lives.

const RECORD_SECONDS = 6;

export interface Quality {
  label: string;
  detail: string;
  tone: "good" | "fair" | "poor";
}

/**
 * Record a few seconds and play it back.
 *
 * The only check that answers the real question. Every other reading is a
 * measurement; nobody believes a green tick about their own microphone the
 * way they believe hearing themselves. Never leaves the browser — the blob is
 * played from memory and dropped.
 */
function PlaybackDialog({ stream, camOn, open, onOpenChange }: {
  stream: MediaStream | null;
  camOn: boolean;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [state, setState] = useState<"idle" | "recording" | "ready">("idle");
  const [left, setLeft] = useState(RECORD_SECONDS);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  // Closing throws the recording away rather than leaving it in memory for
  // the rest of the session.
  useEffect(() => {
    if (open) return;
    recorderRef.current?.state === "recording" && recorderRef.current.stop();
    if (url) URL.revokeObjectURL(url);
    setUrl("");
    setState("idle");
  }, [open]);

  function record() {
    if (!stream) return;
    setError("");
    if (url) { URL.revokeObjectURL(url); setUrl(""); }
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      setError("This browser won't let us record a test. Safari sometimes needs a reload.");
      return;
    }
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      setUrl(URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || "video/webm" })));
      setState("ready");
    };
    recorderRef.current = recorder;
    recorder.start();
    setState("recording");
    setLeft(RECORD_SECONDS);
  }

  useEffect(() => {
    if (state !== "recording") return;
    if (left <= 0) { recorderRef.current?.stop(); return; }
    const t = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [state, left]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Hear and see yourself back</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Headphone crackle and a camera pointing at the ceiling both show up instantly. Nothing is uploaded — this
          plays from memory and is thrown away when you close it.
        </p>
        {state === "ready" && url && (
          <video src={url} controls autoPlay className="w-full rounded-lg border border-border bg-black" />
        )}
        <div className="flex flex-wrap gap-2">
          {state === "idle" && (
            <Button className="gap-1.5 rounded-full" disabled={!stream || !camOn} onClick={record} data-testid="button-playback-record">
              <Play className="h-4 w-4" /> Record {RECORD_SECONDS} seconds
            </Button>
          )}
          {state === "recording" && (
            <Button className="gap-1.5 rounded-full bg-[#ED1C24] text-white hover:bg-[#c8161d]" onClick={() => recorderRef.current?.stop()}>
              <Square className="h-4 w-4" /> Recording… {left}
            </Button>
          )}
          {state === "ready" && (
            <Button variant="outline" className="gap-1.5 rounded-full" onClick={record} data-testid="button-playback-again">
              <RotateCcw className="h-4 w-4" /> Record again
            </Button>
          )}
        </div>
        {error && <p className="text-sm text-[#b45309]">{error}</p>}
        {!stream && <p className="text-sm text-muted-foreground">Turn your camera and mic on first.</p>}
        {stream && !camOn && (
          <p className="text-sm text-muted-foreground">
            Your camera is off, so this would record six seconds of black. Turn it on in the green room and come back.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The record-yourself test, as a button that sits beside "Check my setup". */
export function PlaybackButton({ stream, camOn }: { stream: MediaStream | null; camOn: boolean }) {
  const [open, setOpen] = useState(false);
  if (!stream) return null;
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
        onClick={() => setOpen(true)}
        data-testid="button-playback"
      >
        <Headphones className="h-3.5 w-3.5 text-[#F0A71F]" />
        Hear myself back
      </Button>
      <PlaybackDialog stream={stream} camOn={camOn} open={open} onOpenChange={setOpen} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Up next · Following
// ---------------------------------------------------------------------------
//
// Two cards, not three. The scene on air is already the top card of the rail
// down the right-hand side, pinned there and full width — repeating it here
// spent a third of the strip saying something the page says better a few
// hundred pixels away. What is left is the pair nobody can see anywhere else,
// and with the room to be read from across a desk.

interface ScenesPayload {
  scenes: SceneRow[];
  currentSceneId: number;
  clock?: ShowClock | null;
  runItems?: { id: number; signupId: number | null }[];
  signups?: { id: number; podcastName: string; hostName: string; photoUrl: string }[];
}

function isImage(sc: SceneRow): boolean {
  return sc.mediaKind === "image" || /\.(jpe?g|png|webp|gif|svg)(\?|$)/i.test(sc.mediaUrl);
}

/**
 * How long until something, said the way somebody waiting would say it.
 *
 * Seconds appear under two minutes and not before: a countdown reading 47:19
 * invites you to watch it, and the only number that matters at that range is
 * roughly how many songs long it is.
 *
 * And it stops being a countdown at twelve hours. Fifteen days out the honest
 * arithmetic is "365h 29m", which is a number nobody has ever wanted — past a
 * day the answer to "when am I on" is a date, so the caller shows one instead.
 */
function until(ms: number): string | null {
  if (ms <= 0) return "now";
  const secs = Math.round(ms / 1000);
  if (secs < 120) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min`;
  if (mins < 12 * 60) {
    const hours = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem ? `${hours}h ${rem}m` : `${hours}h`;
  }
  return null;
}

const SLOTS = [
  { key: "next", label: "Up next", offset: 1 },
  { key: "after", label: "Following", offset: 2 },
] as const;

function Card({
  label,
  scene,
  who,
  thumb,
  zone,
  now,
  compact = false,
}: {
  label: string;
  scene: SceneRow | undefined;
  who: string;
  thumb: string | null;
  zone: string;
  now: number;
  /** In a side column: half the width, so half the furniture. */
  compact?: boolean;
}) {
  const starts = scene?.startAtUtc ? Date.parse(scene.startAtUtc) : NaN;
  const hasTime = Number.isFinite(starts);
  const countdown = hasTime ? until(starts - now) : null;
  // Inside five minutes it stops being information and becomes a cue.
  const imminent = hasTime && starts > now && starts - now < 5 * 60_000;

  return (
    <div
      className={`flex min-w-0 items-center rounded-2xl border ${
        compact ? "gap-2.5 px-2.5 py-2" : "gap-4 px-4 py-3.5"
      } ${imminent ? "border-[#F0A71F]/60 bg-[#F0A71F]/[0.08]" : "border-white/12 bg-white/[0.04]"}`}
      data-testid={`upnext-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {/* 16:9, because it is a picture of what goes on the screen. */}
      <span className={`relative aspect-video shrink-0 overflow-hidden rounded-lg bg-[#04102b] ring-1 ring-white/10 ${compact ? "w-16" : "w-32 sm:w-36"}`}>
        {thumb ? (
          <img src={resolveUploadUrl(thumb)} alt="" className="h-full w-full object-cover object-[50%_28%]" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-white/25">
            {scene && scene.mediaUrl ? <Clapperboard className="h-6 w-6" /> : <ImageIcon className="h-6 w-6" />}
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
          <Radio className={`h-3.5 w-3.5 ${imminent ? "text-[#F0A71F]" : "text-[#F0A71F]/70"}`} />
          {label}
        </span>
        <span className={`mt-0.5 block truncate font-bold leading-tight text-white ${compact ? "text-[13px]" : "mt-1 text-base sm:text-lg"}`}>
          {scene?.name?.trim() || "Nothing scheduled"}
        </span>
        <span className="mt-1 block truncate text-[12px] text-white/50">
          {who || (hasTime ? formatTimeInZone(new Date(starts), zone) : "—")}
        </span>
      </span>

      {/* The only number anybody in a green room is looking for. */}
      {hasTime && (
        <span className="shrink-0 text-right">
          <span
            className={`block font-bold leading-none tabular-nums ${compact ? "text-sm" : "text-2xl"} ${
              imminent ? "text-[#F0A71F]" : "text-white/90"
            }`}
          >
            {countdown ?? formatDateInZone(new Date(starts), zone)}
          </span>
          <span className={`mt-0.5 block uppercase tracking-[0.1em] text-white/35 ${compact ? "text-[10px]" : "mt-1 text-[11px]"}`}>
            {formatTimeInZone(new Date(starts), zone)}
          </span>
        </span>
      )}
    </div>
  );
}

/**
 * The two that matter, from the producer's own rail.
 *
 * Read off the same `/api/studio/scenes` the scene list uses — react-query
 * shares the key, so this costs no extra request — because a podcaster being
 * told something different from what the control room is following is worse
 * than being told nothing.
 */
export function UpNext({ slug, studioId, compact = false, fill = false }: { slug?: string; studioId?: number; compact?: boolean; fill?: boolean }) {
  const zone = useMemo(detectLocalTimeZone, []);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { data } = useQuery<ScenesPayload>({
    queryKey: ["/api/studio/scenes", slug ?? "featured", studioId ?? 0],
    queryFn: async () => {
      const q = new URLSearchParams();
      if (slug) q.set("slug", slug);
      if (studioId) q.set("studioId", String(studioId));
      return (await apiRequest("GET", `/api/studio/scenes?${q}`)).json();
    },
    refetchInterval: 15_000,
  });

  const cards = useMemo(() => {
    const scenes = data?.scenes ?? [];
    if (!scenes.length) return null;
    // Where the producer is, or the top of the rail before they have taken
    // anything — never -1, which would hand back the end of the running order.
    const at = Math.max(0, scenes.findIndex((s) => s.id === data?.currentSceneId));
    return SLOTS.map((slot) => {
      const sc = scenes[at + slot.offset];
      const item = sc?.runItemId ? data?.runItems?.find((r) => r.id === sc.runItemId) : undefined;
      const sg = item?.signupId ? data?.signups?.find((x) => x.id === item.signupId) : undefined;
      const sceneImage = sc && sc.mediaUrl && isImage(sc) ? sc.mediaUrl : null;
      return {
        ...slot,
        scene: sc,
        who: sg ? `${sg.podcastName}${sg.hostName ? ` · ${sg.hostName}` : ""}` : "",
        thumb: sceneImage ?? sg?.photoUrl ?? null,
      };
    }).filter((c) => c.scene);
  }, [data]);

  if (!cards?.length) return null;

  const clock = data?.clock;
  // Only when it matters. "On time" is the expected state and saying so every
  // fifteen seconds trains people to stop reading the line that will one day
  // say something else.
  const late = clock && Math.abs(clock.driftSeconds) >= 60;

  return (
    <div data-testid="green-room-upnext" className={fill ? "flex h-full flex-col" : undefined}>
      {late && (
        <div
          className={`mb-2 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${
            clock!.driftSeconds > 0
              ? "border-[#F0A71F]/40 bg-[#F0A71F]/[0.10] text-[#F0A71F]"
              : "border-white/15 bg-white/[0.06] text-white/75"
          }`}
          data-testid="chip-show-drift"
        >
          <Clock className="h-4 w-4 shrink-0" />
          The show is running {describeDrift(clock!.driftSeconds)}.
          <span className="font-normal opacity-80">
            Your start time doesn't move — Alex takes it out of the handover.
          </span>
        </div>
      )}
      <div className={compact ? `flex flex-col gap-2 ${fill ? "min-h-0 flex-1" : ""}` : "grid gap-3 sm:grid-cols-2"}>
        {cards.map((c) => (
          <div key={c.key} className={fill ? "flex min-h-0 flex-1 flex-col [&>*]:flex-1" : undefined}>
            <Card label={c.label} scene={c.scene} who={c.who} thumb={c.thumb} zone={zone} now={now} compact={compact} />
          </div>
        ))}
      </div>
    </div>
  );
}
