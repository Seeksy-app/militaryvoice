// militarycreatoreconomy.com — one page, rendered here.
//
// The rest of the site is a single-page app: the HTML Google first sees is an
// empty <div> until the JavaScript runs. For a page whose whole job is to be
// the answer when someone searches "military creators", that isn't good
// enough — the words, the creators and the numbers have to be in the HTML
// itself. So this page is written out on the server from the same data the
// app shows (the directory, and Discovery's saved sample search), with its
// own CSS inline and every button pointing into MilitaryVoices.ai.

import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage.js";
import { readSample, type SamplePayload } from "./discovery.js";

export const MCE_HOST = /^(www\.)?militarycreatoreconomy\.com$/i;
// www is the address: Vercel sends the bare domain there.
const ORIGIN = "https://www.militarycreatoreconomy.com";
const MV = "https://www.militaryvoices.ai";

export interface MceCreator {
  name: string;
  show: string;
  photo: string;
  branch: string;
  status: string;
}

const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const compact = (n: number | null | undefined) =>
  n == null ? "–" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);
const flagOf = (code: string) =>
  /^[A-Za-z]{2}$/.test(code) ? String.fromCodePoint(...code.toUpperCase().split("").map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : "";
const abs = (u: string) => (u.startsWith("/") ? `${MV}${u}` : u);
const utm = (path: string) => `${MV}${path}${path.includes("?") ? "&" : "?"}src=mce`;

function spark(points: { monthsAgo: number; pct: number }[]): string {
  if (points.length < 2) return "";
  const W = 72, H = 22;
  const vals = points.map((p) => p.pct);
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const d = points.map((p, i) => `${i ? "L" : "M"}${((i / (points.length - 1)) * W).toFixed(1)},${(H - 2 - ((p.pct - min) / span) * (H - 4)).toFixed(1)}`).join(" ");
  const up = points[points.length - 1].pct >= points[0].pct;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="${up ? "#16a34a" : "#dc2626"}" stroke-opacity=".75" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

const FAQ: [string, string][] = [
  [
    "What is the military creator economy?",
    "The military creator economy is the community of service members, National Guard and Reserve members, veterans, military spouses and caregivers who publish their own work — podcasts, YouTube channels, Instagram and TikTok accounts, books and businesses — and the brands, shows and events that work with them. Their audiences trust them because they have lived what they talk about: service, transition, deployment, moving every few years and life after the uniform.",
  ],
  [
    "How do brands find military and veteran creators?",
    "Discovery by MilitaryVoices.ai searches more than 300 million creator profiles across Instagram, YouTube, TikTok, X and Twitch for veterans, service members and military spouses. Describe who you want in plain English, then open any creator to see how much of their audience is real, where it lives, how it is growing and which brands have already paid them.",
  ],
  [
    "How many military creators are there?",
    "Nobody keeps an official count, and follower numbers alone overstate it. What can be measured is who is active and who is real: a single Discovery search for military spouse lifestyle creators on Instagram returns well over a hundred accounts with audiences above ten thousand, each with its audience quality measured.",
  ],
  [
    "What does “Verified on MilitaryVoices” mean?",
    "It means our team has checked who the creator is and that they served, or serve alongside someone who does. Verified creators carry a gold badge in Discovery and in the MilitaryVoices directory, and brands can reach them through us.",
  ],
  [
    "Where does the military creator community meet?",
    "In person at gatherings such as the Military Influencer Conference and Military Creator Con, and on air on National Military Podcast Day, when the Podcast Marathon broadcasts military and veteran podcasts back to back, live on MilitaryVoices.ai. The rest of the year, the MilitaryVoices directory and Discovery are where the community is found and measured.",
  ],
  [
    "I'm a military creator. How do I get listed?",
    "Create a free MilitaryVoices.ai account and fill in your profile — your service, your show and where people can find you. Profiles appear in the directory, and once verified you carry the badge in Discovery, where brands and event organisers are searching.",
  ],
];

export function renderMcePage(o: { creators: MceCreator[]; sample: SamplePayload | null }): string {
  const creators = o.creators.slice(0, 12);
  const sample = o.sample;
  const rows = (sample?.results ?? []).filter((r) => r.extra).slice(0, 6);
  const title = "The Military Creator Economy — find and measure military & veteran creators";
  const description =
    "Service members, veterans and military spouses are building audiences, media companies and businesses. Find them, verify them and measure their real audience with Discovery by MilitaryVoices.ai.";

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${ORIGIN}/#page`,
      url: `${ORIGIN}/`,
      name: "The Military Creator Economy",
      description,
      about: { "@type": "Thing", name: "Military creator economy" },
      publisher: { "@id": `${MV}/#org` },
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${MV}/#org`,
      name: "MilitaryVoices.ai",
      url: MV,
      logo: `${MV}/google-logo-512.png`,
      description: "The platform for military and veteran voices: live events, a verified creator directory and Discovery, a search across 300M+ creator profiles.",
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "Verified military and veteran creators",
      itemListElement: creators.map((c, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: { "@type": "Person", name: c.name, ...(c.show ? { description: c.show } : {}), url: `${MV}/directory` },
      })),
    },
  ];

  const creatorCards = creators
    .map(
      (c) => `
        <li class="creator">
          <img src="${esc(abs(c.photo))}" alt="${esc(c.name)}" loading="lazy" width="96" height="96">
          <div>
            <p class="c-name">${esc(c.name)} <span class="badge" title="Verified on MilitaryVoices">&#10003;</span></p>
            ${c.show ? `<p class="c-show">${esc(c.show)}</p>` : ""}
            ${[c.branch, c.status].filter((x) => x && !/^(none|n\/a|not applicable)$/i.test(x)).length ? `<p class="c-meta">${esc([c.branch, c.status].filter((x) => x && !/^(none|n\/a|not applicable)$/i.test(x)).join(" · "))}</p>` : ""}
          </div>
        </li>`,
    )
    .join("");

  const sampleRows = rows
    .map((r) => {
      const x = r.extra!;
      return `
          <tr>
            <td><div class="who"><img src="${esc(abs(r.picture))}" alt="" loading="lazy" width="40" height="40"><div><p class="w-name">${esc(r.name)}</p><p class="w-handle">@${esc(r.handle)}</p></div></div></td>
            <td class="num">${compact(r.followers)}</td>
            <td><div class="growth">${spark(x.growth)}<span>${x.growth6m != null ? `${x.growth6m > 0 ? "+" : ""}${x.growth6m.toFixed(1)}%` : ""}</span></div></td>
            <td class="num">${r.engagement != null ? `${r.engagement.toFixed(2)}%` : "–"}</td>
            <td class="hide-sm">${x.country ? `${flagOf(x.country.code)} ${esc(x.country.name)}` : "–"}</td>
            <td class="hide-md">${x.niches[0] ? esc(x.niches[0].name) : "–"}</td>
          </tr>`;
    })
    .join("");

  const features: [string, string][] = [
    ["Real reach", "How many followers are real people, and how many are mass-followers or suspicious accounts."],
    ["Who’s listening", "Audience country, city, age, gender and language — not just a follower count."],
    ["Growth", "Six months of follower change, so you can tell rising voices from fading ones."],
    ["Brand history", "The sponsors they have already worked with, and the brands their audience follows."],
    ["Verified military", "A gold badge for creators our team has checked: who they are and that they served."],
    ["Lookalikes", "Found one who fits? See the creators whose audience looks like theirs."],
  ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${ORIGIN}/">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:url" content="${ORIGIN}/">
<meta property="og:site_name" content="The Military Creator Economy">
<meta property="og:title" content="The Military Creator Economy">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${MV}/mce-og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="The Military Creator Economy">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${MV}/mce-og.jpg">
<link rel="icon" type="image/png" href="${MV}/favicon.png?v=2">
<link rel="apple-touch-icon" href="${MV}/apple-touch-icon.png?v=2">
<link rel="preconnect" href="https://api.fontshare.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&f[]=cabinet-grotesk@800&display=swap" rel="stylesheet">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>
<style>
:root{--navy:#000741;--blue:#053877;--gold:#F0A71F;--ink:#0b1233;--muted:#55607a;--line:#e3e8f1;--bg:#f5f8fc;--card:#fff}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:400 17px/1.65 "General Sans",Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:inherit}
img{display:block;max-width:100%}
h1,h2,h3{margin:0;line-height:1.08;letter-spacing:-.02em;text-wrap:balance}
p,li{text-wrap:pretty}
.wrap{max-width:1180px;margin:0 auto;padding:0 20px}
.kicker{font-size:12px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:#b36b00}
.btn{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:14px 26px;font-weight:600;font-size:16px;text-decoration:none;transition:transform .15s,background .15s}
.btn:hover{transform:translateY(-1px)}
.btn-gold{background:var(--gold);color:#1a1200}
.btn-gold:hover{background:#f5b94a}
.btn-ghost{border:1px solid rgba(255,255,255,.28);color:#fff}
.btn-ghost:hover{background:rgba(255,255,255,.08)}
.btn-blue{background:var(--blue);color:#fff}
.btn-blue:hover{background:#0a4a99}
/* header */
.top{position:absolute;inset:0 0 auto;z-index:5}
.top .wrap{display:flex;align-items:center;justify-content:space-between;height:76px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:#fff;font-weight:600;font-size:15px;letter-spacing:.01em}
.brand img{height:42px;width:auto}
.top nav{display:flex;gap:26px;font-size:15px}
.top nav a{color:rgba(255,255,255,.78);text-decoration:none}
.top nav a:hover{color:#fff}
/* hero */
.hero{position:relative;overflow:hidden;background:radial-gradient(1100px 520px at 85% -10%,rgba(240,167,31,.20),transparent 60%),radial-gradient(900px 600px at -10% 110%,rgba(37,99,235,.28),transparent 60%),var(--navy);color:#fff;padding:150px 0 90px}
.hero .grid{display:grid;grid-template-columns:1.15fr .85fr;gap:56px;align-items:center}
.hero h1{font-family:"Cabinet Grotesk","General Sans",sans-serif;font-weight:800;font-size:clamp(44px,6.4vw,84px)}
.hero h1 em{font-style:normal;color:var(--gold)}
.hero .lede{margin:24px 0 0;max-width:600px;font-size:19px;color:rgba(255,255,255,.78)}
.hero .ctas{display:flex;flex-wrap:wrap;gap:12px;margin-top:34px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:52px;padding-top:26px;border-top:1px solid rgba(255,255,255,.14);max-width:620px}
.stats b{display:block;font-size:30px;font-weight:700;letter-spacing:-.02em}
.stats span{display:block;font-size:13px;line-height:1.4;color:rgba(255,255,255,.62)}
.mosaic{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;transform:rotate(-3deg)}
.mosaic img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:18px;box-shadow:0 18px 40px -18px rgba(0,0,0,.7);border:1px solid rgba(255,255,255,.12)}
.mosaic img:nth-child(3n+2){transform:translateY(22px)}
/* sections */
section.band{padding:96px 0}
.band.white{background:#fff}
.head{max-width:760px}
.head h2{font-size:clamp(32px,4vw,48px);margin-top:10px}
.head p{margin:16px 0 0;color:var(--muted);font-size:18px}
.define{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:start}
.define .big{font-size:21px;line-height:1.6;color:var(--ink)}
.pillars{display:grid;gap:14px;margin:0;padding:0;list-style:none}
.pillars li{background:var(--bg);border:1px solid var(--line);border-radius:18px;padding:20px 22px}
.pillars b{display:block;font-size:17px}
.pillars span{color:var(--muted);font-size:15.5px}
/* creators */
.creators{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:40px 0 0;padding:0;list-style:none}
.creator{display:flex;gap:14px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:14px}
.creator img{width:64px;height:64px;border-radius:50%;object-fit:cover;flex:none;box-shadow:0 0 0 3px rgba(240,167,31,.45)}
.creator div{min-width:0}
.c-name{margin:0;font-weight:600;line-height:1.3}
.c-show{margin:2px 0 0;font-size:14px;color:var(--muted);line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.c-meta{margin:3px 0 0;font-size:12.5px;color:#8a5a00;font-weight:500}
.badge{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:var(--gold);color:#1a1200;font-size:10px;font-weight:700;vertical-align:1px;margin-left:2px}
.more{margin-top:28px}
/* sample */
.table-card{margin-top:40px;background:#fff;border:1px solid var(--line);border-radius:24px;overflow:hidden;box-shadow:0 30px 60px -40px rgba(5,56,119,.35)}
.table-top{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:baseline;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--line);background:#fafcff}
.table-top b{font-size:17px}
.table-top span{font-size:14px;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:15px}
th{padding:12px 16px;text-align:left;font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line)}
td{padding:12px 16px;border-bottom:1px solid var(--line);vertical-align:middle}
tr:last-child td{border-bottom:0}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
th.num{text-align:right}
.who{display:flex;gap:12px;align-items:center;min-width:0}
.who img{width:40px;height:40px;border-radius:50%;object-fit:cover;flex:none}
.w-name{margin:0;font-weight:600;line-height:1.25}
.w-handle{margin:0;font-size:13px;color:var(--muted)}
.growth{display:flex;align-items:center;gap:8px;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--muted)}
.note{margin:14px 2px 0;font-size:13px;color:var(--muted)}
/* features */
.features{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:40px}
.feature{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:24px}
.feature b{display:block;font-size:18px;color:#fff}
.feature span{display:block;margin-top:6px;color:rgba(255,255,255,.7);font-size:15.5px}
.dark{background:var(--navy);color:#fff}
.dark .head p{color:rgba(255,255,255,.72)}
.dark .kicker{color:var(--gold)}
/* faq */
.faq{margin-top:36px;display:grid;gap:12px;max-width:860px}
details{background:#fff;border:1px solid var(--line);border-radius:18px;padding:0 22px}
summary{cursor:pointer;list-style:none;padding:20px 0;font-weight:600;font-size:18px;display:flex;justify-content:space-between;gap:16px}
summary::-webkit-details-marker{display:none}
summary::after{content:"+";color:var(--blue);font-size:22px;line-height:1}
details[open] summary::after{content:"–"}
details p{margin:0 0 20px;color:var(--muted)}
/* close */
.close{background:var(--blue);color:#fff;padding:80px 0;text-align:center}
.close h2{font-size:clamp(30px,4vw,46px)}
.close p{margin:14px auto 0;max-width:620px;color:rgba(255,255,255,.78);font-size:18px}
.close .ctas{justify-content:center;display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}
footer{background:var(--navy);color:rgba(255,255,255,.6);font-size:14px;padding:34px 0}
footer .wrap{display:flex;flex-wrap:wrap;gap:12px 24px;justify-content:space-between;align-items:center}
footer a{color:rgba(255,255,255,.75);text-decoration:none}
footer a:hover{color:#fff}
footer nav{display:flex;flex-wrap:wrap;gap:18px}
@media (max-width:1000px){
  .hero .grid,.define{grid-template-columns:1fr}
  .mosaic{max-width:520px;transform:none;grid-template-columns:repeat(4,1fr)}
  .mosaic img:nth-child(3n+2){transform:none}
  .creators{grid-template-columns:repeat(2,1fr)}
  .features{grid-template-columns:repeat(2,1fr)}
  .hide-md{display:none}
}
@media (max-width:640px){
  body{font-size:16px}
  .top nav{display:none}
  .hero{padding:120px 0 64px}
  .hero .lede{font-size:17px}
  .stats{grid-template-columns:1fr 1fr 1fr;gap:12px}
  .stats b{font-size:24px}
  .mosaic{grid-template-columns:repeat(3,1fr)}
  .mosaic img:nth-child(n+7){display:none}
  section.band{padding:64px 0}
  .creators,.features{grid-template-columns:1fr}
  .creator:nth-child(n+7){display:none}
  .hide-sm{display:none}
  td,th{padding:10px 12px}
  .growth svg{width:48px}
}
</style>
</head>
<body>
<header class="top">
  <div class="wrap">
    <a class="brand" href="${ORIGIN}/"><img src="${MV}/logo-lockup-dark.png" alt="MilitaryVoices.ai" width="120" height="34"></a>
    <nav aria-label="Main">
      <a href="#what">What it is</a>
      <a href="#creators">Creators</a>
      <a href="#measured">Measured</a>
      <a href="#faq">FAQ</a>
      <a href="${utm("/discover")}">Discovery</a>
    </nav>
  </div>
</header>

<main>
<section class="hero">
  <div class="wrap grid">
    <div>
      <p class="kicker" style="color:var(--gold)">Veterans · service members · military spouses</p>
      <h1 style="margin-top:14px">The Military <em>Creator Economy</em></h1>
      <p class="lede">Service members, veterans and military spouses are building audiences, media companies and businesses of their own. MilitaryVoices.ai finds them, verifies them and measures who is really listening.</p>
      <div class="ctas">
        <a class="btn btn-gold" href="${utm("/discover")}">Search military creators &rarr;</a>
        <a class="btn btn-ghost" href="${utm("/directory")}">Browse the directory</a>
      </div>
      <div class="stats">
        <div><b>300M+</b><span>creator profiles searched</span></div>
        <div><b>${o.creators.length}</b><span>verified military creators</span></div>
        <div><b>5</b><span>platforms: Instagram, YouTube, TikTok, X, Twitch</span></div>
      </div>
    </div>
    <div class="mosaic" aria-hidden="true">
      ${creators.slice(0, 9).map((c) => `<img src="${esc(abs(c.photo))}" alt="" width="160" height="160">`).join("")}
    </div>
  </div>
</section>

<section class="band white" id="what">
  <div class="wrap define">
    <div class="head">
      <p class="kicker">What it is</p>
      <h2>What is the military creator economy?</h2>
    </div>
    <div>
      <p class="big" style="margin:0">The military creator economy is the community of service members, National Guard and Reserve, veterans, military spouses and caregivers who publish their own work — podcasts, YouTube channels, Instagram and TikTok accounts, books and businesses — and the brands, shows and events that work with them.</p>
      <p style="color:var(--muted);margin:18px 0 0">Their audiences trust them because they have lived what they talk about: service, deployment, a move every few years, and life after the uniform. That trust is exactly what sponsors, podcasts and event organisers are looking for — and why it pays to find the right voices, not just the loudest ones.</p>
    </div>
  </div>
  <div class="wrap" style="margin-top:40px">
    <ul class="pillars" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
      <li><b>Who</b><span>Active duty, Guard and Reserve, veterans, military spouses and caregivers, across every branch.</span></li>
      <li><b>What they make</b><span>Podcasts, video, social channels, books, coaching and veteran-owned businesses.</span></li>
      <li><b>Who works with them</b><span>Brands and sponsors, podcasts booking guests, and events filling the stage.</span></li>
    </ul>
  </div>
</section>

<section class="band" id="creators">
  <div class="wrap">
    <div class="head">
      <p class="kicker">Verified on MilitaryVoices</p>
      <h2>Meet the creators</h2>
      <p>Creators our team knows personally, every one checked: who they are, and that they served or serve alongside.</p>
    </div>
    <ul class="creators">${creatorCards}
    </ul>
    <div class="more"><a class="btn btn-blue" href="${utm("/directory")}">See the full directory &rarr;</a></div>
  </div>
</section>

${
  rows.length
    ? `<section class="band white" id="measured">
  <div class="wrap">
    <div class="head">
      <p class="kicker">Measured, not guessed</p>
      <h2>A real search, every number filled in</h2>
      <p>This is one Discovery search, exactly as it came back. Describe who you want in plain English; each creator opens to their real reach, audience and brand history.</p>
    </div>
    <div class="table-card">
      <div class="table-top"><b>“${esc(sample!.q)}”</b><span>${sample!.total.toLocaleString("en-US")} creators on Instagram · top ${rows.length} shown</span></div>
      <div style="overflow-x:auto">
      <table>
        <thead><tr><th>Creator</th><th class="num">Followers</th><th>Growth · 6 mo</th><th class="num">Engagement</th><th class="hide-sm">Top audience</th><th class="hide-md">Audience niche</th></tr></thead>
        <tbody>${sampleRows}
        </tbody>
      </table>
      </div>
    </div>
    <p class="note">Figures from Discovery by MilitaryVoices.ai, as measured when the search was run.</p>
    <div class="more"><a class="btn btn-blue" href="${utm("/discover")}">Run your own search &rarr;</a></div>
  </div>
</section>`
    : ""
}

<section class="band dark">
  <div class="wrap">
    <div class="head">
      <p class="kicker">Discovery by MilitaryVoices.ai</p>
      <h2>Everything a brand decides on</h2>
      <p>Follower counts are the least useful number on a profile. Discovery opens each creator to what actually matters.</p>
    </div>
    <div class="features">
      ${features.map(([t, b]) => `<div class="feature"><b>${esc(t)}</b><span>${esc(b)}</span></div>`).join("")}
    </div>
    <div class="more"><a class="btn btn-gold" href="${utm("/discover")}">Try Discovery free &rarr;</a></div>
  </div>
</section>

<section class="band" id="faq">
  <div class="wrap">
    <div class="head">
      <p class="kicker">Questions</p>
      <h2>The military creator economy, answered</h2>
    </div>
    <div class="faq">
      ${FAQ.map(([q, a], i) => `<details${i === 0 ? " open" : ""}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}
    </div>
  </div>
</section>

<section class="close">
  <div class="wrap">
    <h2>Find the voices worth working with.</h2>
    <p>Search military and veteran creators, see who is really listening, and reach verified voices through us.</p>
    <div class="ctas">
      <a class="btn btn-gold" href="${utm("/discover")}">Search military creators &rarr;</a>
      <a class="btn btn-ghost" href="${utm("/platform")}">About MilitaryVoices.ai</a>
    </div>
  </div>
</section>
</main>

<footer>
  <div class="wrap">
    <span>© ${new Date().getFullYear()} MilitaryVoices.ai · The Military Creator Economy</span>
    <nav aria-label="Footer">
      <a href="${utm("/discover")}">Discovery</a>
      <a href="${utm("/directory")}">Directory</a>
      <a href="${utm("/events")}">Events</a>
      <a href="${MV}/privacy">Privacy</a>
      <a href="${MV}/terms">Terms</a>
    </nav>
  </div>
</footer>
</body>
</html>`;
}

async function loadCreators(): Promise<MceCreator[]> {
  const rows = (await storage.listAllProfiles())
    .filter((p) => p.hostName.trim() && (p.directoryImage || p.photoUrl).trim() && !p.directoryHidden)
    .sort((a, b) => a.directoryOrder - b.directoryOrder || a.id - b.id);
  return rows.map((p) => ({
    name: p.hostName.trim(),
    show: p.podcastName.trim(),
    photo: (p.directoryImage || p.photoUrl).trim(),
    branch: (p.branch ?? "").trim(),
    status: (p.serviceStatus ?? "").trim(),
  }));
}

async function sendPage(res: Response) {
  const [creators, sample] = await Promise.all([loadCreators(), readSample().catch(() => null)]);
  res.set("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  res.type("text/html").send(renderMcePage({ creators, sample }));
}

/** Only for requests arriving on militarycreatoreconomy.com; everything else passes through. */
export function registerMce(app: Express): void {
  // The same page on our own domain, to look at before the domain points
  // here. Never indexed: the canonical is the real domain.
  app.get("/api/mce-preview", async (_req, res, next) => {
    try {
      res.set("X-Robots-Tag", "noindex");
      await sendPage(res);
    } catch (err) {
      next(err);
    }
  });
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (!MCE_HOST.test(String(req.hostname || req.get("host") || "").split(":")[0])) return next();
    if (req.path === "/robots.txt") {
      res.type("text/plain").send(`User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
      return;
    }
    if (req.path === "/sitemap.xml") {
      res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${ORIGIN}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url></urlset>\n`);
      return;
    }
    // "/" arrives here as /api/mce, rewritten by middleware.ts.
    if (req.path !== "/" && req.path !== "/api/mce") return next();
    try {
      await sendPage(res);
    } catch (err) {
      next(err);
    }
  });
}
