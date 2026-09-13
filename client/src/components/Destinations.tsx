import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { PlatformIcon } from "@/components/SocialIcons";
import type { SocialPlatform, SignupRow } from "@shared/schema";
import { Radio, Plus, Trash2, Signal, SignalHigh } from "lucide-react";

// Where the show goes out. House destinations carry the whole event; one tied
// to a podcaster carries their slot only, and the producer attaches it when
// they come up — which is how the event borrows each speaker's own audience.

export interface Destination {
  id: number;
  signupId: number | null;
  platform: string;
  label: string;
  rtmpUrl: string;
  keyHint: string;
  enabled: boolean;
  live: boolean;
  ownerEmail: string;
}

const PLATFORMS = [
  { value: "youtube", label: "YouTube", hint: "rtmp://a.rtmp.youtube.com/live2" },
  { value: "x", label: "X", hint: "rtmp://va.pscp.tv:80/x" },
  { value: "twitch", label: "Twitch", hint: "rtmp://live.twitch.tv/app" },
  { value: "linkedin", label: "LinkedIn", hint: "" },
  { value: "instagram", label: "Instagram", hint: "rtmps://live-upload.instagram.com:443/rtmp" },
  { value: "custom", label: "Other RTMP", hint: "" },
] as const;

function isSocial(p: string): p is SocialPlatform {
  return ["youtube", "x", "linkedin", "instagram"].includes(p);
}

interface Props {
  adminGet: <T>(path: string) => Promise<T>;
  adminSend: (method: string, path: string, body?: unknown) => Promise<Response>;
  broadcasting: boolean;
  signups: SignupRow[];
}

