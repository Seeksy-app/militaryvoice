// How many episodes has this lineup actually published?
//
//   npx tsx scripts/count-episodes.ts           # count, change nothing
//   npx tsx scripts/count-episodes.ts --apply   # also save the feeds we found
//
// The sponsor page said 2,388, which is what twelve working feeds add up to.
// The other nineteen shows were not counted because we have no feed URL for
// them, or the one on file does not answer — not because they have published
// nothing. So the figure was a floor, and a low one.
//
// Apple's search endpoint is public, needs no key, and returns feedUrl, so the
// missing feeds can be found by name rather than chased by email. --apply
// writes them back to podcaster_profiles.rss_url, which is where the audience
// numbers and the artwork puller both read from: fix it once, everything
// downstream picks it up.
//
// A fuzzy name match can land on the wrong show. Anything Apple returns under
// a different title than the one we hold is listed for a human to confirm and
// is never saved, and WRONG below is the list already rejected.
import "dotenv/config";
import postgres from "postgres";

const apply = process.argv.includes("--apply");

/** Apple matches that are a different show with a similar name. */
const WRONG = new Set(["History On The Road"]);

// Apple titles that are the same show under a longer name, checked by hand.
const SAME: Record<string, string> = {
  "The Hard to Kill Podcast": "The Hard To Kill Podcast with Dave Morrow",
  "Unbreakable Storm": "The Unbreakable Storm Podcast",
};

/** podcast_name holds an episode title for at least one signup. */
const CLEAN: Record<string, string> = {
  "Today with Tally Podcast: Episode 314 with Amy Forsythe": "Today with Tally",
};

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });

interface Row { host_name: string; podcast_name: string; email: string; rss: string }
const rows = await sql<Row[]>`
  SELECT DISTINCT ON (s.email) s.host_name, s.podcast_name, s.email,
         -- Two columns hold a feed: the one the host typed when they booked,
         -- and the one on their profile. Profile first, it is the newer.
         coalesce(nullif(p.rss_url, ''), s.rss_url, '') AS rss
  FROM signups s LEFT JOIN podcaster_profiles p ON p.email = s.email
  WHERE s.event_id = 1 AND s.status <> 'cancelled'
  ORDER BY s.email, s.slot_index`;

async function countFeed(url: string) {
  try {
    const xml = await (await fetch(url, { signal: AbortSignal.timeout(20_000) })).text();
    const items = (xml.match(/<item[\s>]/g) || []).length;
    let oldest = Infinity;
    for (const d of xml.match(/<pubDate>[^<]+<\/pubDate>/g) ?? []) {
      const t = Date.parse(d.replace(/<\/?pubDate>/g, ""));
      if (t < oldest) oldest = t;
    }
    return items ? { items, oldest } : null;
  } catch { return null; }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function findFeed(name: string): Promise<{ feed: string; title: string } | null> {
  try {
    const u = `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=5&term=${encodeURIComponent(name)}`;
    const j: any = await (await fetch(u, { signal: AbortSignal.timeout(20_000) })).json();
    const want = norm(name);
    const hit = (j.results || []).find((r: any) => {
      const got = norm(r.collectionName || "");
      return got === want || got.includes(want) || want.includes(got);
    });
    return hit?.feedUrl ? { feed: hit.feedUrl, title: hit.collectionName || "" } : null;
  } catch { return null; }
}

let total = 0, counted = 0, oldestAll = Infinity;
const per: number[] = [];
const missing: string[] = [];
const confirm: string[] = [];
const found: { email: string; feed: string }[] = [];

for (const r of rows) {
  let src = "on file";
  let got = r.rss ? await countFeed(r.rss) : null;

  if (!got && !WRONG.has(r.podcast_name)) {
    const hit = await findFeed(CLEAN[r.podcast_name] ?? r.podcast_name);
    if (hit) {
      got = await countFeed(hit.feed);
      // Only an exact title match is safe to write back unattended.
      const exact = norm(hit.title) === norm(CLEAN[r.podcast_name] ?? r.podcast_name)
        || norm(hit.title) === norm(SAME[r.podcast_name] ?? "\u0000");
      src = exact ? "apple" : `apple? "${hit.title}"`;
      if (got) {
        if (exact) found.push({ email: r.email, feed: hit.feed });
        else confirm.push(`${r.podcast_name}  →  "${hit.title}" (${got.items} eps)\n      ${hit.feed}`);
      }
    }
  }

  if (got) {
    total += got.items; counted++; per.push(got.items);
    if (got.oldest < oldestAll) oldestAll = got.oldest;
    console.log(`${String(got.items).padStart(5)}  ${r.podcast_name.slice(0, 40).padEnd(42)}${src}`);
  } else {
    missing.push(r.podcast_name);
    console.log(`    ?  ${r.podcast_name.slice(0, 40).padEnd(42)}no feed found`);
  }
}

per.sort((a, b) => a - b);
console.log("\n" + "─".repeat(78));
console.log(`${total.toLocaleString()} episodes across ${counted} of ${rows.length} shows`);
console.log(`median ${per[Math.floor(per.length / 2)]} · oldest episode ${new Date(oldestAll).getUTCFullYear()}`);
if (missing.length) console.log(`\nno feed anywhere (${missing.length}): ${missing.join(", ")}`);
if (confirm.length) console.log(`\nneeds a human eye before saving:\n   ${confirm.join("\n   ")}`);

if (!found.length) {
  console.log(`\nNothing new to save.`);
} else if (!apply) {
  console.log(`\n${found.length} feeds found that we did not have. --apply to save them.`);
} else {
  // A plain UPDATE, not an upsert: podcaster_profiles carries two unique
  // indexes on email (Drizzle's _key and schemaSync's _unique), and Postgres
  // will not use an ambiguous arbiter, so ON CONFLICT (email) falls through to
  // a plain INSERT and trips the NOT NULLs. Everyone we are writing to already
  // has a row; anyone who does not is reported rather than created.
  let saved = 0;
  const noRow: string[] = [];
  for (const f of found) {
    // Both columns, or the next reader picks the blank one.
    const r = await sql`UPDATE podcaster_profiles
      SET rss_url = ${f.feed}, updated_at = now()
      WHERE email = ${f.email} RETURNING id`;
    await sql`UPDATE signups SET rss_url = ${f.feed}
      WHERE email = ${f.email} AND event_id = 1 AND coalesce(rss_url, '') = ''`;
    r.length ? saved++ : noRow.push(f.email);
  }
  if (noRow.length) console.log(`\nno profile row, skipped: ${noRow.join(", ")}`);
  console.log(`\n${saved} feeds saved.`);
}
await sql.end();
