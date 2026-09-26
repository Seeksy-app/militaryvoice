// Confirmation emails via Resend. Works two ways:
//  - Vercel/production: set RESEND_API_KEY to a real Resend API key. Requests hit
//    api.resend.com directly with the standard `Authorization: Bearer` header.
//  - Our own sandbox preview: publish_website injects CUSTOM_CRED_API_RESEND_COM_URL /
//    CUSTOM_CRED_API_RESEND_COM_TOKEN, and requests go through that proxy with the
//    token sent as x-api-key instead of hitting api.resend.com directly.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_BASE = process.env.CUSTOM_CRED_API_RESEND_COM_URL || "https://api.resend.com";
const RESEND_PROXY_TOKEN = process.env.CUSTOM_CRED_API_RESEND_COM_TOKEN;

const FROM_ADDRESS = "MilitaryVoices.ai <hello@militaryvoices.ai>";
const SITE = (process.env.PUBLIC_ORIGIN || "https://www.militaryvoices.ai").replace(/\/+$/, "");

/** Header images live in /public/email; one per mood so emails can rotate. */
export const EMAIL_BANNERS = {
  welcome: `${SITE}/email/creators.jpg`,
  podcasters: `${SITE}/email/podcasters.jpg`,
  studio: `${SITE}/email/studio.jpg`,
  conversation: `${SITE}/email/conversation.jpg`,
} as const;

/**
 * The one layout every outward email uses: photo header, white card, navy
 * footer. Table-based and inline-styled because that's what mail clients
 * render; 640px wide with a 2x banner so it's sharp on a phone.
 *
 * 600px was the standard because Outlook's old reading pane was about that
 * wide and anything larger got a horizontal scrollbar. That pane is long gone
 * and 640 is comfortably inside what every current client shows, so the body
 * gets forty more pixels — worth about five characters a line, which is the
 * difference between a three-line bullet and a two-line one.
 */
export function emailShell(o: {
  banner: string;
  bannerAlt?: string;
  eyebrow: string;
  heading: string;
  body: string;
  cta?: { href: string; label: string };
  secondary?: string; // extra html under the button (calendar links, etc.)
  footerNote?: string;
}): string {
  const cta = o.cta
    ? `<a href="${o.cta.href}" style="display:inline-block;background:#F0A71F;color:#1a1200;text-decoration:none;font-size:13px;font-weight:600;padding:9px 20px;border-radius:9999px;">${escapeHtml(o.cta.label)}</a>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#eef2f8;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f8;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="700" cellpadding="0" cellspacing="0" style="max-width:700px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <!-- The artwork, whole.
             It used to be a background-image with a dark gradient and the
             header type drawn on top. Three things went wrong with that: the
             wash was hiding a picture that is already treated, the type landed
             on the artwork's own lettering, and cover-cropping a 2.5:1 image
             into a band nowhere near 2.5:1 meant which part got clipped
             changed with the width of the client, and on a phone it clipped
             the wave in half. A plain <img> has none of those problems: it
             always shows the whole thing, at every width, in every client. -->
        <tr><td style="padding:0;background:#053877;font-size:0;line-height:0;" bgcolor="#053877">
          <img src="${o.banner}" width="700" alt="${escapeHtml(o.bannerAlt ?? "MilitaryVoices.ai")}"
               style="display:block;width:100%;max-width:700px;height:auto;border:0;">
        </td></tr>
        <!-- The brand bar: what this email is on the left, the mark on the
             right. Below the picture rather than on it, so neither can ever
             land on the other whatever width the client renders at. -->
        <tr><td style="background:#042a5c;padding:12px 32px 14px;" bgcolor="#042a5c">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="left" valign="middle" style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                <p style="margin:0;color:#F0A71F;font-size:13px;font-weight:800;letter-spacing:0.07em;text-transform:uppercase;line-height:1.35;">${escapeHtml(o.eyebrow)}</p>
              </td>
              <td align="right" valign="middle" style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;white-space:nowrap;padding-left:18px;">
                <img src="${SITE}/logo-wave.png" width="58" height="17" alt="" style="display:block;border:0;margin:0 0 5px auto;">
                <p style="margin:0;color:#ffffff;font-size:10px;font-weight:700;letter-spacing:0.10em;text-transform:uppercase;opacity:0.85;">MilitaryVoices.ai</p>
              </td>
            </tr>
          </table>
        </td></tr>
        ${o.heading ? `<tr><td style="padding:26px 32px 6px;">
          <h1 style="margin:0;color:#0b1220;font-size:26px;line-height:1.25;font-weight:800;">${escapeHtml(o.heading)}</h1>
        </td></tr>` : ""}
        <tr><td style="padding:14px 32px 4px;color:#374151;font-size:16px;line-height:1.65;">${o.body}</td></tr>
        ${cta ? `<tr><td style="padding:14px 32px 6px;">${cta}</td></tr>` : ""}
        ${o.secondary ? `<tr><td style="padding:6px 32px 8px;">${o.secondary}</td></tr>` : ""}
        <tr><td style="padding:16px 32px 28px;color:#6b7280;font-size:13px;line-height:1.6;">${o.footerNote ?? "Questions? Reply to this email and a human will read it."}</td></tr>
        <tr><td style="background:#053877;padding:20px 32px;">
          <img src="${SITE}/logo-wave.png" width="54" alt="" style="display:block;border:0;margin:0 0 8px;">
          <p style="margin:0;color:#ffffff;font-size:14px;font-weight:700;">MilitaryVoices.ai</p>
          <p style="margin:2px 0 0;color:#c8d8ee;font-size:12px;line-height:1.6;">The Podcast Marathon for National Military Podcast Day ·
            <a href="${SITE}/agenda" style="color:#F0A71F;text-decoration:none;">Agenda</a> ·
            <a href="${SITE}/host/dashboard" style="color:#F0A71F;text-decoration:none;">Your dashboard</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}


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
  return emailShell({
    banner: EMAIL_BANNERS.welcome,
    bannerAlt: "National Military Podcast Day · October 5, 2026",
    eyebrow: rawInput.eventName,
    heading: `You're on the lineup, ${rawInput.hostName}`,
    body: `
      <p style="margin:0 0 16px;"><strong>${input.podcastName}</strong> is confirmed. Here's your time:</p>
      <div style="background:#fff7e6;border:1px solid #f0a71f;border-radius:12px;padding:16px 20px;margin:0 0 18px;">
        <p style="margin:0 0 4px;color:#053877;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">You're on air</p>
        <p style="margin:0;color:#1f2937;font-size:20px;font-weight:800;">${input.onAirStartLabel} – ${input.onAirEndLabel}</p>
        <p style="margin:2px 0 0;color:#6b7280;font-size:13px;">${escapeHtml(input.timezoneLabel)}</p>
      </div>
      <p style="margin:0 0 12px;">Next, from your dashboard: set your show up for the event, send us anything you want played
        (intro, outro, images), and tick the ready-made posts and we'll promote your slot from your own accounts.</p>
      <p style="margin:0;">On the day, be in the studio page <strong>10 minutes before</strong> you're on. We'll email the details ahead of time.</p>`,
    cta: { href: input.agendaUrl, label: "See the lineup" },
    secondary: input.calendar ? calendarButtonsHtml(input.calendar) : undefined,
  });
}

