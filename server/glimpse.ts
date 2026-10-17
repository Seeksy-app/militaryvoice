// Glimpse (Elorian) visual review: the switch, the budget, the queue and the
// results. A pilot, off unless an admin turns it on (Admin → Clips). See
// docs/glimpse-discovery.md and shared/glimpse.ts.
//
// The key lives on the clip worker (ELORIAN_API_KEY on Render), which cuts
// each clip's excerpt and asks Elorian; this side decides what may go and
// keeps what comes back. Everything is in site_settings:
//   glimpse:on              "1" when switched on
//   glimpse:cap             the day's ceiling in micro-dollars
//   glimpse:spend:<day>     {reserved, actual} for that UTC day
//   glimpse:stopped         why the worker stopped it (a bad key, no credit)
//   glimpse:clip:<clipId>   that clip's GlimpseState
//   glimpse:worker          when the worker last asked, and whether it has a key
import type { Express, RequestHandler } from "express";
import { like } from "drizzle-orm";
import { db, storage } from "./storage.js";
import { signedRecordingUrl } from "./recordingStorage.js";
import { getAdminEmail } from "./session.js";
import { siteSettings } from "../shared/schema.js";
import {
  GLIMPSE_DEFAULT_CAP_MICRO, GLIMPSE_MAX_CLIPS, GLIMPSE_MAX_SEC, GLIMPSE_MAX_TOKENS, GLIMPSE_MODEL, GLIMPSE_RESERVE_MICRO,
  glimpseCostMicro, glimpseFits, glimpsePrompt, glimpseStops, parseGlimpse, type GlimpseState, type GlimpseUsage,
} from "../shared/glimpse.js";

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const KEY = (clipId: number) => `glimpse:clip:${clipId}`;
/** A clip out this long with no answer is written off: it may well have been charged. */
const STALE_MS = 30 * 60_000;

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try { return (JSON.parse((await storage.getSetting(key)) ?? "") as T) ?? fallback; } catch { return fallback; }
}
const write = (key: string, v: unknown) => storage.setSetting(key, JSON.stringify(v));

async function isOn() { return (await storage.getSetting("glimpse:on")) === "1"; }
async function cap() { return Number(await storage.getSetting("glimpse:cap")) || GLIMPSE_DEFAULT_CAP_MICRO; }
type Spend = { reserved: number; actual: number };
const spendOf = (day: string) => readJson<Spend>(`glimpse:spend:${day}`, { reserved: 0, actual: 0 });
async function addSpend(day: string, d: Partial<Spend>) {
  const s = await spendOf(day);
  await write(`glimpse:spend:${day}`, { reserved: Math.max(0, s.reserved + (d.reserved ?? 0)), actual: s.actual + (d.actual ?? 0) });
}

async function allStates(): Promise<{ clipId: number; state: GlimpseState }[]> {
  const rows = await db.select().from(siteSettings).where(like(siteSettings.key, "glimpse:clip:%"));
  return rows.flatMap((r) => {
    try { return [{ clipId: Number(r.key.split(":")[2]), state: JSON.parse(r.value) as GlimpseState }]; } catch { return []; }
  });
}

