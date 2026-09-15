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
import { StageGrid, youtubeId, type StageTile } from "@/components/StageView";
import { MediaLibrary } from "@/components/MediaLibrary";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { STUDIO_STATUSES, type StudioRow, type StudioParticipantRow, type RunItemRow, type SignupRow } from "@shared/schema";
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
  const [mediaPicker, setMediaPicker] = useState<null | "image" | "video" | "all">(null);
  const [sceneName, setSceneName] = useState("");
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
  const { data: scenes } = useQuery<
    { id: number; name: string; mediaUrl: string; mediaLabel: string }[]
  >({
    queryKey: ["/api/admin/scenes", studioId],
    queryFn: () => adminGet(`/api/admin/scenes${q}`),
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
  const takeRow = useMutation({
    mutationFn: async (id: number) =>
      (await adminSend("POST", `/api/admin/run-of-show/${id}/take`, { studioId, eventId })).json(),
    onSuccess: afterTake,
    onError: (e: Error) => toast({ title: "Couldn't take that scene", description: e.message, variant: "destructive" }),
  });
  const takeNext = useMutation({
    mutationFn: async () => (await adminSend("POST", "/api/admin/run-of-show/next", { studioId, eventId })).json(),
    onSuccess: afterTake,
    onError: (e: Error) => toast({ title: "No next scene", description: e.message, variant: "destructive" }),
  });

  const muteStage = useMutation({
    mutationFn: async (muted: boolean) => adminSend("POST", "/api/admin/studio/mute-stage", { muted, studioId }),
    onSuccess: (_r, muted) => {
      setStageMuted(muted);
      refresh();
    },
    onError: (e: Error) => toast({ title: "Couldn't mute the stage", description: e.message, variant: "destructive" }),
  });

  const applyScene = useMutation({
    mutationFn: async (id: number) => adminSend("POST", `/api/admin/scenes/${id}/apply`, { studioId }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast({ title: "Couldn't take that scene", description: e.message, variant: "destructive" }),
  });

  const saveScene = useMutation({
    mutationFn: async (name: string) => adminSend("POST", "/api/admin/scenes", { name, studioId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/scenes", studioId] }),
    onError: (e: Error) => toast({ title: "Couldn't save that scene", description: e.message, variant: "destructive" }),
  });

  const dropScene = useMutation({
    mutationFn: async (id: number) => adminSend("DELETE", `/api/admin/scenes/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/scenes", studioId] }),
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

  async function uploadStandby(file: File) {
    setStandbyBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("label", file.name.replace(/\.[^.]+$/, ""));
      if (studioId) form.append("studioId", String(studioId));
      const res = await fetch("/api/admin/studio/standby", { method: "POST", body: form, credentials: "include" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any)?.message ?? "Upload failed");
      refresh();
      toast({ title: "Standby clip ready", description: file.name });
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
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            {p.camReady ? <Video className="h-3 w-3 text-emerald-600" /> : <VideoOff className="h-3 w-3 text-destructive" />}
            {p.micReady ? <Mic className="h-3 w-3 text-emerald-600" /> : <MicOff className="h-3 w-3 text-destructive" />}
            <span className="truncate">{p.role}</span>
          </div>
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
    .map((f) => ({ identity: f.identity, name: f.name, video: f.video, audio: f.audio, speaking: f.speaking }))
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
                        <Signal className="h-3.5 w-3.5" /> Go on air <ChevronDown className="h-3.5 w-3.5 opacity-80" />
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
                <span className="font-bold uppercase tracking-[0.14em] text-[#ED1C24]">On air</span>
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

          {/* What you can put on the stage, and where to look at it — above the picture, out of the deck. */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10 bg-[#04102b] px-3 py-1.5">
            <span className="mr-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white/40">Stage</span>
            <DeckButton icon={ImageIcon} label="Share image" onClick={() => setMediaPicker("image")} testId="button-deck-image" />
            <DeckButton icon={Film} label="Share video" active={studio?.stageMediaPlaying} onClick={() => setMediaPicker("video")} testId="button-deck-video" />
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
            <aside className="flex w-[272px] shrink-0 flex-col border-r border-white/10">
              {/* Scenes = the agenda. One press takes the row: its media on the
                  stage, its podcaster on, everyone else off. The dot by each
                  face says whether that person has actually arrived. */}
              {isPrimary && (runItems ?? []).length > 0 && (
                <div className="flex min-h-0 flex-[3] flex-col border-b border-white/10">
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.14em] text-white/55">
                      <ListOrdered className="h-3.5 w-3.5" /> Scenes
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/80">{(runItems ?? []).length}</span>
                    </span>
                    <Button
                      size="sm"
                      className="h-7 gap-1 rounded-full bg-[#F0A71F] px-3 text-[12px] font-bold text-[#1a1200] hover:bg-[#f7b73a]"
                      disabled={takeNext.isPending || takeRow.isPending}
                      onClick={() => takeNext.mutate()}
                      title="Take the next row of the agenda"
                      data-testid="button-next-scene"
                    >
                      Next scene <ArrowDown className="h-3 w-3 -rotate-90" />
                    </Button>
                  </div>

                  {(scenes ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1 px-3 pb-2">
                      {(scenes ?? []).map((sc) => {
                        const on = sc.mediaUrl
                          ? studio?.stageMediaPlaying && studio?.stageMediaUrl === sc.mediaUrl
                          : !studio?.stageMediaPlaying && !studio?.currentRunItemId;
                        return (
                          <button
                            key={sc.id}
                            type="button"
                            onClick={() => applyScene.mutate(sc.id)}
                            className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                              on ? "bg-[#F0A71F] text-[#1a1200]" : "bg-white/8 text-white/75 hover:bg-white/15"
                            }`}
                            data-testid={`button-scene-${sc.id}`}
                          >
                            {sc.name}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
                    {(runItems ?? []).map((r) => {
                      const taken = (studio?.currentRunItemId || 0) === r.id;
                      const isNow = !studio?.currentRunItemId && current?.id === r.id;
                      const sg = r.signupId ? (signups ?? []).find((x) => x.id === r.signupId) : undefined;
                      const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
                      const here = sg
                        ? present.some(
                            (p) =>
                              (p as { signupId?: number | null }).signupId === sg.id ||
                              (norm(p.displayName).length > 2 &&
                                (norm(sg.hostName).includes(norm(p.displayName)) || norm(p.displayName).includes(norm(sg.hostName)))),
                          )
                        : false;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          ref={(el) => {
                            if (el && taken) el.scrollIntoView({ block: "nearest" });
                          }}
                          onClick={() => takeRow.mutate(r.id)}
                          disabled={takeRow.isPending}
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                            taken
                              ? "bg-[#F0A71F] text-[#1a1200]"
                              : isNow
                                ? "bg-white/12 text-white"
                                : "text-white/70 hover:bg-white/8"
                          }`}
                          data-testid={`button-cue-${r.id}`}
                        >
                          <span className="w-12 shrink-0 text-[11px] tabular-nums opacity-70">
                            {r.startAtUtc ? formatTimeInZone(new Date(r.startAtUtc), zone) : "--:--"}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold">{r.title}</span>
                            <span className="flex items-center gap-1.5 text-[11px] opacity-70">
                              {r.kind}
                              {r.mediaUrl && <Film className="h-2.5 w-2.5" />}
                            </span>
                          </span>
                          {sg && (
                            <span className="relative shrink-0" title={here ? `${sg.hostName} is in the green room` : `${sg.hostName} hasn't arrived`}>
                              {sg.photoUrl ? (
                                <img src={sg.photoUrl} alt="" className="h-6 w-6 rounded-full object-cover ring-1 ring-white/20" />
                              ) : (
                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-[10px] font-bold">
                                  {(sg.hostName || "?").slice(0, 1).toUpperCase()}
                                </span>
                              )}
                              <span
                                className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[#000741] ${
                                  here ? "bg-emerald-400" : "bg-white/30"
                                }`}
                              />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
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
                            {!p.camReady && !p.micReady && (
                              <span className="truncate text-[11px] text-[#F0A71F]">Camera not on yet</span>
                            )}
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

          {/* the deck: the room's sound on the left, YOU in the middle, like Zoom */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-white/10 bg-[#000741] px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <DeckButton
                icon={stageMuted ? MicOff : Mic}
                label={stageMuted ? "Stage muted" : "Mute the stage"}
                active={stageMuted}
                onClick={() => muteStage.mutate(!stageMuted)}
                testId="button-deck-mute-stage"
              />
            </div>

            <div
              className={`flex items-center gap-1.5 rounded-2xl border-2 px-2 py-1.5 ${
                onCamera ? "border-emerald-500/70 bg-emerald-500/10" : "border-white/15 bg-white/5"
              }`}
              data-testid="deck-you"
            >
              <span className="px-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">You</span>
              {!onCamera ? (
                <button
                  type="button"
                  onClick={() => setOnCamera(true)}
                  className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400"
                  data-testid="button-deck-oncamera"
                >
                  <Video className="h-4 w-4" /> Go on camera
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void toggleCam()}
                    className={`flex flex-col items-center gap-0.5 rounded-xl px-4 py-1.5 text-xs font-medium ${
                      camOn ? "bg-white/10 text-white hover:bg-white/15" : "bg-[#ED1C24] text-white"
                    }`}
                    data-testid="button-deck-cam"
                  >
                    {camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
                    {camOn ? "Camera" : "Camera off"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleMic()}
                    className={`flex flex-col items-center gap-0.5 rounded-xl px-4 py-1.5 text-xs font-medium ${
                      micOn ? "bg-white/10 text-white hover:bg-white/15" : "bg-[#ED1C24] text-white"
                    }`}
                    data-testid="button-deck-mic"
                  >
                    {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                    {micOn ? "Mic" : "Muted"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMonitorMuted((v) => !v)}
                    className="flex flex-col items-center gap-0.5 rounded-xl bg-white/10 px-4 py-1.5 text-xs font-medium text-white hover:bg-white/15"
                    title="Whether you hear the stage in this browser"
                    data-testid="button-deck-volume"
                  >
                    {monitorMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                    {monitorMuted ? "Hear stage" : "Hearing stage"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOnCamera(false)}
                    className="ml-1 rounded-xl px-3 py-2 text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white"
                    data-testid="button-deck-offcamera"
                  >
                    Leave camera
                  </button>
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              {!onCamera && (
                <DeckButton
                  icon={monitorMuted ? VolumeX : Volume2}
                  label={monitorMuted ? "Hear the stage" : "Hearing the stage"}
                  onClick={() => setMonitorMuted((v) => !v)}
                  testId="button-deck-volume"
                />
              )}
            </div>
          </div>
        </div>
      )}

      <Dialog open={mediaPicker !== null} onOpenChange={(o) => !o && setMediaPicker(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Put something on the stage</DialogTitle>
            <DialogDescription>
              This replaces the cameras on air until you stop it. The standby clip still overrides everything.
            </DialogDescription>
          </DialogHeader>
          <MediaLibrary
            adminGet={adminGet}
            adminSend={adminSend}
            studioId={studioId}
            playingUrl={studio?.stageMediaUrl ?? ""}
            isPlaying={Boolean(studio?.stageMediaPlaying)}
            onChanged={refresh}
            only={mediaPicker === "all" ? undefined : (mediaPicker ?? undefined)}
            compact
          />
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
                Set the stage how you want it, then save it under a name. During the show it's one press —
                countdown, welcome, outro. A scene with nothing on the stage means "back to the cameras".
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
