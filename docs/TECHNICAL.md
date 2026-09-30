# MilitaryVoices.ai: technical reference

What the system is, where each piece runs, and the rules that are easy to break. Every claim here was checked against the code on 30 Sep 2026. File paths are given; line numbers are not, because `server/routes.ts` and `shared/schema.ts` move every day.

---

## 1. Architecture overview

### Runtime pieces

| Piece | What it is | Where it runs | Entry point |
|---|---|---|---|
| Web client | React + Vite + wouter + TanStack Query SPA | Vercel static (`dist/public`) | `client/src/App.tsx` |
| API | Express app, one serverless function | Vercel (region `pdx1`) | `api/index.ts` → `server/app.ts` → `server/routes.ts` |
| Database | Postgres (Supabase) via Drizzle + postgres-js | Supabase | `server/storage.ts`, `shared/schema.ts` |
| Clip worker | Long-running Node + ffmpeg process that polls for jobs | Render background worker `militaryvoices-clipper` (Docker) | `agent/clipper.ts`, `agent/Dockerfile`, `render.yaml` |
| Captions agent | LiveKit agent that transcribes the stage and posts lines to the API | Not in `render.yaml`; where it is hosted isn't recorded in the repo (run commands in `agent/README.md`) | `agent/captions.ts` |
| Alex (green-room avatar) | LiveAvatar + ElevenLabs + Claude co-host | VPS, `alex.service` (deployed with `scripts/deploy-agents.sh`) | `scripts/alex-converse.ts` |
| Media | LiveKit rooms and egress (recording, RTMP out) | LiveKit Cloud | `server/livekit.ts` |
| File storage | Recordings/clips in Cloudflare R2 (Supabase S3 as fallback); photos and show assets in Supabase Storage | R2 / Supabase | `server/livekit.ts`, `server/recordingStorage.ts`, `server/photoStorage.ts` |

`server/index.ts` is the local dev server (`npm run dev`, `tsx server/index.ts`). Production never calls `.listen()`; Vercel wraps the exported Express app.

### Request routing (vercel.json)

- `/api/*`, `/sitemap.xml`, `/robots.txt`, `/s/*` (share links), `/go/*` (counted sponsor links), `/feed/*` (podcast RSS), `/e/*` (counted episode downloads), `/og/*` (share images) go to the API function.
- `/:handle` and `/:handle/brands` go to the API only for link-preview bots (user-agent match), so SmartLinks unfurl with real cards; people get the SPA.
- Everything else serves `index.html`.
- Redirects: `militaryvoice.ai` → `https://www.militaryvoices.ai` (301); `militarycreatoreconomy.com` → `www.militaryvoices.ai` (302), except its robots/sitemap (served by `server/mce.ts`).

### Deploy

- Site and API: `git push` to `main` on `Seeksy-app/militaryvoice`. The Vercel GitHub integration builds (`vite build`) and deploys production. The `vercel --prod` CLI call is blocked in this environment; pushing is the path.
- Clip worker: Render Blueprint (`render.yaml`), `autoDeploy: true` on `main`, but only when a push touches `agent/**`, `server/textPath.ts`, `server/assets/**` or `render.yaml` (`buildFilter`). Plan `4c-8g` (4 CPU, 8 GB). The plan in `render.yaml` must match the dashboard, or a Blueprint sync resets it.
- Schema: there are no migrations to run. See section 3.

### Auth, briefly

- Hosts (creators): emailed six-digit code → `mv_host_session` cookie, 30 days with "remember" (`server/session.ts`). `requireHostSession` guards `/api/host/*`.
- Admins: `mv_admin_session` cookie (payload must carry `role: "admin"`, and the email must be in `admin_users`). `requireAdmin` in `server/routes.ts` also accepts the legacy `x-admin-password` header matched against the featured event's `admin_password`.
- Worker: `x-agent-token` header equal to `AGENT_TOKEN` (`requireAgent`, constant-time compare). No token set on the deployment → every `/api/agent/*` answers 503.
- Crons: `Authorization: Bearer <CRON_SECRET>` (Vercel sends it); every cron route checks it.

### Cron jobs (vercel.json)

Vercel's scheduler sends GET, so every cron route answers GET.

| Path | Schedule (UTC) | Handler | What it does |
|---|---|---|---|
| `/api/cron/nudges` | hourly `0 * * * *` | `server/routes.ts` (`nudgeHandler`) | Event nudges to booked podcasters (prep / final / on-air), the posting-plan campaign posts (`runCampaign`), and listener "starting soon" reminders. Accepts cron secret or an admin; `?dryRun=1` supported. |
| `/api/cron/broadcasts` | hourly `0 * * * *` | `server/routes.ts` (`scheduledBroadcastHandler`) | Sends team campaigns whose `status = scheduled` and `scheduled_for <= now`. Scheduling is therefore hour-granular. |
| `/api/cron/follow-ups` | hourly `30 * * * *` | `server/routes.ts` (`followUpHandler`) | "Remind me later" re-sends of a broadcast, three days on. Claimed before sending, so a failure loses one rather than repeating. |
| `/api/cron/reconcile` | every 15 min | `server/routes.ts` (`reconcileEgressHandler`) | Clears studio recording/broadcast flags and marks recordings Failed when LiveKit no longer reports their egress running. |
| `/api/cron/reach` | daily `20 6 * * *` | `server/routes.ts` (`audienceRefreshHandler`) | Rebuilds the lineup's combined audience snapshot for sponsor pages; keeps the old one if the new one comes back empty. |
| `/api/cron/automations` | every 15 min | `server/automations.ts` | Enrolls new starters in "on" automations and sends due steps. |
| `/api/cron/youtube-episodes` | every 15 min | `server/hosting.ts` | Posts scheduled podcast episodes with `youtube_wanted = true` to YouTube once `published_at` has passed. Claims each row first. |
| `/api/cron/trash` | daily `40 7 * * *` | `server/trash.ts` | Deletes Recently-deleted items past 15 days, and their stored files. |
| `/api/cron/creator-campaigns` | every minute | `server/creatorCampaigns.ts` | Creators' "Email your fans": starts due scheduled emails and sends each sending one a batch of 60 a minute. |

### The worker and its jobs

The worker holds one secret (`AGENT_TOKEN`) and no database or storage credentials. It polls `POST /api/agent/clip-jobs/claim` every `CLIP_POLL_MS` (5 s) in `CLIP_WORKERS` lanes (default 2), sending the list of job kinds it can do. Claims are atomic on the server. Files come as signed download links and go back through signed upload URLs (`/api/agent/clip-files/upload-url`, `/api/agent/clean-files/upload-url`).

Claim order in `server/routes.ts` (first match wins):