export function Destinations({ adminGet, adminSend, broadcasting, signups }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);

  const { data } = useQuery<Destination[]>({
    queryKey: ["/api/admin/destinations"],
    queryFn: () => adminGet<Destination[]>("/api/admin/destinations"),
    refetchInterval: broadcasting ? 8000 : false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/destinations"] });
  const fail = (e: Error) => toast({ title: "That didn't work", description: e.message, variant: "destructive" });

  const setLive = useMutation({
    mutationFn: async ({ id, live }: { id: number; live: boolean }) =>
      adminSend("POST", `/api/admin/destinations/${id}/live`, { live }),
    onSuccess: refresh,
    onError: fail,
  });
  const patch = useMutation({
    mutationFn: async ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      adminSend("PATCH", `/api/admin/destinations/${id}`, body),
    onSuccess: refresh,
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: async (id: number) => adminSend("DELETE", `/api/admin/destinations/${id}`),
    onSuccess: refresh,
    onError: fail,
  });

  const all = data ?? [];
  const house = all.filter((d) => !d.signupId);
  const perSlot = all.filter((d) => d.signupId);
  const showName = (id: number | null) =>
    signups.find((sg) => sg.id === id)?.podcastName ?? "A podcaster";

  function Row({ d }: { d: Destination }) {
    return (
      <div
        className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${
          d.live ? "border-[#ED1C24]/50 bg-[#ED1C24]/5" : "border-border bg-background"
        }`}
        data-testid={`destination-${d.id}`}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#053877] text-white">
          {isSocial(d.platform) ? <PlatformIcon platform={d.platform} className="h-4 w-4" /> : <Radio className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {d.label || PLATFORMS.find((p) => p.value === d.platform)?.label || d.platform}
            {d.signupId && <span className="ml-2 text-xs font-normal text-muted-foreground">{showName(d.signupId)}</span>}
          </div>
          <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
            {d.rtmpUrl} · key {d.keyHint}
          </div>
        </div>

        {d.live ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ED1C24] px-2.5 py-1 text-xs font-semibold text-white">
            <SignalHigh className="h-3 w-3" /> On air
          </span>
        ) : (
          <div className="flex items-center gap-2">
            <Switch
              checked={d.enabled}
              onCheckedChange={(v) => patch.mutate({ id: d.id, enabled: v })}
              aria-label="Use this destination"
              data-testid={`switch-destination-${d.id}`}
            />
            <span className="text-xs text-muted-foreground">{d.enabled ? "Ready" : "Off"}</span>
          </div>
        )}

        {broadcasting && (
          <Button
            size="sm"
            variant={d.live ? "outline" : "default"}
            className="h-8 gap-1.5 rounded-full px-3 text-xs"
            disabled={setLive.isPending || (!d.enabled && !d.live)}
            onClick={() => setLive.mutate({ id: d.id, live: !d.live })}
            data-testid={`button-destination-live-${d.id}`}
          >
            <Signal className="h-3 w-3" /> {d.live ? "Drop" : "Add to broadcast"}
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          disabled={d.live}
          onClick={() => remove.mutate(d.id)}
          aria-label="Remove destination"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Radio className="h-3.5 w-3.5 text-primary" /> Going out to
        </div>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-full text-xs" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-3 w-3" /> Add destination
        </Button>
      </div>

      {all.length === 0 && !adding && (
        <p className="mt-3 text-sm text-muted-foreground">
          Nowhere yet. Add a YouTube, X or custom RTMP destination and the broadcast can go out.
        </p>
      )}

      {house.length > 0 && <div className="mt-3 flex flex-col gap-2">{house.map((d) => <Row key={d.id} d={d} />)}</div>}

      {perSlot.length > 0 && (
        <>
          <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Podcasters' own channels
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Add one when its slot starts and drop it when the slot ends. The rest of the broadcast keeps running.
          </p>
          <div className="mt-2 flex flex-col gap-2">{perSlot.map((d) => <Row key={d.id} d={d} />)}</div>
        </>
      )}

      {adding && <AddForm adminSend={adminSend} onDone={() => { setAdding(false); refresh(); }} />}
    </div>
  );
}

function AddForm({
  adminSend,
  onDone,
}: {
  adminSend: (method: string, path: string, body?: unknown) => Promise<Response>;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [platform, setPlatform] = useState<string>("youtube");
  const [label, setLabel] = useState("");
  const [rtmpUrl, setRtmpUrl] = useState<string>(PLATFORMS[0].hint);
  const [streamKey, setStreamKey] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await adminSend("POST", "/api/admin/destinations", { platform, label, rtmpUrl, streamKey, enabled: true });
      onDone();
    } catch (err) {
      toast({ title: "Couldn't add that", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 grid gap-3 rounded-xl border border-border bg-background p-4 sm:grid-cols-2">
      <div>
        <Label>Platform</Label>
        <Select
          value={platform}
          onValueChange={(v) => {
            setPlatform(v);
            const hint = PLATFORMS.find((p) => p.value === v)?.hint ?? "";
            if (hint) setRtmpUrl(hint);
          }}
        >
          <SelectTrigger className="mt-1" data-testid="select-destination-platform">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLATFORMS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="dest-label">Name it</Label>
        <Input
          id="dest-label"
          className="mt-1"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="MilitaryVoice YouTube"
          data-testid="input-destination-label"
        />
      </div>
      <div>
        <Label htmlFor="dest-url">RTMP server URL</Label>
        <Input
          id="dest-url"
          className="mt-1 font-mono text-xs"
          value={rtmpUrl}
          onChange={(e) => setRtmpUrl(e.target.value)}
          placeholder="rtmp://…"
          data-testid="input-destination-url"
        />
      </div>
      <div>
        <Label htmlFor="dest-key">Stream key</Label>
        <Input
          id="dest-key"
          type="password"
          className="mt-1 font-mono text-xs"
          value={streamKey}
          onChange={(e) => setStreamKey(e.target.value)}
          placeholder="Paste it here"
          data-testid="input-destination-key"
        />
        <p className="mt-1 text-xs text-muted-foreground">Stored server-side. Only the last four ever come back.</p>
      </div>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Button size="sm" disabled={saving || !rtmpUrl.trim() || !streamKey.trim()} onClick={() => void save()} data-testid="button-destination-save">
          {saving ? "Saving…" : "Add destination"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
