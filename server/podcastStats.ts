import type { Express } from "express";
import { storage } from "./storage.js";
import { requireHostSession, getSessionEmail } from "./session.js";
import { seal, unseal } from "./secretBox.js";
import type { PodcastStatsData, PodcastStatsRow } from "../shared/schema.js";
import { hostedAsStats } from "./hosting.js";

/**
 * A podcaster's listening numbers, from where the show is hosted or heard:
 *
 * - Buzzsprout: their API token (Profile → API). Lifetime plays per episode,
 *   and downloads a day at a time for the last 30 days.
 * - Podbean: their API client id and secret (Business plan: Settings →
 *   Advanced Options → AI & Integrations). Downloads by month for two years,
 *   and where they come from.
 * - Transistor: their API key (Account → API). Downloads a day at a time, per
 *   show and per episode, since the show began.
 * - Spotify: the CSVs Spotify for Creators exports. Spotify has no stats API
 *   for anyone, so it's an upload, and we ask for a new one each month.
 *
 * All three are boiled down to PodcastStatsData, so the screen shows one shape.
 */
const UA = "MilitaryVoices.ai (hello@militaryvoices.ai)";
const STALE_MS = 12 * 3600 * 1000;
const day = (d: Date) => d.toISOString().slice(0, 10);

class StatsError extends Error {}

// ---- Buzzsprout -------------------------------------------------------------

async function bz<T>(token: string, path: string): Promise<T> {
  const r = await fetch(`https://www.buzzsprout.com/api/${path}`, { headers: { Authorization: `Token token=${token}`, "User-Agent": UA, Accept: "application/json" } });
  if (r.status === 401 || r.status === 403) throw new StatsError("Buzzsprout didn't accept that API token.");
  if (r.status === 404) throw new StatsError("Buzzsprout doesn't know that podcast ID.");
  if (!r.ok) throw new StatsError(`Buzzsprout answered ${r.status}.`);
  return r.json() as Promise<T>;
}

