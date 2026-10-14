// Our own SimpleTexting number, on an account we share (14 Oct 2026).
//
// SmartLoads uses the same SimpleTexting account. 2015344064 is ours; SmartLoads
// has its own number on the account. A webhook with no number filter gets every
// number's texts, and a send with no accountPhone can go out from whichever
// number is primary. So we send only from ours, register our webhook for ours,
// and leave events about any other number alone. Kept free of the database so
// `scripts/sms-number-test.ts` can check it.

/** Ours today. Not a secret, so it's the default when SIMPLETEXTING_ACCOUNT_PHONE isn't set. */
export const DEFAULT_ACCOUNT_PHONE = "2015344064";

/** A US number as ten digits ("+1 (201) 534-4064" → "2015344064"), or "" when it isn't one. */
export function tenDigitPhone(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return "";
}

/** Our number, as ten digits: SIMPLETEXTING_ACCOUNT_PHONE, else 2015344064. */
export function ownAccountPhone(env: Record<string, string | undefined> = process.env): string {
  return tenDigitPhone(env.SIMPLETEXTING_ACCOUNT_PHONE) || DEFAULT_ACCOUNT_PHONE;
}

/**
 * The events that say which number they're about. UNSUBSCRIBE_REPORT carries no
 * accountPhone, and a SimpleTexting opt-out covers the whole account, so it's
 * always recorded.
 */
const PER_NUMBER_EVENTS = new Set(["INCOMING_MESSAGE", "DELIVERY_REPORT", "NON_DELIVERED_REPORT"]);

/** True when a webhook event is about another number on the account. No accountPhone on it → ours, as before. */
export function forOtherNumber(type: string, values: Record<string, unknown> | undefined, own: string = ownAccountPhone()): boolean {
  if (!PER_NUMBER_EVENTS.has(type)) return false;
  const acct = String(values?.accountPhone ?? "").trim();
  if (!acct) return false;
  return tenDigitPhone(acct) !== own;
}

/** The body of SimpleTexting's POST /messages: always from our number. */
export function messageBody(contactPhone: string, text: string, own: string = ownAccountPhone()) {
  return { contactPhone, accountPhone: own, mode: "AUTO", text };
}

/** The body of SimpleTexting's POST /webhooks: only our number's events. */
export function webhookBody(url: string, own: string = ownAccountPhone()) {
  return { url, accountPhone: own, triggers: ["INCOMING_MESSAGE", "DELIVERY_REPORT", "NON_DELIVERED_REPORT", "UNSUBSCRIBE_REPORT"], requestPerSecLimit: 10 };
}
