// What LiveKit thinks is running, versus what our database claims.
import "dotenv/config";
import { EgressClient } from "livekit-server-sdk";
import postgres from "postgres";

const client = new EgressClient(process.env.LIVEKIT_URL!, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });

const studios = await sql`SELECT id, name, status, broadcast_egress_id, recording_egress_id FROM studios ORDER BY id`;
const recs = await sql`SELECT id, studio_id, egress_id, status, started_at FROM recordings WHERE status = 'Recording'`;
await sql.end();

let live: { egressId: string; status: string; roomName: string }[] = [];
try {
  const list = await client.listEgress({});
  live = list.map((e) => ({ egressId: e.egressId, status: String(e.status), roomName: e.roomName ?? "" }));
} catch (err) {
  console.log("couldn't list egress:", (err as Error).message);
}
console.log(`LiveKit reports ${live.length} egress record(s):`);
for (const e of live) console.log(`   ${e.egressId}  ${e.status}  room=${e.roomName}`);

const liveIds = new Set(live.filter((e) => /STARTING|ACTIVE|ENDING/i.test(e.status)).map((e) => e.egressId));
console.log("\nOur studios:");
for (const s of studios) {
  const b = s.broadcast_egress_id, r = s.recording_egress_id;
  console.log(`  #${s.id} ${String(s.name).padEnd(16)} status=${String(s.status).padEnd(8)} broadcast=${b || "-"}${b && !liveIds.has(b) ? " (DEAD)" : ""} rec=${r || "-"}${r && !liveIds.has(r) ? " (DEAD)" : ""}`);
}
console.log("\nRows still marked Recording:");
for (const r of recs) console.log(`  rec #${r.id} studio=${r.studio_id} ${r.egress_id}${liveIds.has(r.egress_id) ? " ACTIVE" : " (DEAD)"} since ${r.started_at}`);
