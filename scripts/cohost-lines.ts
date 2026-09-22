// What Alex says between segments — three lengths of each, written ahead.
//
//   npx tsx scripts/cohost-lines.ts                 # a sample, nothing stored
//   npx tsx scripts/cohost-lines.ts --all           # every handover, nothing stored
//   npx tsx scripts/cohost-lines.ts --all --apply   # write them to the database
//   npx tsx scripts/cohost-lines.ts --solo 14,15    # those slots have no live host
//   npx tsx scripts/cohost-lines.ts --only 499 --apply   # just that handover
//
// The show clock decides which length she reads at the moment she reads it:
// twelve seconds when the last podcaster overran, seventy-five when they
// finished early and she is hosting rather than filling. Generating them live
// would put a model round-trip between one show ending and the next starting,
// which is the one moment in the day that cannot afford one.
//
// All three come from a single request so they are the same thought at three
// lengths, rather than three drafts that disagree about what the show is.
//
// Claude only runs live for the case the schedule cannot predict — a segment
// ending somewhere the written lines do not cover.
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import postgres from "postgres";
import { mileMarkers } from "../shared/mileMarkers";
import { CUE_SECONDS } from "../shared/showClock";

const args = process.argv.slice(2);
const all = args.includes("--all");
const apply = args.includes("--apply");
const soloArg = args[args.indexOf("--solo") + 1];
const soloSlots = new Set(
  args.includes("--solo") && soloArg ? soloArg.split(",").map((n) => Number(n.trim())) : [],
);

const VOICE = `You are Alex, co-host of The Podcast Marathon — 26.2 miles of military and
veteran podcasts, broadcast back to back on National Military Podcast Day.

You are a woman. Alex is your name.

How you speak:
- Warm and brisk, like a live radio host who respects the clock.
- You are talking to an audience, not reading a listing. No "up next we have".
- Veterans are your audience and your guests. Never solemn, never saluting,
  never "thank you for your service". They get enough of that.
- The mile marker is yours to use when it lands naturally. Do not force it.
- No exclamation marks. No "amazing", "incredible", "excited".

Facts you may not invent:
- The course is 26.2 miles. Nothing is further along than 26.2. There is no
  mile 27, no 26.3, no "twenty-seventh mile".
- Use only the distances, times and names given to you below. If a number is
  not in front of you, say nothing rather than reaching for one — asked where
  we are and not told, describe it in words ("the finish", "past the miles").
- This is read out live. A number you guessed is a number the audience hears.
- You have NOT heard the show that just ended. These lines are written weeks
  before the day. You may name it and name its host, and you may say it is
  worth going back for — you may NOT say what was in it, what the host argued,
  what a guest said, or what anyone should have taken from it. Putting an
  opinion in a veteran's mouth and reading it to an audience is the worst
  thing you could do here, and it is the easiest mistake to make, because an
  invented recap reads better than an honest one.
- The specific callback is added on the day from the real transcript. Leave
  the room for it; do not fill it.`;

const SHAPES = `Each handover is three movements, in this order:

  1. The show that just ended. Name it and its host, and send people back to
     it — but say nothing about its contents. You did not hear it. The
     sentence that quotes a point somebody made is written on the day, from
     the transcript, not here.
  2. The sponsor, if you are given one. Say the name plainly and move on.
  3. The show that is starting, and who hosts it.

Write it three times, at three lengths. It is the same handover each time, not
three different ideas — somebody who heard the long one and then the short one
should recognise it.

  short    (~${CUE_SECONDS.short}s, one sentence)   The last one overran and there is no time.
                          Movement 3 only: what is starting and who hosts it.
                          If there is a show sponsor, four words for them.
  standard (~${CUE_SECONDS.standard}s, two or three sentences)   All three movements, tight.
  stretch  (~${CUE_SECONDS.stretch}s, five to seven sentences)   All three with room. Say where we
                          are on the course, let the sponsor read breathe, and
                          give the incoming show a proper introduction. Still
                          nothing about what was in the show that just ended.

Return JSON only, exactly: {"short":"…","standard":"…","stretch":"…"}
Each value is only the words spoken out loud.`;

/**
 * What Alex is allowed to say about money.
 *
 * Read out loud, so a sponsor who is not there must not be invented and a
 * sponsor who is there must be named exactly. A model given "the sponsor" and
 * no name will reach for a plausible one, which is the single worst thing that
 * could come out of her mouth on a broadcast somebody paid for.
 */
