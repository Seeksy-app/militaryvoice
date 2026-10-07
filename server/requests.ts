// Requests (7 Oct 2026), phase 4 of brands on MilitaryVoices: an approved brand
// sends a request to creators on the platform; each creator answers in their
// Opportunities inbox (Interested, with a rate, or Not for me); the brand and
// creator talk in a thread; when the brand connects, each sees the other's
// email. Contact details stay private until then. Intro only: no payments yet.
import type { Express, RequestHandler, Request } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schemaIsReady, storage } from "./storage.js";
import { orgMemberEmails, orgsOf } from "./orgs.js";
import { slackNote } from "./slack.js";
import { sendOpportunityEmail } from "./email.js";
import {
  brandRequests, discoveryListItems, discoveryLists, organizations, podcasterProfiles, requestMessages, requestRecipients, signups,
  REQUEST_KINDS, type OrganizationRow,
} from "../shared/schema.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const now = () => new Date().toISOString();
const norm = (e: unknown) => String(e ?? "").trim().toLowerCase();
const meOf = (req: Request) => norm((req as unknown as { hostEmail?: string }).hostEmail);
const KINDS = Object.keys(REQUEST_KINDS);
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const dollars = (v: unknown) => Math.max(0, Math.min(10_000_000, Math.round(Number(v) || 0)));
const MAX_RECIPIENTS = 50;

type Creator = { email: string; name: string; show: string; picture: string };

/** A creator on MilitaryVoices a brand may write to: a member who said yes to brands, or someone on a lineup. */
async function creatorFor(ref: { profileId?: unknown; signupId?: unknown }): Promise<Creator | null> {
  const profileId = Number(ref.profileId) || 0;
  const signupId = Number(ref.signupId) || 0;
  if (profileId) {
    const [p] = await db.select().from(podcasterProfiles).where(and(eq(podcasterProfiles.id, profileId), eq(podcasterProfiles.openToBrands, true)));
    return p ? { email: norm(p.email), name: p.hostName.trim(), show: p.podcastName.trim(), picture: p.photoUrl } : null;
  }
  if (signupId) {
    const [s] = await db.select().from(signups).where(eq(signups.id, signupId));
    return s && s.status !== "cancelled" ? { email: norm(s.email), name: s.hostName.trim(), show: s.podcastName.trim(), picture: s.photoUrl } : null;
  }
  return null;
}

/** The creators on a saved list we can write to (the wider index's creators aren't on MilitaryVoices, so they're skipped). */
async function creatorsOnList(listId: number): Promise<{ refs: { profileId?: number; signupId?: number }[]; skipped: number }> {
  const items = await db.select().from(discoveryListItems).where(eq(discoveryListItems.listId, listId));
  const refs: { profileId?: number; signupId?: number }[] = [];
  let skipped = 0;
  for (const it of items) {
    let snap: { profileId?: number; signupId?: number } = {};
    try { snap = JSON.parse(it.snapshot || "{}"); } catch { /* none */ }
    const m = it.handle.match(/^(member|signup)-(\d+)$/);
    if (snap.profileId || (m && m[1] === "member")) refs.push({ profileId: snap.profileId ?? Number(m![2]) });
    else if (snap.signupId || (m && m[1] === "signup")) refs.push({ signupId: snap.signupId ?? Number(m![2]) });
    else skipped++;
  }
  return { refs, skipped };
}

/** The brand account they're sending for: an approved brand or agency they're active on. */
async function brandOrgOf(email: string, orgId?: unknown): Promise<(OrganizationRow & { role: string }) | null> {
  const mine = (await orgsOf(email)).filter((o) => o.kind === "brand" || o.kind === "agency");
  return (Number(orgId) ? mine.find((o) => o.id === Number(orgId)) : mine[0]) ?? null;
}

async function threadOf(recipientIds: number[]) {
  return recipientIds.length ? db.select().from(requestMessages).where(inArray(requestMessages.recipientId, recipientIds)).orderBy(requestMessages.id) : [];
}

