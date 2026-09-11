import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, API_BASE } from "@/lib/queryClient";
import { Share2, CalendarPlus, BellRing, Check, Rss, Youtube } from "lucide-react";
import type { PublicSignup } from "@shared/schema";

interface Props {
  signup: PublicSignup;
  shareText: string;
}

export function AgendaSignupActions({ signup, shareText }: Props) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);

  const reminderMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reminders", { signupId: signup.id, email });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "You're set", description: `We've saved your email for ${signup.podcastName}'s slot.` });
      setPopoverOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't save that", description: err.message, variant: "destructive" });
    },
  });

  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({ text: shareText });
        return;
      } catch {
        // user cancelled the native share sheet — fall through to clipboard copy
      }
    }
    navigator.clipboard.writeText(shareText).then(
      () => toast({ title: "Copied to share", description: "Paste it anywhere — socials, texts, group chats." }),
      () => toast({ title: "Couldn't copy", variant: "destructive" })
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {signup.youtubeUrl && (
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" asChild data-testid={`link-youtube-${signup.id}`}>
          <a href={signup.youtubeUrl} target="_blank" rel="noopener noreferrer">
            <Youtube className="h-3 w-3" /> YouTube
          </a>
        </Button>
      )}
      {signup.rssUrl && (
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" asChild data-testid={`link-rss-${signup.id}`}>
          <a href={signup.rssUrl} target="_blank" rel="noopener noreferrer">
            <Rss className="h-3 w-3" /> Subscribe
          </a>
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        onClick={handleShare}
        data-testid={`button-share-${signup.id}`}
      >
        <Share2 className="h-3 w-3" /> Share
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        asChild
        data-testid={`button-calendar-${signup.id}`}
      >
        <a href={`${API_BASE}/api/signups/${signup.id}/calendar.ics`} download>
          <CalendarPlus className="h-3 w-3" /> Remind me
        </a>
      </Button>

      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            data-testid={`button-notify-${signup.id}`}
          >
            <BellRing className="h-3 w-3" /> I want to watch this one
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="start">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) reminderMutation.mutate();
            }}
            className="flex flex-col gap-2"
          >
            <p className="text-sm font-medium">Drop your email for a reminder before this one goes live</p>
            <Input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid={`input-reminder-email-${signup.id}`}
            />
            <Button type="submit" size="sm" disabled={reminderMutation.isPending} className="gap-1.5">
              {reminderMutation.isSuccess ? (
                <>
                  <Check className="h-3.5 w-3.5" /> Saved
                </>
              ) : reminderMutation.isPending ? (
                "Saving…"
              ) : (
                "Notify me"
              )}
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  );
}
