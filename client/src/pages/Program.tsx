import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StageGrid, useStageRoom, type StageTile } from "@/components/StageView";

// MilitaryVoices Radio on air: what the broadcast films all day.
//
// No producer and no scenes. The clock reads the day's bookings (from
// /api/booth/program) and decides: the station's intro card for the first
// three minutes of a booking, that booking's people live (only their sound
// and pictures; everyone else in the room is waiting), the outro card for the
// last three, and filler when nobody is booked.
//
// Same contract as StudioComposite with LiveKit's recorder: START_RECORDING
// once ready to be filmed. ?eventId=N without a token previews the cards;
// add &at=<ISO time> to see any moment of the day.

type Booking = { id: number; show: string; host: string; photo: string; about?: string; mediaUrl?: string; startAtUtc: string; endAtUtc: string; onAirAtUtc: string; offAirAtUtc: string };
type Replay_ = { id: number; show: string; host: string; photo: string; mediaUrl: string; durationSec: number };
type VoiceInfo = { welcomeUrl: string; welcomeSec: number; signoffUrl: string; signoffSec: number; bedUrl?: string };
type Program = { eventId: number; day: string; startAtUtc: string; endAtUtc: string; fillerUrl: string; voice?: VoiceInfo; dayIndex?: number; replays?: Replay_[]; bookings: Booking[] };

const ET = "America/New_York";
const hm = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
function roomFromToken(token: string | null): string {
  try { return token ? (JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { video?: { room?: string } }).video?.room ?? "" : ""; } catch { return ""; }
}

function Face({ photo, size = 220 }: { photo: string; size?: number }) {
  return photo
    ? <img src={photo} alt="" className="rounded-full object-cover shadow-2xl ring-8 ring-[#F0A71F]/80" style={{ width: size, height: size }} />
    : <div className="rounded-full bg-white/10 ring-8 ring-[#F0A71F]/60" style={{ width: size, height: size }} />;
}

