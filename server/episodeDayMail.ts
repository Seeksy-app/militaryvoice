import { and, eq, inArray } from "drizzle-orm";
import { db, storage } from "./storage.js";
import { hostedEpisodes, hostedFeedHits, hostedShows, hostPosts, type PostResult } from "../shared/schema.js";

/**
 * The episode-day email (27 Nov 2026, first for Frank's Bounce Back): the morning an episode goes out, its links and its
 * clips, from MilitaryVoices.ai <hello@> as the team (outbox sender "riccoh" = default from, Riccoh blind-copied).
 * Queued in the outbox with kind "episode-day:<episodeId>" and filled in at send time, so every link is a real one.
 * If any link isn't live yet (the episode, Apple or Spotify not showing it, no YouTube video, no clips), it is held,
 * never sent with a gap: the outbox tries again every 5 minutes until 11:45 am ET, then marks it "held" with the
 * reason and Slacks the team (#mv-inbox).
 */
export const EPISODE_DAY_KIND = "episode-day:";
const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");

/**
 * When a link isn't live yet at send time (PM, 27 Nov): try again in 5 minutes, and send the moment everything resolves,
 * but only until 11:45 am ET, because the email says "is live this morning". Returns the next try (ISO), or null when
 * it's past 11:45 am ET and the email should be held for a person.
 */
export const EPISODE_DAY_LAST_TRY_ET = 11 * 60 + 45;
export function episodeDayRetryAt(nowIso: string): string | null {
  const t = new Date(nowIso);
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(t);
  const n = (k: string) => Number(p.find((x) => x.type === k)?.value ?? "0");
  if (n("hour") * 60 + n("minute") >= EPISODE_DAY_LAST_TRY_ET) return null;
  return new Date(t.getTime() + 5 * 60_000).toISOString();
}

