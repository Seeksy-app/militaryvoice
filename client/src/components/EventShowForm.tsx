import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiUpload } from "@/lib/queryClient";
import { resolveUploadUrl } from "@/lib/queryClient";
import { Radio, PlayCircle, ImagePlus, Save, Mic2, Lock } from "lucide-react";
import { INTERVIEW_NEEDS } from "@shared/schema";
import { LIVE_ONLY_LABEL } from "@shared/slots";

// What a podcaster is bringing to one event: its name, whether it airs live or
// rolls from a file, and its artwork. Separate from the profile because the
// same person can bring a different show to a different event.

export interface EventShow {
  eventId?: number;
  showName: string;
  showFormat: string;
  recordingUrl: string;
  introStyle: string;
  imageUrl: string;
  interviewNeed?: string;
  isNew?: boolean;
}

export function EventShowForm({
  eventId,
  eventName,
  show,
  profilePhotoUrl,
  liveOnlySlot = false,
  onSaved,
}: {
  eventId: number;
  eventName: string;
  show: EventShow;
  profilePhotoUrl?: string;
  /** They hold a daytime slot, which has to be broadcast live. */
  liveOnlySlot?: boolean;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(show.showName ?? "");
  const [format, setFormat] = useState(show.showFormat || "live");
  const [recordingUrl, setRecordingUrl] = useState(show.recordingUrl ?? "");
  const [introStyle, setIntroStyle] = useState(show.introStyle || "virtual");
  const [interviewNeed, setInterviewNeed] = useState(show.interviewNeed || "none");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Only a *switch* is blocked. Anyone already holding a daytime slot with a
  // recorded episode keeps it — the rule starts from here, not retroactively.
  const lockedLive = liveOnlySlot && (show.showFormat || "live") === "live";

  // Matches the Show materials save exactly: solid and enabled only when
  // there is something to save, outline and disabled when there isn't, with
  // the state said in words either way. Two saves on one page are fine; two
  // saves that behave differently are not.
  const dirty =
    name !== (show.showName ?? "") ||
    format !== (show.showFormat || "live") ||
    recordingUrl !== (show.recordingUrl ?? "") ||
    introStyle !== (show.introStyle || "virtual") ||
    interviewNeed !== (show.interviewNeed || "none") ||
    !!imageFile;

  const save = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("showName", name);
      fd.append("showFormat", format);
      fd.append("recordingUrl", recordingUrl.trim());
      fd.append("introStyle", introStyle);
      fd.append("interviewNeed", format === "live" ? interviewNeed : "none");
      if (imageFile) fd.append("image", imageFile);
      const res = await apiUpload("PUT", `/api/host/shows/${eventId}`, fd);
      return res.json();
    },
    onSuccess: () => {
      // The form reads its saved values from this query. Without refreshing
      // it, the just-saved values still look different from what's on screen
      // and the button would sit on "Unsaved changes" forever.
      queryClient.invalidateQueries({ queryKey: ["/api/host/shows"] });
      queryClient.invalidateQueries({ queryKey: ["/api/host/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/host/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/signups"] });
      toast({ title: "Show saved", description: `Your show is set up for ${eventName}.` });
      onSaved();
    },
    onError: (err: Error) => toast({ title: "Couldn't save that", description: err.message, variant: "destructive" }),
  });

  // The artwork wins on the lineup; the person's own photo is the fallback.
  const shown = preview || (show.imageUrl ? resolveUploadUrl(show.imageUrl) : "") || (profilePhotoUrl ? resolveUploadUrl(profilePhotoUrl) : "");
  const usingFallback = !preview && !show.imageUrl && !!profilePhotoUrl;

  return (
    <div className="flex flex-col gap-6">
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="bg-[#053877] px-5 py-3.5 text-white">
          <p className="text-sm font-semibold">Set up your show</p>
          <p className="mt-0.5 text-xs text-white/85">What you're bringing to {eventName}.</p>
        </div>

        <div className="flex flex-col gap-5 p-5">
          <div>
            <Label htmlFor="showName" className="text-sm font-semibold text-foreground">
              Show name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="showName"
              className="mt-1"
              placeholder="What this show is called"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-show-name"
            />
            <p className="mt-1 text-xs text-muted-foreground">This is what listeners see on the lineup.</p>
          </div>

          <div>
            <Label className="text-sm font-semibold text-foreground">Show image</Label>
            <p className="text-xs text-muted-foreground">
              Square works best. {usingFallback ? "Right now your own photo is standing in." : "Shown on the public lineup."}
            </p>
            <div className="mt-2 flex items-center gap-4">
              {shown ? (
                <img
                  src={shown}
                  alt=""
                  className={`h-20 w-20 rounded-full object-cover ring-4 ${usingFallback ? "ring-border" : "ring-primary/20"}`}
                  data-testid="img-show-artwork"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <Mic2 className="h-7 w-7" />
                </div>
              )}
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setImageFile(f);
                    setPreview(f ? URL.createObjectURL(f) : null);
                  }}
                  data-testid="input-show-image"
                />
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()}>
                  <ImagePlus className="h-3.5 w-3.5" /> {show.imageUrl || preview ? "Change image" : "Add an image"}
                </Button>
                {usingFallback && (
                  <p className="mt-1 text-xs text-muted-foreground">Optional — leave it and we'll use your photo.</p>
                )}
              </div>
            </div>
          </div>

          <div>
            <Label className="text-sm font-semibold text-foreground">How your slot runs</Label>
            {lockedLive && (
              <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  Your time falls between {LIVE_ONLY_LABEL}, and daytime slots are live only. Move to an evening or
                  overnight time if you'd rather we rolled a recorded episode.
                </span>
              </p>
            )}
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {[
                { v: "live", icon: Radio, title: "Go live", body: "You broadcast in real time during your window." },
                { v: "prerecorded", icon: PlayCircle, title: "Play a recorded episode", body: "Send us the file and we'll roll it in your slot." },
              ].map(({ v, icon: Icon, title, body }) => {
                const locked = lockedLive && v === "prerecorded";
                return (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={format === v}
                    disabled={locked}
                    onClick={() => !locked && setFormat(v)}
                    className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-colors ${
                      format === v ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-[#053877]/[0.04]"
                    } ${locked ? "cursor-not-allowed border-dashed bg-muted/30 opacity-60 hover:bg-muted/30" : ""}`}
                    data-testid={`radio-show-format-${v}`}
                  >
                    {locked ? (
                      <Lock className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Icon className={`h-4 w-4 ${format === v ? "text-primary" : "text-muted-foreground"}`} />
                    )}
                    <span className="text-sm font-medium">{title}</span>
                    <span className="text-xs text-muted-foreground">
                      {locked ? "Not available in a daytime slot." : body}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Only a live slot can want an interviewer — a finished episode is
              already made. Asked here because it decides how the slot runs. */}
          {format === "live" && (
            <div>
              <Label className="text-sm font-semibold text-foreground">Do you need someone to interview you?</Label>
              <p className="text-xs text-muted-foreground">We can pair you with a host, or find you a guest.</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {INTERVIEW_NEEDS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={interviewNeed === o.value}
                    onClick={() => setInterviewNeed(o.value)}
                    className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors ${
                      interviewNeed === o.value
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:bg-[#053877]/[0.04]"
                    }`}
                    data-testid={`radio-interview-need-${o.value}`}
                  >
                    <span className="text-sm font-medium">{o.label}</span>
                    <span className="text-xs text-muted-foreground">{o.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {format === "prerecorded" && (
            <>
              <div>
                <Label htmlFor="recordingUrl" className="text-sm font-semibold text-foreground">
                  Link to the episode <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="recordingUrl"
                  className="mt-1"
                  inputMode="url"
                  placeholder="Drive, Dropbox, WeTransfer, YouTube"
                  value={recordingUrl}
                  onChange={(e) => setRecordingUrl(e.target.value)}
                  data-testid="input-recording-url"
                />
                <p className="mt-1 text-xs text-muted-foreground">We can't air a recorded slot without the file.</p>
              </div>

              <div>
                <Label className="text-sm font-semibold text-foreground">Before it rolls</Label>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {[
                    ["virtual", "Introduce it live", "You come on camera first, then we roll the episode."],
                    ["straight", "Straight into the episode", "No live intro — we go right to the file."],
                  ].map(([v, title, body]) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={introStyle === v}
                      onClick={() => setIntroStyle(v)}
                      className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors ${
                        introStyle === v ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-[#053877]/[0.04]"
                      }`}
                      data-testid={`radio-intro-style-${v}`}
                    >
                      <span className="text-sm font-medium">{title}</span>
                      <span className="text-xs text-muted-foreground">{body}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant={dirty && name.trim() ? "default" : "outline"}
              className="gap-1.5 rounded-full"
              disabled={save.isPending || !name.trim() || !dirty}
              onClick={() => save.mutate()}
              data-testid="button-save-show"
            >
              <Save className="h-4 w-4" /> {save.isPending ? "Saving…" : "Save show"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {!name.trim() ? "A show name is needed first." : dirty ? "Unsaved changes." : "Everything here is saved."}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
