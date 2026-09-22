import { AlexChat } from "@/components/AlexChat";
import { GreenRoomButton } from "@/components/GreenRoomButton";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, resolveUploadUrl } from "@/lib/queryClient";
import { useStudioRoom, type RoomPeer } from "@/hooks/use-studio-room";
import { StageGrid, type RoomMeta } from "@/components/StageView";
import { SceneRail } from "@/components/SceneRail";
import { UpNext, PlaybackButton } from "@/components/GreenRoomTools";
import { detectLocalTimeZone, formatTimeInZone } from "@/lib/schedule";
import type { StudioParticipantRow, SceneRow } from "@shared/schema";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Radio,
  Users,
  CheckCircle2,
  AlertTriangle,
  LogOut,
  Volume2,
  VolumeX,
  Download,
  Disc,
  Lightbulb,
  ArrowLeft,
  Pencil,
  Sparkles,
  Headphones,
  MessageSquare,
  Wifi,
  Clock,
} from "lucide-react";

export interface SetupCheck {
  key: "light" | "background" | "framing";
  label: string;
  state: "good" | "warn";
  note: string;
}

/**
 * Turn one thumbnail into three observations.
 *
 * Everything here is arithmetic on pixels — mean luma for exposure, the
 * difference between the middle third and the edges for backlighting, and
 * how much detail sits in the outer band for how busy the room is. It is not
 * face detection and does not pretend to be: "framing" is inferred from where
 * the brightest, most detailed part of the picture sits, which for a person
 * on a webcam is their face often enough to be useful and wrong often enough
 * that it is phrased as a suggestion.
 */
export function readFrame(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  mean: number,
  darkShare: number,
): SetupCheck[] {
  const luma = new Float64Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    luma[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  const at = (x: number, y: number) => luma[y * w + x];

  // Centre third versus the outer band: a bright window behind someone shows
  // up as edges much brighter than the middle.
  let centreSum = 0, centreN = 0, edgeSum = 0, edgeN = 0;
  const x0 = Math.floor(w / 3), x1 = Math.ceil((w * 2) / 3);
  const y0 = Math.floor(h / 4), y1 = Math.ceil((h * 3) / 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inCentre = x >= x0 && x < x1 && y >= y0 && y < y1;
      if (inCentre) { centreSum += at(x, y); centreN++; }
      else { edgeSum += at(x, y); edgeN++; }
    }
  }
  const centre = centreN ? centreSum / centreN : mean;
  const edge = edgeN ? edgeSum / edgeN : mean;

  // Detail in the outer band, as a stand-in for how busy the room is.
  let edgeDetail = 0, edgeDetailN = 0;
  let colSum = 0, colWeight = 0, rowSum = 0, rowWeight = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const g = Math.abs(at(x + 1, y) - at(x - 1, y)) + Math.abs(at(x, y + 1) - at(x, y - 1));
      if (x < x0 || x >= x1) { edgeDetail += g; edgeDetailN++; }
      // Where the detail is, weighted — roughly where the subject is.
      colSum += x * g; colWeight += g;
      rowSum += y * g; rowWeight += g;
    }
  }
  const busy = edgeDetailN ? edgeDetail / edgeDetailN : 0;
  const cx = colWeight ? colSum / colWeight / w : 0.5;
  const cy = rowWeight ? rowSum / rowWeight / h : 0.5;

  const light: SetupCheck =
    mean < 55
      ? { key: "light", label: "Lighting", state: "warn", note: "It's dark where you are. A lamp or a window in front of you — not behind — is the whole fix." }
      : mean > 205
        ? { key: "light", label: "Lighting", state: "warn", note: "You're blown out. Move away from the light behind you, or turn it down." }
        : edge > centre + 38
          ? { key: "light", label: "Lighting", state: "warn", note: "The light is behind you, so you're a silhouette. Turn around, or close the blind and put a lamp in front." }
          : { key: "light", label: "Lighting", state: "good", note: "Well lit and evenly exposed." };

  const background: SetupCheck =
    darkShare > 0.55
      ? { key: "background", label: "Background", state: "warn", note: "You're lit but the room behind you is black. Any light on the back wall stops you floating in the dark." }
      : busy > 26
        ? { key: "background", label: "Background", state: "warn", note: "There's a lot going on behind you. A plainer wall, or a couple of steps further from it, keeps the attention on you." }
        : { key: "background", label: "Background", state: "good", note: "Clean enough not to pull focus." };

  const off = Math.abs(cx - 0.5);
  const framing: SetupCheck =
    off > 0.17
      ? { key: "framing", label: "Framing", state: "warn", note: `You're sitting well to the ${cx < 0.5 ? "left" : "right"} of frame. Centre yourself — the lower third covers the bottom of the picture.` }
      : cy > 0.66
        ? { key: "framing", label: "Framing", state: "warn", note: "You're low in frame. Raise the camera to eye level — on a couple of books if you have to." }
        : cy < 0.3
          ? { key: "framing", label: "Framing", state: "warn", note: "There's a lot of room above your head. Tilt down, or raise your chair." }
          : { key: "framing", label: "Framing", state: "good", note: "Centred, at about eye level." };

  return [light, background, framing];
}

