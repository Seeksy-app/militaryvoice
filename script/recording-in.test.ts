// Send us a recording (27 Nov 2026): the pasted link is checked, and the link and passcode go in sealed.
// Run: SESSION_SECRET=test npx tsx --test script/recording-in.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET ||= "test-secret-for-recording-in";
const { checkLink } = await import("../server/recordingIn.js");
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
