// Go-to-market (13 Oct 2026): Admin → Growth → Go-to-market. The promotional library (graphics,
// videos, PDFs, links) and a composer that posts them to Riccoh's own accounts or to
// MilitaryVoices' brand accounts, through Upload-Post. Posts are kept as host_posts (kind "gtm")
// under the account's email, so Riccoh's also show in his own Social desk.
//
// Library: site_settings "gtm:assets" (JSON). MilitaryVoices' Upload-Post profile and its connected
// accounts: "gtm:mv" (JSON). Files go to the public asset bucket, so Upload-Post can fetch them.
import type { Express, RequestHandler } from "express";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { RICCOH_EMAIL } from "./email.js";
import { signedAssetUpload } from "./photoStorage.js";
import { createConnectUrl, ensureUploadPostProfile, fetchConnectedAccounts, isUploadPostConfigured, parseSocialAccounts, publishPhoto, publishVideo } from "./uploadPost.js";
import { hostPosts, type SocialAccount } from "../shared/schema.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const MV_EMAIL = "hello@militaryvoices.ai";
const MV_USERNAME = "mv-brand";
const now = () => new Date().toISOString();
const str = (v: unknown, n: number) => (typeof v === "string" ? v : "").trim().slice(0, n);

export type GtmAsset = { id: string; title: string; kind: "image" | "video" | "pdf" | "link"; url: string; notes: string; tags: string[]; createdAt: string };
type Account = "riccoh" | "mv";

async function assets(): Promise<GtmAsset[]> {
  try { return JSON.parse((await storage.getSetting("gtm:assets")) || "[]") as GtmAsset[]; } catch { return []; }
}
async function saveAssets(list: GtmAsset[]): Promise<void> {
  await storage.setSetting("gtm:assets", JSON.stringify(list));
}
async function mvState(): Promise<{ username: string; accounts: SocialAccount[] }> {
  try { return { username: "", accounts: [], ...JSON.parse((await storage.getSetting("gtm:mv")) || "{}") }; } catch { return { username: "", accounts: [] }; }
}

/** Who posts: the Upload-Post profile and what's connected to it. */
async function accountOf(a: Account): Promise<{ email: string; name: string; username: string; accounts: SocialAccount[] }> {
  if (a === "riccoh") {
    const p = await storage.getProfileByEmail(RICCOH_EMAIL).catch(() => undefined);
    return { email: RICCOH_EMAIL, name: p?.hostName || "Riccoh Player", username: p?.uploadPostUsername ?? "", accounts: parseSocialAccounts(p?.socialAccounts) };
  }
  const m = await mvState();
  return { email: MV_EMAIL, name: "MilitaryVoices.ai", username: m.username, accounts: m.accounts };
}

const VOICE: Record<Account, string> = {
  riccoh: "You write as Riccoh Player, a retired Marine Corps colonel and the host of National Military Podcast Day. First person, warm, direct, proud of the military and veteran community, plain words. Sign-offs like Semper Fi are fine now and then.",
  mv: "You write as MilitaryVoices.ai, the platform for military and veteran podcasters and creators. Brand voice: confident, helpful, plain words, speaks to creators as 'you'. Never use any founder's or staff member's name.",
};

