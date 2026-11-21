/**
 * Founding Members 2026: our own "your free days end soon" email (Andrew, 20 Nov 2026), in place of
 * Stripe's trial reminder (off: the shared Stripe account names another company). 7 days before a
 * Founding Member's Scale trial ends, Alex writes once from hello@ with the date, the price after and
 * the way to Plan & billing. Run by the 5-minute outbox cron.
 *
 * Nothing goes until Andrew approves the exact text: setting founding-reminder:go = "yes".
 * Test-flagged Founding marks are skipped. Each trial is reminded once (setting founding-reminded:<sub id>).
 */
import { and, gt, inArray, eq, lte } from "drizzle-orm";
import { db, storage } from "./storage.js";
import { emailShell, EMAIL_BANNERS, sendOneOffEmail } from "./email.js";
import { postifySubscriptions } from "../shared/schema.js";
import { FOUNDING, PLANS } from "../shared/tokens.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const DAYS_BEFORE = 7;

const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });

/** The email, for one trial ending on endsAt. */
export function foundingReminderEmail(endsAt: string, planKey: string = FOUNDING.plan): { subject: string; html: string; text: string } {
  const pro = planKey === "pro";
  const plan = pro ? PLANS.pro : PLANS.creator;
  const date = longDate(endsAt);
  const price = pro ? `$${(PLANS.pro.quarterCents / 100).toFixed(2)} every 3 months` : `$${(plan.cents / 100).toFixed(2)} a month`;
  const billing = `${ORIGIN}/host/dashboard/billing`;
  const subject = `Your 30 free days of ${plan.name} end on ${date}`;
  const lines = [
    `Thank you for being a Founding Member of MilitaryVoices.ai.`,
    pro
      ? `Your 30 free days of ${plan.name} end on ${date}. After that, ${plan.name} is ${price} on the card you added, with ${plan.credits * 3} credits each time.`
      : `Your 30 free days of ${plan.name} end on ${date}. After that, ${plan.name} is ${price} on the card you added, with ${plan.credits} credits every month.`,
    `Nothing to do if you'd like to stay. To change your plan or cancel before you're charged, open Plan & billing.`,
  ];
  const html = emailShell({
    banner: EMAIL_BANNERS.podcasters,
    bannerAlt: "MilitaryVoices.ai",
    eyebrow: "Founding Members 2026",
    heading: `Your free days end on ${date}`,
    body: lines.map((l) => `<p style="margin:0 0 16px;">${l}</p>`).join(""),
    cta: { href: billing, label: "Open Plan & billing" },
    secondary: `<p style="margin:16px 0 0;">Questions? Just reply. I'm here.<br>Alex, MilitaryVoices.ai</p>`,
    preheader: `Then ${price}. Change or cancel any time in Plan & billing.`,
  });
  const text = [...lines.flatMap((l) => [l, ""]), `Plan & billing: ${billing}`, "", "Questions? Just reply. I'm here.", "Alex, MilitaryVoices.ai"].join("\n");
  return { subject, html, text };
}

/** From the outbox cron: remind every Founding trial that ends within 7 days, once. */
export async function sendFoundingReminders(): Promise<number> {
  if ((await storage.getSetting("founding-reminder:go")) !== "yes") return 0;
  // Pro's wording ("every 3 months") has its own go, founding-reminder:pro-go = "yes"; until then Pro trials aren't reminded.
  const plans = (await storage.getSetting("founding-reminder:pro-go")) === "yes" ? ["creator", "pro"] : ["creator"];
  const now = new Date();
  const soon = new Date(now.getTime() + DAYS_BEFORE * 86_400_000).toISOString();
  const due = await db.select().from(postifySubscriptions).where(and(
    eq(postifySubscriptions.status, "trialing"), inArray(postifySubscriptions.plan, plans),
    gt(postifySubscriptions.periodEnd, now.toISOString()), lte(postifySubscriptions.periodEnd, soon),
  ));
  let sent = 0;
  for (const s of due) {
    const mark = await storage.getSetting(`founding:${s.email}`);
    if (!mark) continue;
    try { if (JSON.parse(mark)?.test) continue; } catch { /* an old plain mark: a real member */ }
    const key = `founding-reminded:${s.subscriptionId || s.email}`;
    if (await storage.getSetting(key)) continue;
    // Claim it first, so two cron runs can't both send it.
    await storage.setSetting(key, JSON.stringify({ at: now.toISOString(), state: "sending" }));
    const m = foundingReminderEmail(s.periodEnd, s.plan);
    try {
      const id = await sendOneOffEmail({ to: s.email, ...m, kind: "founding-trial-ending" });
      await storage.setSetting(key, JSON.stringify({ at: now.toISOString(), state: id ? "sent" : "failed", endsAt: s.periodEnd }));
      if (id) sent++;
    } catch (err) {
      await storage.setSetting(key, JSON.stringify({ at: now.toISOString(), state: "failed", error: String((err as Error).message).slice(0, 200) }));
    }
  }
  return sent;
}
