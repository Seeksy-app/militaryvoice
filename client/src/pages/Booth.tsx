import "@livekit/components-styles";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ControlBar, GridLayout, LiveKitRoom, ParticipantTile, PreJoin, RoomAudioRenderer, useLocalParticipant, useRemoteParticipants, useRoomContext, useTracks, type LocalUserChoices } from "@livekit/components-react";
import { RoomEvent, Track, type RemoteParticipant } from "livekit-client";
import { Check, Clapperboard, Copy, Loader2, Mic, Radio, Square, Timer, Video, VideoOff } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { RadioStreamIn } from "@/components/RadioStreamIn";
import { durationOf, uploadToStorage } from "@/lib/upload";

// MilitaryVoices Radio booth: one booking's own simple studio. Check the
// camera and mic, wait with a countdown, go on air on the clock, see the time
// left. The day's room is shared with every booking, so this page only shows
// and plays the people on this booking (their signupId attribute); the
// station's intro and outro play on air around them (see Program.tsx).

type Info = { clip?: { ready: boolean; playing: boolean; durationSec: number; startedAtMs: number } | null; signupId: number; role: "host" | "guest" | "admin"; show: string; host: string; day: string; startAtUtc: string; endAtUtc: string; onAirAtUtc: string; offAirAtUtc: string; opensAtUtc: string; closesAtUtc: string; guestLink: string; ready: boolean; anytime?: boolean; endedAtUtc?: string; next?: { show: string; host: string; startAtUtc: string } | null };

const ET = "America/New_York";
const hm = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
/** 4:12 under an hour; "2 h 10 min" (or "3 days") further out, where seconds are noise. */
const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 2 * 86_400) return `${Math.floor(s / 86_400)} days`;
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const say = (e: unknown) => ((e as Error).message ?? "").replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "") || "Try again in a moment.";

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  return now;
}

