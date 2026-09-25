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
import { putWithProgress } from "@/lib/upload";
import { CalendarClock, ImagePlus, Loader2, Send, Sparkles, X } from "lucide-react";

interface YouTubeSettings { title: string; description: string; privacyStatus: "public" | "unlisted" | "private"; tags: string; thumbnailKey: string; thumbnailName: string; madeForKids: boolean; notifySubscribers: boolean }

/**
 * YouTube's own settings, shown when YouTube is ticked. A whole episode's
 * description is drafted from what Pōstify knows — what it's about, and
 * chapters at the moments it found — for them to edit.
 */
function YouTubeFields({ target, yt, onChange }: { target: PostTarget; yt: YouTubeSettings; onChange: (y: YouTubeSettings) => void }) {
  const { toast } = useToast();
  const [drafting, setDrafting] = useState(false);
  const [thumbPct, setThumbPct] = useState<number | null>(null);
  const draft = async () => {
    if (target.kind !== "recording") return;
    setDrafting(true);
    try {
      const d = (await (await apiRequest("GET", `/api/host/recordings/${target.id}/youtube-draft`)).json()) as { title: string; description: string; tags: string[] };
      onChange({ ...yt, title: yt.title || d.title, description: d.description, tags: yt.tags || d.tags.join(", ") });
    } catch (e) {
      toast({ title: "Couldn't draft that", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDrafting(false);
    }
  };
  // A whole episode: draft straight away, once.
  useEffect(() => {
    if (target.kind === "recording" && !yt.description) void draft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const thumb = async (file: File) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return toast({ title: "A JPG, PNG or WebP, please", variant: "destructive" });
    if (file.size > 2 * 1024 ** 2) return toast({ title: "YouTube takes thumbnails up to 2MB", description: "1280×720 as a JPG is plenty.", variant: "destructive" });
    try {
      setThumbPct(0);
      const { uploadUrl, storageKey } = (await (await apiRequest("POST", "/api/host/assets/upload-url", { fileName: file.name })).json()) as { uploadUrl: string; storageKey: string };
      await putWithProgress(uploadUrl, file, setThumbPct);
      onChange({ ...yt, thumbnailKey: storageKey, thumbnailName: file.name });
    } catch (e) {
      toast({ title: "Couldn't upload that", description: (e as Error).message, variant: "destructive" });
    } finally {
      setThumbPct(null);
    }
  };
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs font-semibold ${on ? "border-[#053877] bg-[#053877] text-white" : "border-border hover:border-[#053877]/40"}`;
  return (
    <div className="space-y-3 rounded-xl border border-[#FF0000]/25 bg-[#FF0000]/[0.03] p-3" data-testid="youtube-fields">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><PlatformIcon platform={"youtube" as SocialPlatform} className="h-4 w-4 text-[#FF0000]" /> YouTube</p>
      <div>
        <Label htmlFor="yt-title" className="text-xs">YouTube title</Label>
        <Input id="yt-title" className="mt-1" value={yt.title} maxLength={100} onChange={(e) => onChange({ ...yt, title: e.target.value })} placeholder="Defaults to the title above" data-testid="yt-title" />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor="yt-description" className="text-xs">Description</Label>
          {target.kind === "recording" && (
            <button type="button" onClick={() => void draft()} disabled={drafting} className="inline-flex items-center gap-1 text-xs font-semibold text-[#053877] hover:underline disabled:opacity-60 dark:text-[#8fb5e8]" data-testid="yt-draft">
              {drafting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} {yt.description ? "Draft again" : "Draft it for me"}
            </button>
          )}
        </div>
        <Textarea id="yt-description" className="mt-1 min-h-[140px] font-[inherit]" value={yt.description} onChange={(e) => onChange({ ...yt, description: e.target.value })} maxLength={5000} placeholder={drafting ? "Drafting from the episode…" : "What it's about, who's on it. Chapters (0:00 Welcome…) become clickable on YouTube."} data-testid="yt-description" />
      </div>
      <div>
        <Label htmlFor="yt-tags" className="text-xs">Tags</Label>
        <Input id="yt-tags" className="mt-1" value={yt.tags} onChange={(e) => onChange({ ...yt, tags: e.target.value })} placeholder="Comma-separated" data-testid="yt-tags" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold text-muted-foreground">Visibility</span>
        {(["public", "unlisted", "private"] as const).map((v) => (
          <button key={v} type="button" onClick={() => onChange({ ...yt, privacyStatus: v })} className={`${chip(yt.privacyStatus === v)} capitalize`} data-testid={`yt-privacy-${v}`}>{v}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold text-muted-foreground">Thumbnail</span>
        {yt.thumbnailKey ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs">
            <ImagePlus className="h-3 w-3" /> {yt.thumbnailName}
            <button type="button" onClick={() => onChange({ ...yt, thumbnailKey: "", thumbnailName: "" })} aria-label="Remove thumbnail"><X className="h-3 w-3" /></button>
          </span>
        ) : (
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-semibold hover:border-[#053877]/40">
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void thumb(e.target.files[0])} />
            {thumbPct === null ? <ImagePlus className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />} {thumbPct === null ? "Upload (1280×720)" : `${thumbPct}%`}
          </label>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        <label className="flex cursor-pointer items-center gap-2"><Checkbox checked={yt.notifySubscribers} onCheckedChange={(v) => onChange({ ...yt, notifySubscribers: v === true })} /> Notify subscribers</label>
        <label className="flex cursor-pointer items-center gap-2"><Checkbox checked={yt.madeForKids} onCheckedChange={(v) => onChange({ ...yt, madeForKids: v === true })} /> Made for kids</label>
      </div>
    </div>
  );
}

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
  const blankYt: YouTubeSettings = { title: "", description: "", privacyStatus: "public", tags: "", thumbnailKey: "", thumbnailName: "", madeForKids: false, notifySubscribers: true };
  const [yt, setYt] = useState<YouTubeSettings>(blankYt);
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
    setYt(blankYt);
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
        ...(picked.includes("youtube" as SocialPlatform)
          ? { youtube: { ...yt, title: yt.title.trim() || title.trim(), tags: yt.tags.split(",").map((t) => t.trim()).filter(Boolean) } }
          : {}),
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
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
            {target && picked.includes("youtube" as SocialPlatform) && <YouTubeFields key={key} target={target} yt={yt} onChange={setYt} />}
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
