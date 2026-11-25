// "Focus on whoever's talking" for a whole episode (24 Nov 2026): the turns, the stretches, and filters ffmpeg accepts.
// Run: npx tsx --test script/episode-focus.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { speakerRuns, focusWindows, focusFilters } from "../agent/clipper.js";

const L = (speaker: string, startSec: number, endSec: number, text = "a longer line of what was said here") => ({ speaker, startSec, endSec, text });

test("a long turn survives a short mm-hmm from the other person", () => {
  const runs = speakerRuns([L("A", 0, 10), L("B", 10.5, 11.2, "mm-hmm"), L("A", 11.5, 30), L("B", 31, 40)]);
  assert.deepEqual(runs.map((r) => [r.speaker, r.from, r.to]), [["A", 0, 30], ["B", 31, 40]]);
});

test("only turns of 20 seconds or more are focused, on that speaker's side", () => {
  const runs = speakerRuns([L("A", 0, 25), L("B", 26, 35), L("A", 36, 40), L("B", 41, 70)]);
  const wins = focusWindows(runs, { A: "left", B: "right" });
  assert.deepEqual(wins.map((w) => w.side), ["left", "right"]);
  assert.ok(Math.abs(wins[0].from - 3) < 1e-9 && Math.abs(wins[1].to - 70.2) < 1e-9);
});

test("a long turn goes back to both for 6 seconds every minute", () => {
  const wins = focusWindows([{ speaker: "A", from: 0, to: 200 }], { A: "left" });
  assert.deepEqual(wins.map((w) => [w.from, w.to]), [[3, 57], [63, 117], [123, 200.2]]);
});

const ff = (graph: string[], dur = 6) =>
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=30:duration=${dur}`, "-filter_complex", graph.join(";"), "-map", "[out]", "-f", "null", "-"], { stdio: "pipe" });

test("two tiles: the filters run, switching to each tile and back", () => {
  const tiles = { left: { x: 40, y: 300, w: 900, h: 506 }, right: { x: 980, y: 300, w: 900, h: 506 } };
  const g = focusFilters({ kind: "two", fw: 1920, fh: 1080, tiles, wins: [{ from: 1, to: 7, side: "left" }, { from: 8, to: 14, side: "right" }] }, (t) => t, "0:v", "out");
  assert.ok(g.some((x) => x.includes("between(t,1.00,7.00)")) && g.some((x) => x.includes("between(t,8.00,14.00)")));
  ff(g, 15);
  // A stretch the cuts shrink under 5 s is dropped, not flashed.
  const short = focusFilters({ kind: "two", fw: 1920, fh: 1080, tiles, wins: [{ from: 1, to: 3, side: "left" }] }, (t) => t, "0:v", "out");
  assert.ok(short.some((x) => x.includes("enable='0'")));
});

test("one person: a gentle reframe the filters accept", () => {
  const plan = { kind: "one" as const, fw: 1920, fh: 1080, pts: [{ at: 0.5, x: 900, y: 400 }, { at: 3, x: 1100, y: 420 }, { at: 5.5, x: 1000, y: 380 }] };
  const g = focusFilters(plan, (t) => t, "0:v", "out");
  assert.equal(g.length, 1);
  ff(g, 6);
});