| Order | Kind (`can`) | Job | Result routes |
|---|---|---|---|
| 1 | `edit` | Clip "Edit text" / Trim remake of one clip's shapes | `/api/agent/clip-edits/:id/done\|failed` |
| 2 | `suggest` | "Suggest edits" for the episode editor | `/api/agent/suggest-edits/:id/done\|failed` |
| 3 | `music` | "Add music" to finished clips | `/api/agent/music-jobs/:id/done\|failed` |
| 4 | `episode-audio` | Library video → podcast episode MP3 | `/api/agent/episode-audio/:id/done\|failed` |
| 5 | `import` | Zoom / import-link recording into the Library | `/api/agent/imports/:id/done\|failed` |
| 6 | (always) | Clip a recording (moments, three shapes, clean episode) | `/api/agent/clip-jobs/:id/clip`, `/done`, `/failed`, `/progress`, `/heartbeat`, `/duration`, `/transcript`, `/clean` |
| 7 | `episode-edit` | "Save to Library" from the episode editor | `/api/agent/episode-edits/:id/done\|failed` |
| 8 | (always) | Clean episode on its own | `/api/agent/clip-jobs/:id/clean` |
| 9 | `transcript` | Ask my show: transcribe a podcast episode | `/api/agent/transcripts/:id/done\|failed` (`server/askShow.ts`) |
| 10 | `episode-still` | A still from an episode's video for its artwork | `/api/agent/episode-still/:id/done\|failed` (`server/hosting.ts`) |
| 11 | `living-squeeze` | Shrink a SmartLink living photo / talking intro for phones | `/api/agent/living-squeeze/:id/done\|failed` (`server/bioPage.ts`) |
| 12 | `episode-copy` | Copy a moved show's episode from the old host into our storage | `/api/agent/episode-audio/:id/done` |

Also: `/api/agent/clip-renders` (Creatomate, only when `CLIP_RENDERER=creatomate`) and `/api/agent/transcript` (captions agent).

Resilience rules in `agent/clipper.ts`:
- A clip job heartbeats every minute. A `running` clip job with no heartbeat for 10 minutes is reclaimed; clip edits after 15 minutes; episode edits after 30.
- On SIGINT/SIGTERM/SIGHUP the worker hands its clip jobs and episode edits back (`/failed` with `requeue: true`). The Dockerfile starts `node --import tsx agent/clipper.ts` directly (not `npx`) so Render's SIGTERM reaches it.
- ffmpeg concurrency is `min(memory / 1.9 GB, CPUs)` unless `FFMPEG_SLOTS` is set. The start-up log line reads "N jobs at a time, M ffmpeg at a time (X CPU, Y GB)".

---

## 2. Environment variables

Names only. Values live in Vercel (site) and Render (worker). Set secrets from a terminal: `read -rs K && printf '%s' "$K" | vercel env add NAME production && unset K`.

### Core (Vercel)

| Variable | Used by | Purpose |
|---|---|---|
| `POSTGRES_URL` (fallbacks `POSTGRES_PRISMA_URL`, `DATABASE_URL`) | `server/storage.ts` | Database. A Supabase pooler URL on port 5432 is rewritten to 6543 (transaction mode, `prepare: false`, pool of 4). |
| `SESSION_SECRET` | `server/session.ts`, `server/routes.ts`, `server/hosting.ts`, `server/zoom.ts`, `server/creatorCampaigns.ts`, `server/secretBox.ts` | Signs session cookies, unsubscribe and link tokens; fallback key for `secretBox`. |
| `TOKEN_ENCRYPTION_KEY` | `server/secretBox.ts` | AES-256-GCM sealing of stored third-party secrets (Zoom tokens, podcast-stats credentials). |
| `PUBLIC_ORIGIN` | many (`email.ts`, `hosting.ts`, `bioPage.ts`, `myStudio.ts`, `guests.ts`, …) | Origin for links in emails, feeds and invites. |
| `CRON_SECRET` | `server/routes.ts`, `automations.ts`, `trash.ts`, `hosting.ts`, `creatorCampaigns.ts` | Bearer token on cron routes. |
| `AGENT_TOKEN` | `server/routes.ts`, `agent/clipper.ts`, `agent/captions.ts` | Worker ↔ API auth. Same value on Vercel and Render. |
| `NODE_ENV`, `PORT`, `VERCEL`, `VERCEL_ENV` | `server/index.ts`, `session.ts`, `creatomate.ts` | Runtime flags. |

### Email

| Variable | Used by | Purpose |
|---|---|---|
| `RESEND_API_KEY` | `server/email.ts`, `server/routes.ts` | Sending, and reading inbound bodies. Write-only in Vercel. |
| `CUSTOM_CRED_API_RESEND_COM_URL`, `CUSTOM_CRED_API_RESEND_COM_TOKEN` | `server/email.ts` | Alternative Resend base URL / proxy token when no API key is set. |
| `RESEND_WEBHOOK_SECRET` | `server/routes.ts` | Verifies `/api/webhooks/resend` (delivery/open/click events → `broadcast_events`). |
| `RESEND_INBOUND_SECRET` | `server/routes.ts` | Verifies `/api/webhooks/resend-inbound`. |
| `INBOUND_DOMAINS` | `server/routes.ts` | Domains whose inbound mail is ours (default militaryvoices.ai, militaryvoice.ai, militaryvoice.io). |
| `FORWARD_INBOX` | `server/routes.ts` | Where inbound mail is forwarded. |
| `SIGNUP_NOTIFY_EMAIL` | `server/routes.ts`, `server/automations.ts` | Team notification address; fallback test recipient. |
| `RICCOH_EMAIL` | `server/email.ts` | Riccoh's address for sender rules. |

### Media and storage

