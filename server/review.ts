import crypto from "node:crypto";
import type { Express } from "express";
import { storage } from "./storage.js";
import { setSessionCookie } from "./session.js";
import { REVIEW_EMAIL } from "../shared/review.js";

/**
 * App-review sign-in. Marketplace reviewers need a username and password; our
 * podcasters sign in with an emailed code. So one fixed account signs in with
 * a password from ZOOM_REVIEW_PASSWORD (set in Vercel, given to the reviewer
 * in the submission form). Off when that isn't set. The account is set up as
 * a podcaster so the dashboard opens straight in, and is kept off the lineup.
 */
const tries = new Map<string, { n: number; at: number }>();

export function registerReview(app: Express): void {
  app.post("/api/review/login", async (req, res) => {
    const want = process.env.ZOOM_REVIEW_PASSWORD || "";
    if (want.length < 10) return res.status(404).json({ message: "Not available." });
    const ip = String(req.headers["x-forwarded-for"] ?? req.ip ?? "").split(",")[0].trim();
    const t = tries.get(ip);
    if (t && t.n >= 10 && Date.now() - t.at < 15 * 60_000) return res.status(429).json({ message: "Too many tries. Wait 15 minutes." });
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const a = crypto.createHash("sha256").update(password).digest();
    const b = crypto.createHash("sha256").update(want).digest();
    if (email !== REVIEW_EMAIL || !crypto.timingSafeEqual(a, b)) {
      tries.set(ip, { n: (t && Date.now() - t.at < 15 * 60_000 ? t.n : 0) + 1, at: Date.now() });
      return res.status(401).json({ message: "That email and password don't match." });
    }
    tries.delete(ip);
    // A ready podcaster, so there's no first-time setup between them and Integrations.
    const p = await storage.getProfileByEmail(REVIEW_EMAIL);
    if (!p?.hostName || !p.photoUrl) {
      await storage.upsertProfile(REVIEW_EMAIL, { podcastName: "Review Test Show", hostName: "App Reviewer", photoUrl: "/review-avatar.png", branch: "Not applicable", serviceStatus: "Not applicable", directoryHidden: true } as never);
    }
    setSessionCookie(res, REVIEW_EMAIL, false);
    res.json({ ok: true, to: "/host/dashboard/integrations" });
  });
}
