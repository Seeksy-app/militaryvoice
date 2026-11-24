// Out of credits (Andrew, 24 Nov: "if someone runs out of credits they are alerted and asked to
// purchase more or upgrade. this includes Riccoh. But not my accounts"). When a spend leaves
// someone at 0 or a spend is refused, they get one email and one dashboard notice, at most once
// a month. The email text is the one Andrew approved; only the name and the links are filled in.
import { siteSettings } from "../shared/schema.js";
import { db, storage } from "./storage.js";
import { setNotice } from "./notices.js";
import { sendOneOffEmail } from "./email.js";

const SITE = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");

/**
 * Accounts that never get the alert: Andrew's own and the test ones (OCS, the Veteran Benefits
 * Podcast, show 15). Who is charged doesn't change here: OCS is unlimited through POST_TESTERS.
 * CREDIT_EXEMPT in Vercel adds more, comma-separated.
 */
const DEFAULT_EXEMPT = ["marineocsblog@gmail.com", "hello@yourvabenefits.com", "andrew@workready360.com", "andrew@smartloads.io"];
export function creditExempt(email: string): boolean {
  const e = email.trim().toLowerCase();
  const extra = (process.env.CREDIT_EXEMPT || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return DEFAULT_EXEMPT.includes(e) || extra.includes(e);
}

/**
 * Whether a monthly plan still has room for extra credits (they go on the next bill). Then
 * nothing waits, so the email would be wrong: routes.ts hands the check in, since the plan
 * rules live there.
 */
let extrasRoom: ((email: string) => Promise<boolean>) | null = null;
export function setExtrasRoom(fn: (email: string) => Promise<boolean>) { extrasRoom = fn; }

/** The page that opens the plans and credit packs (PostStudio reads ?credits). */
export const creditsLink = (what: "packs" | "plans") => `${SITE}/host/dashboard/postify?credits=${what}`;

export function outOfCreditsEmail(first: string): { subject: string; text: string } {
  return {
    subject: "You're out of Pōstify credits",
    text: [
      `Hi ${first || "there"},`,
      "",
      "You've used all your Pōstify credits, so new episodes will wait in your Library until you top up. Nothing you've made is lost.",
      "",
      "Two ways to keep going:",
      `1. Add a credit pack: ${creditsLink("packs")}`,
      `2. Move up a plan for more credits every month: ${creditsLink("plans")}`,
      "",
      "The MilitaryVoices.ai team",
    ].join("\n"),
  };
}

async function firstName(email: string): Promise<string> {
  const p = await storage.getProfileByEmail(email).catch(() => undefined);
  const first = (p?.hostName ?? "").trim().split(/\s+/)[0] ?? "";
  return /^[A-Za-z][A-Za-z'’-]{1,}$/.test(first) ? first : "";
}

/**
 * Tell them, once this month. Safe to call after any spend or refusal: it checks the exempt
 * list, that they really are at 0 (and have no extras left on a plan), and the month's mark.
 * Never throws. CREDITS_ALERT_DRY=1 logs instead of sending (for tests).
 */
export async function outOfCredits(email: string): Promise<"sent" | "skipped"> {
  try {
    const e = email.trim().toLowerCase();
    if (!e || creditExempt(e)) return "skipped";
    if ((await storage.tokenBalance(e)) > 0) return "skipped";
    if (extrasRoom && (await extrasRoom(e))) return "skipped";
    // The month's mark, taken before sending, so two spends at once send one email.
    const month = new Date().toISOString().slice(0, 7);
    const claimed = await db.insert(siteSettings).values({ key: `credits-alert:${e}:${month}`, value: new Date().toISOString() }).onConflictDoNothing().returning({ key: siteSettings.key });
    if (!claimed.length) return "skipped";
    await setNotice(e, {
      kind: "credits",
      title: "You're out of Pōstify credits",
      body: "New episodes will wait in your Library until you top up. Nothing you've made is lost.",
      at: new Date().toISOString(),
    });
    const first = await firstName(e);
    const mail = outOfCreditsEmail(first);
    if (process.env.CREDITS_ALERT_DRY === "1") {
      console.log(`[credits-alert dry run] to ${e}: ${mail.subject}\n${mail.text}`);
      return "sent";
    }
    // From hello@ (the default sender), plain text, logged in Mail like every email.
    await sendOneOffEmail({ to: e, subject: mail.subject, html: "", text: mail.text, kind: "credits-out", recipientName: first });
    return "sent";
  } catch (err) {
    console.error("Out-of-credits alert failed:", (err as Error).message);
    return "skipped";
  }
}
