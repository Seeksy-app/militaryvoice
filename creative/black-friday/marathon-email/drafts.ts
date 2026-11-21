// Founding Members emails from Riccoh to the Marathon's podcasters (21 Nov 2026). DRAFTS ONLY: nothing is queued,
// nothing is sent until Andrew OKs the exact text of each one. Renders previews:
//   npx tsx creative/black-friday/marathon-email/drafts.ts   → creative/black-friday/marathon-email/preview-*.html + drafts.txt
import { writeFileSync } from "node:fs";
import { emailShell } from "../../../server/email.ts";

const SITE = "https://www.militaryvoices.ai";
export const HEADERS = {
  A: `${SITE}/bf/email.jpg`, // the /black-friday sign-in banner (lettering + tag), already live
  B: `${SITE}/email/founding-hero.jpg`, // loud creative 05, hero wide
  C: `${SITE}/email/founding-what-you-get.jpg`, // loud creative 06, what you get
} as const;
const link = (n: 1 | 2 | 3) => `${SITE}/go/bf?src=email-marathon-${n}`;
const PRO_LINE = "[Pro too?] Want more? Pro is in the offer too: 6 clips an episode instead of 4 and 90 credits a month. [drop this line if Pro stays out]";
const GETS = [
  "Pōstify cuts 4 captioned clips from every episode, ready to post",
  "Animated captions that follow whoever is talking",
  "A clean episode every time: ums and dead air taken out",
  "30 Pōstify credits a month, yours on day 1",
  "Your own Studio to record and go live with your guests",
];
const OFFER = "Scale is free for your first 30 days, then $19.95 a month. You'll need a card at checkout, and if you cancel before day 30 you pay nothing.";
const SIGN = ["Semper Fi,", "Riccoh Player"];

type Draft = { key: string; sendAt: string; subject: string; preheader: string; heading: string; paras: (string | string[])[]; cta?: { label: string; n: 1 | 2 | 3 } };

export const DRAFTS: Draft[] = [
  {
    key: "1", sendAt: "on Andrew's go", subject: "I'm letting you in first", preheader: "Founding Members opens Black Friday. You're in before everyone else.",
    heading: "I'm letting you in first",
    paras: [
      "Hi {first},",
      "You were on the Marathon with us, so I'm letting you in before anyone else.",
      "Founding Members opens on Black Friday, and you can join today. " + OFFER,
      "What you get with Scale:",
      GETS,
      PRO_LINE,
      "Everyone who joins in 2026 is a Founding Member. The offer ends December 31, 2026.",
    ],
    cta: { label: "Become a Founding Member", n: 1 },
  },
  {
    key: "2", sendAt: "Wed 25 Nov, 9:00 am ET (no reply, no sign-in since email 1)", subject: "Your Founding Member spot is still open", preheader: "Scale free for 30 days. Before Thanksgiving, a quick reminder.",
    heading: "Your spot is still open",
    paras: [
      "Hi {first},",
      "A quick one before Thanksgiving. Your spot as a Founding Member is still open.",
      OFFER,
      "That's clips from every episode, animated captions, a clean edit and your own Studio.",
      PRO_LINE,
      "Happy Thanksgiving to you and yours.",
    ],
    cta: { label: "Become a Founding Member", n: 2 },
  },
  {
    key: "3a", sendAt: "Fri 27 Nov, 8:00 am ET (still no reply, no sign-in)", subject: "Closing your account", preheader: "If you want to come back, just reply.",
    heading: "Closing your account",
    paras: [
      "Hi {first},",
      "I haven't heard back from you, and I understand you may have other options.",
      "So we'll close and archive your MilitaryVoices.ai account. If you'd like to come back, reply to this email and let us know.",
      "And if you'd rather stay as a Founding Member, today is Black Friday. " + OFFER,
      PRO_LINE,
      "Thank you for being on the Marathon.",
    ],
    cta: { label: "Stay as a Founding Member", n: 3 },
  },
  {
    key: "3b", sendAt: "Fri 27 Nov, 8:00 am ET (still no reply, no sign-in)", subject: "Last note from me on Founding Members", preheader: "Your free account stays. This is my last note about the offer.",
    heading: "My last note on this",
    paras: [
      "Hi {first},",
      "This is my last note about Founding Members, and I understand you may have other options.",
      "Your free account stays as it is: your SmartLink, your show and your podcast hosting don't go anywhere.",
      "If you want Scale, today is Black Friday and the offer is open until December 31, 2026. " + OFFER,
      PRO_LINE,
      "If something isn't working for you, reply and tell me. Thank you for being on the Marathon.",
    ],
    cta: { label: "Become a Founding Member", n: 3 },
  },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function render(d: Draft, first: string, banner: string, unsubscribeUrl: string) {
  const fill = (s: string) => s.replaceAll("{first}", first);
  const body = d.paras.map((p) => Array.isArray(p)
    ? `<ul style="margin:0 0 16px;padding-left:20px;">${p.map((l) => `<li style="margin:0 0 6px;">${esc(l)}</li>`).join("")}</ul>`
    : `<p style="margin:0 0 16px;">${esc(fill(p))}</p>`).join("\n");
  const html = emailShell({
    banner, bannerAlt: "Black Friday Special: Founding Members 2026, 30 days free",
    eyebrow: "Founding Members 2026", heading: d.heading, body,
    cta: d.cta ? { href: link(d.cta.n), label: d.cta.label } : undefined,
    secondary: `<p style="margin:16px 0 0;">${SIGN.join("<br>")}</p>`,
    footerNote: `Questions? Reply to this email. · <a href="${unsubscribeUrl}" style="color:#6b7280;">Unsubscribe</a>`,
    preheader: d.preheader,
  });
  const text = [
    ...d.paras.flatMap((p) => Array.isArray(p) ? [...p.map((l) => `- ${l}`), ""] : [fill(p), ""]),
    ...(d.cta ? [`${d.cta.label}: ${link(d.cta.n)}`, ""] : []),
    ...SIGN, "", `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");
  return { subject: d.subject, html, text };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = new URL(".", import.meta.url).pathname;
  const out: string[] = [];
  for (const d of DRAFTS) {
    const r = render(d, "Laura", HEADERS.B, "#");
    writeFileSync(`${dir}preview-${d.key}.html`, r.html);
    out.push(`=== Email ${d.key} · ${d.sendAt}\nFrom: Riccoh Player <hello@militaryvoices.ai>\nSubject: ${r.subject}\nPreheader: ${d.preheader}\n\n${r.text}\n`);
  }
  for (const [k, url] of Object.entries(HEADERS)) writeFileSync(`${dir}header-${k}.html`, render(DRAFTS[0], "Laura", url, "#").html);
  writeFileSync(`${dir}drafts.txt`, out.join("\n"));
  console.log("wrote", DRAFTS.length, "previews");
}
