import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { platformLabel } from "@/components/SocialIcons";
import { BrandMark, type Brand } from "@/components/BrandMark";
import type { SocialPlatform } from "@shared/schema";
import { uploadToStorage } from "@/lib/upload";
import { videoFrame } from "@/lib/videoFrame";
import { isSocialLocked402, socialLocked, SOCIAL_UPGRADE_NOTE, type SocialTrial } from "@/components/SocialTrial";
import { UpgradeDialog } from "@/components/PostStudio";
import { postableTitle } from "@shared/episodeTitle";
import { CalendarClock, ImagePlus, Loader2, Send, Sparkles, X } from "lucide-react";

interface YouTubeSettings { privacyStatus: "public" | "unlisted" | "private"; tags: string; thumbnailKey: string; thumbnailName: string; madeForKids: boolean; notifySubscribers: boolean }
const blankYt: YouTubeSettings = { privacyStatus: "public", tags: "", thumbnailKey: "", thumbnailName: "", madeForKids: false, notifySubscribers: true };

const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs font-semibold ${on ? "border-[#053877] bg-[#053877] text-white" : "border-border hover:border-[#053877]/40"}`;
const link = "font-semibold text-[#053877] hover:underline dark:text-[#8fb5e8]";

/** YouTube's own extras, folded into one line until they press Change. The title and description are the shared ones. */
function YouTubeExtras({ yt, onChange, frame }: { yt: YouTubeSettings; onChange: (y: YouTubeSettings) => void; /** A frame from the video is the cover unless they upload one. */ frame?: boolean }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [thumbPct, setThumbPct] = useState<number | null>(null);
  const thumb = async (file: File) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return toast({ title: "A JPG, PNG or WebP, please", variant: "destructive" });
    if (file.size > 2 * 1024 ** 2) return toast({ title: "YouTube takes thumbnails up to 2MB", description: "1280×720 as a JPG is plenty.", variant: "destructive" });
    try {
      setThumbPct(0);
      const storageKey = await uploadToStorage(file, setThumbPct);
      onChange({ ...yt, thumbnailKey: storageKey, thumbnailName: file.name });
    } catch (e) {
      toast({ title: "Couldn't upload that", description: (e as Error).message, variant: "destructive" });
    } finally {
      setThumbPct(null);
    }
  };
  const summary = [
    yt.privacyStatus[0].toUpperCase() + yt.privacyStatus.slice(1),
    yt.notifySubscribers ? "Notifies subscribers" : "No notification",
    yt.thumbnailKey ? "Your thumbnail" : frame ? "Thumbnail from the video" : "No thumbnail",
    ...(yt.madeForKids ? ["Made for kids"] : []),
  ].join(" · ");
  return (
    <div className="rounded-xl border border-border px-3 py-2.5" data-testid="youtube-fields">
      <div className="flex items-center gap-2.5 text-[13px]">
        <BrandMark brand="youtube" className="h-4 w-4" />
        <p className="min-w-0 flex-1"><span className="font-semibold text-foreground">YouTube</span> <span className="text-muted-foreground">· {summary}</span></p>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={`shrink-0 text-[13px] ${link}`} data-testid="yt-change">{open ? "Done" : "Change"}</button>
      </div>
      {open && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold text-muted-foreground">Visibility</span>
            {(["public", "unlisted", "private"] as const).map((v) => (
              <button key={v} type="button" onClick={() => onChange({ ...yt, privacyStatus: v })} className={`${chip(yt.privacyStatus === v)} capitalize`} data-testid={`yt-privacy-${v}`}>{v}</button>
            ))}
          </div>
          <div>
            <Label htmlFor="yt-tags" className="text-xs">Tags</Label>
            <Input id="yt-tags" className="mt-1" value={yt.tags} onChange={(e) => onChange({ ...yt, tags: e.target.value })} placeholder="Comma-separated" data-testid="yt-tags" />
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
      )}
    </div>
  );
}

/** What's being posted: a whole recording from the Library, or one clip in one shape. */
export type PostTarget =
  /** A whole episode: YouTube, and LinkedIn when it fits. clipsFrom: the episode its clips hang off (an edited copy's original). */
  | { kind: "recording"; id: number; title: string; clipsFrom?: number }
  | { kind: "clip"; id: number; title: string; caption?: string; shapes: ("vertical" | "square" | "wide")[] }
  /** A picture uploaded just for this post (not kept in the Library). */
  | { kind: "photo"; id: 0; title: string; storageKey: string; preview: string };

const SHAPE_LABEL = { vertical: "Vertical 9:16", square: "Square 1:1", wide: "Wide 16:9" } as const;

/** A datetime-local value an hour from now, on the quarter hour. */
function inAnHour(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "today 7:15 pm", "tomorrow 9:30 am", "Mon 9:30 am" this week, "Tue 2 Dec, 6:00 pm" after that. */
function shortWhen(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(" AM", " am").replace(" PM", " pm");
  const dayDiff = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  const day = dayDiff === 0 ? "today" : dayDiff === 1 ? "tomorrow" : d.toLocaleDateString("en-US", { weekday: "short" });
  const soon = d.getTime() - Date.now() < 6 * 24 * 3600 * 1000;
  return soon ? `${day} ${time}` : `${day} ${d.getDate()} ${d.toLocaleDateString("en-US", { month: "short" })}, ${time}`;
}

/** "YouTube and LinkedIn", "YouTube, Instagram and TikTok", "5 accounts". */
function names(ps: SocialPlatform[]): string {
  const l = ps.map(platformLabel);
  if (l.length > 3) return `${l.length} accounts`;
  return l.length <= 1 ? l.join("") : `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}`;
}

type Account = { platform: SocialPlatform; username?: string; displayName?: string };
/** One place it can go: ready to tick, or shown greyed with why and the way forward. */
type Dest = { platform: SocialPlatform; who: string; what: string; blocked?: { why?: string; cta: string; title?: string; href: string } };

/**
 * Post it: where it goes first (a card per account, with who it posts as), then one title and one description, then
 * when, and a button that says what will happen (Andrew, 22 Nov: the YouTube tick and the LinkedIn tick were "not
 * really easy to understand"). One dialog for the Library, Pōstify and the Social page. Scheduled posts are held by
 * Upload-Post and go out then.
 */
export function PostDialog({ target, onClose, at, schedule = false }: { target: PostTarget | null; onClose: () => void; /** A time already chosen (an open slot on the calendar): datetime-local. */ at?: string; /** Opened from "Schedule…": the date and time are what's asked first. */ schedule?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const social = useQuery<{ configured: boolean; accounts: Account[]; trial?: SocialTrial }>({
    queryKey: ["/api/host/social"],
    queryFn: async () => (await apiRequest("GET", "/api/host/social")).json(),
    enabled: !!target,
  });
  const queue = useQuery<{ slots: { datetime_utc: string; available: boolean; is_full: boolean }[]; next?: string }>({
    queryKey: ["/api/host/social/queue"],
    queryFn: async () => (await apiRequest("GET", "/api/host/social/queue")).json(),
    enabled: !!target,
    retry: false,
  });
  const nextSlot = (() => {
    const s = queue.data?.slots?.find((x) => x.available && !x.is_full)?.datetime_utc || queue.data?.next || "";
    const d = s ? new Date(s) : null;
    return d && !Number.isNaN(d.getTime()) && d.getTime() > Date.now() ? d : null;
  })();

  const accounts = social.data?.accounts ?? [];
  const account = (p: SocialPlatform) => accounts.find((a) => a.platform === p);
  const whoOf = (a?: Account) => (a ? a.displayName || (a.username && !/^\d+$/.test(a.username) ? `@${a.username}` : "") || "Your account" : "");
  // A whole episode goes to YouTube, and to LinkedIn when it fits (Andrew, 22 Nov: "it should also have LinkedIn there
  // as well"; LinkedIn takes up to 30 minutes); the other apps get the clips the creator picks.
  const episode = target?.kind === "recording";
  const info = useQuery<{ seconds: number; linkedin: { ok: boolean; why: string } }>({
    queryKey: ["/api/host/recordings", target?.id, "post-info"],
    queryFn: async () => (await apiRequest("GET", `/api/host/recordings/${target?.id}/post-info`)).json(),
    enabled: episode,
  });
  const clipsHref = target?.kind === "recording" ? `/host/dashboard/postify?rec=${target.clipsFrom ?? target.id}` : "/host/dashboard/postify";
  const connectHref = "/host/dashboard/integrations";

  const [shape, setShape] = useState<"vertical" | "square" | "wide">("vertical");
  const dests: Dest[] = (() => {
    if (!target) return [];
    if (episode) {
      const yt = account("youtube");
      const li = account("linkedin");
      const why = info.data?.linkedin.why ?? "";
      return [
        { platform: "youtube", who: whoOf(yt) || "Not connected", what: "Whole episode, new video", blocked: yt ? undefined : { cta: "Connect YouTube →", href: connectHref } },
        { platform: "linkedin", who: whoOf(li) || "Not connected", what: "Whole episode, video post", blocked: !li ? { cta: "Connect LinkedIn →", href: connectHref } : why ? { why: /5 GB/.test(why) ? "Over 5 GB" : "Over 30 min", cta: "Post a clip →", title: why, href: clipsHref } : undefined },
      ];
    }
    // A clip or a picture: the shape sits under the cards, so each card is just the account.
    const what = "";
    // YouTube takes video only: a picture goes everywhere else.
    return Array.from(new Set(accounts.map((a) => a.platform)))
      .filter((p) => target.kind !== "photo" || p !== "youtube")
      .map((p) => ({ platform: p, who: whoOf(account(p)), what }));
  })();
  const platforms = dests.filter((d) => !d.blocked).map((d) => d.platform);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // Different words for LinkedIn: only when they ask (a whole episode going to both).
  const [liOwn, setLiOwn] = useState(false);
  const [liText, setLiText] = useState("");
  const [picked, setPicked] = useState<SocialPlatform[]>([]);
  const [drafting, setDrafting] = useState(false);
  // When: the next open slot in their queue (the usual), now, or a time they pick.
  const [mode, setMode] = useState<"queue" | "now" | "later">("queue");
  const later = mode === "later";
  const [yt, setYt] = useState<YouTubeSettings>(blankYt);
  const [when, setWhen] = useState(inAnHour);
  // A whole episode opens on black, and LinkedIn shows the first frame: a still from a little way in is
  // picked and uploaded while they write, and goes with the post as every platform's cover (Andrew, 23 Nov).
  const autoThumb = useRef<Promise<string> | null>(null);

  // Fresh each time a different thing is opened.
  const key = target ? `${target.kind}-${target.id}-${target.kind === "photo" ? target.storageKey : ""}` : "";
  useEffect(() => {
    if (!target) return;
    setTitle(target.kind === "recording" ? postableTitle(target.title) : target.title);
    setDescription(target.kind === "clip" ? target.caption ?? "" : "");
    setLiOwn(false);
    setLiText("");
    setShape(target.kind === "clip" ? target.shapes[0] ?? "vertical" : "vertical");
    setMode(at || schedule ? "later" : "queue");
    setWhen(at || inAnHour());
    setYt(blankYt);
    // A whole episode: its description drafted straight away, chapters and all, for them to edit.
    if (target.kind === "recording") void draft(target.id, true);
    autoThumb.current = target.kind === "recording" ? frameFor(target.id) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, schedule]);
  useEffect(() => setPicked(platforms), [platforms.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  async function frameFor(id: number): Promise<string> {
    try {
      const { url } = (await (await apiRequest("GET", `/api/host/recordings/${id}/video?json=1`)).json()) as { url: string };
      const blob = await videoFrame(url);
      return blob ? await uploadToStorage(new File([blob], "thumbnail.jpg", { type: "image/jpeg" }), () => {}) : "";
    } catch {
      return "";
    }
  }

  async function draft(id: number, onlyIfEmpty = false) {
    setDrafting(true);
    try {
      const d = (await (await apiRequest("GET", `/api/host/recordings/${id}/youtube-draft`)).json()) as { description: string; tags: string[] };
      // The title stays theirs (Frank, 22 Nov: a drafted title silently overrode it).
      setDescription((cur) => (onlyIfEmpty && cur.trim() ? cur : d.description));
      setYt((y) => ({ ...y, tags: y.tags || d.tags.join(", ") }));
    } catch (e) {
      if (!onlyIfEmpty) toast({ title: "Couldn't draft that", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDrafting(false);
    }
  }

  const has = (p: SocialPlatform) => picked.includes(p);
  const both = episode && has("youtube") && has("linkedin");
  // Instagram and TikTok take 2,200 characters; LinkedIn 3,000; YouTube 5,000.
  const limit = !episode ? 2200 : has("linkedin") && !liOwn ? 3000 : 5000;
  const tooLong = description.length > limit || (liOwn && liText.length > 3000);

  const send = useMutation({
    mutationFn: async () => {
      if (!target) return null;
      const words = description.trim();
      // Their own upload wins; otherwise the frame, if it's ready within a few seconds (a post never waits long on it).
      const frameKey = yt.thumbnailKey || !autoThumb.current ? "" : await Promise.race([autoThumb.current, new Promise<string>((r) => setTimeout(() => r(""), 15_000))]);
      // The frame under our title band, in the clip style; the plain frame if that fails.
      const composed = frameKey
        ? await apiRequest("POST", "/api/host/thumbnails/compose", { frameKey, title: title.trim() }).then((r) => r.json() as Promise<{ key: string }>).then((r) => r.key).catch(() => frameKey)
        : "";
      const thumbnailKey = yt.thumbnailKey || composed;
      const body = {
        ...(thumbnailKey ? { thumbnailKey } : {}),
        platforms: picked,
        title: title.trim(),
        // The shared words go everywhere; LinkedIn's own, when they wrote some, go to LinkedIn and YouTube keeps the shared ones.
        description: both && liOwn && liText.trim() ? liText.trim() : words,
        ...(target.kind === "clip" ? { shape } : {}),
        ...(later ? { scheduledAt: new Date(when).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } : {}),
        ...(mode === "queue" ? { queue: true } : {}),
        ...(has("youtube") ? { youtube: { ...yt, title: title.trim(), description: words, tags: yt.tags.split(",").map((t) => t.trim()).filter(Boolean) } } : {}),
      };
      if (target.kind === "photo") return (await apiRequest("POST", "/api/host/posts/photo", { ...body, storageKey: target.storageKey })).json();
      return (await apiRequest("POST", `/api/host/${target.kind === "clip" ? "clips" : "recordings"}/${target.id}/publish`, body)).json();
    },
    onSuccess: (r: { scheduledAt?: string } | null) => {
      void qc.invalidateQueries({ queryKey: ["/api/host/posts"] });
      void qc.invalidateQueries({ queryKey: ["/api/host/social/queue"] });
      const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      toast(
        mode !== "now" && r?.scheduledAt
          ? { title: mode === "queue" ? "In your queue" : "Scheduled", description: `It goes out ${fmt(r.scheduledAt)}. It's on your Social calendar.` }
          : { title: "On its way", description: "Handed to your accounts. A long video can take a few minutes to appear." },
      );
      onClose();
    },
    onError: (e: Error) => {
      // The free 30 days ran out while it was open: the plans, not an error.
      if (isSocialLocked402(e)) { void qc.invalidateQueries({ queryKey: ["/api/host/social"] }); setUpgrade(true); onClose(); return; }
      toast({ title: "Couldn't post that", description: e.message, variant: "destructive" });
    },
  });
  // Growth's 30 days of free posting are over: Post opens the plans instead (Andrew, 21 Nov).
  const [upgrade, setUpgrade] = useState(false);
  const locked = !!target && socialLocked(social.data?.trial);

  if (locked || upgrade) {
    return <UpgradeDialog open onOpenChange={(o) => { if (!o) { setUpgrade(false); if (target) onClose(); } }} note={SOCIAL_UPGRADE_NOTE} />;
  }

  const loading = social.isLoading || (episode && info.isLoading);
  const pickedTime = new Date(when);
  // The button says what happens (Andrew, 22 Nov).
  const action =
    mode === "now" ? `Post to ${names(picked) || "your accounts"} now`
    : later ? `Schedule for ${shortWhen(pickedTime) || "that time"}`
    : nextSlot ? `Schedule for ${shortWhen(nextSlot)}`
    : "Add to your queue";
  const heading = episode ? "Post this episode" : target?.kind === "photo" ? "Post this picture" : "Post this clip";
  const minutes = episode && info.data?.seconds ? `${Math.max(1, Math.round(info.data.seconds / 60))} min` : "";

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-32px)] gap-0 overflow-y-auto p-0 focus:outline-none focus-visible:ring-0 sm:max-w-[600px]" onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).focus(); }}>
        <div className="px-5 pb-1 pt-5 sm:px-6">
          <DialogHeader className="mb-3.5 space-y-0.5 pr-6 text-left">
            <DialogTitle className="text-xl">{heading}</DialogTitle>
            <p className="truncate text-[13px] text-muted-foreground" data-testid="post-subject">{[target?.title ? (episode ? postableTitle(target.title) : target.title) : "", minutes].filter(Boolean).join(" · ")}</p>
            <DialogDescription className="sr-only">Pick where it goes, check the words, and choose when. Nothing goes out until you press the button.</DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !episode && dests.length === 0 ? (
            <div className="mb-4 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              Connect Instagram, YouTube, TikTok, LinkedIn or Facebook first, and they'll show up here.
              <Button asChild className="mt-3 w-full rounded-full"><a href={connectHref}>Connect your accounts</a></Button>
            </div>
          ) : (
            <div className="flex flex-col">
              {target?.kind === "photo" && <img src={target.preview} alt="" className="mb-4 max-h-48 w-full rounded-xl bg-muted object-contain" />}

              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <p className="text-[13px] font-semibold text-foreground">Where it goes</p>
                {platforms.length > 1 && <p className="text-xs text-muted-foreground">Untick one to skip it</p>}
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2" data-testid="post-destinations">
                {dests.map((d) => {
                  const on = !d.blocked && has(d.platform);
                  const inner = (
                    <>
                      <BrandMark brand={d.platform as Brand} tile className="h-5 w-5" tileClassName="h-9 w-9 rounded-[9px]" />
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm font-semibold ${d.blocked ? "text-muted-foreground" : "text-foreground"}`}>{platformLabel(d.platform)}</span>
                        <span className={`block truncate text-xs font-medium ${d.blocked ? "text-muted-foreground" : "text-foreground"}`}>{d.who}</span>
                        {(d.what || d.blocked) && <span className="block truncate text-xs text-muted-foreground">{d.blocked ? <>{d.blocked.why && `${d.blocked.why} · `}<span className="font-semibold text-[#053877] dark:text-[#8fb5e8]">{d.blocked.cta}</span></> : d.what}</span>}
                      </span>
                    </>
                  );
                  return d.blocked ? (
                    <a key={d.platform} href={d.blocked.href} title={d.blocked.title} className="flex items-center gap-2.5 rounded-[14px] border-[1.5px] border-dashed border-border bg-muted/40 px-3 py-2.5 hover:border-[#053877]/40" data-testid={`dest-${d.platform}-blocked`}>
                      {inner}
                      <span className="h-[22px] w-[22px] shrink-0 rounded-[7px] border-[1.5px] border-border" aria-hidden />
                    </a>
                  ) : (
                    <label key={d.platform} className={`flex cursor-pointer items-center gap-2.5 rounded-[14px] border-[1.5px] px-3 py-2.5 transition-colors ${on ? "border-[#053877] bg-[#053877]/[0.04] dark:border-[#8fb5e8] dark:bg-white/5" : "border-border hover:border-[#053877]/40"}`} data-testid={`dest-${d.platform}`}>
                      {inner}
                      <Checkbox
                        checked={on}
                        onCheckedChange={(v) => setPicked((cur) => (v ? [...cur, d.platform] : cur.filter((x) => x !== d.platform)))}
                        className="h-[22px] w-[22px] rounded-[7px]"
                        aria-label={`Post to ${platformLabel(d.platform)}`}
                        data-testid={`checkbox-publish-${d.platform}`}
                      />
                    </label>
                  );
                })}
              </div>
              {episode && (
                <p className="mx-0.5 mt-2 text-[13px] text-muted-foreground" data-testid="episode-youtube-only">
                  Instagram, TikTok and Facebook take short clips. <a href={clipsHref} className={`whitespace-nowrap ${link}`} data-testid="episode-choose-clips">Choose clips →</a>
                </p>
              )}

              {target?.kind === "clip" && target.shapes.length > 1 && (
                <div className="mt-3.5">
                  <p className="text-[13px] font-semibold">Which shape</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {target.shapes.map((s) => <button key={s} type="button" onClick={() => setShape(s)} className={chip(shape === s)}>{SHAPE_LABEL[s]}</button>)}
                  </div>
                </div>
              )}

              {(episode ? platforms.length > 0 : true) && (
                <>
                  <div className="mt-3.5">
                    <div className="mb-1 flex items-baseline justify-between"><Label htmlFor="post-title" className="text-[13px] font-semibold">Title</Label><span className="text-xs tabular-nums text-muted-foreground">{title.length}/100</span></div>
                    <Input id="post-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} data-testid="input-publish-title" />
                  </div>

                  <div className="mt-3.5">
                    <div className="mb-1 flex items-baseline justify-between gap-3">
                      <Label htmlFor="post-description" className="text-[13px] font-semibold">{episode ? "Description" : "Caption"}</Label>
                      {target?.kind === "recording" && (
                        <button type="button" onClick={() => void draft(target.id)} disabled={drafting} className={`inline-flex items-center gap-1 text-xs disabled:opacity-60 ${link}`} data-testid="yt-draft">
                          {drafting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} {description ? "Draft again" : "Draft it for me"}
                        </button>
                      )}
                    </div>
                    <Textarea
                      id="post-description"
                      className="min-h-[84px] font-[inherit] text-[13.5px] leading-relaxed"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={drafting ? "Drafting from the episode…" : episode ? "What it's about, who's on it. Chapters (0:00 Welcome…) become clickable on YouTube." : "The words that go with it: what it's about, who's on it, a link, #hashtags"}
                      data-testid="input-publish-description"
                    />
                    <div className="mt-1 flex items-center justify-between gap-3 text-xs">
                      {both && !liOwn ? (
                        <button type="button" onClick={() => { setLiOwn(true); setLiText(""); }} className={`whitespace-nowrap text-left ${link}`} data-testid="li-own">+ Different words for LinkedIn</button>
                      ) : <span />}
                      <span className={`whitespace-nowrap tabular-nums ${description.length > limit ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                        {both && !liOwn && <span className="hidden sm:inline">Goes on both · </span>}{description.length}/{limit.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {both && liOwn && (
                    <div className="mt-3">
                      <div className="mb-1 flex items-baseline justify-between gap-3">
                        <Label htmlFor="post-li" className="text-[13px] font-semibold">Words for LinkedIn</Label>
                        <button type="button" onClick={() => { setLiOwn(false); setLiText(""); }} className={`text-xs ${link}`} data-testid="li-same">Use the same as YouTube</button>
                      </div>
                      <Textarea id="post-li" className="min-h-[76px] font-[inherit] text-[13.5px]" value={liText} onChange={(e) => setLiText(e.target.value)} placeholder="What LinkedIn sees with the video" data-testid="input-publish-linkedin" />
                      <p className={`mt-1 text-right text-xs tabular-nums ${liText.length > 3000 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{liText.length}/3,000</p>
                    </div>
                  )}

                  {has("youtube") && <div className="mt-3.5"><YouTubeExtras key={key} yt={yt} onChange={setYt} frame={episode} /></div>}

                  <div className="mt-3.5 pb-4">
                    <p className="mb-1.5 text-[13px] font-semibold">When</p>
                    <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/70 p-1" role="radiogroup" aria-label="When">
                      {([
                        { v: "queue", l: "Next open slot", s: nextSlot ? shortWhen(nextSlot) : "" },
                        { v: "now", l: "Now", s: "" },
                        { v: "later", l: "Pick a time", s: later ? shortWhen(pickedTime) : "" },
                      ] as const).map((o) => (
                        <button
                          key={o.v}
                          type="button"
                          role="radio"
                          aria-checked={mode === o.v}
                          onClick={() => setMode(o.v)}
                          className={`flex min-h-[44px] flex-col items-center justify-center rounded-[9px] px-1.5 py-1.5 text-center text-[13px] font-semibold leading-tight ${mode === o.v ? "bg-background text-[#053877] shadow-sm dark:text-white" : "text-foreground/80 hover:text-foreground"}`}
                          data-testid={`post-when-${o.v}`}
                        >
                          {o.l}
                          {o.s && <span className="mt-0.5 text-[11px] font-medium text-muted-foreground">{o.s}</span>}
                        </button>
                      ))}
                    </div>
                    {later && <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="mt-2 h-9 w-auto" data-testid="input-post-when" />}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="sticky bottom-0 flex-row items-center gap-2.5 border-t border-border bg-background px-5 py-3.5 sm:px-6">
          <p className="mr-auto hidden text-xs text-muted-foreground sm:block">Nothing goes out until you press the button.</p>
                    <Button onClick={() => send.mutate()} disabled={loading || send.isPending || picked.length === 0 || !title.trim() || tooLong} className="flex-1 gap-2 rounded-full sm:flex-none" data-testid="button-publish-confirm">
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "now" ? <Send className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