/** A clock face: hours, minutes and seconds, each with its word under it, ticking every second. */
function Clock({ ms, big = true }: { ms: number; big?: boolean }) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const parts = [["hours", Math.floor(t / 3600)], ["minutes", Math.floor((t % 3600) / 60)], ["seconds", t % 60]] as const;
  const dot = big ? "h-2 w-2" : "h-1.5 w-1.5";
  return (
    <div className="flex items-start justify-center gap-2 font-black tabular-nums leading-none" role="timer" aria-label={`${parts[0][1]} hours ${parts[1][1]} minutes ${parts[2][1]} seconds`}>
      {parts.map(([word, n], i) => (
        <div key={word} className="flex items-start gap-2">
          {i > 0 && <span className={`flex flex-col gap-2 ${big ? "mt-[1.9rem] lg:mt-[2.4rem]" : "mt-[0.95rem]"}`} aria-hidden><i className={`${dot} rounded-full bg-white/55`} /><i className={`${dot} rounded-full bg-white/55`} /></span>}
          <div className="flex flex-col items-center">
            <span className={big ? "text-[4.4rem] tracking-tight [text-shadow:0_0_24px_rgba(255,255,255,0.25)] lg:text-[5.4rem]" : "text-[2.6rem] lg:text-[3rem]"}>{String(n).padStart(2, "0")}</span>
            <span className={`${big ? "mt-1.5 text-[11px] lg:text-xs" : "mt-1 text-[10px]"} font-bold uppercase tracking-[0.14em] text-white/60`}>{word}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Where they are against the clock: a rail down the right with the countdown at the top where it can't be missed
 * (it is radio, so the picture matters little and the clock matters most). On a phone it runs across the top.
 * On air, the big clock counts DOWN the time left; the time already used counts UP in the green card below.
 * Design: Andrew's mockup, 15 Nov 2026 (dark navy glass, red ON AIR segment, green time-so-far card, red stop button).
 */
function Rail({ info, shift = 0, onEnd, error = "" }: { info: Info; shift?: number; onEnd?: () => Promise<void>; error?: string }) {
  const [asking, setAsking] = useState(false);
  const [ending, setEnding] = useState(false);
  const now = useNow() + shift;
  const on = Date.parse(info.onAirAtUtc), off = Date.parse(info.offAirAtUtc), start = Date.parse(info.startAtUtc), end = Date.parse(info.endAtUtc);
  const left = off - now;
  // The pill is a two-part switch: the state on the left (red when on air), what the clock means on the right.
  let seg = "bg-white/15 text-white", word = "", what = "", small = "", ms = 0, clock = true;
  let pct = -1;
  if (now < start) { word = "Soon"; what = "On air in"; ms = on - now; small = `The station's intro starts at ${hm(info.startAtUtc)} ET, then you're live at ${hm(info.onAirAtUtc)}.`; }
  else if (now < on) { seg = "bg-gradient-to-b from-[#f7b733] to-[#d98b0a] text-[#1a1200]"; word = "Intro"; what = "Live in"; ms = on - now; small = "Get ready: you're next."; }
  else if (now < off) {
    seg = "bg-gradient-to-b from-[#f0434b] to-[#c8151c] text-white shadow-[0_0_18px_rgba(237,28,36,0.55)]";
    word = "On air"; what = "Time left"; ms = left;
    pct = Math.min(100, Math.max(0, ((now - on) / (off - on)) * 100));
    small = left <= 30_000 ? "Say goodbye now: the outro is about to play." : left <= 120_000 ? "Two minutes: start wrapping up." : left <= 300_000 ? "Five minutes left." : `You're live until ${hm(info.offAirAtUtc)} ET.`;
  }
  else if (now < end) { seg = "bg-gradient-to-b from-[#34d058] to-[#16a34a] text-white"; word = "Off air"; what = "Thank you"; clock = false; small = "The station's outro is playing. Stay as long as you like, or leave below."; }
  else { seg = "bg-gradient-to-b from-[#34d058] to-[#16a34a] text-white"; word = "Done"; what = "Thank you"; clock = false; small = "You can close this tab."; }
  const onAir = now >= on && now < off;
  // The rail flashes three times, and stops, at five minutes, three, one, and thirty seconds left.
  const leftSec = Math.ceil(left / 1000);
  const flash = onAir && [300, 180, 60, 30].some((t) => leftSec <= t && leftSec > t - 2);
  return (
    <aside className="relative flex shrink-0 flex-col justify-start gap-4 overflow-hidden bg-[linear-gradient(180deg,#0b1d4a_0%,#071331_55%,#040b22_100%)] px-5 pb-8 pt-6 text-center text-white lg:w-[30rem] lg:gap-6 lg:px-8 lg:pt-9" data-testid="booth-status" data-flashing={flash || undefined}>
      <style>{`@keyframes mv-flash{0%,100%{opacity:0}35%{opacity:.75}} .mv-flash{animation:mv-flash .6s ease-in-out 3}`}</style>
      {/* The arc of light over the top, and the waves under the bottom */}
      <svg className="pointer-events-none absolute inset-x-0 top-0 h-40 w-full" viewBox="0 0 480 160" preserveAspectRatio="none" aria-hidden>
        <defs><linearGradient id="mvArc" x1="0" x2="1"><stop offset="0" stopColor="#2f6bff" stopOpacity="0.9" /><stop offset="0.55" stopColor="#2f6bff" stopOpacity="0.15" /><stop offset="1" stopColor="#ff3b3b" stopOpacity="0.95" /></linearGradient></defs>
        <path d="M-10 160 C 40 20, 440 20, 490 160" fill="none" stroke="url(#mvArc)" strokeWidth="2.5" style={{ filter: "drop-shadow(0 0 8px rgba(80,120,255,0.6))" }} />
      </svg>
      <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-40 w-full" viewBox="0 0 480 160" preserveAspectRatio="none" aria-hidden>
        <defs><linearGradient id="mvWave" x1="0" x2="1"><stop offset="0" stopColor="#1b4fd8" stopOpacity="0.1" /><stop offset="0.5" stopColor="#4aa3ff" stopOpacity="0.9" /><stop offset="1" stopColor="#2f6bff" stopOpacity="0.15" /></linearGradient></defs>
        <path d="M0 120 C 90 70, 170 150, 260 105 S 420 60, 480 90" fill="none" stroke="url(#mvWave)" strokeWidth="2" />
        <path d="M0 135 C 100 95, 180 160, 270 125 S 420 85, 480 110" fill="none" stroke="url(#mvWave)" strokeWidth="1.2" opacity="0.6" />
      </svg>
      {flash && <div className="mv-flash pointer-events-none absolute inset-0 z-20 bg-[#ED1C24]" aria-hidden />}

      <div className="relative z-10 mx-auto inline-flex items-stretch overflow-hidden rounded-full border border-white/25 bg-white/[0.06] text-sm font-extrabold uppercase tracking-[0.14em] lg:text-base">
        <span className={`flex items-center gap-2 rounded-full px-5 py-2.5 ${seg}`}>{onAir && <Radio className="h-4 w-4 animate-pulse" />}{word}</span>
        <span className="flex items-center px-5 text-white/75">{what}</span>
      </div>

      <div className="relative z-10">{clock ? <Clock ms={ms} /> : <p className="py-4 text-6xl font-black leading-none lg:text-7xl">Thank you</p>}</div>

      {onAir && (
        <div className="relative z-10 mx-auto w-full max-w-sm rounded-2xl border border-[#4ade80]/50 bg-gradient-to-b from-[#14532d]/80 to-[#0b2b1a]/85 px-4 py-4 shadow-[0_0_30px_rgba(74,222,128,0.12)]">
          <p className="flex items-center justify-center gap-2 text-xs font-extrabold uppercase tracking-[0.14em] text-white/90 lg:text-sm"><Mic className="h-4 w-4" />Time on air so far</p>
          <div className="mt-2"><Clock ms={now - on} big={false} /></div>
          {pct >= 0 && <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-gradient-to-r from-[#65e34a] to-[#9be04a]" style={{ width: `${pct}%` }} /></div>}
        </div>
      )}

      <div className="relative z-10 flex items-center gap-3 text-lg font-semibold lg:text-xl">
        <span className="h-px flex-1 bg-white/20" />
        {onAir && <Timer className="h-5 w-5 shrink-0 text-white/80" />}
        <span>{small}</span>
        <span className="h-px flex-1 bg-white/20" />
      </div>

      {info.next && (
        <p className="relative z-10 text-center text-base font-semibold text-white/80 lg:text-lg" data-testid="booth-up-next">
          <span className="font-extrabold uppercase tracking-[0.14em] text-[#F0A71F]">Up next on the station</span><br />
          {hm(info.next.startAtUtc)} ET · {info.next.show}{info.next.host && info.next.host !== info.next.show ? `, with ${info.next.host}` : ""}
        </p>
      )}

      {error && <p className="relative z-10 mx-auto max-w-sm rounded-xl bg-black/40 px-3 py-2 text-sm font-semibold text-[#ffb4b4]" role="alert">{error}</p>}
      {onAir && onEnd && (asking ? (
        <div className="relative z-10 mx-auto flex w-full max-w-sm flex-col gap-2 rounded-2xl border border-white/20 bg-black/35 p-3" data-testid="booth-end-confirm">
          <p className="text-sm font-bold">End your show now? The station plays your outro right away.</p>
          <div className="flex gap-2">
            <button type="button" disabled={ending} onClick={() => { setEnding(true); void onEnd().finally(() => { setEnding(false); setAsking(false); }); }} className="flex-1 rounded-full bg-gradient-to-b from-[#f0434b] to-[#b3121a] px-4 py-2.5 text-sm font-extrabold text-white">{ending ? "Ending…" : "Yes, end it"}</button>
            <button type="button" onClick={() => setAsking(false)} className="flex-1 rounded-full border border-white/50 px-4 py-2.5 text-sm font-bold text-white">Keep going</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAsking(true)} className="relative z-10 mx-auto inline-flex items-center gap-3 rounded-full border border-white/30 bg-gradient-to-b from-[#f0434b] to-[#b3121a] px-8 py-3.5 text-base font-extrabold text-white shadow-[0_8px_26px_rgba(237,28,36,0.4)] hover:brightness-110 lg:text-lg" data-testid="booth-end"><Square className="h-5 w-5 fill-white" />End my show early</button>
      ))}
    </aside>
  );
}


/**
 * Tells the host what the audience gets: with the camera on, their video goes out on the station; with it off, listeners
 * see their photo, the show's name and a sound bar. One tap switches. Before they go live it warns, so no one is surprised.
 */
function OnAirNotice({ info, shift = 0 }: { info: Info; shift?: number }) {
  const { localParticipant, isCameraEnabled } = useLocalParticipant();
  const now = useNow() + shift;
  const [busy, setBusy] = useState(false);
  const on = Date.parse(info.onAirAtUtc), off = Date.parse(info.offAirAtUtc);
  if (now >= off) return null;
  const live = now >= on;
  const toggle = async () => { setBusy(true); try { await localParticipant.setCameraEnabled(!isCameraEnabled); } finally { setBusy(false); } };
  const tone = isCameraEnabled ? (live ? "border-[#ED1C24] bg-[#ED1C24]/20" : "border-[#F0A71F] bg-[#F0A71F]/15") : "border-[#4ade80]/60 bg-[#14532d]/40";
  return (
    <div className={`mx-4 mb-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-white ${tone}`} role="status" data-testid="booth-onair-notice">
      <p className="flex min-w-0 flex-1 items-center gap-3 text-base font-semibold lg:text-lg">
        {isCameraEnabled ? <Video className="h-6 w-6 shrink-0" /> : <VideoOff className="h-6 w-6 shrink-0" />}
        <span>
          {isCameraEnabled
            ? (live ? <><b>Your video is being broadcast right now.</b> For audio only, turn your camera off.</> : <>Your camera is on. At {hm(info.onAirAtUtc)} ET your video goes out on the station. For audio only, turn it off.</>)
            : (live ? <><b>You're on air, audio only.</b> Listeners see your photo, your show's name and a sound bar.</> : <>Your camera is off. At {hm(info.onAirAtUtc)} ET you go on air as audio only: listeners see your photo, your show's name and a sound bar.</>)}
        </span>
      </p>
      <button type="button" disabled={busy} onClick={() => void toggle()} className="shrink-0 rounded-full border border-white/60 bg-white/10 px-5 py-2 text-sm font-extrabold hover:bg-white/20 disabled:opacity-60" data-testid="booth-camera-toggle">
        {isCameraEnabled ? "Turn camera off" : "Turn camera on"}
      </button>
    </div>
  );
}

function GuestLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  if (!link) return null;
  return (
    <button type="button" onClick={() => { void navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/25 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10" data-testid="booth-guest-link">
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy guest link"}
    </button>
  );
}

/** Only this booking's people: hear and see them, never the next show warming up. */
function BookingStage({ signupId }: { signupId: number }) {
  const room = useRoomContext();
  const mine = (p: { attributes?: Record<string, string> }) => p.attributes?.signupId === String(signupId);
  const remotes = useRemoteParticipants();
  useEffect(() => {
    const sync = () => room.remoteParticipants.forEach((p: RemoteParticipant) => p.trackPublications.forEach((pub) => pub.setSubscribed(mine(p))));
    sync();
    room.on(RoomEvent.TrackPublished, sync).on(RoomEvent.ParticipantAttributesChanged, sync);
    return () => { room.off(RoomEvent.TrackPublished, sync).off(RoomEvent.ParticipantAttributesChanged, sync); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, remotes.length, signupId]);
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false })
    .filter((t) => t.participant.isLocal || mine(t.participant as unknown as { attributes?: Record<string, string> }));
  return (
    <>
      <GridLayout tracks={tracks} style={{ height: "100%" }}><ParticipantTile /></GridLayout>
      <RoomAudioRenderer />
    </>
  );
}


/**
 * "Show a clip": the host uploads a video ahead of time (it waits in the booth), then presses Play when they are ready.
 * It plays full screen on air with its sound until it ends or they press Stop.
 */
function ClipBar({ id, g, clip, onChange }: { id: string; g: string; clip?: Info["clip"]; onChange: () => void }) {
  const [pct, setPct] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState("");
  const inp = useRef<HTMLInputElement>(null);
  const rehearse = async () => {
    if (preview) { setPreview(""); return; }
    setErr("");
    try { const r = (await (await apiRequest("GET", `/api/booth/${id}/clip/preview${g ? `?g=${encodeURIComponent(g)}` : ""}`)).json()) as { url: string }; setPreview(r.url); } catch (e) { setErr(say(e)); }
  };
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.max(0, Math.round(sec) % 60)).padStart(2, "0")}`;
  const endAt = clip?.playing ? clip.startedAtMs + clip.durationSec * 1000 : 0;
  const playing = !!clip && clip.playing && Date.now() < endAt;
  const post = async (path: string, body: Record<string, unknown> = {}) => { setErr(""); setBusy(true); try { await apiRequest("POST", `/api/booth/${id}/clip${path}`, { g: g || undefined, ...body }); onChange(); } catch (e) { setErr(say(e)); } finally { setBusy(false); } };
  const upload = async (file: File) => {
    setErr("");
    try {
      const sec = await durationOf(file).catch(() => 0);
      if (!(sec > 0)) throw new Error("We couldn't read that video. Try an MP4.");
      const key = await uploadToStorage(file, setPct);
      setPct(null);
      await post("", { key, durationSec: sec });
    } catch (e) { setPct(null); setErr(say(e)); } finally { if (inp.current) inp.current.value = ""; }
  };
  const btn = "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold disabled:opacity-60";
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="booth-clip">
      <input ref={inp} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
      {pct !== null ? (
        <span className={`${btn} border border-white/30 text-white`}><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading your clip… {Math.round(pct)}%</span>
      ) : playing ? (
        <>
          <span className={`${btn} bg-[#ed1c24] text-white`}><Clapperboard className="h-3.5 w-3.5" /> {Date.now() < clip!.startedAtMs ? "Clip starting…" : `Clip on air · ${mmss((endAt - Date.now()) / 1000)} left`}</span>
          <button type="button" disabled={busy} onClick={() => void post("/stop")} className={`${btn} border border-white/30 text-white hover:bg-white/10`} data-testid="booth-clip-stop">Stop the clip</button>
        </>
      ) : clip?.ready ? (
        <>
          <button type="button" disabled={busy} onClick={() => void post("/play")} className={`${btn} bg-gradient-to-b from-[#34d058] to-[#16a34a] text-white hover:brightness-110`} data-testid="booth-clip-play"><Clapperboard className="h-3.5 w-3.5" /> Play your clip ({mmss(clip.durationSec)})</button>
          <button type="button" disabled={busy} onClick={() => void rehearse()} className={`${btn} border border-white/30 text-white hover:bg-white/10`} data-testid="booth-clip-preview">{preview ? "Close the preview" : "Rehearse it (only you see it)"}</button>
          <button type="button" disabled={busy} onClick={() => inp.current?.click()} className={`${btn} border border-white/30 text-white hover:bg-white/10`}>Choose another</button>
          <button type="button" disabled={busy} onClick={() => void post("/remove")} className="text-xs font-semibold text-white/70 underline hover:text-white">Remove</button>
        </>
      ) : (
        <button type="button" onClick={() => inp.current?.click()} className={`${btn} border border-white/30 text-white hover:bg-white/10`} data-testid="booth-clip-add"><Clapperboard className="h-3.5 w-3.5" /> Add a clip</button>
      )}
      {err && <span className="text-xs text-red-300">{err}</span>}
      {preview && !playing && (
        <div className="fixed bottom-24 right-4 z-50 w-72 overflow-hidden rounded-xl border border-white/30 bg-black shadow-2xl" data-testid="booth-clip-preview-player">
          <video src={preview} controls autoPlay playsInline className="aspect-video w-full" />
          <p className="px-3 py-1.5 text-[11px] text-white/70">Only you can see and hear this. Use headphones so it doesn't go out through your microphone.</p>
        </div>
      )}
    </div>
  );
}

/** Props that never change, so the page ticking its clock twice a second doesn't hand LiveKit a "new" setting each time. */
const CONNECT_OPTS = { autoSubscribe: false } as const;
const ROOM_STYLE = { height: "100dvh", display: "flex", flexDirection: "column", background: "#000741" } as const;
const CONTROLS = { microphone: true, camera: true, screenShare: false, chat: false, leave: true } as const;
const WATCH_CONTROLS = { microphone: false, camera: false, screenShare: false, chat: false, leave: true } as const;

/** An admin watching: joins on its own, with nothing to set up. */
function AutoWatch({ onJoin }: { onJoin: (c: LocalUserChoices) => void }) {
  useEffect(() => { onJoin({ username: "Admin watching", videoEnabled: false, audioEnabled: false, videoDeviceId: "", audioDeviceId: "" } as LocalUserChoices); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  return <p className="text-lg font-semibold">Joining as a watcher…</p>;
}

/**
 * The camera and mic check. Memoised on purpose: the booth page re-renders every half second for its clock, and a
 * pre-join that got fresh props each time restarted its camera preview, so the picture blinked on and off.
 */
const PreJoinBox = memo(function PreJoinBox({ username, onJoin, onError }: { username: string; onJoin: (c: LocalUserChoices) => void; onError: (e: Error) => void }) {
  const defaults = useMemo(() => ({ username }), [username]);
  return <PreJoin defaults={defaults} persistUserChoices={false} joinLabel="Enter Radio" userLabel="Your name" onSubmit={onJoin} onError={onError} />;
});

export default function Booth({ id }: { id: string }) {
  const g = useMemo(() => new URLSearchParams(window.location.search).get("g") ?? "", []);
  const info = useQuery<Info>({ queryKey: ["/api/booth", id, g], queryFn: async () => (await apiRequest("GET", `/api/booth/${id}${g ? `?g=${encodeURIComponent(g)}` : ""}`)).json(), retry: false });
  const [conn, setConn] = useState<{ url: string; token: string } | null>(null);
  const [choices, setChoices] = useState<LocalUserChoices | null>(null);
  const [error, setError] = useState("");
  const [left, setLeft] = useState(false);
  const [previewEnd, setPreviewEnd] = useState("");
  const now = useNow();
  // An admin can preview any moment: ?at=2026-11-16T21:03:00Z plays the clock as if it were then.
  const previewShift = useMemo(() => { const at = Date.parse(new URLSearchParams(window.location.search).get("at") ?? ""); return Number.isFinite(at) ? at - Date.now() : 0; }, []);

  const watchParam = useMemo(() => new URLSearchParams(window.location.search).get("watch") === "1", []);
  const join = useCallback(async (c: LocalUserChoices) => {
    setError("");
    try {
      const r = await apiRequest("POST", `/api/booth/${id}/token`, { name: c.username, g: g || undefined, watch: watchParam || undefined });
      setChoices(c);
      setConn(await r.json());
    } catch (e) { setError(say(e)); }
  }, [id, g, watchParam]);
  const onDisconnected = useCallback(() => setLeft(true), []);
  const onJoin = useCallback((c: LocalUserChoices) => { void join(c); }, [join]);
  const onPreJoinError = useCallback((e: Error) => setError(/permission/i.test(e.message) ? "Allow your camera and microphone for this site (the icon in the address bar), then reload." : e.message), []);
  const videoOpt = useMemo(() => (choices?.videoEnabled ? { deviceId: choices.videoDeviceId } : false), [choices]);
  const audioOpt = useMemo(() => (choices?.audioEnabled ? { deviceId: choices.audioDeviceId } : false), [choices]);

  const shell = "flex min-h-screen flex-col items-center justify-center gap-5 bg-[#000741] p-4 text-white";
  if (info.isLoading) return <div className={shell} />;
  if (!info.data) {
    return (
      <div className={shell}>
        <p className="text-2xl font-bold">Your MilitaryVoices Radio show</p>
        <p className="max-w-md text-center text-white/75">{say(info.error)}</p>
        {!g && <a href="/host/dashboard" className="rounded-full bg-white px-5 py-2.5 font-semibold text-[#000741]">Sign in</a>}
      </div>
    );
  }
  const d = info.data;
  // A show ended early: the clock moves on to the outro now.
  const endedAt = d.endedAtUtc || previewEnd;
  const eff: Info = endedAt && Date.parse(endedAt) < Date.parse(d.offAirAtUtc) ? { ...d, offAirAtUtc: endedAt, endAtUtc: new Date(Math.min(Date.parse(d.endAtUtc), Date.parse(endedAt) + 45_000)).toISOString() } : d;
  const watching = watchParam && d.role === "admin";
  const endShow = async () => {
    setError("");
    // Previewing a moment (?at=): show what ending does on this screen only, without touching the real show.
    if (d.anytime && previewShift) { setPreviewEnd(new Date(Date.now() + previewShift).toISOString()); return; }
    try { await apiRequest("POST", `/api/booth/${id}/end`, { g: g || undefined }); await info.refetch(); } catch (e) { setError(say(e)); }
  };
  if (left) {
    return (
      <div className={shell}>
        <p className="text-2xl font-bold">You've left your Radio show</p>
        {now < Date.parse(d.closesAtUtc) && <button type="button" onClick={() => { setLeft(false); setConn(null); }} className="rounded-full bg-white px-5 py-2.5 font-semibold text-[#000741]">Go back in</button>}
      </div>
    );
  }
  const header = (
    <div className="text-center">
      <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#F0A71F]">MilitaryVoices Radio</p>
      <h1 className="mt-1 text-2xl font-bold [text-wrap:balance]">{d.show}</h1>
      <p className="mt-1 text-sm text-white/70">{d.day.replace(/^MilitaryVoices Radio · /, "")} · <span className="whitespace-nowrap">{hm(d.startAtUtc)}–{hm(d.endAtUtc)} ET</span> · <span className="whitespace-nowrap">live {hm(d.onAirAtUtc)}–{hm(d.offAirAtUtc)}</span></p>
    </div>
  );

  if (!conn) {
    // An admin (or a developer's machine) can go in any time; the server agrees.
    const early = now < Date.parse(d.opensAtUtc) && !d.anytime;
    return (
      <div data-lk-theme="default" className={shell}>
        {header}
        {early ? (
          <div className="rounded-2xl bg-white/10 p-5 text-center">
            <p className="text-lg font-semibold">Your Radio show opens at {hm(d.opensAtUtc)} ET</p>
            <p className="mt-1 text-sm text-white/70">An hour before your time. Come back then to check your camera and mic.</p>
            {d.role === "host" && <div className="mt-4"><p className="mb-2 text-xs text-white/60">Bringing a guest? Send them this link:</p><GuestLink link={d.guestLink} /></div>}
          </div>
        ) : watchParam && d.role === "admin" ? (
          <AutoWatch onJoin={onJoin} />
        ) : (
          <div className="w-full max-w-xl" data-testid="booth-prejoin">
            <PreJoinBox username={d.role === "host" ? d.host : ""} onJoin={onJoin} onError={onPreJoinError} />
          </div>
        )}
        {!watchParam && (d.role === "host" || d.role === "admin") && <RadioStreamIn id={id} />}
        {error && <p className="max-w-md text-center text-sm text-red-300">{error}</p>}
      </div>
    );
  }

  return (
    <LiveKitRoom
      data-lk-theme="default"
      serverUrl={conn.url}
      token={conn.token}
      connect
      connectOptions={CONNECT_OPTS}
      video={videoOpt}
      audio={audioOpt}
      onDisconnected={onDisconnected}
      style={ROOM_STYLE}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 text-white">
        <p className="text-sm font-semibold">{d.show} <span className="font-normal text-white/60">· {watching ? "Watching only: this is what the host sees. You can't be seen or heard." : "you see and hear only your own show"}</span></p>
        <div className="flex flex-wrap items-center gap-3">{!watching && (d.role === "host" || d.role === "admin") && <ClipBar id={id} g={g} clip={d.clip} onChange={() => void info.refetch()} />}{d.role === "host" && <GuestLink link={d.guestLink} />}</div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row-reverse">
        <Rail info={eff} shift={d.anytime ? previewShift : 0} onEnd={!watching && (d.role === "host" || d.role === "admin") ? endShow : undefined} error={error} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!watching && <OnAirNotice info={eff} shift={d.anytime ? previewShift : 0} />}
          <div className="min-h-0 flex-1"><BookingStage signupId={d.signupId} /></div>
        </div>
      </div>
      <ControlBar controls={watching ? WATCH_CONTROLS : CONTROLS} />
    </LiveKitRoom>
  );
}