function buildText(input: ConfirmationEmailInput): string {
  return `You're on the schedule, ${input.hostName}\n\n${input.podcastName} is confirmed for ${input.eventName}.\n\nYou're on air: ${input.onAirStartLabel} - ${input.onAirEndLabel} (${input.timezoneLabel})\n\nWe'll email you the studio details and how to log in ahead of the event. Please be ready and online 10 minutes before your go-live time.\n\nView the agenda: ${input.agendaUrl}\n${input.calendar ? "\n" + calendarText(input.calendar) : ""}`;
}

/** Low-level Resend sender shared by every email type. Never throws — logs and
 *  returns false on failure so a flaky email provider never blocks a user flow. */
async function sendRawEmail(opts: { to: string; subject: string; html: string; text: string; replyTo?: string; from?: string; headers?: Record<string, string> }): Promise<string | null> {
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
        from: opts.from ?? FROM_ADDRESS,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
        ...(opts.headers && Object.keys(opts.headers).length ? { headers: opts.headers } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`Resend email failed (${res.status}):`, body);
      return null;
    }
    const data = await res.json().catch(() => ({})) as { id?: string };
    return data.id ?? null;
  } catch (err) {
    console.error("Failed to send email:", err);
    return null;
  }
}

async function sendEmail(opts: Parameters<typeof sendRawEmail>[0]): Promise<boolean> {
  return (await sendRawEmail(opts)) !== null;
}

/**
 * One email, to one person, written by hand.
 *
 * Everything else in here renders a template, and the broadcast tools resolve
 * an audience segment and attach an unsubscribe footer — right for the
 * forty-person send, wrong for "which episode did you want?". This is the gap
 * between the two, and without it the only way to send a single note was to
 * hold a copy of the Resend key somewhere outside the server, which is how a
 * key ends up in a shell history or a .env that gets committed.
 *
 * One recipient, deliberately. A list parameter here is how this quietly
 * becomes a second broadcast sender with none of the unsubscribe handling.
 */
export async function sendOneOffEmail(o: {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** e.g. In-Reply-To, so a reply threads under the mail it answers. */
  headers?: Record<string, string>;
  /** A named sender on our domain, when it isn't hello@. */
  from?: string;
}): Promise<string | null> {
  return sendRawEmail(o);
}

export async function resendApiGet(path: string): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (RESEND_API_KEY) headers["Authorization"] = `Bearer ${RESEND_API_KEY}`;
  else if (RESEND_PROXY_TOKEN) headers["x-api-key"] = RESEND_PROXY_TOKEN;
  const res = await fetch(`${RESEND_BASE}${path}`, { headers });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

/** The confirmation as it would arrive, without sending it. */
export function renderConfirmationEmail(input: ConfirmationEmailInput): { subject: string; html: string; text: string } {
  return {
    subject: `You're on the schedule: ${input.podcastName} at ${input.onAirStartLabel}`,
    html: buildHtml(input),
    text: buildText(input),
  };
}

/**
 * Send the on-air confirmation email. Never throws.
 *
 * Resolves to Resend's id for the message, or null when it was refused, so
 * the caller can file the send and its opens count like a campaign's.
 */
export async function sendConfirmationEmail(input: ConfirmationEmailInput): Promise<string | null> {
  return sendRawEmail({ to: input.to, ...renderConfirmationEmail(input) });
}

