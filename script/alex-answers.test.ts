// How Alex's how-to answers look (PM for Andrew, 24 Nov 2026: "Yes, fix Alex"): at most 3 numbered steps, about 60
// words, no jargon, no paths typed out, and a "Take me there" button instead.
// Run: npx tsx --test script/alex-answers.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { QUICK_ANSWERS } from "../server/helpArticles.js";
import { shapeAnswer, wordCount, WORD_CAP, KNOWLEDGE, systemPromptForTest } from "../server/help.js";

const PROMISE = /\b(an?|real) (person|human)\b|\bshortly\b/i;
const JARGON = /\bfeed address\b|\bRSS\b|\bowner email\b|\bturn the feed away\b/i;
const RAW_PATH = /\/help\/|\/host\/dashboard|https?:\/\//;

test("every canned how-to is short, stepped, plain and path-free", () => {
  assert.ok(QUICK_ANSWERS.length >= 5);
  for (const { q, a } of QUICK_ANSWERS) {
    assert.ok(wordCount(a) <= WORD_CAP, `${q}: ${wordCount(a)} words`);
    const steps = a.split("\n").filter((l) => /^\d+\.\s/.test(l));
    assert.ok(steps.length <= 3 && (steps.length >= 1 || !/^how do i/i.test(q)), `${q}: ${steps.length} steps`);
    assert.doesNotMatch(a, RAW_PATH, q);
    assert.doesNotMatch(a, JARGON, q);
    assert.doesNotMatch(a, PROMISE, q);
    const { text, actions } = shapeAnswer(a);
    assert.doesNotMatch(text, /\[\[/, `${q}: a token left in the words`);
    assert.equal(actions[0]?.label, "Take me there", `${q}: no Take me there`);
  }
});

test("the Spotify/Apple answer is two steps and takes them to Directories", () => {
  const sa = QUICK_ANSWERS.find((x) => /spotify/i.test(x.q) && /apple/i.test(x.q));
  assert.ok(sa, "no Spotify/Apple answer");
  const { text, actions } = shapeAnswer(sa!.a);
  assert.match(text, /^1\. .*\*\*Directories\*\*/m);
  assert.match(text, /^2\. .*\*\*List it\*\*/m);
  assert.deepEqual(actions, [{ label: "Take me there", href: "/host/dashboard/podcast?tab=directories", guide: "directories" }]);
});

test("a dense answer with paths loses them and gets a Read the full guide button", () => {
  const dense =
    "Open /host/dashboard/podcast and pick your show. Your feed address is on the Publishing tab. Full steps at /help/podcast. You can also read https://www.militaryvoices.ai/help/podcast#directories for more.";
  const { text, actions } = shapeAnswer(dense);
  assert.doesNotMatch(text, RAW_PATH, text);
  assert.ok(actions.some((a) => a.label === "Read the full guide" && a.href === "/help/podcast"), JSON.stringify(actions));
  assert.doesNotMatch(text, /Full steps at/);
});

test("tokens become buttons and unknown ones are dropped", () => {
  const { text, actions } = shapeAnswer("1. Open **Library**.\n[[GO:library]]\n[[READ:library]]\n[[GO:nowhere]]");
  assert.equal(text, "1. Open **Library**.");
  assert.deepEqual(actions.map((a) => a.label), ["Take me there", "Read the full guide"]);
  assert.equal(actions[1].href, "/help/library");
  const pub = shapeAnswer("It's on the schedule.\n[[GO:schedule]]");
  assert.deepEqual(pub.actions, [{ label: "Take me there", href: "/schedule" }]);
});

test("the prompt carries the shape rules and the canned answers", () => {
  const p = systemPromptForTest();
  assert.match(p, new RegExp(`About ${WORD_CAP} words`));
  assert.match(p, /at most 3 short numbered steps/);
  assert.match(p, /Never type a path/);
  assert.doesNotMatch(p, /name the page to go to as its path/);
  assert.ok(p.includes(QUICK_ANSWERS[0].a));
  assert.ok(KNOWLEDGE.length > 1000);
});
