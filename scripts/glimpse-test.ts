// Offline checks for the Glimpse pilot: made-up answers, no key, no network.
//   npx tsx scripts/glimpse-test.ts
import { parseGlimpse, glimpseCostMicro, glimpseStops, glimpseFits, glimpsePrompt, GLIMPSE_RESERVE_MICRO } from "../shared/glimpse.js";
import { reviewOne, type Job } from "../agent/glimpse.js";

let failed = 0;
const check = (name: string, ok: boolean, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !extra ? "" : ` — ${extra}`}`); if (!ok) failed++; };

const good = JSON.stringify({
  shots: [{ at: 0, note: "two-shot" }, { at: 12.5, note: "close on guest" }],
  subject: [{ from: 0, to: 12, note: "host left, guest right" }],
  obstructions: [{ from: 3, to: 5, note: "mic covers mouth" }],
  onScreenText: [{ at: 2, text: "MILITARYVOICES" }],
  crop916: { verdict: "partly", note: "two-shot is too wide", problems: [{ from: 0, to: 12, note: "both can't fit" }] },
  uncertainty: "cut at 12.5 may be off by a second",
});

// The answer, moved onto the episode's clock.
let p = parseGlimpse("```json\n" + good + "\n```", 100, 40);
check("parses a fenced answer", p.ok);
if (p.ok) {
  check("excerpt time 12.5 becomes episode 112.5", p.observations.shots[1].at === 112.5, String(p.observations.shots[1].at));
  check("spans move too", p.observations.subject[0].from === 100 && p.observations.subject[0].to === 112);
  check("crop verdict kept", p.observations.crop916.verdict === "partly");
  check("no warnings on a clean answer", p.warnings.length === 0, p.warnings.join(" | "));
}
// Out of range and backwards: dropped and said, never clamped into place.
p = parseGlimpse(JSON.stringify({ shots: [{ at: 99, note: "x" }, { at: 3, note: "ok" }], subject: [{ from: 10, to: 4, note: "backwards" }], obstructions: [], onScreenText: [], crop916: { verdict: "maybe", note: "", problems: [] }, uncertainty: "" }), 0, 30);
check("drops a time past the end", p.ok && p.observations.shots.length === 1 && p.observations.shots[0].at === 3);
check("drops a backwards span", p.ok && p.observations.subject.length === 0);
check("odd verdict becomes partly, with a warning", p.ok && p.observations.crop916.verdict === "partly" && p.warnings.some((w) => /verdict/.test(w)));
check("says what it dropped", p.ok && p.warnings.filter((w) => /Dropped/.test(w)).length === 2);
// Malformed.
check("prose with no JSON fails", !parseGlimpse("The speaker is centred.", 0, 30).ok);
check("broken JSON fails", !parseGlimpse("{shots: [", 0, 30).ok);
check("a list instead of an object fails", !parseGlimpse("[1,2]", 0, 30).ok);
p = parseGlimpse("{}", 0, 30);
check("an empty object parses, with warnings for each missing part", p.ok && p.warnings.length >= 5);

// Money.
check("cost: 30k in + 2k out = 2.4¢", glimpseCostMicro({ prompt_tokens: 30_000, completion_tokens: 2_000 }) === 24_000);
check("cost: cached tokens at a tenth", glimpseCostMicro({ prompt_tokens: 30_000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 20_000 } }) === 7_200);
check("cost: no usage is 0", glimpseCostMicro(null) === 0);
check("budget: room for one more", glimpseFits({ reserved: 0, actual: 600_000 }, 1_000_000) === true);
check("budget: spent", glimpseFits({ reserved: 0, actual: 700_000 }, 1_000_000) === false);
check("budget: out-but-unanswered counts", glimpseFits({ reserved: 2 * GLIMPSE_RESERVE_MICRO, actual: 0 }, 1_000_000) === false);

// When to stop everything.
check("401 stops", glimpseStops(401, ""));
check("no credit stops", glimpseStops(429, "credits_exhausted"));
check("weekly budget stops", glimpseStops(429, "budget_exceeded"));
check("a rate limit doesn't stop", !glimpseStops(429, "requests"));
check("a 500 doesn't stop", !glimpseStops(500, "server_error"));

// The ask keeps people out of it.
const ask = glimpsePrompt(42, "HOST: welcome");
check("prompt forbids reading people", /emotions, mental state, intent, identity, or credibility/.test(ask) && /JSON only/.test(ask));

// The worker, against fake ffmpeg/storage/Elorian.
const job: Job = { clipId: 7, recordingId: 229, sourceUrl: "https://example.test/ep.mp4", startSec: 100, durationSec: 40, model: "elorian-1-agent", maxTokens: 4096, prompt: "p" };
async function worker(fetchImpl: () => Promise<Response>) {
  const posts: any[] = [];
  const api = async (_m: string, path: string, body?: any): Promise<any> => {
    if (path.endsWith("/upload-url")) return { uploadUrl: "https://up.test", readUrl: "https://read.test/clip.mp4" };
    posts.push({ path, body });
    return { ok: true };
  };
  const ran: string[] = [];
  const run = async (cmd: string) => { ran.push(cmd); return ""; };
  const real = globalThis.fetch;
  process.env.ELORIAN_API_KEY = "elor_sk_test";
  (globalThis as any).fetch = fetchImpl;
  try { await reviewOne(api as any, run, job); } finally { globalThis.fetch = real; }
  return { posts, ran };
}
let w = await worker(async () => new Response("\n\n" + JSON.stringify({ model: "elorian-1-agent", choices: [{ message: { content: good } }], usage: { prompt_tokens: 30000, completion_tokens: 900 } }), { status: 200, headers: { "x-request-id": "req_1" } }));
check("worker: cuts, uploads, then reports the answer", w.ran.join(",") === "ffmpeg,curl" && w.posts[0]?.body.ok === true && w.posts[0].body.requestId === "req_1" && w.posts[0].body.text === good);
w = await worker(async () => new Response("\n" + JSON.stringify({ error: { code: "timed_out", message: "run timed out" } }), { status: 200 }));
check("worker: an error inside a 200 is a failure", w.posts[0]?.body.ok === false && w.posts[0].body.code === "timed_out");
w = await worker(async () => new Response(JSON.stringify({ error: { code: "credits_exhausted", message: "no credit" } }), { status: 429 }));
check("worker: no credit is reported with its code", w.posts[0]?.body.ok === false && w.posts[0].body.status === 429 && glimpseStops(429, w.posts[0].body.code));
let calls = 0;
w = await worker(async () => { calls++; throw new Error("The operation was aborted due to timeout"); });
check("worker: a timeout is 'unknown', reported once, never retried", calls === 1 && w.posts.length === 1 && w.posts[0].body.ambiguous === true);
w = await worker(async () => new Response("<html>bad gateway</html>", { status: 502 }));
check("worker: a non-JSON answer is a failure", w.posts[0]?.body.ok === false && w.posts[0].body.status === 502);

console.log(failed ? `\n${failed} failed` : "\nAll passed");
process.exit(failed ? 1 : 0);
