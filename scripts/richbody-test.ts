// The editor shows markers as formatting and converts back on the way out.
// If that round trip is lossy, people's emails quietly change every time they
// open a draft — so it gets tested on the shapes the renderer supports.
//
//   npx tsx scripts/richbody-test.ts
import { parseHTML } from "linkedom";
import { markersToHtml, htmlToMarkers } from "../client/src/components/RichBody.js";

const dom = { window: parseHTML("<!doctype html><html><body></body></html>") };
(globalThis as any).Node = dom.window.Node;

let bad = 0;
function roundTrip(name: string, input: string, expected = input) {
  const el = dom.window.document.createElement("div");
  el.innerHTML = markersToHtml(input);
  const out = htmlToMarkers(el as unknown as HTMLElement);
  const ok = out === expected;
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      in:  ${JSON.stringify(input)}\n      out: ${JSON.stringify(out)}\n      want:${JSON.stringify(expected)}`);
}

roundTrip("plain paragraph", "Hello there.");
roundTrip("two paragraphs", "First para.\n\nSecond para.");
roundTrip("bold", "Some **bold words** here.");
roundTrip("italic", "Some *emphasis* here.");
roundTrip("bold and italic together", "**Bold** and *italic* in one line.");
roundTrip("link", "Go to [militaryvoice.ai](https://www.militaryvoice.ai) now.");
roundTrip("bold inside a sentence with a link", "**Claim your slot** at [the site](https://x.com).");
roundTrip("bullets", "- First point\n- Second point\n- Third point");
roundTrip("numbered", "1. First\n2. Second\n3. Third");
roundTrip("heading then text", "## Big heading\n\nSome words after it.");
roundTrip("small heading", "### Small heading\n\nBody.");
roundTrip("quote", "> This is the pulled-out bit.");
roundTrip("divider", "Above.\n\n---\n\nBelow.");
roundTrip("merge field survives", "Hi {{First_Name}}, good to see you.");
roundTrip("mixed document",
  "Hi {{First_Name}},\n\n## What to do\n\n- Pick a slot\n- Send your artwork\n\n> We run the whole broadcast.\n\nThanks.");
roundTrip("ampersand and angle brackets", "Bits & pieces < and > survive.");

// Things that must NOT round-trip into markup.
const el = dom.window.document.createElement("div");
el.innerHTML = "<p>Some <u>underlined</u> text</p>";
const noUnderline = htmlToMarkers(el as unknown as HTMLElement);
const uOk = noUnderline === "Some underlined text";
if (!uOk) bad++;
console.log(`${uOk ? "PASS" : "FAIL"}  underline is dropped, words kept${uOk ? "" : ` — got ${JSON.stringify(noUnderline)}`}`);

el.innerHTML = '<p>A <a href="javascript:alert(1)">bad link</a></p>';
const noJs = htmlToMarkers(el as unknown as HTMLElement);
const jsOk = noJs === "A bad link";
if (!jsOk) bad++;
console.log(`${jsOk ? "PASS" : "FAIL"}  non-http link is stripped${jsOk ? "" : ` — got ${JSON.stringify(noJs)}`}`);

console.log(bad === 0 ? "\nAll checks passed." : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
