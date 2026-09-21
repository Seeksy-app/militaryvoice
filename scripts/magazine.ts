// The magazine: every page, in order, with placeholders where the truth is
// not in yet.
//
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

const run = promisify(execFile);
const OUT = path.resolve("media/magazine");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// US magazine trim, plus an eighth of an inch of bleed on every edge.
const TRIM = { w: 8.375, h: 10.875 };
const BLEED = 0.125;
const SHEET = { w: TRIM.w + BLEED * 2, h: TRIM.h + BLEED * 2 };

type Page =
  | { kind: "cover" }
  | { kind: "editorial"; slug: "riccoh" }
  | { kind: "contents" }
  | { kind: "profile"; i: number }
  | { kind: "ad"; position: string; note: string }
  | { kind: "sponsors" }
  | { kind: "blank" };

interface Show {
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
}

/**
 * Make a stored image path absolute.
 *
 * Some photos are full Supabase URLs and some are site-relative ("/riccoh.jpeg"),
 * which the browser resolves against whatever it is currently looking at. This
 * document is a file:// on disk, so a relative path resolved to the root of
 * the filesystem and every one of those pages printed with an empty frame —
 * silently, because a background-image that 404s draws nothing at all.
 */
const SITE = process.env.PUBLIC_BASE_URL || "https://www.militaryvoice.ai";

