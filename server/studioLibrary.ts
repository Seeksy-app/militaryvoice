// The Studio's built-in sounds and music (Studio phase 3, 21 Nov 2026). CC0 or public domain, or CC BY 4.0
// with its credit shown (Andrew, 21 Nov: "credit is fine", for HoliznaCC0's "Beginning 1", which his own
// Bandcamp marks CC BY 4.0). Never ElevenLabs music, never Pixabay, no military music (Andrew).
//
// The licence table: an item shows in the Studio only when EVERY field is filled in. That means the file is
// in our bucket, and its source page, the licence as the page states it, and the date we checked it are on
// file. An item missing any of them stays hidden, even if it's listed here.
import type { Express, RequestHandler } from "express";
import { putRecordingObject, signedRecordingUrl } from "./recordingStorage.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");

export interface LibrarySource {
  /** Where it came from, e.g. "Freesound" or "Free Music Archive". */
  site: string;
  title: string;
  artist: string;
  /** The item's own page, where the licence was read. */
  page: string;
  /** The licence as that page states it, e.g. "CC0 1.0 Universal" or "Public Domain Mark 1.0". */
  licence: string;
  /** YYYY-MM-DD, when we read it there. */
  checked: string;
  /** Required for CC BY: the line shown wherever it plays (the Studio, and the recording's and live show's credits). */
  credit?: string;
}
export interface LibraryItem {
  slug: string;
  kind: "sound" | "music";
  name: string;
  /** In the recordings bucket, under studio-library/. */
  key: string;
  sec: number;
  source: LibrarySource;
}

/** Filled in as each item is checked and uploaded (see exports/cc0-music-candidates.md for the shortlist). */
export const LIBRARY: LibraryItem[] = [
  // Bought on Bandcamp 21 Nov 2026 ($1.50; receipt in Andrew's email). The artist's page marks it CC BY 4.0.
  { slug: "beginning-1", kind: "music", name: "Beginning 1", key: "studio-library/holiznacc0-beginning-1.mp3", sec: 270,
    source: { site: "Bandcamp", title: "Beginning 1", artist: "HoliznaCC0", page: "https://holiznacc0.bandcamp.com/track/beginning-1",
      licence: "CC BY 4.0", checked: "2026-11-21", credit: "Music: Beginning 1 by HoliznaCC0 (CC BY 4.0)" } },
  // Sound pads: CC0 on each sound's own Freesound page, read at import (21 Nov 2026). From the HQ previews, levelled to about -16 LUFS (peaks -1.5 dB) so no pad jumps out.
  { slug: "applause", kind: "sound", name: "Applause", key: "studio-library/applause.mp3", sec: 6.3,
    source: { site: "Freesound", title: "Applause 2.WAV", artist: "Sandermotions", page: "https://freesound.org/people/Sandermotions/sounds/277021/", licence: "CC0 1.0 Universal", checked: "2026-11-21" } },
  { slug: "drum-roll", kind: "sound", name: "Drum roll", key: "studio-library/drum-roll.mp3", sec: 6,
    source: { site: "Freesound", title: "drumroll.wav", artist: "adriann", page: "https://freesound.org/people/adriann/sounds/191718/", licence: "CC0 1.0 Universal", checked: "2026-11-21" } },
  { slug: "gong", kind: "sound", name: "Gong", key: "studio-library/gong.mp3", sec: 6,
    source: { site: "Freesound", title: "gong.WAV", artist: "BOSS MUSIC", page: "https://freesound.org/people/BOSS%20MUSIC/sounds/121800/", licence: "CC0 1.0 Universal", checked: "2026-11-21" } },
  { slug: "cheer", kind: "sound", name: "Cheer", key: "studio-library/cheer.mp3", sec: 4.1,
    source: { site: "Freesound", title: "Cheer 2.wav", artist: "jayfrosting", page: "https://freesound.org/people/jayfrosting/sounds/333404/", licence: "CC0 1.0 Universal", checked: "2026-11-21" } },
  { slug: "laugh", kind: "sound", name: "Laugh", key: "studio-library/laugh.mp3", sec: 5.8,
    source: { site: "Freesound", title: "Sitcom Laughter with Applause, Small Audience", artist: "Kinoton", page: "https://freesound.org/people/Kinoton/sounds/371562/", licence: "CC0 1.0 Universal", checked: "2026-11-21" } },
  { slug: "ta-da", kind: "sound", name: "Ta-da", key: "studio-library/ta-da.mp3", sec: 5.9,
    source: { site: "Freesound", title: "TaDa!.wav", artist: "jimhancock", page: "https://freesound.org/people/jimhancock/sounds/376318/", licence: "CC0 1.0 Universal", checked: "2026-11-21" } },
];

