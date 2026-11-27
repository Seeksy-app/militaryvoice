/**
 * Our mail moved to militaryvoices.ai (Workspace primary domain, 27 Nov 2026). The old militaryvoice.ai addresses
 * stay as aliases of the same mailboxes, and some stored rows still carry them, so compare through these:
 * send and show the new spelling, match either.
 */
export const canonMail = (email: string | null | undefined): string =>
  String(email ?? "").trim().toLowerCase().replace(/@militaryvoice\.ai$/, "@militaryvoices.ai");
export const sameMailbox = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const x = canonMail(a);
  return x !== "" && x === canonMail(b);
};
/** The same mailbox under the old spelling (for looking up rows stored before the move), or "" when there isn't one. */
export const oldSpelling = (email: string | null | undefined): string => {
  const c = canonMail(email);
  return c.endsWith("@militaryvoices.ai") ? c.replace(/@militaryvoices\.ai$/, "@militaryvoice.ai") : "";
};
