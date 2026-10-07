// Organizations (6 Oct 2026): brands, agencies and event organizers as accounts
// of their own, each with a team. The multi-tenant base: an organization's
// events, saved Discovery lists and (next) requests and deals belong to it, and
// everyone active on its team shares them. People still sign in as themselves;
// an organization is something they belong to, never a login of its own.
import type { Express, RequestHandler, Request } from "express";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db, schemaIsReady, storage } from "./storage.js";
import { slackNote } from "./slack.js";
import { sendOrgInviteEmail } from "./email.js";
import { discoveryLists, discoveryMembers, events, organizations, orgMembers, ORG_KINDS, type OrganizationRow } from "../shared/schema.js";

const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");
const now = () => new Date().toISOString();
const norm = (e: unknown) => String(e ?? "").trim().toLowerCase();
const validEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const meOf = (req: Request) => norm((req as unknown as { hostEmail?: string }).hostEmail);
const KINDS = Object.keys(ORG_KINDS);
const MAX_SEATS = 25;
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : undefined);
const cleanUrl = (v: unknown) => {
  const s = str(v, 300);
  if (!s) return s === "" ? "" : undefined;
  const u = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try { return new URL(u).toString(); } catch { return undefined; }
};

/** The organizations someone is active in, with their role. */
export async function orgsOf(email: string): Promise<(OrganizationRow & { role: string })[]> {
  const e = norm(email);
  if (!e) return [];
  const mem = await db.select().from(orgMembers).where(and(eq(orgMembers.email, e), eq(orgMembers.status, "active")));
  if (!mem.length) return [];
  const orgs = await db.select().from(organizations).where(inArray(organizations.id, mem.map((m) => m.orgId)));
  return orgs.map((o) => ({ ...o, role: mem.find((m) => m.orgId === o.id)?.role ?? "member" }));
}
export async function orgIdsOf(email: string): Promise<number[]> {
  return (await orgsOf(email)).map((o) => o.id);
}
/** Active team members' addresses (studio access for an approved organizer's events). */
export async function orgMemberEmails(orgId: number): Promise<string[]> {
  if (!orgId) return [];
  return (await db.select({ email: orgMembers.email }).from(orgMembers).where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.status, "active")))).map((r) => r.email);
}

async function createOrg(o: { name: string; kind: string; website?: string; createdBy: string; status?: string }): Promise<OrganizationRow> {
  const kind = KINDS.includes(o.kind) ? o.kind : "brand";
  // Organizers' events are approved one by one, so the account itself is fine at once; brands wait for us.
  const status = o.status ?? (kind === "organizer" ? "approved" : "pending");
  const [org] = await db.insert(organizations).values({
    name: o.name, kind, website: o.website ?? "", status, createdBy: o.createdBy, createdAt: now(), approvedAt: status === "approved" ? now() : "",
  }).returning();
  await db.insert(orgMembers).values({ orgId: org.id, email: o.createdBy, role: "owner", status: "active", createdAt: now(), joinedAt: now() });
  return org;
}

/**
 * Their brand or agency account, made when they join Discovery as one (or say
 * they're a brand at sign-up). The first one of that kind is reused, renamed if
 * they gave a new name. A new brand waits for our approval.
 */
export async function ensureOrg(email: string, kind: string, name: string, website = ""): Promise<OrganizationRow | null> {
  const e = norm(email);
  const n = name.trim().slice(0, 120);
  if (!e || !n || !KINDS.includes(kind)) return null;
  const had = (await orgsOf(e)).find((o) => o.kind === kind);
  if (had) return had;
  const org = await createOrg({ name: n, kind, website: cleanUrl(website) ?? "", createdBy: e });
  if (org.status === "pending") {
    await slackNote(`:office: New ${ORG_KINDS[kind as keyof typeof ORG_KINDS].toLowerCase()} on Discovery: "${n}" (${e}), waiting for approval.`, { label: "Review it", url: `${ORIGIN}/admin/orgs` }).catch(() => {});
  }
  return org;
}

