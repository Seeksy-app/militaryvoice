import type { Express, RequestHandler } from "express";
import { storage } from "./storage.js";
import { requireHostSession } from "./session.js";
import { putRecordingObject, signedRecordingUrl } from "./recordingStorage.js";
import { MUSIC_SEEDS } from "../shared/music.js";

/**
 * Pōstify's music library. The admin generates each track once with
 * ElevenLabs Music; podcasters pick one to play under their clips.
 */
const elevenKey = () => (process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY || "").trim();

async function compose(prompt: string, seconds: number): Promise<Buffer> {
  const key = elevenKey();
  if (!key) throw new Error("ELEVENLABS_API_KEY isn't set.");
  let last = "";
  // The newest model first; the original if the account can't use it.
  for (const model of ["music_v2_5", "music_v1"]) {
    const r = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192", {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, music_length_ms: Math.round(seconds * 1000), model_id: model, force_instrumental: true }),
    });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    last = `${r.status} ${(await r.text()).slice(0, 300)}`;
    if (r.status !== 422 && r.status !== 400) break;
  }
  throw new Error(`ElevenLabs: ${last}`);
}

export function registerMusic(app: Express, requireAdmin: RequestHandler): void {
  /** The tracks a podcaster can pick. */
  app.get("/api/music", requireHostSession, async (_req, res) => {
    res.set("Cache-Control", "private, max-age=300");
    res.json((await storage.listMusic()).filter((t) => t.url).map((t) => ({ key: t.key, name: t.name, mood: t.mood, durationSec: t.durationSec })));
  });

  /** A short-lived link to play a track. */
  app.get("/api/music/:key/audio", requireHostSession, async (req, res) => {
    const t = await storage.getMusic(String(req.params.key));
    if (!t?.url) return res.status(404).json({ message: "No such track." });
    res.redirect(302, await signedRecordingUrl(t.url, 3600));
  });

  /** Admin: what's generated and what isn't. */
  app.get("/api/admin/music", requireAdmin, async (_req, res) => {
    const have = new Map((await storage.listMusic()).map((t) => [t.key, t]));
    res.json(MUSIC_SEEDS.map((s) => ({ key: s.key, name: s.name, mood: s.mood, generated: !!have.get(s.key)?.url })));
  });

  /** Admin: make one track (a seed by key), or remake it. */
  app.post("/api/admin/music/generate", requireAdmin, async (req, res) => {
    const seed = MUSIC_SEEDS.find((s) => s.key === String(req.body?.key ?? ""));
    if (!seed) return res.status(404).json({ message: "No such seed." });
    try {
      const mp3 = await compose(String(req.body?.prompt || seed.prompt), seed.seconds);
      const path = `music/${seed.key}.mp3`;
      await putRecordingObject(path, mp3, "audio/mpeg");
      const row = await storage.upsertMusic({ key: seed.key, name: seed.name, mood: seed.mood, prompt: seed.prompt, url: path, durationSec: seed.seconds });
      res.json({ ok: true, key: row.key, bytes: mp3.length });
    } catch (e) {
      res.status(502).json({ message: (e as Error).message });
    }
  });
}
