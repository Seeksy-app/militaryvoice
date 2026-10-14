// The SimpleTexting account is shared with SmartLoads: we send only from our
// number and leave the other number's replies and delivery reports alone.
// No network, no database.
//
//   npx tsx scripts/sms-number-test.ts
import { DEFAULT_ACCOUNT_PHONE, forOtherNumber, messageBody, ownAccountPhone, tenDigitPhone, webhookBody } from "../server/smsNumber.js";

let bad = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`);
}

const OURS = "2015344064";
const THEIRS = "4025551234";

// Our number
check("default is 2015344064", DEFAULT_ACCOUNT_PHONE === OURS);
check("unset env → default", ownAccountPhone({}) === OURS, ownAccountPhone({}));
check("blank env → default", ownAccountPhone({ SIMPLETEXTING_ACCOUNT_PHONE: "  " }) === OURS);
check("env +1 with spaces and dashes → ten digits", ownAccountPhone({ SIMPLETEXTING_ACCOUNT_PHONE: "+1 201-534-4064" }) === OURS);
check("env (201) 534-4064 → ten digits", ownAccountPhone({ SIMPLETEXTING_ACCOUNT_PHONE: "(201) 534-4064" }) === OURS);
check("env another number is used", ownAccountPhone({ SIMPLETEXTING_ACCOUNT_PHONE: "402-555-1234" }) === THEIRS);
check("env that isn't a number → default", ownAccountPhone({ SIMPLETEXTING_ACCOUNT_PHONE: "12345" }) === OURS);
check("11 digits starting 1 → ten", tenDigitPhone("12015344064") === OURS);
check("not a US number → empty", tenDigitPhone("+44 20 7946 0958") === "", tenDigitPhone("+44 20 7946 0958"));

// Webhook events
for (const type of ["INCOMING_MESSAGE", "DELIVERY_REPORT", "NON_DELIVERED_REPORT"]) {
  check(`${type}: other number ignored`, forOtherNumber(type, { accountPhone: THEIRS }, OURS) === true);
  check(`${type}: other number with +1 ignored`, forOtherNumber(type, { accountPhone: `+1${THEIRS}` }, OURS) === true);
  check(`${type}: our number processed`, forOtherNumber(type, { accountPhone: OURS }, OURS) === false);
  check(`${type}: our number as +1 201-534-4064 processed`, forOtherNumber(type, { accountPhone: "+1 201-534-4064" }, OURS) === false);
  check(`${type}: no accountPhone processed (as before)`, forOtherNumber(type, { contactPhone: "5555550100" }, OURS) === false);
  check(`${type}: empty accountPhone processed (as before)`, forOtherNumber(type, { accountPhone: "" }, OURS) === false);
  check(`${type}: no values processed (as before)`, forOtherNumber(type, undefined, OURS) === false);
  check(`${type}: unreadable accountPhone ignored`, forOtherNumber(type, { accountPhone: "SHORTCODE" }, OURS) === true);
}
check("UNSUBSCRIBE_REPORT: recorded (no accountPhone)", forOtherNumber("UNSUBSCRIBE_REPORT", { contactPhone: "5555550100" }, OURS) === false);
check("UNSUBSCRIBE_REPORT: recorded even naming another number (opt-outs are account-wide)", forOtherNumber("UNSUBSCRIBE_REPORT", { accountPhone: THEIRS }, OURS) === false);

// Sending
const msg = messageBody("5555550100", "MilitaryVoices.ai: hi", OURS);
check("send includes our accountPhone", msg.accountPhone === OURS, msg);
check("send body otherwise unchanged", JSON.stringify(msg) === JSON.stringify({ contactPhone: "5555550100", accountPhone: OURS, mode: "AUTO", text: "MilitaryVoices.ai: hi" }), msg);
check("send uses env number by default", messageBody("5555550100", "x").accountPhone === ownAccountPhone());

// Registering the webhook
const hook = webhookBody("https://www.militaryvoices.ai/api/webhooks/simpletexting?key=k", OURS);
check("webhook registration includes our accountPhone", hook.accountPhone === OURS, hook);
check("webhook registration keeps all four triggers", hook.triggers.join(",") === "INCOMING_MESSAGE,DELIVERY_REPORT,NON_DELIVERED_REPORT,UNSUBSCRIBE_REPORT", hook.triggers);
check("webhook registration keeps url and rate limit", hook.url.endsWith("?key=k") && hook.requestPerSecLimit === 10, hook);

console.log(bad === 0 ? "\nAll checks passed." : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
