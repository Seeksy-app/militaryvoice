import Anthropic from "@anthropic-ai/sdk";
import type { ClipRow } from "../shared/schema.js";

/**
 * A YouTube description for a whole episode, drafted from what Pōstify
 * already knows about it: the show, the episode title, and the moments it
 * picked (their titles and what's said in them). The podcaster edits it.
 */
export async function draftYoutubeDescription(v: { show: string; title: string; clips: ClipRow[] }): Promise<string> {
  const fallback = `${v.title}\n\nA new episode of ${v.show}.`;
  if (!process.env.ANTHROPIC_API_KEY || v.clips.length === 0) return fallback;
  try {
    const client = new Anthropic();
    const res = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 600,
      system:
        "You write YouTube descriptions for military and veteran podcasts. Plain, warm, specific; no hype, no emoji, no hashtags, no links. " +
        "Two short paragraphs: what the episode is about and who's on it, then why it's worth the listen. Under 120 words. Return only the description.",
      messages: [{
        role: "user",
        content: `Show: ${v.show}\nEpisode: ${v.title}\n\nMoments from it:\n${v.clips.map((c) => `- ${c.title}: ${c.transcript.slice(0, 600)}`).join("\n")}`,
      }],
    });
    const text = res.content.map((c) => ("text" in c ? c.text : "")).join("").trim();
    return text || fallback;
  } catch (err) {
    console.error("YouTube description draft failed:", (err as Error).message);
    return fallback;
  }
}

const stamp = (sec: number) => {
  const t = Math.max(0, Math.round(sec));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};

/**
 * YouTube chapters from the moments, at their times in this video. YouTube
 * only shows chapters when the list starts at 0:00, has three or more, and
 * each runs at least 10 seconds — so anything that can't meet that is
 * dropped rather than posted broken.
 */
export function chaptersFrom(moments: { title: string; at: number }[], lengthSec: number): string {
  const list: { title: string; at: number }[] = [{ title: "Welcome", at: 0 }];
  for (const m of [...moments].sort((a, b) => a.at - b.at)) {
    if (m.at - list[list.length - 1].at >= 10 && lengthSec - m.at >= 10) list.push({ title: m.title, at: m.at });
  }
  return list.length >= 3 ? list.map((c) => `${stamp(c.at)} ${c.title}`).join("\n") : "";
}
