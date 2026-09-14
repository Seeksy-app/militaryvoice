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
  // Google's `dates` param is documented with a literal slash between the two
  // stamps. URLSearchParams would percent-encode it; build this one by hand so
  // the URL matches the documented form exactly.
  const g = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    details: input.details,
    ...(input.location ? { location: input.location } : {}),
  });
  const googleDates = `${toGoogleStamp(input.start)}/${toGoogleStamp(input.end)}`;
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
    google: `https://calendar.google.com/calendar/render?${g.toString()}&dates=${googleDates}`,
    outlook: `https://outlook.live.com/calendar/0/deeplink/compose?${o.toString()}`,
    ics: input.icsUrl,
  };
}

function calendarButtonsHtml(c: CalendarLinks): string {
  const btn = (href: string, label: string) =>
    `<a href="${href}" style="display:inline-block;margin:0 8px 8px 0;background:#ffffff;color:#053877;border:1px solid #cbd5e1;text-decoration:none;font-size:13px;font-weight:600;padding:8px 14px;border-radius:9999px;">${label}</a>`;
  return `
    <p style="margin:20px 0 8px;color:#053877;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Add to your calendar</p>
    <div>${btn(c.google, "Google Calendar")}&nbsp;&nbsp;${btn(c.outlook, "Outlook")}&nbsp;&nbsp;${btn(c.ics, "Apple / .ics file")}</div>`;
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
  onAirStartLabel: string;
  onAirEndLabel: string;
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
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
    <p style="margin:0 0 4px;color:#053877;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${input.eventName}</p>
    <h1 style="margin:0 0 20px;color:#111827;font-size:22px;font-weight:700;">You're on the schedule, ${input.hostName}</h1>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      <strong>${input.podcastName}</strong> is confirmed for the marathon. Here's your time:
    </p>
    <div style="background:#fff7e6;border:1px solid #f0a71f;border-radius:12px;padding:16px 20px;margin:0 0 16px;">
      <p style="margin:0 0 4px;color:#053877;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">You're on air</p>
      <p style="margin:0;color:#1f2937;font-size:18px;font-weight:700;">${input.onAirStartLabel} – ${input.onAirEndLabel} (${input.timezoneLabel})</p>
    </div>
    <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">
      We'll email you the studio details and how to log in ahead of the event. Please be ready and online
      <strong>10 minutes before</strong> your go-live time.
    </p>
    <a href="${input.agendaUrl}" style="display:inline-block;background:#053877;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:9999px;">View the agenda</a>
    ${input.calendar ? calendarButtonsHtml(input.calendar) : ""}
    <p style="margin:28px 0 0;color:#9ca3af;font-size:12px;">Questions? Just reply to this email.</p>
  </div>`;
}

function buildText(input: ConfirmationEmailInput): string {
  return `You're on the schedule, ${input.hostName}\n\n${input.podcastName} is confirmed for ${input.eventName}.\n\nYou're on air: ${input.onAirStartLabel} - ${input.onAirEndLabel} (${input.timezoneLabel})\n\nWe'll email you the studio details and how to log in ahead of the event. Please be ready and online 10 minutes before your go-live time.\n\nView the agenda: ${input.agendaUrl}\n${input.calendar ? "\n" + calendarText(input.calendar) : ""}`;
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

/** Tell the admin team a sponsor asked to get involved. Never throws. */
export async function sendSponsorInquiryEmail(input: {
  to: string[];
  name: string;
  company: string;
  email: string;
  phone: string;
  message: string;
}): Promise<boolean> {
  const row = (label: string, value: string) =>
    value ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px;">${escapeHtml(label)}</td><td style="padding:4px 0;color:#111827;font-size:14px;">${escapeHtml(value)}</td></tr>` : "";
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
    <p style="margin:0 0 4px;color:#053877;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">MilitaryVoice.ai</p>
    <h1 style="margin:0 0 16px;color:#111827;font-size:20px;font-weight:700;">New sponsor inquiry</h1>
    <table style="border-collapse:collapse;">
      ${row("Name", input.name)}${row("Company", input.company)}${row("Email", input.email)}${row("Phone", input.phone)}
    </table>
    ${input.message ? `<p style="margin:16px 0 0;padding:12px 16px;background:#f3f4f6;border-radius:10px;color:#374151;font-size:14px;line-height:1.6;">${escapeHtml(input.message)}</p>` : ""}
    <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">Reply straight to ${escapeHtml(input.email)} to pick it up.</p>
  </div>`;
  const text = `New sponsor inquiry\n\nName: ${input.name}\nCompany: ${input.company}\nEmail: ${input.email}\nPhone: ${input.phone}\n\n${input.message}\n`;
  const results = await Promise.all(
    input.to.map((to) => sendRawEmail({ to, subject: `Sponsor inquiry: ${input.company || input.name}`, html, text })),
  );
  return results.some(Boolean);
}

export interface PlatformInterestInput {
  intent: "register" | "beta";
  name: string;
  email: string;
  organization: string;
  eventTiming: string;
  notes: string;
}

/** Internal heads-up when someone asks about the platform. Never throws. */
export async function sendPlatformInterestEmail(v: PlatformInterestInput): Promise<boolean> {
  const heading = v.intent === "register" ? "Event registration" : "Beta list sign-up";
  const rows: [string, string][] = [
    ["Name", v.name],
    ["Email", v.email],
    ["Organization", v.organization || "—"],
    ["Next event", v.eventTiming || "—"],
    ["Notes", v.notes || "—"],
  ];
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
    <p style="margin:0 0 4px;color:#053877;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">MilitaryVoice.ai platform</p>
    <h1 style="margin:0 0 20px;color:#111827;font-size:20px;font-weight:700;">${escapeHtml(heading)}</h1>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${rows
        .map(
          ([k, val]) =>
            `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;vertical-align:top;white-space:nowrap;">${k}</td><td style="padding:6px 0;color:#1f2937;">${escapeHtml(val)}</td></tr>`,
        )
        .join("")}
    </table>
  </div>`;
  const text = `${heading}\n\n` + rows.map(([k, val]) => `${k}: ${val}`).join("\n") + "\n";
  return sendRawEmail({ to: "hello@militaryvoice.ai", subject: `${heading}: ${v.name}`, html, text });
}

// ---------------------------------------------------------------------------
// Show-day nudges. Three, sent once each by the scheduled sender. Every one
// has to earn its place in an inbox, so each names what this particular
// podcaster still hasn't done rather than repeating the same reminder.
// ---------------------------------------------------------------------------

export interface NudgeInput {
  to: string;
  hostName: string;
  podcastName: string;
  eventName: string;
  onAirLabel: string;
  dashboardUrl: string;
  studioUrl: string;
  shareUrl: string;
  /** What's still missing, in plain words. Empty when they're all set. */
  outstanding: string[];
}

function nudgeShell(opts: { eyebrow: string; heading: string; body: string; cta?: { href: string; label: string } }): string {
  const cta = opts.cta
    ? `<p style="margin:0 0 8px;"><a href="${opts.cta.href}" style="display:inline-block;background:#F0A71F;color:#1a1200;text-decoration:none;font-size:15px;font-weight:700;padding:12px 22px;border-radius:9999px;">${opts.cta.label}</a></p>`
    : "";
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
    <p style="margin:0 0 4px;color:#053877;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(opts.eyebrow)}</p>
    <h1 style="margin:0 0 18px;color:#111827;font-size:22px;font-weight:700;">${escapeHtml(opts.heading)}</h1>
    ${opts.body}
    ${cta}
    <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;line-height:1.6;">
      You're getting this because you hold a slot on MilitaryVoice.ai. Reply to this email and a human will read it.
    </p>
  </div>`;
}

