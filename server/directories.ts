// Admin → People → Directories (Andrew, 27 Nov 2026; mockup exports/directories-mockup/, OK'd "Looks good").
// A directory is a group of members. Two are built in and fill themselves by rule:
//   all       "All subscribers": everyone with an account. Team only. Its Public switch is the member's own
//             Member Directory setting (directory_hidden, /directory) and Featured is the directory pin (directory_order).
//   verified  "Verified podcasters and creators": members we know: on an MV event's lineup, or hosting their show with us.
// More can be made by hand ("hand-picked"). Rule and hand-picked directories keep each member's Public and Featured
// in mv_directory_members; a public one has its own page at /directory/<slug>.
// House, test and reviewer accounts are never in any directory (keptOutOfDirectories).
import type { Express, RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { keptOutOfDirectories } from "../shared/review.js";
import { isPodcaster, pathOf } from "../shared/schema.js";

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>): Promise<Row[]> => { const r: any = await db.execute(q); return (r.rows ?? r) as Row[]; };

let made: Promise<void> | null = null;
function ensure(): Promise<void> {
  made ??= (async () => {
    await schemaIsReady();
    await db.execute(sql`CREATE TABLE IF NOT EXISTS mv_directories (
      id SERIAL PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'manual', public BOOLEAN NOT NULL DEFAULT false, created_at TEXT NOT NULL DEFAULT '')`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS mv_directory_members (
      directory_id INTEGER NOT NULL, profile_id INTEGER NOT NULL, public BOOLEAN NOT NULL DEFAULT true,
      featured BOOLEAN NOT NULL DEFAULT false, added_at TEXT NOT NULL DEFAULT '', PRIMARY KEY (directory_id, profile_id))`);
    const now = new Date().toISOString();
    await db.execute(sql`INSERT INTO mv_directories (slug, name, description, kind, public, created_at)
      VALUES ('all', 'All subscribers', 'Everyone who signed up. Members marked Public show on the Member Directory.', 'all', false, ${now}),
             ('verified', 'Verified podcasters and creators', 'Members we know: on an MV event''s lineup, or hosting their show with us.', 'verified', true, ${now})
      ON CONFLICT (slug) DO NOTHING`);
  })().catch((e) => { made = null; throw e; });
  return made;
}

type Dir = { id: number; slug: string; name: string; description: string; kind: "all" | "verified" | "manual"; public: boolean };
const asDir = (r: Row): Dir => ({ id: Number(r.id), slug: String(r.slug), name: String(r.name), description: String(r.description ?? ""), kind: (["all", "verified"].includes(String(r.kind)) ? r.kind : "manual") as Dir["kind"], public: r.public === true || r.public === "t" });

type Profile = Awaited<ReturnType<typeof storage.listAllProfiles>>[number];
const norm = (e: string) => e.trim().toLowerCase();
const photoOf = (p: Profile) => (p.directoryImage || p.photoUrl || "").trim();

/** Everyone a directory could hold: a real account with a name; never house, test or reviewer seats. */
async function candidates(): Promise<Profile[]> {
  return (await storage.listAllProfiles()).filter((p) => p.hostName.trim() && !keptOutOfDirectories(p.email));
}

/** Members we know: on any MV event's lineup (not cancelled), or hosting a show with us. Brands aren't creators. */
async function verifiedEmails(): Promise<Set<string>> {
  const out = new Set<string>();
  for (const r of await rows(sql`select distinct lower(trim(email)) e from signups where status <> 'cancelled'`).catch(() => [])) out.add(String(r.e));
  for (const r of await rows(sql`select distinct lower(trim(email)) e from hosted_shows`).catch(() => [])) out.add(String(r.e));
  return out;
}

type Member = {
  profileId: number; name: string; show: string; photoUrl: string; branch: string; serviceStatus: string;
  platforms: { platform: string; followers: number | null }[]; followers: number | null; public: boolean; featured: boolean;
};

function platformsOf(p: Profile): Member["platforms"] {
  try {
    const list = JSON.parse(p.socialAccounts || "[]") as { platform?: string; followers?: number }[];
    if (!Array.isArray(list)) return [];
    const seen = new Map<string, number | null>();
    for (const a of list) {
      const k = String(a.platform ?? "").toLowerCase().trim();
      if (!k) continue;
      const n = Number(a.followers);
      seen.set(k, Math.max(seen.get(k) ?? 0, Number.isFinite(n) ? n : 0) || null);
    }
    return Array.from(seen, ([platform, followers]) => ({ platform, followers }));
  } catch { return []; }
}

const NO_BRANCH = new Set(["", "none", "not applicable", "n/a"]);

async function membersOf(d: Dir): Promise<Member[]> {
  const all = await candidates();
  const flags = new Map<number, { public: boolean; featured: boolean }>();
  for (const r of await rows(sql`select profile_id, public, featured from mv_directory_members where directory_id = ${d.id}`)) {
    flags.set(Number(r.profile_id), { public: r.public === true || r.public === "t", featured: r.featured === true || r.featured === "t" });
  }
  let list: Profile[];
  if (d.kind === "all") list = all;
  else if (d.kind === "verified") { const v = await verifiedEmails(); list = all.filter((p) => v.has(norm(p.email)) && pathOf(p.interests) !== "brand"); }
  else list = all.filter((p) => flags.has(p.id));
  return list.map((p) => {
    const plats = platformsOf(p);
    const total = plats.reduce((n, x) => n + (x.followers ?? 0), 0);
    const f = flags.get(p.id);
    return {
      profileId: p.id, name: p.hostName.trim(), show: p.podcastName.trim(),
      photoUrl: photoOf(p), branch: NO_BRANCH.has(p.branch.trim().toLowerCase()) ? "" : p.branch.trim(), serviceStatus: NO_BRANCH.has(p.serviceStatus.trim().toLowerCase()) ? "" : p.serviceStatus.trim(),
      platforms: plats, followers: total || null,
      // All subscribers: the member's own directory setting and the directory pin. Everywhere else: our row, public by default.
      public: d.kind === "all" ? !p.directoryHidden : (f?.public ?? true),
      featured: d.kind === "all" ? p.directoryOrder < 1000 : (f?.featured ?? false),
    };
  }).sort((a, b) => Number(b.featured) - Number(a.featured) || (b.followers ?? 0) - (a.followers ?? 0) || a.name.localeCompare(b.name));
}

async function listDirs(): Promise<Dir[]> {
  await ensure();
  return (await rows(sql`select * from mv_directories order by case kind when 'all' then 0 when 'verified' then 1 else 2 end, id`)).map(asDir);
}
async function dirBySlug(slug: string): Promise<Dir | null> {
  await ensure();
  const r = (await rows(sql`select * from mv_directories where slug = ${slug} limit 1`))[0];
  return r ? asDir(r) : null;
}

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "directory";

export function registerDirectories(app: Express, requireAdmin: RequestHandler) {
  const adminOnly: RequestHandler = (req, res, next) => ((req as { studioHost?: unknown }).studioHost ? void res.status(403).json({ message: "Admins only." }) : next());

  /** Every directory, with its count and up to four faces. */
  app.get("/api/admin/directories", requireAdmin, adminOnly, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const out = [];
    for (const d of await listDirs()) {
      const m = await membersOf(d);
      out.push({ ...d, count: m.length, publicCount: m.filter((x) => x.public).length, faces: m.filter((x) => x.photoUrl).slice(0, 4).map((x) => x.photoUrl) });
    }
    res.json(out);
  });

  /** Make one: hand-picked, private until switched public. */
  app.post("/api/admin/directories", requireAdmin, adminOnly, async (req, res) => {
    await ensure();
    const name = String(req.body?.name ?? "").trim().slice(0, 80);
    if (name.length < 2) return res.status(400).json({ message: "Give it a name." });
    const description = String(req.body?.description ?? "").trim().slice(0, 300);
    let slug = slugify(name);
    for (let i = 2; await dirBySlug(slug); i++) slug = `${slugify(name)}-${i}`;
    if (["all", "verified"].includes(slug)) slug = `${slug}-2`;
    const r = (await rows(sql`insert into mv_directories (slug, name, description, kind, public, created_at) values (${slug}, ${name}, ${description}, 'manual', ${req.body?.public === true}, ${new Date().toISOString()}) returning *`))[0];
    res.status(201).json(asDir(r));
  });

  /** Rename, describe, or switch public. "All subscribers" stays team only. */
  app.patch("/api/admin/directories/:slug", requireAdmin, adminOnly, async (req, res) => {
    const d = await dirBySlug(String(req.params.slug));
    if (!d) return res.status(404).json({ message: "No such directory." });
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 80) : d.name;
    const description = typeof req.body?.description === "string" ? req.body.description.trim().slice(0, 300) : d.description;
    const pub = d.kind === "all" ? false : typeof req.body?.public === "boolean" ? req.body.public : d.public;
    if (name.length < 2) return res.status(400).json({ message: "Give it a name." });
    await db.execute(sql`update mv_directories set name = ${name}, description = ${description}, public = ${pub} where id = ${d.id}`);
    res.json({ ...d, name, description, public: pub });
  });

  app.delete("/api/admin/directories/:slug", requireAdmin, adminOnly, async (req, res) => {
    const d = await dirBySlug(String(req.params.slug));
    if (!d) return res.status(404).json({ message: "No such directory." });
    if (d.kind !== "manual") return res.status(400).json({ message: "The built-in directories stay." });
    await db.execute(sql`delete from mv_directory_members where directory_id = ${d.id}`);
    await db.execute(sql`delete from mv_directories where id = ${d.id}`);
    res.json({ ok: true });
  });

  /** One directory opened: its members, featured first. */
  app.get("/api/admin/directories/:slug", requireAdmin, adminOnly, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const d = await dirBySlug(String(req.params.slug));
    if (!d) return res.status(404).json({ message: "No such directory." });
    res.json({ directory: d, members: await membersOf(d) });
  });

  /** Add members to a hand-picked directory. */
  app.post("/api/admin/directories/:slug/members", requireAdmin, adminOnly, async (req, res) => {
    const d = await dirBySlug(String(req.params.slug));
    if (!d) return res.status(404).json({ message: "No such directory." });
    if (d.kind !== "manual") return res.status(400).json({ message: "This one fills itself." });
    const ids = (Array.isArray(req.body?.profileIds) ? req.body.profileIds : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 200) as number[];
    const ok = new Set((await candidates()).map((p) => p.id));
    const now = new Date().toISOString();
    let added = 0;
    for (const id of ids) {
      if (!ok.has(id)) continue;
      await db.execute(sql`insert into mv_directory_members (directory_id, profile_id, added_at) values (${d.id}, ${id}, ${now}) on conflict do nothing`);
      added++;
    }
    res.json({ added });
  });

  app.delete("/api/admin/directories/:slug/members/:profileId", requireAdmin, adminOnly, async (req, res) => {
    const d = await dirBySlug(String(req.params.slug));
    if (!d) return res.status(404).json({ message: "No such directory." });
    if (d.kind !== "manual") return res.status(400).json({ message: "This one fills itself. Switch Public off to hide someone." });
    await db.execute(sql`delete from mv_directory_members where directory_id = ${d.id} and profile_id = ${Number(req.params.profileId)}`);
    res.json({ ok: true });
  });

  /** A member's Public or Featured in one directory. In All subscribers these are their own directory setting and the pin. */
  app.patch("/api/admin/directories/:slug/members/:profileId", requireAdmin, adminOnly, async (req, res) => {
    const d = await dirBySlug(String(req.params.slug));
    if (!d) return res.status(404).json({ message: "No such directory." });
    const pid = Number(req.params.profileId);
    const p = (await candidates()).find((x) => x.id === pid);
    if (!p) return res.status(404).json({ message: "No such member." });
    const pub = typeof req.body?.public === "boolean" ? req.body.public : undefined;
    const feat = typeof req.body?.featured === "boolean" ? req.body.featured : undefined;
    if (d.kind === "all") {
      await storage.upsertProfile(p.email, { ...(pub === undefined ? {} : { directoryHidden: !pub }), ...(feat === undefined ? {} : { directoryOrder: feat ? 0 : 1000 }) } as never);
    } else {
      if (d.kind === "manual" && !(await rows(sql`select 1 from mv_directory_members where directory_id = ${d.id} and profile_id = ${pid}`)).length) return res.status(404).json({ message: "Not in this directory." });
      await db.execute(sql`insert into mv_directory_members (directory_id, profile_id, public, featured, added_at)
        values (${d.id}, ${pid}, ${pub ?? true}, ${feat ?? false}, ${new Date().toISOString()})
        on conflict (directory_id, profile_id) do update set
          public = ${pub === undefined ? sql`mv_directory_members.public` : sql`${pub}`},
          featured = ${feat === undefined ? sql`mv_directory_members.featured` : sql`${feat}`}`);
    }
    res.json({ ok: true });
  });

  /** People to add: a name search over everyone a directory could hold. */
  app.get("/api/admin/directories-people", requireAdmin, adminOnly, async (req, res) => {
    const q = String(req.query.q ?? "").trim().toLowerCase();
    const out = (await candidates())
      .filter((p) => !q || `${p.hostName} ${p.podcastName}`.toLowerCase().includes(q))
      .slice(0, 20)
      .map((p) => ({ profileId: p.id, name: p.hostName.trim(), show: p.podcastName.trim(), photoUrl: photoOf(p) }));
    res.json(out);
  });

  /** A public directory's page: its public members, in the Member Directory's card shape. Nothing private. */
  app.get("/api/directory/:slug", async (req, res) => {
    const d = await dirBySlug(String(req.params.slug));
    if (!d || !d.public || d.kind === "all") return res.status(404).json({ message: "No such directory." });
    res.setHeader("Cache-Control", "public, max-age=60");
    const m = (await membersOf(d)).filter((x) => x.public && x.photoUrl);
    const byId = new Map((await storage.listAllProfiles()).map((p) => [p.id, p]));
    res.json({
      name: d.name, description: d.description,
      cards: m.map((x) => {
        const p = byId.get(x.profileId)!;
        return {
          id: p.id, hostName: x.name, podcastName: p.podcastName, photoUrl: x.photoUrl, branch: p.branch, serviceStatus: p.serviceStatus,
          podcaster: isPodcaster(p.interests) && Boolean(p.podcastName.trim()), interests: p.interests, rssUrl: p.rssUrl, youtubeUrl: p.youtubeUrl,
          socialLinks: p.socialLinks, socialAccounts: p.socialAccounts, onLineup: "", featured: x.featured,
        };
      }),
    });
  });
}