export function registerGtm(app: Express, requireAdmin: RequestHandler): void {
  /** Everything the page needs: the library, both accounts, recent posts. */
  app.get("/api/admin/gtm", requireAdmin, async (_req, res) => {
    await schemaIsReady();
    res.setHeader("Cache-Control", "no-store");
    const [riccoh, mv] = await Promise.all([accountOf("riccoh"), accountOf("mv")]);
    const posts = await db.select().from(hostPosts).where(and(eq(hostPosts.kind, "gtm"), inArray(hostPosts.email, [RICCOH_EMAIL, MV_EMAIL]))).orderBy(desc(hostPosts.createdAt)).limit(40);
    res.json({
      configured: isUploadPostConfigured(),
      assets: await assets(),
      accounts: {
        riccoh: { name: riccoh.name, ready: Boolean(riccoh.username), accounts: riccoh.accounts },
        mv: { name: mv.name, ready: Boolean(mv.username) && mv.accounts.length > 0, accounts: mv.accounts },
      },
      posts: posts.map((p) => ({ id: p.id, account: p.email === RICCOH_EMAIL ? "riccoh" : "mv", title: p.title, description: p.description, platforms: p.platforms, status: p.status, scheduledAt: p.scheduledAt, createdAt: p.createdAt, results: p.results, error: p.error, mediaKey: p.mediaKey })),
    });
  });

  /** A file for the library: a signed upload straight to the public bucket (no size limit through us). */
  app.post("/api/admin/gtm/upload-url", requireAdmin, async (req, res) => {
    const name = str(req.body?.fileName, 120).replace(/[^\w.-]+/g, "-") || "file";
    try { res.json(await signedAssetUpload(`gtm/${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${name}`)); }
    catch (err) { res.status(502).json({ message: (err as Error).message || "Couldn't start the upload." }); }
  });

  /** Add to the library. */
  app.post("/api/admin/gtm/assets", requireAdmin, async (req, res) => {
    const url = str(req.body?.url, 1200);
    const kind = (["image", "video", "pdf", "link"] as const).find((k) => k === req.body?.kind) ?? "link";
    if (!/^https?:\/\//.test(url)) return res.status(400).json({ message: "A file or a link, please." });
    const a: GtmAsset = { id: crypto.randomBytes(6).toString("hex"), title: str(req.body?.title, 160) || "Untitled", kind, url, notes: str(req.body?.notes, 2000), tags: (Array.isArray(req.body?.tags) ? req.body.tags : []).map((t: unknown) => str(t, 40)).filter(Boolean).slice(0, 8), createdAt: now() };
    await saveAssets([a, ...(await assets())]);
    res.json(a);
  });
  app.patch("/api/admin/gtm/assets/:id", requireAdmin, async (req, res) => {
    const list = await assets();
    const a = list.find((x) => x.id === req.params.id);
    if (!a) return res.status(404).json({ message: "Not found." });
    if (typeof req.body?.title === "string") a.title = str(req.body.title, 160) || a.title;
    if (typeof req.body?.notes === "string") a.notes = str(req.body.notes, 2000);
    await saveAssets(list);
    res.json(a);
  });
  app.delete("/api/admin/gtm/assets/:id", requireAdmin, async (req, res) => {
    await saveAssets((await assets()).filter((x) => x.id !== req.params.id));
    res.json({ ok: true });
  });

  /** A caption in the account's voice, for these platforms, from the asset's notes and a brief. */
  app.post("/api/admin/gtm/caption", requireAdmin, async (req, res) => {
    const account: Account = req.body?.account === "mv" ? "mv" : "riccoh";
    const a = (await assets()).find((x) => x.id === req.body?.assetId);
    const platforms = (Array.isArray(req.body?.platforms) ? req.body.platforms : []).map((p: unknown) => str(p, 20)).filter(Boolean);
    const brief = str(req.body?.brief, 800);
    const facts = [a ? `What's being posted: ${a.title} (${a.kind})` : "", a?.notes ? `Facts and notes: ${a.notes}` : "", brief ? `What the post should say: ${brief}` : "", `Link to include if it fits: ${a?.kind === "link" ? a.url : ORIGIN}`].filter(Boolean).join("\n");
    try {
      const out = await new Anthropic().messages.create({
        model: "claude-sonnet-5",
        max_tokens: 500,
        system: `${VOICE[account]} Write one social media post for ${platforms.join(", ") || "Instagram, Facebook and LinkedIn"}. Under 600 characters, 2 to 4 short paragraphs, at most 3 hashtags at the end, no emoji walls. Use only the facts given: never invent numbers, names, dates or quotes. Return only the post text.`,
        messages: [{ role: "user", content: facts || "Write a short post inviting military and veteran podcasters to MilitaryVoices.ai." }],
      });
      res.json({ caption: out.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("").trim() });
    } catch (err) {
      console.error("GTM caption failed:", (err as Error).message);
      res.status(502).json({ message: "Couldn't write one just now. Try again in a moment." });
    }
  });

  /** Post an image or a video from the library, now or at a time, to the accounts picked. */
  app.post("/api/admin/gtm/post", requireAdmin, async (req, res) => {
    if (!isUploadPostConfigured()) return res.status(503).json({ message: "Posting to socials isn't switched on." });
    const account: Account = req.body?.account === "mv" ? "mv" : "riccoh";
    const who = await accountOf(account);
    if (!who.username || !who.accounts.length) return res.status(400).json({ message: account === "mv" ? "Connect MilitaryVoices' accounts first." : "Riccoh's accounts aren't connected." });
    const a = (await assets()).find((x) => x.id === req.body?.assetId);
    if (!a || (a.kind !== "image" && a.kind !== "video")) return res.status(400).json({ message: "Pick a picture or a video to post." });
    const have = new Set(who.accounts.map((x) => x.platform));
    const platforms = (Array.isArray(req.body?.platforms) ? req.body.platforms : []).map((p: unknown) => String(p).toLowerCase()).filter((p: string) => have.has(p as SocialAccount["platform"]) && (a.kind === "video" || p !== "youtube"));
    if (!platforms.length) return res.status(400).json({ message: "Pick at least one account to post to." });
    const caption = str(req.body?.caption, 5000);
    const title = str(req.body?.title, 100) || a.title;
    const raw = str(req.body?.scheduledAt, 40);
    const when = raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : "";
    if (when && Date.parse(when) < Date.now() + 60_000) return res.status(400).json({ message: "Pick a time in the future." });
    const row = await storage.addHostPost({ email: who.email, kind: "gtm", refId: 0, shape: a.kind, title, description: caption, platforms: platforms.join(","), scheduledAt: when, status: "sending", error: "", jobId: "", requestId: "", results: "", mediaKey: a.url, metrics: "", metricsAt: "" });
    try {
      const common = { username: who.username, platforms, title, description: caption || undefined, scheduledDate: when || undefined, timezone: when ? "UTC" : undefined, externalId: `hp-${row.id}` };
      const r = a.kind === "video"
        ? await publishVideo({ ...common, videoUrl: a.url, youtube: platforms.includes("youtube") ? { title, description: caption, privacyStatus: "public" } : undefined })
        : await publishPhoto({ ...common, photoUrl: a.url });
      await storage.updateHostPost(row.id, { status: when ? "scheduled" : "sent", jobId: r.jobId ?? "", requestId: r.requestId ?? `hp-${row.id}` });
      res.json({ ok: true, scheduled: Boolean(when) });
    } catch (err) {
      await storage.updateHostPost(row.id, { status: "failed", error: ((err as Error).message || "Failed").slice(0, 300) });
      res.status(502).json({ message: (err as Error).message || "Couldn't post that right now." });
    }
  });

  /** MilitaryVoices' own accounts: start Upload-Post's connect page, and read back what's connected. */
  app.post("/api/admin/gtm/connect", requireAdmin, async (_req, res) => {
    if (!isUploadPostConfigured()) return res.status(503).json({ message: "Posting to socials isn't switched on." });
    try {
      await ensureUploadPostProfile(MV_USERNAME);
      const m = await mvState();
      if (!m.username) await storage.setSetting("gtm:mv", JSON.stringify({ ...m, username: MV_USERNAME }));
      const url = await createConnectUrl({ username: MV_USERNAME, redirectUrl: `${ORIGIN}/admin?tab=gtm&social=connected`, logoUrl: `${ORIGIN}/favicon.png` });
      res.json({ url });
    } catch (err) {
      console.error("GTM connect failed:", err);
      res.status(502).json({ message: "Couldn't start connecting right now. Try again in a minute." });
    }
  });
  app.post("/api/admin/gtm/refresh", requireAdmin, async (_req, res) => {
    const m = await mvState();
    if (!m.username) return res.json({ accounts: [] });
    const accounts = await fetchConnectedAccounts(m.username).catch(() => m.accounts);
    await storage.setSetting("gtm:mv", JSON.stringify({ ...m, accounts }));
    res.json({ accounts });
  });
}
