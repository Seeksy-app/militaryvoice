// First drafts of every show's page in the magazine, written from the show's
// own feed and nothing else.
//
//   npx tsx scripts/magazine-drafts.ts                  # draft what isn't drafted yet
//   npx tsx scripts/magazine-drafts.ts --force          # redraft everything
//   npx tsx scripts/magazine-drafts.ts --only a@b.com   # redraft one show
//
// Why a feed and not a web search: the feed is what the podcaster wrote about
// themselves and chose to publish. It is the one source nobody can say we made
// up, and when the draft goes back to them for approval they will recognise
// every sentence in it. A search would find more, and some of it would be
// about somebody else with the same name.
//
// Every draft lands in media/magazine/drafts.json keyed by the podcaster's
// email, marked "draft" until they say yes. Reruns skip anything already
// drafted from the same material, so running this twice costs nothing the
// second time. Nothing here writes to the database or sends anything to
// anybody.
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import postgres from "postgres";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";

const OUT = path.resolve("media/magazine");
const DRAFTS = path.join(OUT, "drafts.json");
const MODEL = "claude-sonnet-5";

export interface Episode { title: string; description: string; link: string; date: string }
export interface Source {
  feedUrl: string;          // the feed we actually read, after resolving Apple links
  feedFoundBy: string;      // "profile", "signup", "apple-lookup", "apple-search"
  title: string;
  description: string;
  author: string;
  link: string;
  image: string;            // the feed's cover art — usually 1400–3000px
  episodes: Episode[];
}
export interface Draft {
  status: "draft" | "no-source";
  approved: false;
  email: string;
  podcastName: string;
  hostName: string;
  generatedAt: string;
  model: string;
  fingerprint: string;      // hash of the source material this was written from
  feedUrl: string;
  feedFoundBy: string;
  artwork: string;
  headline: string;
  standfirst: string;
  sections: { heading: string; body: string[] }[];
  pullQuote: { text: string; from: string } | null;
  tags: string[];
  latestEpisode: { title: string; summary: string; date: string; link: string } | null;
  sources: string[];
  thin: boolean;            // the source was too slight to say much — the draft says less
  notes: string;            // anything the model flagged for the editor
}

// ------------------------------------------------------------------ feeds

const decode = (v: string) =>
  v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&#8217;/g, "’").replace(/&#8216;/g, "‘")
    .replace(/&#8220;/g, "“").replace(/&#8221;/g, "”").replace(/&#8211;/g, "–").replace(/&#8212;/g, "—")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

/** Feed descriptions are HTML more often than not. The model wants prose. */
const plain = (html: string) =>
  decode(decode(html))
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

const tag = (xml: string, name: string) =>
  xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? "";

async function get(url: string, ms = 12000): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(ms),
      // Some hosts (Libsyn, Megaphone) answer a bare fetch with a 403.
      headers: { "user-agent": "Mozilla/5.0 (Macintosh) MilitaryVoices magazine drafts" },
      redirect: "follow",
    });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/**
 * Podcasters paste all sorts into the feed box: an Apple page, a Spotify
 * episode, a StreamYard studio, a Simplecast web page. Apple pages resolve
 * through Apple's public lookup; the rest are not feeds, and are skipped
 * rather than scraped.
 */