function Card({ eyebrow, title, sub, photo, foot }: { eyebrow: string; title: string; sub?: string; photo?: string; foot?: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(ellipse_at_top,#0a2a6b_0%,#000741_60%)] px-24 text-white">
      <div className="flex items-center gap-16">
        {photo !== undefined && <Face photo={photo} />}
        <div className="max-w-[1000px]">
          <p className="text-2xl font-extrabold uppercase tracking-[0.22em] text-[#F0A71F]">{eyebrow}</p>
          <p className="mt-4 text-7xl font-black leading-[1.05] [text-wrap:balance]">{title}</p>
          {sub && <p className="mt-5 text-4xl font-semibold text-white/85 [text-wrap:balance]">{sub}</p>}
          {foot && <p className="mt-10 text-3xl font-bold text-[#F0A71F]">{foot}</p>}
        </div>
      </div>
      <p className="absolute bottom-10 left-24 text-xl font-bold uppercase tracking-[0.18em] text-white/60">MilitaryVoices Radio · Live From Anywhere · M–F 7 am – 10 pm ET</p>
    </div>
  );
}

/** Music for any stretch that would be silent: never dead air. Loops, and stays under the station's voice. */
function Bed({ src, muted, duck }: { src: string; muted: boolean; duck?: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => { const a = ref.current; if (a) { a.muted = muted; a.volume = duck ? 0.1 : 0.45; if (!muted) a.play().catch(() => undefined); } }, [muted, duck]);
  if (!src) return null;
  return <audio ref={ref} src={src} autoPlay loop muted={muted} />;
}

/**
 * A recorded episode rolling in its slot, or a replay in open time: the file plays from wherever the
 * clock is (so every listener hears the same moment), and when it ends the thank-you card takes over
 * until the slot closes.
 */
function Replay({ id, src, show, host, photo, startedAt, now, muted, tag, duck, bedUrl }: { id: string; src: string; show: string; host: string; photo: string; startedAt: number; now: number; muted: boolean; tag?: string; duck?: boolean; bedUrl?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ended, setEnded] = useState(false);
  const offset = Math.max(0, (now - startedAt) / 1000);
  const place = () => { const v = ref.current; if (v && Math.abs(v.currentTime - offset) > 2) v.currentTime = offset; };
  useEffect(() => { setEnded(false); }, [id]);
  // React sets `muted` only when the element is made, so a listener's tap has to reach the element itself.
  useEffect(() => { const v = ref.current; if (v) { v.muted = muted; if (!muted) v.play().catch(() => undefined); } }, [muted, ended]);
  // The station's voice talks over it: turn it down while she does.
  useEffect(() => { const v = ref.current; if (v) v.volume = duck ? 0.12 : 1; }, [duck, ended]);
  if (ended) return <><Card eyebrow="Thank you for listening" title={show} sub={host ? `with ${host}` : undefined} photo={photo} /><Bed src={bedUrl ?? ""} muted={muted} duck={duck} /></>;
  return (
    <>
      <video ref={ref} src={src} autoPlay playsInline muted={muted} onLoadedMetadata={place} onEnded={() => setEnded(true)} className="absolute inset-0 h-full w-full bg-black object-contain" />
      <div className="absolute bottom-8 left-8 rounded-2xl bg-[#000741]/85 px-7 py-4 text-3xl font-bold text-white">{tag ? `${tag} · ` : ""}{show}{host ? ` · with ${host}` : ""}</div>
      {/* The Marathon's own picture has a red LIVE badge in this corner. An encore is not live: cover it and say so. */}
      <div className="pointer-events-none absolute left-[1%] top-[2%] flex h-[6.8%] w-[9.8%] items-center justify-center rounded-full bg-[#0b1d4a] font-black uppercase tracking-[0.16em] text-white ring-1 ring-white/30 [font-size:1.1cqw]" data-testid="encore-tag">Encore</div>
    </>
  );
}

/** A clip the host is showing from their booth: full screen over the show, with its sound, joined from wherever it has got to. */
function ClipOverlay({ clip, now, muted, host }: { clip: { url: string; startedAtMs: number; durationSec: number }; now: number; muted: boolean; host: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ended, setEnded] = useState(false);
  if (ended) return null;
  return (
    <div className="absolute inset-0 z-20 bg-black">
      <video ref={ref} src={clip.url} autoPlay playsInline muted={muted} onLoadedMetadata={() => { const v = ref.current; if (v) { const at = Math.max(0, (now - clip.startedAtMs) / 1000); if (at > 1 && at < (v.duration || Infinity)) v.currentTime = at; } }} onEnded={() => setEnded(true)} className="h-full w-full object-contain" />
      <span className="absolute left-4 top-4 rounded-full bg-black/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">A clip from {host}</span>
    </div>
  );
}

/** The station's voice (Alex, with a little music under her): a clip that starts at a given moment and is joined from wherever the clock is. */
function Voice({ src, startedAt, now, muted }: { src: string; startedAt: number; now: number; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  const place = () => { const a = ref.current; const off = Math.max(0, (now - startedAt) / 1000); if (a && off < (a.duration || 1e9) && Math.abs(a.currentTime - off) > 1.5) a.currentTime = off; };
  useEffect(() => { const a = ref.current; if (a) { a.muted = muted; if (!muted) a.play().catch(() => undefined); } }, [muted]);
  return <audio ref={ref} src={src} autoPlay muted={muted} onLoadedMetadata={place} />;
}


/**
 * The host is on air with the camera off: an On Air badge, a sound bar that moves with their voice, and who they are
 * (the show, the host and their title, and what the show is about). Sits over the stage, which stays mounted
 * underneath because it is what plays the voices.
 */
function AudioOnAir({ tiles, show, host, photo, about, demo = false }: { tiles: StageTile[]; show: string; host: string; photo: string; about?: string; demo?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tracks = useMemo(() => tiles.map((t) => t.audio?.mediaStreamTrack).filter((t): t is MediaStreamTrack => !!t), [tiles]);
  useEffect(() => {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const an = ctx.createAnalyser();
    an.fftSize = 256; an.smoothingTimeConstant = 0.8;
    // Listened to, never played: the stage's own tiles are what the audience hears.
    const srcs = tracks.map((t) => { const s = ctx.createMediaStreamSource(new MediaStream([t])); s.connect(an); return s; });
    const data = new Uint8Array(an.frequencyBinCount);
    const BARS = 48;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current; const g = c?.getContext("2d");
      if (!c || !g) return;
      an.getByteFrequencyData(data);
      // A preview with no room: a made-up voice, so the bar can be seen moving.
      if (demo) { const t = performance.now() / 1000; for (let i = 0; i < data.length; i++) data[i] = Math.max(0, 140 + 100 * Math.sin(t * 5 + i * 0.35) * Math.sin(t * 1.7 + i * 0.1) - i * 1.4); }
      g.clearRect(0, 0, c.width, c.height);
      const slot = c.width / BARS, w = slot * 0.62;
      for (let i = 0; i < BARS; i++) {
        // Voice lives in the low bins: use the first 70 % of them, mirrored so it grows from the middle.
        const k = Math.floor((Math.abs(i - BARS / 2) / (BARS / 2)) * data.length * 0.7);
        const v = data[Math.min(k, data.length - 1)] / 255;
        const h = Math.max(10, v * c.height * 0.95);
        g.fillStyle = i % 2 ? "#F0A71F" : "#ffd36b";
        g.fillRect(i * slot + (slot - w) / 2, (c.height - h) / 2, w, h);
      }
    };
    draw();
    return () => { cancelAnimationFrame(raf); srcs.forEach((s) => { try { s.disconnect(); } catch { /* gone */ } }); void ctx.close().catch(() => undefined); };
  }, [tracks]);
  const title = tiles.find((t) => t.displayTitle)?.displayTitle ?? "";
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-start justify-center bg-[radial-gradient(ellipse_at_top,#0a2a6b_0%,#000741_60%)] px-24 text-white" data-testid="radio-audio-only">
      <div className="flex items-center gap-16">
        <Face photo={photo || tiles.find((t) => t.photoUrl)?.photoUrl || ""} size={300} />
        <div className="max-w-[1100px]">
          <p className="inline-flex items-center gap-4 rounded-full bg-[#ED1C24] px-8 py-3 text-4xl font-black uppercase tracking-[0.2em] shadow-[0_0_40px_rgba(237,28,36,0.55)]">
            <span className="h-5 w-5 animate-pulse rounded-full bg-white" />On air
          </p>
          <p className="mt-6 text-7xl font-black leading-[1.05] [text-wrap:balance]">{show}</p>
          <p className="mt-4 text-4xl font-semibold text-white/90">with {host}{title ? <span className="text-[#F0A71F]"> · {title}</span> : null}</p>
          {about && <p className="mt-5 line-clamp-3 text-3xl font-medium leading-snug text-white/75 [text-wrap:pretty]">{about}</p>}
        </div>
      </div>
      <canvas ref={canvas} width={1000} height={150} className="mt-12 h-[150px] w-[1000px] max-w-full" aria-hidden />
      <p className="absolute bottom-10 left-24 text-xl font-bold uppercase tracking-[0.18em] text-white/60">MilitaryVoices Radio · M–F 7 am – 10 pm ET</p>
    </div>
  );
}

export default function Program() {
  (window as unknown as { __mvBroadcast?: boolean }).__mvBroadcast = true;
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  // ?listen=1: a listener's copy (the /radio page embeds it). It asks for its own pass, and stays muted until a tap.
  const listen = params.get("listen") === "1";
  const pass = useQuery<{ url: string; token: string; eventId: number }>({
    queryKey: ["/api/radio/token"], enabled: listen, staleTime: Infinity, retry: false,
    queryFn: async () => (await fetch("/api/radio/token", { method: "POST" })).json(),
  });
  const [muted, setMuted] = useState(listen);
  // The first tap starts the sound (browsers need one); after that the listener has a mute button of their own.
  const [tapped, setTapped] = useState(!listen);
  const url = listen ? pass.data?.url ?? null : params.get("url");
  const token = listen ? pass.data?.token ?? null : params.get("token");
  const room = roomFromToken(token);
  const eventId = listen ? String(pass.data?.eventId ?? "") : params.get("eventId");
  const program = useQuery<Program>({
    queryKey: ["/api/booth/program", room, eventId],
    queryFn: async () => (await fetch(`/api/booth/program?${room ? `room=${encodeURIComponent(room)}` : `eventId=${eventId ?? ""}`}`)).json(),
    refetchInterval: 10_000,
  });

  // Preview only (no recorder token): ?at=2026-10-26T13:01:00Z plays the day as if it were then.
  const shift = useMemo(() => { const at = Date.parse(params.get("at") ?? ""); return !token && !listen && Number.isFinite(at) ? at - Date.now() : 0; }, [params, token, listen]);
  const [now, setNow] = useState(Date.now() + shift);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() + shift), 500); return () => clearInterval(t); }, [shift]);

  const bookings = program.data?.bookings ?? [];
  const current = bookings.find((b) => now >= Date.parse(b.startAtUtc) && now < Date.parse(b.endAtUtc));
  const next = bookings.find((b) => Date.parse(b.startAtUtc) > now && b.id !== current?.id);
  const phase: "intro" | "live" | "outro" | "filler" = !current ? "filler" : now < Date.parse(current.onAirAtUtc) ? "intro" : now < Date.parse(current.offAirAtUtc) ? "live" : "outro";
  // A clip the host is showing from their booth: looked for every two seconds while they are on air.
  const clipQ = useQuery<{ clip: { url: string; startedAtMs: number; durationSec: number } | null }>({
    queryKey: ["/api/booth/clip-state", current?.id],
    queryFn: async () => (await fetch(`/api/booth/${current!.id}/clip-state`)).json(),
    enabled: phase === "live" && !!current && !current.mediaUrl,
    refetchInterval: 2000,
  });
  const clip = clipQ.data?.clip ?? null;

  // Only the booking on the clock is on air, and only while it's live.
  const onAir = phase === "live" ? current!.id : -1;
  const { tiles, connected, failed, caption } = useStageRoom(url, token, muted, undefined, !listen, (a) => Number(a.signupId) === onAir, String(onAir));

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    if (listen) return;
    if ((connected || failed || !token) && program.data) {
      started.current = true;
      console.log("START_RECORDING");
    }
  }, [connected, failed, token, program.data]);

  // Open time: the day's replays, one per half hour, the same one for every listener.
  const fill = useMemo(() => {
    const list = (program.data?.replays ?? []).filter((r) => r.mediaUrl);
    const dayStart = Date.parse(program.data?.startAtUtc ?? "");
    if (phase !== "filler" || !list.length || !Number.isFinite(dayStart) || now < dayStart) return null;
    const slot = Math.floor((now - dayStart) / 1_800_000);
    const g = (program.data?.dayIndex ?? 0) * 30 + slot;
    // A show that ended early inside this slot: the replay starts when its outro is done, not from the half hour.
    const slotStart = dayStart + slot * 1_800_000;
    const lastEnd = Math.max(0, ...bookings.map((b) => Date.parse(b.endAtUtc)).filter((e) => e > slotStart && e <= now));
    return { r: list[g % list.length], slot, startedAt: Math.max(slotStart, lastEnd) };
  }, [program.data, phase, Math.floor(now / 60_000)]);

  // The day's spoken welcome at go-time (a booking's intro waits for it) and the sign-off that ends the day.
  const voice = program.data?.voice;
  const dayStart = Date.parse(program.data?.startAtUtc ?? "");
  const dayEnd = Date.parse(program.data?.endAtUtc ?? "");
  const welcomeMs = voice?.welcomeUrl ? (voice.welcomeSec + 1) * 1000 : 0;
  const welcomeOn = !!voice?.welcomeUrl && Number.isFinite(dayStart) && now >= dayStart && now < dayStart + welcomeMs;
  const signoffAt = dayEnd - ((voice?.signoffSec ?? 0) + 1) * 1000;
  const signoffOn = !!voice?.signoffUrl && Number.isFinite(dayEnd) && now >= signoffAt && now < dayEnd;
  const introAt = current ? Date.parse(current.startAtUtc) + (Date.parse(current.startAtUtc) === dayStart ? welcomeMs : 0) : 0;

  // Everyone on air has their camera off: audio only, with a sound bar and who they are.
  const audioOnly = phase === "live" && !current!.mediaUrl && tiles.length > 0 && tiles.every((t) => !t.video);
  // Not at the first instant: a camera that is on takes a second or two to arrive, and must not flash the audio card.
  const [audioOnlyOk, setAudioOnlyOk] = useState(false);
  useEffect(() => { if (!audioOnly) { setAudioOnlyOk(false); return; } const t = setTimeout(() => setAudioOnlyOk(true), 2500); return () => clearTimeout(t); }, [audioOnly]);
  const demoAudio = !token && !listen && params.get("demo") === "audio" && !!current;
  const nextLine = next ? `Up next at ${hm(next.startAtUtc)}: ${next.show}` : "Back weekdays at 7 am Eastern";
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#000741] [container-type:size]">
      {phase === "live" && !current!.mediaUrl && tiles.length > 0 && <StageGrid tiles={tiles} meta={{ status: "Live" }} caption={caption} />}
      {phase === "live" && clip && now >= clip.startedAtMs && now < clip.startedAtMs + clip.durationSec * 1000 && <ClipOverlay key={clip.startedAtMs} clip={clip} now={now} muted={muted} host={current!.host} />}
      {audioOnlyOk && <AudioOnAir tiles={tiles} show={current!.show} host={current!.host} photo={current!.photo} about={current!.about} />}
      {demoAudio && <AudioOnAir demo tiles={[]} show={current!.show} host={current!.host} photo={current!.photo} about={current!.about || "Veterans, service members and their families, telling their own stories."} />}
      {phase === "live" && current!.mediaUrl && <Replay id={`b${current!.id}`} src={current!.mediaUrl} show={current!.show} host={current!.host} photo={current!.photo} startedAt={Date.parse(current!.onAirAtUtc)} now={now} muted={muted} bedUrl={voice?.bedUrl} />}
      {phase === "live" && !current!.mediaUrl && tiles.length === 0 && <><Card eyebrow="Live now" title={current!.show} sub={`with ${current!.host}`} photo={current!.photo} foot="Joining in a moment" /><Bed src={voice?.bedUrl ?? ""} muted={muted} /></>}
      {phase === "intro" && now >= introAt && <Voice key={`i${current!.id}`} src={`/api/radio/voice/${current!.id}/intro.mp3`} startedAt={Date.parse(current!.startAtUtc)} now={now} muted={muted} />}
      {phase === "outro" && <Voice key={`o${current!.id}`} src={`/api/radio/voice/${current!.id}/outro.mp3`} startedAt={Date.parse(current!.offAirAtUtc)} now={now} muted={muted} />}
      {welcomeOn && <Voice key="welcome" src={voice!.welcomeUrl} startedAt={dayStart} now={now} muted={muted} />}
      {signoffOn && <Voice key="signoff" src={voice!.signoffUrl} startedAt={signoffAt} now={now} muted={muted} />}
      {phase === "intro" && <Card eyebrow="Coming up" title={current!.show} sub={`with ${current!.host}`} photo={current!.photo} foot={`${current!.mediaUrl ? "Starts" : "Live"} in ${mmss(Date.parse(current!.onAirAtUtc) - now)}`} />}
      {phase === "outro" && <Card eyebrow="Thank you" title={current!.host} sub={current!.show} photo={current!.photo} foot={nextLine} />}
      {phase === "filler" && fill && <Replay id={`f${fill.slot}`} src={fill.r.mediaUrl} show={fill.r.show} host={fill.r.host} photo={fill.r.photo} startedAt={fill.startedAt} now={now} muted={muted} tag="Replay" duck={welcomeOn || signoffOn} bedUrl={voice?.bedUrl} />}
      {phase === "filler" && !fill && (program.data?.fillerUrl
        ? <>
            <video src={program.data.fillerUrl} autoPlay loop playsInline muted={muted} className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute bottom-8 left-8 rounded-2xl bg-[#000741]/85 px-7 py-4 text-3xl font-bold text-white">{nextLine}</div>
          </>
        : <Card eyebrow="MilitaryVoices Radio" title="Live From Anywhere" sub={nextLine} />)}

      {next && phase !== "intro" && (
        <div className="pointer-events-none absolute bottom-10 right-10 z-10 max-w-[900px] rounded-3xl bg-[#000741]/85 px-9 py-5 text-white shadow-2xl ring-1 ring-white/20" data-testid="radio-up-next" style={listen && tapped ? { bottom: "11rem" } : undefined}>
          <p className="text-2xl font-extrabold uppercase tracking-[0.2em] text-[#F0A71F]">Up next · {hm(next.startAtUtc)} ET</p>
          <p className="mt-1 truncate text-5xl font-bold">{next.show}</p>
          {next.host && next.host !== next.show && <p className="truncate text-3xl text-white/80">with {next.host}</p>}
        </div>
      )}
      <img src="/logo-wave.png?v=2" alt="" className="pointer-events-none absolute right-6 top-5 h-10 w-auto opacity-90 drop-shadow-lg" />
      {listen && tapped && (
        <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"} className={`absolute bottom-10 right-10 z-30 flex items-center gap-5 rounded-full px-12 py-7 text-6xl font-black shadow-2xl ${muted ? "bg-[#F0A71F] text-[#1a1200]" : "bg-[#000741]/85 text-white ring-4 ring-white/40"}`} data-testid="radio-mute">
          <span aria-hidden>{muted ? "🔇" : "🔊"}</span>{muted ? "Unmute" : "Mute"}
        </button>
      )}
      {listen && !tapped && (
        <button type="button" onClick={() => { setTapped(true); setMuted(false); }} className="absolute inset-0 z-20 flex items-center justify-center bg-black/30" data-testid="radio-tap-to-listen">
          <span className="flex items-center gap-8 rounded-full bg-[#F0A71F] px-28 py-16 text-[8rem] font-black leading-none text-[#1a1200] shadow-2xl">▶ Tap to listen</span>
        </button>
      )}
      {phase === "live" && !current!.mediaUrl && !audioOnlyOk && (
        <div className="pointer-events-none absolute left-6 top-5 flex items-center gap-2 rounded-full bg-[#ED1C24] px-4 py-1.5">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
          <span className="text-sm font-bold uppercase tracking-[0.14em] text-white">Live</span>
        </div>
      )}
    </div>
  );
}