export interface LoginCodeEmailInput {
  to: string;
  code: string;
}

/** Send a podcaster their one-time typed sign-in code. Never throws. */
export async function sendLoginCodeEmail(input: LoginCodeEmailInput): Promise<boolean> {
  const codeBlock = `
    <div style="background:#fff7e6;border:2px solid #f0a71f;border-radius:12px;padding:20px 24px;margin:0 0 20px;text-align:center;">
      <p style="margin:0 0 6px;color:#053877;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Your code</p>
      <p style="margin:0;color:#053877;font-size:36px;font-weight:800;letter-spacing:0.25em;font-family:monospace;">${escapeHtml(input.code)}</p>
    </div>`;
  return sendEmail({
    to: input.to,
    subject: `Your sign-in code: ${input.code}`,
    html: emailShell({
      banner: EMAIL_BANNERS.welcome,
      bannerAlt: "MilitaryVoices.ai",
      eyebrow: "Sign-in",
      heading: "Your sign-in code",
      body: `<p style="margin:0 0 16px;">Enter this code on the sign-in page. It expires in 15 minutes.</p>${codeBlock}<p style="margin:0;color:#9ca3af;font-size:13px;">If you didn't request this, you can ignore this email.</p>`,
      footerNote: "One-time code — expires in 15 minutes.",
    }),
    text: `Your MilitaryVoices.ai sign-in code: ${input.code}\n\nThis code expires in 15 minutes. If you didn't request this, you can ignore this email.\n`,
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
  return sendEmail({ to: raw.to, subject: `Reminder set: ${raw.podcastName} · ${raw.whenLabel}`, html, text });
}

/** Tell the admin team a sponsor asked to get involved. Never throws. */
/**
 * Their copy of the enquiry, with the way to pay in it.
 *
 * The team's alert already goes out; this is the half the sponsor sees. It
 * carries the checkout link when they picked a package and deliberately does
 * not when they didn't — somebody who chose "not sure yet" said they wanted a
 * conversation, and answering that with a payment button is how you lose them.
 */
export async function sendSponsorThanksEmail(input: {
  to: string;
  name: string;
  packageName: string;
  checkoutUrl: string;
}): Promise<boolean> {
  const first = input.name.trim().split(/\s+/)[0] || "there";
  const pay =
    input.checkoutUrl && input.packageName
      ? `<p style="margin:20px 0 0;color:#374151;font-size:15px;line-height:1.65;">You asked about <strong>${escapeHtml(input.packageName)}</strong>. When you're ready, this is the link:</p>
         <p style="margin:16px 0 0;"><a href="${escapeHtml(input.checkoutUrl)}" style="display:inline-block;background:#F0A71F;color:#1a1200;font-weight:700;font-size:15px;text-decoration:none;padding:13px 26px;border-radius:999px;">Complete your sponsorship</a></p>
         <p style="margin:12px 0 0;color:#9ca3af;font-size:12px;">No rush — the link stays good, and our sponsor team will be in touch about your creative either way.</p>`
      : `<p style="margin:20px 0 0;color:#374151;font-size:15px;line-height:1.65;">A member of our sponsor team will be in touch shortly to walk you through the packages and find the one that fits.</p>`;

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
    <p style="margin:0 0 4px;color:#053877;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">MilitaryVoices.ai</p>
    <h1 style="margin:0 0 16px;color:#111827;font-size:20px;font-weight:700;">Thanks, ${escapeHtml(first)} — we've got it.</h1>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.65;">26.2 miles of military and veteran stories, going out back to back on National Military Podcast Day. Your name sits with it.</p>
    ${pay}
    <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">Reply to this email and it reaches us directly.</p>
  </div>`;
  const text = `Thanks, ${first} — we've got it.\n\n${
    input.checkoutUrl && input.packageName
      ? `You asked about ${input.packageName}. When you're ready:\n${input.checkoutUrl}\n`
      : "A member of our sponsor team will be in touch shortly to walk you through the packages.\n"
  }\nReply to this email and it reaches us directly.\n`;
  return sendEmail({ to: input.to, subject: "Thanks for your interest in sponsoring", html, text });
}

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
    <p style="margin:0 0 4px;color:#053877;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">MilitaryVoices.ai</p>
    <h1 style="margin:0 0 16px;color:#111827;font-size:20px;font-weight:700;">New sponsor inquiry</h1>
    <table style="border-collapse:collapse;">
      ${row("Name", input.name)}${row("Company", input.company)}${row("Email", input.email)}${row("Phone", input.phone)}
    </table>
    ${input.message ? `<p style="margin:16px 0 0;padding:12px 16px;background:#f3f4f6;border-radius:10px;color:#374151;font-size:14px;line-height:1.6;">${escapeHtml(input.message)}</p>` : ""}
    <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">Reply straight to ${escapeHtml(input.email)} to pick it up.</p>
  </div>`;
  const text = `New sponsor inquiry\n\nName: ${input.name}\nCompany: ${input.company}\nEmail: ${input.email}\nPhone: ${input.phone}\n\n${input.message}\n`;
  const results = await Promise.all(
    input.to.map((to) => sendEmail({ to, subject: `Sponsor inquiry: ${input.company || input.name}`, html, text })),
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
    <p style="margin:0 0 4px;color:#053877;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">MilitaryVoices.ai platform</p>
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
  return sendEmail({ to: "hello@militaryvoice.ai", subject: `${heading}: ${v.name}`, html, text });
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
  return emailShell({
    banner: EMAIL_BANNERS.podcasters,
    bannerAlt: "The Podcast Marathon",
    eyebrow: opts.eyebrow,
    heading: opts.heading,
    body: opts.body,
    cta: opts.cta,
    footerNote: "You're getting this because you hold a slot on MilitaryVoices.ai. Reply to this email and a human will read it.",
  });
}

function outstandingHtml(items: string[]): string {
  if (items.length === 0) {
    return `<p style="margin:0 0 20px;color:#166534;font-size:15px;line-height:1.6;">Everything we need is in. Nothing for you to do.</p>`;
  }
  const lis = items.map((i) => `<li style="margin:0 0 6px;">${escapeHtml(i)}</li>`).join("");
  return `<p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">Still outstanding:</p>
    <ul style="margin:0 0 20px;padding-left:20px;color:#374151;font-size:15px;line-height:1.6;">${lis}</ul>`;
}

export type NudgeKind = "prep" | "final" | "onair";

/**
 * A nudge as it would arrive, without sending it.
 *
 * The three senders below used to build their HTML inline, which meant the
 * only way to see one was to send it to yourself. The admin's activity log
 * previews them through this instead.
 */
export function renderNudge(kind: NudgeKind, v: NudgeInput): { subject: string; html: string; text: string } {
  if (kind === "prep") {
    // Two weeks out: time to send us things.
    return {
      subject: `${v.podcastName}: your slot is ${v.onAirLabel}`,
      html: nudgeShell({
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
      }),
      text: `${v.podcastName} is on air ${v.onAirLabel}.\n\n${
      v.outstanding.length ? `Still outstanding:\n- ${v.outstanding.join("\n- ")}\n\n` : "Everything we need is in.\n\n"
    }Share link: ${v.shareUrl}\nYour dashboard: ${v.dashboardUrl}`,
    };
  }
  if (kind === "final") {
    // Two days out: the practical details.
    return {
      subject: `Two days: ${v.podcastName} at ${v.onAirLabel}`,
      html: nudgeShell({
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
      }),
      text: `You're on air ${v.onAirLabel}.\n\nJoin the green room ten minutes before: ${v.studioUrl}\n\n${
      v.outstanding.length ? `Still outstanding:\n- ${v.outstanding.join("\n- ")}\n` : ""
    }`,
    };
  }
  // An hour out: one link, nothing else.
  return {
    subject: `You're on soon: ${v.podcastName} at ${v.onAirLabel}`,
    html: nudgeShell({
      eyebrow: v.eventName,
      heading: `You're on in about an hour`,
      body: `<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
          <strong>${escapeHtml(v.podcastName)}</strong> is on air at <strong>${escapeHtml(v.onAirLabel)}</strong>.
          Join the green room now — we'll check your camera and sound before you go on.
        </p>`,
      cta: { href: v.studioUrl, label: "Join the green room" },
    }),
    text: `${v.podcastName} is on air at ${v.onAirLabel}.\n\nJoin the green room: ${v.studioUrl}`,
  };
}

// Each resolves to Resend's id, or null when refused, so the send can be filed.

/** Two weeks out: time to send us things. */
export async function sendPrepNudge(v: NudgeInput): Promise<string | null> {
  return sendRawEmail({ to: v.to, ...renderNudge("prep", v) });
}

/** Two days out: the practical details. */
export async function sendFinalNudge(v: NudgeInput): Promise<string | null> {
  return sendRawEmail({ to: v.to, ...renderNudge("final", v) });
}

/** An hour out: one link, nothing else. */
export async function sendOnAirNudge(v: NudgeInput): Promise<string | null> {
  return sendRawEmail({ to: v.to, ...renderNudge("onair", v) });
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

  return sendEmail({
    to: v.to,
    subject: `New booking: ${v.podcastName} — ${v.onAirLabel}`,
    html,
    text,
  });
}


/** The organiser's reference: when every automatic email and post goes out. */
export async function sendScheduleReference(to: string): Promise<boolean> {
  const row = (a: string, b: string, c: string) =>
    `<tr><td style="padding:8px 12px 8px 0;font-weight:700;color:#0b1220;white-space:nowrap;vertical-align:top;">${a}</td><td style="padding:8px 12px 8px 0;color:#053877;font-weight:600;white-space:nowrap;vertical-align:top;">${b}</td><td style="padding:8px 0;color:#374151;vertical-align:top;">${c}</td></tr>`;
  const head = (t: string) =>
    `<tr><td colspan="3" style="padding:16px 0 4px;color:#053877;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;border-bottom:1px solid #e5e7eb;">${t}</td></tr>`;
  const body = `
<p style="margin:0 0 12px;">Everything below is automatic. One cron runs <strong>every hour on the hour</strong>; anything due goes out on that pass.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:15px;line-height:1.5;">
  ${head("Podcaster nudges — relative to each slot")}
  ${row("Get ready", "14 days before", "What to send us, how the day runs. Oct 5 slots → Mon Sep 21; Oct 6 early-hours slots → Tue Sep 22.")}
  ${row("Two days to go", "2 days before", "Final checklist and their exact time. Oct 3 or Oct 4.")}
  ${row("You're on in an hour", "60 min before", "Studio link. Within the hour before their slot.")}
  ${row("Rule", "", "Only the most urgent one goes out. Someone booking three days out never gets “two weeks to go”.")}
  ${head("Posting plan — per podcaster, only the posts they tick")}
  ${row("Join me", "Mon Aug 31", "Already past → goes out at the next hourly run after they save.")}
  ${row("Share this", "Mon Sep 7", "Past → 2 days after the first.")}
  ${row("What is the day?", "Mon Sep 14", "Past → 4 days after the first. Links to the About page.")}
  ${row("Two weeks to go", "Mon Sep 21", "10:00 AM ET.")}
  ${row("This week", "Mon Sep 28", "10:00 AM ET.")}
  ${row("I'm on today", "Show day", "3 hours before their slot.")}
  ${row("Rule", "", "Anchored to the event, not the booking date. Overdue posts are spaced so nobody's followers get three in one hour.")}
  ${head("Listeners")}
  ${row("Remind me", "On tap", "Confirmation with Google / Outlook / Apple calendar links.")}
  ${row("Starting soon", "Within the hour", "One email in the hour before the show they picked (the :00 run before it). Text reminders are not sent — there's no SMS provider.")}
</table>`;
  const text =
    "Podcaster nudges (relative to each slot): Get ready 14 days before; Two days to go 2 days before; You're on in an hour 60 min before. Only the most urgent goes out.\n" +
    "Posting plan (only what they tick): Join me Aug 31 (past, next run); Share this Sep 7 (past, +2d); What is the day? Sep 14 (past, +4d); Two weeks Sep 21 10am ET; This week Sep 28 10am ET; I'm on today 3h before slot.\n" +
    "Listeners: calendar links at sign-up; no pre-show email yet.\nCron: every hour on the hour.";
  return sendEmail({
    to,
    subject: "Your automatic sends: nudges and posting plan dates",
    html: emailShell({
      banner: EMAIL_BANNERS.podcasters,
      eyebrow: "The Podcast Marathon · reference",
      heading: "When every automatic email and post goes out",
      body,
      cta: { href: `${SITE}/admin`, label: "Open the admin dashboard" },
      footerNote: "Internal reference for the organiser. Dates are US Eastern.",
    }),
    text,
  });
}


/** Someone on the site asked to talk to a person. Reply-To is them, so
 *  answering from your inbox answers them directly. */
export async function sendHelpRequestAlert(v: {
  to: string;
  name: string;
  email: string;
  question: string;
  transcript: string;
  page: string;
}): Promise<boolean> {
  const lines = v.transcript
    .split("\n")
    .filter(Boolean)
    .map((l) => `<p style="margin:0 0 6px;">${escapeHtml(l)}</p>`)
    .join("");
  return sendEmail({
    to: v.to,
    replyTo: v.email,
    subject: `Help request from ${v.name || v.email}: ${v.question.slice(0, 60)}`,
    html: emailShell({
      banner: EMAIL_BANNERS.podcasters,
      eyebrow: "Help chat · wants a person",
      heading: `${v.name || "A visitor"} asked to talk to someone`,
      body: `
        <p style="margin:0 0 10px;"><strong>Email:</strong> ${escapeHtml(v.email)}<br><strong>On page:</strong> ${escapeHtml(v.page || "unknown")}</p>
        <p style="margin:0 0 6px;font-weight:700;">Their question</p>
        <p style="margin:0 0 16px;padding:12px 16px;background:#fff7e6;border:1px solid #f0a71f;border-radius:12px;">${escapeHtml(v.question)}</p>
        ${lines ? `<p style="margin:0 0 6px;font-weight:700;">What the assistant and they said first</p><div style="padding:12px 16px;background:#f3f4f6;border-radius:12px;font-size:14px;color:#374151;">${lines}</div>` : ""}`,
      cta: { href: `mailto:${v.email}?subject=${encodeURIComponent("Re: your question on MilitaryVoices.ai")}`, label: "Reply to them" },
      footerNote: "Hit reply on this email and it goes straight to them.",
    }),
    text: `${v.name || "A visitor"} (${v.email}) asked to talk to a person.\nPage: ${v.page}\n\nQuestion:\n${v.question}\n\nTranscript:\n${v.transcript}\n\nReply to this email to answer them.`,
  });
}


export interface StartingSoonInput {
  to: string;
  name: string;
  podcastName: string;
  hostName: string;
  timeLabel: string; // "9:30 AM EDT"
  minutesAway: number;
  watchUrl: string;
  cardUrl: string;
  youtubeUrl?: string;
}

/** The listener's pre-show nudge: the promise on the homepage, kept. */
export async function sendListenerStartingSoon(v: StartingSoonInput): Promise<boolean> {
  const soon = v.minutesAway <= 5 ? "right now" : `in about ${v.minutesAway} minutes`;
  const first = v.name.trim().split(/\s+/)[0] || "there";
  return sendEmail({
    to: v.to,
    subject: `${v.podcastName} is on ${soon} — ${v.timeLabel}`,
    html: emailShell({
      banner: EMAIL_BANNERS.welcome,
      bannerAlt: "National Military Podcast Day",
      eyebrow: "Starting soon",
      heading: `${v.podcastName} goes live ${soon}`,
      body: `
        <p style="margin:0 0 14px;">Hi ${escapeHtml(first)} — you asked us to give you a nudge. <strong>${escapeHtml(v.podcastName)}</strong>
          with ${escapeHtml(v.hostName)} is on at <strong>${escapeHtml(v.timeLabel)}</strong> as part of the Podcast Marathon.</p>
        <p style="margin:0;">The stream is on the agenda; the show's card has the host's channels if you'd rather watch there.</p>`,
      cta: { href: v.watchUrl, label: "Watch live" },
      secondary: `<p style="margin:0;font-size:14px;"><a href="${v.cardUrl}" style="color:#053877;font-weight:600;">Open the show's card</a>${
        v.youtubeUrl ? ` · <a href="${v.youtubeUrl}" style="color:#053877;font-weight:600;">Their YouTube</a>` : ""
      }</p>`,
      footerNote: "One email, as promised. Reply if anything's wrong.",
    }),
    text: `${v.podcastName} with ${v.hostName} is on ${soon} — ${v.timeLabel}.\n\nWatch live: ${v.watchUrl}\nThe show's card: ${v.cardUrl}${v.youtubeUrl ? `\nTheir YouTube: ${v.youtubeUrl}` : ""}`,
  });
}

// ---------------------------------------------------------------------------
// Import finished: a recording that came in by itself is in their Library.
// ---------------------------------------------------------------------------

/** 754 -> "12:34", 3754 -> "1:02:34". */
function clockLength(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export interface ImportReadyInput {
  to: string;
  recordingId: number;
  title: string;
  startedAt: string; // ISO
  durationSec: number;
  /** Where it came from: Zoom's recording.completed event, or their personal import link. */
  provider: "zoom" | "link";
}

/**
 * Sent once, when an automatic import (Zoom's event or the import link) lands
 * in the Library. Not for "Import past recordings": they're watching then.
 */
export async function sendImportReadyEmail(v: ImportReadyInput): Promise<boolean> {
  const zoom = v.provider === "zoom";
  const title = v.title.trim() || (zoom ? "Zoom recording" : "Imported recording");
  const when = Date.parse(v.startedAt);
  const date = Number.isFinite(when)
    ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(new Date(when))
    : "";
  const length = v.durationSec > 0 ? clockLength(v.durationSec) : "";
  const libraryUrl = `${SITE}/host/dashboard/library`;
  const postifyUrl = `${SITE}/host/dashboard/postify?rec=${encodeURIComponent(String(v.recordingId))}`;
  const integrationsUrl = `${SITE}/host/dashboard/integrations`;
  const subject = zoom ? "Your Zoom recording is in your Library" : "Your recording is in your Library";
  const footer = zoom
    ? { lead: "You're getting this because automatic import is on.", link: "Turn it off on the Zoom card in Integrations" }
    : { lead: "You're getting this because a recording was sent to your import link.", link: "Manage or replace the import link in Integrations" };
  const facts = [date, length ? `Length ${length}` : ""].filter(Boolean);
  return sendEmail({
    to: v.to,
    subject,
    html: emailShell({
      banner: EMAIL_BANNERS.studio,
      bannerAlt: "MilitaryVoices.ai",
      eyebrow: "Library",
      heading: subject,
      body: `
        <p style="margin:0 0 14px;">${zoom ? "Your Zoom recording came in by itself" : "The recording sent to your import link came in"} and it's ready in your Library.</p>
        <div style="background:#f3f6fb;border:1px solid #d8e2f0;border-radius:12px;padding:14px 18px;margin:0 0 14px;">
          <p style="margin:0;color:#0b1220;font-size:17px;font-weight:700;">${escapeHtml(title)}</p>
          ${facts.length ? `<p style="margin:4px 0 0;color:#6b7280;font-size:14px;">${escapeHtml(facts.join(" · "))}</p>` : ""}
        </div>`,
      cta: { href: libraryUrl, label: "Open your Library" },
      secondary: `<p style="margin:0;font-size:14px;"><a href="${postifyUrl}" style="color:#053877;font-weight:600;">Make clips and a clean episode with Pōstify</a></p>
        <p style="margin:18px 0 0;color:#374151;font-size:16px;">The MilitaryVoices.ai team</p>`,
      footerNote: `${escapeHtml(footer.lead)} <a href="${integrationsUrl}" style="color:#6b7280;">${escapeHtml(footer.link)}</a>.`,
    }),
    text: `${subject}\n\n${title}${facts.length ? `\n${facts.join(" · ")}` : ""}\n\nOpen your Library: ${libraryUrl}\nMake clips and a clean episode with Pōstify: ${postifyUrl}\n\nThe MilitaryVoices.ai team\n\n${footer.lead} ${footer.link}: ${integrationsUrl}\n`,
  });
}

// ---------------------------------------------------------------------------
// Broadcast — one-to-many announcement email
// ---------------------------------------------------------------------------

/** Convert plain text to basic HTML paragraphs for the email body. */
/**
 * Inline marks, applied *after* escaping so the body can never inject markup:
 * **bold**, and [label](https://…) with the scheme checked.
 */
function inlineMarks(escaped: string): string {
  return escaped
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_m, label, href) => `<a href="${href}" style="color:#053877;text-decoration:underline;">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#0b1220;">$1</strong>')
    // Single asterisks after the double ones have been consumed, so **bold**
    // can never be read as two italics wrapping nothing.
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
}

/**
 * One row of a list: a gold marker in a narrow cell, the text beside it.
 *
 * The marker cell was 38px wide with 12px of padding after it — half an inch
 * of nothing between the dot and the first word, which read as a hanging
 * indent rather than a bullet. A dot needs about as much room as a dot.
 */
function listRow(marker: string, body: string, numbered: boolean): string {
  const bullet = numbered
    ? `<div style="width:22px;height:22px;border-radius:50%;background:#F0A71F;color:#1a1200;font-weight:700;font-size:12px;line-height:22px;text-align:center;font-family:Arial,sans-serif;">${marker}</div>`
    : `<div style="width:7px;height:7px;border-radius:50%;background:#F0A71F;margin:8px 0 0 2px;"></div>`;
  return `<tr>
    <td width="${numbered ? 30 : 14}" valign="top" style="padding:0 ${numbered ? 10 : 8}px 8px 0;">${bullet}</td>
    <td valign="top" style="padding:0 0 8px;font-size:15px;line-height:1.6;color:#374151;">${body}</td>
  </tr>`;
}

/**
 * Turns the plain-text body an author types into email HTML. Tables rather than
 * <ol>/<ul> because list rendering is the least consistent thing across mail
 * clients — Outlook's Word engine in particular ignores most list styling.
 */
function textToHtml(text: string): string {
  const NUM = /^\s*(\d+)[.)]\s+(.*)$/;
  // A bullet is "- " or "• ". An asterisk is not, any more: "*Important*" on
  // its own line is italics, and treating it as a bullet ate the closing mark.
  const BUL = /^\s*[-•]\s+(.*)$/;
  const HEAD = /^\s*(#{2,3})\s+(.*)$/;
  const QUOTE = /^\s*>\s?(.*)$/;
  const RULE = /^\s*-{3,}\s*$/;

  return text
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.trim().split("\n").filter((l) => l.trim());
      if (!lines.length) return "";

      // A divider on its own.
      if (lines.length === 1 && RULE.test(lines[0])) {
        return '<hr style="border:0;border-top:1px solid #e5e7eb;margin:22px 0;">';
      }

      // Headings. Two sizes is all an email needs; more just invites a
      // hierarchy nobody reads on a phone.
      if (lines.length === 1 && HEAD.test(lines[0])) {
        const [, hashes, body] = lines[0].match(HEAD)!;
        const big = hashes.length === 2;
        return `<p style="margin:26px 0 10px;font-size:${big ? 21 : 17}px;line-height:1.3;font-weight:700;color:#0b1220;">${inlineMarks(escapeHtml(body.trim()))}</p>`;
      }

      // A pulled-out note, in the brand gold. The one thing in an email people
      // read when they read nothing else.
      if (lines.every((l) => QUOTE.test(l))) {
        const body = lines.map((l) => inlineMarks(escapeHtml(l.match(QUOTE)![1].trim()))).join("<br>");
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
          <tr>
            <td width="4" style="background:#F0A71F;"></td>
            <td style="padding:12px 16px;background:#fdf6e8;font-size:15px;line-height:1.6;color:#4b3b16;">${body}</td>
          </tr>
        </table>`;
      }

      const numbered = lines.every((l) => NUM.test(l));
      const bulleted = !numbered && lines.every((l) => BUL.test(l));

      if (numbered || bulleted) {
        const rows = lines
          .map((l) => {
            const m = numbered ? l.match(NUM)! : l.match(BUL)!;
            const marker = numbered ? m[1] : "";
            const body = inlineMarks(escapeHtml((numbered ? m[2] : m[1]).trim()));
            return listRow(marker, body, numbered);
          })
          .join("");
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;">${rows}</table>`;
      }

      // A line ending in a colon ahead of a list reads as its lead-in; keep it
      // tight to what follows rather than a full paragraph gap.
      const html = inlineMarks(escapeHtml(block.trim())).replace(/\n/g, "<br>");
      const tight = /:\s*$/.test(block.trim());
      return `<p style="margin:0 0 ${tight ? 10 : 14}px;font-size:15px;line-height:1.65;color:#374151;">${html}</p>`;
    })
    .join("");
}

