// Makes each guide's "Hear me" clip once, for both ages, into client/public/guides/<id>-<age>.mp3, so the guide picker never
// spends text-to-speech live. Re-run after changing a voice or sampleLine in shared/guides.ts, then commit the files.
//   npx tsx --env-file=.env scripts/make-guide-samples.ts [id ...]
import { writeFileSync } from "node:fs";
import { GUIDES, sampleLine } from "../shared/guides";

const key = (process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY || "").trim();
const only = process.argv.slice(2);
for (const g of GUIDES.filter((x) => !only.length || only.includes(x.id))) for (const age of ["younger", "older"] as const) {
  const voiceId = g.ages[age].voiceId;
  // The same model and settings as /api/guide/speak, so the sample sounds like the guide will.
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`, {
    method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text: sampleLine(g.name), model_id: "eleven_flash_v2_5", voice_settings: { stability: 0.5, similarity_boost: 0.8 } }),
  });
  if (!r.ok) { console.log(g.id, age, "failed", r.status, (await r.text()).slice(0, 200)); continue; }
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(`client/public/guides/${g.id}-${age}.mp3`, buf);
  console.log(g.id, age, "saved", buf.length, "bytes");
}
