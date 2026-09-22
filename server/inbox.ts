// A draft reply for mail that came in to hello@.
//
// A podcaster who writes back gets an answer from a person; this writes the
// first version so the person edits and presses send rather than starting
// from a blank page. It knows who wrote in, what they were sent, where they
// are on the day, and which half-hours are open — and it never confirms a
// change it cannot make. Two voices: Riccoh, host to host, for anything about
// a slot, a swap, co-hosting or a favour; the team for logistics, files,
// links and technical questions.
import Anthropic from "@anthropic-ai/sdk";
import { storage } from "./storage.js";
import type { InboundEmailRow } from "../shared/schema.js";

export interface InboundDraft {
  category: "scheduling" | "materials" | "question" | "cancel" | "thanks" | "other";
  summary: string;
  from: "riccoh" | "team";
  subject: string;
  reply: string;
  /** One to three sentences answering what they asked, for the automatic
   *  acknowledgement — or empty when nothing in the context answers it. */
  ack: string;
}

const ET = "America/New_York";

function at(startAtUtc: string, slotMinutes: number, slot: number): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET })
    .format(new Date(Date.parse(startAtUtc) + slot * slotMinutes * 60_000));
}

/** Everything the drafter is allowed to know, as plain lines. */
export async function inboundContext(m: InboundEmailRow): Promise<string> {
  const ev = await storage.getFeaturedEvent();
  const lines: string[] = [];
  const day = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: ET }).format(new Date(ev.startAtUtc));
  lines.push(`Event: ${ev.name}. Day: ${day}. First show ${at(ev.startAtUtc, ev.slotMinutes, 0)} Eastern. Slots are ${ev.slotMinutes} minutes.`);
  const all = await storage.listSignups(ev.id);
  const total = Math.floor((ev.durationHours * 60) / ev.slotMinutes);
  const taken = new Set(all.filter((s) => s.status !== "cancelled").map((s) => s.slotIndex));
  const open = Array.from({ length: total }, (_, i) => i).filter((i) => !taken.has(i)).map((i) => at(ev.startAtUtc, ev.slotMinutes, i));
  lines.push(open.length ? `Open half-hours on the day (Eastern): ${open.join(", ")}.` : "No half-hours are open on the day.");
  const mine = all.filter((s) => s.email.trim().toLowerCase() === m.fromEmail.trim().toLowerCase()).sort((a, b) => b.id - a.id);
  if (mine.length) {
    const s = mine[0];
    lines.push(`Sender is on the lineup: ${s.hostName}, "${s.podcastName}", slot ${at(ev.startAtUtc, ev.slotMinutes, s.slotIndex)} Eastern, status ${s.status}.`);
  } else {
    lines.push("Sender has no booking on the lineup.");
  }
  const hist = await storage.getContactHistory(m.fromEmail);
  const sent = await storage.listSentBroadcasts();
  const subjects = hist.sends.map((x) => sent.find((b) => b.id === x.broadcastId)?.subject).filter(Boolean) as string[];
  if (subjects.length) lines.push(`Emails we sent them, latest last: ${subjects.slice(-5).join(" | ")}.`);
  if (m.broadcastId) {
    const b = sent.find((x) => x.id === m.broadcastId);
    if (b) lines.push(`They are replying to our email "${b.subject}", which said: ${b.bodyText.slice(0, 700)}`);
  }
  return lines.join("\n");
}

