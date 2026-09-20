// Pull every podcaster's show artwork at print resolution, from their own feed.
//
//   npx tsx scripts/pull-artwork.ts            # what it would take
//   npx tsx scripts/pull-artwork.ts --apply    # take it
//
// Apple requires podcast cover art between 1400 and 3000 pixels square, so
// every feed already carries the one high-resolution image of a show that
// exists — and nobody has to be emailed for it. The copy the site holds is a
// 720px crop, which prints at 2.4 inches. The feed's copy prints at ten.
//
// This does not solve the harder half. Cover art is a logo, and a magazine
// page about a person wants a photograph of that person. What it does is take
// the third of the lineup whose page would otherwise have been a blurry
// wordmark and make it printable, today, over an API, for nothing.
import "dotenv/config";
import postgres from "postgres";
import { uploadPhoto } from "../server/photoStorage.js";

const apply = process.argv.includes("--apply");
// Re-hosting means an upload, and an upload from this laptop dies on `bad
// record mac` — something on the network inspects TLS. So the default records
// where the artwork is, which needs no upload and works from anywhere, and
// --rehost takes our own copy when this is run somewhere that can (the VPS,
// which is where upload-via-vps.ts sends bytes for the same reason).
const rehost = process.argv.includes("--rehost");
const MIN_EDGE = 1400; // below this it is not worth storing a second copy

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });

// The column may not exist yet if this runs before the deploy that adds it.
// schemaSync does the same on boot, so the order of the two does not matter.
await sql.unsafe(
  `ALTER TABLE podcaster_profiles ADD COLUMN IF NOT EXISTS artwork_print_url text NOT NULL DEFAULT ''`,
);

/** Width and height from the file header, without decoding the image. */
function dims(b: Buffer): [number, number] | null {
  if (b[0] === 0x89 && b[1] === 0x50) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

/** `<itunes:image href>` first, the RSS `<image><url>` second. */
function artworkFrom(xml: string): string | null {
  const m =
    xml.match(/<itunes:image[^>]*href=["']([^"']+)/i) ??
    xml.match(/<image>[\s\S]*?<url>\s*([^<\s]+)/i);
  return m ? m[1].trim() : null;
}

const rows = await sql<{ email: string; podcast_name: string; rss_url: string; artwork_print_url: string }[]>`
  SELECT DISTINCT ON (s.email) s.email, s.podcast_name,
         coalesce(p.rss_url, '') AS rss_url, coalesce(p.artwork_print_url, '') AS artwork_print_url
  FROM signups s LEFT JOIN podcaster_profiles p ON p.email = s.email
  WHERE s.event_id = 1 AND s.status <> 'cancelled' AND coalesce(p.rss_url, '') <> ''
  ORDER BY s.email, s.slot_index`;

console.log(`${rows.length} feeds to read\n`);

let took = 0;
let already = 0;
let tooSmall = 0;
let failed = 0;

for (const r of rows) {
  const label = r.podcast_name.slice(0, 38).padEnd(40);
  if (r.artwork_print_url) { already++; console.log(`  have   ${label}`); continue; }
  try {
    const xml = await (await fetch(r.rss_url, { signal: AbortSignal.timeout(20_000) })).text();
    const href = artworkFrom(xml);
    if (!href) { failed++; console.log(`  none   ${label} (no artwork in the feed)`); continue; }

    const buf = Buffer.from(await (await fetch(href, { signal: AbortSignal.timeout(30_000) })).arrayBuffer());
    const d = dims(buf);
    if (!d || Math.max(...d) < MIN_EDGE) {
      tooSmall++;
      console.log(`  small  ${label} ${d ? d.join("x") : "unreadable"}`);
      continue;
    }

    const inches = (Math.max(...d) / 300).toFixed(1);
    console.log(`  TAKE   ${label} ${d.join("x")}  (${inches}in at 300dpi)`);
    took++;
    if (!apply) continue;

    let stored = href;
    if (rehost) {
      const type = buf[0] === 0x89 ? "image/png" : "image/jpeg";
      const ext = type === "image/png" ? "png" : "jpg";
      const name = `artwork/${Date.now()}-${r.email.replace(/[^a-z0-9]/gi, "").slice(0, 12)}.${ext}`;
      stored = await uploadPhoto(name, buf, type);
    }
    await sql`UPDATE podcaster_profiles SET artwork_print_url = ${stored} WHERE email = ${r.email}`;
  } catch (err) {
    failed++;
    console.log(`  err    ${label} ${(err as Error).name}`);
  }
}

console.log(
  `\n${took} printable, ${already} already stored, ${tooSmall} too small, ${failed} unreadable.`,
);
if (took && !apply) console.log("Dry run. Add --apply to store them.");
await sql.end();
