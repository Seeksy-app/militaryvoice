# Glimpse visual review: discovery (phase 1)

17 Oct 2026. This document is reading only. It made no uploads and no paid calls, and it changed no code.

## Where it fits

Pōstify picks moments from the transcript, then frames the 9:16 and square crops itself. Today that framing is:

- ffmpeg finds shot changes and letterboxing;
- Claude vision is sent up to 12 still frames per clip and boxes the speaker in each one (`agent/clipper.ts` `framingFor`, ~line 1492).

Glimpse watches the whole excerpt rather than stills. That makes framing the natural fit: shot changes, where the speaker sits, what blocks the frame, on-screen text, and whether a 9:16 crop works at all.

There is no human review today. Clips go live as they finish. The pilot therefore keeps Glimpse out of the customer path entirely:

- an admin asks for a review of one recording's clips;
- the observations show next to each clip in Admin → Clips;
- nothing about the clips the podcaster gets changes until we decide to go.

## The pilot design

1. **Ask.** In Admin → Clips, a "Visual review" button on a recording (admin only, off unless switched on).
2. **Queue.** The server records the request and reserves budget for it, then queues a job.
3. **Worker.** The clip worker (Render) claims the job.
   - For each clip, it cuts the excerpt with ffmpeg and puts it in our R2 with a 6-hour signed link. This is the same pattern the Creatomate source cuts use (`clipper.ts` ~1394).
   - It sends Elorian the link: one excerpt per request, `background: true`, then polls the run.
   - Nothing is uploaded to Elorian's file storage.
4. **Back.** The observations are checked against our own schema and turned into episode-relative timestamps; anything out of range is rejected. They are stored per clip and shown under the clip's "why this moment" in Admin → Clips. The fields:
   - shots
   - subject position
   - obstructions
   - on-screen text
   - crop warnings
   - uncertainty
   - usage
5. **Off cleanly.** With no key, the switch off, the budget spent, a 401/402, or `credits_exhausted`, the job is skipped and Pōstify carries on exactly as now.

## Cost

Elorian's rates per 1M tokens are $0.60 input, $0.06 cached input and $3.00 output. Their estimator converts video to tokens like this:

- frames = fps × seconds;
- about 98 tokens per frame at the "auto" size;
- plus 256 tokens, plus the audio transcript.

| Excerpt | fps | Input tokens | Cost |
|---|---|---|---|
| 60 s | 5 (default) | ~30k | ~$0.02, plus up to ~$0.02 output |
| 60 s | 2 (enough for framing) | ~12k | under 2¢ all-in |

**The five-clip pilot is about $0.10–0.25.** The $8 balance covers roughly 200–400 excerpts.

Limits for the pilot:
- `video_fps` 2;
- `max_completion_tokens` set from `/v1/limits`;
- `reasoning_effort` medium;
- at most 6 excerpts per job and 90 seconds per excerpt;
- a $1 daily cap kept in site settings;
- no automatic retry after a timeout, since the run may have been billed;
- never buy credits automatically.

## Answered by their docs

- **Endpoints.** OpenAI-compatible at `https://api.elorian.ai/v1`, Bearer key (`elor_sk_…`), model `elorian-1-agent`.
- **Video input.** `video_url` takes an HTTPS link or `file://<id>`, one video per request. MP4, MOV and WebM; no inline video.
- **Background runs.** `background: true` returns a run; poll `GET /v1/runs/{id}` and cancel with `POST /v1/runs/{id}/cancel`.
- **Failures.** A failure can arrive as HTTP 200 with an `error` body.
- **Errors.** 429s carry `x-ratelimit-*` headers. An empty balance is 429 `credits_exhausted`. Every response has an `x-request-id`.
- **Audio.** Sound is transcribed automatically and billed as input. If transcription fails, the request still succeeds. Our transcript stays the source of truth.
- **Data location.** Elorian is hosted in the US, with Standard Contractual Clauses for transfers from the EU and UK. Media sits in `us-west-2`.

## Still open (blocks the pilot)

1. **Training opt-out.** The terms (§8.2) license Elorian to train on inputs. Paid accounts can opt out by email, but the two pages name different addresses: contact@elorian.ai (terms) and privacy@elorian.ai (privacy). We email both and get a written yes before any upload. **Sent 17 Oct from hello@ to both addresses, with questions 2 and 3; waiting for a reply.**
2. **Retention.** No period is given for media fetched from a link or uploaded. We ask them, and ask how to delete.
3. **Billing.** Are failed, timed-out or cancelled runs charged? We ask them.
4. **Structured output.** Does `elorian-1-agent` accept `response_format` with a JSON schema? If not, we ask for JSON in the prompt and validate it ourselves.
5. **Account limits: answered 17 Oct.** `GET /v1/limits`:
   - tier "free", with a hard weekly budget of $5 that resets each Monday 00:00 UTC; the credit balance is $10;
   - video up to 200 s at 1080p, 450 s at 720p and 600 s at 360p;
   - at most 376 frames, 220k context tokens and 2 GB;
   - `max_completion_tokens` 4,096. That settles the 8,000-vs-4,096 question: use 4,096;
   - 15,000 requests a minute and 40 at once, far beyond what we need.

   A 60-second excerpt at 5 fps is 300 frames, which fits. At 2 fps it is 120.
6. **Rights.** Proposed test: Riccoh's "Marine Veteran and Author Michael Nixon" (recording 229, 27:46, 4 clips; the clean copy is 230). It needs Riccoh's OK and the guest's. The pilot needs one published episode whose podcaster has agreed to their video being processed by another company. No minors, no private or sensitive interviews.

## Files that would change (phase 2, after approval)

| File | Change |
|---|---|
| `server/visualReview.ts` (new) | switch, daily cap and reservation, admin "review this recording" route, agent routes for claim and result, response validation |
| `server/routes.ts` | register it beside `registerCreatomate`; add the review job to the worker's claim chain |
| `agent/clipper.ts` | the review job: cut excerpt → signed R2 link → Elorian run → poll → post observations; skip on any error |
| `shared/schema.ts` | a `visual_review` JSON column on `clips` (added on boot by schemaSync) |
| `client/src/components/AdminClips.tsx` | the button, and the observations under each clip |
| `server/health.ts` | an Elorian row: key present, last call, today's spend |
| `scripts/glimpse-test.ts` (new) | offline checks against made-up responses: disabled, no key, no credits, bad JSON, timestamp offsets, 429, timeout, duplicate job, budget spent |

**The key** goes in Render, on the clipper service, as `ELORIAN_API_KEY`. It needs Chat and Files scopes, or Everything, and a 90-day expiry. The worker already makes long calls, so the background run and polling suit it.
