import { useEffect, useRef, useState } from "react";
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
import { Camera, ImagePlus, X, Crop, Rss, Youtube } from "lucide-react";

const formSchema = insertProfileSchema.extend({
  needsInterviewer: z.boolean(),
});
type FormValues = z.infer<typeof formSchema>;

interface Props {
  email: string;
  profile: ProfileRow | null;
  onSaved: () => void;
  onCancel?: () => void;
}

export function ProfileForm({ email, profile, onSaved, onCancel }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [rawImageSrc, setRawImageSrc] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);

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
      toast({ title: "Profile saved", description: "You're all set — this will be used every time you claim a slot." });
      onSaved();
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't save your profile", description: err.message, variant: "destructive" });
    },
  });

  function handleSubmit(values: FormValues) {
    if (!photoFile && !existingPhotoUrl) {
      setPhotoError("A photo is required — give us the best one you've got.");
      toast({ title: "A photo is required", description: "Give us the best one you've got, then try again.", variant: "destructive" });
      return;
    }
    mutation.mutate(values);
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit, () => {
          toast({ title: "Check the form", description: "A few fields still need your attention.", variant: "destructive" });
        })}
        className="flex flex-col gap-5"
        data-testid="form-profile"
      >
        <div>
          <FormLabel>Your photo</FormLabel>
          <FormDescription className="mt-0.5">
            Give us the best photo you have — we'll enhance it and put it on the agenda.
          </FormDescription>
          <div className="mt-2 flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="group relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-border bg-muted transition-colors hover:border-primary"
              data-testid="button-upload-photo"
            >
              {photoPreview || existingPhotoUrl ? (
                <img src={photoPreview ?? existingPhotoUrl ?? ""} alt="Your selected photo" className="h-full w-full object-cover" />
              ) : (
                <Camera className="h-6 w-6 text-muted-foreground transition-colors group-hover:text-primary" />
              )}
            </button>
            <div className="flex flex-col gap-1.5">
              <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => fileInputRef.current?.click()}>
                <ImagePlus className="h-3.5 w-3.5" />
                {photoFile || existingPhotoUrl ? "Change photo" : "Upload photo"}
              </Button>
              <div className="flex items-center gap-3">
                {photoFile && (
                  <button
                    type="button"
                    onClick={() => {
                      if (photoPreview) {
                        setRawImageSrc(photoPreview);
                        setCropOpen(true);
                      }
                    }}
                    className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                    data-testid="button-adjust-crop"
                  >
                    <Crop className="h-3 w-3" /> Adjust crop
                  </button>
                )}
                {photoFile && (
                  <button
                    type="button"
                    onClick={() => {
                      handlePhotoChange(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" /> Remove
                  </button>
                )}
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              data-testid="input-photo"
              onChange={(e) => handlePhotoChange(e.target.files?.[0] ?? null)}
            />
          </div>
          {photoError && <p className="mt-1.5 text-sm font-medium text-destructive">{photoError}</p>}
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
              <FormLabel>Podcast / show name</FormLabel>
              <FormControl>
                <Input placeholder="The Night Watch Podcast" {...field} data-testid="input-podcast-name" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="hostName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Your name</FormLabel>
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
            <FormDescription>Signed in as {email}.</FormDescription>
          </FormItem>
        </div>

        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone (optional)</FormLabel>
              <FormControl>
                <Input placeholder="(555) 555-5555" {...field} data-testid="input-phone" />
              </FormControl>
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
                  className="flex gap-4"
                >
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl>
                      <RadioGroupItem value="1" data-testid="radio-people-one" />
                    </FormControl>
                    <FormLabel className="font-normal">Just me</FormLabel>
                  </FormItem>
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl>
                      <RadioGroupItem value="2" data-testid="radio-people-two" />
                    </FormControl>
                    <FormLabel className="font-normal">Two of us</FormLabel>
                  </FormItem>
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div>
          <FormLabel>What are you bringing?</FormLabel>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(
              [
                ["hasVideoIntro", "Video intro"],
                ["hasVideoOutro", "Video outro"],
                ["hasSlides", "Slides"],
                ["hasImages", "Images"],
              ] as const
            ).map(([name, label]) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0 rounded-md border border-border p-2.5">
                    <FormControl>
                      <Checkbox
                        checked={field.value as boolean}
                        onCheckedChange={field.onChange}
                        data-testid={`checkbox-${name}`}
                      />
                    </FormControl>
                    <FormLabel className="font-normal">{label}</FormLabel>
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
                  className="flex flex-col gap-2"
                >
                  <FormItem className="flex items-center gap-2 space-y-0 rounded-md border border-border p-2.5">
                    <FormControl>
                      <RadioGroupItem value="no" data-testid="radio-interviewer-no" />
                    </FormControl>
                    <FormLabel className="font-normal">We're good on our own</FormLabel>
                  </FormItem>
                  <FormItem className="flex items-center gap-2 space-y-0 rounded-md border border-border p-2.5">
                    <FormControl>
                      <RadioGroupItem value="yes" data-testid="radio-interviewer-yes" />
                    </FormControl>
                    <FormLabel className="font-normal">Pair us with an interviewer</FormLabel>
                  </FormItem>
                </RadioGroup>
              </FormControl>
              <FormDescription>We'll follow up to line someone up before air time.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/40 p-4">
          <div>
            <p className="text-sm font-medium">Where can people find your show?</p>
            <p className="text-xs text-muted-foreground">All optional. Anything you add shows up as a link on the public agenda.</p>
          </div>

          <FormField
            control={form.control}
            name="socialLinks"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Website / social link</FormLabel>
                <FormControl>
                  <Input placeholder="instagram.com/yourshow" {...field} data-testid="input-social-links" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="rssUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1.5">
                    <Rss className="h-3.5 w-3.5 text-primary" /> Podcast RSS feed
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="feeds.example.com/yourshow" inputMode="url" {...field} data-testid="input-rss-url" />
                  </FormControl>
                  <FormDescription>Lets listeners subscribe in any podcast app.</FormDescription>
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
                    <Youtube className="h-3.5 w-3.5 text-primary" /> YouTube podcast
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="youtube.com/@yourshow" inputMode="url" {...field} data-testid="input-youtube-url" />
                  </FormControl>
                  <FormDescription>If your show also lives on YouTube.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Anything else? (optional)</FormLabel>
              <FormControl>
                <Textarea rows={2} {...field} data-testid="input-notes" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center gap-2 pt-1">
          <Button type="submit" disabled={mutation.isPending} data-testid="button-save-profile">
            {mutation.isPending ? "Saving…" : "Save profile"}
          </Button>
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={mutation.isPending}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Form>
  );
}
