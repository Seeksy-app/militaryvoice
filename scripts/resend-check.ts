// Read-only: ask Resend itself what happened to the 86 messages in broadcast
// #1. Our own table only holds one event per message, which is the signature
// of the retroactive backfill rather than a live webhook feed — so the table
// cannot be trusted to answer "did anyone open it".
import "dotenv/config";
import postgres from "postgres";

const KEY = process.env.RESEND_API_KEY!;
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const sends = await sql`SELECT email, resend_id FROM broadcast_sends WHERE broadcast_id = 1 ORDER BY id`;
await sql.end();

const tally = new Map<string, number>();
const opened: string[] = [];
let checked = 0;
for (const s of sends) {
  const res = await fetch(`https://api.resend.com/emails/${s.resend_id}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) { tally.set(`HTTP ${res.status}`, (tally.get(`HTTP ${res.status}`) ?? 0) + 1); continue; }
  const j = (await res.json()) as { last_event?: string };
  const ev = j.last_event ?? "unknown";
  tally.set(ev, (tally.get(ev) ?? 0) + 1);
  if (ev === "opened" || ev === "clicked") opened.push(`${ev}  ${s.email}`);
  checked++;
}
console.log(`Checked ${checked} of ${sends.length} messages with Resend directly.\n`);
for (const [k, v] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(12)} ${v}`);
if (opened.length) console.log("\nEngaged:\n" + opened.map((o) => "  " + o).join("\n"));
