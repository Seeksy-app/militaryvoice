import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { PlatformIcon, platformBackground } from "@/components/SocialIcons";
import type { PublicDestination, SocialPlatform } from "@shared/schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useProducerRoom, type ProducerFeed } from "@/hooks/use-producer-room";
import { Destinations } from "@/components/Destinations";
import { StageGrid, youtubeId, clockText, type StageTile } from "@/components/StageView";
import { MediaLibrary, type MediaItem } from "@/components/MediaLibrary";
import { SceneRail, type SceneSpec } from "@/components/SceneRail";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { STUDIO_STATUSES, LOGO_CORNERS, type StudioRow, type StudioParticipantRow, type RunItemRow, type SignupRow, type SceneRow } from "@shared/schema";
import { detectLocalTimeZone, formatTimeInZone } from "@/lib/schedule";
import {
  MonitorPlay,
  Users,
  Mic,
  MicOff,
  Video,
  VideoOff,
  ArrowUp,
  ArrowDown,
  X,
  PlayCircle,
  Radio,
  Copy,
  AlertTriangle,
  Clock,
  Disc,
  Square,
  Signal,
  Cable,
  Trash2,
  Check,
  Upload,
  Volume2,
  VolumeX,
  Film,
  Image as ImageIcon,
  Clapperboard,
  ListOrdered,
  Plus,
  Maximize2,
  Minimize2,
  LogOut,
  ChevronDown,
  Settings2,
  Timer,
} from "lucide-react";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

interface Props {
  /** Limit to one event's studios (the event dashboard); omit for every studio. */
  eventId?: number;
  /**
   * "event": only the event's own studio is offered. "room": only rooms (the
   * one-off spaces), never an event studio. Omit for the old everything list.
   */
  kind?: "event" | "room";
  /** Pin the console to one studio/room; the picker is hidden and nothing can drift it. */
  fixedStudioId?: number;
  /** In a room: "Leave the room" takes you back to the list. */
  onLeave?: () => void;
  adminGet: <T>(path: string) => Promise<T>;
  adminSend: (method: string, path: string, body?: unknown) => Promise<Response>;
  /**
   * "live" is the control surface you use on air — one frame, never scrolls.
   * "set" is everything you decide beforehand. They're separate tabs because
   * mid-show is the worst possible time to be scrolling for a button.
   */
  view: "live" | "set";
}

type Participant = StudioParticipantRow & { present: boolean };
interface StudioPayload {
  studio: StudioRow;
  participants: Participant[];
}


/** Live camera thumbnail for one participant, or their initials if they
 *  haven't published yet. Muted: the control room monitors on the stage feed,
 *  not by playing every green-room mic at once. */
const SOCIAL: SocialPlatform[] = ["instagram", "tiktok", "youtube", "x", "linkedin", "facebook", "threads"];
/** A destination's badge: the network's own mark when we have one, a signal icon otherwise. */
function DestIcon({ platform }: { platform: string }) {
  const p = platform.toLowerCase() as SocialPlatform;
  if (SOCIAL.includes(p)) {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full text-white" style={{ background: platformBackground(p) }} title={platform}>
        <PlatformIcon platform={p} className="h-3 w-3" />
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-white" title={platform}>
      <Signal className="h-3 w-3" />
    </span>
  );
}

function FeedThumb({ feed, initials, fill }: { feed?: ProducerFeed; initials: string; fill?: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !feed?.video) return;
    feed.video.attach(el);
    return () => {
      feed.video?.detach(el);
    };
  }, [feed?.video]);

  return (
    <div
      className={
        fill
          ? "absolute inset-0 overflow-hidden bg-[#053877]"
          : "relative h-11 w-[74px] shrink-0 overflow-hidden rounded-lg bg-[#053877]"
      }
    >
      {feed?.video ? (
        <video ref={ref} autoPlay playsInline muted className="h-full w-full object-contain" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm font-bold text-white">{initials}</div>
      )}
    </div>
  );
}

