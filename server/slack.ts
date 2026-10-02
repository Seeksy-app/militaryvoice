// A post to the team's Slack channel for incoming mail (hello@ and Help-chat
// requests for a person). The channel's incoming-webhook address lives in
// SLACK_INBOX_WEBHOOK_URL; without it, nothing is sent and nothing breaks.
const ORIGIN = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function isSlackInboxConfigured(): boolean {
  return /^https:\/\/hooks\.slack\.com\//.test(process.env.SLACK_INBOX_WEBHOOK_URL ?? "");
}

/** One incoming email, what it's about, and what Alex did with it. Never throws. */
export async function slackInbound(o: {
  inboundId: number;
  fromName: string;
  fromEmail: string;
  subject: string;
  summary: string;
  source: "email" | "help";
  alex: "answered" | "person" | "followup" | "none";
}): Promise<void> {
  const url = process.env.SLACK_INBOX_WEBHOOK_URL ?? "";
  if (!isSlackInboxConfigured()) return;
  const who = o.fromName && o.fromName !== o.fromEmail ? `${o.fromName} <${o.fromEmail}>` : o.fromEmail;
  const alex = {
    answered: ":white_check_mark: Alex answered it. Nothing to do unless they write back.",
    followup: ":speech_balloon: Alex answered their follow-up.",
    person: ":raising_hand: Alex told them a person will follow up. *Needs a reply.*",
    none: ":raising_hand: *Needs a reply.*",
  }[o.alex];
  const link = `${ORIGIN}/admin/crm?with=${encodeURIComponent(o.fromEmail)}&focus=in-${o.inboundId}`;
  const text = `${o.source === "help" ? ":sos: Help chat" : ":incoming_envelope: Email"} from ${who}: ${o.subject}`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `*${esc(text)}*${o.summary ? `\n${esc(o.summary)}` : ""}` } },
          { type: "context", elements: [{ type: "mrkdwn", text: alex }] },
          { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open in Mail" }, url: link }] },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.warn("Slack post failed:", (err as Error).message);
  }
}

/** A short heads-up to the team channel, with an optional button. Never throws. */
export async function slackNote(text: string, button?: { label: string; url: string }): Promise<void> {
  if (!isSlackInboxConfigured()) return;
  try {
    await fetch(process.env.SLACK_INBOX_WEBHOOK_URL ?? "", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: esc(text) } },
          ...(button ? [{ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: button.label }, url: button.url.startsWith("http") ? button.url : `${ORIGIN}${button.url}` }] }] : []),
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.warn("Slack post failed:", (err as Error).message);
  }
}
