import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiUpload, apiRequest, resolveUploadUrl } from "@/lib/queryClient";
import { SocialTiles } from "@/components/SocialTiles";
import { SocialIconRow, parseSocialAccounts } from "@/components/SocialIcons";
import { insertProfileSchema, SERVICE_BRANCHES, SERVICE_STATUSES, RECORDING_MODES, STREAM_PLATFORMS, type ProfileRow, type SocialAccount } from "@shared/schema";
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
  Users,
  Sparkles,
  Save,
  AlertCircle,
  FileVideo,
  Headphones,
  Video,
  Presentation,
  Image as ImageIcon,
  PlayCircle,
  Film,
} from "lucide-react";

const DRAFT_KEY = "mv_profile_draft";
interface Draft {
  email: string;
  values: Partial<FormValues>;
  photoDataUrl: string | null;
}
function readDraft(email: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return d.email === email ? d : null;
  } catch {
    return null;
  }
}
function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

// insertProfileSchema carries a refinement (a pre-recorded slot needs a link),
// so it can't be extended — use it as-is.
const formSchema = insertProfileSchema;
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
  /** Where to go once it saves. Setup offers a choice; editing just closes. */
  onSaved: (next?: "events" | "dashboard") => void;
  /** So the page can stop nav-bar clicks from throwing away unsaved work. */
  onDirtyChange?: (dirty: boolean) => void;
  onCancel?: () => void;
  /** Slot the podcaster picked before signing in; shown pinned in the sidebar. */
  pendingSlot?: PendingSlotSummary | null;
  /**
   * "setup" is the one-pass form someone fills to get booked, and asks about
   * their show as well as themselves. "profile" is Profile Settings, which is
   * only ever about the person.
   */
  variant?: "setup" | "profile";
}

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
  id,
  step,
  plain = false,
}: {
  icon: typeof Mic2;
  title: string;
  description?: string;
  children: React.ReactNode;
  id?: string;
  step?: number;
  /** One continuous form instead of a stack of separate cards. */
  plain?: boolean;
}) {
  if (plain) {
    return (
      <div id={id} className="flex flex-col gap-5 border-b border-border px-5 py-6 last:border-b-0">
        {children}
      </div>
    );
  }
  return (
    <section id={id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <header className="flex items-start gap-3 bg-[#053877] px-5 py-4 text-white">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#F0A71F]">
          <Icon className="h-5 w-5" />
          {step !== undefined && (
            <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#F0A71F] font-mono text-[12px] font-bold text-[#1a1200]">
              {step}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-tight" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>
            {title}
          </h3>
          {description && <p className="mt-0.5 text-sm leading-relaxed text-white/70">{description}</p>}
        </div>
      </header>
      <div className="flex flex-col gap-5 px-5 py-6">{children}</div>
    </section>
  );
}

export function ProfileForm({ email, profile, onSaved, onCancel, pendingSlot, variant = "setup", onDirtyChange }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [rawImageSrc, setRawImageSrc] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const bypassGuard = useRef(false);
  const nextAfterSave = useRef<"events" | "dashboard">("events");
  const isSetup = !profile;

  const { data: social } = useQuery<{ configured: boolean; accounts: SocialAccount[] }>({
    queryKey: ["/api/host/social"],
    retry: false,
  });

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
    // Keep a data URL so the photo survives the social-connect round trip.
    const r = new FileReader();
    r.onload = () => setPhotoDataUrl(r.result as string);
    r.readAsDataURL(blob);
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
      showFormat: (profile?.showFormat as "live" | "prerecorded") ?? "live",
      recordingUrl: profile?.recordingUrl ?? "",
      introStyle: (profile?.introStyle as "virtual" | "straight") ?? "virtual",
      branch: profile?.branch ?? "",
      serviceStatus: profile?.serviceStatus ?? "",
      recordingMode: profile?.recordingMode ?? "",
      postEdits: profile?.postEdits ?? "",
      streamPlatform: profile?.streamPlatform ?? "",
      streamPlatformOther: profile?.streamPlatformOther ?? "",
      notes: profile?.notes ?? "",
      // These three live on the dashboard's Show materials panel, not on this
      // form — but the shared schema requires them as strings. Leaving them
      // undefined failed validation on fields with no control to fix, so the
      // form could never be submitted at all. Any field the schema requires
      // needs a default here, rendered or not.
      guests: profile?.guests ?? "",
      interviewQuestions: profile?.interviewQuestions ?? "",
      promoNotes: profile?.promoNotes ?? "",
    },
  });

  // Restore a draft stashed before a social-connect redirect (first-time setup only).
  useEffect(() => {
    if (profile) return;
    const d = readDraft(email);
    if (!d) return;
    form.reset({ ...form.getValues(), ...d.values });
    if (d.photoDataUrl) {
      fetch(d.photoDataUrl)
        .then((r) => r.blob())
        .then((blob) => {
          const file = new File([blob], "photo.jpg", { type: "image/jpeg" });
          setPhotoFile(file);
          setPhotoPreview(URL.createObjectURL(file));
          setPhotoDataUrl(d.photoDataUrl);
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectSocial = useMutation({
    mutationFn: async () => {
      // Stash everything typed so far; the connect flow leaves the page.
      try {
        const draft: Draft = { email, values: form.getValues(), photoDataUrl };
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch {
        /* storage full or blocked — connect anyway */
      }
      const res = await apiRequest("POST", "/api/host/social/connect");
      return (await res.json()) as { url: string };
    },
    onSuccess: ({ url }) => {
      bypassGuard.current = true;
      window.location.href = url;
    },
    onError: (err: Error) => toast({ title: "Couldn't open the connection page", description: err.message, variant: "destructive" }),
  });

  const existingPhotoUrl = profile?.photoUrl ? resolveUploadUrl(profile.photoUrl) : null;
  const shownPhoto = photoPreview ?? existingPhotoUrl;
  const dirty = form.formState.isDirty || !!photoFile;
  useEffect(() => {
    onDirtyChange?.(dirty);
    // Never leave a stale "unsaved" flag behind when the form unmounts.
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  // "Save before you leave": browser prompt on close/reload, and a confirm on
  // in-app links while there are unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (bypassGuard.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onClickCapture = (e: MouseEvent) => {
      if (bypassGuard.current) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      if (a.origin !== window.location.origin) return;
      if (!window.confirm("You have unsaved changes. Leave this page without saving?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClickCapture, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [dirty]);
  const watchPodcast = form.watch("podcastName");
  const watchHost = form.watch("hostName");
  const watchRss = form.watch("rssUrl");
  const watchYouTube = form.watch("youtubeUrl");
  // Same accounts the public card will show.
  const connectedAccounts = parseSocialAccounts(profile?.socialAccounts);
  const watchFormat = form.watch("showFormat");
  const isPrerecorded = watchFormat === "prerecorded";
  const watchIntro = form.watch("introStyle");
  const watchPlatform = form.watch("streamPlatform");

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
      // A finished episode carries its own intro, slides and guests, and there's
      // no interview to staff — don't ship stale production flags the form hid.
      const prerecorded = values.showFormat === "prerecorded";
      formData.append("hasVideoIntro", String(prerecorded ? false : values.hasVideoIntro));
      formData.append("hasVideoOutro", String(prerecorded ? false : values.hasVideoOutro));
      formData.append("hasSlides", String(prerecorded ? false : values.hasSlides));
      formData.append("hasImages", String(prerecorded ? false : values.hasImages));
      formData.append("needsInterviewer", String(prerecorded ? false : values.needsInterviewer));
      formData.append("socialLinks", values.socialLinks ?? "");
      formData.append("rssUrl", values.rssUrl ?? "");
      formData.append("youtubeUrl", values.youtubeUrl ?? "");
      formData.append("showFormat", values.showFormat);
      formData.append("recordingUrl", values.recordingUrl ?? "");
      formData.append("introStyle", values.introStyle);
      formData.append("branch", values.branch ?? "");
      formData.append("serviceStatus", values.serviceStatus ?? "");
      formData.append("recordingMode", values.recordingMode ?? "");
      formData.append("postEdits", values.postEdits ?? "");
      formData.append("streamPlatform", values.streamPlatform ?? "");
      formData.append("streamPlatformOther", values.streamPlatformOther ?? "");
      formData.append("notes", values.notes ?? "");
      if (photoFile) formData.append("photo", photoFile);
      const res = await apiUpload("PUT", "/api/host/profile", formData);
      return res.json();
    },
    onSuccess: () => {
      clearDraft();
      bypassGuard.current = true; // the caller navigates away next
      queryClient.invalidateQueries({ queryKey: ["/api/host/profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasters"] });
      toast({
        title: isSetup ? "You're set up" : "Profile saved",
        description: isSetup
          ? "Your show details are saved. They'll follow you if you move to a different time."
          : "Your changes apply to the slot you hold.",
      });
      onSaved(nextAfterSave.current);
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

  // Shared by the form's submit and by each save button, so both routes get
  // the same field-naming behaviour.
  const onInvalid = (errors: Record<string, unknown>) => {
          // Name the fields. A generic "check the form" with nothing marked
          // sends people hunting for a mistake that may not be on screen at
          // all, which is exactly how the missing-defaults bug stayed hidden.
          const names = Object.keys(errors);
          const onScreen = names.filter((n) => document.getElementsByName(n).length > 0);
          if (onScreen.length !== names.length) {
            console.warn("Profile form blocked by fields with no control:", names.filter((n) => !onScreen.includes(n)), errors);
          }
          toast({
            title: "Check the form",
            description: names.length
              ? `Still needed: ${names.slice(0, 4).join(", ")}${names.length > 4 ? "…" : ""}.`
              : "A few fields still need your attention.",
            variant: "destructive",
          });
          const first = onScreen[0] ?? names[0];
          if (first) form.setFocus(first as keyof FormValues);
        };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit, onInvalid)}
        data-testid="form-profile"
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
          {/* ------------------------------------------------ main column
              Profile settings is one bordered frame — the separate navy-headed
              cards made four short groups of fields look like four errands. */}
          <div
            className={
              variant === "profile"
                ? "overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
                : "flex flex-col gap-6"
            }
          >
            <SectionCard
              plain={variant === "profile"}
              id="section-about"
              step={variant === "setup" ? 1 : undefined}
              icon={User}
              title="About you"
              description="Who's behind the mic. Your photo goes on the public lineup; contact details stay with the production team."
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

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem className="sm:max-w-xs">
                    <FormLabel>Phone (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="(555) 555-5555" {...field} data-testid="input-phone" />
                    </FormControl>
                    <FormDescription>Only used if we need to reach you fast on show day.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="serviceStatus"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status (optional)</FormLabel>
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger data-testid="select-service-status">
                            <SelectValue placeholder="Select your status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SERVICE_STATUSES.map((o) => (
                            <SelectItem key={o} value={o}>
                              {o}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>How you're connected to the military community.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="branch"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Branch (optional)</FormLabel>
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger data-testid="select-branch">
                            <SelectValue placeholder="Select a branch" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SERVICE_BRANCHES.map((o) => (
                            <SelectItem key={o} value={o}>
                              {o}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Pick "Not applicable" if you're a supporter or an organization.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </SectionCard>

            {/* The show and its format belong to an event, not to the
                person, so Profile Settings does not carry them — they live in
                Event settings. First-time setup still asks, because you cannot
                book a slot without them and we are not making that two trips. */}
            {variant === "setup" && (
              <>
            <SectionCard
              id="section-show"
              step={2}
              icon={Mic2}
              title="Your show"
              description="What listeners see on the lineup."
            >
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

            </SectionCard>

            <SectionCard
              step={3}
              icon={Radio}
              title="How your slot runs"
              description="Broadcast live in your time block, or hand us an episode you've already recorded."
            >
              <FormField
                control={form.control}
                name="showFormat"
                render={({ field }) => (
                  <FormItem className="space-y-0">
                    <FormControl>
                      <RadioGroup value={field.value} onValueChange={field.onChange} className="grid gap-3 sm:grid-cols-2">
                        {[
                          {
                            v: "live",
                            icon: Radio,
                            title: "Go live",
                            body: "You broadcast in real time during your window, from your own studio.",
                          },
                          {
                            v: "prerecorded",
                            icon: PlayCircle,
                            title: "Play a recorded episode",
                            body: "Already have it in the can? Send us the file and we'll roll it in your slot.",
                          },
                        ].map(({ v, icon: Icon, title, body }) => (
                          <FormItem key={v} className="space-y-0">
                            <FormLabel
                              className={`flex h-full cursor-pointer flex-col gap-2 rounded-xl border-2 p-4 font-normal transition-colors ${
                                field.value === v ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                              }`}
                              data-testid={`radio-format-${v}`}
                            >
                              <span className="flex items-center justify-between">
                                <Icon className={`h-5 w-5 ${field.value === v ? "text-primary" : "text-muted-foreground"}`} />
                                <FormControl>
                                  <RadioGroupItem value={v} />
                                </FormControl>
                              </span>
                              <span className="text-sm font-semibold text-card-foreground">{title}</span>
                              <span className="text-xs leading-relaxed text-muted-foreground">{body}</span>
                            </FormLabel>
                          </FormItem>
                        ))}
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {isPrerecorded && (
                <div className="flex flex-col gap-5 rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <FormField
                    control={form.control}
                    name="recordingUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-1.5">
                          <FileVideo className="h-4 w-4 text-primary" /> Link to your episode <span className="text-destructive">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="youtube.com/watch?v=… or a Drive / Dropbox link"
                            inputMode="url"
                            {...field}
                            data-testid="input-recording-url"
                          />
                        </FormControl>
                        <FormDescription>
                          Paste an unlisted YouTube or Vimeo link, or a Google Drive, Dropbox, or WeTransfer link to the video
                          or audio file. Make sure sharing is set so anyone with the link can view it. We'll download it and
                          check the audio before your slot.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="introStyle"
                    render={({ field }) => (
                      <FormItem className="space-y-0">
                        <FormLabel className="mb-2 block">How should we open your slot?</FormLabel>
                        <FormControl>
                          <RadioGroup value={field.value} onValueChange={field.onChange} className="grid gap-2 sm:grid-cols-2">
                            {[
                              {
                                v: "virtual",
                                icon: Film,
                                title: "Live virtual intro first",
                                body: "You join on camera for a short hello, then we roll the episode.",
                              },
                              {
                                v: "straight",
                                icon: PlayCircle,
                                title: "Just play the episode",
                                body: "Straight into the recording. Nothing needed from you on the day.",
                              },
                            ].map(({ v, icon: Icon, title, body }) => (
                              <FormItem key={v} className="space-y-0">
                                <FormLabel
                                  className={`flex h-full cursor-pointer items-start gap-3 rounded-lg border bg-background p-3 font-normal transition-colors ${
                                    field.value === v ? "border-primary ring-1 ring-primary/30" : "border-border hover:bg-muted/50"
                                  }`}
                                  data-testid={`radio-intro-${v}`}
                                >
                                  <FormControl>
                                    <RadioGroupItem value={v} className="mt-0.5" />
                                  </FormControl>
                                  <span>
                                    <span className="flex items-center gap-1.5 text-sm font-medium text-card-foreground">
                                      <Icon className="h-3.5 w-3.5 text-primary" /> {title}
                                    </span>
                                    <span className="mt-0.5 block text-xs text-muted-foreground">{body}</span>
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
                </div>
              )}
            </SectionCard>
              </>
            )}

            {/* Only Profile settings carries this now: everything left in it is
                about how the person normally works, which has no bearing on
                getting booked. During setup the card was rendering empty. */}
            {variant === "profile" && (
            <SectionCard
              plain
              icon={Clapperboard}
              title="How you normally work"
              description="All optional. Just so we know what you're used to — it changes nothing about your slot."
            >
              {/* Permanent facts about how this person works, not setup for
                  the event — what they normally use has no bearing on claiming
                  a slot. So it lives in Profile Settings and stays out of the
                  way while someone is trying to get booked. */}
              {!isSetup && (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="recordingMode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Do you record and edit, or live stream?</FormLabel>
                        <Select value={field.value || undefined} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger data-testid="select-recording-mode">
                              <SelectValue placeholder="Select one" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {RECORDING_MODES.map((o) => (
                              <SelectItem key={o} value={o}>
                                {o}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="streamPlatform"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>What do you use?</FormLabel>
                        <Select value={field.value || undefined} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger data-testid="select-stream-platform">
                              <SelectValue placeholder="Select one" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {STREAM_PLATFORMS.map((o) => (
                              <SelectItem key={o} value={o}>
                                {o}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {watchPlatform === "Other" && (
                    <FormField
                      control={form.control}
                      name="streamPlatformOther"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Which one?</FormLabel>
                          <FormControl>
                            <Input placeholder="Tell us what you use" {...field} data-testid="input-stream-platform-other" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              </div>
              )}

              {/* "What are you bringing?" and the interviewer question are
                  about one segment, not about the person, so they now live on
                  the Show materials tab beside the files they describe. The
                  values still round-trip through this form's defaults. */}

            </SectionCard>
            )}

            <SectionCard
              plain={variant === "profile"}
              step={variant === "setup" ? 4 : undefined}
              icon={Headphones}
              title="Where people can listen"
              description="Both optional — add whichever you have, or skip this and come back later."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="rssUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <Rss className="h-4 w-4 text-primary" /> Podcast RSS feed
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="https://feeds.example.com/your-show" inputMode="url" {...field} data-testid="input-rss-url" />
                      </FormControl>
                      <FormDescription>
                        Lets listeners play your episodes from your card. It's in your host's settings (Buzzsprout,
                        Spotify for Creators, Libsyn, Transistor, Podbean…).
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
                        <Youtube className="h-4 w-4 text-primary" /> YouTube channel
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="youtube.com/@yourshow" inputMode="url" {...field} data-testid="input-youtube-url" />
                      </FormControl>
                      <FormDescription>Perfect if your show lives on YouTube rather than a podcast feed.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </SectionCard>

            <SectionCard
              plain={variant === "profile"}
              step={variant === "setup" ? 5 : undefined}
              icon={Globe}
              title="Connect your social media"
              description="So listeners can find and follow you after your slot. Everything here shows on your public card."
            >
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
              {social?.configured ? (
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      <Link2 className="mr-1.5 inline h-4 w-4 text-primary" />
                      Tap a network to connect it
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Connected accounts show on your card with avatar and follower count.
                    </p>
                  </div>
                  <SocialTiles accounts={social.accounts} onConnect={() => connectSocial.mutate()} connecting={connectSocial.isPending} />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Connecting opens a secure page and brings you right back here. What you've typed is kept.
                  </p>
                </div>
              ) : (
                <div className="flex items-start gap-3 rounded-xl border border-[#053877]/20 bg-[#053877]/[0.035] p-3.5 text-sm">
                  <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">Connect Instagram, TikTok, YouTube, X, Facebook and LinkedIn</span>{" "}
                    from your dashboard. Each connected account shows on your card with your avatar and follower count.
                  </p>
                </div>
              )}
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
                  <div className="text-xs font-medium uppercase tracking-[0.08em] text-foreground">{pendingSlot.eventName.trim()}</div>
                  <div className="mt-1 font-semibold">{formatDateInZone(pendingSlot.start, pendingSlot.zone)}</div>
                  <div className="tabular-nums text-lg font-bold text-primary">
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
              <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> How you'll appear
              </div>
              <div className="flex flex-col items-center rounded-2xl border border-border bg-background p-5 text-center">
                {shownPhoto ? (
                  <img src={shownPhoto} alt="" className="h-20 w-20 rounded-full object-cover ring-4 ring-primary/10" />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Mic2 className="h-7 w-7" />
                  </div>
                )}
                <div className="mt-3 line-clamp-2 text-sm font-semibold leading-tight">
                  {watchPodcast?.trim() || <span className="text-muted-foreground">Your show name</span>}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {watchHost?.trim() || "Host name"}
                </div>
                <div className="mt-2 tabular-nums text-xs text-primary">
                  {pendingSlot
                    ? `${formatDateInZone(pendingSlot.start, pendingSlot.zone)} · ${formatTimeInZone(pendingSlot.start, pendingSlot.zone)}`
                    : "Time coming soon"}
                </div>
                <SocialIconRow accounts={connectedAccounts} size="md" variant="filled" className="mt-3 justify-center" />
              </div>
              <ul className="mt-4 space-y-2 text-xs">
                {[
                  ["Photo", photoDone],
                  ["Show and host name", basicsDone],
                  ["Somewhere to listen (optional)", !!watchRss?.trim() || !!watchYouTube?.trim()],
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
              <div className="rounded-2xl border border-[#053877]/20 bg-[#053877]/[0.035] p-4 text-xs text-foreground">
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
        <div
          className={`sticky bottom-0 z-10 mt-6 -mx-4 border-t-2 px-4 py-3 shadow-[0_-10px_30px_rgba(0,7,65,0.12)] backdrop-blur sm:mx-0 sm:rounded-2xl sm:border-2 ${
            dirty ? "border-[#F0A71F] bg-[#fff7e6]/95 dark:bg-[#2a1f05]/95" : "border-border bg-background/95"
          }`}
          data-testid="bar-save"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm">
              {dirty ? (
                <>
                  <AlertCircle className="h-4 w-4 text-[#b7791f]" />
                  <span className="font-medium text-foreground">Unsaved changes.</span>
                  <span className="text-muted-foreground">Save before you leave this page.</span>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">
                  <span className="text-destructive">*</span> Required. Everything else can be added later.
                </span>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {/* Saving the profile is only half of getting on air, so setup's
                  primary action carries on to the event rather than leaving
                  someone on a dashboard with nothing obvious to do next. */}
              {isSetup && !pendingSlot && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => {
                    nextAfterSave.current = "dashboard";
                    void form.handleSubmit(handleSubmit, onInvalid)();
                  }}
                  data-testid="button-save-close"
                >
                  Save &amp; close
                </Button>
              )}
              {onCancel && (
                <Button type="button" variant="outline" onClick={onCancel} disabled={mutation.isPending}>
                  Cancel
                </Button>
              )}
              <Button
                type="button"
                size="lg"
                disabled={mutation.isPending}
                onClick={() => {
                  nextAfterSave.current = pendingSlot ? "dashboard" : "events";
                  void form.handleSubmit(handleSubmit, onInvalid)();
                }}
                className="gap-2 rounded-full bg-[#F0A71F] px-6 text-base font-semibold text-[#1a1200] hover:bg-[#f5b944]"
                data-testid="button-save-profile"
              >
                {mutation.isPending ? (
                  "Saving…"
                ) : pendingSlot ? (
                  <>
                    <Users className="h-4 w-4" /> Save &amp; claim my slot
                  </>
                ) : isSetup ? (
                  <>
                    <Save className="h-4 w-4" /> Save &amp; continue to Event settings
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" /> Save changes
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </Form>
  );
}
