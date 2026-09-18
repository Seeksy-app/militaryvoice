// The captioning agent.
//
// A LiveKit agent is an ordinary program that joins a room as a real
// participant. This one subscribes to whoever is on stage, streams their audio
// through speech-to-text, and publishes the text back into the room on the
// "captions" topic. The broadcast layout and the watch page already listen for
// that, so captions reach the audience, the recording and every RTMP
// destination without either of them knowing an agent exists.
//
// It runs as a long-lived worker — not on Vercel, which only runs functions.
// LiveKit Cloud Agents is the natural home; any host that runs a Node process
// works (Fly, Railway, Render, a small VM).
//
//   npm i @livekit/agents @livekit/agents-plugin-deepgram @livekit/rtc-node
//   LIVEKIT_URL=… LIVEKIT_API_KEY=… LIVEKIT_API_SECRET=… DEEPGRAM_API_KEY=…
//   npx tsx agent/captions.ts dev
//
// Deepgram is one choice among many — AssemblyAI, OpenAI and others have
// plugins, and swapping is a one-line change. What matters here is the shape.

import {
  type JobContext,
  WorkerOptions,
  cli,
  defineAgent,
} from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import { AudioStream, RoomEvent, TrackKind, type RemoteParticipant, type RemoteTrack } from "@livekit/rtc-node";

/** Only people the producer has put on stage are on air, so only they get captioned. */
const ON_STAGE = "On stage";

const API_BASE = (process.env.API_BASE || "http://localhost:3000").replace(/\/+$/, "");
const AGENT_TOKEN = process.env.AGENT_TOKEN || "";

/**
 * Keep what was said, as well as showing it.
 *
 * The captions are already being produced for the audience. Posting the final
 * lines back means every segment has a timed transcript the instant it ends —
 * which is what lets the clipper cut a show into posts without paying to
 * listen to the same audio a second time. Best-effort by design: a transcript
 * that fails to save must never take the captions off the air with it.
 */
function transcriptSink(studioId: number) {
  type Line = { speaker: string; text: string; startMs: number; endMs: number };
  let pending: Line[] = [];
  let timer: NodeJS.Timeout | null = null;

  async function flush() {
    timer = null;
    const batch = pending.splice(0, 200);
    if (batch.length === 0 || !AGENT_TOKEN || !studioId) return;
    try {
      const res = await fetch(`${API_BASE}/api/agent/transcript`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-agent-token": AGENT_TOKEN },
        body: JSON.stringify({ studioId, lines: batch }),
      });
      if (!res.ok) console.warn("transcript rejected:", res.status, (await res.text()).slice(0, 160));
    } catch (err) {
      console.warn("transcript not saved:", (err as Error).message);
    }
  }

  return {
    add(line: Line) {
      if (!AGENT_TOKEN || !studioId) return;
      pending.push(line);
      if (pending.length >= 25) void flush();
      else if (!timer) timer = setTimeout(() => void flush(), 5000);
    },
    async drain() {
      if (timer) clearTimeout(timer);
      await flush();
    },
  };
}

/** Rooms are named mv-studio-<id>; the transcript belongs to that studio. */
function studioIdFrom(roomName: string): number {
  const m = /(\d+)$/.exec(roomName ?? "");
  return m ? Number(m[1]) : 0;
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();
    const room = ctx.room;
    const stt = new deepgram.STT({ model: "nova-3", interimResults: true });
    const studioId = studioIdFrom(room.name ?? "");
    const transcript = transcriptSink(studioId);
    if (!AGENT_TOKEN) console.warn("No AGENT_TOKEN — captions will go out but nothing will be kept for clipping.");

    const publish = async (speaker: string, text: string, final: boolean) => {
      await room.localParticipant?.publishData(
        new TextEncoder().encode(JSON.stringify({ type: "caption", speaker, text, final })),
        { topic: "captions", reliable: false },
      );
    };

    const transcribe = async (participant: RemoteParticipant, track: RemoteTrack) => {
      const name = participant.name || participant.identity;
      const stream = stt.stream();
      const audio = new AudioStream(track);
      // Deepgram times each phrase from the start of its own stream, so a
      // clip cut from these needs the wall clock the stream began on.
      const streamStart = Date.now();

      // Feed audio in and read text out at the same time.
      void (async () => {
        for await (const frame of audio) stream.pushFrame(frame);
        stream.endInput();
      })();

      for await (const event of stream) {
        const alt = event.alternatives?.[0];
        if (!alt?.text) continue;
        // Interim results keep captions moving with the speaker; the final one
        // corrects it. Both are published — the layout just shows the latest.
        const final = event.type === "final_transcript";
        await publish(name, alt.text, final);
        // Only finals are kept: an interim is the same words half-heard, and
        // a transcript full of both is worse than no transcript at all.
        if (final) {
          transcript.add({
            speaker: name,
            text: alt.text,
            startMs: streamStart + (alt.startTime ?? 0) * 1000,
            endMs: streamStart + (alt.endTime ?? alt.startTime ?? 0) * 1000,
          });
        }
      }
    };

    room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      if (track.kind !== TrackKind.KIND_AUDIO) return;
      if ((participant.attributes?.state ?? "") !== ON_STAGE) return;
      void transcribe(participant, track).catch((err) =>
        console.error("transcription stopped for", participant.identity, err),
      );
    });

    // Whatever is still in hand when the room empties.
    room.on(RoomEvent.Disconnected, () => void transcript.drain());

    // Someone promoted mid-sentence should start being captioned immediately.
    room.on(RoomEvent.ParticipantAttributesChanged, (_changed, participant) => {
      if ((participant.attributes?.state ?? "") !== ON_STAGE) return;
      for (const pub of participant.trackPublications.values()) {
        if (pub.kind === TrackKind.KIND_AUDIO && pub.track) {
          void transcribe(participant as RemoteParticipant, pub.track).catch(() => {});
        }
      }
    });
  },
});

cli.runApp(new WorkerOptions({ agent: import.meta.filename }));