export function registerRequests(app: Express, requireHostSession: RequestHandler, requireAdmin: RequestHandler) {
  // ---- The brand's side ------------------------------------------------------
  /** SI writes the request from one sentence. */
  app.post("/api/brand/requests/draft", requireHostSession, async (req, res) => {
    const idea = str(req.body?.idea, 600);
    if (idea.length < 8) return res.status(400).json({ message: "Tell us a sentence about what you want." });
    const org = await brandOrgOf(meOf(req), req.body?.orgId);
    try {
      const ai = new Anthropic();
      const out = await ai.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 700,
        system: `You turn a brand's one-line idea into a short request to military and veteran creators on MilitaryVoices. Return JSON only: {"kind": one of ${JSON.stringify(KINDS)}, "title": "...", "details": "...", "timing": "...", "budgetLow": number, "budgetHigh": number}.
"title": under 70 characters, plain, says what it is. "details": 60 to 120 words, second person to the creator, warm and direct: what the brand wants, what the creator would do, anything they must include, and why this creator's audience fits. Use only what the brand said; never invent products, numbers, dates or claims. "timing": when, in the brand's words, or "". Budget: whole US dollars only if the brand gave one, else 0 and 0. No hype words.`,
        messages: [{ role: "user", content: `Brand: ${org?.name ?? "a brand"}${org?.about ? ` (${org.about})` : ""}${org?.website ? `, ${org.website}` : ""}\nIdea: ${idea}` }],
      });
      const text = out.content.map((c) => ("text" in c ? c.text : "")).join("");
      const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Record<string, unknown>;
      res.json({
        kind: KINDS.includes(String(j.kind)) ? j.kind : "other",
        title: str(j.title, 120), details: str(j.details, 2000), timing: str(j.timing, 80),
        budgetLow: dollars(j.budgetLow), budgetHigh: dollars(j.budgetHigh),
      });
    } catch (e) {
      res.status(502).json({ message: "Couldn't write it just now. Try again, or write it yourself." });
    }
  });

  /** Their brand's requests, each creator's answer and thread. */
  app.get("/api/brand/requests", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await schemaIsReady();
    const orgs = (await orgsOf(meOf(req))).filter((o) => o.kind === "brand" || o.kind === "agency");
    if (!orgs.length) return res.json({ orgs: [], requests: [] });
    const reqs = await db.select().from(brandRequests).where(inArray(brandRequests.orgId, orgs.map((o) => o.id))).orderBy(desc(brandRequests.id));
    const rcpts = reqs.length ? await db.select().from(requestRecipients).where(inArray(requestRecipients.requestId, reqs.map((r) => r.id))) : [];
    const msgs = await threadOf(rcpts.map((r) => r.id));
    res.json({
      orgs: orgs.map((o) => ({ id: o.id, name: o.name, status: o.status })),
      requests: reqs.map((r) => ({
        ...r,
        recipients: rcpts.filter((x) => x.requestId === r.id).map((x) => ({
          id: x.id, name: x.name, show: x.show, picture: x.picture, status: x.status, rate: x.rate, seenAt: x.seenAt, respondedAt: x.respondedAt, connectedAt: x.connectedAt,
          // Their email only once the brand has connected.
          email: x.status === "connected" ? x.email : "",
          messages: msgs.filter((m) => m.recipientId === x.id).map((m) => ({ id: m.id, side: m.side, body: m.body, createdAt: m.createdAt })),
        })),
      })),
    });
  });

  /** Send a request to creators (picked one by one, or a saved list). */
  app.post("/api/brand/requests", requireHostSession, async (req, res) => {
    await schemaIsReady();
    const me = meOf(req);
    const org = await brandOrgOf(me, req.body?.orgId);
    if (!org) return res.status(403).json({ message: "Set up your brand first (Your team)." });
    if (org.status !== "approved") return res.status(403).json({ message: "We're still checking your brand. Requests open as soon as we've approved it, usually within a day." });
    const kind = KINDS.includes(String(req.body?.kind)) ? String(req.body.kind) : "other";
    const title = str(req.body?.title, 120);
    const details = str(req.body?.details, 2000);
    if (!title) return res.status(400).json({ message: "Give it a title." });
    if (details.length < 20) return res.status(400).json({ message: "Say a little more about what you want." });
    const today = (await db.select({ id: brandRequests.id, at: brandRequests.createdAt }).from(brandRequests).where(eq(brandRequests.orgId, org.id))).filter((r) => Date.now() - Date.parse(r.at) < 24 * 3600_000).length;
    if (today >= 20) return res.status(429).json({ message: "That's 20 requests today. More tomorrow." });

    // Who it goes to.
    let refs: { profileId?: unknown; signupId?: unknown }[] = Array.isArray(req.body?.creators) ? req.body.creators : [];
    let skipped = 0;
    if (Number(req.body?.listId)) {
      const [list] = await db.select().from(discoveryLists).where(eq(discoveryLists.id, Number(req.body.listId)));
      const mine = list && (norm(list.email) === me || (list.orgId && (await orgsOf(me)).some((o) => o.id === list.orgId)));
      if (!mine) return res.status(404).json({ message: "That isn't one of your lists." });
      const fromList = await creatorsOnList(list.id);
      refs = [...refs, ...fromList.refs];
      skipped += fromList.skipped;
    }
    // Never to themselves or their own team.
    const team = new Set([me, ...(await orgMemberEmails(org.id)).map(norm)]);
    const seen = new Set<string>();
    const creators: Creator[] = [];
    for (const r of refs.slice(0, 200)) {
      const c = await creatorFor(r);
      if (!c) { skipped++; continue; }
      if (seen.has(c.email) || team.has(c.email)) continue;
      seen.add(c.email);
      creators.push(c);
    }
    if (!creators.length) return res.status(400).json({ message: skipped ? "None of those creators can take requests here yet. Requests go to creators on MilitaryVoices." : "Pick who it goes to." });
    if (creators.length > MAX_RECIPIENTS) return res.status(400).json({ message: `Up to ${MAX_RECIPIENTS} creators per request.` });

    const t = now();
    const [row] = await db.insert(brandRequests).values({
      orgId: org.id, createdBy: me, kind, title, details, timing: str(req.body?.timing, 80),
      budgetLow: dollars(req.body?.budgetLow), budgetHigh: dollars(req.body?.budgetHigh), createdAt: t, updatedAt: t,
    }).returning();
    await db.insert(requestRecipients).values(creators.map((c) => ({ requestId: row.id, email: c.email, name: c.name, show: c.show, picture: c.picture, createdAt: t })));
    // The creators hear about it (once the owner has switched these emails on), and so do we.
    if ((await storage.getSetting("opportunity_emails")) === "on") {
      for (const c of creators) await sendOpportunityEmail({ to: c.email, name: c.name, brand: org.name, title, kind: REQUEST_KINDS[kind as keyof typeof REQUEST_KINDS], link: `${ORIGIN}/host/dashboard/opportunities` }).catch(() => false);
    }
    await slackNote(`:incoming_envelope: ${org.name} sent a request, "${title}", to ${creators.length} ${creators.length === 1 ? "creator" : "creators"}.`, { label: "See requests", url: `${ORIGIN}/admin/orgs` }).catch(() => {});
    res.status(201).json({ id: row.id, sent: creators.length, skipped });
  });

  /** Close a request: no more answers wanted. */
  app.post("/api/brand/requests/:id/close", requireHostSession, async (req, res) => {
    const [r] = await db.select().from(brandRequests).where(eq(brandRequests.id, Number(req.params.id)));
    if (!r || !(await orgsOf(meOf(req))).some((o) => o.id === r.orgId)) return res.status(404).json({ message: "Not one of yours." });
    await db.update(brandRequests).set({ status: "closed", updatedAt: now() }).where(eq(brandRequests.id, r.id));
    res.json({ ok: true });
  });

  /** A recipient row of one of the signed-in person's brand's requests. */
  const brandRecipient = async (req: Request) => {
    const [x] = await db.select().from(requestRecipients).where(eq(requestRecipients.id, Number(req.params.rid)));
    if (!x) return null;
    const [r] = await db.select().from(brandRequests).where(eq(brandRequests.id, x.requestId));
    if (!r || !(await orgsOf(meOf(req))).some((o) => o.id === r.orgId)) return null;
    const [org] = await db.select().from(organizations).where(eq(organizations.id, r.orgId));
    return { x, r, org };
  };

  /** Connect: the brand wants to work with a creator who said they're interested. Both see each other's email. */
  app.post("/api/brand/recipients/:rid/connect", requireHostSession, async (req, res) => {
    const found = await brandRecipient(req);
    if (!found) return res.status(404).json({ message: "Not one of yours." });
    if (found.x.status !== "interested" && found.x.status !== "connected") return res.status(409).json({ message: "They haven't said they're interested yet." });
    await db.update(requestRecipients).set({ status: "connected", connectedAt: now() }).where(eq(requestRecipients.id, found.x.id));
    await db.insert(requestMessages).values({ recipientId: found.x.id, side: "team", author: "MilitaryVoices", body: `You're connected. ${found.org?.name ?? "The brand"} can reach ${found.x.name} at ${found.x.email}, and ${found.x.name} can reach them at ${found.r.createdBy}.`, createdAt: now() });
    await slackNote(`:handshake: ${found.org?.name ?? "A brand"} connected with ${found.x.name} on "${found.r.title}".`).catch(() => {});
    res.json({ ok: true, email: found.x.email });
  });

  app.post("/api/brand/recipients/:rid/messages", requireHostSession, async (req, res) => {
    const found = await brandRecipient(req);
    if (!found) return res.status(404).json({ message: "Not one of yours." });
    // The brand writes once the creator has answered: the request itself is the first message.
    if (found.x.status === "new") return res.status(409).json({ message: "You can write once they've answered your request." });
    if (found.x.status === "declined") return res.status(409).json({ message: "They passed on this one." });
    const body = str(req.body?.body, 2000);
    if (!body) return res.status(400).json({ message: "Write something first." });
    const [m] = await db.insert(requestMessages).values({ recipientId: found.x.id, side: "brand", author: meOf(req), body, createdAt: now() }).returning();
    res.status(201).json(m);
  });

  // ---- The creator's side ------------------------------------------------------
  /** Their Opportunities: every request sent to them, newest first. Opening the list marks them seen. */
  app.get("/api/host/opportunities", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await schemaIsReady();
    const me = meOf(req);
    const mine = await db.select().from(requestRecipients).where(eq(requestRecipients.email, me)).orderBy(desc(requestRecipients.id));
    if (!mine.length) return res.json([]);
    const reqs = await db.select().from(brandRequests).where(inArray(brandRequests.id, mine.map((x) => x.requestId)));
    const orgs = reqs.length ? await db.select().from(organizations).where(inArray(organizations.id, reqs.map((r) => r.orgId))) : [];
    const msgs = await threadOf(mine.map((x) => x.id));
    if (req.query.peek !== "1") {
      const unseen = mine.filter((x) => !x.seenAt).map((x) => x.id);
      if (unseen.length) await db.update(requestRecipients).set({ seenAt: now() }).where(inArray(requestRecipients.id, unseen));
    }
    res.json(mine.map((x) => {
      const r = reqs.find((q) => q.id === x.requestId)!;
      const o = orgs.find((g) => g.id === r?.orgId);
      return {
        id: x.id, status: x.status, rate: x.rate, seen: !!x.seenAt, createdAt: x.createdAt,
        request: r && { kind: r.kind, title: r.title, details: r.details, timing: r.timing, budgetLow: r.budgetLow, budgetHigh: r.budgetHigh, open: r.status === "open" },
        brand: o && { name: o.name, logoUrl: o.logoUrl, website: o.website, about: o.about },
        // The brand's email only once they've connected.
        brandEmail: x.status === "connected" ? r?.createdBy ?? "" : "",
        messages: msgs.filter((m) => m.recipientId === x.id).map((m) => ({ id: m.id, side: m.side, body: m.body, createdAt: m.createdAt })),
      };
    }));
  });

  const creatorRecipient = async (req: Request) => {
    const [x] = await db.select().from(requestRecipients).where(and(eq(requestRecipients.id, Number(req.params.rid)), eq(requestRecipients.email, meOf(req))));
    return x ?? null;
  };

  /** Interested (with a rate and a note), or Not for me. */
  app.post("/api/host/opportunities/:rid", requireHostSession, async (req, res) => {
    const x = await creatorRecipient(req);
    if (!x) return res.status(404).json({ message: "Not here any more." });
    const [r] = await db.select().from(brandRequests).where(eq(brandRequests.id, x.requestId));
    if (r?.status !== "open" && x.status === "new") return res.status(409).json({ message: "The brand closed this request." });
    const interested = req.body?.answer === "interested";
    if (x.status === "connected") return res.status(409).json({ message: "You're already connected." });
    await db.update(requestRecipients).set({ status: interested ? "interested" : "declined", rate: interested ? str(req.body?.rate, 160) : x.rate, respondedAt: now() }).where(eq(requestRecipients.id, x.id));
    const note = str(req.body?.note, 2000);
    if (note) await db.insert(requestMessages).values({ recipientId: x.id, side: "creator", author: meOf(req), body: note, createdAt: now() });
    if (interested) {
      const [o] = r ? await db.select().from(organizations).where(eq(organizations.id, r.orgId)) : [];
      await slackNote(`:raised_hand: ${x.name} is interested in ${o?.name ?? "a brand"}'s request "${r?.title ?? ""}"${req.body?.rate ? ` (rate: ${str(req.body.rate, 80)})` : ""}.`).catch(() => {});
    }
    res.json({ ok: true });
  });

  app.post("/api/host/opportunities/:rid/messages", requireHostSession, async (req, res) => {
    const x = await creatorRecipient(req);
    if (!x) return res.status(404).json({ message: "Not here any more." });
    const body = str(req.body?.body, 2000);
    if (!body) return res.status(400).json({ message: "Write something first." });
    const [m] = await db.insert(requestMessages).values({ recipientId: x.id, side: "creator", author: meOf(req), body, createdAt: now() }).returning();
    res.status(201).json(m);
  });

  // ---- Ours ------------------------------------------------------------------
  const platformOnly: RequestHandler = (req, res, next) =>
    (req as { studioHost?: unknown; eventAdmin?: unknown }).studioHost || (req as { eventAdmin?: unknown }).eventAdmin ? res.status(403).json({ message: "Admins only." }) : next();

  app.get("/api/admin/requests", requireAdmin, platformOnly, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await schemaIsReady();
    const reqs = await db.select().from(brandRequests).orderBy(desc(brandRequests.id)).limit(200);
    const rcpts = reqs.length ? await db.select().from(requestRecipients).where(inArray(requestRecipients.requestId, reqs.map((r) => r.id))) : [];
    const orgs = reqs.length ? await db.select().from(organizations).where(inArray(organizations.id, reqs.map((r) => r.orgId))) : [];
    res.json({
      emailsOn: (await storage.getSetting("opportunity_emails")) === "on",
      requests: reqs.map((r) => ({ ...r, org: orgs.find((o) => o.id === r.orgId)?.name ?? "", recipients: rcpts.filter((x) => x.requestId === r.id).map((x) => ({ id: x.id, name: x.name, email: x.email, status: x.status, rate: x.rate, seen: !!x.seenAt })) })),
    });
  });
  /** Remove a request (a test, or one sent by mistake), with its answers and threads. */
  app.delete("/api/admin/requests/:id", requireAdmin, platformOnly, async (req, res) => {
    const id = Number(req.params.id);
    const rows = await db.select({ id: requestRecipients.id }).from(requestRecipients).where(eq(requestRecipients.requestId, id));
    if (rows.length) await db.delete(requestMessages).where(inArray(requestMessages.recipientId, rows.map((r) => r.id)));
    await db.delete(requestRecipients).where(eq(requestRecipients.requestId, id));
    await db.delete(brandRequests).where(eq(brandRequests.id, id));
    res.json({ ok: true });
  });
  /** The owner switches the "a brand sent you a request" email on or off. */
  app.post("/api/admin/requests/emails", requireAdmin, platformOnly, async (req, res) => {
    await storage.setSetting("opportunity_emails", req.body?.on === true ? "on" : "off");
    res.json({ on: req.body?.on === true });
  });
}
