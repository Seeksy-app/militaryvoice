// Podscan (7 Oct 2026): hosts and guests as real records, read from episode
// transcripts — name, occupation, company, socials, and every appearance —
// so Hosts & guests no longer has to guess names out of episode titles. First
// choice for people when PODSCAN_API_KEY is set; Podchaser, then Listen Notes,
// behind it. Nothing of theirs is stored (their caching terms aren't published).
import { eq } from "drizzle-orm";
import { db, storage } from "./storage.js";
import { discoveryCache } from "../shared/schema.js";

const BASE = "https://podscan.fm/api/v1";
const key = () => (process.env.PODSCAN_API_KEY || "").trim();
export const podscanOn = () => Boolean(key());

class PodscanError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/**
 * Requests a day, all members together (settings `podscan_daily_cap`; 90 while
 * on the trial's 100 a day, raise it on Premium's 2,000), and a member's share.
 */
async function spend(who: string, perMember = 30): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const cap = Number(await storage.getSetting("podscan_daily_cap").catch(() => "")) || 90;
  const read = async (k: string) => { const [r] = await db.select().from(discoveryCache).where(eq(discoveryCache.key, k)); return r ? Number(r.payload) || 0 : 0; };
  const write = async (k: string, n: number) => { const payload = String(n), createdAt = new Date().toISOString(); await db.insert(discoveryCache).values({ key: k, payload, createdAt }).onConflictDoUpdate({ target: discoveryCache.key, set: { payload, createdAt } }); };
  const all = `ps:used:${day}`, mine = `ps:user:${who}:${day}`;
  const [a, m] = await Promise.all([read(all), read(mine)]);
  if (a >= cap || m >= perMember) throw new PodscanError(429, "That's all the guest searches for today. Try again tomorrow.");
  await Promise.all([write(all, a + 1), write(mine, m + 1)]);
}
export async function podscanUsedToday(): Promise<{ used: number; cap: number }> {
  const [r] = await db.select().from(discoveryCache).where(eq(discoveryCache.key, `ps:used:${new Date().toISOString().slice(0, 10)}`));
  return { used: r ? Number(r.payload) || 0 : 0, cap: Number(await storage.getSetting("podscan_daily_cap").catch(() => "")) || 90 };
}

