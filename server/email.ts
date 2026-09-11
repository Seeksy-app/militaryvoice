// Confirmation emails via Resend. Works two ways:
//  - Vercel/production: set RESEND_API_KEY to a real Resend API key. Requests hit
//    api.resend.com directly with the standard `Authorization: Bearer` header.
//  - Our own sandbox preview: publish_website injects CUSTOM_CRED_API_RESEND_COM_URL /
//    CUSTOM_CRED_API_RESEND_COM_TOKEN, and requests go through that proxy with the
//    token sent as x-api-key instead of hitting api.resend.com directly.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_BASE = process.env.CUSTOM_CRED_API_RESEND_COM_URL || "https://api.resend.com";
const RESEND_PROXY_TOKEN = process.env.CUSTOM_CRED_API_RESEND_COM_TOKEN;

const FROM_ADDRESS = "MilitaryVoice.ai <hello@militaryvoice.ai>";

export interface CalendarLinks {
  google: string;
  outlook: string;
  ics: string;
}

function toGoogleStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

/** Add-to-calendar links that work without any app install: Google and
 *  Outlook.com open in the browser; the .ics covers Apple Calendar, Outlook
 *  desktop, and everything else. */
export function buildCalendarLinks(input: { title: string; details: string; start: Date; end: Date; icsUrl: string; location?: string }): CalendarLinks {
  const g = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates: `${toGoogleStamp(input.start)}/${toGoogleStamp(input.end)}`,
    details: input.details,
    ...(input.location ? { location: input.location } : {}),
  });
  const o = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: input.title,
    startdt: input.start.toISOString(),
    enddt: input.end.toISOString(),
    body: input.details,
    ...(input.location ? { location: input.location } : {}),
  });
  return {
    google: `https://calendar.google.com/calendar/render?${g.toString()}`,
    outlook: `https://outlook.live.com/calendar/0/deeplink/compose?${o.toString()}`,
    ics: input.icsUrl,
  };
}

function calendarButtonsHtml(c: CalendarLinks): string {
  const btn = (href: string, label: string) =>
    `<a href="${href}" style="display:inline-block;margin:0 8px 8px 0;background:#ffffff;color:#053877;border:1px solid #cbd5e1;text-decoration:none;font-size:13px;font-weight:600;padding:8px 14px;border-radius:9999px;">${label}</a>`;
  return `
    <p style="margin:20px 0 8px;color:#053877;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Add to your calendar</p>
    <div>${btn(c.google, "Google Calendar")}${btn(c.outlook, "Outlook")}${btn(c.ics, "Apple / .ics file")}</div>`;
}

function calendarText(c: CalendarLinks): string {
  return `Add to your calendar:\n  Google: ${c.google}\n  Outlook: ${c.outlook}\n  Apple/.ics: ${c.ics}\n`;
}

export interface ConfirmationEmailInput {
  to: string;
  calendar?: CalendarLinks;
  hostName: string;
  podcastName: string;
  eventName: string;
  blockStartLabel: string; // e.g. "Sat, Sep 12, 4:00 PM"
  blockEndLabel: string;
  onAirStartLabel: string;
  onAirEndLabel: string;
  bufferMinutes: number;
  bufferPosition: "before" | "after";
  timezoneLabel: string;
  agendaUrl: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildHtml(rawInput: ConfirmationEmailInput): string {
  const input: ConfirmationEmailInput = {
    ...rawInput,
    hostName: escapeHtml(rawInput.hostName),
    podcastName: escapeHtml(rawInput.podcastName),
    eventName: escapeHtml(rawInput.eventName),
  };
  const bufferLine =
    input.bufferMinutes > 0
      ? `<p style="margin:0 0 16px;color:#4b5563;font-size:14px;line-height:1.6;">Your booked block runs <strong>${input.blockStartLabel} – ${input.blockEndLabel}</strong> (${input.timezoneLabel}), which includes a ${input.bufferMinutes}-minute buffer ${input.bufferPosition} your segment for a sponsor read and transition to the next show.</p>`
      : "";
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
    <p style="margin:0 0 4px;color:#053877;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${input.eventName}</p>
    <h1 style="margin:0 0 20px;color:#111827;font-size:22px;font-weight:700;">You're on the schedule, ${input.hostName}</h1>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      <strong>${input.podcastName}</strong> is confirmed for the marathon. Here's your time:
    </p>
    <div style="background:#fff7e6;border:1px solid #f0a71f;border-radius:12px;padding:16px 20px;margin:0 0 16px;">
      <p style="margin:0 0 4px;color:#053877;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">You're on air</p>
      <p style="margin:0;color:#1f2937;font-size:18px;font-weight:700;">${input.onAirStartLabel} – ${input.onAirEndLabel}</p>
      <p style="margin:4px 0 0;color:#6b7280;font-size:13px;">${input.timezoneLabel}</p>
    </div>
    ${bufferLine}
    <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">
      No login needed — just be ready to go live at your on-air start time. You can view or share the full agenda anytime.
    </p>
    <a href="${input.agendaUrl}" style="display:inline-block;background:#053877;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:9999px;">View the agenda</a>
    ${input.calendar ? calendarButtonsHtml(input.calendar) : ""}
    <p style="margin:28px 0 0;color:#9ca3af;font-size:12px;">Questions? Just reply to this email.</p>
  </div>`;
}

function buildText(input: ConfirmationEmailInput): string {
  const bufferLine =
    input.bufferMinutes > 0
      ? `Your booked block runs ${input.blockStartLabel} - ${input.blockEndLabel} (${input.timezoneLabel}), including a ${input.bufferMinutes}-minute buffer ${input.bufferPosition} your segment for a sponsor read and transition.\n\n`
      : "";
  return `You're on the schedule, ${input.hostName}\n\n${input.podcastName} is confirmed for ${input.eventName}.\n\nYou're on air: ${input.onAirStartLabel} - ${input.onAirEndLabel} (${input.timezoneLabel})\n\n${bufferLine}No login needed - just be ready to go live at your on-air start time.\n\nView the agenda: ${input.agendaUrl}\n${input.calendar ? "\n" + calendarText(input.calendar) : ""}`;
}

/** Low-level Resend sender shared by every email type. Never throws — logs and
 *  returns false on failure so a flaky email provider never blocks a user flow. */
async function sendRawEmail(opts: { to: string; subject: string; html: string; text: string }): Promise<boolean> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (RESEND_API_KEY) {
      headers["Authorization"] = `Bearer ${RESEND_API_KEY}`;
    } else if (RESEND_PROXY_TOKEN) {
      headers["x-api-key"] = RESEND_PROXY_TOKEN;
    }
    const res = await fetch(`${RESEND_BASE}/emails`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`Resend email failed (${res.status}):`, body);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Failed to send email:", err);
    return false;
  }
}

/** Send the on-air confirmation email. Never throws. */
export async function sendConfirmationEmail(input: ConfirmationEmailInput): Promise<boolean> {
  return sendRawEmail({
    to: input.to,
    subject: `You're on the schedule: ${input.podcastName} at ${input.onAirStartLabel}`,
    html: buildHtml(input),
    text: buildText(input),
  });
}

