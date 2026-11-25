// "Mark a clip" → a labelled clip in Pōstify (25 Nov 2026): grouping presses, the window, and every mark getting its clip.
// Run: npx tsx --test script/mark-clips.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { markGroups, markWindow, withMarks } from "../agent/clipper.js";

// A sentence every 6 seconds for ten minutes.
const lines = Array.from({ length: 100 }, (_, i) => ({ speaker: i % 2 ? "B" : "A", startSec: i * 6, endSec: i * 6 + 5.5, text: `sentence number ${i} with several words in it` }));
const job = { recordingId: 1, title: "t", durationSec: 600, downloadUrl: "", show: "Show", host: "", transcript: [] } as never;

test("presses within 30 seconds are one moment", () => {
  assert.deepEqual(markGroups([100, 110, 129, 131, 300]), [100, 131, 300]);
});

test("the window runs about 20 s before to 40 s after, on sentence edges", () => {
  const w = markWindow(200, lines, 600);
  assert.equal(w.startSec, 180); // the sentence under way at 180 starts at 180
  assert.equal(w.endSec, 240); // the last sentence begun before 240 ends at 239.5
  assert.ok(lines.some((l) => l.startSec === w.startSec));
});

test("near the start and the end it stays inside the recording", () => {
  const a = markWindow(5, lines, 600);
  assert.equal(a.startSec, 0);
  const b = markWindow(598, lines, 600);
  assert.ok(b.endSec <= 600 && b.endSec - b.startSec >= 20);
});

test("a picked moment holding the press becomes the marked clip; a mark with none gets one cut around it; marked come first", async () => {
  const picked = [
    { title: "Picked near the mark", caption: "", reason: "", startSec: 90, endSec: 140 },
    { title: "Another good one", caption: "", reason: "", startSec: 400, endSec: 450 },
  ];
  const out = await withMarks(null, job, lines, picked, [120, 300], 4);
  assert.equal(out[0].markSec, 120);
  assert.equal(out[0].title, "Picked near the mark");
  assert.equal(out[1].markSec, 300);
  assert.ok(out[1].startSec <= 300 && out[1].endSec >= 300);
  assert.equal(out[2].title, "Another good one");
  assert.equal(out[2].markSec, undefined);
});

test("a picked moment overlapping a cut-around clip gives way to it", async () => {
  const picked = [{ title: "Overlaps the marked one", caption: "", reason: "", startSec: 355, endSec: 400 }];
  const out = await withMarks(null, job, lines, picked, [330], 4);
  assert.equal(out.length, 1);
  assert.equal(out[0].markSec, 330);
});
