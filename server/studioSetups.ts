// Saved setups for a host's own studio (Andrew, 24 Nov: "we need to have a library of stages… Choose setups", approved
// with the mockup). A setup is a named copy of the studio's look (scenes, Media, style) for one of their shows. The
// host picks one on "Choose a setup" before the camera check, or saves today's from the studio's Scenes ⋯. Using one,
// a template or a blank start replaces the studio's look; whatever was there is kept first as "Before <date>" unless
// it's already saved, so nothing is lost. Never while the studio is live or recording. Guests never see any of it.
import type { Express, Request, RequestHandler } from "express";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { getSessionEmail } from "./session.js";
import { assetsOf, clean, freshLook, getLook, saveLook, type Look } from "./roomKit.js";
import { studioShow } from "./hostShows.js";
import { personalStudios, roomLooks, type PersonalStudioRow } from "../shared/schema.js";
import { freeName, templateById } from "../shared/studioTemplates.js";

type Setup = { id: string; name: string; showId: number | null; look: Omit<Look, "rev">; savedAt: string; usedAt: string; auto?: boolean };
const MAX = 24;
const key = (studioId: number) => `studio-setups:${studioId}`;
const me = (req: Request) => (getSessionEmail(req) ?? "").trim().toLowerCase();
const now = () => new Date().toISOString();
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

async function studioOf(email: string): Promise<PersonalStudioRow | undefined> {
  await schemaIsReady();
  const [s] = await db.select().from(personalStudios).where(eq(personalStudios.ownerEmail, email)).limit(1);
  return s;
}
async function readAll(studioId: number): Promise<Setup[]> {
  try { const v = JSON.parse((await storage.getSetting(key(studioId))) ?? "[]"); return Array.isArray(v) ? (v as Setup[]) : []; } catch { return []; }
}
const writeAll = (studioId: number, list: Setup[]) => storage.setSetting(key(studioId), JSON.stringify(list.slice(0, MAX)));
/** The show the studio is set to now (null for hosts with one show or none): setups are kept per show. */
const showOf = async (s: PersonalStudioRow) => (await studioShow(s.ownerEmail, s.id, s.name).catch(() => null))?.id ?? null;
const mine = (list: Setup[], show: number | null) => list.filter((x) => x.showId === null || show === null || x.showId === show);
const sameScenes = (a: Omit<Look, "rev">, b: Omit<Look, "rev">) => JSON.stringify(a.scenes) === JSON.stringify(b.scenes);
const strip = ({ rev: _rev, ...rest }: Look): Omit<Look, "rev"> => rest;

/** What a card needs: name, dates, counts, and the first scene for a small picture. */
const card = (x: Setup) => ({
  id: x.id, name: x.name, savedAt: x.savedAt, usedAt: x.usedAt, auto: !!x.auto,
  scenes: x.look.scenes.length, clips: x.look.videos?.length ?? 0,
  first: x.look.scenes[0] ? { type: x.look.scenes[0].type, layout: x.look.scenes[0].layout, people: x.look.scenes[0].people, boxes: x.look.scenes[0].boxes } : null,
});

/** Replace the studio's look, keeping what was there as "Before <date>" when it isn't saved already. */
async function replaceLook(s: PersonalStudioRow, next: (cur: Look) => Record<string, unknown>): Promise<Look | string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await getLook(s.id);
    const show = await showOf(s);
    const list = await readAll(s.id);
    const was = strip(cur);
    if (cur.rev > 0 && was.scenes.length && !mine(list, show).some((x) => sameScenes(x.look, was))) {
      const kept: Setup = { id: crypto.randomBytes(5).toString("hex"), name: `Before ${day(now())}`, showId: show, look: was, savedAt: now(), usedAt: now(), auto: true };
      // One kept copy per show: the newest replaces the last.
      await writeAll(s.id, [kept, ...list.filter((x) => !(x.auto && x.showId === show))]);
    }
    const look = clean({ ...cur, ...next(cur) }, await assetsOf(s.id));
    if (typeof look === "string") return look;
    const out = await saveLook(s.id, cur.rev, look);
    if (out) return out;
  }
  return "Your studio changed in another window. Try again.";
}

