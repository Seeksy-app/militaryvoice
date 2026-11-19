// Black Friday 2026: Founding Members. Podcasters who join in 2026 are the founding group; until the end of
// December 31, 2026 (Eastern) a first Scale plan comes with 30 days free (Stripe's own trial, card at checkout).
//
// Counted links: every post, email and card links to /go/bf?src=<channel> (counted, then on to /black-friday).
// The page reports its own steps (join, code, signedin, checkout) to POST /api/promo/bf, so each channel has a funnel.
// Clicks are kept in sponsor_clicks with sponsor id 0 (our own promotion, not a sponsor) and source
// "bf:<step>:<src>", so no new table is needed. Sponsor reports read real sponsor ids only, so 0 never shows there.
//
// Founding Members: setting "founding:<email>" = { at, via }, set when they sign in on the page or start the trial.
import type { Express, RequestHandler } from "express";
import { and, eq, like, sql } from "drizzle-orm";
import { db, storage } from "./storage.js";
import { requireHostSession, getSessionEmail } from "./session.js";
import { createPlanCheckout, hadPlanSubscription, stripeReady } from "./stripe.js";
import { siteSettings, sponsorClicks } from "../shared/schema.js";
import { FOUNDING, foundingOpen, planOf, type PlanKey } from "../shared/tokens.js";

const PROMO_ID = 0;
const STEPS = new Set(["page", "start", "join", "code", "signedin", "checkout"]);
const clean = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "").slice(0, 20) || "link";
const LIVE = ["active", "trialing", "past_due"];

function count(step: string, src: string, req: { get(h: string): string | undefined }): void {
  storage.recordSponsorClick(PROMO_ID, `bf:${step}:${clean(src)}`, String(req.get("referer") ?? ""), String(req.get("user-agent") ?? "")).catch(() => {});
}

async function markFounding(email: string, via: string): Promise<boolean> {
  const key = `founding:${email}`;
  if (await storage.getSetting(key)) return true;
  if (!foundingOpen()) return false;
  await storage.setSetting(key, JSON.stringify({ at: new Date().toISOString(), via }));
  return true;
}

/** Where this person stands with the offer. */
async function standing(email: string): Promise<{ member: boolean; plan: string | null; eligible: boolean; reason: string }> {
  const [mark, sub] = await Promise.all([storage.getSetting(`founding:${email}`), storage.getSubscription(email)]);
  const live = sub && LIVE.includes(sub.status) ? planOf(sub.plan)?.name ?? "a plan" : null;
  if (live) return { member: Boolean(mark), plan: live, eligible: false, reason: "plan" };
  if (!foundingOpen()) return { member: Boolean(mark), plan: null, eligible: false, reason: "closed" };
  // One trial per person: any plan before, here or in Stripe, and the 30 days free has been had.
  if (sub) return { member: Boolean(mark), plan: null, eligible: false, reason: "had-plan" };
  const before = await hadPlanSubscription(email).catch(() => false);
  return { member: Boolean(mark), plan: null, eligible: !before, reason: before ? "had-plan" : "" };
}

export function registerPromo(app: Express, requireAdmin: RequestHandler): void {
  /** /go/bf?src=li → counted → /black-friday?src=li. (/go/bf/start, from the first version, lands on the sign-up box.) */
  app.get(["/go/bf", "/go/bf/:step"], (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const src = clean(req.query.src);
    const step = req.params.step === "start" ? "start" : "page";
    count(step, src, req);
    res.redirect(302, `/black-friday?src=${encodeURIComponent(src)}${step === "start" ? "#join" : ""}`);
  });

  /** The page's own steps, for the funnel. */
  app.post("/api/promo/bf", (req, res) => {
    const step = String(req.body?.step ?? "");
    if (STEPS.has(step) && step !== "page" && step !== "start") count(step, String(req.body?.src ?? ""), req);
    res.json({ ok: true });
  });

  /** Signed in: are they a Founding Member, on a plan, and can they have the 30 days free? */
  app.get("/api/host/founding", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const email = (getSessionEmail(req) ?? "").trim().toLowerCase();
    res.json({ open: foundingOpen(), endsLabel: FOUNDING.endsLabel, ...(await standing(email)) });
  });

  /** Joined from the page: they're a Founding Member (while the offer is open). */
  app.post("/api/host/founding/join", requireHostSession, async (req, res) => {
    const email = (getSessionEmail(req) ?? "").trim().toLowerCase();
    await markFounding(email, "page");
    res.json({ open: foundingOpen(), endsLabel: FOUNDING.endsLabel, ...(await standing(email)) });
  });

  /** Scale with the first 30 days free: Stripe Checkout with a trial, card taken there. */
  app.post("/api/host/founding/checkout", requireHostSession, async (req, res) => {
    const email = (getSessionEmail(req) ?? "").trim().toLowerCase();
    if (!stripeReady()) return res.status(503).json({ message: "Payments aren't switched on yet. Try again soon." });
    const s = await standing(email);
    if (!s.eligible) {
      const message = s.reason === "plan" ? `You're already on ${s.plan}.` : s.reason === "closed" ? `The Founding Members offer ended on ${FOUNDING.endsLabel}.` : "The 30 days free is for a first plan, and you've had one before. Scale is on the Pricing page.";
      return res.status(409).json({ message, reason: s.reason });
    }
    try {
      await markFounding(email, "trial");
      const sub = await storage.getSubscription(email);
      const origin = (process.env.PUBLIC_ORIGIN || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
      const url = await createPlanCheckout({ email, plan: FOUNDING.plan as PlanKey, interval: "month", origin, customerId: sub?.customerId || undefined, trialDays: FOUNDING.trialDays, cohort: FOUNDING.cohort, cancelPath: "/black-friday" });
      count("checkout", String(req.body?.src ?? ""), req);
      res.json({ url });
    } catch (err) {
      console.error("Founding checkout failed:", (err as Error).message);
      res.status(502).json({ message: "Checkout didn't open. Try again in a moment." });
    }
  });

  /** The funnel so far, by step and channel, and how many Founding Members. */
  app.get("/api/admin/promo/bf", requireAdmin, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const rows = await db
      .select({ source: sponsorClicks.source, n: sql<number>`count(*)::int` })
      .from(sponsorClicks)
      .where(and(eq(sponsorClicks.sponsorId, PROMO_ID), like(sponsorClicks.source, "bf:%")))
      .groupBy(sponsorClicks.source);
    const [m] = await db.select({ n: sql<number>`count(*)::int` }).from(siteSettings).where(like(siteSettings.key, "founding:%"));
    const members = Number(m?.n ?? 0);
    res.json({ members, clicks: rows.map((r) => { const [, step, src] = r.source.split(":"); return { step, src, n: r.n }; }) });
  });
}
