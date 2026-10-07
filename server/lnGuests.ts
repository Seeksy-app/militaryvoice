// Hosts & guests on Listen Notes (7 Oct 2026), while Podchaser refuses our key.
//
// Listen Notes has shows and episodes but no people, so the people come from
// the episodes: search episodes for the topic or the name, then read who was
// interviewed in each from its title and notes. Each person found carries the
// episodes they were on as proof; opening one searches their name.
import Anthropic from "@anthropic-ai/sdk";
import type { LnEpisode } from "./listenNotes.js";

/** "ln:" + their name, so the person route knows to ask Listen Notes and who for. */
export const lnPersonId = (name: string) => `ln:${Buffer.from(name.trim(), "utf8").toString("base64url")}`;
export function lnPersonName(id: string): string | null {
  const m = /^ln:([A-Za-z0-9_-]{2,200})$/.exec(id);
  if (!m) return null;
  const name = Buffer.from(m[1], "base64url").toString("utf8").replace(/\s+/g, " ").trim();
  return name.length >= 3 && name.length <= 80 ? name : null;
}

export type Guest = { name: string; about: string; episodes: number[] };

/**
 * Who was interviewed in these episodes: named guests only, never the host,
 * with what the text says they do. Nothing invented; an episode with no named
 * guest gives no one.
 */
export async function guestsIn(eps: LnEpisode[], focus = ""): Promise<Guest[]> {
  if (!eps.length || !process.env.ANTHROPIC_API_KEY) return [];
  const listing = eps.map((e, i) => `[${i}] Show: ${e.show.title}${e.show.host ? ` (host/publisher: ${e.show.host})` : ""}\nTitle: ${e.title}\nNotes: ${e.about.slice(0, 600)}`).join("\n\n");
  try {
    const out = await new Anthropic().messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1500,
      system: `You read podcast episode titles and notes and list the guests: the people interviewed on each episode. Rules: only people named in the text; never the show's host or publisher; never people merely mentioned or discussed (an author of a book being reviewed, a historical figure) unless they are on the episode; no companies. "about" is one short line from the text on who they are (their role, rank, title, book or what they're known for), or "" if the text doesn't say. Merge the same person across episodes. Return JSON only: {"guests":[{"name":"...","about":"...","episodes":[0,3]}]}`,
      messages: [{ role: "user", content: `${focus ? `The search was: ${focus}\n\n` : ""}${listing}` }],
    });
    const text = out.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
    const m = text.match(/\{[\s\S]*\}/);
    const j = m ? (JSON.parse(m[0]) as { guests?: { name?: unknown; about?: unknown; episodes?: unknown }[] }) : {};
    const seen = new Map<string, Guest>();
    for (const g of j.guests ?? []) {
      const name = String(g.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (name.split(" ").length < 2 || name.length < 4) continue; // a full name, not "Mike"
      const idx = (Array.isArray(g.episodes) ? g.episodes : []).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < eps.length);
      if (!idx.length) continue;
      const k = name.toLowerCase();
      const had = seen.get(k);
      if (had) had.episodes = Array.from(new Set([...had.episodes, ...idx]));
      else seen.set(k, { name, about: String(g.about ?? "").replace(/\s+/g, " ").trim().slice(0, 160), episodes: idx });
    }
    return Array.from(seen.values());
  } catch (err) {
    console.warn("Guest read failed:", (err as Error).message);
    return [];
  }
}
