import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useStudioRoom, type RoomPeer } from "@/hooks/use-studio-room";
import { StageGrid, type RoomMeta } from "@/components/StageView";
import { SceneRail } from "@/components/SceneRail";
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
} from "lucide-react";

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
function RunningOrder({ slug, studioId }: { slug?: string; studioId?: number }) {
  const zone = useMemo(detectLocalTimeZone, []);
  const { data } = useQuery<{ scenes: SceneRow[]; currentSceneId: number }>({
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
        runItems={[]}
        signups={[]}
        presentNames={[]}
        media={[]}
        readOnly
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
function PeerTile({ peer, muted = false }: { peer: RoomPeer; muted?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !peer.videoTrack) return;
    peer.videoTrack.attach(el);
    return () => {
      peer.videoTrack?.detach(el);
    };
  }, [peer.videoTrack]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !peer.audioTrack) return;
    peer.audioTrack.attach(el);
    return () => {
      peer.audioTrack?.detach(el);
    };
  }, [peer.audioTrack]);

  return (
    <div className="relative aspect-video overflow-hidden rounded-xl border border-white/15 bg-black">
      <video ref={videoRef} autoPlay playsInline className="h-full w-full object-cover" />
      <audio ref={audioRef} autoPlay muted={muted} />
      {!peer.videoTrack && (
        <div className="absolute inset-0 flex items-center justify-center">
          <VideoOff className="h-5 w-5 text-white/30" />
        </div>
      )}
      <span className="absolute inset-x-1.5 bottom-1.5 truncate rounded bg-black/60 px-1.5 py-0.5 text-[12px] text-white">
        {peer.name}
      </span>
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
  const { data: state } = useQuery<StudioState>({
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
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
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
  const { status: roomStatus, peers, reconnect } = useStudioRoom({
    enabled: joined,
    clientKey: key,
    slug,
    studioId,
    stream,
  });
  const onAirPeers = peers.filter((p) => p.state === "On stage");
  const greenRoomPeers = peers.filter((p) => p.state !== "On stage");
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
  /** Read off the picture: too dark to see, or blown out. */
  const [lightHint, setLightHint] = useState<string>("");

  useEffect(() => {
    if (!stream) {
      setCamProved(false);
      setMicProved(false);
      setLightHint("");
    }
  }, [stream]);

  useEffect(() => {
    if (micOn && level > 0.06) setMicProved(true);
  }, [micOn, level]);

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
      setLightHint(
        mean < 55
          ? "It's dark where you are. A lamp or a window in front of you — not behind — makes the difference."
          : mean > 205
            ? "You're blown out. Move away from the light behind you, or turn it down."
            : darkShare > 0.55
              ? "Your face is lit but the room behind you is black. A light on the back wall stops you floating in the dark."
              : "",
      );
    }, 2000);
    return () => clearInterval(id);
  }, [stream, camOn]);

  const onStage = state?.me?.state === "On stage";
  // Standby rolling with nobody up is not a live show, whatever the flag says.
  const showIsLive =
    state?.studio.status === "Live" && !state?.studio.fallbackPlaying && onAirPeers.length > 0;

  return (
    <div className="min-h-screen bg-[#04102b] text-white">
      <div className="mx-auto w-full max-w-[1800px] px-4 py-5 sm:px-6">
        <Link
          href="/host/dashboard"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-white/60 transition-colors hover:text-white"
          data-testid="link-back-to-dashboard"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to your dashboard
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" style={HEADLINE_FONT}>
              {state?.studio.name ?? "Studio"}
            </h1>
            <p className="mt-1 text-sm text-white/60">{state?.eventName?.trim() ?? "Loading…"}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* What's true from where they're standing. The studio's own status
                said "Live" while standby was rolling and nobody was on stage,
                which reads as "you are being broadcast" — the one thing it must
                never say wrongly. */}
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
            {joined && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                onClick={async () => {
                  await apiRequest("POST", "/api/studio/leave", { clientKey: key, slug, studioId }).catch(() => {});
                  streamRef.current?.getTracks().forEach((t) => t.stop());
                  streamRef.current = null;
                  setStream(null);
                  setJoined(false);
                }}
                data-testid="button-studio-leave"
              >
                <LogOut className="h-3.5 w-3.5" /> Leave
              </Button>
            )}
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
              <Button
                type="submit"
                disabled={!name.trim()}
                className="rounded-full bg-[#F0A71F] font-semibold text-[#1a1200] hover:bg-[#f5b944]"
                data-testid="button-studio-join"
              >
                Enter the green room
              </Button>
            </form>
          </div>
        )
        ) : (
          /* Three columns: who's waiting, the programme, what's coming.
             The programme is the middle because it is the thing everyone in
             here is about to be part of, and seeing it is how you know the
             room is real. Your own face and your own checks live together on
             the left, because they are one question — am I ready. */
          <div className="mt-5 grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)_320px]">
            {/* ------------------------------------------------ left: the room */}
            <div className="order-2 flex flex-col gap-4 xl:order-1">
              <div>
                <div
                  className={`relative aspect-video overflow-hidden rounded-2xl border-2 bg-black ${
                    onStage ? "border-[#ED1C24]" : "border-white/20"
                  }`}
                >
                  <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
                  {!stream && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
                      <VideoOff className="h-6 w-6 text-white/40" />
                      <Button size="sm" className="rounded-full" onClick={() => void startMedia()} data-testid="button-studio-start-media">
                        Turn on camera & mic
                      </Button>
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-3 pb-1.5 pt-6">
                    <p className="truncate text-sm font-semibold">{state?.me?.displayName || name || "You"}</p>
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

                {lightHint && (
                  <p className="mt-2 flex items-start gap-2 rounded-xl border border-[#F0A71F]/40 bg-[#F0A71F]/10 p-2.5 text-xs text-white/85">
                    <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#F0A71F]" />
                    {lightHint}
                  </p>
                )}

                {mediaError && (
                  <p className="mt-2 flex items-start gap-2 rounded-xl border border-[#F0A71F]/40 bg-[#F0A71F]/10 p-2.5 text-xs text-white/85">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#F0A71F]" />
                    {mediaError}
                  </p>
                )}
              </div>

              {greenRoomPeers.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/50">
                    <Users className="h-3.5 w-3.5 text-[#F0A71F]" /> In here with you ({greenRoomPeers.length})
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {greenRoomPeers.map((p) => (
                      <PeerTile key={p.identity} peer={p} />
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-white/40">Talk freely — none of this is on air.</p>
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
              <RunningOrder slug={slug} studioId={studioId} />

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
        )}
      </div>
    </div>
  );
}