export async function draftReply(m: InboundEmailRow): Promise<InboundDraft> {
  const context = await inboundContext(m);
  const client = new Anthropic();
  const system = `You draft replies for The Podcast Marathon, a one-day livestream of military and veteran podcasts. A person will read, edit and send your draft; it is not sent automatically.

Voices:
- "riccoh": Riccoh Player, USMC retired, the host of the day. Host to host. Use for anything about a slot, a time change, a swap, co-hosting, an interview, a favour, a complaint, or anything personal. Warm, direct, short sentences. Signs "Riccoh".
- "team": The Podcast Marathon team. Use for files, links, uploads, technical setup, YouTube, promo materials, receipts and logistics. Plain and helpful. Signs "The Podcast Marathon team".

Rules:
- 8th-grade reading level. Short. No corporate phrases. Never say "MilitaryVoice.ai" as the sender name; the event is "The Podcast Marathon".
- Use only the facts in the context. Never invent times, links, names or promises.
- Never say a change is done. Say what will happen and who will confirm ("I'll move you and confirm by tomorrow").
- If they ask to cancel, acknowledge it kindly, do not argue, and say a person will confirm.
- If they ask a question you cannot answer from the context, say a person will get back to them today.
- Give times in Eastern and, when the sender's signature shows another zone, in theirs too.
- Address them by first name if known. End with the signature line only.

Also write "ack": one to three plain sentences, team voice, no greeting and no sign-off, that answer what they asked using only the context — the part of an automatic acknowledgement that goes out the moment their mail arrives. If the context does not answer it, or they asked to cancel or change a slot, make "ack" an empty string so the acknowledgement only promises a person.

Return JSON only: {"category":"scheduling|materials|question|cancel|thanks|other","summary":"one line on what they want","from":"riccoh|team","subject":"Re: ...","reply":"the email body, plain text","ack":"..."}`;
  const user = `Context:\n${context}\n\nInbound email\nFrom: ${m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail}\nSubject: ${m.subject}\n\n${m.bodyText.slice(0, 6000)}`;
  const res = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 900,
    system,
    messages: [{ role: "user", content: user }],
  });
  const text = res.content.map((c) => ("text" in c ? c.text : "")).join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json) as Partial<InboundDraft>;
  const cats = ["scheduling", "materials", "question", "cancel", "thanks", "other"] as const;
  return {
    category: (cats as readonly string[]).includes(parsed.category ?? "") ? (parsed.category as InboundDraft["category"]) : "other",
    summary: String(parsed.summary ?? "").slice(0, 300),
    from: parsed.from === "riccoh" ? "riccoh" : "team",
    subject: String(parsed.subject ?? (m.subject.startsWith("Re:") ? m.subject : `Re: ${m.subject}`)).slice(0, 200),
    reply: String(parsed.reply ?? "").trim(),
    ack: String(parsed.ack ?? "").trim().slice(0, 600),
  };
}

/** Podcasters and sponsors: anyone we already hold a record for. */
export async function isKnownSender(email: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  if (!e.includes("@")) return false;
  const ev = await storage.getFeaturedEvent();
  if ((await storage.listSignups(ev.id)).some((s) => s.email.trim().toLowerCase() === e)) return true;
  if (await storage.getProfileByEmail(e)) return true;
  if ((await storage.listSponsorInquiries()).some((s) => s.email.trim().toLowerCase() === e)) return true;
  if ((await storage.listContacts()).some((c) => c.email.trim().toLowerCase() === e)) return true;
  return false;
}

/** Mail that should never get an automatic answer: another machine's. */
export function looksAutomatic(m: { subject: string; fromEmail: string; bodyText: string }): boolean {
  const subj = m.subject.toLowerCase();
  const from = m.fromEmail.toLowerCase();
  if (/^(auto(matic)?[\s-]*reply|out of office|automatic reply|delivery status|undeliverable|mail delivery)/i.test(subj)) return true;
  if (/(no-?reply|mailer-daemon|postmaster|bounce|notification)@/.test(from)) return true;
  if (/@(militaryvoice\.(ai|io)|resend\.dev)$/.test(from)) return true;
  return false;
}

/**
 * The acknowledgement itself. The frame is fixed — thanks, the answer when
 * we have one, and a person if that did not cover it — so a podcaster always
 * knows what happens next.
 */
export function composeAck(m: InboundEmailRow, ack: string): { subject: string; text: string } {
  const first = (m.fromName || "").trim().split(/\s+/)[0] || "";
  const subject = m.subject.trim() ? (/^re:/i.test(m.subject) ? m.subject.trim() : `Re: ${m.subject.trim()}`) : "Re: your email to The Podcast Marathon";
  const answer = ack.trim() ? `\n\n${ack.trim()}` : "";
  const text = `${first ? `Hi ${first},` : "Hi,"}

Thank you for sending this email.${answer}

If this doesn't answer your question, please reply to this email. We'll get a human on it, and someone will reach out to you shortly.

The Podcast Marathon team`;
  return { subject, text };
}

/** The campaign a reply answers, read off its subject line. */
export async function matchBroadcast(subject: string): Promise<number | null> {
  const clean = subject.replace(/^\s*((re|fwd?|aw)\s*:\s*)+/i, "").trim().toLowerCase();
  if (!clean) return null;
  const sent = await storage.listSentBroadcasts();
  const hit = sent
    .filter((b) => b.subject.trim().toLowerCase() === clean)
    .sort((a, b) => Date.parse(b.sentAt ?? b.createdAt) - Date.parse(a.sentAt ?? a.createdAt))[0];
  return hit?.id ?? null;
}