function sponsorContext(partner: string, showSponsor: string, hourly: boolean): string {
  const lines: string[] = [];
  if (partner) {
    lines.push(`Title sponsor, named in every handover: "${partner}". The day is "National Military Podcast Day, presented by ${partner}".`);
  }
  if (showSponsor) {
    lines.push(`The show that is STARTING is sponsored by "${showSponsor}". Name them as that show's sponsor.`);
  }
  if (hourly) {
    lines.push(`This handover is on the hour, so it carries the hourly sponsor read. Leave a natural place for it; do not invent who is in it.`);
  }
  if (!lines.length) {
    lines.push("There are NO sponsors to name in this handover. Do not mention sponsorship, do not thank anybody, and do not leave a gap for a name.");
  }
  return lines.join("\n");
}

async function main() {
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });

  // Idempotent, like schemaSync — so this runs before or after the deploy that
  // adds the table and neither order is wrong.
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS cohost_lines (
    id serial PRIMARY KEY,
    event_id integer NOT NULL,
    run_item_id integer NOT NULL DEFAULT 0,
    kind text NOT NULL DEFAULT 'intro',
    short text NOT NULL DEFAULT '',
    standard text NOT NULL DEFAULT '',
    stretch text NOT NULL DEFAULT '',
    solo_intro boolean NOT NULL DEFAULT false,
    edited boolean NOT NULL DEFAULT false,
    approved boolean NOT NULL DEFAULT false,
    created_at text NOT NULL,
    updated_at text NOT NULL DEFAULT ''
  )`);
  await sql.unsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS cohost_lines_row_kind ON cohost_lines (event_id, run_item_id, kind)`,
  );

  const [ev] = await sql`SELECT id, start_at_utc, slot_minutes, duration_hours FROM events WHERE is_featured = true`;
  const rows = await sql`
    SELECT r.id, r.sort_index, r.kind, r.title, r.start_at_utc,
           s.slot_index, s.podcast_name, s.host_name, s.branch, s.service_status, s.show_format
    FROM run_of_show r LEFT JOIN signups s ON s.id = r.signup_id
    WHERE r.event_id = ${ev.id} AND r.kind = 'Intro' ORDER BY r.sort_index`;

  // The course, not a running total of rows. Counting intros made the Flag
  // Carry "mile 29" on a twenty-six mile course, and the model papered over it
  // in the copy rather than refusing — which is exactly how a wrong number
  // ends up being read out live.
  const booked = await sql`SELECT slot_index, podcast_name FROM signups
    WHERE event_id = ${ev.id} AND status <> 'cancelled'`;
  const n = Math.round((ev.duration_hours * 60) / ev.slot_minutes);
  const markers = mileMarkers(
    Array.from({ length: n }, (_, i) => {
      const b = (booked as any[]).find((x) => x.slot_index === i);
      return { signup: b ? { podcastName: b.podcast_name } : null };
    }),
  );
  const markerFor = (slot: number | null) => {
    const m = slot == null ? null : markers[slot];
    if (!m) return "";
    if (m.kind === "mile") return `mile ${m.n} of 26`;
    if (m.kind === "extra") return `${m.label} — past the twenty-sixth mile`;
    if (m.kind === "start") return "the start line";
    if (m.kind === "finish") return "the finish line";
    if (m.kind === "flag") return "the Flag Carry, the colours coming in";
    if (m.kind === "medal") return "the medals, after the finish";
    return "a bonus leg";
  };

  const when = (x: string) =>
    new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
      .format(new Date(x));

  // --only <run item id[,id]> rewrites just those handovers: a slot that changed hands.
  const onlyArg = args[args.indexOf("--only") + 1];
  const only = new Set(args.includes("--only") && onlyArg ? onlyArg.split(",").map((n) => Number(n.trim())) : []);
  const pick = only.size
    ? (rows as any[]).filter((r) => only.has(r.id))
    : all
      ? (rows as any[])
      : [rows[0], rows[6], rows[13], rows[rows.length - 3], rows[rows.length - 1]].filter(Boolean);

  // Who is actually sold. Nothing here is guessed: an unsold slot produces a
  // handover with no sponsor line at all, rather than a gap somebody has to
  // remember to fill before she reads it out.
  const partnerRow = await sql`SELECT name FROM sponsors
    WHERE event_id = ${ev.id} AND active AND lower(tier) IN ('partner', 'title') ORDER BY sort_order LIMIT 1`;
  const partner = (partnerRow as any[])[0]?.name ?? "";

  await sql.unsafe(`CREATE TABLE IF NOT EXISTS show_sponsors (
    id serial PRIMARY KEY, event_id integer NOT NULL, sponsor_id integer NOT NULL,
    signup_id integer, read_line text NOT NULL DEFAULT '', created_at text NOT NULL)`);
  const showSponsorRows = await sql`SELECT ss.signup_id, s.name FROM show_sponsors ss
    JOIN sponsors s ON s.id = ss.sponsor_id
    WHERE ss.event_id = ${ev.id} AND ss.signup_id IS NOT NULL`;
  const showSponsorFor = new Map<number, string>();
  for (const r of showSponsorRows as any[]) showSponsorFor.set(r.signup_id, r.name);

  console.log(
    `title sponsor: ${partner || "none yet"} · ${showSponsorFor.size} of 32 shows sponsored\n`,
  );

  const anthropic = new Anthropic();
  let stored = 0;

  for (const r of pick as any[]) {
    const nth = (rows as any[]).findIndex((x) => x.id === r.id);
    const prev = (rows as any[])[nth - 1];
    // A pre-recorded slot has nobody to hand to, so she carries it herself and
    // must not write a line that waits for an answer.
    const solo = soloSlots.has(r.slot_index) || r.show_format === "prerecorded";

    const ctx = [
      `Time: ${when(r.start_at_utc)} ET`,
      prev?.podcast_name ? `Just finished: ${prev.podcast_name} with ${prev.host_name}` : `This opens the day.`,
      `Coming up: ${r.podcast_name ?? r.title}`,
      r.host_name ? `Host: ${r.host_name}${r.branch ? `, ${r.branch}${r.service_status ? ` (${r.service_status})` : ""}` : ""}` : "",
      `Where we are on the course: ${markerFor(r.slot_index)}`,
      prev?.slot_index != null ? `The segment that just ended was at: ${markerFor(prev.slot_index)}` : "",
      solo
        ? "There is NO live host to hand to on this one. You carry it alone — do not ask a question or leave a line hanging for someone to pick up."
        : "There IS a live host. The last line of the long version hands to them and gives them something to answer.",
      sponsorContext(
        partner,
        showSponsorFor.get(r.signup_id) ?? "",
        // On the hour, where the hourly read belongs.
        new Date(r.start_at_utc).getUTCMinutes() === new Date(ev.start_at_utc).getUTCMinutes(),
      ),
    ]
      .filter(Boolean)
      .join("\n");

    let parsed: { short: string; standard: string; stretch: string } | null = null;
    for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
      const msg = await anthropic.messages.create({
        model: "claude-opus-5",
        max_tokens: 1200,
        system: `${VOICE}\n\n${SHAPES}`,
        messages: [{ role: "user", content: `Introduce the next segment.\n\n${ctx}` }],
      });
      const text = msg.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("").trim();
      try {
        const j = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
        // A cut-off line is not cosmetic here: it is read aloud, and the
        // audience hears her stop mid-clause. Cheap to check, so it is checked.
        if (["short", "standard", "stretch"].every((k) => typeof j[k] === "string" && /[.?!"]$/.test(j[k].trim()))) {
          parsed = j;
        }
      } catch {
        /* try once more */
      }
    }

    if (!parsed) {
      console.log(`\n${when(r.start_at_utc).padStart(8)}  ${r.podcast_name ?? r.title}   ⚠︎ unusable, skipped`);
      continue;
    }

    console.log(`\n${when(r.start_at_utc).padStart(8)}  ${r.podcast_name ?? r.title}${solo ? "   [solo — no live host]" : ""}`);
    console.log(`   short    "${parsed.short}"`);
    console.log(`   standard "${parsed.standard}"`);
    console.log(`   stretch  "${parsed.stretch}"`);

    if (!apply) continue;
    const now = new Date().toISOString();
    // An edited line is somebody's decision and survives a regeneration.
    await sql`
      INSERT INTO cohost_lines (event_id, run_item_id, kind, short, standard, stretch, solo_intro, created_at, updated_at)
      VALUES (${ev.id}, ${r.id}, 'intro', ${parsed.short}, ${parsed.standard}, ${parsed.stretch}, ${solo}, ${now}, ${now})
      ON CONFLICT (event_id, run_item_id, kind) DO UPDATE SET
        short = CASE WHEN cohost_lines.edited THEN cohost_lines.short ELSE EXCLUDED.short END,
        standard = CASE WHEN cohost_lines.edited THEN cohost_lines.standard ELSE EXCLUDED.standard END,
        stretch = CASE WHEN cohost_lines.edited THEN cohost_lines.stretch ELSE EXCLUDED.stretch END,
        solo_intro = EXCLUDED.solo_intro,
        updated_at = ${now}`;
    stored++;
  }

  console.log(
    apply
      ? `\n${stored} handovers stored.`
      : `\nNothing stored. Add --apply to write them, --all for every handover.`,
  );
  await sql.end();
}

main();
