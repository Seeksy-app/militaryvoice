// Admin → Finances → Statements (Andrew, 27 Nov 2026): the income statement, cash by month and owner
// contributions, live from Stripe (money in from members and sponsors), Mercury (Applied Growth
// Technologies' bank: spend, and the owner's own transfers) and the hand-kept bills list (bills paid on
// cards outside Mercury, at our share). Read-only on money: GETs to Stripe and Mercury, nothing else.
//
// Revenue is two lines for now: Subscribers (plans, add-ons, Pōstify credit packs) and Sponsorship.
// Riccoh's payments (OHIOWA) are owner contributions, never revenue, and so are the owner's own
// deposits into Mercury. Anything that can't be sorted by rule waits in "To sort" for an admin.
//
// The server sends every line, month by month; the page adds them up for the month, quarter or year picked.
import type { Express, RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { db, storage, schemaIsReady } from "./storage.js";
import { PLANS, ADDONS } from "../shared/tokens.js";
import { FIN_START, maskNumbers, monthOf, classifyCharge, expenseCategory, vendorKey, isOwnerText, matchHand, type Kind, type FinRow, type HandLine, type SortKind } from "../shared/finance.js";

const SORT_KEY = "finance_sort";

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>): Promise<Row[]> => { const r: any = await db.execute(q); return (r.rows ?? r) as Row[]; };
const json = <T>(raw: string | null, fallback: T): T => { try { return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; } };
const cents = (dollars: unknown) => Math.round((Number(dollars) || 0) * 100);

// ---------------------------------------------------------------------------------------------- Stripe

async function stripeGet(path: string): Promise<any> {
  const r = await fetch(`https://api.stripe.com/v1${path}`, { headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } });
  const body = (await r.json().catch(() => ({}))) as any;
  if (!r.ok) throw new Error(body?.error?.message || `Stripe ${r.status}`);
  return body;
}
async function stripeAll(path: string, pages = 20): Promise<any[]> {
  const out: any[] = [];
  let after = "";
  for (let i = 0; i < pages; i++) {
    const body = await stripeGet(`${path}${path.includes("?") ? "&" : "?"}limit=100${after ? `&starting_after=${after}` : ""}`);
    out.push(...(body.data ?? []));
    if (!body.has_more || !body.data?.length) break;
    after = body.data[body.data.length - 1].id;
  }
  return out;
}

// --------------------------------------------------------------------------------------------- Mercury

async function mercuryGet(path: string): Promise<any> {
  const r = await fetch(`https://api.mercury.com/api/v1${path}`, { headers: { authorization: `Bearer ${process.env.MERCURY_API_TOKEN}`, accept: "application/json" } });
  const body = (await r.json().catch(() => ({}))) as any;
  if (!r.ok) throw Object.assign(new Error(body?.errors?.message || body?.message || `Mercury ${r.status}`), { status: r.status });
  return body;
}
/** Every transaction on every account (checking, savings and the credit card) since the start. */
async function mercuryTransactions(start: string): Promise<any[]> {
  try {
    const out: any[] = [];
    let after = "";
    for (let i = 0; i < 20; i++) {
      const body = await mercuryGet(`/transactions?limit=500&order=asc&start=${start}${after ? `&start_after=${after}` : ""}`);
      out.push(...(body.transactions ?? []));
      after = body.page?.nextPage ?? "";
      if (!after) break;
    }
    return out;
  } catch (e) {
    if ((e as any).status !== 404) throw e;
    // Older API: account by account.
    const accounts = (await mercuryGet("/accounts")).accounts ?? [];
    const out: any[] = [];
    for (const a of accounts) {
      for (let offset = 0; offset < 5000; offset += 500) {
        const body = await mercuryGet(`/account/${a.id}/transactions?limit=500&offset=${offset}&start=${start}`);
        out.push(...(body.transactions ?? []));
        if ((body.transactions ?? []).length < 500) break;
      }
    }
    return out;
  }
}

