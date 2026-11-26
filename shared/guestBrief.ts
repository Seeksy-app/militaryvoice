// The guest brief's shared pieces (26 Nov 2026): who can be looked up, and the card's shape.
const GENERIC = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|zoho|comcast|verizon|att|sbcglobal|cox|charter|earthlink|usaa|yandex)\./i;
/** Their organisation's domain from a work email; '' for Gmail and the like (and .mil, which says nothing public). */
export const workDomain = (email: string) => {
  const d = (email.split("@")[1] ?? "").toLowerCase().trim();
  return d && d.includes(".") && !GENERIC.test(d) && !/\.mil$/.test(d) ? d : "";
};
export const isLinkedIn = (u: string) => /linkedin\.com\/(in|pub)\/[^/?#\s]+/i.test(u);
/** Enough to find the right person: a first and last name, and a LinkedIn link or a work email. */
export const canLookUp = (name: string, email: string, linkedin: string) => name.trim().length >= 3 && /\s/.test(name.trim()) && (!!workDomain(email) || isLinkedIn(linkedin));

export type Brief = {
  confidence: "high" | "medium" | "low";
  summary: string; role: string; service: string; serviceWhere: string; website: string;
  sources: { n: number; url: string; title: string }[];
  podcasts: { show: string; episode: string; date: string; url: string }[];
  socials: { platform: string; handle: string; url: string; followers: number | null; likely: boolean }[];
  linkedin: string;
  questions: string[];
};
export type BriefView = { id: number; status: "running" | "done" | "failed"; guestName: string; result: Brief | null; notes: string; error: string; cached?: boolean };
