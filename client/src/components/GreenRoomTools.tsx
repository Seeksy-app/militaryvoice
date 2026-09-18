import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Headphones, MessageSquare, Wifi, Play, Square, RotateCcw, Clock } from "lucide-react";

// The four things worth knowing before you go on, in one strip above the fold.
//
// These were a grid of paragraphs under the stage, which read fine and pushed
// the stage off screen — and a green room you have to scroll is one where
// somebody misses the producer bringing them up. So each box is now a label
// and a value, nothing else: the explanation only appears where it changes
// what you'd do, and the one tool that needs room opens in a dialog.

const RECORD_SECONDS = 6;

export interface Quality {
  label: string;
  detail: string;
  tone: "good" | "fair" | "poor";
}

/**
 * Record a few seconds and play it back.
 *
 * The only check that answers the real question. Every other box reports a
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

function Box({
  icon: Icon,
  label,
  value,
  tone = "plain",
  hint,
  onClick,
  testId,
}: {
  icon: typeof Wifi;
  label: string;
  value: string;
  tone?: "plain" | "good" | "warn" | "bad";
  hint?: string;
  onClick?: () => void;
  testId?: string;
}) {
  const colour =
    tone === "good" ? "text-emerald-400" : tone === "warn" ? "text-[#F0A71F]" : tone === "bad" ? "text-[#ED1C24]" : "text-white";
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">
        <Icon className="h-3 w-3 text-[#F0A71F]" /> {label}
      </span>
      <span className={`mt-1 block truncate text-sm font-semibold ${colour}`}>{value}</span>
      {/* Only where it changes what you'd do — "plenty of headroom" under
          "Strong" is a sentence nobody acts on. */}
      {hint && <span className="mt-0.5 block truncate text-[11px] text-white/45">{hint}</span>}
    </>
  );
  const shell = "min-w-0 rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-left";
  return onClick ? (
    <button type="button" onClick={onClick} className={`${shell} transition-colors hover:bg-white/[0.09]`} data-testid={testId}>
      {body}
    </button>
  ) : (
    <div className={shell} data-testid={testId}>{body}</div>
  );
}

export function GreenRoomTools({
  stream,
  micOn,
  onStage,
  peerCount,
  quality,
  slotLabel,
  signedInAs,
  isCrew,
  camOn,
}: {
  stream: MediaStream | null;
  micOn: boolean;
  onStage: boolean;
  peerCount: number;
  quality: Quality | null;
  slotLabel: string;
  signedInAs: string;
  isCrew: boolean;
  camOn: boolean;
}) {
  const [testOpen, setTestOpen] = useState(false);

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="green-room-tools">
        {/* A camera that is switched off still has a track, and MediaRecorder
            happily records six seconds of black from it. The button offered
            the test anyway, so the answer to "does my camera work" was a black
            rectangle — which looks like the test is broken rather than the
            camera being off. */}
        <Box
          icon={Headphones}
          label="Check yourself"
          value={!stream ? "Turn your camera on" : camOn ? "Record 6 seconds" : "Camera is off"}
          hint={!stream ? undefined : camOn ? "See and hear it back" : "Turn it on to record a test"}
          onClick={stream ? () => setTestOpen(true) : undefined}
          testId="tool-playback"
        />
        <Box
          icon={MessageSquare}
          label="Talking in here"
          value={onStage ? "You're on air" : micOn ? "Mic open to the room" : "Muted"}
          tone={onStage ? "bad" : micOn ? "good" : "plain"}
          hint={
            onStage
              ? "Everything you say is going out"
              : peerCount === 0
                ? "Only you in here · the audience can't hear this"
                : `${peerCount} ${peerCount === 1 ? "other" : "others"} in here · the audience can't hear this`
          }
          testId="tool-talking"
        />
        <Box
          icon={Wifi}
          label="Your connection"
          value={quality?.label ?? "Checking…"}
          tone={quality?.tone === "good" ? "good" : quality?.tone === "poor" ? "bad" : "plain"}
          // Only a struggling connection gets an explanation; a strong one
          // needs no advice and saying something anyway just fills the box.
          hint={quality?.tone === "poor" ? "A cable beats wi-fi" : undefined}
          testId="tool-connection"
        />
        {/* When there's no slot, name the account that was checked. Somebody
            who holds one under a different sign-in reads a bare "no slot" as
            the page being wrong, and there is no way to tell from the screen
            which of two sessions they are in. */}
        <Box
          icon={Clock}
          label="When you're on"
          value={slotLabel || "No slot for this sign-in"}
          hint={
            slotLabel
              ? "Wait here — the producer brings you up"
              : signedInAs
                ? `${signedInAs}${isCrew ? " · crew" : ""}`
                : "Sign in to see your slot"
          }
          testId="tool-slot"
        />
      </div>

      <PlaybackDialog stream={stream} camOn={camOn} open={testOpen} onOpenChange={setTestOpen} />
    </>
  );
}
