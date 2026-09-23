// The magazine: every page, in order, with placeholders where the truth is
// not in yet.
//
//   npx tsx scripts/magazine-drafts.ts             # draft the show pages (cached)
//   npx tsx scripts/magazine.ts                    # build it
//   npx tsx scripts/magazine.ts --open             # build it and open the PDF
//
// Why the pages are built here rather than in a design tool: Adobe sells
// programmatic InDesign only with a Firefly Services contract, and Canva sells
// Autofill only with Enterprise. Neither is on this account. CSS has had
// proper print support — page boxes, bleed, crop marks — for years, and a
// headless Chrome renders it at exactly the trim a printer asks for. Adobe PDF
// Services, which IS on this account, does the part it is good at afterwards:
// assembling, numbering, and converting to PDF/X.
//
// Page count is forced to a multiple of four. A saddle-stitched magazine is
// folded sheets, and a sheet is four pages whether you filled them or not —
// the printer will add the blanks if you don't, in whatever place suits their
// imposition rather than yours.
import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import QRCode from "qrcode";
import type { Draft } from "./magazine-drafts";

const run = promisify(execFile);
const OUT = path.resolve("media/magazine");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// US magazine trim, plus an eighth of an inch of bleed on every edge.
const TRIM = { w: 8.375, h: 10.875 };
const BLEED = 0.125;
const SHEET = { w: TRIM.w + BLEED * 2, h: TRIM.h + BLEED * 2 };

// The name on every page. The company was Military Voice until 23 September
// 2026; the book is the first thing printed under the new one, so it says it
// in full on the cover and in short in every folio.
const BRAND = "MilitaryVoices";
const DOMAIN = "militaryvoices.ai";
const FOLIO = `Issue One · A publication of ${BRAND}.ai`;

type Page =
  | { kind: "cover" }
  | { kind: "host"; part: "photo" | "story" }
  | { kind: "contents" }
  | { kind: "schedule" }
  | { kind: "profile"; i: number }
  | { kind: "ad"; position: string; note: string }
  | { kind: "sponsors" }
  | { kind: "blank" };

interface Show {
  email: string;
  podcastName: string;
  hostName: string;
  branch: string;
  serviceStatus: string;
  photo: string;
  artwork: string;
  printPhoto: string;
  slotIndex: number;
  rss: string;
  youtube: string;
  draft?: Draft;
  qr: string; // inline SVG
  listenUrl: string;
}

interface Sponsor { name: string; logo: string; tier: string }
interface EventInfo { name: string; startAtUtc: string; durationHours: number; slotMinutes: number }

/**
 * Make a stored image path absolute.
 *
 * Some photos are full Supabase URLs and some are site-relative ("/riccoh.jpeg"),
 * which the browser resolves against whatever it is currently looking at. This
 * document is a file:// on disk, so a relative path resolved to the root of
 * the filesystem and every one of those pages printed with an empty frame —
 * silently, because a background-image that 404s draws nothing at all.
 */
const SITE = process.env.PUBLIC_BASE_URL || `https://www.${DOMAIN}`;

