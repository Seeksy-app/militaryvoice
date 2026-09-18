// Prove the recruitment list contains nobody who already holds a slot.
import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const contacts = await sql`SELECT lower(email) AS e FROM contacts WHERE status = 'active'`;
const signups = await sql`SELECT lower(email) AS e FROM signups WHERE status <> 'cancelled'`;
await sql.end();
const held = new Set(signups.map((r: any) => r.e));
const all = contacts.map((r: any) => r.e);
const overlap = all.filter((e) => held.has(e));
console.log(`active contacts      : ${all.length}`);
console.log(`hold a slot          : ${held.size}`);
console.log(`in BOTH (excluded)   : ${overlap.length}${overlap.length ? "  → " + overlap.join(", ") : ""}`);
console.log(`recruitment list     : ${all.length - overlap.length}`);
