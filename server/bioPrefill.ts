// A head start on their SmartLink (8 Oct 2026): fill each Marathon podcaster's page
// from what they already gave us (show name, photo, feed, the description on their
// magazine page, the social accounts they connected, their website). Only empty
// things are filled; nothing they've written is touched. A page we make for them
// stays unpublished until they press Publish.
import type { Express, RequestHandler } from "express";
import { and, eq } from "drizzle-orm";
import { db, schemaIsReady } from "./storage.js";
import { parseSocialAccounts } from "./uploadPost.js";
import { freeHandle, slugify } from "./bioPage.js";
import { bioPages, magazinePages, podcasterProfiles, signups } from "../shared/schema.js";
import { parseSections, parseSocials, TEMPLATES, type BioSection, type BioSocial } from "../shared/bio.js";

const SOCIAL_HOSTS: [RegExp, BioSocial["platform"]][] = [
  [/(^|\.)instagram\.com$/i, "instagram"],
  [/(^|\.)tiktok\.com$/i, "tiktok"],
  [/(^|\.)(youtube\.com|youtu\.be)$/i, "youtube"],
  [/(^|\.)(x\.com|twitter\.com)$/i, "x"],
  [/(^|\.)linkedin\.com$/i, "linkedin"],
  [/(^|\.)facebook\.com$/i, "facebook"],
  [/(^|\.)threads\.net$/i, "threads"],
];
const asUrl = (s: string) => {
  const t = s.trim();
  if (!t || /\s/.test(t)) return null;
  try { return new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`); } catch { return null; }
};
const platformOf = (u: URL) => SOCIAL_HOSTS.find(([re]) => re.test(u.hostname))?.[1] ?? null;
const usernameOf = (u: URL) => u.pathname.split("/").filter(Boolean).pop()?.replace(/^@/, "") ?? "";
const id = () => Math.random().toString(36).slice(2, 10);

export function registerBioPrefill(app: Express, requireAdmin: RequestHandler) {
  /** body: { eventId, emails: string[], dryRun?: boolean } → what each page got (or would get). */
  app.post("/api/admin/bio/prefill", requireAdmin, async (req, res) => {
    await schemaIsReady();
    const eventId = Number(req.body?.eventId);
    const emails: string[] = Array.isArray(req.body?.emails) ? req.body.emails.map((e: unknown) => String(e).trim().toLowerCase()).filter(Boolean).slice(0, 100) : [];
    const dryRun = req.body?.dryRun !== false;
    if (!eventId || !emails.length) return res.status(400).json({ message: "Which event, and whose pages?" });
    const lineup = await db.select().from(signups).where(eq(signups.eventId, eventId));
    const out: { email: string; handle: string; made: boolean; published: boolean; filled: string[] }[] = [];

    for (const email of emails) {
      const s = lineup.find((x) => x.email.trim().toLowerCase() === email && x.status !== "cancelled");
      if (!s) { out.push({ email, handle: "", made: false, published: false, filled: ["not in the lineup"] }); continue; }
      const [p] = await db.select().from(podcasterProfiles).where(eq(podcasterProfiles.email, email)).limit(1);
      const [w] = await db.select({ blurb: magazinePages.blurb }).from(magazinePages).where(and(eq(magazinePages.eventId, eventId), eq(magazinePages.signupId, s.id))).limit(1);
      const [row] = await db.select().from(bioPages).where(eq(bioPages.email, email)).limit(1);

      // What we know.
      const name = s.podcastName.trim() || p?.podcastName.trim() || "";
      const photo = p?.photoUrl || s.photoUrl || "";
      const rss = s.rssUrl.trim() || p?.rssUrl.trim() || "";
      const bio = (w?.blurb ?? "").trim().slice(0, 500);
      const socials: BioSocial[] = [];
      const add = (platform: string, username: string, url: string) => { if (!socials.some((x) => x.platform === platform)) socials.push({ platform, username, url, on: true }); };
      for (const a of parseSocialAccounts(s.socialAccounts || p?.socialAccounts || "")) if (a.url) add(a.platform, a.username, a.url);
      const yt = asUrl(s.youtubeUrl || p?.youtubeUrl || "");
      if (yt && platformOf(yt) === "youtube") add("youtube", usernameOf(yt), yt.toString());
      let website = "";
      for (const piece of (s.socialLinks || p?.socialLinks || "").split(/[\s,]+/)) {
        const u = asUrl(piece);
        if (!u || !u.hostname.includes(".")) continue;
        const pl = platformOf(u);
        if (pl) add(pl, usernameOf(u), u.toString());
        else if (!website) website = u.toString();
      }

      // Fill only what's empty.
      const filled: string[] = [];
      const patch: Partial<typeof bioPages.$inferInsert> = {};
      if (!row?.displayName.trim() && name) { patch.displayName = name.slice(0, 80); filled.push("name"); }
      if (!row?.avatarUrl && photo) { patch.avatarUrl = photo; filled.push("photo"); }
      if (!row?.bio.trim() && bio) { patch.bio = bio; filled.push("bio"); }
      if (!row?.rssUrl.trim() && rss) { patch.rssUrl = rss; filled.push("feed"); }
      if (!parseSocials(row?.socials).length && socials.length) { patch.socials = JSON.stringify(socials); filled.push(`socials (${socials.map((x) => x.platform).join(", ")})`); }
      const sections: BioSection[] = parseSections(row?.sections);
      let changed = false;
      if (website && !sections.some((x) => x.type === "links")) { sections.unshift({ id: id(), type: "links", visible: true, title: "", links: [{ id: id(), label: "Our website", url: website }] }); changed = true; filled.push("website link"); }
      if ((rss || row?.rssUrl) && !sections.some((x) => x.type === "podcast")) { sections.push({ id: id(), type: "podcast", visible: true, title: "" }); changed = true; filled.push("episodes"); }
      if (changed) patch.sections = JSON.stringify(sections);

      const now = new Date().toISOString();
      if (row) {
        if (!dryRun && filled.length) await db.update(bioPages).set({ ...patch, updatedAt: now }).where(eq(bioPages.id, row.id));
        out.push({ email, handle: row.handle, made: false, published: row.published, filled });
      } else {
        const handle = dryRun ? `${slugify(name || email.split("@")[0])} (to make)` : await freeHandle(slugify(name || email.split("@")[0]));
        if (!dryRun) await db.insert(bioPages).values({
          email, handle,
          theme: JSON.stringify({ ...TEMPLATES.bold.theme, template: "bold", color: "#F0A71F" }),
          sections: "[]", socials: "[]",
          ...patch,
          published: false,
          createdAt: now, updatedAt: now,
        }).onConflictDoNothing();
        out.push({ email, handle, made: true, published: false, filled });
      }
    }
    res.json({ dryRun, pages: out });
  });
}
