import { Bell, BellOff, Check, Loader2 } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { usePush } from "@/lib/push";

/** In the account menu: notifications on this device, on or off. Nothing when the browser can't. */
export function NotificationsMenuItem() {
  const { toast } = useToast();
  const push = usePush();
  if (push.state === "loading" || push.state === "unavailable") return null;
  const on = push.state === "on";
  return (
    <DropdownMenuItem
      onSelect={(e) => {
        e.preventDefault();
        if (push.state === "needs-app") return toast({ title: "Add the app first", description: "On iPhone and iPad, notifications work in the app: Share, then Add to Home Screen. Open it from there and turn them on." });
        if (push.state === "blocked") return toast({ title: "Notifications are blocked", description: "Allow them for militaryvoices.ai in your browser's site settings, then try again." });
        void (on ? push.disable() : push.enable().then((ok) => ok && toast({ title: "Notifications are on", description: "We'll tell you when your clips and episodes are ready." })));
      }}
      className="gap-2"
      data-testid="account-notifications"
    >
      {push.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : on ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
      Notifications
      <span className="ml-auto text-xs text-muted-foreground">{on ? <Check className="h-4 w-4 text-foreground" /> : "Off"}</span>
    </DropdownMenuItem>
  );
}

/** While Pōstify works: one tap to be told when it's done. Gone once they're on (or where they can't be). */
export function NotifyPrompt({ what = "your clips are" }: { what?: string }) {
  const { toast } = useToast();
  const push = usePush();
  if (push.state !== "off" && push.state !== "needs-app") return null;
  return (
    <button
      type="button"
      onClick={() => {
        if (push.state === "needs-app") return toast({ title: "Add the app first", description: "On iPhone and iPad, notifications work in the app: Share, then Add to Home Screen." });
        void push.enable().then((ok) => ok && toast({ title: "We'll tell you", description: `You'll get a notification when ${what} ready.` }));
      }}
      disabled={push.busy}
      className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/20"
      data-testid="notify-prompt"
    >
      {push.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />} Tell me when {what} ready
    </button>
  );
}
