MilitaryVoice.ai · handover
  
# The Podcast Marathon

  Where everything stands on 20 September, fifteen days out. What runs where, what is waiting on a command, and the things that cost us hours so they need not cost them again.

## The event

  **32 / 32**slots booked — the course is full
  **26.2**miles, plus start, flag and finish
  **6**pre-recorded segments
  **Mon 5 Oct**7:00 AM – 10:45 PM ET

### The closing stretch

  - 9:00 PM · **4Years A Slave** — Cody Sewell · 26.2

  - 9:30 PM · **The Flag Carry** — Theresa Carpenter · flag

  - 10:00 PM · **Devil Dawg Double Dare** — Riccoh · pre-recorded · —

  - 10:30 PM · **Closing Ceremonies & Awards** — Riccoh · finish · ends 10:45

  **Miles stop at 26 by design**
  The twenty-seventh show does not become Mile 27 — it becomes `26.1`, then `26.2`. A marathon does not get longer because more people entered. The Flag Carry is not a mile, which is what keeps the arithmetic honest; rename that slot and a phantom Mile 26.3 appears on the live agenda.

## What is running

  - Thing · Where · 

  - **The site** · Vercel, deploys on push to `main` · live

  - **Clip worker** · VPS `187.77.217.123` · `clipper.service` · live

  - **Alex** — green room co-host · same VPS · `alex.service` · live

  - **Inbound email** · Resend → `/api/webhooks/resend-inbound` → forwarded to you · live

```bash
ssh root@187.77.217.123
systemctl status alex.service
journalctl -u alex.service -f        # watch her think
```

## Alex

An AI co-host who sits in the green room, answers to her name, and knows the whole running order. She is **Alex** because speech-to-text kept hearing the previous name as "Mary Ann" and she ignored people talking straight to her.

  - **Face** · LiveAvatar "Marianne in Red Suit", LITE mode, 1 credit/minute

  - **Voice** · ElevenLabs "Madison" — `NUjosfEayZAdRcDmcHM8`

  - **Brain** · Claude, holding all 31 segments plus twelve turns of memory

  - **Ears** · a second LiveKit connection; ElevenLabs Scribe transcribes

### How she behaves

  - Answers only when someone says **"Alex"**, then stays open 25 seconds so follow-ups need no preamble

  - Replies privately — only the person who asked hears her

  - Renews her own session before the five-minute cap, so she never vanishes mid-sentence

  - Stands down a minute after the room empties, and returns within fifteen seconds of someone arriving

  **She costs a credit a minute while connected**
  Roughly $0.095. The stand-down is what stops her billing 1,440 a night to an empty room — if you change her lifecycle, keep it. About 160 credits left this month on Starter.

## Waiting on a command

All dry-run clean. Each refuses to run if the world has moved underneath it.

```bash
npx tsx scripts/email-podcasters.ts --test    # to you
npx tsx scripts/email-podcasters.ts --apply   # all 30
```

The "course is full" email. Three steps: social accounts, auto-post, green room. Sponsor paragraph removed at your request.

## Open

  - design · **Green room header** — replace the four personal status boxes with Alex, On Stage Now, On Deck, In The Hole, each counting down. Personal settings move onto your own card below, collapsible. Agreed, not built.

  - rule · **Green room should require a slot.** Also makes Alex recognise everyone, since her lookup keys on a signup.

  - naming · **Theresa's card** says "The Flag Carry", not her show. Renaming it brings Mile 26.3 back unless the marker is decoupled from the card name first.

  - media · **Two pre-recorded slots have no file.** WARRIOR Legacy (8:00 AM) is audio-only and needs a still; Brave Blocks (8:30 PM) is waiting on Greg to name an episode.

  - admin · **Recordings cannot be played** from the admin panel — only "Clip it". Needs a play button before show day.

  - quota · **Upload-Post is capped at 25 profiles**, ~11 free. Around 21 podcasters still need one, so it will run out again.

## Things that cost us hours

### Audio was four problems wearing one disguise

  - The self-preview played the raw `getUserMedia` stream — mic included

  - The "Listen" monitor returned your own voice off the network

  - A fix of mine muted the stage monitor, so a host on stage could not hear their guests

  - AirPods **Conversation Awareness** pipes your room in when you speak — not ours at all

Each presented as "the audio is broken". The device pickers in the deck exist so the next one can be diagnosed rather than guessed.

### Bluetooth output, not input

Latency lives on the playback side. Bluetooth speaker adds 150–250ms to everything you hear; Bluetooth mic is merely mediocre. Anyone monitoring themselves on AirPods will feel lag no matter what the app does. **Wired headphones for everyone on 5 October.**

### Two sources of truth on the sponsor page

The cards are hardcoded in `Sponsor.tsx`; `sponsor_packages` feeds the admin picker. They have already drifted once — the database described "the full 24 hours" for weeks while the page said "the whole marathon".

### Uploads fail from the laptop

Every large upload dies on `bad record mac` — something inspects TLS on that network. `scripts/upload-via-vps.ts` routes bytes over SSH instead and uploads from the VPS. Secrets never leave the laptop; the VPS gets a presigned URL.

### Other sharp edges

  - `duration_hours` is an integer — the day can only be an even number of half-hour slots

  - The Resend key is write-only in Vercel; one-off email goes through `/api/admin/emails/send-one` on the server

  - Local `.env` `POSTGRES_URL` points at **production** — never restart the local dev server against it

  - LiveAvatar renders only on green; the chroma key is ours, in `StageView` and `PeerTile`

  Every schedule change is a script in `scripts/` with a dry run and an `--apply` flag. Read the dry run before applying — several of them refuse to act if the schedule has moved, and that refusal has caught real mistakes.
