import { useState } from "react";
import { UpgradeDialog } from "@/components/PostStudio";

/**
 * Free social posting on the Growth plan is 30 days (Andrew, 21 Nov 2026). The server sends this on
 * GET /api/host/social as `trial` (server/socialTrial.ts). `free` is false on Scale, Pro and every other
 * plan, and then nothing here shows at all.
 */
export type SocialTrial = { free: boolean; startedAt: string | null; endsAt: string | null; daysLeft: number | null; over: boolean };

export const SOCIAL_UPGRADE_NOTE = "Upgrade to Scale or Pro to keep posting to your socials.";

/** True when posting, scheduling or connecting should open the plans instead. */
export const socialLocked = (t?: SocialTrial | null) => !!t?.free && t.over;

/**
 * The one line under a Social header on a free account:
 * - before the first connection: "Free for 30 days"
 * - during: "12 days of free posting left · Upgrade"
 * - after: "Your 30 days of free posting are over · Upgrade"
 */
export function SocialTrialLine({ trial, onUpgrade, className = "" }: { trial?: SocialTrial | null; onUpgrade: () => void; className?: string }) {
  if (!trial?.free) return null;
  const upgrade = (
    <button type="button" onClick={onUpgrade} className="font-semibold text-[#053877] hover:underline dark:text-[#8ab4f8]" data-testid="social-trial-upgrade">
      Upgrade
    </button>
  );
  const text = trial.over
    ? "Your 30 days of free posting are over"
    : !trial.startedAt
      ? "Free for 30 days"
      : `${trial.daysLeft ?? 0} ${trial.daysLeft === 1 ? "day" : "days"} of free posting left`;
  return (
    <p className={`text-xs ${trial.over ? "text-[#b42318] dark:text-[#fda29b]" : "text-muted-foreground"} ${className}`} data-testid="social-trial">
      {text}
      {trial.startedAt || trial.over ? <> · {upgrade}</> : null}
    </p>
  );
}

/** The server's answer once the free days are over: 402 with the trial in the body (server/socialTrial.ts).
    A 402 without it is something else (out of credits) and keeps its own message. */
export const isSocialLocked402 = (e: unknown) => {
  const x = e as { status?: number; body?: { trial?: unknown } } | null;
  return x?.status === 402 && !!x.body?.trial;
};

/** The plans dialog with the posting note, and a way to open it. */
export function useSocialUpgrade() {
  const [open, setOpen] = useState(false);
  return {
    open: () => setOpen(true),
    dialog: <UpgradeDialog open={open} onOpenChange={setOpen} note={SOCIAL_UPGRADE_NOTE} />,
  };
}
