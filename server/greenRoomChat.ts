// The green room chat, with a person behind it.
//
// Podcasters waiting to go on ask Alex by text. Every conversation is kept,
// so the producer (Michael — Andrew, on the day) watches them all live and can
// take any one over. Alex hands a conversation to him herself when it's not
// hers to answer: she ends her reply with a tag, which never reaches the
// screen, and the thread is flagged for him and Slack hears. He can also switch
// Alex off for the whole green room, and then every question comes to him.
import type { Express, RequestHandler } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { greenRoomChats, greenRoomMessages, type GreenRoomChatRow } from "../shared/schema.js";
import { alexAnswer, HANDOFF_TAG, type AlexTurn } from "./alex.js";
import { slackNote } from "./slack.js";

const now = () => new Date().toISOString();
const alexKey = (eventId: number) => `alex_greenroom:${eventId}`;
export const PRODUCER_NAME = "Michael";

async function alexOn(eventId: number): Promise<boolean> {
  return ((await storage.getSetting(alexKey(eventId))) ?? "on") !== "off";
}

/** Which event the chat belongs to: the studio's, or the featured one. */
async function eventFor(studioId: unknown): Promise<number> {
  const id = Number(studioId);
  if (id > 0) {
    const st = await storage.getStudioById(id).catch(() => undefined);
    if (st) return st.eventId;
  }
  return (await storage.getFeaturedEvent()).id;
}

async function threadFor(eventId: number, email: string): Promise<GreenRoomChatRow> {
  await schemaIsReady();
  const e = email.trim().toLowerCase();
  const [have] = await db.select().from(greenRoomChats).where(and(eq(greenRoomChats.eventId, eventId), eq(greenRoomChats.email, e))).limit(1);
  if (have) return have;
  const sg = (await storage.listSignups(eventId)).find((x) => x.status !== "cancelled" && x.email.trim().toLowerCase() === e);
  const prof = sg ? undefined : await storage.getProfileByEmail(e).catch(() => undefined);
  const [made] = await db.insert(greenRoomChats).values({
    eventId, email: e,
    name: sg?.hostName.trim() || prof?.hostName?.trim() || "",
    show: sg?.podcastName.trim() || prof?.podcastName?.trim() || "",
    createdAt: now(), lastAt: now(),
  }).onConflictDoNothing().returning();
  if (made) return made;
  const [again] = await db.select().from(greenRoomChats).where(and(eq(greenRoomChats.eventId, eventId), eq(greenRoomChats.email, e))).limit(1);
  return again;
}

async function say(chatId: number, role: "user" | "alex" | "producer", content: string, author = "") {
  const at = now();
  await db.insert(greenRoomMessages).values({ chatId, role, author, content, createdAt: at });
  await db.update(greenRoomChats).set({ lastAt: at }).where(eq(greenRoomChats.id, chatId));
}

const messagesOf = (chatId: number) => db.select().from(greenRoomMessages).where(eq(greenRoomMessages.chatId, chatId)).orderBy(asc(greenRoomMessages.id));

