// Founding Members emails from Riccoh to the Marathon (final texts, 21 Nov 2026: Andrew "Yes, 3a, ok").
// The words live in server/marathonFounding.ts; this writes drafts.txt and preview-1/2/3.html from them:
//   npx tsx creative/black-friday/marathon-email/drafts.ts
import { writeFileSync } from "node:fs";
import { renderMarathon, RICCOH_FROM, STEPS, type MarathonStep } from "../../../server/marathonFounding.ts";

const WHEN: Record<MarathonStep, string> = {
  1: "when Andrew says",
  2: "Wed 25 Nov, 9:00 am ET, only if no reply, sign-in, click or plan since email 1",
  3: "Fri 27 Nov, 8:00 am ET, same test (3a wording)",
};
const dir = new URL(".", import.meta.url).pathname;
const out: string[] = [];
for (const step of [1, 2, 3] as MarathonStep[]) {
  const r = renderMarathon(step, "laura@example.com", "Laura");
  writeFileSync(`${dir}preview-${step}.html`, r.html);
  out.push(`=== Email ${step} · ${WHEN[step]}\nFrom: ${RICCOH_FROM}\nSubject: ${r.subject}\nPreheader: ${STEPS[step].preheader}\nHeader image: https://www.militaryvoices.ai/email/founding-hero.jpg\n\n${r.text}\n`);
}
writeFileSync(`${dir}drafts.txt`, out.join("\n"));
console.log("wrote drafts.txt and 3 previews");