/**
 * Header images, every one cropped to the 2.5:1 the header wants.
 *
 * The header is a plain <img>, so the file's own shape is the shape people
 * see — a hero cropped by the browser shows whatever the middle happens to
 * be. scripts/email-banners.ts regenerates the set.
 *
 * "marathon" is kept pointing at studio.jpg because broadcasts already store
 * that key; renaming it would blank the header on every draft that has it.
 */
const BROADCAST_BANNERS: Record<string, string> = {
  welcome: `${SITE}/email/creators.jpg`,
  podcasters: `${SITE}/email/podcasters.jpg`,
  marathon: `${SITE}/email/studio.jpg`,
  studio: `${SITE}/email/studio.jpg`,
  conversation: `${SITE}/email/conversation.jpg`,
  desk: `${SITE}/email/desk.jpg`,
  mic: `${SITE}/email/mic.jpg`,
  headphones: `${SITE}/email/headphones.jpg`,
  board: `${SITE}/email/board.jpg`,
  schedule: `${SITE}/email/schedule.jpg`,
};

const RICO_PHOTO = `${SITE}/riccoh-player.jpg`;

const RICO_SIGNATURE = `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0;border-top:1px solid #e5e7eb;padding-top:20px;">
  <tr>
    <td style="padding-right:14px;vertical-align:top;">
      <img src="${RICO_PHOTO}" width="56" height="56" alt="Riccoh Player" style="display:block;border-radius:50%;object-fit:cover;">
    </td>
    <td style="vertical-align:top;">
      <p style="margin:0;color:#0b1220;font-size:14px;font-weight:700;line-height:1.4;">Riccoh Player</p>
      <p style="margin:2px 0 0;color:#053877;font-size:12px;">Host · MilitaryVoices.ai</p>
    </td>
  </tr>
</table>`;

