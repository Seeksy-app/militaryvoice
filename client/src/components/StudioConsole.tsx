import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
} from "lucide-react";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

interface Props {
  adminGet: <T>(path: string) => Promise<T>;
  adminSend: (method: string, path: string, body?: unknown) => Promise<Response>;
}

type Participant = StudioParticipantRow & { present: boolean };
interface StudioPayload {
  studio: StudioRow;
  participants: Participant[];
}


/** Live camera thumbnail for one participant, or their initials if they
 *  haven't published yet. Muted: the control room monitors on the stage feed,
 *  not by playing every green-room mic at once. */
function FeedThumb({ feed, initials }: { feed?: ProducerFeed; initials: string }) {
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
    <div className="relative h-11 w-[74px] shrink-0 overflow-hidden rounded-lg bg-[#053877]">
      {feed?.video ? (
        <video ref={ref} autoPlay playsInline muted className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm font-bold text-white">{initials}</div>
      )}
    </div>
  );
}

export function StudioConsole({ adminGet, adminSend }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const zone = useMemo(detectLocalTimeZone, []);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [fallbackLabel, setFallbackLabel] = useState<string | null>(null);

  // Which room we're looking at. Remembered per browser so a refresh mid-show
  // doesn't drop you back into the wrong studio.
  const [studioId, setStudioId] = useState<number | null>(() => {
    const v = Number(localStorage.getItem("mv_admin_studio"));
    return Number.isFinite(v) && v > 0 ? v : null;
  });
  const [renaming, setRenaming] = useState<string | null>(null);

  const { data: studios } = useQuery<(StudioRow & { isPrimary: boolean })[]>({
    queryKey: ["/api/admin/studios"],
    queryFn: () => adminGet("/api/admin/studios"),
  });

  const pick = (id: number | null) => {
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
    queryKey: ["/api/admin/run-of-show"],
    queryFn: () => adminGet<RunItemRow[]>("/api/admin/run-of-show"),
  });

  // Live pictures for the green room, when the event has a media layer.
  const { status: roomStatus, feeds } = useProducerRoom({ enabled: true, adminSend });

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
  const { data: dests } = useQuery<{ id: number; enabled: boolean; signupId: number | null }[]>({
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

  const live = studio?.status === "Live";
  const recording = Boolean(studio?.recordingEgressId);
  const broadcasting = Boolean(studio?.broadcastEgressId);
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

  const currentStudio = (studios ?? []).find((x) => x.id === (studioId ?? studios?.[0]?.id));
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

  const houseDests = (dests ?? []).filter((d) => d.enabled && !d.signupId).length;
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
    <Card className="overflow-hidden">
      {/* ---------------------------------------------------- the control bar */}
      <div className={`relative ${broadcasting || live ? "bg-[#3d0a0d]" : "bg-[#000741]"} px-5 py-4 text-white`}>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_140%_at_15%_0%,rgba(240,167,31,0.16),transparent_60%)]"
        />
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
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/55">
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

          {broadcasting && (
            <span className="inline-flex items-center gap-2 rounded-full bg-[#ED1C24] px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.14em]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> On air
            </span>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select
              value={String(currentStudio?.id ?? "")}
              onValueChange={(v) => (v === "new" ? makeStudio.mutate("New studio") : pick(Number(v)))}
            >
              <SelectTrigger
                className="h-9 w-[180px] border-white/20 bg-white/10 text-white hover:bg-white/15"
                data-testid="select-studio"
              >
                <SelectValue placeholder="Studio" />
              </SelectTrigger>
              <SelectContent>
                {(studios ?? []).map((st) => (
                  <SelectItem key={st.id} value={String(st.id)}>
                    {st.name}
                    {st.isPrimary ? " · event studio" : ""}
                  </SelectItem>
                ))}
                <SelectItem value="new">+ New studio…</SelectItem>
              </SelectContent>
            </Select>

            <Select value={studio?.status ?? "Offline"} onValueChange={(v) => patchStudio.mutate({ status: v })}>
              <SelectTrigger
                className="h-9 w-[124px] border-white/20 bg-white/10 text-white hover:bg-white/15"
                data-testid="select-studio-status"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STUDIO_STATUSES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

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

            <span className="mx-1 hidden h-7 w-px bg-white/15 sm:block" />

            <Button
              size="sm"
              className={`h-9 gap-1.5 rounded-full px-4 font-semibold ${
                broadcasting
                  ? "bg-white/15 text-white hover:bg-white/25"
                  : "bg-[#ED1C24] text-white shadow-[0_6px_20px_rgba(237,28,36,0.45)] hover:bg-[#c81820]"
              }`}
              disabled={broadcast.isPending}
              onClick={() => broadcast.mutate(broadcasting ? "stop" : "start")}
              data-testid="button-broadcast-toggle"
            >
              <Signal className="h-3.5 w-3.5" /> {broadcasting ? "Stop the broadcast" : "Go out live"}
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  className={`h-9 gap-1.5 rounded-full px-4 font-semibold ${
                    studio?.fallbackPlaying
                      ? "bg-[#ED1C24] text-white hover:bg-[#c81820]"
                      : "bg-[#F0A71F] text-[#1a1200] hover:bg-[#f5b944]"
                  }`}
                  data-testid="button-studio-fallback"
                >
                  <PlayCircle className="h-3.5 w-3.5" />
                  {studio?.fallbackPlaying ? "Stop standby" : "Start video now"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {studio?.fallbackPlaying ? "Stop the standby video?" : "Roll the standby video?"}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {studio?.fallbackPlaying
                      ? "The broadcast goes back to the stage. Make sure someone is ready before you cut back."
                      : studio?.fallbackVideoUrl
                        ? `"${studio.fallbackLabel || studio.fallbackVideoUrl}" starts immediately and everyone in the green room is told to hold.`
                        : "No standby clip is set yet. Add one below first, otherwise there's nothing to roll."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={!studio?.fallbackPlaying && !studio?.fallbackVideoUrl}
                    onClick={() => patchStudio.mutate({ fallbackPlaying: !studio?.fallbackPlaying })}
                  >
                    {studio?.fallbackPlaying ? "Stop it" : "Roll it"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* ------------------------------------------------ where you are in it */}
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
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
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
      </div>

      {/* --------------------------------------------------- what to do next */}
      {step && (
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
                    <div className="mt-0.5 font-mono text-xs text-muted-foreground">
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

        {/* ------------------------------------------------------------ people */}
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-bold uppercase tracking-[0.12em]" style={HEADLINE_FONT}>
              The room
            </h3>
            <a
              href={joinUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#053877] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#0a4a99]"
              data-testid="link-join-as-host"
            >
              <Video className="h-3.5 w-3.5" /> Join as host
            </a>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              onClick={() =>
                navigator.clipboard.writeText(joinUrl).then(
                  () => toast({ title: "Join link copied", description: joinUrl }),
                  () => {},
                )
              }
            >
              {joinUrl.replace(/^https?:\/\//, "")} <Copy className="h-3 w-3" />
            </button>
          </div>

          {/* programme monitor — what the audience is seeing right now */}
          <div className="mb-4 overflow-hidden rounded-2xl border border-border bg-[#000741]">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
              <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/60">
                <MonitorPlay className="h-3.5 w-3.5 text-[#F0A71F]" /> Programme monitor
              </span>
              <span className="text-[11px] text-white/45">
                {monitorTiles.length > 0
                  ? `${monitorTiles.length} on air`
                  : studio?.fallbackPlaying
                    ? "Standby clip"
                    : "Holding card"}
              </span>
            </div>
            <div className="relative aspect-video w-full">
              <StageGrid
                tiles={monitorTiles}
                meta={{
                  fallbackPlaying: studio?.fallbackPlaying,
                  fallbackVideoUrl: studio?.fallbackVideoUrl,
                  fallbackLabel: studio?.fallbackLabel,
                  eventName: currentStudio?.name,
                }}
                muted
                idleTitle={currentStudio?.name}
              />
            </div>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-border bg-muted/25 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    <Users className="h-3.5 w-3.5" /> Green room
                    <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-semibold">
                      {greenRoom.length}
                    </span>
                  </h4>
                </div>
                {greenRoom.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center">
                    <Users className="mx-auto h-5 w-5 text-muted-foreground/40" />
                    <p className="mt-2 text-sm text-muted-foreground">Nobody waiting yet.</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Send them the join link above.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {greenRoom.map((p) => (
                      <Tile key={p.id} p={p} stage={false} />
                    ))}
                  </div>
                )}
              </div>

              <div
                className={`rounded-2xl border p-4 ${
                  onStage.length > 0 ? "border-[#ED1C24]/40 bg-[#ED1C24]/5" : "border-border bg-muted/25"
                }`}
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    <Radio className="h-3.5 w-3.5" /> On stage
                    <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-semibold">
                      {onStage.length}/{studio?.maxOnStage ?? 5}
                    </span>
                  </h4>
                  <Select
                    value={String(studio?.maxOnStage ?? 5)}
                    onValueChange={(v) => patchStudio.mutate({ maxOnStage: Number(v) })}
                  >
                    <SelectTrigger className="h-7 w-[104px] text-xs" data-testid="select-studio-capacity">
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
                {onStage.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center">
                    <Radio className="mx-auto h-5 w-5 text-muted-foreground/40" />
                    <p className="mt-2 text-sm text-muted-foreground">Nobody on air.</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Press <strong>On</strong> beside a name to bring them up.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {onStage.map((p) => (
                      <Tile key={p.id} p={p} stage />
                    ))}
                  </div>
                )}
                {stageFull && (
                  <p className="mt-2 text-xs text-muted-foreground">Stage is full. Take someone off to add another.</p>
                )}
              </div>
            </div>
          )}
          {stale.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {stale.length} {stale.length === 1 ? "person has" : "people have"} dropped off and stopped reporting in.
            </p>
          )}
        </section>

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

            <div className="grid gap-4 lg:grid-cols-2">
              <div
                className={`flex flex-col gap-3 rounded-2xl border p-4 ${
                  recording ? "border-[#ED1C24]/50 bg-[#ED1C24]/5" : "border-border bg-muted/25"
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  <Disc className={`h-3.5 w-3.5 ${recording ? "text-[#ED1C24]" : "text-primary"}`} /> Recording
                </div>
                <p className="flex-1 text-sm text-muted-foreground">
                  {recording
                    ? "This slot is being kept. It lands in the podcaster's dashboard when you stop."
                    : current?.title
                      ? `Ready to keep "${current.title}".`
                      : "Records the room to one file for the slot that's on air."}
                </p>
                {recording ? (
                  <Button
                    size="sm"
                    className="w-fit gap-1.5 rounded-full bg-[#ED1C24] text-white hover:bg-[#c81820]"
                    disabled={record.isPending}
                    onClick={() => record.mutate({ action: "stop" })}
                    data-testid="button-studio-record-stop"
                  >
                    <Square className="h-3.5 w-3.5" /> Stop and save
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-fit gap-1.5 rounded-full"
                    disabled={record.isPending}
                    onClick={() => record.mutate({ action: "start", signupId: current?.signupId ?? undefined })}
                    data-testid="button-studio-record-start"
                  >
                    <Disc className="h-3.5 w-3.5" /> Record this slot
                  </Button>
                )}
              </div>

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
    </Card>
  );
}
