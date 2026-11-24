// A host's own shows (hosted_shows), for the places that need to know which one something is for.
import { sql } from "drizzle-orm";
import { db } from "./storage.js";

const rows = (r: unknown) => ((r as { rows?: Record<string, unknown>[] }).rows ?? (r as Record<string, unknown>[]));

/** The host's shows, oldest first. Someone with two or more picks which one an invitation is for (Riccoh, 24 Nov 2026:
 *  his invite went out looking like his older show's). */
export type Show = { id: number; slug: string; title: string };
export async function ownerShows(email: string): Promise<Show[]> {
  try {
    return rows(await db.execute(sql`select id, slug, title from hosted_shows where lower(email)=${email} order by id`)).map((r) => ({ id: Number(r.id), slug: String(r.slug ?? ""), title: String(r.title ?? "") }));
  } catch { return []; }
}
/** The show an invitation is for, when the host has more than one and it's one of theirs; otherwise null (today's behaviour). */
export async function inviteShow(email: string, showId: unknown): Promise<Show | null> {
  const id = Number(showId);
  if (!id) return null;
  const list = await ownerShows(email);
  return list.length > 1 ? list.find((x) => x.id === id) ?? null : null;
}
