import type { Express, RequestHandler } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { eq, sql } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { signedRecordingUrl } from "./recordingStorage.js";
import { readFeed } from "./hosting.js";
import { bioPages, hostedShows, hostedEpisodes, showTranscripts, transcriptChunks, type BioPageRow } from "../shared/schema.js";

/**
 * Ask my show: an AI that answers listeners on the podcaster's page from what
 * was actually said on the show. Every episode is transcribed (the worker,
 * with the same transcriber the clips use), cut into passages of about a
 * minute, and searched when a listener asks; Claude answers from the best
 * passages only and says which episode and minute, so the listener can press
 * play right there. What it can't answer, it offers to send to the host.
 */

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const now = () => new Date().toISOString();
type Line = [number, number, string, string];

/** Passages of ~110 words, each with the second it starts at. */
function chunk(lines: Line[]): { startSec: number; text: string }[] {
  const out: { startSec: number; text: string }[] = [];
  let buf: string[] = [];
  let start = 0;
  let words = 0;
  for (const [s, , , text] of lines) {
    if (!buf.length) start = s;
    buf.push(text.trim());
    words += text.split(/\s+/).length;
    if (words >= 110) { out.push({ startSec: Math.floor(start), text: buf.join(" ") }); buf = []; words = 0; }
  }
  if (buf.length) out.push({ startSec: Math.floor(start), text: buf.join(" ") });
  return out.filter((c) => c.text.length > 20);
}

async function store(id: number, email: string, lines: Line[]) {
  await db.delete(transcriptChunks).where(eq(transcriptChunks.transcriptId, id));
  const rows = chunk(lines).map((c) => ({ transcriptId: id, email, startSec: c.startSec, text: c.text.slice(0, 4000) }));
  for (let i = 0; i < rows.length; i += 300) await db.insert(transcriptChunks).values(rows.slice(i, i + 300));
  await db.update(showTranscripts).set({ status: "done", lines: JSON.stringify(lines), error: "" }).where(eq(showTranscripts.id, id));
}

/**
 * Line up every episode to learn: all of a show hosted here (a Library
 * recording's transcript is used as it is), or the latest 25 from their feed.
 * Idempotent; the worker does the rest.
 */
export async function syncKnowledge(email: string): Promise<void> {
  await schemaIsReady();
  // One that failed (the transcriber was down, a bill unpaid) tries again after a few hours, by itself.
  const retry = new Date(Date.now() - 3 * 3600_000).toISOString();
  await db.execute(sql`UPDATE show_transcripts SET status = 'queued', error = '' WHERE email = ${email} AND status = 'failed' AND claimed_at < ${retry} AND error NOT LIKE 'No audio%' AND error NOT LIKE 'Nothing was said%'`);
  const have = new Set((await db.select({ k: showTranscripts.episodeKey }).from(showTranscripts).where(eq(showTranscripts.email, email))).map((r) => r.k));
  const [show] = await db.select().from(hostedShows).where(eq(hostedShows.email, email)).orderBy(hostedShows.id).limit(1);
  const add: (typeof showTranscripts.$inferInsert)[] = [];
  if (show) {
    const eps = (await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.showId, show.id)))
      .filter((e) => e.status === "published" && (e.audioKey || e.audioUrl));
    for (const e of eps) {
      const key = `hosted:${e.id}`;
      if (have.has(key)) continue;
      let lines: Line[] = [];
      if (e.recordingId) {
        const rec = await storage.getRecording(e.recordingId).catch(() => undefined);
        try { lines = rec?.transcriptJson ? JSON.parse(rec.transcriptJson) : []; } catch { lines = []; }
      }
      add.push({ email, episodeKey: key, title: e.title, publishedAt: e.publishedAt, audioUrl: `${ORIGIN}/e/${e.id}.${/mp4|m4a|aac/.test(e.mime) ? "m4a" : "mp3"}`, status: lines.length ? "done" : "queued", lines: lines.length ? JSON.stringify(lines) : "", createdAt: now() });
    }
  } else {
    const [page] = await db.select().from(bioPages).where(eq(bioPages.email, email)).limit(1);
    const url = page?.rssUrl?.trim();
    if (url && /^https?:\/\//.test(url)) {
      const feed = await readFeed(url).catch(() => null);
      for (const it of (feed?.items ?? []).slice().sort((a, b) => b.published.localeCompare(a.published)).slice(0, 25)) {
        const key = `rss:${it.guid}`.slice(0, 400);
        if (have.has(key)) continue;
        add.push({ email, episodeKey: key, title: it.title, publishedAt: it.published, audioUrl: it.url, status: "queued", createdAt: now() });
      }
    }
  }
  if (!add.length) return;
  const made = await db.insert(showTranscripts).values(add).onConflictDoNothing().returning();
  // The ones that came with a transcript are searchable straight away.
  for (const r of made) if (r.status === "done" && r.lines) await store(r.id, email, JSON.parse(r.lines) as Line[]);
}

