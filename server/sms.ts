// Show-day texts, on Telnyx.
//
// Email was our only way to reach a guest on the day, and it was missed all
// day (5 Oct AAR): "you're on in 10" sat unread in inboxes while the slot ran.
// A text gets read. This is deliberately small: the team picks people, picks
// or writes a line, and it goes. Every text says who it's from, the first one
// to a number says how to stop them, and a STOP reply is honoured for good.
//
// Needs TELNYX_API_KEY and TELNYX_FROM_NUMBER (a verified toll-free number);
// TELNYX_PUBLIC_KEY lets the delivery and reply webhook be checked. Without
// the first two the admin says texting isn't set up, and nothing is sent.
import type { Express, RequestHandler, Request } from "express";
import crypto from "node:crypto";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { getAdminEmail } from "./session.js";
import { slackNote } from "./slack.js";
import { smsMessages, smsOptOuts } from "../shared/schema.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const now = () => new Date().toISOString();
const BRAND = "MilitaryVoices.ai";
const STOP_LINE = "Reply STOP to opt out.";
const STOP_WORDS = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|optout|opt out)\s*$/i;
const START_WORDS = /^\s*(start|unstop|yes)\s*$/i;

/** A US/Canada number as +1XXXXXXXXXX, or "" when it isn't one we can text. */
export function toE164(raw: string): string {
  const t = (raw || "").trim();
  if (!t) return "";
  const digits = t.replace(/\D/g, "");
  if (t.startsWith("+") && digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

export function smsConfigured(): boolean {
  return Boolean(process.env.TELNYX_API_KEY && toE164(process.env.TELNYX_FROM_NUMBER || ""));
}

/** One text, through Telnyx. Never throws: the result says what happened. */
async function telnyxSend(to: string, text: string): Promise<{ ok: boolean; id: string; error: string }> {
  try {
    const body: Record<string, string> = { from: toE164(process.env.TELNYX_FROM_NUMBER || ""), to, text };
    if (process.env.TELNYX_MESSAGING_PROFILE_ID) body.messaging_profile_id = process.env.TELNYX_MESSAGING_PROFILE_ID;
    const r = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.TELNYX_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as { data?: { id?: string }; errors?: { title?: string; detail?: string }[] };
    if (!r.ok) {
      const e = j.errors?.[0];
      return { ok: false, id: "", error: [e?.title, e?.detail].filter(Boolean).join(": ") || `Telnyx said ${r.status}` };
    }
    return { ok: true, id: j.data?.id ?? "", error: "" };
  } catch (err) {
    return { ok: false, id: "", error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Text one person. Adds who it's from, and the opt-out line on the first text
 * a number ever gets from us. Numbers that said STOP are skipped and logged
 * as blocked, so the team can see why.
 */
export async function sendSms(o: { phone: string; body: string; name?: string; email?: string; eventId?: number | null; sentBy?: string }): Promise<{ ok: boolean; status: string; error: string }> {
  await schemaIsReady();
  const phone = toE164(o.phone);
  const base = { eventId: o.eventId ?? null, direction: "out", name: o.name ?? "", email: o.email ?? "", sentBy: o.sentBy ?? "", createdAt: now() };
  if (!phone) return { ok: false, status: "failed", error: "Not a phone number we can text" };
  const [out] = await db.select().from(smsOptOuts).where(eq(smsOptOuts.phone, phone)).limit(1);
  const text0 = o.body.trim();
  if (out) {
    await db.insert(smsMessages).values({ ...base, phone, body: text0, status: "blocked", error: "They replied STOP" });
    return { ok: false, status: "blocked", error: "They replied STOP" };
  }
  const [before] = await db.select({ id: smsMessages.id }).from(smsMessages).where(and(eq(smsMessages.phone, phone), eq(smsMessages.direction, "out"), inArray(smsMessages.status, ["sent", "delivered"]))).limit(1);
  const text = `${text0.startsWith(BRAND) ? "" : `${BRAND}: `}${text0}${before ? "" : ` ${STOP_LINE}`}`;
  if (!smsConfigured()) {
    await db.insert(smsMessages).values({ ...base, phone, body: text, status: "failed", error: "Texting isn't set up yet" });
    return { ok: false, status: "failed", error: "Texting isn't set up yet" };
  }
  const r = await telnyxSend(phone, text);
  await db.insert(smsMessages).values({ ...base, phone, body: text, status: r.ok ? "sent" : "failed", providerId: r.id, error: r.error });
  return { ok: r.ok, status: r.ok ? "sent" : "failed", error: r.error };
}

/** Telnyx signs its webhooks with Ed25519 over "timestamp|body". */
function verifyTelnyx(req: Request): boolean {
  const key = process.env.TELNYX_PUBLIC_KEY;
  if (!key) return false;
  const sig = String(req.headers["telnyx-signature-ed25519"] ?? "");
  const ts = String(req.headers["telnyx-timestamp"] ?? "");
  const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!sig || !ts || !raw) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  try {
    const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(key, "base64")]);
    const pub = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(`${ts}|${raw.toString("utf8")}`), pub, Buffer.from(sig, "base64"));
  } catch {
    return false;
  }
}

/** Who on this event's lineup we could text, and with what number. */
async function peopleFor(eventId: number) {
  const signups = (await storage.listSignups(eventId)).filter((s) => s.status !== "cancelled");
  const event = await storage.getEventById(eventId);
  const start = event ? Date.parse(event.startAtUtc) : NaN;
  const out: { key: string; signupId: number; role: "host" | "cohost"; name: string; email: string; show: string; slotIndex: number; slotAt: string; phone: string; textable: boolean }[] = [];
  for (const s of signups) {
    const slotAt = Number.isFinite(start) && event ? new Date(start + s.slotIndex * event.slotMinutes * 60000).toISOString() : "";
    const host = await storage.getProfileByEmail(s.email);
    const phone = s.phone || host?.phone || "";
    out.push({ key: `h-${s.id}`, signupId: s.id, role: "host", name: s.hostName, email: s.email, show: s.podcastName, slotIndex: s.slotIndex, slotAt, phone, textable: !!toE164(phone) });
    const co = (s as { coHostEmail?: string | null }).coHostEmail?.trim();
    if (co) {
      const p = await storage.getProfileByEmail(co);
      const cphone = p?.phone || "";
      out.push({ key: `c-${s.id}`, signupId: s.id, role: "cohost", name: p?.hostName || co, email: co, show: s.podcastName, slotIndex: s.slotIndex, slotAt, phone: cphone, textable: !!toE164(cphone) });
    }
  }
  return out.sort((a, b) => a.slotIndex - b.slotIndex || (a.role === "host" ? -1 : 1));
}

export function registerSms(app: Express, requireAdmin: RequestHandler) {
  const adminOnly: RequestHandler = (req, res, next) => ((req as { studioHost?: unknown }).studioHost ? res.status(403).json({ message: "Admins only." }) : next());

  app.get("/api/admin/sms/people", requireAdmin, adminOnly, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const eventId = Number(req.query.eventId) || (await storage.getFeaturedEvent()).id;
    const event = await storage.getEventById(eventId);
    const opted = new Set((await db.select().from(smsOptOuts)).map((o) => o.phone));
    const people = (await peopleFor(eventId)).map((p) => ({ ...p, optedOut: opted.has(toE164(p.phone)) }));
    res.json({
      configured: smsConfigured(),
      from: smsConfigured() ? toE164(process.env.TELNYX_FROM_NUMBER || "") : "",
      studioLink: `${ORIGIN}/event/${event?.slug ?? ""}/studio`.replace("/event//studio", "/studio"),
      people,
    });
  });

  app.get("/api/admin/sms/log", requireAdmin, adminOnly, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await schemaIsReady();
    const eventId = Number(req.query.eventId) || 0;
    const rows = await db
      .select()
      .from(smsMessages)
      .where(eventId ? or(eq(smsMessages.eventId, eventId), isNull(smsMessages.eventId)) : undefined)
      .orderBy(desc(smsMessages.id))
      .limit(200);
    res.json(rows);
  });

  /** Text a list of people the same line. `{name}` and `{link}` fill in per person. */
  app.post("/api/admin/sms/send", requireAdmin, adminOnly, async (req, res) => {
    const eventId = Number(req.body?.eventId) || (await storage.getFeaturedEvent()).id;
    const text = String(req.body?.text ?? "").trim().slice(0, 600);
    const keys = (Array.isArray(req.body?.keys) ? req.body.keys : []).map(String).slice(0, 100);
    if (!text) return res.status(400).json({ message: "Write the text first." });
    if (!keys.length) return res.status(400).json({ message: "Pick who to text." });
    const event = await storage.getEventById(eventId);
    const link = `${ORIGIN}/event/${event?.slug ?? ""}/studio`.replace("/event//studio", "/studio");
    const people = (await peopleFor(eventId)).filter((p) => keys.includes(p.key));
    const sentBy = getAdminEmail(req) ?? "";
    const results = [];
    for (const p of people) {
      const first = p.name.trim().split(/\s+/)[0] || "there";
      const body = text.replace(/\{name\}/gi, first).replace(/\{link\}/gi, link).replace(/\{show\}/gi, p.show);
      const r = await sendSms({ phone: p.phone, body, name: p.name, email: p.email, eventId, sentBy });
      results.push({ key: p.key, name: p.name, ...r });
    }
    res.json({ results, sent: results.filter((r) => r.ok).length });
  });

  /**
   * Telnyx: delivery reports and replies. A reply of STOP is honoured at once;
   * anything else a person writes back goes to the log and to Slack, so a
   * guest texting "I can't get in" reaches someone.
   */
  app.post("/api/webhooks/telnyx", async (req, res) => {
    if (!verifyTelnyx(req)) return res.status(401).json({ message: "Unsigned" });
    await schemaIsReady();
    const ev = req.body?.data as { event_type?: string; payload?: Record<string, any> } | undefined;
    const p = ev?.payload ?? {};
    if (ev?.event_type === "message.finalized" || ev?.event_type === "message.sent") {
      const status = String(p.to?.[0]?.status ?? "");
      const mapped = status === "delivered" ? "delivered" : /fail|undeliver/.test(status) ? "failed" : "sent";
      const err = p.errors?.[0]?.title ?? "";
      if (p.id) await db.update(smsMessages).set({ status: mapped, ...(err ? { error: String(err) } : {}) }).where(eq(smsMessages.providerId, String(p.id)));
    } else if (ev?.event_type === "message.received") {
      const phone = toE164(String(p.from?.phone_number ?? ""));
      const text = String(p.text ?? "").slice(0, 1600);
      if (phone) {
        const [last] = await db.select().from(smsMessages).where(and(eq(smsMessages.phone, phone), eq(smsMessages.direction, "out"))).orderBy(desc(smsMessages.id)).limit(1);
        await db.insert(smsMessages).values({ eventId: last?.eventId ?? null, direction: "in", phone, name: last?.name ?? "", email: last?.email ?? "", body: text, status: "received", providerId: String(p.id ?? ""), createdAt: now() });
        if (STOP_WORDS.test(text)) await db.insert(smsOptOuts).values({ phone, createdAt: now() }).onConflictDoNothing();
        else if (START_WORDS.test(text)) await db.delete(smsOptOuts).where(eq(smsOptOuts.phone, phone));
        else await slackNote(`:iphone: Text from ${last?.name || phone}: "${text.slice(0, 300)}"`, { label: "Open Texts", url: `${ORIGIN}/admin/texts` }).catch(() => {});
      }
    }
    res.json({ ok: true });
  });
}
