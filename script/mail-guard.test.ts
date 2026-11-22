// Andrew's rule (22 Nov 2026): never his name, his address, or a copy to him on a customer's email.
// Run: npx tsx --test script/mail-guard.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mailGuard } from "../server/mailGuard.js";

const env = {};
const base = { to: "frank@example.com", subject: "Your episode is live", text: "Hi Frank, it's up.", html: "<p>Hi Frank, it's up.</p>", from: "MilitaryVoices.ai <hello@militaryvoices.ai>" };

test("a normal customer email goes", () => assert.equal(mailGuard(base, env), null));

test("from or reply-to Andrew is held", () => {
  assert.match(mailGuard({ ...base, from: "Andrew <andrew@podlogix.co>" }, env) ?? "", /from Andrew's address/);
  assert.match(mailGuard({ ...base, replyTo: "andrew@podlogix.co" }, env) ?? "", /from Andrew's address/);
  assert.match(mailGuard({ ...base, from: "andrew@militaryvoices.ai" }, env) ?? "", /from Andrew's address/);
});

test("copying Andrew is held", () => {
  assert.match(mailGuard({ ...base, bcc: ["andrew@podlogix.co"] }, env) ?? "", /copies Andrew/);
  assert.match(mailGuard({ ...base, cc: ["appletonab@gmail.com"] }, env) ?? "", /copies Andrew/);
  assert.match(mailGuard({ ...base, bcc: ["andrew@smartloads.io"] }, env) ?? "", /copies Andrew/);
});

test("naming Andrew is held, in any part, any case", () => {
  assert.equal(mailGuard({ ...base, text: "Andrew will call you." }, env), "This email names Andrew. Take his name out before sending.");
  assert.ok(mailGuard({ ...base, subject: "A note from ANDREW" }, env));
  assert.ok(mailGuard({ ...base, html: "<p>Thanks, Appleton</p>" }, env));
  // Not inside another word.
  assert.equal(mailGuard({ ...base, text: "St Andrews golf" }, env), null);
});

test("a customer called Andrew can be greeted, but never Appleton", () => {
  assert.equal(mailGuard({ ...base, to: "andy@example.com", text: "Hi Andrew, it's up.", recipientName: "Andrew Smith" }, env), null);
  assert.ok(mailGuard({ ...base, to: "andy@example.com", text: "Hi Andrew, Appleton here.", recipientName: "Andrew Smith" }, env));
});

test("mail to Andrew or our own mailboxes is untouched", () => {
  assert.equal(mailGuard({ ...base, to: "andrew@podlogix.co", text: "Andrew, Frank replied." }, env), null);
  assert.equal(mailGuard({ ...base, to: "hello@militaryvoices.ai", text: "For Andrew" }, env), null);
  assert.equal(mailGuard({ ...base, to: "ops@example.com", text: "Andrew" }, { SIGNUP_NOTIFY_EMAIL: "ops@example.com" }), null);
});

test("a creator's own campaign to their audience is theirs", () => {
  assert.equal(mailGuard({ ...base, kind: "creator-campaign:7", text: "Andrew joins us this week" }, env), null);
});
