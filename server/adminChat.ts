// The admin's chat with Alex.
//
// "Send Frank an email saying thanks for your patience" is one line to a
// person and four screens to a form. Alex reads the line, finds Frank on the
// lineup, writes the email in her own voice, and hands back a draft. Nothing
// is sent from here; the admin presses Send on the draft, and that call is
// the one that mails. Alex answers questions about the day the same way, from
// the same facts the help desk and the inbox drafter use.
import Anthropic from "@anthropic-ai/sdk";
import { storage } from "./storage.js";

export interface ChatTurn { role: "user" | "assistant"; content: string }
export interface ChatDraft { to: string; toName: string; subject: string; text: string; from: "alex" | "team" | "riccoh" | "michael" }
export interface ChatReply { reply: string; draft: ChatDraft | null }

const ET = "America/New_York";

async function people(eventId: number): Promise<string> {
  const rows = await storage.listSignups(eventId);
  const ev = await storage.getEventById(eventId);
  const at = (slot: number) => ev ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET }).format(new Date(Date.parse(ev.startAtUtc) + slot * ev.slotMinutes * 60_000)) : "";
  const lineup = rows.filter((s) => s.status !== "cancelled").map((s) => `${s.hostName} · ${s.podcastName.trim()} · ${s.email} · ${at(s.slotIndex)} Eastern`);
  const cancelled = rows.filter((s) => s.status === "cancelled").map((s) => `${s.hostName} · ${s.podcastName.trim()} · ${s.email} · cancelled`);
  const team = (await storage.listEventTeam(eventId)).map((m) => `${m.name} · ${m.title}${m.email ? ` · ${m.email}` : ""}`);
  const recent = (await storage.listInbound(15)).map((m) => `${m.fromName || m.fromEmail} <${m.fromEmail}> wrote "${m.subject}" (${m.status}${m.summary ? `: ${m.summary}` : ""})`);
  return [
    `Lineup (name · show · email · slot):\n${lineup.join("\n")}`,
    cancelled.length ? `Cancelled:\n${cancelled.join("\n")}` : "",
    `Team:\n${team.join("\n")}`,
    recent.length ? `Recent inbound mail:\n${recent.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

export async function adminChat(eventId: number, turns: ChatTurn[]): Promise<ChatReply> {
  const ev = await storage.getEventById(eventId);
  const context = await people(eventId);
  const day = ev ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: ET }).format(new Date(ev.startAtUtc)) : "";
  const system = `You are Alex, the AI producer and help desk for ${ev?.name?.trim() ?? "The Podcast Marathon"} (${day}). You are talking to the organiser in their admin. Be brief and plain; 8th-grade reading level; no corporate phrases.

You can do one thing besides talk: draft an email. When the organiser asks you to email, write to, reply to, or tell someone something, produce a draft. Find the person in the context by first name, full name, show name or email; if two people could match, ask which, and draft nothing. Never invent an address.

The draft's voice:
- "alex" (default): you, the AI help desk — warm, short, signs "Alex". Use for thanks, updates, quick answers, "we'll be in touch".
- "riccoh": Riccoh Player, the host — only if the organiser says it should come from Riccoh.
- "michael": Michael, the producer — only if they say Michael.
- "team": The Podcast Marathon team — only if they say the team.
Say what the organiser asked to say, in that voice; do not pad it. Keep the organiser's meaning exactly. If they gave you the words in quotes, use those words, tidied. The subject is short and specific. Sign off with the name only; the signature block is added later.

Return JSON only:
{"reply":"one or two sentences to the organiser — what you did or what you need","draft":null}
or
{"reply":"...","draft":{"to":"email","toName":"First Last","subject":"...","text":"the email body, plain text, greeting through sign-off","from":"alex|riccoh|michael|team"}}

Context:
${context}`;
  const client = new Anthropic();
  const res = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 900,
    system,
    messages: turns.slice(-12).map((t) => ({ role: t.role, content: t.content })),
  });
  const text = res.content.map((c) => ("text" in c ? c.text : "")).join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    const parsed = JSON.parse(json) as Partial<ChatReply>;
    const d = parsed.draft && typeof parsed.draft === "object" ? parsed.draft : null;
    const from = d && ["alex", "riccoh", "michael", "team"].includes(String(d.from)) ? (d.from as ChatDraft["from"]) : "alex";
    return {
      reply: String(parsed.reply ?? "").trim() || (d ? "Here's the draft." : "Sorry — say that again?"),
      draft: d && d.to && String(d.to).includes("@") ? { to: String(d.to).trim().toLowerCase(), toName: String(d.toName ?? ""), subject: String(d.subject ?? "").slice(0, 200), text: String(d.text ?? "").trim(), from } : null,
    };
  } catch {
    return { reply: text.trim() || "Sorry — say that again?", draft: null };
  }
}
