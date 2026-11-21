import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LiveKitRoom, RoomAudioRenderer, VideoTrack, isTrackReference, useChat, useConnectionState, useIsSpeaking,
  useLocalParticipant, useMediaDeviceSelect, useParticipantAttribute, useParticipants, useRoomContext, useRoomInfo, useSpeakingParticipants, useTracks,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { ConnectionState, Track, type Participant } from "livekit-client";
import {
  ArrowLeft, Check, Circle, Copy, ExternalLink, Loader2, LogOut, MessageSquare, Mic, MicOff, MonitorUp, NotebookPen,
  Palette, Plus, Settings, Square, UserPlus, Users, Video, VideoOff, X, Youtube,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BACKGROUNDS, bgCss, sceneLive, useRoomKit, type RoomKit, type Scene } from "@/components/room/look";
import { LayoutPicker, ScenesPanel } from "@/components/room/ScenesPanel";
import { LookPanel } from "@/components/room/LookPanel";
import { MarkClip } from "@/components/room/MarkClip";
import { RoomStage } from "@/components/RoomStage";

/** The room is light in both themes, so always the light logo file. */
const Logo = ({ className }: { className: string }) => <img src="/logo-lockup.png?v=4" alt="MilitaryVoices.ai" className={`w-auto ${className}`} />;

/**
 * Your room (phase 1 of the Restream-style studio, 20 Nov 2026). Set up first:
 * your picture, your mic, your name. Going in starts nothing. Inside: the stage,
 * layouts, the people strip, a labeled control bar, and a side panel with
 * People, Notes, Recording and Chat. Go live opens a sheet: your Library is
 * always on, plus YouTube and any streaming key.
 *
 * Phase 2 (20 Nov, mockup v8): scenes on the left, "Your look" on the right, and the stage
 * follows the scene on air. It switches on by itself when the server sends `look` (Podcasting's
 * API); until then the room stays phase 1, a plain grid like the recording, with no layout picker
 * (Andrew: "go, hide layouts").
 */
type Studio = { you?: string; id: number; name: string; inviteLink: string; recording: { since: string } | null; live: { since: string; watchUrl: string } | null; youtube: boolean; youtubeOn: boolean; streams: { id: string; name: string; on: boolean }[]; ready: boolean; canRecord: boolean };
type Conn = { url: string; token: string; name: string };
type Setup = { name: string; title: string; mic: boolean; cam: boolean; micId?: string; camId?: string };
type Tab = "look" | "people" | "notes" | "recording" | "chat";

