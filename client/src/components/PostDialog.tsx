import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PlatformIcon, platformLabel } from "@/components/SocialIcons";
import type { SocialPlatform } from "@shared/schema";
import { CalendarClock, Loader2, Send } from "lucide-react";

/** What's being posted: a whole recording from the Library, or one clip in one shape. */
export type PostTarget =
  | { kind: "recording"; id: number; title: string }
  | { kind: "clip"; id: number; title: string; caption?: string; shapes: ("vertical" | "square" | "wide")[] };

const SHAPE_LABEL = { vertical: "Vertical 9:16", square: "Square 1:1", wide: "Wide 16:9" } as const;

/** A datetime-local value an hour from now, on the quarter hour. */
function inAnHour(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Post it: the words, the accounts, and now or later. One dialog for the
 * Library, Pōstify and the Social page, so posting works the same wherever
 * you start it. Scheduled posts are held by Upload-Post and go out then.
 */
export function PostDialog({ target, onClose }: { target: PostTarget | null; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const social = useQuery<{ configured: boolean; accounts: { platform: SocialPlatform }[] }>({
    queryKey: ["/api/host/social"],
    queryFn: async () => (await apiRequest("GET", "/api/host/social")).json(),
    enabled: !!target,
  });
  const platforms = Array.from(new Set((social.data?.accounts ?? []).map((a) => a.platform)));

  const [shape, setShape] = useState<"vertical" | "square" | "wide">("vertical");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<SocialPlatform[]>([]);
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState(inAnHour);

  // Fresh each time a different thing is opened.
  const key = target ? `${target.kind}-${target.id}` : "";
  useEffect(() => {
    if (!target) return;
    setTitle(target.title);
    setDescription(target.kind === "clip" ? target.caption ?? "" : "");
    setShape(target.kind === "clip" ? target.shapes[0] ?? "vertical" : "vertical");
    setLater(false);
    setWhen(inAnHour());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => setPicked(platforms), [platforms.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useMutation({
    mutationFn: async () => {
      if (!target) return null;
      const body = {
        platforms: picked,
        title: title.trim(),
        description: description.trim(),
        ...(target.kind === "clip" ? { shape } : {}),
        ...(later ? { scheduledAt: new Date(when).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } : {}),
      };
      return (await apiRequest("POST", `/api/host/${target.kind === "clip" ? "clips" : "recordings"}/${target.id}/publish`, body)).json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/host/posts"] });
      toast(
        later
          ? { title: "Scheduled", description: `It goes out ${new Date(when).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. You'll find it under Social.` }
          : { title: "On its way", description: "Handed to your accounts. A long video can take a few minutes to appear." },
      );
      onClose();
    },
    onError: (e: Error) => toast({ title: "Couldn't post that", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Post it</DialogTitle>
          <DialogDescription>To the accounts you tick, under your own name. Nothing goes out until you press the button.</DialogDescription>
        </DialogHeader>

        {social.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : platforms.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Connect Instagram, YouTube, TikTok, LinkedIn or Facebook first, and they'll show up here.
            <Button asChild className="mt-3 w-full rounded-full"><a href="/host/dashboard/integrations">Connect your accounts</a></Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {target?.kind === "clip" && target.shapes.length > 1 && (
              <div>
                <p className="text-sm font-medium">Which shape</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {target.shapes.map((s) => (
                    <button key={s} type="button" onClick={() => setShape(s)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${shape === s ? "border-[#053877] bg-[#053877] text-white" : "border-border hover:border-[#053877]/40"}`}>
                      {SHAPE_LABEL[s]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <Label htmlFor="post-title">Title</Label>
              <Input id="post-title" className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} data-testid="input-publish-title" />
            </div>
            <div>
              <Label htmlFor="post-description">What to say</Label>
              <Textarea
                id="post-description"
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
              <p className="text-sm font-medium">Where it goes</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {platforms.map((p) => (
                  <label key={p} className="flex cursor-pointer items-center gap-2.5 text-sm">
                    <Checkbox checked={picked.includes(p)} onCheckedChange={(v) => setPicked((cur) => (v ? [...cur, p] : cur.filter((x) => x !== p)))} data-testid={`checkbox-publish-${p}`} />
                    <PlatformIcon platform={p} className="h-4 w-4 text-muted-foreground" />
                    {platformLabel(p)}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium">When</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {[{ v: false, l: "Now" }, { v: true, l: "Later" }].map((o) => (
                  <button key={o.l} type="button" onClick={() => setLater(o.v)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${later === o.v ? "border-[#053877] bg-[#053877] text-white" : "border-border hover:border-[#053877]/40"}`} data-testid={`post-when-${o.l.toLowerCase()}`}>
                    {o.l}
                  </button>
                ))}
                {later && <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="h-8 w-auto" data-testid="input-post-when" />}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={send.isPending}>Cancel</Button>
          <Button onClick={() => send.mutate()} disabled={send.isPending || picked.length === 0 || !title.trim()} className="gap-2" data-testid="button-publish-confirm">
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : later ? <CalendarClock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {later ? "Schedule" : "Post now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
