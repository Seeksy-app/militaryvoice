// Move a hosted show to another account (Andrew, 23 Nov 2026: "Yes, build Move"). Made for Veteran Benefits
// Podcast, which has to leave the Work Ready account without losing its feed: deleting a show switches its
// feed off, and every app that reads it through the old host's redirect would lose the subscribers.
//
// What moves with a show (audited 23 Nov across every table tied to a show by id or by owner email):
// - hosted_shows.email: the show itself, with the feed name (slug), guid, artwork, owner fields, directories,
//   Apple/Spotify links, intro/outro and settings. The slug never changes, so /feed/<slug> and the old host's
//   301 keep working.
// - By show id, so they follow on their own: hosted_episodes, hosted_downloads (the download history),
//   hosted_feed_hits (which apps read the feed), hosted_spots (sponsor spots), settings feed-alias:<slug>.
// - host_posts of kind "episode" for its episodes (YouTube posting history), by email: moved.
// - show_transcripts (email + "hosted:<episode id>") and their transcript_chunks: the ones for its episodes move,
//   so Ask my show and the show website keep them.
// - The SmartLink (bio_pages, one per account), with listener_questions; bio_events, bio_subscribers and
//   site-off:<page id> follow by page id. Only when the old account has no other show and the new one has no
//   SmartLink yet: the page lists every hosted show of its owner, so it goes where the show goes.
// - podcast_stats (Apple/Spotify/Buzzsprout connections, one per account and source): only when the old account
//   has no other show, and only sources the new account doesn't have.
// What stays: Library recordings and folders (an episode's folder is cleared, its recording link is kept and the
// file stays in the old Library), the old account's YouTube connection (new uploads use the new owner's), and
// the feed's owner email (ownerEmail / ownerEmailVerified), which is the email Apple shows and is left alone.
//
// Each move is written to setting "show-moves" (newest first) with every row id it touched, so it can be undone.
import type { Express, RequestHandler } from "express";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { getSessionEmail } from "./session.js";
import { bioPages, hostPosts, hostedDownloads, hostedEpisodes, hostedFeedHits, hostedShows, hostedSpots, listenerQuestions, podcastStats, showTranscripts, transcriptChunks } from "../shared/schema.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const LOG = "show-moves";
const lc = (s: unknown) => String(s ?? "").trim().toLowerCase();
const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

