import { eq } from "drizzle-orm";
import { db } from "./storage.js";
import { discoveryCache } from "../shared/schema.js";
// Listen Notes (the podcast search engine), through its Podcast API. For now one
// job: list every podcast we host there, the way a hosting service should
// (POST /podcasts/submit). The key is LISTEN_API_KEY; without it nothing runs.
// Their terms: show "Powered by Listen Notes" wherever their data appears, and
// store nothing of theirs but ids and dates.
const BASE = "https://listen-api.listennotes.com/api/v2";

export function isListenNotesConfigured(): boolean {
  return Boolean(process.env.LISTEN_API_KEY);
}

export type ListenNotesSubmit = { status: "found" | "in review" | "rejected"; url: string; id: string };

/** Ask Listen Notes to add a feed. "found" comes back with the show's page; "in review" is checked within 12 hours. */
export async function submitToListenNotes(rss: string): Promise<ListenNotesSubmit> {
  const res = await fetch(`${BASE}/podcasts/submit`, {
    method: "POST",
    headers: { "X-ListenAPI-Key": process.env.LISTEN_API_KEY ?? "", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ rss }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Listen Notes ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const j = (await res.json()) as { status?: string; podcast?: { listennotes_url?: string; id?: string } };
  const status = j.status === "found" || j.status === "rejected" ? j.status : "in review";
  return { status, url: j.podcast?.listennotes_url ?? "", id: j.podcast?.id ?? "" };
}

// ---------------------------------------------------------------------------
// The month's allowance. The plan's requests (LISTEN_MONTHLY_LIMIT: 150 on
// Free, 1,000 on the custom plan) are counted here, kept back a little, and
// shared out a day at a time per member. Only counts are stored: Listen
// Notes' terms don't let us keep their content.
// ---------------------------------------------------------------------------

const monthKey = () => `ln:used:${new Date().toISOString().slice(0, 7)}`;
const limit = () => Math.max(0, Number(process.env.LISTEN_MONTHLY_LIMIT) || 150);
async function readCount(key: string): Promise<number> {
  const [row] = await db.select().from(discoveryCache).where(eq(discoveryCache.key, key));
  try { return row ? Number(JSON.parse(row.payload).n) || 0 : 0; } catch { return 0; }
}
async function writeCount(key: string, n: number): Promise<void> {
  const payload = JSON.stringify({ n });
  const createdAt = new Date().toISOString();
  await db.insert(discoveryCache).values({ key, payload, createdAt }).onConflictDoUpdate({ target: discoveryCache.key, set: { payload, createdAt } });
}
/** Requests used and allowed this month. */
export async function listenNotesMonth(): Promise<{ used: number; limit: number }> {
  return { used: await readCount(monthKey()), limit: limit() };
}
/**
 * One request's worth, if there's room: under the month's limit less a
 * reserve (so hosting submissions always get through), and, for a member,
 * under their share for the day. False means "not now".
 */
export async function spendListenNotes(who?: string, perDay = 15): Promise<boolean> {
  const used = await readCount(monthKey());
  const reserve = Math.max(5, Math.round(limit() * 0.1));
  if (used >= limit() - (who ? reserve : 0)) return false;
  if (who) {
    const dayKey = `ln:user:${who}:${new Date().toISOString().slice(0, 10)}`;
    const mine = await readCount(dayKey);
    if (mine >= perDay) return false;
    await writeCount(dayKey, mine + 1);
  }
  await writeCount(monthKey(), used + 1);
  return true;
}

async function lnGet(path: string, params: Record<string, string | number | undefined>): Promise<any> {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
  const res = await fetch(`${BASE}${path}?${qs}`, { headers: { "X-ListenAPI-Key": process.env.LISTEN_API_KEY ?? "" }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 429) throw Object.assign(new Error("Listen Notes is busy. Try again in a moment."), { status: 429 });
  if (!res.ok) throw Object.assign(new Error(`Listen Notes ${res.status}`), { status: 502 });
  return res.json();
}

const clean = (s: unknown, n: number) => {
  const t = String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const msIso = (v: unknown) => (Number(v) > 0 ? new Date(Number(v)).toISOString() : "");
const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** A Listen Notes podcast in Discovery's show shape; its id is "ln:<id>" so the show panel knows where to ask. */
export function lnShow(p: any, aboutLen = 400) {
  const extra = p?.extra ?? {};
  const socials = [
    extra.youtube_url && { platform: "youtube", url: extra.youtube_url },
    extra.instagram_handle && { platform: "instagram", url: `https://instagram.com/${extra.instagram_handle}` },
    extra.facebook_handle && { platform: "facebook", url: `https://facebook.com/${extra.facebook_handle}` },
    extra.twitter_handle && { platform: "twitter", url: `https://x.com/${extra.twitter_handle}` },
    extra.linkedin_url && { platform: "linkedin", url: extra.linkedin_url },
  ].filter(Boolean) as { platform: string; url: string }[];
  const hours = num(p?.update_frequency_hours);
  return {
    kind: "show" as const,
    id: `ln:${p?.id ?? ""}`,
    title: clean(p?.title_original ?? p?.title, 200),
    about: clean(p?.description_original ?? p?.description, aboutLen),
    image: String(p?.thumbnail || p?.image || ""),
    web: String(p?.listennotes_url ?? ""),
    site: String(p?.website ?? ""),
    rss: String(p?.rss ?? ""),
    episodes: num(p?.total_episodes),
    latest: msIso(p?.latest_pub_date_ms),
    since: msIso(p?.earliest_pub_date_ms),
    categories: [] as string[],
    host: clean(p?.publisher_original ?? p?.publisher, 160),
    rating: null, ratings: null, language: String(p?.language ?? ""),
    audience: null, audienceRange: null, powerScore: null,
    hasGuests: typeof p?.has_guest_interviews === "boolean" ? p.has_guest_interviews : null,
    socials,
    apple: p?.itunes_id ? `https://podcasts.apple.com/podcast/id${p.itunes_id}` : "",
    spotify: String(extra.spotify_url ?? ""),
    status: "",
    everyDays: hours ? Math.max(1, Math.round(hours / 24)) : null,
    source: "listennotes" as const,
  };
}

/** Shows matching a search, ten a page (the Free plan sees the first 30). */
export async function lnSearchShows(o: { term: string; page: number; byDate: boolean; activeSince?: number }) {
  const j = await lnGet("/search", {
    q: o.term, type: "podcast", offset: o.page * 10, page_size: 10, language: "English",
    sort_by_date: o.byDate ? 1 : 0, published_after: o.activeSince,
  });
  const rows = Array.isArray(j?.results) ? j.results : [];
  return { total: num(j?.total) ?? rows.length, perPage: 10, results: rows.map((r: any) => lnShow(r)) };
}

/** An episode from a search or a show, with the show it's on. */
export type LnEpisode = { title: string; about: string; date: string; web: string; minutes: number | null; show: { id: string; title: string; image: string; host: string } };
function lnEpisode(e: any, show?: any): LnEpisode {
  const p = show ?? e?.podcast ?? {};
  return {
    title: clean(e?.title_original ?? e?.title, 200),
    about: clean(e?.description_original ?? e?.description, 700),
    date: msIso(e?.pub_date_ms),
    web: String(e?.listennotes_url ?? ""),
    minutes: num(e?.audio_length_sec) ? Math.round(Number(e.audio_length_sec) / 60) : null,
    show: { id: p?.id ? `ln:${p.id}` : "", title: clean(p?.title_original ?? p?.title, 160), image: String(p?.thumbnail || p?.image || e?.thumbnail || ""), host: clean(p?.publisher_original ?? p?.publisher, 160) },
  };
}

/** Episodes whose title or notes match: where guests turn up. Ten a page. */
export async function lnSearchEpisodes(o: { term: string; page: number; byDate: boolean }) {
  const j = await lnGet("/search", {
    q: o.term, type: "episode", offset: o.page * 10, page_size: 10, language: "English",
    sort_by_date: o.byDate ? 1 : 0, only_in: "title,description", len_min: 10,
  });
  const rows = Array.isArray(j?.results) ? j.results : [];
  return { total: num(j?.total) ?? rows.length, episodes: rows.map((e: any) => lnEpisode(e)) as LnEpisode[] };
}

/** One show, with its ten latest episodes. */
export async function lnShowFull(id: string) {
  const p = await lnGet(`/podcasts/${encodeURIComponent(id)}`, {});
  const show = lnShow(p, 1200);
  const email = String(p?.email ?? "").trim();
  return {
    ...show,
    email,
    contacts: email ? [{ name: show.host, email, url: "", type: "Show email" }] : [],
    people: [],
    locked: [] as string[],
    recent: (Array.isArray(p?.episodes) ? p.episodes : []).slice(0, 10).map((e: any) => ({ title: clean(e?.title, 160), date: msIso(e?.pub_date_ms), web: String(e?.listennotes_url ?? ""), minutes: num(e?.audio_length_sec) ? Math.round(Number(e.audio_length_sec) / 60) : null })),
    /** The same episodes with their notes, for finding who's been on (not sent to the page). */
    episodesFull: (Array.isArray(p?.episodes) ? p.episodes : []).slice(0, 10).map((e: any) => lnEpisode(e, p)) as LnEpisode[],
  };
}
