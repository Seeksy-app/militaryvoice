import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiUpload, resolveUploadUrl } from "@/lib/queryClient";
import { insertProfileSchema, type ProfileRow } from "@shared/schema";
import { PhotoCropDialog } from "@/components/PhotoCropDialog";
import { formatDateInZone, formatTimeInZone, zoneLabel } from "@/lib/schedule";
import {
  Camera,
  ImagePlus,
  X,
  Crop,
  Rss,
  Youtube,
  Mic2,
  User,
  Globe,
  Clapperboard,
  Radio,
  CalendarClock,
  Check,
  Link2,
  Video,
  Presentation,
  Image as ImageIcon,
  Users,
  Sparkles,
} from "lucide-react";

const formSchema = insertProfileSchema.extend({
  needsInterviewer: z.boolean(),
});
type FormValues = z.infer<typeof formSchema>;

export interface PendingSlotSummary {
  eventName: string;
  start: Date;
  end: Date;
  zone: string;
}

interface Props {
  email: string;
  profile: ProfileRow | null;
  onSaved: () => void;
  onCancel?: () => void;
  /** Slot the podcaster picked before signing in; shown pinned in the sidebar. */
  pendingSlot?: PendingSlotSummary | null;
}

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
  id,
}: {
  icon: typeof Mic2;
  title: string;
  description?: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="overflow-hidden rounded-2xl border border-border bg-card">
      <header className="flex items-start gap-3 border-b border-border bg-muted/40 px-5 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-4.5 w-4.5" />
        </div>
        <div>
          <h3 className="text-base font-semibold leading-tight text-card-foreground">{title}</h3>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
      </header>
      <div className="flex flex-col gap-5 px-5 py-5">{children}</div>
    </section>
  );
}

