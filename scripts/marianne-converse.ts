// Marianne, listening.
//
//   npx tsx scripts/marianne-converse.ts [seconds]
//
// Her mouth was the hard part and it is done. This gives her ears, which needs
// a second connection: her own participant is deliberately deaf — it publishes
// and never subscribes — because when it did subscribe, the room's audio went
// in and came back out and everyone heard themselves a second later.
//
// So a separate headless listener joins, subscribes, and never publishes. It
// cannot feed itself.
//
// The loop: audio in → wait for a gap → transcribe → Claude → Madison → push
// to Marianne's media socket. Turn-taking is an energy gate rather than a
// trained detector: speech is loud, the gap after a sentence is not, and 900ms
// of quiet is a reasonable guess at "your turn". It will occasionally answer
// a dramatic pause. That is the right failure for a green room and the wrong
// one for live air, which is why she stays scripted on the broadcast.
import "dotenv/config";
import WebSocket from "ws";
import Anthropic from "@anthropic-ai/sdk";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { Room, RoomEvent, AudioStream, TrackKind } from "@livekit/rtc-node";

const MARIANNE = "8532b602-89e8-44fa-a9e2-5a4259a058cc";
const MADISON = "NUjosfEayZAdRcDmcHM8";
const SECONDS = Math.min(Number(process.argv[2] ?? 300), 300);
const K = process.env.LIVEAVATAR_API_KEY!;
const http = process.env.LIVEKIT_URL!.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
const svc = new RoomServiceClient(http, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
const say = (...a: unknown[]) => process.stdout.write(a.join(" ") + "\n");

const PERSONA = `You are Marianne, co-host of The Podcast Marathon — 26.2 miles of
military and veteran podcasts on National Military Podcast Day, 5 October.

You are talking to the crew in the studio. Be warm, brisk and brief: one or two
sentences, never three. You are among veterans — no solemnity, no "thank you for
your service". Do not invent facts about the schedule; if you do not know
something, say so plainly and offer to find out.`;

/** Scribe wants a file, so the raw PCM gets a WAV header. */
function wav(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function main() {
  const live = ((await svc.listRooms().catch(() => [])) as any[]).filter((r) => r.numParticipants > 0);
  if (!live.length) { say("Nobody in any studio room."); process.exit(0); }
  const room = live.sort((a, b) => b.numParticipants - a.numParticipants)[0].name;
  say(`room ${room}`);

  // Her avatar: publishes, never listens.
  const face = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, { identity: "marianne", name: "Marianne" });
  face.addGrant({ room, roomJoin: true, canPublish: true, canPublishData: true, canSubscribe: false });
  const r1 = await fetch("https://api.liveavatar.com/v1/sessions/token", {
    method: "POST", headers: { "X-API-KEY": K, "content-type": "application/json" },
    body: JSON.stringify({ avatar_id: MARIANNE, mode: "LITE", max_session_duration: SECONDS,
      livekit_config: { livekit_url: process.env.LIVEKIT_URL, livekit_room: room, livekit_client_token: await face.toJwt() } }),
  });
  if (!r1.ok) { say(`token ${r1.status}: ${(await r1.text()).slice(0, 200)}`); process.exit(1); }
  const d1 = (await r1.json() as any).data;
  const r2 = await fetch("https://api.liveavatar.com/v1/sessions/start", {
    method: "POST", headers: { Authorization: `Bearer ${d1.session_token}`, "content-type": "application/json" }, body: "{}" });
  if (!r2.ok) { say(`start ${r2.status}: ${(await r2.text()).slice(0, 200)}`); process.exit(1); }
  const d2 = (await r2.json() as any).data;
  say(`avatar session ${d1.session_id}`);

  const ws = new WebSocket(d2.ws_url);
  await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
  const anthropic = new Anthropic();
  let busy = false;

  async function reply(heard: string) {
    if (busy) return;
    busy = true;
    try {
      say(`  heard: "${heard}"`);
      const msg = await anthropic.messages.create({
        model: "claude-opus-5", max_tokens: 200, system: PERSONA,
        messages: [{ role: "user", content: `Someone in the studio said: "${heard}"\n\nReply out loud. Only the words you say.` }],
      });
      const line = msg.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("").trim();
      say(`  says:  "${line}"`);
      const tts = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${MADISON}?output_format=pcm_24000`, {
        method: "POST", headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "content-type": "application/json" },
        body: JSON.stringify({ text: line, model_id: "eleven_turbo_v2_5" }) });
      if (!tts.ok) { say(`  TTS ${tts.status}`); return; }
      const pcm = Buffer.from(await tts.arrayBuffer());
      ws.send(JSON.stringify({ type: "start", encoding: "pcm_s16le", sample_rate: 24000, channels: 1 }));
      for (let o = 0; o < pcm.length; o += 38400) {
        ws.send(JSON.stringify({ type: "agent.speak", audio: pcm.subarray(o, o + 38400).toString("base64") }));
        await new Promise((r) => setTimeout(r, 25));
      }
      ws.send(JSON.stringify({ type: "agent.speak_end" }));
    } catch (e: any) { say(`  reply failed: ${String(e?.message ?? e).slice(0, 140)}`); }
    finally { busy = false; }
  }

  // The listener: subscribes, never publishes, so it cannot hear itself.
  const ears = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, { identity: "marianne-ears", name: "Marianne (listening)" });
  ears.addGrant({ room, roomJoin: true, canPublish: false, canSubscribe: true });
  const listener = new Room();
  await listener.connect(process.env.LIVEKIT_URL!, await ears.toJwt(), { autoSubscribe: true, dynacast: false });
  say("listening\n");

  listener.on(RoomEvent.TrackSubscribed, (track: any, _pub: any, participant: any) => {
    if (track.kind !== TrackKind.KIND_AUDIO || participant.identity === "marianne") return;
    say(`  ear on ${participant.identity}`);
    (async () => {
      const stream = new AudioStream(track);
      let buf: Buffer[] = [], quiet = 0, loud = 0;
      for await (const frame of stream) {
        const pcm = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
        let peak = 0;
        const view = new Int16Array(frame.data.buffer, frame.data.byteOffset, frame.data.length);
        for (let i = 0; i < view.length; i += 16) peak = Math.max(peak, Math.abs(view[i]));
        const ms = (frame.samplesPerChannel / frame.sampleRate) * 1000;
        if (peak > 1200) { loud += ms; quiet = 0; buf.push(pcm); }
        else if (loud > 0) { quiet += ms; buf.push(pcm); }
        // 900ms of quiet after at least 400ms of speech = their turn is over.
        if (loud > 400 && quiet > 900) {
          const utter = Buffer.concat(buf);
          buf = []; loud = 0; quiet = 0;
          if (busy) continue;
          const fd = new FormData();
          fd.append("file", new Blob([new Uint8Array(wav(utter, frame.sampleRate))], { type: "audio/wav" }), "turn.wav");
          fd.append("model_id", "scribe_v1");
          const st = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
            method: "POST", headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! }, body: fd });
          if (!st.ok) { say(`  STT ${st.status}`); continue; }
          const text = String(((await st.json()) as any).text ?? "").trim();
          if (text.length > 2) await reply(text);
        }
        if (buf.length > 900) buf = []; // never hoard more than ~20s
      }
    })().catch((e) => say(`ear failed: ${String(e?.message ?? e).slice(0, 140)}`));
  });

  setTimeout(async () => {
    await listener.disconnect().catch(() => {});
    ws.close();
    await fetch("https://api.liveavatar.com/v1/sessions/stop", {
      method: "POST", headers: { "X-API-KEY": K, "content-type": "application/json" },
      body: JSON.stringify({ session_id: d1.session_id }) }).catch(() => {});
    say("\nsession over");
    process.exit(0);
  }, SECONDS * 1000);
}
main();
