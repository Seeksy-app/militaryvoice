// Layout suggestion (19 Nov 2026): the worker looks at a recording for two people on screen and, if it is sure, writes a
// suggestion on the recording (recordings.layout_suggestion) with a still of each layout. It NEVER changes a render by itself:
// Radio stays as it is, and everything else stays "Automatic" until the person picks. The Make clips screen shows the
// suggestion as a banner and the choice goes in the normal clip options (layout "stacked" | "side" | "single").
//
// layout_suggestion is "" (not looked at), or JSON:
//   { status: "running" | "done" | "none" | "failed", suggested?: "stacked", people?: 2, confidence?: 0..1, reason?: string,
//     previews?: { stacked?: url, side?: url, single?: url }, at: iso }
import type { Express, RequestHandler } from "express";
import { storage } from "./storage.js";

const url = (v: unknown) => { const s = String(v ?? "").trim(); return /^https:\/\/[^\s"]+$/i.test(s) ? s.slice(0, 600) : ""; };

export function registerLayoutSuggest(app: Express, requireAgent: RequestHandler): void {
  app.post("/api/agent/layout-suggest/:id/done", requireAgent, async (req, res) => {
    const id = Number(req.params.id);
    const rec = await storage.getRecording(id);
    if (!rec) return res.status(404).json({ message: "No such recording." });
    const b = req.body ?? {};
    const confidence = Math.max(0, Math.min(1, Number(b.confidence) || 0));
    const sure = b.suggested === "stacked" && Number(b.people) >= 2 && confidence >= 0.66;
    const previews = Object.fromEntries((["stacked", "side", "single"] as const).map((k) => [k, url(b.previews?.[k])]).filter(([, v]) => v));
    const value = sure
      ? { status: "done", suggested: "stacked", people: 2, confidence: Math.round(confidence * 100) / 100, reason: String(b.reason ?? "").slice(0, 200), previews, at: new Date().toISOString() }
      : { status: "none", at: new Date().toISOString() };
    await storage.setLayoutSuggestion(id, JSON.stringify(value));
    res.json({ ok: true, status: value.status });
  });

  app.post("/api/agent/layout-suggest/:id/failed", requireAgent, async (req, res) => {
    await storage.setLayoutSuggestion(Number(req.params.id), JSON.stringify({ status: "failed", at: new Date().toISOString() }));
    res.json({ ok: true });
  });
}
