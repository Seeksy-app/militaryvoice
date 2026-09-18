import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Headphones, MessageSquare, Wifi, Play, Square, RotateCcw, Users, Clock } from "lucide-react";

// The things people actually need in the minutes before they go on.
//
// The green room had a self-view, a stage and a scene list and nothing else,
// so the space under the stage was empty while the two questions everyone
// arrives with went unanswered: does this work, and can anyone hear me.

const RECORD_SECONDS = 6;

/**
 * Record a few seconds and play it back.
 *
 * Every other check here is something we measure and report. This one is the
 * only one that answers the real question — not "is a track present" but
 * "does it sound and look like I think it does" — and nobody believes a green
 * tick about their own microphone the way they believe hearing themselves.
 *
 * It never leaves the browser: the blob is played from memory and dropped.
 */
function PlaybackTest({ stream }: { stream: MediaStream | null }) {
  const [state, setState] = useState<"idle" | "recording" | "ready">("idle");
  const [left, setLeft] = useState(RECORD_SECONDS);
  const [url, setUrl] = useState<string>("");
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // A recording held after the page moves on is a memory leak and a privacy
  // smell; drop the object URL as soon as it stops being shown.
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

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
    if (left <= 0) {
      recorderRef.current?.stop();
      return;
    }
    const t = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [state, left]);

  return (
    <div className="flex flex-col gap-2">
      {state === "ready" && url ? (
        <video ref={videoRef} src={url} controls autoPlay className="w-full rounded-lg border border-white/15 bg-black" />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {state === "idle" && (
          <Button
            size="sm"
            className="h-8 gap-1.5 rounded-full bg-[#F0A71F] font-semibold text-[#1a1200] hover:bg-[#f5b944]"
            disabled={!stream}
            onClick={record}
            data-testid="button-playback-record"
          >
            <Play className="h-3.5 w-3.5" /> Record {RECORD_SECONDS} seconds
          </Button>
        )}
        {state === "recording" && (
          <Button
            size="sm"
            className="h-8 gap-1.5 rounded-full bg-[#ED1C24] font-semibold text-white hover:bg-[#c8161d]"
            onClick={() => recorderRef.current?.stop()}
            data-testid="button-playback-stop"
          >
            <Square className="h-3.5 w-3.5" /> Recording… {left}
          </Button>
        )}
        {state === "ready" && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            onClick={record}
            data-testid="button-playback-again"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Record again
          </Button>
        )}
      </div>

      {error && <p className="text-xs text-[#F0A71F]">{error}</p>}
      {!stream && <p className="text-xs text-white/45">Turn your camera and mic on first.</p>}
    </div>
  );
}

/** Round-trip time and packet loss, read from the peer connection itself. */
function ConnectionMeter({ quality }: { quality: { label: string; detail: string; tone: "good" | "fair" | "poor" } | null }) {
  if (!quality) return <p className="text-xs text-white/45">Connecting…</p>;
  const colour =
    quality.tone === "good" ? "text-emerald-400" : quality.tone === "fair" ? "text-[#F0A71F]" : "text-[#ED1C24]";
  return (
    <div>
      <p className={`text-sm font-semibold ${colour}`}>{quality.label}</p>
      <p className="mt-0.5 text-xs text-white/55">{quality.detail}</p>
    </div>
  );
}

function Tool({ icon: Icon, title, children }: { icon: typeof Headphones; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/12 bg-white/[0.04] p-4">
      <h3 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/60">
        <Icon className="h-3.5 w-3.5 text-[#F0A71F]" /> {title}
      </h3>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

export function GreenRoomTools({
  stream,
  micOn,
  onStage,
  peerCount,
  quality,
  slotLabel,
}: {
  stream: MediaStream | null;
  micOn: boolean;
  onStage: boolean;
  peerCount: number;
  quality: { label: string; detail: string; tone: "good" | "fair" | "poor" } | null;
  slotLabel: string;
}) {
  return (
    <section className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="green-room-tools">
      <Tool icon={Headphones} title="Hear and see yourself back">
        <p className="mb-2.5 text-xs leading-relaxed text-white/55">
          The only check that settles it. Record a few seconds and watch it back — headphone crackle and a camera
          pointing at the ceiling both show up instantly.
        </p>
        <PlaybackTest stream={stream} />
      </Tool>

      <Tool icon={MessageSquare} title="Talking in here">
        <p className="text-xs leading-relaxed text-white/55">
          {onStage
            ? "You're on the air right now — everything you say is going out."
            : "Nobody watching the show can hear the green room. Unmute and the other guests and the producer can, and that's all."}
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-sm font-medium">
          <span className={`h-2 w-2 rounded-full ${micOn ? "bg-emerald-400" : "bg-white/30"}`} />
          {micOn ? "Your mic is open to the room" : "You're muted — nobody can hear you"}
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-white/45">
          <Users className="h-3.5 w-3.5" />
          {peerCount === 0 ? "You're the only one in here so far" : `${peerCount} ${peerCount === 1 ? "other person" : "others"} in here`}
        </p>
      </Tool>

      <Tool icon={Wifi} title="Your connection">
        <ConnectionMeter quality={quality} />
        <p className="mt-2 text-xs leading-relaxed text-white/45">
          If it's struggling: a cable beats wi-fi, and closing other tabs beats both.
        </p>
      </Tool>

      <Tool icon={Clock} title="When you're on">
        <p className="text-sm font-semibold text-white">{slotLabel || "No slot on this event"}</p>
        <p className="mt-2 text-xs leading-relaxed text-white/55">
          Stay in here until the producer brings you up — you'll see yourself appear on the stage above, and the badge
          at the top turns red.
        </p>
      </Tool>
    </section>
  );
}