/** "Andrew Appleton" → "AA". One letter when there is only one word. */
function initialsOf(v: string): string {
  const parts = (v ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const KEY_STORAGE = "mv_studio_key";
const HEARTBEAT_MS = 6_000;

interface StudioState {
  eventName: string;
  /** Whether this visitor is on the lineup, or crew. */
  mayJoin?: boolean;
  studio: { name: string; status: string; fallbackPlaying: boolean; maxOnStage: number };
  /** What's actually going out, in the same shape the watch page renders. */
  meta?: RoomMeta;
  me: StudioParticipantRow | null;
  /** Their own slot on this event, when they hold one. Crew have none. */
  mySlot?: { startsAtUtc: string; endsAtUtc: string; label: string } | null;
  /** Their show artwork, for when the camera is off. */
  myPhotoUrl?: string;
  /** The sign-in the slot was looked up under. */
  myEmail?: string;
  isCrew?: boolean;
  onStageCount: number;
  greenRoomCount: number;
}

/** Stable per-browser id so a refresh rejoins as the same person. */
function clientKey(): string {
  try {
    let k = localStorage.getItem(KEY_STORAGE);
    if (!k) {
      k = crypto.randomUUID().replace(/-/g, "");
      localStorage.setItem(KEY_STORAGE, k);
    }
    return k;
  } catch {
    return "anon" + Math.random().toString(36).slice(2, 12);
  }
}

/**
 * The producer's own scene rail, read-only.
 *
 * Not a summary of it — the same component, so what a podcaster sees is what
 * the control room sees, down to the thumbnails. Editing is a producer's job
 * and is gated twice: readOnly here, and /api/studio/scenes having no write
 * side to call.
 */
function RunningOrder({ slug, studioId, searchable = false }: { slug?: string; studioId?: number; searchable?: boolean }) {
  const zone = useMemo(detectLocalTimeZone, []);
  const { data } = useQuery<{ scenes: SceneRow[]; currentSceneId: number; runItems?: any[]; signups?: any[] }>({
    queryKey: ["/api/studio/scenes", slug ?? "featured", studioId ?? 0],
    queryFn: async () => {
      const q = new URLSearchParams();
      if (slug) q.set("slug", slug);
      if (studioId) q.set("studioId", String(studioId));
      return (await apiRequest("GET", `/api/studio/scenes?${q}`)).json();
    },
    refetchInterval: 15_000,
  });

  if (!data?.scenes?.length) return null;
  return (
    <div className="flex max-h-[70vh] min-h-0 flex-col overflow-hidden rounded-2xl border border-white/15 bg-white/[0.04]">
      <SceneRail
        scenes={data.scenes}
        currentSceneId={data.currentSceneId}
        zone={zone}
        runItems={data.runItems ?? []}
        signups={data.signups ?? []}
        presentNames={[]}
        media={[]}
        readOnly
        searchable={searchable}
        onApply={() => {}}
        onAdd={() => {}}
        onPatch={() => {}}
        onDelete={() => {}}
        onReorder={() => {}}
        onGenerate={() => {}}
      />
    </div>
  );
}

/** Attaches a subscribed LiveKit track to a real media element. */
function PeerTile({ peer, muted = false, fill = false, keyed = false }: { peer: RoomPeer; muted?: boolean; fill?: boolean; keyed?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !peer.videoTrack) return;
    peer.videoTrack.attach(el);
    return () => {
      peer.videoTrack?.detach(el);
    };
  }, [peer.videoTrack]);

  // The avatar arrives on chroma-key green — that is the right output for a
  // source meant to be composited, and LiveAvatar offers no alternative. The
  // stage keys it already; the green room is a different component and was
  // still showing her against a wall of green.
  useEffect(() => {
    if (!keyed) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return;
      const cw = Math.min(w, 480), ch = Math.round((cw / w) * h);
      if (canvas.width !== cw) { canvas.width = cw; canvas.height = ch; }
      ctx.drawImage(video, 0, 0, cw, ch);
      const frame = ctx.getImageData(0, 0, cw, ch);
      const d = frame.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        // Green measured against its neighbours, not in absolute terms — skin
        // is green-ish and a flat threshold takes her face with the backdrop.
        if (g > 90 && g > r * 1.35 && g > b * 1.35) d[i + 3] = 0;
        else if (g > r * 1.1 && g > b * 1.1) d[i + 1] = Math.max(r, b);
      }
      ctx.putImageData(frame, 0, 0);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [keyed, peer.videoTrack]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !peer.audioTrack) return;
    peer.audioTrack.attach(el);
    return () => {
      peer.audioTrack?.detach(el);
    };
  }, [peer.audioTrack]);

  return (
    <div
      className={`relative overflow-hidden bg-black ${
        // aspect-video is right for a grid of equal tiles and wrong inside a
        // card that sets its own height — it letterboxed her into a strip.
        fill ? "h-full w-full" : "aspect-video rounded-xl border border-white/15"
      }`}
    >
      {/* muted, because srcObject is the raw getUserMedia stream and that
          carries the microphone as well as the camera. Without it the preview
          plays your own mic out of your own speakers: instant rather than
          delayed, so it does not sound like an echo — it sounds like the room
          is broken. Headphones do not help, muting in the app does not help,
          and you can hear yourself typing. Every other video in this codebase
          is muted; this one was missed. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`h-full w-full object-cover ${keyed ? "invisible absolute" : ""}`}
      />
      {keyed && (
        // Scaled up and anchored to her head. The source frames her small with
        // a lot of headroom, so at natural size she floated in the middle of
        // the card with space above and below; cropping in makes her fill it.
        // 1.75 took the top of her head off once the card was short; with a
        // taller card the crop can be gentler and keep it.
        <canvas
          ref={canvasRef}
          className="h-full w-full object-cover"
          style={{ transform: "scale(1.45)", transformOrigin: "center 30%" }}
        />
      )}
      <audio ref={audioRef} autoPlay muted={muted} />
      {/* Their initials rather than a crossed-out camera icon. Four tiles all
          showing the same grey icon tell you nothing about who is in the room;
          the names are underneath but the eye goes to the picture. */}
      {!peer.videoTrack && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-lg font-bold text-white/60 ring-1 ring-white/15">
            {initialsOf(peer.name)}
          </span>
        </div>
      )}
      {!fill && (
        <span className="absolute inset-x-1.5 bottom-1.5 truncate rounded bg-black/60 px-1.5 py-0.5 text-[12px] text-white">
          {peer.name}
        </span>
      )}
    </div>
  );
}

