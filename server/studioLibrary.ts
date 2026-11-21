// The Studio's built-in sounds and music (Studio phase 3, 21 Nov 2026). CC0 or public domain, or CC BY 4.0
// with its credit shown (Andrew, 21 Nov: "credit is fine", for HoliznaCC0's "Beginning 1", which his own
// Bandcamp marks CC BY 4.0). Never ElevenLabs music, never Pixabay, no military music (Andrew).
//
// The licence table: an item shows in the Studio only when EVERY field is filled in. That means the file is
// in our bucket, and its source page, the licence as the page states it, and the date we checked it are on
// file. An item missing any of them stays hidden, even if it's listed here.
import type { Express, RequestHandler } from "express";
import { signedRecordingUrl } from "./recordingStorage.js";

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
export const LIBRARY: LibraryItem[] = [];

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
