// YouTube Live by stream key (Andrew, 22 Nov 2026: "Are we able to consolidate all these to just using upload post?" …
// "Yes, one connection"). Clips and episode videos already go to YouTube through Upload-Post; going live was the one thing
// that needed our own Google sign-in. Now a podcaster pastes their channel's stream key once, and the studio's Go live and
// their Radio segment both push to it. The trade-off: we can't set each broadcast's title, so it goes live under the
// channel's default title (set in YouTube Studio).
//
// One key per person, in the site setting yt-key:<email>, sealed like Zoom's tokens. The old Google connections keep
// working until that person saves a key (a key always wins), and YOUTUBE_OAUTH=0 turns the sign-in path off for good.
import type { Express, RequestHandler } from "express";
import { storage } from "./storage.js";
import { seal, unseal } from "./secretBox.js";
import { getSessionEmail } from "./session.js";

/** YouTube's ingest for a persistent stream key. */
export const YOUTUBE_RTMP = "rtmp://a.rtmp.youtube.com/live2";
/** Off with YOUTUBE_OAUTH=0: no Connect with Google, no token refreshes, no broadcasts opened through the API. */
export const YOUTUBE_OAUTH = process.env.YOUTUBE_OAUTH !== "0";

const keyOf = (email: string) => `yt-key:${email.trim().toLowerCase()}`;

export async function getYoutubeKey(email: string): Promise<string> {
  if (!email) return "";
  return unseal((await storage.getSetting(keyOf(email)).catch(() => null)) ?? "");
}
export async function setYoutubeKey(email: string, key: string): Promise<void> {
  await storage.setSetting(keyOf(email), key ? seal(key) : "");
}
export const youtubeKeyHint = (key: string) => (key ? `••••${key.slice(-4)}` : "");
export const youtubePushUrl = (key: string) => `${YOUTUBE_RTMP}/${key}`;

/**
 * What they pasted, as a key: the key itself, or the whole rtmp address with the key on the end. YouTube's are four or five
 * groups of letters and digits joined by dashes; anything that plainly isn't a key is refused.
 */
export function cleanYoutubeKey(raw: unknown): string | null {
  let v = String(raw ?? "").trim();
  const m = v.match(/^rtmps?:\/\/[^\s]*\/live2?\/([^\s/]+)$/i);
  if (m) v = m[1];
  v = v.replace(/\s+/g, "");
  return /^[A-Za-z0-9_-]{12,80}$/.test(v) ? v : null;
}

export function registerYoutubeKey(app: Express, requireHostSession: RequestHandler): void {
  const me = (req: Parameters<RequestHandler>[0]) => (getSessionEmail(req) ?? "").toLowerCase().trim();
  const status = async (email: string) => {
    const key = await getYoutubeKey(email);
    const acct = await storage.getYoutubeAccount(email).catch(() => undefined);
    return {
      saved: !!key,
      hint: youtubeKeyHint(key),
      // The old Google connection, shown with "Switch to a stream key" until they do.
      legacy: !key && acct?.channelId ? { channelTitle: acct.channelTitle || "", scope: acct.scope === "show" ? "show" : "segment" } : null,
    };
  };
  app.get("/api/host/youtube-key", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await status(me(req)));
  });
  app.put("/api/host/youtube-key", requireHostSession, async (req, res) => {
    const email = me(req);
    const key = cleanYoutubeKey(req.body?.key);
    if (!key) return res.status(400).json({ message: "That doesn't look like a YouTube stream key. Copy it from YouTube Studio → Create → Go live → Stream." });
    await setYoutubeKey(email, key);
    res.json(await status(email));
  });
  app.delete("/api/host/youtube-key", requireHostSession, async (req, res) => {
    const email = me(req);
    await setYoutubeKey(email, "");
    res.json(await status(email));
  });
}