export default function Studio({ slug }: { slug?: string }) {
  const { toast } = useToast();
  // A link can name which room to walk into; without one you land in the
  // event's own studio, which is what every link issued so far means.
  const studioId = useMemo(() => {
    const v = Number(new URLSearchParams(window.location.search).get("studioId"));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  }, []);
  // ?s=<signup id> comes from the podcaster's own emails, and lets the
  // producer's scenes find them by booking rather than by name.
  const signupId = useMemo(() => {
    const v = Number(new URLSearchParams(window.location.search).get("s"));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  }, []);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [key] = useState(clientKey);
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [level, setLevel] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  // Kept in state as well as a ref so the page re-renders when the camera comes up.
  const [stream, setStream] = useState<MediaStream | null>(null);

  const queryClient = useQueryClient();

  interface RecordingRow {
    id: number;
    status: string;
    durationSeconds: number | null;
    fileSizeBytes: number | null;
    downloadUrl: string | null;
    createdAt: string;
  }
  const { data: recordings = [] } = useQuery<RecordingRow[]>({
    queryKey: ["/api/host/recordings", signupId],
    queryFn: async () => {
      const q = signupId ? `?signupId=${signupId}` : "";
      const r = await apiRequest("GET", `/api/host/recordings${q}`);
      return r.json();
    },
    enabled: joined,
    refetchInterval: 30_000,
  });

  function fmtDuration(secs: number | null) {
    if (!secs) return "—";
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  function fmtSize(bytes: number | null) {
    if (!bytes) return "";
    if (bytes > 1_000_000_000) return ` · ${(bytes / 1e9).toFixed(1)} GB`;
    return ` · ${(bytes / 1e6).toFixed(0)} MB`;
  }
  const stateKey = ["/api/studio/state", slug ?? "featured", studioId ?? 0, key];

  // Once we're in the room the heartbeat carries the state back with it, so
  // this poll only runs while we're still on the join screen.
  const { data: state, refetch: refetchState } = useQuery<StudioState>({
    queryKey: stateKey,
    queryFn: async () => {
      const q = new URLSearchParams({ clientKey: key, ...(slug ? { slug } : {}), ...(studioId ? { studioId: String(studioId) } : {}) });
      const res = await apiRequest("GET", `/api/studio/state?${q}`);
      return res.json();
    },
    refetchInterval: joined ? false : 5000,
  });

  useEffect(() => {
    if (state?.me && !joined) setJoined(true);
    if (state?.me?.displayName && !name) setName(state.me.displayName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.me?.id]);

  /** Camera and mic run entirely in the browser — no server, no SDK. */
  const startMedia = useCallback(async () => {
    setMediaError(null);
    try {
      // Bare `audio: true` leaves the browser's defaults, and the default
      // that hurts is auto gain: in a quiet room it winds the gain up until
      // the noise floor itself is audible, which is heard as a constant
      // whisper that is always there and never loud enough to place. Off, with
      // suppression and cancellation left on, the room goes quiet between
      // words. Everything is a hint — a device that cannot do it ignores it
      // rather than failing the request.
      const s = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
      streamRef.current = s;
      setStream(s);
      if (videoRef.current) videoRef.current.srcObject = s;
      setCamOn(s.getVideoTracks().some((t) => t.enabled));
      setMicOn(s.getAudioTracks().some((t) => t.enabled));

      // A simple level meter so they can see the mic is actually working.
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(s);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
        setLevel(Math.min(1, peak / 64));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      setMediaError(
        (err as Error).name === "NotAllowedError"
          ? "Your browser blocked the camera or microphone. Allow access and try again."
          : "Couldn't reach a camera or microphone on this device.",
      );
    }
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Tell the control room we're still here, and whether our kit is working.
  useEffect(() => {
    if (!joined) return;
    const beat = async () => {
      try {
        const res = await apiRequest("POST", "/api/studio/heartbeat", {
          clientKey: key,
          camReady: camOn,
          micReady: micOn,
          slug,
          studioId,
        });
        queryClient.setQueryData(stateKey, (await res.json()) as StudioState);
      } catch {
        /* a dropped beat is fine; the next one puts us back */
      }
    };
    void beat();
    const id = setInterval(() => void beat(), HEARTBEAT_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, camOn, micOn, key, slug, studioId]);

  async function join() {
    try {
      await apiRequest("POST", "/api/studio/join", { clientKey: key, displayName: name.trim(), email: "", slug, studioId, signupId });
      setJoined(true);
      if (!streamRef.current) void startMedia();
    } catch (err) {
      toast({ title: "Couldn't join", description: (err as Error).message, variant: "destructive" });
    }
  }

  function toggleTrack(kind: "video" | "audio") {
    const s = streamRef.current;
    if (!s) return;
    const tracks = kind === "video" ? s.getVideoTracks() : s.getAudioTracks();
    const next = !tracks.every((t) => t.enabled);
    tracks.forEach((t) => (t.enabled = next));
    if (kind === "video") setCamOn(next);
    else setMicOn(next);
  }

  // Real audio and video, when the event has a media layer configured. Without
  // it the page still works as a green room; it just doesn't carry sound.
  const { status: roomStatus, peers, reconnect, quality } = useStudioRoom({
    enabled: joined,
    clientKey: key,
    slug,
    studioId,
    stream,
  });
  /**
   * The audience is in the same LiveKit room as the green room.
   *
   * /api/watch/token admits viewers subscribe-only under a `viewer-…`
   * identity, and the green room roster was "everyone not on stage" — so
   * anybody watching the public page appeared in "In here with you", with
   * their camera off and the name "Viewer". Two strangers in a room the
   * lineup is told is private, and a count that matched nobody in it.
   *
   * They cannot publish and nobody can see or hear them, so this is a display
   * bug rather than a leak — but it is the wrong answer to "who is in here".
   */
  const isViewer = (p: RoomPeer) => p.identity.startsWith("viewer-");
  const onAirPeers = peers.filter((p) => p.state === "On stage" && !isViewer(p));
  const isCohost = (p: { identity: string }) => p.identity === "alex";
  // The listening leg is plumbing — a second connection she needs in order to
  // hear, publishing nothing. It showed up as an empty box with initials
  // beside her, which reads as a broken second guest.
  const isCohostEar = (p: { identity: string }) => p.identity === "alex-ears";
  const greenRoomPeers = peers.filter(
    (p) => p.state !== "On stage" && !isViewer(p) && !isCohost(p) && !isCohostEar(p),
  );
  const cohost = peers.find((p) => isCohost(p) && !isViewer(p));
  const watchingCount = peers.filter(isViewer).length;
  // Whether we're listening to the programme while we wait. Off by default:
  // hearing the show and the room at once is a mess, and the show is what
  // you'd be talking over.
  const [listenToShow, setListenToShow] = useState(false);

  /**
   * Whether the camera and mic are actually working, proved rather than asked.
   *
   * "Camera on" only ever meant a track existed. A covered lens, a virtual
   * camera with no source, a muted-at-the-OS microphone — all reported on. So
   * the camera check waits for real frames, and the mic check waits to hear
   * something. Both latch once proved, and neither is remembered between
   * visits: a laptop that worked last week is not evidence about today.
   */
  const [camProved, setCamProved] = useState(false);
  const [micProved, setMicProved] = useState(false);
  /**
   * What the picture itself says about lighting, framing and background.
   *
   * Read off a 64px thumbnail of their own video every couple of seconds —
   * no model, no upload, nothing leaves the browser. These are heuristics on
   * brightness and detail, and they are worded as observations rather than
   * verdicts, because a heuristic that says "your background is cluttered"
   * about a bookshelf somebody likes is worse than saying nothing.
   */
  const [setup, setSetup] = useState<SetupCheck[]>([]);
  const [showSetup, setShowSetup] = useState(false);
  /**
   * How many of the three results have been revealed.
   *
   * The analysis itself is instant — it is arithmetic on a 64px thumbnail —
   * but revealing three verdicts in the same frame as the click reads as a
   * canned answer rather than a look at your picture. Walking down the list
   * shows what is being examined, which is also the honest description of
   * what it does.
   */
  const [scanned, setScanned] = useState(0);
  const scanning = showSetup && camOn && scanned < 3;

  useEffect(() => {
    if (!stream) {
      setCamProved(false);
      setMicProved(false);
      setSetup([]);
    }
  }, [stream]);

  useEffect(() => {
    if (micOn && level > 0.06) setMicProved(true);
  }, [micOn, level]);

  // Reveal one line at a time while the panel is open, and start again from
  // the top each time it is reopened.
  useEffect(() => {
    if (!showSetup || !camOn) {
      setScanned(0);
      return;
    }
    if (scanned >= 3) return;
    const t = setTimeout(() => setScanned((n) => n + 1), scanned === 0 ? 700 : 620);
    return () => clearTimeout(t);
  }, [showSetup, camOn, scanned]);

  useEffect(() => {
    if (!stream || !camOn) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const id = setInterval(() => {
      const v = videoRef.current;
      if (!v || !v.videoWidth || v.readyState < 2) return;
      setCamProved(true);
      if (!ctx) return;
      // A thumbnail is plenty — this is about average brightness, not detail.
      canvas.width = 64;
      canvas.height = Math.max(1, Math.round((64 * v.videoHeight) / v.videoWidth));
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      let sum = 0;
      let dark = 0;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < data.length; i += 4) {
        // Rec. 601 luma: green carries most of what the eye reads as bright.
        const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        sum += y;
        if (y < 40) dark++;
      }
      const px = data.length / 4;
      const mean = sum / px;
      const darkShare = dark / px;
      setSetup(readFrame(data, canvas.width, canvas.height, mean, darkShare));
    }, 2000);
    return () => clearInterval(id);
  }, [stream, camOn]);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  async function saveName() {
    const next = nameDraft.trim().slice(0, 60);
    setEditingName(false);
    if (!next || next === (state?.me?.displayName ?? "")) return;
    try {
      await apiRequest("POST", "/api/studio/rename", { clientKey: key, slug, studioId, displayName: next });
      await refetchState();
    } catch {
      // Not worth a dialog: the name they see reverts to the stored one on
      // the next poll, which is the honest outcome.
    }
  }

  const warnCount = setup.filter((c) => c.state === "warn").length;

  const zone = useMemo(detectLocalTimeZone, []);
  // A countdown has to move on its own; nobody reloads a green room.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  /**
   * "You're on at 3:30 PM · in 2 hours" — the thing everybody in a green room
   * actually wants to know. The server already worked the window out; the
   * client only has to say it in their own zone and count down.
   */
  const slotLabel = useMemo(() => {
    const slot = state?.mySlot;
    if (!slot) return "";
    // The empty case is handled by the caller, which names the account it
    // checked — "no slot" without saying whose is how somebody who holds one
    // under a different sign-in concludes the page is broken.
    const start = new Date(slot.startsAtUtc);
    const when = `${formatTimeInZone(start, zone)}`;
    const mins = Math.round((start.getTime() - now) / 60000);
    if (mins > 90) return `${when} · in ${Math.round(mins / 60)} hours`;
    if (mins > 1) return `${when} · in ${mins} minutes`;
    if (mins > -5) return `${when} · you're up now`;
    return `${when} · your slot has passed`;
  }, [state?.mySlot, zone, now]);
  const onStage = state?.me?.state === "On stage";
  // Standby rolling with nobody up is not a live show, whatever the flag says.
  const showIsLive =
    state?.studio.status === "Live" && !state?.studio.fallbackPlaying && onAirPeers.length > 0;

  return (
    <div className="min-h-screen bg-[#04102b] text-white">
      <div className="mx-auto w-full max-w-[1800px] px-4 py-5 sm:px-6">
        {/* Three columns, all starting on the back link's line: the room's
            name, Alex, and what is coming. Alex at half her old width — the
            chat needs a column, not the page — and Up next beside her rather
            than above the rail, so the top of the page answers "who is on,
            who is next, and who do I ask" without a scroll. */}
        <div className="grid gap-5 xl:grid-cols-[minmax(200px,15rem)_minmax(0,1fr)_minmax(17rem,20rem)] xl:items-start">
          <div>
            <Link
              href="/host/dashboard"
              className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-white/60 transition-colors hover:text-white"
              data-testid="link-back-to-dashboard"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to your dashboard
            </Link>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" style={HEADLINE_FONT}>
              Green Room
            </h1>
            <p className="text-sm text-white/60">
              {state?.eventName?.trim() ?? "…"}{state?.studio.name ? ` · ${state.studio.name}` : ""}
            </p>
            {state?.meta?.eventStartAtUtc && (
              <p className="mt-1 text-sm text-white/70" data-testid="text-start-time">
                Start time: <span className="font-semibold text-white">{formatTimeInZone(new Date(state.meta.eventStartAtUtc), "America/New_York")} Eastern</span>
              </p>
            )}
            {/* The pills live with the title, so the two cards on the right
                can stand the full height of Alex's. */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
            {quality && (
              <span
                className={`hidden items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold sm:inline-flex ${
                  quality.tone === "good"
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                    : quality.tone === "poor"
                      ? "border-[#ED1C24]/40 bg-[#ED1C24]/10 text-[#ff8a8f]"
                      : "border-white/20 bg-white/10 text-white/70"
                }`}
                data-testid="chip-connection"
              >
                <Wifi className="h-3.5 w-3.5" />
                {quality.label}
                {quality.tone === "poor" && <span className="font-normal opacity-80">· a cable beats wi-fi</span>}
              </span>
            )}
            <Badge
              className={`gap-1.5 px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                onStage
                  ? "bg-[#ED1C24] text-white hover:bg-[#ED1C24]"
                  : showIsLive
                    ? "bg-[#F0A71F] text-[#1a1200] hover:bg-[#F0A71F]"
                    : "bg-white/15 text-white/80 hover:bg-white/15"
              }`}
              data-testid="badge-studio-air"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  onStage ? "animate-pulse bg-white" : showIsLive ? "bg-[#1a1200]" : "bg-white/50"
                }`}
              />
              {onStage ? "You're on air" : showIsLive ? "Show is live" : "Off air"}
            </Badge>
            </div>
          </div>
          {/* The co-host sits with the room's name, not in the queue of people
              waiting to go on. She is staff. By text here: her rendered face
              took seven seconds to answer, and the stage is where the face
              matters. */}
          {/* Only once they are in the room. On the "add your name" screen
              she answered questions about a green room the person had not
              entered yet. */}
          {joined ? <AlexChat studioId={studioId} /> : <div />}
          <div className="flex h-56 flex-col">
            <div className="min-h-0 flex-1">
              {joined && <UpNext slug={slug} studioId={studioId} compact fill />}
            </div>
          </div>
        </div>

        {!joined ? (
          state && state.mayJoin === false ? (
          /* Said here rather than after they've filled in a name. The server
             refuses either way; this is only so nobody is surprised by it. */
          <div className="mx-auto mt-10 max-w-md rounded-2xl border border-white/15 bg-white/[0.06] p-6 text-center backdrop-blur">
            <Users className="mx-auto h-8 w-8 text-white/35" />
            <h2 className="mt-3 text-lg font-semibold">The green room is for the lineup</h2>
            <p className="mt-2 text-sm text-white/70">
              It carries live microphones and every other speaker's camera, so it's open to podcasters with a time on
              this event — and the crew. Take a slot and it opens for you.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Link href="/host/dashboard">
                <Button className="rounded-full bg-[#F0A71F] font-semibold text-[#1a1200] hover:bg-[#f5b944]">
                  Go to your dashboard
                </Button>
              </Link>
              <Link href="/agenda">
                <Button variant="outline" className="rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white">
                  See the agenda
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="mx-auto mt-10 max-w-md rounded-2xl border border-white/15 bg-white/[0.06] p-6 backdrop-blur">
            <h2 className="text-lg font-semibold">Join the green room</h2>
            <p className="mt-1 text-sm text-white/70">
              We'll check your camera and sound here first. The producer brings you on when it's your turn.
            </p>
            <form
              className="mt-5 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) void join();
              }}
            >
              <div>
                <Label htmlFor="studio-name" className="text-white/80">
                  Your name
                </Label>
                <Input
                  id="studio-name"
                  className="mt-1 border-white/20 bg-white/10 text-white placeholder:text-white/40"
                  placeholder="How you'll appear on screen"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  data-testid="input-studio-name"
                />
              </div>
              <GreenRoomButton type="submit" disabled={!name.trim()} testId="button-studio-join" />
            </form>
          </div>
        )
        ) : (
          /* Three columns: who's waiting, the programme, what's coming.
             The programme is the middle because it is the thing everyone in
             here is about to be part of, and seeing it is how you know the
             room is real. Your own face and your own checks live together on
             the left, because they are one question — am I ready.

             Above the stage, not below it: under the stage these pushed the
             thing you are actually here to watch off the bottom of the screen,
             and a green room you have to scroll is one where somebody misses
             the producer bringing them up. */
          <>
          <div className="mt-4 grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)_320px]">
            {/* ------------------------------------------------ left: the room */}
            <div className="order-2 flex flex-col gap-4 xl:order-1">
              <div>
                <div
                  className={`relative aspect-video overflow-hidden rounded-2xl border-2 bg-black ${
                    onStage ? "border-[#ED1C24]" : "border-white/20"
                  }`}
                >
                  {/* A camera that's off shows who they are instead of a
                      black rectangle — which is what the stage does, and the
                      green room shouldn't look more broken than the show.
                      Initials when there's no picture at all: crew hold no
                      slot, so there is often no artwork to fall back to, and
                      an empty tile tells the room nothing. */}
                  {!camOn && (
                    <div className="absolute inset-0 flex items-center justify-center" data-testid="self-avatar">
                      {state?.myPhotoUrl ? (
                        <>
                          <img
                            src={resolveUploadUrl(state.myPhotoUrl)}
                            alt=""
                            aria-hidden="true"
                            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-xl"
                          />
                          <img
                            src={resolveUploadUrl(state.myPhotoUrl)}
                            alt=""
                            className="relative h-24 w-24 rounded-full object-cover ring-2 ring-white/25"
                            data-testid="img-self-avatar"
                          />
                        </>
                      ) : (
                        <span
                          className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 text-3xl font-bold text-white/70 ring-2 ring-white/20"
                          data-testid="text-self-initials"
                        >
                          {initialsOf(state?.me?.displayName || name)}
                        </span>
                      )}
                    </div>
                  )}

                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`relative h-full w-full object-cover ${camOn ? "" : "opacity-0"}`}
                  />

                  {/* The sweep runs over your own picture while the checks
                      resolve, so it is obvious what is being looked at — and
                      that it is this frame, not something sent somewhere. */}
                  {scanning && (
                    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
                      <div className="setup-scan absolute inset-x-0 h-24" />
                      <div className="absolute inset-0 ring-2 ring-inset ring-[#F0A71F]/50" />
                    </div>
                  )}

                  {!stream && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
                      <VideoOff className="h-6 w-6 text-white/40" />
                      <Button size="sm" className="rounded-full" onClick={() => void startMedia()} data-testid="button-studio-start-media">
                        Turn on camera & mic
                      </Button>
                    </div>
                  )}
                  {/* The name the room sees and the lower third carries, and
                      it could only be set on the way in — so anyone who typed
                      it in a hurry was stuck with it in front of an audience.
                      Click it and fix it. */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-3 pb-1.5 pt-6">
                    {editingName ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void saveName();
                        }}
                        className="flex items-center gap-1.5"
                      >
                        <input
                          autoFocus
                          value={nameDraft}
                          maxLength={60}
                          onChange={(e) => setNameDraft(e.target.value)}
                          onBlur={() => void saveName()}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              setEditingName(false);
                              setNameDraft(state?.me?.displayName ?? name);
                            }
                          }}
                          className="min-w-0 flex-1 rounded-md border border-white/30 bg-black/50 px-2 py-1 text-sm font-semibold text-white outline-none focus:border-[#F0A71F]"
                          data-testid="input-rename-self"
                        />
                        <button type="submit" className="shrink-0 rounded-md bg-[#F0A71F] px-2 py-1 text-xs font-bold text-[#1a1200]">
                          Save
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setNameDraft(state?.me?.displayName ?? name);
                          setEditingName(true);
                        }}
                        className="group/name flex w-full items-center gap-1.5 text-left"
                        title="Change the name people see"
                        data-testid="button-rename-self"
                      >
                        <span className="truncate text-sm font-semibold">{state?.me?.displayName || name || "You"}</span>
                        <Pencil className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/name:opacity-70" />
                      </button>
                    )}
                  </div>
                  {onStage && (
                    <div className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-[#ED1C24] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> On stage
                    </div>
                  )}
                </div>

                {/* Your controls and your checks, directly under your own face. */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                    onClick={() => toggleTrack("video")}
                    disabled={!stream}
                    data-testid="button-studio-toggle-cam"
                  >
                    {camOn ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5 text-[#ED1C24]" />}
                    {camOn ? "Camera on" : "Camera off"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                    onClick={() => toggleTrack("audio")}
                    disabled={!stream}
                    data-testid="button-studio-toggle-mic"
                  >
                    {micOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5 text-[#ED1C24]" />}
                    {micOn ? "Mic on" : "Mic off"}
                  </Button>
                  {stream && (
                    <span className="flex items-center gap-0.5" aria-label="Microphone level">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <span
                          key={i}
                          className={`h-3.5 w-1 rounded-full transition-colors ${micOn && level * 8 > i ? "bg-[#F0A71F]" : "bg-white/15"}`}
                        />
                      ))}
                    </span>
                  )}
                  {/* Beside the meter because this is the other half of "am I
                      ready" — the half nobody thinks to check until they see
                      themselves back. */}
                  {stream && (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-expanded={showSetup}
                      className={`h-8 gap-1.5 rounded-full border-white/25 text-white hover:bg-white/20 hover:text-white ${
                        warnCount > 0 ? "bg-[#F0A71F]/20 border-[#F0A71F]/50" : "bg-white/10"
                      }`}
                      onClick={() => {
                        setScanned(0);
                        setShowSetup((v) => !v);
                      }}
                      data-testid="button-setup-check"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-[#F0A71F]" />
                      Check my setup
                      {warnCount > 0 && (
                        <span className="rounded-full bg-[#F0A71F] px-1.5 text-[10px] font-bold text-[#1a1200]">
                          {warnCount}
                        </span>
                      )}
                    </Button>
                  )}
                  <PlaybackButton stream={stream} camOn={camOn} />
                </div>

                {/* When there's no slot, name the account that was checked.
                    Somebody who holds one under a different sign-in reads a
                    bare "no slot" as the page being wrong, and there is no way
                    to tell from the screen which of two sessions they are in. */}
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-white/12 bg-white/[0.04] px-2.5 py-1.5">
                  <Clock className="h-3.5 w-3.5 shrink-0 text-[#F0A71F]" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-white">
                      {slotLabel || "No slot for this sign-in"}
                    </span>
                    <span className="block truncate text-[11px] text-white/45">
                      {slotLabel
                        ? "Wait here — the producer brings you up"
                        : state?.myEmail
                          ? `${state.myEmail}${state?.isCrew ? " · crew" : ""}`
                          : "Sign in to see your slot"}
                    </span>
                  </span>
                </div>

                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                  {(
                    [
                      ["Camera", camProved, camOn ? "waiting for a picture" : "turn it on"],
                      ["Mic", micProved, micOn ? "say something" : "turn it on"],
                      ["Name", !!state?.me?.displayName, "set it above"],
                    ] as const
                  ).map(([label, ok, hint]) => (
                    <li key={label} className="flex items-center gap-1" title={ok ? `${label} working` : `${label} — ${hint}`}>
                      <CheckCircle2 className={`h-3.5 w-3.5 ${ok ? "text-emerald-400" : "text-white/25"}`} />
                      <span className={ok ? "text-white/85" : "text-white/40"}>{label}</span>
                      {!ok && <span className="text-white/30">· {hint}</span>}
                    </li>
                  ))}
                </ul>

                {showSetup && (
                  <div className="mt-2 rounded-xl border border-white/15 bg-white/[0.05] p-3" data-testid="panel-setup-check">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">
                        <Sparkles className="h-3.5 w-3.5 text-[#F0A71F]" /> How you look right now
                      </span>
                      <span className="flex items-center gap-2">
                        {/* The readings keep updating underneath, but after
                            the first pass there was nothing that said so and
                            no way to ask again after moving a lamp. */}
                        {!scanning && (
                          <button
                            type="button"
                            onClick={() => setScanned(0)}
                            className="text-xs text-[#F0A71F] hover:text-white"
                            data-testid="button-setup-rescan"
                          >
                            Scan again
                          </button>
                        )}
                        <button type="button" onClick={() => setShowSetup(false)} className="text-xs text-white/45 hover:text-white">
                          Hide
                        </button>
                      </span>
                    </div>

                    {!camOn ? (
                      <p className="mt-2 text-xs text-white/60">Turn your camera on and this fills in.</p>
                    ) : (
                      <ul className="mt-2 flex flex-col gap-2">
                        {(["light", "background", "framing"] as const).map((key, i) => {
                          const done = scanned > i;
                          const c = setup.find((x) => x.key === key);
                          const label = key === "light" ? "Lighting" : key === "background" ? "Background" : "Framing";
                          return (
                            <li
                              key={key}
                              className={`flex items-start gap-2 text-xs transition-all duration-500 ${
                                done ? "opacity-100" : scanned === i ? "opacity-100" : "opacity-35"
                              }`}
                              data-testid={`setup-${key}`}
                            >
                              {done && c ? (
                                c.state === "good" ? (
                                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                                ) : (
                                  <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#F0A71F]" />
                                )
                              ) : (
                                <span
                                  className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
                                    scanned === i
                                      ? "animate-spin border-[#F0A71F] border-t-transparent"
                                      : "border-white/20"
                                  }`}
                                />
                              )}
                              <span className="min-w-0">
                                <span className="font-medium text-white">{label}</span>
                                {done && c ? (
                                  <span className="text-white/60"> — {c.note}</span>
                                ) : (
                                  <span className="text-white/35">{scanned === i ? " — looking…" : ""}</span>
                                )}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {/* Said plainly, because "AI is looking at me" is a
                        reasonable thing to worry about in a green room. */}
                    <p className="mt-2.5 border-t border-white/10 pt-2 text-[11px] leading-relaxed text-white/35">
                      {camOn && !scanning ? "Still watching — move a lamp and this follows. " : ""}
                      Worked out in your own browser from your own picture. Nothing is uploaded, recorded or seen by
                      anyone else.
                    </p>
                  </div>
                )}

                {mediaError && (
                  <p className="mt-2 flex items-start gap-2 rounded-xl border border-[#F0A71F]/40 bg-[#F0A71F]/10 p-2.5 text-xs text-white/85">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#F0A71F]" />
                    {mediaError}
                  </p>
                )}
              </div>

              {greenRoomPeers.length === 0 && (
                <p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/45">
                  Nobody else is in the green room yet.
                  {watchingCount > 0 && ` ${watchingCount} watching the public stream — they can't hear you.`}
                </p>
              )}

              {greenRoomPeers.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/50">
                    <Users className="h-3.5 w-3.5 text-[#F0A71F]" /> In here with you ({greenRoomPeers.length})
                  </div>
                  <div className="grid max-h-[22rem] grid-cols-2 gap-2 overflow-y-auto pr-1">
                    {greenRoomPeers.map((p) => (
                      <PeerTile key={p.identity} peer={p} />
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-white/40">
                    Talk freely — none of this is on air.
                    {watchingCount > 0 && ` ${watchingCount} watching the public stream, who cannot hear you.`}
                  </p>
                </div>
              )}

            </div>

            {/* --------------------------------------------- centre: the studio */}
            <div className="order-1 xl:order-2">
              <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/15 bg-black">
                {/* Exactly what the audience is seeing — the standby card, a
                    clip, the break clock or the stage. Not a description of it. */}
                <StageGrid
                  tiles={onAirPeers.map((p) => ({
                    identity: p.identity,
                    name: p.name,
                    displayTitle: "",
                    video: p.videoTrack ?? null,
                    audio: p.audioTrack ?? null,
                    speaking: false,
                  }))}
                  meta={(state?.meta ?? {}) as RoomMeta}
                  muted={!onStage && !listenToShow}
                  idleTitle={state?.studio.name}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-white/55">
                  {onStage
                    ? "You're on the air. Camera and mic are being taken."
                    : "This is what's going out. The producer brings you up when it's your turn."}
                </p>
                {!onStage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 gap-1.5 px-2 text-xs text-white/55 hover:text-white"
                    onClick={() => setListenToShow((v) => !v)}
                    data-testid="button-listen-show"
                  >
                    {listenToShow ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                    {listenToShow ? "Listening" : "Listen in"}
                  </Button>
                )}
              </div>

              {roomStatus === "unavailable" && (
                <p className="mt-3 rounded-xl border border-white/15 bg-white/[0.06] p-3 text-sm text-white/60">
                  Sound and video for this event aren't switched on yet. Your camera check still works.
                </p>
              )}
              {(roomStatus === "error" || (roomStatus === "idle" && stream)) && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#ED1C24]/50 bg-[#ED1C24]/10 p-3 text-sm text-white/85">
                  <span>
                    {roomStatus === "error"
                      ? "We couldn't connect you to the live room. Trying again shortly."
                      : "You dropped out of the room — reconnecting. Keep this tab in front."}
                  </span>
                  <Button size="sm" className="rounded-full" onClick={reconnect} data-testid="button-studio-reconnect">
                    Reconnect now
                  </Button>
                </div>
              )}
              {roomStatus === "connecting" && (
                <p className="mt-3 text-sm text-white/50">Connecting you to the room…</p>
              )}
            </div>

            {/* --------------------------------------------- right: the running order */}
            <div className="order-3 flex flex-col gap-4">
              {/* Producers get the filter in here too — they answer "is my video
                  loaded?" from wherever they happen to be standing. A podcaster
                  is looking for one scene, their own, and scrolling to it is
                  not the problem worth solving. */}
              <RunningOrder slug={slug} studioId={studioId} searchable={!!state?.isCrew} />

              {recordings.length > 0 && (
                <div className="rounded-2xl border border-white/15 bg-white/[0.06] p-4">
                  <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/50">
                    <Disc className="h-3.5 w-3.5 text-[#ED1C24]" /> My recordings
                  </div>
                  <div className="flex flex-col gap-2">
                    {recordings.map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.04] px-2.5 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-white">
                            {new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                          </p>
                          <p className="text-[11px] text-white/50">
                            {r.status === "Recording" ? (
                              <span className="font-medium text-[#ED1C24]">● Recording…</span>
                            ) : r.status === "Ready" ? (
                              `${fmtDuration(r.durationSeconds)}${fmtSize(r.fileSizeBytes)}`
                            ) : (
                              r.status
                            )}
                          </p>
                        </div>
                        {r.status === "Ready" && r.downloadUrl && (
                          <a
                            href={r.downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-white/20"
                          >
                            <Download className="mr-1 inline h-3 w-3" /> MP4
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
