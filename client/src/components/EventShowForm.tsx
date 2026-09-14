import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiUpload } from "@/lib/queryClient";
import { resolveUploadUrl } from "@/lib/queryClient";
import { Radio, PlayCircle, ImagePlus, Save, Mic2 } from "lucide-react";

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
  isNew?: boolean;
}

export function EventShowForm({
  eventId,
  eventName,
  show,
  profilePhotoUrl,
  onSaved,
}: {
  eventId: number;
  eventName: string;
  show: EventShow;
  profilePhotoUrl?: string;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(show.showName ?? "");
  const [format, setFormat] = useState(show.showFormat || "live");
  const [recordingUrl, setRecordingUrl] = useState(show.recordingUrl ?? "");
  const [introStyle, setIntroStyle] = useState(show.introStyle || "virtual");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("showName", name);
      fd.append("showFormat", format);
      fd.append("recordingUrl", recordingUrl.trim());
      fd.append("introStyle", introStyle);
      if (imageFile) fd.append("image", imageFile);
      const res = await apiUpload("PUT", `/api/host/shows/${eventId}`, fd);
      return res.json();
    },
    onSuccess: () => {
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
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {[
                { v: "live", icon: Radio, title: "Go live", body: "You broadcast in real time during your window." },
                { v: "prerecorded", icon: PlayCircle, title: "Play a recorded episode", body: "Send us the file and we'll roll it in your slot." },
              ].map(({ v, icon: Icon, title, body }) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={format === v}
                  onClick={() => setFormat(v)}
                  className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-colors ${
                    format === v ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                  }`}
                  data-testid={`radio-show-format-${v}`}
                >
                  <Icon className={`h-4 w-4 ${format === v ? "text-primary" : "text-muted-foreground"}`} />
                  <span className="text-sm font-medium">{title}</span>
                  <span className="text-xs text-muted-foreground">{body}</span>
                </button>
              ))}
            </div>
          </div>

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
                        introStyle === v ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
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
              className="gap-1.5 rounded-full"
              disabled={save.isPending || !name.trim()}
              onClick={() => save.mutate()}
              data-testid="button-save-show"
            >
              <Save className="h-4 w-4" /> {save.isPending ? "Saving…" : "Save show"}
            </Button>
            {!name.trim() && <span className="text-xs text-muted-foreground">A show name is needed first.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
