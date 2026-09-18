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

// ---------------------------------------------------------------------------
// The HTML a browser actually produces
//
// Everything above starts from markersToHtml, which writes tidy top-level
// blocks. contentEditable does not: press the bullet button and you get the
// list wrapped in a div, press return and you get divs inside divs. The first
// version of this passed every test above and still flattened a three-bullet
// list into one paragraph in the preview, because the serialiser only looked
// at the top level.
// ---------------------------------------------------------------------------
function fromHtml(name: string, html: string, expected: string) {
  const el = dom.window.document.createElement("div");
  el.innerHTML = html;
  const out = htmlToMarkers(el as unknown as HTMLElement);
  const ok = out === expected;
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      out: ${JSON.stringify(out)}\n      want:${JSON.stringify(expected)}`);
}

console.log("\nBrowser-shaped HTML:");
fromHtml(
  "list wrapped in a div (Chrome after the bullet button)",
  "<div><ul><li><b>One.</b> First</li><li><b>Two.</b> Second</li></ul></div>",
  "- **One.** First\n- **Two.** Second",
);
fromHtml(
  "the real pre-show checklist shape",
  '<div>Hi {{First_Name}},</div><div><br></div><div><b>Here\u2019s your checklist:</b></div>' +
    '<ul><li><b>Step into the <a href="https://x.com/a">green room</a></b>. Check your audio.</li>' +
    "<li><b>Bring your extras.</b> Upload your logo.</li></ul><div>Thanks.</div>",
  "Hi {{First_Name}},\n\n**Here\u2019s your checklist:**\n\n- **Step into the [green room](https://x.com/a)**. Check your audio.\n- **Bring your extras.** Upload your logo.\n\nThanks.",
);
fromHtml("divs as paragraphs", "<div>One</div><div>Two</div>", "One\n\nTwo");
fromHtml("an empty div between paragraphs", "<div>One</div><div><br></div><div>Two</div>", "One\n\nTwo");
fromHtml("nested divs", "<div><div><div>Buried</div></div></div>", "Buried");
fromHtml("ordered list in a div", "<div><ol><li>First</li><li>Second</li></ol></div>", "1. First\n2. Second");
fromHtml("empty list items are dropped", "<ul><li>Real</li><li><br></li></ul>", "- Real");
fromHtml("heading in a wrapper", "<div><h2>Title</h2></div><div>Body</div>", "## Title\n\nBody");
fromHtml("non-breaking spaces become spaces", "<div>A\u00a0B</div>", "A B");
fromHtml(
  "a list and a paragraph inside one div",
  "<div><ul><li>Item</li></ul><p>After</p></div>",
  "- Item\n\nAfter",
);

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