async function get(path: string, params: Record<string, string | number | undefined> = {}): Promise<any> {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
  const res = await fetch(`${BASE}${path}${qs.size ? `?${qs}` : ""}`, { headers: { Authorization: `Bearer ${key()}`, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (res.ok) return res.json();
  const text = await res.text().catch(() => "");
  console.warn("podscan", res.status, path, text.slice(0, 200));
  if (res.status === 401 || res.status === 403) throw new PodscanError(503, "Podscan didn't accept our API key.");
  if (res.status === 404) throw new PodscanError(404, "That isn't in the podcast index any more.");
  if (res.status === 429) throw new PodscanError(429, "Guest search is busy for a moment. Try again in a few seconds.");
  throw new PodscanError(502, `Couldn't reach the podcast index (${res.status}).`);
}
/** Is the key good? One cheap call, for System health. */
export async function podscanPing(): Promise<void> {
  await get("/entities/search", { query: "veteran", type: "person", per_page: 1 });
}

const s = (v: unknown, n = 200) => { const t = String(v ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const social = (l: unknown) => (Array.isArray(l) ? l : [])
  .map((x: any) => ({ platform: String(x?.platform ?? "").toLowerCase().replace(/^x$/, "twitter"), url: String(x?.url ?? "") }))
  .filter((x) => x.platform && /^https?:\/\//.test(x.url));

/** A Podscan person in Discovery's person shape; its id is "ps:<entity id>". */
function person(e: any) {
  const a = e?.appearances ?? {};
  const hosts = Number(a.hosts_count) || 0, guests = Number(a.guests_count) || 0;
  const what = [s(e?.occupation, 90), s(e?.company, 70)].filter(Boolean).join(" · ");
  return {
    kind: "person" as const, pcid: `ps:${e?.entity_id ?? ""}`, name: s(e?.entity_name, 120),
    subtitle: what || (guests ? `Guest on ${guests} ${guests === 1 ? "episode" : "episodes"}` : `Hosts ${hosts} ${hosts === 1 ? "episode" : "episodes"}`),
    bio: [e?.industry ? `Industry: ${s(e.industry, 80)}.` : "", hosts ? `Host on ${hosts} ${hosts === 1 ? "episode" : "episodes"}.` : "", guests ? `Guest on ${guests} ${guests === 1 ? "episode" : "episodes"}.` : ""].filter(Boolean).join(" "),
    image: "", web: String(e?.url ?? ""), location: "", followers: null,
    appearances: hosts + guests, socials: social(e?.social_links),
  };
}

const ORDER: Record<string, string> = { appearances: "guests_count", recent_episode: "best_match", relevance: "best_match" };
/** People who host or guest, matching the words in their name, job, company or field. */
export async function podscanPeople(o: { q: string; page: number; sort: string; who: string }) {
  await spend(o.who);
  const j = await get("/entities/search", {
    query: o.q, type: "person", search_fields: "name,company,occupation,industry",
    order_by: ORDER[o.sort] ?? "best_match", per_page: 25, page: o.page + 1,
  });
  const rows = (Array.isArray(j?.entities) ? j.entities : [])
    .filter((e: any) => (Number(e?.appearances?.hosts_count) || 0) + (Number(e?.appearances?.guests_count) || 0) > 0);
  const total = Number(j?.pagination?.total) || rows.length;
  const last = Number(j?.pagination?.last_page) || 1;
  return { total: o.page + 1 < last ? Math.max(total, (o.page + 2) * 25) : (o.page * 25) + rows.length, perPage: 25, results: rows.map(person) };
}

/** One person: their shows and the episodes they're on, newest first. */
export async function podscanPerson(entityId: string, who: string) {
  await spend(who);
  const j = await get(`/entities/${encodeURIComponent(entityId)}/appearances`, { per_page: 30 });
  const e = j?.entity ?? {};
  const apps = (Array.isArray(j?.appearances) ? j.appearances : []).filter((x: any) => ["host", "guest"].includes(String(x?.role)));
  const role = (r: string) => (r === "host" ? "Host" : "Guest");
  const shows = new Map<string, { id: string; title: string; image: string; web: string; role: string; episodes: number }>();
  for (const x of apps) {
    const p = x?.episode?.podcast ?? {};
    if (!p.podcast_id) continue;
    const id = `ps:${p.podcast_id}`;
    const had = shows.get(id);
    if (had) had.episodes++;
    else shows.set(id, { id, title: s(p.podcast_name, 160), image: String(x?.episode?.episode_image_url ?? ""), web: String(p.podcast_url ?? ""), role: role(String(x.role)), episodes: 1 });
  }
  const what = [s(e?.occupation, 90), s(e?.company, 70)].filter(Boolean).join(" · ");
  return {
    kind: "person" as const, pcid: `ps:${entityId}`, name: s(e?.entity_name, 120),
    ...(what ? { subtitle: what } : {}),
    ...(e?.url ? { web: String(e.url) } : {}),
    appearances: Number(j?.pagination?.total) || apps.length,
    shows: Array.from(shows.values()).sort((a, b) => b.episodes - a.episodes),
    recent: apps.slice(0, 15).map((x: any) => ({
      title: s(x?.episode?.episode_title, 160), date: String(x?.episode?.posted_at ?? ""), web: String(x?.episode?.episode_url ?? ""),
      show: s(x?.episode?.podcast?.podcast_name, 120), showId: x?.episode?.podcast?.podcast_id ? `ps:${x.episode.podcast.podcast_id}` : "",
      image: String(x?.episode?.episode_image_url ?? ""), role: role(String(x.role)),
    })),
    source: "podscan",
  };
}

/** One show, with who's been on its latest episode. */
export async function podscanShow(podcastId: string, who: string) {
  await spend(who);
  const [j, latest] = await Promise.all([get(`/podcasts/${encodeURIComponent(podcastId)}`), get(`/podcasts/${encodeURIComponent(podcastId)}/latest/guest`).catch(() => null)]);
  const p = j?.podcast ?? j ?? {};
  const people = (Array.isArray(latest?.guests) ? latest.guests : []).filter((g: any) => g?.guest_name)
    .map((g: any) => ({ pcid: "", name: s(g.guest_name, 120), image: "", role: [s(g.guest_occupation, 60), s(g.guest_company, 50)].filter(Boolean).join(" · ") || "Guest", episodes: 1 }));
  const days = Number(p.podcast_days_between_episodes);
  return {
    kind: "show" as const, id: `ps:${podcastId}`, title: s(p.podcast_name, 200), about: s(p.podcast_summary || p.podcast_description, 1200),
    image: String(p.podcast_image_url ?? ""), web: String(p.podcast_url ?? ""), site: String(p.podcast_url ?? ""), rss: String(p.rss_url ?? ""),
    episodes: Number(p.episode_count) || null, latest: String(p.last_posted_at ?? ""), since: "",
    categories: (Array.isArray(p.podcast_categories) ? p.podcast_categories : []).map((c: any) => s(c?.category_display_name ?? c?.category_name, 40)).filter(Boolean).slice(0, 4),
    host: s(p.publisher_name, 160), rating: null, ratings: null, language: String(p.language ?? ""),
    audience: Number(p.reach?.audience_size) || null, audienceRange: null, powerScore: null,
    hasGuests: typeof p.podcast_has_guests === "boolean" ? p.podcast_has_guests : null, socials: [],
    apple: p.podcast_itunes_id ? `https://podcasts.apple.com/podcast/id${p.podcast_itunes_id}` : "",
    spotify: p.podcast_spotify_id ? `https://open.spotify.com/show/${p.podcast_spotify_id}` : "",
    status: "", everyDays: Number.isFinite(days) && days > 0 ? Math.round(days) : null,
    email: "", contacts: [], people, locked: [] as string[], source: "podscan",
  };
}

export { PodscanError };
