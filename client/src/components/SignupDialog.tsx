import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiUpload } from "@/lib/queryClient";
import { insertSignupSchema } from "@shared/schema";
import { formatDateInZone, formatTimeInZone, zoneLabel } from "@/lib/schedule";
import { Camera, ImagePlus, X } from "lucide-react";

const formSchema = insertSignupSchema.extend({
  needsInterviewer: z.boolean(),
});
type FormValues = z.infer<typeof formSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slotIndex: number | null;
  start: Date | null;
  end: Date | null;
  viewZone: string;
}

export function SignupDialog({ open, onOpenChange, slotIndex, start, end, viewZone }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

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
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      slotIndex: slotIndex ?? 0,
      podcastName: "",
      hostName: "",
      email: "",
      phone: "",
      numPeople: 1,
      hasVideoIntro: false,
      hasVideoOutro: false,
      hasSlides: false,
      hasImages: false,
      needsInterviewer: false,
      socialLinks: "",
      notes: "",
      timezone: viewZone,
      photoUrl: "pending",
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        slotIndex: slotIndex ?? 0,
        podcastName: "",
        hostName: "",
        email: "",
        phone: "",
        numPeople: 1,
        hasVideoIntro: false,
        hasVideoOutro: false,
        hasSlides: false,
        hasImages: false,
        needsInterviewer: false,
        socialLinks: "",
        notes: "",
        timezone: viewZone,
        photoUrl: "pending",
      });
      handlePhotoChange(null);
      setPhotoError(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slotIndex, viewZone]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!photoFile) {
        throw new Error("A photo is required — give us the best one you've got.");
      }
      const formData = new FormData();
      formData.append("slotIndex", String(values.slotIndex));
      formData.append("podcastName", values.podcastName);
      formData.append("hostName", values.hostName);
      formData.append("email", values.email);
      formData.append("phone", values.phone ?? "");
      formData.append("numPeople", String(values.numPeople));
      formData.append("hasVideoIntro", String(values.hasVideoIntro));
      formData.append("hasVideoOutro", String(values.hasVideoOutro));
      formData.append("hasSlides", String(values.hasSlides));
      formData.append("hasImages", String(values.hasImages));
      formData.append("needsInterviewer", String(values.needsInterviewer));
      formData.append("socialLinks", values.socialLinks ?? "");
      formData.append("notes", values.notes ?? "");
      formData.append("timezone", values.timezone ?? "");
      formData.append("photo", photoFile);
      const res = await apiUpload("POST", "/api/signups", formData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signups"] });
      toast({ title: "You're on the schedule", description: "This slot is now yours — we'll be in touch before air time." });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't claim that slot", description: err.message, variant: "destructive" });
    },
  });

  function handleSubmit(values: FormValues) {
    if (!photoFile) {
      setPhotoError("A photo is required — give us the best one you've got.");
      return;
    }
    mutation.mutate(values);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Claim your slot</DialogTitle>
          <DialogDescription>
            {start && end
              ? `${formatDateInZone(start, viewZone)}, ${formatTimeInZone(start, viewZone)} – ${formatTimeInZone(
                  end,
                  viewZone
                )} (${zoneLabel(viewZone)})`
              : "Pick a time to appear on the marathon."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="flex flex-col gap-4" data-testid="form-signup">
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
                  {photoPreview ? (
                    <img src={photoPreview} alt="Your selected photo" className="h-full w-full object-cover" />
                  ) : (
                    <Camera className="h-6 w-6 text-muted-foreground transition-colors group-hover:text-primary" />
                  )}
                </button>
                <div className="flex flex-col gap-1.5">
                  <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => fileInputRef.current?.click()}>
                    <ImagePlus className="h-3.5 w-3.5" />
                    {photoFile ? "Change photo" : "Upload photo"}
                  </Button>
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
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="you@example.com" {...field} data-testid="input-email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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

            <FormField
              control={form.control}
              name="socialLinks"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Website / social link (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="instagram.com/yourshow" {...field} data-testid="input-social-links" />
                  </FormControl>
                  <FormDescription>We'll credit this on the public agenda.</FormDescription>
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
                    <Textarea rows={2} {...field} data-testid="input-notes" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-submit-signup">
                {mutation.isPending ? "Claiming…" : "Claim slot"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
