/**
 * The dashboard's Shortcuts row, per account (Andrew, 23 Nov: "make those cards drag about to arrange; and
 * customize to add other favorites"). Stored on the server so the order follows them to every device.
 *
 * Kept as a list of keys in the settings table, `shortcuts:<email>`. No row means "today's four" — the client
 * owns the default, so changing it never needs a migration.
 *
 * Under View as, reads and writes are the customer's, like every other admin edit there (Andrew via PM, 23 Nov:
 * admins set dashboards up for customers). `readOnly` stays in the answer, always false, for older clients.
 */
import type { Express, RequestHandler } from "express";
import { storage } from "./storage.js";
import { getSessionEmail } from "./session.js";

export const SHORTCUT_MAX = 8;
const KEY_RE = /^[a-z][a-z0-9-]{0,31}$/;
const norm = (e: string) => e.trim().toLowerCase();
const keyOf = (email: string) => `shortcuts:${norm(email)}`;

export function registerShortcuts(app: Express, requireHostSession: RequestHandler) {
  app.get("/api/host/shortcuts", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const email = norm(getSessionEmail(req) ?? "");
    let keys: string[] | null = null;
    try {
      const raw = await storage.getSetting(keyOf(email));
      const v = raw ? JSON.parse(raw) : null;
      if (Array.isArray(v)) keys = v.filter((k): k is string => typeof k === "string" && KEY_RE.test(k)).slice(0, SHORTCUT_MAX);
    } catch { keys = null; }
    res.json({ keys, max: SHORTCUT_MAX, readOnly: false });
  });

  /** {keys: string[]} replaces the row; {keys: null} goes back to the default four. */
  app.put("/api/host/shortcuts", requireHostSession, async (req, res) => {
    const email = norm(getSessionEmail(req) ?? "");
    const body = req.body as { keys?: unknown };
    if (body?.keys === null) {
      await storage.setSetting(keyOf(email), "");
      return res.json({ keys: null, max: SHORTCUT_MAX, readOnly: false });
    }
    if (!Array.isArray(body?.keys)) return res.status(400).json({ message: "Send the list of shortcuts." });
    const keys = Array.from(new Set(body.keys.filter((k): k is string => typeof k === "string" && KEY_RE.test(k))));
    if (keys.length > SHORTCUT_MAX) return res.status(400).json({ message: `Up to ${SHORTCUT_MAX} shortcuts.` });
    await storage.setSetting(keyOf(email), JSON.stringify(keys));
    res.json({ keys, max: SHORTCUT_MAX, readOnly: false });
  });
}