export function registerGreenRoomChat(app: Express, requireAdmin: RequestHandler, requireHostSession: RequestHandler): void {
  /**
   * A podcaster writes. Kept, then answered by Alex as it's written (streamed
   * text), unless Michael has the thread or Alex is switched off: then it waits
   * for him and the reply is JSON saying so.
   */
  app.post("/api/host/alex/chat", requireHostSession, async (req, res) => {
    const email = String((req as unknown as { hostEmail?: string }).hostEmail ?? "");
    // The text, or (older pages) the last of the messages they send.
    const raw = Array.isArray(req.body?.messages) ? (req.body.messages as { role?: string; content?: string }[]) : [];
    const text = String(req.body?.text ?? [...raw].reverse().find((m) => m?.role === "user")?.content ?? "").trim().slice(0, 2000);
    if (!text) return res.status(400).json({ message: "Say something first." });
    const eventId = await eventFor(req.body?.studioId);
    const chat = await threadFor(eventId, email);
    await say(chat.id, "user", text);

    // Straight to Michael: the studio host's button, or anything once he has the thread.
    const direct = req.body?.toProducer === true;
    if (direct || chat.mode === "producer" || !(await alexOn(eventId))) {
      await db.update(greenRoomChats).set({ needsProducer: true, ...(direct ? { mode: "producer" } : {}) }).where(eq(greenRoomChats.id, chat.id));
      if (direct) void slackNote(`${req.body?.urgent === true ? ":rotating_light: URGENT from the studio" : ":speech_balloon: Studio"}: ${chat.name || chat.email} needs ${PRODUCER_NAME}. "${text.slice(0, 200)}"`, { label: "Open the green room chat", url: "/admin/greenroom" });
      return res.json({ waiting: true });
    }

    const history = (await messagesOf(chat.id)).slice(-12);
    const turns: AlexTurn[] = history.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.role === "producer" ? `(${PRODUCER_NAME}, the producer:) ${m.content}` : m.content,
    }));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders?.();
    // The hand-off tag comes at the end and must never reach the screen, so
    // anything that could be the start of it is held back until it can't be.
    let all = "";
    let sent = 0;
    try {
      for await (const piece of alexAnswer(turns, email)) {
        all += piece;
        let safe = all.indexOf(HANDOFF_TAG);
        if (safe < 0) {
          // Hold back the longest tail that could still become the tag.
          safe = all.length;
          for (let k = Math.min(HANDOFF_TAG.length - 1, all.length); k > 0; k--) {
            if (HANDOFF_TAG.startsWith(all.slice(-k))) { safe = all.length - k; break; }
          }
        }
        if (safe > sent) {
          res.write(all.slice(sent, safe));
          sent = safe;
        }
      }
    } catch (err) {
      console.error("Alex chat failed:", err);
      all += all ? "" : "I've lost my train of thought. Michael, the producer, will answer you here. " + HANDOFF_TAG;
    }
    const handoff = all.includes(HANDOFF_TAG);
    const clean = all.split(HANDOFF_TAG).join("").trim();
    if (clean.length > sent) res.write(clean.slice(sent));
    res.end();
    if (clean) await say(chat.id, "alex", clean, "Alex");
    if (handoff) {
      await db.update(greenRoomChats).set({ mode: "producer", needsProducer: true }).where(eq(greenRoomChats.id, chat.id));
      void slackNote(`:raising_hand: Green room: ${chat.name || chat.email}${chat.show ? ` (${chat.show})` : ""} needs ${PRODUCER_NAME}. "${text.slice(0, 200)}"`, { label: "Open the green room chat", url: "/admin/greenroom" });
    }
  });

  /** Their conversation so far, polled, so Michael's replies appear without a reload. */
  app.get("/api/host/alex/thread", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const email = String((req as unknown as { hostEmail?: string }).hostEmail ?? "");
    const eventId = await eventFor(req.query.studioId);
    await schemaIsReady();
    const [chat] = await db.select().from(greenRoomChats).where(and(eq(greenRoomChats.eventId, eventId), eq(greenRoomChats.email, email.trim().toLowerCase()))).limit(1);
    const on = await alexOn(eventId);
    if (!chat) return res.json({ alexOn: on, mode: "alex", messages: [] });
    res.json({
      alexOn: on,
      mode: chat.mode,
      messages: (await messagesOf(chat.id)).map((m) => ({ id: m.id, role: m.role, content: m.content, at: m.createdAt })),
    });
  });

  // ---- The producer's desk (admins only; not studio hosts) -----------------

  app.get("/api/admin/greenroom/chats", requireAdmin, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if ((req as any).studioHost) return res.status(403).json({ message: "Admins only." });
    await schemaIsReady();
    const eventId = Number(req.query.eventId) || (await storage.getFeaturedEvent()).id;
    const chats = await db.select().from(greenRoomChats).where(eq(greenRoomChats.eventId, eventId)).orderBy(desc(greenRoomChats.lastAt)).limit(200);
    const out = [];
    for (const c of chats) {
      const [last] = await db.select().from(greenRoomMessages).where(eq(greenRoomMessages.chatId, c.id)).orderBy(desc(greenRoomMessages.id)).limit(1);
      out.push({ id: c.id, name: c.name, show: c.show, email: c.email, mode: c.mode, needsProducer: c.needsProducer, lastAt: c.lastAt, last: last ? { role: last.role, content: last.content.slice(0, 140) } : null });
    }
    res.json({ alexOn: await alexOn(eventId), chats: out });
  });

  app.get("/api/admin/greenroom/chats/:id", requireAdmin, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if ((req as any).studioHost) return res.status(403).json({ message: "Admins only." });
    await schemaIsReady();
    const [chat] = await db.select().from(greenRoomChats).where(eq(greenRoomChats.id, Number(req.params.id))).limit(1);
    if (!chat) return res.status(404).json({ message: "No such chat." });
    res.json({ chat, messages: await messagesOf(chat.id) });
  });

  /** Michael answers. Answering takes the thread: Alex stays quiet in it until he hands it back. */
  app.post("/api/admin/greenroom/chats/:id/reply", requireAdmin, async (req, res) => {
    if ((req as any).studioHost) return res.status(403).json({ message: "Admins only." });
    const text = String(req.body?.text ?? "").trim().slice(0, 2000);
    if (!text) return res.status(400).json({ message: "Write something first." });
    const id = Number(req.params.id);
    await say(id, "producer", text, PRODUCER_NAME);
    await db.update(greenRoomChats).set({ mode: "producer", needsProducer: false }).where(eq(greenRoomChats.id, id));
    res.json({ ok: true });
  });

  /** Take a thread from Alex, or hand it back to her. */
  app.post("/api/admin/greenroom/chats/:id/mode", requireAdmin, async (req, res) => {
    if ((req as any).studioHost) return res.status(403).json({ message: "Admins only." });
    const mode = req.body?.mode === "producer" ? "producer" : "alex";
    await db.update(greenRoomChats).set({ mode, ...(mode === "alex" ? { needsProducer: false } : {}) }).where(eq(greenRoomChats.id, Number(req.params.id)));
    res.json({ ok: true, mode });
  });

  /** Alex in the green room at all: off, and every question comes to Michael. */
  app.put("/api/admin/greenroom/alex", requireAdmin, async (req, res) => {
    if ((req as any).studioHost) return res.status(403).json({ message: "Admins only." });
    const eventId = Number(req.body?.eventId) || (await storage.getFeaturedEvent()).id;
    await storage.setSetting(alexKey(eventId), req.body?.on === false ? "off" : "on");
    res.json({ alexOn: req.body?.on !== false });
  });
}
