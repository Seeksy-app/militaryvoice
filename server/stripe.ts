import { createHmac, timingSafeEqual } from "node:crypto";
import { tokenPack, PLANS, planOf, type PlanKey } from "../shared/tokens.js";

/**
 * Stripe Checkout for Pōstify tokens, over Stripe's REST API (no SDK: three
 * calls don't need one). STRIPE_SECRET_KEY switches it on. Tokens are credited
 * when the buyer lands back on Pōstify (the session is read from Stripe, not
 * trusted from the URL) and again by the webhook if STRIPE_WEBHOOK_SECRET is
 * set, for someone who closes the tab first; the ledger's ref makes the
 * second one a no-op.
 */

const key = () => process.env.STRIPE_SECRET_KEY || "";
export const stripeReady = () => Boolean(key());

async function stripe(method: "GET" | "POST", path: string, form?: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${key()}`, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(body?.error?.message || `Stripe ${res.status}`);
  return body;
}

export interface PaidTokens { sessionId: string; email: string; tokens: number; pack: string }

export async function createTokenCheckout(v: { email: string; pack: string; origin: string }): Promise<string> {
  const pack = tokenPack(v.pack);
  if (!pack) throw new Error("Which pack?");
  const s = await stripe("POST", "/checkout/sessions", {
    mode: "payment",
    customer_email: v.email,
    client_reference_id: v.email,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(pack.price * 100),
    "line_items[0][price_data][product_data][name]": `Pōstify · ${pack.tokens} tokens`,
    "line_items[0][price_data][product_data][description]": "One token is one clip or one clean episode. Beta pricing.",
    "metadata[kind]": "postify_tokens",
    "metadata[email]": v.email,
    "metadata[pack]": pack.key,
    "metadata[tokens]": String(pack.tokens),
    success_url: `${v.origin}/host/dashboard/postify?paid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${v.origin}/pricing`,
  });
  return String(s.url);
}

/** A finished, paid token purchase, or null for anything else. */
function paidFrom(s: any): PaidTokens | null {
  if (!s || s.object !== "checkout.session" || s.payment_status !== "paid" || s.metadata?.kind !== "postify_tokens") return null;
  const tokens = Number(s.metadata.tokens);
  const email = String(s.metadata.email || "").trim().toLowerCase();
  if (!email || !(tokens > 0)) return null;
  return { sessionId: String(s.id), email, tokens, pack: String(s.metadata.pack || "") };
}

export async function readPaidSession(sessionId: string): Promise<PaidTokens | null> {
  if (!/^cs_[\w]+$/.test(sessionId)) return null;
  return paidFrom(await stripe("GET", `/checkout/sessions/${sessionId}`));
}

/** Why a webhook wasn't accepted, without giving anything away: which check failed. */
export function webhookProblem(raw: Buffer | undefined, header: string): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
  if (!secret) return "no STRIPE_WEBHOOK_SECRET on the server";
  if (!secret.startsWith("whsec_")) return "STRIPE_WEBHOOK_SECRET doesn't look like a signing secret (whsec_…)";
  if (secret.trim() !== secret) return "STRIPE_WEBHOOK_SECRET has spaces or a line break around it";
  if (!raw) return "no raw body reached the handler";
  if (!header) return "no Stripe-Signature header";
  const t = Number((header.match(/t=(\d+)/) ?? [])[1]);
  if (!t || Math.abs(Date.now() / 1000 - t) > 600) return "timestamp too old or missing";
  return "signature doesn't match: the secret is for a different endpoint, or the body was changed";
}

/** Check Stripe's signature; the event, or null when it isn't genuinely from Stripe. */
export function verifyWebhook(raw: Buffer | undefined, header: string): any | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
  if (!secret || !raw) return null;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]).filter((p) => p.length === 2));
  const t = Number(parts.t);
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > 600) return null;
  const want = createHmac("sha256", secret).update(`${t}.${raw.toString("utf8")}`).digest();
  const ok = sigs.some((s) => {
    const got = Buffer.from(s, "hex");
    return got.length === want.length && timingSafeEqual(got, want);
  });
  if (!ok) return null;
  return JSON.parse(raw.toString("utf8"));
}

/** A one-off credit purchase in a checkout event, if that's what it is. */
export function paidFromEvent(event: any): PaidTokens | null {
  if (event?.type !== "checkout.session.completed" && event?.type !== "checkout.session.async_payment_succeeded") return null;
  return paidFrom(event.data?.object);
}

// ---------------------------------------------------------------------------
// Plans: a monthly price, and extra credits metered at the end of the month.
// The products, prices and meter are made in Stripe on first use and found
// again by lookup key, so there's nothing to set up by hand in the dashboard.
// ---------------------------------------------------------------------------

const METER_EVENT = "postify_extra_credits";

/** A Stripe form body from a nested object: { a: { b: 1 } } → a[b]=1. */
function flat(o: Record<string, unknown>, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" ? flat(x as Record<string, unknown>, `${key}[${i}]`, out) : (out[`${key}[${i}]`] = String(x))));
    else if (typeof v === "object") flat(v as Record<string, unknown>, key, out);
    else out[key] = String(v);
  }
  return out;
}

let billing: Promise<Record<string, string>> | null = null;

/** The price ids for every plan's monthly and extra-credit prices, made if missing. */
function ensureBilling(): Promise<Record<string, string>> {
  billing ??= (async () => {
    const meters = await stripe("GET", "/billing/meters?limit=100");
    let meter = (meters.data ?? []).find((m: any) => m.event_name === METER_EVENT && m.status === "active");
    meter ??= await stripe("POST", "/billing/meters", flat({
      display_name: "Pōstify extra credits",
      event_name: METER_EVENT,
      default_aggregation: { formula: "sum" },
      customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
      value_settings: { event_payload_key: "value" },
    }));
    const keys = Object.keys(PLANS).flatMap((k) => [`postify_${k}_monthly`, `postify_${k}_extra`]);
    const found = await stripe("GET", `/prices?limit=20&${keys.map((k) => `lookup_keys[]=${k}`).join("&")}`);
    const ids: Record<string, string> = Object.fromEntries((found.data ?? []).map((p: any) => [p.lookup_key, p.id]));
    for (const plan of Object.values(PLANS)) {
      if (!ids[`postify_${plan.key}_monthly`]) {
        const p = await stripe("POST", "/prices", flat({
          lookup_key: `postify_${plan.key}_monthly`, currency: "usd", unit_amount: plan.cents,
          recurring: { interval: "month" }, product_data: { name: `Pōstify ${plan.name} · ${plan.credits} credits a month` },
        }));
        ids[p.lookup_key] = p.id;
      }
      if (!ids[`postify_${plan.key}_extra`]) {
        const p = await stripe("POST", "/prices", flat({
          lookup_key: `postify_${plan.key}_extra`, currency: "usd", unit_amount: plan.overageCents,
          recurring: { interval: "month", usage_type: "metered", meter: meter.id }, product_data: { name: `Pōstify ${plan.name} · extra credits` },
        }));
        ids[p.lookup_key] = p.id;
      }
    }
    return ids;
  })().catch((err) => { billing = null; throw err; });
  return billing;
}

export async function createPlanCheckout(v: { email: string; plan: PlanKey; origin: string; customerId?: string }): Promise<string> {
  const plan = planOf(v.plan);
  if (!plan) throw new Error("Which plan?");
  const ids = await ensureBilling();
  const s = await stripe("POST", "/checkout/sessions", flat({
    mode: "subscription",
    ...(v.customerId ? { customer: v.customerId } : { customer_email: v.email }),
    client_reference_id: v.email,
    line_items: [{ price: ids[`postify_${plan.key}_monthly`], quantity: 1 }, { price: ids[`postify_${plan.key}_extra`] }],
    metadata: { kind: "postify_plan", email: v.email, plan: plan.key },
    subscription_data: { metadata: { kind: "postify_plan", email: v.email, plan: plan.key } },
    success_url: `${v.origin}/host/dashboard/postify?subscribed={CHECKOUT_SESSION_ID}`,
    cancel_url: `${v.origin}/pricing`,
  }));
  return String(s.url);
}

export interface PlanState { email: string; plan: PlanKey; status: string; customerId: string; subscriptionId: string; periodStart: string; periodEnd: string; latestInvoice: string }

/** A subscription as we keep it, from Stripe's own record. */
export async function readSubscription(subscriptionId: string): Promise<PlanState | null> {
  const sub = await stripe("GET", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  return planStateFrom(sub);
}

export function planStateFrom(sub: any): PlanState | null {
  if (!sub || sub.object !== "subscription" || sub.metadata?.kind !== "postify_plan") return null;
  const plan = planOf(String(sub.metadata.plan));
  const email = String(sub.metadata.email || "").trim().toLowerCase();
  if (!plan || !email) return null;
  const iso = (t: unknown) => (Number(t) ? new Date(Number(t) * 1000).toISOString() : "");
  const item = sub.items?.data?.[0];
  return {
    email, plan: plan.key, status: String(sub.status),
    customerId: String(sub.customer), subscriptionId: String(sub.id),
    periodStart: iso(sub.current_period_start ?? item?.current_period_start),
    periodEnd: iso(sub.current_period_end ?? item?.current_period_end),
    latestInvoice: typeof sub.latest_invoice === "string" ? sub.latest_invoice : sub.latest_invoice?.id ?? "",
  };
}

/** Back from a plan checkout: the subscription it made, read from Stripe. */
export async function readPlanSession(sessionId: string): Promise<PlanState | null> {
  if (!/^cs_[\w]+$/.test(sessionId)) return null;
  const s = await stripe("GET", `/checkout/sessions/${sessionId}`);
  if (s?.metadata?.kind !== "postify_plan" || !s.subscription) return null;
  return readSubscription(String(s.subscription));
}

/** Extra credits used: Stripe adds them to the next bill at the plan's extra-credit price. */
export async function reportExtraCredits(v: { customerId: string; credits: number; identifier: string }): Promise<void> {
  await stripe("POST", "/billing/meter_events", flat({
    event_name: METER_EVENT,
    identifier: v.identifier.slice(0, 100),
    payload: { stripe_customer_id: v.customerId, value: v.credits },
  }));
}

/** Stripe's own page for changing card, plan or cancelling. */
export async function billingPortal(customerId: string, returnUrl: string): Promise<string> {
  const s = await stripe("POST", "/billing_portal/sessions", flat({ customer: customerId, return_url: returnUrl }));
  return String(s.url);
}
