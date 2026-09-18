// The sanitiser is the only thing standing between a bad provider feed and a
// number printed on a sponsor page, so it gets tested on the real shapes we
// have actually seen come back — including the X account that reported 17,891
// shares against 744 impressions.
//
//   npx tsx scripts/audience-test.ts
import { sanitizeAccount } from "../server/audience.js";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

// --- what a healthy account looks like
const ig = sanitizeAccount({ followers: 18552, reach: 5141, impressions: 14860, likes: 300, comments: 40, shares: 22 });
check("healthy Instagram is kept", ig.figures?.followers === 18552);
check("engagement is likes + comments + shares", ig.figures?.engagements === 362);

// --- the case that started all this
const x = sanitizeAccount({ followers: 827, impressions: 744, shares: 17891, likes: 10 });
check("followers survive a bad engagement feed", x.figures?.followers === 827);
check("17,891 shares on 744 impressions is dropped", x.figures?.engagements === 0);

// --- reach cannot exceed impressions
const impossible = sanitizeAccount({ followers: 500, reach: 9000, impressions: 100 });
check("reach above impressions voids both", impossible.figures?.reach === 0 && impossible.figures?.impressions === 0);
check("...but the follower count still stands", impossible.figures?.followers === 500);

// --- a small overshoot is measurement noise, not a broken feed
const noise = sanitizeAccount({ followers: 100, reach: 1020, impressions: 1000 });
check("a 2% overshoot is tolerated", noise.figures?.reach === 1020);

// --- negatives seen in the wild (a -2 save count)
const negative = sanitizeAccount({ followers: 300, impressions: 1000, likes: 50, comments: -2, shares: 5 });
check("negative counters contribute zero, not a subtraction", negative.figures?.engagements === 55);

// --- refusals must be told apart from real zeros
check("an error block is refused", sanitizeAccount({ success: false, error: "page_id is required" }).figures === null);
check("...and says why", /page_id/.test(sanitizeAccount({ success: false, error: "page_id is required" }).reason));
check("a 403 is refused", sanitizeAccount({ error: "403 requires ADMINISTRATOR role" }).figures === null);
check("an all-zero account is refused", sanitizeAccount({ followers: 0, impressions: 0 }).figures === null);
check("a missing block is refused", sanitizeAccount(undefined).figures === null);

// --- absurd values
check("a 90-million follower count is refused", sanitizeAccount({ followers: 90_000_000 }).figures === null);

// --- the payload is nested differently per platform; the reader must dig
const nested = sanitizeAccount({ success: true, data: { profile: { subscribers: "9,850" }, stats: { views: 11116 } } });
check("reads a nested, comma-formatted subscriber count", nested.figures?.followers === 9850);
check("reads views as impressions from a sibling branch", nested.figures?.impressions === 11116);

console.log(bad === 0 ? "\nAll checks passed." : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