const NAVY = "#053877";
/** Mark a clip stays hidden until Podcasting's POST /api/host/my-studio/mark is on main. */
const MARK_CLIP = true;
/** The approved mockup (v8) is set in Inter; the rest of the site isn't, so the room loads it itself. */
const INTER = "'Inter', 'General Sans', system-ui, sans-serif";
function useInter() {
  useEffect(() => {
    if (document.getElementById("font-inter")) return;
    const l = document.createElement("link");
    l.id = "font-inter";
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap";
    document.head.appendChild(l);
  }, []);
}
const say = (e: unknown) => ((e as Error).message ?? "").replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "") || "Try again in a moment.";
const clock = (since: string, now: number) => { const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s % 60).padStart(2, "0")}`; };
const initials = (n: string) => n.trim().split(/\s+/).map((w) => w[0] ?? "").slice(0, 2).join("").toUpperCase() || "?";
const today = () => new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
const useNow = () => { const [now, setNow] = useState(Date.now()); useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []); return now; };

export default function MyStudio({ invite }: { invite?: string }) {
  const owner = !invite;
  useInter();
  const [conn, setConn] = useState<Conn | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [left, setLeft] = useState(false);
  const guestInfo = useQuery<{ name: string }>({ queryKey: ["/api/my-studio/invite", invite], enabled: !owner, queryFn: async () => (await apiRequest("GET", `/api/my-studio/invite/${invite}`)).json(), retry: false });
  const studio = useQuery<Studio>({ queryKey: ["/api/host/my-studio"], enabled: owner, queryFn: async () => (await apiRequest("GET", "/api/host/my-studio")).json(), retry: false, refetchInterval: conn ? 8000 : false });
  const roomName = (owner ? studio.data?.name : guestInfo.data?.name) || "";

  if (left) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#f3f4f7] p-6 text-center text-[#101828]">
        <Logo className="h-12" />
        <p className="mt-4 text-2xl font-bold">{owner ? "You've left your studio" : "Thanks for joining"}</p>
        {owner ? (
          <>
            <p className="max-w-md text-[#475467]">Anything you recorded is on its way to your Library, ready for clips.</p>
            <div className="flex flex-wrap justify-center gap-3">
              <button type="button" onClick={() => { setLeft(false); setConn(null); }} className="h-11 rounded-xl px-5 font-semibold text-white" style={{ background: NAVY }}>Go back in</button>
              <a href="/host/dashboard/library" className="flex h-11 items-center rounded-xl border border-[#d0d5dd] bg-white px-5 font-semibold">Open your Library</a>
            </div>
          </>
        ) : <p className="text-[#475467]">You can close this tab.</p>}
      </div>
    );
  }

  if (!conn || !setup) {
    const blocked = owner ? (studio.error ? "Sign in to open your studio." : "") : guestInfo.error ? say(guestInfo.error) : "";
    return (
      <SetupScreen
        owner={owner}
        roomName={roomName}
        blocked={blocked}
        defaultName={owner ? studio.data?.you ?? "" : ""}
        onEnter={async (s) => {
          const r = owner
            ? await apiRequest("POST", "/api/host/my-studio/token", { name: s.name })
            : await apiRequest("POST", `/api/my-studio/invite/${invite}/token`, { name: s.name });
          setConn(await r.json());
          setSetup(s);
        }}
      />
    );
  }

  return (
    <LiveKitRoom
      serverUrl={conn.url}
      token={conn.token}
      connect
      video={setup.cam ? (setup.camId ? { deviceId: setup.camId } : true) : false}
      audio={setup.mic ? (setup.micId ? { deviceId: setup.micId } : true) : false}
      onDisconnected={() => setLeft(true)}
      style={{ height: "100dvh" }}
    >
      <RoomAudioRenderer />
      <StudioFrame owner={owner} roomName={conn.name} studio={owner ? studio.data : undefined} title={setup.title} />
    </LiveKitRoom>
  );
}

/* ───────────────────────── Set up ───────────────────────── */

function SetupScreen({ owner, roomName, blocked, defaultName, onEnter }: { owner: boolean; roomName: string; blocked: string; defaultName: string; onEnter: (s: Setup) => Promise<void> }) {
  const [name, setName] = useState(defaultName);
  const [title, setTitle] = useState("");
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [micId, setMicId] = useState<string>();
  const [camId, setCamId] = useState<string>();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const [problem, setProblem] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  useEffect(() => { if (defaultName && !name) setName(defaultName); }, [defaultName]); // eslint-disable-line react-hooks/exhaustive-deps

  // The preview: their camera and mic, with a live level so they can see the mic works.
  useEffect(() => {
    let stop = false, raf = 0;
    let ctx: AudioContext | null = null;
    setLevel(0);
    if (!mic && !cam) { stream.current = null; return; }
    navigator.mediaDevices?.getUserMedia({ video: cam ? (camId ? { deviceId: { exact: camId } } : true) : false, audio: mic ? (micId ? { deviceId: { exact: micId } } : true) : false })
      .then(async (s) => {
        if (stop) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        setProblem("");
        if (video.current) video.current.srcObject = s;
        setDevices(await navigator.mediaDevices.enumerateDevices());
        if (mic && s.getAudioTracks().length) {
          ctx = new AudioContext();
          const an = ctx.createAnalyser();
          an.fftSize = 512;
          ctx.createMediaStreamSource(s).connect(an);
          const buf = new Uint8Array(an.fftSize);
          const tick = () => {
            an.getByteTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) sum += ((buf[i] - 128) / 128) ** 2;
            const l = Math.min(1, Math.sqrt(sum / buf.length) * 4);
            setLevel(l);
            if (l > 0.12) setHeard(true);
            raf = requestAnimationFrame(tick);
          };
          tick();
        }
      })
      .catch((e: Error) => {
        setProblem(e.name === "NotAllowedError" ? "Allow your camera and microphone for this site (the icon in the address bar), then reload." : e.name === "NotFoundError" ? "We can't find a camera or mic. Plug one in, or go in with them off." : "Your camera or mic is busy in another app. Close it there, then reload.");
      });
    return () => { stop = true; cancelAnimationFrame(raf); void ctx?.close(); stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  }, [mic, cam, micId, camId]);

  const cams = devices.filter((d) => d.kind === "videoinput" && d.deviceId);
  const mics = devices.filter((d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "communications");
  const enter = async () => {
    if (!name.trim()) { setError("Your name, please. It shows under your picture."); return; }
    setBusy(true); setError("");
    stream.current?.getTracks().forEach((t) => t.stop());
    try { await onEnter({ name: name.trim(), title: title.trim(), mic, cam, micId, camId }); }
    catch (e) { setError((e as { status?: number }).status === 401 ? "Sign in to open your studio." : say(e)); setBusy(false); }
  };
  const select = "h-9 min-w-0 flex-1 truncate rounded-lg border border-[#d0d5dd] bg-white px-2 text-[13px] text-[#344054]";

  return (
    <div className="min-h-screen bg-[#f3f4f7] text-[#101828]" data-testid="my-studio-setup" style={{ fontFamily: INTER }}>
      <header className="flex h-16 items-center gap-4 border-b border-[#e4e7ec] bg-white px-5">
        <Logo className="h-10" />
        {owner && <a href="/host/dashboard/studio" className="ml-auto flex items-center gap-1.5 text-sm font-semibold text-[#475467] hover:text-[#101828]"><ArrowLeft className="h-4 w-4" /> Back to your dashboard</a>}
      </header>
      {blocked ? (
        <div className="mx-auto mt-24 max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <p className="text-lg font-semibold">{blocked}</p>
          {owner && <a href="/host/dashboard/studio" className="mt-4 inline-flex h-11 items-center rounded-xl px-5 font-semibold text-white" style={{ background: NAVY }}>Sign in</a>}
        </div>
      ) : (
        <main className="mx-auto flex max-w-[1180px] flex-col gap-8 px-4 py-6 lg:flex-row lg:items-start lg:px-8 lg:py-10">
          <section className="w-full rounded-2xl bg-white p-4 shadow-[0_8px_24px_rgba(16,24,40,0.08)] lg:w-[680px] lg:shrink-0">
            <div className="relative aspect-video overflow-hidden rounded-xl bg-[#0b1f4a]">
              <video ref={video} autoPlay muted playsInline className={`h-full w-full -scale-x-100 object-cover ${cam && !problem ? "" : "invisible"}`} />
              {(!cam || problem) && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex h-28 w-28 items-center justify-center rounded-full bg-[#3a4f80] text-4xl font-bold text-white">{initials(name || "You")}</div>
                </div>
              )}
              <div className="absolute bottom-3 left-3 rounded-full bg-[rgba(5,18,48,0.78)] px-3 py-1.5 text-[13px] font-semibold text-white">{name || "Your name"}{title && <span className="font-medium text-[#9bb6e8]"> · {title}</span>}</div>
              <div className="absolute bottom-3 right-3 flex gap-2">
                <PreviewToggle on={mic} onClick={() => setMic(!mic)} label={mic ? "Turn mic off" : "Turn mic on"}>{mic ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}</PreviewToggle>
                <PreviewToggle on={cam} onClick={() => setCam(!cam)} label={cam ? "Turn camera off" : "Turn camera on"}>{cam ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}</PreviewToggle>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3 px-1">
              <Mic className="h-5 w-5 shrink-0 text-[#475467]" />
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[#eaecf0]" aria-hidden>
                <div className="h-full rounded-full bg-[#12b76a] transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
              </div>
              {!mic || problem ? <span className="rounded-full bg-[#f2f4f7] px-3 py-1 text-[13px] font-semibold text-[#475467]">{mic ? "No sound yet" : "Your mic is off"}</span>
                : heard ? <span className="flex items-center gap-1 rounded-full bg-[#d1fadf] px-3 py-1 text-[13px] font-semibold text-[#067647]" data-testid="mic-working"><Check className="h-3.5 w-3.5" /> Mic is working</span>
                  : <span className="rounded-full bg-[#f2f4f7] px-3 py-1 text-[13px] font-semibold text-[#475467]">Say something to test it</span>}
            </div>
            {(cams.length > 1 || mics.length > 1) && (
              <div className="mt-3 flex flex-col gap-2 px-1 sm:flex-row">
                {cams.length > 1 && <select aria-label="Camera" className={select} value={camId ?? ""} onChange={(e) => setCamId(e.target.value || undefined)}><option value="">Camera: default</option>{cams.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Camera"}</option>)}</select>}
                {mics.length > 1 && <select aria-label="Microphone" className={select} value={micId ?? ""} onChange={(e) => setMicId(e.target.value || undefined)}><option value="">Mic: default</option>{mics.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone"}</option>)}</select>}
              </div>
            )}
            {problem && <p className="mt-3 px-1 text-sm font-medium text-[#b42318]">{problem}</p>}
          </section>

          <section className="w-full lg:max-w-[420px] lg:pt-2">
            <p className="text-sm font-semibold uppercase tracking-[0.08em] text-[#667085]">{owner ? roomName || "Your studio" : `You're invited to ${roomName || "a show"}`}</p>
            <h1 className="mt-1 text-balance text-[28px] font-bold leading-tight tracking-tight">{owner ? "Set up your studio" : "Get ready to join"}</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-[#475467]">{owner ? "Check your picture and sound. Going in doesn't start anything; you choose when to record and when to go live." : "Check your picture and sound. The host brings you in when you join."}</p>
            <label className="mt-6 block text-sm font-semibold" htmlFor="studio-name">Your name on screen</label>
            <input id="studio-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Your name" className="mt-1.5 h-12 w-full rounded-xl border border-[#d0d5dd] bg-white px-4 text-[15px] outline-none focus:border-[#053877] focus:ring-2 focus:ring-[#053877]/15" data-testid="studio-name" />
            <label className="mt-4 block text-sm font-semibold" htmlFor="studio-title">Your title <span className="font-normal text-[#667085]">(optional)</span></label>
            <input id="studio-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} placeholder={owner ? "Host" : "e.g. Army veteran, author"} className="mt-1.5 h-12 w-full rounded-xl border border-[#d0d5dd] bg-white px-4 text-[15px] outline-none focus:border-[#053877] focus:ring-2 focus:ring-[#053877]/15" />
            <button type="button" onClick={() => void enter()} disabled={busy} className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[16px] font-bold text-white shadow-[0_4px_12px_rgba(5,56,119,0.28)] disabled:opacity-70" style={{ background: NAVY }} data-testid="studio-enter">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}{owner ? "Enter studio" : "Join"}
            </button>
            {error && <p className="mt-3 text-sm font-medium text-[#b42318]">{error}</p>}
          </section>
        </main>
      )}
    </div>
  );
}

