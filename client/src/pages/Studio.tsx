import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NavBar } from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useStudioRoom, type RoomPeer } from "@/hooks/use-studio-room";
import type { StudioParticipantRow } from "@shared/schema";
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
} from "lucide-react";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const KEY_STORAGE = "mv_studio_key";
const HEARTBEAT_MS = 6_000;

interface StudioState {
  eventName: string;
  studio: { name: string; status: string; fallbackPlaying: boolean; maxOnStage: number };
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
      <span className="absolute inset-x-1.5 bottom-1.5 truncate rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
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
      await apiRequest("POST", "/api/studio/join", { clientKey: key, displayName: name.trim(), email: "", slug, studioId });
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
  const { status: roomStatus, peers } = useStudioRoom({
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

  const onStage = state?.me?.state === "On stage";
  const live = state?.studio.status === "Live";

  return (
    <div className="min-h-screen bg-[#04102b] text-white">
      <NavBar />

      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" style={HEADLINE_FONT}>
              {state?.studio.name ?? "Studio"}
            </h1>
            <p className="mt-1 text-sm text-white/60">{state?.eventName?.trim() ?? "Loading…"}</p>
          </div>
          <Badge
            className={`gap-1.5 px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
              live ? "bg-[#ED1C24] text-white hover:bg-[#ED1C24]" : "bg-white/15 text-white/80 hover:bg-white/15"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${live ? "animate-pulse bg-white" : "bg-white/50"}`} />
            {live ? "On the air" : (state?.studio.status ?? "Offline")}
          </Badge>
        </div>

        {!joined ? (
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
        ) : (
          <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            {/* ------------------------------------------------ camera preview */}
            <div>
              <div
                className={`relative aspect-video overflow-hidden rounded-2xl border-2 bg-black ${
                  onStage ? "border-[#ED1C24]" : "border-white/15"
                }`}
              >
                <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" />
                {!stream && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                    <VideoOff className="h-8 w-8 text-white/40" />
                    <p className="text-sm text-white/70">Your camera isn't on yet.</p>
                    <Button size="sm" className="rounded-full" onClick={() => void startMedia()} data-testid="button-studio-start-media">
                      Turn on camera & mic
                    </Button>
                  </div>
                )}
                {onStage && (
                  <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-[#ED1C24] px-3 py-1 text-xs font-bold uppercase tracking-wide">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> On stage
                  </div>
                )}
              </div>

              {mediaError && (
                <p className="mt-3 flex items-start gap-2 rounded-xl border border-[#F0A71F]/40 bg-[#F0A71F]/10 p-3 text-sm text-white/85">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#F0A71F]" />
                  {mediaError}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
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
                  className="gap-1.5 rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                  onClick={() => toggleTrack("audio")}
                  disabled={!stream}
                  data-testid="button-studio-toggle-mic"
                >
                  {micOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5 text-[#ED1C24]" />}
                  {micOn ? "Mic on" : "Mic off"}
                </Button>

                {stream && (
                  <div className="ml-1 flex items-center gap-1" aria-label="Microphone level">
                    {Array.from({ length: 10 }).map((_, i) => (
                      <span
                        key={i}
                        className={`h-4 w-1.5 rounded-full transition-colors ${
                          micOn && level * 10 > i ? "bg-[#F0A71F]" : "bg-white/15"
                        }`}
                      />
                    ))}
                  </div>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto gap-1.5 text-white/60 hover:text-white"
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
              </div>
            </div>

            {/* ---------------------------------------------------- your status */}
            <div className="flex flex-col gap-4">
              <div
                className={`rounded-2xl border p-5 ${
                  onStage ? "border-[#ED1C24]/60 bg-[#ED1C24]/10" : "border-white/15 bg-white/[0.06]"
                }`}
              >
                <div className="text-xs font-semibold uppercase tracking-wide text-white/60">You are</div>
                <div className="mt-1 text-xl font-bold" style={HEADLINE_FONT}>
                  {onStage ? "On stage" : "In the green room"}
                </div>
                <p className="mt-2 text-sm text-white/70">
                  {onStage
                    ? "You're part of the broadcast. Camera and mic are being taken."
                    : "Stay here with your camera on. The producer will bring you up when it's your turn."}
                </p>
              </div>

              {/* On air. When you're waiting this is a monitor you can watch;
                  when you're up there it's the people beside you. */}
              {(onAirPeers.length > 0 || state?.studio.fallbackPlaying) && (
                <div className="rounded-2xl border border-white/15 bg-white/[0.06] p-5">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-white/60">
                      <Radio className="h-3.5 w-3.5 text-[#ED1C24]" />
                      {onStage ? "Also on stage" : "On air now"}
                    </div>
                    {!onStage && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1.5 px-2 text-xs text-white/60 hover:text-white"
                        onClick={() => setListenToShow((v) => !v)}
                        data-testid="button-listen-show"
                      >
                        {listenToShow ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                        {listenToShow ? "Listening" : "Listen in"}
                      </Button>
                    )}
                  </div>
                  <div className={`grid gap-2 ${onAirPeers.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                    {onAirPeers.map((p) => (
                      // On stage you hear them. Waiting, only if you asked to.
                      <PeerTile key={p.identity} peer={p} muted={!onStage && !listenToShow} />
                    ))}
                  </div>
                  {!onStage && (
                    <p className="mt-2 text-xs text-white/45">
                      They can't hear the green room. Nothing said here reaches the broadcast.
                    </p>
                  )}
                </div>
              )}

              {/* The green room as an actual room: everyone waiting can see and
                  hear each other, and none of it goes out. */}
              {!onStage && greenRoomPeers.length > 0 && (
                <div className="rounded-2xl border border-white/15 bg-white/[0.06] p-5">
                  <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-white/60">
                    <Users className="h-3.5 w-3.5 text-[#F0A71F]" /> In here with you ({greenRoomPeers.length})
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {greenRoomPeers.map((p) => (
                      <PeerTile key={p.identity} peer={p} />
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-white/45">
                    Talk freely — this is off air.
                  </p>
                </div>
              )}

              {roomStatus === "unavailable" && (
                <p className="rounded-2xl border border-white/15 bg-white/[0.06] p-4 text-sm text-white/60">
                  Sound and video for this event aren't switched on yet. Your camera check still works.
                </p>
              )}
              {roomStatus === "error" && (
                <p className="rounded-2xl border border-[#ED1C24]/50 bg-[#ED1C24]/10 p-4 text-sm text-white/85">
                  We couldn't connect you to the live room. Refresh, and tell the producer if it happens again.
                </p>
              )}

              <div className="rounded-2xl border border-white/15 bg-white/[0.06] p-5">
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/60">Your check</div>
                <ul className="flex flex-col gap-2 text-sm">
                  {[
                    ["Camera working", camOn],
                    ["Microphone working", micOn && level > 0.02],
                    ["Name set", !!state?.me?.displayName],
                  ].map(([label, ok]) => (
                    <li key={label as string} className="flex items-center gap-2">
                      <CheckCircle2 className={`h-4 w-4 ${ok ? "text-[#F0A71F]" : "text-white/25"}`} />
                      <span className={ok ? "text-white" : "text-white/55"}>{label as string}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex items-center gap-4 rounded-2xl border border-white/15 bg-white/[0.06] p-5 text-sm">
                <span className="inline-flex items-center gap-1.5 text-white/75">
                  <Radio className="h-4 w-4 text-[#F0A71F]" /> {state?.onStageCount ?? 0} on stage
                </span>
                <span className="inline-flex items-center gap-1.5 text-white/75">
                  <Users className="h-4 w-4 text-[#F0A71F]" /> {state?.greenRoomCount ?? 0} waiting
                </span>
              </div>

              {state?.studio.fallbackPlaying && (
                <p className="rounded-2xl border border-[#F0A71F]/40 bg-[#F0A71F]/10 p-4 text-sm text-white/85">
                  The producer has rolled the standby video. Hold tight — you'll be brought back shortly.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
