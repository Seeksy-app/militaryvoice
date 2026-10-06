import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, ChevronDown, Check, Loader2, Headphones, ScanFace, CircleAlert, CircleCheck } from "lucide-react";
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

  // ---- The check at the door (6 Oct AAR): hear your mic, headphones on, and
  // SI looks at your shot. Done once a day on this device; then it remembers.
  const CHECK_KEY = "mv-join-check-ok";
  const [passedEarlier, setPassedEarlier] = useState(() => {
    try { return Date.now() - Number(localStorage.getItem(CHECK_KEY) || 0) < 12 * 3600_000; } catch { return false; }
  });
  const loudFor = useRef(0);
  const [heard, setHeard] = useState(false);
  useEffect(() => {
    if (heard || !micOn) return;
    if (level > 0.12) loudFor.current += 1;
    if (loudFor.current >= 8) setHeard(true);
  }, [level, micOn, heard]);
  const [phones, setPhones] = useState<"" | "yes" | "no">("");
  type Review = { verdict: "good" | "fix"; summary: string; items: { area: string; ok: boolean; tip: string }[]; unavailable?: boolean };
  const [review, setReview] = useState<Review | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const checkShot = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setReviewing(true);
    try {
      const w = 640, h = Math.round((v.videoHeight / v.videoWidth) * 640);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d")!.drawImage(v, 0, 0, w, h);
      const r = await fetch("/api/studio/shot-review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: c.toDataURL("image/jpeg", 0.8) }) });
      setReview(r.ok ? ((await r.json()) as Review) : { verdict: "good", summary: "We couldn't check your shot just now, so go ahead.", items: [], unavailable: true });
    } catch {
      setReview({ verdict: "good", summary: "We couldn't check your shot just now, so go ahead.", items: [], unavailable: true });
    }
    setReviewing(false);
  };
  const shotDone = !camOn || Boolean(review);
  const ready = passedEarlier || (heard && phones !== "" && shotDone);

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

            {passedEarlier ? (
              <p className="mt-5 flex items-center justify-center gap-2 text-sm text-emerald-700">
                <CircleCheck className="h-4 w-4" /> You checked your mic and camera earlier today.
                <button type="button" className="font-semibold text-[#053877] underline underline-offset-2" onClick={() => setPassedEarlier(false)}>Check again</button>
              </p>
            ) : (
              <div className="mt-5 space-y-2 rounded-2xl bg-slate-50 p-4" data-testid="join-check">
                <p className="text-sm font-semibold text-slate-700">A quick check before you go in</p>
                <div className="flex items-center gap-2.5 text-sm">
                  {heard ? <CircleCheck className="h-4 w-4 shrink-0 text-emerald-600" /> : <Mic className="h-4 w-4 shrink-0 text-slate-400" />}
                  <span className={heard ? "text-slate-700" : "text-slate-500"}>{heard ? "We can hear you" : micOn ? "Say a few words so we can hear your mic" : "Turn your mic on, then say a few words"}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 text-sm">
                  {phones ? <CircleCheck className="h-4 w-4 shrink-0 text-emerald-600" /> : <Headphones className="h-4 w-4 shrink-0 text-slate-400" />}
                  <span className="text-slate-600">Headphones on? They stop the echo.</span>
                  <span className="flex gap-1.5">
                    {(["yes", "no"] as const).map((v) => (
                      <button key={v} type="button" onClick={() => setPhones(v)} className={`rounded-full px-3 py-0.5 text-xs font-semibold ${phones === v ? "bg-[#053877] text-white" : "bg-white text-slate-600 ring-1 ring-slate-300"}`} data-testid={`join-phones-${v}`}>
                        {v === "yes" ? "Yes" : "I don't have any"}
                      </button>
                    ))}
                  </span>
                </div>
                {phones === "no" && <p className="pl-6 text-xs text-slate-500">That's OK. Keep your speaker volume low, and we'll mute you when you're not on stage.</p>}
                <div className="flex flex-wrap items-center gap-2.5 text-sm">
                  {review ? (review.verdict === "good" ? <CircleCheck className="h-4 w-4 shrink-0 text-emerald-600" /> : <CircleAlert className="h-4 w-4 shrink-0 text-[#b07800]" />) : <ScanFace className="h-4 w-4 shrink-0 text-slate-400" />}
                  <span className="text-slate-600">{!camOn ? "Camera off: nothing to check" : review ? review.summary || (review.verdict === "good" ? "You look good on camera" : "A couple of things to fix") : "SI checks your light, framing and background"}</span>
                  {camOn && (
                    <button type="button" onClick={() => void checkShot()} disabled={reviewing || !stream} className="rounded-full bg-white px-3 py-0.5 text-xs font-semibold text-[#053877] ring-1 ring-slate-300 disabled:opacity-50" data-testid="join-check-shot">
                      {reviewing ? "Checking…" : review ? "Check again" : "Check my shot"}
                    </button>
                  )}
                </div>
                {review && review.items.length > 0 && (
                  <ul className="space-y-1 pl-6 text-xs" data-testid="join-shot-notes">
                    {review.items.map((i) => (
                      <li key={i.area} className={i.ok ? "text-slate-500" : "font-medium text-[#8a5a00]"}>{i.ok ? "✓ " : "→ "}{i.tip}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <form
              className="mt-6"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim() && !joining && ready) {
                  try { localStorage.setItem(CHECK_KEY, String(Date.now())); } catch { /* private window */ }
                  onJoin();
                }
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
                disabled={!name.trim() || joining || !ready}
                className="mt-5 h-14 w-full rounded-2xl bg-[#053877] text-lg font-bold text-white transition-colors hover:bg-[#0a4a9a] disabled:opacity-50"
                data-testid="button-studio-join"
              >
                {joining ? "Joining…" : ready ? "Join the green room" : "Finish the check to join"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
