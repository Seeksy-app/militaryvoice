import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TIP_TEXT, useLookCheck, type LookTip } from "@/components/room/lookCheck";
import { BLUR_SLOW, BLUR_UNSUPPORTED, readBlur, saveBlur, useBlur, type BlurState } from "@/components/room/blur";
import { PRACTICE_NAME, practice, usePractice } from "@/components/room/practiceGuest";
import { startScreenShare } from "@/components/room/screenShare";
import { BrandMark } from "@/components/BrandMark";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LiveKitRoom, RoomAudioRenderer, VideoTrack, isTrackReference, useChat, useConnectionState, useIsMuted, useIsSpeaking,
  useLocalParticipant, useMediaDeviceSelect, useParticipantAttribute, useParticipants, useRoomContext, useRoomInfo, useSpeakingParticipants, useTracks,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { ConnectionState, DisconnectReason, LocalVideoTrack, Track, type Participant } from "livekit-client";
import {
  ArrowLeft, Check, Circle, Clapperboard, Copy, ExternalLink, Image as ImageIcon, Loader2, LogOut, MessageSquare, Mic, MicOff, MonitorUp, MoreHorizontal, NotebookPen, Presentation,
  ChevronLeft, ChevronRight, LayoutDashboard, Lightbulb, Music, Type, Palette, Pause, Play, Plus, RotateCcw, Settings, Square, UserPlus, UserRound, Users, Video, VideoOff, X, } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BACKGROUNDS, LIMITS, PRESENT_NAME, bgCss, isClipScene, isPresenting, sceneLive, useRoomKit, type Asset, type Playing, type RoomKit, type Scene } from "@/components/room/look";
import { closeClipSound, useClipSound, useStageClipElement, warmClipSound, type StageClip } from "@/components/room/clipSound";
import { LayoutPicker, ScenesPanel } from "@/components/room/ScenesPanel";
import { SaveSetupDialog, SetupMenuButton, TemplatesDialog } from "@/components/room/Setups";
import { LookPanel } from "@/components/room/LookPanel";
import { MediaPanel, SoundsPanel } from "@/components/room/MediaPanel";
import { BannersPanel } from "@/components/room/BannersPanel";
import { StarterCard, TipsPanel, TipsSwitch } from "@/components/room/TipsPanel";
import { StylePanel } from "@/components/room/StylePanel";
import { PhoneStudio } from "@/components/room/PhoneStudio";
import { LayoutEditor } from "@/components/room/LayoutEditor";
import { MarkClip } from "@/components/room/MarkClip";
import { ShowPanel } from "@/components/room/ShowPanel";
import { AddDestinationSheet, DestinationBar, anyDestinationOn } from "@/components/room/Destinations";
import { CopyLinkButton } from "@/components/WatchLink";
import { RoomStage } from "@/components/RoomStage";
import { YoutubeKeyForm, useYoutubeKey, useYoutubeConnectResult, youtubeConnectHref } from "@/components/ConnectYoutube";
import { PrompterNews, PrompterOverlay, PrompterSwitch, ScriptsBar, usePrompter, useStudioNotes, type NotesSync } from "@/components/room/Teleprompter";
import { pdfToPictures, useDeck } from "@/components/room/slides";
import { NewVersionBar } from "@/components/NewVersionBar";
import { STUDIO_HOURS_KEY, StudioHoursBar } from "@/components/StudioHoursBar";
import { EXTRA_CAMS, addExtraCamera, freeCameras, isExtraCam, stopAllExtraCameras, stopExtraCamera, useExtraCams } from "@/components/room/extraCamera";
import { Select } from "@/components/room/Select";

