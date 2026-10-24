import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";

// Admin → a MilitaryVoices Radio day → Promotion: the station's ready-made
// artwork (rendered from creative/digital-experience, served from /dx) and a
// LinkedIn post to go with it, so whoever's posting has it in one place.
// Each podcaster's own graphics come with their booking (DxShare).

const V = "?v=nov";
const ART: { file: string; title: string; size: string; use: string }[] = [
  { file: "hero.jpg", title: "The whole week", size: "1600 × 900", use: "LinkedIn, Facebook, X" },
  { file: "mon.jpg", title: "Monday, Nov 16", size: "1600 × 900", use: "Day post" },
  { file: "tue.jpg", title: "Tuesday, Nov 17", size: "1600 × 900", use: "Day post" },
  { file: "wed.jpg", title: "Wednesday, Nov 18", size: "1600 × 900", use: "Day post" },
  { file: "thu.jpg", title: "Thursday, Nov 19", size: "1600 × 900", use: "Day post" },
  { file: "fri.jpg", title: "Friday, Nov 20", size: "1600 × 900", use: "Day post" },
  { file: "email.jpg", title: "Email header", size: "1400 × 560", use: "Emails and newsletters" },
];

const LINKEDIN = `MilitaryVoices Radio goes live November 16–20: the live station for military and veteran voices, weekdays 7 am – 10 pm ET.

Podcasters: book a free 30- or 60-minute slot. Our AI producer brings you on and off the air, live on LiveOne, YouTube and MilitaryVoices.ai. Book as many slots as you like.

Choose your date and time: https://www.militaryvoices.ai/radio/book

#MilitaryVoices #VeteranPodcasters #MilitaryPodcast #Veterans #MilitaryCommunity`;

export function RadioCreatives() {
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard.writeText(LINKEDIN).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  const pill = "inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs font-semibold hover:bg-muted";
  return (
    <section data-testid="radio-creatives">
      <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-foreground">MilitaryVoices Radio creatives</h3>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">The station's artwork for the week, ready to download and post. Each podcaster gets their own graphics with their booking.</p>

      <div className="mt-4 rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">LinkedIn post</p>
          <button type="button" onClick={copy} className={pill} data-testid="radio-creatives-copy">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? "Copied" : "Copy post"}</button>
        </div>
        <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{LINKEDIN}</p>
        <p className="mt-2 text-xs text-muted-foreground">Post it with "The whole week" image below.</p>
      </div>

      <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ART.map((a) => (
          <li key={a.file} className="overflow-hidden rounded-2xl border border-border bg-card">
            <img src={`/dx/${a.file}${V}`} alt={a.title} className="aspect-video w-full bg-[#000741] object-contain" />
            <div className="flex items-center justify-between gap-2 p-3">
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{a.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{a.size} · {a.use}</span>
              </span>
              <a href={`/dx/${a.file}${V}`} download={`militaryvoices-radio-${a.file}`} className={pill} data-testid={`radio-creative-${a.file}`}><Download className="h-3.5 w-3.5" /> Download</a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
