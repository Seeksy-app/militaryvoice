// The check before the green room (6 Oct AAR): a still from the guest's own
// camera, looked at by SI the way a good producer would at the door — is
// there enough light, are they centred, is the background busy, are they too
// close or too far — and told in plain words, before anyone else sees them.
//
// On show day the fixes happened live, in front of other guests (echo, a
// muted mic, a face in shadow). This moves them to the door, one person at a
// time, with nobody watching.
import type { Express } from "express";
import Anthropic from "@anthropic-ai/sdk";

type Item = { area: "light" | "framing" | "background" | "distance" | "camera"; ok: boolean; tip: string };
type Review = { verdict: "good" | "fix"; summary: string; items: Item[] };

const SYSTEM = `You check how someone looks on camera before they join a live podcast broadcast. You get one still from their webcam (it may be mirrored).

Judge five things: light (is the face well and evenly lit, not backlit or in shadow), framing (eyes about a third from the top, face centred, head not cut off), distance (head and shoulders in frame, not too close or far), background (tidy and not distracting; a plain wall or a bookshelf is fine), camera (roughly eye level, not looking up the nose or down from above).

Be kind and brief. Each tip is one short plain sentence telling them what to do, like "Turn on a lamp in front of you" or "Raise your laptop so the camera is at eye level". If something is fine, say what's good in a few words. Never comment on the person's appearance, body, age, race, clothing or anything personal; only light, camera and room.

If there's no face in the picture, say so under framing and set verdict to "fix".

Reply with JSON only:
{"verdict":"good"|"fix","summary":"one short sentence","items":[{"area":"light","ok":true,"tip":"..."},{"area":"framing",...},{"area":"distance",...},{"area":"background",...},{"area":"camera",...}]}
Use "fix" only when something would clearly look bad on air.`;

// A little protection: one review every few seconds per address.
const last = new Map<string, number>();

export function registerDeviceCheck(app: Express) {
  app.post("/api/studio/shot-review", async (req, res) => {
    const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
    const now = Date.now();
    if (now - (last.get(ip) ?? 0) < 4000) return res.status(429).json({ message: "One moment, then try again." });
    last.set(ip, now);
    if (last.size > 5000) last.clear();

    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.image ?? ""));
    if (!m || m[2].length > 1_500_000) return res.status(400).json({ message: "Send a still from your camera." });
    try {
      const client = new Anthropic();
      const msg = await client.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 600,
        system: SYSTEM,
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: `image/${m[1]}` as "image/jpeg", data: m[2] } }, { type: "text", text: "Check my shot." }] }],
      });
      const text = msg.content.find((c) => c.type === "text")?.text ?? "";
      const json = /\{[\s\S]*\}/.exec(text)?.[0];
      const r = JSON.parse(json ?? "{}") as Partial<Review>;
      const items = (Array.isArray(r.items) ? r.items : []).slice(0, 6).map((i) => ({ area: String(i?.area ?? ""), ok: Boolean(i?.ok), tip: String(i?.tip ?? "").slice(0, 160) }));
      res.json({ verdict: r.verdict === "fix" ? "fix" : "good", summary: String(r.summary ?? "").slice(0, 200), items });
    } catch (err) {
      console.error("Shot review failed:", err);
      // Our outage must never keep a guest out: they're told and let through.
      res.json({ verdict: "good", summary: "We couldn't check your shot just now, so go ahead.", items: [], unavailable: true });
    }
  });
}
