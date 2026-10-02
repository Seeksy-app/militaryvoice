// A one-time celebration for a podcaster: shown the next time they open their
// dashboard (with confetti), then gone. Kept in discovery_cache under
// notice:<email>; one at a time per person, the newest wins.
//
// Bonus credits are the first use: Admin gives someone credits, the ledger
// gets the row, and they find out the moment they're next in.
import type { Express, RequestHandler } from "express";
import { desc, eq, like } from "drizzle-orm";
import { db, storage } from "./storage.js";
import { discoveryCache, postifyTokens } from "../shared/schema.js";
import { getAdminEmail } from "./session.js";

export type Notice = { kind: "bonus"; title: string; body: string; credits?: number; at: string };
const key = (email: string) => `notice:${email.trim().toLowerCase()}`;
/** When they last saw a pop-up, so admin can tell "seen" from "waiting". */
const seenKey = (email: string) => `notice-seen:${email.trim().toLowerCase()}`;

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

  /**
   * Every bonus given, newest first per person, with whether its pop-up is still waiting or was
   * seen (and when). From the ledger, so bonuses given before this was built show too.
   */
  app.get("/api/admin/postify/bonuses", requireAdmin, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const rows = await db.select().from(postifyTokens).where(like(postifyTokens.reason, "Bonus credits%")).orderBy(desc(postifyTokens.createdAt));
    const keys = await db.select().from(discoveryCache).where(like(discoveryCache.key, "notice%"));
    const waiting = new Map(keys.filter((k) => k.key.startsWith("notice:")).map((k) => [k.key.slice(7), k.createdAt]));
    const seen = new Map(keys.filter((k) => k.key.startsWith("notice-seen:")).map((k) => [k.key.slice(12), k.createdAt]));
    const out: Record<string, { credits: number; total: number; at: string; popup: "waiting" | "seen" | "none"; seenAt: string }> = {};
    for (const r of rows) {
      const e = r.email.trim().toLowerCase();
      if (out[e]) { out[e].total += r.delta; continue; }
      const w = waiting.get(e);
      const s = seen.get(e) ?? "";
      out[e] = { credits: r.delta, total: r.delta, at: r.createdAt, popup: w ? "waiting" : s ? "seen" : "none", seenAt: s };
    }
    res.json(out);
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
    const at = new Date().toISOString();
    await db.insert(discoveryCache).values({ key: seenKey(email), payload: JSON.stringify({ at }), createdAt: at })
      .onConflictDoUpdate({ target: discoveryCache.key, set: { payload: JSON.stringify({ at }), createdAt: at } });
    res.json({ ok: true });
  });
}
