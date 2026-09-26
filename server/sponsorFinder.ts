import type { Express, RequestHandler } from "express";
import { storage } from "./storage.js";
import type { SponsorSearchRow } from "../shared/schema.js";

/**
 * The sponsor finder. Parallel's Task API does the research — the web plus
 * the company and people data it licenses (Apollo, Crunchbase, Harmonic and
 * the rest come in by default) — and answers in the shape asked for. A
 * "find" run lists companies that fit an event; a "contact" run finds the one
 * person at a company to write to. Runs take minutes, so they are started
 * here, stored, and checked when the admin page asks.
 */
const API = "https://api.parallel.ai/v1/tasks/runs";
const KEY_NAMES = ["PARALLEL_API_KEY", "PARALLEL_AI_API_KEY", "PARALLELAI_API_KEY", "PARALLEL_KEY", "PARALLEL_WEB_API_KEY"];
const key = () => KEY_NAMES.map((n) => (process.env[n] || "").trim()).find(Boolean) || "";
/** When the key can't be found: the names that look close (names only, never values). */
const missing = () => {
  const near = Object.keys(process.env).filter((n) => /parallel/i.test(n));
  return `PARALLEL_API_KEY isn't set for this deployment.${near.length ? ` Found: ${near.join(", ")}.` : ""}`;
};

// Lists are exploratory research (pro, ~2–10 min, $0.10 a run); one person
// at one company is a cross-checked look-up (core, ~1–5 min, $0.025).
const PROCESSOR = { find: "pro", contact: "core" } as const;

const str = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

const FIND_SCHEMA = obj({
  companies: {
    type: "array",
    description: "The companies that fit, best fit first.",
    items: obj({
      name: str("Company name."),
      website: str("Company website URL."),
      hq: str("Headquarters city and state or country."),
      size: str("Employees and revenue or funding, briefly, e.g. '1,200 employees · $300M revenue'. Empty if unknown."),
      category: str("What they sell, in a few words."),
      why_fit: str("One or two sentences: why this company would sponsor this event, specific to them."),
      evidence: str("What they have sponsored or done for veterans, military families or podcasts before, with the year. Empty if nothing found."),
      contact_name: str("The person most likely to decide on a sponsorship: head of partnerships, brand, marketing or military/veteran programs. Empty if not found."),
      contact_title: str("That person's title."),
      contact_linkedin: str("That person's LinkedIn profile URL, only if found."),
      contact_email: str("That person's work email, only if found in a trusted source. Never guessed."),
    }),
  },
});

const CONTACT_SCHEMA = obj({
  name: str("Full name of the person who decides on event and podcast sponsorships at this company. Empty if not found."),
  title: str("Their current title."),
  linkedin: str("Their LinkedIn profile URL, only if found."),
  email: str("Their work email, only if found in a trusted source. Never guessed."),
  phone: str("A direct work phone, only if published. Usually empty."),
  why: str("One sentence: why this is the right person (their remit, a past sponsorship they ran)."),
  backup_name: str("A second person to try, with title, e.g. 'Jane Doe, VP Brand'. Empty if none."),
});

