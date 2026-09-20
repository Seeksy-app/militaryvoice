// Rename the thank-you to the Awards Ceremony, and put the real times on the
// last two segments.
//
//   npx tsx scripts/closing-times.ts           # dry run
//   npx tsx scripts/closing-times.ts --apply
//
// Closing 10:00–10:15, Awards 10:15–10:30. The grid is half-hour slots because
// the day is a whole number of hours, so the agenda cards already draw these
// two at a quarter hour each while the slots underneath stay where they are.
// The studio was still carrying the old 25-minute shape, which is what put the
// awards at 10:30 and a sponsor handoff at 10:55 — a quarter hour after the
// day is over.
//
// The two handoffs between and after them go to zero minutes rather than being
// deleted. A producer may still want the row to cut to; what it must not do is
// claim airtime that does not exist.
import "dotenv/config";
import postgres from "postgres";

const OLD = "Thank You — Our Podcasters & Sponsors";
const NEW = "Awards Ceremony";

async function main() {
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
  const [ev] = await sql`SELECT id, start_at_utc FROM events WHERE is_featured = true`;
  const hhmm = (s: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(s));

  // 10:00 PM ET on the day of the event, derived rather than typed.
  const day = new Date(ev.start_at_utc);
  const closeAt = new Date(day.getTime());
  closeAt.setUTCHours(day.getUTCHours() + 15, 0, 0, 0); // 7:00 AM ET + 15h
  const awardAt = new Date(closeAt.getTime() + 15 * 60000);
  const endAt = new Date(closeAt.getTime() + 30 * 60000);

  const rows = await sql`SELECT id, sort_index, kind, title, start_at_utc, duration_minutes
    FROM run_of_show WHERE event_id = ${ev.id} AND sort_index >= 92 ORDER BY sort_index`;

  const plan: { id: number; title?: string; start: Date; mins: number; was: string }[] = [];
  for (const r of rows as any[]) {
    const was = `${hhmm(r.start_at_utc)} ${r.duration_minutes}m  ${r.title}`;
    if (/Intro to Closing/.test(r.title)) plan.push({ id: r.id, start: closeAt, mins: 0, was });
    else if (/^Closing Ceremonies/.test(r.title)) plan.push({ id: r.id, start: closeAt, mins: 15, was });
    else if (r.kind === "Handoff" && r.sort_index === 94) plan.push({ id: r.id, start: awardAt, mins: 0, was });
    else if (r.title.includes(OLD) && r.kind === "Intro") plan.push({ id: r.id, title: `Intro to ${NEW}`, start: awardAt, mins: 0, was });
    else if (r.title.includes(OLD)) plan.push({ id: r.id, title: NEW, start: awardAt, mins: 15, was });
    else if (r.kind === "Handoff") plan.push({ id: r.id, start: endAt, mins: 0, was });
  }

  console.log("run of show\n");
  for (const p of plan) {
    console.log(`  #${p.id}  was  ${p.was}`);
    console.log(`         now  ${hhmm(p.start.toISOString())} ${p.mins}m  ${p.title ?? "(title unchanged)"}`);
  }
  const sg = await sql`SELECT id, slot_index, podcast_name FROM signups WHERE podcast_name = ${OLD}`;
  const scn = await sql`SELECT id, name FROM scenes WHERE name LIKE ${"%" + OLD + "%"}`;
  console.log(`\nsignup rows to rename: ${sg.length}   scenes to rename: ${scn.length}   → "${NEW}"`);

  if (!process.argv.includes("--apply")) { console.log("\nDry run — pass --apply."); await sql.end(); return; }

  for (const p of plan) {
    if (p.title) await sql`UPDATE run_of_show SET title = ${p.title}, start_at_utc = ${p.start.toISOString()}, duration_minutes = ${p.mins} WHERE id = ${p.id}`;
    else await sql`UPDATE run_of_show SET start_at_utc = ${p.start.toISOString()}, duration_minutes = ${p.mins} WHERE id = ${p.id}`;
  }
  for (const x of sg as any[]) await sql`UPDATE signups SET podcast_name = ${NEW} WHERE id = ${x.id}`;
  for (const x of scn as any[]) await sql`UPDATE scenes SET name = ${String(x.name).replace(OLD, NEW)} WHERE id = ${x.id}`;
  console.log(`\nUpdated ${plan.length} agenda rows, ${sg.length} signup(s), ${scn.length} scene(s).`);
  await sql.end();
}

main();