/** The room is light in both themes, so always the light logo file. */
const DASHBOARD = "/host/dashboard";
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
type Studio = { you?: string; studioName?: string; showTitle?: string; shows?: { id: number; title: string }[]; showId?: number | null; id: number; name: string; inviteLink: string; recording: { since: string } | null; live: { since: string; watchUrl: string } | null; youtube: boolean; youtubeOn: boolean; youtubeKey?: string; youtubeLegacy?: boolean; livePage?: { on: boolean; url: string }; streams: { id: string; name: string; on: boolean }[]; ready: boolean; canRecord: boolean; v3?: boolean };
type Conn = { url: string; token: string; name: string };
type Setup = { name: string; title: string; mic: boolean; cam: boolean; micId?: string; camId?: string };
type Tab = "show" | "look" | "banners" | "media" | "style" | "sounds" | "tips" | "people" | "notes" | "recording" | "chat";
/** Studio v2 (26 Nov): the panels that only exist with STUDIO_V3. */
const V3_TABS: Tab[] = ["show", "banners", "media", "style", "sounds", "tips"];

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
/** The studio's sound and music player (Engineering, phase 3): heard by everyone, never shown or counted. */
const isPlayer = (p: Participant) => p.identity.startsWith("player-") || p.attributes?.role === "player";
const say = (e: unknown) => ((e as Error).message ?? "").replace(/^\d+:\s*/, "").replace(/^\{"message":"|"\}$/g, "") || "Try again in a moment.";
const clock = (since: string, now: number) => { const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s % 60).padStart(2, "0")}`; };
/**
 * How each person shows on stage in this studio, kept in this browser so it stays the way they left it
 * (Andrew, 24 Nov: "let them toggle their icon on and off… where can we edit that to show or not show?").
 * The host's key is "own", a guest's their invite.
 */
type MyStage = { name?: string; showName?: boolean };
const meKeyOf = (invite?: string) => `mv-studio-me:${invite || "own"}`;
function readMe(key: string): MyStage {
  try { return JSON.parse(window.localStorage.getItem(key) || "{}") as MyStage; } catch { return {}; }
}
function saveMe(key: string, patch: MyStage) {
  try { window.localStorage.setItem(key, JSON.stringify({ ...readMe(key), ...patch })); } catch { /* private mode: it still works for this visit */ }
}

const initials = (n: string) => n.trim().split(/\s+/).map((w) => w[0] ?? "").slice(0, 2).join("").toUpperCase() || "?";
const today = () => new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
const useNow = () => { const [now, setNow] = useState(Date.now()); useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []); return now; };

export default function MyStudio({ invite }: { invite?: string }) {
  const owner = !invite;
  const { toast } = useToast();
  useInter();
  useYoutubeConnectResult();
  const [conn, setConn] = useState<Conn | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [left, setLeft] = useState(false);
  const [removed, setRemoved] = useState(false);
  // An invitation for one of the host's shows carries ?show=<id>: the room greets the guest with that show's name.
  const forShow = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("show") ?? "" : "";
  // The host's show pick (?show=, or the entry screen's Show picker); the server remembers it.
  const pick = useRef(forShow);
  const guestInfo = useQuery<{ name: string }>({ queryKey: ["/api/my-studio/invite", invite, forShow], enabled: !owner, queryFn: async () => (await apiRequest("GET", `/api/my-studio/invite/${invite}${/^\d+$/.test(forShow) ? `?show=${forShow}` : ""}`)).json(), retry: false });
  // The host's studio opened for one of their shows (?show=<id>) takes that show's name, icon and recording title.
  const studio = useQuery<Studio>({ queryKey: ["/api/host/my-studio"], enabled: owner, queryFn: async () => (await apiRequest("GET", `/api/host/my-studio${/^\d+$/.test(pick.current) ? `?show=${pick.current}` : ""}`)).json(), retry: false, refetchInterval: conn ? 8000 : false });
  const roomName = (owner ? studio.data?.name : guestInfo.data?.name) || "";

  if (left) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#f3f4f7] p-6 text-center text-[#101828]">
        <Logo className="h-12" />
        <p className="mt-4 text-2xl font-bold">{owner ? "You've left your studio" : removed ? "The host removed you from the studio" : "Thanks for joining"}</p>
        {owner ? (
          <>
            <p className="max-w-md text-[#475467]">Anything you recorded is on its way to your Library, ready for clips.</p>
            <a href={DASHBOARD} className="mt-2 flex h-14 w-full max-w-xs items-center justify-center gap-2 rounded-xl text-[17px] font-bold text-white shadow-[0_4px_12px_rgba(5,56,119,0.28)]" style={{ background: NAVY }} data-testid="left-dashboard"><ArrowLeft className="h-5 w-5" /> Back to your dashboard</a>
            <div className="flex flex-wrap justify-center gap-3">
              <button type="button" onClick={() => { setLeft(false); setConn(null); }} className="h-11 rounded-xl border border-[#d0d5dd] bg-white px-5 font-semibold">Go back in</button>
              <a href="/host/dashboard/library" className="flex h-11 items-center rounded-xl border border-[#d0d5dd] bg-white px-5 font-semibold">Open your Library</a>
            </div>
          </>
        ) : (
          <>
            <p className="max-w-md text-[#475467]">{removed ? "You're no longer in the studio or the show. If that was a mistake, ask the host." : "You've left the studio. You can close this tab."}</p>
            <div className="flex flex-wrap justify-center gap-3">
              {!removed && <button type="button" onClick={() => { setLeft(false); setConn(null); }} className="h-11 rounded-xl border border-[#d0d5dd] bg-white px-5 font-semibold" data-testid="left-rejoin">Join again</button>}
              <a href="/" className="flex h-11 items-center rounded-xl px-5 font-semibold text-white" style={{ background: NAVY }}>Go to MilitaryVoices.ai</a>
            </div>
          </>
        )}
      </div>
    );
  }

  // No "How do you want to start?" page (Andrew, 27 Nov: "Build A (rows)"): the studio opens as it was left. Saved
  // studios are opened from the dashboard's Studio page, which loads one before coming here.
  if (!conn || !setup) {
    const blocked = owner ? (studio.error ? "Sign in to open your studio." : "") : guestInfo.error ? say(guestInfo.error) : "";
    return (
      <SetupScreen
        owner={owner}
        roomName={roomName}
        blocked={blocked}
        defaultName={readMe(meKeyOf(invite)).name || (owner ? studio.data?.you ?? "" : "")}
        onEnter={async (s) => {
          if (s.name.trim()) saveMe(meKeyOf(invite), { name: s.name.trim().slice(0, 60) });
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
      onDisconnected={(why) => {
        void stopAllExtraCameras();
        const out = why === DisconnectReason.PARTICIPANT_REMOVED;
        // The owner leaving lands back on the Studio start, the camera check (Andrew, 26 Nov: "it should just take me
        // back to the start point of Studio, not back to the dashboard"). Guests still get their goodbye.
        if (owner && !out) {
          setConn(null); setSetup(null);
          void studio.refetch();
          toast({ title: "You've left your studio", description: "Anything you recorded is on its way to your Library, ready for clips." });
          return;
        }
        setRemoved(out); setLeft(true);
      }}
      style={{ height: "100dvh" }}
    >
      <RoomAudioRenderer />
      <StudioFrame owner={owner} roomName={conn.name} studio={owner ? studio.data : undefined} title={setup.title} meKey={meKeyOf(invite)} />
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
  // The preview's camera as a LiveKit track, so the same background blur as in the studio can run on it.
  const [preview, setPreview] = useState<LocalVideoTrack | null>(null);
  const [blur, setBlurState] = useState(readBlur);
  const setBlur = (on: boolean) => { setBlurState(on); saveBlur(on); };
  const blurState = useBlur(preview, blur, () => setBlur(false));
  useEffect(() => { if (defaultName && !name) setName(defaultName); }, [defaultName]); // eslint-disable-line react-hooks/exhaustive-deps

  // The preview: their camera and mic, with a live level so they can see the mic works.
  useEffect(() => {
    let stop = false, raf = 0;
    let ctx: AudioContext | null = null;
    let cam0: LocalVideoTrack | null = null;
    setLevel(0);
    if (!mic && !cam) { stream.current = null; return; }
    navigator.mediaDevices?.getUserMedia({ video: cam ? (camId ? { deviceId: { exact: camId } } : true) : false, audio: mic ? (micId ? { deviceId: { exact: micId } } : true) : false })
      .then(async (s) => {
        if (stop) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        setProblem("");
        const vt = s.getVideoTracks()[0];
        if (vt) {
          cam0 = new LocalVideoTrack(vt, undefined, true);
          if (video.current) cam0.attach(video.current);
          setPreview(cam0);
        }
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
    return () => {
      stop = true; cancelAnimationFrame(raf); void ctx?.close();
      const t = cam0;
      setPreview(null);
      if (t) void t.stopProcessor().catch(() => {}).finally(() => t.detach());
      stream.current?.getTracks().forEach((x) => x.stop()); stream.current = null;
    };
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
  const select = "h-10 rounded-lg border border-[#d0d5dd] bg-white pl-3 text-[13px] text-[#344054]";
  // Look your best (Andrew, 24 Nov; 27 Nov: a 3-second scan, then one honest tip). Worked out in the browser, and it
  // never blocks going in. It scans again for a new camera.
  const look = useLookCheck(video, cam && !problem && !!preview, camId ?? "");
  const scanning = look.status === "scanning";
  // The guide's lines turn green once the head sits right (headroom and eye height), whatever else there is to say.
  const framed = look.status === "ok" && !FRAMING_TIPS.includes(look.tip as LookTip);

  return (
    <div className="min-h-screen bg-[#f3f4f7] text-[#101828]" data-testid="my-studio-setup" style={{ fontFamily: INTER }}>
      <header className="flex h-16 items-center gap-4 border-b border-[#e4e7ec] bg-white px-5">
        {owner ? <a href={DASHBOARD} aria-label="MilitaryVoices.ai, back to your dashboard"><Logo className="h-10" /></a> : <Logo className="h-10" />}
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
              {/* A faint framing guide: eyes about a third of the way down, a little room above the head. Hidden while the
                  scan runs; the lines turn green once the head sits right. Andrew, 24 Nov: lines that show on a light wall
                  and a dark room alike (a soft dark shadow under each). */}
              {cam && !problem && !scanning && (
                <div aria-hidden className={`pointer-events-none absolute inset-0 transition-opacity duration-500 ${framed ? "opacity-70" : "opacity-100"}`} data-testid="framing-guide" data-framed={framed ? "1" : "0"}>
                  <div className={`absolute inset-x-0 top-[7%] border-t-2 transition-colors [filter:drop-shadow(0_1px_1.5px_rgba(0,0,0,0.55))] ${framed ? "border-[#6ce9a6]" : "border-white/80"}`} />
                  <span className="absolute left-4 top-[calc(7%+6px)] text-[11px] font-semibold sm:text-[13px] text-white/95 [text-shadow:0_1px_3px_rgba(0,0,0,0.85),0_0_8px_rgba(0,0,0,0.45)]">A little room above your head</span>
                  <div className={`absolute inset-x-0 top-[33%] border-t-2 border-dashed transition-colors [filter:drop-shadow(0_1px_1.5px_rgba(0,0,0,0.55))] ${framed ? "border-[#6ce9a6]" : "border-white/90"}`} />
                  <span className="absolute right-4 top-[calc(33%+6px)] text-[11px] font-semibold sm:top-[calc(33%-24px)] sm:text-[13px] text-white/95 [text-shadow:0_1px_3px_rgba(0,0,0,0.85),0_0_8px_rgba(0,0,0,0.45)]">Eyes about here</span>
                </div>
              )}
              {cam && !problem && scanning && <ScanSweep />}
              {(!cam || problem) && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex h-28 w-28 items-center justify-center rounded-full bg-[#3a4f80] text-4xl font-bold text-white">{initials(name || "You")}</div>
                </div>
              )}
              <div className="absolute bottom-4 left-4 rounded-full bg-[rgba(5,18,48,0.78)] px-3 py-1.5 text-[13px] font-semibold text-white">{name || "Your name"}{title && <span className="font-medium text-[#9bb6e8]"> · {title}</span>}</div>
              <div className="absolute bottom-4 right-4 flex gap-2">
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
            {(cams.length > 1 || mics.length > 1 || (cam && !problem)) && <div className="mt-3 flex flex-col gap-2 px-1 sm:flex-row sm:items-center">
              {cams.length > 1 && <Select wrap="flex-1 min-w-0" aria-label="Camera" className={select} value={camId ?? ""} onChange={(e) => setCamId(e.target.value || undefined)}><option value="">Camera: default</option>{cams.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Camera"}</option>)}</Select>}
              {mics.length > 1 && <Select wrap="flex-1 min-w-0" aria-label="Microphone" className={select} value={micId ?? ""} onChange={(e) => setMicId(e.target.value || undefined)}><option value="">Mic: default</option>{mics.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone"}</option>)}</Select>}
              {cam && !problem && <BlurSwitch on={blur} state={blurState} onChange={setBlur} compact />}
            </div>}
            <BlurNote state={blurState} />
            {problem && <p className="mt-3 px-1 text-sm font-medium text-[#b42318]">{problem}</p>}
            {look.status === "ok" && (look.tip ? (
              <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-[#fedf89] bg-[#fffaeb] px-3.5 py-3" data-testid="look-tip" data-tip={look.tip}>
                <span className="mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#f79009] text-[13px] font-bold text-white">!</span>
                <p className="text-balance text-sm font-semibold text-[#93370d]">{TIP_TEXT[look.tip]}</p>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-[#abefc6] bg-[#ecfdf3] px-3.5 py-3" data-testid="look-great">
                <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#12b76a] text-white"><Check className="h-3.5 w-3.5" /></span>
                <p className="text-balance text-sm font-semibold text-[#067647]">You look great. Good light, good framing.</p>
              </div>
            ))}
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
            {look.status === "ok" && look.tip && <p className="mt-2 text-center text-[13px] text-[#667085]">The tip is only a suggestion. You can go in any time.</p>}
            {error && <p className="mt-3 text-sm font-medium text-[#b42318]">{error}</p>}
          </section>
        </main>
      )}
    </div>
  );
}

/** The tips that are about where the head sits; the others (light, moving sideways) leave the guide's lines green. */
const FRAMING_TIPS: LookTip[] = ["face", "back", "closer", "top", "raise"];

/** The scan (Andrew, 27 Nov): a soft line sweeping over the picture while it's checked, about three seconds. */
function ScanSweep() {
  return (
    <div aria-live="polite" className="pointer-events-none absolute inset-0" data-testid="look-scan">
      <style>{"@keyframes mv-scan{from{top:-24%}to{top:100%}}.mv-scan-band{animation:mv-scan 1.5s cubic-bezier(.45,0,.55,1) infinite alternate}@media (prefers-reduced-motion:reduce){.mv-scan-band{display:none}}"}</style>
      <div className="absolute inset-0 bg-[rgba(5,24,64,0.18)]" />
      <div className="mv-scan-band absolute inset-x-0 h-[24%] bg-gradient-to-b from-transparent to-[rgba(125,211,252,0.32)]">
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-[#bae6fd] shadow-[0_0_12px_3px_rgba(125,211,252,0.65)]" />
      </div>
      <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-[rgba(5,18,48,0.78)] px-3 py-1.5 text-[13px] font-semibold text-white">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking your picture…
      </div>
    </div>
  );
}

/** Blur my background (Andrew, 27 Nov), on the camera check and in the studio's Settings. Kept on this computer. */
function BlurSwitch({ on, state, onChange, compact }: { on: boolean; state: BlurState; onChange: (on: boolean) => void; compact?: boolean }) {
  return (
    <label className={`flex shrink-0 cursor-pointer select-none items-center justify-between gap-3 ${compact ? "h-10 rounded-lg border border-[#d0d5dd] bg-white px-3" : "h-11 rounded-xl border border-[#d0d5dd] px-3.5"}`} data-testid="blur-switch">
      <span className="flex items-center gap-2 text-[13px] font-semibold text-[#344054]">
        {state === "starting" && on ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[#667085]" /> : null}Blur my background
      </span>
      <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-[#053877]" : "bg-[#d0d5dd]"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

function BlurNote({ state }: { state: BlurState }) {
  if (state !== "slow" && state !== "unsupported") return null;
  return <p className="mt-2 px-1 text-[13px] text-[#667085]" data-testid="blur-note">{state === "slow" ? BLUR_SLOW : BLUR_UNSUPPORTED}</p>;
}

function PreviewToggle({ on, onClick, label, children }: { on: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return <button type="button" onClick={onClick} aria-label={label} title={label} className={`flex h-11 w-11 items-center justify-center rounded-full ${on ? "bg-[rgba(5,18,48,0.7)] text-white hover:bg-[rgba(5,18,48,0.85)]" : "bg-[#d92d20] text-white"}`}>{children}</button>;
}

/* ───────────────────────── In the studio ───────────────────────── */

/**
 * The stage as big as the room allows (Andrew, 22 Nov: "make the viewer a little bit larger"): the column's
 * width, or the height left once the bar, the people row and the controls are counted. It was capped at 768px.
 */
const STAGE_W = "min(100%, calc((100dvh - 415px) * 16 / 9))"; // 415: header, Mark a clip row, people, controls

/** The right panel (Andrew, 24 Nov: "I like the hide panel better", no dragging): a fixed width, a wider icon rail so
 *  every label fits whole, and a "Hide panel" tab on its edge that folds it down to the rail. Kept per computer. */
const RAIL = { min: 352, max: 600, def: 384, nav: 96, key: "mv-studio-rail", hidden: "mv-studio-panel-hidden" };
function useRailWidth() {
  const w = (() => { try { const n = Number(localStorage.getItem(RAIL.key)); return n >= RAIL.min && n <= RAIL.max ? n : RAIL.def; } catch { return RAIL.def; } })();
  // Never so wide that the stage column gets squeezed: leave it at least 480px beside the Scenes column.
  const [vw, setVw] = useState(() => window.innerWidth);
  useEffect(() => { const r = () => setVw(window.innerWidth); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, []);
  const [hidden, setHiddenState] = useState(() => { try { return localStorage.getItem(RAIL.hidden) === "1"; } catch { return false; } });
  const setHidden = useCallback((h: boolean) => { setHiddenState(h); try { localStorage.setItem(RAIL.hidden, h ? "1" : "0"); } catch { /* private window */ } }, []);
  return { width: hidden ? RAIL.nav : Math.max(RAIL.min, Math.min(w, RAIL.max, vw - 232 - 480)), hidden, setHidden };
}

function HidePanelTab({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  const label = hidden ? "Show panel" : "Hide panel";
  return (
    <button type="button" onClick={onToggle} aria-label={label} title={label} aria-expanded={!hidden}
      className="absolute -left-[26px] top-1/2 z-20 flex h-16 w-[26px] -translate-y-1/2 items-center justify-center rounded-l-xl border border-r-0 border-[#e4e7ec] bg-white text-[#475467] shadow-[-4px_0_12px_rgba(16,24,40,0.06)] hover:bg-[#f9fafb] hover:text-[#101828]" data-testid="rail-hide">
      {hidden ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
    </button>
  );
}

function StudioFrame({ owner, roomName, studio, title, meKey }: { owner: boolean; roomName: string; studio?: Studio; title: string; meKey: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const room = useRoomContext();
  const state = useConnectionState();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled, cameraTrack } = useLocalParticipant();
  const now = useNow();
  // Blur my background (27 Nov): set on the camera check, changed in Settings, and run on the camera as it's sent.
  const [blurOn, setBlurOnState] = useState(readBlur);
  const setBlurOn = (on: boolean) => { setBlurOnState(on); saveBlur(on); };
  const blurState = useBlur(cameraTrack?.track instanceof LocalVideoTrack ? cameraTrack.track : null, blurOn, () => {
    setBlurOn(false);
    toast({ title: BLUR_SLOW });
  });
  const [picked, setPicked] = useState<Tab | null>(null);
  const noteKey = owner ? String(studio?.id ?? "mine") : roomName;
  const [notes, setNotes, notesSync] = useStudioNotes(noteKey, owner && !!studio?.id);
  // One name for it (Andrew, 22 Nov: "just put teleprompter on there on the sidebar, and if it's turned on,
  // then maybe turn it green"). Guests have no prompter, so theirs stays Notes.
  const [prompterPrefs] = usePrompter(noteKey);
  const prompterOn = owner && prompterPrefs.on;
  const notesLabel = owner ? "Teleprompter" : "Notes";
  const [sheet, setSheet] = useState(false);
  // Add a destination (25 Nov): from the "+" beside Record, Go live with nothing on, or the Go live sheet.
  const [addDest, setAddDest] = useState(false);
  const [settings, setSettings] = useState(false);
  const rail = useRailWidth();
  // Picking a panel always shows it, so a hidden panel never leaves a click doing nothing.
  const setTab = (t: Tab) => { setPicked(t); rail.setHidden(false); };
  const [busy, setBusy] = useState<"" | "rec" | "live">("");
  const hosting = useQuery<{ shows: { show: { artworkUrl?: string } }[] }>({ queryKey: ["/api/host/hosting"], enabled: owner, queryFn: async () => (await apiRequest("GET", "/api/host/hosting")).json(), staleTime: 60_000, retry: false });
  const logo = hosting.data?.shows?.find((s) => s.show.artworkUrl)?.show.artworkUrl;

  // Phase 2: the owner's saved look (Podcasting) and what's on air (Engineering, in the room's metadata).
  // With no look from the server, or for guests, the room works as in phase 1.
  const meta = useRoomInfo().metadata;
  const kit = useRoomKit(owner, meta);
  const look = kit.look;
  const editing = owner && !!look;
  // Studio phase 3 (scene types, Media and Style) only when the server says STUDIO_V3 is on.
  const v3 = editing && studio?.v3 === true;
  const scene = sceneLive(look, kit.live);
  // Mark a clip sits above whatever runs along the bottom of the stage: a banner, else the ticker.
  // The layout editor (21 Nov): a scene's ⋯ → Edit layout. It takes the stage column and the right panel until Done or Cancel.
  const [layoutFor, setLayoutFor] = useState<string | null>(null);
  const layoutScene = v3 && layoutFor ? look?.scenes.find((s) => s.id === layoutFor) : undefined;
  // Scenes ⋯ (Andrew, 24 Nov): Start from a template… and Save this setup as….
  const [setupDialog, setSetupDialog] = useState<"" | "template" | "save">("");
  const setupMenu = editing ? <SetupMenuButton onTemplate={() => setSetupDialog("template")} onSave={() => setSetupDialog("save")} /> : null;
  const tab: Tab = picked && (v3 ? picked !== "look" && ((picked !== "tips" && picked !== "show") || owner) : !V3_TABS.includes(picked)) ? picked : editing ? (v3 ? "show" : "look") : "people";

  // Once connected, put the scene on air again so the room carries it (Engineering: call /scene after joining).
  const joined = useRef(false);
  useEffect(() => {
    if (!editing || joined.current || state !== ConnectionState.Connected || !scene) return;
    joined.current = true;
    kit.toScene(scene.id, true);
  }, [editing, state, scene?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Their title from the set-up screen rides on their participant, so it shows under their name for everyone.
  useEffect(() => {
    if (state === ConnectionState.Connected && title) void localParticipant.setAttributes({ title, displayTitle: title }).catch(() => {});
    // Show name, as they left it last time in this studio.
    if (state === ConnectionState.Connected && readMe(meKey).showName === false) void localParticipant.setAttributes({ showName: "0" }).catch(() => {});
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
    finally { setBusy(""); void qc.invalidateQueries({ queryKey: STUDIO_HOURS_KEY }); }
  };
  // The practice guest is never recorded or streamed: Record and Go live ask to take it off first (Andrew, 24 Nov).
  const [askPractice, setAskPractice] = useState<null | "record" | "live">(null);
  useEffect(() => () => practice.set(false), []);
  const startRecord = () => { if (practice.isOn()) setAskPractice("record"); else void record(true); };
  // Nothing picked to go live to: Go live opens Add a destination instead (the destinations mockup, 25 Nov).
  const goLive = () => { if (studio && !anyDestinationOn(studio)) setAddDest(true); else setSheet(true); };
  const openLive = () => { if (practice.isOn()) setAskPractice("live"); else goLive(); };
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
      // With its sound: a shared browser tab can carry its audio (Chrome's "Share tab audio"), so a
      // video played in a tab is heard in the studio and the recording (Andrew, 24 Nov).
      if (isScreenShareEnabled) await localParticipant.setScreenShareEnabled(false);
      else {
        toast({ title: "Sharing a video?", description: "Pick the browser tab and turn on Share tab audio." });
        // Stays in the studio while sharing (Andrew, 24 Nov): Chrome keeps this tab in front; where a browser
        // still switches, say how to come back.
        const { stays } = await startScreenShare(localParticipant);
        if (!stays) toast({ title: "Come back to this tab to see your studio", description: "Your share stays on air until you press Stop share." });
      }
      // Starting a share puts the screen-share scene on air, if there is one.
      const s = !isScreenShareEnabled && editing ? look?.scenes.find((x) => x.layout === "screen") : undefined;
      if (s) kit.toScene(s.id);
    }
    catch (e) { if ((e as Error).name !== "NotAllowedError") toast({ title: "Couldn't share your screen", description: say(e), variant: "destructive" }); }
  };
  // Andrew, 21 Nov: Leave never ends a live show on its own. Guests just leave; the owner, while live or
  // recording, chooses to end it and leave, or leave and keep it going (guests carry on).
  const [leaving, setLeaving] = useState(false);
  // Andrew, 21 Nov: "we need an EXIT from studio". The header's exit, the logo and Leave all take the owner
  // back to the Studio start (26 Nov); guests get their goodbye. All ask first while live or recording.
  const exitTo = useRef<string | null>(null);
  const go = async () => {
    await stopAllExtraCameras();
    await closeClipSound();
    await room.disconnect();
    if (exitTo.current) window.location.assign(exitTo.current);
  };
  const leave = (to?: string) => {
    exitTo.current = to ?? null;
    if (owner && (rec || live)) { setLeaving(true); return; }
    void go();
  };
  const endAndLeave = async () => {
    setLeaving(false);
    if (live) await apiRequest("POST", "/api/host/my-studio/live", { on: false }).catch(() => {});
    if (rec) await apiRequest("POST", "/api/host/my-studio/record", { on: false }).catch(() => {});
    void qc.invalidateQueries({ queryKey: ["/api/host/my-studio"] });
    void go();
  };
  // The owner's exit goes back to the Studio start too (26 Nov); the dashboard is one click on from there.
  const exit = () => leave();

  return (
    <div className="flex h-[100dvh] flex-col bg-[#f3f4f7] text-[#101828]" data-testid="my-studio" style={{ fontFamily: INTER }}>
      {/* A video on stage, heard by everyone in the studio (whatever panel or editor is open). */}
      {editing && <StageClipSound kit={kit} />}
      {/* Guests can't see whether the host is recording, so they're told it loads next time they join. */}
      <NewVersionBar busy={owner ? !!(rec || live) : true} afterLine={owner ? "Reload after your show." : "It loads next time you join."} />
      {/* Studio hours: the owner's own, never a guest's. */}
      {owner && <StudioHoursBar busy={!!(rec || live)} />}
      {/* Top bar */}
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-[#e4e7ec] bg-white px-4 lg:gap-3.5 lg:px-5" data-testid="my-studio-bar">
        <button type="button" onClick={exit} className="hidden shrink-0 sm:block" aria-label={owner ? "MilitaryVoices.ai, leave to the Studio start" : "MilitaryVoices.ai, exit the studio"}><Logo className="h-[38px]" /></button>
        <div className="hidden h-7 w-px bg-[#e4e7ec] sm:block" />
        <button type="button" onClick={exit} className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#d0d5dd] bg-white px-2.5 text-[13px] font-semibold text-[#344054] hover:bg-[#f9fafb]" data-testid="my-studio-exit">
          <ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">Exit studio</span>
        </button>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold tracking-tight">{roomName}</p>
          <p className="hidden truncate text-xs text-[#667085] sm:block">{today()} · {owner ? "Your studio" : "You're a guest"}</p>
        </div>
        {owner && studio && (
          // Two starts, one way per job (Andrew, 22 Nov: "you want to go live, or you want just to record, record and go
          // live"): Record, and Go live (its sheet ticks "Also record to my Library"). Each turns into its own state with its
          // own Stop or End; the old "Record to your Library" pill and "Not live yet" chip are gone.
          <div className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap sm:gap-2.5">
            {live?.watchUrl && <a href={live.watchUrl} target="_blank" rel="noreferrer" className="hidden items-center gap-1 text-[13px] font-semibold text-[#053877] underline-offset-2 hover:underline lg:flex">Watch <ExternalLink className="h-3.5 w-3.5" /></a>}
            <button type="button" onClick={copyInvite} aria-label="Invite guests" title="Invite guests" className="hidden h-[42px] items-center gap-2 rounded-xl border border-[#d0d5dd] bg-white px-3 text-sm font-semibold hover:bg-[#f9fafb] lg:flex xl:px-4" data-testid="my-studio-invite"><UserPlus className="h-[18px] w-[18px]" /><span className="hidden xl:inline">Invite guests</span></button>
            {/* Where the show goes, beside Record: each circle one click on or off (25 Nov). */}
            <DestinationBar studio={studio} live={!!live} onAdd={() => setAddDest(true)} />
            {rec ? (
              <div className="flex h-[42px] items-center overflow-hidden rounded-xl bg-[#fef3f2] ring-1 ring-inset ring-[#fecdca]" data-testid="badge-recording">
                <button type="button" onClick={() => setTab("recording")} className="flex h-full items-center gap-2 pl-3.5 pr-3 text-sm font-bold tabular-nums text-[#b42318]" aria-label={`Recording, ${clock(rec.since, now)}. Open the recording panel`}>
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#d92d20]" /><span className="hidden sm:inline">Recording</span> {clock(rec.since, now)}
                </button>
                {/* While live, the recording is part of the show: End live first, or stop it from the Recording panel. */}
                {!live && (
                  <button type="button" onClick={() => { if (window.confirm("Stop recording? It goes to your Library, ready for clips.")) void record(false); }} disabled={busy !== ""} className="flex h-full items-center gap-1.5 border-l border-[#fecdca] px-3.5 text-sm font-bold text-[#b42318] hover:bg-[#fee4e2] disabled:opacity-60" data-testid="my-studio-stop-record">
                    {busy === "rec" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3 w-3 fill-current" />} Stop
                  </button>
                )}
              </div>
            ) : studio.canRecord ? (
              <button type="button" onClick={startRecord} disabled={busy !== ""} className="flex h-[42px] items-center gap-2 rounded-xl border border-[#fda29b] bg-white px-4 text-sm font-bold text-[#b42318] hover:bg-[#fef3f2] disabled:opacity-60" data-testid="my-studio-record">
                {busy === "rec" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Circle className="h-2.5 w-2.5 fill-current" />} Record
              </button>
            ) : null}
            {live ? (
              <div className="flex h-[42px] items-center overflow-hidden rounded-xl bg-[#d92d20] text-white" data-testid="badge-live">
                <span className="flex items-center pl-4 pr-3 text-sm font-extrabold tabular-nums">LIVE {clock(live.since, now)}</span>
                <button type="button" onClick={() => void endLive()} disabled={busy !== ""} className="flex h-full items-center gap-1.5 border-l border-white/30 px-3.5 text-sm font-bold hover:bg-[#b42318] disabled:opacity-60" data-testid="my-studio-end-live">
                  {busy === "live" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3 w-3 fill-current" />} End live
                </button>
              </div>
            ) : (
              <button type="button" onClick={openLive} className="h-[42px] rounded-xl px-5 text-sm font-bold text-white shadow-[0_4px_12px_rgba(5,56,119,0.28)] sm:px-6" style={{ background: NAVY }} data-testid="my-studio-live">Go live</button>
            )}
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {editing && <ScenesPanel kit={kit} v3={v3} onEditLayout={v3 ? setLayoutFor : undefined} menu={setupMenu} />}
        {setupDialog === "template" && <TemplatesDialog kit={kit} v3={v3} onClose={() => setSetupDialog("")} />}
        {setupDialog === "save" && <SaveSetupDialog show={studio?.name ?? ""} showId={studio?.showId ?? null} onClose={() => setSetupDialog("")} />}
        {layoutScene ? <LayoutEditor kit={kit} sceneId={layoutScene.id} onClose={() => setLayoutFor(null)} /> : <>
        {/* Stage column */}
        <div className="flex min-w-0 flex-1 flex-col items-center px-4 pt-5 lg:px-6">
          {owner ? (
            // The host sees exactly what's recorded and streamed (Engineering's RoomStage); guests keep the plain grid.
            <div className="relative shrink-0 rounded-2xl shadow-[0_12px_32px_rgba(16,24,40,0.22)]" style={{ width: STAGE_W }}>
              <RoomStage muted onMediaEnded={() => { if (kit.live.playing) kit.play(null); }} />
              {/* The teleprompter: on this screen only, over the preview; the program is drawn elsewhere. */}
              <PrompterOverlay roomKey={noteKey} text={notes} />
              <SlidesBar kit={kit} />
            </div>
          ) : (
            <Stage kit={kit} scene={scene} fallbackLogo={look ? undefined : logo} />
          )}
          {/* Mark a clip just below the stage, right-aligned (Andrew, 26 Nov: "it's below the stage. It doesn't float
              around on the stage"): never over the video or its frame. */}
          {owner && MARK_CLIP && <div className="mt-2 flex w-full shrink-0 justify-end" style={{ maxWidth: STAGE_W }}><MarkClip recording={!!rec} onStage /></div>}
          {owner && <ClipBar kit={kit} />}
          {/* Conversation starters: only what the listener sends, only to the owner, never on air (Studio v2). */}
          {owner && v3 && <div className="w-full shrink-0" style={{ maxWidth: STAGE_W }}><StarterCard /></div>}
          {editing && !v3 && scene && (
            <div className="mt-3 shrink-0" title={`Layout for ${scene.name}`}>
              <LayoutPicker value={scene.layout} onPick={(layout) => kit.change((l) => ({ ...l, scenes: l.scenes.map((s) => (s.id === scene.id ? { ...s, layout } : s)) }))} />
            </div>
          )}
          {v3 && <PhoneStudio kit={kit} onEditLayout={setLayoutFor} menu={setupMenu} show={owner ? <ShowPanel studioName={studio?.studioName || studio?.name || ""} showTitle={studio?.showTitle ?? ""} /> : undefined} />}
          <Backstage kit={kit} />
          {owner && <PrompterNews onOpen={() => setTab("notes")} />}
          <PeopleStrip kit={kit} owner={owner} sharing={isScreenShareEnabled} onShare={() => void share()} onInvite={copyInvite} />
          {/* Below lg the bar sits above Ask Alex (bottom right on every page) so nothing is covered. At lg it stands 40px up
              (Andrew, 24 Nov: his dictation bar sits at the bottom of the screen and covered it). */}
          <div className="mb-[84px] mt-auto flex items-center gap-0.5 rounded-[18px] border border-[#e4e7ec] bg-white px-1.5 py-2 shadow-[0_8px_24px_rgba(16,24,40,0.1)] sm:gap-1.5 sm:px-3 lg:mb-10" data-testid="my-studio-controls">
            <BarButton label={isMicrophoneEnabled ? "Mic" : "Muted"} off={!isMicrophoneEnabled} onClick={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}>{isMicrophoneEnabled ? <Mic className="h-[22px] w-[22px]" /> : <MicOff className="h-[22px] w-[22px]" />}</BarButton>
            <BarButton label={isCameraEnabled ? "Camera" : "Camera off"} off={!isCameraEnabled} onClick={() => void localParticipant.setCameraEnabled(!isCameraEnabled)}>{isCameraEnabled ? <Video className="h-[22px] w-[22px]" /> : <VideoOff className="h-[22px] w-[22px]" />}</BarButton>
            <BarButton label={isScreenShareEnabled ? "Stop share" : "Share"} active={isScreenShareEnabled} onClick={() => void share()}><MonitorUp className="h-[22px] w-[22px]" /></BarButton>
            {owner && <BarButton label="Invite" onClick={copyInvite}><UserPlus className="h-[22px] w-[22px]" /></BarButton>}
            {/* Notes opens a side panel, which only shows at lg and up. */}
            <BarButton label={notesLabel} wide={owner ? "w-[92px]" : true} active={!rail.hidden && tab === "notes"} green={prompterOn} onClick={() => setTab("notes")}><NotebookPen className="h-[22px] w-[22px]" /></BarButton>
            <BarButton label="Settings" onClick={() => setSettings(true)}><Settings className="h-[22px] w-[22px]" /></BarButton>
            {owner && v3 && <TipsSwitch onOpen={() => setTab("tips")} />}
            <div className="mx-1 h-9 w-px bg-[#e4e7ec]" />
            <button type="button" onClick={() => leave()} className="flex h-[58px] w-[54px] flex-col items-center justify-center gap-1 rounded-xl bg-[#fef3f2] text-[11px] font-bold text-[#b42318] hover:bg-[#fee4e2] sm:w-[76px] sm:text-xs" data-testid="my-studio-leave"><LogOut className="h-[22px] w-[22px]" />Leave</button>
          </div>
        </div>

        {/* Right panel */}
        <aside className="relative hidden shrink-0 border-l border-[#e4e7ec] bg-white lg:flex" style={{ width: rail.width }} data-testid="my-studio-rail">
          <HidePanelTab hidden={rail.hidden} onToggle={() => rail.setHidden(!rail.hidden)} />
          <div className={`min-w-0 flex-1 flex-col ${rail.hidden ? "hidden" : "flex"}`}>
            {tab === "look" && editing && <LookPanel kit={kit} />}
            {tab === "show" && v3 && owner && <><p className="border-b border-[#eef0f4] px-4 py-3 text-[15px] font-bold">Show</p><ShowPanel studioName={studio?.studioName || studio?.name || ""} showTitle={studio?.showTitle ?? ""} /></>}
            {tab === "banners" && v3 && <BannersPanel kit={kit} />}
            {tab === "media" && v3 && <MediaPanel kit={kit} fallback={logo} />}
            {tab === "style" && v3 && <StylePanel kit={kit} />}
            {tab === "sounds" && v3 && <SoundsPanel kit={kit} />}
            {tab === "tips" && v3 && owner && <TipsPanel />}
            {tab === "people" && <PeoplePanel owner={owner} studio={studio} onCopy={copyInvite} kit={kit} meKey={meKey} showArt={!!logo} />}
            {tab === "notes" && <NotesPanel roomKey={noteKey} text={notes} setText={setNotes} prompter={owner} sync={owner ? notesSync : undefined} />}
            {tab === "recording" && owner && <RecordingPanel studio={studio} now={now} busy={busy} onRecord={(on) => { if (on) startRecord(); else void record(false); }} onGoLive={openLive} onEndLive={() => void endLive()} />}
            {tab === "chat" && <ChatPanel />}
          </div>
          <nav className={`flex w-[96px] shrink-0 flex-col items-center gap-1 pt-3 ${rail.hidden ? "" : "border-l border-[#eef0f4]"}`} aria-label="Panels">
            {editing && !v3 && <RailButton on={!rail.hidden && tab === "look"} onClick={() => setTab("look")} icon={<Palette className="h-[22px] w-[22px]" />} label="Look" />}
            {/* Studio v2 (Andrew, 26 Nov: "Let's go back to simplicity. StreamYard has it right"): one place per job. */}
            {/* Show first and open on load (Andrew, 26 Nov: "I just don't like it when it starts out just with banners"). */}
            {v3 && owner && <RailButton on={!rail.hidden && tab === "show"} onClick={() => setTab("show")} icon={<LayoutDashboard className="h-[22px] w-[22px]" />} label="Show" testId="rail-show" />}
            {v3 && <RailButton on={!rail.hidden && tab === "banners"} onClick={() => setTab("banners")} icon={<Type className="h-[22px] w-[22px]" />} label="Banners" testId="rail-banners" />}
            {v3 && <RailButton on={!rail.hidden && tab === "media"} onClick={() => setTab("media")} icon={<ImageIcon className="h-[22px] w-[22px]" />} label="Media" />}
            {v3 && <RailButton on={!rail.hidden && tab === "style"} onClick={() => setTab("style")} icon={<Palette className="h-[22px] w-[22px]" />} label="Style" />}
            {v3 && <RailButton on={!rail.hidden && tab === "sounds"} onClick={() => setTab("sounds")} icon={<Music className="h-[22px] w-[22px]" />} label="Sounds" testId="rail-sounds" />}
            {v3 && owner && <RailButton on={!rail.hidden && tab === "tips"} onClick={() => setTab("tips")} icon={<Lightbulb className="h-[22px] w-[22px]" />} label="Starters" testId="rail-tips" />}
            <RailButton on={!rail.hidden && tab === "people"} onClick={() => setTab("people")} icon={<Users className="h-[22px] w-[22px]" />} label="People" />
            <RailButton on={!rail.hidden && tab === "notes"} green={prompterOn} onClick={() => setTab("notes")} icon={<NotebookPen className="h-[22px] w-[22px]" />} label={notesLabel} testId="rail-notes" />
            {owner && <RailButton on={!rail.hidden && tab === "recording"} onClick={() => setTab("recording")} icon={<Circle className={`h-[22px] w-[22px] ${rec ? "fill-[#d92d20] text-[#d92d20]" : ""}`} />} label="Recording" />}
            <RailButton on={!rail.hidden && tab === "chat"} onClick={() => setTab("chat")} icon={<MessageSquare className="h-[22px] w-[22px]" />} label="Chat" />
          </nav>
        </aside>
        </>}
      </div>

      {sheet && owner && studio && <GoLiveSheet studio={studio} onClose={() => setSheet(false)} onAdd={() => { setSheet(false); setAddDest(true); }} />}
      {addDest && owner && studio && <AddDestinationSheet studio={studio} onClose={() => setAddDest(false)} />}
      {askPractice && <PracticeAsk what={askPractice} onCancel={() => setAskPractice(null)} onGo={() => { const what = askPractice; setAskPractice(null); practice.set(false); if (what === "record") void record(true); else goLive(); }} />}
      {settings && <SettingsSheet onClose={() => setSettings(false)} blur={<><BlurSwitch on={blurOn} state={blurState} onChange={setBlurOn} /><BlurNote state={blurState} /></>} />}
      {leaving && <LeaveDialog live={!!live} onEnd={() => void endAndLeave()} onKeep={() => { setLeaving(false); void go(); }} onCancel={() => { exitTo.current = null; setLeaving(false); }} />}
    </div>
  );
}

/** Record or Go live with the practice guest in: take it off first, so what the host sees is what goes out. */
function PracticeAsk({ what, onGo, onCancel }: { what: "record" | "live"; onGo: () => void; onCancel: () => void }) {
  const pg = usePractice();
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onCancel]);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(16,24,40,0.45)] p-4" onClick={onCancel}>
      <div role="dialog" aria-labelledby="practice-ask" className="w-full max-w-[420px] rounded-2xl bg-white p-6 shadow-[0_24px_48px_rgba(16,24,40,0.25)]" onClick={(e) => e.stopPropagation()} data-testid="practice-ask">
        <div className="flex items-center gap-3">
          <img src={pg.face} alt="" className="h-10 w-10 rounded-full object-cover" />
          <h2 id="practice-ask" className="text-balance text-lg font-bold">Remove the practice guest?</h2>
        </div>
        <p className="mt-2.5 text-sm leading-relaxed text-[#475467]">{pg.name} is only for trying out your scenes, and is never in a recording or a live show.</p>
        <div className="mt-5 flex justify-end gap-2.5">
          <button type="button" onClick={onCancel} className="h-[42px] rounded-xl border border-[#d0d5dd] bg-white px-4 text-sm font-semibold">Cancel</button>
          <button type="button" onClick={onGo} className="h-[42px] rounded-xl px-[18px] text-sm font-bold text-white" style={{ background: NAVY }} data-testid="practice-ask-go">{what === "record" ? "Remove and record" : "Remove and go live"}</button>
        </div>
      </div>
    </div>
  );
}

/** Leaving while live or recording: end it, or keep it going for the people still in the studio. */
export function LeaveDialog({ live, onEnd, onKeep, onCancel }: { live: boolean; onEnd: () => void; onKeep: () => void; onCancel: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onCancel]);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(16,24,40,0.55)] p-4" onClick={onCancel}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="leave-title" className="w-full max-w-[420px] rounded-2xl bg-white p-6 shadow-[0_24px_48px_rgba(16,24,40,0.28)]" onClick={(e) => e.stopPropagation()} data-testid="leave-dialog">
        <p id="leave-title" className="text-balance text-xl font-bold tracking-tight">{live ? "You're live. End the show or keep it going?" : "You're recording. Stop or keep it going?"}</p>
        <p className="mt-2 text-[14px] leading-relaxed text-[#475467]">{live ? "If you keep it live, your guests carry on without you. The recording keeps going too." : "If you keep recording, it carries on with your guests until you come back and stop it."}</p>
        <div className="mt-5 flex flex-col gap-2.5">
          <button type="button" onClick={onEnd} className="h-12 rounded-xl bg-[#d92d20] text-[15px] font-bold text-white hover:bg-[#b42318]" data-testid="leave-end">{live ? "End live and leave" : "Stop recording and leave"}</button>
          <button type="button" onClick={onKeep} className="h-12 rounded-xl border border-[#d0d5dd] bg-white text-[15px] font-bold text-[#344054] hover:bg-[#f9fafb]" data-testid="leave-keep">{live ? "Leave, keep it live" : "Leave, keep recording"}</button>
          <button type="button" autoFocus onClick={onCancel} className="h-11 rounded-xl text-[15px] font-semibold text-[#475467] hover:bg-[#f2f4f7]" data-testid="leave-cancel">Cancel</button>
        </div>
      </div>
    </div>
  );
}

/** `wide`: only at lg and up (a side panel opens), at the given width if a string. `green`: something it controls is on. */
function BarButton({ label, onClick, off, active, wide, green, children }: { label: string; onClick: () => void; off?: boolean; active?: boolean; wide?: boolean | string; green?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active || off ? true : undefined} className={`${wide ? "hidden lg:flex" : "flex"} relative h-[58px] flex-col items-center justify-center gap-1 rounded-xl text-center text-[11px] font-semibold leading-tight sm:text-xs ${typeof wide === "string" ? wide : "w-[54px] sm:w-[76px]"} ${off ? "bg-[#fef3f2] text-[#b42318]" : green ? "bg-[#ecfdf3] text-[#067647] hover:bg-[#dcfae6]" : active ? "bg-[#eef3fb] text-[#053877]" : "text-[#344054] hover:bg-[#f2f4f7]"}`} data-testid={green ? "bar-prompter-on" : undefined}>
      {green && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#17b26a]" aria-hidden="true" />}
      {children}{label}{green && <span className="sr-only"> (on)</span>}
    </button>
  );
}

/** `green`: what it opens is on (the teleprompter), with a dot, whether or not its panel is open. */
function RailButton({ on, onClick, icon, label, green, testId }: { on: boolean; onClick: () => void; icon: ReactNode; label: string; green?: boolean; testId?: string }) {
  return (
    <button type="button" onClick={onClick} aria-current={on ? "page" : undefined} className={`relative flex w-[88px] flex-col items-center gap-1 rounded-xl pb-[7px] pt-[9px] text-[11px] ${green ? `bg-[#ecfdf3] text-[#067647] ${on ? "font-bold ring-1 ring-inset ring-[#abefc6]" : "font-semibold hover:bg-[#dcfae6]"}` : on ? "bg-[#eef3fb] font-bold text-[#053877]" : "font-semibold text-[#667085] hover:bg-[#f9fafb]"}`} data-testid={testId} data-on={green ? "yes" : undefined}>
      {green && <span className="absolute right-3 top-2 h-2 w-2 rounded-full bg-[#17b26a]" aria-hidden="true" />}
      {icon}{label}{green && <span className="sr-only"> (on)</span>}
    </button>
  );
}

/* ── The stage and its layouts ── */

function useStageTracks() {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }, { source: Track.Source.ScreenShare, withPlaceholder: false }], { onlySubscribed: false });
  const cams = tracks.filter((t) => t.source === Track.Source.Camera && !isPlayer(t.participant))
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
  const playing = kit.live.playing;
  const clip = playing && (playing.slot === "intro" || playing.slot === "outro") ? look?.[playing.slot] : null;
  const card = playing && !clip && playing.slot !== "intro" && playing.slot !== "outro" ? playing : null;
  if (!cams.length && !screens.length) body = <div className="flex h-full items-center justify-center text-center text-[15px] font-semibold text-white/80">No one is on the stage in this scene</div>;

  return (
    <div className="relative shrink-0 overflow-hidden rounded-2xl shadow-[0_12px_32px_rgba(16,24,40,0.22)]" style={{ width: STAGE_W, aspectRatio: "16 / 9", background }} data-testid="my-studio-stage">
      <div className={`absolute inset-x-[4.5%] top-[12.5%] transition-[bottom] duration-300 ${banner ? "bottom-[17%]" : "bottom-[8%]"}`}>{body}</div>
      {logo && <img src={logo} alt="Your show's logo" className={`absolute h-[11%] max-h-[50px] w-auto rounded-md object-contain ${corner.startsWith("b") ? (banner ? "bottom-[17%]" : "bottom-4") : "top-2"} ${corner.endsWith("l") ? "left-4" : "right-4"}`} />}
      {banner && <div className="absolute bottom-[3%] left-[4.5%] max-w-[80%] truncate rounded-lg bg-[#053877] px-4 py-2 text-[15px] font-bold text-white shadow-[0_6px_18px_rgba(0,0,0,0.3)]" data-testid="stage-banner">{banner.text}</div>}
      {card && <LiveCard p={card} />}
      {clip && <video key={clip.id} src={clip.url} autoPlay muted playsInline onEnded={() => kit.play(null)} onError={() => kit.play(null)} className="absolute inset-0 h-full w-full bg-black object-contain" data-testid="stage-clip" />}
    </div>
  );
}

/** Our ready-made cards as guests see them (the host sees Engineering's RoomStage). The countdown ends on "We're starting". */
function LiveCard({ p }: { p: Playing }) {
  const now = useNow();
  const left = p.slot === "countdown" ? Math.max(0, Math.round(((p.minutes ?? 5) * 60_000 - (now - p.at)) / 1000)) : 0;
  const text = p.slot === "brb" ? "Be right back" : p.slot === "soon" ? "Starting soon" : p.slot === "thanks" ? "Thank you for watching" : left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "We're starting";
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[rgba(5,18,48,0.88)] text-center text-white" data-testid="stage-card">
      {p.slot === "countdown" && left > 0 && <p className="text-[15px] font-semibold uppercase tracking-[0.12em] text-white/70">Starting in</p>}
      <p className={`font-bold tracking-tight ${p.slot === "countdown" && left ? "text-6xl tabular-nums" : "text-4xl"}`}>{text}</p>
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
const roleOf = (p: Participant) => p.attributes?.displayTitle || p.attributes?.title || (p.attributes?.role === "host" ? "Host" : "Guest");

function Tile({ t, big, small }: { t: TrackReferenceOrPlaceholder; big?: boolean; small?: boolean }) {
  const speaking = useIsSpeaking(t.participant);
  const nameOff = useParticipantAttribute("showName", { participant: t.participant }) === "0";
  const name = t.participant.name || t.participant.identity;
  const shows = isTrackReference(t) && !t.publication.isMuted && !!t.publication.track;
  const screen = t.source === Track.Source.ScreenShare;
  return (
    <div className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-[#16264a] ${speaking && !screen ? "ring-[3px] ring-[rgba(18,183,106,0.9)]" : ""}`}>
      {shows && isTrackReference(t) ? <VideoTrack trackRef={t} className={`h-full w-full ${screen ? "object-contain" : "object-cover"} ${t.participant.isLocal && !screen ? "-scale-x-100" : ""}`} />
        : <div className={`flex items-center justify-center rounded-full bg-[#3a4f80] font-bold text-white ${small ? "h-10 w-10 text-sm" : big ? "h-28 w-28 text-4xl" : "h-24 w-24 text-3xl"}`}>{initials(name)}</div>}
      {!small && !(nameOff && !screen) && <div className="absolute bottom-3 left-3 max-w-[85%] truncate rounded-full bg-[rgba(5,18,48,0.78)] px-3 py-1.5 text-[13px] font-semibold text-white">{screen ? `${name}'s screen` : name}{!screen && <span className="font-medium text-[#9bb6e8]"> · {roleOf(t.participant)}</span>}</div>}
      {small && !nameOff && <div className="absolute bottom-1.5 left-2 max-w-[85%] truncate rounded-full bg-[rgba(5,18,48,0.78)] px-2 py-0.5 text-[11px] font-semibold text-white">{name}</div>}
      {speaking && !screen && !small && <Meter p={t.participant} />}
    </div>
  );
}