// Art that lives with the book rather than in the database: the event's own
// logo, the brand's waveform, and the one photograph of Riccoh worth
// printing. Referenced off disk because the renderer runs here — which also
// sidesteps the upload that dies on this network.
const ASSET = (name: string) => `file://${path.resolve(OUT, "assets", name)}`;
const abs = (u: string) => (!u ? "" : /^https?:\/\//i.test(u) ? u : `${SITE}${u.startsWith("/") ? "" : "/"}${u}`);

const esc = (v: string) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Straight quotes to curly ones. The drafts and the feeds they came from are
 * typed on keyboards; a printed page with inch marks for quotation marks looks
 * like a web page that got printed by accident.
 */
function curly(v: string): string {
  return String(v ?? "")
    .replace(/(^|[\s(\[{—–-])"/g, "$1“").replace(/"/g, "”")
    .replace(/(^|[\s(\[{—–“-])'/g, "$1‘").replace(/'/g, "’")
    .replace(/\s--\s/g, " — ").replace(/\.\.\./g, "…");
}
/** Escape and set: every word a reader sees from the drafts goes through here. */
const t = (v: string) => esc(curly(v));

/**
 * Names as the form received them, tidied only where the tidying is not a
 * matter of taste: a name typed all in lower case gets its capitals, and the
 * "Life- The" of a hurried hyphen becomes the dash it meant to be. Anything
 * with deliberate capitals ("#StillServing", "VET S.O.S.") is left alone.
 */
const SMALL = new Set(["a", "an", "and", "the", "of", "in", "on", "at", "to", "for", "with", "or"]);
function tidyName(v: string): string {
  let out = String(v ?? "").trim().replace(/(\w)- (\w)/g, "$1 — $2");
  if (out && out === out.toLowerCase()) {
    const words = out.split(" ");
    out = words
      .map((w, i) => (i > 0 && words[i - 1] !== "—" && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(" ");
  }
  return out;
}

/** "Army · Retired" is a form's answer; a magazine says "Army, retired". */
function serviceLine(s: Show): string {
  const branch = /not applicable/i.test(s.branch) ? "" : s.branch;
  const status = s.serviceStatus.toLowerCase();
  if (!branch && !status) return "";
  if (!branch) return s.serviceStatus;
  return status ? `${branch}, ${status}` : branch;
}

/**
 * The picture for a page, best first.
 *
 * A print original if somebody sent one, then the feed's cover art — which is
 * 1400–3000px because Apple insists — and only then the 720px web crop, which
 * prints at two and a half inches and is there to prove the layout rather than
 * to be printed. The feed art comes either from the profile, where the site
 * saved it, or from the feed the drafts were written from, which reaches the
 * shows whose profile never got that far.
 */
function bestImage(s: Show): { url: string; warn: string } {
  if (s.printPhoto) return { url: abs(s.printPhoto), warn: "" };
  if (s.artwork) return { url: abs(s.artwork), warn: "Show artwork — no photograph of the host yet" };
  if (s.draft?.artwork) return { url: s.draft.artwork, warn: "Feed artwork — no photograph of the host yet" };
  if (s.photo) return { url: abs(s.photo), warn: "720px web photo — too small to print" };
  return { url: "", warn: "No image at all" };
}

/**
 * The proof marks across the top of a page, in the margin above the live area.
 *
 * Drawn to look like a proofreader's stamp — outlined, magenta, in the slug —
 * so nobody reading the PDF on a screen takes an unapproved page for a
 * finished one, and so it is plainly something to take off rather than part
 * of the design. Build with --final and they go.
 */
const FINAL = process.argv.includes("--final");
function proofMarks(...marks: { text: string; kind?: "draft" | "note" }[]): string {
  const shown = marks.filter((m) => m.text);
  if (FINAL || !shown.length) return "";
  return `<div class="proof">${shown
    .map((m) => `<span class="proof-${m.kind ?? "note"}">${esc(m.text)}</span>`)
    .join("")}</div>`;
}

function folio(mile: string, n: number | string): string {
  return `<div class="folio"><span class="mile">${esc(mile)}</span><span>${FOLIO}</span><span>${n}</span></div>`;
}

/**
 * The cover: every show on the day, as a mosaic behind the masthead.
 *
 * The book is about thirty-odd podcasters, so the cover is too — no one face
 * on it, the day's whole line-up instead. The pictures are small (720px web
 * photos, feed artwork), which is why each tile is only an inch and a quarter
 * wide: at that size even the web photos print at well over 300 dots to the
 * inch. The mosaic sits under a navy wash that is solid behind the masthead
 * and the cover lines and thins out across the middle, so the faces carry the
 * page without a word of the type ever sitting on a busy picture.
 *
 * Tiles are laid so the middle rows — the ones the wash leaves visible — get
 * every show once before any show is repeated; the repeats go to the edges,
 * where the wash all but hides them.
 */
function coverPage(showCount: number, images: string[]): string {
  const COLS = 7, ROWS = 8;
  const visible = [2, 3, 4, 5, 6]; // rows the wash leaves open, best first
  const order = [...visible, 1, 7, 0];
  const cells: string[] = new Array(COLS * ROWS).fill("");
  let k = 0;
  // Spread neighbours apart: step through the list by a stride coprime with
  // its length, so the same show never sits beside itself.
  const stride = images.length % 5 === 0 ? 7 : 5;
  for (const row of order) {
    for (let c = 0; c < COLS; c++) cells[row * COLS + c] = images.length ? images[(k++ * stride) % images.length] : "";
  }
  const tiles = cells
    .map((u) => `<div class="cv-tile"${u ? ` style="background-image:url('${esc(u)}')"` : ""}></div>`)
    .join("");
  return `<section class="page cover">
  <div class="cover-field"></div>
  <div class="cv-mosaic">${tiles}</div>
  <div class="cv-wash"></div>
  <div class="live" style="display:flex;flex-direction:column">
    <div class="cover-top">
      <img class="cover-wave" src="${ASSET("logo-wave.png")}" alt="">
      <div class="kicker" style="color:var(--amber)">National Military Podcast Day · 5 October 2026</div>
    </div>
    <div class="masthead" style="margin-top:12pt">Military<br>Voices<span class="dot">.ai</span></div>
    <div class="rule-amber" style="margin-top:14pt"></div>
    <div class="coverline" style="margin-top:10pt;max-width:4.3in">
      ${esc(numberWord(showCount))} shows. Twenty-six point two miles.<br>One day on the air.
    </div>

    <div class="cv-foot">
      <div class="cv-lines">
        <div class="cv-issue">Issue One</div>
        <div class="coverline cv-lead"><b>Every show, a page of its own</b><br>
          <span>The podcasters of the Podcast Marathon</span></div>
        <div class="coverline cv-sub"><b>Col. Riccoh Player</b> on sixteen hours at the desk</div>
      </div>
      <img class="cv-seal" src="${ASSET("nmpd-logo.jpg")}" alt="">
    </div>
    <div class="cv-pub">A publication of ${BRAND}.ai · www.${DOMAIN}</div>
  </div>${crops()}
</section>`;
}

const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty"];
function numberWord(n: number): string {
  if (n < 20) return WORDS[n];
  if (n < 60) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${WORDS[n % 10].toLowerCase()}` : "");
  return String(n);
}

/**
 * The host, as a spread: his photograph on the left, his story on the right.
 *
 * The photograph is 910 pixels wide, so it is framed rather than bled — at
 * 3.9 inches it prints at about 230 dots to the inch, which is honest; run
 * across a whole page it would be a hundred and soft.
 *
 * What the page says about him comes from three places, and nowhere else:
 * the booking (he opens and closes the day, with Jane Babcock beside him for
 * the opening), the WARRIOR Legacy Network's feed (which credits him as
 * "Col. Riccoh Player (USMC, Ret.)", a co-host there), and the host section of
 * our own sponsor page (thirty-three years in the Marine Corps, five combat
 * tours, an Emmy). Anything that needs his own voice is left as a placeholder
 * for him to fill, and the whole spread is marked as a draft until he has
 * read it.
 */
interface HostInfo {
  opens: string; closes: string; closingName: string; cohost: string;
  warriorPage: number | undefined; shows: number; hours: number; qr: string;
}

function hostPhotoPage(pageNo: number, h: HostInfo): string {
  return `<section class="page host-photo">
  ${proofMarks({ text: "Draft — awaiting Riccoh's approval", kind: "draft" })}
  <div class="live" style="display:flex;flex-direction:column">
    <div class="kicker" style="color:var(--amber)">The host of the day</div>
    <div class="hp-row">
      <div class="hp-frame" style="background-image:url('${ASSET("riccoh-emmy.jpg")}')"></div>
      <div class="hp-facts">
        <div><b>33</b><span>years in the Marine Corps</span></div>
        <div><b>5</b><span>combat tours</span></div>
        <div><b>${h.hours}</b><span>hours on the air, 5 October</span></div>
        <div><b>${h.shows}</b><span>shows on the line-up</span></div>
      </div>
    </div>
    <div class="hp-name">Riccoh<br>Player</div>
    <div class="hp-caption">Col. Riccoh Player, USMC (Ret.), with his Emmy</div>
  </div>
  ${folio("The host", pageNo)}
  ${crops()}
</section>`;
}

function hostStoryPage(pageNo: number, h: HostInfo): string {
  return `<section class="page host-story">
  ${proofMarks({ text: "Draft — awaiting Riccoh's approval", kind: "draft" }, { text: "His own words still to come" })}
  <div class="live" style="display:flex;flex-direction:column">
    <div class="p-show">The host · Riccoh Player</div>
    <div class="showname hs-headline">Sixteen hours at the desk</div>
    <p class="standfirst hs-standfirst">He opens National Military Podcast Day at ${esc(h.opens)} on Monday 5 October
      and closes it at ${esc(h.closes)}. In between, ${esc(numberWord(h.shows).toLowerCase())} military and
      veteran podcasts take the air, one after another, live — and Col. Riccoh Player is the host of it all.</p>

    <div class="pull hs-pull"><span class="ph">[PULL QUOTE — one line from Riccoh, in his own words: why a whole day, and why these shows]</span></div>

    <div class="p-body hs-body">
      <h3 class="xhead">Thirty-three years, then a microphone</h3>
      <p class="lede">Riccoh Player spent thirty-three years in the Marine Corps and served five combat tours,
        retiring as a colonel. He is also an Emmy winner — that is the award in his hands on the facing
        page.</p>
      <p>He co-hosts the WARRIOR Legacy Network podcast with Zachary Green and LtCol Oliver Stolley, a show built
        to help veterans make the move from active duty to civilian life — mentorship, the Transition
        Assistance Program, and the network a veteran needs when the formation is gone${h.warriorPage ? ` (page ${h.warriorPage})` : ""}.
        His own show is the <i>Devil Dawg Double Dare Podcast</i>.</p>
      <h3 class="xhead">Opening and closing the day</h3>
      <p>On the day he is the constant. He opens at ${esc(h.opens)} Eastern with the Welcoming Ceremonies,
        ${h.cohost ? `with ${esc(h.cohost)} beside him, ` : ""}and closes at ${esc(h.closes)} with the
        ${esc(h.closingName)}. Every show in this book goes on the air between those two moments.</p>
      <p class="ph">[IN HIS OWN WORDS — why he built the day, what sixteen hours on the air asks of somebody,
        and what he wants a listener to take from it. A hundred words, from Riccoh.]</p>
    </div>

    <div class="hs-day">
      <div class="hs-stop"><b>${esc(h.opens)}</b><span>Welcoming Ceremonies</span>${h.cohost ? `<i>with ${esc(h.cohost)}</i>` : ""}</div>
      <div class="hs-line"><span>${h.shows} shows · ${h.hours} hours · one after another</span></div>
      <div class="hs-stop hs-end"><b>${esc(h.closes)}</b><span>${esc(h.closingName)}</span><i>Eastern time</i></div>
    </div>

    <div class="p-foot hs-foot">
      <div class="hs-show">
        <img src="${ASSET("devil-dawg-logo.jpg")}" alt="">
        <div>
          <div class="latest-k">His show</div>
          <div class="latest-t">Devil Dawg Double Dare Podcast</div>
          <div class="latest-s">On Instagram @riccoh_player · co-host, WARRIOR Legacy Network</div>
        </div>
      </div>
      <div class="listen-block">
        <div class="qr">${h.qr}</div>
        <div class="listen">Scan for the day<br><b>${esc(DOMAIN)}</b><br>
          <span class="listen-note">The running order, live from ${esc(h.opens)} Eastern</span></div>
      </div>
    </div>
  </div>
  ${folio("The host", pageNo)}
  ${crops()}
</section>`;
}

function contentsPage(rows: { name: string; host: string; page: number }[], pageNo: number, schedulePage: number): string {
  const html = rows
    .map((r, i) => `<div class="toc-row"><span class="toc-n">${i + 1}</span>
      <span class="toc-text"><span class="toc-name">${esc(r.name)}</span><span class="toc-host">${esc(r.host)}</span></span>
      <span class="toc-p">${r.page}</span></div>`)
    .join("");
  return `<section class="page">
  <div class="live" style="display:flex;flex-direction:column">
    <div class="kicker" style="color:var(--amber)">Issue One · October 2026</div>
    <div class="showname" style="margin-top:8pt;font-size:36pt">Contents</div>
    <div class="toc-intro">Every show on the line-up for National Military Podcast Day, in the order
      they go on the air on Monday 5 October — each with a page of its own. The running order,
      with times, is on page ${schedulePage}.</div>
    <div class="toc">${html}</div>
    <div class="toc-foot">
      <img src="${ASSET("logo-wave.png")}" alt="" style="height:18pt">
      <span>A publication of ${BRAND}.ai · www.${DOMAIN}</span>
    </div>
  </div>
  ${folio("Contents", pageNo)}
  ${crops()}
</section>`;
}

/** Feed hosts as a reader would say them: "anchor.fm", "coldwarconversations.com". */
const hostOf = (u: string) => {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
};

/** "Fri, 18 Sep 2026 23:00:00 -0000" → "18 September 2026". */
function niceDate(d: string): string {
  const t = Date.parse(d);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * A show's page.
 *
 * The picture is contained, not bled. Most of these are cover artwork rather
 * than a photograph, and a logo enlarged to four and a half inches and run off
 * three edges is a badge magnified past its purpose — it stops being a mark
 * and becomes wallpaper. Artwork gets a square, which is the shape it was
 * drawn in; a photograph of a person gets a portrait. The page is then mostly
 * type and paper, which is what a magazine is.
 *
 * The words are the draft from magazine-drafts.ts, written from the show's own
 * feed. Where there is no draft there was no feed to write it from, and the
 * page says so in a placeholder rather than making something up.
 */
function profilePage(s: Show, pageNo: number): string {
  const { url, warn } = bestImage(s);
  const d = s.draft?.status === "draft" ? s.draft : undefined;
  const square = !s.printPhoto; // artwork and web crops are square; a print photo is not
  const service = serviceLine(s);

  const body = d
    ? d.sections
        .map((sec, i) => `<h3 class="xhead">${t(sec.heading)}</h3>${sec.body
          .map((p, j) => `<p${i === 0 && j === 0 ? ' class="lede"' : ""}>${t(p)}</p>`)
          .join("")}`)
        .join("")
    : `<p class="ph ph-body">[PROFILE — no podcast feed we could read is on file for this show
      (${esc(s.rss || s.youtube || "no links at all")}). It needs a feed, or a few lines from
      ${esc(s.hostName)}, before it can be drafted.]</p>`;

  const latest = d?.latestEpisode;
    // Hosts, not URLs, and only the first two: the credit is that it came from
  // their own feed, and a line of tracking-laden links is noise at 6pt.
  const sources = d ? [...new Set(d.sources.map(hostOf).filter((h) => h && h.length <= 34))].slice(0, 2) : [];

  return `<section class="page profile">
  ${proofMarks(
    { text: d ? "Draft — awaiting approval" : "No draft — no source", kind: "draft" },
    { text: warn },
    { text: d?.thin ? "Thin source" : "" },
  )}
  <div class="live">
    <div class="p-head">
      <div class="p-head-text">
        ${d ? `<div class="p-show">${esc(s.podcastName)}</div>` : ""}
        <div class="showname p-headline">${d ? t(d.headline) : esc(s.podcastName)}</div>
        <div class="hostline" style="margin-top:9pt">${esc(s.hostName)}${service ? `<span class="svc"> · ${esc(service)}</span>` : ""}</div>
        ${d?.standfirst ? `<p class="standfirst">${t(d.standfirst)}</p>` : ""}
      </div>
      ${
        url
          ? `<div class="p-art ${square ? "is-square" : "is-portrait"}" style="background-image:url('${esc(url)}')"></div>`
          : `<div class="p-art is-square portrait-missing"></div>`
      }
    </div>

    ${
      d?.pullQuote
        ? `<blockquote class="pull p-pull">“${t(d.pullQuote.text.replace(/^["“]|["”]$/g, ""))}”<cite>From ${t(d.pullQuote.from)}</cite></blockquote>`
        : d ? "" : `<div class="pull p-pull"><span class="ph">[PULL QUOTE — only from the show's own words]</span></div>`
    }

    <div class="p-body">${body}</div>

    <div class="p-foot">
      ${
        latest
          ? `<div class="latest">
        <div class="latest-k">Latest episode${latest.date ? ` · ${esc(niceDate(latest.date))}` : ""}</div>
        <div class="latest-t">${t(latest.title)}</div>
        <div class="latest-s">${t(latest.summary)}</div>
        ${d?.tags?.length ? `<div class="tags">${d.tags.slice(0, 5).map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : ""}
      </div>`
          : `<div class="latest"><div class="latest-k">Latest episode</div><div class="latest-s ph">[no episodes on file]</div></div>`
      }
      <div class="listen-block">
        <div class="qr">${s.qr}</div>
        <div class="listen">
          Scan to listen<br>
          <b>${esc(DOMAIN)}</b><br>
          <span class="listen-note">The show's page on the running order, with every place to hear it</span>
        </div>
      </div>
    </div>
    ${sources.length ? `<div class="sources">Drafted from the show's own feed and episodes: ${sources.map(esc).join(" · ")}</div>` : ""}
  </div>
  ${folio(s.slotIndex >= 0 ? `Slot ${s.slotIndex + 1}` : "", pageNo)}
  ${crops()}
</section>`;
}

/**
 * The running order: every show, with its time, on one page.
 *
 * The one page of the book somebody will tear out and stick on a wall on the
 * day, so it is set as a timetable rather than as prose — Eastern time, which
 * is what the whole event runs on, with the page each show is on beside it.
 */
interface Slot { slotIndex: number; podcastName: string; hostName: string; page?: number }

const slotTime = (ev: EventInfo, i: number) =>
  new Date(Date.parse(ev.startAtUtc) + i * ev.slotMinutes * 60000)
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
    .replace(" AM", " am").replace(" PM", " pm");

function runningOrderPage(ev: EventInfo, shows: Slot[], showCount: number, pageNo: number): string {
  const slots = Math.floor((ev.durationHours * 60) / ev.slotMinutes);
  const at = (i: number) => slotTime(ev, i);
  const outside = shows.filter((s) => s.slotIndex >= slots);
  const rows = shows
    .map((s) => `<div class="ro-row${s.slotIndex >= slots ? " ro-out" : ""}">
      <span class="ro-t">${at(s.slotIndex)}</span>
      <span class="ro-name">${esc(s.podcastName)}<span class="ro-host">${esc(s.hostName)}</span></span>
      <span class="ro-p">${s.page ?? ""}</span></div>`)
    .join("");
  return `<section class="page">
  ${proofMarks(outside.length ? { text: `${outside.map((s) => s.podcastName).join(", ")}: slot outside the ${ev.durationHours}-hour day — check` } : { text: "" })}
  <div class="live" style="display:flex;flex-direction:column">
    <div class="kicker" style="color:var(--amber)">Monday 5 October 2026 · All times Eastern</div>
    <div class="showname" style="margin-top:8pt;font-size:36pt">The running order</div>
    <div class="toc-intro">${esc(numberWord(showCount))} shows, one after another, ${ev.slotMinutes} minutes apiece —
      live at www.${DOMAIN}/watch from ${at(0)} until the last one signs off.</div>
    <div class="ro">${rows}</div>
  </div>
  ${folio("Running order", pageNo)}
  ${crops()}
</section>`;
}

function adPage(position: string, note: string): string {
  return `<section class="page">
  <div class="ad-frame">
    <div class="kicker" style="color:var(--amber)">Advertising</div>
    <div class="ad-pos" style="margin-top:10pt">${esc(position)}</div>
    <div class="ad-spec" style="margin-top:8pt;color:#8b91a0">${esc(note)}</div>
    <div class="ad-spec" style="margin-top:26pt">
      <span class="n">${SHEET.w} × ${SHEET.h} in</span> &nbsp;supplied size, including bleed<br>
      <span class="n">${TRIM.w} × ${TRIM.h} in</span> &nbsp;trim<br>
      <span class="n">0.375 in</span> &nbsp;safety margin — keep type inside it<br>
      PDF/X-1a or PDF/X-4 · CMYK · images 300 dpi · fonts embedded
    </div>
    <div class="ad-spec" style="margin-top:22pt;font-size:8pt">To book this page: hello@${DOMAIN}</div>
  </div>
  <div class="safe-line"></div>${crops()}
</section>`;
}

/**
 * The sponsor wall, from the sponsors table.
 *
 * On navy, because two of the four logos are white-on-transparent and vanish
 * on paper. The files on the site are web logos, a hundred and forty pixels
 * wide in places — fine for proving the page, not for printing it, and the
 * page says so until vector files arrive.
 */
function sponsorsPage(sponsors: Sponsor[], pageNo: number): string {
  const tiles = sponsors
    .map((sp) => `<div class="sp-tile"><img src="${esc(abs(sp.logo))}" alt="${esc(sp.name)}"><span>${esc(sp.name)}</span></div>`)
    .join("");
  return `<section class="page sponsors">
  ${proofMarks({ text: "Web logos — vector files needed for print" })}
  <div class="live" style="display:flex;flex-direction:column">
    <div class="kicker" style="color:var(--amber)">With thanks</div>
    <div class="showname" style="margin-top:8pt;font-size:30pt;color:#fff">The people who<br>paid for the day</div>
    <div class="body" style="margin-top:14pt;max-width:4.6in;color:rgba(255,255,255,.78)">
      <p>Sixteen hours of military and veteran podcasting, live and in one place. These are
      the companies whose support put it on the air.</p>
    </div>
    <div class="sp-grid">${tiles || `<p class="ph">[SPONSOR WALL]</p>`}</div>
    <div class="sp-cta">Sponsor the next one: <b>hello@${DOMAIN}</b></div>
  </div>
  ${folio("Thanks", pageNo)}
  ${crops()}
</section>`;
}

function blankPage(): string {
  return `<section class="page">
  ${proofMarks({ text: "Pads the signature to a multiple of four — sell it, or leave it for notes" })}
  <div class="live notes-page">
    <div class="kicker" style="color:var(--amber)">Notes</div>
    <div class="notes-lines"></div>
  </div>${crops()}</section>`;
}

function crops(): string {
  return `<i class="crop tl-v"></i><i class="crop tl-h"></i><i class="crop tr-v"></i><i class="crop tr-h"></i>
  <i class="crop bl-v"></i><i class="crop bl-h"></i><i class="crop br-v"></i><i class="crop br-h"></i>`;
}

/**
 * A QR code as inline SVG, so it prints as sharp as the type around it.
 *
 * It points at the show's own card on the running order (/agenda?slot=N, the
 * same link podcasters already share), which opens their profile and every
 * link they gave us — one address that outlives whichever app the reader
 * uses. Error correction at M: enough to survive a scuffed page, small enough
 * to stay readable at an inch.
 */
async function qrFor(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: "svg", errorCorrectionLevel: "M", margin: 0,
    color: { dark: "#000741", light: "#0000" },
  });
}

async function main() {
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });
  const rows = await sql<any[]>`
    SELECT DISTINCT ON (s.email) s.email, s.podcast_name, s.host_name, s.branch, s.service_status,
           s.photo_url, s.slot_index, coalesce(p.artwork_print_url,'') AS artwork,
           coalesce(p.photo_original_url,'') AS print_photo,
           coalesce(nullif(p.rss_url,''), s.rss_url, '') AS rss,
           coalesce(nullif(p.youtube_url,''), s.youtube_url, '') AS youtube
    FROM signups s LEFT JOIN podcaster_profiles p ON p.email = s.email
    WHERE s.event_id = 1 AND s.status <> 'cancelled'
    ORDER BY s.email, s.slot_index`;
  // Every booked slot, for the running order. The rows above are one per
  // podcaster, which is right for the profiles but drops Riccoh's second slot —
  // the closing ceremony — from the timetable.
  const allSlots = await sql<any[]>`
    SELECT slot_index, podcast_name, host_name, lower(trim(email)) AS email, co_host_email
    FROM signups WHERE event_id = 1 AND status <> 'cancelled' ORDER BY slot_index`;
  const cohostEmails = allSlots.map((r) => String(r.co_host_email || "").trim().toLowerCase()).filter(Boolean);
  const cohostRows = cohostEmails.length
    ? await sql<any[]>`SELECT lower(email) AS email, host_name FROM podcaster_profiles WHERE lower(email) IN ${sql(cohostEmails)}`
    : [];
  const [evRow] = await sql<any[]>`
    SELECT name, start_at_utc, duration_hours, slot_minutes FROM events WHERE id = 1`;
  const sponsorRows = await sql<any[]>`
    SELECT name, logo_url, tier FROM sponsors
    WHERE active AND event_id IN (0, 1) AND logo_url <> ''
    ORDER BY CASE tier WHEN 'presenting' THEN 0 WHEN 'official' THEN 1 ELSE 2 END, sort_order, id`;
  await sql.end();

  const drafts: Record<string, Draft> = JSON.parse(
    await fs.readFile(path.join(OUT, "drafts.json"), "utf8").catch(() => "{}"),
  );

  const shows: Show[] = await Promise.all(
    rows.map(async (r) => {
      const email = String(r.email).trim().toLowerCase();
      const listenUrl = `${SITE}/agenda?slot=${r.slot_index}`;
      return {
        email, podcastName: tidyName(r.podcast_name), hostName: tidyName(r.host_name), branch: r.branch,
        serviceStatus: r.service_status, photo: r.photo_url, artwork: r.artwork,
        printPhoto: r.print_photo, slotIndex: r.slot_index, rss: r.rss, youtube: r.youtube,
        draft: drafts[email], listenUrl, qr: await qrFor(listenUrl),
      };
    }),
  );
  shows.sort((a, b) => a.slotIndex - b.slotIndex);
  const ev: EventInfo = {
    name: evRow.name, startAtUtc: evRow.start_at_utc, durationHours: evRow.duration_hours, slotMinutes: evRow.slot_minutes,
  };
  const sponsors: Sponsor[] = sponsorRows.map((r) => ({ name: r.name, logo: r.logo_url, tier: r.tier }));

  // Riccoh's opening slot is the editorial on page 2, written by hand; giving
  // it a drafted show page as well would print him twice.
  const riccoh = shows.find((s) => /riccoh/i.test(s.hostName));
  const profiled = shows.filter((s) => s !== riccoh);

  // The order of the book. Covers are C1–C4 and are sold by those names.
  const pages: Page[] = [
    { kind: "cover" },
    { kind: "host", part: "photo" },
    { kind: "host", part: "story" },
    { kind: "contents" },
    { kind: "schedule" },
    { kind: "ad", position: "Front of book — full page", note: "Premium. The first ad anybody sees, facing the first show." },
  ];
  profiled.forEach((_, i) => {
    pages.push({ kind: "profile", i });
    // An ad every four shows: often enough to sell, rare enough that the book
    // still reads as a magazine rather than a catalogue.
    if ((i + 1) % 4 === 0 && i + 1 < profiled.length) {
      pages.push({ kind: "ad", position: "Full page, run of book", note: `After show ${i + 1}` });
    }
  });
  pages.push({ kind: "sponsors" });
  pages.push({ kind: "ad", position: "C3 — inside back cover", note: "Premium position." });
  pages.push({ kind: "ad", position: "C4 — outside back cover", note: "The most expensive page in the book." });

  // Saddle stitch: a sheet is four pages whether you filled them or not.
  // The spare pages go to advertising, halfway between the regular ads so no
  // two land together — three blank pages at the back of a first issue read
  // as a book that ran out of things to say. Blanks only if the gaps run out.
  for (const after of [2, 10, 18, 26, 6, 14, 22]) {
    if (pages.length % 4 === 0) break;
    const at = pages.findIndex((p) => p.kind === "profile" && p.i === after - 1);
    if (at < 0 || after >= profiled.length) continue;
    pages.splice(at + 1, 0, { kind: "ad", position: "Full page, run of book", note: `After show ${after}` });
  }
  while (pages.length % 4 !== 0) pages.splice(pages.length - 3, 0, { kind: "blank" });

  // Page numbers from where things actually landed, not from arithmetic that
  // silently goes wrong the day an ad moves.
  const pageOf = new Map<number, number>();
  pages.forEach((p, n) => p.kind === "profile" && pageOf.set(p.i, n + 1));
  const pageForShow = new Map<Show, number>(profiled.map((s, i) => [s, pageOf.get(i)!]));
  const hostPage = pages.findIndex((p) => p.kind === "host" && p.part === "story") + 1;
  if (riccoh) pageForShow.set(riccoh, 3);
  const toc = shows.map((s) => ({ name: s.podcastName, host: s.hostName, page: pageForShow.get(s)! }));
  const schedulePage = pages.findIndex((p) => p.kind === "schedule") + 1;

  const pageByEmail = new Map(shows.map((s) => [s.email, pageForShow.get(s)]));
  const slotList: Slot[] = allSlots.map((r) => ({
    slotIndex: r.slot_index, podcastName: tidyName(r.podcast_name), hostName: tidyName(r.host_name),
    page: /riccoh/i.test(r.host_name) ? hostPage : pageByEmail.get(r.email),
  }));

  const opening = allSlots.find((r) => r.slot_index === riccoh?.slotIndex);
  const closing = allSlots.filter((r) => /riccoh/i.test(r.host_name)).at(-1);
  const cohostName = cohostRows.find((c) => c.email === String(opening?.co_host_email || "").trim().toLowerCase())?.host_name ?? "";
  const hostInfo: HostInfo = {
    opens: slotTime(ev, opening?.slot_index ?? 0),
    closes: slotTime(ev, closing?.slot_index ?? 0),
    closingName: tidyName(closing?.podcast_name ?? "closing ceremony"),
    cohost: cohostName.trim(),
    warriorPage: pageForShow.get(profiled.find((s) => /warrior legacy/i.test(s.podcastName))!),
    shows: profiled.length,
    hours: ev.durationHours,
    qr: await qrFor(`${SITE}/agenda`),
  };

  // The cover's mosaic: the picture each show's page already uses.
  const coverImages = shows.map((s) => bestImage(s).url).filter(Boolean);

  const html = pages
    .map((p, n) => {
      const no = n + 1;
      switch (p.kind) {
        case "cover": return coverPage(profiled.length, coverImages);
        case "host": return p.part === "photo" ? hostPhotoPage(no, hostInfo) : hostStoryPage(no, hostInfo);
        case "contents": return contentsPage(toc, no, schedulePage);
        case "schedule": return runningOrderPage(ev, slotList, profiled.length, no);
        case "profile": return profilePage(profiled[p.i], no);
        case "ad": return adPage(p.position, p.note);
        case "sponsors": return sponsorsPage(sponsors, no);
        case "blank": return blankPage();
      }
    })
    .join("\n");

  const css = await fs.readFile(path.resolve("scripts/magazine.css"), "utf8");
  const doc = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>${BRAND}.ai — Issue One</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,600;0,9..144,900;1,9..144,300;1,9..144,400&family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
<style>${css}</style></head><body>${html}
<script>
// Copyfitting, done the way a sub-editor would: a page that runs long is set a
// little tighter, one step at a time, and a page that runs short is set a
// little looser so it doesn't end in an inch of bare paper. Anything still too
// long after the last step is marked on the proof rather than left for a
// reader to find. Runs once the fonts are in, because before that every
// measurement is of Georgia.
document.fonts.ready.then(() => {
  const PX_PER_IN = 96;
  for (const live of document.querySelectorAll(".profile .live")) {
    const page = live.closest(".page");
    const foot = live.querySelector(".p-foot"), body = live.querySelector(".p-body");
    const over = () => live.scrollHeight > live.clientHeight + 1 ||
      body.getBoundingClientRect().bottom > foot.getBoundingClientRect().top - 8;
    const gap = () => foot.getBoundingClientRect().top - body.getBoundingClientRect().bottom;
    if (!over() && gap() > 0.9 * PX_PER_IN) {
      page.classList.add("fit-loose");
      if (over()) page.classList.remove("fit-loose");
    }
    for (const step of ["fit-1", "fit-2", "fit-3"]) {
      if (!over()) break;
      page.classList.add(step);
    }
    if (over()) {
      page.dataset.overflow = "1";
      const m = document.createElement("div");
      m.className = "overflow-mark"; m.textContent = "OVERFLOW — cut the copy";
      page.appendChild(m);
    }
  }
});
</script></body></html>`;

  await fs.mkdir(OUT, { recursive: true });
  const htmlPath = path.join(OUT, "issue-one.html");
  const pdfPath = path.join(OUT, "issue-one.pdf");
  await fs.writeFile(htmlPath, doc);

  await run(CHROME, [
    "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
    "--virtual-time-budget=60000", `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`,
  ]).catch(() => {});

  const counts = pages.reduce<Record<string, number>>((a, p) => ({ ...a, [p.kind]: (a[p.kind] ?? 0) + 1 }), {});
  const noPrint = profiled.filter((s) => !s.printPhoto).length;
  const noImage = profiled.filter((s) => !bestImage(s).url).length;
  const drafted = profiled.filter((s) => s.draft?.status === "draft");

  console.log(`${pages.length} pages (${pages.length / 4} sheets)`);
  for (const [k, v] of Object.entries(counts)) console.log(`   ${String(v).padStart(3)}  ${k}`);
  console.log(`\n${drafted.length} of ${profiled.length} show pages carry a draft; the rest are placeholders:`);
  for (const s of profiled.filter((s) => s.draft?.status !== "draft")) console.log(`   – ${s.podcastName} (${s.hostName})`);
  console.log(`\n${profiled.length - noPrint} of ${profiled.length} shows have a print-quality photograph.`);
  console.log(`${noPrint - noImage} fall back to artwork or a web photo. ${noImage} have nothing printable.`);
  console.log(`\n${pdfPath}`);
  if (process.argv.includes("--open")) await run("open", [pdfPath]).catch(() => {});
}

main();
