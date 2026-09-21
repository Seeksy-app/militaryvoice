import Anthropic from "@anthropic-ai/sdk";
import { storage } from "./storage.js";
import { mileMarkers } from "../shared/mileMarkers.js";

/**
 * Alex in text.
 *
 * In the green room she was a rendered face that took seven seconds to
 * answer "when do I start?" — most of it spent transcribing, writing the whole
 * reply, rendering the whole reply to audio, and lip-syncing it. Typed in,
 * typed out, streamed, the first words land in under a second. The avatar
 * keeps the main stage, where a face is the point; here the point is the
 * answer.
 *
 * Same person as scripts/alex-converse.ts, same sheet. Who she is has to be
 * stated, not left to the model.
 */
const PERSONA = `You are Alex, producer and co-host of The Podcast Marathon — 26.2 miles of
military and veteran podcasts on National Military Podcast Day, 5 October.
You are a woman. Alex is your name, not a nickname for anything else.
You are chatting by text with a podcaster in the green room, the waiting area
before they go on air. Be warm, brisk and brief: one or two sentences, never
three. You are among veterans — no solemnity, no "thank you for your service".
What happens on the day: they wait in the green room, check camera and mic,
and you bring them onto the stage at their time; between shows there are five
minutes for the handover. Do not invent facts about the schedule; if you do
not know something, say so plainly and offer to find out.`;

/** The running order, as one block of text the model can answer from. */
async function sheet(): Promise<{ eventName: string; text: string; at: (i: number) => string }> {
  const ev = await storage.getFeaturedEvent();
  const n = Math.round((ev.durationHours * 60) / ev.slotMinutes);
  const rows = (await storage.listSignups(ev.id)).filter((s) => s.status !== "cancelled").sort((a, b) => a.slotIndex - b.slotIndex);
  const at = (i: number) =>
    new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
      .format(new Date(new Date(ev.startAtUtc).getTime() + i * ev.slotMinutes * 60000));
  const markers = mileMarkers(Array.from({ length: n }, (_, i) => {
    const r = rows.find((x) => x.slotIndex === i);
    return { signup: r ? { podcastName: r.podcastName } : null };
  }));
  const lines = rows.filter((r) => r.slotIndex < n).map((r) => {
    const m = markers[r.slotIndex];
    const where = m?.kind === "mile" ? `Mile ${m.n}` : m?.kind === "extra" ? m.label
      : m?.kind === "flag" ? "the Flag Carry" : m?.kind === "start" ? "the start"
      : m?.kind === "finish" ? "the finish" : m?.kind === "medal" ? "after the finish" : "";
    const who = [r.branch, r.serviceStatus].filter(Boolean).join(" ");
    return `${at(r.slotIndex)} ET · ${where} · ${r.podcastName} — ${r.hostName}${who ? ` (${who})` : ""} · ${r.showFormat === "prerecorded" ? "pre-recorded" : "live"}`;
  });
  return { eventName: ev.name, text: lines.join("\n"), at };
}

export interface AlexTurn { role: "user" | "assistant"; content: string }

/**
 * Stream her answer, a few words at a time.
 *
 * `who` is the address of the person typing; their own booking is looked up
 * so she can answer "when am I on?" without being told the name.
 */
export async function* alexAnswer(turns: AlexTurn[], who: string): AsyncGenerator<string> {
  const s = await sheet();
  const ev = await storage.getFeaturedEvent();
  const mine = (await storage.listSignups(ev.id)).find((x) => x.status !== "cancelled" && x.email.trim().toLowerCase() === who.trim().toLowerCase());
  const speaking = mine
    ? `You are speaking to ${mine.hostName}, who hosts ${mine.podcastName}, on at ${s.at(mine.slotIndex)} ET.`
    : "You do not know who this is; they are signed in as a podcaster.";
  const client = new Anthropic();
  const stream = client.messages.stream({
    // Sonnet: the questions are "when am I on" and "what happens next", and
    // the answer has to start before the person looks away.
    model: "claude-sonnet-5",
    max_tokens: 220,
    system: [
      { type: "text", text: `${PERSONA}\n\nThe running order for ${s.eventName}, all times Eastern:\n${s.text}\n\nThis is the confirmed sheet. Answer from it directly — never say you will go and check.`, cache_control: { type: "ephemeral" } },
      { type: "text", text: speaking },
    ],
    messages: turns.slice(-12).map((t) => ({ role: t.role, content: t.content })) as Anthropic.MessageParam[],
  });
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield ev.delta.text;
  }
}