export interface LoginCodeEmailInput {
  to: string;
  code: string;
}

/** Send a podcaster their one-time typed sign-in code. Never throws. */
export async function sendLoginCodeEmail(input: LoginCodeEmailInput): Promise<boolean> {
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
    <p style="margin:0 0 4px;color:#053877;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">MilitaryVoice.ai</p>
    <h1 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">Your sign-in code</h1>
    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">Enter this code on the sign-in page. It expires in 15 minutes.</p>
    <div style="background:#fff7e6;border:1px solid #f0a71f;border-radius:12px;padding:16px 20px;margin:0 0 24px;text-align:center;">
      <p style="margin:0;color:#053877;font-size:28px;font-weight:800;letter-spacing:0.2em;font-family:monospace;">${escapeHtml(input.code)}</p>
    </div>
    <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">If you didn't request this, you can ignore this email.</p>
  </div>`;
  const text = `Your MilitaryVoice.ai sign-in code: ${input.code}\n\nThis code expires in 15 minutes. If you didn't request this, you can ignore this email.\n`;
  return sendRawEmail({
    to: input.to,
    subject: `Your sign-in code: ${input.code}`,
    html,
    text,
  });
}

// ---------------------------------------------------------------------------
// Listener reminder: "you're set" + when it's on + add-to-calendar links.
// ---------------------------------------------------------------------------
export interface ReminderEmailInput {
  to: string;
  name: string;
  podcastName: string;
  hostName: string;
  eventName: string;
  whenLabel: string; // e.g. "Mon, Oct 5, 7:30 AM"
  timezoneLabel: string;
  agendaUrl: string;
  calendar: CalendarLinks;
  wantsText: boolean;
}

export async function sendReminderConfirmationEmail(raw: ReminderEmailInput): Promise<boolean> {
  const i = {
    ...raw,
    name: escapeHtml(raw.name),
    podcastName: escapeHtml(raw.podcastName),
    hostName: escapeHtml(raw.hostName),
    eventName: escapeHtml(raw.eventName),
  };
  const first = i.name.split(" ")[0] || "there";
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
    <p style="margin:0 0 4px;color:#053877;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${i.eventName}</p>
    <h1 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;">You're set, ${first}.</h1>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      We'll email you before <strong>${i.podcastName}</strong> with ${i.hostName} goes live${i.wantsText ? ", and text you too" : ""}.
    </p>
    <div style="background:#fff7e6;border:1px solid #f0a71f;border-radius:12px;padding:16px 20px;margin:0 0 8px;">
      <p style="margin:0 0 4px;color:#053877;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">On air</p>
      <p style="margin:0;color:#1f2937;font-size:18px;font-weight:700;">${i.whenLabel}</p>
      <p style="margin:4px 0 0;color:#6b7280;font-size:13px;">${i.timezoneLabel}</p>
    </div>
    ${calendarButtonsHtml(i.calendar)}
    <p style="margin:20px 0 0;color:#374151;font-size:15px;line-height:1.6;">See the whole lineup and who else is on:</p>
    <a href="${i.agendaUrl}" style="display:inline-block;margin-top:8px;background:#053877;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:9999px;">View the agenda</a>
    <p style="margin:28px 0 0;color:#9ca3af;font-size:12px;">Didn't ask for this? Ignore it and we won't email you again.</p>
  </div>`;
  const text = `You're set, ${raw.name}.\n\nWe'll email you before ${raw.podcastName} with ${raw.hostName} goes live${raw.wantsText ? ", and text you too" : ""}.\n\nOn air: ${raw.whenLabel} (${raw.timezoneLabel})\n\n${calendarText(raw.calendar)}\nView the agenda: ${raw.agendaUrl}\n`;
  return sendRawEmail({ to: raw.to, subject: `Reminder set: ${raw.podcastName} · ${raw.whenLabel}`, html, text });
}
