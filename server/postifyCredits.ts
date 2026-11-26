import type { Express, Request, RequestHandler } from "express";
import { and, asc, desc, eq, gt, gte, inArray, like, lt, sql } from "drizzle-orm";
import { db, schemaIsReady, storage } from "./storage.js";
import { clips, postifySubscriptions, postifyTokens, recordings, scheduledGrants, type PostifySubscriptionRow } from "../shared/schema.js";
import { planOf } from "../shared/tokens.js";

/**
 * Pōstify credits: where they went (Andrew, 26 Nov: "we need to have a log they can look at for their credits to see
 * exactly what they've spent it on"), and when the next ones come. The ledger is postify_tokens; this only reads it.
 */

const emailOf = (req: Request) => String((req as unknown as { hostEmail?: string }).hostEmail ?? "").trim().toLowerCase();

/** A gifted plan: no card, its credits come as scheduled grants. */
export const isCompPlan = (sub: Pick<PostifySubscriptionRow, "subscriptionId" | "customerId">) =>
  String(sub.subscriptionId ?? "").startsWith("comp:") || !sub.customerId;

/**
 * When their next plan credits arrive, or null when none are coming. A paid plan's come with its next invoice
 * (periodEnd); a gifted plan's are scheduled grants, so the next one still to give (26 Nov: WorkReady360's panel said
 * "next credits Dec 31" from the gift's end date while none were scheduled at all).
 */
export async function nextCreditsAt(sub: PostifySubscriptionRow): Promise<string | null> {
  if (!isCompPlan(sub)) return sub.periodEnd || null;
  const [g] = await db.select({ at: scheduledGrants.grantAt }).from(scheduledGrants)
    .where(and(eq(scheduledGrants.email, sub.email), eq(scheduledGrants.doneAt, ""), gte(scheduledGrants.grantAt, new Date().toISOString())))
    .orderBy(asc(scheduledGrants.grantAt)).limit(1);
  // With monthly gift credits on, the next 1st (while the gift lasts) if no grant comes sooner.
  if (await compMonthlyOn()) {
    const first = nextFirst(new Date());
    if (first < (sub.periodEnd || "9999") && (!g || first < g.at)) return first;
  }
  return g?.at ?? null;
}

// ---- Gifted plans give their own monthly credits ------------------------------------------------------------------

/**
 * Off until Andrew's go (26 Nov). On: every active gifted plan gets its plan's credits once a calendar month (UTC), with
 * ref comp:<email>:<YYYY-MM>, so a month lands once however often the cron runs. A month that already has a plan grant
 * in scheduled_grants (the October gifts' hand-made November and December 90s) is skipped, so nobody gets it twice.
 * Turning it on in a month gives that month too (the 21 Nov gifts' November).
 */
export const COMP_MONTHLY_SETTING = "postify:comp-monthly";
export const compMonthlyOn = async () => (await storage.getSetting(COMP_MONTHLY_SETTING).catch(() => null)) === "on";
const monthOf = (d: Date) => d.toISOString().slice(0, 7);
/** 12:00 UTC on the 1st of next month, when the monthly credits come (the same hour the hand-made grants used). */
const nextFirst = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 12)).toISOString();

