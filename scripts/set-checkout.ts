// Put a checkout link on one sponsor package.
//
//   npx tsx scripts/set-checkout.ts "<package name>" "<url>"           # dry run
//   npx tsx scripts/set-checkout.ts "<package name>" "<url>" --apply
//
// One column, one row, matched by exact name. Narrow on purpose: a partial
// write to this table once set every price to zero on a live page and the
// original slot counts could not be recovered. Nothing here touches price,
// slots, tier or any other package.
import "dotenv/config";
import postgres from "postgres";

async function main() {
  const name = process.argv[2] ?? "";
  const url = process.argv[3] ?? "";
  if (!name || !/^https:\/\//.test(url)) { console.log(`Need a package name and an https URL.`); return; }

  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
  const [ev] = await sql`SELECT id FROM events WHERE is_featured = true`;
  const [pkg] = await sql`SELECT id, name, price, total_slots, checkout_url FROM sponsor_packages
    WHERE event_id = ${ev.id} AND lower(name) = ${name.toLowerCase()}`;
  if (!pkg) { console.log(`No package named "${name}".`); await sql.end(); return; }

  console.log(`${pkg.name} — $${Number(pkg.price).toLocaleString()}, ${pkg.total_slots} slots`);
  console.log(`  was: ${pkg.checkout_url || "(none — unbuyable)"}`);
  console.log(`  now: ${url}`);

  if (!process.argv.includes("--apply")) { console.log("\nDry run — pass --apply."); await sql.end(); return; }
  await sql`UPDATE sponsor_packages SET checkout_url = ${url} WHERE id = ${pkg.id}`;
  const [after] = await sql`SELECT name, price, total_slots, checkout_url FROM sponsor_packages WHERE id = ${pkg.id}`;
  console.log(`\nSet. Row now: $${Number(after.price).toLocaleString()}, ${after.total_slots} slots, link ${after.checkout_url ? "yes" : "no"}`);
  await sql.end();
}
main();
