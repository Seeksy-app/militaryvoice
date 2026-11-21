// One-shot emails that wait for the person's next move (21 Nov 2026, first for Frank's "meet Lori" note;
// Andrew: "Wait for his next email. Or his next login if he logs in trigger the email.").
//
// A nudge is armed by an admin with the exact text Andrew approved. It goes out once, on whichever comes
// first for that address: their next inbound email (it then replaces the auto-acknowledgement, so they get one
// email, not two), their next sign-in with a code, or their next visit to a signed-in page on their own session.
// An admin "view as" never fires it. Plain text, from hello@, through the normal send hook (so it's in mail_log).
import type { Express, Request, RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { db, storage } from "./storage.js";
import { sendOneOffEmail } from "./email.js";
import { getAdminEmail } from "./session.js";

export interface Nudge { ref: string; to: string; subject: string; text: string; armedAt: string; by: string }
const KEY = "nudges";
const sentKey = (ref: string) => `nudge-sent:${ref}`;
const norm = (e: string) => e.trim().toLowerCase();

async function armed(): Promise<Nudge[]> {
  try { return JSON.parse((await storage.getSetting(KEY)) ?? "[]"); } catch { return []; }
}

/** Sends any nudge waiting for this address. True when one went out. Safe to call often: each ref sends once. */
export async function fireNudgeFor(email: string, why: "email" | "sign-in" | "visit"): Promise<boolean> {
  const who = norm(email);
  const list = (await armed()).filter((n) => norm(n.to) === who);
  let sent = false;
  for (const n of list) {
    // The claim is one row insert, so two triggers at the same moment can't both send.
    const claim: any[] = (await db.execute(sql`insert into site_settings (key, value) values (${sentKey(n.ref)}, ${JSON.stringify({ at: new Date().toISOString(), why, claiming: true })}) on conflict (key) do nothing returning key`)) as any;
    if (!claim.length) continue;
    const id = await sendOneOffEmail({ kind: "nudge", to: n.to, subject: n.subject, text: n.text, html: "" }).catch(() => null);
    if (!id) {
      // Failed: let the next trigger try again.
      await db.execute(sql`delete from site_settings where key = ${sentKey(n.ref)}`);
      console.error(`Nudge ${n.ref} to ${n.to} failed to send`);
      continue;
    }
    await storage.setSetting(sentKey(n.ref), JSON.stringify({ at: new Date().toISOString(), why, resendId: id }));
    await storage.setSetting(KEY, JSON.stringify((await armed()).filter((x) => x.ref !== n.ref)));
    console.log(`Nudge ${n.ref} sent to ${n.to} on ${why}`);
    sent = true;
  }
  return sent;
}

/** For a signed-in page load: fires only on the person's own session, never an admin viewing as them. */
export function fireNudgeOnVisit(req: Request, email: string): Promise<boolean> {
  if (getAdminEmail(req)) return Promise.resolve(false);
  return fireNudgeFor(email, "visit").catch(() => false);
}

export function registerNudges(app: Express, requireAdmin: RequestHandler): void {
  app.get("/api/admin/nudges", requireAdmin, async (_req, res) => {
    const list = await armed();
    res.json({ armed: list });
  });
  app.get("/api/admin/nudges/:ref", requireAdmin, async (req, res) => {
    const ref = String(req.params.ref);
    res.json({ armed: (await armed()).find((n) => n.ref === ref) ?? null, sent: JSON.parse((await storage.getSetting(sentKey(ref))) ?? "null") });
  });
  /** Arm: {to, subject, text}. Refused if that ref already went out. */
  app.put("/api/admin/nudges/:ref", requireAdmin, async (req, res) => {
    const ref = String(req.params.ref);
    if (!/^[a-z0-9-]{3,60}$/.test(ref)) return res.status(400).json({ message: "ref: a-z, 0-9 and dashes." });
    if (await storage.getSetting(sentKey(ref))) return res.status(409).json({ message: "That one already went out." });
    const to = norm(String(req.body?.to ?? "")), subject = String(req.body?.subject ?? "").trim(), text = String(req.body?.text ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) || !subject || !text) return res.status(400).json({ message: "to, subject and text are required." });
    const n: Nudge = { ref, to, subject: subject.slice(0, 200), text: text.slice(0, 5000), armedAt: new Date().toISOString(), by: getAdminEmail(req) ?? "admin" };
    await storage.setSetting(KEY, JSON.stringify([...(await armed()).filter((x) => x.ref !== ref), n]));
    res.json({ armed: n });
  });
  app.delete("/api/admin/nudges/:ref", requireAdmin, async (req, res) => {
    const ref = String(req.params.ref);
    await storage.setSetting(KEY, JSON.stringify((await armed()).filter((x) => x.ref !== ref)));
    res.json({ ok: true });
  });
}