function outstandingHtml(items: string[]): string {
  if (items.length === 0) {
    return `<p style="margin:0 0 20px;color:#166534;font-size:15px;line-height:1.6;">Everything we need is in. Nothing for you to do.</p>`;
  }
  const lis = items.map((i) => `<li style="margin:0 0 6px;">${escapeHtml(i)}</li>`).join("");
  return `<p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">Still outstanding:</p>
    <ul style="margin:0 0 20px;padding-left:20px;color:#374151;font-size:15px;line-height:1.6;">${lis}</ul>`;
}

/** Two weeks out: time to send us things. */
export async function sendPrepNudge(v: NudgeInput): Promise<boolean> {
  const html = nudgeShell({
    eyebrow: v.eventName,
    heading: `Your slot is coming up, ${v.hostName}`,
    body: `<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
        <strong>${escapeHtml(v.podcastName)}</strong> is on air <strong>${escapeHtml(v.onAirLabel)}</strong>.
        Now's a good time to get your side ready.
      </p>
      ${outstandingHtml(v.outstanding)}
      <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
        Your share link — it shows your artwork and your time wherever you post it:<br />
        <a href="${v.shareUrl}" style="color:#053877;">${escapeHtml(v.shareUrl)}</a>
      </p>`,
    cta: { href: v.dashboardUrl, label: "Open your dashboard" },
  });
  return sendRawEmail({
    to: v.to,
    subject: `${v.podcastName}: your slot is ${v.onAirLabel}`,
    html,
    text: `${v.podcastName} is on air ${v.onAirLabel}.\n\n${
      v.outstanding.length ? `Still outstanding:\n- ${v.outstanding.join("\n- ")}\n\n` : "Everything we need is in.\n\n"
    }Share link: ${v.shareUrl}\nYour dashboard: ${v.dashboardUrl}`,
  });
}

