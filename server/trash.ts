// Recently deleted: what a member deletes (a Library episode, a clip, a podcast episode or
// show, a media file) waits here for 15 days and can be put back exactly as it was. The rows
// are kept as they were (ids and all), and any stored files stay where they are until the 15
// days are up; then a daily job removes the files and forgets the rows.
import type { Express, RequestHandler } from "express";
import { and, asc, eq, lte } from "drizzle-orm";
import { db, schemaIsReady } from "./storage.js";
import { getSessionEmail } from "./session.js";
import { deleteRecordingObject } from "./recordingStorage.js";
import { deleteShowAsset } from "./photoStorage.js";
import { clips, hostedEpisodes, hostedShows, recordings, showAssets, trash } from "../shared/schema.js";

export const TRASH_DAYS = 15;

/** The tables something can be put back into. */
const TABLES = { recordings, clips, hostedEpisodes, hostedShows, showAssets } as const;
type TableName = keyof typeof TABLES;
export type TrashKind = "recording" | "clip" | "episode" | "show" | "asset";
/** Files to remove once it's gone for good: R2 keys, and Supabase public URLs. */
export type TrashFiles = { r2?: string[]; supabase?: string[] };

const now = () => new Date().toISOString();

/** Keep what's about to be deleted. Call it before the delete, with the rows as they are. */
export async function toTrash(o: { email: string; kind: TrashKind; label: string; rows: Partial<Record<TableName, object[]>>; files?: TrashFiles }): Promise<void> {
  await schemaIsReady();
  const t = Date.now();
  await db.insert(trash).values({
    email: o.email.trim().toLowerCase(),
    kind: o.kind,
    label: o.label.slice(0, 300),
    rows: JSON.stringify(o.rows),
    files: JSON.stringify(o.files ?? {}),
    deletedAt: new Date(t).toISOString(),
    expiresAt: new Date(t + TRASH_DAYS * 86400_000).toISOString(),
  });
}

async function purgeFiles(raw: string) {
  let f: TrashFiles = {};
  try { f = JSON.parse(raw || "{}"); } catch { f = {}; }
  for (const k of f.r2 ?? []) await deleteRecordingObject(k).catch((err) => console.error("Trash: couldn't remove a file:", err?.message));
  for (const u of f.supabase ?? []) await deleteShowAsset(u).catch((err) => console.error("Trash: couldn't remove a file:", err?.message));
}

export function registerTrash(app: Express, requireHostSession: RequestHandler) {
  const me = (req: Parameters<RequestHandler>[0]) => (getSessionEmail(req) ?? "").trim().toLowerCase();

  app.get("/api/host/trash", requireHostSession, async (req, res) => {
    await schemaIsReady();
    res.setHeader("Cache-Control", "no-store");
    const rows = await db.select({ id: trash.id, kind: trash.kind, label: trash.label, deletedAt: trash.deletedAt, expiresAt: trash.expiresAt })
      .from(trash).where(eq(trash.email, me(req))).orderBy(asc(trash.expiresAt));
    res.json(rows.filter((r) => r.expiresAt > now()));
  });

  /** Put it back, exactly as it was. */
  app.post("/api/host/trash/:id/restore", requireHostSession, async (req, res) => {
    await schemaIsReady();
    const [item] = await db.select().from(trash).where(and(eq(trash.id, Number(req.params.id)), eq(trash.email, me(req))));
    if (!item) return res.status(404).json({ message: "It's not in Recently deleted any more." });
    const rows = JSON.parse(item.rows || "{}") as Partial<Record<TableName, Record<string, unknown>[]>>;
    // Parents before children: a show before its episodes, a recording before its clips.
    const order: TableName[] = ["hostedShows", "hostedEpisodes", "recordings", "clips", "showAssets"];
    try {
      await db.transaction(async (tx) => {
        for (const name of order) {
          const list = rows[name];
          if (!list?.length) continue;
          // Every row must go back: one that clashes (a show's address taken since) stops the lot.
          const back = await tx.insert(TABLES[name]).values(list as never).onConflictDoNothing().returning();
          if (back.length !== list.length) throw new Error(`${name}: ${list.length - back.length} clashed`);
        }
        await tx.delete(trash).where(eq(trash.id, item.id));
      });
    } catch (err) {
      console.error("Trash restore failed:", err);
      // A show's web address taken since, say.
      return res.status(409).json({ message: "It couldn't go back: something new has its name or address now. Rename that one, then try again." });
    }
    res.json({ ok: true, kind: item.kind });
  });

  /** Gone for good, now. */
  app.delete("/api/host/trash/:id", requireHostSession, async (req, res) => {
    await schemaIsReady();
    const [item] = await db.delete(trash).where(and(eq(trash.id, Number(req.params.id)), eq(trash.email, me(req)))).returning();
    if (item) await purgeFiles(item.files);
    res.json({ ok: true });
  });

  // Daily: past their 15 days, the files go and the rows are forgotten.
  app.get("/api/cron/trash", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret && (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") !== secret) return res.status(401).json({ message: "Not authorised." });
    await schemaIsReady();
    const gone = await db.delete(trash).where(lte(trash.expiresAt, now())).returning();
    for (const g of gone) await purgeFiles(g.files);
    res.json({ purged: gone.length });
  });
}
