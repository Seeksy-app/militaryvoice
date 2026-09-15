import Anthropic from "@anthropic-ai/sdk";
import type { EventRow } from "../shared/schema.js";

// The help chat. A visitor asks; Claude answers from what we actually know
// about the site, and hands off to a person the moment it can't. No third
// party chat product — this is one route and one system prompt.

const HANDOFF = "[[HUMAN]]";

export function isHelpAgentConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Everything the agent is allowed to say comes from here. Mirrors the FAQ page
// and the podcaster guide; if the site changes, change this.
const KNOWLEDGE = `
ABOUT THE SITE
- MilitaryVoice.ai runs the 24 Hour Podcastathon for National Military Podcast Day: twenty-four hours of live and "Best of MilVet" podcasting — back-to-back shows, special guests, stories from the military and veteran community, streaming around the clock. Shows hand off every 30 minutes so someone is always on.
- It is free for podcasters to claim a slot and free for listeners.
- Host: Riccoh Player — 33 years in the Marine Corps, five combat tours, an Emmy. He anchors the day and hands off to each show.
- Every time on the site is shown in the visitor's own time zone; they can switch zones on the agenda.

FOR PODCASTERS
- Who can claim a slot: veteran and military-community podcasters — shows by, for, or about the military community. Solo hosts and two-person shows welcome.
- How to claim: pick an open time on the schedule (/schedule), enter your email, type the 6-digit code we email you, then set your show up once (photo, show name, RSS feed). The slot is confirmed the moment you save.
- No passwords. Sign-in is always a 6-digit emailed code; your email is your account. Codes expire after 15 minutes and an older code stops working once a new one is requested.
- Slots are 30 minutes: 25 on air, 5 for the handoff to the next show. The confirmation email and the agenda card show the exact on-air window.
- One slot per show. To change it: dashboard → Event settings → "Remove this time", then pick another.
- Cancel any time before the event from the dashboard; the slot goes back on the open schedule.
- Pre-recorded episodes are fine: in Event settings choose "Play a recorded episode" and paste a link (unlisted YouTube/Vimeo, Google Drive, Dropbox, WeTransfer — set sharing to anyone with the link). Then choose a short live intro on camera, or straight into the recording.
- Going live: you join from the studio page in your browser about 10 minutes before your slot (a link is emailed before the event). No special software. Podcasters who already run OBS/StreamYard can ask for a stream key instead.
- Materials: upload an intro, outro, mid-roll, images or slides from the dashboard so the production team can plan transitions. Say in Event settings if you'd like an interviewer paired with you.
- RSS feed: optional but recommended — it lets listeners play your episodes from your card and follow you after. Found in your hosting platform's settings (Buzzsprout, Spotify for Creators, Libsyn, Transistor, Podbean...).
- Connected social accounts show on your card with avatar and follower count. Podcasters can also tick ready-made posts in "Your posting plan" and we post them from their own accounts on schedule; nothing is ever posted without them ticking it.
- Share your slot: every podcaster has a share link (militaryvoice.ai/s/<number>) that unfurls with their artwork and time.
- Podcaster guide: /prepare. Dashboard: /host/dashboard.

FOR LISTENERS
- Nothing to claim or install. The agenda (/agenda) shows who's on and when.
- Every show card has "Remind me": name + email (+ optional mobile) and we send a confirmation with Google/Outlook/Apple calendar links.
- Where to watch: the agenda is home base on the day; each card links to the podcaster's channels and stream details are posted there before the event.
- Every card has a Share button.

SPONSORS
- Sponsor logos run in the "Friends of the Podcastathon" strip and get read on air between shows. Use the Sponsors link in the nav to send an inquiry; the team replies by email with packages.

WHAT YOU DON'T KNOW
- Anything about a specific person's booking, payment, or account details; exact production timings beyond the above; anything not listed here.
`;

function systemPrompt(event: EventRow | undefined, taken: number, total: number): string {
  const when = event
    ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(new Date(event.startAtUtc))
    : "October 5, 2026";
  return `You are the help assistant on MilitaryVoice.ai. You answer visitors' questions about the site and the event, briefly and warmly, using ONLY the knowledge below. Plain text, no markdown headings, no bullet lists longer than three items, two to four sentences for most answers. Use "we" for MilitaryVoice.ai.

Live facts right now:
- Event: ${event?.name ?? "24 Hour Podcastathon"}, starting ${when}. ${taken} of ${total} slots are booked.

Rules:
- If the answer is in the knowledge, give it, and when useful name the page to go to (e.g. "the agenda" or "your dashboard").
- If the question is about a specific person's booking, an account problem, money, a complaint, press, partnership, or anything the knowledge doesn't cover — or the visitor asks for a person — say in one sentence that you'll get them to a person, and end your reply with the exact token ${HANDOFF} on its own.
- Never invent facts, dates, prices or policies. Never ask for passwords or codes.

KNOWLEDGE:
${KNOWLEDGE}`;
}

export interface HelpTurn {
  role: "user" | "assistant";
  content: string;
}

export async function answerHelp(
  turns: HelpTurn[],
  ctx: { event?: EventRow; taken: number; total: number },
): Promise<{ text: string; handoff: boolean }> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-5",
    // Help answers are deliberately short; a low cap keeps them that way.
    max_tokens: 600,
    output_config: { effort: "low" },
    system: [{ type: "text", text: systemPrompt(ctx.event, ctx.taken, ctx.total), cache_control: { type: "ephemeral" } }],
    messages: turns.map((t) => ({ role: t.role, content: t.content })) as Anthropic.MessageParam[],
  });
  if (response.stop_reason === "refusal") {
    return { text: "I'd rather get a person to help with that one.", handoff: true };
  }
  let text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  const handoff = text.includes(HANDOFF);
  text = text.replace(HANDOFF, "").trim();
  return { text: text || "Let me get a person to help with that.", handoff };
}