| Variable | Used by | Purpose |
|---|---|---|
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | `server/livekit.ts` (captions agent too) | Rooms, tokens, egress. Unset → studio runs with no audio/video. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | `server/livekit.ts`, `server/recordingStorage.ts` | Recording/clip storage. When set, R2 wins over Supabase. |
| `SUPABASE_S3_ENDPOINT`, `SUPABASE_S3_REGION`, `SUPABASE_S3_ACCESS_KEY_ID`, `SUPABASE_S3_SECRET_ACCESS_KEY`, `RECORDINGS_BUCKET` | `server/livekit.ts` | Fallback recording storage. |
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY` | `server/photoStorage.ts`, `server/recordingStorage.ts`, `server/bioPage.ts` | Photo and show-asset storage (several naming conventions accepted). |

### AI and media services

| Variable | Used by | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | `help.ts`, `youtubeDraft.ts`, `routes.ts`, `agent/clipper.ts`; also read implicitly by every `new Anthropic()` (`alex.ts`, `askShow.ts`, `adminChat.ts`, `inbox.ts`, `bioPage.ts`, `creatorCampaigns.ts`) | Claude. Worker without it falls back to speech-density picks. |
| `ELEVENLABS_API_KEY` (or `ELEVEN_LABS_API_KEY`) | `server/music.ts`, `server/bioPage.ts`, `agent/clipper.ts` (worker reads only `ELEVENLABS_API_KEY`) | Music generation, community intro voices, Scribe transcription in the worker. |
| `FAL_KEY` | `server/bioPage.ts` | SmartLink living photo, talking intro (Kling avatar), fix-up, styles, scenes, cutout. |
| `DEEPGRAM_API_KEY` | `agent/clipper.ts`, captions agent | Transcription fallback / live captions. |
| `CREATOMATE_API_KEY` (also accepted: `CREATOMTE_API_KEY`, `CREATOMATE_KEY`, `CREATOMATE_API`, `CREATOMATE`) | `server/creatomate.ts` | Creatomate renders, only used when the worker has `CLIP_RENDERER=creatomate`. The Vercel variable is spelled `CREATOMTE_API_KEY`. |

### Social, video and integrations

| Variable | Used by | Purpose |
|---|---|---|
| `UPLOAD_POST_API_KEY` | `server/uploadPost.ts` | All social posting and account connection. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `server/youtube.ts` | YouTube OAuth (live broadcasts). |
| `YOUTUBE_CALLBACK_ORIGIN` | `server/routes.ts` | OAuth callback origin; stays on the old militaryvoice.ai spelling on purpose. |
| `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_WEBHOOK_SECRET` | `server/zoom.ts` | Zoom connection and recording webhook. |
| `ZOOM_REVIEW_PASSWORD` | `server/review.ts` | Fixed sign-in for marketplace app reviewers. |
| `ADOBE_CLIENT_ID`, `ADOBE_CLIENT_SECRET` | `server/routes.ts` (`/api/admin/adobe/check`) | Admin credential check only. |
| `INFLUENCER_CLUB_API_KEY` | `server/discovery.ts`, `server/influencers.ts` | Discovery creator search, analytics, contacts. |
| `PODCHASER_API_KEY` (or `PODCHASER_CLIENT_ID`, `PODCHASER_KEY`) | `server/podchaser.ts` | Podcasts in Discovery. |
| `PARALLEL_API_KEY` (and variants) | `server/sponsorFinder.ts` | Admin sponsor research. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `server/stripe.ts` | Plans, add-ons, credit packs; webhook at `/api/webhooks/stripe`. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `server/push.ts` | Web Push. |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | `server/turnstile.ts` | Bot check on public forms. |
| `POST_TESTERS`, `POST_VIEW_AS`, `POSTIFY_BETA_EPISODES`, `POSTIFY_BETA_MAX_MIN` | `server/routes.ts` | Pōstify test accounts (no limit), accounts admins can view as, beta episode allowance (default 1) and max length (default 90 min). |

### Worker only (Render)

`render.yaml` sets `API_BASE` (https://www.militaryvoices.ai), `CLIP_COUNT=4`, and asks for `AGENT_TOKEN`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`. Optional knobs read by `agent/clipper.ts`:

| Variable | Default | Effect |
|---|---|---|
| `CLIP_WORKERS` | 2 | Parallel job lanes. |
| `CLIP_PARALLEL` | 2 | Moments rendered at once inside one job. |
| `CLIP_POLL_MS` | 5000 | Poll interval. |
| `FFMPEG_SLOTS` | derived | Concurrent ffmpeg processes. |
| `CLIP_RENDERER` | `local` | `local` = our renderer; `creatomate` = Creatomate via the API; `ffmpeg` = plain ffmpeg. |
| `CLEAN_EPISODE`, `CLEAN_VIDEO` | `1` | `0` skips the clean episode / its video. |
| `CLEAN_PRESET` | `superfast` | x264 preset for clean and edited episodes. |
| `FOCUS_MODEL` | `claude-sonnet-5` | Model for speaker framing. |
| `WHISPER_MODEL`, `DEEPGRAM_API_KEY` | – | Transcription fallbacks. |

Scripts in `scripts/` also read `MV_API`, `MV_SITE`, `MV_VPS`, `PUBLIC_BASE_URL`, `ADMIN_API_BASE`, `ASSET_ORIGIN`, `PREP_DIR`, `LIVEAVATAR_API_KEY`, `SINGLE_EGRESS`.

---

## 3. Data model

`shared/schema.ts` is the only source of truth: 85 tables. All timestamps are ISO strings in `text` columns.

**Schema sync.** `server/schemaSync.ts` derives DDL from the Drizzle definitions and runs `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS` and `CREATE [UNIQUE] INDEX IF NOT EXISTS`. It is additive only: it never drops or renames a table, column or index, and never changes a type. A new column on a table with rows is added nullable unless it has a default. It runs on the first request after a deploy (`ensureSchemaSafe` in `server/storage.ts`), skips when the stored fingerprint in `schema_meta` matches, takes advisory lock `873321` so one instance does the work, and sets `lock_timeout 3s` and `statement_timeout 20s` so a blocked ALTER can't take the API down. Modules that query `db` directly call `schemaIsReady()` first. To remove or rename anything, write a one-off script.

### Events and the marathon
| Table | Purpose · key columns |
|---|---|
| `events` | Each event; one `is_featured`. `slug`, `visible`, `closed`, `start_at_utc`, `duration_hours` (integer), `slot_minutes`, `on_air_minutes`, `buffer_minutes`, `admin_password` (legacy admin header). |
| `signups` | A podcaster's booked slot. `event_id`, `slot_index`, `email`, `podcast_name`, `co_host_email`, `show_format` (live/prerecorded), `recording_url`, `social_accounts` (JSON), `status`. |
| `event_shows` | What a person brings to a given event (show, format, intro style), so events don't overwrite each other. |
| `podcaster_profiles` | One account per email: show, host name, `interests`, photo (`photo_url` 720px, `photo_original_url`), `upload_post_username`, `social_accounts`, directory controls. |
| `login_tokens` | Emailed sign-in codes (`token`, `expires_at`, `used_at`). |
| `admin_users` | Who is an admin (`email`, `is_owner`). |
| `reminders` | A fan asking to be told before a slot goes live (`signup_id`, `reminded_at` claim). |
| `nudges` | Pre-show emails sent per signup and kind (claim stops double sends). |
| `show_guests` | A podcaster's guests on a slot: name, title, intro, photo, invite `token` into the green room. |
| `cohost_slots` | Hour blocks of the broadcast day claimed by co-hosts (unique per event+block). |
| `cohost_lines` | Pre-written host lines per run-of-show item (short/standard/stretch), `edited`, `approved`. |
| `run_of_show` | Minute-by-minute plan: `sort_index`, `kind`, `start_at_utc`, `duration_minutes`, `signup_id`, media. |
| `event_team` | Named team members; the "from" person on campaigns (`member:<id>` sender). |
| `show_assets` | Files a podcaster sends (intro/outro, images, links); `storage_key` for R2. |
| `platform_interest` | "Run your own event" / platform enquiries. |
| `site_settings` | Key/value admin switches. |