/** Everyone in the room. The owner brings guests on stage or sends them backstage (phase 2). */
function PeopleStrip({ kit, owner, sharing, onShare, onInvite }: { kit: RoomKit; owner: boolean; sharing: boolean; onShare: () => void; onInvite: () => void }) {
  const { cams } = useStageTracks();
  const scenes = !!kit.look;
  // The bigger tiles (21 Nov) mean only two fit beside the + on a laptop, so a third person sat
  // hidden in the scroll. Arrows show only when there is more to see that way.
  const row = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = row.current;
    if (!el) return;
    const left = el.scrollLeft > 2, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  }, []);
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);
  useEffect(measure, [cams.length, measure]);
  const nudge = (dir: 1 | -1) => {
    row.current?.scrollBy({ left: dir * 188, behavior: "smooth" });
    window.setTimeout(measure, 450); // a smooth scroll doesn't always send its last scroll event
  };
  return (
    // The + sits outside the scrolling row: a scrolling row clips anything that pops out of it, so
    // its menu never showed (Andrew, 21 Nov: "This doesn't work").
    // Present or invite sits straight after the last person, not pushed to the far right (Andrew,
    // 21 Nov: "should be to the right next to the first card"): the row takes only the room its tiles
    // need and shrinks (then scrolls) when they don't fit. gap-2 plus the row's p-1 = the gap-3 between tiles.
    <div className="mt-3 flex w-full shrink-0 gap-2" style={{ maxWidth: STAGE_W }}>
    <div className="relative flex min-w-0">
    <div ref={row} onScroll={measure} className="flex min-w-0 gap-3 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="my-studio-strip">
      {cams.map((t) => <PersonTile key={key(t)} t={t} kit={kit} owner={owner} scenes={scenes} />)}
      {owner && <PracticeTile scenes={scenes} />}
    </div>
      {more.left && <button type="button" onClick={() => nudge(-1)} aria-label="Show earlier people" className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-[#d0d5dd] bg-white text-[#344054] shadow-[0_1px_3px_rgba(16,24,40,0.18)] hover:bg-[#f9fafb]" data-testid="strip-scroll-left"><ChevronLeft className="h-4 w-4" /></button>}
      {more.right && <button type="button" onClick={() => nudge(1)} aria-label="Show more people" className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-[#d0d5dd] bg-white text-[#344054] shadow-[0_1px_3px_rgba(16,24,40,0.18)] hover:bg-[#f9fafb]" data-testid="strip-scroll-right"><ChevronRight className="h-4 w-4" /></button>}
    </div>
      <PresentButton kit={kit} owner={owner} sharing={sharing} canPresent={scenes && owner} onShare={onShare} onInvite={onInvite} />
    </div>
  );
}

/** The practice guest's card in the row: their guide's picture, the name tag, and one click to remove it. */
function PracticeTile({ scenes }: { scenes: boolean }) {
  const pg = usePractice();
  if (!pg.on) return null;
  return (
    <div className={`relative w-44 shrink-0 overflow-hidden rounded-xl border-2 border-dashed bg-white ${scenes ? "border-[#F0A71F]" : "border-[#d0d5dd]"}`} data-testid="strip-practice">
      <div className="relative aspect-video w-full bg-[#e4e7ec]"><img src={pg.face} alt="" className="h-full w-full object-cover" /></div>
      <button type="button" onClick={() => practice.set(false)} className="absolute right-2.5 top-2.5 flex h-7 items-center gap-1 rounded-full bg-white px-2.5 text-xs font-bold text-[#344054] shadow-[0_1px_3px_rgba(16,24,40,0.25)] hover:bg-[#f2f4f7]" data-testid="practice-remove"><X className="h-3.5 w-3.5" /> Remove</button>
      <div className="flex h-8 items-center gap-1.5 px-2 text-left text-xs font-semibold">
        <UserRound className="h-3.5 w-3.5 shrink-0 text-[#667085]" />
        <span className="min-w-0 flex-1 truncate">{PRACTICE_NAME}</span>
        <span className="shrink-0 text-[11px] font-semibold text-[#667085]">Not recorded</span>
      </div>
    </div>
  );
}

/**
 * One person in the row (StreamYard's person tile, 21 Nov): their picture, a mic light (red when
 * muted, a green ring while they talk), and for the owner on a guest, a ⋯ menu: on stage or
 * backstage, mute their mic, remove them from the studio.
 */
function PersonTile({ t, kit, owner, scenes }: { t: TrackReferenceOrPlaceholder; kit: RoomKit; owner: boolean; scenes: boolean }) {
  const { toast } = useToast();
  const p = t.participant;
  const name = p.name || p.identity;
  const on = kit.isOnStage(p.identity, p.attributes?.stage);
  const guest = p.identity.startsWith("guest-");
  const cam = isExtraCam(p.identity);
  const micPub = p.getTrackPublication(Track.Source.Microphone);
  const muted = useIsMuted(micPub ? { participant: p, source: Track.Source.Microphone, publication: micPub } : { participant: p, source: Track.Source.Microphone });
  const speaking = useIsSpeaking(p);
  const [menu, setMenu] = useState<null | { x: number; y: number; confirm?: boolean }>(null);
  const [busy, setBusy] = useState(false);
  const first = name.split(/\s+/)[0] || "them";
  const act = async (url: string, fail: string) => {
    setBusy(true);
    try { await apiRequest("POST", url, { identity: p.identity }); setMenu(null); }
    catch (e) { toast({ title: fail, description: say(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const open = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Fixed to the screen: the row scrolls sideways, and a scrolling row clips anything that pops out of it.
    const r = e.currentTarget.getBoundingClientRect();
    setMenu(menu ? null : { x: Math.max(8, Math.min(window.innerWidth - 248, r.right - 240)), y: r.top - 8 });
  };
  // It's pinned to where the ⋯ was, so a resize (a phone turning) or Escape closes it.
  const isOpen = !!menu;
  useEffect(() => {
    if (!isOpen) return;
    const close = () => setMenu(null);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("resize", close);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("resize", close); window.removeEventListener("keydown", key); };
  }, [isOpen]);
  const item = "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] font-medium text-[#101828] hover:bg-[#f2f4f7] disabled:cursor-default disabled:text-[#98a2b3] disabled:hover:bg-transparent";
  return (
    // StreamYard's tile (Andrew, 21 Nov: "should look like 2nd image"): the picture on top, mic and ⋯
    // in one pill over it, the name underneath. On stage shows as a gold edge, talking as a green ring.
    <div className={`relative w-44 shrink-0 overflow-hidden rounded-xl border-2 bg-white ${scenes && on ? "border-[#F0A71F]" : "border-[#e4e7ec]"} ${speaking && !muted ? "ring-2 ring-[#12b76a] ring-offset-1" : ""} ${on ? "" : "opacity-70"}`} data-testid="strip-person" data-on-stage={on ? "yes" : "no"}>
      <div className="relative aspect-video w-full bg-[#e4e7ec]"><MiniFace t={t} /></div>
      <div className="absolute right-2.5 top-2.5 flex h-7 items-center gap-0.5 rounded-full bg-white px-1 shadow-[0_1px_3px_rgba(16,24,40,0.25)]">
        {cam ? <span className="flex h-6 w-6 items-center justify-center text-[#475467]" aria-label="Extra camera"><Video className="h-4 w-4" /></span>
          : <span className={`flex h-6 w-6 items-center justify-center rounded-full ${muted ? "text-[#d92d20]" : speaking ? "text-[#067647]" : "text-[#475467]"}`} data-testid="strip-mic" aria-label={muted ? "Mic off" : "Mic on"}>{muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}</span>}
        {owner && (guest || cam) && (
          <button type="button" onClick={open} aria-label={`More for ${name}`} aria-expanded={!!menu} className="flex h-6 w-6 items-center justify-center rounded-full text-[#344054] hover:bg-[#f2f4f7]" data-testid="strip-more"><MoreHorizontal className="h-4 w-4" /></button>
        )}
      </div>
      <div className="flex h-8 items-center gap-1.5 px-2 text-left text-xs font-semibold">
        {cam ? <Video className="h-3.5 w-3.5 shrink-0 text-[#667085]" /> : <UserRound className="h-3.5 w-3.5 shrink-0 text-[#667085]" />}
        <span className="min-w-0 flex-1 truncate">{name}{p.isLocal ? " (you)" : ""}</span>
        {scenes && !on && <span className="shrink-0 text-[11px] font-semibold text-[#667085]" data-testid="strip-backstage">Backstage</span>}
      </div>
      {menu && (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-30 cursor-default" onClick={() => setMenu(null)} />
          <div className="fixed z-40 w-60 -translate-y-full rounded-xl border border-[#e4e7ec] bg-white p-1.5 shadow-[0_12px_32px_rgba(16,24,40,0.18)]" style={{ left: menu.x, top: menu.y }} data-testid="strip-person-menu">
            {menu.confirm ? (
              <div className="p-2.5">
                <p className="text-sm font-semibold">Remove {name} from the studio?</p>
                <p className="mt-1 text-[13px] text-[#667085]">They leave the studio and the show. They can come back on your invite link.</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" disabled={busy} onClick={() => void act("/api/host/my-studio/remove", `Couldn't remove ${first}`)} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#d92d20] text-[13px] font-bold text-white disabled:opacity-60" data-testid="strip-remove-yes">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Remove</button>
                  <button type="button" onClick={() => setMenu(null)} className="h-9 flex-1 rounded-lg bg-white text-[13px] font-semibold text-[#344054] ring-1 ring-[#d0d5dd]">Cancel</button>
                </div>
              </div>
            ) : <>
              {scenes && <button type="button" onClick={() => { setMenu(null); void kit.backstage(p.identity, !on); }} className={item}><Users className="h-[18px] w-[18px]" /> {on ? "Send backstage" : "Bring on stage"}</button>}
              {cam ? <>
                {scenes && <div className="my-1 h-px bg-[#eaecf0]" />}
                <button type="button" onClick={() => { setMenu(null); void stopExtraCamera(p.identity); }} className={`${item} text-[#b42318]`} data-testid="strip-cam-off"><VideoOff className="h-[18px] w-[18px]" /> Turn off this camera</button>
              </> : <>
                <button type="button" disabled={muted || busy} onClick={() => void act("/api/host/my-studio/mute", `Couldn't mute ${first}`)} className={item} data-testid="strip-mute"><MicOff className="h-[18px] w-[18px]" /> {muted ? "Their mic is off" : `Mute ${first}'s mic`}</button>
                <div className="my-1 h-px bg-[#eaecf0]" />
                <button type="button" onClick={() => setMenu({ ...menu, confirm: true })} className={`${item} text-[#b42318]`} data-testid="strip-remove"><LogOut className="h-[18px] w-[18px]" /> Remove from studio</button>
              </>}
            </>}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The video on stage, heard in the studio (clipSound.ts): the intro or outro while it plays, or a
 * media scene's video. A play-once clip goes back to the scene before it when it ends. That's the
 * clip's own end, never a clock on someone talking, so the live-switching rule holds.
 */
function StageClipSound({ kit }: { kit: RoomKit }) {
  const look = kit.look;
  const p = kit.live.playing;
  const scene = look ? sceneLive(look, kit.live) : undefined;
  const heard = (a?: Asset | null) => !!a?.url && !(a.mime ?? "").startsWith("image");
  let clip: StageClip | null = null;
  if (look && p && (p.slot === "intro" || p.slot === "outro")) {
    const a = look[p.slot];
    if (heard(a)) clip = { key: `${p.slot}:${a!.id}`, url: a!.url, loop: false, sec: a!.sec };
  } else if (!p && scene && heard(scene.media) && (scene.type === "media" || scene.boxes?.some((b) => b.kind === "media"))) {
    const loop = scene.loop === true;
    clip = { key: `${scene.id}:${scene.media!.id}:${loop}`, url: scene.media!.url, loop, sec: scene.media!.sec };
  }
  const sceneId = scene?.id;
  // The intro and outro end through the preview (kit.play(null)); a play-once scene goes back here.
  // Back to the scene before it when the STAGE's copy ends, not this sound: the stage (like the filmed page) starts
  // the clip at its first frame, up to a few seconds after Play, so going back on this sound would cut its end.
  const waiting = useRef<() => void>();
  useEffect(() => () => waiting.current?.(), [clip?.key]);
  const held = useRef(false);
  held.current = !!sceneId && kit.live.clip?.scene === sceneId && kit.live.clip.paused === true;
  useClipSound(clip, clip && !clip.loop && !p ? () => {
    waiting.current?.();
    waiting.current = whenStageCopyEnds(clip.url, () => held.current, () => {
      const now = kit.look ? sceneLive(kit.look, kit.live) : undefined;
      if (now?.id === sceneId && !kit.live.playing) kit.stopPresenting(sceneId);
    });
  } : undefined, !p && sceneId && kit.live.clip?.scene === sceneId ? kit.live.clip : null);
  return null;
}

/**
 * Calls `done` once the stage's own copy of the clip (`url`, in [data-stage-root]) has ended. While it plays, the
 * deadline follows what's left of it (plus 1.5 s); while the host has it paused (the player bar), it waits; a copy
 * the browser stalled (a hidden tab pauses muted video) lets go when its time is up; when the stage never draws it
 * (4 s), it's done at once. Returns a cancel.
 */
function whenStageCopyEnds(url: string, hostPaused: () => boolean, done: () => void): () => void {
  const start = Date.now();
  let deadline = 0;
  let over = false;
  const finish = () => { if (over) return; over = true; window.clearInterval(t); done(); };
  const t = window.setInterval(() => {
    const v = Array.from(document.querySelectorAll<HTMLVideoElement>("[data-stage-root] video")).find((x) => (x.currentSrc || x.src).endsWith(url) || x.src === new URL(url, window.location.href).href);
    if (!v) { if (Date.now() - start > 4000) finish(); return; }
    if (v.ended) { finish(); return; }
    if (hostPaused()) { deadline = 0; return; }
    // Not loaded yet: count the clip's whole length from now.
    const left = Number.isFinite(v.duration) && v.duration > 0 ? Math.max(0, v.duration - v.currentTime) : 30;
    if (!v.paused || !deadline) deadline = Date.now() + left * 1000 + 1500;
    if (Number.isFinite(v.duration) && v.duration > 0 && left <= 0.05) finish();
  }, 200);
  // A copy that stops updating (a frozen tab) still lets go once its time is up.
  const guard = window.setInterval(() => { if (deadline && Date.now() > deadline) { window.clearInterval(guard); finish(); } if (over) window.clearInterval(guard); }, 500);
  return () => { over = true; window.clearInterval(t); window.clearInterval(guard); };
}

const mmss = (t: number) => (Number.isFinite(t) && t > 0 ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}` : "0:00");

/**
 * The clip on air, for the host only (never filmed): Pause / Play, From the start, Stop, and where it is
 * (Andrew, 24 Nov: "I don't see a stop and play"). Everyone's copy follows. The space bar pauses too,
 * unless they're typing. Under it, what happens next: back to the scene before it, or it loops.
 */
function ClipBar({ kit }: { kit: RoomKit }) {
  const el = useStageClipElement();
  const scene = kit.look ? sceneLive(kit.look, kit.live) : undefined;
  const on = !!el && !kit.live.playing && isClipScene(scene);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!on || !el) return;
    const t = window.setInterval(() => tick((x) => x + 1), 250);
    return () => window.clearInterval(t);
  }, [on, el]);
  const paused = !!scene && kit.live.clip?.scene === scene.id && kit.live.clip.paused === true;
  const toggle = () => { if (el) void kit.clipAct(paused ? "play" : "pause", el.currentTime); };
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    if (!on) return;
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.code !== "Space" || e.repeat || e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName)))) return;
      e.preventDefault();
      toggleRef.current();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [on]);
  if (!on || !el || !scene) return null;
  const len = el.duration || scene.media?.sec || 0;
  const at = Math.min(el.currentTime, len || el.currentTime);
  const back = kit.backOf(scene.id);
  const btn = "flex h-8 w-8 items-center justify-center rounded-lg text-[#344054] hover:bg-[#f2f4f7]";
  return (
    <div className="mt-3 w-full max-w-[560px] shrink-0" data-testid="clip-bar">
      <div className="flex items-center gap-1.5 rounded-xl border border-[#e4e7ec] bg-white px-2 py-1.5 shadow-[0_2px_8px_rgba(16,24,40,0.06)]">
        <button type="button" onClick={toggle} className={btn} aria-label={paused ? "Play" : "Pause"} title={paused ? "Play (space)" : "Pause (space)"} data-testid="clip-toggle">{paused ? <Play className="h-4 w-4 fill-current" /> : <Pause className="h-4 w-4 fill-current" />}</button>
        <button type="button" onClick={() => void kit.clipAct("restart", 0)} className={btn} aria-label="From the start" title="From the start" data-testid="clip-restart"><RotateCcw className="h-4 w-4" /></button>
        <button type="button" onClick={() => kit.stopPresenting(scene.id)} className={btn} aria-label="Stop" title={back ? `Stop: back to ${back.name}` : "Stop"} data-testid="clip-stop"><Square className="h-3.5 w-3.5 fill-current" /></button>
        <div className="mx-1.5 h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#eaecf0]"><div className="h-full rounded-full bg-[#053877]" style={{ width: `${len ? Math.min(100, (at / len) * 100) : 0}%` }} /></div>
        <span className="shrink-0 pr-1 text-[12px] font-semibold tabular-nums text-[#475467]" data-testid="clip-time">{mmss(at)} / {mmss(len)}</span>
      </div>
      <p className="mt-1 px-1 text-[11.5px] text-[#667085]" data-testid="clip-next">{scene.loop === true ? "It loops until you pick another scene." : back ? `Back to ${back.name} when it ends.` : "It plays once."}</p>
    </div>
  );
}

/**
 * Slides on air: ‹ Slide 3 of 12 › over the host's own preview (never in the program), and the ← →
 * keys (Page Up / Page Down too, which most clickers send) while nobody's typing. Each turn puts that
 * page on the Presenting scene.
 */
function SlidesBar({ kit }: { kit: RoomKit }) {
  const { deck } = useDeck(true);
  const look = kit.look;
  const onAir = look ? sceneLive(look, kit.live) : undefined;
  const pages = deck?.pages ?? [];
  const i = onAir && onAir.type === "media" && onAir.name === PRESENT_NAME && onAir.media ? pages.findIndex((p) => p.id === onAir.media?.id) : -1;
  const show = i >= 0;
  const turn = (j: number) => {
    if (!onAir || j < 0 || j >= pages.length || j === i) return;
    const page = pages[j];
    kit.change((l) => ({ ...l, scenes: l.scenes.map((x) => (x.id === onAir.id ? { ...x, media: page } : x)) }));
  };
  const turnRef = useRef(turn);
  turnRef.current = turn;
  useEffect(() => {
    if (!show) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); turnRef.current(i + 1); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); turnRef.current(i - 1); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [show, i]);
  if (!show) return null;
  const btn = "flex h-9 w-9 items-center justify-center rounded-full text-white hover:bg-white/15 disabled:opacity-35";
  return (
    <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[rgba(4,12,32,0.82)] px-1.5 py-1 text-white shadow-lg" data-testid="slides-bar">
      <button type="button" onClick={() => turn(i - 1)} disabled={i === 0} className={btn} aria-label="Previous slide" data-testid="slides-prev"><ChevronLeft className="h-5 w-5" /></button>
      <span className="min-w-[96px] text-center text-[13px] font-semibold tabular-nums" data-testid="slides-count">Slide {i + 1} of {pages.length}</span>
      <button type="button" onClick={() => turn(i + 1)} disabled={i === pages.length - 1} className={btn} aria-label="Next slide" data-testid="slides-next"><ChevronRight className="h-5 w-5" /></button>
    </div>
  );
}

/**
 * "Present or invite" (Andrew, 21 Nov, from StreamYard's own): a video or picture of yours fills the
 * stage, your screen, or a guest's link. A file goes onto one Presenting scene that's put on air at
 * once; Stop presenting goes back to the scene before it.
 */
function PresentButton({ kit, owner, sharing, canPresent, onShare, onInvite }: { kit: RoomKit; owner: boolean; sharing: boolean; canPresent: boolean; onShare: () => void; onInvite: () => void }) {
  const { toast } = useToast();
  const [menu, setMenu] = useState<"" | "menu" | "rights" | "cams">("");
  const [busy, setBusy] = useState<string | null>(null);
  const [free, setFree] = useState<MediaDeviceInfo[] | null>(null);
  const video = useRef<HTMLInputElement | null>(null);
  const image = useRef<HTMLInputElement | null>(null);
  const pdf = useRef<HTMLInputElement | null>(null);
  // Off by default (Andrew, 24 Nov): a video plays once, then the stage goes back to the scene before it.
  const [loop, setLoop] = useState(false);
  const { localParticipant } = useLocalParticipant();
  const { deck, save: saveDeck } = useDeck(owner);
  const extra = useExtraCams();
  const look = kit.look;
  const onAir = look ? sceneLive(look, kit.live) : undefined;
  const presenting = isPresenting(onAir) && !!onAir!.media;
  const practiceOn = usePractice().on;

  const roomForScene = () => {
    if (!look) return false;
    const reuse = look.scenes.find((x) => isPresenting(x));
    if (!reuse && look.scenes.length >= LIMITS.scenes) { toast({ title: `You have ${LIMITS.scenes} scenes`, description: "Delete one, then present your file.", variant: "destructive" }); return false; }
    return true;
  };

  const present = async (f: File | undefined, kind: "video" | "photo") => {
    if (!f || !roomForScene()) return;
    setBusy("Uploading 0%");
    try {
      if (kind === "video") void warmClipSound().catch(() => {}); // the room's sound connection, ready before the clip starts
      kit.present(await kit.addAsset(kind, f, (p) => setBusy(`Uploading ${p}%`), kind === "video" ? true : undefined), kind === "video" && loop);
    } catch (e) { toast({ title: kind === "video" ? "Couldn't present that video" : "Couldn't present that picture", description: say(e), variant: "destructive" }); }
    finally { setBusy(null); if (video.current) video.current.value = ""; if (image.current) image.current.value = ""; }
  };

  /** A PDF: each page a picture, the deck kept for the arrows, page 1 on air. The last deck's pages are then deleted. */
  const presentSlides = async (f: File | undefined) => {
    if (!f || !roomForScene()) return;
    const old = deck?.pages ?? [];
    setBusy("Reading slides");
    try {
      const pictures = await pdfToPictures(f, (i, n) => setBusy(`Preparing ${i} of ${n}`));
      const pages: Asset[] = [];
      for (let i = 0; i < pictures.length; i++) pages.push(await kit.addAsset("photo", pictures[i], () => setBusy(`Uploading ${i + 1} of ${pictures.length}`)));
      await saveDeck(f.name.replace(/\.pdf$/i, ""), pages);
      kit.present(pages[0]);
      for (const a of old) void apiRequest("DELETE", `/api/host/room/assets/${encodeURIComponent(a.id)}`).catch(() => {});
    } catch (e) { toast({ title: "Couldn't present those slides", description: say(e), variant: "destructive" }); }
    finally { setBusy(null); if (pdf.current) pdf.current.value = ""; }
  };

  const openCams = async () => {
    setMenu("cams"); setFree(null);
    const using = (localParticipant.getTrackPublication(Track.Source.Camera)?.track?.mediaStreamTrack.getSettings().deviceId) ?? "";
    try { setFree(await freeCameras(using ? [using] : [])); } catch { setFree([]); }
  };
  const addCam = async (d: MediaDeviceInfo) => {
    setMenu(""); setBusy("Adding camera");
    try { await addExtraCamera(d, localParticipant.name || "You"); }
    catch (e) { toast({ title: "Couldn't add that camera", description: say(e), variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const stop = () => kit.stopPresenting();

  const item = "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[15px] font-medium text-[#101828] hover:bg-[#f2f4f7]";
  const pick = (fn: () => void) => () => { setMenu(""); fn(); };
  return (
    <div className="relative shrink-0 py-1">
      <button type="button" onClick={() => setMenu(menu ? "" : "menu")} disabled={busy !== null} aria-expanded={!!menu} className={`flex h-[135px] w-32 flex-col sm:w-44 items-center justify-center gap-2.5 rounded-xl border-2 bg-white text-[13px] font-semibold text-[#344054] hover:bg-[#f9fafb] disabled:opacity-80 ${menu ? "border-[#84adff] ring-2 ring-[#d1e0ff]" : "border-[#e4e7ec]"}`} data-testid="strip-add">
        {busy !== null ? <><Loader2 className="h-5 w-5 animate-spin" /> {busy}</> : <>
          <span className="flex items-center gap-3 rounded-full border border-[#d0d5dd] bg-white px-4 py-2 shadow-[0_1px_2px_rgba(16,24,40,0.06)]"><MonitorUp className="h-5 w-5" />{owner && <UserPlus className="h-5 w-5" />}</span>
          {owner ? "Present or invite" : "Share your screen"}
        </>}
      </button>
      <input ref={video} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={(e) => void present(e.target.files?.[0], "video")} />
      <input ref={image} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => void present(e.target.files?.[0], "photo")} />
      <input ref={pdf} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void presentSlides(e.target.files?.[0])} data-testid="present-pdf-input" />
      {menu && (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-10 cursor-default" onClick={() => setMenu("")} />
          <div className="absolute bottom-[calc(100%+8px)] right-0 z-20 w-64 rounded-xl border border-[#e4e7ec] bg-white p-1.5 shadow-[0_12px_32px_rgba(16,24,40,0.18)]" data-testid="strip-add-menu">
            {menu === "cams" ? (
              <div className="p-1">
                <p className="px-2 pb-1 pt-1.5 text-sm font-semibold">Add another camera</p>
                <p className="px-2 pb-2 text-[13px] text-[#667085]">A second camera on this computer joins as its own picture. Put it on stage like a guest.</p>
                {free === null ? <p className="flex items-center gap-2 px-2 py-2 text-[13px] text-[#667085]"><Loader2 className="h-4 w-4 animate-spin" /> Looking for cameras…</p>
                  : free.length === 0 ? <p className="rounded-lg bg-[#f9fafb] px-2.5 py-2 text-[13px] text-[#475467]" data-testid="cams-none">We found no other camera on this computer. Plug one in (a USB webcam or a camera with a USB cable), then try again.</p>
                  : free.map((d) => <button key={d.deviceId} type="button" onClick={() => void addCam(d)} className={item} data-testid="cams-pick"><Video className="h-[18px] w-[18px]" /> <span className="truncate">{d.label || "Camera"}</span></button>)}
              </div>
            ) : menu === "rights" ? (
              <div className="p-2.5">
                <p className="text-sm font-semibold">Present a video</p>
                <p className="mt-1 text-[13px] text-[#667085]">It fills the stage and plays once, with its sound, for everyone in your studio and in the recording and live show. Then the stage goes back to the scene before it.</p>
                <label className="mt-3 flex items-start gap-2 text-[13px] font-medium"><input type="checkbox" className="mt-0.5" checked={loop} onChange={(e) => setLoop(e.target.checked)} data-testid="present-loop" /> Loop it until I stop presenting</label>
                <label className="mt-2 flex items-start gap-2 text-[13px] font-medium"><input type="checkbox" className="mt-0.5" onChange={(e) => { if (e.target.checked) { setMenu(""); video.current?.click(); } }} data-testid="present-rights" /> I have the rights to use this video</label>
              </div>
            ) : <>
              {canPresent && presenting && <><button type="button" onClick={pick(stop)} className={item} data-testid="present-stop"><Square className="h-[18px] w-[18px] fill-current text-[#b42318]" /> Stop presenting</button><div className="my-1 h-px bg-[#eaecf0]" /></>}
              {canPresent && <>
                <button type="button" onClick={() => setMenu("rights")} className={item} data-testid="present-video"><Clapperboard className="h-[18px] w-[18px]" /> Video file</button>
                <button type="button" onClick={pick(() => image.current?.click())} className={item} data-testid="present-image"><ImageIcon className="h-[18px] w-[18px]" /> Image file</button>
                <button type="button" onClick={pick(() => pdf.current?.click())} className={item} data-testid="present-slides"><Presentation className="h-[18px] w-[18px]" /> <span>Slides <span className="text-[13px] text-[#667085]">(PDF)</span></span></button>
                <div className="my-1 h-px bg-[#eaecf0]" />
              </>}
              <button type="button" onClick={pick(onShare)} className={item} data-testid="strip-add-screen"><MonitorUp className="h-[18px] w-[18px]" /> {sharing ? "Stop sharing screen" : "Share screen"}</button>
              {owner && extra.length < EXTRA_CAMS && <button type="button" onClick={() => void openCams()} className={item} data-testid="present-camera"><Video className="h-[18px] w-[18px]" /> Extra camera</button>}
              {owner && <><div className="my-1 h-px bg-[#eaecf0]" /><button type="button" onClick={pick(onInvite)} className={item} data-testid="strip-add-invite"><UserPlus className="h-[18px] w-[18px]" /> Invite guest</button></>}
              {owner && !practiceOn && <button type="button" onClick={pick(() => practice.set(true))} className={item} data-testid="present-practice"><UserRound className="h-[18px] w-[18px]" /> <span>Add a practice guest <span className="block text-[12px] font-normal text-[#667085]">Try your scenes. Never recorded.</span></span></button>}
            </>}
          </div>
        </>
      )}
    </div>
  );
}

/** A guest who's backstage is told so: they're in the room, not in the recording or the show. */
function Backstage({ kit }: { kit: RoomKit }) {
  const { localParticipant } = useLocalParticipant();
  // useLocalParticipant doesn't re-render on attribute changes; this does, so the notice shows the moment the host sends you backstage.
  const stage = useParticipantAttribute("stage", { participant: localParticipant });
  if (kit.isOnStage(localParticipant.identity, stage)) return null;
  return <p style={{ maxWidth: STAGE_W }} className="mt-3 w-full shrink-0 rounded-xl bg-[#fff8e6] px-4 py-2.5 text-sm font-semibold text-[#7a4e00]" data-testid="you-backstage">You're backstage. You're not in the recording or the live show until the host brings you on.</p>;
}

function MiniFace({ t }: { t: TrackReferenceOrPlaceholder }) {
  const name = t.participant.name || t.participant.identity;
  const shows = isTrackReference(t) && !t.publication.isMuted && !!t.publication.track;
  return shows && isTrackReference(t)
    ? <VideoTrack trackRef={t} className={`absolute inset-0 h-full w-full object-cover ${t.participant.isLocal ? "-scale-x-100" : ""}`} />
    : <div className="absolute inset-0 flex items-center justify-center"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#98a2b3] text-sm font-bold text-white">{initials(name)}</div></div>;
}

/* ── Right panel ── */

function PanelHead({ title, line }: { title: string; line: string }) {
  return <div className="px-5 pt-5"><p className="text-lg font-bold tracking-tight">{title}</p><p className="mt-0.5 text-[13px] text-[#667085]">{line}</p></div>;
}

function PeoplePanel({ owner, studio, onCopy, kit, meKey, showArt }: { owner: boolean; studio?: Studio; onCopy: () => void; kit: RoomKit; meKey: string; showArt: boolean }) {
  const people = useParticipants().filter((p) => !isPlayer(p));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHead title="People" line={(() => { const back = people.filter((p) => p.attributes?.stage === "off").length; return back ? `${people.length} in the studio, ${back} backstage.` : `${people.length} in the studio. Everyone here is on the stage.`; })()} />
      <ul className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto px-3">
        {people.map((p) => (
          <li key={p.identity} className={`flex flex-wrap items-center gap-3 rounded-xl px-2 py-2 ${p.isLocal ? "bg-[#f9fafb]" : "hover:bg-[#f9fafb]"}`} data-testid={p.isLocal ? "people-me" : undefined}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#3a4f80] text-xs font-bold text-white">{initials(p.name || p.identity)}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{p.name || p.identity}{p.isLocal ? " (you)" : ""}</p><p className="truncate text-xs text-[#667085]">{roleOf(p)}</p></div>
            {p.isMicrophoneEnabled ? <Mic className="h-4 w-4 text-[#475467]" aria-label="Mic on" /> : <MicOff className="h-4 w-4 text-[#b42318]" aria-label="Muted" />}
            {p.isCameraEnabled ? <Video className="h-4 w-4 text-[#475467]" aria-label="Camera on" /> : <VideoOff className="h-4 w-4 text-[#98a2b3]" aria-label="Camera off" />}
            {p.isLocal && <div className="basis-full"><MyStageRow meKey={meKey} /></div>}
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

/**
 * Your own row in People: the name on stage, and whether it shows (Andrew, 24 Nov). Saved at once,
 * remembered for this studio, and the stage, recording and live show change straight away. The show's
 * own logo is set in Media > Logo (Bottom left / Bottom right / None), the one place for it (PM, 25 Nov).
 */
function MyStageRow({ meKey }: { meKey: string }) {
  const { localParticipant } = useLocalParticipant();
  const { toast } = useToast();
  const shown = useParticipantAttribute("showName", { participant: localParticipant }) !== "0";
  const [name, setName] = useState(localParticipant.name ?? "");
  const saved = useRef(localParticipant.name ?? "");
  const saveName = async () => {
    const n = name.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!n) { setName(saved.current); return; }
    if (n === saved.current) return;
    try { await localParticipant.setName(n); saved.current = n; saveMe(meKey, { name: n }); }
    catch (e) { setName(saved.current); toast({ title: "Couldn't change your name", description: say(e), variant: "destructive" }); }
  };
  const setShown = (on: boolean) => {
    saveMe(meKey, { showName: on });
    void localParticipant.setAttributes({ showName: on ? "1" : "0" }).catch((e) => toast({ title: "Couldn't change that", description: say(e), variant: "destructive" }));
  };
  return (
    <div className="mt-1 space-y-2.5 pl-12 pb-1">
      <label className="block text-xs font-semibold text-[#475467]">
        Your name on screen
        <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={() => void saveName()} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setName(saved.current); (e.target as HTMLInputElement).blur(); } }}
          className="mt-1 block h-9 w-full rounded-lg border border-[#d0d5dd] bg-white px-2.5 text-sm font-semibold text-[#101828]" data-testid="me-name" />
      </label>
      <Switch on={shown} onChange={setShown} label="Show my name" testId="me-show-name" />
    </div>
  );
}

function Switch({ on, onChange, label, testId }: { on: boolean; onChange: (on: boolean) => void; label: string; testId: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full items-center justify-between gap-3 text-left text-sm font-medium text-[#344054]" data-testid={testId}>
      {label}
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-[#053877]" : "bg-[#d0d5dd]"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${on ? "left-[18px]" : "left-0.5"}`} /></span>
    </button>
  );
}

function NotesPanel({ roomKey, text, setText, prompter, sync }: { roomKey: string; text: string; setText: (t: string) => void; prompter: boolean; sync?: NotesSync }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHead title={prompter ? "Teleprompter" : "Notes"} line={sync === undefined ? "Only you see these. They stay on this computer." : "Only you see these. They're saved to your studio, so they're here on any computer."} />
      {sync !== undefined && sync !== "" && (
        <p className={`mx-4 mt-2 text-[12px] ${sync === "error" ? "text-[#b42318]" : "text-[#667085]"}`} data-testid="notes-sync">
          {sync === "saving" ? "Saving…" : sync === "saved" ? "Saved to your studio" : "Couldn't save just now. It's kept on this computer, and we'll try again when you type."}
        </p>
      )}
      {prompter && <PrompterSwitch roomKey={roomKey} text={text} />}
      {/* Saved scripts live on the studio, so only when Notes are saved there (the owner). */}
      {prompter && sync !== undefined && <ScriptsBar roomKey={roomKey} text={text} setText={setText} />}
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

function GoLiveSheet({ studio, onClose, onAdd }: { studio: Studio; onClose: () => void; onAdd: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState(`${studio.name} · ${today()}`);
  const [busy, setBusy] = useState<"" | "patch" | "go">("");
  const [error, setError] = useState("");
  // Connect YouTube as the main way in (Andrew, 22 Nov: "Yes, build it"): admins while Google verifies the app.
  const canConnect = !!useYoutubeKey().data?.canConnect;
  const [pasting, setPasting] = useState(false);
  // "Also record to my Library" (Andrew, 22 Nov: "They may not want to go live. They just may want to record it"):
  // on by default, untick to stream only. Already recording: it stays on and can't be unticked here.
  const [alsoRecord, setAlsoRecord] = useState(true);
  const recordToo = !!studio.recording || (alsoRecord && studio.canRecord);
  const set = (s: Studio) => qc.setQueryData(["/api/host/my-studio"], s);
  const patch = async (body: Record<string, unknown>) => {
    setBusy("patch"); setError("");
    try { set((await (await apiRequest("PATCH", "/api/host/my-studio", body)).json()) as Studio); return true; }
    catch (e) { setError(say(e)); return false; }
    finally { setBusy(""); }
  };
  const ytOn = studio.youtube && studio.youtubeOn;
  const pageOn = !!studio.livePage?.on;
  const anyOn = pageOn || ytOn || studio.streams.some((s) => s.on);
  /** Their MilitaryVoices live page on or off: the same switch as Integrations → Live. */
  const togglePage = async () => {
    setBusy("patch"); setError("");
    try {
      await apiRequest("PUT", "/api/host/live-page", { on: !pageOn });
      set((await (await apiRequest("GET", "/api/host/my-studio")).json()) as Studio);
      void qc.invalidateQueries({ queryKey: ["/api/host/live-page"] });
    } catch (e) { setError(say(e)); } finally { setBusy(""); }
  };
  const start = async () => {
    setBusy("go"); setError("");
    try {
      if (recordToo && !studio.recording) set((await (await apiRequest("POST", "/api/host/my-studio/record", { on: true })).json()) as Studio);
      set((await (await apiRequest("POST", "/api/host/my-studio/live", { on: true, title: title.trim() || studio.name })).json()) as Studio);
      toast(recordToo ? { title: "You're live", description: "It's recording to your Library too." } : { title: "You're live", description: "Not recording. Press Record at the top any time." });
      onClose();
    } catch (e) { setError(say(e)); setBusy(""); }
    void qc.invalidateQueries({ queryKey: STUDIO_HOURS_KEY });
  };
  const row = "flex items-center gap-4 rounded-2xl border p-4";
  const icon = "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl";
  return (
    <Sheet onClose={onClose} testId="go-live-sheet">
      <h2 className="text-[22px] font-bold tracking-tight">Go live</h2>
      <p className="mt-1 text-[15px] text-[#475467]">Pick where the show goes.</p>
      <div className="mt-5 space-y-2.5">
        {/* Their watch page (25 Nov: "Yes, build it", the watch page for everyone): every account has one, SmartLink or not.
            Copy link sits beside it so they can send it before the show. */}
        {studio.livePage?.url && (
          <div className={`flex items-center gap-3 rounded-2xl border p-4 sm:gap-4 ${pageOn ? "border-2 border-[#053877] bg-[#f5f8fd] p-[15px]" : "border-[#e4e7ec]"}`} data-testid="golive-page-row">
            <div className={`${icon} text-[13px] font-extrabold tracking-tight text-white`} style={{ background: NAVY }}>MV</div>
            <div className="min-w-0 flex-1"><p className="font-semibold">Your watch page</p><p className="truncate text-[13px] text-[#475467]">{studio.livePage.url.replace(/^https?:\/\/(www\.)?/, "")}</p></div>
            <CopyLinkButton url={studio.livePage.url} testId="golive-page-copy" />
            <button type="button" onClick={() => void togglePage()} disabled={busy !== ""} aria-pressed={pageOn} className={`h-9 rounded-xl px-4 text-sm font-bold disabled:opacity-60 ${pageOn ? "text-white" : "border border-[#d0d5dd] bg-white text-[#344054]"}`} style={pageOn ? { background: NAVY } : undefined} data-testid="golive-page-toggle">{pageOn ? "Selected" : "Select"}</button>
          </div>
        )}
        {/* YouTube by their own stream key (Andrew, 22 Nov: "Yes, one connection"); the old Google sign-in still works until they save one. */}
        <div className={`rounded-2xl border p-4 ${ytOn ? "border-2 border-[#053877] bg-[#f5f8fd] p-[15px]" : "border-[#e4e7ec]"}`} data-testid="golive-youtube-row">
          <div className="flex items-center gap-4">
            <div className={`${icon} bg-white ring-1 ring-black/10`}><BrandMark brand="youtube" className="h-6 w-6" /></div>
            <div className="min-w-0 flex-1"><p className="font-semibold">YouTube</p><p className="truncate text-[13px] text-[#475467]">{studio.youtubeKey ? `Your stream key ${studio.youtubeKey}` : studio.youtube ? "Your channel · connected" : canConnect ? "Not connected yet" : "Paste your stream key once, then it's one press."}</p></div>
            {!studio.youtube && canConnect && !pasting && (
              <div className="flex shrink-0 flex-col items-end gap-1">
                <a href={youtubeConnectHref("studio")} className="flex h-9 items-center rounded-xl px-4 text-sm font-bold text-white" style={{ background: NAVY }} data-testid="golive-youtube-connect">Connect YouTube</a>
                <button type="button" onClick={() => setPasting(true)} className="text-[13px] font-semibold text-[#053877] underline decoration-[#98a2b3] underline-offset-2" data-testid="golive-youtube-paste">or paste a stream key</button>
              </div>
            )}
            {studio.youtube && <button type="button" onClick={() => void patch({ youtubeOn: !studio.youtubeOn })} disabled={busy !== ""} aria-pressed={ytOn} className={`h-9 rounded-xl px-4 text-sm font-bold disabled:opacity-60 ${ytOn ? "text-white" : "border border-[#d0d5dd] bg-white"}`} style={ytOn ? { background: NAVY } : undefined} data-testid="golive-youtube">{ytOn ? "Selected" : "Select"}</button>}
          </div>
          {!studio.youtube && (!canConnect || pasting) && <div className="mt-3 pl-[60px]"><YoutubeKeyForm compact onSaved={() => { if (!studio.youtubeOn) void patch({ youtubeOn: true }); }} /></div>}
        </div>
        <div className={`rounded-2xl border p-4 ${studio.streams.some((s) => s.on) ? "border-2 border-[#053877] bg-[#f5f8fd] p-[15px]" : "border-[#e4e7ec]"}`}>
          <div className="flex items-center gap-4">
            <div className={`${icon} bg-[#eef3fb] text-[#053877]`}><Plus className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1"><p className="font-semibold">Facebook, LinkedIn, Twitch and more</p><p className="text-[13px] text-[#475467]">With a stream key from that site.</p></div>
            <button type="button" onClick={onAdd} className="h-9 rounded-xl border border-[#d0d5dd] bg-white px-4 text-sm font-semibold" data-testid="golive-add-key">Add one</button>
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
        </div>
      </div>
      {studio.canRecord && (
        <label className={`mt-4 flex items-start gap-3 rounded-2xl border p-4 ${recordToo ? "border-[#abefc6] bg-[#f6fef9]" : "border-[#e4e7ec]"} ${studio.recording ? "" : "cursor-pointer"}`} data-testid="golive-record-row">
          <input type="checkbox" checked={recordToo} disabled={!!studio.recording || busy !== ""} onChange={(e) => setAlsoRecord(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#067647]" data-testid="golive-also-record" />
          <span className="min-w-0">
            <span className="block font-semibold">Also record to my Library</span>
            <span className="block text-[13px] text-[#475467]">{studio.recording ? "You're already recording. It keeps going." : recordToo ? "Your episode and clips start from the recording. Untick to stream only." : "Streaming only. You can press Record at the top any time."}</span>
          </span>
        </label>
      )}
      <label className="mt-5 block text-sm font-semibold" htmlFor="live-title">Title of your show</label>
      <input id="live-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} className="mt-1.5 h-12 w-full rounded-xl border border-[#d0d5dd] px-4 text-[15px] outline-none focus:border-[#053877] focus:ring-2 focus:ring-[#053877]/15" />
      {ytOn && studio.youtubeKey && <p className="mt-1.5 text-[13px] text-[#667085]" data-testid="golive-yt-title-note">On YouTube it goes live under your channel's default title, set in YouTube Studio.</p>}
      {error && <p className="mt-3 text-sm font-medium text-[#b42318]">{error}</p>}
      <div className="mt-6 flex items-center justify-end gap-3">
        {!anyOn && <p className="mr-auto text-[13px] text-[#667085]">Pick your page, YouTube or a key to go live.</p>}
        <button type="button" onClick={onClose} className="h-12 rounded-xl px-5 text-[15px] font-semibold text-[#344054] hover:bg-[#f2f4f7]">Not yet</button>
        <button type="button" onClick={() => void start()} disabled={!anyOn || busy !== ""} className="flex h-12 items-center gap-2 rounded-xl bg-[#d92d20] px-6 text-[15px] font-bold text-white shadow-[0_4px_12px_rgba(217,45,32,0.28)] disabled:opacity-50 disabled:shadow-none" data-testid="golive-start">
          {busy === "go" && <Loader2 className="h-4 w-4 animate-spin" />}{recordToo && !studio.recording ? "Go live and record" : "Go live"}
        </button>
      </div>
    </Sheet>
  );
}

function SettingsSheet({ onClose, blur }: { onClose: () => void; blur: ReactNode }) {
  return (
    <Sheet onClose={onClose} width={480} testId="studio-settings">
      <h2 className="text-[22px] font-bold tracking-tight">Settings</h2>
      <p className="mt-1 text-[15px] text-[#475467]">Pick the camera, mic and speakers this computer uses.</p>
      <div className="mt-5 space-y-4">
        <DevicePick kind="videoinput" label="Camera" />
        <div>{blur}</div>
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
      <Select wrap="mt-1.5 w-full" value={activeDeviceId} onChange={(e) => void setActiveMediaDevice(e.target.value)} className="h-11 rounded-xl border border-[#d0d5dd] bg-white pl-3 text-sm">
        {list.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || label}</option>)}
      </Select>
    </label>
  );
}
