// Black Friday 2026 (Founding Members): counted links for the promotion, so "where did the sign-ups come from"
// has one answer. Every post, email and card links to /go/bf?src=<channel> (counted, then on to /black-friday),
// and the page's button goes through /go/bf/start?src=<channel> (counted, then on to sign-up).
//
// Clicks are kept in sponsor_clicks with sponsor id 0 (our own promotion, not a sponsor) and source
// "bf:<step>:<src>", so no new table is needed. Sponsor reports read real sponsor ids only, so 0 never shows there.
import type { Express, RequestHandler } from "express";
import { and, eq, like, sql } from "drizzle-orm";
import { db, storage } from "./storage.js";
import { sponsorClicks } from "../shared/schema.js";

const PROMO_ID = 0;
const STEPS: Record<string, string> = { page: "/black-friday", start: "/host/dashboard?start" };
const clean = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "").slice(0, 20) || "link";

export function registerPromo(app: Express, requireAdmin: RequestHandler): void {
  /** /go/bf?src=li → counted → /black-friday?src=li.  /go/bf/start?src=li → counted → sign-up. */
  app.get(["/go/bf", "/go/bf/:step"], (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const step = req.params.step === "start" ? "start" : "page";
    const src = clean(req.query.src);
    storage.recordSponsorClick(PROMO_ID, `bf:${step}:${src}`, String(req.get("referer") ?? ""), String(req.get("user-agent") ?? "")).catch(() => {});
    const to = STEPS[step];
    res.redirect(302, step === "page" ? `${to}?src=${encodeURIComponent(src)}` : to);
  });

  /** Clicks so far, by step and channel. */
  app.get("/api/admin/promo/bf", requireAdmin, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const rows = await db
      .select({ source: sponsorClicks.source, n: sql<number>`count(*)::int` })
      .from(sponsorClicks)
      .where(and(eq(sponsorClicks.sponsorId, PROMO_ID), like(sponsorClicks.source, "bf:%")))
      .groupBy(sponsorClicks.source);
    res.json({ clicks: rows.map((r) => { const [, step, src] = r.source.split(":"); return { step, src, n: r.n }; }) });
  });
}
