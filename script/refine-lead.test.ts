// Clean pass (27 Nov 2026, rec 474: "The first second Riccoh is clearing his throat, and then says 'Welcome to'"):
// the quiet and noise before the first word and after the last go, and throat clears between words go; no word is cut.
// Run: npx tsx --test script/refine-lead.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { cutList, snapToAudio, type Word } from "../agent/refine.js";

/** A 10 ms envelope: quiet everywhere, loud in the given [start, end) seconds. */
const env = (sec: number, loud: [number, number][]) => Array.from({ length: Math.round(sec * 100) }, (_, k) => (loud.some(([a, b]) => k / 100 >= a && k / 100 < b) ? 3000 : 40));
const word = (text: string, start: number, end: number, type = "word"): Word => ({ text, start, end, type });

test("a cue word and a throat clear before the open are cut, up to just before the first real word", () => {
  // "Okay." 0.2–0.7, throat clear 0.9–3.8, "Welcome" sounds from 4.05 (Scribe says 4.18: it runs late).
  const e = env(12, [[0.2, 0.7], [0.9, 3.8], [4.05, 4.5], [4.55, 4.7], [4.8, 9]]);
  const words = [word("Okay.", 0.2, 0.8), word("[clears throat]", 0.8, 4.04, "audio_event"), word("Welcome", 4.18, 4.48), word("to", 4.54, 4.62), word("show.", 4.8, 9)];
  const cuts = snapToAudio(cutList(words), e);
  const lead = cuts.find((c) => c.why === "lead");
  assert.ok(lead, "a lead cut");
  assert.equal(lead!.start, 0);
  assert.ok(lead!.end >= 3.85 && lead!.end <= 4.05, `ends in the quiet before "Welcome" (${lead!.end})`);
  const tail = cuts.find((c) => c.why === "tail");
  assert.ok(tail && tail.start >= 9 && tail.start <= 9.5, `tail keeps a moment after the last word (${tail?.start})`);
});

test("an open that starts on a word keeps it", () => {
  const e = env(6, [[0.05, 2], [2.1, 5.9]]);
  const cuts = snapToAudio(cutList([word("Welcome", 0.15, 0.5), word("back.", 2.2, 5.9)]), e);
  assert.ok(!cuts.some((c) => c.why === "lead"));
});

test("a throat clear between words is cut, the words either side are not", () => {
  const e = env(12, [[0.05, 3], [3.6, 4.4], [5.0, 11.9]]);
  const words = [word("first", 0.1, 3), word("[clears throat]", 3.5, 4.5, "audio_event"), word("second", 5.1, 11.9)];
  const noise = snapToAudio(cutList(words), e).find((c) => c.why === "noise");
  assert.ok(noise, "a noise cut");
  assert.ok(noise!.start >= 3.0 && noise!.end <= 5.0, `inside the gap (${noise!.start}–${noise!.end})`);
  assert.ok(noise!.start <= 3.6 && noise!.end >= 4.4, "covers the throat clear");
});

test("laughter stays", () => {
  const e = env(12, [[0.05, 3], [3.6, 4.4], [5.0, 11.9]]);
  const words = [word("first", 0.1, 3), word("[laughs]", 3.5, 4.5, "audio_event"), word("second", 5.1, 11.9)];
  assert.ok(!snapToAudio(cutList(words), e).some((c) => c.why === "noise"));
});
