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
import postgres from "postgres";
import { mileMarkers } from "../shared/mileMarkers";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { Room, RoomEvent, AudioStream, TrackKind } from "@livekit/rtc-node";

const MARIANNE = "8532b602-89e8-44fa-a9e2-5a4259a058cc";
const MADISON = "NUjosfEayZAdRcDmcHM8";
// 0 = stay up until stopped. Sessions renew underneath, so there is no
// five-minute ceiling on how long she is in the room.
const SECONDS = Number(process.argv[2] ?? 0);
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

/**
 * Everything she should know without being told.
 *
 * She had a persona and no facts, so "what time am I on?" got a graceful
 * dodge — she offered to go and find the running order. The running order is
 * one query away, and a co-host who cannot answer that question is a
 * decoration.
 */
async function loadShow(sql: ReturnType<typeof postgres>) {
  const [ev] = await sql`SELECT id, name, start_at_utc, slot_minutes, duration_hours FROM events WHERE is_featured = true`;
  const n = Math.round((ev.duration_hours * 60) / ev.slot_minutes);
  const rows = await sql`SELECT slot_index, podcast_name, host_name, branch, service_status, show_format, email
    FROM signups WHERE event_id = ${ev.id} AND status <> 'cancelled' ORDER BY slot_index`;
  const at = (i: number) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
    .format(new Date(new Date(ev.start_at_utc).getTime() + i * ev.slot_minutes * 60000));
  const markers = mileMarkers(Array.from({ length: n }, (_, i) => {
    const r = (rows as any[]).find((x) => x.slot_index === i);
    return { signup: r ? { podcastName: r.podcast_name } : null };
  }));
  const lines = (rows as any[]).map((r) => {
    const m = markers[r.slot_index];
    const where = m?.kind === "mile" ? `Mile ${m.n}` : m?.kind === "extra" ? m.label
      : m?.kind === "flag" ? "the Flag Carry" : m?.kind === "start" ? "the start"
      : m?.kind === "finish" ? "the finish" : m?.kind === "medal" ? "after the finish" : "";
    const who = [r.branch, r.service_status].filter(Boolean).join(" ");
    return `${at(r.slot_index)} ET · ${where} · ${r.podcast_name} — ${r.host_name}${who ? ` (${who})` : ""} · ${r.show_format === "prerecorded" ? "pre-recorded" : "live"}`;
  });
  // identity -> who that actually is, so she can greet by name
  const parts = await sql`SELECT p.id, s.host_name, s.podcast_name, s.slot_index
    FROM studio_participants p LEFT JOIN signups s ON s.id = p.signup_id`;
  const whoIs = new Map<string, string>();
  for (const p of parts as any[]) {
    if (!p.host_name) continue;
    whoIs.set(`p-${p.id}`, `${p.host_name}, who hosts ${p.podcast_name}${p.slot_index != null ? `, on at ${at(p.slot_index)} ET` : ""}`);
  }
  return { eventName: ev.name, sheet: lines.join("\n"), whoIs };
}

