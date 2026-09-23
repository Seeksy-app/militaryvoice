// The same handovers, written for a person at the desk rather than for Alex.
// One line each, about twenty seconds, into cohost_lines.host beside Alex's
// three. The co-host dashboard shows this one.
//
//   npx tsx scripts/host-lines.ts            # a sample, nothing stored
//   npx tsx scripts/host-lines.ts --all      # every handover, nothing stored
//   npx tsx scripts/host-lines.ts --all --apply
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import postgres from "postgres";
import { mileMarkers } from "../shared/mileMarkers";

const args = process.argv.slice(2);
const all = args.includes("--all");
const apply = args.includes("--apply");

const VOICE = `You write what a human host says at the desk of The Podcast Marathon: 26.2
miles of military and veteran podcasts, live and back to back on National
Military Podcast Day. The host is a veteran talking to veterans. Their name is
not in the line; anyone at the desk should be able to read it as their own.

How it sounds:
- Warm and brisk, like a live radio host who respects the clock. Plain words.
- Talking to an audience, not reading a listing. No "up next we have".
- Never solemn, never saluting, never "thank you for your service".
- No exclamation marks. No "amazing", "incredible", "excited".
- About twenty seconds read aloud: three or four short sentences.

Facts you may not invent:
- The course is 26.2 miles; nothing is further than 26.2.
- Use only the names, times and numbers given. Missing a number, say nothing.
- You have NOT heard the show that just ended. Name it and its host and send
  people back to it, but say nothing about what was in it.
- A sponsor is named exactly as given, plainly, once. No sponsor given, none
  mentioned.

Return only the words spoken out loud. No quotes, no notes.`;

async function main() {
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, onnotice: () => {} });
  await sql.unsafe(`ALTER TABLE cohost_lines ADD COLUMN IF NOT EXISTS host text NOT NULL DEFAULT ''`);
  const [ev] = await sql`SELECT id, start_at_utc, slot_minutes, duration_hours FROM events WHERE is_featured = true`;
  const rows = await sql`
    SELECT r.id, r.sort_index, r.kind, r.title, r.start_at_utc, r.signup_id,
           s.slot_index, s.podcast_name, s.host_name, s.branch, s.service_status, s.show_format
    FROM run_of_show r LEFT JOIN signups s ON s.id = r.signup_id
    WHERE r.event_id = ${ev.id} AND r.kind = 'Intro' ORDER BY r.sort_index`;
  const booked = await sql`SELECT id, slot_index, podcast_name, host_name FROM signups WHERE event_id = ${ev.id} AND status <> 'cancelled' ORDER BY slot_index`;
  const markers = mileMarkers((booked as any[]).map((b) => ({ signup: { slotIndex: b.slot_index, podcastName: b.podcast_name, hostName: b.host_name, email: "" } as any })));
  const markerFor = (slot: number | null) => {
    if (slot == null) return "";
    const i = (booked as any[]).findIndex((b) => b.slot_index === slot);
    const m = markers[i];
    if (!m) return "";
    return m.kind === "mile" ? `mile ${m.n} of 26.2` : m.kind === "start" ? "the start line" : m.kind === "finish" ? "the finish" : "";
  };
  const when = (x: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(x));
  const showSponsorRows = await sql`SELECT ss.signup_id, s.name, ss.read_line FROM show_sponsors ss JOIN sponsors s ON s.id = ss.sponsor_id WHERE ss.event_id = ${ev.id}`;
  const sponsorFor = new Map<number, string>();
  for (const r of showSponsorRows as any[]) sponsorFor.set(r.signup_id, r.read_line || `This show is sponsored by ${r.name}.`);

  // --only <run item id[,id]> rewrites just those handovers.
  const onlyArg = args[args.indexOf("--only") + 1];
  const only = new Set(args.includes("--only") && onlyArg ? onlyArg.split(",").map((n) => Number(n.trim())) : []);
  const pick = only.size ? (rows as any[]).filter((r) => only.has(r.id)) : all ? (rows as any[]) : (rows as any[]).slice(1, 3);
  const anthropic = new Anthropic();
  let stored = 0;
  for (const r of pick) {
    const nth = (rows as any[]).findIndex((x) => x.id === r.id);
    const prev = (rows as any[])[nth - 1];
    const ctx = [
      `Time: ${when(r.start_at_utc)} ET`,
      prev?.podcast_name ? `Just finished: ${prev.podcast_name} with ${prev.host_name}` : `This opens the day.`,
      `Coming up: ${r.podcast_name ?? r.title}`,
      r.host_name ? `Host: ${r.host_name}${r.branch ? `, ${r.branch}${r.service_status ? ` (${r.service_status})` : ""}` : ""}` : "",
      `Where we are on the course: ${markerFor(r.slot_index)}`,
      r.show_format === "prerecorded" ? "This one is a recorded episode: the producer rolls it after you bring it on. Do not ask the host a question." : "The host is live and waiting. End by handing to them.",
      sponsorFor.get(r.signup_id) ? `Sponsor line to include, in these words or close to them: "${sponsorFor.get(r.signup_id)}"` : "No sponsor on this show. Do not mention one.",
    ].filter(Boolean).join("\n");
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 400,
      system: VOICE,
      messages: [{ role: "user", content: `Bring on the next show.\n\n${ctx}` }],
    });
    const text = msg.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("").trim().replace(/^["“]|["”]$/g, "");
    console.log(`\n${when(r.start_at_utc).padStart(8)}  ${r.podcast_name ?? r.title}\n   "${text}"`);
    if (!apply || !text) continue;
    const now = new Date().toISOString();
    const [existing] = await sql`SELECT id FROM cohost_lines WHERE run_item_id = ${r.id} AND kind = 'intro'`;
    if (existing) await sql`UPDATE cohost_lines SET host = ${text}, updated_at = ${now} WHERE id = ${existing.id}`;
    else await sql`INSERT INTO cohost_lines (event_id, run_item_id, kind, host, created_at, updated_at) VALUES (${ev.id}, ${r.id}, 'intro', ${text}, ${now}, ${now})`;
    stored++;
  }
  console.log(`\n${apply ? `${stored} stored.` : "Nothing stored. --apply to write."}`);
  await sql.end();
}
main();