### Sponsors
| Table | Purpose · key columns |
|---|---|
| `sponsor_packages` | What can be bought: `price`, `total_slots`, `tier`, `checkout_url`. |
| `sponsors` | Sponsor companies and logos per event: `tier`, `package_id`, `video_url`. |
| `show_sponsors` | A sponsor backing one show (`signup_id` may be empty until picked), `read_line`, referral fee. |
| `sponsor_inquiries` | The public sponsor form. |
| `sponsor_leads` | People Riccoh will contact (status pipeline). |
| `sponsor_searches` | Parallel research runs (`kind` find/contact, `run_id`, `result`). |
| `sponsor_clicks` | Counted `/go/sponsor/<id>` clicks. |

### Studio, rooms and live
| Table | Purpose · key columns |
|---|---|
| `studios` | The event studio's live state: stage media, layout, banner/ticker, `broadcast_egress_id`, `recording_egress_id`, current scene. |
| `scenes` | Saved stage states (one button each in the console). |
| `lower_thirds` | Reusable name/caption cards. |
| `studio_participants` | Green-room presence: `role`, `state`, `cam_ready`, `mic_ready`, `last_seen_at`. |
| `destinations` | RTMP outputs: the house's, or a podcaster's own for their slot only. |
| `ingresses` | RTMP-in for a podcaster pushing from their own encoder. |
| `captures` | Recording a show that happens elsewhere (RTMP in → Library). |
| `presentations`, `presentation_slides` | Slide decks for a show. |
| `transcript_lines` | Live caption lines per studio (`start_ms`, `end_ms`, `speaker`). |
| `personal_studios` | Rooms: one per creator, LiveKit room `my-<id>`, `invite_token`, `streams` (JSON keys), `youtube_on`, recording/live egress ids, `live_watch_url`. |
| `youtube_accounts` | A connected YouTube channel (OAuth tokens, `enabled`). |

### Library and Pōstify
| Table | Purpose · key columns |
|---|---|
| `recordings` | Every Library episode: `email`, `url` (storage key), `status`, `duration_sec`, `clip_status`/`clip_claimed_at`/`clip_progress`, `clean` (JSON), `clip_options`, `episode_edit` (JSON), `edit_draft` (JSON autosave), `music_mix` (JSON), `edit_suggest`, `transcript_json`, `import_source`, `folder_id`. Edited copies have an `egress_id` starting `CLEAN_EDIT_`. |
| `clips` | One cut: `recording_id`, `start_sec`/`end_sec`, `url` (wide), `vertical_url`, `square_url`, `subtitles_url`, `transcript`, `edit_title`/`edit_subtitle`/`edit_status`/`edit_shapes`. |
| `library_folders` | Folders in the Library. |
| `music_tracks` | Pōstify's music library (`key`, `mood`, `url`). |
| `postify_tokens` | Credit ledger: `delta` (+ purchase, − spend), `overage`, `overage_cents`, unique-ish `ref` (Stripe session, episode, `reveal:<email>:<platform>:<handle>`). Balance = sum. |
| `postify_subscriptions` | Pōstify plan mirrored from Stripe: `plan`, `status`, `interval`, period, `overage_cap_cents`. |
| `addon_subscriptions` | Add-ons (Discovery Pro): `status` active/trialing/comped. |
| `zoom_connections` | Zoom OAuth per creator (sealed tokens), `auto_import`. |
| `import_links` | Personal `/api/import/<token>` link for Zapier-style imports. |
| `trash` | Recently deleted: `kind`, `label`, `rows` (JSON, by table), `files` (R2 keys / Supabase URLs), `expires_at` (+15 days). |

### Social posting and reach
| Table | Purpose · key columns |
|---|---|
| `host_posts` | What a creator posted or scheduled: `kind` (clip/recording/episode/photo), `ref_id`, `shape`, `platforms`, `scheduled_at`, `status`, `job_id`, `request_id`, `results`, `metrics`. External id at Upload-Post is `hp-<id>`. |
| `social_posts` | The event's own promo posts per booked show (approved by an admin, sent via Upload-Post). |
| `campaign_posts` | The pre-designed posting plan a podcaster ticks (`server/campaign.ts`). |
| `social_metrics` | Third-party reach per account (`followers`, `engagement_rate`, `raw`). |
| `podcast_stats` | Listening numbers from Buzzsprout/Podbean/Spotify CSV (`creds` sealed). |
| `push_subscriptions` | Web Push endpoints per device. |

### CRM and email
| Table | Purpose · key columns |
|---|---|
| `contacts` | The mailing list: `email`, names, `source`, `status` (active/unsubscribed), `lifecycle_stage`, `tags` (JSON list). |
| `contact_notes` | Team notes on a person, by email. |
| `contact_imports` | CSV import log. |
| `segments` | Saved filters (`filter_json`) usable as `segment:<id>`. |
| `broadcasts` | Team campaigns and templates: `subject`, `preheader`, `body_text` (marked-up text), `segment`, `sender`, `banner`, `status`, `scheduled_for`, `is_template`, `source`. |
| `broadcast_sends` | One row per recipient per broadcast with the Resend id. |
| `broadcast_events` | Resend webhook events by Resend id (delivered/opened/clicked/bounced/complained). |
| `follow_ups` | "Remind me later" re-sends, one per (email, broadcast). |
| `mail_log` | Every email sent, whatever sent it (`kind`, `resend_id`, `ok`, `error`). Sign-in and owner codes are logged without the code. |
| `inbound_emails` | Mail to hello@ and Help-chat "get me a person" requests (`to_addr` = "Help chat"): body, `category`, `summary`, draft reply, `status`, `read_at`, `archived`, and Alex's first reply (`ack_*`). Alex answers every person who writes in once per thread per day, from the help desk's knowledge (server/help.ts KNOWLEDGE); the drafter's `respond:false` skips newsletters, pitches and notifications, and `looksAutomatic` skips machines. |
| `help_requests` | Help-chat visitors who asked for a person. |
| `automations`, `automation_steps`, `automation_runs`, `automation_sends` | Email series: trigger/status/`started_at`/`stop_on_reply`; steps with `delay_hours`; one run per person with `step_index`, `next_at`, `end_reason`; one send row per email. |
| `creator_campaigns`, `creator_campaign_sends` | Creators' "Email your fans" to their SmartLink subscribers (`status` draft/scheduled/sending/sent, `sent_count`). |

### Discovery
| Table | Purpose · key columns |
|---|---|
| `discovery_members` | Who has Discovery (`role`, `source`). |
| `discovery_cache` | Every paid answer (Influencers Club, Podchaser) by `key` with `created_at`. |
| `discovery_lists`, `discovery_list_items` | Saved lists and their creators/shows (`snapshot`, `note`). |
| `discovery_reveals` | Contacts revealed inside the monthly allowance. |
| `discovery_lookups` | Paid Enrich look-ups, counted per month. |
| `discovery_visits` | Visits by source. |
| `discovery_intros` | Requests to reach a verified MilitaryVoices creator through us. |

