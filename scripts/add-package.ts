// A live-stream sponsor tier, shaped like the ones already there.
//
//   npx tsx scripts/add-package.ts           # dry run
//   npx tsx scripts/add-package.ts --apply
//
// Insert only. It never updates or deletes an existing package: a partial
// write to this table once set every price to zero on a live page, and the
// original slot counts could not be recovered. Adding a row cannot do that.
//
// Prices here are whole dollars, not cents — 10000 is the ten-thousand-dollar
// partner tier, not one hundred dollars.
import "dotenv/config";
import postgres from "postgres";

const PKG = {
  name: "Live stream sponsor",
  price: 5000,
  total_slots: 4,
  tier: "official",
  description: "Your name on the stream itself, every mile of the way.",
  sort_order: 0,
  active: true,
  checkout_url: "https://checkout.seeksy.io/b/8x2eVc95m1et4H7fbldfG0d",
};

async function main() {
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
  const [ev] = await sql`SELECT id FROM events WHERE is_featured = true`;
  const existing = await sql`SELECT name, price, total_slots, tier FROM sponsor_packages WHERE event_id = ${ev.id} ORDER BY price DESC`;

  console.log("already there (untouched):");
  for (const p of existing as any[]) console.log(`  $${Number(p.price).toLocaleString().padStart(7)}  ${String(p.name).padEnd(20)} ${p.total_slots} slot(s)  [${p.tier}]`);

  const clash = (existing as any[]).find((p) => String(p.name).toLowerCase() === PKG.name.toLowerCase());
  if (clash) { console.log(`\n"${PKG.name}" already exists. Nothing to do.`); await sql.end(); return; }

  console.log(`\nadding:`);
  console.log(`  $${PKG.price.toLocaleString().padStart(7)}  ${PKG.name.padEnd(20)} ${PKG.total_slots} slot(s)  [${PKG.tier}]`);
  console.log(`           "${PKG.description}"`);
  console.log(`           checkout link: ${PKG.checkout_url || "NONE — nobody can buy it until you add one"}`);

  if (!process.argv.includes("--apply")) { console.log("\nDry run — pass --apply."); await sql.end(); return; }
  const [row] = await sql`
    INSERT INTO sponsor_packages (event_id, name, price, total_slots, tier, description, sort_order, active, checkout_url, created_at)
    VALUES (${ev.id}, ${PKG.name}, ${PKG.price}, ${PKG.total_slots}, ${PKG.tier}, ${PKG.description},
            ${PKG.sort_order}, ${PKG.active}, ${PKG.checkout_url}, ${new Date().toISOString()})
    RETURNING id`;
  console.log(`\nPackage #${row.id} created.`);
  await sql.end();
}
main();