/** The worker's next episode to transcribe (a stuck one is taken back after an hour). */
export async function claimTranscript(): Promise<{ id: number; title: string; url: string } | null> {
  await schemaIsReady();
  const stale = new Date(Date.now() - 60 * 60_000).toISOString();
  const rows = await db.execute(sql`
    UPDATE show_transcripts SET status = 'running', claimed_at = ${now()}
    WHERE id = (SELECT id FROM show_transcripts WHERE status = 'queued' OR (status = 'running' AND claimed_at < ${stale}) ORDER BY id DESC LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id, title, episode_key, audio_url`);
  const r = (rows as unknown as { id: number; title: string; episode_key: string; audio_url: string }[])[0];
  if (!r) return null;
  // A hosted episode is fetched from storage directly, so learning it isn't counted as a listen.
  let url = r.audio_url;
  const m = r.episode_key.match(/^hosted:(\d+)$/);
  if (m) {
    const [e] = await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.id, Number(m[1]))).limit(1);
    url = e?.audioKey ? await signedRecordingUrl(e.audioKey, 6 * 3600) : e?.audioUrl || "";
  }
  if (!/^https?:\/\//.test(url)) {
    await db.update(showTranscripts).set({ status: "failed", error: "No audio to learn from." }).where(eq(showTranscripts.id, r.id));
    return null;
  }
  return { id: r.id, title: r.title, url };
}

export async function knowledgeOf(email: string): Promise<{ done: number; total: number }> {
  const rows = await db.select({ status: showTranscripts.status, n: sql<number>`count(*)::int` }).from(showTranscripts).where(eq(showTranscripts.email, email)).groupBy(showTranscripts.status);
  const total = rows.filter((r) => r.status !== "failed").reduce((a, r) => a + r.n, 0);
  return { done: rows.find((r) => r.status === "done")?.n ?? 0, total };
}

type Passage = { id: number; start_sec: number; text: string; transcript_id: number; title: string; audio_url: string; published_at: string; rank: number };

/**
 * The passages most like the question: Postgres full-text search, any of its
 * words, best first. Asked about one episode, only that episode's, topped up
 * with passages from across it so "what's it about?" has the whole of it to go on.
 */
