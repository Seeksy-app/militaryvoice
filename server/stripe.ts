import { createHmac, timingSafeEqual } from "node:crypto";
import { tokenPack } from "../shared/tokens.js";

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

/** Check Stripe's signature and hand back the purchase, if the event is one. */
export function paidFromWebhook(raw: Buffer | undefined, header: string): PaidTokens | null | "bad-signature" {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
  if (!secret || !raw) return "bad-signature";
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]).filter((p) => p.length === 2));
  const t = Number(parts.t);
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > 600) return "bad-signature";
  const want = createHmac("sha256", secret).update(`${t}.${raw.toString("utf8")}`).digest();
  const ok = sigs.some((s) => {
    const got = Buffer.from(s, "hex");
    return got.length === want.length && timingSafeEqual(got, want);
  });
  if (!ok) return "bad-signature";
  const event = JSON.parse(raw.toString("utf8"));
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return null;
  return paidFrom(event.data?.object);
}
