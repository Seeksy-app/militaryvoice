// Run the schema sync once, from one connection, and record the fingerprint.
//
// Serverless cold starts each run this. When the DDL is slow they lock each
// other out, time out, and the fingerprint is never recorded — so every cold
// start tries again and the database never converges. One clean run breaks it.
import "dotenv/config";
import postgres from "postgres";
import { ensureSchema, schemaFingerprint } from "/Users/andrewappleton/projects/militaryvoice/server/schemaSync.js";

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1, idle_timeout: 20 });
const t0 = Date.now();
console.log("fingerprint wanted:", schemaFingerprint());
const before = await sql`SELECT value FROM schema_meta WHERE key = 'fingerprint'`;
console.log("fingerprint stored:", before[0]?.value ?? "(none)");

const report = await ensureSchema(sql as never);
console.log(`synced in ${Math.round((Date.now() - t0) / 1000)}s — ${report.tablesCreated.length} tables, ${report.columnsAdded.length} columns, ${report.indexesCreated.length} indexes`);

await sql`
  INSERT INTO schema_meta (key, value) VALUES ('fingerprint', ${schemaFingerprint()})
  ON CONFLICT (key) DO UPDATE SET value = ${schemaFingerprint()}`;
const after = await sql`SELECT value FROM schema_meta WHERE key = 'fingerprint'`;
console.log("fingerprint now:", after[0]?.value);
await sql.end();
