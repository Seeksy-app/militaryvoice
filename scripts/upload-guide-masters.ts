// Puts each guide's full-resolution master (1024×1024, ready for a talking avatar) in R2 at guides/master/<id>-<age>.jpg.
//   npx tsx --env-file=.env scripts/upload-guide-masters.ts <folder of <id>-<age>.jpg>
import { readFileSync } from "node:fs";
import { GUIDES, guideMaster } from "../shared/guides";
import { putRecordingObject } from "../server/recordingStorage";
const dir = process.argv[2];
for (const g of GUIDES) for (const age of ["younger", "older"] as const) {
  await putRecordingObject(guideMaster(g.id, age), readFileSync(`${dir}/${g.id}-${age}.jpg`), "image/jpeg");
  console.log("saved", guideMaster(g.id, age));
}
process.exit(0);
