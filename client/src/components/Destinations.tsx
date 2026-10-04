import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminGet as getAdmin } from "@/lib/adminApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { PlatformIcon } from "@/components/SocialIcons";
import type { SocialPlatform, SignupRow } from "@shared/schema";
import { Radio, Plus, Trash2, Signal, SignalHigh } from "lucide-react";
import { StreamKeyHelp } from "@/components/StreamKeyHelp";
import { IconTile } from "@/components/ui/icon-tile";

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
  { value: "linkedin", label: "LinkedIn Live", hint: "" },
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
    mutationFn: async ({ id, live }: { id: number; live: boolean }) => {
      try {
        return await adminSend("POST", `/api/admin/destinations/${id}/live`, { live });
      } catch (e) {
        // A podcaster's channel before its time: only on a deliberate yes.
        const msg = (e as Error).message;
        if (!live || !/^Not their time yet/.test(msg)) throw e;
        if (!window.confirm(`${msg}\n\nSend to their channel anyway, as a test?`)) return null;
        return adminSend("POST", `/api/admin/destinations/${id}/live`, { live, test: true });
      }
    },
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
        <IconTile icon={Radio}>
          {isSocial(d.platform) ? <PlatformIcon platform={d.platform} className="h-6 w-6" /> : undefined}
        </IconTile>
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
        <div className="flex items-center gap-4">
          <StreamKeyHelp />
          <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-full text-xs" onClick={() => setAdding((v) => !v)}>
            <Plus className="h-3 w-3" /> Add destination
          </Button>
        </div>
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

/** The Marathon's four LinkedIn Live events, Eastern. */
const LINKEDIN_BLOCKS = ["7–11 AM ET", "11 AM–3 PM ET", "3–7 PM ET", "7–11 PM ET"];

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
  // LinkedIn Live caps a stream at four hours, so the day is four events, each with its own key.
  const [block, setBlock] = useState<string>("0");
  // YouTube, no key: a channel an admin connected with Google, and the studio opens the broadcast.
  const channels = useQuery<{ configured: boolean; channels: { id: number; title: string; email: string }[] }>({
    queryKey: ["/api/admin/studio/youtube-channels"],
    queryFn: () => getAdmin("/api/admin/studio/youtube-channels"),
  });
  const list = channels.data?.channels ?? [];
  const [channelId, setChannelId] = useState<number | null>(null);
  const [privacy, setPrivacy] = useState<"unlisted" | "public">("unlisted");
  const [useKey, setUseKey] = useState(false);
  const pickedChannel = channelId ?? list[0]?.id ?? null;
  const connected = platform === "youtube" && !useKey;

  async function addYoutube() {
    if (!pickedChannel) return;
    setSaving(true);
    try {
      const r = await adminSend("POST", "/api/admin/studio/youtube", { accountId: pickedChannel, privacy });
      const out = (await r.json()) as { watchUrl?: string };
      toast({ title: "YouTube is ready", description: out.watchUrl ? `It goes live there when you press Go live: ${out.watchUrl}` : "It goes live there when you press Go live." });
      onDone();
    } catch (err) {
      toast({ title: "Couldn't open YouTube", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const li = platform === "linkedin" && block !== "none";
      await adminSend("POST", "/api/admin/destinations", {
        platform,
        label: label.trim() || (li ? `LinkedIn · ${LINKEDIN_BLOCKS[Number(block)]}` : ""),
        rtmpUrl, streamKey, enabled: true,
        ...(li ? { linkedinBlock: Number(block) } : {}),
      });
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
      {connected ? (
        <div className="sm:col-span-2">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No channel connected yet.{" "}
              <a href="/api/admin/youtube/connect-studio" className="font-semibold text-[#053877] hover:underline dark:text-white" data-testid="link-studio-connect-youtube">Connect a YouTube channel</a>{" "}
              with Google (no stream key) and you'll come straight back here.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Channel</Label>
                <Select value={String(pickedChannel ?? "")} onValueChange={(v) => setChannelId(Number(v))}>
                  <SelectTrigger className="mt-1" data-testid="select-studio-youtube-channel"><SelectValue /></SelectTrigger>
                  <SelectContent>{list.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.title}</SelectItem>)}</SelectContent>
                </Select>
                <a href="/api/admin/youtube/connect-studio" className="mt-1 inline-block text-xs text-muted-foreground hover:underline">Connect another channel</a>
              </div>
              <div>
                <Label>Who can watch</Label>
                <Select value={privacy} onValueChange={(v) => setPrivacy(v as "unlisted" | "public")}>
                  <SelectTrigger className="mt-1" data-testid="select-studio-youtube-privacy"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unlisted">Unlisted (only with the link): for a test</SelectItem>
                    <SelectItem value="public">Public</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <button type="button" onClick={() => setUseKey(true)} className="mt-2 text-xs text-muted-foreground hover:underline">Use a stream key instead</button>
        </div>
      ) : (
      <>
      {platform === "linkedin" && (
        <div className="sm:col-span-2">
          <Label>Which block</Label>
          <Select value={block} onValueChange={setBlock}>
            <SelectTrigger className="mt-1" data-testid="select-linkedin-block"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LINKEDIN_BLOCKS.map((b, i) => <SelectItem key={b} value={String(i)}>{b}</SelectItem>)}
              <SelectItem value="none">No time limit</SelectItem>
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">LinkedIn Live runs four hours at most, so the day is four LinkedIn events. Paste each one's Stream URL and key when LinkedIn shows them (an hour before). It switches itself on 5 minutes early and off at the end; press Go live in LinkedIn once our picture shows.</p>
        </div>
      )}
      <div>
        <Label htmlFor="dest-label">Name it</Label>
        <Input
          id="dest-label"
          className="mt-1"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="MilitaryVoices YouTube"
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
      </>
      )}
      <div className="flex items-center gap-2 sm:col-span-2">
        {connected ? (
          <Button size="sm" disabled={saving || !pickedChannel} onClick={() => void addYoutube()} data-testid="button-studio-youtube-add">
            {saving ? "Opening YouTube…" : "Add YouTube"}
          </Button>
        ) : (
          <Button size="sm" disabled={saving || !rtmpUrl.trim() || !streamKey.trim()} onClick={() => void save()} data-testid="button-destination-save">
            {saving ? "Saving…" : "Add destination"}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
