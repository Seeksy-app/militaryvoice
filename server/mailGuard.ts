// Andrew's rule, 22 Nov 2026: "Make sure you put some guardrails on and make this a rule: never, ever say my name to any
// of our customers, or send from andrew@podlogix.co, or copy andrew@podlogix.co."
//
// Every email goes through sendRawEmail (server/email.ts), which asks this first. A mail to a customer (anyone who
// isn't Andrew or one of our own addresses) is refused, never quietly changed, when:
//   1. it's from, or replies to, one of Andrew's addresses;
//   2. it copies (cc or bcc) one of Andrew's addresses;
//   3. its subject or body says "Andrew" or "Appleton".
// A customer who is themselves called Andrew may be greeted by name (recipientName), but "Appleton" never goes out.
// Internal mail to Andrew (alerts, sign-up notices, forwards) is untouched. Test: script/mail-guard.test.ts.

const ANDREW_BUILT_IN = ["andrew@podlogix.co", "andrew@smartloads.io", "andrew@workready360.com", "andrew@paradedeck.com", "appletonab@gmail.com"];

/** The bare address, lower case, from "Name <a@b.c>" or "a@b.c". */
export const addrOf = (s: string): string => (String(s ?? "").match(/<([^>]+)>/)?.[1] ?? String(s ?? "")).trim().toLowerCase();

/** Andrew's own addresses: the built-in ones, plus any in ANDREW_EMAILS, SIGNUP_NOTIFY_EMAIL or FORWARD_INBOX. */
export function andrewAddresses(env: Record<string, string | undefined> = process.env): Set<string> {
  const extra = [env.ANDREW_EMAILS, env.SIGNUP_NOTIFY_EMAIL, env.FORWARD_INBOX].flatMap((v) => String(v ?? "").split(","));
  return new Set([...ANDREW_BUILT_IN, ...extra].map(addrOf).filter((a) => a.includes("@")));
}

const OWN_DOMAIN = /@(?:[a-z0-9-]+\.)*militaryvoices?\.ai$/i;
/** Andrew himself, or one of our own mailboxes (hello@, team@…): not a customer. */
export const isInternalAddress = (a: string, andrew = andrewAddresses()): boolean => andrew.has(addrOf(a)) || OWN_DOMAIN.test(addrOf(a));
/** An address that must never send to, reply-to, or be copied on a customer's mail. */
const isAndrewish = (a: string, andrew: Set<string>): boolean => andrew.has(addrOf(a)) || /^(?:andrew|appletonab)@/.test(addrOf(a));

export type GuardMail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  from?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  kind?: string;
  /** The customer's own name, so someone called Andrew can be greeted by name. */
  recipientName?: string;
};

/** Why this email can't go, in plain words, or null when it's fine. */
export function mailGuard(m: GuardMail, env: Record<string, string | undefined> = process.env): string | null {
  const andrew = andrewAddresses(env);
  if (isInternalAddress(m.to, andrew)) return null;
  // A creator's own campaign to their own audience is their words, not ours.
  if ((m.kind ?? "").startsWith("creator-campaign:")) return null;
  if ((m.from && isAndrewish(m.from, andrew)) || (m.replyTo && isAndrewish(m.replyTo, andrew))) {
    return "This email is from Andrew's address. Customer mail goes from hello@ or the team, never from Andrew.";
  }
  if ([...(m.cc ?? []), ...(m.bcc ?? [])].some((a) => isAndrewish(a, andrew))) {
    return "This email copies Andrew. Take his address off before sending.";
  }
  const words = `${m.subject}\n${m.text}\n${m.html}`;
  if (/\bappleton\b/i.test(words)) return "This email names Andrew. Take his name out before sending.";
  if (/\bandrew\b/i.test(words) && !/\bandrew\b/i.test(m.recipientName ?? "")) return "This email names Andrew. Take his name out before sending.";
  return null;
}
