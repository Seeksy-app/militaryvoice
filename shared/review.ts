/** The one account Zoom's (and other marketplaces') reviewers sign in to, with a password instead of an emailed code. Never on the public lineup. */
export const REVIEW_EMAIL = "zoom-review@militaryvoices.ai";

/**
 * House, test and reviewer accounts never show in a directory (Andrew, 27 Nov 2026: the reviewer's
 * "Review Test Show" card was in the Member Directory). The accounts stay; they're only kept off lists.
 * On our own two domains: hello@ and any hello+tag@ test seat, the reviewer, and any address with
 * "test" or "review" in it. Everyone else's address is never matched.
 */
export function keptOutOfDirectories(email: string | null | undefined): boolean {
  const e = String(email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return false;
  const local = e.slice(0, at), domain = e.slice(at + 1);
  if (domain !== "militaryvoices.ai" && domain !== "militaryvoice.ai") return false;
  return e === REVIEW_EMAIL || local === "hello" || local.startsWith("hello+") || /test|review/.test(local);
}
