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
import { Disc, Download, Loader2, Share2, Wand2 } from "lucide-react";

// A podcaster's own sessions. The studio writes them; nothing here is uploaded
// by hand. The bucket is private, so every download is a fresh signed link.

function duration(sec: number): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
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
        Nothing here yet. Your session appears once your slot has been on air.
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
    <section className="mt-8 rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Disc className="h-4.5 w-4.5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-card-foreground">Your recordings</h2>
          <p className="text-sm text-muted-foreground">
            Every session we record for you lands here. Yours to keep and publish wherever you like.
          </p>
        </div>
      </div>

      <ul className="mt-5 flex flex-col gap-2">
        {data.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background p-4"
            data-testid={`recording-${r.id}`}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-card-foreground">{r.title || "Your session"}</div>
              <div className="mt-0.5 tabular-nums text-xs text-muted-foreground">
                {new Date(r.startedAt).toLocaleString()}
                {[duration(r.durationSec), size(r.sizeBytes)].filter(Boolean).map((v) => ` · ${v}`)}
              </div>
            </div>

            {r.status === "Recording" ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Still recording
              </span>
            ) : r.status === "Failed" ? (
              <span className="text-xs font-medium text-destructive">Didn't save — tell us and we'll look</span>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 rounded-full"
                  onClick={() => void download(r.id)}
                  data-testid={`button-download-recording-${r.id}`}
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </Button>
                {/* Clips and the clean episode are made in Pōstify. */}
                <Button asChild size="sm" variant="outline" className="gap-1.5 rounded-full border-[#F0A71F]/60">
                  <a href={`/host/dashboard/postify?rec=${r.id}`} data-testid={`button-postify-recording-${r.id}`}>
                    <Wand2 className="h-3.5 w-3.5 text-[#b36b00]" /> {r.clipStatus === "done" ? "Clips in Pōstify" : "Open in Pōstify"}
                  </a>
                </Button>
                {connected.length > 0 && (
                  <Button
                    size="sm"
                    className="gap-1.5 rounded-full"
                    onClick={() => setPublishing(r)}
                    data-testid={`button-publish-recording-${r.id}`}
                  >
                    <Share2 className="h-3.5 w-3.5" /> Post it
                  </Button>
                )}
              </div>
            )}
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
  const [sending, setSending] = useState(false);

  // Reset each time a different recording opens the dialog.
  const key = recording?.id ?? 0;
  const [seen, setSeen] = useState(0);
  if (recording && key !== seen) {
    setSeen(key);
    setPicked(platforms);
    setTitle(recording.title || "");
  }

  async function send() {
    if (!recording) return;
    setSending(true);
    try {
      await apiRequest("POST", `/api/host/recordings/${recording.id}/publish`, {
        platforms: picked,
        title: title.trim(),
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
          <DialogTitle>Post your session</DialogTitle>
          <DialogDescription>
            This goes out to the accounts you've connected, under your own name. Nothing is posted without you.
          </DialogDescription>
        </DialogHeader>

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

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={() => void send()} disabled={sending || picked.length === 0} data-testid="button-publish-confirm">
            {sending ? "Sending…" : "Post it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
