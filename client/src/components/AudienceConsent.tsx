import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiUpload } from "@/lib/queryClient";
import type { ProfileRow } from "@shared/schema";
import { BarChart3 } from "lucide-react";

// Asking before counting somebody's audience in a sales deck.
//
// They linked these accounts so we could post their clips. Using the same
// handles to pull follower and engagement figures, and putting the total in
// front of a sponsor, is a different purpose — so it is a separate question,
// off until answered, and it says what they get out of saying yes.

export function AudienceConsent({ profile }: { profile: ProfileRow }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: async (on: boolean) => {
      // The profile endpoint validates the whole record, so resend it intact.
      const fd = new FormData();
      const fields: [string, string][] = [
        ["podcastName", profile.podcastName], ["hostName", profile.hostName], ["phone", profile.phone ?? ""],
        ["numPeople", String(profile.numPeople ?? 1)],
        ["hasVideoIntro", String(profile.hasVideoIntro)], ["hasVideoOutro", String(profile.hasVideoOutro)],
        ["hasSlides", String(profile.hasSlides)], ["hasImages", String(profile.hasImages)],
        ["needsInterviewer", String(profile.needsInterviewer)],
        ["shareAudienceStats", String(on)], ["mediaAnswered", String(profile.mediaAnswered)],
        ["socialLinks", profile.socialLinks ?? ""], ["rssUrl", profile.rssUrl ?? ""], ["youtubeUrl", profile.youtubeUrl ?? ""],
        ["showFormat", profile.showFormat || "live"], ["recordingUrl", profile.recordingUrl ?? ""],
        ["introStyle", profile.introStyle || "virtual"], ["branch", profile.branch ?? ""],
        ["serviceStatus", profile.serviceStatus ?? ""], ["recordingMode", profile.recordingMode ?? ""],
        ["postEdits", profile.postEdits ?? ""], ["streamPlatform", profile.streamPlatform ?? ""],
        ["streamPlatformOther", profile.streamPlatformOther ?? ""], ["notes", profile.notes ?? ""],
        ["guests", profile.guests ?? ""], ["interviewQuestions", profile.interviewQuestions ?? ""],
        ["promoNotes", profile.promoNotes ?? ""],
      ];
      for (const [k, v] of fields) fd.append(k, v);
      return (await apiUpload("PUT", "/api/host/profile", fd)).json();
    },
    onSuccess: (_d, on) => {
      queryClient.invalidateQueries({ queryKey: ["/api/host/profile"] });
      toast({
        title: on ? "Counted in the sponsor figures" : "Left out of the sponsor figures",
        description: on
          ? "Thank you — a bigger combined number is what gets the event funded."
          : "Your accounts still work for posting clips. Nothing else changes.",
      });
    },
    onError: (err: Error) => toast({ title: "Couldn't save that", description: err.message, variant: "destructive" }),
  });

  return (
    <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-muted/20 p-4">
      <Switch
        checked={profile.shareAudienceStats}
        disabled={save.isPending}
        onCheckedChange={(v) => save.mutate(v === true)}
        className="mt-0.5"
        data-testid="switch-audience-consent"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <BarChart3 className="h-3.5 w-3.5 text-primary" /> Count me in
        </span>
        <span className="mt-1 block text-sm text-muted-foreground">
          Add my follower numbers to the event's combined total. Sponsors fund the production everyone here uses,
          and they buy audience — a bigger honest number gets more of them. Your figures are shown as part of a total,
          never as a list of names, and you can switch this off whenever you like.
        </span>
      </span>
    </label>
  );
}