export async function giveCompMonthly(at = new Date()): Promise<{ given: number; skipped: number }> {
  if (!(await compMonthlyOn())) return { given: 0, skipped: 0 };
  const t = at.toISOString();
  const month = monthOf(at);
  const monthStart = `${month}-01T00:00:00.000Z`;
  const monthEnd = nextFirst(at).slice(0, 10) + "T00:00:00.000Z";
  const subs = await db.select().from(postifySubscriptions)
    .where(and(like(postifySubscriptions.subscriptionId, "comp:%"), eq(postifySubscriptions.status, "active"), gt(postifySubscriptions.periodEnd, t)));
  let given = 0;
  let skipped = 0;
  for (const sub of subs) {
    const plan = planOf(sub.plan);
    if (!plan || (sub.periodStart && sub.periodStart > t)) continue;
    const handMade = await db.select({ credits: scheduledGrants.credits, note: scheduledGrants.note }).from(scheduledGrants)
      .where(and(eq(scheduledGrants.email, sub.email), gte(scheduledGrants.grantAt, monthStart), lt(scheduledGrants.grantAt, monthEnd)));
    if (handMade.some((g) => g.credits === plan.credits || /pro plan|plan's|plan:/i.test(g.note))) { skipped++; continue; }
    const added = await storage.addTokens({ email: sub.email, delta: plan.credits, reason: `${plan.name} monthly (gift): ${plan.credits} credits`, ref: `comp:${sub.email}:${month}` });
    if (added) given++;
  }
  return { given, skipped };
}

export type CreditKind = "episode" | "clip" | "more" | "reclean" | "refund" | "plan" | "pack" | "gift" | "discovery" | "other";
export type CreditRow = {
  id: number;
  at: string;
  delta: number;
  kind: CreditKind;
  /** Plain words, e.g. "Clip: You NEVER Know (1 credit)", "Pro monthly: 90 credits", "Pack: 20 credits". */
  reason: string;
  /** The episode it was for, when there is one (open it at /host/dashboard/postify?episode=<id>). */
  episode: { id: number; title: string } | null;
  /** Credits past their balance that went on the bill as extras (paid monthly plans only). */
  extra: number;
  balanceAfter: number;
};

const plural = (n: number) => `${n} credit${n === 1 ? "" : "s"}`;
/** Upload names ("IMG_4661", a hex id) aren't titles. */
const titleOf = (t: string | undefined) => {
  const s = String(t ?? "").trim();
  return !s || /^[0-9a-f]{24,}$/i.test(s) ? "an episode" : s;
};
/** Never a person's email in what a customer reads: "(from andrew@…)" came from the bonus tool. */
const scrub = (s: string) => s.replace(/\s*\(from [^)]*\)\s*$/i, "").replace(/[^\s@()]+@[^\s@()]+\.[a-z]{2,}/gi, "the team").trim();

export function kindOf(ref: string): CreditKind {
  const p = ref.split(":")[0];
  if (p === "episode" || p === "clip" || p === "more" || p === "reclean" || p === "refund" || p === "plan") return p;
  if (p === "stripe") return "pack";
  if (p === "comp") return "plan";
  if (p === "bonus" || p === "grant") return "gift";
  if (p === "profile" || p === "reveal") return "discovery";
  return "other";
}
/** The recording a ref points at, or the clip whose recording it is. */
function recordingRef(ref: string): { rec?: number; clip?: number } {
  const [p, a, b] = ref.split(":");
  if ((p === "episode" || p === "more" || p === "reclean") && /^\d+$/.test(a ?? "")) return { rec: Number(a) };
  if (p === "refund" && a === "episode" && /^\d+$/.test(b ?? "")) return { rec: Number(b) };
  if (p === "clip" && /^\d+$/.test(a ?? "")) return { clip: Number(a) };
  return {};
}

export function plainReason(kind: CreditKind, raw: string, delta: number, title: string | null): string {
  const n = Math.abs(delta);
  const t = title && title !== "an episode" ? title : "";
  const on = (label: string) => (t ? `${label}: ${t}` : label);
  switch (kind) {
    case "episode": return `${on("Episode")} (${plural(n)})`;
    case "clip": { const c = raw.replace(/^Clip:\s*/i, "").trim(); return `${c ? `Clip: ${c}` : on("Clip")} (${plural(n)})`; }
    case "more": return `${on("More clips")} (${plural(n)})`;
    case "reclean": return `${on("Cleaned again")} (${plural(n)})`;
    case "refund": return `Refund: ${scrub(raw).replace(/^(Refund|Credit back):\s*/i, "")} (${plural(n)})`;
    case "plan": return raw; // "Pro monthly: 90 credits"
    case "pack": return `Pack: ${plural(n)}`;
    case "gift": {
      const note = scrub(raw).replace(/^Bonus credits:?\s*/i, "").trim();
      if (!note) return `Gift: ${plural(n)} from the team`;
      return new RegExp(`\\b${n} credits?\\b`).test(note) ? `Gift: ${note}` : `Gift: ${note} (${plural(n)})`;
    }
    case "discovery": return `${scrub(raw)} (${plural(n)})`;
    default: return `${scrub(raw) || (delta > 0 ? "Added" : "Used")} (${plural(n)})`;
  }
}

/** One page of someone's ledger, newest first. `before` is the id to page from (the last row's id). */
export async function creditHistory(email: string, opts: { before?: number; limit?: number } = {}): Promise<{ rows: CreditRow[]; balance: number; next: number | null }> {
  const limit = Math.min(100, Math.max(1, Math.round(opts.limit ?? 30)));
  // Running balance in the database, so a page shows the right "after" without reading every row.
  const ledger = db.$with("ledger").as(
    db.select({
      id: postifyTokens.id, at: postifyTokens.createdAt, delta: postifyTokens.delta, overage: postifyTokens.overage,
      reason: postifyTokens.reason, ref: postifyTokens.ref,
      after: sql<number>`sum(${postifyTokens.delta}) over (order by ${postifyTokens.id})`.as("after"),
    }).from(postifyTokens).where(eq(postifyTokens.email, email)),
  );
  const page = await db.with(ledger).select().from(ledger)
    .where(opts.before ? lt(ledger.id, opts.before) : undefined)
    .orderBy(desc(ledger.id)).limit(limit + 1);
  const [{ balance } = { balance: 0 }] = await db.select({ balance: sql<number>`coalesce(sum(${postifyTokens.delta}), 0)` }).from(postifyTokens).where(eq(postifyTokens.email, email));
  const rows = page.slice(0, limit);

  const refs = rows.map((r) => recordingRef(r.ref));
  const clipIds = refs.map((r) => r.clip).filter((x): x is number => !!x);
  const clipRec = new Map<number, number>();
  if (clipIds.length) for (const c of await db.select({ id: clips.id, rec: clips.recordingId }).from(clips).where(inArray(clips.id, clipIds))) clipRec.set(c.id, c.rec);
  const recIds = Array.from(new Set(refs.map((r) => r.rec ?? (r.clip ? clipRec.get(r.clip) : undefined)).filter((x): x is number => !!x)));
  const recTitle = new Map<number, string>();
  // Only their own recordings: a ref can't show someone else's episode.
  if (recIds.length) for (const r of await db.select({ id: recordings.id, title: recordings.title }).from(recordings).where(and(inArray(recordings.id, recIds), eq(recordings.email, email)))) recTitle.set(r.id, titleOf(r.title));

  return {
    balance: Number(balance),
    next: page.length > limit ? rows[rows.length - 1].id : null,
    rows: rows.map((r, i) => {
      const kind = kindOf(r.ref);
      const recId = refs[i].rec ?? (refs[i].clip ? clipRec.get(refs[i].clip!) : undefined);
      const title = recId && recTitle.has(recId) ? recTitle.get(recId)! : null;
      return {
        id: r.id,
        at: r.at,
        delta: r.delta,
        kind,
        reason: plainReason(kind, r.reason, r.delta, title),
        episode: recId && title ? { id: recId, title } : null,
        extra: r.overage,
        balanceAfter: Number(r.after),
      };
    }),
  };
}

export function registerPostifyCredits(app: Express, requireHostSession: RequestHandler, requireAdmin: RequestHandler) {
  const read = (q: Request["query"]) => ({ before: Number(q.before) || undefined, limit: Number(q.limit) || undefined });

  /** Signed in: their own credits, newest first. `?before=<id>` for the next page. */
  app.get("/api/postify/credits/history", requireHostSession, async (req, res) => {
    try {
      await schemaIsReady();
      const email = emailOf(req);
      if (!email) return void res.status(401).json({ message: "Please sign in again." });
      res.set("Cache-Control", "no-store");
      res.json(await creditHistory(email, read(req.query)));
    } catch (err) {
      console.error("credit history:", (err as Error).message);
      res.status(500).json({ message: "Your credits didn't load. Try again in a minute." });
    }
  });

  /** Admin: anyone's credits (Admin → the account), with the ledger's raw reason and ref beside the plain words. */
  app.get("/api/admin/postify/credits", requireAdmin, async (req, res) => {
    try {
      await schemaIsReady();
      const email = String(req.query.email ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+$/.test(email)) return void res.status(400).json({ message: "Whose credits?" });
      const page = await creditHistory(email, read(req.query));
      const raw = new Map((await db.select({ id: postifyTokens.id, reason: postifyTokens.reason, ref: postifyTokens.ref }).from(postifyTokens)
        .where(inArray(postifyTokens.id, page.rows.length ? page.rows.map((r) => r.id) : [0]))).map((r) => [r.id, r]));
      const grants = await db.select().from(scheduledGrants).where(eq(scheduledGrants.email, email)).orderBy(asc(scheduledGrants.grantAt));
      res.json({ email, ...page, rows: page.rows.map((r) => ({ ...r, rawReason: raw.get(r.id)?.reason ?? "", ref: raw.get(r.id)?.ref ?? "" })), scheduled: grants });
    } catch (err) {
      console.error("admin credit history:", (err as Error).message);
      res.status(500).json({ message: (err as Error).message });
    }
  });
}