### Podcast hosting
| Table | Purpose · key columns |
|---|---|
| `hosted_shows` | A show we host: `slug`, feed metadata, `guid`, `imported_from`, `redirect_ok`, owner-email verification, `directories` (JSON), `youtube_mode` (ask/always), `youtube_privacy`, `new_feed_url` (moving out). |
| `hosted_episodes` | Episodes: `audio_key`/`audio_url`, `mime`, `status`, `published_at`, `recording_id`, `youtube` (JSON state), `youtube_wanted`, `audio_job`, `still_job`. |
| `hosted_downloads` | IAB-style downloads: one row per listener hash per episode per day. |

### SmartLink and Ask my show
| Table | Purpose · key columns |
|---|---|
| `bio_pages` | The SmartLink at `/<handle>`: `theme` (JSON, shape in `shared/bio.ts`), `sections`, `socials`, `brands`, `family`, cutout/living/intro URLs and job JSON, `published`. |
| `bio_events` | Views, taps, plays, shares. |
| `bio_subscribers` | "Stay in touch" sign-ups (`unsubscribed_at` for the creator's own list). |
| `listener_questions` | Questions from the page, with reply token. |
| `show_transcripts`, `transcript_chunks` | Episode transcripts and searchable passages for Ask my show. |

`schema_meta` (key/value, holds the schema fingerprint) is created by `server/storage.ts`, not declared in `shared/schema.ts`.

---

## 4. Features

### CRM Mail
- **What:** a mail-app view of all email. Folders: Needs a reply, Inbox, Sent, Campaigns, Didn't send, All mail, Archive. The right pane is one person's whole conversation, with delivery/open/click/bounce per email and a reply box.
- **Files:** `server/mail.ts`, `client/src/components/AdminMail.tsx`; logging hook in `server/email.ts`; inbound in `server/routes.ts` + `server/inbox.ts`.
- **Routes:** `GET /api/admin/mail?folder=&q=&offset=`, `GET /api/admin/mail/counts`, `POST /api/admin/mail/bulk` (read, unread, archive, unarchive, noreply, delete), `GET /api/admin/mail/thread?email=`, `GET /api/admin/mail/campaign/:id`; replies through `/api/admin/inbound/:id/reply|ignore`.
- **Rules:** every send goes through `sendRawEmail`, which calls the logger set by `setMailLogger` (installed by `registerMail`). Kinds `sendLoginCodeEmail` and `sendPodcastOwnerCodeEmail` are logged without their body. Bulk kinds (`sendBroadcastEmail`, `campaign`, `cadence`) stay out of Sent and show once each in Campaigns. `backfillMailLog()` copied older sends in from `broadcast_sends`. Inbound mail arrives at `/api/webhooks/resend-inbound`, is checked against `INBOUND_DOMAINS`, forwarded to `FORWARD_INBOX`, then filed in `inbound_emails` with a draft reply.

### Contact profiles, tags and notes
- **What:** one person by email (whether or not in Contacts): who they are to us, every email both ways, bookings, SmartLink, shows, sign-ups, tags and notes as a timeline.
- **Files:** `server/contactProfile.ts`, `client/src/components/AdminContact.tsx`.
- **Routes:** `GET /api/admin/contact-profile?email=`, `PUT /api/admin/contact-profile/tags`, `GET /api/admin/contact-tags`, `POST/DELETE /api/admin/contact-profile/notes[/:id]`.
- **Rules:** tags live on the `contacts` row (one is created as a manual contact if needed). A newly added tag calls `enrollByTrigger("tag:<name>")`, so any "on" automation for that tag starts.

### Campaign builder
- **What:** blocks on the left, the real rendered email (phone/computer) on the right. Starters and saved templates, Have SI write it, Send test, Review & send, or schedule.
- **Files:** `client/src/components/CampaignBuilder.tsx` (also used for automation steps and, since the creator-campaign commit, creators' "Email your fans"), `server/email.ts` (`renderBroadcastEmail`, `textToHtml`), send/preview routes in `server/routes.ts`.
- **Format:** blocks serialize to the same marked-up text every campaign stores in `body_text`: `## heading`, `![alt](https://…)`, `[[Button]](https://…)`, `---`, `> quote`, plus paragraphs, `- ` bullets, numbered lists and inline marks. `toBlocks`/`fromBlocks` convert; `textToHtml` renders. Half-filled image/button blocks are dropped rather than sent broken.
- **Preheader:** `broadcasts.preheader` (and `automation_steps.preheader`), the grey inbox preview line. The builder warns when it's empty.
- **Merge fields:** `{{First_Name}}` (also `{{Slot_Time}}`, `{{Remind_Me_Later}}` are allowed by the checker); anything else blocks sending.
- **Segments** (`resolveBroadcastRecipients` in `server/routes.ts`): `signups`, `contacts`, `all`, `not-signed-up` (exclusion applied last), `no-audience-link`, `segment:<id>`, `tag:<name>` (active contacts carrying the tag), `engagement:<broadcastId>:<type>`. Recipients are deduped by lower-cased email. Preview count via `GET /api/admin/segment-preview`.
- **Routes:** `GET/POST /api/admin/broadcasts`, `PUT /api/admin/broadcasts/:id`, `POST /api/admin/broadcasts/preview`, `POST /api/admin/broadcasts/:id/test`, `POST /api/admin/broadcasts/:id/send`, `POST /api/admin/ai/draft-email`, `POST /api/admin/media/upload-url`.
- **Scheduling:** saving with `scheduledFor` sets status `scheduled`; the hourly `/api/cron/broadcasts` sends it on the first run after that time.
- **Unsubscribe:** `/api/unsubscribe?email=&token=` calls `storage.unsubscribeContact`, which marks the contact unsubscribed or, if the address isn't in Contacts (an account holder in an automation, say), inserts a `contacts` row with `source = "unsubscribe"`, `status = "unsubscribed"`, so every sender sees it.

### Automations
- **What:** email series each person receives on their own clock.
- **Files:** `server/automations.ts`, `client/src/components/AdminAutomations.tsx`.
- **Triggers:** `account` (new `podcaster_profiles`), `smartlink` (new `bio_pages`), `podcast` (new `hosted_shows`), `discovery` (new `discovery_members`), `slot` (confirmed `signups`), `contact` (active contacts added), `tag:<name>` (from the tag editor), `manual` ("Add people"). Recipes: Welcome series, New SmartLink tips, Discovery welcome, blank.
- **Routes:** `GET/POST /api/admin/automations`, `GET/PUT/DELETE /api/admin/automations/:id`, `POST …/:id/status` (on/off), `POST …/:id/enroll`, `POST …/:id/runs/:runId/stop`, `POST …/:id/test`; cron `GET /api/cron/automations` every 15 minutes.
- **Rules:**
  - Only new after switch-on: turning an automation on sets `started_at = now`, and the cron only enrolls people whose trigger happened after it. Anyone who has ever had a run in that automation is skipped. House addresses (hello@) are never enrolled.
  - `delay_hours` counts from the previous email (step 0 from enrollment).
  - Each due run is claimed (`next_at` set to `"9999"`) before sending, so overlapping passes can't double-send.
  - Stops: `unsubscribed` if the contact is unsubscribed; `replied` if `stop_on_reply` and an inbound email from them arrived after enrollment; `removed` by hand. A step with an empty subject or body is skipped, not sent blank. A failed send retries in an hour.
  - Can't delete an automation that's on; can't enroll into one that's off.
- **State:** the Welcome series (id 1, trigger `account`, stop on reply) is **on** since 2026-09-29 20:08 UTC (checked in the database on 30 Sep).

### Creators' "Email your fans"
- **What:** creators email their SmartLink "Stay in touch" subscribers, from "<Show> via MilitaryVoices.ai", replies to the creator.
- **Files:** `server/creatorCampaigns.ts`, `client/src/components/FanEmails.tsx`, builder in creator mode.
- **Routes:** `/api/host/campaigns` (list/create), `PUT/DELETE /api/host/campaigns/:id`, `…/:id/test`, `…/:id/send`, `…/preview`, `…/draft`, `…/image`; `/api/fans/unsubscribe` (that creator's list only); cron `/api/cron/creator-campaigns` every minute.
- **Rules:** 60 per minute per campaign, one email a day per creator, lists up to 5,000. Show-reminder sign-ups are not included.

### Discovery and Podchaser
- **What:** search military/veteran creators (our verified lineup first, then Influencers Club), full profiles, similar creators, contact reveal, Enrich look-ups, saved lists, intros; and Podcasts (Podchaser): shows and people.
- **Files:** `server/discovery.ts`, `server/creatorProfile.ts`, `server/podchaser.ts`, `client/src/pages/Discover.tsx` (tabs search / enrich / lists), `client/src/components/DiscoverPodcasts.tsx`, `DiscoverEnrich.tsx`. **Book a guest** and **Be a guest** are tabs on the Podcast screen (`PodcastHosting.tsx`), built from `DiscoverPodcasts.tsx`.
- **Routes:** `/api/discover/me|join|visit|search|creator|similar|reveal|enrich|verified|showcase|sample|intro`, `/api/discover/lists` (+ `/:id`, `/:id/items[/:itemId]`), `/api/discover/podcasts/status|search|show|person`; admin `/api/admin/discover/*`.
- **Reveal allowance:** per calendar month, 10 contacts free (`FREE_DISCOVERY.reveals`) or 100 with Discovery Pro (`ADDONS.discovery.reveals`, $29/mo; status active/trialing/comped). After that each contact costs `REVEAL_CREDITS = 1` credit from the Pōstify ledger (HTTP 402 when out). A contact already revealed by that member, inside the allowance (`discovery_reveals`) or paid for (`postify_tokens.ref = reveal:<email>:<platform>:<handle>`), is free to see again. The credit is taken only after the contact comes back. Look-ups: 200/month free, 1,000 with Pro.
- **Caching:** Influencers Club answers are cached in `discovery_cache`: search pages a day, analytics a month, contacts for good. Podchaser (Starter, 1,000 requests/month, REST, `x-api-key`): searches a week, shows and people a month; 40 requests are kept in reserve each month; fresh searches capped at 2/day for visitors, 40/day for members.

### Podcast hosting
- **What:** we host shows: RSS at `/feed/<slug>`, counted downloads at `/e/<episodeId>.<ext>`, public page `/podcast/<slug>`, import from another host, directory tracking, YouTube per show.
- **Files:** `server/hosting.ts`, `client/src/components/PodcastHosting.tsx` (tabs Episodes, Directories, Details, Book a guest, Be a guest).
- **Routes:** `GET /api/host/hosting`, `POST /api/host/hosting/shows`, `PATCH /api/host/hosting/shows/:id`, artwork uploads, `POST …/shows/:id/episodes`, `PATCH /api/host/hosting/episodes/:id`, `POST …/episodes/:id/youtube` and `/youtube/skip`, owner email `…/owner-email/send|confirm` (6-digit code, 30 minutes), `POST /api/host/hosting/import`, `…/listings`, `…/redirect-check` (the old host's 301), deletes (to Recently deleted).
- **Downloads:** counted IAB-style: a request for the start of the file, not HEAD, not a bot, once per listener per episode per day; the listener is a hash of IP + user agent + day.
- **YouTube per show:** `youtube_mode` `ask` (default; the episode form offers "Also post it to YouTube") or `always`; `youtube_privacy` public/unlisted/private. A scheduled episode sets `youtube_wanted`; `/api/cron/youtube-episodes` posts it once it's out. Posting goes through Upload-Post (`publishVideo`) with a `host_posts` row. An audio-only episode can't go.
- **No double YouTube post:** `libraryYouTubeAt(recordingId)` finds a Library post of the same recording to YouTube; the podcast then records `{state: "sent", via: "library"}` instead of posting. In reverse, `POST /api/host/recordings/:id/publish` calls `podcastYouTubeAt` and answers 409 if the podcast already sent it, unless the body says `again: true`.
- **Moving out:** `new_feed_url` makes `/feed/<slug>` 301 to the new feed.

### Library and Pōstify
- **Library:** `client/src/components/RecordingsScreen.tsx` has Episodes | Clips tabs (`?tab=clips&ep=<id>` opens one episode's clips). `MyRecordings.tsx` groups copies under their original: Clean, the **latest** Edited copy, Original, with older edits under "Earlier edits (n)". `ClipsLibrary.tsx` lists every clip with its status (ready / scheduled / posted), using the same card as Pōstify, so Post, Trim and Edit title work there too.
- **Episode editor** (`PostStudio.tsx`, "Edit episode"): timeline with **Split** (cut at the playhead; pick a piece; delete it) and **Trim start & end**; **Done** finishes the current edit and takes out the picked piece; intro/outro blocks with Fade / Dip to black / Cut; **Your edits** log with undo and reset; music ranges ("Music for the episode": opening, close, picked piece or whole episode; under the voices or full).
  - Autosave: `PUT /api/host/recordings/:id/edit-draft` into `recordings.edit_draft` (`clear: true` wipes it).
  - **Save to Library:** `POST /api/host/recordings/:id/episode-edit` validates trims (end ≥ start + 5 s), merges cuts (≥ 0.5 s each, max 50), resolves music tracks, and queues `episode_edit`. The worker's `handleEpisodeEdit` renders a new copy; `/api/agent/episode-edits/:id/done` saves it as a new recording (`CLEAN_EDIT_…`) and sends a push notification.
  - Music: each range is mapped past the cuts (`toOut`) and shifted by the intro, looped (`-stream_loop -1`), faded, set to 0.12 volume ("under") or 0.6 ("full"), and mixed with `amix` (`normalize=0`).
  - Output always ends in `format=yuv420p` and `-pix_fmt yuv420p`: the xfade crossfades can produce 4:4:4 video that Safari won't play.
- **Clips:** `POST /api/host/recordings/:id/clips` (make clips), `/more-clips` (Generate more), `/clip` (a clip marked by hand), `/music` (Add music), `/suggest-edits`; clean episode via `/clean/audio|video|save`.
  - **Trim / Edit text:** `POST /api/host/clips/:id/text` with `title`, `subtitle`, and optionally `startSec`/`endSec` (5 s to 180 s). Queues a remake of only that clip's existing shapes. When the recording has music mixed (`music_mix.status = done`), the done handler re-queues the music mix from the new files, so remakes keep their music.
  - **Suggest titles:** `POST /api/host/clips/:id/suggest-title` returns three 4–7 word titles from the clip transcript (Claude Sonnet); needs at least 8 words said.
- **Clipper (`agent/clipper.ts`):** `pickMoments` asks Claude Opus up to three times (third try without thinking, forced tool). If all fail, it falls back to the densest speech stretches and `titled()` makes one quick call to write real 4–7 word headlines, keeping first-words titles only if that also fails. Rendering defaults to our own renderer (`CLIP_RENDERER=local`, word captions in `agent/wordCaptions.ts`, title band via `server/textPath.ts` outlines).
- **Credits:** see Plan & billing. Beta: one free episode (`POSTIFY_BETA_EPISODES`), up to 90 minutes; `POST_TESTERS` unlimited.

### Social posting
- **What:** post clips, episodes and photos now, scheduled, or queued, through Upload-Post; see Scheduled and Posted with per-platform results and metrics.
- **Files:** `client/src/components/PostDialog.tsx` (post form, YouTube fields, SI-drafted episode description via `/api/host/recordings/:id/youtube-draft`), `client/src/components/SocialScreen.tsx`, `server/uploadPost.ts`, routes in `server/routes.ts`.
- **Routes:** `POST /api/host/clips/:id/publish` (shape vertical/square/wide, any platforms), `POST /api/host/recordings/:id/publish`, `POST /api/host/posts/photo`, `GET /api/host/posts`, `PATCH/DELETE /api/host/posts/:id`, `POST /api/host/share/publish` (event promo card).
- **Rules:** a whole episode goes to **YouTube only**: the server filters platforms to `youtube` and answers 400 otherwise; clips go to the other apps. A post shows as Scheduled while `status = scheduled` and its time is in the future, otherwise Posted (or failed). Upload-Post's messages are shortened by `plainError`, which also explains Instagram's 15-minute video limit. For a whole episode, the signed video link lasts 6 hours when posting now and 7 days when scheduled or queued (Upload-Post fetches it at post time).

### Recently deleted
- **Files:** `server/trash.ts`, `client/src/components/RecentlyDeleted.tsx`, `ConfirmDelete.tsx`.
- **What:** deleting a Library recording, clip, podcast episode or show, or a media file first calls `toTrash()` with the rows exactly as they are and the files to purge later. Kept 15 days (`TRASH_DAYS`).
- **Routes:** `GET /api/host/trash`, `POST /api/host/trash/:id/restore`, `DELETE /api/host/trash/:id` (gone now); cron `/api/cron/trash` daily.
- **Restore** reinserts the rows **by their original ids**, parents first (shows, episodes, recordings, clips, assets), in one transaction; any clash (e.g. a show slug reused since) aborts the lot with a 409.

### Plan and billing
- **Files:** `client/src/components/PlanBilling.tsx` (Account → Plan & billing), `shared/tokens.ts`, `server/stripe.ts`, routes in `server/routes.ts`, `client/src/lib/tokens.ts`.
- **Plans** (`PLANS`): Creator $19.95/mo or $199/yr, 30 credits, 4 clips/episode, extras 60¢; Pro $49/mo or $490/yr, 90 credits, 6 clips/episode, extras 50¢. Yearly gets 12 months of credits up front and no metered extras.
- **Episode cost** (`episodeCredits`): animated captions 2 credits a clip; classic 1 a clip + 1 for the clean episode.
- **Credit packs** (`CREDIT_PACKS`): 20 for $15, 50 for $35, 120 for $78; `TEST_PACK` (2 for $1) only via `/pricing?test`.
- **Add-ons** (`ADDONS`): Discovery Pro $29/mo.
- **Routes:** `POST /api/host/plan/checkout|confirm|cap|portal`, `/api/host/addon/checkout|confirm`, `/api/host/tokens/checkout|confirm`, `/api/admin/addons/grant` (comped), `POST /api/webhooks/stripe`.
- **Rules:** extras beyond plan credits are metered to Stripe (a billing meter created on first use) up to the subscriber's cap (`overage_cap_cents`, default $20). Credits are granted by the return page and by the webhook; the ledger `ref` makes the second a no-op. Prices come from `shared/tokens.ts`, never from the browser.

### Rooms (and Studio)
- **What:** a creator's own room, any time: guests on an invite link, record to the Library, go live to their YouTube and any streaming keys. LiveKit room `my-<personal_studios.id>`, separate from the event studio.
- **Files:** `server/myStudio.ts`, `client/src/pages/MyStudio.tsx`; routes `/room`, `/room/join/:token` (old `/my-studio` links still work).
- **Routes:** `GET/PATCH /api/host/my-studio`, `POST /api/host/my-studio/token`, `GET /api/my-studio/invite/:token`, `POST /api/my-studio/invite/:token/token`, `POST /api/host/my-studio/record`, `POST /api/host/my-studio/live`.
- **Rules:** recordings finish through the LiveKit `egress_ended` webhook (`/api/livekit/webhook`) and land in the owner's Library. Going live creates a YouTube broadcast (`createBroadcast`) when YouTube is on, plus every enabled stream key, in one egress. Recording/live flags are checked against LiveKit before being shown. YouTube's "live streaming is not enabled" error is turned into plain advice.
- **Studio (full):** the marathon studio for a creator's own show is planned after Oct 5. The nav item in `HostNav.tsx` is tagged "Oct 5" and a click shows "Studio is coming Oct 5th".

### SmartLink
- **What:** a creator's page at `militaryvoices.ai/<handle>` with templates, sections, podcast, socials, Stay in touch, Ask my show, a Brands media kit (`/<handle>/brands`) and Family view.
- **Files:** `server/bioPage.ts`, `shared/bio.ts` (theme/sections shapes, `INTRO_VOICES`, reserved handles), `client/src/components/BioBuilder.tsx`, `BioPageView.tsx`, `BioBrandsView.tsx`, `BioFamilyView.tsx`, `client/src/pages/BioPublicPage.tsx`.
- **Hero sliders** (theme fields, clamped server-side): `nameY` (−260 to 120 px, name position), `imageY` (0–100 %, photo position), `imageZoom` (100–200 %, photo size).
- **Talking intro:** `POST/GET /api/host/bio/intro`. Their profile photo speaks via fal `fal-ai/kling-video/ai-avatar/v2/standard`, from their own recorded voice or an AI voice. Stock voices go through fal's ElevenLabs TTS. Community voices (Brock, Sarge, Jerry, the entries with an `eleven` id in `INTRO_VOICES`) are spoken by ElevenLabs directly with `ELEVENLABS_API_KEY`/`ELEVEN_LABS_API_KEY`; that key needs **Text to Speech** and **Voices (read)** permission, or ElevenLabs answers 401. Three intros per page per day, up to 20 minutes each; the worker then makes a smaller phone copy (`living-squeeze`).
- Other fal features in the same file: living photo, fix-up, styles, scenes, cutout (BiRefNet). All return 503 without `FAL_KEY`.

### Agenda guests on cards
- `publicGuestsFor(signupIds)` in `server/guests.ts` returns each show's named guests (name, title, photo, intro; never email or link). `withCoHosts` in `server/routes.ts` attaches them to public signups. `client/src/components/AgendaCard.tsx` shows the first named guest on a card that has no co-host.

### Branding rule: SI, not AI
- In anything visitors and creators see, "AI" is written **SI** (super intelligence): SI search, Alex · SI help desk, Have SI write it, Moments picked by SI, and so on.
- Unchanged: the MilitaryVoices.ai name, Podbean's own menu name "AI & Integrations" where we quote it, code comments and model prompts.

### Other modules (one line each)
| File | What |
|---|---|
| `server/help.ts`, `client/src/components/HelpChat.tsx` | Alex · SI help desk chat; hands off to a person (`help_requests`). |
| `server/adminChat.ts` | Admin's chat with Alex (e.g. "email Frank…"). |
| `server/inbox.ts` | Drafts replies to inbound mail. |
| `server/askShow.ts` | Ask my show: transcripts → passages → answers on the SmartLink. |
| `server/music.ts` | Music library, tracks generated once with ElevenLabs Music. |
| `server/zoom.ts` | Zoom OAuth; cloud recordings into the Library. |
| `server/podcastStats.ts` | Buzzsprout/Podbean/Spotify numbers. |
| `server/push.ts` | Web Push. |
| `server/captures.ts` | Record an outside show via RTMP. |
| `server/audience.ts`, `server/influencers.ts` | Combined lineup reach for sponsors. |
| `server/sponsorFinder.ts` | Parallel research for sponsors. |
| `server/campaign.ts`, `server/shareCard.ts` | Event posting plan and share cards. |
| `server/mce.ts` | militarycreatoreconomy.com page. |
| `server/review.ts` | App-review sign-in. |
| `server/turnstile.ts` | Bot check on public forms. |

---

## 5. Operations runbook

### Deploy
1. Commit to `main` and `git push`. Vercel builds in about 40 s.
2. Before pushing server code, check relative imports carry `.js`:
   `grep -rn 'from "\./[^"]*"' server/*.ts | grep -v '\.js"'` must print nothing.
3. Typecheck (the Vercel build does not): `npx tsc --noEmit -p . > /tmp/tsc.out 2>&1; echo "exit $?"` and read the exit code. There is no `timeout` command on this Mac; don't wrap tsc in one.

### Check a deploy
- Commit status from the Vercel GitHub integration:
  `gh api repos/Seeksy-app/militaryvoice/commits/<sha>/statuses --jq '.[0] | {state, description, target_url}'`
  `state` goes `pending` → `success` (or `failure`/`error`).
- Then hit `https://www.militaryvoices.ai` (the apex redirects; use `curl -L`).
- A 500 on every route after a deploy is usually a module that failed to load (see gotchas); `vercel logs` shows the real error.
- The worker: Render dashboard → militaryvoices-clipper → Events/Logs. The start-up line shows lanes, ffmpeg slots, CPU and memory.

### One-off scripts
- Run locally with the production environment: `node --env-file=.env --import tsx scripts/<name>.ts`.
- The database is `POSTGRES_URL`, and the local `.env` points at **production**. Read first; clean up any test rows; don't run the local dev server against it with real accounts.
- Scripts that change data follow the dry-run then `--apply` pattern. Read the dry run.

### Don't push `agent/**` while a render job is running
A push touching `agent/**`, `server/textPath.ts`, `server/assets/**` or `render.yaml` redeploys the worker. The worker hands back what it holds on SIGTERM, but the job restarts from the beginning (a long episode loses its progress). Check first, read-only:

```sql
select 'clip' job, id from recordings where clip_status in ('queued','running')
union all select 'episode-edit', id from recordings where episode_edit like '%"status":"running"%' or episode_edit like '%"status":"queued"%'
union all select 'clean', id from recordings where clean like '%"status":"running"%'
union all select 'music', id from recordings where music_mix like '%"status":"running"%' or music_mix like '%"status":"queued"%'
union all select 'import', id from recordings where status = 'Importing'
union all select 'clip-edit', id from clips where edit_status in ('queued','running')
union all select 'episode-audio', id from hosted_episodes where audio_job in ('queued','running')
union all select 'transcript', id from show_transcripts where status in ('queued','running');
```

Empty means safe. The Render logs also show `[<recordingId>] …` lines while a job runs. Changes only to `client/**` or other `server/**` files don't redeploy the worker.

### Local mock harness (never committed)
To look at a screen without the API or a real session:
- `vite.hx.config.ts` merges the main Vite config with a middleware that answers `/api/*` with canned JSON (and renders the real email preview via `server/email.ts`).
- `client/hx.html` loads `client/src/hx.tsx`, which mounts only the component under test (`?v=` picks one).
- Run `npx vite --config vite.hx.config.ts` and open `/hx.html`.
- These three files stay untracked. Don't `git add -A` them.

---

## 6. Known gotchas

| Gotcha | Detail |
|---|---|
| Vercel ESM needs `.js` | The API runs as native Node ESM, transpiled but not bundled. A relative import without `.js` passes locally and then fails at module load on Vercel, which takes **every** route down. |
| No fonts on Vercel (or in the worker) | SVG text rasterized by sharp renders as empty boxes. Draw text as outlines (`server/textPath.ts`, embedded fonts in `server/assets/`). |
| Hidden-tab video | Chrome defers media loading in a hidden tab. A video that "won't load" in a background tab is usually this: check `document.visibilityState` before blaming the file. |
| Instagram 15-minute limit | Instagram through Upload-Post rejects video over 15 minutes ("not ready for publishing"). Whole episodes go to YouTube only; post clips to Instagram. |
| YouTube live needs streaming enabled | A channel without live streaming turned on fails with `liveStreamingNotEnabled`. It is turned on in YouTube Studio and can take a day; a streaming key works meanwhile. |
| 4:4:4 video | ffmpeg crossfades can output yuv444; Safari won't play it. Always end in `yuv420p`. |
| Schema changes are additive | `schemaSync` never drops, renames or retypes. Do those with a script. |
| `duration_hours` is an integer | An event can only be a whole number of hours. |
| Worker plan | Change the worker size in the Render dashboard, then match `plan:` in `render.yaml`, or a sync resets it. |
| Creatomate key spelling | Vercel has `CREATOMTE_API_KEY`; the code accepts both spellings. |
