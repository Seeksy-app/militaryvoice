// LIVE phase 2, step 2: the console rows written from an approved (frozen) run of show. Run: npx tsx --test script/live-approve.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { liveRows } from "../server/live/approve.js";

const frozen = {
  sessions: [
    { id: 1, version: 2, title: "Session 1: Opening", kind: "keynote", status: "confirmed", startsAt: "2026-12-10T15:00:00.000Z", endsAt: "2026-12-10T15:20:00.000Z", sort: 0, mvOnly: false,
      people: [{ speakerId: 1, version: 1, name: "Speaker 1", role: "speaker" }], scripts: [{ id: 7, version: 3, kind: "intro" as const }, { id: 8, version: 1, kind: "outro" as const }] },
    { id: 2, version: 1, title: "Changeover", kind: "break", status: "confirmed", startsAt: "2026-12-10T15:20:00.000Z", endsAt: "2026-12-10T15:30:30.000Z", sort: 0, mvOnly: true, people: [], scripts: [] },
    { id: 3, version: 1, title: "Session 2: Cancelled", kind: "panel", status: "cancelled", startsAt: "2026-12-10T15:30:00.000Z", endsAt: "2026-12-10T16:00:00.000Z", sort: 0, mvOnly: false, people: [], scripts: [] },
  ],
};

test("sessions, their scripts in place, cancelled left out", () => {
  const rows = liveRows(frozen, new Map([[7, { version: 3, url: "https://x/intro.mp3" }], [8, { version: 2, url: "https://x/old.mp3" }]]));
  assert.deepEqual(rows.map((r) => r.sourceKey), ["live-session-1", "live-script-7", "live-script-8", "live-session-2"]);
  const byKey = Object.fromEntries(rows.map((r) => [r.sourceKey, r]));
  assert.equal(byKey["live-session-1"].durationMinutes, 20);
  assert.equal(byKey["live-session-1"].notes, "With Speaker 1");
  assert.equal(byKey["live-session-2"].kind, "Break");
  assert.equal(byKey["live-session-2"].durationMinutes, 11); // rounds up
  // The intro sits a second before its session, with its audio; the outro's audio is a newer version than was frozen, so none.
  assert.equal(byKey["live-script-7"].startAtUtc, "2026-12-10T14:59:59.000Z");
  assert.equal(byKey["live-script-7"].mediaUrl, "https://x/intro.mp3");
  assert.equal(byKey["live-script-8"].startAtUtc, "2026-12-10T15:19:58.001Z");
  assert.equal(byKey["live-script-8"].mediaUrl, "");
  // In time order the intro comes before the session it introduces.
  const ordered = [...rows].sort((a, b) => a.startAtUtc.localeCompare(b.startAtUtc)).map((r) => r.sourceKey);
  assert.deepEqual(ordered, ["live-script-7", "live-session-1", "live-script-8", "live-session-2"]);
});
