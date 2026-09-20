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
import { StudioRail, Hint } from "@/components/StudioRail";
import { stageMetaFromStudio } from "@shared/stageMeta";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { STUDIO_STATUSES, LOGO_CORNERS, type StudioRow, type StudioParticipantRow, type RunItemRow, type SignupRow, type SceneRow } from "@shared/schema";
import { detectLocalTimeZone, formatTimeInZone } from "@/lib/schedule";
import {
  MonitorPlay,
  Users,
  Headphones,
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
  Pause,
  Play,
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

/**
 * Who is waiting, as faces, in the bar above the stage.
 *
 * The green room used to take the bottom half of the left rail — the same rail
 * the scenes live in. On a 146-scene marathon that is the wrong trade: a
 * producer looks at the rail constantly and at the waiting list occasionally.
 * Up here it costs one row, the face is the thing you recognise anyway, and
 * the whole rail goes to scenes.
 */
function GreenRoomStrip({
  people,
  feeds,
  stageFull,
  maxOnStage,
  roomConnected,
  onStage,
}: {
  people: Participant[];
  feeds: Map<string, ProducerFeed>;
  stageFull: boolean;
  maxOnStage: number;
  roomConnected: boolean;
  onStage: (id: number) => void;
}) {
  // Empty is the normal state for most of a show, so it says so in a tooltip
  // rather than spending a pill on it.
  if (people.length === 0) {
    return (
      <span
        className="flex h-8 w-8 items-center justify-center rounded-lg text-white/35"
        title="Green room empty — nobody waiting to come on"
        data-testid="green-room-empty"
      >
        <Users className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5" data-testid="green-room-strip">
      <span
        className="flex h-8 items-center gap-1 pl-1 text-[12px] font-bold tabular-nums text-white/55"
        title={`${people.length} waiting in the green room`}
      >
        <Users className="h-4 w-4" /> {people.length}
      </span>
      <span className="flex items-center gap-1">
        {people.map((p) => {
          const name = p.displayName || "Unnamed";
          // Said in the tooltip rather than on screen: at a glance the ring is
          // enough, and the detail is there when the producer wants it.
          // Order matters, and it was wrong. Somebody who has not joined the
          // media room also reports cam=false, so the "camera not on yet"
          // branch caught them first and sent the producer looking for a
          // camera button on a page that never connected. Not being in the
          // room is the bigger fact and the one with a different fix, so it
          // is tested first.
          const inRoom = feeds.has(`p-${p.id}`);
          const trouble = roomConnected && !inRoom
            ? "hasn't joined the media room — ask them to reload their link"
            : !p.camReady && !p.micReady
              ? "camera not on yet"
              : "";
          const ready = p.camReady && p.micReady && !trouble;
          return (
            <Popover key={p.id}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  title={trouble ? `${name} — ${trouble}` : `${name} — ready`}
                  className={`relative h-8 w-8 shrink-0 overflow-hidden rounded-full ring-2 transition-transform hover:scale-105 ${
                    ready ? "ring-emerald-400" : "ring-[#F0A71F]"
                  }`}
                  data-testid={`green-room-avatar-${p.id}`}
                >
                  <FeedThumb feed={feeds.get(`p-${p.id}`)} initials={name.slice(0, 2).toUpperCase()} fill />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-60 p-3">
                <p className="truncate text-sm font-semibold">{name}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {p.camReady ? <Video className="h-3 w-3 text-emerald-600" /> : <VideoOff className="h-3 w-3 text-destructive" />}
                  {p.micReady ? <Mic className="h-3 w-3 text-emerald-600" /> : <MicOff className="h-3 w-3 text-destructive" />}
                  {trouble || "Ready to come on"}
                </p>
                <Button
                  size="sm"
                  className="mt-3 w-full gap-1.5 rounded-full"
                  disabled={stageFull}
                  title={stageFull ? `Stage is full at ${maxOnStage}` : undefined}
                  onClick={() => onStage(p.id)}
                  data-testid={`button-live-up-${p.id}`}
                >
                  <ArrowUp className="h-3 w-3" /> Bring on stage
                </Button>
              </PopoverContent>
            </Popover>
          );
        })}
      </span>
    </span>
  );
}

/**
 * One icon in the top bar. No word underneath — the bar is the thing that was
 * eating the room, and "No standby clip set" spelled out in 11px told a
 * producer nothing they could act on anyway. The tooltip says it in full.
 */
function BarButton({
  icon: Icon,
  label,
  onClick,
  active,
  amber,
  disabled,
  testId,
}: {
  icon: typeof Disc;
  label: string;
  onClick: () => void;
  active?: boolean;
  amber?: boolean;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <Hint label={label} side="bottom">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={!!active}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-35 ${
          active
            ? amber
              ? "bg-[#F0A71F] text-[#1a1200]"
              : "bg-[#ED1C24] text-white"
            : "text-white/60 hover:bg-white/10 hover:text-white"
        }`}
        data-testid={testId}
      >
        <Icon className="h-4 w-4" />
      </button>
    </Hint>
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
      title={label}
      aria-label={label}
      aria-pressed={!!active}
      // Icon above, word underneath, the way every conference deck does it.
      // Side-by-side at this size made a row of pills of different widths that
      // moved as their labels changed — "Mute stage" becoming "Stage muted"
      // shifted everything beside it, which is the last thing you want under
      // the hand of somebody cutting a live show.
      className={`flex w-[4.75rem] flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium leading-none transition-colors ${
        active
          ? amber
            ? "bg-[#F0A71F] text-[#1a1200]"
            : "bg-[#ED1C24] text-white"
          : "text-white/70 hover:bg-white/10 hover:text-white"
      }`}
      data-testid={testId}
    >
      <Icon className="h-5 w-5" />
      <span className="w-full truncate text-center">{label}</span>
    </button>
  );
}

/**
 * Says when the rendered standby clip no longer matches the lineup.
 *
 * Everything else on the public side rebuilds itself from the database. The
 * clip cannot: it is an encoded file with the faces burnt into it, so a host
 * who signs up after it was made is simply absent from the card inviting
 * people to watch them. That happened for weeks with the last one, and nothing
 * in the product said so — you would find out by watching your own pre-show
 * and counting.
 */
function StandbyFreshness({ adminGet, eventId }: { adminGet: <T>(path: string) => Promise<T>; eventId?: number }) {
  const { data } = useQuery<{
    lineup: number;
    build: { shows?: number; builtAt?: string; music?: string } | null;
    stale: boolean;
  }>({
    queryKey: ["/api/admin/standby-build", eventId ?? 0],
    queryFn: () => adminGet(`/api/admin/standby-build?eventId=${eventId ?? ""}`),
    staleTime: 60_000,
  });
  if (!data?.build) return null;

  const { build, lineup, stale } = data;
  const built = build.builtAt ? new Date(build.builtAt).toLocaleDateString() : "";
  const cmd = "npx tsx scripts/build-standby.ts --music media/standby-bed.mp3 --upload";

  return (
    <div
      className={`mt-3 rounded-xl border p-3 text-xs ${
        stale ? "border-[#F0A71F]/60 bg-[#F0A71F]/10" : "border-border bg-muted/30"
      }`}
      data-testid="panel-standby-freshness"
    >
      {stale ? (
        <>
          <p className="font-semibold text-foreground">
            The pre-event card is showing {build.shows} shows — the lineup now has {lineup}.
          </p>
          <p className="mt-1 text-muted-foreground">
            The faces are rendered into the file, so it can't update itself. Rebuild and it goes live in about twenty
            seconds:
          </p>
          <code className="mt-2 block overflow-x-auto rounded bg-background px-2 py-1.5 font-mono text-[11px]">
            {cmd}
          </code>
        </>
      ) : (
        <p className="text-muted-foreground">
          Pre-event card is current — {build.shows} shows, built {built}
          {build.music ? ` · ${build.music}` : ""}.
        </p>
      )}
    </div>
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
  // The stage monitor is a rule, not a button. You want to hear the show; you
  // never want to hear it while you are the one making it, because that is
  // your own voice back at you half a second late. So it follows where you
  // are, and the Listen toggle that used to get this wrong is gone.

  /**
   * Another console open in this browser, publishing.
   *
   * Two studio tabs both live on the same microphone is a feedback loop: your
   * voice goes into one room, comes out of the other tab's speakers, and back
   * into the mic. It sounds like the room is broken and the cause is invisible
   * — nothing on either screen mentions the other tab. A BroadcastChannel is
   * enough to notice, because the tabs are in the same browser by definition.
   */
  const [otherConsole, setOtherConsole] = useState<string>("");

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
    level,
    micTrack,
  } = useProducerRoom({ enabled: isLive, adminSend, studioId, publish: onCamera, displayName: "Host" });

  const studio = data?.studio;

  /**
   * Paused: the standby card is up and the stage is muted.
   *
   * Not a state of its own — it is the two things a producer does by hand when
   * they need to hold, and reading it back off those two flags means nothing
   * can disagree with reality. A separate "paused" column could say paused
   * while the stage was live, which is the one mistake worth designing out.
   */
  const paused = Boolean(studio?.fallbackPlaying) && stageMuted;
  const present = (data?.participants ?? []).filter((p) => p.present);
  const onStage = present.filter((p) => p.state === "On stage");
  const greenRoom = present.filter((p) => p.state !== "On stage");
  /**
   * The producer's own participant row.
   *
   * Turning your camera on publishes you into the room but leaves you in the
   * green room like anybody else, and the only way onto the stage was pressing
   * On beside your own name in a list you are not looking at — so a producer
   * could go live, record for seven minutes and capture nothing but the idle
   * card, with their camera on the whole time.
   */
  const me = selfKey ? present.find((p) => p.clientKey === selfKey) : undefined;
  const meOnStage = me?.state === "On stage";

  /**
   * Hearing yourself, the way a mixer does it.
   *
   * The stage monitor is a network round trip — up to LiveKit, mixed, back
   * down — so your own voice arrives about a second late. Delayed like that it
   * does not read as monitoring, it disrupts your speech, and the instinct is
   * to call the room broken. This plays the microphone straight back on the
   * machine it came from: no server, no mix, just the local audio path.
   *
   * Off by default and headphones-only on purpose. Through speakers it is a
   * loop, which is the exact problem it exists to solve.
   */
  const [hearSelf, setHearSelf] = useState(false);
  useEffect(() => {
    if (!hearSelf || !micTrack || !micOn) return;
    // Web Audio, not an <audio> element. An element buffers for smooth
    // playback, which is right for a stream off the network and wrong for
    // your own voice — the buffer is pure added delay on a path that has
    // nowhere to go. Routing the source straight at the destination, with
    // interactive latency asked for explicitly, is the shortest path the
    // browser offers.
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext({ latencyHint: "interactive" });
      const src = ctx.createMediaStreamSource(new MediaStream([micTrack]));
      src.connect(ctx.destination);
      void ctx.resume().catch(() => {});
    } catch {
      /* no audio context — the toggle simply does nothing */
    }
    return () => { void ctx?.close().catch(() => {}); };
  }, [hearSelf, micTrack, micOn]);
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

  // The lower third the scene on air carries, shown in the rail so a producer
  // can see where the name bar came from before they overwrite it.
  const currentSceneBanner = useMemo(() => {
    const sc = (scenes ?? []).find((x) => x.id === studio?.currentSceneId);
    return sc?.bannerTitle ? { name: sc.name, title: sc.bannerTitle } : null;
  }, [scenes, studio?.currentSceneId]);

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
  /**
   * Links to this studio, not to whichever one the site happens to feature.
   *
   * The studioId was only appended for non-primary studios, on the assumption
   * that a primary studio is the one /watch shows. That is only true of the
   * featured event: open the primary studio of any other event, press Watch
   * page, and you land on the marathon — a different event, live, with none of
   * your test on it. Always naming the studio removes the assumption.
   */
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const studioQuery = currentStudio ? `?studioId=${currentStudio.id}` : "";
  const watchUrl = `${origin}/watch${studioQuery}`;
  const joinUrl = `${origin}/studio${studioQuery}`;

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

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel("mv-studio-console");
    const label = currentStudio?.name ?? "another studio";
    let lastSeen = 0;

    ch.onmessage = (e) => {
      const m = e.data as { studioId?: number; publishing?: boolean; name?: string };
      if (!m?.publishing || m.studioId === studioId) return;
      lastSeen = Date.now();
      setOtherConsole(m.name || "another studio");
    };
    const beat = setInterval(() => {
      if (onCamera && micOn) ch.postMessage({ studioId, publishing: true, name: label });
      // Stop warning once the other tab has gone quiet for a few beats.
      if (lastSeen && Date.now() - lastSeen > 9000) setOtherConsole("");
    }, 3000);
    if (onCamera && micOn) ch.postMessage({ studioId, publishing: true, name: label });

    return () => {
      clearInterval(beat);
      ch.close();
    };
  }, [studioId, onCamera, micOn, currentStudio?.name]);

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
        className={`relative bg-[#000741] text-white ${isLive ? "px-4 py-2" : "px-5 py-4"} ${
          broadcasting ? "border-t-[3px] border-[#ED1C24]" : ""
        }`}
      >
        <div className="relative flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className={`flex shrink-0 items-center justify-center rounded-xl bg-white/10 ${
                isLive ? "h-8 w-8" : "h-9 w-9"
              }`}
            >
              <MonitorPlay className="h-4.5 w-4.5 text-[#F0A71F]" />
            </div>
            <div className="min-w-0">
              {renaming === null ? (
                <button
                  type="button"
                  className={`-mx-1 block truncate rounded px-1 font-bold leading-tight hover:bg-white/10 ${
                    isLive ? "text-[15px]" : "text-lg"
                  }`}
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

          {/* What used to be two full-width strips under this bar: a standby
              button, a logo button, the countdown and the green room. They
              cost about 70px of stage for four controls, and the two with
              words under them ("No standby clip set", "Logo off") were the two
              nobody could read anyway. Icons, in the bar, with tooltips. */}
          {isLive && (
            <div className="flex shrink-0 items-center gap-0.5">
              {!isRoom && (
                <BarButton
                  icon={PlayCircle}
                  label={
                    studio?.fallbackPlaying
                      ? "Stop the standby clip"
                      : studio?.fallbackVideoUrl
                        ? "Roll the standby clip"
                        : "No standby clip set — add one under Studio set"
                  }
                  active={studio?.fallbackPlaying}
                  amber
                  disabled={!studio?.fallbackVideoUrl}
                  onClick={() => patchStudio.mutate({ fallbackPlaying: !studio?.fallbackPlaying })}
                  testId="button-deck-standby"
                />
              )}
              {!isRoom && studio?.logoUrl && (
                <BarButton
                  icon={ImageIcon}
                  label={studio.logoVisible ? "Logo is on the frame — switch it off" : "Put the logo on the frame"}
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
              <span className="mx-1 h-6 w-px bg-white/15" aria-hidden="true" />
              <GreenRoomStrip
                people={greenRoom}
                feeds={feeds}
                stageFull={stageFull}
                maxOnStage={studio?.maxOnStage ?? 5}
                roomConnected={roomStatus === "connected"}
                onStage={(id) => setState.mutate({ id, state: "On stage" })}
              />
            </div>
          )}

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
                {/* Only when there is somewhere else to send it. With no
                    external destinations this said "To our watch page" and
                    opened an empty list — a control whose only state is its
                    default. */}
                {!isRoom && houseDestRows.length > 0 && (
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

                {/* One control, and its colour is the answer to "are we on".
                    Red means the button will put you on air; green means you
                    already are. It used to be red either way, with the state
                    hiding in a separate pill — so the most consequential fact
                    on the screen was the one thing it didn't say loudly. */}
                {broadcasting || recording ? (
                  <div className="flex items-center">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        className={`h-9 gap-2 rounded-l-full rounded-r-none border-r px-4 font-semibold text-white ${
                          paused
                            ? "border-[#1a1200]/20 bg-[#F0A71F] text-[#1a1200] shadow-[0_6px_20px_rgba(240,167,31,0.4)] hover:bg-[#f5b944]"
                            : "border-white/20 bg-emerald-600 shadow-[0_6px_20px_rgba(5,150,105,0.4)] hover:bg-emerald-700"
                        }`}
                        disabled={broadcast.isPending || record.isPending}
                        data-testid="button-end-all"
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${paused ? "bg-[#1a1200]" : "animate-pulse bg-white"}`}
                        />
                        {paused
                          ? "Paused"
                          : broadcasting && recording
                            ? "Live · recording"
                            : broadcasting
                              ? "Live"
                              : "Recording"}
                        <Square className="h-3.5 w-3.5 opacity-80" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {broadcasting ? "End the broadcast?" : "Stop recording?"}
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                          <div className="space-y-2">
                            {broadcasting && (
                              <p>
                                The watch page and every connected destination stop immediately. Anyone watching sees
                                the stream end.
                              </p>
                            )}
                            {recording && (
                              <p>
                                The recording is closed and saved. It appears in Recordings within a few minutes, and
                                the clipper picks it up from there.
                              </p>
                            )}
                            {/* The bit people get wrong: starting again is a
                                new stream, not a resumption, and every viewer
                                has to reconnect. */}
                            <p className="font-medium text-foreground">
                              Going live again starts a fresh stream — viewers have to reload, and a new recording
                              begins. This can't be undone.
                            </p>
                          </div>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel data-testid="button-end-cancel">Stay on air</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => {
                            if (recording) record.mutate({ action: "stop" });
                            if (broadcasting) broadcast.mutate("stop");
                          }}
                          data-testid="button-end-confirm"
                        >
                          {broadcasting ? "End the broadcast" : "Stop recording"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  {/* Pause beside End, because holding is the thing you
                      actually need mid-show and ending almost never is. It
                      keeps the stream up and the recording running — the
                      segment stays one file — and puts the standby card on
                      with the stage muted. Reversible, so it asks nothing. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        aria-label="Pause or hold"
                        className={`h-9 rounded-l-none rounded-r-full px-2.5 font-semibold text-white ${
                          paused
                            ? "bg-[#F0A71F] text-[#1a1200] hover:bg-[#f5b944]"
                            : "bg-emerald-600 hover:bg-emerald-700"
                        }`}
                        disabled={patchStudio.isPending || muteStage.isPending}
                        data-testid="button-live-options"
                      >
                        <ChevronDown className="h-3.5 w-3.5 opacity-80" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuItem
                        onClick={() => {
                          patchStudio.mutate({ fallbackPlaying: !paused });
                          muteStage.mutate(!paused);
                        }}
                        disabled={!studio?.fallbackVideoUrl && !paused}
                        data-testid="menu-pause"
                      >
                        {paused ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}
                        <span>
                          <span className="block font-semibold">{paused ? "Back on air" : "Pause"}</span>
                          <span className="block text-xs text-muted-foreground">
                            {paused
                              ? "Drop the standby card and unmute the stage"
                              : studio?.fallbackVideoUrl
                                ? "Standby card up, stage muted — stream and recording keep running"
                                : "Set a standby clip first"}
                          </span>
                        </span>
                      </DropdownMenuItem>
                      {recording && broadcasting && (
                        <DropdownMenuItem onClick={() => record.mutate({ action: "stop" })} data-testid="menu-stop-recording">
                          <Disc className="mr-2 h-4 w-4" />
                          <span>
                            <span className="block font-semibold">Stop recording</span>
                            <span className="block text-xs text-muted-foreground">Stay live, close the file</span>
                          </span>
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
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
                  /* Go live goes live. It used to open a menu of three
                     options, so the button everybody reaches for did nothing
                     visible and the actual action was a second click most
                     people never made. The common case — out to the watch page
                     and keep a recording — is now the button itself, and the
                     chevron beside it holds the other two. */
                  <div className="flex items-center">
                    <Button
                      size="sm"
                      className="h-9 gap-1.5 rounded-l-full rounded-r-none border-r border-white/20 bg-[#ED1C24] px-4 font-semibold text-white shadow-[0_6px_20px_rgba(237,28,36,0.45)] hover:bg-[#c81820]"
                      disabled={broadcast.isPending || record.isPending}
                      onClick={() => {
                        broadcast.mutate("start");
                        record.mutate({ action: "start", signupId: current?.signupId ?? undefined });
                      }}
                      data-testid="button-broadcast-toggle"
                    >
                      <Signal className="h-3.5 w-3.5" />
                      {broadcast.isPending || record.isPending ? "Going live…" : "Go live"}
                    </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        aria-label="Other ways to go live"
                        className="h-9 rounded-l-none rounded-r-full bg-[#ED1C24] px-2.5 font-semibold text-white shadow-[0_6px_20px_rgba(237,28,36,0.45)] hover:bg-[#c81820]"
                        disabled={broadcast.isPending || record.isPending}
                        data-testid="button-broadcast-options"
                      >
                        <ChevronDown className="h-3.5 w-3.5 opacity-80" />
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
                    </DropdownMenuContent>
                  </DropdownMenu>
                  </div>
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
              <div className="flex min-h-0 flex-1 flex-col">
                  <SceneRail
                    scenes={scenes ?? []}
                    currentSceneId={studio?.currentSceneId ?? 0}
                    zone={zone}
                    runItems={runItems ?? []}
                    signups={signups ?? []}
                    presentNames={present.map((p) => p.displayName || "")}
                    media={mediaItems ?? []}
                    searchable
                    busy={applyScene.isPending}
                    onApply={(id) => applyScene.mutate(id)}
                    onAdd={(spec) => addScene.mutate(spec)}
                    onPatch={(id, patch) => patchScene.mutate({ id, patch })}
                    onDelete={(id) => dropScene.mutate(id)}
                    onReorder={(ids) => reorderScenes.mutate(ids)}
                    onGenerate={() => generateScenes.mutate()}
                  />
              </div>
              {/* On stage stays — it is the thing a producer has to be able to
                  undo in one press. The green room moved to the bar above the
                  stage, which gives the whole rail to the scenes. */}
              {onStage.length > 0 && (
                <div className="shrink-0 border-t border-white/10 px-3 py-2.5">
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
            </aside>

            {/* the programme, filling whatever is left */}
            <div className="relative min-w-0 flex-1 bg-black">
              <StageGrid
                tiles={monitorTiles}
                // The monitor has to be the programme, not an approximation of
                // it: whatever the audience gets, the producer sees. Built by
                // the same function that builds the room's metadata, because
                // the hand-copied version of this object silently fell behind
                // and the rail's graphics reached air without ever reaching
                // the screen the producer was watching.
                meta={{ ...(studio ? stageMetaFromStudio(studio) : {}), eventName: currentStudio?.name }}
                muted={meOnStage}
                idleTitle={currentStudio?.name}
              />
              {recording && (
                <span className="pointer-events-none absolute right-4 top-4 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-[12px] font-semibold text-white">
                  <Disc className="h-3 w-3 text-[#ED1C24]" /> Recording
                </span>
              )}
            </div>

            {/* The graphics rail. It takes its width out of the stage rather
                than floating over it, so the picture the producer is judging
                is never partly covered by the panel they opened to change it. */}
            <StudioRail
              studio={studio ?? null}
              media={mediaItems ?? []}
              sceneBanner={currentSceneBanner}
              patch={(pch) => patchStudio.mutate(pch as Record<string, unknown>)}
              uploadLogo={uploadLogo}
              logoBusy={logoBusy}
              adminGet={adminGet}
              adminSend={adminSend}
              studioId={studioId}
              onMediaChanged={refresh}
            />
          </div>

          {otherConsole && onCamera && micOn && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F0A71F]/40 bg-[#F0A71F]/15 px-4 py-2 text-sm">
              <span className="flex items-center gap-2 text-white">
                <AlertTriangle className="h-4 w-4 shrink-0 text-[#F0A71F]" />
                Your microphone is also live in <span className="font-semibold">{otherConsole}</span> in another tab.
                That's what echoes.
              </span>
              <Button
                size="sm"
                className="h-7 shrink-0 rounded-full bg-[#F0A71F] text-xs font-semibold text-[#1a1200] hover:bg-[#f5b944]"
                onClick={() => void toggleMic()}
                data-testid="button-fix-feedback"
              >
                Mute me here
              </Button>
            </div>
          )}

          {/* the deck: share/mute on the left, YOU in the middle, volume on the right */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-10 border-t border-white/10 bg-[#000741] px-4 py-3">
            {/* The programme's own audio, on the left. Putting things on the
                stage moved to the + in the middle and to the Media panel in
                the rail — a deck button per source does not survive contact
                with a fourth source. */}
            {/* Mute stage and Listen used to sit here. Listen monitors the
                stage, and when the producer is the stage it plays their own
                voice back half a second late — every time, read as a fault in
                the room. The level meter answers "is my mic on" without
                putting sound in anyone's ears, so the monitor went with it. */}
            <div />

            {/* Zoom-style cam + mic toggles — always visible, first click joins the room */}
            {/* Your own camera and mic, the way every conference app draws
                them: the same stacked icon as the rest of the deck, red only
                on the slash. Two filled red blocks read as an error state
                rather than as "off", which is the normal way to sit in a
                studio before you are called up. */}
            <div className="flex items-center gap-1" data-testid="deck-you">
              <button
                type="button"
                onClick={() => { if (!onCamera) setOnCamera(true); void toggleCam(); }}
                title={onCamera && camOn ? "Turn your camera off" : "Turn your camera on"}
                aria-label={onCamera && camOn ? "Turn your camera off" : "Turn your camera on"}
                className="flex w-[4.75rem] flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium leading-none text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                data-testid="button-deck-cam"
              >
                {onCamera && camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5 text-[#ED1C24]" />}
                <span className="w-full truncate text-center">{onCamera && camOn ? "Camera" : "Camera off"}</span>
              </button>
              <button
                type="button"
                onClick={() => { if (!onCamera) setOnCamera(true); void toggleMic(); }}
                title={onCamera && micOn ? "Mute yourself" : "Unmute yourself"}
                aria-label={onCamera && micOn ? "Mute yourself" : "Unmute yourself"}
                className="flex w-[4.75rem] flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium leading-none text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                data-testid="button-deck-mic"
              >
                {onCamera && micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5 text-[#ED1C24]" />}
                <span className="w-full truncate text-center">{onCamera && micOn ? "Mic" : "Muted"}</span>
              </button>

              {/* Are you actually making a sound?
                  Without this the only way to answer that is Listen, which
                  plays the stage back — and when you are the stage, that is
                  your own voice half a second late. It reads as a fault, and
                  it is the reason a producer ends up debugging an echo
                  instead of checking a microphone. Bars move, mic works. */}
              <span
                className="flex h-9 items-end gap-[3px] self-center px-1"
                title={onCamera && micOn ? "Your microphone level" : "Unmute to see your level"}
                aria-label="Microphone level"
                data-testid="deck-mic-level"
              >
                {Array.from({ length: 7 }).map((_, i) => {
                  const lit = onCamera && micOn && level * 7 > i;
                  return (
                    <span
                      key={i}
                      className={`w-[3px] rounded-full transition-[height,background-color] duration-75 ${
                        lit ? "bg-[#F0A71F]" : "bg-white/20"
                      }`}
                      style={{ height: `${6 + i * 3}px` }}
                    />
                  );
                })}
              </span>

              <button
                type="button"
                onClick={() => setHearSelf((v) => !v)}
                title={hearSelf ? "Stop hearing yourself" : "Hear yourself in your headphones (no delay)"}
                aria-label="Hear yourself"
                aria-pressed={hearSelf}
                className={`flex w-[4.75rem] flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium leading-none transition-colors hover:bg-white/10 ${
                  hearSelf ? "text-[#F0A71F]" : "text-white/70 hover:text-white"
                }`}
                data-testid="button-deck-hear-self"
              >
                {hearSelf ? <Headphones className="h-5 w-5" /> : <Headphones className="h-5 w-5 opacity-60" />}
                <span className="w-full truncate text-center">{hearSelf ? "Hearing" : "Hear me"}</span>
              </button>

              {/* Onto the stage, from where you are. */}
              {onCamera && me && (
                <button
                  type="button"
                  // Going on stage turns the camera on. Going on with it off
                  // puts a black rectangle on the broadcast, which is never
                  // what anybody means by "put me on" — and it is exactly what
                  // happened: a minute of stage time recorded with no picture.
                  onClick={() => {
                    if (!meOnStage && !camOn) void toggleCam();
                    setState.mutate({ id: me.id, state: meOnStage ? "Green room" : "On stage" });
                  }}
                  disabled={setState.isPending}
                  title={meOnStage ? "Take yourself off the stage" : "Put yourself on the stage"}
                  className={`ml-1 flex w-[4.75rem] flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium leading-none transition-colors ${
                    meOnStage ? "bg-[#ED1C24] text-white" : "bg-white/10 text-white hover:bg-white/20"
                  }`}
                  data-testid="button-deck-self-stage"
                >
                  <Radio className="h-5 w-5" />
                  <span className="w-full truncate text-center">{meOnStage ? "On stage" : "Go on stage"}</span>
                </button>
              )}

              {/* Add a source. Everything that can be put on the stage lives
                  behind one button, the way it does in every conference deck,
                  so the bar stays the same width as sources are added. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title="Put something on the stage"
                    className="ml-1 flex w-[4.75rem] flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium leading-none text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                    data-testid="button-deck-add"
                  >
                    <Plus className="h-5 w-5" />
                    <span className="w-full truncate text-center">Add</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" side="top">
                  <DropdownMenuItem onSelect={() => setMediaPicker("image")} data-testid="menu-add-image">
                    <ImageIcon className="mr-2 h-4 w-4" /> Image
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setMediaPicker("video")} data-testid="menu-add-video">
                    <Film className="mr-2 h-4 w-4" /> Video
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setMediaPicker("presentations")} data-testid="menu-add-presentation">
                    <Clapperboard className="mr-2 h-4 w-4" /> Presentation
                  </DropdownMenuItem>
                  {studio?.stageMediaPlaying && (
                    <DropdownMenuItem
                      onSelect={() => putOnStage.mutate({ action: "stop" })}
                      data-testid="menu-add-clear"
                    >
                      <Square className="mr-2 h-4 w-4" /> Back to the cameras
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* The handful of settings you might actually change mid-show.
                  Everything else stays on the Set tab, where there is room to
                  read it. */}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    title="Studio settings"
                    className="flex w-[4.75rem] flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium leading-none text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                    data-testid="button-deck-settings"
                  >
                    <Settings2 className="h-5 w-5" />
                    <span className="w-full truncate text-center">Settings</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="center" side="top" className="w-64 space-y-3">
                  <div>
                    <Label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      People on stage at once
                    </Label>
                    <Select
                      value={String(studio?.maxOnStage ?? 5)}
                      onValueChange={(v) => patchStudio.mutate({ maxOnStage: Number(v) })}
                    >
                      <SelectTrigger className="mt-1 h-9" data-testid="select-deck-max-on-stage">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      Studio status
                    </Label>
                    <Select
                      value={studio?.status ?? "Offline"}
                      onValueChange={(v) => patchStudio.mutate({ status: v })}
                    >
                      <SelectTrigger className="mt-1 h-9" data-testid="select-deck-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STUDIO_STATUSES.map((st) => (
                          <SelectItem key={st} value={st}>
                            {st}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* Where other people are, on the right — they open a tab rather
                than changing what is on air, so they do not belong next to
                the controls that do. */}
            <div className="flex items-center justify-end gap-1">
              <a href={joinUrl} target="_blank" rel="noreferrer" title="Open the green room" data-testid="link-deck-green-room">
                <span className="flex w-[4.75rem] flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium leading-none text-white/70 transition-colors hover:bg-white/10 hover:text-white">
                  <Users className="h-5 w-5" />
                  <span className="w-full truncate text-center">Green room</span>
                </span>
              </a>
              <a href={watchUrl} target="_blank" rel="noreferrer" title="Open the watch page" data-testid="link-deck-watch">
                <span className="flex w-[4.75rem] flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium leading-none text-white/70 transition-colors hover:bg-white/10 hover:text-white">
                  <Radio className="h-5 w-5" />
                  <span className="w-full truncate text-center">Watch page</span>
                </span>
              </a>
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

                <StandbyFreshness adminGet={adminGet} eventId={eventId} />

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