async function appleLookup(id: string): Promise<string> {
  const res = await get(`https://itunes.apple.com/lookup?id=${id}&entity=podcast`);
  const data = res ? ((await res.json()) as { results?: { feedUrl?: string }[] }) : null;
  return data?.results?.[0]?.feedUrl ?? "";
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Last resort for a show with no usable feed on file: ask Apple's directory
 * for it by name. Only an exact name match counts — "Unbreakable" is not
 * "Unbreakable Storm", and printing a stranger's show on somebody's page is
 * the one mistake this book cannot make.
 */
async function appleSearch(name: string, host: string): Promise<string> {
  const q = encodeURIComponent(name.replace(/podcast:.*$/i, "podcast"));
  const res = await get(`https://itunes.apple.com/search?media=podcast&entity=podcast&limit=10&term=${q}`);
  if (!res) return "";
  const data = (await res.json()) as { results?: { collectionName?: string; artistName?: string; feedUrl?: string }[] };
  const want = norm(name);
  const hostWords = norm(host).split(" ").filter((w) => w.length > 2);
  const hit = (data.results ?? []).find((r) => {
    if (!r.feedUrl) return false;
    const got = norm(r.collectionName ?? "");
    const artist = norm(r.artistName ?? "");
    return got === want || (got.length > 6 && want.startsWith(got) && hostWords.some((w) => artist.includes(w)));
  });
  return hit?.feedUrl ?? "";
}

async function readFeed(url: string): Promise<Omit<Source, "feedUrl" | "feedFoundBy"> | null> {
  const res = await get(url);
  if (!res) return null;
  const xml = await res.text();
  if (!/<rss\b|<feed\b/i.test(xml.slice(0, 2000))) return null;
  const [channel] = xml.split(/<item[\s>]/i);
  const items = xml.split(/<item[\s>]/i).slice(1, 6).map((raw) => {
    const item = raw.split(/<\/item>/i)[0];
    return {
      title: plain(tag(item, "title")),
      description: plain(tag(item, "description") || tag(item, "content:encoded") || tag(item, "itunes:summary")).slice(0, 1800),
      link: decode(tag(item, "link")).trim(),
      date: decode(tag(item, "pubDate")).trim(),
    };
  });
  const image =
    channel.match(/<itunes:image\b[^>]*href\s*=\s*["']([^"']+)["']/i)?.[1] ??
    tag(tag(channel, "image"), "url");
  return {
    title: plain(tag(channel, "title")),
    description: plain(tag(channel, "description") || tag(channel, "itunes:summary")).slice(0, 3000),
    author: plain(tag(channel, "itunes:author")),
    link: decode(tag(channel, "link")).trim(),
    image: decode(image ?? "").trim(),
    episodes: items.filter((e) => e.title),
  };
}

const isFeedish = (u: string) =>
  /^https?:\/\//i.test(u) && !/open\.spotify\.com|streamyard\.com|youtube\.com|youtu\.be/i.test(u);

export async function findSource(opts: { profileRss: string; signupRss: string; podcastName: string; hostName: string }): Promise<Source | null> {
  const tried = new Set<string>();
  const candidates: [string, string][] = [];
  for (const [raw, by] of [[opts.profileRss, "profile"], [opts.signupRss, "signup"]] as const) {
    if (!raw) continue;
    const apple = raw.match(/podcasts\.apple\.com\/.*\/id(\d+)/i)?.[1];
    if (apple) candidates.push([await appleLookup(apple), "apple-lookup"]);
    else if (isFeedish(raw)) candidates.push([raw, by]);
  }
  for (const [url, by] of candidates) {
    if (!url || tried.has(url)) continue;
    tried.add(url);
    const feed = await readFeed(url);
    if (feed && (feed.description || feed.episodes.length)) return { feedUrl: url, feedFoundBy: by, ...feed };
  }
  const found = await appleSearch(opts.podcastName, opts.hostName);
  if (found && !tried.has(found)) {
    const feed = await readFeed(found);
    if (feed && (feed.description || feed.episodes.length)) return { feedUrl: found, feedFoundBy: "apple-search", ...feed };
  }
  return null;
}

// ------------------------------------------------------------------ drafting

const Out = z.object({
  headline: z.string().describe("A magazine headline for this page, 3–9 words. Not the show's name repeated."),
  standfirst: z.string().describe("One sentence, 15–30 words, that sits under the headline and says what the show is."),
  sections: z.array(z.object({
    heading: z.string().describe("A short crosshead, 2–5 words."),
    body: z.array(z.string()).describe("One to three paragraphs."),
  })).describe("Exactly two sections. Together about 350 words when the source supports it; fewer when it does not."),
  pullQuote: z.object({
    text: z.string().describe("Copied VERBATIM, character for character, from the source text. 8–35 words."),
    from: z.string().describe("Where it came from, e.g. 'the show's description' or 'the episode \"<title>\"'."),
  }).nullable().describe("null unless there is a sentence in the source worth pulling that you can copy exactly."),
  tags: z.array(z.string()).describe("3–5 short topic tags, lower case."),
  latestEpisode: z.object({
    title: z.string(),
    summary: z.string().describe("One or two sentences on the most recent episode, from its description only."),
  }).nullable(),
  thin: z.boolean().describe("true if the source was too slight to support a full profile."),
  notes: z.string().describe("Anything the editor should check: ambiguities, things you left out, names you were unsure of. Empty string if none."),
});

const SYSTEM = `You write profile pages for the first print issue of the MilitaryVoices.ai magazine, which covers National Military Podcast Day (Monday 5 October 2026) — a sixteen-hour relay of military and veteran podcasts hosted by Riccoh Player. Each show taking part gets one page.

You are given source material about one show: its podcast feed's own description and its most recent episodes, plus what the podcaster told us when they signed up. Write the page from that material and nothing else.

The rules, which matter more than the prose:
- Every fact must be in the source. Never add military service, rank, unit, deployments, awards, education, employers, family, audience size or biography that the source does not state. The branch and service status the podcaster gave at signup may be used as stated, in plain words ("an Army veteran"), and no further.
- Do not guess what a show is "known for" or how it is received. Describe what it does.
- If the source is thin, write less. A short honest page is better than a padded one. Set thin=true.
- The pull quote must be copied exactly from the source text — same words, same order. If no sentence is both quotable and exact, return null. Never tidy, merge or paraphrase a quote.
- Episode descriptions often contain sponsor reads, links and calls to subscribe. Ignore them.
- Write in plain, warm, confident magazine English — third person, present tense, no hype, no clichés about "heroes" or "service beyond the uniform", no exclamation marks. Use the host's name as the source gives it.
- This draft goes to the podcaster for approval before it prints.`;

function brief(show: { podcastName: string; hostName: string; branch: string; serviceStatus: string }, src: Source): string {
  const eps = src.episodes
    .map((e, i) => `Episode ${i + 1}${e.date ? ` (${e.date})` : ""}: ${e.title}\n${e.description || "(no description)"}`)
    .join("\n\n");
  return `SIGNUP (what the podcaster told us)
Show: ${show.podcastName}
Host: ${show.hostName}
Branch: ${show.branch || "(not given)"}
Service status: ${show.serviceStatus || "(not given)"}

FEED (${src.feedUrl})
Title: ${src.title}
Author: ${src.author || "(none)"}
Description:
${src.description || "(none)"}

MOST RECENT EPISODES, newest first
${eps || "(none)"}`;
}

/** Quote check done by us, not trusted to the model: is it really in there? */
const squash = (s: string) => s.toLowerCase().replace(/[‘’`]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9']+/g, " ").trim();

async function draft(client: Anthropic, show: Row, src: Source): Promise<Omit<Draft, "email" | "podcastName" | "hostName" | "status" | "approved" | "fingerprint">> {
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    output_config: { format: zodOutputFormat(Out) },
    messages: [{ role: "user", content: brief(show, src) }],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error(`no draft (${res.stop_reason})`);
  const o = res.parsed_output;

  const haystack = squash([src.description, ...src.episodes.map((e) => `${e.title} ${e.description}`)].join(" "));
  let notes = o.notes;
  let pullQuote = o.pullQuote;
  if (pullQuote && !haystack.includes(squash(pullQuote.text))) {
    notes = `${notes} [Pull quote dropped: not found verbatim in the source.]`.trim();
    pullQuote = null;
  }

  const latest = src.episodes[0];
  const sources = [src.feedUrl, src.link, ...src.episodes.slice(0, 3).map((e) => e.link)].filter(
    (u, i, a) => u && /^https?:\/\//.test(u) && a.indexOf(u) === i,
  );
  return {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    feedUrl: src.feedUrl,
    feedFoundBy: src.feedFoundBy,
    artwork: src.image,
    headline: o.headline,
    standfirst: o.standfirst,
    sections: o.sections.slice(0, 2),
    pullQuote,
    tags: o.tags.slice(0, 5),
    latestEpisode: o.latestEpisode && latest
      ? { title: latest.title, summary: o.latestEpisode.summary, date: latest.date, link: latest.link }
      : null,
    sources,
    thin: o.thin,
    notes,
  };
}

// ------------------------------------------------------------------ run

interface Row { email: string; podcastName: string; hostName: string; branch: string; serviceStatus: string; profileRss: string; signupRss: string }

async function main() {
  const force = process.argv.includes("--force");
  // --dry: find and read every feed, spend nothing, write nothing.
  const dry = process.argv.includes("--dry");
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1]?.toLowerCase() : "";

  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });
  const rows = await sql<any[]>`
    SELECT DISTINCT ON (s.email) s.email, s.podcast_name, s.host_name, s.branch, s.service_status,
           s.slot_index, s.rss_url AS signup_rss, coalesce(p.rss_url,'') AS profile_rss
    FROM signups s LEFT JOIN podcaster_profiles p ON p.email = s.email
    WHERE s.event_id = 1 AND s.status <> 'cancelled'
    ORDER BY s.email, s.slot_index`;
  await sql.end();

  const shows: Row[] = rows.map((r) => ({
    email: r.email.trim().toLowerCase(), podcastName: r.podcast_name.trim(), hostName: r.host_name.trim(),
    branch: r.branch, serviceStatus: r.service_status, profileRss: r.profile_rss.trim(), signupRss: r.signup_rss.trim(),
  }));

  await fs.mkdir(OUT, { recursive: true });
  const cache: Record<string, Draft> = JSON.parse(await fs.readFile(DRAFTS, "utf8").catch(() => "{}"));
  const client = new Anthropic();

  let spent = 0;
  const queue = shows.filter((s) => !only || s.email === only);
  const work = async (s: Row) => {
    const src = await findSource(s);
    const base = { email: s.email, podcastName: s.podcastName, hostName: s.hostName, approved: false as const };
    if (!src) {
      cache[s.email] = {
        ...base, status: "no-source", generatedAt: new Date().toISOString(), model: "", fingerprint: "",
        feedUrl: "", feedFoundBy: "", artwork: "", headline: "", standfirst: "", sections: [], pullQuote: null,
        tags: [], latestEpisode: null, sources: [], thin: true,
        notes: `No readable feed. On file: ${[s.profileRss, s.signupRss].filter(Boolean).join(" / ") || "nothing"}`,
      };
      console.log(`  —  ${s.podcastName}: no source`);
      if (dry) return;
      return;
    }
    if (dry) {
      console.log(`  ?  ${s.podcastName}: ${src.feedFoundBy} ${src.feedUrl} — ${src.description.length} chars, ${src.episodes.length} episodes, art ${src.image ? "yes" : "no"}`);
      return;
    }
    const fingerprint = crypto.createHash("sha1").update(brief(s, src)).digest("hex").slice(0, 16);
    const had = cache[s.email];
    if (!force && had?.status === "draft" && had.fingerprint === fingerprint) {
      console.log(`  =  ${s.podcastName}: cached`);
      return;
    }
    // Same show, new episode since the last run: keep the words, which the
    // podcaster may already be reading, and say so rather than silently
    // rewriting them.
    if (!force && !only && had?.status === "draft") {
      console.log(`  ~  ${s.podcastName}: feed has moved on since the draft — kept; --only ${s.email} to redraft`);
      return;
    }
    try {
      const d = await draft(client, s, src);
      spent++;
      cache[s.email] = { ...base, status: "draft", fingerprint, ...d };
      console.log(`  +  ${s.podcastName}: drafted${d.pullQuote ? "" : " (standfirst, no quote)"}${d.thin ? " — thin" : ""}`);
    } catch (e) {
      console.log(`  !  ${s.podcastName}: ${(e as Error).message}`);
    }
    // Written after every show, so a crash halfway keeps what it paid for.
    await fs.writeFile(DRAFTS, JSON.stringify(cache, null, 2));
  };

  // Four at a time: quick enough, and polite to the feed hosts.
  for (let i = 0; i < queue.length; i += 4) await Promise.all(queue.slice(i, i + 4).map(work));
  await fs.writeFile(DRAFTS, JSON.stringify(cache, null, 2));

  const all = Object.values(cache);
  console.log(`\n${all.filter((d) => d.status === "draft").length} drafts, ${all.filter((d) => d.status === "no-source").length} with no source. ${spent} drafted this run.`);
  console.log(DRAFTS);
}

main();
