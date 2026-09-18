// Bring the database back in line with what LiveKit is actually doing.
//
// Studios keep an egress id and a status so the console knows whether it is
// on. Nothing ever clears them when an egress dies on LiveKit's side — a
// crashed worker, a room that emptied, a tab closed mid-session — so the flags
// outlive the thing they describe. A producer then walks into a room that says
// RECORDING with a red dot, cannot stop it because there is nothing to stop,
// and has no way to tell whether they are on air.
//
//   npx tsx scripts/reconcile-egress.ts           # report
//   npx tsx scripts/reconcile-egress.ts --apply   # clear what's dead
import "dotenv/config";
import { EgressClient } from "livekit-server-sdk";
import postgres from "postgres";

const client = new EgressClient(process.env.LIVEKIT_URL!, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const apply = process.argv.includes("--apply");

/** STARTING and ACTIVE are running; everything else is over. */
const RUNNING = new Set(["EGRESS_STARTING", "EGRESS_ACTIVE", "0", "1"]);
const live = new Set<string>();
try {
  for (const e of await client.listEgress({})) {
    if (RUNNING.has(String(e.status))) live.add(e.egressId);
  }
} catch (err) {
  console.error("Could not reach LiveKit — not touching anything:", (err as Error).message);
  await sql.end();
  process.exit(1);
}
console.log(`LiveKit has ${live.size} egress actually running.`);

const studios = await sql`SELECT id, name, status, broadcast_egress_id, recording_egress_id FROM studios`;
for (const s of studios) {
  const patch: string[] = [];
  const deadBroadcast = s.broadcast_egress_id && !live.has(String(s.broadcast_egress_id));
  const deadRecording = s.recording_egress_id && !live.has(String(s.recording_egress_id));
  // "Live" with nothing going out is the claim that matters most: it is what
  // the public watch page reads to decide whether to show a LIVE badge.
  const falselyLive = s.status === "Live" && deadBroadcast !== false && !live.has(String(s.broadcast_egress_id));
  if (deadBroadcast) patch.push("broadcast egress");
  if (deadRecording) patch.push("recording egress");
  if (falselyLive && s.status === "Live") patch.push("status Live → Offline");
  if (patch.length === 0) continue;
  console.log(`  #${s.id} ${s.name}: clearing ${patch.join(", ")}`);
  if (apply) {
    await sql`
      UPDATE studios SET
        broadcast_egress_id = ${deadBroadcast ? "" : s.broadcast_egress_id},
        recording_egress_id = ${deadRecording ? "" : s.recording_egress_id},
        status = ${falselyLive ? "Offline" : s.status}
      WHERE id = ${s.id}`;
  }
}

const recs = await sql`SELECT id, studio_id, egress_id, started_at FROM recordings WHERE status = 'Recording'`;
for (const r of recs) {
  if (live.has(String(r.egress_id))) continue;
  console.log(`  recording #${r.id} (studio ${r.studio_id}, since ${r.started_at}): marking Failed`);
  if (apply) {
    await sql`
      UPDATE recordings
      SET status = 'Failed', ended_at = ${new Date().toISOString()},
          error = 'Egress ended without a completion callback; reconciled from LiveKit.'
      WHERE id = ${r.id}`;
  }
}

await sql.end();
console.log(apply ? "\nReconciled." : "\nDry run — pass --apply.");
