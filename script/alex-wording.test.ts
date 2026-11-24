// Andrew's rule (20 Nov 2026, again 24 Nov after Daniel Flint's auto-reply): Alex never promises "a person",
// "a human", a call, or a time like "shortly". The wording is "someone will get back to you as soon as possible".
// Run: npx tsx --test script/alex-wording.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { composeAck, ALEX_FOLLOW_UP, ALEX_IF_NOT_ANSWERED, ALEX_NO_ANSWER } from "../server/inbox.js";
import { CHECKING, GET_BACK } from "../server/help.js";
import type { InboundEmailRow } from "../shared/schema.js";

const PROMISE = /\b(an?|real) (person|human)\b|\bpeople on (our|the) team\b|\bshortly\b|\bgive you a call\b|\bcall you\b/i;
const ok = (label: string, text: string) => assert.doesNotMatch(text, PROMISE, `${label}: "${text.match(PROMISE)?.[0]}" in ${JSON.stringify(text.slice(0, 200))}`);

const mail = { subject: "Where's my episode?", fromName: "Daniel Flint", fromEmail: "daniel@example.com" } as InboundEmailRow;

test("Alex's set lines say 'someone … as soon as possible'", () => {
  for (const [k, v] of Object.entries({ ALEX_FOLLOW_UP, ALEX_IF_NOT_ANSWERED, ALEX_NO_ANSWER, GET_BACK })) {
    ok(k, v);
    assert.match(v, /someone will get back to you as soon as possible/i, k);
  }
  ok("CHECKING", CHECKING);
});

test("the email auto-reply never promises a person, in all three shapes", () => {
  for (const [label, ack, followUp] of [["no answer", "", false], ["with an answer", "It's under Podcast.", false], ["follow-up", "It's under Podcast.", true]] as const) {
    const out = composeAck(mail, ack, "Daniel", followUp);
    ok(`${label} (text)`, out.text);
    ok(`${label} (html)`, out.html);
    assert.match(out.text, /as soon as possible/, label);
  }
});

// Visitor-facing copy where Alex or the help pages say what happens next. Comments and code names don't count.
const FILES = [
  "client/src/components/HelpChat.tsx",
  "client/src/components/LoriGuide.tsx",
  "client/src/pages/HelpIndex.tsx",
  "client/src/pages/Faq.tsx",
  "server/helpArticles.ts",
  "server/help.ts",
  "server/inbox.ts",
];
const SAID = /\b(get|gets|getting) (you )?to a (person|human)\b|\ba (person|human) (on our team )?will (get back|reach out|read|confirm)|\bget a (person|human) on it\b|\b(back to|out to) you shortly\b|\bpassed (this|it) to a person\b/i;

test("no visitor-facing copy promises a person or 'shortly'", () => {
  for (const f of FILES) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      assert.doesNotMatch(line, SAID, `${f}:${i + 1}: ${line.trim().slice(0, 160)}`);
    });
  }
});
