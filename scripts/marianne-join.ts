// Can Alex stand on our stage?
//
//   npx tsx scripts/alex-join.ts
//
// LiveAvatar publishes the avatar's video into a LiveKit room. By default that
// is a room it provisions, which would leave us bridging two rooms and paying
// twice the latency. The session config takes a livekit_config instead, and
// their own reference calls this out: hand it a url, a room and a token and
// the avatar "joins their room as a participant".
//
// So this mints a token the way the studio mints one for a podcaster, points a
// LITE session at a throwaway room, and then asks LiveKit who is standing in
// it. A 201 from their API only proves they accepted the config; the
// participant list is what proves she actually arrived.
import "dotenv/config";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

const ROOM = `alex-probe-${Date.now()}`;
const MARIANNE = "8532b602-89e8-44fa-a9e2-5a4259a058cc";
const httpUrl = process.env.LIVEKIT_URL!.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");

async function main() {
  const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
    identity: "alex", name: "Alex",
  });
  // canPublishData is not optional here — LiveAvatar validates the token
  // before it will accept the config, and rejects one without it. Her video is
  // a media track, but the lip-sync timing rides the data channel.
  at.addGrant({ room: ROOM, roomJoin: true, canPublish: true, canPublishData: true,
      // Deaf on purpose. Her audio arrives over the media-server websocket,
      // never from the room — and with canSubscribe she was taking the room's
      // audio in and putting it back out, which is everyone hearing
      // themselves a second and a half later. She publishes; she does not
      // listen.
      canSubscribe: false });
  const token = await at.toJwt();

  const K = process.env.LIVEAVATAR_API_KEY!;
  const r1 = await fetch("https://api.liveavatar.com/v1/sessions/token", {
    method: "POST",
    headers: { "X-API-KEY": K, "content-type": "application/json" },
    body: JSON.stringify({
      avatar_id: MARIANNE, mode: "LITE", max_session_duration: 120,
      livekit_config: { livekit_url: process.env.LIVEKIT_URL, livekit_room: ROOM, livekit_client_token: token },
    }),
  });
  const b1 = await r1.text();
  console.log(`sessions/token → ${r1.status}`);
  if (!r1.ok) { console.log(b1.slice(0, 300)); return; }
  const sid = (JSON.parse(b1) as any).data.session_id;
  const stok = (JSON.parse(b1) as any).data.session_token;

  const r2 = await fetch("https://api.liveavatar.com/v1/sessions/start", {
    method: "POST", headers: { Authorization: `Bearer ${stok}`, "content-type": "application/json" }, body: "{}",
  });
  console.log(`sessions/start → ${r2.status}`);
  if (!r2.ok) { console.log((await r2.text()).slice(0, 300)); return; }

  const svc = new RoomServiceClient(httpUrl, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
  for (let i = 1; i <= 8; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const ps = await svc.listParticipants(ROOM).catch(() => []);
    if (ps.length) {
      for (const p of ps) {
        const tracks = p.tracks.map((t: any) => `${t.type === 1 ? "video" : "audio"}${t.muted ? " (muted)" : ""}`);
        console.log(`  in room: "${p.identity}" — tracks: ${tracks.join(", ") || "none yet"}`);
      }
      break;
    }
    console.log(`  waiting for her to join… (${i})`);
  }

  await fetch("https://api.liveavatar.com/v1/sessions/stop", {
    method: "POST", headers: { "X-API-KEY": K, "content-type": "application/json" },
    body: JSON.stringify({ session_id: sid }),
  });
  console.log("session stopped");
}
main();
