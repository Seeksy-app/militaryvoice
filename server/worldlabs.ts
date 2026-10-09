// World Labs Marble 2 beta (9 Oct 2026): first requests, admin only, while we pilot 3D studio
// tours for SmartLinks. Key in Vercel as WORLDLABS_API_KEY; base per atlas-beta.worldlabs.ai/docs.
import type { Express, RequestHandler } from "express";
import crypto from "node:crypto";
import { putRecordingObject } from "./recordingStorage.js";

const BASE = (process.env.WLT_API_BASE_URL || "https://api.atlas-beta.worldlabs.ai/api/v2").replace(/\/+$/, "");
const key = () => process.env.WORLDLABS_API_KEY || process.env.WLT_API_KEY || "";

export function registerWorldLabs(app: Express, requireAdmin: RequestHandler) {
  /** images2PosedRGBD on one or more public photos: returns the operation to poll. */
  app.post("/api/admin/worldlabs/rgbd", requireAdmin, async (req, res) => {
    if (!key()) return res.status(503).json({ message: "WORLDLABS_API_KEY isn't set on the server." });
    const urls: string[] = (Array.isArray(req.body?.imageUrls) ? req.body.imageUrls : [req.body?.imageUrl]).map((u: unknown) => String(u ?? "")).filter((u: string) => /^https:\/\//.test(u)).slice(0, 8);
    if (!urls.length) return res.status(400).json({ message: "Which photo (a public https link)?" });
    const r = await fetch(`${BASE}/tasks:images2PosedRGBD`, {
      method: "POST",
      headers: { "WLT-Api-Key": key(), "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ frames: urls.map((url) => ({ imageAsset: { url } })), targetResolution: [1280, 720] }),
      signal: AbortSignal.timeout(30_000),
    }).catch((e: Error) => ({ ok: false, status: 502, json: async () => ({ message: e.message }) }) as unknown as Response);
    res.status(r.ok ? 200 : r.status).json(await r.json().catch(() => ({})));
  });

  /**
   * Any Atlas task with a body we build (9 Oct: posing several overlapping photos together, then
   * atlasGenerate for new viewpoints). The body passes straight through; returns the operation.
   */
  const TASKS = new Set(["images2PosedRGBD", "atlasGenerate", "atlasMasked", "atlasTextToImage", "atlasChisel"]);
  app.post("/api/admin/worldlabs/task/:name", requireAdmin, async (req, res) => {
    if (!key()) return res.status(503).json({ message: "WORLDLABS_API_KEY isn't set on the server." });
    const name = String(req.params.name);
    if (!TASKS.has(name)) return res.status(400).json({ message: `Unknown task: ${name}` });
    const r = await fetch(`${BASE}/tasks:${name}`, {
      method: "POST",
      headers: { "WLT-Api-Key": key(), "Content-Type": "application/json", "Idempotency-Key": String(req.headers["idempotency-key"] || crypto.randomUUID()) },
      body: JSON.stringify(req.body ?? {}),
      signal: AbortSignal.timeout(30_000),
    }).catch((e: Error) => ({ ok: false, status: 502, json: async () => ({ message: e.message }) }) as unknown as Response);
    res.status(r.ok ? 200 : r.status).json(await r.json().catch(() => ({})));
  });

  /**
   * Keep a finished operation's pictures (9 Oct): World Labs' output links are signed and expire, so
   * each frame's image is copied into our storage at worldlabs/<operationId>/<n>.<ext>. Returns the paths.
   */
  app.post("/api/admin/worldlabs/operations/:id/save", requireAdmin, async (req, res) => {
    if (!key()) return res.status(503).json({ message: "WORLDLABS_API_KEY isn't set on the server." });
    const id = String(req.params.id).replace(/[^a-zA-Z0-9_-]/g, "");
    const op = await fetch(`${BASE}/operations/${id}`, { headers: { "WLT-Api-Key": key() }, signal: AbortSignal.timeout(20_000) }).then((r) => r.json()).catch(() => null);
    const frames: { imageAsset?: { url?: string } }[] = op?.response?.frames ?? [];
    if (!op?.done || !frames.length) return res.status(409).json({ message: "That operation isn't finished, or has no pictures." });
    const saved: string[] = [];
    for (let i = 0; i < frames.length; i++) {
      const url = frames[i].imageAsset?.url;
      if (!url) continue;
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
      if (!r?.ok) continue;
      const type = r.headers.get("content-type") || "image/png";
      const path = `worldlabs/${id}/${i + 1}.${type.includes("jpeg") ? "jpg" : type.includes("webp") ? "webp" : "png"}`;
      await putRecordingObject(path, Buffer.from(await r.arrayBuffer()), type);
      saved.push(path);
    }
    res.json({ id, saved, promptUsed: op.response?.promptUsed ?? null });
  });

  /** One check on an operation (non-blocking, safe to repeat). */
  app.get("/api/admin/worldlabs/operations/:id", requireAdmin, async (req, res) => {
    if (!key()) return res.status(503).json({ message: "WORLDLABS_API_KEY isn't set on the server." });
    const r = await fetch(`${BASE}/operations/${encodeURIComponent(String(req.params.id))}`, { headers: { "WLT-Api-Key": key() }, signal: AbortSignal.timeout(20_000) })
      .catch((e: Error) => ({ ok: false, status: 502, json: async () => ({ message: e.message }) }) as unknown as Response);
    res.status(r.ok ? 200 : r.status).json(await r.json().catch(() => ({})));
  });
}
