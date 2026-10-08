// The admin's front page numbers (8 Oct 2026): what Andrew checks first — texts,
// surveys, clips made and posted, new events, and who's waiting on a reply —
// in one call, so the overview isn't eight requests deep.
import type { Express, RequestHandler } from "express";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "./storage.js";
import { clips, events, hostPosts, inboundEmails, smsMessages, smsOptOuts, surveyInvites } from "../shared/schema.js";

const n = (r: { n: number }[] | undefined) => Number(r?.[0]?.n ?? 0);

export function registerAdminOverview(app: Express, requireAdmin: RequestHandler) {
  app.get("/api/admin/overview", requireAdmin, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const month = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const count = sql<number>`count(*)::int`;

    const [textsOut, textsDelivered, textsFailed, textsIn, optOuts, optOutsWeek] = await Promise.all([
      db.select({ n: count }).from(smsMessages).where(and(eq(smsMessages.direction, "out"), gte(smsMessages.createdAt, week))),
      db.select({ n: count }).from(smsMessages).where(and(eq(smsMessages.direction, "out"), eq(smsMessages.status, "delivered"), gte(smsMessages.createdAt, week))),
      db.select({ n: count }).from(smsMessages).where(and(eq(smsMessages.direction, "out"), eq(smsMessages.status, "failed"), gte(smsMessages.createdAt, week))),
      db.select({ n: count }).from(smsMessages).where(and(eq(smsMessages.direction, "in"), gte(smsMessages.createdAt, week))),
      db.select({ n: count }).from(smsOptOuts),
      db.select({ n: count }).from(smsOptOuts).where(gte(smsOptOuts.createdAt, week)),
    ]);

    const [surveyInvited, surveyDone, surveyWeek] = await Promise.all([
      db.select({ n: count }).from(surveyInvites),
      db.select({ n: count }).from(surveyInvites).where(sql`${surveyInvites.completedAt} <> ''`),
      db.select({ n: count }).from(surveyInvites).where(and(sql`${surveyInvites.completedAt} <> ''`, gte(surveyInvites.completedAt, week))),
    ]);

    const [clipsWeek, episodesWeek, postsSent, postsScheduled] = await Promise.all([
      db.select({ n: count }).from(clips).where(gte(clips.createdAt, week)),
      db.select({ n: sql<number>`count(distinct ${clips.recordingId})::int` }).from(clips).where(gte(clips.createdAt, week)),
      db.select({ n: count }).from(hostPosts).where(and(eq(hostPosts.status, "sent"), gte(hostPosts.createdAt, week))),
      db.select({ n: count }).from(hostPosts).where(eq(hostPosts.status, "scheduled")),
    ]);

    const newEvents = await db
      .select({ id: events.id, name: events.name, startAtUtc: events.startAtUtc, createdAt: events.createdAt, review: events.review, visible: events.visible })
      .from(events)
      .where(gte(events.createdAt, month))
      .orderBy(desc(events.createdAt))
      .limit(6);

    // Who's waiting on us: everyone who wrote in and hasn't had a person's reply, oldest first.
    const waiting = await db
      .select({ id: inboundEmails.id, fromName: inboundEmails.fromName, fromEmail: inboundEmails.fromEmail, subject: inboundEmails.subject, summary: inboundEmails.summary, receivedAt: inboundEmails.receivedAt, toAddr: inboundEmails.toAddr, ackAt: inboundEmails.ackAt })
      .from(inboundEmails)
      .where(and(inArray(inboundEmails.status, ["new", "drafted"]), eq(inboundEmails.archived, false)))
      .orderBy(inboundEmails.receivedAt)
      .limit(12);

    res.json({
      texts: { sent: n(textsOut), delivered: n(textsDelivered), failed: n(textsFailed), replies: n(textsIn), optOuts: n(optOuts), optOutsWeek: n(optOutsWeek) },
      survey: { invited: n(surveyInvited), done: n(surveyDone), week: n(surveyWeek) },
      clips: { week: n(clipsWeek), episodes: n(episodesWeek), posted: n(postsSent), scheduled: n(postsScheduled) },
      newEvents,
      waiting,
    });
  });
}