/** Their organizer account, made the first time they run an event. */
export async function organizerOrgFor(email: string, name?: string): Promise<OrganizationRow> {
  const mine = (await orgsOf(email)).filter((o) => o.kind === "organizer");
  if (mine.length) return mine.find((o) => o.role === "owner") ?? mine[0];
  const profile = await storage.getProfileByEmail(email).catch(() => undefined);
  const who = name?.trim() || (profile?.hostName?.trim() ? `${profile.hostName.trim()} Events` : `${email.split("@")[0]} Events`);
  return createOrg({ name: who.slice(0, 120), kind: "organizer", createdBy: email });
}

async function teamOf(orgId: number) {
  return db.select().from(orgMembers).where(eq(orgMembers.orgId, orgId)).orderBy(orgMembers.id);
}

export function registerOrgs(app: Express, requireHostSession: RequestHandler, requireAdmin: RequestHandler) {
  /** Is the signed-in person an owner of this organization? */
  const ownerOf = async (req: Request, id: number) => {
    const [m] = await db.select().from(orgMembers).where(and(eq(orgMembers.orgId, id), eq(orgMembers.email, meOf(req)), eq(orgMembers.status, "active")));
    return m?.role === "owner" ? m : null;
  };

  // ---- The member's side -----------------------------------------------------
  /** Their organizations (with each team), and invitations waiting on them. */
  app.get("/api/host/orgs", requireHostSession, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await schemaIsReady();
    const me = meOf(req);
    const orgs = await orgsOf(me);
    const out = [];
    for (const o of orgs) {
      const team = await teamOf(o.id);
      const evCount = (await db.select({ id: events.id }).from(events).where(eq(events.orgId, o.id))).length;
      out.push({ ...o, myMemberId: team.find((t) => t.email === me)?.id ?? 0, team: team.map((t) => ({ id: t.id, email: t.email, role: t.role, status: t.status, joinedAt: t.joinedAt })), events: evCount });
    }
    const pending = await db.select().from(orgMembers).where(and(eq(orgMembers.email, me), eq(orgMembers.status, "invited")));
    const invOrgs = pending.length ? await db.select().from(organizations).where(inArray(organizations.id, pending.map((p) => p.orgId))) : [];
    res.json({
      orgs: out,
      invites: pending.map((p) => ({ id: p.id, orgId: p.orgId, invitedBy: p.invitedBy, org: invOrgs.find((o) => o.id === p.orgId) })).filter((p) => p.org),
    });
  });

  app.post("/api/host/orgs", requireHostSession, async (req, res) => {
    await schemaIsReady();
    const me = meOf(req);
    const name = str(req.body?.name, 120);
    if (!name) return res.status(400).json({ message: "What's the organization called?" });
    const kind = String(req.body?.kind ?? "");
    if (!KINDS.includes(kind)) return res.status(400).json({ message: "Is it a brand, an agency or an event organizer?" });
    const owned = (await orgsOf(me)).filter((o) => o.role === "owner");
    if (owned.length >= 5) return res.status(429).json({ message: "That's five organizations. Write to hello@militaryvoices.ai if you need more." });
    const org = await createOrg({ name, kind, website: cleanUrl(req.body?.website) ?? "", createdBy: me });
    if (org.status === "pending") {
      await slackNote(`:office: ${me} set up ${ORG_KINDS[kind as keyof typeof ORG_KINDS].toLowerCase()} "${name}" and is waiting for approval.`, { label: "Review it", url: `${ORIGIN}/admin/orgs` }).catch(() => {});
    }
    res.status(201).json(org);
  });

  app.put("/api/host/orgs/:id", requireHostSession, async (req, res) => {
    const id = Number(req.params.id);
    if (!(await ownerOf(req, id))) return res.status(403).json({ message: "Only an owner can change the organization." });
    const patch: Partial<typeof organizations.$inferInsert> = {};
    const name = str(req.body?.name, 120); if (name) patch.name = name;
    const about = str(req.body?.about, 1000); if (about !== undefined) patch.about = about;
    const website = cleanUrl(req.body?.website); if (website !== undefined) patch.website = website;
    const logo = cleanUrl(req.body?.logoUrl); if (logo !== undefined) patch.logoUrl = logo;
    const [org] = await db.update(organizations).set(patch).where(eq(organizations.id, id)).returning();
    res.json(org);
  });

  /** Add someone to the team. They get an email, and an invitation on their dashboard when they sign in. */
  app.post("/api/host/orgs/:id/members", requireHostSession, async (req, res) => {
    const id = Number(req.params.id);
    if (!(await ownerOf(req, id))) return res.status(403).json({ message: "Only an owner can add people." });
    const email = norm(req.body?.email);
    if (!validEmail(email)) return res.status(400).json({ message: "That doesn't look like an email address." });
    const team = await teamOf(id);
    if (team.some((t) => t.email === email)) return res.status(409).json({ message: "They're already on the team." });
    if (team.length >= MAX_SEATS) return res.status(400).json({ message: `That's ${MAX_SEATS} people. Write to hello@militaryvoices.ai for more.` });
    const role = req.body?.role === "owner" ? "owner" : "member";
    const [row] = await db.insert(orgMembers).values({ orgId: id, email, role, status: "invited", invitedBy: meOf(req), createdAt: now() }).returning();
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
    const inviter = (await storage.getProfileByEmail(meOf(req)).catch(() => undefined))?.hostName?.trim() || meOf(req);
    const sent = await sendOrgInviteEmail({ to: email, orgName: org.name, kind: ORG_KINDS[org.kind as keyof typeof ORG_KINDS] ?? "", inviter, link: `${ORIGIN}/host/dashboard/organization` }).catch(() => false);
    res.status(201).json({ ...row, emailed: sent });
  });

  app.put("/api/host/orgs/:id/members/:memberId", requireHostSession, async (req, res) => {
    const id = Number(req.params.id);
    if (!(await ownerOf(req, id))) return res.status(403).json({ message: "Only an owner can change roles." });
    const role = req.body?.role === "owner" ? "owner" : "member";
    const team = await teamOf(id);
    const target = team.find((t) => t.id === Number(req.params.memberId));
    if (!target) return res.status(404).json({ message: "Not on this team." });
    if (role === "member" && target.role === "owner" && team.filter((t) => t.role === "owner" && t.status === "active").length <= 1) {
      return res.status(400).json({ message: "Every organization needs an owner. Make someone else an owner first." });
    }
    const [row] = await db.update(orgMembers).set({ role }).where(eq(orgMembers.id, target.id)).returning();
    res.json(row);
  });

  /** An owner removes someone, or anyone leaves. The last owner can't. */
  app.delete("/api/host/orgs/:id/members/:memberId", requireHostSession, async (req, res) => {
    const id = Number(req.params.id);
    const team = await teamOf(id);
    const target = team.find((t) => t.id === Number(req.params.memberId));
    if (!target) return res.status(404).json({ message: "Not on this team." });
    const self = target.email === meOf(req);
    if (!self && !(await ownerOf(req, id))) return res.status(403).json({ message: "Only an owner can remove people." });
    if (target.role === "owner" && target.status === "active" && team.filter((t) => t.role === "owner" && t.status === "active").length <= 1) {
      return res.status(400).json({ message: "Every organization needs an owner. Make someone else an owner first." });
    }
    await db.delete(orgMembers).where(eq(orgMembers.id, target.id));
    res.json({ ok: true });
  });

  /** Accept or turn down an invitation addressed to the signed-in person. */
  app.post("/api/host/org-invites/:memberId", requireHostSession, async (req, res) => {
    const [m] = await db.select().from(orgMembers).where(and(eq(orgMembers.id, Number(req.params.memberId)), eq(orgMembers.email, meOf(req)), eq(orgMembers.status, "invited")));
    if (!m) return res.status(404).json({ message: "That invitation isn't here any more." });
    if (req.body?.accept === false) {
      await db.delete(orgMembers).where(eq(orgMembers.id, m.id));
      return res.json({ ok: true, joined: false });
    }
    await db.update(orgMembers).set({ status: "active", joinedAt: now() }).where(eq(orgMembers.id, m.id));
    res.json({ ok: true, joined: true });
  });

  // ---- Our side ------------------------------------------------------------
  const platformOnly: RequestHandler = (req, res, next) =>
    (req as { studioHost?: unknown; eventAdmin?: unknown }).studioHost || (req as { eventAdmin?: unknown }).eventAdmin ? res.status(403).json({ message: "Admins only." }) : next();

  app.get("/api/admin/orgs", requireAdmin, platformOnly, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await schemaIsReady();
    const orgs = await db.select().from(organizations).orderBy(desc(organizations.id));
    const team = orgs.length ? await db.select().from(orgMembers).where(inArray(orgMembers.orgId, orgs.map((o) => o.id))) : [];
    const evs = await db.select({ id: events.id, name: events.name, orgId: events.orgId, review: events.review }).from(events).where(ne(events.orgId, 0));
    const lists = await db.select({ id: discoveryLists.id, orgId: discoveryLists.orgId }).from(discoveryLists).where(ne(discoveryLists.orgId, 0));
    res.json(orgs.map((o) => ({
      ...o,
      team: team.filter((t) => t.orgId === o.id).map((t) => ({ id: t.id, email: t.email, role: t.role, status: t.status })),
      events: evs.filter((e) => e.orgId === o.id),
      lists: lists.filter((l) => l.orgId === o.id).length,
    })));
  });

  app.post("/api/admin/orgs/:id/status", requireAdmin, platformOnly, async (req, res) => {
    const status = ["approved", "declined", "pending"].includes(req.body?.status) ? req.body.status : "approved";
    const [org] = await db.update(organizations).set({ status, approvedAt: status === "approved" ? now() : "" }).where(eq(organizations.id, Number(req.params.id))).returning();
    if (!org) return res.status(404).json({ message: "No such organization." });
    res.json(org);
  });

  /** Remove one that was made by mistake (or a test). Not while it runs events. */
  app.delete("/api/admin/orgs/:id", requireAdmin, platformOnly, async (req, res) => {
    const id = Number(req.params.id);
    if ((await db.select({ id: events.id }).from(events).where(eq(events.orgId, id))).length) return res.status(409).json({ message: "It runs events. Move or delete those first." });
    await db.update(discoveryLists).set({ orgId: 0 }).where(eq(discoveryLists.orgId, id));
    await db.delete(orgMembers).where(eq(orgMembers.orgId, id));
    await db.delete(organizations).where(eq(organizations.id, id));
    res.json({ ok: true });
  });

  /**
   * Bring what already exists under organizations: each planner's events, and
   * the brands, agencies and organizers already on Discovery (with their saved
   * lists). Safe to run again; it only fills in what's missing.
   */
  app.post("/api/admin/orgs/backfill", requireAdmin, platformOnly, async (_req, res) => {
    await schemaIsReady();
    let made = 0, eventsMoved = 0, listsMoved = 0;
    for (const e of await db.select().from(events).where(and(ne(events.ownerEmail, ""), eq(events.orgId, 0)))) {
      const before = (await orgsOf(e.ownerEmail)).length;
      const org = await organizerOrgFor(norm(e.ownerEmail));
      if ((await orgsOf(e.ownerEmail)).length > before) made++;
      await db.update(events).set({ orgId: org.id }).where(eq(events.id, e.id));
      eventsMoved++;
    }
    const kindOf: Record<string, string> = { brand: "brand", agency: "agency", event: "organizer" };
    for (const m of await db.select().from(discoveryMembers)) {
      const kind = kindOf[m.role];
      if (!kind || !m.orgName.trim()) continue;
      const email = norm(m.email);
      let org = (await orgsOf(email)).find((o) => o.kind === kind);
      // Already on Discovery before organizations existed: approved as they are.
      if (!org) { org = { ...(await createOrg({ name: m.orgName.trim().slice(0, 120), kind, createdBy: email, status: "approved" })), role: "owner" }; made++; }
      const moved = await db.update(discoveryLists).set({ orgId: org.id }).where(and(eq(discoveryLists.email, email), eq(discoveryLists.orgId, 0))).returning({ id: discoveryLists.id });
      listsMoved += moved.length;
    }
    res.json({ made, eventsMoved, listsMoved });
  });
}
