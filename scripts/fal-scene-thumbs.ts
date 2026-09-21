// Two stills for the scenes that have no face to wear: the pre-show and the
// sponsor reel. Made on fal.ai in the same look as the standby backdrop — a
// dark studio, warm bokeh, navy and gold — so the rail reads as one set.
//
//   npx tsx scripts/fal-scene-thumbs.ts
import "dotenv/config";
import fs from "node:fs/promises";

const KEY = process.env.FAL_KEY;
if (!KEY) throw new Error("FAL_KEY is not set");

const STYLE =
  "warm, funny, photoreal, cinematic lighting, dark navy studio with amber bokeh lights behind, no text, no words, no letters, no logos";

const SHOTS: { file: string; prompt: string }[] = [
  {
    file: "pre-show.jpg",
    prompt: `A golden retriever wearing big studio headphones and aviator sunglasses sits behind a broadcast microphone, one paw hovering over a big red ON AIR button, tongue out, looking straight at the camera like it is about to start the show, ${STYLE}`,
  },
  {
    file: "sponsor-reel.jpg",
    prompt: `A happy corgi in a tiny navy blazer and gold bow tie stands on a news desk, one paw pointing proudly at a big glowing blank screen beside it, gold balloons and confetti, bright, cheerful, well-lit, photoreal, warm golden light, soft bokeh, no text, no words, no letters, no logos`,
  },
];

for (const s of SHOTS) {
  const r = await fetch("https://fal.run/fal-ai/nano-banana", {
    method: "POST",
    headers: { Authorization: `Key ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: s.prompt, aspect_ratio: "16:9", num_images: 1, output_format: "jpeg" }),
  });
  if (!r.ok) throw new Error(`fal ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as { images: { url: string; width: number; height: number }[] };
  const url = j.images[0].url;
  const img = await fetch(url);
  const buf = Buffer.from(await img.arrayBuffer());
  await fs.writeFile(`client/public/scenes/${s.file}`, buf);
  console.log(s.file, j.images[0].width, "x", j.images[0].height, `${Math.round(buf.length / 1024)}kb`);
}
