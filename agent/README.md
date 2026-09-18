# The studio agents

Two long-lived Node processes that run beside the studio. Neither belongs on
Vercel — that runs functions, and these need to hold a connection open and to
shell out to ffmpeg.

| | What it does | Needs |
|---|---|---|
| `captions.ts` | Joins each room as an invisible participant, transcribes whoever is on stage, publishes the text back on the `captions` topic, and posts the finished lines to the API so the transcript survives the show | LiveKit + Deepgram |
| `clipper.ts` | Takes each finished recording and cuts it into posts — landscape, vertical, square, plus an `.srt` | ffmpeg + Anthropic |

They are deliberately separate: captions must never stop because clipping fell
over, and clipping is bursty work that wants its own machine.

## Why the transcript is kept

The captioner is already running speech-to-text on everyone on stage, because
the audience wants captions. Keeping those lines means **every segment has a
timed transcript the instant it ends**. The clipper doesn't pay to listen to
the same audio again, and it doesn't wait for an upload and a queue — it starts
when the recorder stops.

That is also the whole reason clips can be ready before the podcaster is home.

## What the clipper does with one recording

1. Claims the next queued job. The API hands back a signed download link and
   the transcript it already has, so **the worker holds one token and no
   database, storage or cloud credentials of its own**.
2. Checks the transcript actually covers the segment. If captions dropped out,
   it transcribes locally with `whisper-cli` instead.
3. Asks Claude for the moments worth posting — with the rule that a moment has
   to stand up cold, start on the first word of a thought, and run 20–75
   seconds. Without `ANTHROPIC_API_KEY` it falls back to the densest stretches
   of speech, which is worse, and the reason it gives says so.
4. Renders each moment at 1920×1080, 1080×1920 and 1080×1080.

   The picture is **letterboxed onto a blurred copy of itself, not cropped.** A
   centre crop is how a vertical clip loses the guest: two people side by side
   and one of them is simply gone. Vertical and square get a title band above
   the picture, drawn as vector outlines rather than typeset — a server has no
   fonts installed, and anything that asks for one renders as empty boxes.
5. Uploads the files, posts the results back, and the clips appear in that
   podcaster's dashboard.

A job that dies mid-flight is reclaimed after an hour, so a worker that is
killed cannot strand a recording in "running" forever. A re-run replaces the
clips rather than adding to them.

## Setup

```bash
export LIVEKIT_URL=wss://your-project.livekit.cloud
export LIVEKIT_API_KEY=…
export LIVEKIT_API_SECRET=…
export DEEPGRAM_API_KEY=…            # captions
export ANTHROPIC_API_KEY=…           # clipper — without it, picks get worse
export AGENT_TOKEN=…                 # shared with the API; see below
export API_BASE=https://www.militaryvoice.ai
```

`AGENT_TOKEN` is the only thing the agents use to authenticate, and it must
match `AGENT_TOKEN` on the Vercel project. It is never in a browser. Set it
from a terminal so it is never pasted into a chat or a file:

```bash
read -rs K && printf '%s' "$K" | vercel env add AGENT_TOKEN production && unset K
```

Until it is set, `/api/agent/*` answers 503 and clip jobs are never queued —
the studio works exactly as before, just without clips.

## Running

```bash
npx tsx agent/captions.ts dev     # joins rooms on demand
npx tsx agent/captions.ts start   # LiveKit Cloud Agents dispatch
npx tsx agent/clipper.ts          # polls for clip jobs
```

Optional for the clipper: `CLIP_COUNT` (default 4), `CLIP_POLL_MS` (default
30000), `WHISPER_MODEL` (a path to a `ggml-*.bin`, only used when the live
transcript is thin).

## Testing the clipper without a show

`scripts/clipper-test.ts` runs everything except the two fetches — it
transcribes a real file, asks the model, renders all three shapes and writes
the subtitles, checking the dimensions, durations and audio of each:

```bash
npx tsx scripts/clipper-test.ts path/to/segment.mp4 /tmp/clipout
```

It needs `whisper-cli` and a model file (`WHISPER_MODEL=…/ggml-base.en.bin`).
With no `ANTHROPIC_API_KEY` it still passes, but it exercises the density
fallback rather than the model — the log says which.

## Deploying

1. **LiveKit Cloud Agents** — the natural home for `captions.ts`; upload with
   `lk agent create` and set the env vars in the LiveKit dashboard.
2. **Any small VM, Fly or Railway** — both agents are plain `tsx` processes.
   The clipper wants ffmpeg installed and a few GB of scratch disk; it cleans
   up after every job.

One clipper is enough for a 24-hour event: a 30-minute segment takes a couple
of minutes to cut, and they arrive one every half hour. Run a second only if
you are recording more than one studio at once.
