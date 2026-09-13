import "dotenv/config";
import postgres from "postgres";
let url = process.env.POSTGRES_URL;
const u = new URL(url);
if (/\.pooler\.supabase\.com$/i.test(u.hostname) && (u.port === "5432" || u.port === "")) { u.port = "6543"; url = u.toString(); }
console.log("host", u.hostname, "port", u.port, "user", u.username);
const sql = postgres(url, { prepare: false, max: 4, idle_timeout: 20, connect_timeout: 10 });
const t0=Date.now();
console.log("statement_timeout:", (await sql`show statement_timeout`)[0]);
console.log("idle_in_transaction:", (await sql`show idle_in_transaction_session_timeout`)[0]);
let t=Date.now(); await sql`SELECT 1 FROM information_schema.columns WHERE table_name='podcaster_profiles' AND column_name='promo_notes' LIMIT 1`; console.log("sentinel query ms:", Date.now()-t);
t=Date.now(); await sql`select id from admin_users where email = ${'andrew@podlogix.co'}`; console.log("admin_users ms:", Date.now()-t);
t=Date.now(); await Promise.all(Array.from({length:12},()=>sql`select count(*) from signups`)); console.log("12 concurrent ms:", Date.now()-t);
console.log("total", Date.now()-t0);
await sql.end();
