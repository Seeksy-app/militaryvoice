// Projects (6 Oct 2026): the owner and Claude plan the platform's bigger builds
// together in platform admin. Claude works from Claude Code sessions and writes
// here through the same admin API, with its notes signed "Claude".
import type { Express, RequestHandler, Request, Response, NextFunction } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schemaIsReady } from "./storage.js";
import { getAdminEmail } from "./session.js";
import { pmItems, pmNotes, pmProjects } from "../shared/schema.js";

const now = () => new Date().toISOString();
const STATUSES = ["todo", "doing", "decide", "done"];
const OWNERS = ["claude", "owner", "team"];
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : undefined);

/** Whose note: "Claude" when Claude writes it, otherwise the admin's first name from their address. */
function authorOf(req: Request): string {
  if (req.body?.author === "claude") return "Claude";
  const local = (getAdminEmail(req) ?? "").split("@")[0].split(/[._+-]/)[0];
  return local ? local[0].toUpperCase() + local.slice(1) : "Team";
}

function itemPatch(b: Record<string, unknown>) {
  const patch: Partial<typeof pmItems.$inferInsert> = {};
  const title = str(b.title, 200); if (title) patch.title = title;
  const detail = str(b.detail, 8000); if (detail !== undefined) patch.detail = detail;
  const phase = str(b.phase, 80); if (phase !== undefined) patch.phase = phase;
  if (typeof b.status === "string" && STATUSES.includes(b.status)) patch.status = b.status;
  if (typeof b.owner === "string" && OWNERS.includes(b.owner)) patch.owner = b.owner;
  if (Number.isFinite(Number(b.position)) && b.position !== undefined) patch.position = Math.round(Number(b.position));
  return patch;
}

export function registerProjects(app: Express, requireAdmin: RequestHandler) {
  // Owners and admins only; a studio host's session never sees the plans.
  const adminOnly = (req: Request, res: Response, next: NextFunction) => {
    if ((req as { studioHost?: unknown }).studioHost) return res.status(403).json({ message: "Admins only." });
    next();
  };
  const guard = [requireAdmin, adminOnly];

  app.get("/api/admin/pm", ...guard, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await schemaIsReady();
    const projects = await db.select().from(pmProjects).orderBy(asc(pmProjects.id));
    const items = await db.select({ projectId: pmItems.projectId, status: pmItems.status }).from(pmItems);
    res.json(projects.map((p) => {
      const mine = items.filter((i) => i.projectId === p.id);
      return { ...p, total: mine.length, done: mine.filter((i) => i.status === "done").length, decide: mine.filter((i) => i.status === "decide").length };
    }));
  });

  app.post("/api/admin/pm/projects", ...guard, async (req, res) => {
    await schemaIsReady();
    const name = str(req.body?.name, 120);
    if (!name) return res.status(400).json({ message: "Give the project a name." });
    const [p] = await db.insert(pmProjects).values({ name, goal: str(req.body?.goal, 2000) ?? "", createdAt: now() }).returning();
    res.status(201).json(p);
  });

  app.put("/api/admin/pm/projects/:id", ...guard, async (req, res) => {
    const patch: Partial<typeof pmProjects.$inferInsert> = {};
    const name = str(req.body?.name, 120); if (name) patch.name = name;
    const goal = str(req.body?.goal, 2000); if (goal !== undefined) patch.goal = goal;
    if (typeof req.body?.archived === "boolean") patch.archived = req.body.archived;
    const [p] = await db.update(pmProjects).set(patch).where(eq(pmProjects.id, Number(req.params.id))).returning();
    if (!p) return res.status(404).json({ message: "No such project." });
    res.json(p);
  });

  /** A project's tasks, in order, each with its notes. */
  app.get("/api/admin/pm/projects/:id/items", ...guard, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    await schemaIsReady();
    const items = await db.select().from(pmItems).where(eq(pmItems.projectId, Number(req.params.id))).orderBy(asc(pmItems.position), asc(pmItems.id));
    const notes = items.length ? await db.select().from(pmNotes).where(inArray(pmNotes.itemId, items.map((i) => i.id))).orderBy(asc(pmNotes.createdAt)) : [];
    res.json(items.map((i) => ({ ...i, notes: notes.filter((n) => n.itemId === i.id) })));
  });

  /** One task, or many at once ({ items: [...] }) when Claude lays out a plan. */
  app.post("/api/admin/pm/projects/:id/items", ...guard, async (req, res) => {
    await schemaIsReady();
    const projectId = Number(req.params.id);
    const [p] = await db.select({ id: pmProjects.id }).from(pmProjects).where(eq(pmProjects.id, projectId));
    if (!p) return res.status(404).json({ message: "No such project." });
    const list: Record<string, unknown>[] = Array.isArray(req.body?.items) ? req.body.items.slice(0, 200) : [req.body ?? {}];
    const last = (await db.select({ position: pmItems.position }).from(pmItems).where(eq(pmItems.projectId, projectId))).reduce((m, r) => Math.max(m, r.position), 0);
    const rows = list.map((b, i) => ({ ...itemPatch(b), projectId, position: last + (i + 1) * 10, createdAt: now(), updatedAt: now() })).filter((r) => r.title);
    if (!rows.length) return res.status(400).json({ message: "A task needs a title." });
    const out = await db.insert(pmItems).values(rows as (typeof pmItems.$inferInsert)[]).returning();
    res.status(201).json(Array.isArray(req.body?.items) ? out : out[0]);
  });

  app.put("/api/admin/pm/items/:id", ...guard, async (req, res) => {
    const patch = itemPatch(req.body ?? {});
    if (patch.status) patch.doneAt = patch.status === "done" ? now() : "";
    const [i] = await db.update(pmItems).set({ ...patch, updatedAt: now() }).where(eq(pmItems.id, Number(req.params.id))).returning();
    if (!i) return res.status(404).json({ message: "No such task." });
    res.json(i);
  });

  app.delete("/api/admin/pm/items/:id", ...guard, async (req, res) => {
    const id = Number(req.params.id);
    await db.delete(pmNotes).where(eq(pmNotes.itemId, id));
    await db.delete(pmItems).where(eq(pmItems.id, id));
    res.json({ ok: true });
  });

  app.post("/api/admin/pm/items/:id/notes", ...guard, async (req, res) => {
    const text = str(req.body?.text, 8000);
    if (!text) return res.status(400).json({ message: "Write something first." });
    const id = Number(req.params.id);
    const [n] = await db.insert(pmNotes).values({ itemId: id, author: authorOf(req), text, createdAt: now() }).returning();
    await db.update(pmItems).set({ updatedAt: now() }).where(eq(pmItems.id, id));
    res.status(201).json(n);
  });
}
