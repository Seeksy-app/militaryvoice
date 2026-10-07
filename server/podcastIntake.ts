// Alex, your podcast producer (7 Oct 2026): a few questions on the Podcast page,
// one at a time, before any advice — what's published, what they record with,
// where it's hosted, whether they can get into that account, where it's listed,
// what's ready, and whether they want to be walked through it or have us do it.
// What we already know (their feed from sign-up) is filled in, not asked.
import type { Express, RequestHandler, Request } from "express";
import { storage } from "./storage.js";
import { slackNote } from "./slack.js";
import { findShows } from "./showFinder.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const meOf = (req: Request) => String((req as unknown as { hostEmail?: string }).hostEmail ?? "").trim().toLowerCase();
const key = (email: string) => `podcast_intake:${email}`;

/** Which host a feed lives on, from its address. */
const HOSTS: [RegExp, string][] = [
  [/buzzsprout\./, "Buzzsprout"], [/libsyn\./, "Libsyn"], [/anchor\.fm|spotify\.com|podcasters\.spotify/, "Spotify for Creators"],
  [/captivate\./, "Captivate"], [/transistor\./, "Transistor"], [/podbean\./, "Podbean"], [/rss\.com/, "RSS.com"],
  [/megaphone\./, "Megaphone"], [/simplecast\./, "Simplecast"], [/podomatic\./, "Podomatic"], [/spreaker\./, "Spreaker"],
  [/blubrry\./, "Blubrry"], [/redcircle\./, "RedCircle"], [/acast\./, "Acast"], [/omny\.fm|omnystudio/, "Omny"], [/soundcloud\./, "SoundCloud"],
  [/militaryvoices\.ai/, "MilitaryVoices"],
];
export function hostOfFeed(rss: string): string {
  const u = rss.toLowerCase();
  return HOSTS.find(([re]) => re.test(u))?.[1] ?? "";
}

export function registerPodcastIntake(app: Express, requireHostSession: RequestHandler) {
  app.get("/api/host/podcast-intake", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const me = meOf(req);
    let saved: { answers?: Record<string, unknown>; done?: boolean } = {};
    try { saved = JSON.parse((await storage.getSetting(key(me))) || "{}"); } catch { /* none */ }
    const profile = await storage.getProfileByEmail(me).catch(() => undefined);
    const rss = (profile?.rssUrl ?? "").trim();
    // What we can tell without asking: their feed's host, and whether Apple has it.
    let apple = "", episodes = 0, title = profile?.podcastName ?? "";
    if (rss && title) {
      const hit = (await findShows(title).catch(() => [])).find((s) => s.rss === rss);
      if (hit) { apple = hit.apple; episodes = hit.episodes; title = hit.title || title; }
    }
    res.json({ answers: saved.answers ?? {}, done: !!saved.done, known: { rss, host: rss ? hostOfFeed(rss) : "", apple, episodes, title } });
  });

  app.put("/api/host/podcast-intake", requireHostSession, async (req, res) => {
    const me = meOf(req);
    const answers = (req.body?.answers ?? {}) as Record<string, unknown>;
    const done = req.body?.done === true;
    await storage.setSetting(key(me), JSON.stringify({ answers, done, at: new Date().toISOString() }));
    if (done) {
      const profile = await storage.getProfileByEmail(me).catch(() => undefined);
      const who = profile?.hostName || me;
      const list = (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v ?? "")) || "?";
      const help = answers.help === "do-it";
      await slackNote(
        `${help ? ":raising_hand:" : ":studio_microphone:"} ${who} (${me}) went through Alex's podcast questions${help ? " and wants us to handle the setup" : ""}. Published: ${list(answers.published)} · records with: ${list(answers.record)} · host: ${list(answers.host)} · has the login: ${list(answers.access)} · listed on: ${list(answers.listed)}`,
        { label: "Open their profile", url: `${ORIGIN}/admin/crm` },
      ).catch(() => {});
    }
    res.json({ ok: true });
  });
}
