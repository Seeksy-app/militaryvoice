// A podcaster's show logo (Andrew, 23 Nov 2026: "if it's a live event that we're doing, let's get that logo up in the
// right-hand corner … It can be small"). One per account, read from here by everything that wants it:
//   - the live corner on Radio (/dx/program), event studios (/studio/composite) and their own Studio room;
//   - Social's custom video thumbnails.
// The corner's order: their show logo, else their podcast's cover art, else our gold mark (drawn by the page).
// Set in Integrations → Live → 3 · How it looks (LiveSettings.tsx). Stored as a setting (show-logo:<email>): JSON { url, plate }, so no table change.
import type { Express, RequestHandler } from "express";
import crypto from "node:crypto";
import multer from "multer";
import { asc, eq } from "drizzle-orm";
import { db, storage } from "./storage.js";
import { getSessionEmail } from "./session.js";
import { uploadPhoto } from "./photoStorage.js";
import { hostedShows } from "../shared/schema.js";
import { prepareShowLogo as prepare, type Plate } from "./showLogoImage.js";

const norm = (e: string) => String(e ?? "").trim().toLowerCase();
const key = (email: string) => `show-logo:${norm(email)}`;

/** What sits behind the logo in the corner so it reads on any video: a light plate for a dark logo, a dark plate for a
    light one, none for a picture that brings its own background (opaque, like cover art). */
export type { Plate };
type Stored = { url: string; plate: Plate };
async function stored(email: string): Promise<Stored> {
  if (!norm(email)) return { url: "", plate: "none" };
  const raw = (await storage.getSetting(key(email)).catch(() => null)) || "";
  if (!raw) return { url: "", plate: "none" };
  try {
    const j = JSON.parse(raw) as Partial<Stored>;
    return { url: String(j.url ?? ""), plate: j.plate === "light" || j.plate === "dark" ? j.plate : "none" };
  } catch {
    return { url: raw, plate: "light" };
  }
}

/** Their uploaded show logo, or "". Social's thumbnails read this. */
export async function showLogoOf(email: string): Promise<string> {
  return (await stored(email)).url;
}

/** Their podcast's cover art (the first show they host with us), or "". */
export async function showCoverOf(email: string): Promise<string> {
  if (!norm(email)) return "";
  const [row] = await db.select({ art: hostedShows.artworkUrl }).from(hostedShows).where(eq(hostedShows.email, norm(email))).orderBy(asc(hostedShows.id)).limit(1).catch(() => []);
  return row?.art || "";
}

/** What goes in the live corner for this person: their logo, else their cover, else "" (the page draws our mark). */
export async function cornerLogoOf(email: string): Promise<{ url: string; plate: Plate }> {
  const own = await stored(email);
  if (own.url) return own;
  return { url: await showCoverOf(email).catch(() => ""), plate: "none" };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(png|jpeg|webp|svg\+xml)$/.test(file.mimetype)),
});

export function registerShowLogo(app: Express, requireHostSession: RequestHandler): void {
  const view = async (email: string) => { const s = await stored(email); return { logo: s.url, plate: s.plate, cover: await showCoverOf(email).catch(() => "") }; };

  app.get("/api/host/show-logo", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await view(norm(getSessionEmail(req) ?? "")));
  });

  app.post(
    "/api/host/show-logo",
    requireHostSession,
    (req, res, next) => upload.single("file")(req, res, (err: unknown) => (err ? res.status(400).json({ message: "Under 8 MB, please." }) : next())),
    async (req, res) => {
      const email = norm(getSessionEmail(req) ?? "");
      const f = (req as unknown as { file?: { buffer: Buffer; mimetype: string } }).file;
      if (!f) return res.status(400).json({ message: "That's not a PNG or JPG." });
      let ready: Awaited<ReturnType<typeof prepare>>;
      try {
        ready = await prepare(f.buffer, f.mimetype);
      } catch {
        return res.status(400).json({ message: "We couldn't read that picture. Try a PNG." });
      }
      let url = "";
      try {
        url = await uploadPhoto(`show-logos/${Date.now()}-${crypto.randomBytes(5).toString("hex")}.${ready.ext}`, ready.buf, ready.mime);
      } catch (err) {
        console.error("Show logo upload failed:", err);
        return res.status(502).json({ message: "Couldn't save that picture. Try again." });
      }
      await storage.setSetting(key(email), JSON.stringify({ url, plate: ready.plate } satisfies Stored));
      res.status(201).json(await view(email));
    },
  );

  /**
   * The event studio's corner (/studio/composite and the console's monitor): the scene on air → its run-of-show row →
   * that row's podcaster. A scene with no podcaster behind it (the desk, a sponsor, a hand-off) gets our mark ("").
   * Public: a show logo is on their public pages anyway.
   */
  app.get("/api/stage/corner", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const none = { url: "", plate: "none" as Plate };
    const sceneId = Number(req.query.scene);
    if (!Number.isInteger(sceneId) || sceneId <= 0) return res.json(none);
    try {
      const scene = await storage.getScene(sceneId);
      const row = scene?.runItemId ? await storage.getRunItem(scene.runItemId) : undefined;
      const sg = row?.signupId ? await storage.getSignupById(row.signupId) : undefined;
      res.json(sg?.email ? await cornerLogoOf(sg.email) : none);
    } catch {
      res.json(none);
    }
  });

  app.delete("/api/host/show-logo", requireHostSession, async (req, res) => {
    const email = norm(getSessionEmail(req) ?? "");
    await storage.setSetting(key(email), "");
    res.json(await view(email));
  });
}
