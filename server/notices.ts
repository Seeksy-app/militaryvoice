// A one-time celebration for a podcaster: shown the next time they open their
// dashboard (with confetti), then gone. Kept in discovery_cache under
// notice:<email>; one at a time per person, the newest wins.
//
// Bonus credits are the first use: Admin gives someone credits, the ledger
// gets the row, and they find out the moment they're next in.
import type { Express, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, storage } from "./storage.js";
import { discoveryCache } from "../shared/schema.js";
import { getAdminEmail } from "./session.js";

export type Notice = { kind: "bonus"; title: string; body: string; credits?: number; at: string };
const key = (email: string) => `notice:${email.trim().toLowerCase()}`;

export async function setNotice(email: string, n: Notice): Promise<void> {
  const payload = JSON.stringify(n);
  const createdAt = new Date().toISOString();
  await db.insert(discoveryCache).values({ key: key(email), payload, createdAt })
    .onConflictDoUpdate({ target: discoveryCache.key, set: { payload, createdAt } });
}

export function registerNotices(app: Express, requireAdmin: RequestHandler, requireHostSession: RequestHandler): void {
  /** Give someone bonus Pōstify credits, and tell them with a pop-up next time they're in. */
  app.post("/api/admin/postify/bonus", requireAdmin, async (req, res) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const credits = Math.round(Number(req.body?.credits));
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return res.status(400).json({ message: "Whose account?" });
    if (!(credits > 0 && credits <= 1000)) return res.status(400).json({ message: "Between 1 and 1,000 credits." });
    const note = String(req.body?.note ?? "").trim().slice(0, 200);
    const by = (getAdminEmail(req) ?? "admin").trim().toLowerCase();
    await storage.addTokens({ email, delta: credits, reason: `Bonus credits${note ? `: ${note}` : ""} (from ${by})`, ref: `bonus:${email}:${Date.now()}` });
    if (req.body?.celebrate !== false) {
      await setNotice(email, {
        kind: "bonus",
        credits,
        title: `You have ${credits} bonus ${credits === 1 ? "credit" : "credits"}!`,
        body: note || "A thank-you from the MilitaryVoices team. They're in your Pōstify balance now: use them on clips, clean episodes and edits.",
        at: new Date().toISOString(),
      });
    }
    res.json({ ok: true, balance: await storage.tokenBalance(email) });
  });

  /** The podcaster's waiting celebration, if there is one. */
  app.get("/api/host/notice", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const email = String((req as unknown as { hostEmail?: string }).hostEmail ?? "").trim().toLowerCase();
    const [row] = await db.select().from(discoveryCache).where(eq(discoveryCache.key, key(email)));
    let notice: Notice | null = null;
    try { notice = row ? (JSON.parse(row.payload) as Notice) : null; } catch { notice = null; }
    res.json({ notice, balance: notice?.kind === "bonus" ? await storage.tokenBalance(email) : undefined });
  });

  /** Seen: it doesn't show again. */
  app.post("/api/host/notice/seen", requireHostSession, async (req, res) => {
    const email = String((req as unknown as { hostEmail?: string }).hostEmail ?? "").trim().toLowerCase();
    await db.delete(discoveryCache).where(eq(discoveryCache.key, key(email)));
    res.json({ ok: true });
  });
}