/** One control on the live deck. Icon over label, so the row scans at a glance. */
/** A running break clock, in the producer's own bar, with the way out of it. */
function CountdownChip({ endsAt, label, onClear }: { endsAt: number; label: string; onClear: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const done = left <= 0;
  return (
    <span
      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ${
        done ? "bg-[#ED1C24] text-white" : "bg-[#F0A71F] text-[#1a1200]"
      }`}
      data-testid="chip-countdown"
    >
      <Timer className="h-4 w-4" />
      <span className="tabular-nums font-bold">{clockText(left)}</span>
      <span className="max-w-[10rem] truncate opacity-80">{done ? "clock at zero" : label}</span>
      <button
        type="button"
        onClick={onClear}
        className="rounded-full bg-black/20 px-2 py-0.5 text-[11px] font-semibold hover:bg-black/35"
        data-testid="button-clear-countdown"
      >
        Clear
      </button>
    </span>
  );
}

function DeckButton({
  icon: Icon,
  label,
  onClick,
  active,
  amber,
  testId,
}: {
  icon: typeof Disc;
  label: string;
  onClick: () => void;
  active?: boolean;
  amber?: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
        active
          ? amber
            ? "bg-[#F0A71F] text-[#1a1200]"
            : "bg-[#ED1C24] text-white"
          : "bg-white/8 text-white/80 hover:bg-white/15"
      }`}
      data-testid={testId}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

export function StudioConsole({ adminGet, adminSend, view, eventId, kind, fixedStudioId, onLeave }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const zone = useMemo(detectLocalTimeZone, []);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [fallbackLabel, setFallbackLabel] = useState<string | null>(null);

  // Which room we're looking at. Remembered per browser so a refresh mid-show
  // doesn't drop you back into the wrong studio.
  const [studioId, setStudioId] = useState<number | null>(() => {
    if (fixedStudioId) return fixedStudioId;
    const v = Number(localStorage.getItem("mv_admin_studio"));
    return Number.isFinite(v) && v > 0 ? v : null;
  });
  const [renaming, setRenaming] = useState<string | null>(null);
  // Setup is a form you scroll. Live is a control surface that must never
  // scroll — once you're on air you can't go hunting for a button.
  const isLive = view === "live";
  const [monitorMuted, setMonitorMuted] = useState(true);
  const [mediaPicker, setMediaPicker] = useState<null | "image" | "video" | "all" | "presentations">(null);
  const [sceneName, setSceneName] = useState("");
  const [presName, setPresName] = useState("");
  const [presFiles, setPresFiles] = useState<FileList | null>(null);
  const [presUploading, setPresUploading] = useState(false);
  const [presSlideIdx, setPresSlideIdx] = useState<Record<number, number>>({});
  const [stageMuted, setStageMuted] = useState(false);
  // The studio takes the whole window by default. Site nav, the logo, the
  // sign-in, the dashboard heading and the tabs are all noise when you're
  // running a show, and the padding around them was costing the stage width.
  const [focus, setFocus] = useState(view === "live");

  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocus(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [focus]);

  const { data: studios } = useQuery<(StudioRow & { isPrimary: boolean; eventName?: string })[]>({
    // Every studio, whatever event it belongs to — a rehearsal room shows up
    // next to the live one.
    queryKey: ["/api/admin/studios", eventId ?? "all"],
    queryFn: () => adminGet(eventId ? `/api/admin/studios?eventId=${eventId}` : "/api/admin/studios?all=1"),
  });

  const pick = (id: number | null) => {
    if (fixedStudioId) return;
    setStudioId(id);
    if (id) localStorage.setItem("mv_admin_studio", String(id));
    else localStorage.removeItem("mv_admin_studio");
    queryClient.removeQueries({ queryKey: ["/api/admin/studio"] });
  };

  const q = studioId ? `?studioId=${studioId}` : "";

  const { data, isLoading } = useQuery<StudioPayload>({
    queryKey: ["/api/admin/studio", studioId],
    queryFn: () => adminGet<StudioPayload>(`/api/admin/studio${q}`),
    refetchInterval: 4000,
  });
  const { data: runItems } = useQuery<RunItemRow[]>({
    queryKey: ["/api/admin/run-of-show", eventId ?? "featured"],
    queryFn: () => adminGet<RunItemRow[]>(eventId ? `/api/admin/run-of-show?eventId=${eventId}` : "/api/admin/run-of-show"),
  });

  // Live pictures for the green room, when the event has a media layer.
  const [onCamera, setOnCamera] = useState(false);
  const {
    status: roomStatus,
    feeds,
    camOn,
    micOn,
    toggleCam,
    toggleMic,
    selfKey,
  } = useProducerRoom({ enabled: isLive, adminSend, studioId, publish: onCamera, displayName: "Host" });

  const studio = data?.studio;
  const present = (data?.participants ?? []).filter((p) => p.present);
  const onStage = present.filter((p) => p.state === "On stage");
  const greenRoom = present.filter((p) => p.state !== "On stage");
  const stale = (data?.participants ?? []).filter((p) => !p.present);

  // What the control room should be doing right now, and next.
  const { current, next } = useMemo(() => {
    const timed = (runItems ?? []).filter((r) => r.startAtUtc).sort((a, b) => a.startAtUtc.localeCompare(b.startAtUtc));
    const now = Date.now();
    let cur: RunItemRow | undefined;
    let nxt: RunItemRow | undefined;
    for (const r of timed) {
      const t = new Date(r.startAtUtc).getTime();
      if (t <= now) cur = r;
      else {
        nxt = r;
        break;
      }
    }
    return { current: cur, next: nxt };
  }, [runItems]);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/studio", studioId] });
  }

  const patchStudio = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => adminSend("PATCH", "/api/admin/studio", { ...patch, studioId }),
    onSuccess: () => {
      refresh();
      // The picker reads names from its own query; a rename has to reach it too.
      queryClient.invalidateQueries({ queryKey: ["/api/admin/studios"] });
    },
    onError: (e: Error) => toast({ title: "Couldn't update the studio", description: e.message, variant: "destructive" }),
  });

  const setState = useMutation({
    mutationFn: async ({ id, state }: { id: number; state: string }) =>
      adminSend("PATCH", `/api/admin/studio/participants/${id}`, { state, studioId }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast({ title: "Couldn't move them", description: e.message, variant: "destructive" }),
  });

  const setTitle = useMutation({
    mutationFn: async ({ id, displayTitle }: { id: number; displayTitle: string }) =>
      adminSend("PATCH", `/api/admin/studio/participants/${id}/title`, { displayTitle }),
    onSuccess: () => refresh(),
  });

  const [editingTitle, setEditingTitle] = useState<number | null>(null);
  const [titleDraft, setTitleDraft] = useState("");

  const { data: feeds2 } = useQuery<
    { id: number; ownerEmail: string; displayName: string; url: string; keyHint: string; status: string }[]
  >({
    queryKey: ["/api/admin/ingress"],
    queryFn: () => adminGet("/api/admin/ingress"),
    refetchInterval: 15000,
  });

  const dropIngress = useMutation({
    mutationFn: async (id: number) => adminSend("DELETE", `/api/admin/ingress/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/ingress"] }),
    onError: (e: Error) => toast({ title: "Couldn't remove that feed", description: e.message, variant: "destructive" }),
  });

  // Shares a cache key with <Destinations>, so this is free.
  const { data: scenes } = useQuery<SceneRow[]>({
    queryKey: ["/api/admin/scenes", studioId],
    queryFn: () => adminGet(`/api/admin/scenes${q}`),
  });

  type PresSlide = { id: number; slideIndex: number; url: string };
  type Presentation = { id: number; name: string; createdAt: string; slides: PresSlide[] };
  const { data: presData = [], refetch: refetchPres } = useQuery<Presentation[]>({
    queryKey: ["/api/admin/studio/presentations", studioId],
    queryFn: () => adminGet(`/api/admin/studio/presentations?studioId=${studioId}`),
    enabled: !!studioId,
  });

  const putOnStage = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      adminSend("POST", "/api/admin/studio/media", { ...body, studioId }),
    onSuccess: () => refresh(),
  });

  async function uploadPresentation(e: React.FormEvent) {
    e.preventDefault();
    if (!presFiles || presFiles.length === 0 || !studioId) return;
    setPresUploading(true);
    try {
      const fd = new FormData();
      fd.append("studioId", String(studioId));
      fd.append("name", presName.trim() || "Presentation");
      for (const f of Array.from(presFiles)) fd.append("slides", f);
      const res = await fetch("/api/admin/studio/presentations", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      setPresName(""); setPresFiles(null); refetchPres();
      toast({ title: "Presentation uploaded" });
    } catch (err) {
      toast({ title: "Upload failed", description: (err as Error).message, variant: "destructive" });
    } finally { setPresUploading(false); }
  }

  const deletePresentation = useMutation({
    mutationFn: async (id: number) => adminSend("DELETE", `/api/admin/studio/presentations/${id}`),
    onSuccess: () => refetchPres(),
  });

  const afterTake = (r: { missing?: string | null }) => {
    refresh();
    if (r?.missing) {
      toast({
        title: `${r.missing} isn't in the green room`,
        description: "The scene is up, but nobody matching that booking has arrived. Bring them on by hand when they do.",
      });
    }
  };
  const muteStage = useMutation({
    mutationFn: async (muted: boolean) => adminSend("POST", "/api/admin/studio/mute-stage", { muted, studioId }),
    onSuccess: (_r, muted) => {
      setStageMuted(muted);
      refresh();
    },
    onError: (e: Error) => toast({ title: "Couldn't mute the stage", description: e.message, variant: "destructive" }),
  });

  const applyScene = useMutation({
    mutationFn: async (id: number) => (await adminSend("POST", `/api/admin/scenes/${id}/apply`, { studioId })).json(),
    // A scene off the agenda moves people too, so it gets the same warning a
    // taken row does when the podcaster hasn't turned up.
    onSuccess: afterTake,
    onError: (e: Error) => toast({ title: "Couldn't take that scene", description: e.message, variant: "destructive" }),
  });

  const invalidateScenes = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/scenes", studioId] });

  const saveScene = useMutation({
    mutationFn: async (name: string) => adminSend("POST", "/api/admin/scenes", { name, studioId, capture: true }),
    onSuccess: invalidateScenes,
    onError: (e: Error) => toast({ title: "Couldn't save that scene", description: e.message, variant: "destructive" }),
  });

  const addScene = useMutation({
    mutationFn: async (spec: SceneSpec) => adminSend("POST", "/api/admin/scenes", { ...spec, studioId }),
    onSuccess: invalidateScenes,
    onError: (e: Error) => toast({ title: "Couldn't add that scene", description: e.message, variant: "destructive" }),
  });

  const patchScene = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Partial<SceneSpec> }) =>
      adminSend("PATCH", `/api/admin/scenes/${id}`, patch),
    onSuccess: invalidateScenes,
    onError: (e: Error) => toast({ title: "Couldn't change that scene", description: e.message, variant: "destructive" }),
  });

  const reorderScenes = useMutation({
    mutationFn: async (ids: number[]) => adminSend("POST", "/api/admin/scenes/reorder", { ids, studioId }),
    onSuccess: invalidateScenes,
    onError: (e: Error) => toast({ title: "Couldn't reorder those", description: e.message, variant: "destructive" }),
  });

  const dropScene = useMutation({
    mutationFn: async (id: number) => adminSend("DELETE", `/api/admin/scenes/${id}`),
    onSuccess: invalidateScenes,
  });

  const clearCountdown = useMutation({
    mutationFn: async () => adminSend("POST", "/api/admin/studio/countdown/clear", { studioId }),
    onSuccess: () => refresh(),
  });

  // The uploads podcasters already sent us, offered when building a media scene.
  const { data: mediaItems } = useQuery<MediaItem[]>({
    queryKey: ["/api/admin/media"],
    queryFn: () => adminGet<MediaItem[]>("/api/admin/media"),
  });

  const generateScenes = useMutation({
    mutationFn: async () => (await adminSend("POST", "/api/admin/scenes/generate", { studioId })).json() as Promise<{ created: number; total: number }>,
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scenes", studioId] });
      toast({ title: `Generated ${r.created} scene${r.created !== 1 ? "s" : ""}`, description: `${r.total} items on the agenda.` });
    },
    onError: (e: Error) => toast({ title: "Couldn't generate scenes", description: e.message, variant: "destructive" }),
  });

  const { data: dests } = useQuery<PublicDestination[]>({
    queryKey: ["/api/admin/destinations"],
    queryFn: () => adminGet("/api/admin/destinations"),
  });

  const { data: signups } = useQuery<SignupRow[]>({
    queryKey: ["/api/admin/signups"],
    queryFn: () => adminGet<SignupRow[]>("/api/admin/signups"),
  });

  const broadcast = useMutation({
    mutationFn: async (action: "start" | "stop") => adminSend("POST", "/api/admin/studio/broadcast", { action, studioId }),
    onSuccess: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/destinations"] });
    },
    onError: (e: Error) => toast({ title: "Broadcast didn't change", description: e.message, variant: "destructive" }),
  });

  const toggleDest = useMutation({
    mutationFn: async (d: { id: number; enabled: boolean }) => adminSend("PATCH", `/api/admin/destinations/${d.id}`, { enabled: d.enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/destinations"] }),
    onError: (e: Error) => toast({ title: "Couldn't change that destination", description: e.message, variant: "destructive" }),
  });

  const record = useMutation({
    mutationFn: async (body: { action: "start" | "stop"; signupId?: number }) =>
      adminSend("POST", "/api/admin/studio/record", { ...body, studioId }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast({ title: "Recording didn't change", description: e.message, variant: "destructive" }),
  });

  const makeStudio = useMutation({
    mutationFn: async (name: string) => adminSend("POST", "/api/admin/studios", { name }),
    onSuccess: async (res) => {
      const created = (await res.json()) as StudioRow;
      queryClient.invalidateQueries({ queryKey: ["/api/admin/studios"] });
      pick(created.id);
    },
    onError: (e: Error) => toast({ title: "Couldn't make that studio", description: e.message, variant: "destructive" }),
  });

  const removeStudio = useMutation({
    mutationFn: async (id: number) => adminSend("DELETE", `/api/admin/studios/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/studios"] });
      pick(null);
    },
    onError: (e: Error) => toast({ title: "Couldn't remove it", description: e.message, variant: "destructive" }),
  });

  const drop = useMutation({
    mutationFn: async (id: number) => adminSend("DELETE", `/api/admin/studio/participants/${id}`),
    onSuccess: () => refresh(),
  });

  const isRoom = kind === "room";
  const live = !isRoom && studio?.status === "Live";
  const recording = Boolean(studio?.recordingEgressId);
  // "Live" without external destinations has no egress at all — the audience
  // watches on our page — so the button has to read the status, not the egress.
  // Rooms never stream: whatever status a room carries, it is only ever recording.
  const broadcasting = !isRoom && (Boolean(studio?.broadcastEgressId) || studio?.status === "Live");
  const stageFull = !!studio && onStage.length >= studio.maxOnStage;
  // A cleared countdown is an empty string; anything unparseable is treated the
  // same, so a bad value can't wedge a clock on the air.
  const countdownEndsRaw = studio?.countdownEndsAtUtc ? Date.parse(studio.countdownEndsAtUtc) : NaN;
  const countdownEnds = Number.isFinite(countdownEndsRaw) ? countdownEndsRaw : null;
  /**
   * The standby clip is played by a <video> tag on the broadcast, so it has to
   * be an actual media file. A YouTube or Vimeo *page* link looks right and
   * plays as a black screen — which is the worst possible thing to discover
   * during the emergency you queued it up for.
   */
  function standbyProblem(url: string): string | null {
    const v = url.trim();
    if (!v) return null;
    if (youtubeId(v)) return null; // played as an embed
    if (!/^https?:\/\//i.test(v)) return "That needs to be a full https:// link.";
    if (/^https?:\/\/(www\.)?(vimeo\.com|twitch\.tv|facebook\.com|drive\.google\.com|dropbox\.com)/i.test(v)) {
      return "That's a page link we can't play. Upload the clip instead, or use a YouTube link.";
    }
    if (!/\.(mp4|m4v|mov|webm|m3u8|mp3|m4a)(\?|$)/i.test(v)) {
      return "That doesn't look like a media file. Upload the clip instead — it's the only way to be sure it rolls.";
    }
    return null;
  }

  const standbyFileRef = useRef<HTMLInputElement | null>(null);
  const [standbyBusy, setStandbyBusy] = useState(false);
  const logoFileRef = useRef<HTMLInputElement | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);

  async function uploadLogo(file: File) {
    setLogoBusy(true);
    try {
      const form = new FormData();
      form.append("logo", file);
      if (studioId) form.append("studioId", String(studioId));
      const res = await fetch("/api/admin/studio/logo", { method: "POST", body: form, credentials: "include" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any)?.message ?? "Upload failed");
      refresh();
      toast({ title: "Logo is on the frame", description: "Switch it off any time from the live bar." });
    } catch (err) {
      toast({ title: "Couldn't upload that", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLogoBusy(false);
    }
  }

  /** slot "pre" is the card shown until the event's start time passes. */
  async function uploadStandby(file: File, slot: "main" | "pre" = "main") {
    setStandbyBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("label", file.name.replace(/\.[^.]+$/, ""));
      form.append("slot", slot);
      if (studioId) form.append("studioId", String(studioId));
      const res = await fetch("/api/admin/studio/standby", { method: "POST", body: form, credentials: "include" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any)?.message ?? "Upload failed");
      refresh();
      toast({
        title: slot === "pre" ? "Pre-event card ready" : "Standby clip ready",
        description: slot === "pre" ? `${file.name} — plays until the event starts` : file.name,
      });
    } catch (err) {
      toast({ title: "Couldn't upload that", description: (err as Error).message, variant: "destructive" });
    } finally {
      setStandbyBusy(false);
    }
  }

  function commitRename() {
    const next = (renaming ?? "").trim();
    if (next && next !== currentStudio?.name) patchStudio.mutate({ name: next });
    setRenaming(null);
  }

  const visibleStudios = (studios ?? []).filter((x) => (kind === "event" ? x.isPrimary : kind === "room" ? !x.isPrimary : true));
  // Keep the selection inside what this surface is allowed to show.
  useEffect(() => {
    if (!kind || visibleStudios.length === 0) return;
    if (!studioId || !visibleStudios.some((x) => x.id === studioId)) pick(visibleStudios[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, studioId, studios]);
  const currentStudio = visibleStudios.find((x) => x.id === (studioId ?? visibleStudios[0]?.id));
  const isPrimary = currentStudio?.isPrimary !== false;
  const watchUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/watch${currentStudio && !currentStudio.isPrimary ? `?studioId=${currentStudio.id}` : ""}`
      : "/watch";
  const joinUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/studio${currentStudio && !currentStudio.isPrimary ? `?studioId=${currentStudio.id}` : ""}`
      : "/studio";

  function Tile({ p, stage }: { p: Participant; stage: boolean }) {
    return (
      <div
        className={`flex items-center gap-3 rounded-xl border p-3 ${
          stage ? "border-[#ED1C24]/50 bg-[#ED1C24]/5" : "border-border bg-background"
        }`}
        data-testid={`studio-participant-${p.id}`}
      >
        <FeedThumb feed={feeds.get(`p-${p.id}`)} initials={(p.displayName || "?").slice(0, 2).toUpperCase()} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{p.displayName || "Unnamed"}</div>
          {editingTitle === p.id ? (
            <form
              className="mt-1 flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                setTitle.mutate({ id: p.id, displayTitle: titleDraft });
                setEditingTitle(null);
              }}
            >
              <input
                autoFocus
                className="h-6 flex-1 rounded border bg-background px-1.5 text-xs min-w-0"
                placeholder="Lower third title…"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => { setTitle.mutate({ id: p.id, displayTitle: titleDraft }); setEditingTitle(null); }}
              />
            </form>
          ) : (
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              {p.camReady ? <Video className="h-3 w-3 text-emerald-600" /> : <VideoOff className="h-3 w-3 text-destructive" />}
              {p.micReady ? <Mic className="h-3 w-3 text-emerald-600" /> : <MicOff className="h-3 w-3 text-destructive" />}
              <button
                className="truncate hover:text-foreground transition-colors text-left"
                title="Set lower third title"
                onClick={() => { setEditingTitle(p.id); setTitleDraft(p.displayTitle || ""); }}
              >
                {p.displayTitle || <span className="italic opacity-60">+ lower third</span>}
              </button>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {stage ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 rounded-full px-2.5 text-xs"
              onClick={() => setState.mutate({ id: p.id, state: "Green room" })}
              data-testid={`button-studio-down-${p.id}`}
            >
              <ArrowDown className="h-3 w-3" /> Off
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-8 gap-1 rounded-full px-2.5 text-xs"
              disabled={stageFull}
              title={stageFull ? `Stage is full at ${studio?.maxOnStage}` : "Bring them on stage"}
              onClick={() => setState.mutate({ id: p.id, state: "On stage" })}
              data-testid={`button-studio-up-${p.id}`}
            >
              <ArrowUp className="h-3 w-3" /> On
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => drop.mutate(p.id)}
            aria-label="Remove from studio"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  }
  // What the producer should do next. A control room is a sequence, not a
  // wall of equal-weight panels, so the console says where you are in it.
  // The programme monitor: exactly the people the audience can see, drawn from
  // the same subscription that powers the green-room thumbnails.
  const monitorTiles: StageTile[] = Array.from(feeds.values())
    .filter((f) => f.state === "On stage")
    .map((f) => ({ identity: f.identity, name: f.name, displayTitle: f.displayTitle, video: f.video, audio: f.audio, speaking: f.speaking }))
    .sort((a, b) => a.identity.localeCompare(b.identity));

  // Presence is what keeps the host in the room lists; without a heartbeat
  // they'd vanish after twenty-five seconds like anyone who closed their laptop.
  useEffect(() => {
    if (!onCamera || !selfKey) return;
    const beat = () =>
      fetch("/api/studio/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ clientKey: selfKey, camReady: camOn, micReady: micOn, studioId }),
      }).catch(() => {});
    void beat();
    const id = setInterval(beat, 8000);
    return () => clearInterval(id);
  }, [onCamera, selfKey, camOn, micOn, studioId]);

  const houseDestRows = (dests ?? []).filter((d) => !d.signupId);
  const houseDests = houseDestRows.filter((d) => d.enabled).length;
  const steps = [
    { n: 1, label: "Get people in", done: present.length > 0, hint: "Send them the join link." },
    { n: 2, label: "Put someone on stage", done: onStage.length > 0, hint: "Press On beside a name in the green room." },
    {
      n: 3,
      label: "Add somewhere else (optional)",
      done: houseDests > 0,
      hint: "Your own watch page always carries it. Add YouTube, X or Twitch to go out there too.",
    },
    { n: 4, label: "Go out live", done: broadcasting, hint: "Opens the watch page and pushes to every destination." },
  ];
  // Step 3 is optional, so it never blocks the prompt — it only shows as the
  // next thing to do once everything required is done.
  const step = steps.find((x) => !x.done && x.n !== 3) ?? steps.find((x) => !x.done);

  return (
    <Card
      className={
        focus
          ? "fixed inset-0 z-[60] flex flex-col overflow-hidden rounded-none border-0 bg-[#04102b]"
          : "overflow-hidden"
      }
    >
      {/* ---------------------------------------------------- the control bar */}
      <div
        className={`relative bg-[#000741] px-5 py-4 text-white ${
          broadcasting ? "border-t-[3px] border-[#ED1C24]" : ""
        }`}
      >
        <div className="relative flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10">
              <MonitorPlay className="h-4.5 w-4.5 text-[#F0A71F]" />
            </div>
            <div className="min-w-0">
              {renaming === null ? (
                <button
                  type="button"
                  className="-mx-1 block truncate rounded px-1 text-lg font-bold leading-tight hover:bg-white/10"
                  style={HEADLINE_FONT}
                  title="Rename this studio"
                  onClick={() => setRenaming(currentStudio?.name ?? "")}
                  data-testid="button-rename-studio"
                >
                  {currentStudio?.name ?? "Studio"}
                </button>
              ) : (
                <Input
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-8 w-52 border-white/25 bg-white/10 text-base text-white"
                  value={renaming}
                  onChange={(e) => setRenaming(e.target.value)}
                  onBlur={() => commitRename()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRename();
                    }
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  data-testid="input-studio-name"
                />
              )}
              <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-white/55">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    roomStatus === "connected"
                      ? "bg-emerald-400"
                      : roomStatus === "error"
                        ? "bg-[#ED1C24]"
                        : "bg-white/35"
                  }`}
                />
                {roomStatus === "connected"
                  ? "Camera and sound connected"
                  : roomStatus === "connecting"
                    ? "Connecting…"
                    : roomStatus === "error"
                      ? "Can't reach the media room"
                      : "Media layer off"}
              </div>
            </div>
          </div>

          {(broadcasting || (isRoom && recording)) && (
            <span className="inline-flex items-center gap-2 rounded-full bg-[#ED1C24] px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.14em]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> {broadcasting ? "On air" : "Recording"}
            </span>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* The event studio stands alone; rooms pick among rooms. Only the
                legacy everything-view still offers "new" here. */}
            {!fixedStudioId && (kind !== "event" || visibleStudios.length > 1) && (
              <Select
                value={String(currentStudio?.id ?? "")}
                onValueChange={(v) => (v === "new" ? makeStudio.mutate("New studio") : pick(Number(v)))}
              >
                <SelectTrigger
                  className="h-9 w-[200px] border-white/20 bg-white/10 text-white hover:bg-white/15"
                  data-testid="select-studio"
                >
                  <SelectValue placeholder={kind === "room" ? "Room" : "Studio"} />
                </SelectTrigger>
                <SelectContent>
                  {visibleStudios.map((st) => (
                    <SelectItem key={st.id} value={String(st.id)}>
                      {st.name}
                      {!kind && st.isPrimary ? " · event studio" : ""}
                    </SelectItem>
                  ))}
                  {!kind && <SelectItem value="new">+ New studio…</SelectItem>}
                </SelectContent>
              </Select>
            )}


            {!isPrimary && currentStudio && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-white/50 hover:bg-white/10 hover:text-[#ED1C24]"
                title="Remove this studio"
                onClick={() => removeStudio.mutate(currentStudio.id)}
                data-testid="button-delete-studio"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}

            {isLive && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-white/60 hover:bg-white/10 hover:text-white"
              title={focus ? "Leave full screen (Esc)" : "Full screen"}
              onClick={() => {
                const next = !focus;
                setFocus(next);
                // Real fullscreen too where the browser allows it; the overlay
                // stands on its own if it refuses.
                if (next) void document.documentElement.requestFullscreen?.().catch(() => {});
                else if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
              }}
              data-testid="button-studio-fullscreen"
            >
              {focus ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            )}

            {focus && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 gap-1.5 rounded-full px-3 text-xs text-white/70 hover:bg-white/10 hover:text-white"
                onClick={() => {
                  setFocus(false);
                  if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
                  onLeave?.();
                }}
                data-testid="button-studio-exit-focus"
              >
                <LogOut className="h-3.5 w-3.5" /> {onLeave ? "Leave the room" : "Leave the studio"}
              </Button>
            )}

            {isLive && (
              <>
                <span className="mx-1 hidden h-7 w-px bg-white/15 sm:block" />

                {/* Where the stream goes. Icons for what's on; tap to switch any on or off. */}
                {!isRoom && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="flex h-9 items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 text-xs font-medium text-white/85 hover:bg-white/15"
                        title="Where the live stream goes"
                        data-testid="button-destinations"
                      >
                        <span className="text-white/55">To</span>
                        {houseDestRows.filter((d) => d.enabled).length === 0 ? (
                          <span>our watch page</span>
                        ) : (
                          <span className="flex items-center gap-1">
                            {houseDestRows
                              .filter((d) => d.enabled)
                              .map((d) => (
                                <DestIcon key={d.id} platform={d.platform} />
                              ))}
                          </span>
                        )}
                        <ChevronDown className="h-3 w-3 text-white/60" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-80 p-3">
                      <p className="text-sm font-semibold">Streaming to</p>
                      <p className="text-xs text-muted-foreground">Our watch page is always on. Switch the others on or off here.</p>
                      <div className="mt-3 flex flex-col gap-2">
                        {houseDestRows.length === 0 && (
                          <p className="text-xs text-muted-foreground">No external destinations yet — add YouTube, X or a custom RTMP under Studio set.</p>
                        )}
                        {houseDestRows.map((d) => (
                          <label key={d.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-sm">
                            <DestIcon platform={d.platform} />
                            <span className="min-w-0 flex-1 truncate">{d.label || d.platform}</span>
                            {d.live && <span className="text-[11px] font-semibold text-[#ED1C24]">live</span>}
                            <Switch checked={d.enabled} onCheckedChange={(v) => toggleDest.mutate({ id: d.id, enabled: v })} />
                          </label>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}

                {/* One control for going on: live stream, record, or both. */}
                {broadcasting || recording ? (
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white">
                      {broadcasting && (
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 animate-pulse rounded-full bg-[#ED1C24]" /> Live
                        </span>
                      )}
                      {broadcasting && recording && <span className="text-white/40">·</span>}
                      {recording && (
                        <span className="flex items-center gap-1.5">
                          <Disc className="h-3 w-3 text-[#ED1C24]" /> Recording
                        </span>
                      )}
                    </span>
                    <Button
                      size="sm"
                      className="h-9 gap-1.5 rounded-full bg-white/15 px-4 font-semibold text-white hover:bg-white/25"
                      disabled={broadcast.isPending || record.isPending}
                      onClick={() => {
                        if (recording) record.mutate({ action: "stop" });
                        if (broadcasting) broadcast.mutate("stop");
                      }}
                      data-testid="button-end-all"
                    >
                      <Square className="h-3.5 w-3.5" /> End
                    </Button>
                  </div>
                ) : isRoom ? (
                  <Button
                    size="sm"
                    className="h-9 gap-1.5 rounded-full bg-[#ED1C24] px-4 font-semibold text-white shadow-[0_6px_20px_rgba(237,28,36,0.45)] hover:bg-[#c81820]"
                    disabled={record.isPending}
                    onClick={() => record.mutate({ action: "start" })}
                    data-testid="button-broadcast-toggle"
                  >
                    <Disc className="h-3.5 w-3.5" /> Start recording
                  </Button>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        className="h-9 gap-1.5 rounded-full bg-[#ED1C24] px-4 font-semibold text-white shadow-[0_6px_20px_rgba(237,28,36,0.45)] hover:bg-[#c81820]"
                        disabled={broadcast.isPending || record.isPending}
                        data-testid="button-broadcast-toggle"
                      >
                        <Signal className="h-3.5 w-3.5" /> Go live <ChevronDown className="h-3.5 w-3.5 opacity-80" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuItem onClick={() => broadcast.mutate("start")} data-testid="menu-go-live">
                        <Signal className="mr-2 h-4 w-4" />
                        <span>
                          <span className="block font-semibold">Live stream</span>
                          <span className="block text-xs text-muted-foreground">Watch page and the destinations above</span>
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => record.mutate({ action: "start", signupId: current?.signupId ?? undefined })} data-testid="menu-record">
                        <Disc className="mr-2 h-4 w-4" />
                        <span>
                          <span className="block font-semibold">Record only</span>
                          <span className="block text-xs text-muted-foreground">Nothing goes out; the file is saved</span>
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          broadcast.mutate("start");
                          record.mutate({ action: "start", signupId: current?.signupId ?? undefined });
                        }}
                        data-testid="menu-live-record"
                      >
                        <Radio className="mr-2 h-4 w-4" />
                        <span>
                          <span className="block font-semibold">Live stream + record</span>
                          <span className="block text-xs text-muted-foreground">Go out and keep a copy</span>
                        </span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>
            )}

          </div>
        </div>

        {/* ------------------------------------------------ where you are in it */}
        {!isLive && (
        <div className="relative mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-white/10 pt-3">
          {steps.map((x, i) => {
            const isNow = step?.n === x.n;
            return (
              <div key={x.n} className="flex items-center gap-2">
                <div
                  className={`flex items-center gap-2 rounded-full py-1 pl-1 pr-3 ${
                    isNow ? "bg-[#F0A71F] text-[#1a1200]" : x.done ? "text-white/70" : "text-white/35"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                      isNow ? "bg-[#1a1200] text-[#F0A71F]" : x.done ? "bg-emerald-500/25 text-emerald-300" : "bg-white/10"
                    }`}
                  >
                    {x.done ? <Check className="h-3 w-3" /> : x.n}
                  </span>
                  <span className="text-xs font-semibold">{x.label}</span>
                </div>
                {i < steps.length - 1 && <span className="h-px w-3 bg-white/15" aria-hidden="true" />}
              </div>
            );
          })}
        </div>
        )}
      </div>

      {/* --------------------------------------------------- what to do next */}
      {!isLive && step && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-[#F0A71F]/10 px-5 py-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#F0A71F] text-xs font-bold text-[#1a1200]">
            {step.n}
          </span>
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">{step.label}.</span>{" "}
            <span className="text-muted-foreground">{step.hint}</span>
          </p>
          {step.n === 1 && (
            <Button
              size="sm"
              className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]"
              onClick={() =>
                navigator.clipboard.writeText(joinUrl).then(
                  () => toast({ title: "Join link copied", description: joinUrl }),
                  () => {},
                )
              }
              data-testid="button-copy-join"
            >
              <Copy className="h-3.5 w-3.5" /> Copy the join link
            </Button>
          )}
        </div>
      )}

      {/* ------------------------------------------------- the live surface */}
      {isLive && (
        <div
          className={`flex flex-col bg-[#04102b] ${
            focus ? "min-h-0 flex-1" : "h-[calc(100vh-15rem)] min-h-[520px]"
          }`}
        >
          {isPrimary && (current || next) && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-white/10 bg-[#000741] px-4 py-2 text-xs">
              <span className="flex min-w-0 items-center gap-2">
                <span className="font-bold uppercase tracking-[0.14em] text-[#ED1C24]">Now</span>
                <span className="truncate text-white/85">{current?.title ?? "Nothing scheduled"}</span>
              </span>
              {next && (
                <span className="flex min-w-0 items-center gap-2">
                  <span className="font-bold uppercase tracking-[0.14em] text-white/40">Next</span>
                  <span className="truncate text-white/60">
                    {formatTimeInZone(new Date(next.startAtUtc), zone)} · {next.title}
                  </span>
                </span>
              )}
            </div>
          )}

          {/* Links row — above the picture */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10 bg-[#04102b] px-3 py-1.5">
            {!isRoom && (
              <DeckButton
                icon={PlayCircle}
                label={studio?.fallbackPlaying ? "Stop standby" : studio?.fallbackVideoUrl ? "Roll standby" : "No standby set"}
                active={studio?.fallbackPlaying}
                amber
                onClick={() => patchStudio.mutate({ fallbackPlaying: !studio?.fallbackPlaying })}
                testId="button-deck-standby"
              />
            )}
            {!isRoom && studio?.logoUrl && (
              <DeckButton
                icon={ImageIcon}
                label={studio.logoVisible ? "Logo on" : "Logo off"}
                active={studio.logoVisible}
                amber
                onClick={() => patchStudio.mutate({ logoVisible: !studio.logoVisible })}
                testId="button-deck-logo"
              />
            )}
            {countdownEnds !== null && (
              <CountdownChip
                endsAt={countdownEnds}
                label={studio?.countdownLabel ?? ""}
                onClear={() => clearCountdown.mutate()}
              />
            )}
            <span className="ml-auto flex items-center gap-1.5">
              <a href={joinUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl bg-white/8 px-3 py-2 text-xs font-medium text-white/80 hover:bg-white/15" data-testid="link-deck-greenroom">
                <Users className="h-4 w-4" /> Green room link
              </a>
              <a href={watchUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl bg-white/8 px-3 py-2 text-xs font-medium text-white/80 hover:bg-white/15" data-testid="link-deck-watch">
                <Radio className="h-4 w-4" /> Watch page
              </a>
            </span>
          </div>

          <div className="flex min-h-0 flex-1">
            {/* green room, down the left, where a producer's eye already is */}
            <aside className="flex w-[300px] shrink-0 flex-col border-r border-white/10">
              {/* The rail is the show. One press cuts: its media on the stage,
                  its podcaster on, everyone else off. The dot by each face says
                  whether that person has actually arrived. */}
              {/* Every studio gets a rail, not just the event's own: a one-off
                  room is exactly where a countdown and a sponsor card earn
                  their keep. The agenda entries in the menu fold away when
                  there's no agenda behind them. */}
              <div className="flex min-h-0 flex-[3] flex-col border-b border-white/10">
                  <SceneRail
                    scenes={scenes ?? []}
                    currentSceneId={studio?.currentSceneId ?? 0}
                    zone={zone}
                    runItems={runItems ?? []}
                    signups={signups ?? []}
                    presentNames={present.map((p) => p.displayName || "")}
                    media={mediaItems ?? []}
                    busy={applyScene.isPending}
                    onApply={(id) => applyScene.mutate(id)}
                    onAdd={(spec) => addScene.mutate(spec)}
                    onPatch={(id, patch) => patchScene.mutate({ id, patch })}
                    onDelete={(id) => dropScene.mutate(id)}
                    onReorder={(ids) => reorderScenes.mutate(ids)}
                    onGenerate={() => generateScenes.mutate()}
                  />
              </div>
              <div className="flex min-h-0 flex-[2] flex-col">
              {onStage.length > 0 && (
                <div className="border-b border-white/10 px-3 py-2.5">
                  <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.14em] text-white/55">
                    On stage · {onStage.length}/{studio?.maxOnStage ?? 5}
                  </div>
                  <div className="space-y-1.5">
                    {onStage.map((p) => (
                      <div key={p.id} className="flex items-center gap-2 rounded-lg bg-[#ED1C24]/15 px-2 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-white">
                          {p.displayName || "Unnamed"}
                          {roomStatus === "connected" && !feeds.has(`p-${p.id}`) && (
                            <span className="block truncate text-[11px] font-normal text-[#F0A71F]" title="They're on the page but not in the media room. Ask them to reload the link.">
                              {p.camReady ? "Not in the room — ask them to reload" : "Camera not on yet"}
                            </span>
                          )}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 rounded-full px-2 text-[12px] text-white/70 hover:bg-white/10 hover:text-white"
                          onClick={() => setState.mutate({ id: p.id, state: "Green room" })}
                          data-testid={`button-live-down-${p.id}`}
                        >
                          <ArrowDown className="h-3 w-3" /> Off
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between px-4 py-2.5 text-[12px] font-bold uppercase tracking-[0.14em] text-white/55">
                <span className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" /> Green room
                </span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/80">{greenRoom.length}</span>
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
                {greenRoom.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-white/15 p-4 text-center text-xs text-white/45">
                    Nobody waiting.
                  </p>
                ) : (
                  greenRoom.map((p) => (
                    <div key={p.id} className="overflow-hidden rounded-xl bg-white/[0.06]">
                      <div className="relative aspect-video bg-black">
                        <FeedThumb
                          feed={feeds.get(`p-${p.id}`)}
                          initials={(p.displayName || "?").slice(0, 2).toUpperCase()}
                          fill
                        />
                      </div>
                      <div className="flex items-center gap-2 p-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-semibold text-white">{p.displayName || "Unnamed"}</div>
                          <div className="flex items-center gap-1.5 text-white/45">
                            {p.camReady ? (
                              <Video className="h-3 w-3 text-emerald-400" />
                            ) : (
                              <VideoOff className="h-3 w-3 text-[#ED1C24]" />
                            )}
                            {p.micReady ? (
                              <Mic className="h-3 w-3 text-emerald-400" />
                            ) : (
                              <MicOff className="h-3 w-3 text-[#ED1C24]" />
                            )}
                            {!p.camReady && !p.micReady ? (
                              <span className="truncate text-[11px] text-[#F0A71F]">Camera not on yet</span>
                            ) : roomStatus === "connected" && !feeds.has(`p-${p.id}`) ? (
                              <span className="truncate text-[11px] text-[#F0A71F]" title="Ask them to reload the link">Not in the room</span>
                            ) : null}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          className="h-7 gap-1 rounded-full px-2.5 text-[12px]"
                          disabled={stageFull}
                          title={stageFull ? `Stage is full at ${studio?.maxOnStage}` : "Bring them on stage"}
                          onClick={() => setState.mutate({ id: p.id, state: "On stage" })}
                          data-testid={`button-live-up-${p.id}`}
                        >
                          <ArrowUp className="h-3 w-3" /> On
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              </div>
            </aside>

            {/* the programme, filling whatever is left */}
            <div className="relative min-w-0 flex-1 bg-black">
              <StageGrid
                tiles={monitorTiles}
                meta={{
                  fallbackPlaying: studio?.fallbackPlaying,
                  fallbackVideoUrl: studio?.fallbackVideoUrl,
                  fallbackLabel: studio?.fallbackLabel,
                  stageMediaPlaying: studio?.stageMediaPlaying,
                  stageMediaUrl: studio?.stageMediaUrl,
                  stageMediaKind: studio?.stageMediaKind,
                  stageMediaLabel: studio?.stageMediaLabel,
                  // The monitor has to be the programme, not an approximation
                  // of it: whatever the audience gets, the producer sees.
                  countdownEndsAtUtc: studio?.countdownEndsAtUtc,
                  countdownLabel: studio?.countdownLabel,
                  logoUrl: studio?.logoVisible ? studio?.logoUrl : "",
                  logoCorner: studio?.logoCorner,
                  logoSize: studio?.logoSize,
                  eventName: currentStudio?.name,
                }}
                muted={monitorMuted}
                idleTitle={currentStudio?.name}
              />
              {recording && (
                <span className="pointer-events-none absolute right-4 top-4 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-[12px] font-semibold text-white">
                  <Disc className="h-3 w-3 text-[#ED1C24]" /> Recording
                </span>
              )}
            </div>

          </div>

          {/* the deck: share/mute on the left, YOU in the middle, volume on the right */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-white/10 bg-[#000741] px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <DeckButton icon={ImageIcon} label="Image" onClick={() => setMediaPicker("image")} testId="button-deck-image" />
              <DeckButton icon={Film} label="Video" active={studio?.stageMediaPlaying} onClick={() => setMediaPicker("video")} testId="button-deck-video" />
              <DeckButton
                icon={stageMuted ? MicOff : Mic}
                label={stageMuted ? "Stage muted" : "Mute stage"}
                active={stageMuted}
                onClick={() => muteStage.mutate(!stageMuted)}
                testId="button-deck-mute-stage"
              />
            </div>

            {/* Zoom-style cam + mic toggles — always visible, first click joins the room */}
            <div
              className={`flex items-center gap-1.5 rounded-2xl border-2 px-2 py-1.5 ${
                onCamera ? "border-emerald-500/70 bg-emerald-500/10" : "border-white/15 bg-white/5"
              }`}
              data-testid="deck-you"
            >
              <span className="px-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">You</span>
              <button
                type="button"
                onClick={() => { if (!onCamera) setOnCamera(true); void toggleCam(); }}
                className={`flex flex-col items-center gap-0.5 rounded-xl px-4 py-1.5 text-xs font-medium ${
                  onCamera && camOn ? "bg-white/10 text-white hover:bg-white/15" : "bg-[#ED1C24] text-white"
                }`}
                data-testid="button-deck-cam"
              >
                {onCamera && camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
                {onCamera && camOn ? "Camera" : "Camera off"}
              </button>
              <button
                type="button"
                onClick={() => { if (!onCamera) setOnCamera(true); void toggleMic(); }}
                className={`flex flex-col items-center gap-0.5 rounded-xl px-4 py-1.5 text-xs font-medium ${
                  onCamera && micOn ? "bg-white/10 text-white hover:bg-white/15" : "bg-[#ED1C24] text-white"
                }`}
                data-testid="button-deck-mic"
              >
                {onCamera && micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                {onCamera && micOn ? "Mic" : "Muted"}
              </button>
            </div>

            <div className="flex items-center justify-end gap-2">
              <DeckButton
                icon={monitorMuted ? VolumeX : Volume2}
                label={monitorMuted ? "Hear stage" : "Hearing stage"}
                onClick={() => setMonitorMuted((v) => !v)}
                testId="button-deck-volume"
              />
            </div>
          </div>
        </div>
      )}

      <Dialog open={mediaPicker !== null} onOpenChange={(o) => !o && setMediaPicker(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Put something on the stage</DialogTitle>
            <DialogDescription>
              This replaces the cameras on air until you stop it. The standby clip still overrides everything.
            </DialogDescription>
          </DialogHeader>

          {/* Tab bar */}
          <div className="flex gap-1 rounded-lg bg-muted p-1 shrink-0">
            {([["media", "Media Library"], ["presentations", "Presentations"]] as const).map(([tab, label]) => (
              <button
                key={tab}
                className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${mediaPicker === tab || (tab === "media" && mediaPicker !== "presentations") ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setMediaPicker(tab === "media" ? "all" : "presentations")}
              >{label}</button>
            ))}
          </div>

          {mediaPicker === "presentations" ? (
            <div className="flex flex-col gap-4 overflow-y-auto">
              {/* Upload form */}
              <form onSubmit={uploadPresentation} className="flex flex-col gap-2 rounded-xl border border-dashed p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Upload slide images</p>
                <input
                  className="text-sm"
                  type="text"
                  placeholder="Presentation name"
                  value={presName}
                  onChange={(e) => setPresName(e.target.value)}
                />
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="text-sm"
                  onChange={(e) => setPresFiles(e.target.files)}
                />
                <Button type="submit" size="sm" disabled={presUploading || !presFiles?.length} className="self-start gap-1.5">
                  {presUploading ? "Uploading…" : `Upload ${presFiles?.length ?? 0} slide${(presFiles?.length ?? 0) !== 1 ? "s" : ""}`}
                </Button>
              </form>
              {/* Presentation list */}
              {presData.map((pres) => {
                const cur = presSlideIdx[pres.id] ?? 0;
                const slide = pres.slides[cur];
                return (
                  <div key={pres.id} className="rounded-xl border p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-sm truncate">{pres.name}</p>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-xs text-muted-foreground">{cur + 1}/{pres.slides.length}</span>
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={cur === 0} onClick={() => setPresSlideIdx((s) => ({ ...s, [pres.id]: cur - 1 }))}>‹</Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={cur >= pres.slides.length - 1} onClick={() => setPresSlideIdx((s) => ({ ...s, [pres.id]: cur + 1 }))}>›</Button>
                        <Button size="sm" className="h-7 gap-1 px-2.5 text-xs" disabled={!slide} onClick={() => slide && putOnStage.mutate({ action: "play", url: slide.url, kind: "image", label: `${pres.name} · Slide ${cur + 1}` })}>
                          On stage
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deletePresentation.mutate(pres.id)}>×</Button>
                      </div>
                    </div>
                    {slide && <img src={slide.url} alt={`Slide ${cur + 1}`} className="w-full rounded-lg object-contain max-h-40 bg-black" />}
                    {/* Slide strip */}
                    <div className="flex gap-1 overflow-x-auto pb-1">
                      {pres.slides.map((s, i) => (
                        <button key={s.id} onClick={() => setPresSlideIdx((p) => ({ ...p, [pres.id]: i }))}
                          className={`shrink-0 rounded border-2 ${i === cur ? "border-primary" : "border-transparent"}`}
                        >
                          <img src={s.url} alt={`Slide ${i + 1}`} className="h-12 w-20 object-contain rounded bg-black" />
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {presData.length === 0 && !presUploading && (
                <p className="text-sm text-muted-foreground text-center py-4">No presentations yet. Upload slide images above.</p>
              )}
            </div>
          ) : (
            <MediaLibrary
              adminGet={adminGet}
              adminSend={adminSend}
              studioId={studioId}
              playingUrl={studio?.stageMediaUrl ?? ""}
              isPlaying={Boolean(studio?.stageMediaPlaying)}
              onChanged={refresh}
              only={mediaPicker === "all" || mediaPicker === null ? undefined : (mediaPicker as "image" | "video")}
              compact
            />
          )}
        </DialogContent>
      </Dialog>

      {!isLive && (
      <CardContent className="flex flex-col gap-6 pt-6">
        {studio?.fallbackPlaying && (
          <div
            className={`flex items-start gap-3 rounded-xl border-2 p-4 ${
              broadcasting ? "border-[#ED1C24] bg-[#ED1C24]/10" : "border-[#F0A71F] bg-[#F0A71F]/10"
            }`}
          >
            <AlertTriangle
              className={`mt-0.5 h-5 w-5 shrink-0 ${broadcasting ? "text-[#ED1C24]" : "text-[#F0A71F]"}`}
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {broadcasting ? "Standby video is on the air." : "Standby is armed, but nothing is going out."}
              </p>
              <p className="mt-0.5 break-words text-sm text-muted-foreground">
                {studio.fallbackLabel || studio.fallbackVideoUrl}.{" "}
                {broadcasting
                  ? "Everyone in the green room has been told to hold."
                  : "It will be the first thing the audience sees the moment you go out live."}
              </p>
              {standbyProblem(studio.fallbackVideoUrl) && (
                <p className="mt-2 text-sm font-medium text-[#ED1C24]">
                  {standbyProblem(studio.fallbackVideoUrl)}
                </p>
              )}
            </div>
          </div>
        )}

        {isPrimary && (current || next) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["On air now", current],
              ["Up next", next],
            ].map(([label, item]) => (
              <div
                key={label as string}
                className={`rounded-xl border p-4 ${
                  label === "On air now" ? "border-[#053877]/25 bg-[#053877]/5" : "border-border bg-muted/30"
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Clock className="h-3 w-3 text-primary" /> {label as string}
                </div>
                {item ? (
                  <>
                    <div className="mt-1 text-sm font-semibold">{(item as RunItemRow).title}</div>
                    <div className="mt-0.5 tabular-nums text-xs text-muted-foreground">
                      {formatTimeInZone(new Date((item as RunItemRow).startAtUtc), zone)}
                      {(item as RunItemRow).durationMinutes ? ` · ${(item as RunItemRow).durationMinutes}m` : ""}
                    </div>
                    {(item as RunItemRow).notes && (
                      <p className="mt-1.5 whitespace-pre-line text-xs text-muted-foreground">
                        {(item as RunItemRow).notes}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">Nothing scheduled.</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Capacity is the one thing about the room you decide beforehand. */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-muted/25 p-4">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
            <Radio className="h-3.5 w-3.5 text-primary" /> Stage size
          </div>
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            How many people can be on air at once. The producer can't exceed this mid-show.
          </p>
          <Select
            value={String(studio?.maxOnStage ?? 5)}
            onValueChange={(v) => patchStudio.mutate({ maxOnStage: Number(v) })}
          >
            <SelectTrigger className="h-9 w-[112px] text-sm" data-testid="select-studio-capacity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[2, 3, 4, 5, 6, 8].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  Max {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* ------------------------------------------------------------ output */}
        <section>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.12em]" style={HEADLINE_FONT}>
            Where it goes
          </h3>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-[#053877]/30 bg-[#053877]/5 p-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#053877] text-white">
                <Radio className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Our own watch page · always on</div>
                <p className="text-xs text-muted-foreground">
                  The audience watches here with no delay. Everything below is in addition to this, never instead of it.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  onClick={() =>
                    navigator.clipboard.writeText(watchUrl).then(
                      () => toast({ title: "Watch link copied", description: watchUrl }),
                      () => {},
                    )
                  }
                  data-testid="button-copy-watch"
                >
                  {watchUrl.replace(/^https?:\/\//, "")} <Copy className="h-3 w-3" />
                </button>
                <a
                  href={watchUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                  data-testid="link-open-watch"
                >
                  Open
                </a>
              </div>
            </div>

            <Destinations
              adminGet={adminGet}
              adminSend={adminSend}
              broadcasting={broadcasting}
              signups={signups ?? []}
            />

            <div className="grid gap-4">
              <div className="rounded-2xl border border-border bg-muted/25 p-4">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  <PlayCircle className="h-3.5 w-3.5 text-[#F0A71F]" /> Standby video
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  One button rolls this if something goes wrong. Keep something here at all times.
                </p>

                {studio?.fallbackVideoUrl ? (
                  <div className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-background p-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#053877] text-white">
                      <PlayCircle className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">
                        {studio.fallbackLabel || "Standby clip"}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {youtubeId(studio.fallbackVideoUrl) ? "YouTube video" : studio.fallbackVideoUrl}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => patchStudio.mutate({ fallbackVideoUrl: "", fallbackLabel: "" })}
                      aria-label="Remove the standby clip"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <p className="mt-3 rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                    Nothing queued. If the show falls over, the audience sees a holding card.
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    ref={standbyFileRef}
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadStandby(f);
                      e.target.value = "";
                    }}
                    data-testid="input-standby-file"
                  />
                  <Button
                    size="sm"
                    className="gap-1.5 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]"
                    disabled={standbyBusy}
                    onClick={() => standbyFileRef.current?.click()}
                    data-testid="button-standby-upload"
                  >
                    <Upload className="h-3.5 w-3.5" /> {standbyBusy ? "Uploading…" : "Upload a clip"}
                  </Button>
                  <span className="text-xs text-muted-foreground">or paste a YouTube link</span>
                </div>

                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_140px]">
                  <Input
                    placeholder="https://youtu.be/…"
                    value={fallbackUrl ?? studio?.fallbackVideoUrl ?? ""}
                    onChange={(e) => setFallbackUrl(e.target.value)}
                    data-testid="input-studio-fallback-url"
                  />
                  <Input
                    placeholder="Sponsor reel"
                    value={fallbackLabel ?? studio?.fallbackLabel ?? ""}
                    onChange={(e) => setFallbackLabel(e.target.value)}
                    data-testid="input-studio-fallback-label"
                  />
                </div>
                {standbyProblem(fallbackUrl ?? studio?.fallbackVideoUrl ?? "") && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-[#ED1C24]">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {standbyProblem(fallbackUrl ?? studio?.fallbackVideoUrl ?? "")}
                  </p>
                )}
                {youtubeId(fallbackUrl ?? studio?.fallbackVideoUrl ?? "") && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    YouTube plays, but whether it carries sound is the browser's call. For a real emergency, upload the
                    file.
                  </p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 rounded-full"
                  disabled={fallbackUrl === null && fallbackLabel === null}
                  onClick={() => {
                    patchStudio.mutate({
                      fallbackVideoUrl: fallbackUrl ?? studio?.fallbackVideoUrl ?? "",
                      fallbackLabel: fallbackLabel ?? studio?.fallbackLabel ?? "",
                    });
                    setFallbackUrl(null);
                    setFallbackLabel(null);
                  }}
                  data-testid="button-studio-save-fallback"
                >
                  Save the link
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-muted/25 p-4">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                <Clapperboard className="h-3.5 w-3.5 text-primary" /> Scenes
              </div>
              <p className="mb-3 mt-1 text-xs text-muted-foreground">
                Scenes are built and reordered on the rail in the Live tab, where you actually use them. This is the
                other way in: set the stage how you want it, then save that exact state under a name.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {(scenes ?? []).map((sc) => (
                  <span
                    key={sc.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background py-1 pl-3 pr-1 text-xs font-medium"
                  >
                    {sc.name}
                    <button
                      type="button"
                      className="rounded-full p-1 text-muted-foreground hover:text-destructive"
                      onClick={() => dropScene.mutate(sc.id)}
                      aria-label={`Remove ${sc.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (sceneName.trim()) {
                      saveScene.mutate(sceneName.trim());
                      setSceneName("");
                    }
                  }}
                >
                  <Input
                    className="h-8 w-40 text-xs"
                    placeholder="Name this scene"
                    value={sceneName}
                    onChange={(e) => setSceneName(e.target.value)}
                    data-testid="input-scene-name"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1 rounded-full text-xs"
                    disabled={!sceneName.trim() || saveScene.isPending}
                    data-testid="button-scene-save"
                  >
                    <Plus className="h-3 w-3" /> Save the stage
                  </Button>
                </form>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-muted/25 p-4">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                <ImageIcon className="h-3.5 w-3.5 text-primary" /> Graphics
              </div>
              <p className="mb-3 mt-1 text-xs text-muted-foreground">
                A logo in the corner of the frame, above every scene — cameras, clips and the break clock alike. It
                reaches the recording and every destination, because it's burned into the picture, not laid over the
                player. PNG or SVG with a transparent background sits best.
              </p>

              <div className="flex flex-wrap items-start gap-4">
                <div
                  className="relative flex h-24 w-40 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border"
                  style={{ background: "linear-gradient(135deg,#0a1628 0%,#1a2a4a 100%)" }}
                >
                  {studio?.logoUrl ? (
                    <img
                      src={studio.logoUrl}
                      alt=""
                      className={`absolute max-h-[38%] max-w-[38%] object-contain transition-opacity ${
                        studio.logoVisible ? "opacity-100" : "opacity-25"
                      } ${
                        studio.logoCorner === "top-left"
                          ? "left-2 top-2"
                          : studio.logoCorner === "bottom-left"
                            ? "bottom-2 left-2"
                            : studio.logoCorner === "bottom-right"
                              ? "bottom-2 right-2"
                              : "right-2 top-2"
                      }`}
                      data-testid="img-logo-preview"
                    />
                  ) : (
                    <span className="text-[11px] text-white/40">No logo yet</span>
                  )}
                </div>

                <div className="flex min-w-[15rem] flex-1 flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={logoFileRef}
                      type="file"
                      accept="image/png,image/svg+xml,image/webp,image/jpeg"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadLogo(f);
                        e.target.value = "";
                      }}
                      data-testid="input-studio-logo"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 rounded-full text-xs"
                      disabled={logoBusy}
                      onClick={() => logoFileRef.current?.click()}
                      data-testid="button-upload-logo"
                    >
                      <Upload className="h-3.5 w-3.5" /> {logoBusy ? "Uploading…" : studio?.logoUrl ? "Replace" : "Upload a logo"}
                    </Button>
                    {studio?.logoUrl && (
                      <label className="flex items-center gap-2 text-xs font-medium">
                        <Switch
                          checked={Boolean(studio.logoVisible)}
                          onCheckedChange={(v) => patchStudio.mutate({ logoVisible: v })}
                          data-testid="switch-logo-visible"
                        />
                        {studio.logoVisible ? "On air" : "Hidden"}
                      </label>
                    )}
                  </div>

                  {studio?.logoUrl && (
                    <>
                      <div>
                        <Label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                          Corner
                        </Label>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {LOGO_CORNERS.map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => patchStudio.mutate({ logoCorner: c })}
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
                                (studio.logoCorner || "top-right") === c
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border hover:bg-muted"
                              }`}
                              data-testid={`button-logo-corner-${c}`}
                            >
                              {c.replace("-", " ")}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <Label
                          htmlFor="logo-size"
                          className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
                        >
                          Size — {studio.logoSize || 96}px on a 1280-wide frame
                        </Label>
                        <input
                          id="logo-size"
                          type="range"
                          min={40}
                          max={320}
                          step={8}
                          value={studio.logoSize || 96}
                          onChange={(e) => patchStudio.mutate({ logoSize: Number(e.target.value) })}
                          className="mt-1.5 w-full accent-[#F0A71F]"
                          data-testid="input-logo-size"
                        />
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Scales with the frame, so it looks the same on the stream as it does here.
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-muted/25 p-4">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                <Film className="h-3.5 w-3.5 text-primary" /> Media you can put on the stage
              </div>
              <p className="mb-3 mt-1 text-xs text-muted-foreground">
                Intros, outros and sponsor reels the podcasters uploaded, ready to roll on air.
              </p>
              <MediaLibrary
                adminGet={adminGet}
                adminSend={adminSend}
                studioId={studioId}
                playingUrl={studio?.stageMediaUrl ?? ""}
                isPlaying={Boolean(studio?.stageMediaPlaying)}
                onChanged={refresh}
              />
            </div>

            {(feeds2 ?? []).length > 0 && (
              <div className="rounded-2xl border border-border bg-muted/25 p-4">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  <Cable className="h-3.5 w-3.5 text-primary" /> Their own encoders
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  These podcasters push in from their own software. They arrive in the green room like anyone else.
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  {(feeds2 ?? []).map((f) => (
                    <div
                      key={f.id}
                      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-3"
                      data-testid={`ingress-${f.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{f.displayName || f.ownerEmail}</div>
                        <div className="truncate font-mono text-xs text-muted-foreground">key {f.keyHint}</div>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {f.status === "2" ? "Receiving" : f.status === "1" ? "Waiting for their stream" : "Set up"}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => dropIngress.mutate(f.id)}
                        aria-label="Remove this feed"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </CardContent>
      )}
    </Card>
  );
}