export function ProfileForm({ email, profile, onSaved, onCancel, pendingSlot }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [rawImageSrc, setRawImageSrc] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const isSetup = !profile;

  function handlePhotoChange(file: File | null) {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    if (!file) {
      setPhotoFile(null);
      setPhotoPreview(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setPhotoError("That file isn't an image — try a JPG or PNG.");
      return;
    }
    setPhotoError(null);
    const reader = new FileReader();
    reader.onload = () => {
      setRawImageSrc(reader.result as string);
      setCropOpen(true);
    };
    reader.readAsDataURL(file);
  }

  function handleCropConfirm(blob: Blob) {
    const file = new File([blob], "photo.jpg", { type: "image/jpeg" });
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    setCropOpen(false);
    setRawImageSrc(null);
  }

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      podcastName: profile?.podcastName ?? "",
      hostName: profile?.hostName ?? "",
      phone: profile?.phone ?? "",
      numPeople: profile?.numPeople ?? 1,
      hasVideoIntro: profile?.hasVideoIntro ?? false,
      hasVideoOutro: profile?.hasVideoOutro ?? false,
      hasSlides: profile?.hasSlides ?? false,
      hasImages: profile?.hasImages ?? false,
      needsInterviewer: profile?.needsInterviewer ?? false,
      socialLinks: profile?.socialLinks ?? "",
      rssUrl: profile?.rssUrl ?? "",
      youtubeUrl: profile?.youtubeUrl ?? "",
      notes: profile?.notes ?? "",
    },
  });

  const existingPhotoUrl = profile?.photoUrl ? resolveUploadUrl(profile.photoUrl) : null;
  const shownPhoto = photoPreview ?? existingPhotoUrl;
  const watchPodcast = form.watch("podcastName");
  const watchHost = form.watch("hostName");
  const watchPeople = form.watch("numPeople");
  const watchRss = form.watch("rssUrl");

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!photoFile && !existingPhotoUrl) {
        throw new Error("A photo is required — give us the best one you've got.");
      }
      const formData = new FormData();
      formData.append("podcastName", values.podcastName);
      formData.append("hostName", values.hostName);
      formData.append("phone", values.phone ?? "");
      formData.append("numPeople", String(values.numPeople));
      formData.append("hasVideoIntro", String(values.hasVideoIntro));
      formData.append("hasVideoOutro", String(values.hasVideoOutro));
      formData.append("hasSlides", String(values.hasSlides));
      formData.append("hasImages", String(values.hasImages));
      formData.append("needsInterviewer", String(values.needsInterviewer));
      formData.append("socialLinks", values.socialLinks ?? "");
      formData.append("rssUrl", values.rssUrl ?? "");
      formData.append("youtubeUrl", values.youtubeUrl ?? "");
      formData.append("notes", values.notes ?? "");
      if (photoFile) formData.append("photo", photoFile);
      const res = await apiUpload("PUT", "/api/host/profile", formData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/host/profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasters"] });
      toast({
        title: isSetup ? "You're set up" : "Profile saved",
        description: isSetup
          ? "Your show details are saved and will be reused for every slot you claim."
          : "Your changes apply to every slot you hold.",
      });
      onSaved();
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't save your profile", description: err.message, variant: "destructive" });
    },
  });

  function handleSubmit(values: FormValues) {
    if (!photoFile && !existingPhotoUrl) {
      setPhotoError("A photo is required — give us the best one you've got.");
      document.getElementById("section-show")?.scrollIntoView({ behavior: "smooth", block: "start" });
      toast({ title: "Add a photo", description: "It's what listeners will see on the lineup.", variant: "destructive" });
      return;
    }
    mutation.mutate(values);
  }

  const photoDone = !!shownPhoto;
  const basicsDone = !!watchPodcast?.trim() && !!watchHost?.trim();

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit, () => {
          toast({ title: "Check the form", description: "A few fields still need your attention.", variant: "destructive" });
        })}
        data-testid="form-profile"
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
          {/* ------------------------------------------------ main column */}
          <div className="flex flex-col gap-6">
            <SectionCard
              id="section-show"
              icon={Mic2}
              title="Your show"
              description="The essentials listeners see on the lineup, and the feed we use to pull your episodes."
            >
              {/* Photo */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`group relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-muted transition-colors hover:border-primary ${
                    shownPhoto ? "border-transparent ring-4 ring-primary/10" : "border-dashed border-border"
                  }`}
                  data-testid="button-upload-photo"
                >
                  {shownPhoto ? (
                    <img src={shownPhoto} alt="Your selected photo" className="h-full w-full object-cover" />
                  ) : (
                    <Camera className="h-7 w-7 text-muted-foreground transition-colors group-hover:text-primary" />
                  )}
                </button>
                <div className="flex flex-col gap-1.5">
                  <div className="text-sm font-medium">Photo {shownPhoto ? "" : <span className="text-destructive">*</span>}</div>
                  <p className="text-xs text-muted-foreground">
                    Square works best. We'll enhance it and crop it to a circle for the agenda.
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => fileInputRef.current?.click()}>
                      <ImagePlus className="h-3.5 w-3.5" />
                      {shownPhoto ? "Change photo" : "Upload photo"}
                    </Button>
                    {photoFile && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            if (photoPreview) {
                              setRawImageSrc(photoPreview);
                              setCropOpen(true);
                            }
                          }}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                          data-testid="button-adjust-crop"
                        >
                          <Crop className="h-3 w-3" /> Adjust crop
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handlePhotoChange(null);
                            if (fileInputRef.current) fileInputRef.current.value = "";
                          }}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3 w-3" /> Remove
                        </button>
                      </>
                    )}
                  </div>
                  {photoError && <p className="text-sm font-medium text-destructive">{photoError}</p>}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  data-testid="input-photo"
                  onChange={(e) => handlePhotoChange(e.target.files?.[0] ?? null)}
                />
                <PhotoCropDialog
                  open={cropOpen}
                  imageSrc={rawImageSrc}
                  onCancel={() => {
                    setCropOpen(false);
                    setRawImageSrc(null);
                    if (!photoFile && fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  onConfirm={handleCropConfirm}
                />
              </div>

              <FormField
                control={form.control}
                name="podcastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Podcast / show name <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="The Night Watch Podcast" {...field} data-testid="input-podcast-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="rssUrl"
                render={({ field }) => (
                  <FormItem className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                    <FormLabel className="flex items-center gap-1.5">
                      <Rss className="h-4 w-4 text-primary" /> Podcast RSS feed
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="https://feeds.example.com/your-show" inputMode="url" {...field} data-testid="input-rss-url" />
                    </FormControl>
                    <FormDescription>
                      This is how we pull your episodes so listeners can hit play right from your card. Find it in your
                      host's settings (Buzzsprout, Spotify for Creators, Libsyn, Transistor, Podbean…). Optional, but
                      strongly recommended.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="youtubeUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5">
                      <Youtube className="h-4 w-4 text-primary" /> YouTube channel (optional)
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="youtube.com/@yourshow" inputMode="url" {...field} data-testid="input-youtube-url" />
                    </FormControl>
                    <FormDescription>If your show also lives on YouTube, we'll link it.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SectionCard>

            <SectionCard icon={User} title="About you" description="Who's behind the mic. Contact details stay private to the production team.">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="hostName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Your name <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="Jamie Rivera" {...field} data-testid="input-host-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" readOnly disabled value={email} data-testid="input-email" />
                  </FormControl>
                  <FormDescription>You signed in with this. It's where we'll send show-day details.</FormDescription>
                </FormItem>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone (optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="(555) 555-5555" {...field} data-testid="input-phone" />
                      </FormControl>
                      <FormDescription>Only used if we need to reach you fast on show day.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="numPeople"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Who's on the mic?</FormLabel>
                      <FormControl>
                        <RadioGroup
                          value={String(field.value)}
                          onValueChange={(v) => field.onChange(Number(v))}
                          className="grid grid-cols-2 gap-2"
                        >
                          {[
                            ["1", "Just me"],
                            ["2", "Two of us"],
                          ].map(([v, label]) => (
                            <FormItem key={v} className="space-y-0">
                              <FormLabel
                                className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm font-normal transition-colors ${
                                  String(field.value) === v ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                                }`}
                              >
                                <FormControl>
                                  <RadioGroupItem value={v} data-testid={`radio-people-${v === "1" ? "one" : "two"}`} />
                                </FormControl>
                                {label}
                              </FormLabel>
                            </FormItem>
                          ))}
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </SectionCard>

            <SectionCard icon={Globe} title="Where to follow you" description="Shown as links on your card so listeners can find you after your slot.">
              <FormField
                control={form.control}
                name="socialLinks"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Website or main social link (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="instagram.com/yourshow" {...field} data-testid="input-social-links" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex items-start gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-3.5 text-sm">
                <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Connect Instagram, TikTok, YouTube, X and more</span> with one
                  click from your dashboard after this step. Connected accounts appear as follow buttons on your card.
                </p>
              </div>
            </SectionCard>

            <SectionCard
              icon={Clapperboard}
              title="For the production team"
              description="Helps us plan transitions and line up support. You can change any of this later."
            >
              <div>
                <FormLabel>What are you bringing?</FormLabel>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(
                    [
                      ["hasVideoIntro", "Video intro", Video],
                      ["hasVideoOutro", "Video outro", Video],
                      ["hasSlides", "Slides", Presentation],
                      ["hasImages", "Images", ImageIcon],
                    ] as const
                  ).map(([name, label, Icon]) => (
                    <FormField
                      key={name}
                      control={form.control}
                      name={name}
                      render={({ field }) => (
                        <FormItem className="space-y-0">
                          <FormLabel
                            className={`flex cursor-pointer flex-col items-start gap-2 rounded-xl border p-3 text-sm font-normal transition-colors ${
                              field.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                            }`}
                          >
                            <div className="flex w-full items-center justify-between">
                              <Icon className={`h-4 w-4 ${field.value ? "text-primary" : "text-muted-foreground"}`} />
                              <FormControl>
                                <Checkbox
                                  checked={field.value as boolean}
                                  onCheckedChange={field.onChange}
                                  data-testid={`checkbox-${name}`}
                                />
                              </FormControl>
                            </div>
                            {label}
                          </FormLabel>
                        </FormItem>
                      )}
                    />
                  ))}
                </div>
              </div>

              <FormField
                control={form.control}
                name="needsInterviewer"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Interview help</FormLabel>
                    <FormControl>
                      <RadioGroup
                        value={field.value ? "yes" : "no"}
                        onValueChange={(v) => field.onChange(v === "yes")}
                        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                      >
                        {[
                          ["no", "We're good on our own", "You run your own show start to finish."],
                          ["yes", "Pair us with an interviewer", "We'll line someone up before air time."],
                        ].map(([v, label, hint]) => (
                          <FormItem key={v} className="space-y-0">
                            <FormLabel
                              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 font-normal transition-colors ${
                                (field.value ? "yes" : "no") === v ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                              }`}
                            >
                              <FormControl>
                                <RadioGroupItem value={v} className="mt-0.5" data-testid={`radio-interviewer-${v}`} />
                              </FormControl>
                              <span>
                                <span className="block text-sm">{label}</span>
                                <span className="block text-xs text-muted-foreground">{hint}</span>
                              </span>
                            </FormLabel>
                          </FormItem>
                        ))}
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Anything else? (optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        placeholder="Guests you're bringing, how you like to open, tech quirks we should know about…"
                        {...field}
                        data-testid="input-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SectionCard>
          </div>

          {/* ----------------------------------------------------- sidebar */}
          <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
            {pendingSlot && (
              <div className="overflow-hidden rounded-2xl border border-[#F0A71F]/50 bg-card shadow-sm" data-testid="card-pending-slot">
                <div className="flex items-center gap-2 bg-[#F0A71F] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#1a1200]">
                  <CalendarClock className="h-3.5 w-3.5" /> Your slot is held
                </div>
                <div className="px-4 py-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{pendingSlot.eventName.trim()}</div>
                  <div className="mt-1 font-semibold">{formatDateInZone(pendingSlot.start, pendingSlot.zone)}</div>
                  <div className="font-mono text-lg font-bold text-primary">
                    {formatTimeInZone(pendingSlot.start, pendingSlot.zone)}–{formatTimeInZone(pendingSlot.end, pendingSlot.zone)}
                  </div>
                  <div className="text-xs text-muted-foreground">{zoneLabel(pendingSlot.zone)}</div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Finish your profile and this slot is yours. We'll confirm by email.
                  </p>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-border bg-card p-4" data-testid="card-profile-preview">
              <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> How you'll appear
              </div>
              <div className="flex flex-col items-center rounded-xl border border-border bg-background p-4 text-center">
                {shownPhoto ? (
                  <img src={shownPhoto} alt="" className="h-16 w-16 rounded-full object-cover ring-4 ring-primary/10" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Mic2 className="h-6 w-6" />
                  </div>
                )}
                <div className="mt-2 line-clamp-2 text-sm font-semibold leading-tight">
                  {watchPodcast?.trim() || <span className="text-muted-foreground">Your show name</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {watchHost?.trim() || "Host name"}
                  {watchPeople === 2 && " + co-host"}
                </div>
                {pendingSlot && (
                  <div className="mt-2 font-mono text-[11px] text-primary">
                    {formatDateInZone(pendingSlot.start, pendingSlot.zone)} · {formatTimeInZone(pendingSlot.start, pendingSlot.zone)}
                  </div>
                )}
                {watchRss?.trim() && (
                  <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px]">
                    <Rss className="h-3 w-3 text-primary" /> Episodes linked
                  </div>
                )}
              </div>
              <ul className="mt-4 space-y-2 text-xs">
                {[
                  ["Photo", photoDone],
                  ["Show and host name", basicsDone],
                  ["RSS feed (recommended)", !!watchRss?.trim()],
                ].map(([label, done]) => (
                  <li key={label as string} className="flex items-center gap-2">
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full ${
                        done ? "bg-primary text-primary-foreground" : "border border-border text-transparent"
                      }`}
                    >
                      <Check className="h-2.5 w-2.5" />
                    </span>
                    <span className={done ? "text-foreground" : "text-muted-foreground"}>{label as string}</span>
                  </li>
                ))}
              </ul>
            </div>

            {isSetup && (
              <div className="rounded-2xl border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
                <div className="mb-2 flex items-center gap-1.5 font-semibold uppercase tracking-wide">
                  <Radio className="h-3.5 w-3.5 text-primary" /> What happens next
                </div>
                <ol className="list-decimal space-y-1 pl-4">
                  <li>{pendingSlot ? "Your slot is confirmed the moment you save." : "Pick an open slot from your dashboard."}</li>
                  <li>Connect your social accounts so listeners can follow you.</li>
                  <li>We email show-day details and your on-air window.</li>
                </ol>
              </div>
            )}
          </aside>
        </div>

        {/* sticky action bar */}
        <div className="sticky bottom-0 z-10 mt-6 -mx-4 border-t border-border bg-background/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              <span className="text-destructive">*</span> Required. Everything else can be added later.
            </p>
            <div className="flex items-center gap-2">
              {onCancel && (
                <Button type="button" variant="outline" onClick={onCancel} disabled={mutation.isPending}>
                  Cancel
                </Button>
              )}
              <Button type="submit" disabled={mutation.isPending} className="gap-1.5 rounded-full px-5" data-testid="button-save-profile">
                {mutation.isPending ? (
                  "Saving…"
                ) : pendingSlot ? (
                  <>
                    <Users className="h-4 w-4" /> Save & claim my slot
                  </>
                ) : isSetup ? (
                  "Save & continue"
                ) : (
                  "Save changes"
                )}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </Form>
  );
}
