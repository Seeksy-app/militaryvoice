// Regression check for the 18 Nov 2026 pool hang (see server/poolOptions.ts).
//
//   npx tsx scripts/pool-smoke.ts            # the app's pool options: must pass
//   npx tsx scripts/pool-smoke.ts --control  # postgres.js defaults: expected to hang/mismatch on the pooler
//
// Reads only (selects, plus one deliberately failing query per worker round so
// an error reply is in the mix). It builds the pool from poolOptions() — the
// same options server/storage.ts uses — and fires a dashboard-sized burst:
// 17 concurrent workers, 6 queries each, on a pool of 4. Fails (exit 1) if any
// query is still unanswered after 20s, or is answered with another query's result.
import "dotenv/config";
import postgres from "postgres";
import { poolOptions } from "../server/poolOptions.js";

const control = process.argv.includes("--control");
let url = process.env.POSTGRES_URL;
if (!url) { console.error("POSTGRES_URL is not set."); process.exit(2); }
try {
  const u = new URL(url);
  if (/\.pooler\.supabase\.com$/i.test(u.hostname) && (u.port === "5432" || u.port === "")) { u.port = "6543"; url = u.toString(); }
} catch { /* leave it */ }

const options = control ? { ...poolOptions(), max_pipeline: 100 } : poolOptions();
const sql = postgres(url, { ...options, onnotice: () => {} });

const tables = ["events", "signups", "podcaster_profiles", "hosted_shows", "hosted_episodes", "discovery_cache", "bio_pages", "postify_tokens"];
const WORKERS = 17, ROUNDS = 6, WAIT_MS = 20_000;
let answered = 0, hung = 0, mixed = 0;
const t0 = Date.now();

await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
  for (let r = 0; r < ROUNDS; r++) {
    const tb = tables[(w + r) % tables.length];
    const failing = r === 2; // an error reply in the stream
    const q = failing
      ? sql.unsafe(`select 1 from no_such_table_${w}`)
      : sql.unsafe(`select '${tb}' as t, (select count(*) from (select 1 from ${tb} limit 50) x)::int as n`);
    let timer: NodeJS.Timeout | undefined;
    try {
      const rows: any = await Promise.race([q, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("HUNG")), WAIT_MS); })]);
      if (failing) mixed++; // it should have thrown
      else if (rows[0]?.t !== tb) mixed++;
      else answered++;
    } catch (e: any) {
      if (e.message === "HUNG") { hung++; return; }
      if (failing && /no_such_table_/.test(e.message)) answered++;
      else mixed++; // an error that isn't ours came back
    } finally { clearTimeout(timer); }
  }
}));

const total = WORKERS * ROUNDS;
const ok = hung === 0 && mixed === 0 && answered === total;
console.log(`${ok ? "PASS" : "FAIL"}  ${control ? "(control: pipelining on) " : ""}pool of ${options.max}, ${WORKERS} workers — ${answered}/${total} answered, ${hung} hung, ${mixed} wrong/mixed, ${Date.now() - t0}ms`);
process.exit(control ? 0 : ok ? 0 : 1);
