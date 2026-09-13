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

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();
    const room = ctx.room;
    const stt = new deepgram.STT({ model: "nova-3", interimResults: true });

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
        await publish(name, alt.text, event.type === "final_transcript");
      }
    };

    room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      if (track.kind !== TrackKind.KIND_AUDIO) return;
      if ((participant.attributes?.state ?? "") !== ON_STAGE) return;
      void transcribe(participant, track).catch((err) =>
        console.error("transcription stopped for", participant.identity, err),
      );
    });

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
