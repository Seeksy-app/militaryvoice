import type { Response } from "express";
import { storage } from "./storage.js";

// Social on the free Growth plan is a 30-day trial (Andrew, 21 Nov 2026: "free cannot do their social media. They can
// do 30 days free on it, but after 30 days ... they have to upgrade"). Upload-Post bills per connected profile.
//
// - Starts on their first Connect (setting social-trial:<email> = {"start": ISO}).
// - Accounts that already had an Upload-Post profile when this shipped get 30 days from SHIPPED_AT, not their old date.
// - Not counted at all: any plan subscription that's on (Scale, Pro, comp plans, Founding trials, past_due), the test
//   accounts (POST_TESTERS), admins, and production-package customers (package:<email> on).
// - After day 30: connect, post and schedule answer 402 with OVER_MESSAGE. Nothing already scheduled is touched here,
//   and no Upload-Post profile is deleted.

export const SOCIAL_TRIAL_DAYS = 30;
const SHIPPED_AT = "2026-11-21T05:00:00.000Z"; // Sat 21 Nov 2026, 00:00 ET
export const OVER_MESSAGE = "Your 30 days of free social posting are over. Upgrade to Scale or Pro to keep posting.";

export type SocialTrial = { free: boolean; startedAt: string | null; endsAt: string | null; daysLeft: number | null; over: boolean };
const NOT_FREE: SocialTrial = { free: false, startedAt: null, endsAt: null, daysLeft: null, over: false };

const key = (email: string) => `social-trial:${email}`;
const testers = () => new Set((process.env.POST_TESTERS || "marineocsblog@gmail.com").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));

async function exempt(email: string): Promise<boolean> {
  if (testers().has(email)) return true;
  const sub = await storage.getSubscription(email);
  if (sub && ["active", "trialing", "past_due"].includes(sub.status)) return true;
  if ((await storage.listAdmins()).some((a) => a.email.trim().toLowerCase() === email)) return true;
  try { if ((JSON.parse((await storage.getSetting(`package:${email}`)) ?? "{}") as { on?: boolean }).on) return true; } catch { /* not a package */ }
  return false;
}

/** Where this person's free social stands. `start` (Connect) begins the 30 days if they haven't begun. */
export async function socialTrial(emailIn: string, o: { start?: boolean } = {}): Promise<SocialTrial> {
  const email = emailIn.trim().toLowerCase();
  if (!email || (await exempt(email))) return NOT_FREE;
  let start: string | null = null;
  try { start = (JSON.parse((await storage.getSetting(key(email))) ?? "{}") as { start?: string }).start ?? null; } catch { /* unreadable: treat as none */ }
  if (!start) {
    const profile = await storage.getProfileByEmail(email);
    if (profile?.uploadPostUsername) start = SHIPPED_AT; // connected before this shipped
    else if (o.start) start = new Date().toISOString();
    if (start && o.start) await storage.setSetting(key(email), JSON.stringify({ start, via: profile?.uploadPostUsername ? "existing" : "connect" }));
  }
  if (!start) return { free: true, startedAt: null, endsAt: null, daysLeft: SOCIAL_TRIAL_DAYS, over: false };
  const ends = Date.parse(start) + SOCIAL_TRIAL_DAYS * 86400_000;
  const left = Math.max(0, Math.ceil((ends - Date.now()) / 86400_000));
  return { free: true, startedAt: start, endsAt: new Date(ends).toISOString(), daysLeft: left, over: Date.now() >= ends };
}

/** For connect, post and schedule routes: true (and a 402 already sent) when their free 30 days are over. */
export async function socialBlocked(email: string, res: Response, o: { start?: boolean } = {}): Promise<boolean> {
  const t = await socialTrial(email, o);
  if (!t.over) return false;
  res.status(402).json({ message: OVER_MESSAGE, trial: t, upgrade: "/pricing" });
  return true;
}