// ----------------------------------------------------------------------------------------------- Build

async function build() {
  await schemaIsReady();
  const sorted = json<Record<string, SortKind>>(await storage.getSetting(SORT_KEY), {});
  const handRevenue = json<HandLine[]>(await storage.getSetting("finance_revenue"), []).map((l: any) => ({ ...l, kind: l.kind === "Sponsorship" ? "sponsorship" : l.kind === "Plans and credits" ? "plans" : "sponsorship" })) as HandLine[];
  const handOwner = json<any[]>(await storage.getSetting("finance_contributions"), []).map((l) => ({ source: String(l.name ?? ""), date: String(l.date ?? ""), note: String(l.note ?? ""), amount: Number(l.amount) || 0, kind: "owner" as Kind }));
  const bills = json<any[]>(await storage.getSetting("finance_actuals:platform"), []);
  const out: FinRow[] = [];
  const sources: Record<"stripe" | "mercury", "ok" | "off" | "error"> = { stripe: "off", mercury: "off" };
  const errors: string[] = [];

  // Stripe: every paid charge since the start, sorted into a kind.
  if (process.env.STRIPE_SECRET_KEY) {
    try {
      const gte = Math.floor(Date.parse(`${FIN_START}T05:00:00Z`) / 1000);
      const charges = await stripeAll(`/charges?created[gte]=${gte}&expand[]=data.customer`);
      const sessions = await stripeAll(`/checkout/sessions?created[gte]=${gte}`).catch(() => [] as any[]);
      const byPi = new Map<string, any>(sessions.filter((s) => s.payment_intent).map((s) => [String(s.payment_intent), s]));
      // Sponsor packages pay through a Stripe payment link pasted into the package; match by its URL.
      const links = await stripeAll(`/payment_links?active=true`, 3).catch(() => [] as any[]);
      const packageUrls = new Set((await rows(sql`select checkout_url u from sponsor_packages where checkout_url <> ''`).catch(() => [])).map((r) => String(r.u).trim()));
      const sponsorLinks = new Set(links.filter((l) => packageUrls.has(String(l.url))).map((l) => String(l.id)));
      for (const c of charges) {
        if (c.status !== "succeeded" || !c.paid || c.currency !== "usd") continue;
        const cust = typeof c.customer === "object" && c.customer ? c.customer : null;
        const email = String(c.billing_details?.email || c.receipt_email || cust?.email || "").toLowerCase();
        const who = String(c.billing_details?.name || cust?.name || email || "Unknown");
        const date = new Date(c.created * 1000).toISOString();
        const s = c.payment_intent ? byPi.get(String(c.payment_intent)) : undefined;
        const kind = classifyCharge({
          id: c.id, sorted: sorted[c.id], who, email, description: String(c.description ?? ""),
          invoice: Boolean(c.invoice), sessionKind: String(s?.metadata?.kind ?? ""), sessionMode: String(s?.mode ?? ""),
          sponsorLink: Boolean(s?.payment_link && sponsorLinks.has(String(s.payment_link))),
        });
        if (kind === "ignore") continue;
        out.push({ id: c.id, source: "stripe", month: monthOf(date), date: date.slice(0, 10), kind, cents: Number(c.amount) || 0, refundCents: Number(c.amount_refunded) || 0, who, note: String(c.description || s?.metadata?.pack && `Pōstify credits (${s.metadata.pack})` || "") });
      }
      sources.stripe = "ok";
    } catch (e) { sources.stripe = "error"; errors.push(`Stripe: ${(e as Error).message}`); }
  }

  // Hand-kept lines that a Stripe charge doesn't already cover (same amount within five days).
  // A charge still "to sort" that matches one takes that line's kind.
  for (const h of [...handRevenue, ...handOwner]) {
    const hit = matchHand(h, out);
    // The hand-kept name is the clearer one (Stripe's billing name can be a street address).
    if (hit) { if (hit.kind === "unsorted" && !sorted[hit.id!]) hit.kind = h.kind; if (h.source) { hit.note = [hit.who, hit.note].filter(Boolean).join(" · "); hit.who = h.source; } continue; }
    if (!(h.amount > 0)) continue;
    out.push({ source: "hand", month: h.date ? monthOf(`${h.date}T12:00:00Z`) : monthOf(new Date().toISOString()), date: h.date, kind: h.kind, cents: cents(h.amount), refundCents: 0, who: h.source, note: h.note || "Entered by hand" });
  }

  // Mercury: spend (card and bill payments) and money put in. Moving money between our own accounts, and
  // paying off the Mercury card (its charges are already counted one by one), are neither.
  const shareOf = new Map<string, number>();
  for (const b of bills) if (b?.label) shareOf.set(vendorKey(String(b.label)), b.share == null ? 100 : Number(b.share));
  const paidInMercury = new Set<string>(); // vendor|month seen in Mercury, so the bills list doesn't count it again
  if (process.env.MERCURY_API_TOKEN) {
    try {
      for (const t of await mercuryTransactions(FIN_START)) {
        if (!["sent", "pending"].includes(String(t.status))) continue;
        const name = String(t.counterpartyName || t.bankDescription || "Unknown");
        const cat = String(t.mercuryCategory || t.categoryData?.name || t.category || "");
        if (t.kind === "internalTransfer" || /^mercury (checking|savings|credit|treasury)/i.test(name) || /credit & loan/i.test(cat)) continue;
        const date = String(t.postedAt || t.createdAt);
        const amt = Math.round(Math.abs(Number(t.amount) || 0) * 100);
        if (!amt) continue;
        const override = sorted[t.id];
        if (override === "ignore") continue;
        if (Number(t.amount) > 0) {
          // Stripe payouts are already counted as their charges; cashback is pennies.
          if (/stripe|cashback/i.test(name)) continue;
          // Today every deposit is the owner's own money (his other accounts and companies), whatever Mercury's
          // category says. A real customer paying by bank transfer is sorted once, by hand.
          out.push({ id: t.id, source: "mercury", month: monthOf(date), date: date.slice(0, 10), kind: override && override !== "unsorted" ? override : "owner", cents: amt, refundCents: 0, who: isOwnerText(name) ? name : `Applied Growth Technologies · ${name}`, note: "Deposit to Mercury" });
          continue;
        }
        const key = vendorKey(name);
        const share = shareOf.has(key) ? shareOf.get(key)! : 100;
        paidInMercury.add(`${key}|${monthOf(date)}`);
        if (share <= 0) continue;
        out.push({ id: t.id, source: "mercury", month: monthOf(date), date: date.slice(0, 10), kind: "expense", category: expenseCategory(name, cat), cents: Math.round((amt * share) / 100), refundCents: 0, who: name, note: share < 100 ? `${share}% of $${(amt / 100).toFixed(2)}` : "" });
      }
      sources.mercury = "ok";
    } catch (e) { sources.mercury = "error"; errors.push(`Mercury: ${(e as Error).message}`); }
  }

  // Bills paid outside Mercury: each month gets the bills list at our share, as an estimate,
  // unless Mercury already shows that vendor that month.
  const months: string[] = [];
  for (let m = FIN_START.slice(0, 7), now = monthOf(new Date().toISOString()); m <= now; ) {
    months.push(m);
    const [y, mo] = m.split("-").map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  for (const b of bills) {
    if (/bought once/i.test(String(b?.group ?? ""))) continue;
    const share = b?.share == null ? 100 : Number(b.share);
    const amt = Math.round(cents(b?.amount) * share / 100);
    if (!(amt > 0)) continue;
    const key = vendorKey(String(b.label));
    for (const m of months) {
      if (paidInMercury.has(`${key}|${m}`)) continue;
      out.push({ source: "bills", month: m, date: `${m}-01`, kind: "expense", category: expenseCategory(String(b.label), ""), cents: amt, refundCents: 0, who: String(b.label), note: share < 100 ? `${share}% of $${Number(b.amount).toFixed(2)} a month` : "a month", estimate: true });
    }
  }

  // Monthly recurring revenue, as Analytics had it: paid plans at their monthly share, add-ons monthly.
  const subs = await rows(sql`select plan, interval, (subscription_id like 'sub_%') paid, count(*)::int n from postify_subscriptions where status in ('active','trialing','past_due') group by 1, 2, 3`).catch(() => [] as Row[]);
  const addons = await rows(sql`select addon, count(*)::int n from addon_subscriptions where status in ('active','trialing','past_due') and subscription_id like 'sub_%' group by addon`).catch(() => [] as Row[]);
  let mrrCents = 0;
  const plans: { name: string; interval: string; n: number; comped?: boolean }[] = [];
  for (const s of subs) {
    const p = PLANS[String(s.plan) as keyof typeof PLANS];
    const n = Number(s.n) || 0;
    if (!p) continue;
    const paid = s.paid === true || s.paid === "t";
    plans.push({ name: p.name, interval: String(s.interval || "month"), n, ...(paid ? {} : { comped: true }) });
    if (paid) mrrCents += n * (s.interval === "year" ? Math.round(p.yearCents / 12) : s.interval === "quarter" && "quarterCents" in p ? Math.round((p as any).quarterCents / 3) : p.cents);
  }
  const addonRows = addons.map((a) => {
    const ad = ADDONS[String(a.addon) as keyof typeof ADDONS];
    const n = Number(a.n) || 0;
    if (ad) mrrCents += n * ad.cents;
    return { name: ad?.name ?? String(a.addon), n };
  });

  out.sort((a, b) => a.date.localeCompare(b.date));
  // Payers sometimes type a card number into the description (PM, 27 Nov): mask it before anything is sent.
  for (const r of out) { r.who = maskNumbers(r.who); r.note = maskNumbers(r.note); }
  return { months, rows: out, recurring: { mrrCents, plans, addons: addonRows }, sources, errors, at: new Date().toISOString() };
}

export function registerFinances(app: Express, requireAdmin: RequestHandler) {
  let memo: { at: number; body: unknown } | null = null;
  const adminsOnly = (req: any, res: any) => { if (req.studioHost) { res.status(403).json({ message: "Admins only." }); return false; } return true; };

  // Path starts finance- so requireAdmin keeps it from admins without finance access and from the read key.
  app.get("/api/admin/finance-statements", requireAdmin, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!adminsOnly(req, res)) return;
    if (memo && Date.now() - memo.at < 5 * 60_000 && req.query.fresh !== "1") return res.json(memo.body);
    const late = new Promise<"late">((r) => setTimeout(() => r("late"), 25_000));
    const body = await Promise.race([build(), late]).catch((e) => { console.warn("finances:", (e as Error).message); return null; });
    if (body === "late" || !body) return res.status(503).json({ message: "Stripe and Mercury are slow to answer. Try again in a minute." });
    memo = { at: Date.now(), body };
    res.json(body);
  });

  // Sort one Stripe charge or Mercury deposit by hand; remembered by its id. "" clears it.
  app.put("/api/admin/finance-sort", requireAdmin, async (req, res) => {
    if (!adminsOnly(req, res)) return;
    const id = String(req.body?.id ?? "");
    const kind = String(req.body?.kind ?? "") as SortKind | "";
    if (!/^(ch_|py_)[\w]+$|^[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ message: "Which payment?" });
    if (kind && !["plans", "credits", "sponsorship", "owner", "ignore"].includes(kind)) return res.status(400).json({ message: "Which kind?" });
    const map = json<Record<string, SortKind>>(await storage.getSetting(SORT_KEY), {});
    if (kind) map[id] = kind; else delete map[id];
    await storage.setSetting(SORT_KEY, JSON.stringify(map));
    memo = null;
    res.json({ ok: true });
  });
}
