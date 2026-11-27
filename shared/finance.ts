// Admin → Finances → Statements: the kinds of money, how a payment is sorted, and the expense groups.
// Shared so the server's sorting and the page's adding-up use the same words.

/** The first month the statements cover: Riccoh's first contribution was 19 Aug 2026. */
export const FIN_START = "2026-08-01";

/** plans + credits = Subscribers; sponsorship = Sponsorship; owner = owner contributions (equity, not revenue). */
export type Kind = "plans" | "credits" | "sponsorship" | "owner" | "expense" | "unsorted";
export type SortKind = "plans" | "credits" | "sponsorship" | "owner" | "ignore" | "unsorted";

export interface FinRow {
  /** Stripe charge or Mercury transaction id, so an admin can sort it; none for bills and hand-kept lines. */
  id?: string;
  source: "stripe" | "mercury" | "bills" | "hand";
  /** YYYY-MM, US Eastern. */
  month: string;
  date: string;
  kind: Kind;
  category?: ExpenseCategory;
  cents: number;
  refundCents: number;
  who: string;
  note: string;
  /** A bill from the bills list, not a charge we can see. */
  estimate?: boolean;
}

export interface HandLine { source: string; date: string; note: string; amount: number; kind: Kind }

export const EXPENSE_CATEGORIES = ["AI & voice", "Hosting & servers", "Software & tools", "Email & texts", "Data & search", "Internet & phone", "Travel & meals"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

const VENDORS: [ExpenseCategory, RegExp][] = [
  ["AI & voice", /anthropic|claude|openai|chatgpt|elevenlabs|\bfal\b|deepgram|heygen|creatomate|elorian|glimpse|whisper/i],
  ["Hosting & servers", /vercel|supabase|cloudflare|hostinger|render|livekit|digitalocean|hetzner|vultr|amazon web|aws|neon/i],
  ["Email & texts", /resend|twilio|telnyx|simpletexting|sendgrid|mailgun/i],
  ["Data & search", /podchaser|podscan|parallel|influencers|listen ?notes/i],
  ["Internet & phone", /comcast|xfinity|verizon|at&t|t-mobile|spectrum/i],
  ["Travel & meals", /lyft|uber|\blime\b|smartrip|airline|airlines|hotel|marriott|hilton|amtrak/i],
];

/** Which group a vendor's spend goes in: by name first, then by Mercury's own category, else software. */
export function expenseCategory(name: string, mercuryCategory: string): ExpenseCategory {
  for (const [cat, re] of VENDORS) if (re.test(name)) return cat;
  if (/travel|meal|restaurant|ride|taxi|lodging|airfare/i.test(mercuryCategory)) return "Travel & meals";
  if (/internet|telephone|utilities/i.test(mercuryCategory)) return "Internet & phone";
  return "Software & tools";
}

/** A vendor's first word, lower case: "Google Workspace" and "Google" are the same bill. */
export const vendorKey = (name: string) => (name.toLowerCase().match(/[a-z0-9]+/) ?? [""])[0];

/** Riccoh (OHIOWA operates MV under licence): what he pays in is an owner contribution, not revenue. */
const OWNER_EMAILS = new Set(["riccoh.player@drphil.tv"]);
export const isOwnerText = (s: string) => /riccoh|ohiowa/i.test(s);

export function classifyCharge(c: {
  id: string; sorted?: SortKind; who: string; email: string; description: string;
  invoice: boolean; sessionKind: string; sessionMode: string; sponsorLink: boolean;
}): Kind | "ignore" {
  if (c.sorted) return c.sorted;
  if (OWNER_EMAILS.has(c.email) || isOwnerText(`${c.who} ${c.email} ${c.description}`)) return "owner";
  if (c.sessionKind === "postify_tokens") return "credits";
  if (c.invoice || c.sessionMode === "subscription" || /^subscription/i.test(c.description)) return "plans";
  if (c.sponsorLink || /sponsor/i.test(c.description)) return "sponsorship";
  return "unsorted";
}

/** A Stripe or Mercury line a hand-kept line describes: the same amount within five days, not taken by another line. */
const taken = new WeakSet<FinRow>();
export function matchHand(h: HandLine, rows: FinRow[]): FinRow | undefined {
  if (!h.date) return undefined;
  const at = Date.parse(`${h.date}T12:00:00Z`);
  const want = Math.round(h.amount * 100);
  // A shared surname or company word ("Tarver Realty Group" and "Jeffrey Tarver") allows 30 days: invoices get paid late.
  const words = new Set((h.source.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !["group", "network", "player", "deposit"].includes(w)));
  const hit = rows.find((r) => {
    if (taken.has(r) || (r.source !== "stripe" && r.source !== "mercury") || r.kind === "expense") return false;
    if (Math.abs(r.cents - want) > 1 || (r.kind !== h.kind && r.kind !== "unsorted")) return false;
    const days = Math.abs(Date.parse(`${r.date}T12:00:00Z`) - at) / 86_400_000;
    return days <= 5 || (days <= 30 && (r.who.toLowerCase().match(/[a-z]{4,}/g) ?? []).some((w) => words.has(w)));
  });
  if (hit) taken.add(hit);
  return hit;
}

/** YYYY-MM in US Eastern (a payment at 9 pm ET on the 31st belongs to that month). */
export const monthOf = (iso: string) => new Date(Date.parse(iso) - 5 * 3_600_000).toISOString().slice(0, 7);

/** The months a period covers: one month, its quarter, or the year to that month. */
export function periodMonths(kind: "month" | "quarter" | "ytd", month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const first = kind === "month" ? m : kind === "quarter" ? Math.floor((m - 1) / 3) * 3 + 1 : 1;
  const last = kind === "quarter" ? first + 2 : m;
  return Array.from({ length: last - first + 1 }, (_, i) => `${y}-${String(first + i).padStart(2, "0")}`);
}
