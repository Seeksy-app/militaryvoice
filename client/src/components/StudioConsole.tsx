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
import { STUDIO_STATUSES, type StudioRow, type StudioParticipantRow, type RunItemRow } from "@shared/schema";
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
} from "lucide-react";

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

  const { data, isLoading } = useQuery<StudioPayload>({
    queryKey: ["/api/admin/studio"],
    queryFn: () => adminGet<StudioPayload>("/api/admin/studio"),
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
    queryClient.invalidateQueries({ queryKey: ["/api/admin/studio"] });
  }

  const patchStudio = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => adminSend("PATCH", "/api/admin/studio", patch),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast({ title: "Couldn't update the studio", description: e.message, variant: "destructive" }),
  });

  const setState = useMutation({
    mutationFn: async ({ id, state }: { id: number; state: string }) =>
      adminSend("PATCH", `/api/admin/studio/participants/${id}`, { state }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast({ title: "Couldn't move them", description: e.message, variant: "destructive" }),
  });

  const drop = useMutation({
    mutationFn: async (id: number) => adminSend("DELETE", `/api/admin/studio/participants/${id}`),
    onSuccess: () => refresh(),
  });

  const live = studio?.status === "Live";
  const stageFull = !!studio && onStage.length >= studio.maxOnStage;
  const joinUrl = typeof window !== "undefined" ? `${window.location.origin}/studio` : "/studio";

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

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <MonitorPlay className="h-4 w-4" />
              Studio
              {live && (
                <Badge className="gap-1 bg-[#ED1C24] text-white hover:bg-[#ED1C24]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Live
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Who's waiting, who's on stage, and the standby clip. Speakers join at{" "}
              <button
                type="button"
                className="inline-flex items-center gap-1 text-primary hover:underline"
                onClick={() => {
                  navigator.clipboard.writeText(joinUrl).then(
                    () => toast({ title: "Link copied", description: joinUrl }),
                    () => {},
                  );
                }}
              >
                {joinUrl.replace(/^https?:\/\//, "")} <Copy className="h-3 w-3" />
              </button>
              <span className="ml-2 inline-flex items-center gap-1.5 text-xs">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    roomStatus === "connected"
                      ? "bg-emerald-500"
                      : roomStatus === "error"
                        ? "bg-destructive"
                        : "bg-muted-foreground/40"
                  }`}
                />
                {roomStatus === "connected"
                  ? "Camera and sound connected"
                  : roomStatus === "connecting"
                    ? "Connecting to the room…"
                    : roomStatus === "error"
                      ? "Couldn't reach the media room"
                      : "Media layer off"}
              </span>
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={studio?.status ?? "Offline"} onValueChange={(v) => patchStudio.mutate({ status: v })}>
              <SelectTrigger className="h-9 w-[130px]" data-testid="select-studio-status">
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

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  className={`gap-1.5 rounded-full ${
                    studio?.fallbackPlaying
                      ? "bg-[#ED1C24] text-white hover:bg-[#c81820]"
                      : "bg-[#F0A71F] text-[#1a1200] hover:bg-[#f5b944]"
                  }`}
                  data-testid="button-studio-fallback"
                >
                  <PlayCircle className="h-3.5 w-3.5" />
                  {studio?.fallbackPlaying ? "Stop standby video" : "Start video now"}
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
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {studio?.fallbackPlaying && (
          <div className="flex items-start gap-3 rounded-xl border-2 border-[#ED1C24] bg-[#ED1C24]/10 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#ED1C24]" />
            <div>
              <p className="text-sm font-semibold">Standby video is on the air.</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {studio.fallbackLabel || studio.fallbackVideoUrl}. Everyone in the green room has been told to hold.
              </p>
            </div>
          </div>
        )}

        {/* what the run of show says is happening now */}
        {(current || next) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["On air now", current],
              ["Up next", next],
            ].map(([label, item]) => (
              <div key={label as string} className="rounded-xl border border-border bg-muted/30 p-4">
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
                      <p className="mt-1.5 whitespace-pre-line text-xs text-muted-foreground">{(item as RunItemRow).notes}</p>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">Nothing scheduled.</p>
                )}
              </div>
            ))}
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* green room */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  <Users className="h-4 w-4" /> Green room ({greenRoom.length})
                </h3>
              </div>
              {greenRoom.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                  Nobody waiting. Send them the join link above.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {greenRoom.map((p) => (
                    <Tile key={p.id} p={p} stage={false} />
                  ))}
                </div>
              )}
            </div>

            {/* stage */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  <Radio className="h-4 w-4" /> On stage ({onStage.length}/{studio?.maxOnStage ?? 5})
                </h3>
                <Select
                  value={String(studio?.maxOnStage ?? 5)}
                  onValueChange={(v) => patchStudio.mutate({ maxOnStage: Number(v) })}
                >
                  <SelectTrigger className="h-7 w-[110px] text-xs" data-testid="select-studio-capacity">
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
                <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                  Stage is empty.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {onStage.map((p) => (
                    <Tile key={p.id} p={p} stage />
                  ))}
                </div>
              )}
              {stageFull && <p className="mt-2 text-xs text-muted-foreground">Stage is full. Take someone off to add another.</p>}
            </div>
          </div>
        )}

        {/* standby clip */}
        <div className="rounded-xl border border-border bg-muted/20 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Standby video</p>
          <div className="grid gap-3 sm:grid-cols-[1fr_200px_auto]">
            <div>
              <Label className="text-xs">Video URL</Label>
              <Input
                className="mt-1"
                placeholder="https://…  (mp4 or a stream URL)"
                value={fallbackUrl ?? studio?.fallbackVideoUrl ?? ""}
                onChange={(e) => setFallbackUrl(e.target.value)}
                data-testid="input-studio-fallback-url"
              />
            </div>
            <div>
              <Label className="text-xs">Label</Label>
              <Input
                className="mt-1"
                placeholder="Sponsor reel"
                value={fallbackLabel ?? studio?.fallbackLabel ?? ""}
                onChange={(e) => setFallbackLabel(e.target.value)}
                data-testid="input-studio-fallback-label"
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                className="rounded-full"
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
                Save
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            One button rolls this if something goes wrong. Keep something here at all times.
          </p>
        </div>

        {stale.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {stale.length} {stale.length === 1 ? "person has" : "people have"} dropped off and stopped reporting in.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
