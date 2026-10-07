// Show-day texts, on SimpleTexting (Telnyx as a fallback).
//
// Email was our only way to reach a guest on the day, and it was missed all
// day (5 Oct AAR): "you're on in 10" sat unread in inboxes while the slot ran.
// A text gets read. This is deliberately small: the team picks people, picks
// or writes a line, and it goes. Every text says who it's from, the first one
// to a number says how to stop them, and a STOP reply is honoured for good.
//
// SimpleTexting needs SIMPLETEXTING_API_TOKEN (and SIMPLETEXTING_ACCOUNT_PHONE
// when the account has more than one number); SIMPLETEXTING_WEBHOOK_SECRET
// guards the reply/STOP webhook, which carries no signature of its own.
// Telnyx (TELNYX_API_KEY + TELNYX_FROM_NUMBER) is used only if SimpleTexting
// isn't set. With neither, the admin says texting isn't set up, and nothing
// is sent. (Telnyx suspended our account on 6 Oct 2026.)
import type { Express, RequestHandler, Request } from "express";
import crypto from "node:crypto";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { getAdminEmail } from "./session.js";
import { slackNote } from "./slack.js";
import { smsMessages, smsOptIns, smsOptOuts } from "../shared/schema.js";
import { SMS_CONSENT } from "../shared/sms.js";

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

const simpleTexting = () => Boolean(process.env.SIMPLETEXTING_API_TOKEN);
const telnyx = () => Boolean(process.env.TELNYX_API_KEY && toE164(process.env.TELNYX_FROM_NUMBER || ""));
export function smsConfigured(): boolean {
  return simpleTexting() || telnyx();
}
/** The number texts come from, for the admin to show. */
function fromNumber(): string {
  if (simpleTexting()) return toE164(process.env.SIMPLETEXTING_ACCOUNT_PHONE || "") || "your SimpleTexting number";
  return toE164(process.env.TELNYX_FROM_NUMBER || "");
}
/** SimpleTexting wants US numbers as ten digits. */
const tenDigits = (e164: string) => e164.replace(/^\+1/, "").replace(/\D/g, "");

