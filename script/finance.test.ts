// Admin → Finances (27 Nov 2026): card numbers masked, payments sorted, hand-kept lines matched once.
// Run: npx tsx --test script/finance.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { maskNumbers, classifyCharge, matchHand, periodMonths, type FinRow } from "../shared/finance.js";

test("a card number in a note or name is masked to its last four", () => {
  assert.equal(maskNumbers("4111 1111 1111 0222"), "•••• 0222");
  assert.equal(maskNumbers("paid with 4111-1111-1111-0222 today"), "paid with •••• 0222 today");
  assert.equal(maskNumbers("411111111111"), "•••• 1111");
  // Addresses, dates, packs and short numbers are left alone.
  for (const s of ["4440 S Rural Rd Bldg. F Tempe AZ 85282", "Invoice 2026-11-13", "pack-120", "San Diego trip", "12345678901"]) assert.equal(maskNumbers(s), s);
});

const charge = { id: "ch_1", who: "", email: "", description: "", invoice: false, sessionKind: "", sessionMode: "", sponsorLink: false };
test("Riccoh is an owner contribution, whatever he paid for", () => {
  assert.equal(classifyCharge({ ...charge, email: "riccoh.player@drphil.tv", sessionKind: "postify_tokens" }), "owner");
  assert.equal(classifyCharge({ ...charge, who: "OHIOWA Management Group", invoice: true }), "owner");
});
test("plans, credits and sponsors by rule; the rest waits to be sorted", () => {
  assert.equal(classifyCharge({ ...charge, description: "Subscription creation" }), "plans");
  assert.equal(classifyCharge({ ...charge, sessionKind: "postify_tokens" }), "credits");
  assert.equal(classifyCharge({ ...charge, sponsorLink: true }), "sponsorship");
  assert.equal(classifyCharge(charge), "unsorted");
  assert.equal(classifyCharge({ ...charge, sorted: "ignore" }), "ignore");
});

const row = (over: Partial<FinRow>): FinRow => ({ source: "stripe", month: "2026-10", date: "2026-10-05", kind: "unsorted", cents: 25000, refundCents: 0, who: "", note: "", ...over });
test("a hand-kept line matches a payment once: five days, or 30 with a shared name", () => {
  const rows = [row({ who: "Jeffrey Tarver" }), row({ who: "Someone Else", date: "2026-11-08" })];
  assert.ok(matchHand({ source: "Tarver Realty Group", date: "2026-09-23", note: "", amount: 250, kind: "sponsorship" }, rows));
  assert.equal(matchHand({ source: "Tarver Realty Group", date: "2026-09-23", note: "", amount: 250, kind: "sponsorship" }, rows), undefined);
  assert.equal(matchHand({ source: "Riccoh Player", date: "2026-10-12", note: "", amount: 250, kind: "owner" }, rows), undefined);
});

test("periods: a month, its quarter, the year to date", () => {
  assert.deepEqual(periodMonths("month", "2026-11"), ["2026-11"]);
  assert.deepEqual(periodMonths("quarter", "2026-11"), ["2026-10", "2026-11", "2026-12"]);
  assert.deepEqual(periodMonths("ytd", "2026-03"), ["2026-01", "2026-02", "2026-03"]);
});
