// LIVE phase 2 (27 Nov 2026): the pure rules in the Programme contract.
// Run: npx tsx --test script/live-programme.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLiveTestAddress, sessionMinutes } from "../shared/live.js";

test("session length rounds up, so the console's zero never comes early", () => {
  assert.equal(sessionMinutes("2026-12-01T15:00:00.000Z", "2026-12-01T15:30:00.000Z"), 30);
  assert.equal(sessionMinutes("2026-12-01T15:00:00.000Z", "2026-12-01T15:30:01.000Z"), 31);
  assert.equal(sessionMinutes("2026-12-01T15:00:00.000Z", "2026-12-01T14:00:00.000Z"), 0);
});

test("only the hello+live*@ test addresses count as test addresses", () => {
  for (const ok of ["hello+liveclient@militaryvoices.ai", "hello+livereview@militaryvoices.ai", "HELLO+LIVECREW@militaryvoice.ai", " hello+live@militaryvoices.ai "]) assert.ok(isLiveTestAddress(ok), ok);
  for (const no of ["hello@militaryvoices.ai", "hello+studiotest@militaryvoices.ai", "someone+liveclient@militaryvoices.ai", "hello+liveclient@example.com", "hello+liveclient@militaryvoices.ai.evil.com"]) assert.ok(!isLiveTestAddress(no), no);
});