/**
 * Send a single broadcast email to one recipient.
 * The unsubscribe token is a simple HMAC — good enough for a mailing list
 * of military podcast fans, not a compliance-grade setup.
 */
function memberSignatureHtml(member: { name: string; title: string; photoUrl: string }): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;border-top:1px solid #e5e7eb;padding-top:20px;">
        <tr>
          ${member.photoUrl ? `<td width="56" valign="middle" style="padding-right:14px;">
            <img src="${member.photoUrl}" width="56" height="56" alt="${escapeHtml(member.name)}" style="display:block;border-radius:50%;object-fit:cover;" />
          </td>` : ""}
          <td valign="middle">
            <p style="margin:0;font-weight:700;font-size:15px;color:#0b1220;">${escapeHtml(member.name)}</p>
            <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">${escapeHtml(member.title)}</p>
          </td>
        </tr>
      </table>`;
}

/**
 * The exact HTML a broadcast will send as, without sending it.
 *
 * Split out of sendBroadcastEmail so the composer's preview and the real send
 * cannot drift: a preview built by a second renderer is a preview of something
 * nobody receives.
 */
export function renderBroadcastEmail(opts: BroadcastEmailOptions): { subject: string; html: string; text: string; fromName: string } {
  const isRico = opts.sender === "rico" && !opts.senderMember;
  const member = opts.senderMember;
  const resolvedName = opts.firstName.trim() || "Friend";
  // {{Remind_Me_Later}} becomes a real link when the caller has a signed URL
  // for this recipient, and disappears cleanly when it doesn't — a test send
  // and the composer's preview have no recipient to sign for, and neither
  // should show a dead link or the raw token.
  const withRemind = opts.remindUrl
    ? opts.bodyText.replace(/\{\{Remind_Me_Later\}\}/gi, `[Remind me in three days](${opts.remindUrl})`)
    : opts.bodyText.replace(/^.*\{\{Remind_Me_Later\}\}.*$/gim, "").replace(/\n{3,}/g, "\n\n");
  // {{Slot_Time}} is the host's own air time, already formatted in their zone
  // by the caller. A test send and the composer preview have no booking to
  // look up, so it falls back to wording that still reads as a sentence
  // rather than leaking the token.
  const withSlot = withRemind.replace(/\{\{Slot_Time\}\}/gi, opts.slotLabel?.trim() || "your slot time");
  const resolvedBodyText = withSlot.replace(/\{\{First_Name\}\}/gi, resolvedName);
  const resolvedSubject = opts.subject
    .replace(/\{\{First_Name\}\}/gi, resolvedName)
    .replace(/\{\{Slot_Time\}\}/gi, opts.slotLabel?.trim() || "your slot time");

  const memberSignature = member ? memberSignatureHtml(member) : "";
  const bodyHtml = `${textToHtml(resolvedBodyText)}${isRico ? RICO_SIGNATURE : memberSignature}`;
  const bannerUrl = BROADCAST_BANNERS[opts.banner ?? "welcome"] ?? BROADCAST_BANNERS.welcome;
  const eyebrow = opts.bannerTitle?.trim() || "The Podcast Marathon";
  const fromName = member ? `${member.name} | MilitaryVoices.ai` : isRico ? "Riccoh Player | MilitaryVoices.ai" : "MilitaryVoices.ai";

  return {
    subject: resolvedSubject,
    fromName,
    html: emailShell({
      banner: bannerUrl,
      bannerAlt: "MilitaryVoices.ai",
      eyebrow,
      heading: "",
      body: bodyHtml,
      cta: { href: SITE, label: "Visit MilitaryVoices.ai" },
      footerNote: `Questions? Reply to this email. · <a href="${opts.unsubscribeUrl}" style="color:#6b7280;">Unsubscribe</a>`,
    }),
    text: `${resolvedBodyText}${member ? `\n\n— ${member.name}\n${member.title}, MilitaryVoices.ai` : isRico ? "\n\n— Riccoh Player\nHost, MilitaryVoices.ai" : ""}\n\n---\nVisit: ${SITE}\nUnsubscribe: ${opts.unsubscribeUrl}`,
  };
}

export interface BroadcastEmailOptions {
  to: string;
  firstName: string;
  /** This recipient's air time, already formatted in their own zone. */
  slotLabel?: string;
  subject: string;
  bodyText: string;
  unsubscribeUrl: string;
  /** Signed, per-recipient "remind me in three days" link. */
  remindUrl?: string;
  sender?: string;
  banner?: string;
  senderMember?: { name: string; title: string; photoUrl: string } | null;
  bannerTitle?: string;
}

export async function sendBroadcastEmail(opts: BroadcastEmailOptions): Promise<string | null> {
  const rendered = renderBroadcastEmail(opts);
  return sendRawEmail({
    to: opts.to,
    from: `${rendered.fromName} <hello@militaryvoices.ai>`,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
}
