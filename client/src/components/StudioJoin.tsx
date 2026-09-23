import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, ChevronDown, Check, Loader2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LogoLockupOnDark } from "@/components/Logo";

/**
 * The way into the green room, modelled on Restream's "Ready to join?":
 * who invited you on the left, and on the right your own camera, your mic and
 * camera with a picker for each, your name and an optional title — the two
 * things that will sit under your picture on air — and one button.
 *
 * The camera starts here, so the stream you check is the stream you walk in
 * with: nothing is asked for twice and nothing changes on the way in.
 */
export function StudioJoin({
  inviter,
  eventName,
  whenLabel,
  stream,
  camOn,
  micOn,
  level,
  mediaError,
  onStartMedia,
  onToggle,
  name,
  setName,
  title,
  setTitle,
  onJoin,
  joining,
}: {
  inviter: { name: string; photoUrl: string } | null;
  eventName: string;
  whenLabel: string;
  stream: MediaStream | null;
  camOn: boolean;
  micOn: boolean;
  level: number;
  mediaError: string | null;
  onStartMedia: (dev?: { video?: string; audio?: string }) => void;
  onToggle: (kind: "video" | "audio") => void;
  name: string;
  setName: (v: string) => void;
  title: string;
  setTitle: (v: string) => void;
  onJoin: () => void;
  joining: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  // Ask for the camera the moment the page opens, as Restream does.
  useEffect(() => {
    if (!stream) onStartMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
    // Labels only come back once permission is granted, so list after the stream.
    if (stream) void navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => {});
  }, [stream]);

  const cams = devices.filter((d) => d.kind === "videoinput");
  const mics = devices.filter((d) => d.kind === "audioinput");
  const camId = stream?.getVideoTracks()[0]?.getSettings().deviceId;
  const micId = stream?.getAudioTracks()[0]?.getSettings().deviceId;

  const Picker = ({ list, current, kind }: { list: MediaDeviceInfo[]; current?: string; kind: "video" | "audio" }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-12 items-center rounded-r-full pl-1 pr-3 text-slate-500 transition-colors hover:text-slate-900"
          aria-label={kind === "video" ? "Choose a camera" : "Choose a microphone"}
          data-testid={`button-join-pick-${kind}`}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-72">
        <DropdownMenuLabel className="text-xs">{kind === "video" ? "Camera" : "Microphone"}</DropdownMenuLabel>
        {list.length === 0 && <DropdownMenuItem disabled>Allow access to see your devices</DropdownMenuItem>}
        {list.map((d, i) => (
          <DropdownMenuItem
            key={d.deviceId || i}
            onClick={() => {
              try { localStorage.setItem(kind === "video" ? "mv-green-cam" : "mv-green-mic", d.deviceId); } catch { /* private window */ }
              onStartMedia(kind === "video" ? { video: d.deviceId } : { audio: d.deviceId });
            }}
          >
            <Check className={`mr-2 h-3.5 w-3.5 ${d.deviceId === current ? "opacity-100" : "opacity-0"}`} />
            <span className="truncate">{d.label || `${kind === "video" ? "Camera" : "Microphone"} ${i + 1}`}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="min-h-screen bg-[#04102b] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-6">
        <LogoLockupOnDark className="h-9 w-auto self-start" />
        <div className="grid flex-1 content-center items-center gap-8 py-6 lg:grid-cols-[1fr_minmax(0,34rem)] lg:gap-10 lg:py-8">
          {/* Who asked you here, and to what. */}
          <div className="text-center lg:text-left">
            {inviter && (
              <p className="flex items-center justify-center gap-2.5 text-lg text-white/80 lg:justify-start">
                {inviter.photoUrl ? (
                  <img src={inviter.photoUrl} alt="" className="h-9 w-9 rounded-full object-cover ring-2 ring-white/20" />
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-sm font-bold">{inviter.name.slice(0, 1)}</span>
                )}
                <span><span className="font-semibold text-white">{inviter.name}</span> has invited you to join</span>
              </p>
            )}
            <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>
              {eventName || "The green room"}
            </h1>
            {whenLabel && <p className="mt-2 text-base text-[#F0A71F]">{whenLabel}</p>}
            <p className="mx-auto mt-5 max-w-md text-sm leading-relaxed text-white/55 lg:mx-0">
              You'll wait in the green room with the other guests. Nothing there is on air — the producer brings you on
              stage when it's your turn.
            </p>
          </div>

          {/* Ready to join? */}
          <div className="rounded-[1.75rem] bg-white p-6 text-slate-900 shadow-2xl sm:p-8" data-testid="card-ready-to-join">
            <h2 className="text-center text-2xl font-bold tracking-tight text-[#000741]">Ready to join?</h2>

            <div className="relative mt-5 aspect-video overflow-hidden rounded-2xl bg-[#0b1433]">
              {/* Muted: this is your own microphone, and hearing it back is the echo. */}
              <video ref={videoRef} autoPlay playsInline muted className={`h-full w-full scale-x-[-1] object-cover ${camOn && stream ? "" : "invisible"}`} data-testid="video-join-preview" />
              {(!stream || !camOn) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/70">
                  {!stream && !mediaError ? <Loader2 className="h-6 w-6 animate-spin" /> : <VideoOff className="h-7 w-7" />}
                  <span className="px-6 text-center text-sm">
                    {mediaError ?? (!stream ? "Starting your camera…" : "Your camera is off")}
                  </span>
                  {mediaError && (
                    <button type="button" onClick={() => onStartMedia()} className="mt-1 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white hover:bg-white/25">
                      Try again
                    </button>
                  )}
                </div>
              )}
              {name.trim() && (
                <span className="absolute bottom-3 left-3 max-w-[70%] truncate rounded-md bg-black/45 px-2 py-0.5 text-sm font-semibold text-white">
                  {name.trim()}
                  {title.trim() && <span className="font-normal text-white/75"> · {title.trim()}</span>}
                </span>
              )}
            </div>

            <div className="mt-5 flex items-center justify-center gap-3">
              <div className="flex items-center rounded-full bg-slate-100">
                <button
                  type="button"
                  onClick={() => onToggle("audio")}
                  disabled={!stream}
                  className={`relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-full transition-colors ${micOn ? "bg-white text-slate-900 shadow" : "bg-red-500 text-white"}`}
                  aria-label={micOn ? "Mute your microphone" : "Turn your microphone on"}
                  data-testid="button-join-mic"
                >
                  {/* The fill rises with your voice, so you can see the mic hears you. */}
                  {micOn && <span className="absolute inset-x-0 bottom-0 bg-emerald-400/35 transition-[height] duration-75" style={{ height: `${Math.round(level * 100)}%` }} />}
                  {micOn ? <Mic className="relative h-5 w-5" /> : <MicOff className="relative h-5 w-5" />}
                </button>
                <Picker list={mics} current={micId} kind="audio" />
              </div>
              <div className="flex items-center rounded-full bg-slate-100">
                <button
                  type="button"
                  onClick={() => onToggle("video")}
                  disabled={!stream}
                  className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${camOn ? "bg-white text-slate-900 shadow" : "bg-red-500 text-white"}`}
                  aria-label={camOn ? "Turn your camera off" : "Turn your camera on"}
                  data-testid="button-join-camera"
                >
                  {camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
                </button>
                <Picker list={cams} current={camId} kind="video" />
              </div>
            </div>

            <form
              className="mt-6"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim() && !joining) onJoin();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-600">Your name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={80}
                    autoFocus
                    placeholder="How you'll appear on screen"
                    className="mt-1.5 h-12 w-full rounded-xl border border-slate-300 px-3.5 text-base text-slate-900 outline-none transition focus:border-[#053877] focus:ring-2 focus:ring-[#053877]/25"
                    data-testid="input-studio-name"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-600">
                    Title <span className="font-normal text-slate-400">(optional)</span>
                  </span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={120}
                    placeholder="e.g. Host, Army Ranger"
                    className="mt-1.5 h-12 w-full rounded-xl border border-slate-300 px-3.5 text-base text-slate-900 outline-none transition focus:border-[#053877] focus:ring-2 focus:ring-[#053877]/25"
                    data-testid="input-studio-title"
                  />
                </label>
              </div>
              <button
                type="submit"
                disabled={!name.trim() || joining}
                className="mt-5 h-14 w-full rounded-2xl bg-[#053877] text-lg font-bold text-white transition-colors hover:bg-[#0a4a9a] disabled:opacity-50"
                data-testid="button-studio-join"
              >
                {joining ? "Joining…" : "Join the green room"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