export function registerStudioSetups(app: Express, requireHostSession: RequestHandler): void {
  const studio = async (req: Request, res: import("express").Response, change = false) => {
    const s = await studioOf(me(req));
    if (!s) { res.status(404).json({ message: "Open your studio first." }); return null; }
    if (change && (s.liveEgressId || s.recordingEgressId)) { res.status(409).json({ message: "You're live or recording. Change setups after the show." }); return null; }
    return s;
  };

  /** The setups for the show the studio is set to, newest used first, and what the studio has now. */
  app.get("/api/host/my-studio/setups", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const s = await studio(req, res);
    if (!s) return;
    const show = await showOf(s);
    const cur = await getLook(s.id);
    const [row] = await db.select({ at: roomLooks.updatedAt }).from(roomLooks).where(eq(roomLooks.studioId, s.id)).limit(1);
    const list = mine(await readAll(s.id), show).sort((a, b) => b.usedAt.localeCompare(a.usedAt));
    const was = strip(cur);
    const named = list.find((x) => !x.auto && sameScenes(x.look, was));
    res.json({
      current: cur.rev > 0 ? { name: named?.name ?? "Last time", usedAt: row?.at ?? "", scenes: cur.scenes.length, clips: cur.videos?.length ?? 0, first: card({ look: was } as Setup).first } : null,
      setups: list.map(card),
    });
  });

  /** Save the studio's look now as a setup. The same name for the same show updates that one. */
  app.post("/api/host/my-studio/setups", requireHostSession, async (req, res) => {
    const s = await studio(req, res);
    if (!s) return;
    const name = String(req.body?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!name) return res.status(400).json({ message: "Give your setup a name." });
    const show = await showOf(s);
    const list = await readAll(s.id);
    const look = strip(await getLook(s.id));
    const same = list.find((x) => !x.auto && x.showId === show && x.name.toLowerCase() === name.toLowerCase());
    if (!same && list.filter((x) => !x.auto).length >= MAX - 1) return res.status(400).json({ message: `You have ${MAX - 1} saved setups. Delete one first.` });
    const saved: Setup = same ? { ...same, name, look, savedAt: now(), usedAt: now() } : { id: crypto.randomBytes(5).toString("hex"), name, showId: show, look, savedAt: now(), usedAt: now() };
    await writeAll(s.id, [saved, ...list.filter((x) => x.id !== saved.id)]);
    res.json({ setup: card(saved), updated: !!same });
  });

  /** Use a saved setup: the studio's look becomes it. */
  app.post("/api/host/my-studio/setups/:id/use", requireHostSession, async (req, res) => {
    const s = await studio(req, res, true);
    if (!s) return;
    const list = await readAll(s.id);
    const x = list.find((y) => y.id === req.params.id);
    if (!x) return res.status(404).json({ message: "That setup isn't there any more." });
    const out = await replaceLook(s, () => x.look as unknown as Record<string, unknown>);
    if (typeof out === "string") return res.status(409).json({ message: out });
    const after = await readAll(s.id);
    await writeAll(s.id, after.map((y) => (y.id === x.id ? { ...y, usedAt: now() } : y)));
    res.json({ look: out });
  });

  /**
   * Start fresh: a template's scenes (the style, logo and Media stay), or Blank: one "Just me" scene and a clean
   * Media panel (Andrew, 26 Nov: "Everything should be clean and shouldn't have any logos or preset anything"): no
   * logo or show icon, banners, video clips, backgrounds or music, and the sound pads back to the starting set.
   * Nothing is deleted: the uploads stay, and the look that was there is kept as "Before <date>".
   */
  app.post("/api/host/my-studio/setups/fresh", requireHostSession, async (req, res) => {
    const s = await studio(req, res, true);
    if (!s) return;
    const tpl = req.body?.template === "blank" ? null : templateById(String(req.body?.template ?? ""));
    if (req.body?.template !== "blank" && !tpl) return res.status(400).json({ message: "Pick a template." });
    const v3 = req.body?.v3 === true;
    const out = await replaceLook(s, (cur) => {
      const blank = tpl ? null : freshLook();
      const background = blank ? blank.background : cur.background;
      const taken = new Set<string>();
      const scenes = (tpl ? tpl.scenes(v3) : [{ name: "Just me", type: "single" as const, layout: "solo" as const, people: 1 }]).map((x, i) => {
        const name = freeName(x.name, taken);
        taken.add(name);
        return { ...x, name, id: crypto.randomBytes(4).toString("hex"), n: i + 1, stage: [], look: { background } };
      });
      if (!blank) return { scenes };
      return {
        scenes, background, logo: null, showIcon: false, logos: [], backgrounds: [], banners: [],
        videos: [], intro: null, outro: null, sounds: blank.sounds, music: [],
      };
    });
    if (typeof out === "string") return res.status(409).json({ message: out });
    res.json({ look: out });
  });

  app.patch("/api/host/my-studio/setups/:id", requireHostSession, async (req, res) => {
    const s = await studio(req, res);
    if (!s) return;
    const name = String(req.body?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!name) return res.status(400).json({ message: "Give your setup a name." });
    const list = await readAll(s.id);
    if (!list.some((x) => x.id === req.params.id)) return res.status(404).json({ message: "That setup isn't there any more." });
    await writeAll(s.id, list.map((x) => (x.id === req.params.id ? { ...x, name, auto: false } : x)));
    res.json({ ok: true });
  });

  app.post("/api/host/my-studio/setups/:id/duplicate", requireHostSession, async (req, res) => {
    const s = await studio(req, res);
    if (!s) return;
    const list = await readAll(s.id);
    const x = list.find((y) => y.id === req.params.id);
    if (!x) return res.status(404).json({ message: "That setup isn't there any more." });
    if (list.filter((y) => !y.auto).length >= MAX - 1) return res.status(400).json({ message: `You have ${MAX - 1} saved setups. Delete one first.` });
    const taken = new Set(list.filter((y) => y.showId === x.showId).map((y) => y.name));
    const copy: Setup = { ...x, id: crypto.randomBytes(5).toString("hex"), name: freeName(`${x.name} copy`, taken), auto: false, savedAt: now(), usedAt: x.usedAt };
    await writeAll(s.id, [...list, copy]);
    res.json({ setup: card(copy) });
  });

  app.delete("/api/host/my-studio/setups/:id", requireHostSession, async (req, res) => {
    const s = await studio(req, res);
    if (!s) return;
    const list = await readAll(s.id);
    await writeAll(s.id, list.filter((x) => x.id !== req.params.id));
    res.json({ ok: true });
  });
}