const LICENCES = /^(CC0 1\.0( Universal)?|Public Domain Mark 1\.0|Public Domain|CC BY 4\.0)$/;
/** CC BY needs its credit line on file; without it the item stays hidden. */
const credited = (x: LibraryItem) => x.source?.licence !== "CC BY 4.0" || !!x.source.credit?.trim();
const complete = (x: LibraryItem) =>
  !!(x.slug && x.name && /^studio-library\/[\w.-]+$/.test(x.key) && x.source?.site && x.source.title && x.source.artist &&
    /^https:\/\//.test(x.source.page) && LICENCES.test(x.source.licence) && credited(x) && /^\d{4}-\d{2}-\d{2}$/.test(x.source.checked));

/** What the Studio may offer: complete items only. */
export const libraryReady = (): LibraryItem[] => LIBRARY.filter(complete);

/** The asset shape the look uses, for a library item (id "lib-<slug>"). */
export const libraryAsset = (x: LibraryItem) => ({ id: `lib-${x.slug}`, kind: x.kind, name: x.name, mime: "audio/mpeg", sec: x.sec, url: `${ORIGIN}/api/room-library/${x.slug}` });

/** Freesound (admin only): find CC0 sounds for the pads and copy one into the bucket. Nothing shows in the
 *  Studio until its LIBRARY entry is added by hand, with the page, licence and date from the import reply. */
const FS = "https://freesound.org/apiv2";
const CC0 = /publicdomain\/zero\/1\.0/;
export function registerFreesoundImport(app: Express, requireAdmin: RequestHandler): void {
  const key = () => process.env.FREESOUND_API_KEY?.trim() || "";
  app.get("/api/admin/studio-library/freesound", requireAdmin, async (req, res) => {
    if (!key()) return res.status(503).json({ message: "FREESOUND_API_KEY isn't set." });
    const q = String(req.query.q ?? "").slice(0, 80);
    const u = new URL(`${FS}/search/text/`);
    u.searchParams.set("query", q);
    u.searchParams.set("filter", 'license:"Creative Commons 0" duration:[0.3 TO 8]');
    u.searchParams.set("fields", "id,name,username,license,duration,url,avg_rating,num_ratings,num_downloads,previews,tags");
    u.searchParams.set("sort", String(req.query.sort ?? "downloads_desc"));
    u.searchParams.set("page_size", "15");
    u.searchParams.set("token", key());
    const r = await fetch(u);
    if (!r.ok) return res.status(502).json({ message: `Freesound ${r.status}`, body: (await r.text()).slice(0, 300) });
    const j: any = await r.json();
    res.json({ count: j.count, results: (j.results ?? []).filter((s: any) => CC0.test(s.license)) });
  });
  app.post("/api/admin/studio-library/freesound/:id", requireAdmin, async (req, res) => {
    if (!key()) return res.status(503).json({ message: "FREESOUND_API_KEY isn't set." });
    const slug = String(req.body?.slug ?? "").toLowerCase();
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) return res.status(400).json({ message: "slug: a-z, 0-9 and dashes." });
    const r = await fetch(`${FS}/sounds/${encodeURIComponent(String(req.params.id))}/?fields=id,name,username,license,duration,url,previews&token=${key()}`);
    if (!r.ok) return res.status(502).json({ message: `Freesound ${r.status}` });
    const s: any = await r.json();
    // Read on the sound's own record at import time; only CC0 comes in.
    if (!CC0.test(String(s.license))) return res.status(400).json({ message: `Not CC0: ${s.license}` });
    const mp3 = await fetch(s.previews?.["preview-hq-mp3"]);
    if (!mp3.ok) return res.status(502).json({ message: `Preview ${mp3.status}` });
    const buf = Buffer.from(await mp3.arrayBuffer());
    const k = `studio-library/${slug}.mp3`;
    await putRecordingObject(k, buf, "audio/mpeg");
    res.json({ key: k, bytes: buf.length, entry: { slug, kind: "sound", name: s.name, key: k, sec: Math.round(s.duration * 10) / 10,
      source: { site: "Freesound", title: s.name, artist: s.username, page: s.url, licence: "CC0 1.0 Universal", checked: new Date().toISOString().slice(0, 10) } } });
  });
}

export function registerStudioLibrary(app: Express, requireHostSession: RequestHandler): void {
  /** The picker: ready items, each with its source and licence line. */
  app.get("/api/host/room/library", requireHostSession, (_req, res) => {
    res.setHeader("Cache-Control", "private, max-age=300");
    res.json({ items: libraryReady().map((x) => ({ id: `lib-${x.slug}`, kind: x.kind, name: x.name, sec: x.sec, asset: libraryAsset(x), source: x.source })) });
  });
  /** The file, for anyone with the link (the player bot and the recording page have no login). */
  app.get("/api/room-library/:slug", async (req, res) => {
    const x = libraryReady().find((i) => i.slug === req.params.slug);
    if (!x) return res.status(404).type("text/plain").send("Not found.");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.redirect(302, await signedRecordingUrl(x.key, 6 * 3600));
  });
}