// Art that lives with the book rather than in the database: the event's own
// logo, and the one photograph of Riccoh worth printing. Referenced off disk
// because the renderer runs here — which also sidesteps the upload that dies
// on this network.
const ASSET = (name: string) => `file://${path.resolve(OUT, "assets", name)}`;
const abs = (u: string) => (!u ? "" : /^https?:\/\//i.test(u) ? u : `${SITE}${u.startsWith("/") ? "" : "/"}${u}`);

const esc = (v: string) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The picture for a page, best first.
 *
 * A print original if somebody sent one, then the feed's cover art — which is
 * 1400–3000px because Apple insists — and only then the 720px web crop, which
 * prints at two and a half inches and is there to prove the layout rather than
 * to be printed.
 */
function bestImage(s: Show): { url: string; warn: string } {
  if (s.printPhoto) return { url: abs(s.printPhoto), warn: "" };
  if (s.artwork) return { url: abs(s.artwork), warn: "show artwork — no photograph of the host yet" };
  if (s.photo) return { url: abs(s.photo), warn: "720px — too small to print" };
  return { url: "", warn: "no image at all" };
}

/**
 * The cover.
 *
 * Built around the logo rather than a full-bleed photograph, because the best
 * picture of Riccoh is 910px wide and a full-bleed cover wants 2588 — it would
 * print at about a hundred dots to the inch, which on the one page everybody
 * looks at is not a trade worth making. A contained panel puts him at 227dpi,
 * which is honest, and the logo carries the rest of the page at 2000px square.
 *
 * With a bigger file of Riccoh this becomes a full-bleed cover in one line.
 */
function coverPage(_hero: Show | undefined): string {
  return `<section class="page cover">
  <div class="cover-field"></div>
  <div class="live" style="display:flex;flex-direction:column">
    <div class="kicker" style="color:var(--amber)">National Military Podcast Day · October 2026</div>
    <div class="masthead" style="margin-top:12pt">Military<br>Voice<span class="dot">.</span></div>
    <div class="rule-amber" style="margin-top:14pt"></div>
    <div class="coverline" style="margin-top:10pt;max-width:4.3in">
      Thirty-two shows. Twenty-six point two miles.<br>One day on the air.
    </div>

    <div class="cover-art">
      <img class="cover-logo" src="${ASSET("nmpd-logo.jpg")}" alt="">
      <div class="cover-portrait" style="background-image:url('${ASSET("riccoh-emmy.jpg")}')"></div>
    </div>

    <div style="margin-top:auto;max-width:4.8in">
      <div class="coverline" style="border-top:.75pt solid rgba(255,255,255,.28);padding-top:11pt">
        <b>Riccoh Player</b> hosts sixteen hours of it<br>
        <span class="ph" style="color:rgba(255,255,255,.45)">[SECOND COVER LINE]</span>
      </div>
      <div class="kicker" style="margin-top:13pt;opacity:.6">Issue One · militaryvoice.ai</div>
    </div>
  </div>${crops()}
</section>`;
}

function riccohPage(r: Show | undefined): string {
  const img = ASSET("riccoh-emmy.jpg");
  return `<section class="page">
  ${img ? `<div class="portrait" style="background-image:url('${esc(img)}')"></div>` : ""}
  <div class="live" style="width:3.5in">
    <span class="badge">The host</span>
    <div class="showname" style="margin-top:14pt">Riccoh<br>Player</div>
    <div class="hostline" style="margin-top:9pt">${esc(r?.podcastName ?? "Welcoming Ceremonies")}</div>
    <div class="pull" style="margin-top:20pt">
      <span class="ph">[PULL QUOTE — one line from Riccoh, in his own words]</span>
    </div>
    <div class="body" style="margin-top:20pt">
      <p class="ph">[ABOUT THE HOST — who Riccoh is, why he built this, and what
      sixteen hours on the air asks of somebody. Two to three hundred words.
      This page is the inside front cover, which is the first thing anybody
      reads, so it is the one page worth writing by hand rather than drafting.]</p>
    </div>
  </div>
  <div class="folio"><span class="mile">The host</span><span>Military Voice · Issue One</span><span>2</span></div>
  ${crops()}
</section>`;
}

function contentsPage(shows: Show[]): string {
  const rows = shows
    .map((s, i) => `<div class="toc-row"><span class="toc-n">${i + 1}</span>
      <span class="toc-name">${esc(s.podcastName)}</span>
      <span class="toc-host">${esc(s.hostName)}</span>
      <span class="toc-p">${5 + i + Math.floor(i / 4)}</span></div>`)
    .join("");
  return `<section class="page">
  <div class="live">
    <div class="kicker" style="color:var(--amber)">Issue One</div>
    <div class="showname" style="margin-top:8pt;font-size:32pt">Contents</div>
    <div style="margin-top:16pt;column-count:2;column-gap:22pt">${rows}</div>
  </div>
  <div class="folio"><span class="mile">Contents</span><span>Military Voice · Issue One</span><span>3</span></div>
  ${crops()}
</section>`;
}

/**
 * A show's page.
 *
 * The picture is contained, not bled. Two thirds of these are cover artwork
 * rather than a photograph, and a logo enlarged to four and a half inches and
 * run off three edges is a badge magnified past its purpose — it stops being a
 * mark and becomes wallpaper. Artwork gets a square, which is the shape it was
 * drawn in; a photograph of a person gets a portrait. The page is then mostly
 * type and paper, which is what a magazine is.
 */
function profilePage(s: Show, pageNo: number): string {
  const { url, warn } = bestImage(s);
  const who = [s.branch, s.serviceStatus].filter(Boolean).join(" · ");
  const square = !s.printPhoto; // artwork and web crops are square; a print photo is not
  return `<section class="page profile">
  ${warn ? `<div class="flag-tag">${esc(warn)}</div>` : ""}
  <div class="live">
    <div class="p-head">
      <div class="p-head-text">
        ${who ? `<span class="badge">${esc(who)}</span>` : ""}
        <div class="showname" style="margin-top:12pt">${esc(s.podcastName)}</div>
        <div class="hostline" style="margin-top:8pt">${esc(s.hostName)}</div>
      </div>
      ${
        url
          ? `<div class="p-art ${square ? "is-square" : "is-portrait"}" style="background-image:url('${esc(url)}')"></div>`
          : `<div class="p-art is-square portrait-missing"></div>`
      }
    </div>

    <div class="pull" style="margin-top:14pt;max-width:4.9in">
      <span class="ph">[PULL QUOTE — lifted from a transcript]</span>
    </div>

    <div class="p-body">
      <p class="ph">[PROFILE — drafted from this host's own feed and recent
      episodes, with sources, then approved by them before it prints. Two
      columns of roughly a hundred and ninety words each sits comfortably at
      this measure, which is where a page stops looking like a slide and starts
      reading like a magazine.]</p>
    </div>

    <div class="p-foot">
      <div class="qr">QR</div>
      <div class="listen" style="flex:1">Listen<br>
        <b style="font-size:9pt;text-transform:none">${esc(s.rss ? s.rss.replace(/^https?:\/\//, "").slice(0, 40) : "[feed]")}</b><br>
        <b style="font-size:9pt;text-transform:none">${esc(s.youtube ? s.youtube.replace(/^https?:\/\//, "").slice(0, 40) : "[youtube]")}</b>
      </div>
    </div>
  </div>
  <div class="folio"><span class="mile">${s.slotIndex >= 0 ? `Slot ${s.slotIndex + 1}` : ""}</span><span>Military Voice · Issue One</span><span>${pageNo}</span></div>
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
  </div>
  <div class="safe-line"></div>${crops()}
</section>`;
}

function sponsorsPage(): string {
  return `<section class="page">
  <div class="live">
    <div class="kicker" style="color:var(--amber)">With thanks</div>
    <div class="showname" style="margin-top:8pt;font-size:30pt">The people who<br>paid for the day</div>
    <div class="body" style="margin-top:22pt;max-width:4.6in">
      <p class="ph">[SPONSOR WALL — title sponsor large, then live stream,
      supporting and show sponsors. Logos supplied as vector where possible.]</p>
    </div>
  </div>
  <div class="folio"><span class="mile">Thanks</span><span>Military Voice · Issue One</span><span></span></div>
  ${crops()}
</section>`;
}

function blankPage(): string {
  return `<section class="page"><div class="live" style="display:flex;align-items:flex-end;justify-content:center">
    <span class="ph" style="font-size:8pt">[intentionally blank — pads the signature to a multiple of four]</span>
  </div>${crops()}</section>`;
}

function crops(): string {
  return `<i class="crop tl-v"></i><i class="crop tl-h"></i><i class="crop tr-v"></i><i class="crop tr-h"></i>
  <i class="crop bl-v"></i><i class="crop bl-h"></i><i class="crop br-v"></i><i class="crop br-h"></i>`;
}

async function main() {
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });
  const rows = await sql<any[]>`
    SELECT DISTINCT ON (s.email) s.podcast_name, s.host_name, s.branch, s.service_status,
           s.photo_url, s.slot_index, coalesce(p.artwork_print_url,'') AS artwork,
           coalesce(p.photo_original_url,'') AS print_photo,
           coalesce(p.rss_url,'') AS rss, coalesce(p.youtube_url,'') AS youtube
    FROM signups s LEFT JOIN podcaster_profiles p ON p.email = s.email
    WHERE s.event_id = 1 AND s.status <> 'cancelled'
    ORDER BY s.email, s.slot_index`;
  await sql.end();

  const shows: Show[] = rows
    .map((r) => ({
      podcastName: r.podcast_name, hostName: r.host_name, branch: r.branch,
      serviceStatus: r.service_status, photo: r.photo_url, artwork: r.artwork,
      printPhoto: r.print_photo, slotIndex: r.slot_index, rss: r.rss, youtube: r.youtube,
    }))
    .sort((a, b) => a.slotIndex - b.slotIndex);

  const riccoh = shows.find((s) => /riccoh/i.test(s.hostName));

  // The order of the book. Covers are C1–C4 and are sold by those names.
  const pages: Page[] = [
    { kind: "cover" },
    { kind: "editorial", slug: "riccoh" },
    { kind: "contents" },
    { kind: "ad", position: "C2 facing — full page", note: "Premium. The first ad anybody sees." },
  ];
  shows.forEach((_, i) => {
    pages.push({ kind: "profile", i });
    // An ad every four shows: often enough to sell, rare enough that the book
    // still reads as a magazine rather than a catalogue.
    if ((i + 1) % 4 === 0 && i + 1 < shows.length) {
      pages.push({ kind: "ad", position: "Full page, run of book", note: `After show ${i + 1}` });
    }
  });
  pages.push({ kind: "sponsors" });
  pages.push({ kind: "ad", position: "C3 — inside back cover", note: "Premium position." });
  pages.push({ kind: "ad", position: "C4 — outside back cover", note: "The most expensive page in the book." });

  // Saddle stitch: a sheet is four pages whether you filled them or not.
  while (pages.length % 4 !== 0) pages.splice(pages.length - 2, 0, { kind: "blank" });

  let folio = 0;
  const html = pages
    .map((p) => {
      folio++;
      switch (p.kind) {
        case "cover": return coverPage(riccoh);
        case "editorial": return riccohPage(riccoh);
        case "contents": return contentsPage(shows);
        case "profile": return profilePage(shows[p.i], folio);
        case "ad": return adPage(p.position, p.note);
        case "sponsors": return sponsorsPage();
        case "blank": return blankPage();
      }
    })
    .join("\n");

  const css = await fs.readFile(path.resolve("scripts/magazine.css"), "utf8");
  const doc = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Military Voice — Issue One</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,600;9..144,900&family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
<style>${css}</style></head><body>${html}</body></html>`;

  await fs.mkdir(OUT, { recursive: true });
  const htmlPath = path.join(OUT, "issue-one.html");
  const pdfPath = path.join(OUT, "issue-one.pdf");
  await fs.writeFile(htmlPath, doc);

  await run(CHROME, [
    "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
    "--virtual-time-budget=60000", `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`,
  ]).catch(() => {});

  const counts = pages.reduce<Record<string, number>>((a, p) => ({ ...a, [p.kind]: (a[p.kind] ?? 0) + 1 }), {});
  const noPrint = shows.filter((s) => !s.printPhoto).length;
  const noImage = shows.filter((s) => !s.printPhoto && !s.artwork).length;

  console.log(`${pages.length} pages (${pages.length / 4} sheets)`);
  for (const [k, v] of Object.entries(counts)) console.log(`   ${String(v).padStart(3)}  ${k}`);
  console.log(`\n${shows.length - noPrint} of ${shows.length} shows have a print-quality photograph.`);
  console.log(`${noPrint - noImage} fall back to feed artwork. ${noImage} have nothing printable.`);
  console.log(`\n${pdfPath}`);
  if (process.argv.includes("--open")) await run("open", [pdfPath]).catch(() => {});
}

main();
