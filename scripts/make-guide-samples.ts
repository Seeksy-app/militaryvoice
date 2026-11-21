// Makes each guide's "Hear me" clip once and saves it in R2 (guides/samples/<key>.mp3), so the
// guide picker never spends text-to-speech live. Re-run after changing a sample line in shared/guides.ts.
//   npx tsx --env-file=.env scripts/make-guide-samples.ts [key ...]
import { GUIDES, sampleKey } from "../shared/guides";
import { putRecordingObject } from "../server/recordingStorage";
import { sayable } from "../server/guide";

const key = (process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY || "").trim();
const only = process.argv.slice(2);
for (const g of GUIDES.filter((x) => !only.length || only.includes(x.key))) {
  // The same model and settings as /api/guide/speak, so the sample sounds like the guide will.
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${g.voiceId}?output_format=mp3_44100_64`, {
    method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text: sayable(g.sample), model_id: "eleven_flash_v2_5", voice_settings: { stability: 0.5, similarity_boost: 0.8 } }),
  });
  if (!r.ok) { console.log(g.key, "failed", r.status, (await r.text()).slice(0, 200)); continue; }
  const buf = Buffer.from(await r.arrayBuffer());
  await putRecordingObject(sampleKey(g.key), buf, "audio/mpeg");
  console.log(g.key, "saved", buf.length, "bytes");
}
process.exit(0);
