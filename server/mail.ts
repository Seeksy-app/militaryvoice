// Mail: our side of email, the way a mail app shows it. Every email we send is logged
// (the hook in email.ts), and the Mail screen shows it beside what came in to hello@:
// Needs a reply, Inbox, Sent, Campaigns and Didn't send, each person's whole
// conversation in one place, with what happened to each email we sent
// (delivered, opened, clicked, bounced).
import type { Express, RequestHandler, Response } from "express";
import { and, desc, eq, ilike, inArray, notInArray, or, sql } from "drizzle-orm";
import { db, schemaIsReady } from "./storage.js";
import { setMailLogger } from "./email.js";
import { broadcastEvents, broadcasts, contacts, inboundEmails, mailLog, type MailLogRow } from "../shared/schema.js";

/** Emails whose words stay out of the log (a code is a key). */
const SECRET_KINDS = new Set(["sendLoginCodeEmail", "sendPodcastOwnerCodeEmail"]);
/** One campaign is one line in Campaigns, not a line per person in Sent. */
const BULK_KINDS = ["sendBroadcastEmail", "campaign", "cadence"];

const now = () => new Date().toISOString();
const noStore = (res: Response) => res.setHeader("Cache-Control", "no-store");
const snippet = (t: string, n = 160) => { const s = (t || "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
/** Their words without the quoted history below them. */
const said = (t: string) => (t || "").split(/\n(?:On .{5,200}wrote:|-{2,} ?Original Message|From: .+\nSent: )/)[0].replace(/\n>.*$/gm, "").trim();

export function installMailLog() {
  setMailLogger(async (m) => {
    await schemaIsReady();
    await db.insert(mailLog).values({
      toEmail: m.to.trim().toLowerCase(), fromAddr: m.from, subject: m.subject.slice(0, 300), kind: m.kind,
      bodyText: SECRET_KINDS.has(m.kind) ? "(The code in this email isn't kept.)" : m.text.slice(0, 20000),
      resendId: m.resendId, ok: m.ok, error: m.error.slice(0, 300), replyTo: m.replyTo, sentAt: now(),
    });
  });
}

type Events = { delivered: boolean; opened: boolean; clicked: boolean; bounced: boolean; complained: boolean };
async function eventsFor(ids: string[]): Promise<Map<string, Events>> {
  const out = new Map<string, Events>();
  const clean = ids.filter(Boolean);
  if (!clean.length) return out;
  const rows = await db.select({ id: broadcastEvents.resendId, type: broadcastEvents.eventType }).from(broadcastEvents).where(inArray(broadcastEvents.resendId, clean));
  for (const r of rows) {
    const e = out.get(r.id) ?? { delivered: false, opened: false, clicked: false, bounced: false, complained: false };
    if (r.type in e) (e as Record<string, boolean>)[r.type] = true;
    // An open or a click means it arrived.
    if (r.type === "opened" || r.type === "clicked") e.delivered = true;
    out.set(r.id, e);
  }
  return out;
}

type Item = {
  key: string; dir: "in" | "out" | "campaign"; email: string; name: string; subject: string; snippet: string; at: string;
  kind: string; status: string; ok: boolean; events: Events | null; inboundId?: number; broadcastId?: number; count?: number; opened?: number; clicked?: number;
  /** Came in and not opened yet; put away in Archive. */
  unread?: boolean; archived?: boolean;
};
const inItem = (r: typeof inboundEmails.$inferSelect): Item => ({
  key: `in-${r.id}`, dir: "in", email: r.fromEmail.toLowerCase(), name: r.fromName || r.fromEmail, subject: r.subject, snippet: snippet(r.summary || said(r.bodyText)), at: r.receivedAt,
  kind: r.category || "other", status: r.status, ok: true, events: null, inboundId: r.id, unread: !r.readAt, archived: r.archived,
});
const outItem = (r: MailLogRow, ev: Map<string, Events>): Item => ({
  key: `out-${r.id}`, dir: "out", email: r.toEmail, name: r.toEmail, subject: r.subject, snippet: snippet(r.bodyText), at: r.sentAt,
  kind: r.kind, status: r.ok ? "sent" : "failed", ok: r.ok, events: ev.get(r.resendId) ?? null,
});

export function registerMail(app: Express, requireAdmin: RequestHandler) {
  installMailLog();

  /** A folder: Needs a reply, Inbox, Sent, Didn't send, Campaigns, or All mail. Searchable. */
  app.get("/api/admin/mail", requireAdmin, async (req, res) => {
    noStore(res);
    await schemaIsReady();
    const folder = String(req.query.folder ?? "needs");
    const q = String(req.query.q ?? "").trim().slice(0, 100);
    const limit = 60;
    const offset = Math.max(0, Math.min(5000, Number(req.query.offset) || 0));
    const like = `%${q}%`;
    const inWhere = (extra?: ReturnType<typeof and>) => and(extra, q ? or(ilike(inboundEmails.fromEmail, like), ilike(inboundEmails.fromName, like), ilike(inboundEmails.subject, like), ilike(inboundEmails.bodyText, like)) : undefined);
    const outWhere = (extra?: ReturnType<typeof and>) => and(extra, q ? or(ilike(mailLog.toEmail, like), ilike(mailLog.subject, like), ilike(mailLog.bodyText, like)) : undefined);
    let items: Item[] = [];
    if (folder === "needs" || folder === "inbox" || folder === "archive") {
      const rows = await db.select().from(inboundEmails).where(inWhere(
        folder === "archive" ? and(eq(inboundEmails.archived, true))
          : folder === "needs" ? and(inArray(inboundEmails.status, ["new", "drafted"]), eq(inboundEmails.archived, false))
          : and(eq(inboundEmails.archived, false)),
      )).orderBy(desc(inboundEmails.receivedAt)).limit(limit).offset(offset);
      items = rows.map(inItem);
    } else if (folder === "sent" || folder === "failed") {
      const rows = await db.select().from(mailLog).where(outWhere(folder === "failed" ? and(eq(mailLog.ok, false)) : and(notInArray(mailLog.kind, BULK_KINDS)))).orderBy(desc(mailLog.sentAt)).limit(limit).offset(offset);
      const ev = await eventsFor(rows.map((r) => r.resendId));
      items = rows.map((r) => outItem(r, ev));
    } else if (folder === "campaigns") {
      // Each campaign once: how many it went to, and how many opened and clicked.
      const rows = await db.execute(sql`
        select b.id, b.subject, b.body_text, b.sent_at, b.recipient_count, b.source,
          (select count(distinct s.email) from broadcast_sends s join broadcast_events e on e.resend_id = s.resend_id and e.event_type = 'opened' where s.broadcast_id = b.id) as opened,
          (select count(distinct s.email) from broadcast_sends s join broadcast_events e on e.resend_id = s.resend_id and e.event_type = 'clicked' where s.broadcast_id = b.id) as clicked
        from broadcasts b
        where b.is_template = false and b.recipient_count > 0 and b.source <> 'one-off' and b.sent_at is not null
          ${q ? sql`and (b.subject ilike ${like} or b.body_text ilike ${like})` : sql``}
        order by b.sent_at desc limit ${limit} offset ${offset}`);
      items = (rows as unknown as Record<string, unknown>[]).map((b) => ({
        key: `c-${b.id}`, dir: "campaign" as const, email: "", name: String(b.source ?? "").startsWith("cadence") ? "Automation" : "Campaign", subject: String(b.subject ?? ""),
        snippet: snippet(String(b.body_text ?? "")), at: String(b.sent_at ?? ""), kind: String(b.source ?? "manual"), status: "sent", ok: true, events: null,
        broadcastId: Number(b.id), count: Number(b.recipient_count ?? 0), opened: Number(b.opened ?? 0), clicked: Number(b.clicked ?? 0),
      }));
    } else {
      // All mail: in and out together, newest first (campaigns stay in Campaigns).
      const [ins, outs] = await Promise.all([
        db.select().from(inboundEmails).where(inWhere(and(eq(inboundEmails.archived, false)))).orderBy(desc(inboundEmails.receivedAt)).limit(limit + offset),
        db.select().from(mailLog).where(outWhere(and(notInArray(mailLog.kind, BULK_KINDS)))).orderBy(desc(mailLog.sentAt)).limit(limit + offset),
      ]);
      const ev = await eventsFor(outs.map((r) => r.resendId));
      items = [...ins.map(inItem), ...outs.map((r) => outItem(r, ev))].sort((a, b) => b.at.localeCompare(a.at)).slice(offset, offset + limit);
    }
    res.json({ folder, items, more: items.length === limit });
  });

  /** How many are waiting, sent today, and didn't send (for the folder badges). */
  app.get("/api/admin/mail/counts", requireAdmin, async (_req, res) => {
    noStore(res);
    await schemaIsReady();
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const [needs] = await db.select({ n: sql<number>`count(*)::int` }).from(inboundEmails).where(and(inArray(inboundEmails.status, ["new", "drafted"]), eq(inboundEmails.archived, false)));
    const [unread] = await db.select({ n: sql<number>`count(*)::int` }).from(inboundEmails).where(and(eq(inboundEmails.readAt, ""), eq(inboundEmails.archived, false)));
    const [today] = await db.select({ n: sql<number>`count(*)::int` }).from(mailLog).where(and(sql`${mailLog.sentAt} >= ${since}`, notInArray(mailLog.kind, BULK_KINDS)));
    const [failed] = await db.select({ n: sql<number>`count(*)::int` }).from(mailLog).where(and(eq(mailLog.ok, false), sql`${mailLog.sentAt} >= ${new Date(Date.now() - 7 * 86400_000).toISOString()}`));
    res.json({ needs: needs?.n ?? 0, unread: unread?.n ?? 0, sentToday: today?.n ?? 0, failedWeek: failed?.n ?? 0 });
  });

  /**
   * Several at once, as a mail app does: read or unread, archive or bring back, no reply needed,
   * or delete (what came in is gone; a sent one leaves the list, it was still sent).
   */
  app.post("/api/admin/mail/bulk", requireAdmin, async (req, res) => {
    await schemaIsReady();
    const keys: string[] = (Array.isArray(req.body?.keys) ? req.body.keys : []).map(String).slice(0, 500);
    const action = String(req.body?.action ?? "");
    const ins = keys.filter((k) => /^in-\d+$/.test(k)).map((k) => Number(k.slice(3)));
    const outs = keys.filter((k) => /^out-\d+$/.test(k)).map((k) => Number(k.slice(4)));
    if (!ins.length && !outs.length) return res.status(400).json({ message: "Pick something first." });
    if (ins.length) {
      if (action === "read") await db.update(inboundEmails).set({ readAt: now() }).where(and(inArray(inboundEmails.id, ins), eq(inboundEmails.readAt, "")));
      else if (action === "unread") await db.update(inboundEmails).set({ readAt: "" }).where(inArray(inboundEmails.id, ins));
      else if (action === "archive") await db.update(inboundEmails).set({ archived: true, readAt: now() }).where(inArray(inboundEmails.id, ins));
      else if (action === "unarchive") await db.update(inboundEmails).set({ archived: false }).where(inArray(inboundEmails.id, ins));
      else if (action === "noreply") await db.update(inboundEmails).set({ status: "ignored", readAt: now() }).where(and(inArray(inboundEmails.id, ins), inArray(inboundEmails.status, ["new", "drafted"])));
      else if (action === "delete") await db.delete(inboundEmails).where(inArray(inboundEmails.id, ins));
    }
    if (outs.length && action === "delete") await db.delete(mailLog).where(inArray(mailLog.id, outs));
    res.json({ ok: true, done: ins.length + outs.length });
  });

  /** One person's whole conversation with us: what they wrote, and everything we sent them. */
  app.get("/api/admin/mail/thread", requireAdmin, async (req, res) => {
    noStore(res);
    await schemaIsReady();
    const email = String(req.query.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return res.status(400).json({ message: "Whose conversation?" });
    const [ins, outs, [contact]] = await Promise.all([
      db.select().from(inboundEmails).where(sql`lower(${inboundEmails.fromEmail}) = ${email}`).orderBy(inboundEmails.receivedAt),
      db.select().from(mailLog).where(eq(mailLog.toEmail, email)).orderBy(mailLog.sentAt),
      db.select().from(contacts).where(sql`lower(${contacts.email}) = ${email}`).limit(1),
    ]);
    const ev = await eventsFor(outs.map((r) => r.resendId));
    const messages = [
      ...ins.map((r) => ({ key: `in-${r.id}`, dir: "in" as const, at: r.receivedAt, subject: r.subject, body: said(r.bodyText) || r.bodyText, from: r.fromName || r.fromEmail, kind: r.category || "other",
        inbound: { id: r.id, status: r.status, draftFrom: r.draftFrom, draftSubject: r.draftSubject, draftText: r.draftText, summary: r.summary } })),
      ...outs.map((r) => ({ key: `out-${r.id}`, dir: "out" as const, at: r.sentAt, subject: r.subject, body: r.bodyText, from: r.fromAddr, kind: r.kind, ok: r.ok, error: r.error, events: ev.get(r.resendId) ?? null })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    const name = ins.find((r) => r.fromName)?.fromName || [contact?.firstName, contact?.lastName].filter(Boolean).join(" ") || email;
    res.json({ email, name, contact: contact ? { status: contact.status, lifecycleStage: contact.lifecycleStage, source: contact.source } : null, messages });
  });

  /** One campaign: its words, and how it did. */
  app.get("/api/admin/mail/campaign/:id", requireAdmin, async (req, res) => {
    noStore(res);
    const [b] = await db.select().from(broadcasts).where(eq(broadcasts.id, Number(req.params.id))).limit(1);
    if (!b) return res.status(404).json({ message: "No such campaign." });
    const stats = await db.execute(sql`
      select e.event_type as type, count(distinct s.email)::int as n
      from broadcast_sends s join broadcast_events e on e.resend_id = s.resend_id
      where s.broadcast_id = ${b.id} group by e.event_type`);
    const by = Object.fromEntries((stats as unknown as { type: string; n: number }[]).map((r) => [r.type, Number(r.n)]));
    res.json({ id: b.id, subject: b.subject, body: b.bodyText, sentAt: b.sentAt, recipients: b.recipientCount, source: b.source, delivered: by.delivered ?? 0, opened: by.opened ?? 0, clicked: by.clicked ?? 0, bounced: by.bounced ?? 0, complained: by.complained ?? 0 });
  });
}

/**
 * The mail log starts today; what we sent before is in broadcast_sends (campaigns, one-offs,
 * replies and acknowledgements). Copied in once, labelled as best we know.
 */
export async function backfillMailLog(): Promise<number> {
  await schemaIsReady();
  const r = await db.execute(sql`
    insert into mail_log (to_email, from_addr, subject, kind, body_text, resend_id, ok, error, reply_to, sent_at)
    select lower(s.email), '', coalesce(b.subject, ''),
      case when i_reply.id is not null then 'reply' when i_ack.id is not null then 'ack'
           when b.source = 'one-off' then 'one-off' when b.source like 'cadence%' then 'cadence' else 'campaign' end,
      coalesce(i_reply.reply_text, i_ack.ack_text, b.body_text, ''), coalesce(s.resend_id, ''), true, '', '', s.sent_at
    from broadcast_sends s
    left join broadcasts b on b.id = s.broadcast_id
    left join inbound_emails i_reply on i_reply.reply_resend_id <> '' and i_reply.reply_resend_id = s.resend_id
    left join inbound_emails i_ack on i_ack.ack_resend_id <> '' and i_ack.ack_resend_id = s.resend_id
    where s.sent_at is not null and not exists (select 1 from mail_log m where m.resend_id <> '' and m.resend_id = s.resend_id)`);
  return (r as unknown as { count?: number }).count ?? 0;
}