const ST_BASE = "https://api-app2.simpletexting.com/v2/api";
async function simpleTextingSend(to: string, text: string): Promise<{ ok: boolean; id: string; error: string }> {
  try {
    const body: Record<string, string> = { contactPhone: tenDigits(to), mode: "AUTO", text };
    const acct = toE164(process.env.SIMPLETEXTING_ACCOUNT_PHONE || "");
    if (acct) body.accountPhone = tenDigits(acct);
    const r = await fetch(`${ST_BASE}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.SIMPLETEXTING_API_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as { id?: string; message?: string; error?: string; details?: string };
    if (!r.ok) return { ok: false, id: "", error: j.message || j.details || j.error || `SimpleTexting said ${r.status}` };
    return { ok: true, id: j.id ?? "", error: "" };
  } catch (err) {
    return { ok: false, id: "", error: err instanceof Error ? err.message : String(err) };
  }
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
  const r = simpleTexting() ? await simpleTextingSend(phone, text) : await telnyxSend(phone, text);
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
export async function peopleFor(eventId: number) {
  const signups = (await storage.listSignups(eventId)).filter((s) => s.status !== "cancelled");
  const event = await storage.getEventById(eventId);
  const start = event ? Date.parse(event.startAtUtc) : NaN;
  const out: { key: string; signupId: number; role: "host" | "cohost"; name: string; email: string; show: string; slotIndex: number; slotAt: string; phone: string; textable: boolean }[] = [];
  for (const s of signups) {
    const slotAt = Number.isFinite(start) && event ? new Date(start + s.slotIndex * event.slotMinutes * 60000).toISOString() : "";
    const host = await storage.getProfileByEmail(s.email);
    const phone = s.phone || host?.phone || (await optInPhone(s.email));
    out.push({ key: `h-${s.id}`, signupId: s.id, role: "host", name: s.hostName, email: s.email, show: s.podcastName, slotIndex: s.slotIndex, slotAt, phone, textable: !!toE164(phone) });
    const co = (s as { coHostEmail?: string | null }).coHostEmail?.trim();
    if (co) {
      const p = await storage.getProfileByEmail(co);
      const cphone = p?.phone || (await optInPhone(co));
      out.push({ key: `c-${s.id}`, signupId: s.id, role: "cohost", name: p?.hostName || co, email: co, show: s.podcastName, slotIndex: s.slotIndex, slotAt, phone: cphone, textable: !!toE164(cphone) });
    }
  }
  return out.sort((a, b) => a.slotIndex - b.slotIndex || (a.role === "host" ? -1 : 1));
}

/** A text back from someone: kept against whoever we last texted at that number; STOP/START honoured; anything else to Slack. */
async function logReply(phone: string, text: string, providerId: string) {
  const [last] = await db.select().from(smsMessages).where(and(eq(smsMessages.phone, phone), eq(smsMessages.direction, "out"))).orderBy(desc(smsMessages.id)).limit(1);
  await db.insert(smsMessages).values({ eventId: last?.eventId ?? null, direction: "in", phone, name: last?.name ?? "", email: last?.email ?? "", body: text, status: "received", providerId, createdAt: now() });
  if (STOP_WORDS.test(text)) await db.insert(smsOptOuts).values({ phone, createdAt: now() }).onConflictDoNothing();
  else if (START_WORDS.test(text)) await db.delete(smsOptOuts).where(eq(smsOptOuts.phone, phone));
  else await slackNote(`:iphone: Text from ${last?.name || phone}: "${text.slice(0, 300)}"`, { label: "Open Texts", url: `${ORIGIN}/admin/texts` }).catch(() => {});
}

/** The newest number someone gave on the text-alerts page. */
async function optInPhone(email: string): Promise<string> {
  const [r] = await db.select({ phone: smsOptIns.phone }).from(smsOptIns).where(eq(smsOptIns.email, email.trim().toLowerCase())).orderBy(desc(smsOptIns.id)).limit(1);
  return r?.phone ?? "";
}

const optInHits = new Map<string, number[]>();

export function registerSms(app: Express, requireAdmin: RequestHandler) {
  /**
   * The public opt-in (/text-alerts): name, email, mobile and a box they tick
   * themselves. Kept with the exact consent words; START undoes an old STOP.
   */
  app.post("/api/sms/opt-in", async (req, res) => {
    const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
    const recent = (optInHits.get(ip) ?? []).filter((t) => Date.now() - t < 3600_000);
    if (recent.length >= 5) return res.status(429).json({ message: "Too many tries. Try again in an hour." });
    optInHits.set(ip, [...recent, Date.now()]);
    const email = String(req.body?.email ?? "").trim().toLowerCase().slice(0, 200);
    const name = String(req.body?.name ?? "").trim().slice(0, 100);
    const phone = toE164(String(req.body?.phone ?? ""));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ message: "Enter the email you booked with." });
    if (!phone) return res.status(400).json({ message: "Enter a US mobile number." });
    if (req.body?.consent !== true) return res.status(400).json({ message: "Tick the box to agree to the texts." });
    await schemaIsReady();
    await db.insert(smsOptIns).values({ email, name, phone, consentText: SMS_CONSENT, ip, createdAt: now() });
    await db.delete(smsOptOuts).where(eq(smsOptOuts.phone, phone));
    res.json({ ok: true });
  });

  const adminOnly: RequestHandler = (req, res, next) => ((req as { studioHost?: unknown }).studioHost ? res.status(403).json({ message: "Admins only." }) : next());

  app.get("/api/admin/sms/people", requireAdmin, adminOnly, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const eventId = Number(req.query.eventId) || (await storage.getFeaturedEvent()).id;
    const event = await storage.getEventById(eventId);
    const opted = new Set((await db.select().from(smsOptOuts)).map((o) => o.phone));
    const people = (await peopleFor(eventId)).map((p) => ({ ...p, optedOut: opted.has(toE164(p.phone)) }));
    res.json({
      configured: smsConfigured(),
      from: smsConfigured() ? fromNumber() : "",
      provider: simpleTexting() ? "SimpleTexting" : telnyx() ? "Telnyx" : "",
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

  /** A test text to any number (the admin's own phone), to check the line works end to end. */
  app.post("/api/admin/sms/test", requireAdmin, adminOnly, async (req, res) => {
    const phone = toE164(String(req.body?.phone ?? ""));
    if (!phone) return res.status(400).json({ message: "Enter a US mobile number." });
    const r = await sendSms({ phone, body: "This is a test from Admin → Texts. If you can read this, show-day texts work.", name: "Test", sentBy: getAdminEmail(req) ?? "" });
    res.status(r.ok ? 200 : 502).json(r.ok ? { ok: true } : { message: r.error || "It didn't send." });
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
   * SimpleTexting: replies, delivery reports and unsubscribes. Their webhooks
   * aren't signed, so the URL carries our secret.
   */
  app.post("/api/webhooks/simpletexting", async (req, res) => {
    const secret = process.env.SIMPLETEXTING_WEBHOOK_SECRET;
    if (!secret || String(req.query.key ?? "") !== secret) return res.status(401).json({ message: "No" });
    await schemaIsReady();
    const type = String(req.body?.type ?? "");
    const v = (req.body?.values ?? {}) as Record<string, any>;
    if (type === "UNSUBSCRIBE_REPORT") {
      const phone = toE164(String(v.phone ?? v.contactPhone ?? ""));
      if (phone) await db.insert(smsOptOuts).values({ phone, createdAt: now() }).onConflictDoNothing();
    } else if (type === "DELIVERY_REPORT" || type === "NON_DELIVERED_REPORT") {
      const id = String(v.messageId ?? v.id ?? "");
      if (id) await db.update(smsMessages).set({ status: type === "DELIVERY_REPORT" ? "delivered" : "failed", ...(type === "NON_DELIVERED_REPORT" ? { error: String(v.reason ?? v.errorDescription ?? "Not delivered") } : {}) }).where(eq(smsMessages.providerId, id));
    } else if (type === "INCOMING_MESSAGE") {
      const phone = toE164(String(v.contactPhone ?? ""));
      const text = String(v.text ?? "").slice(0, 1600);
      if (phone) await logReply(phone, text, String(v.messageId ?? ""));
    }
    res.json({ ok: true });
  });

  /** Point SimpleTexting's replies, delivery reports and STOPs at us. One press, once. */
  app.post("/api/admin/sms/connect-webhook", requireAdmin, adminOnly, async (_req, res) => {
    if (!simpleTexting()) return res.status(400).json({ message: "Add SIMPLETEXTING_API_TOKEN first." });
    const secret = process.env.SIMPLETEXTING_WEBHOOK_SECRET;
    if (!secret) return res.status(400).json({ message: "Add SIMPLETEXTING_WEBHOOK_SECRET first." });
    const r = await fetch(`${ST_BASE}/webhooks`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.SIMPLETEXTING_API_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ url: `${ORIGIN}/api/webhooks/simpletexting?key=${encodeURIComponent(secret)}`, triggers: ["INCOMING_MESSAGE", "DELIVERY_REPORT", "NON_DELIVERED_REPORT", "UNSUBSCRIBE_REPORT"], requestPerSecLimit: 10 }),
    });
    const j = await r.json().catch(() => ({}));
    res.status(r.ok ? 200 : 502).json(r.ok ? { ok: true } : { message: (j as { message?: string }).message || `SimpleTexting said ${r.status}` });
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
      if (phone) await logReply(phone, String(p.text ?? "").slice(0, 1600), String(p.id ?? ""));
    }
    res.json({ ok: true });
  });
}
