// World Labs Marble 2 beta (9 Oct 2026): first requests, admin only, while we pilot 3D studio
// tours for SmartLinks. Key in Vercel as WORLDLABS_API_KEY; base per atlas-beta.worldlabs.ai/docs.
import type { Express, RequestHandler } from "express";
import crypto from "node:crypto";

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

  /** One check on an operation (non-blocking, safe to repeat). */
  app.get("/api/admin/worldlabs/operations/:id", requireAdmin, async (req, res) => {
    if (!key()) return res.status(503).json({ message: "WORLDLABS_API_KEY isn't set on the server." });
    const r = await fetch(`${BASE}/operations/${encodeURIComponent(String(req.params.id))}`, { headers: { "WLT-Api-Key": key() }, signal: AbortSignal.timeout(20_000) })
      .catch((e: Error) => ({ ok: false, status: 502, json: async () => ({ message: e.message }) }) as unknown as Response);
    res.status(r.ok ? 200 : r.status).json(await r.json().catch(() => ({})));
  });
}
