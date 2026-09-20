// Marianne, with a voice.
//
//   npx tsx scripts/marianne-speak.ts "line to say"
//   npx tsx scripts/marianne-speak.ts            # uses a written transition
//
// The last leg. Her video already publishes into our own LiveKit room; what
// was missing was the audio, which does not travel over WebRTC at all. Her
// media server takes it on a separate websocket, lip-syncs it, and publishes
// the result as her video track — which is why she could stand on the stage
// and still be mute.
//
// Protocol, from LiveAvatar's own reference client:
//   {"type":"start","encoding":"pcm_s16le","sample_rate":24000,"channels":1}
//   {"type":"agent.speak","audio":"<base64 pcm>"}   × n
//   {"type":"agent.speak_end"}
//
// ElevenLabs emits pcm_24000 directly, so Madison's voice arrives in exactly
// the shape the avatar wants — no resampling, nothing to get wrong.
import "dotenv/config";
import WebSocket from "ws";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

const MARIANNE = "8532b602-89e8-44fa-a9e2-5a4259a058cc";
const MADISON = "NUjosfEayZAdRcDmcHM8";
const LINE = process.argv[2] ||
  "Mile thirteen, which means we're halfway and nobody's walking yet. Rob Couture, Army retired, has Still Serving from the VFW.";

const K = process.env.LIVEAVATAR_API_KEY!;
const http = process.env.LIVEKIT_URL!.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
const svc = new RoomServiceClient(http, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
const say = (...a: unknown[]) => process.stdout.write(a.join(" ") + "\n");

async function main() {
  // A room can be named explicitly so the audio leg can be proved without a
  // human sitting in a studio waiting to hear it.
  const forced = process.argv[3];
  const live = ((await svc.listRooms().catch(() => [])) as any[]).filter((r) => r.numParticipants > 0);
  if (!forced && !live.length) { say("No studio room has anyone in it. Join first, or pass a room name."); process.exit(0); }
  const room = forced ?? live.sort((a, b) => b.numParticipants - a.numParticipants)[0].name;
  say(`room ${room}`);

  // Madison, as raw 24kHz mono PCM — the avatar's native input format.
  say("speaking the line…");
  const tts = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${MADISON}?output_format=pcm_24000`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "content-type": "application/json" },
    body: JSON.stringify({ text: LINE, model_id: "eleven_turbo_v2_5" }),
  });
  if (!tts.ok) { say(`ElevenLabs ${tts.status}: ${(await tts.text()).slice(0, 200)}`); process.exit(1); }
  const pcm = Buffer.from(await tts.arrayBuffer());
  say(`  ${(pcm.length / 48000).toFixed(1)}s of audio (${(pcm.length / 1024).toFixed(0)}KB)`);

  const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
    identity: "marianne", name: "Marianne",
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
      avatar_id: MARIANNE, mode: "LITE", max_session_duration: 300,
      livekit_config: { livekit_url: process.env.LIVEKIT_URL, livekit_room: room, livekit_client_token: await at.toJwt() },
    }),
  });
  if (!r1.ok) { say(`sessions/token ${r1.status}: ${(await r1.text()).slice(0, 200)}`); process.exit(1); }
  const d1 = (await r1.json() as any).data;
  const r2 = await fetch("https://api.liveavatar.com/v1/sessions/start", {
    method: "POST", headers: { Authorization: `Bearer ${d1.session_token}`, "content-type": "application/json" }, body: "{}",
  });
  if (!r2.ok) { say(`sessions/start ${r2.status}: ${(await r2.text()).slice(0, 200)}`); process.exit(1); }
  const d2 = (await r2.json() as any).data;
  say(`session ${d1.session_id} started`);

  const stop = async () => {
    await fetch("https://api.liveavatar.com/v1/sessions/stop", {
      method: "POST", headers: { "X-API-KEY": K, "content-type": "application/json" },
      body: JSON.stringify({ session_id: d1.session_id }),
    }).catch(() => {});
  };

  // Put her on the stage — joining is not enough, the stage filters on state.
  (async () => {
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const ps = (await svc.listParticipants(room).catch(() => [])) as any[];
      if (ps.some((p) => p.identity === "marianne")) {
        await svc.updateParticipant(room, "marianne", { attributes: { state: "On stage", avatar: "1" } }).catch(() => {});
        say("she is on stage");
        return;
      }
    }
  })();

  const ws = new WebSocket(d2.ws_url);
  await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
  say("media socket open");
  ws.on("message", (m) => say(`  ← ${String(m).slice(0, 160)}`));

  ws.send(JSON.stringify({ type: "start", encoding: "pcm_s16le", sample_rate: 24000, channels: 1 }));
  // Small first chunk so she starts moving quickly, then larger ones.
  let off = 0, first = true;
  while (off < pcm.length) {
    const size = first ? 9600 : 38400; // 0.2s then 0.8s at 24kHz mono 16-bit
    const slice = pcm.subarray(off, off + size);
    ws.send(JSON.stringify({ type: "agent.speak", audio: slice.toString("base64") }));
    off += size; first = false;
    await new Promise((r) => setTimeout(r, 30));
  }
  ws.send(JSON.stringify({ type: "agent.speak_end" }));
  say("audio sent — she should be speaking now");

  // Stay on the stage for the rest of the session rather than leaving the
  // moment she stops talking — people are still joining and a co-host who
  // vanishes between lines is worse than one who waits.
  await new Promise((r) => setTimeout(r, 280000));
  ws.close();
  await stop();
  say("session stopped");
  process.exit(0);
}
main();
