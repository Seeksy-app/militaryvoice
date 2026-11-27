// Send us a recording (27 Nov 2026): the pasted link is checked, and the link and passcode go in sealed.
// Run: SESSION_SECRET=test npx tsx --test script/recording-in.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET ||= "test-secret-for-recording-in";
const { checkLink, nextInRhythm } = await import("../server/recordingIn.js");
const { seal, open } = await import("../server/shareLogin.js");

test("share links from the usual places pass, with their site", () => {
  assert.deepEqual(checkLink("https://us02web.zoom.us/rec/share/abc123?pwd=x"), { link: "https://us02web.zoom.us/rec/share/abc123?pwd=x", site: "us02web.zoom.us" });
  assert.equal(checkLink("https://www.dropbox.com/scl/fi/xyz/ep.mp4?dl=0")?.site, "dropbox.com");
  assert.equal(checkLink("drive.google.com/file/d/1abc/view")?.link, "https://drive.google.com/file/d/1abc/view");
  assert.equal(checkLink("  https://drive.google.com/x  ")?.site, "drive.google.com");
});

test("anything that isn't a web link is refused", () => {
  for (const bad of ["", "hello", "javascript:alert(1)", "ftp://x.com/a", "https://x.com/a b", "file:///etc/passwd", "https://localhost/a", "x".repeat(1001)]) assert.equal(checkLink(bad), null, bad);
});

test("the link and passcode go in sealed and come back the same", () => {
  const plain = JSON.stringify({ link: "https://zoom.us/rec/share/abc", passcode: "Ab1!x" });
  const box = seal(plain);
  assert.ok(!box.includes("zoom") && !box.includes("Ab1"));
  assert.equal(open(box), plain);
  assert.notEqual(seal(plain), box, "a fresh iv every time");
});

test("the publish date starts on the show's next release day when it keeps a rhythm", () => {
  // Weekly on Tuesdays: the next Tuesday after today.
  assert.equal(nextInRhythm(["2026-11-03", "2026-11-10", "2026-11-17", "2026-11-24"], "2026-11-27"), "2026-12-01");
  // Every two weeks, a day early once: still the rhythm.
  assert.equal(nextInRhythm(["2026-10-06", "2026-10-20", "2026-11-02", "2026-11-17"], "2026-11-27"), "2026-12-01");
  // One already scheduled ahead: the one after it.
  assert.equal(nextInRhythm(["2026-11-10", "2026-11-17", "2026-11-24", "2026-12-01"], "2026-11-27"), "2026-12-08");
  // Two missed: still the next one on the rhythm, after today.
  assert.equal(nextInRhythm(["2026-10-20", "2026-10-27", "2026-11-03", "2026-11-10"], "2026-11-27"), "2026-12-01");
});

test("no steady rhythm, no date", () => {
  assert.equal(nextInRhythm([], "2026-11-27"), "");
  assert.equal(nextInRhythm(["2026-11-10", "2026-11-17", "2026-11-24"], "2026-11-27"), "", "three isn't enough");
  assert.equal(nextInRhythm(["2026-09-01", "2026-09-08", "2026-10-20", "2026-11-24"], "2026-11-27"), "", "uneven");
  assert.equal(nextInRhythm(["2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"], "2026-11-27"), "", "daily is out of range");
  assert.equal(nextInRhythm(["2026-06-02", "2026-06-09", "2026-06-16", "2026-06-23"], "2026-11-27"), "", "gone quiet since June");
  assert.equal(nextInRhythm(["2026-11-24", "2026-11-24", "2026-11-24", "2026-11-24"], "2026-11-27"), "", "same day");
});
