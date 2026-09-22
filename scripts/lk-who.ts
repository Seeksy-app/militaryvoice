// Who is in the studio room right now, as LiveKit sees them.
//   npx tsx scripts/lk-who.ts
import "dotenv/config";
import { RoomServiceClient } from "livekit-server-sdk";
async function main() {
  const url = (process.env.LIVEKIT_URL || "").replace(/^ws/, "http");
  const svc = new RoomServiceClient(url, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
  for (const r of await svc.listRooms()) {
    console.log(`room ${r.name} · ${r.numParticipants} participants`);
    for (const p of await svc.listParticipants(r.name)) {
      const tracks = p.tracks.map((t) => `${t.type === 1 ? "audio" : t.type === 2 ? "video" : String(t.type)}${t.muted ? "(muted)" : ""}`).join(",") || "none";
      console.log(`  ${p.identity} | ${p.name} | state=${p.attributes?.state ?? "-"} | publish=${p.permission?.canPublish} hidden=${p.permission?.hidden} | ${tracks}`);
    }
  }
}
main();