export function registerGlimpse(app: Express, requireAdmin: RequestHandler, requireAgent: RequestHandler): void {
  /** The panel: switch, money, what the worker said last, and one recording's clips with their reviews. */
  app.get("/api/admin/glimpse", requireAdmin, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const recId = Number(req.query.rec) || 0;
    const rec = recId ? await storage.getRecording(recId) : undefined;
    const clips = rec ? (await storage.listClips(rec.id)).sort((a, b) => a.startSec - b.startSec) : [];
    const reviews: Record<number, GlimpseState> = {};
    for (const c of clips) {
      const s = await readJson<GlimpseState | null>(KEY(c.id), null);
      if (s) reviews[c.id] = s;
    }
    // Recordings that have been reviewed, so the last one is one click away.
    const recent = Array.from(new Set((await allStates()).map((x) => x.state.recordingId))).slice(-8);
    res.json({
      on: await isOn(),
      capMicro: await cap(),
      spend: await spendOf(today()),
      stopped: (await storage.getSetting("glimpse:stopped")) ?? "",
      worker: await readJson<{ at: string; hasKey: boolean } | null>("glimpse:worker", null),
      recording: rec ? { id: rec.id, title: rec.title, email: rec.email, durationSec: rec.durationSec } : null,
      clips: clips.map((c) => ({ id: c.id, title: c.title, reason: c.reason, startSec: c.startSec, endSec: c.endSec, verticalUrl: c.verticalUrl, source: c.source })),
      reviews,
      recent: await Promise.all(recent.map(async (id) => ({ id, title: (await storage.getRecording(id))?.title ?? `Recording #${id}` }))),
    });
  });

  app.post("/api/admin/glimpse/switch", requireAdmin, async (req, res) => {
    const on = req.body?.on === true;
    await storage.setSetting("glimpse:on", on ? "1" : "0");
    if (on) await storage.setSetting("glimpse:stopped", "");
    const capUsd = Number(req.body?.capUsd);
    if (Number.isFinite(capUsd) && capUsd > 0 && capUsd <= 5) await storage.setSetting("glimpse:cap", String(Math.round(capUsd * 1e6)));
    res.json({ on, capMicro: await cap() });
  });

  /**
   * Review a recording's clips: pressing this is the approval for that media.
   * Only clips cut from the original file, up to six, each up to 75 seconds.
   */
  app.post("/api/admin/glimpse/review", requireAdmin, async (req, res) => {
    if (!(await isOn())) return res.status(409).json({ message: "Glimpse is switched off." });
    const rec = await storage.getRecording(Number(req.body?.recordingId) || 0);
    if (!rec || !rec.url) return res.status(404).json({ message: "No such recording, or it has no file." });
    const by = getAdminEmail(req) ?? "admin";
    const clips = (await storage.listClips(rec.id)).sort((a, b) => a.startSec - b.startSec).slice(0, GLIMPSE_MAX_CLIPS);
    let queued = 0;
    for (const c of clips) {
      const prev = await readJson<GlimpseState | null>(KEY(c.id), null);
      if (prev && ["queued", "running", "done"].includes(prev.status)) continue;
      const end = Math.min(c.endSec, c.startSec + GLIMPSE_MAX_SEC);
      const skip = c.source === "clean" ? "Cut from the clean episode; the pilot only sends the original." : end <= c.startSec ? "No length." : "";
      await write(KEY(c.id), { status: skip ? "skipped" : "queued", error: skip || undefined, recordingId: rec.id, sourceStart: c.startSec, sourceEnd: end, requestedBy: by, queuedAt: now() } satisfies GlimpseState);
      if (!skip) queued++;
    }
    res.json({ queued, estimateMicro: queued * 40_000 });
  });

  /** A person's call on one clip's review. */
  app.post("/api/admin/glimpse/:clipId/verdict", requireAdmin, async (req, res) => {
    const id = Number(req.params.clipId);
    const s = await readJson<GlimpseState | null>(KEY(id), null);
    if (!s || s.status !== "done") return res.status(404).json({ message: "No finished review for that clip." });
    s.review = { useful: req.body?.useful === true, note: String(req.body?.note ?? "").slice(0, 500), by: getAdminEmail(req) ?? "admin", at: now() };
    await write(KEY(id), s);
    res.json({ ok: true });
  });

  /**
   * The worker asks for the next clip. It says whether it has a key, so the
   * panel can tell "nobody's listening" from "nothing to do". Nothing is handed
   * out when the switch is off, the stop flag is up, or the day's money is spoken for.
   */
  app.post("/api/agent/glimpse/claim", requireAgent, async (req, res) => {
    const hasKey = req.body?.hasKey === true;
    await write("glimpse:worker", { at: now(), hasKey });
    if (!hasKey || !(await isOn())) return res.json({ job: null });
    const states = await allStates();
    // Anything out too long: written off, its reservation counted as spent.
    for (const { clipId, state } of states) {
      if (state.status === "running" && state.startedAt && Date.now() - Date.parse(state.startedAt) > STALE_MS) {
        await write(KEY(clipId), { ...state, status: "failed", finishedAt: now(), error: "No answer came back within 30 minutes. Elorian may still have charged for it." });
        await addSpend(state.startedAt.slice(0, 10), { reserved: -GLIMPSE_RESERVE_MICRO, actual: GLIMPSE_RESERVE_MICRO });
      }
    }
    const next = states.filter((x) => x.state.status === "queued").sort((a, b) => a.state.queuedAt.localeCompare(b.state.queuedAt))[0];
    if (!next) return res.json({ job: null });
    const s = await spendOf(today());
    if (!glimpseFits(s, await cap())) return res.json({ job: null, waiting: "The day's Glimpse budget is used." });

    const clip = await storage.getClip(next.clipId);
    const rec = clip ? await storage.getRecording(clip.recordingId) : undefined;
    if (!clip || !rec?.url) {
      await write(KEY(next.clipId), { ...next.state, status: "failed", finishedAt: now(), error: "The clip or its recording is gone." });
      return res.json({ job: null });
    }
    await addSpend(today(), { reserved: GLIMPSE_RESERVE_MICRO });
    await write(KEY(next.clipId), { ...next.state, status: "running", startedAt: now() });
    const sourceUrl = /^https?:\/\//i.test(rec.url) ? rec.url : await signedRecordingUrl(rec.url, 2 * 3600);
    const dur = next.state.sourceEnd - next.state.sourceStart;
    res.json({
      job: {
        clipId: clip.id,
        recordingId: rec.id,
        sourceUrl,
        startSec: next.state.sourceStart,
        durationSec: dur,
        model: GLIMPSE_MODEL,
        maxTokens: GLIMPSE_MAX_TOKENS,
        prompt: glimpsePrompt(dur, clip.transcript),
      },
    });
  });

  /**
   * What came back. `text` is the model's answer as sent; it's checked here.
   * A stop (bad key, no credit) also switches Glimpse off, so nothing else goes.
   */
  app.post("/api/agent/glimpse/:clipId/result", requireAgent, async (req, res) => {
    const id = Number(req.params.clipId);
    const s = await readJson<GlimpseState | null>(KEY(id), null);
    if (!s || s.status !== "running") return res.status(409).json({ message: "That clip isn't out for review." });
    const b = req.body ?? {};
    const usage = (b.usage ?? null) as GlimpseUsage | null;
    // An answer we never saw (a timeout) may still be billed: keep the reservation as spent.
    const cost = usage ? glimpseCostMicro(usage) : b.ambiguous ? GLIMPSE_RESERVE_MICRO : 0;
    await addSpend((s.startedAt ?? now()).slice(0, 10), { reserved: -GLIMPSE_RESERVE_MICRO, actual: cost });
    const base: GlimpseState = {
      ...s,
      finishedAt: now(),
      model: String(b.model ?? GLIMPSE_MODEL).slice(0, 80),
      requestId: String(b.requestId ?? "").slice(0, 120),
      usage: usage ? { prompt: Number(usage.prompt_tokens) || 0, cached: Number(usage.prompt_tokens_details?.cached_tokens) || 0, completion: Number(usage.completion_tokens) || 0, costMicro: cost } : undefined,
    };
    if (!b.ok) {
      const code = String(b.code ?? "");
      if (glimpseStops(Number(b.status) || 0, code)) {
        await storage.setSetting("glimpse:on", "0");
        await storage.setSetting("glimpse:stopped", `Stopped ${now().slice(0, 16).replace("T", " ")} UTC: ${String(b.error ?? code).slice(0, 200)}`);
      }
      await write(KEY(id), { ...base, status: "failed", error: String(b.error ?? "It didn't work.").slice(0, 400) });
      return res.json({ ok: true, stop: glimpseStops(Number(b.status) || 0, code) });
    }
    const parsed = parseGlimpse(String(b.text ?? ""), s.sourceStart, s.sourceEnd - s.sourceStart);
    if (!parsed.ok) {
      await write(KEY(id), { ...base, status: "failed", error: parsed.error, warnings: [String(b.text ?? "").slice(0, 600)] });
      return res.json({ ok: true });
    }
    await write(KEY(id), { ...base, status: "done", observations: parsed.observations, warnings: parsed.warnings });
    res.json({ ok: true });
  });
}
