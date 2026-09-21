// What we still need from each podcaster, in one list.
//
//   npx tsx scripts/whats-missing.ts
//   npx tsx scripts/whats-missing.ts --csv > missing.csv
//
// The gaps were scattered across four places — follower figures, feeds, print
// photographs and artwork — and each was found separately, which meant nobody
// could see that the same eight names accounted for most of them. One row per
// podcaster, one column per thing we are waiting on.
//
// Feeds are fetched live rather than trusted, because a URL on file is not the
// same as a feed that answers: two hosts stored a YouTube playlist where a
// channel should be, and one link 404s.
import "dotenv/config";
import postgres from "postgres";

const csv = process.argv.includes("--csv");
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });

interface Row {
  host_name: string;
  podcast_name: string;
  email: string;
  slot_index: number;
  rss: string;
  youtube: string;
  links: string;
  print_photo: string;
  artwork: string;
  metrics: number;
}

const rows = await sql<Row[]>`
  SELECT DISTINCT ON (s.email)
    s.host_name, s.podcast_name, s.email, s.slot_index,
    coalesce(p.rss_url, '') AS rss,
    coalesce(p.youtube_url, '') AS youtube,
    coalesce(p.social_links, '') AS links,
    coalesce(p.photo_original_url, '') AS print_photo,
    coalesce(p.artwork_print_url, '') AS artwork,
    (SELECT count(*)::int FROM social_metrics m
      WHERE m.email = s.email AND coalesce(m.error, '') = '' AND m.followers > 0) AS metrics
  FROM signups s LEFT JOIN podcaster_profiles p ON p.email = s.email
  WHERE s.event_id = 1 AND s.status <> 'cancelled'
  ORDER BY s.email, s.slot_index`;
await sql.end();

/** Does the feed answer, and with how many episodes? */
async function feedEpisodes(url: string): Promise<number | null> {
  if (!url) return null;
  try {
    const xml = await (await fetch(url, { signal: AbortSignal.timeout(15_000) })).text();
    return (xml.match(/<item>/g) || []).length;
  } catch {
    return 0;
  }
}

const checked = await Promise.all(
  rows.map(async (r) => ({ ...r, episodes: await feedEpisodes(r.rss) })),
);
checked.sort((a, b) => a.slot_index - b.slot_index);

const need = (r: (typeof checked)[number]) => {
  const out: string[] = [];
  if (!r.print_photo) out.push("headshot");
  if (r.metrics === 0) out.push("social");
  if (!r.rss) out.push("feed URL");
  else if (!r.episodes) out.push("feed broken");
  // A playlist has no subscriber count and never will, however often we ask.
  if (/playlist\?list=/i.test(r.youtube)) out.push("YouTube is a playlist");
  return out;
};

if (csv) {
  console.log("host,show,email,needs");
  for (const r of checked) {
    const n = need(r);
    if (n.length) console.log(`"${r.host_name}","${r.podcast_name}",${r.email},"${n.join("; ")}"`);
  }
} else {
  const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s).padEnd(n);
  console.log(`${"HOST".padEnd(24)}${"SHOW".padEnd(32)}NEEDS`);
  console.log("─".repeat(92));
  let clean = 0;
  for (const r of checked) {
    const n = need(r);
    if (!n.length) { clean++; continue; }
    console.log(`${short(r.host_name, 24)}${short(r.podcast_name, 32)}${n.join(", ")}`);
  }
  console.log("─".repeat(92));
  const count = (k: string) => checked.filter((r) => need(r).includes(k)).length;
  console.log(`${checked.length} shows · ${clean} need nothing`);
  console.log(
    `headshot ${count("headshot")} · social ${count("social")} · ` +
      `feed URL ${count("feed URL")} · feed broken ${count("feed broken")} · ` +
      `playlist ${count("YouTube is a playlist")}`,
  );
}