type MoveLog = {
  id: string; showId: number; title: string; slug: string; from: string; to: string; at: string; by: string;
  posts: number[]; transcripts: number[]; pageId: number; stats: number[]; folders: { id: number; folderId: number }[];
  feedBefore: number; feedAfter: number; undoneAt?: string;
};
async function readLog(): Promise<MoveLog[]> {
  try { const v = JSON.parse((await storage.getSetting(LOG)) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
const writeLog = (l: MoveLog[]) => storage.setSetting(LOG, JSON.stringify(l.slice(0, 200)));

/** How many items the feed has right now (read with ?preview=1, so it isn't counted as an app's visit). */
async function feedItems(slug: string): Promise<{ status: number; items: number }> {
  try {
    const r = await fetch(`${ORIGIN}/feed/${slug}?preview=1`, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    const xml = r.status === 200 ? await r.text() : "";
    return { status: r.status, items: (xml.match(/<item[\s>]/g) ?? []).length };
  } catch { return { status: 0, items: 0 }; }
}

/** Everything a move would touch, without touching it. */
export async function plan(showId: number, toRaw: string) {
  const to = lc(toRaw);
  const [show] = await db.select().from(hostedShows).where(eq(hostedShows.id, showId)).limit(1);
  if (!show) return { error: "No such show." };
  const from = lc(show.email);
  if (!isEmail(to)) return { error: "Type the email of the account it goes to." };
  if (to === from) return { error: "It's already on that account." };
  const profile = await storage.getProfileByEmail(to).catch(() => undefined);
  if (!profile) return { error: `There's no account for ${to} yet. Make the account first, then move the show.` };

  const eps = await db.select({ id: hostedEpisodes.id, status: hostedEpisodes.status, folderId: hostedEpisodes.folderId, recordingId: hostedEpisodes.recordingId, youtube: hostedEpisodes.youtube }).from(hostedEpisodes).where(eq(hostedEpisodes.showId, showId));
  const epIds = eps.map((e) => e.id);
  const keys = epIds.map((id) => `hosted:${id}`);
  const [[dl], [hits], [spots], posts, trs, others, [pageFrom], [pageTo], statsFrom, statsTo] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(hostedDownloads).where(eq(hostedDownloads.showId, showId)),
    db.select({ n: sql<number>`count(*)::int` }).from(hostedFeedHits).where(eq(hostedFeedHits.showId, showId)),
    db.select({ n: sql<number>`count(*)::int` }).from(hostedSpots).where(eq(hostedSpots.showId, showId)),
    epIds.length ? db.select({ id: hostPosts.id }).from(hostPosts).where(and(eq(hostPosts.kind, "episode"), inArray(hostPosts.refId, epIds), eq(sql`lower(${hostPosts.email})`, from))) : Promise.resolve([]),
    keys.length ? db.select({ id: showTranscripts.id }).from(showTranscripts).where(and(eq(sql`lower(${showTranscripts.email})`, from), inArray(showTranscripts.episodeKey, keys))) : Promise.resolve([]),
    db.select({ id: hostedShows.id, title: hostedShows.title }).from(hostedShows).where(and(eq(sql`lower(${hostedShows.email})`, from), ne(hostedShows.id, showId))),
    db.select({ id: bioPages.id, handle: bioPages.handle }).from(bioPages).where(eq(sql`lower(${bioPages.email})`, from)).limit(1),
    db.select({ id: bioPages.id, handle: bioPages.handle }).from(bioPages).where(eq(sql`lower(${bioPages.email})`, to)).limit(1),
    db.select({ id: podcastStats.id, source: podcastStats.source }).from(podcastStats).where(eq(sql`lower(${podcastStats.email})`, from)),
    db.select({ source: podcastStats.source }).from(podcastStats).where(eq(sql`lower(${podcastStats.email})`, to)),
  ]);
  const trIds = trs.map((t) => t.id);
  const [chunks] = trIds.length ? await db.select({ n: sql<number>`count(*)::int` }).from(transcriptChunks).where(inArray(transcriptChunks.transcriptId, trIds)) : [{ n: 0 }];
  const alone = others.length === 0;
  const smartlink = pageFrom
    ? { handle: pageFrom.handle, moves: alone && !pageTo, why: !alone ? `${from} has other shows, so its SmartLink stays.` : pageTo ? `${to} already has a SmartLink (/${pageTo.handle}), so /${pageFrom.handle} stays with ${from}.` : "" }
    : null;
  const haveTo = new Set(statsTo.map((s) => s.source));
  const stats = statsFrom.map((s) => ({ id: s.id, source: s.source, moves: alone && !haveTo.has(s.source) }));
  const notes: string[] = [];
  if (lc(show.ownerEmail) === from) notes.push(`The feed's owner email is ${from}, the old account. It stays as it is: change it on the show's settings if Apple should show the new one (it needs a new code).`);
  if (eps.some((e) => e.recordingId)) notes.push(`${eps.filter((e) => e.recordingId).length} episodes were made from Library recordings. Those recordings stay in ${from}'s Library.`);
  if (eps.some((e) => e.folderId)) notes.push(`${eps.filter((e) => e.folderId).length} episodes are in ${from}'s folders. They come out of those folders.`);
  if (eps.some((e) => e.youtube && e.youtube !== "{}" && e.youtube !== "")) notes.push(`Videos already on YouTube stay on ${from}'s channel. New uploads go to ${to}'s YouTube once connected.`);
  if (!alone) notes.push(`${from} keeps ${others.length} other show${others.length === 1 ? "" : "s"}: ${others.map((o) => o.title).join(", ")}.`);
  return {
    show: { id: show.id, title: show.title, slug: show.slug, feed: `${ORIGIN}/feed/${show.slug}`, artworkUrl: show.artworkUrl, ownerEmail: show.ownerEmail },
    from, to, toName: profile.hostName || profile.podcastName || "",
    episodes: eps.length, published: eps.filter((e) => e.status === "published").length,
    downloads: dl?.n ?? 0, feedApps: hits?.n ?? 0, spots: spots?.n ?? 0,
    posts: posts.map((p) => p.id), transcripts: trIds, chunks: chunks?.n ?? 0,
    smartlink, pageId: smartlink?.moves ? pageFrom!.id : 0,
    stats, notes,
    folders: eps.filter((e) => e.folderId).map((e) => ({ id: e.id, folderId: e.folderId })),
  };
}

export function registerShowMove(app: Express, requireAdmin: RequestHandler) {
  /** The preview: what moves, how many, and the feed as it is now. */
  app.get("/api/admin/show-move/preview", requireAdmin, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await schemaIsReady();
    const p = await plan(Number(req.query.showId), String(req.query.to ?? ""));
    if ("error" in p) return res.status(400).json({ message: p.error });
    const feed = await feedItems(p.show.slug);
    const { folders: _f, ...out } = p;
    res.json({ ...out, posts: p.posts.length, transcripts: p.transcripts.length, feed });
  });

  /** The move. One transaction; the feed is read before and after, and both counts go in the log. */
  app.post("/api/admin/show-move", requireAdmin, async (req, res) => {
    await schemaIsReady();
    const showId = Number(req.body?.showId), to = lc(req.body?.to);
    if (req.body?.confirm !== true) return res.status(400).json({ message: "Look at the preview first." });
    const p = await plan(showId, to);
    if ("error" in p) return res.status(400).json({ message: p.error });
    const before = await feedItems(p.show.slug);
    const stats = p.stats.filter((s) => s.moves).map((s) => s.id);
    const t = new Date().toISOString();
    await db.transaction(async (tx) => {
      await tx.update(hostedShows).set({ email: to, updatedAt: t }).where(eq(hostedShows.id, showId));
      if (p.folders.length) await tx.update(hostedEpisodes).set({ folderId: 0 }).where(inArray(hostedEpisodes.id, p.folders.map((f) => f.id)));
      if (p.posts.length) await tx.update(hostPosts).set({ email: to }).where(inArray(hostPosts.id, p.posts));
      if (p.transcripts.length) {
        await tx.update(showTranscripts).set({ email: to }).where(inArray(showTranscripts.id, p.transcripts));
        await tx.update(transcriptChunks).set({ email: to }).where(inArray(transcriptChunks.transcriptId, p.transcripts));
      }
      if (p.pageId) {
        await tx.update(bioPages).set({ email: to }).where(eq(bioPages.id, p.pageId));
        await tx.update(listenerQuestions).set({ email: to }).where(eq(listenerQuestions.pageId, p.pageId));
      }
      if (stats.length) await tx.update(podcastStats).set({ email: to }).where(inArray(podcastStats.id, stats));
    });
    const after = await feedItems(p.show.slug);
    const entry: MoveLog = { id: `${showId}-${Date.now()}`, showId, title: p.show.title, slug: p.show.slug, from: p.from, to, at: t, by: getSessionEmail(req) ?? "", posts: p.posts, transcripts: p.transcripts, pageId: p.pageId, stats, folders: p.folders, feedBefore: before.items, feedAfter: after.items };
    await writeLog([entry, ...(await readLog())]);
    res.json({ ok: true, move: entry, feed: { before, after, same: after.status === 200 && after.items === before.items } });
  });

  /** Every move, newest first. */
  app.get("/api/admin/show-moves", requireAdmin, async (_req, res) => { res.setHeader("Cache-Control", "no-store"); res.json(await readLog()); });

  /** Undo one move: every row it touched goes back, folders included. Only while the show is still where it was moved to. */
  app.post("/api/admin/show-moves/:id/undo", requireAdmin, async (req, res) => {
    await schemaIsReady();
    const log = await readLog();
    const m = log.find((x) => x.id === req.params.id);
    if (!m) return res.status(404).json({ message: "No such move." });
    if (m.undoneAt) return res.status(400).json({ message: "Already undone." });
    const [show] = await db.select({ email: hostedShows.email }).from(hostedShows).where(eq(hostedShows.id, m.showId)).limit(1);
    if (!show || lc(show.email) !== m.to) return res.status(409).json({ message: `The show isn't on ${m.to} any more, so this can't be undone automatically.` });
    const [pageBack] = m.pageId ? await db.select({ id: bioPages.id }).from(bioPages).where(eq(sql`lower(${bioPages.email})`, m.from)).limit(1) : [];
    if (pageBack) return res.status(409).json({ message: `${m.from} has a new SmartLink since, so the old one can't go back without clashing.` });
    const t = new Date().toISOString();
    await db.transaction(async (tx) => {
      await tx.update(hostedShows).set({ email: m.from, updatedAt: t }).where(eq(hostedShows.id, m.showId));
      for (const f of m.folders) await tx.update(hostedEpisodes).set({ folderId: f.folderId }).where(eq(hostedEpisodes.id, f.id));
      if (m.posts.length) await tx.update(hostPosts).set({ email: m.from }).where(inArray(hostPosts.id, m.posts));
      if (m.transcripts.length) {
        await tx.update(showTranscripts).set({ email: m.from }).where(inArray(showTranscripts.id, m.transcripts));
        await tx.update(transcriptChunks).set({ email: m.from }).where(inArray(transcriptChunks.transcriptId, m.transcripts));
      }
      if (m.pageId) {
        await tx.update(bioPages).set({ email: m.from }).where(eq(bioPages.id, m.pageId));
        await tx.update(listenerQuestions).set({ email: m.from }).where(eq(listenerQuestions.pageId, m.pageId));
      }
      if (m.stats.length) await tx.update(podcastStats).set({ email: m.from }).where(inArray(podcastStats.id, m.stats));
    });
    m.undoneAt = t;
    await writeLog(log);
    res.json({ ok: true, feed: await feedItems(m.slug) });
  });
}