function PreviewToggle({ on, onClick, label, children }: { on: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return <button type="button" onClick={onClick} aria-label={label} title={label} className={`flex h-11 w-11 items-center justify-center rounded-full ${on ? "bg-[rgba(5,18,48,0.7)] text-white hover:bg-[rgba(5,18,48,0.85)]" : "bg-[#d92d20] text-white"}`}>{children}</button>;
}

/* ───────────────────────── In the studio ───────────────────────── */

function StudioFrame({ owner, roomName, studio, title }: { owner: boolean; roomName: string; studio?: Studio; title: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const room = useRoomContext();
  const state = useConnectionState();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  const now = useNow();
  const [picked, setTab] = useState<Tab | null>(null);
  const [sheet, setSheet] = useState(false);
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState<"" | "rec" | "live">("");
  const hosting = useQuery<{ shows: { show: { artworkUrl?: string } }[] }>({ queryKey: ["/api/host/hosting"], enabled: owner, queryFn: async () => (await apiRequest("GET", "/api/host/hosting")).json(), staleTime: 60_000, retry: false });
  const logo = hosting.data?.shows?.find((s) => s.show.artworkUrl)?.show.artworkUrl;

  // Phase 2: the owner's saved look (Podcasting) and what's on air (Engineering, in the room's metadata).
  // With no look from the server, or for guests, the room works as in phase 1.
  const meta = useRoomInfo().metadata;
  const kit = useRoomKit(owner, meta);
  const look = kit.look;
  const editing = owner && !!look;
  const scene = sceneLive(look, kit.live);
  const tab: Tab = picked ?? (editing ? "look" : "people");

  // Once connected, put the scene on air again so the room carries it (Engineering: call /scene after joining).
  const joined = useRef(false);
  useEffect(() => {
    if (!editing || joined.current || state !== ConnectionState.Connected || !scene) return;
    joined.current = true;
    kit.toScene(scene.id, true);
  }, [editing, state, scene?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Their title from the set-up screen rides on their participant, so it shows under their name for everyone.
  useEffect(() => {
    if (state === ConnectionState.Connected && title) void localParticipant.setAttributes({ title }).catch(() => {});
  }, [state, title, localParticipant]);

  const rec = studio?.recording;
  const live = studio?.live;
  const set = (s: Studio) => qc.setQueryData(["/api/host/my-studio"], s);
  const record = async (on: boolean) => {
    setBusy("rec");
    try {
      set((await (await apiRequest("POST", "/api/host/my-studio/record", { on })).json()) as Studio);
      toast(on ? { title: "Recording to your Library" } : { title: "Recording saved", description: "It's in your Library in a minute or two, ready for clips." });
    } catch (e) { toast({ title: on ? "Couldn't start recording" : "Couldn't stop recording", description: say(e), variant: "destructive" }); }
    finally { setBusy(""); }
  };
  const endLive = async () => {
    if (!window.confirm("End the live show? The recording keeps going until you stop it.")) return;
    setBusy("live");
    try { set((await (await apiRequest("POST", "/api/host/my-studio/live", { on: false })).json()) as Studio); toast({ title: "You're off the air" }); }
    catch (e) { toast({ title: "Couldn't end the live show", description: say(e), variant: "destructive" }); }
    finally { setBusy(""); }
  };
  const copyInvite = () => {
    if (!studio?.inviteLink) return;
    void navigator.clipboard.writeText(studio.inviteLink).then(() => toast({ title: "Invite link copied", description: "Send it to your guest. They pick a name and they're in." }));
  };
  const share = async () => {
    try {
      await localParticipant.setScreenShareEnabled(!isScreenShareEnabled);
      // Starting a share puts the screen-share scene on air, if there is one.
      const s = !isScreenShareEnabled && editing ? look?.scenes.find((x) => x.layout === "screen") : undefined;
      if (s) kit.toScene(s.id);
    }
    catch (e) { if ((e as Error).name !== "NotAllowedError") toast({ title: "Couldn't share your screen", description: say(e), variant: "destructive" }); }
  };
  const leave = async () => {
    if (owner && (rec || live)) {
      if (!window.confirm(`Leaving stops the ${rec && live ? "recording and the live show" : rec ? "recording" : "live show"}. Leave now?`)) return;
      if (live) await apiRequest("POST", "/api/host/my-studio/live", { on: false }).catch(() => {});
      if (rec) await apiRequest("POST", "/api/host/my-studio/record", { on: false }).catch(() => {});
      void qc.invalidateQueries({ queryKey: ["/api/host/my-studio"] });
    }
    void room.disconnect();
  };

  return (
    <div className="flex h-[100dvh] flex-col bg-[#f3f4f7] text-[#101828]" data-testid="my-studio" style={{ fontFamily: INTER }}>
      {/* Top bar */}
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-[#e4e7ec] bg-white px-4 lg:gap-3.5 lg:px-5" data-testid="my-studio-bar">
        <Logo className="hidden h-[38px] sm:block" />
        <div className="hidden h-7 w-px bg-[#e4e7ec] sm:block" />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold tracking-tight">{roomName}</p>
          <p className="text-xs text-[#667085]">{today()} · {owner ? "Your studio" : "You're a guest"}</p>
        </div>
        {owner && studio && (
          <div className="ml-2 hidden items-center gap-2 md:flex">
            {rec ? (
              <button type="button" onClick={() => setTab("recording")} className="flex items-center gap-2 rounded-full bg-[#fef3f2] px-3.5 py-[7px] text-[13px] font-semibold tabular-nums text-[#b42318]" data-testid="badge-recording">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#d92d20]" /> Recording · {clock(rec.since, now)}
              </button>
            ) : studio.canRecord ? (
              <button type="button" onClick={() => void record(true)} disabled={busy !== ""} className="flex items-center gap-2 rounded-full border border-[#fda29b] bg-white px-3.5 py-[6px] text-[13px] font-semibold text-[#b42318] hover:bg-[#fef3f2] disabled:opacity-60" data-testid="my-studio-record">
                {busy === "rec" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Circle className="h-2.5 w-2.5 fill-current" />} Record to your Library
              </button>
            ) : null}
            {live ? (
              <span className="flex items-center gap-2 rounded-full bg-[#d92d20] px-3.5 py-[7px] text-[13px] font-bold tabular-nums text-white" data-testid="badge-live">LIVE · {clock(live.since, now)}</span>
            ) : <span className="rounded-full bg-[#f2f4f7] px-3.5 py-[7px] text-[13px] font-semibold text-[#475467]">Not live yet</span>}
          </div>
        )}
        {owner && studio && (
          <div className="ml-auto flex items-center gap-2.5">
            {MARK_CLIP && <MarkClip recording={!!rec} />}
            {live?.watchUrl && <a href={live.watchUrl} target="_blank" rel="noreferrer" className="hidden items-center gap-1 text-[13px] font-semibold text-[#053877] underline-offset-2 hover:underline lg:flex">Watch <ExternalLink className="h-3.5 w-3.5" /></a>}
            <button type="button" onClick={copyInvite} className="hidden h-[42px] items-center gap-2 rounded-xl border border-[#d0d5dd] bg-white px-4 text-sm font-semibold hover:bg-[#f9fafb] sm:flex" data-testid="my-studio-invite"><UserPlus className="h-[18px] w-[18px]" /> Invite guests</button>
            {live ? (
              <button type="button" onClick={() => void endLive()} disabled={busy !== ""} className="flex h-[42px] items-center gap-2 rounded-xl border border-[#fda29b] bg-white px-5 text-sm font-bold text-[#b42318] hover:bg-[#fef3f2] disabled:opacity-60" data-testid="my-studio-end-live">
                {busy === "live" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-3.5 w-3.5 fill-current" />} End live
              </button>
            ) : (
              <button type="button" onClick={() => setSheet(true)} className="h-[42px] rounded-xl px-6 text-sm font-bold text-white shadow-[0_4px_12px_rgba(5,56,119,0.28)]" style={{ background: NAVY }} data-testid="my-studio-live">Go live</button>
            )}
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {editing && <ScenesPanel kit={kit} />}
        {/* Stage column */}
        <div className="flex min-w-0 flex-1 flex-col items-center px-4 pt-5 lg:px-6">
          {owner ? (
            // The host sees exactly what's recorded and streamed (Engineering's RoomStage); guests keep the plain grid.
            <div className="shrink-0 rounded-2xl shadow-[0_12px_32px_rgba(16,24,40,0.22)]" style={{ width: "min(768px, 100%, calc((100dvh - 336px) * 16 / 9))" }}>
              <RoomStage muted onMediaEnded={() => kit.play(null)} />
            </div>
          ) : (
            <Stage kit={kit} scene={scene} fallbackLogo={look ? undefined : logo} />
          )}
          {editing && scene && (
            <div className="mt-3 shrink-0" title={`Layout for ${scene.name}`}>
              <LayoutPicker value={scene.layout} onPick={(layout) => kit.change((l) => ({ ...l, scenes: l.scenes.map((s) => (s.id === scene.id ? { ...s, layout } : s)) }))} />
            </div>
          )}
          <Backstage kit={kit} />
          <PeopleStrip kit={kit} owner={owner} onShare={() => void share()} onInvite={copyInvite} />
          {/* Below lg the bar sits above Ask Alex (bottom right on every page) so nothing is covered. */}
          <div className="mb-[84px] mt-auto flex items-center gap-0.5 rounded-[18px] border border-[#e4e7ec] bg-white px-1.5 py-2 shadow-[0_8px_24px_rgba(16,24,40,0.1)] sm:gap-1.5 sm:px-3 lg:mb-3" data-testid="my-studio-controls">
            <BarButton label={isMicrophoneEnabled ? "Mic" : "Muted"} off={!isMicrophoneEnabled} onClick={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}>{isMicrophoneEnabled ? <Mic className="h-[22px] w-[22px]" /> : <MicOff className="h-[22px] w-[22px]" />}</BarButton>
            <BarButton label={isCameraEnabled ? "Camera" : "Camera off"} off={!isCameraEnabled} onClick={() => void localParticipant.setCameraEnabled(!isCameraEnabled)}>{isCameraEnabled ? <Video className="h-[22px] w-[22px]" /> : <VideoOff className="h-[22px] w-[22px]" />}</BarButton>
            <BarButton label={isScreenShareEnabled ? "Stop share" : "Share"} active={isScreenShareEnabled} onClick={() => void share()}><MonitorUp className="h-[22px] w-[22px]" /></BarButton>
            {owner && <BarButton label="Invite" onClick={copyInvite}><UserPlus className="h-[22px] w-[22px]" /></BarButton>}
            {/* Notes opens a side panel, which only shows at lg and up. */}
            <BarButton label="Notes" wide active={tab === "notes"} onClick={() => setTab("notes")}><NotebookPen className="h-[22px] w-[22px]" /></BarButton>
            <BarButton label="Settings" onClick={() => setSettings(true)}><Settings className="h-[22px] w-[22px]" /></BarButton>
            <div className="mx-1 h-9 w-px bg-[#e4e7ec]" />
            <button type="button" onClick={() => void leave()} className="flex h-[58px] w-[54px] flex-col items-center justify-center gap-1 rounded-xl bg-[#fef3f2] text-[11px] font-bold text-[#b42318] hover:bg-[#fee4e2] sm:w-[76px] sm:text-xs" data-testid="my-studio-leave"><LogOut className="h-[22px] w-[22px]" />Leave</button>
          </div>
        </div>

        {/* Right panel */}
        <aside className={`hidden shrink-0 border-l border-[#e4e7ec] bg-white lg:flex ${editing ? "w-[360px] 2xl:w-[392px]" : "w-[360px]"}`}>
          <div className="flex min-w-0 flex-1 flex-col">
            {tab === "look" && editing && <LookPanel kit={kit} />}
            {tab === "people" && <PeoplePanel owner={owner} studio={studio} onCopy={copyInvite} />}
            {tab === "notes" && <NotesPanel roomKey={owner ? String(studio?.id ?? "mine") : roomName} />}
            {tab === "recording" && owner && <RecordingPanel studio={studio} now={now} busy={busy} onRecord={(on) => void record(on)} onGoLive={() => setSheet(true)} onEndLive={() => void endLive()} />}
            {tab === "chat" && <ChatPanel />}
          </div>
          <nav className="flex w-[72px] shrink-0 flex-col items-center gap-1 border-l border-[#eef0f4] pt-3" aria-label="Panels">
            {editing && <RailButton on={tab === "look"} onClick={() => setTab("look")} icon={<Palette className="h-[22px] w-[22px]" />} label="Look" />}
            <RailButton on={tab === "people"} onClick={() => setTab("people")} icon={<Users className="h-[22px] w-[22px]" />} label="People" />
            <RailButton on={tab === "notes"} onClick={() => setTab("notes")} icon={<NotebookPen className="h-[22px] w-[22px]" />} label="Notes" />
            {owner && <RailButton on={tab === "recording"} onClick={() => setTab("recording")} icon={<Circle className={`h-[22px] w-[22px] ${rec ? "fill-[#d92d20] text-[#d92d20]" : ""}`} />} label="Recording" />}
            <RailButton on={tab === "chat"} onClick={() => setTab("chat")} icon={<MessageSquare className="h-[22px] w-[22px]" />} label="Chat" />
          </nav>
        </aside>
      </div>

      {sheet && owner && studio && <GoLiveSheet studio={studio} onClose={() => setSheet(false)} />}
      {settings && <SettingsSheet onClose={() => setSettings(false)} />}
    </div>
  );
}

function BarButton({ label, onClick, off, active, wide, children }: { label: string; onClick: () => void; off?: boolean; active?: boolean; wide?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active || off ? true : undefined} className={`${wide ? "hidden lg:flex" : "flex"} h-[58px] w-[54px] flex-col items-center justify-center gap-1 rounded-xl text-center text-[11px] font-semibold leading-tight sm:w-[76px] sm:text-xs ${off ? "bg-[#fef3f2] text-[#b42318]" : active ? "bg-[#eef3fb] text-[#053877]" : "text-[#344054] hover:bg-[#f2f4f7]"}`}>
      {children}{label}
    </button>
  );
}

function RailButton({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-current={on ? "page" : undefined} className={`flex w-[62px] flex-col items-center gap-1 rounded-xl pb-[7px] pt-[9px] text-[11px] ${on ? "bg-[#eef3fb] font-bold text-[#053877]" : "font-semibold text-[#667085] hover:bg-[#f9fafb]"}`}>{icon}{label}</button>
  );
}

/* ── The stage and its layouts ── */

function useStageTracks() {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }, { source: Track.Source.ScreenShare, withPlaceholder: false }], { onlySubscribed: false });
  const cams = tracks.filter((t) => t.source === Track.Source.Camera)
    .sort((a, b) => Number(b.participant.attributes?.role === "host") - Number(a.participant.attributes?.role === "host") || (a.participant.joinedAt?.getTime() ?? 0) - (b.participant.joinedAt?.getTime() ?? 0));
  const screens = tracks.filter((t) => t.source === Track.Source.ScreenShare);
  return { cams, screens };
}

/**
 * The stage as the room sees it: the scene on air (its layout), who's on stage (guests sent
 * backstage aren't), the background, the logo in its corner, any banner and a playing intro or
 * outro. Guests see this one (with no look it's the plain grid); the host sees Engineering's RoomStage.
 */
function Stage({ kit, scene, fallbackLogo }: { kit: RoomKit; scene?: Scene; fallbackLogo?: string }) {
  const look = kit.look;
  const all = useStageTracks();
  const cams = all.cams.filter((t) => kit.isOnStage(t.participant.identity, t.participant.attributes?.stage));
  const screens = all.screens;
  const layout = scene?.layout ?? "grid";
  const speaking = useSpeakingParticipants();
  const byId = (id: string | null | undefined) => cams.find((t) => t.participant.identity === id);
  const main = byId(speaking[0]?.identity) ?? cams[0];
  const others = cams.filter((t) => t !== main);
  const screen = screens[0];

  let body: ReactNode;
  if (layout === "solo") body = main && <Tile t={main} big />;
  else if (layout === "side") body = <div className="flex h-full gap-3.5">{[main, others[0]].filter(Boolean).map((t) => <div key={key(t!)} className="min-w-0 flex-1"><Tile t={t!} /></div>)}</div>;
  else if (layout === "grid") {
    const all = [...screens, ...cams];
    const cols = Math.ceil(Math.sqrt(all.length || 1));
    body = <div className="grid h-full gap-2.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gridAutoRows: "minmax(0,1fr)" }}>{all.map((t) => <Tile key={key(t)} t={t} />)}</div>;
  } else if (layout === "speaker") {
    body = <div className="flex h-full flex-col gap-2.5"><div className="min-h-0 flex-[4]">{main && <Tile t={main} big />}</div>{others.length > 0 && <div className="flex min-h-0 flex-1 justify-center gap-2.5">{others.slice(0, 5).map((t) => <div key={key(t)} className="aspect-video h-full"><Tile t={t} small /></div>)}</div>}</div>;
  } else if (layout === "screen") {
    body = screen
      ? <div className="flex h-full gap-2.5"><div className="min-w-0 flex-[4]"><Tile t={screen} big /></div><div className="flex min-w-0 flex-1 flex-col gap-2.5">{cams.slice(0, 4).map((t) => <div key={key(t)} className="aspect-video w-full"><Tile t={t} small /></div>)}</div></div>
      : <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/25 text-center text-white/85"><MonitorUp className="h-8 w-8" /><p className="text-[15px] font-semibold">No one is sharing a screen yet</p><p className="text-[13px] text-white/60">Press Share at the bottom to show yours.</p></div>;
  } else {
    const big = screen ?? main;
    const small = screen ? main : others[0];
    body = <div className="relative h-full">{big && <Tile t={big} big />}{small && <div className="absolute bottom-3 right-3 aspect-video w-[26%] shadow-[0_6px_18px_rgba(0,0,0,0.35)]"><Tile t={small} small /></div>}</div>;
  }

  const background = look ? bgCss(scene?.look?.background ?? look.background) : BACKGROUNDS.blue;
  const logoOn = look ? (scene?.look && "logo" in scene.look ? scene.look.logo : look.logo) : null;
  const logo = look ? logoOn?.asset.url : fallbackLogo;
  const corner = logoOn?.corner ?? "tr";
  const banner = look?.banners.find((b) => b.id === kit.live.showing?.bannerId);
  const clip = kit.live.playing && look?.[kit.live.playing.slot];
  if (!cams.length && !screens.length) body = <div className="flex h-full items-center justify-center text-center text-[15px] font-semibold text-white/80">No one is on the stage in this scene</div>;

  return (
    <div className="relative shrink-0 overflow-hidden rounded-2xl shadow-[0_12px_32px_rgba(16,24,40,0.22)]" style={{ width: "min(768px, 100%, calc((100dvh - 336px) * 16 / 9))", aspectRatio: "16 / 9", background }} data-testid="my-studio-stage">
      <div className={`absolute inset-x-[4.5%] top-[12.5%] transition-[bottom] duration-300 ${banner ? "bottom-[17%]" : "bottom-[8%]"}`}>{body}</div>
      {logo && <img src={logo} alt="Your show's logo" className={`absolute top-2 h-[11%] max-h-[50px] w-auto rounded-md object-contain ${corner === "tl" ? "left-4" : "right-4"}`} />}
      {banner && <div className="absolute bottom-[3%] left-[4.5%] max-w-[80%] truncate rounded-lg bg-[#053877] px-4 py-2 text-[15px] font-bold text-white shadow-[0_6px_18px_rgba(0,0,0,0.3)]" data-testid="stage-banner">{banner.text}</div>}
      {clip && <video key={clip.id} src={clip.url} autoPlay muted playsInline onEnded={() => kit.play(null)} onError={() => kit.play(null)} className="absolute inset-0 h-full w-full bg-black object-contain" data-testid="stage-clip" />}
    </div>
  );
}

/** The speaker's level, as four green bars in the tile's corner (mockup v8). */
function Meter({ p }: { p: Participant }) {
  const [lvl, setLvl] = useState(0);
  useEffect(() => { const t = window.setInterval(() => setLvl(p.audioLevel ?? 0), 100); return () => window.clearInterval(t); }, [p]);
  const v = Math.min(1, lvl * 3);
  return (
    <div className="absolute bottom-3 right-3 flex h-[18px] items-end gap-[3px]" aria-hidden>
      {[0.45, 0.8, 0.6, 1].map((k, i) => <span key={i} className="w-1 rounded-sm bg-[#12b76a] transition-[height] duration-100" style={{ height: `${Math.max(4, Math.round(18 * Math.min(1, v * k + 0.2)))}px` }} />)}
    </div>
  );
}

const key = (t: TrackReferenceOrPlaceholder) => `${t.participant.identity}:${t.source}`;
const roleOf = (p: Participant) => p.attributes?.title || (p.attributes?.role === "host" ? "Host" : "Guest");

function Tile({ t, big, small }: { t: TrackReferenceOrPlaceholder; big?: boolean; small?: boolean }) {
  const speaking = useIsSpeaking(t.participant);
  const name = t.participant.name || t.participant.identity;
  const shows = isTrackReference(t) && !t.publication.isMuted && !!t.publication.track;
  const screen = t.source === Track.Source.ScreenShare;
  return (
    <div className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-[#16264a] ${speaking && !screen ? "ring-[3px] ring-[rgba(18,183,106,0.9)]" : ""}`}>
      {shows && isTrackReference(t) ? <VideoTrack trackRef={t} className={`h-full w-full ${screen ? "object-contain" : "object-cover"} ${t.participant.isLocal && !screen ? "-scale-x-100" : ""}`} />
        : <div className={`flex items-center justify-center rounded-full bg-[#3a4f80] font-bold text-white ${small ? "h-10 w-10 text-sm" : big ? "h-28 w-28 text-4xl" : "h-24 w-24 text-3xl"}`}>{initials(name)}</div>}
      {!small && <div className="absolute bottom-3 left-3 max-w-[85%] truncate rounded-full bg-[rgba(5,18,48,0.78)] px-3 py-1.5 text-[13px] font-semibold text-white">{screen ? `${name}'s screen` : name}{!screen && <span className="font-medium text-[#9bb6e8]"> · {roleOf(t.participant)}</span>}</div>}
      {small && <div className="absolute bottom-1 left-1.5 max-w-[90%] truncate rounded-full bg-[rgba(5,18,48,0.78)] px-2 py-0.5 text-[11px] font-semibold text-white">{name}</div>}
      {speaking && !screen && !small && <Meter p={t.participant} />}
    </div>
  );
}

/** Everyone in the room. The owner brings guests on stage or sends them backstage (phase 2). */
function PeopleStrip({ kit, owner, onShare, onInvite }: { kit: RoomKit; owner: boolean; onShare: () => void; onInvite: () => void }) {
  const { cams } = useStageTracks();
  const [menu, setMenu] = useState(false);
  const scenes = !!kit.look;
  return (
    <div className="mt-3 flex w-full max-w-[768px] shrink-0 gap-3 overflow-x-auto pb-1" data-testid="my-studio-strip">
      {cams.map((t) => {
        const p = t.participant;
        const name = p.name || p.identity;
        const on = kit.isOnStage(p.identity, p.attributes?.stage);
        const guest = p.identity.startsWith("guest-");
        return (
          <div key={key(t)} className={`relative h-24 w-40 shrink-0 overflow-hidden rounded-xl border border-[#e4e7ec] bg-white ${on ? "" : "opacity-70"}`} data-testid="strip-person">
            <div className="absolute inset-x-0 top-0 bottom-6"><MiniFace t={t} /></div>
            <div className="absolute inset-x-2.5 bottom-1 truncate text-left text-xs font-semibold">{name}{p.isLocal ? " (you)" : ""}</div>
            {(scenes || !on) && (on
              ? <div className="absolute left-2 top-2 rounded-full bg-[#d1fadf] px-2 py-0.5 text-[10px] font-bold text-[#067647]">ON STAGE</div>
              : <div className="absolute left-2 top-2 rounded-full bg-[#f2f4f7] px-2 py-0.5 text-[10px] font-bold text-[#475467]">BACKSTAGE</div>)}
            {owner && scenes && guest && (
              <button type="button" onClick={() => void kit.backstage(p.identity, !on)} className={`absolute right-1.5 top-1.5 rounded-lg px-2 py-1 text-[11px] font-bold shadow-sm ${on ? "bg-white text-[#344054] ring-1 ring-[#d0d5dd] hover:bg-[#f9fafb]" : "bg-[#053877] text-white hover:bg-[#0a4a99]"}`} data-testid="strip-stage-toggle">
                {on ? "Send backstage" : "Bring on stage"}
              </button>
            )}
          </div>
        );
      })}
      <div className="relative shrink-0">
        <button type="button" onClick={() => setMenu(!menu)} className="flex h-24 w-40 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#98a2b3] bg-white text-[13px] font-semibold text-[#475467] hover:bg-[#f9fafb]" data-testid="strip-add">
          <Plus className="h-6 w-6" /> Share screen or invite
        </button>
        {menu && (
          <div className="absolute bottom-[calc(100%+6px)] left-0 z-20 w-56 rounded-xl border border-[#e4e7ec] bg-white p-1.5 shadow-[0_12px_32px_rgba(16,24,40,0.18)]">
            <button type="button" onClick={() => { setMenu(false); onShare(); }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-semibold hover:bg-[#f2f4f7]"><MonitorUp className="h-4 w-4" /> Share my screen</button>
            {owner && <button type="button" onClick={() => { setMenu(false); onInvite(); }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-semibold hover:bg-[#f2f4f7]"><UserPlus className="h-4 w-4" /> Copy the invite link</button>}
          </div>
        )}
      </div>
    </div>
  );
}

/** A guest who's backstage is told so: they're in the room, not in the recording or the show. */
function Backstage({ kit }: { kit: RoomKit }) {
  const { localParticipant } = useLocalParticipant();
  // useLocalParticipant doesn't re-render on attribute changes; this does, so the notice shows the moment the host sends you backstage.
  const stage = useParticipantAttribute("stage", { participant: localParticipant });
  if (kit.isOnStage(localParticipant.identity, stage)) return null;
  return <p className="mt-3 w-full max-w-[768px] shrink-0 rounded-xl bg-[#fff8e6] px-4 py-2.5 text-sm font-semibold text-[#7a4e00]" data-testid="you-backstage">You're backstage. You're not in the recording or the live show until the host brings you on.</p>;
}

function MiniFace({ t }: { t: TrackReferenceOrPlaceholder }) {
  const name = t.participant.name || t.participant.identity;
  const shows = isTrackReference(t) && !t.publication.isMuted && !!t.publication.track;
  return shows && isTrackReference(t)
    ? <VideoTrack trackRef={t} className={`h-full w-full object-cover ${t.participant.isLocal ? "-scale-x-100" : ""}`} />
    : <div className="flex h-full items-center justify-center"><div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#3a4f80] text-sm font-bold text-white">{initials(name)}</div></div>;
}

/* ── Right panel ── */

function PanelHead({ title, line }: { title: string; line: string }) {
  return <div className="px-5 pt-5"><p className="text-lg font-bold tracking-tight">{title}</p><p className="mt-0.5 text-[13px] text-[#667085]">{line}</p></div>;
}

function PeoplePanel({ owner, studio, onCopy }: { owner: boolean; studio?: Studio; onCopy: () => void }) {
  const people = useParticipants();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHead title="People" line={(() => { const back = people.filter((p) => p.attributes?.stage === "off").length; return back ? `${people.length} in the studio, ${back} backstage.` : `${people.length} in the studio. Everyone here is on the stage.`; })()} />
      <ul className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto px-3">
        {people.map((p) => (
          <li key={p.identity} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-[#f9fafb]">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#3a4f80] text-xs font-bold text-white">{initials(p.name || p.identity)}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{p.name || p.identity}{p.isLocal ? " (you)" : ""}</p><p className="truncate text-xs text-[#667085]">{roleOf(p)}</p></div>
            {p.isMicrophoneEnabled ? <Mic className="h-4 w-4 text-[#475467]" aria-label="Mic on" /> : <MicOff className="h-4 w-4 text-[#b42318]" aria-label="Muted" />}
            {p.isCameraEnabled ? <Video className="h-4 w-4 text-[#475467]" aria-label="Camera on" /> : <VideoOff className="h-4 w-4 text-[#98a2b3]" aria-label="Camera off" />}
          </li>
        ))}
      </ul>
      {owner && studio && (
        <div className="m-4 rounded-2xl border border-[#e4e7ec] bg-[#fcfcfd] p-4">
          <p className="text-sm font-bold">Invite a guest</p>
          <p className="mt-0.5 text-[13px] text-[#667085]">Send this link. They pick a name and they're in. No account needed.</p>
          <div className="mt-3 flex gap-2">
            <input readOnly value={studio.inviteLink} onFocus={(e) => e.currentTarget.select()} className="h-10 min-w-0 flex-1 truncate rounded-lg border border-[#d0d5dd] bg-white px-3 text-[13px] text-[#475467]" aria-label="Invite link" />
            <button type="button" onClick={onCopy} className="flex h-10 items-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold text-white" style={{ background: NAVY }}><Copy className="h-4 w-4" /> Copy</button>
          </div>
        </div>
      )}
    </div>
  );
}

function NotesPanel({ roomKey }: { roomKey: string }) {
  const k = `mv-room-notes-${roomKey}`;
  const [text, setText] = useState(() => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } });
  useEffect(() => { try { localStorage.setItem(k, text); } catch { /* private window */ } }, [k, text]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHead title="Notes" line="Only you see these. They stay on this computer." />
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"Questions for your guest, talking points, the sponsor read…"} className="m-4 min-h-0 flex-1 resize-none rounded-xl border border-[#d0d5dd] p-3.5 text-[14px] leading-relaxed outline-none focus:border-[#053877] focus:ring-2 focus:ring-[#053877]/15" data-testid="studio-notes" />
    </div>
  );
}

function RecordingPanel({ studio, now, busy, onRecord, onGoLive, onEndLive }: { studio?: Studio; now: number; busy: string; onRecord: (on: boolean) => void; onGoLive: () => void; onEndLive: () => void }) {
  if (!studio) return <PanelHead title="Recording" line="Loading…" />;
  const rec = studio.recording, live = studio.live;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHead title="Recording" line="Everything you record lands in your Library, ready for clips." />
      <div className="mt-4 space-y-3 px-4">
        <div className={`rounded-2xl border p-4 ${rec ? "border-[#fecdca] bg-[#fef3f2]" : "border-[#e4e7ec]"}`}>
          <p className="flex items-center gap-2 text-sm font-bold">{rec ? <><span className="h-2 w-2 animate-pulse rounded-full bg-[#d92d20]" /> Recording · <span className="tabular-nums">{clock(rec.since, now)}</span></> : "Not recording"}</p>
          <p className="mt-1 text-[13px] text-[#475467]">{!studio.canRecord ? "Recording isn't switched on for your studio yet." : rec ? "Stop when you're done. It's in your Library a minute or two later." : "Starts recording the whole studio to your Library."}</p>
          {studio.canRecord && (
            <button type="button" onClick={() => onRecord(!rec)} disabled={busy !== ""} className={`mt-3 flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-bold disabled:opacity-60 ${rec ? "border border-[#fda29b] bg-white text-[#b42318]" : "bg-[#d92d20] text-white"}`} data-testid="panel-record">
              {busy === "rec" ? <Loader2 className="h-4 w-4 animate-spin" /> : rec ? <Square className="h-3.5 w-3.5 fill-current" /> : <Circle className="h-3 w-3 fill-current" />}{rec ? "Stop recording" : "Start recording"}
            </button>
          )}
        </div>
        <div className={`rounded-2xl border p-4 ${live ? "border-[#fecdca] bg-[#fef3f2]" : "border-[#e4e7ec]"}`}>
          <p className="text-sm font-bold">{live ? <>Live · <span className="tabular-nums">{clock(live.since, now)}</span></> : "Not live yet"}</p>
          <p className="mt-1 text-[13px] text-[#475467]">{live ? (live.watchUrl ? "You're on YouTube and any streaming keys that are on." : "You're on your streaming keys.") : "Go live to YouTube, Facebook, LinkedIn or any site with a streaming key."}</p>
          <div className="mt-3 flex items-center gap-3">
            {live ? <button type="button" onClick={onEndLive} disabled={busy !== ""} className="flex h-10 items-center gap-2 rounded-xl border border-[#fda29b] bg-white px-4 text-sm font-bold text-[#b42318] disabled:opacity-60"><Square className="h-3.5 w-3.5 fill-current" /> End live</button>
              : <button type="button" onClick={onGoLive} className="h-10 rounded-xl px-4 text-sm font-bold text-white" style={{ background: NAVY }}>Go live</button>}
            {live?.watchUrl && <a href={live.watchUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm font-semibold text-[#053877] hover:underline">Watch <ExternalLink className="h-3.5 w-3.5" /></a>}
          </div>
        </div>
        <a href="/host/dashboard/library" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-1 pt-1 text-sm font-semibold text-[#053877] hover:underline">Open your Library <ExternalLink className="h-3.5 w-3.5" /></a>
      </div>
    </div>
  );
}

function ChatPanel() {
  const { chatMessages, send, isSending } = useChat();
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [chatMessages.length]);
  const go = async () => { const t = text.trim(); if (!t) return; setText(""); await send(t).catch(() => setText(t)); };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHead title="Chat" line="Messages go to everyone in the studio. They aren't saved." />
      <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto px-5">
        {chatMessages.length === 0 && <p className="pt-6 text-center text-[13px] text-[#98a2b3]">No messages yet.</p>}
        {chatMessages.map((m) => (
          <div key={m.id ?? m.timestamp}>
            <p className="text-xs font-semibold text-[#667085]">{m.from?.isLocal ? "You" : m.from?.name || "Someone"}</p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-[14px]">{m.message}</p>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void go(); }} className="m-4 flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message" className="h-10 min-w-0 flex-1 rounded-lg border border-[#d0d5dd] px-3 text-sm outline-none focus:border-[#053877]" data-testid="chat-input" />
        <button type="submit" disabled={isSending || !text.trim()} className="h-10 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-50" style={{ background: NAVY }}>Send</button>
      </form>
    </div>
  );
}

/* ── Sheets ── */

function Sheet({ onClose, width = 640, children, testId }: { onClose: () => void; width?: number; children: ReactNode; testId: string }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(16,24,40,0.45)] p-4" onClick={onClose}>
      <div role="dialog" aria-modal className="relative max-h-[calc(100dvh-32px)] w-full overflow-y-auto rounded-[20px] bg-white p-6 text-[#101828] shadow-[0_24px_64px_rgba(16,24,40,0.3)]" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()} data-testid={testId}>
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full text-[#667085] hover:bg-[#f2f4f7]"><X className="h-5 w-5" /></button>
        {children}
      </div>
    </div>
  );
}

function GoLiveSheet({ studio, onClose }: { studio: Studio; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState(`${studio.name} · ${today()}`);
  const [adding, setAdding] = useState(false);
  const [add, setAdd] = useState({ name: "", url: "", key: "" });
  const [busy, setBusy] = useState<"" | "patch" | "go">("");
  const [error, setError] = useState("");
  const set = (s: Studio) => qc.setQueryData(["/api/host/my-studio"], s);
  const patch = async (body: Record<string, unknown>) => {
    setBusy("patch"); setError("");
    try { set((await (await apiRequest("PATCH", "/api/host/my-studio", body)).json()) as Studio); return true; }
    catch (e) { setError(say(e)); return false; }
    finally { setBusy(""); }
  };
  const ytOn = studio.youtube && studio.youtubeOn;
  const anyOn = ytOn || studio.streams.some((s) => s.on);
  const start = async () => {
    setBusy("go"); setError("");
    try {
      // Your Library is always on: going live records too.
      if (!studio.recording && studio.canRecord) set((await (await apiRequest("POST", "/api/host/my-studio/record", { on: true })).json()) as Studio);
      set((await (await apiRequest("POST", "/api/host/my-studio/live", { on: true, title: title.trim() || studio.name })).json()) as Studio);
      toast({ title: "You're live", description: "It's recording to your Library too." });
      onClose();
    } catch (e) { setError(say(e)); setBusy(""); }
  };
  const row = "flex items-center gap-4 rounded-2xl border p-4";
  const icon = "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl";
  return (
    <Sheet onClose={onClose} testId="go-live-sheet">
      <h2 className="text-[22px] font-bold tracking-tight">Go live</h2>
      <p className="mt-1 text-[15px] text-[#475467]">Pick where the show goes. It's recorded to your Library either way, ready for clips.</p>
      <div className="mt-5 space-y-2.5">
        <div className={`${row} border-[#abefc6] bg-[#f6fef9]`}>
          <div className={`${icon} bg-[#d1fadf] text-[#067647]`}><Check className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1"><p className="font-semibold">Your Library</p><p className="text-[13px] text-[#475467]">Always on. Your episode and clips start from here.</p></div>
          <span className="rounded-full bg-[#d1fadf] px-3 py-1 text-[13px] font-bold text-[#067647]">On</span>
        </div>
        <div className={`${row} ${ytOn ? "border-2 border-[#053877] bg-[#f5f8fd] p-[15px]" : "border-[#e4e7ec]"}`}>
          <div className={`${icon} bg-[#fee4e2] text-[#d92d20]`}><Youtube className="h-6 w-6" /></div>
          <div className="min-w-0 flex-1"><p className="font-semibold">YouTube</p><p className="truncate text-[13px] text-[#475467]">{studio.youtube ? "Your channel · connected" : "Connect your channel once, then it's one press."}</p></div>
          {studio.youtube
            ? <button type="button" onClick={() => void patch({ youtubeOn: !studio.youtubeOn })} disabled={busy !== ""} aria-pressed={ytOn} className={`h-9 rounded-xl px-4 text-sm font-bold disabled:opacity-60 ${ytOn ? "text-white" : "border border-[#d0d5dd] bg-white"}`} style={ytOn ? { background: NAVY } : undefined} data-testid="golive-youtube">{ytOn ? "Selected" : "Select"}</button>
            : <a href="/host/dashboard/integrations" target="_blank" rel="noreferrer" className="flex h-9 items-center rounded-xl border border-[#d0d5dd] bg-white px-4 text-sm font-semibold">Connect YouTube</a>}
        </div>
        <div className={`rounded-2xl border p-4 ${studio.streams.some((s) => s.on) ? "border-2 border-[#053877] bg-[#f5f8fd] p-[15px]" : "border-[#e4e7ec]"}`}>
          <div className="flex items-center gap-4">
            <div className={`${icon} bg-[#eef3fb] text-[#053877]`}><Plus className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1"><p className="font-semibold">Facebook, LinkedIn or another site</p><p className="text-[13px] text-[#475467]">Use a streaming key from that site.</p></div>
            {!adding && <button type="button" onClick={() => setAdding(true)} className="h-9 rounded-xl border border-[#d0d5dd] bg-white px-4 text-sm font-semibold" data-testid="golive-add-key">Add a key</button>}
          </div>
          {studio.streams.length > 0 && (
            <ul className="mt-3 space-y-1.5 pl-[60px]">
              {studio.streams.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-sm">
                  <label className="flex flex-1 cursor-pointer items-center gap-2"><input type="checkbox" checked={s.on} onChange={() => void patch({ toggleStream: s.id })} disabled={busy !== ""} className="h-4 w-4 accent-[#053877]" /><span className="font-semibold">{s.name}</span></label>
                  <button type="button" onClick={() => { if (window.confirm(`Remove the ${s.name} key?`)) void patch({ removeStream: s.id }); }} className="text-xs font-semibold text-[#667085] hover:text-[#b42318]">Remove</button>
                </li>
              ))}
            </ul>
          )}
          {adding && (
            <form className="mt-3 grid gap-2 pl-[60px]" onSubmit={(e) => { e.preventDefault(); void patch({ addStream: add }).then((ok) => { if (ok) { setAdding(false); setAdd({ name: "", url: "", key: "" }); } }); }}>
              <input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="Which site? e.g. Facebook" className="h-10 rounded-lg border border-[#d0d5dd] px-3 text-sm" />
              <input value={add.url} onChange={(e) => setAdd({ ...add, url: e.target.value })} placeholder="Server address (starts rtmp://)" className="h-10 rounded-lg border border-[#d0d5dd] px-3 text-sm" required />
              <input value={add.key} onChange={(e) => setAdd({ ...add, key: e.target.value })} placeholder="Stream key" type="password" autoComplete="off" className="h-10 rounded-lg border border-[#d0d5dd] px-3 text-sm" required />
              <div className="flex gap-2"><button type="submit" disabled={busy !== ""} className="h-9 rounded-xl px-4 text-sm font-bold text-white disabled:opacity-60" style={{ background: NAVY }}>Save key</button><button type="button" onClick={() => setAdding(false)} className="h-9 rounded-xl px-3 text-sm font-semibold text-[#475467]">Cancel</button></div>
            </form>
          )}
        </div>
      </div>
      <label className="mt-5 block text-sm font-semibold" htmlFor="live-title">Title of your show</label>
      <input id="live-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} className="mt-1.5 h-12 w-full rounded-xl border border-[#d0d5dd] px-4 text-[15px] outline-none focus:border-[#053877] focus:ring-2 focus:ring-[#053877]/15" />
      {error && <p className="mt-3 text-sm font-medium text-[#b42318]">{error}</p>}
      <div className="mt-6 flex items-center justify-end gap-3">
        {!anyOn && <p className="mr-auto text-[13px] text-[#667085]">Pick YouTube or add a key to go live.</p>}
        <button type="button" onClick={onClose} className="h-12 rounded-xl px-5 text-[15px] font-semibold text-[#344054] hover:bg-[#f2f4f7]">Not yet</button>
        <button type="button" onClick={() => void start()} disabled={!anyOn || busy !== ""} className="flex h-12 items-center gap-2 rounded-xl bg-[#d92d20] px-6 text-[15px] font-bold text-white shadow-[0_4px_12px_rgba(217,45,32,0.28)] disabled:opacity-50 disabled:shadow-none" data-testid="golive-start">
          {busy === "go" && <Loader2 className="h-4 w-4 animate-spin" />}Start the live show
        </button>
      </div>
    </Sheet>
  );
}

function SettingsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet onClose={onClose} width={480} testId="studio-settings">
      <h2 className="text-[22px] font-bold tracking-tight">Settings</h2>
      <p className="mt-1 text-[15px] text-[#475467]">Pick the camera, mic and speakers this computer uses.</p>
      <div className="mt-5 space-y-4">
        <DevicePick kind="videoinput" label="Camera" />
        <DevicePick kind="audioinput" label="Microphone" />
        <DevicePick kind="audiooutput" label="Speakers" />
      </div>
      <button type="button" onClick={onClose} className="mt-6 h-11 w-full rounded-xl text-[15px] font-bold text-white" style={{ background: NAVY }}>Done</button>
    </Sheet>
  );
}

function DevicePick({ kind, label }: { kind: MediaDeviceKind; label: string }) {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind });
  const list = useMemo(() => devices.filter((d) => d.deviceId), [devices]);
  if (!list.length) return null;
  return (
    <label className="block">
      <span className="text-sm font-semibold">{label}</span>
      <select value={activeDeviceId} onChange={(e) => void setActiveMediaDevice(e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 text-sm">
        {list.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || label}</option>)}
      </select>
    </label>
  );
}
