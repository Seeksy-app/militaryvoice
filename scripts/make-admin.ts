// Grant admin.
//
//   npx tsx scripts/make-admin.ts <email> "<name>"           # dry run
//   npx tsx scripts/make-admin.ts <email> "<name>" --apply
//
// Admin is everything: the whole schedule, every podcaster's details, the
// studio, the sends. Worth a deliberate command rather than a checkbox, and
// worth printing who the address belongs to before granting it — an email on
// its own tells you nothing, and the cost of getting it wrong is not small.
import "dotenv/config";
import postgres from "postgres";

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  const name = process.argv[3] ?? "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.log("Need a valid email."); return; }

  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
  const [already] = await sql`SELECT id, name FROM admin_users WHERE lower(email) = ${email}`;
  if (already) { console.log(`${email} is already an admin (#${already.id}${already.name ? `, ${already.name}` : ""}).`); await sql.end(); return; }

  const [who] = await sql`SELECT host_name, podcast_name FROM podcaster_profiles WHERE lower(email) = ${email}`;
  console.log(`grant admin to ${email}`);
  console.log(`  on file: ${who ? `${who.host_name} — ${who.podcast_name}` : "no podcaster profile"}`);
  console.log(`  name to store: ${name || who?.host_name || "(none)"}`);

  if (!process.argv.includes("--apply")) { console.log("\nDry run — pass --apply."); await sql.end(); return; }
  const [row] = await sql`
    INSERT INTO admin_users (email, name, is_owner, created_at)
    VALUES (${email}, ${name || who?.host_name || ""}, false, ${new Date().toISOString()})
    RETURNING id`;
  console.log(`\nAdmin #${row.id} created.`);
  await sql.end();
}
main();
