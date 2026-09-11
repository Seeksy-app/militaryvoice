import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { detectLocalTimeZone } from "@/lib/schedule";
import { Share2, BellRing, Check, CalendarPlus, Rss, Youtube } from "lucide-react";
import type { PublicSignup } from "@shared/schema";

interface Props {
  signup: PublicSignup;
  shareText: string;
}

/**
 * Listener actions on a booked card: Share, and one "Remind me" that collects
 * name + email (+ optional phone for a text). The confirmation email carries
 * Google / Outlook / Apple add-to-calendar links, so no app is required here.
 */
export function AgendaSignupActions({ signup, shareText }: Props) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);

  const reminderMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reminders", {
        signupId: signup.id,
        name,
        email,
        phone,
        timezone: detectLocalTimeZone(),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "You're set",
        description: `Check your email — it has add-to-calendar links for ${signup.podcastName}'s slot.`,
      });
      setTimeout(() => setPopoverOpen(false), 900);
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

  const canSubmit = name.trim().length > 0 && /\S+@\S+\.\S+/.test(email);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" className="h-8 gap-1.5 rounded-full px-3 text-xs" data-testid={`button-notify-${signup.id}`}>
            <BellRing className="h-3.5 w-3.5" /> Remind me
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80" align="start">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) reminderMutation.mutate();
            }}
            className="flex flex-col gap-3"
          >
            <div>
              <p className="text-sm font-semibold">Get a heads-up before this one goes live</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                We'll email you before <span className="font-medium text-foreground">{signup.podcastName}</span> starts, with
                add-to-calendar links for Google, Outlook, and Apple.
              </p>
            </div>
            <div className="grid gap-2">
              <div>
                <Label htmlFor={`rem-name-${signup.id}`} className="text-xs">
                  Your name
                </Label>
                <Input
                  id={`rem-name-${signup.id}`}
                  required
                  placeholder="Jamie Rivera"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 h-9"
                  data-testid={`input-reminder-name-${signup.id}`}
                />
              </div>
              <div>
                <Label htmlFor={`rem-email-${signup.id}`} className="text-xs">
                  Email
                </Label>
                <Input
                  id={`rem-email-${signup.id}`}
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 h-9"
                  data-testid={`input-reminder-email-${signup.id}`}
                />
              </div>
              <div>
                <Label htmlFor={`rem-phone-${signup.id}`} className="text-xs">
                  Mobile <span className="font-normal text-muted-foreground">(optional, for a text reminder)</span>
                </Label>
                <Input
                  id={`rem-phone-${signup.id}`}
                  type="tel"
                  inputMode="tel"
                  placeholder="(555) 555-5555"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 h-9"
                  data-testid={`input-reminder-phone-${signup.id}`}
                />
              </div>
            </div>
            <Button type="submit" size="sm" disabled={reminderMutation.isPending || !canSubmit} className="gap-1.5 rounded-full">
              {reminderMutation.isSuccess ? (
                <>
                  <Check className="h-3.5 w-3.5" /> You're set
                </>
              ) : reminderMutation.isPending ? (
                "Saving…"
              ) : (
                <>
                  <CalendarPlus className="h-3.5 w-3.5" /> Remind me
                </>
              )}
            </Button>
            <p className="text-[11px] text-muted-foreground">One email before the show. No lists, no spam.</p>
          </form>
        </PopoverContent>
      </Popover>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 rounded-full px-3 text-xs"
        onClick={handleShare}
        data-testid={`button-share-${signup.id}`}
      >
        <Share2 className="h-3.5 w-3.5" /> Share
      </Button>

      {signup.youtubeUrl && (
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" asChild data-testid={`link-youtube-${signup.id}`}>
          <a href={signup.youtubeUrl} target="_blank" rel="noopener noreferrer">
            <Youtube className="h-3.5 w-3.5 text-[#FF0000]" /> YouTube
          </a>
        </Button>
      )}
      {signup.rssUrl && (
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" asChild data-testid={`link-rss-${signup.id}`}>
          <a href={signup.rssUrl} target="_blank" rel="noopener noreferrer">
            <Rss className="h-3.5 w-3.5 text-[#F0A71F]" /> Subscribe
          </a>
        </Button>
      )}
    </div>
  );
}