/** Two days out: the practical details. */
export async function sendFinalNudge(v: NudgeInput): Promise<boolean> {
  const html = nudgeShell({
    eyebrow: v.eventName,
    heading: `You're on in two days`,
    body: `<div style="background:#fff7e6;border:1px solid #f0a71f;border-radius:12px;padding:16px 20px;margin:0 0 16px;">
        <p style="margin:0 0 4px;color:#053877;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">You're on air</p>
        <p style="margin:0;color:#1f2937;font-size:18px;font-weight:700;">${escapeHtml(v.onAirLabel)}</p>
      </div>
      <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
        Join the green room <strong>ten minutes before</strong> and we'll check your camera and sound. The producer
        brings you on when it's your turn.
      </p>
      ${outstandingHtml(v.outstanding)}`,
    cta: { href: v.studioUrl, label: "Your studio link" },
  });
  return sendRawEmail({
    to: v.to,
    subject: `Two days: ${v.podcastName} at ${v.onAirLabel}`,
    html,
    text: `You're on air ${v.onAirLabel}.\n\nJoin the green room ten minutes before: ${v.studioUrl}\n\n${
      v.outstanding.length ? `Still outstanding:\n- ${v.outstanding.join("\n- ")}\n` : ""
    }`,
  });
}

/** An hour out: one link, nothing else. */
export async function sendOnAirNudge(v: NudgeInput): Promise<boolean> {
  const html = nudgeShell({
    eyebrow: v.eventName,
    heading: `You're on in about an hour`,
    body: `<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
        <strong>${escapeHtml(v.podcastName)}</strong> is on air at <strong>${escapeHtml(v.onAirLabel)}</strong>.
        Join the green room now — we'll check your camera and sound before you go on.
      </p>`,
    cta: { href: v.studioUrl, label: "Join the green room" },
  });
  return sendRawEmail({
    to: v.to,
    subject: `You're on soon: ${v.podcastName} at ${v.onAirLabel}`,
    html,
    text: `${v.podcastName} is on air at ${v.onAirLabel}.\n\nJoin the green room: ${v.studioUrl}`,
  });
}

// ---------------------------------------------------------------------------
// Organiser notification. Sent when a slot is claimed, so nobody has to watch
// the dashboard to know the lineup moved.
// ---------------------------------------------------------------------------

export interface BookingAlertInput {
  to: string;
  podcastName: string;
  hostName: string;
  podcasterEmail: string;
  eventName: string;
  onAirLabel: string;
  format: string;
  needsInterviewer: boolean;
  taken: number;
  total: number;
  adminUrl: string;
}

export async function sendBookingAlert(v: BookingAlertInput): Promise<boolean> {
  const row = (label: string, value: string) =>
    `<tr>
       <td style="padding:6px 14px 6px 0;color:#6b7280;font-size:13px;white-space:nowrap;">${escapeHtml(label)}</td>
       <td style="padding:6px 0;color:#111827;font-size:15px;font-weight:600;">${escapeHtml(value)}</td>
     </tr>`;

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
    <p style="margin:0 0 4px;color:#053877;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(v.eventName)}</p>
    <h1 style="margin:0 0 18px;color:#111827;font-size:22px;font-weight:700;">${escapeHtml(v.podcastName)} just booked a slot</h1>
    <table style="border-collapse:collapse;margin:0 0 20px;">
      ${row("On air", v.onAirLabel)}
      ${row("Host", v.hostName)}
      ${row("Email", v.podcasterEmail)}
      ${row("Format", v.format === "prerecorded" ? "Pre-recorded episode" : "Live")}
      ${v.needsInterviewer ? row("Needs", "An interviewer — someone has to be assigned") : ""}
      ${row("Lineup", `${v.taken} of ${v.total} slots taken`)}
    </table>
    <p style="margin:0 0 8px;">
      <a href="${v.adminUrl}" style="display:inline-block;background:#F0A71F;color:#1a1200;text-decoration:none;font-size:15px;font-weight:700;padding:12px 22px;border-radius:9999px;">Open the admin dashboard</a>
    </p>
  </div>`;

  const text =
    `${v.podcastName} just booked a slot on ${v.eventName}.\n\n` +
    `On air: ${v.onAirLabel}\nHost: ${v.hostName}\nEmail: ${v.podcasterEmail}\n` +
    `Format: ${v.format === "prerecorded" ? "Pre-recorded episode" : "Live"}\n` +
    (v.needsInterviewer ? "Needs: an interviewer\n" : "") +
    `Lineup: ${v.taken} of ${v.total} slots taken\n\n${v.adminUrl}`;

  return sendRawEmail({
    to: v.to,
    subject: `New booking: ${v.podcastName} — ${v.onAirLabel}`,
    html,
    text,
  });
}