async function passages(email: string, question: string, episode = ""): Promise<Passage[]> {
  const words = Array.from(new Set(question.toLowerCase().match(/[a-z0-9']{3,}/g) ?? [])).slice(0, 24).map((w) => w.replace(/'/g, ""));
  const only = episode ? sql`AND t.title = ${episode}` : sql``;
  const tsq = words.join(" | ");
  const hits = words.length ? (await db.execute(sql`
    SELECT c.id, c.start_sec, c.text, c.transcript_id, t.title, t.audio_url, t.published_at,
           ts_rank_cd(to_tsvector('english', c.text), to_tsquery('english', ${tsq})) AS rank
    FROM transcript_chunks c JOIN show_transcripts t ON t.id = c.transcript_id
    WHERE c.email = ${email} ${only} AND to_tsvector('english', c.text) @@ to_tsquery('english', ${tsq})
    ORDER BY rank DESC LIMIT 10`).catch(() => [] as unknown[])) as unknown as Passage[] : [];
  if (!episode || hits.length >= 6) return hits;
  const all = (await db.execute(sql`
    SELECT c.id, c.start_sec, c.text, c.transcript_id, t.title, t.audio_url, t.published_at, 0 AS rank
    FROM transcript_chunks c JOIN show_transcripts t ON t.id = c.transcript_id
    WHERE c.email = ${email} ${only} ORDER BY c.start_sec`).catch(() => [] as unknown[])) as unknown as Passage[];
  const step = Math.max(1, Math.floor(all.length / 12));
  const spread = all.filter((_, i) => i % step === 0).slice(0, 12);
  const seen = new Set(hits.map((h) => h.id));
  return [...hits, ...spread.filter((p) => !seen.has(p.id))].slice(0, 16);
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function registerAskShow(app: Express, requireAgent: RequestHandler) {
  app.post("/api/agent/transcripts/:id/done", requireAgent, async (req, res) => {
    const id = Number(req.params.id);
    const [t] = await db.select().from(showTranscripts).where(eq(showTranscripts.id, id)).limit(1);
    if (!t) return res.status(404).json({ message: "No such transcript." });
    const lines = (Array.isArray(req.body?.lines) ? req.body.lines : [])
      .map((l: { startSec?: number; endSec?: number; speaker?: string; text?: string }) => [Number(l.startSec) || 0, Number(l.endSec) || 0, String(l.speaker ?? ""), String(l.text ?? "")] as Line)
      .filter((l: Line) => l[3].trim());
    if (!lines.length) {
      await db.update(showTranscripts).set({ status: "failed", error: "Nothing was said we could hear." }).where(eq(showTranscripts.id, id));
      return res.json({ ok: true });
    }
    await store(id, t.email, lines);
    res.json({ ok: true });
  });
  app.post("/api/agent/transcripts/:id/failed", requireAgent, async (req, res) => {
    await db.update(showTranscripts).set(req.body?.requeue ? { status: "queued" } : { status: "failed", error: String(req.body?.error ?? "").slice(0, 300) }).where(eq(showTranscripts.id, Number(req.params.id)));
    res.json({ ok: true });
  });

  // A listener asks the show. Answers only from the transcripts, with where it was said.
  const recent = new Map<string, number[]>();
  app.post("/api/public/bio/:handle/ask-ai", async (req, res) => {
    await schemaIsReady();
    const [page] = await db.select().from(bioPages).where(eq(bioPages.handle, String(req.params.handle).toLowerCase())).limit(1);
    if (!page || !page.published || !page.aiEnabled) return res.status(404).json({ message: "Ask my show is off for this page." });
    const ip = String(req.ip ?? "");
    const hits = (recent.get(ip) ?? []).filter((t) => Date.now() - t < 3600_000);
    if (hits.length >= 20) return res.status(429).json({ message: "That's a lot of questions. Try again in a while." });
    recent.set(ip, [...hits, Date.now()]);
    const question = String(req.body?.question ?? "").trim().slice(0, 500);
    if (question.length < 4) return res.status(400).json({ message: "Ask a question first." });
    const history = (Array.isArray(req.body?.history) ? req.body.history : []).slice(-4)
      .map((h: { role?: string; content?: string }) => ({ role: h.role === "assistant" ? "assistant" as const : "user" as const, content: String(h.content ?? "").slice(0, 1500) }))
      .filter((h: { content: string }) => h.content);
    const episode = String(req.body?.episode ?? "").trim().slice(0, 400);
    const asked = [question, ...history.filter((h: { role: string }) => h.role === "user").map((h: { content: string }) => h.content)].join(" ");
    // About one episode: its own passages; if it hasn't been learned yet, the whole show's.
    let found = episode ? await passages(page.email, asked, episode) : [];
    const scoped = found.length > 0;
    if (!scoped) found = await passages(page.email, asked);
    const k = await knowledgeOf(page.email);
    if (!found.length) {
      return res.json({ answer: k.done ? `I couldn't find that in the episodes I've learned. ${page.displayName || "The host"} would know${page.askEnabled ? ": message them with the chat button in the corner" : ""}.` : `I'm still learning ${page.displayName || "this show"}'s episodes. Try again soon${page.askEnabled ? ", or message them with the chat button in the corner" : ""}.`, sources: [], unanswered: true });
    }
    const excerpts = found.map((f, i) => `[${i + 1}] "${f.title}" at ${mmss(f.start_sec)}:\n${f.text}`).join("\n\n");
    const who = page.displayName || "the host";
    try {
      const client = new Anthropic();
      const out = await client.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 700,
        system: `You answer listeners' questions on ${who}'s podcast page, on ${who}'s behalf: you are the show's AI, not ${who} in person, and you say so if asked. Answer ONLY from the transcript excerpts below, which are from the show's own episodes${scoped ? ` (the listener is asking about the episode "${episode}", and these are from it)` : ""}. Be warm, plain and brief (2 to 5 sentences), the way ${who} would put it. Put the excerpt number in square brackets after each point that uses it, like [2]. If the excerpts don't answer the question, say you couldn't find it on the show and suggest messaging ${who} with the chat button in the corner of the page; never guess, never add facts that aren't in them. No medical, legal or financial advice beyond what was said on the show, and say it's what was said on the show.\n\nExcerpts:\n\n${excerpts}`,
        messages: [...history, { role: "user", content: question }],
      });
      const text = out.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("").trim();
      const cited = Array.from(new Set(Array.from(text.matchAll(/\[(\d+)\]/g)).map((m) => Number(m[1]) - 1))).filter((i) => found[i]);
      const sources = cited.map((i) => ({ n: i + 1, title: found[i].title, startSec: found[i].start_sec, audio: found[i].audio_url, at: mmss(found[i].start_sec) }));
      res.json({ answer: text, sources, unanswered: !cited.length });
    } catch (err) {
      console.error("Ask my show failed:", (err as Error).message);
      res.status(502).json({ message: "The show's AI is taking a break. Try again in a moment, or send your question to the host." });
    }
  });
}

export async function aiFor(row: BioPageRow): Promise<{ enabled: boolean; episodes: number }> {
  if (!row.aiEnabled) return { enabled: false, episodes: 0 };
  const k = await knowledgeOf(row.email).catch(() => ({ done: 0, total: 0 }));
  return { enabled: k.done > 0, episodes: k.done };
}

