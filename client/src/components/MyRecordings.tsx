import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { PlatformIcon, platformLabel, parseSocialAccounts } from "@/components/SocialIcons";
import type { RecordingRow, SocialPlatform } from "@shared/schema";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Download, Loader2, MoreHorizontal, Play, Share2, Wand2 } from "lucide-react";

// A podcaster's own sessions. The studio writes them; nothing here is uploaded
// by hand. The bucket is private, so every download is a fresh signed link.

function duration(sec: number): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function clock(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function size(bytes: string): string {
  const n = Number(bytes);
  if (!n) return "";
  const mb = n / 1_048_576;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export function MyRecordings({
  socialAccounts,
  eventId,
  showEmpty = false,
}: {
  socialAccounts?: string | null;
  /** Only this event's sessions. Omit for every event. */
  eventId?: number | null;
  /** Say so when there is nothing, instead of rendering nothing at all. */
  showEmpty?: boolean;
}) {
  const connected = parseSocialAccounts(socialAccounts).map((a) => a.platform);
  const [publishing, setPublishing] = useState<RecordingRow | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const { toast } = useToast();
  const { data: all, isLoading } = useQuery<RecordingRow[]>({
    queryKey: ["/api/host/recordings"],
    queryFn: async () => (await apiRequest("GET", "/api/host/recordings")).json(),
    // A session that's still being written turns up shortly after it stops.
    refetchInterval: (q) =>
      (q.state.data ?? []).some((r) => r.status === "Recording") ? 15_000 : false,
  });
  const data = eventId == null ? all : (all ?? []).filter((r) => r.eventId === eventId);

  if (isLoading) return null;
  if (!data || data.length === 0) {
    if (!showEmpty) return null;
    return (
      <p className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Nothing here yet. Studio sessions appear once they've been on air, or upload a video above.
      </p>
    );
  }

  async function download(id: number) {
    try {
      const res = await apiRequest("GET", `/api/host/recordings/${id}/download`);
      const { url } = (await res.json()) as { url: string };
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast({ title: "Couldn't open that file", description: (err as Error).message, variant: "destructive" });
    }
  }

  return (
    <section className="mt-2">
      {/* Thumbnails, each with one menu: the three things you do with a recording. */}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data.map((r) => (
          <li key={r.id} className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm" data-testid={`recording-${r.id}`}>
            <div className="relative aspect-video bg-[#050d26]">
              {r.status === "Ready" ? (
                playing === r.id ? (
                  <video src={`/api/host/recordings/${r.id}/video`} controls autoPlay playsInline className="h-full w-full bg-black object-contain" />
                ) : (
                  <button type="button" onClick={() => setPlaying(r.id)} className="absolute inset-0" aria-label={`Play ${r.title || "recording"}`}>
                    <video src={`/api/host/recordings/${r.id}/video#t=8`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/10 opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-[#000741] shadow-lg"><Play className="h-5 w-5 fill-current" /></span>
                    </span>
                    {r.durationSec > 0 && <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">{clock(r.durationSec)}</span>}
                    {r.clipStatus === "done" && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-[#F0A71F] px-2 py-0.5 text-[10px] font-bold text-[#1a1200]"><Wand2 className="h-3 w-3" /> Clips ready</span>}
                  </button>
                )
              ) : (
                <span className="absolute inset-0 flex items-center justify-center gap-1.5 text-xs font-medium text-white/70">
                  {r.status === "Recording" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Still recording</> : "Didn't save — tell us and we'll look"}
                </span>
              )}
            </div>
            <div className="flex items-start gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-semibold leading-snug text-card-foreground" title={r.title}>{r.title || "Your session"}</p>
                <p className="mt-0.5 tabular-nums text-xs text-muted-foreground">
                  {new Date(r.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  {size(r.sizeBytes) ? ` · ${size(r.sizeBytes)}` : ""}
                </p>
              </div>
              {r.status === "Ready" && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full" aria-label="More" data-testid={`menu-recording-${r.id}`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onSelect={() => void download(r.id)} className="gap-2" data-testid={`button-download-recording-${r.id}`}>
                      <Download className="h-4 w-4" /> Download
                    </DropdownMenuItem>
                    {/* Clips and the clean episode are made in Pōstify. */}
                    <DropdownMenuItem onSelect={() => { window.location.href = `/host/dashboard/postify?rec=${r.id}`; }} className="gap-2" data-testid={`button-postify-recording-${r.id}`}>
                      <Wand2 className="h-4 w-4 text-[#b36b00]" /> {r.clipStatus === "done" ? "Clips in Pōstify" : "Pōstify it"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setPublishing(r)} className="gap-2" data-testid={`button-publish-recording-${r.id}`}>
                      <Share2 className="h-4 w-4" /> Post it
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </li>
        ))}
      </ul>

      <PublishDialog
        recording={publishing}
        platforms={connected}
        onClose={() => setPublishing(null)}
      />
    </section>
  );
}

/** Sends one finished session out to the accounts they've already connected. */
function PublishDialog({
  recording,
  platforms,
  onClose,
}: {
  recording: RecordingRow | null;
  platforms: SocialPlatform[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [picked, setPicked] = useState<SocialPlatform[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);

  // Reset each time a different recording opens the dialog.
  const key = recording?.id ?? 0;
  const [seen, setSeen] = useState(0);
  if (recording && key !== seen) {
    setSeen(key);
    setPicked(platforms);
    setTitle(recording.title || "");
    setDescription("");
  }

  async function send() {
    if (!recording) return;
    setSending(true);
    try {
      await apiRequest("POST", `/api/host/recordings/${recording.id}/publish`, {
        platforms: picked,
        title: title.trim(),
        description: description.trim(),
      });
      toast({
        title: "On its way",
        description: "We've handed it to your accounts. Publishing can take a few minutes for a long session.",
      });
      onClose();
    } catch (err) {
      toast({ title: "Couldn't post that", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={!!recording} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Post it</DialogTitle>
          <DialogDescription>
            Goes out now to the accounts you tick, under your own name. Nothing is posted until you press Post.
          </DialogDescription>
        </DialogHeader>

        {platforms.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Connect Instagram, YouTube, TikTok, LinkedIn or Facebook first, and they'll show up here.
            <Button asChild className="mt-3 w-full rounded-full"><a href="/host/dashboard/integrations">Connect your accounts</a></Button>
          </div>
        ) : (

        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="publish-title">Title</Label>
            <Input
              id="publish-title"
              className="mt-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What to call it"
              data-testid="input-publish-title"
            />
          </div>

          <div>
            <Label htmlFor="publish-description">What to say</Label>
            <Textarea
              id="publish-description"
              className="mt-1 min-h-[96px]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="The words that go with it: what it's about, who's on it, a link, #hashtags"
              maxLength={2200}
              data-testid="input-publish-description"
            />
            <p className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">{description.length}/2200</p>
          </div>

          <div>
            <div className="text-sm font-medium">Where it goes</div>
            <div className="mt-2 flex flex-col gap-2">
              {platforms.map((p) => (
                <label key={p} className="flex cursor-pointer items-center gap-2.5 text-sm">
                  <Checkbox
                    checked={picked.includes(p)}
                    onCheckedChange={(v) =>
                      setPicked((cur) => (v ? [...cur, p] : cur.filter((x) => x !== p)))
                    }
                    data-testid={`checkbox-publish-${p}`}
                  />
                  <PlatformIcon platform={p} className="h-4 w-4 text-muted-foreground" />
                  {platformLabel(p)}
                </label>
              ))}
            </div>
          </div>
        </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={() => void send()} disabled={sending || picked.length === 0} data-testid="button-publish-confirm">
            {sending ? "Sending…" : "Post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
