// End to end: browser-shaped HTML → marker text → the email HTML that sends.
import { parseHTML } from "linkedom";
import { htmlToMarkers } from "../client/src/components/RichBody.js";
const { document, Node } = parseHTML("<!doctype html><html><body></body></html>");
(globalThis as any).Node = Node;
const el = document.createElement("div");
el.innerHTML =
  '<div>Hi {{First_Name}},</div><div><br></div><div><b>Here’s your quick pre-show checklist:</b></div>' +
  '<ul><li><b>Step into the <a href="https://www.militaryvoice.ai/studio">green room</a></b>. Check your audio and video.</li>' +
  "<li><b>Bring your extras.</b> Upload your logo, images, clips.</li>" +
  "<li><b>Rally your crew.</b> Use our social media tool.</li></ul>" +
  "<div>See you in the studio!</div>";
const markers = htmlToMarkers(el as any);
console.log("--- marker text the editor stores ---");
console.log(markers);
console.log("\n--- does the email renderer see a list? ---");
const BUL = /^\s*[-•]\s+(.*)$/;
for (const block of markers.split(/\n{2,}/)) {
  const lines = block.trim().split("\n").filter((l) => l.trim());
  const isList = lines.length > 0 && lines.every((l) => BUL.test(l));
  console.log(`  ${isList ? `LIST (${lines.length} items)` : "paragraph"}: ${lines[0].slice(0, 56)}`);
}