async function main() {
  // The room with a person in it, not the room with the most connections.
  //
  // Headcount sent her to a studio whose only occupant was a stale producer
  // tab publishing nothing, while the actual podcaster sat alone in another
  // room. A participant who publishes no audio is furniture; she should go
  // where someone is talking.
  // Wait for a person rather than giving up on an empty room. Starting her
  // costs credits from the moment she connects, so she should not be burning
  // them in an empty green room — but exiting means somebody has to run this
  // again at exactly the right moment, which is worse.
  let room = "";
  let best = 0;
  for (let wait = 0; wait < 60 && !room; wait++) {
    for (const r of ((await svc.listRooms().catch(() => [])) as any[])) {
      const ps = ((await svc.listParticipants(r.name).catch(() => [])) as any[])
        .filter((p) => !p.identity.startsWith("marianne"))
        .filter((p) => p.tracks.some((t: any) => t.type === 0));
      if (ps.length > best) { best = ps.length; room = r.name; }
    }
    if (!room) { if (wait === 0) say("waiting for someone with a mic on…"); await new Promise((x) => setTimeout(x, 3000)); }
  }
  if (!room) { say("Nobody turned up."); process.exit(0); }
  say(`room ${room} — ${best} live mic(s)`);
  const roomName = room;

  // Her avatar: publishes, never listens.
  const face = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, { identity: "marianne", name: "Marianne" });
  // canSubscribe is not optional: LiveAvatar validates the token and refuses
  // one without it. So she cannot be made deaf at the token, and if her media
  // server turns out to echo the room, that has to be solved somewhere else.
  face.addGrant({ room, roomJoin: true, canPublish: true, canPublishData: true, canSubscribe: true });
  // She renews herself.
  //
  // A session is capped at five minutes on this plan, and she was simply
  // disappearing when it ran out — mid-conversation, with no warning, and
  // somebody had to notice and restart her. A green room co-host who vanishes
  // every five minutes is a demo. This starts the next session shortly before
  // the current one expires and swaps to it, so from the room she is just
  // there.
  const CAP = 290;
  let face_token = "";
  let avatar: { id: string; ws: WebSocket } | null = null;

  async function startAvatar(): Promise<boolean> {
    face_token = await face.toJwt();
    const r1 = await fetch("https://api.liveavatar.com/v1/sessions/token", {
      method: "POST", headers: { "X-API-KEY": K, "content-type": "application/json" },
      body: JSON.stringify({ avatar_id: MARIANNE, mode: "LITE", max_session_duration: CAP,
        livekit_config: { livekit_url: process.env.LIVEKIT_URL, livekit_room: room, livekit_client_token: face_token } }),
    });
    if (!r1.ok) { say(`token ${r1.status}: ${(await r1.text()).slice(0, 160)}`); return false; }
    const d1 = (await r1.json() as any).data;
    const r2 = await fetch("https://api.liveavatar.com/v1/sessions/start", {
      method: "POST", headers: { Authorization: `Bearer ${d1.session_token}`, "content-type": "application/json" }, body: "{}" });
    if (!r2.ok) { say(`start ${r2.status}: ${(await r2.text()).slice(0, 160)}`); return false; }
    const d2 = (await r2.json() as any).data;
    const sock = new WebSocket(d2.ws_url);
    await new Promise<void>((res, rej) => { sock.once("open", () => res()); sock.once("error", rej); });
    const old = avatar;
    avatar = { id: d1.session_id, ws: sock };
    if (old) {
      old.ws.close();
      await fetch("https://api.liveavatar.com/v1/sessions/stop", {
        method: "POST", headers: { "X-API-KEY": K, "content-type": "application/json" },
        body: JSON.stringify({ session_id: old.id }) }).catch(() => {});
      say(`renewed → ${d1.session_id.slice(0, 8)}`);
    } else {
      say(`avatar session ${d1.session_id}`);
    }
    return true;
  }

  if (!(await startAvatar())) process.exit(1);
  // Twenty seconds of headroom: the new one is up and publishing before the
  // old one is cut, so there is no moment where the room has no co-host.
  setInterval(() => { void startAvatar(); }, (CAP - 20) * 1000);
  const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
  const show = await loadShow(sql);
  await sql.end();
  say(`schedule loaded — ${show.sheet.split("\n").length} segments`);

  const anthropic = new Anthropic();
  let busy = false;
  let openUntil = 0;
  // What has been said so far. Without it every reply was a standalone
  // request: she could answer a question and then have no idea what it was,
  // so "who's on before me?" arrived with nothing to refer back to. That is
  // the difference between a search box and a conversation.
  const history: { role: "user" | "assistant"; content: string }[] = [];
  let pending: { text: string; who?: string } | null = null;

  async function reply(heard: string, askedBy?: string) {
    // Mid-sentence, hold it rather than lose it. People carry on talking while
    // she is still answering, and dropping that turn made her feel deaf.
    if (busy) { pending = { text: heard, who: askedBy }; return; }
    busy = true;
    // Only the person who asked hears the answer. Five people wait in a green
    // room and four of them are mid-conversation; a voice answering somebody
    // else's question out loud is an interruption, not a service.
    if (askedBy) {
      const all = (await svc.listParticipants(roomName).catch(() => [])) as any[];
      const hers = all.find((p) => p.identity === "marianne")?.tracks?.filter((t: any) => t.type === 0).map((t: any) => t.sid) ?? [];
      for (const p of all) {
        if (p.identity.startsWith("marianne")) continue;
        await svc.updateSubscriptions(roomName, p.identity, hers, p.identity === askedBy).catch(() => {});
      }
    }
    try {
      say(`  heard: "${heard}"`);
      const msg = await anthropic.messages.create({
        model: "claude-opus-5", max_tokens: 200,
        system: `${PERSONA}\n\nThe running order for ${show.eventName}, all times Eastern:\n${show.sheet}\n\nThis is the confirmed sheet. Answer from it directly — never say you will go and check.`,
        messages: [
          ...history,
          { role: "user" as const, content:
            `${askedBy && show.whoIs.get(askedBy) ? `You are speaking to ${show.whoIs.get(askedBy)}.` : "You do not know who this is."}\n\nThey said: "${heard}"\n\nReply out loud. Only the words you say.` },
        ],
      });
      const line = msg.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("").trim();
      say(`  says:  "${line}"`);
      history.push({ role: "user", content: heard }, { role: "assistant", content: line });
      // Enough to hold a thread, not so much that the prompt grows all night.
      while (history.length > 12) history.shift();
      const tts = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${MADISON}?output_format=pcm_24000`, {
        method: "POST", headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "content-type": "application/json" },
        body: JSON.stringify({ text: line, model_id: "eleven_turbo_v2_5" }) });
      if (!tts.ok) { say(`  TTS ${tts.status}`); return; }
      const pcm = Buffer.from(await tts.arrayBuffer());
      const ws = avatar?.ws;
      if (!ws) { say("  no avatar session"); return; }
      ws.send(JSON.stringify({ type: "start", encoding: "pcm_s16le", sample_rate: 24000, channels: 1 }));
      for (let o = 0; o < pcm.length; o += 38400) {
        ws.send(JSON.stringify({ type: "agent.speak", audio: pcm.subarray(o, o + 38400).toString("base64") }));
        await new Promise((r) => setTimeout(r, 25));
      }
      ws.send(JSON.stringify({ type: "agent.speak_end" }));
    } catch (e: any) { say(`  reply failed: ${String(e?.message ?? e).slice(0, 140)}`); }
    finally {
      busy = false;
      const next = pending;
      pending = null;
      if (next) { openUntil = Date.now() + 25000; await reply(next.text, next.who); }
    }
  }

  // The listener: subscribes, never publishes, so it cannot hear itself.
  const ears = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, { identity: "marianne-ears", name: "Marianne (listening)" });
  ears.addGrant({ room, roomJoin: true, canPublish: false, canSubscribe: true });
  const listener = new Room();
  // Handler before connect, and a sweep afterwards. Tracks that already exist
  // are subscribed during connect, so a handler attached after it never hears
  // about them — she worked when somebody joined after her and sat deaf when
  // they were already in the room, which is the normal case.
  const ears_on = (track: any, participant: any) => listenTo(track, participant);
  listener.on(RoomEvent.TrackSubscribed, (track: any, _pub: any, participant: any) => ears_on(track, participant));
  await listener.connect(process.env.LIVEKIT_URL!, await ears.toJwt(), { autoSubscribe: true, dynacast: false });
  for (const p of listener.remoteParticipants.values()) {
    for (const pub of p.trackPublications.values()) if (pub.track) ears_on(pub.track, p);
  }
  for (let i = 0; i < 20; i++) {
    const her = ((await svc.listParticipants(room).catch(() => [])) as any[]).find((p) => p.identity === "marianne");
    if (her?.tracks?.some((t: any) => t.type === 1)) {
      await svc.updateParticipant(room, "marianne", { attributes: { state: "Green room", avatar: "1" } }).catch(() => {});
      say("she is on screen");
      break;
    }
    await new Promise((x) => setTimeout(x, 1500));
  }
  say("listening\n");

  const eared = new Set<string>();
  function listenTo(track: any, participant: any) {
    if (track.kind !== TrackKind.KIND_AUDIO || participant.identity.startsWith("marianne")) return;
    // Both the sweep and the event fire for a track already published, and two
    // ears on one mouth transcribe everything twice.
    if (eared.has(participant.identity)) return;
    eared.add(participant.identity);
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
          if (text.length <= 2) continue;

          // She answers when addressed, and for a short while afterwards.
          //
          // Without this she replies to whatever anyone says, including two
          // podcasters talking to each other. Her name is how people already
          // address her — "Marianne, can you hear me?" — so it costs nothing
          // to learn, and the window means a follow-up does not need it again.
          // Speech-to-text does not know how she spells it. Scribe returned
          // "Mary Ann" for a clear "Marianne", so an exact match meant she
          // ignored somebody talking straight to her. Generous on purpose:
          // answering when not quite addressed costs a sentence, not
          // answering at all costs the whole feature.
          const named = /\bmar(i|y|ie)[\s-]?(anne?|ann|on|ana)\b/i.test(text);
          if (named) openUntil = Date.now() + 25000;
          if (!named && Date.now() > openUntil) { say(`  (not for her: "${text.slice(0, 48)}")`); continue; }
          openUntil = Date.now() + 25000;
          await reply(text, participant.identity);
        }
        if (buf.length > 900) buf = []; // never hoard more than ~20s
      }
    })().catch((e) => say(`ear failed: ${String(e?.message ?? e).slice(0, 140)}`));
  }

  async function shutDown(why: string) {
    say(`\n${why}`);
    await listener.disconnect().catch(() => {});
    if (avatar) {
      avatar.ws.close();
      await fetch("https://api.liveavatar.com/v1/sessions/stop", {
        method: "POST", headers: { "X-API-KEY": K, "content-type": "application/json" },
        body: JSON.stringify({ session_id: avatar.id }) }).catch(() => {});
    }
    process.exit(0);
  }

  // Ctrl-C leaves a session running and billing otherwise.
  process.on("SIGINT", () => void shutDown("stopped"));
  process.on("SIGTERM", () => void shutDown("stopped"));
  if (SECONDS > 0) setTimeout(() => void shutDown("time up"), SECONDS * 1000);
}
main();