async function buzzsprout(creds: { token: string; podcastId?: string }): Promise<{ showName: string; podcastId: string; data: PodcastStatsData }> {
  const shows = await bz<{ id: number; title: string; artwork_url?: string }[]>(creds.token, "podcasts.json");
  const show = creds.podcastId ? shows.find((s) => String(s.id) === String(creds.podcastId)) : shows[0];
  if (!show) throw new StatsError(shows.length ? "That podcast ID isn't on this Buzzsprout account." : "No podcasts on this Buzzsprout account.");
  const eps = await bz<{ id: number; title: string; published_at: string; total_plays?: number; private?: boolean }[]>(creds.token, `${show.id}/episodes.json`);
  const episodes = eps
    .filter((e) => !e.private)
    .map((e) => ({ title: e.title, published: (e.published_at || "").slice(0, 10), count: Math.max(0, Number(e.total_plays) || 0) }))
    .sort((a, b) => b.published.localeCompare(a.published));
  // The last 30 days, a day per call (the API has no range), five at a time
  // to stay well under 60 a minute.
  const days = Array.from({ length: 30 }, (_, i) => day(new Date(Date.now() - (30 - i) * 86400000)));
  const series: { date: string; count: number }[] = [];
  for (let i = 0; i < days.length; i += 5) {
    const batch = await Promise.all(days.slice(i, i + 5).map(async (d) => {
      const rows = await bz<{ total: number }[]>(creds.token, `${show.id}/downloads.json?date=${d}`).catch(() => null);
      return rows ? { date: d, count: rows.reduce((a, r) => a + (Number(r.total) || 0), 0) } : null;
    }));
    for (const b of batch) if (b) series.push(b);
  }
  return {
    showName: show.title,
    podcastId: String(show.id),
    data: { total: episodes.reduce((a, e) => a + e.count, 0), unit: "downloads", episodes, series, from: days[0], to: days[days.length - 1], artwork: /^https:\/\//.test(show.artwork_url ?? "") ? show.artwork_url : undefined },
  };
}

// ---- Transistor ---------------------------------------------------------------

/** Transistor's dates are dd-mm-yyyy. */
const tdate = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
const fromT = (s: string) => { const [dd, mm, yy] = s.split("-"); return `${yy}-${mm}-${dd}`; };

async function tr<T>(key: string, path: string): Promise<T> {
  const r = await fetch(`https://api.transistor.fm/v1/${path}`, { headers: { "x-api-key": key, "User-Agent": UA, Accept: "application/json" } });
  if (r.status === 401 || r.status === 403) throw new StatsError("Transistor didn't accept that API key.");
  if (r.status === 404) throw new StatsError("Transistor doesn't know that show.");
  if (r.status === 429) throw new StatsError("Transistor asked us to slow down. Try again in a minute.");
  if (!r.ok) throw new StatsError(`Transistor answered ${r.status}.`);
  return r.json() as Promise<T>;
}

async function transistor(creds: { key: string; show?: string }): Promise<{ showName: string; show: string; data: PodcastStatsData }> {
  type Show = { id: string; attributes: { title: string; slug?: string; image_url?: string; created_at?: string; feed_url?: string } };
  const shows = (await tr<{ data: Show[] }>(creds.key, "shows?pagination[per]=50")).data ?? [];
  // A show by its ID, its slug, or the end of its feed address (feeds.transistor.fm/<slug>).
  const want = (creds.show ?? "").trim().replace(/\/+$/, "").split("/").pop()?.toLowerCase() ?? "";
  const show = want ? shows.find((s) => s.id === want || s.attributes.slug?.toLowerCase() === want || (s.attributes.feed_url ?? "").toLowerCase().endsWith(`/${want}`)) : shows[0];
  if (!show) throw new StatsError(shows.length ? "That show isn't on this Transistor account. Use its feed address or slug." : "No shows on this Transistor account.");
  const now = new Date();
  const began = show.attributes.created_at ? new Date(show.attributes.created_at) : new Date(now.getTime() - 5 * 365 * 86400000);
  const range = `start_date=${tdate(began)}&end_date=${tdate(now)}`;
  type Day = { date: string; downloads: number };
  const all = await tr<{ data: { attributes: { downloads: Day[] } } }>(creds.key, `analytics/${show.id}?${range}`);
  const eps = await tr<{ data: { attributes: { episodes: { title: string; published_at?: string; downloads: Day[] }[] } } }>(creds.key, `analytics/${show.id}/episodes?${range}`).catch(() => null);
  const days = (all.data?.attributes?.downloads ?? []).map((d) => ({ date: fromT(d.date), count: Math.max(0, Number(d.downloads) || 0) })).sort((a, b) => a.date.localeCompare(b.date));
  const episodes = (eps?.data?.attributes?.episodes ?? [])
    .map((e) => ({ title: e.title, published: (e.published_at ?? "").slice(0, 10), count: (e.downloads ?? []).reduce((a, d) => a + (Number(d.downloads) || 0), 0) }))
    .sort((a, b) => b.published.localeCompare(a.published));
  const series = days.slice(-30);
  return {
    showName: show.attributes.title,
    show: show.id,
    data: {
      total: days.reduce((a, d) => a + d.count, 0), unit: "downloads", episodes, series,
      from: days[0]?.date, to: days[days.length - 1]?.date,
      artwork: /^https:\/\//.test(show.attributes.image_url ?? "") ? show.attributes.image_url : undefined,
    },
  };
}

// ---- Podbean ----------------------------------------------------------------

async function podbeanToken(clientId: string, secret: string): Promise<string> {
  const r = await fetch("https://api.podbean.com/v1/oauth/token", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: "grant_type=client_credentials",
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
  if (!r.ok || !j.access_token) throw new StatsError(`Podbean didn't accept those API credentials${j.error_description ? `: ${j.error_description}` : "."}`);
  return j.access_token;
}

async function pb<T>(token: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const q = new URLSearchParams({ access_token: token, ...params });
  const r = await fetch(`https://api.podbean.com/v1/${path}?${q}`, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new StatsError(`Podbean answered ${r.status} for ${path}.`);
  return r.json() as Promise<T>;
}

async function podbean(creds: { clientId: string; secret: string }): Promise<{ showName: string; data: PodcastStatsData }> {
  const token = await podbeanToken(creds.clientId, creds.secret);
  const { podcast } = await pb<{ podcast?: { title?: string; logo?: string } }>(token, "podcast").catch(() => ({ podcast: undefined }));
  const end = new Date(Date.now() - 86400000);
  const start = new Date(end.getFullYear() - 2, end.getMonth(), 1);
  const range = { start: day(start), end: day(end) };
  const [monthly, countries, sources, followers, list] = await Promise.all([
    pb<Record<string, number>>(token, "podcastStats/stats", { ...range, period: "m" }),
    pb<Record<string, number>>(token, "podcastStats/countries", { ...range, period: "m" }).catch(() => ({})),
    pb<Record<string, number>>(token, "podcastStats/sources", { ...range, period: "m" }).catch(() => ({})),
    pb<Record<string, unknown>>(token, "analytics/podcastAnalyticReports", { "types[]": "followers" }).catch(() => ({})),
    pb<{ episodes?: { id: string; title: string; publish_time?: number }[] }>(token, "episodes", { offset: "0", limit: "20" }).catch(() => ({ episodes: [] })),
  ]);
  const series = Object.entries(monthly ?? {}).map(([date, count]) => ({ date, count: Number(count) || 0 })).sort((a, b) => a.date.localeCompare(b.date));
  // Downloads per episode, for the latest twenty: one call each, gently.
  const episodes: PodcastStatsData["episodes"] = [];
  for (const e of list.episodes ?? []) {
    const s = await pb<Record<string, number>>(token, "podcastStats/stats", { ...range, period: "m", episode_id: e.id }).catch(() => ({}));
    episodes.push({ title: e.title, published: e.publish_time ? day(new Date(e.publish_time * 1000)) : "", count: Object.values(s).reduce((a, n) => a + (Number(n) || 0), 0) });
  }
  const f = followers as { followers?: number } | Record<string, unknown>;
  const followerCount = Number((f as { followers?: unknown }).followers ?? (Object.values(f)[0] as { followers?: unknown } | undefined)?.followers) || undefined;
  return {
    showName: podcast?.title ?? "",
    data: {
      total: series.reduce((a, s) => a + s.count, 0),
      unit: "downloads",
      episodes,
      series,
      followers: followerCount,
      audience: { countries: countries as Record<string, number>, apps: sources as Record<string, number> },
      from: range.start,
      to: range.end,
      artwork: /^https:\/\//.test(podcast?.logo ?? "") ? podcast!.logo : undefined,
    },
  };
}

// ---- Spotify (CSV) ------------------------------------------------------------

/** A CSV line into cells, quotes respected. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
const num = (s: string) => {
  const n = Number(String(s).replace(/[,%\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Read whatever Spotify for Creators exported. The column names aren't
 * published, so each file is recognised by its headers: a date column with
 * plays (a trend), an episode column with plays (per episode), or age,
 * gender or country (the audience). Returns what it read and what it didn't.
 */
export function parseSpotify(files: { name: string; text: string }[], prev?: PodcastStatsData | null): { data: PodcastStatsData; read: string[]; skipped: string[] } {
  const data: PodcastStatsData = { total: prev?.total ?? 0, unit: "streams", episodes: prev?.episodes ?? [], series: prev?.series ?? [], followers: prev?.followers, audience: { ...(prev?.audience ?? {}) } };
  const read: string[] = [], skipped: string[] = [];
  for (const f of files) {
    const rows = f.text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim()).map(cells);
    if (rows.length < 2) { skipped.push(f.name); continue; }
    const head = rows[0].map((h) => h.toLowerCase());
    const body = rows.slice(1);
    const col = (re: RegExp) => head.findIndex((h) => re.test(h));
    const playCol = col(/plays|streams|starts|downloads|listens/);
    const valueCol = playCol >= 0 ? playCol : head.findIndex((_, i) => i > 0 && body.every((r) => !Number.isNaN(num(r[i] ?? ""))));
    const dateCol = col(/^date|day|month|week|time/);
    const epCol = col(/episode|title/);
    const ageCol = col(/\bage\b/);
    const genderCol = col(/gender|sex/);
    const countryCol = col(/country|location|market|region/);
    const followCol = col(/follower/);
    const tally = (k: number) => {
      const m: Record<string, number> = {};
      for (const r of body) if (r[k]) m[r[k]] = (m[r[k]] ?? 0) + (valueCol >= 0 ? num(r[valueCol]) || 0 : 1);
      return m;
    };
    let used = false;
    if (followCol >= 0) {
      const last = [...body].reverse().find((r) => !Number.isNaN(num(r[followCol] ?? "")));
      if (last) { data.followers = num(last[followCol]); used = true; }
    }
    if (ageCol >= 0) { data.audience!.age = tally(ageCol); used = true; }
    else if (genderCol >= 0) { data.audience!.gender = tally(genderCol); used = true; }
    else if (countryCol >= 0) { data.audience!.countries = tally(countryCol); used = true; }
    else if (epCol >= 0 && valueCol >= 0 && valueCol !== epCol) {
      const pub = col(/publish|release|date/);
      data.episodes = body.map((r) => ({ title: r[epCol], published: pub >= 0 ? String(r[pub]).slice(0, 10) : "", count: num(r[valueCol]) || 0 })).filter((e) => e.title);
      used = true;
    } else if (dateCol >= 0 && valueCol >= 0 && valueCol !== dateCol) {
      const series = body.map((r) => ({ date: String(r[dateCol]), count: num(r[valueCol]) || 0 })).filter((s) => s.date);
      series.sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
      data.series = series;
      data.from = series[0]?.date;
      data.to = series[series.length - 1]?.date;
      used = true;
    }
    (used ? read : skipped).push(f.name);
  }
  // The total: per-episode plays if we have them (lifetime), else the trend's sum.
  const epSum = data.episodes.reduce((a, e) => a + e.count, 0);
  data.total = epSum || (data.series ?? []).reduce((a, s) => a + s.count, 0);
  return { data, read, skipped };
}

// ---- The comparison -----------------------------------------------------------

// The average of the episodes we have numbers for (every source reports episodes its own way; the total can span more).
const perEpisode = (d: PodcastStatsData | null) => (d && d.episodes.length ? d.episodes.reduce((a, e) => a + e.count, 0) / d.episodes.length : 0);
const parse = (s: string): PodcastStatsData | null => { try { return s ? (JSON.parse(s) as PodcastStatsData) : null; } catch { return null; } };

/**
 * Where a show fits: its average per episode against every other show that
 * connected the same kind of number (downloads with downloads, streams with
 * streams). Only the percentile leaves the server, and only with five or
 * more shows to compare against.
 */
async function benchmark(mine: PodcastStatsRow[]) {
  const all = await storage.allPodcastStats();
  const out: { unit: string; avg: number; percentile: number; peers: number }[] = [];
  for (const unit of ["downloads", "streams"] as const) {
    const m = mine.map((r) => parse(r.data)).filter((d): d is PodcastStatsData => !!d && d.unit === unit);
    if (!m.length) continue;
    const avg = Math.max(...m.map(perEpisode));
    // One number per show (the best of its sources of this kind).
    const byShow = new Map<string, number>();
    for (const r of all) {
      const d = parse(r.data);
      if (!d || d.unit !== unit || !d.episodes.length) continue;
      byShow.set(r.email, Math.max(byShow.get(r.email) ?? 0, perEpisode(d)));
    }
    const peers = Array.from(byShow.values());
    if (peers.length < 5) { out.push({ unit, avg, percentile: -1, peers: peers.length }); continue; }
    const below = peers.filter((v) => v < avg).length;
    out.push({ unit, avg, percentile: Math.round((below / peers.length) * 100), peers: peers.length });
  }
  return out;
}

// ---- Routes --------------------------------------------------------------------

async function refresh(row: PodcastStatsRow): Promise<PodcastStatsRow> {
  const creds = JSON.parse(unseal(row.creds) || "{}");
  try {
    if (row.source === "buzzsprout") {
      const r = await buzzsprout(creds);
      return storage.upsertPodcastStats(row.email, "buzzsprout", { showName: r.showName, data: JSON.stringify(r.data), status: "ok", error: "", fetchedAt: new Date().toISOString() });
    }
    if (row.source === "transistor") {
      const r = await transistor(creds);
      return storage.upsertPodcastStats(row.email, "transistor", { showName: r.showName, data: JSON.stringify(r.data), status: "ok", error: "", fetchedAt: new Date().toISOString() });
    }
    if (row.source === "podbean") {
      const r = await podbean(creds);
      return storage.upsertPodcastStats(row.email, "podbean", { showName: r.showName, data: JSON.stringify(r.data), status: "ok", error: "", fetchedAt: new Date().toISOString() });
    }
  } catch (e) {
    return storage.upsertPodcastStats(row.email, row.source, { status: "failed", error: (e as Error).message.slice(0, 300), fetchedAt: new Date().toISOString() });
  }
  return row;
}

const view = (r: PodcastStatsRow) => ({ source: r.source, showName: r.showName, status: r.status, error: r.error, fetchedAt: r.fetchedAt, data: parse(r.data) });

export function registerPodcastStats(app: Express) {
  const email = (req: Parameters<typeof getSessionEmail>[0]) => (getSessionEmail(req) ?? "").trim().toLowerCase();

  app.get("/api/host/podcast-stats", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    let rows = await storage.listPodcastStats(email(req));
    // Connected sources refresh themselves when they're half a day old.
    rows = await Promise.all(rows.map((r) => (r.source !== "spotify" && (!r.fetchedAt || Date.now() - Date.parse(r.fetchedAt) > STALE_MS) ? refresh(r) : r)));
    // Hosted here: counted by us, always current, first in the list.
    const hosted = await hostedAsStats(email(req)).catch((err) => { console.warn("Hosted stats failed:", (err as Error).message); return []; });
    res.json({ sources: [...hosted, ...rows.map(view)], benchmark: await benchmark(rows) });
  });

  app.post("/api/host/podcast-stats/buzzsprout", requireHostSession, async (req, res) => {
    const token = String(req.body?.token ?? "").trim();
    const podcastId = String(req.body?.podcastId ?? "").replace(/\D/g, "");
    if (!token) return res.status(400).json({ message: "Paste your Buzzsprout API token." });
    try {
      const r = await buzzsprout({ token, podcastId: podcastId || undefined });
      const row = await storage.upsertPodcastStats(email(req), "buzzsprout", {
        creds: seal(JSON.stringify({ token, podcastId: r.podcastId })), showName: r.showName, data: JSON.stringify(r.data), status: "ok", error: "", fetchedAt: new Date().toISOString(),
      });
      res.json(view(row));
    } catch (e) {
      res.status(e instanceof StatsError ? 400 : 502).json({ message: (e as Error).message });
    }
  });

  app.post("/api/host/podcast-stats/transistor", requireHostSession, async (req, res) => {
    const key = String(req.body?.key ?? "").trim();
    const show = String(req.body?.show ?? "").trim().slice(0, 300);
    if (!key) return res.status(400).json({ message: "Paste your Transistor API key." });
    try {
      const r = await transistor({ key, show: show || undefined });
      const row = await storage.upsertPodcastStats(email(req), "transistor", {
        creds: seal(JSON.stringify({ key, show: r.show })), showName: r.showName, data: JSON.stringify(r.data), status: "ok", error: "", fetchedAt: new Date().toISOString(),
      });
      res.json(view(row));
    } catch (e) {
      res.status(e instanceof StatsError ? 400 : 502).json({ message: (e as Error).message });
    }
  });

  app.post("/api/host/podcast-stats/podbean", requireHostSession, async (req, res) => {
    const clientId = String(req.body?.clientId ?? "").trim();
    const secret = String(req.body?.secret ?? "").trim();
    if (!clientId || !secret) return res.status(400).json({ message: "Paste your Podbean client ID and secret." });
    try {
      const r = await podbean({ clientId, secret });
      const row = await storage.upsertPodcastStats(email(req), "podbean", {
        creds: seal(JSON.stringify({ clientId, secret })), showName: r.showName, data: JSON.stringify(r.data), status: "ok", error: "", fetchedAt: new Date().toISOString(),
      });
      res.json(view(row));
    } catch (e) {
      res.status(e instanceof StatsError ? 400 : 502).json({ message: (e as Error).message });
    }
  });

  app.post("/api/host/podcast-stats/spotify", requireHostSession, async (req, res) => {
    const files = (Array.isArray(req.body?.files) ? req.body.files : [])
      .slice(0, 12)
      .map((f: { name?: unknown; text?: unknown }) => ({ name: String(f?.name ?? "file.csv").slice(0, 120), text: String(f?.text ?? "").slice(0, 2_000_000) }))
      .filter((f: { text: string }) => f.text.trim());
    if (!files.length) return res.status(400).json({ message: "Choose the CSV files you exported from Spotify for Creators." });
    const prev = (await storage.listPodcastStats(email(req))).find((r) => r.source === "spotify");
    const { data, read, skipped } = parseSpotify(files, prev ? parse(prev.data) : null);
    if (!read.length) return res.status(400).json({ message: `We couldn't find plays, episodes or audience in ${skipped.join(", ")}. Export from Spotify for Creators → Analytics → Export.` });
    const row = await storage.upsertPodcastStats(email(req), "spotify", { data: JSON.stringify(data), status: "ok", error: "", fetchedAt: new Date().toISOString() });
    res.json({ ...view(row), read, skipped });
  });

  app.post("/api/host/podcast-stats/:source/refresh", requireHostSession, async (req, res) => {
    const row = (await storage.listPodcastStats(email(req))).find((r) => r.source === req.params.source);
    if (!row) return res.status(404).json({ message: "Not connected." });
    res.json(view(await refresh(row)));
  });

  app.delete("/api/host/podcast-stats/:source", requireHostSession, async (req, res) => {
    await storage.deletePodcastStats(email(req), String(req.params.source));
    res.json({ ok: true });
  });
}