type Built = { ok: true; subject: string; text: string; html: string } | { ok: false; why: string };

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.round(s % 60))).padStart(2, "0")}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The show's page on an app, when that app has read the feed since the episode went out (so the episode is there). */
async function appLink(show: typeof hostedShows.$inferSelect, key: "apple" | "spotify", appName: string, publishedAt: string): Promise<{ url: string; why: string }> {
  let dirs: Record<string, { state?: string; url?: string }> = {};
  try { dirs = JSON.parse(show.directories || "{}"); } catch { /* none */ }
  const url = (dirs[key]?.url || (key === "apple" ? show.appleUrl : show.spotifyUrl) || "").trim();
  if (!/^https:\/\//.test(url)) return { url: "", why: `no ${appName} link for the show yet` };
  const [hit] = await db.select().from(hostedFeedHits).where(and(eq(hostedFeedHits.showId, show.id), eq(hostedFeedHits.app, appName))).limit(1);
  if (!hit?.seenUntil || hit.seenUntil < publishedAt) return { url: "", why: `${appName} hasn't picked up the episode from our feed yet` };
  return { url, why: "" };
}

/** The episode's YouTube video, from the post that sent it. */
async function youtubeLink(e: typeof hostedEpisodes.$inferSelect): Promise<string> {
  let y: { state?: string; post?: number } = {};
  try { y = JSON.parse(e.youtube || "{}"); } catch { /* not posted */ }
  const ids = y.post ? [y.post] : [];
  const posts = ids.length ? await db.select().from(hostPosts).where(inArray(hostPosts.id, ids)) : [];
  if (!posts.length && e.recordingId) posts.push(...await db.select().from(hostPosts).where(and(eq(hostPosts.kind, "recording"), eq(hostPosts.refId, e.recordingId))));
  for (const p of posts) {
    let rs: PostResult[] = [];
    try { rs = JSON.parse(p.results || "[]"); } catch { /* none */ }
    const yt = rs.find((r) => r.platform === "youtube" && r.ok && /^https:\/\//.test(r.url));
    if (yt) return yt.url;
  }
  return "";
}

export async function episodeDayMail(episodeId: number, nowIso = new Date().toISOString()): Promise<Built> {
  const [e] = await db.select().from(hostedEpisodes).where(eq(hostedEpisodes.id, episodeId)).limit(1);
  if (!e) return { ok: false, why: "the episode is gone" };
  if (e.status !== "published" || !e.publishedAt || e.publishedAt > nowIso) return { ok: false, why: "the episode isn't live yet" };
  const [show] = await db.select().from(hostedShows).where(eq(hostedShows.id, e.showId)).limit(1);
  if (!show) return { ok: false, why: "the show is gone" };
  const missing: string[] = [];
  const apple = await appLink(show, "apple", "Apple Podcasts", e.publishedAt);
  const spotify = await appLink(show, "spotify", "Spotify", e.publishedAt);
  if (apple.why) missing.push(apple.why);
  if (spotify.why) missing.push(spotify.why);
  const youtube = await youtubeLink(e);
  if (!youtube) missing.push("no YouTube video for the episode yet");
  const clips = e.recordingId ? (await storage.listClips(e.recordingId)).filter((c) => /^https:\/\//.test(c.verticalUrl || c.url)) : [];
  if (!clips.length) missing.push("no clips ready for the episode yet");
  if (missing.length) return { ok: false, why: missing.join("; ") };

  const profile = await storage.getProfileByEmail(show.email.trim().toLowerCase()).catch(() => undefined);
  const first = (profile?.hostName || "").trim().split(/\s+/)[0] || "there";
  const mv = `${ORIGIN}/podcast/${show.slug}`;
  const num = e.episodeNumber != null ? `Episode ${e.episodeNumber}, ` : "";
  const subject = `Your new episode is live: ${e.title}`;
  const lines = clips.map((c) => ({ title: (c.editTitle || c.title || "Clip").trim(), len: mmss(Math.max(0, c.endSec - c.startSec)), url: c.verticalUrl || c.url }));
  const text = [
    `Hi ${first},`,
    "",
    `${num}"${e.title}", is live this morning. Here is everything you need to share it.`,
    "",
    "Listen and share",
    `- Your show page: ${mv}`,
    `- Apple Podcasts: ${apple.url}`,
    `- Spotify: ${spotify.url}`,
    `- YouTube: ${youtube}`,
    "",
    "Your clips and creatives",
    ...lines.map((l) => `- ${l.title} (${l.len}): ${l.url}`),
    "",
    "Each link downloads the file, ready to post. The same clips are on your Social page in your account, where you can schedule them to your channels: https://www.militaryvoices.ai/host/dashboard/social",
    "",
    "Reply to this email if you'd like anything changed.",
    "",
    "The MilitaryVoices.ai team",
  ].join("\n");
  // Plain, as text: the html part is the same words with the links clickable, nothing more.
  const link = (u: string) => `<a href="${esc(u)}">${esc(u)}</a>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">`
    + `<p>Hi ${esc(first)},</p><p>${esc(`${num}"${e.title}", is live this morning. Here is everything you need to share it.`)}</p>`
    + `<p>Listen and share<br>- Your show page: ${link(mv)}<br>- Apple Podcasts: ${link(apple.url)}<br>- Spotify: ${link(spotify.url)}<br>- YouTube: ${link(youtube)}</p>`
    + `<p>Your clips and creatives<br>${lines.map((l) => `- ${esc(l.title)} (${l.len}): ${link(l.url)}`).join("<br>")}</p>`
    + `<p>Each link downloads the file, ready to post. The same clips are on your Social page in your account, where you can schedule them to your channels: ${link("https://www.militaryvoices.ai/host/dashboard/social")}</p>`
    + `<p>Reply to this email if you'd like anything changed.</p><p>The MilitaryVoices.ai team</p></div>`;
  return { ok: true, subject, text, html };
}
