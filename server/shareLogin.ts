// A private page where someone hands us a login without putting a password in an email
// (11 Nov 2026: Frank Zaccari's Buzzsprout, so the team can copy his episodes over).
//
// The team makes a link for one person and one service. The page asks for the login and
// stores it encrypted (AES-256-GCM, a key derived from SESSION_SECRET); only an admin can
// read it, from /admin-logins, and deleting it wipes it. The password never goes in an email,
// a log line (the reveal answers with res.send, which the JSON logger doesn't capture), or
// the mail log: the team's notice says who shared what, not the login itself.
import type { Express, RequestHandler } from "express";
import crypto from "node:crypto";
import { like, eq } from "drizzle-orm";
import { db, storage } from "./storage.js";
import { sendOneOffEmail } from "./email.js";
import { siteSettings } from "../shared/schema.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const TEAM = "hello@militaryvoices.ai";
const PREFIX = "sharelogin:";
const str = (v: unknown, n: number) => (typeof v === "string" ? v : "").trim().slice(0, n);
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface Record_ {
  name: string;
  service: string;
  createdAt: string;
  status: "open" | "received";
  receivedAt?: string;
  revealedAt?: string;
  tries?: number;
  /** iv.tag.ciphertext, base64url */
  box?: string;
}

let cachedKey: Buffer | null = null;
function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("No session secret on this server.");
  return (cachedKey ??= crypto.scryptSync(secret, "mv-share-login", 32));
}
function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}
function open(box: string): string {
  const [iv, tag, enc] = box.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

async function load(token: string): Promise<Record_ | null> {
  if (!/^[A-Za-z0-9_-]{20,60}$/.test(token)) return null;
  const raw = await storage.getSetting(PREFIX + token);
  try { return raw ? (JSON.parse(raw) as Record_) : null; } catch { return null; }
}
const save = (token: string, r: Record_) => storage.setSetting(PREFIX + token, JSON.stringify(r));

const tokenOf = (req: { params: Record<string, unknown> }) => String(req.params.token ?? "");

export function registerShareLogin(app: Express, requireAdmin: RequestHandler): void {
  // ── The customer's side ────────────────────────────────────────────────
  app.get("/api/share-login/:token", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const r = await load(tokenOf(req));
    if (!r) return res.status(404).json({ message: "This link isn't valid any more." });
    res.json({ name: r.name.split(/\s+/)[0] || "", service: r.service, received: r.status === "received" });
  });

  app.post("/api/share-login/:token", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const r = await load(tokenOf(req));
    if (!r) return res.status(404).json({ message: "This link isn't valid any more." });
    if ((r.tries ?? 0) >= 12) return res.status(429).json({ message: "Too many tries. Please tell us and we'll send a new link." });
    const loginEmail = str(req.body?.loginEmail, 200);
    const password = str(req.body?.password, 200);
    if (!loginEmail || !password) return res.status(400).json({ message: "Please fill in both boxes." });
    try {
      r.box = seal(JSON.stringify({ loginEmail, password }));
    } catch {
      return res.status(503).json({ message: "We can't take this right now. Please tell us and we'll find another way." });
    }
    r.tries = (r.tries ?? 0) + 1;
    r.status = "received";
    r.receivedAt = new Date().toISOString();
    delete r.revealedAt;
    await save(tokenOf(req), r);
    // The team hears who and what, never the login itself.
    await sendOneOffEmail({
      to: TEAM,
      subject: `${r.name} shared their ${r.service} login`,
      text: `${r.name} shared their ${r.service} login through the private page.\n\nRead it (then delete it when you're done): ${ORIGIN}/admin-logins\n`,
      html: `<p><b>${esc(r.name)}</b> shared their ${esc(r.service)} login through the private page.</p><p><a href="${ORIGIN}/admin-logins">Read it, and delete it when you're done</a></p>`,
      kind: "share-login",
    }).catch(() => undefined);
    res.json({ ok: true });
  });

  // ── The team's side ────────────────────────────────────────────────────
  app.post("/api/admin/share-login", requireAdmin, async (req, res) => {
    const name = str(req.body?.name, 80);
    const service = str(req.body?.service, 40) || "Buzzsprout";
    if (!name) return res.status(400).json({ message: "Whose link is it?" });
    const token = crypto.randomBytes(24).toString("base64url");
    await save(token, { name, service, createdAt: new Date().toISOString(), status: "open" });
    res.json({ token, url: `${ORIGIN}/share-login/${token}` });
  });

  app.get("/api/admin/share-logins", requireAdmin, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const rows = await db.select().from(siteSettings).where(like(siteSettings.key, `${PREFIX}%`));
    const out = rows.flatMap((row) => {
      try {
        const r = JSON.parse(row.value) as Record_;
        return [{ token: row.key.slice(PREFIX.length), name: r.name, service: r.service, status: r.status, createdAt: r.createdAt, receivedAt: r.receivedAt ?? "", revealedAt: r.revealedAt ?? "" }];
      } catch { return []; }
    });
    res.json(out.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  });

  // The login itself. res.send, not res.json: the JSON logger writes every json answer to the server log.
  app.get("/api/admin/share-login/:token/reveal", requireAdmin, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const r = await load(tokenOf(req));
    if (!r?.box) return res.status(404).json({ message: "Nothing shared yet." });
    try {
      const plain = open(r.box);
      r.revealedAt = new Date().toISOString();
      await save(tokenOf(req), r);
      res.type("application/json").send(plain);
    } catch {
      res.status(500).json({ message: "Couldn't open that one." });
    }
  });

  app.delete("/api/admin/share-login/:token", requireAdmin, async (req, res) => {
    if (!/^[A-Za-z0-9_-]{20,60}$/.test(tokenOf(req))) return res.status(400).json({ message: "Not a link." });
    await db.delete(siteSettings).where(eq(siteSettings.key, PREFIX + tokenOf(req)));
    res.json({ ok: true });
  });
}
