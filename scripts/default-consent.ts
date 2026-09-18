// Turn "count me in" on for the profiles created before it defaulted to on.
//
// The column default only applies to new rows. Every existing profile was
// written while the default was false and nobody has since turned it on, so
// the flag reflects a question nobody was asked rather than an answer anybody
// gave. Bringing them in line with the new default keeps one meaning for the
// field instead of two.
//
//   npx tsx scripts/default-consent.ts --apply
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const off = await sql`SELECT email FROM podcaster_profiles WHERE share_audience_stats = false`;
console.log(`${off.length} profile(s) currently off.`);
if (process.argv.includes("--apply")) {
  await sql`UPDATE podcaster_profiles SET share_audience_stats = true WHERE share_audience_stats = false`;
  console.log("All set to on. Each host can switch it off in their dashboard.");
} else {
  console.log("Dry run — pass --apply to write.");
}
await sql.end();
