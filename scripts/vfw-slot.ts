// Give Rob Couture the 1:30 PM slot that was being held for him.
//
//   npx tsx scripts/vfw-slot.ts           # dry run
//   npx tsx scripts/vfw-slot.ts --apply
//
// He finished the whole signup on the 19th — profile, photo, branch, and a
// finished prerecorded episode — and never landed on a slot, so from his side
// he was booked and from ours he did not exist. The held row at 1:30 is the
// slot he was always meant to have, so it becomes his rather than being
// deleted and replaced: same row, same slot, no window where 1:30 is free for
// somebody else to take.
//
// Everything on the booking is read from what he already told us. Retyping it
// here would be a second copy to keep in step with the first, and the one that
// drifts is always the copy.
import "dotenv/config";
import postgres from "postgres";

const EMAIL = "rcouture@vfw.org";
const SLOT = 13; // 1:30 PM ET

async function main() {
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
  const [event] = await sql`SELECT * FROM events WHERE is_featured = true`;
  const when = new Intl.DateTimeFormat("en-US", {
    weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  }).format(new Date(new Date(event.start_at_utc).getTime() + SLOT * event.slot_minutes * 60000));

  const [p] = await sql`SELECT * FROM podcaster_profiles WHERE lower(email) = ${EMAIL}`;
  const [show] = await sql`SELECT * FROM event_shows WHERE lower(email) = ${EMAIL} AND event_id = ${event.id}`;
  const [held] = await sql`SELECT * FROM signups WHERE event_id = ${event.id} AND slot_index = ${SLOT} AND status <> 'cancelled'`;
  const [already] = await sql`SELECT id, slot_index FROM signups WHERE event_id = ${event.id} AND lower(email) = ${EMAIL} AND status <> 'cancelled'`;

  if (!p) { console.log(`No profile for ${EMAIL} — nothing to book.`); await sql.end(); return; }
  if (already) { console.log(`Already booked: signup #${already.id} at slot ${already.slot_index}. Nothing to do.`); await sql.end(); return; }
  if (!held) { console.log(`Slot ${SLOT} is empty — this script only converts the held row.`); await sql.end(); return; }
  if (held.email !== "hello@militaryvoice.ai") {
    console.log(`Slot ${SLOT} belongs to ${held.podcast_name} <${held.email}> — a real booking. Refusing to overwrite.`);
    await sql.end(); return;
  }

  const next = {
    podcast_name: p.podcast_name, host_name: p.host_name, email: p.email, phone: p.phone ?? "",
    num_people: p.num_people ?? 1, photo_url: p.photo_url ?? "", youtube_url: p.youtube_url ?? "",
    rss_url: p.rss_url ?? "", social_accounts: p.social_accounts ?? "", social_links: p.social_links ?? "",
    branch: p.branch ?? "", service_status: p.service_status ?? "",
    show_format: show?.show_format ?? p.show_format ?? "live",
    recording_url: show?.recording_url ?? p.recording_url ?? "",
    intro_style: show?.intro_style ?? p.intro_style ?? "straight",
    notes: "", status: "confirmed",
  };

  console.log(`${event.name}\n`);
  console.log(`slot ${SLOT} · ${when}`);
  console.log(`  was:  ${held.podcast_name} <${held.email}>`);
  console.log(`  now:  ${next.podcast_name} / ${next.host_name} <${next.email}>`);
  console.log(`        ${next.branch} ${next.service_status} · ${next.show_format}${next.recording_url ? ` · ${next.recording_url}` : ""}`);
  console.log(`        photo ${next.photo_url ? "yes" : "MISSING"}`);

  if (!process.argv.includes("--apply")) { console.log("\nDry run — pass --apply."); await sql.end(); return; }
  await sql`UPDATE signups SET ${sql(next)} WHERE id = ${held.id}`;
  console.log(`\nUpdated signup #${held.id} → ${next.podcast_name}`);
  await sql.end();
}

main();
