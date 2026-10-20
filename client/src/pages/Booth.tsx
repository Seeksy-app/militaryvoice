import "@livekit/components-styles";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ControlBar, GridLayout, LiveKitRoom, ParticipantTile, PreJoin, RoomAudioRenderer, useRemoteParticipants, useRoomContext, useTracks, type LocalUserChoices } from "@livekit/components-react";
import { RoomEvent, Track, type RemoteParticipant } from "livekit-client";
import { Check, Copy, Radio } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

// The Digital Experience booth: one booking's own simple studio. Check the
// camera and mic, wait with a countdown, go on air on the clock, see the time
// left. The day's room is shared with every booking, so this page only shows
// and plays the people on this booking (their signupId attribute); the
// station's intro and outro play on air around them (see Program.tsx).

type Info = { signupId: number; role: "host" | "guest" | "admin"; show: string; host: string; day: string; startAtUtc: string; endAtUtc: string; onAirAtUtc: string; offAirAtUtc: string; opensAtUtc: string; closesAtUtc: string; guestLink: string; ready: boolean };

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

/** Where they are against the clock, in words they can act on. */
function Status({ info }: { info: Info }) {
  const now = useNow();
  const on = Date.parse(info.onAirAtUtc), off = Date.parse(info.offAirAtUtc), start = Date.parse(info.startAtUtc), end = Date.parse(info.endAtUtc);
  const left = off - now;
  let tone = "bg-white/10 text-white", big = "", small = "";
  if (now < start) { big = `On air in ${mmss(on - now)}`; small = `The station's intro starts at ${hm(info.startAtUtc)} ET, then you're live at ${hm(info.onAirAtUtc)}.`; }
  else if (now < on) { tone = "bg-[#F0A71F] text-[#1a1200]"; big = `Intro playing · live in ${mmss(on - now)}`; small = "Get ready: you're next."; }
  else if (now < off) {
    tone = left <= 30_000 ? "bg-white text-[#ED1C24]" : "bg-[#ED1C24] text-white";
    big = `ON AIR · ${mmss(left)} left`;
    small = left <= 30_000 ? "Say goodbye now: the outro is about to play." : left <= 120_000 ? "Two minutes: start wrapping up." : left <= 300_000 ? "Five minutes left." : `You're live until ${hm(info.offAirAtUtc)} ET.`;
  }
  else if (now < end) { tone = "bg-[#053877] text-white"; big = "Outro playing · thank you!"; small = "You're off air. Stay as long as you like, or leave below."; }
  else { big = "That's a wrap. Thank you!"; small = "You can close this tab."; }
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 px-5 py-3 ${tone}`} data-testid="booth-status">
      <p className="flex items-center gap-2 text-xl font-black tracking-tight sm:text-2xl">{now >= on && now < off && <Radio className="h-6 w-6 animate-pulse" />}{big}</p>
      <p className="text-sm font-semibold opacity-90">{small}</p>
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

export default function Booth({ id }: { id: string }) {
  const g = useMemo(() => new URLSearchParams(window.location.search).get("g") ?? "", []);
  const info = useQuery<Info>({ queryKey: ["/api/booth", id, g], queryFn: async () => (await apiRequest("GET", `/api/booth/${id}${g ? `?g=${encodeURIComponent(g)}` : ""}`)).json(), retry: false });
  const [conn, setConn] = useState<{ url: string; token: string } | null>(null);
  const [choices, setChoices] = useState<LocalUserChoices | null>(null);
  const [error, setError] = useState("");
  const [left, setLeft] = useState(false);
  const now = useNow();

  const join = async (c: LocalUserChoices) => {
    setError("");
    try {
      const r = await apiRequest("POST", `/api/booth/${id}/token`, { name: c.username, g: g || undefined });
      setChoices(c);
      setConn(await r.json());
    } catch (e) { setError(say(e)); }
  };

  const shell = "flex min-h-screen flex-col items-center justify-center gap-5 bg-[#000741] p-4 text-white";
  if (info.isLoading) return <div className={shell} />;
  if (!info.data) {
    return (
      <div className={shell}>
        <p className="text-2xl font-bold">Your Digital Experience booth</p>
        <p className="max-w-md text-center text-white/75">{say(info.error)}</p>
        <a href="/host/dashboard" className="rounded-full bg-white px-5 py-2.5 font-semibold text-[#000741]">Sign in</a>
      </div>
    );
  }
  const d = info.data;
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
      <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#F0A71F]">MilitaryVoices Digital Experience</p>
      <h1 className="mt-1 text-2xl font-bold [text-wrap:balance]">{d.show}</h1>
      <p className="mt-1 text-sm text-white/70">{d.day.replace(/^MilitaryVoices Digital Experience · /, "")} · {hm(d.startAtUtc)}–{hm(d.endAtUtc)} ET · live {hm(d.onAirAtUtc)}–{hm(d.offAirAtUtc)}</p>
    </div>
  );

  if (!conn) {
    // On a developer's machine the booth opens any time, to try it (the server agrees).
    const early = now < Date.parse(d.opensAtUtc) && d.role !== "admin" && window.location.hostname !== "localhost";
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
            <PreJoin defaults={{ username: d.role === "host" ? d.host : "" }} persistUserChoices={false} joinLabel="Enter my booth" userLabel="Your name" onSubmit={(c) => void join(c)} onError={(e) => setError(/permission/i.test(e.message) ? "Allow your camera and microphone for this site (the icon in the address bar), then reload." : e.message)} />
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
      connectOptions={{ autoSubscribe: false }}
      video={choices?.videoEnabled ? { deviceId: choices.videoDeviceId } : false}
      audio={choices?.audioEnabled ? { deviceId: choices.audioDeviceId } : false}
      onDisconnected={() => setLeft(true)}
      style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "#000741" }}
    >
      <Status info={d} />
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 text-white">
        <p className="text-sm font-semibold">{d.show} <span className="font-normal text-white/60">· you see and hear only your own booth</span></p>
        {d.role === "host" && <GuestLink link={d.guestLink} />}
      </div>
      <div className="min-h-0 flex-1"><BookingStage signupId={d.signupId} /></div>
      <ControlBar controls={{ microphone: true, camera: true, screenShare: false, chat: false, leave: true }} />
    </LiveKitRoom>
  );
}
