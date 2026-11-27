// A host's own shows (hosted_shows), for the places that need to know which one something is for.
import { sql } from "drizzle-orm";
import { db, storage } from "./storage.js";
import { parseTheme } from "../shared/bio.js";

const rows = (r: unknown) => ((r as { rows?: Record<string, unknown>[] }).rows ?? (r as Record<string, unknown>[]));

/** The host's shows, oldest first. Someone with two or more picks which one an invitation is for (Riccoh, 24 Nov 2026:
 *  his invite went out looking like his older show's). */
export type Show = { id: number; slug: string; title: string };
export async function ownerShows(email: string): Promise<Show[]> {
  try {
    return rows(await db.execute(sql`select id, slug, title from hosted_shows where lower(email)=${email} and archived_at = '' order by id`)).map((r) => ({ id: Number(r.id), slug: String(r.slug ?? ""), title: String(r.title ?? "") }));
  } catch { return []; }
}
/** The show an invitation is for, when the host has more than one and it's one of theirs; otherwise null (today's behaviour). */
export async function inviteShow(email: string, showId: unknown): Promise<Show | null> {
  const id = Number(showId);
  if (!id) return null;
  const list = await ownerShows(email);
  return list.length > 1 ? list.find((x) => x.id === id) ?? null : null;
}

const titleKey = (v: string) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
/**
 * Which of the host's shows something is for (one lookup for link cards and the studio's show icon; Andrew, 24 Nov:
 * Riccoh's Warriors' Voice studio showed his Devil Dawg cover): the picked one (?show=), else the first of `names`
 * that is one of their show titles (the room's name, then their profile's podcast), else their only show. Null when
 * it can't tell, never just the oldest.
 */
export async function showFor(email: string, picked: unknown, ...names: (string | null | undefined)[]): Promise<Show | null> {
  const chosen = await inviteShow(email, picked);
  if (chosen) return chosen;
  const list = await ownerShows(email);
  for (const n of names) {
    const k = titleKey(n ?? "");
    const hit = k ? list.find((x) => titleKey(x.title) === k) : undefined;
    if (hit) return hit;
  }
  return list.length === 1 ? list[0] : null;
}

/** The show a host picked for their studio (only kept for hosts with 2 or more shows). */
export const studioShowKey = (studioId: number) => `studio-show:${studioId}`;
/**
 * Which show a host's own studio is for (Andrew, 24 Nov: his studio said "Veteran Benefits Podcast", the name it was made
 * with, while he was under Next Mile): the one picked now (?show=), else the one picked last time, else showFor's
 * usual order (the studio's name, their profile's podcast, their only show). Null when it can't tell.
 */
export async function studioShow(email: string, studioId: number, studioName: string, picked?: unknown): Promise<Show | null> {
  const em = String(email ?? "").trim().toLowerCase();
  const now = await inviteShow(em, picked);
  if (now) return now;
  const saved = await storage.getSetting(studioShowKey(studioId)).catch(() => null);
  const profile = await storage.getProfileByEmail(em).catch(() => undefined);
  return showFor(em, saved ?? "", studioName, profile?.podcastName);
}
/** The studio's title: its show's name, else the name it was made with. */
export async function studioTitle(email: string, studioId: number, studioName: string, picked?: unknown): Promise<string> {
  const show = (await studioShow(email, studioId, studioName, picked).catch(() => null))?.title || "";
  return fuller(show, studioName);
}

/**
 * The show's title, unless one name begins with the other: then the longer, fuller one (PM, 24 Nov: a room named
 * "Bounce Back in Business & Life" for the show "Bounce Back" shouldn't shorten itself).
 */
export function fuller(show: string, studioName: string): string {
  const a = show.trim(), b = studioName.trim();
  if (!a) return b;
  if (!b) return a;
  const x = a.toLowerCase(), y = b.toLowerCase();
  if (x.startsWith(y) || y.startsWith(x)) return a.length >= b.length ? a : b;
  return a;
}

/** The show a Library recording was made for, saved when it started recording (hosts with 2 or more shows). */
export const recShowKey = (recordingId: number) => `rec-show:${recordingId}`;
/**
 * Where a recording publishes to (Andrew, 26 Nov: his Next Mile recording would have gone into his Veteran Benefits
 * show, the account's first). Only what's known for sure, in this order: the show it was recorded for (saved at the
 * time, for it or the recording it was cleaned from), the show the host's SmartLink names, their only show. Null when
 * it can't tell, so the caller asks: never the oldest show, never a guess from a title.
 */
export async function recordingShow(email: string, recordingIds: number[]): Promise<Show | null> {
  const em = String(email ?? "").trim().toLowerCase();
  const list = await ownerShows(em);
  if (!list.length) return null;
  for (const id of recordingIds.filter((x) => x > 0)) {
    const saved = Number(await storage.getSetting(recShowKey(id)).catch(() => null));
    const hit = saved ? list.find((x) => x.id === saved) : undefined;
    if (hit) return hit;
  }
  try {
    const r = rows(await db.execute(sql`select theme from bio_pages where lower(email)=${em} limit 1`))[0];
    const source = parseTheme(String(r?.theme ?? "")).podcast?.source ?? "";
    const named = source.startsWith("show:") ? list.find((x) => x.id === Number(source.slice(5))) : undefined;
    if (named) return named;
  } catch { /* no SmartLink: fall through */ }
  return list.length === 1 ? list[0] : null;
}
