import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { apiRequest, apiUpload } from "@/lib/queryClient";
import { ASSET_KINDS, type ShowAssetRow, type ProfileRow } from "@shared/schema";
import {
  Upload,
  Link2,
  Trash2,
  FileVideo,
  ImageIcon,
  Paperclip,
  Save,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Video,
  Presentation,
  Check,
} from "lucide-react";

const MAX_MB = 50;

function prettySize(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Everything a podcaster hands to the studio before their slot: files to play
 * on screen, and the written details the run of show is built from.
 */
export function ShowMaterials({
  profile,
  showFormat,
  interviewNeed,
}: {
  profile: ProfileRow;
  /** The event's show format — the profile's is only a default for new events. */
  showFormat?: string;
  /** What they asked for in Event settings under how the slot runs. */
  interviewNeed?: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<string>("");
  const [label, setLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);

  // What the segment contains, and whether they want an interviewer. These
  // describe one slot, so they belong here next to the files rather than in
  // the permanent profile.
  const [bringing, setBringing] = useState({
    hasVideoIntro: profile.hasVideoIntro,
    hasVideoOutro: profile.hasVideoOutro,
    hasSlides: profile.hasSlides,
    hasImages: profile.hasImages,
  });
  const [needsInterviewer] = useState(profile.needsInterviewer);

  // Both of these belong to the event's show, not the profile — the profile
  // only carries defaults for a brand new event.
  const isPrerecorded = (showFormat ?? profile.showFormat) === "prerecorded";
  const wantsInterviewer = !isPrerecorded && interviewNeed === "interview_me";

  const [guests, setGuests] = useState(profile.guests ?? "");
  const [questions, setQuestions] = useState(profile.interviewQuestions ?? "");
  const [promo, setPromo] = useState(profile.promoNotes ?? "");
  const detailsDirty =
    guests !== (profile.guests ?? "") ||
    questions !== (profile.interviewQuestions ?? "") ||
    promo !== (profile.promoNotes ?? "") ||
    needsInterviewer !== profile.needsInterviewer ||
    bringing.hasVideoIntro !== profile.hasVideoIntro ||
    bringing.hasVideoOutro !== profile.hasVideoOutro ||
    bringing.hasSlides !== profile.hasSlides ||
    bringing.hasImages !== profile.hasImages;

  const { data: assets } = useQuery<ShowAssetRow[]>({ queryKey: ["/api/host/assets"] });

  const add = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("label", label);
      fd.append("linkUrl", linkUrl.trim());
      if (file) fd.append("file", file);
      const res = await apiUpload("POST", "/api/host/assets", fd);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/host/assets"] });
      setKind("");
      setLabel("");
      setLinkUrl("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      toast({ title: "Added", description: "The studio team can see it now." });
    },
    onError: (err: Error) => toast({ title: "Couldn't add that", description: err.message, variant: "destructive" }),
  });

  /** Answering either way is the answer. Saved so the checklist can cross it
   *  off and stay crossed off — "nothing to send" is a finished task. */
  const answerMedia = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("podcastName", profile.podcastName);
      fd.append("hostName", profile.hostName);
      fd.append("phone", profile.phone ?? "");
      fd.append("numPeople", String(profile.numPeople ?? 1));
      fd.append("hasVideoIntro", String(bringing.hasVideoIntro));
      fd.append("hasVideoOutro", String(bringing.hasVideoOutro));
      fd.append("hasSlides", String(bringing.hasSlides));
      fd.append("hasImages", String(bringing.hasImages));
      fd.append("needsInterviewer", String(needsInterviewer));
      fd.append("shareAudienceStats", String(profile.shareAudienceStats));
      fd.append("mediaAnswered", "true");
      fd.append("socialLinks", profile.socialLinks ?? "");
      fd.append("rssUrl", profile.rssUrl ?? "");
      fd.append("youtubeUrl", profile.youtubeUrl ?? "");
      fd.append("showFormat", profile.showFormat || "live");
      fd.append("recordingUrl", profile.recordingUrl ?? "");
      fd.append("introStyle", profile.introStyle || "virtual");
      fd.append("branch", profile.branch ?? "");
      fd.append("serviceStatus", profile.serviceStatus ?? "");
      fd.append("recordingMode", profile.recordingMode ?? "");
      fd.append("postEdits", profile.postEdits ?? "");
      fd.append("streamPlatform", profile.streamPlatform ?? "");
      fd.append("streamPlatformOther", profile.streamPlatformOther ?? "");
      fd.append("notes", profile.notes ?? "");
      fd.append("guests", guests);
      fd.append("interviewQuestions", questions);
      fd.append("promoNotes", promo);
      return (await apiUpload("PUT", "/api/host/profile", fd)).json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/host/profile"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/host/assets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/host/assets"] });
      toast({ title: "Removed" });
    },
    onError: (err: Error) => toast({ title: "Couldn't remove that", description: err.message, variant: "destructive" }),
  });

  const saveDetails = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      // The profile endpoint validates the whole record, so resend what it needs.
      fd.append("podcastName", profile.podcastName);
      fd.append("hostName", profile.hostName);
      fd.append("phone", profile.phone ?? "");
      fd.append("numPeople", String(profile.numPeople ?? 1));
      fd.append("hasVideoIntro", String(bringing.hasVideoIntro));
      fd.append("hasVideoOutro", String(bringing.hasVideoOutro));
      fd.append("hasSlides", String(bringing.hasSlides));
      fd.append("hasImages", String(bringing.hasImages));
      fd.append("needsInterviewer", String(needsInterviewer));
      fd.append("socialLinks", profile.socialLinks ?? "");
      fd.append("rssUrl", profile.rssUrl ?? "");
      fd.append("youtubeUrl", profile.youtubeUrl ?? "");
      fd.append("showFormat", profile.showFormat || "live");
      fd.append("recordingUrl", profile.recordingUrl ?? "");
      fd.append("introStyle", profile.introStyle || "virtual");
      fd.append("branch", profile.branch ?? "");
      fd.append("serviceStatus", profile.serviceStatus ?? "");
      fd.append("recordingMode", profile.recordingMode ?? "");
      fd.append("postEdits", profile.postEdits ?? "");
      fd.append("streamPlatform", profile.streamPlatform ?? "");
      fd.append("streamPlatformOther", profile.streamPlatformOther ?? "");
      fd.append("notes", profile.notes ?? "");
      fd.append("guests", guests);
      fd.append("interviewQuestions", questions);
      fd.append("promoNotes", promo);
      const res = await apiUpload("PUT", "/api/host/profile", fd);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/host/profile"] });
      toast({ title: "Saved", description: "Your show details are with the production team." });
    },
    onError: (err: Error) => toast({ title: "Couldn't save", description: err.message, variant: "destructive" }),
  });

  // Everything in here is optional. It defaults open so nobody misses it, and
  // folds away once they've sent what they're sending.
  const [openFiles, setOpenFiles] = useState(true);
  // Nobody should meet a type dropdown, a name field, an upload button and a
  // link box before they have even said they have a file. One question first.
  const [wantsFiles, setWantsFiles] = useState<boolean | null>(profile.mediaAnswered ? false : null);
  const hasAssets = Boolean(assets && assets.length > 0);
  // Already sent something, or just said they have something to send.
  const showUploader = hasAssets ? openFiles : wantsFiles === true;
  const [openDetails, setOpenDetails] = useState(true);

  return (
    <section className="mt-8 scroll-mt-24" id="section-media" data-testid="section-show-materials">
      <h2 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
        <Paperclip className="h-4 w-4" />
        Media
        <span className="rounded-full bg-[#F0A71F] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#000741]">
          All optional
        </span>
      </h2>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="bg-[#053877] px-5 py-3.5 text-white">
          <p className="text-sm font-semibold">Anything we play or show during your slot</p>
          <p className="mt-0.5 text-xs text-white/85">
            None of it is required to hold your slot. Send what you have and it's attached automatically — you can
            come back and add the rest any time.
          </p>
        </div>

        {/* ---------------------------------------------------------- files */}
        <div className="border-b border-border p-5">
          {hasAssets && (
            <button
              type="button"
              className="group mb-4 flex w-full items-center gap-3 text-left"
              onClick={() => setOpenFiles((v) => !v)}
              aria-expanded={openFiles}
              data-testid="toggle-materials-files"
            >
              <span className="h-8 w-1 shrink-0 rounded-full bg-[#F0A71F]" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-base font-bold leading-tight text-[#053877]">
                  {assets!.length} file{assets!.length === 1 ? "" : "s"} attached to your slot
                </span>
                <span className="block text-xs text-muted-foreground">Intros, outros, slides — anything we roll for you.</span>
              </span>
              {openFiles ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-[#053877]" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-[#053877]" />
              )}
            </button>
          )}

          {/* The question, asked once, for anyone with nothing attached yet. */}
          {!hasAssets && (
            <div className="mb-4">
              <p className="text-[15px] font-semibold text-foreground">
                Do you have anything for us to play during your slot?
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                An intro, an outro, a sponsor reel, slides. {isPrerecorded ? "Your episode itself is already set up separately." : ""}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={wantsFiles === true ? "default" : "outline"}
                  className="rounded-full"
                  onClick={() => {
                    setWantsFiles(true);
                    answerMedia.mutate();
                  }}
                  data-testid="button-media-yes"
                >
                  Yes, I have files
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={wantsFiles === false ? "default" : "outline"}
                  className="rounded-full"
                  onClick={() => {
                    setWantsFiles(false);
                    answerMedia.mutate();
                  }}
                  data-testid="button-media-no"
                >
                  No, nothing to send
                </Button>
              </div>
              {wantsFiles === false && (
                <p className="mt-3 rounded-xl border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                  Nothing to do then — we'll take you straight from the green room. If that changes, come back and say
                  yes any time before the day.
                </p>
              )}
            </div>
          )}

          {showUploader && (
          <>

          {assets && assets.length > 0 && (
            <ul className="mb-4 flex flex-col gap-2">
              {assets.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
                  data-testid={`asset-${a.id}`}
                >
                  <Badge variant="secondary" className="shrink-0 font-normal">
                    {a.kind}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{a.label || a.fileName || a.linkUrl}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {a.fileUrl ? (
                        <>
                          {a.fileName} {a.sizeBytes ? `· ${prettySize(a.sizeBytes)}` : ""}
                        </>
                      ) : (
                        a.linkUrl
                      )}
                    </div>
                  </div>
                  <a
                    href={a.fileUrl || a.linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove this file?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {a.label || a.fileName || a.linkUrl} will be deleted and the studio team will no longer see it.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep it</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => remove.mutate(a.id)}
                        >
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </li>
              ))}
            </ul>
          )}

          <div className="rounded-xl border border-[#053877]/25 bg-[#053877]/[0.05] p-4 sm:p-5">
            <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
              <div>
                <Label className="text-xs font-semibold text-foreground">What is it?</Label>
                <Select value={kind || undefined} onValueChange={setKind}>
                  <SelectTrigger className="mt-1" data-testid="select-asset-kind">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSET_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-semibold text-foreground">Name it (optional)</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. Opening sizzle, 20 seconds"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  data-testid="input-asset-label"
                />
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs font-semibold text-foreground">Upload a file</Label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    data-testid="input-asset-file"
                  />
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()}>
                    <Upload className="h-3.5 w-3.5" /> Choose file
                  </Button>
                  {file && (
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      {file.name} · {prettySize(file.size)}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Up to {MAX_MB}MB.</p>
              </div>
              <div>
                <Label className="text-xs font-semibold text-foreground">…or paste a link</Label>
                <Input
                  className="mt-1"
                  placeholder="Drive, Dropbox, WeTransfer, YouTube"
                  inputMode="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  data-testid="input-asset-link"
                />
                <p className="mt-1 text-xs text-muted-foreground">Best for anything larger.</p>
              </div>
            </div>

            <Button
              type="button"
              size="sm"
              variant={!kind || (!file && !linkUrl.trim()) ? "outline" : "default"}
              className="mt-4 gap-1.5 rounded-full"
              disabled={add.isPending || !kind || (!file && !linkUrl.trim())}
              onClick={() => add.mutate()}
              data-testid="button-add-asset"
            >
              {file ? <Upload className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
              {add.isPending ? "Adding…" : "Add to my slot"}
            </Button>
            {(!kind || (!file && !linkUrl.trim())) && (
              <span className="ml-3 text-xs text-muted-foreground">
                {!kind ? "Pick what it is first." : "Choose a file or paste a link first."}
              </span>
            )}
          </div>

          <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
            <FileVideo className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Pick the right type for each file. It's what tells the studio whether to roll it before you start, part-way
            through, or at the end.
          </p>
          </>
          )}
        </div>

        {/* -------------------------------------------------------- details */}
        <div className="flex flex-col gap-4 p-5">
          <button
            type="button"
            className="flex w-full items-center gap-3 text-left"
            onClick={() => setOpenDetails((v) => !v)}
            aria-expanded={openDetails}
            data-testid="toggle-materials-details"
          >
            <span className="h-8 w-1 shrink-0 rounded-full bg-[#F0A71F]" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-base font-bold leading-tight text-[#053877]">Show details</span>
              <span className="block text-xs text-muted-foreground">What the crew reads out and plans around.</span>
            </span>
            {openDetails ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-[#053877]" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-[#053877]" />
            )}
          </button>
          {openDetails && (
          <>

          {/* Only what still needs answering. A pre-recorded episode has its
              intros and guests baked in, so none of this applies to it, and
              telling someone what they don't have to do is just more to read. */}
          {!isPrerecorded && (
            <div>
              <Label className="text-sm font-semibold text-foreground">What are you bringing?</Label>
              <p className="text-xs text-muted-foreground">Tick anything we should have cued up for your segment.</p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    ["hasVideoIntro", "Video intro", Video],
                    ["hasVideoOutro", "Video outro", Video],
                    ["hasSlides", "Slides", Presentation],
                    ["hasImages", "Images", ImageIcon],
                  ] as const
                ).map(([key, label, Icon]) => {
                  const on = bringing[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setBringing((b) => ({ ...b, [key]: !b[key] }))}
                      className={`flex flex-col items-start gap-2 rounded-xl border p-3 text-left text-sm transition-colors ${
                        on ? "border-primary bg-primary/5 font-medium" : "border-border bg-card hover:bg-[#053877]/[0.04]"
                      }`}
                      data-testid={`toggle-${key}`}
                    >
                      <div className="flex w-full items-center justify-between">
                        <Icon className={`h-4 w-4 ${on ? "text-primary" : "text-muted-foreground"}`} />
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card"
                          }`}
                        >
                          {on && <Check className="h-3 w-3" />}
                        </span>
                      </div>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!isPrerecorded && (
          <div>
            <Label htmlFor="guests" className="text-sm font-semibold text-foreground">
              Who's appearing with you <span className="font-normal text-muted-foreground">— leave blank if it's just you</span>
            </Label>
            <Textarea
              id="guests"
              rows={3}
              className="mt-1.5"
              placeholder="Jane Doe — Founder, Veterans First"
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
              data-testid="input-guests"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Full names and titles, one per line, exactly as you want them read on air.
            </p>
          </div>
          )}

          {wantsInterviewer && (
          <div>
            <Label htmlFor="questions" className="text-sm font-semibold text-foreground">
              Questions for your interviewer
            </Label>
            <Textarea
              id="questions"
              rows={3}
              className="mt-1.5"
              placeholder="What would you like to be asked?"
              value={questions}
              onChange={(e) => setQuestions(e.target.value)}
              data-testid="input-interview-questions"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              You asked us to pair you with a host — this is what they'll work from.
            </p>
          </div>
          )}

          <div>
            <Label htmlFor="promo" className="text-sm font-semibold text-foreground">
              Anything we can help promote
            </Label>
            <Textarea
              id="promo"
              rows={3}
              className="mt-1.5"
              placeholder="A launch, a campaign, a cause"
              value={promo}
              onChange={(e) => setPromo(e.target.value)}
              data-testid="input-promo-notes"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Your show’s mission or anything you’d like the host to mention.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant={detailsDirty ? "default" : "outline"}
              className="gap-1.5 rounded-full"
              disabled={!detailsDirty || saveDetails.isPending}
              onClick={() => saveDetails.mutate()}
              data-testid="button-save-materials"
            >
              <Save className="h-4 w-4" />
              {saveDetails.isPending ? "Saving…" : "Save details"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {detailsDirty ? "Unsaved changes." : "Everything here is saved."}
            </span>
          </div>
          </>
          )}
        </div>
      </div>
    </section>
  );
}
