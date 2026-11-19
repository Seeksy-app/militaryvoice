# Ingest box (our own RTMP engine for Stream in)

StreamYard, Restream and OBS send their stream to `rtmp://stream.militaryvoices.ai/live/<key>`
(or `rtmps://…:443/live/<key>`). This box checks the key with the site, records the stream
without re-encoding, uploads one MP4 to our R2 bucket and tells the site, which puts it in
the podcaster's Library, queues the clips and sends the email. The podcaster's page, key and
monthly hours are the same as with LiveKit; this is "engine #2". LiveKit stays the default
until the box has handled a week of real streams, and the fallback after that.

```
StreamYard/OBS ──RTMP(S)──> MediaMTX ──hooks──> agent.mjs ──HTTPS──> /api/ingest/*  (site)
                               │                    └─ joins segments, uploads to R2
                               └─ records fMP4 segments to /var/lib/mvingest/rec
```

Files: `mediamtx.yml` (the server config), `agent.mjs` (key checks, sessions, finishing),
`setup.sh` (installs everything), `agent.env.example` (what goes in `/etc/mvingest/agent.env`),
`test.mjs` (a local rehearsal of the agent: `node ingest/test.mjs`).
The site side is `server/ingestEngine.ts` (routes) and `server/streamIn.ts` (engine choice).

## Set up (once)
1. Buy a small VPS: Ubuntu 24.04, 2 vCPU, 4 GB+, 80 GB+, US east. Not the Alex server.
2. DNS (GoDaddy, where militaryvoices.ai lives): add an **A record, name `stream`, value = the new server's IP**.
3. Copy this folder to the server and run `CERT_EMAIL=… ./setup.sh stream.militaryvoices.ai` as root.
4. Make an R2 API token limited to the recordings bucket (Object Read & Write). Put it and the shared
   secret in `/etc/mvingest/agent.env` (`INGEST_TOKEN`, `R2_*`). Generate the secret with `openssl rand -hex 32`.
5. Set the same value as `INGEST_TOKEN` in the site's environment (Vercel) and redeploy.
6. `systemctl start mv-ingest-agent mediamtx`. Admin → System health shows "Ingest box" green within a minute.
7. Test with a real stream (OBS or StreamYard) on a test key before switching anything on.
8. Switch on: `POST /api/admin/stream-in/engine {"engine":"own"}` (admin). New and renewed keys then use the box
   while it answers; if it goes silent for 3 minutes new keys fall back to LiveKit by themselves. Existing keys keep their engine.

## Run
- Logs: `journalctl -u mediamtx -u mv-ingest-agent -f` (the agent hides keys; MediaMTX's own log lines contain the path, so the journal is root-only).
- Restart: `systemctl restart mv-ingest-agent mediamtx`. A restart mid-stream drops the stream; the encoder reconnects and the agent resumes the session.
- Nothing precious lives here: config is in the repo, finished files are in R2. Raw segments are kept 3 days in `/var/lib/mvingest/done`.
- If an upload fails the segments stay in `/var/lib/mvingest/rec/live/<key>`, the podcaster is told, and Slack is told.
- Roll back: `POST /api/admin/stream-in/engine {"engine":"livekit"}`; a podcaster presses "Make a new key" to move over.
- Security: SSH keys only, ufw open on 22/80/443/1935, fail2ban, automatic security updates, MediaMTX API on localhost.
  A key is 144 random bits; the agent refuses every read; revoking a key (new key or off) kicks its stream within 30 seconds.
- At 2 am: systemd restarts both services if they die; the System health check pages Slack if the box is silent.
