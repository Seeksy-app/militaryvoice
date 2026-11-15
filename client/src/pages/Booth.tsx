import "@livekit/components-styles";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ControlBar, GridLayout, LiveKitRoom, ParticipantTile, PreJoin, RoomAudioRenderer, useRemoteParticipants, useRoomContext, useTracks, type LocalUserChoices } from "@livekit/components-react";
import { RoomEvent, Track, type RemoteParticipant } from "livekit-client";
import { Check, Copy, Radio } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

// MilitaryVoices Radio booth: one booking's own simple studio. Check the
// camera and mic, wait with a countdown, go on air on the clock, see the time
// left. The day's room is shared with every booking, so this page only shows
// and plays the people on this booking (their signupId attribute); the
// station's intro and outro play on air around them (see Program.tsx).

type Info = { signupId: number; role: "host" | "guest" | "admin"; show: string; host: string; day: string; startAtUtc: string; endAtUtc: string; onAirAtUtc: string; offAirAtUtc: string; opensAtUtc: string; closesAtUtc: string; guestLink: string; ready: boolean; anytime?: boolean; endedAtUtc?: string };

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
  const parts = [["hours", Math.floor(t / 3600)], ["min", Math.floor((t % 3600) / 60)], ["sec", t % 60]] as const;
  return (
    <div className="flex items-start justify-center gap-1.5 font-black tabular-nums leading-none" role="timer" aria-label={`${parts[0][1]} hours ${parts[1][1]} minutes ${parts[2][1]} seconds`}>
      {parts.map(([word, n], i) => (
        <div key={word} className="flex items-start gap-1.5">
          {i > 0 && <span className={`${big ? "text-[3.5rem] lg:text-[4.5rem]" : "text-3xl"} -mt-1 opacity-60`}>:</span>}
          <div className="flex flex-col items-center">
            <span className={big ? "text-[4.25rem] lg:text-[5.5rem]" : "text-4xl"}>{String(n).padStart(2, "0")}</span>
            <span className={`${big ? "mt-1 text-xs lg:text-sm" : "mt-0.5 text-[10px]"} font-bold uppercase tracking-[0.16em] opacity-70`}>{word}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Where they are against the clock: a rail down the right, with the countdown at the top where it can't be missed
 * (it is radio, so the picture matters little and the clock matters most). On a phone it runs across the top.
 * On air, the big clock counts DOWN the time left; the time already used counts UP underneath.
 */
function Rail({ info, shift = 0, onEnd }: { info: Info; shift?: number; onEnd?: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [ending, setEnding] = useState(false);
  const now = useNow() + shift;
  const on = Date.parse(info.onAirAtUtc), off = Date.parse(info.offAirAtUtc), start = Date.parse(info.startAtUtc), end = Date.parse(info.endAtUtc);
  const left = off - now;
  let tone = "bg-[#1a2150] text-white", label = "", small = "", ms = 0, clock = true;
  let pct = -1;
  if (now < start) { label = "You're on air in"; ms = on - now; small = `The station's intro starts at ${hm(info.startAtUtc)} ET, then you're live at ${hm(info.onAirAtUtc)}.`; }
  else if (now < on) { tone = "bg-[#F0A71F] text-[#1a1200]"; label = "Intro playing. You're live in"; ms = on - now; small = "Get ready: you're next."; }
  else if (now < off) {
    // Green while there's time, amber for the last five minutes, red only for the last thirty seconds.
    tone = left <= 30_000 ? "bg-[#c81e25] text-white" : left <= 300_000 ? "bg-[#b45309] text-white" : "bg-[#14532d] text-white";
    label = "ON AIR · time left"; ms = left;
    pct = Math.min(100, Math.max(0, ((now - on) / (off - on)) * 100));
    small = left <= 30_000 ? "Say goodbye now: the outro is about to play." : left <= 120_000 ? "Two minutes: start wrapping up." : left <= 300_000 ? "Five minutes left." : `You're live until ${hm(info.offAirAtUtc)} ET.`;
  }
  else if (now < end) { tone = "bg-[#053877] text-white"; label = "You're off air"; clock = false; small = "The station's outro is playing. Stay as long as you like, or leave below."; }
  else { label = "That's a wrap"; clock = false; small = "You can close this tab."; }
  const onAir = now >= on && now < off;
  // The whole rail flashes for eight seconds at five minutes, three, one, and thirty seconds left: no one misses it.
  const leftSec = Math.ceil(left / 1000);
  const flash = onAir && [300, 180, 60, 30].some((t) => leftSec <= t && leftSec > t - 8);
  return (
    <aside className={`flex shrink-0 flex-col justify-start gap-3 px-5 pb-6 pt-5 text-center lg:w-[30rem] lg:gap-5 lg:px-6 lg:pt-8 ${tone} ${flash ? "mv-booth-flash" : ""}`} data-testid="booth-status" data-flashing={flash || undefined} style={{ ["--mv-tone" as string]: left <= 30_000 ? "#c81e25" : left <= 300_000 ? "#b45309" : "#14532d" }}>
      <style>{`@keyframes mv-booth-flash{0%,49%{background-color:var(--mv-tone);color:#fff}50%,100%{background-color:#fff;color:#14532d}} .mv-booth-flash{animation:mv-booth-flash .7s steps(1) infinite} .mv-booth-flash *{color:inherit !important}`}</style>
      <p className="mx-auto flex items-center justify-center gap-2 rounded-full bg-black/30 px-5 py-2 text-sm font-extrabold uppercase tracking-[0.18em] sm:text-base lg:text-lg">{onAir && <Radio className="h-5 w-5 animate-pulse" />}{label}</p>
      {clock ? <Clock ms={ms} /> : <p className="text-6xl font-black leading-none lg:text-7xl">Thank you</p>}
      {onAir && (
        <div className="mx-auto mt-1 w-full max-w-sm rounded-xl bg-[#04140a]/60 px-4 py-3 ring-1 ring-white/20">
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] opacity-80">Time on air so far</p>
          <div className="mt-2 text-white/95"><Clock ms={now - on} big={false} /></div>
          {pct >= 0 && <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-black/20"><div className="h-full rounded-full bg-current" style={{ width: `${pct}%` }} /></div>}
        </div>
      )}
      <p className="text-base font-semibold opacity-90 lg:text-xl">{small}</p>
      {onAir && onEnd && (asking ? (
        <div className="mx-auto flex w-full max-w-sm flex-col gap-2 rounded-xl bg-black/20 p-3" data-testid="booth-end-confirm">
          <p className="text-sm font-bold">End your show now? The station plays your outro right away.</p>
          <div className="flex gap-2">
            <button type="button" disabled={ending} onClick={() => { setEnding(true); void onEnd().finally(() => { setEnding(false); setAsking(false); }); }} className="flex-1 rounded-full bg-white px-4 py-2 text-sm font-extrabold text-[#ED1C24]">{ending ? "Ending…" : "Yes, end it"}</button>
            <button type="button" onClick={() => setAsking(false)} className="flex-1 rounded-full border border-white/50 px-4 py-2 text-sm font-bold">Keep going</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAsking(true)} className="mx-auto mt-2 rounded-full bg-white px-7 py-3 text-base font-extrabold text-[#0b1230] shadow-lg hover:bg-white/90" data-testid="booth-end">End my show early</button>
      ))}
    </aside>
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

/** Props that never change, so the page ticking its clock twice a second doesn't hand LiveKit a "new" setting each time. */
const CONNECT_OPTS = { autoSubscribe: false } as const;
const ROOM_STYLE = { height: "100dvh", display: "flex", flexDirection: "column", background: "#000741" } as const;
const CONTROLS = { microphone: true, camera: true, screenShare: false, chat: false, leave: true } as const;

/**
 * The camera and mic check. Memoised on purpose: the booth page re-renders every half second for its clock, and a
 * pre-join that got fresh props each time restarted its camera preview, so the picture blinked on and off.
 */
const PreJoinBox = memo(function PreJoinBox({ username, onJoin, onError }: { username: string; onJoin: (c: LocalUserChoices) => void; onError: (e: Error) => void }) {
  const defaults = useMemo(() => ({ username }), [username]);
  return <PreJoin defaults={defaults} persistUserChoices={false} joinLabel="Enter my booth" userLabel="Your name" onSubmit={onJoin} onError={onError} />;
});

export default function Booth({ id }: { id: string }) {
  const g = useMemo(() => new URLSearchParams(window.location.search).get("g") ?? "", []);
  const info = useQuery<Info>({ queryKey: ["/api/booth", id, g], queryFn: async () => (await apiRequest("GET", `/api/booth/${id}${g ? `?g=${encodeURIComponent(g)}` : ""}`)).json(), retry: false });
  const [conn, setConn] = useState<{ url: string; token: string } | null>(null);
  const [choices, setChoices] = useState<LocalUserChoices | null>(null);
  const [error, setError] = useState("");
  const [left, setLeft] = useState(false);
  const now = useNow();
  // An admin can preview any moment: ?at=2026-11-16T21:03:00Z plays the clock as if it were then.
  const previewShift = useMemo(() => { const at = Date.parse(new URLSearchParams(window.location.search).get("at") ?? ""); return Number.isFinite(at) ? at - Date.now() : 0; }, []);

  const join = useCallback(async (c: LocalUserChoices) => {
    setError("");
    try {
      const r = await apiRequest("POST", `/api/booth/${id}/token`, { name: c.username, g: g || undefined });
      setChoices(c);
      setConn(await r.json());
    } catch (e) { setError(say(e)); }
  }, [id, g]);
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
        <p className="text-2xl font-bold">Your MilitaryVoices Radio booth</p>
        <p className="max-w-md text-center text-white/75">{say(info.error)}</p>
        <a href="/host/dashboard" className="rounded-full bg-white px-5 py-2.5 font-semibold text-[#000741]">Sign in</a>
      </div>
    );
  }
  const d = info.data;
  // A show ended early: the clock moves on to the outro now.
  const eff: Info = d.endedAtUtc && Date.parse(d.endedAtUtc) < Date.parse(d.offAirAtUtc) ? { ...d, offAirAtUtc: d.endedAtUtc, endAtUtc: new Date(Math.min(Date.parse(d.endAtUtc), Date.parse(d.endedAtUtc) + 45_000)).toISOString() } : d;
  const endShow = async () => {
    try { await apiRequest("POST", `/api/booth/${id}/end`, { g: g || undefined }); await info.refetch(); } catch (e) { setError(say(e)); }
  };
  if (left) {
    return (
      <div className={shell}>
        <p className="text-2xl font-bold">You've left the booth</p>
        {now < Date.parse(d.closesAtUtc) && <button type="button" onClick={() => { setLeft(false); setConn(null); }} className="rounded-full bg-white px-5 py-2.5 font-semibold text-[#000741]">Go back in</button>}
      </div>
    );
  }
  const header = (
    <div className="text-center">
      <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#F0A71F]">MilitaryVoices Radio</p>
      <h1 className="mt-1 text-2xl font-bold [text-wrap:balance]">{d.show}</h1>
      <p className="mt-1 text-sm text-white/70">{d.day.replace(/^MilitaryVoices Radio · /, "")} · {hm(d.startAtUtc)}–{hm(d.endAtUtc)} ET · live {hm(d.onAirAtUtc)}–{hm(d.offAirAtUtc)}</p>
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
            <p className="text-lg font-semibold">Your booth opens at {hm(d.opensAtUtc)} ET</p>
            <p className="mt-1 text-sm text-white/70">An hour before your time. Come back then to check your camera and mic.</p>
            {d.role === "host" && <div className="mt-4"><p className="mb-2 text-xs text-white/60">Bringing a guest? Send them this link:</p><GuestLink link={d.guestLink} /></div>}
          </div>
        ) : (
          <div className="w-full max-w-xl" data-testid="booth-prejoin">
            <PreJoinBox username={d.role === "host" ? d.host : ""} onJoin={onJoin} onError={onPreJoinError} />
          </div>
        )}
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
        <p className="text-sm font-semibold">{d.show} <span className="font-normal text-white/60">· you see and hear only your own booth</span></p>
        {d.role === "host" && <GuestLink link={d.guestLink} />}
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row-reverse">
        <Rail info={eff} shift={d.anytime ? previewShift : 0} onEnd={d.role === "host" || d.role === "admin" ? endShow : undefined} />
        <div className="min-h-0 flex-1"><BookingStage signupId={d.signupId} /></div>
      </div>
      <ControlBar controls={CONTROLS} />
    </LiveKitRoom>
  );
}