async function parallel(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API}${path}`, { ...init, headers: { "x-api-key": key(), "Content-Type": "application/json", ...(init?.headers ?? {}) } });
}

async function errorText(r: Response): Promise<string> {
  const body = await r.text();
  try {
    const j = JSON.parse(body);
    return j?.error?.message || j?.detail || body.slice(0, 300);
  } catch {
    return `${r.status} ${body.slice(0, 300)}`;
  }
}

async function startRun(processor: string, input: string, schema: object): Promise<string> {
  const r = await parallel("", {
    method: "POST",
    body: JSON.stringify({ input, processor, task_spec: { output_schema: { type: "json", json_schema: schema } } }),
  });
  if (!r.ok) throw new Error(r.status === 402 ? "The Parallel account is out of credit." : `Parallel: ${await errorText(r)}`);
  const run = (await r.json()) as { run_id?: string };
  if (!run.run_id) throw new Error("Parallel didn't return a run.");
  return run.run_id;
}

/** Look at a running search once; store the answer if Parallel has one. */
async function settle(row: SponsorSearchRow): Promise<SponsorSearchRow> {
  if (row.status !== "running" || !row.runId) return row;
  const r = await parallel(`/${row.runId}`);
  if (!r.ok) return row;
  const run = (await r.json()) as { status?: string; error?: { message?: string } };
  if (run.status === "failed" || run.status === "cancelled") {
    return (await storage.updateSponsorSearch(row.id, { status: "failed", error: run.error?.message || `The research ${run.status}.` })) ?? row;
  }
  if (run.status !== "completed") return row;
  const res = await parallel(`/${row.runId}/result?timeout=20`);
  if (!res.ok) return row;
  const out = (await res.json()) as { output?: { content?: unknown; basis?: Array<{ field?: string; citations?: Array<{ url?: string; title?: string }> }> } };
  const content = typeof out.output?.content === "string" ? safeJson(out.output.content) : out.output?.content;
  // Keep the sources beside the answer: a lead with a link behind it is one
  // Riccoh can check before he writes.
  const sources = (out.output?.basis ?? []).map((b) => ({ field: b.field ?? "", urls: (b.citations ?? []).map((c) => c.url).filter(Boolean).slice(0, 3) })).filter((b) => b.urls.length);
  return (await storage.updateSponsorSearch(row.id, { status: "done", result: JSON.stringify({ ...(content as object), sources }) })) ?? row;
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}

async function eventContext(eventId: number) {
  const [event, sponsors, packages, leads] = await Promise.all([
    storage.getEventById(eventId),
    storage.listSponsors(false, [eventId, 0]),
    storage.listSponsorPackages(eventId),
    storage.listSponsorLeads(eventId),
  ]);
  return { event, sponsors, packages, leads };
}

export function registerSponsorFinder(app: Express, requireAdmin: RequestHandler) {
  app.get("/api/admin/sponsor-finder", requireAdmin, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const eventId = Number(req.query.eventId) || (await storage.getFeaturedEvent()).id;
    const rows = await storage.listSponsorSearches(eventId);
    // Only the running ones cost a look, and only a handful are ever running.
    const settled = await Promise.all(rows.map((r) => (r.status === "running" ? settle(r).catch(() => r) : r)));
    res.json({ configured: !!key(), missing: key() ? "" : missing(), searches: settled });
  });

  app.post("/api/admin/sponsor-finder", requireAdmin, async (req, res) => {
    if (!key()) return res.status(503).json({ message: missing() });
    const eventId = Number(req.body?.eventId) || (await storage.getFeaturedEvent()).id;
    const brief = String(req.body?.brief ?? "").trim().slice(0, 1500);
    const count = Math.min(25, Math.max(5, Number(req.body?.count) || 12));
    const { event, sponsors, packages, leads } = await eventContext(eventId);
    if (!event) return res.status(404).json({ message: "No such event." });
    const skip = Array.from(new Set([...sponsors.map((s) => s.name), ...leads.map((l) => l.company)].map((s) => s.trim()).filter(Boolean)));
    const pkgs = packages.filter((p) => p.active).map((p) => `${p.name}${p.price ? ` ($${p.price.toLocaleString("en-US")})` : ""}`);
    const when = new Date(event.startAtUtc).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
    const input = [
      `Find ${count} companies that are likely to sponsor this event, and the person at each who decides.`,
      ``,
      `Event: ${event.name}${event.tagline ? ` — ${event.tagline}` : ""}. ${when}, ${event.durationHours} hours, streamed live.`,
      `Organizer: MilitaryVoices.ai, the platform for military and veteran podcasters. The audience is veterans, service members, military spouses and families, and the people who hire and serve them.`,
      event.description ? `About it: ${event.description.slice(0, 700)}` : "",
      pkgs.length ? `Sponsorship packages: ${pkgs.join("; ")}.` : "",
      brief ? `What we're looking for: ${brief}` : `Favour companies with a record of sponsoring veteran causes, military family programs, podcasts or live events, or that sell to or hire veterans, and US companies with a real marketing budget.`,
      skip.length ? `Leave out these, we already have them: ${skip.slice(0, 80).join(", ")}.` : "",
      `Only real companies with evidence behind why they fit. For contacts, only real people currently in the role; leave a field empty rather than guess.`,
    ].filter(Boolean).join("\n");
    try {
      const runId = await startRun(PROCESSOR.find, input, FIND_SCHEMA);
      res.json(await storage.createSponsorSearch({ eventId, kind: "find", brief: brief || "Companies that fit this event", company: "", runId }));
    } catch (e) {
      res.status(502).json({ message: (e as Error).message });
    }
  });

  // The right person at one company: for a result that came back without
  // one, or a company Riccoh already has in mind.
  app.post("/api/admin/sponsor-finder/contact", requireAdmin, async (req, res) => {
    if (!key()) return res.status(503).json({ message: missing() });
    const eventId = Number(req.body?.eventId) || (await storage.getFeaturedEvent()).id;
    const company = String(req.body?.company ?? "").trim().slice(0, 200);
    const website = String(req.body?.website ?? "").trim().slice(0, 300);
    if (!company) return res.status(400).json({ message: "Which company?" });
    const event = await storage.getEventById(eventId);
    const input = [
      `Company: ${company}${website ? ` (${website})` : ""}.`,
      `Find the person at this company who would decide on sponsoring ${event?.name ?? "a live-streamed military and veteran podcast event"}, run by MilitaryVoices.ai for an audience of veterans and military families.`,
      `Look for heads of partnerships, sponsorships, brand, marketing or community, or whoever runs their military and veteran programs. Prefer someone who has run a sponsorship before.`,
      `Only people currently in the role. Leave a field empty rather than guess, and never construct an email address from a pattern.`,
    ].join("\n");
    try {
      const runId = await startRun(PROCESSOR.contact, input, CONTACT_SCHEMA);
      res.json(await storage.createSponsorSearch({ eventId, kind: "contact", brief: "", company, runId }));
    } catch (e) {
      res.status(502).json({ message: (e as Error).message });
    }
  });

  app.delete("/api/admin/sponsor-finder/:id", requireAdmin, async (req, res) => {
    // Parallel has no cancel for a task run; a running one finishes and is
    // simply never looked at again.
    await storage.deleteSponsorSearch(Number(req.params.id));
    res.json({ ok: true });
  });
}
