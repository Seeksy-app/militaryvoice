// Put Alex on the stage the producer is actually standing on.
//
//   npx tsx scripts/alex-live.ts [seconds]
//
// Finds the room with a live producer in it, mints her a token the way the
// studio mints one for a podcaster, and points a LITE session at that room so
// she publishes into it directly rather than into one of LiveAvatar's.
//
// She arrives silent. The audio leg — Madison's voice over the media-server
// websocket — is not built yet, so this is her face, her video track, and a
// second body on the stage. That is the part worth proving today: the studio
// holding two participants on camera at once.
import "dotenv/config";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

const SECONDS = Math.min(Number(process.argv[2] ?? 300), 300); // Starter caps a session at 5 minutes.
const MARIANNE = "8532b602-89e8-44fa-a9e2-5a4259a058cc";
const http = process.env.LIVEKIT_URL!.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
const svc = new RoomServiceClient(http, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
const K = process.env.LIVEAVATAR_API_KEY!;
const say = (...a: unknown[]) => process.stdout.write(a.join(" ") + "\n");

async function main() {
  const rooms = (await svc.listRooms().catch(() => [])) as any[];
  const live = rooms.filter((r) => r.numParticipants > 0);
  if (!live.length) { say("Nobody is in any studio room. Join first."); return; }
  const room = live.sort((a, b) => b.numParticipants - a.numParticipants)[0].name;
  say(`joining ${room} (${live.find((r) => r.name === room).numParticipants} already in)`);

  const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
    identity: "alex", name: "Alex",
  });
  at.addGrant({ room, roomJoin: true, canPublish: true, canPublishData: true,
      // Deaf on purpose. Her audio arrives over the media-server websocket,
      // never from the room — and with canSubscribe she was taking the room's
      // audio in and putting it back out, which is everyone hearing
      // themselves a second and a half later. She publishes; she does not
      // listen.
      canSubscribe: false });

  const r1 = await fetch("https://api.liveavatar.com/v1/sessions/token", {
    method: "POST", headers: { "X-API-KEY": K, "content-type": "application/json" },
    body: JSON.stringify({
      avatar_id: MARIANNE, mode: "LITE", max_session_duration: SECONDS,
      livekit_config: { livekit_url: process.env.LIVEKIT_URL, livekit_room: room, livekit_client_token: await at.toJwt() },
    }),
  });
  if (!r1.ok) { say(`sessions/token ${r1.status}: ${(await r1.text()).slice(0, 240)}`); return; }
  const d1 = (await r1.json() as any).data;

  const r2 = await fetch("https://api.liveavatar.com/v1/sessions/start", {
    method: "POST", headers: { Authorization: `Bearer ${d1.session_token}`, "content-type": "application/json" }, body: "{}",
  });
  if (!r2.ok) { say(`sessions/start ${r2.status}: ${(await r2.text()).slice(0, 240)}`); return; }
  say(`session ${d1.session_id} started`);

  // The stage filters on the state attribute, so joining is not enough — she
  // would sit in the room invisible, which looks exactly like a failure.
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const ps = (await svc.listParticipants(room).catch(() => [])) as any[];
    const her = ps.find((p) => p.identity === "alex");
    if (her) {
      await svc.updateParticipant(room, "alex", { attributes: { state: "On stage", avatar: "1" } }).catch(() => {});
      say(`she is in — tracks: ${her.tracks.map((t: any) => (t.type === 1 ? "video" : "audio")).join(", ") || "none yet"}`);
      say(`everyone here: ${ps.map((p: any) => `${p.identity}${p.attributes?.state === "On stage" ? "*" : ""}`).join(", ")}  (* = on stage)`);
      break;
    }
  }

  say(`\nholding for ${SECONDS}s — she is silent until the audio leg is built`);
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  await fetch("https://api.liveavatar.com/v1/sessions/stop", {
    method: "POST", headers: { "X-API-KEY": K, "content-type": "application/json" },
    body: JSON.stringify({ session_id: d1.session_id }),
  });
  say("session stopped");
  process.exit(0);
}
main();
