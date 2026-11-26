# The clipper on the Alex VPS

Since 22 Nov 2026 the clip worker (`agent/clipper.ts`, built from `agent/Dockerfile`) runs on the Alex VPS
(187.77.217.123, 8 CPU, 32GB, ~278GB free disk) as the docker container `mv-clipper`. Render's
`militaryvoices-clipper` moved off: 25GB of included bandwidth, $0.15/GB after, a 2GB /tmp.

| | |
|---|---|
| Container | `mv-clipper` (`--restart unless-stopped`), 6 CPUs, 20GB, low CPU priority (`--cpu-shares 512`), so two CPUs stay free for RTMP, OpenClaw, admin-backend and mv's Claude sessions |
| Settings and secrets | `/etc/mv-clipper.env` (root, 600). Never print it. |
| Temporary disk | `/var/lib/mv-clipper/tmp` (the container's /tmp). TMP_BUDGET_BYTES is 60GB. |
| Deployed commit | `/var/lib/mv-clipper/deployed` |
| Source for builds | `/opt/mv-clipper/src`, root's own clone, fetched from GitHub (the repo is public, so no key). Never from mv's checkout: mv must not be able to choose what root installs and runs. |
| Updates | `mv-clipper-update.timer`, every 5 min → `/usr/local/sbin/mv-clipper-update` (this folder's `update.sh`) |

**Deploys.** Push to main. When agent/**, server/textPath.ts, server/assets/** or tsconfig.json change, the VPS has the new build
running within ~5–10 minutes (the timer every 5, then a build of a minute or two). It builds while the
old worker works, then waits for the worker's job count (`/var/lib/mv-clipper/tmp/worker-busy`) to reach 0,
for at most 3 hours. A job stopped anyway is handed back on SIGTERM, and clip jobs resume.

**Conversation starters listener** (since 26 Nov 2026, Andrew: "Yes, run it"). `agent/starters.ts` runs from the same image as
the docker container `mv-listener` (1 CPU, 1GB). It holds only API_BASE and AGENT_TOKEN (`/etc/mv-listener.env`, written by
update.sh from the worker's env file). update.sh starts it with each new build, and restarts it if it isn't running. It joins
only rooms that `/api/agent/starters/rooms` lists: the toggle on, the studio in setting `starters:studios` (default `13`),
and someone in the room. Logs: `docker logs -f --tail 100 mv-listener`. Spend: Admin `GET /api/admin/starters`.

**Everyday commands** (Mac: `ssh vps`, which is root):

```bash
docker logs -f --tail 100 mv-clipper            # the worker
journalctl -u mv-clipper-update -n 30 --no-pager # builds and restarts
mv-clipper-update --force                         # rebuild and restart now
docker restart mv-clipper                         # restart the same build
cat /var/lib/mv-clipper/deployed                  # which commit is running
```

Its start-up line, and each stop, also lands in settings `worker_notes`, starting with `vps:` (Render's start with `render:`).

## First install / changing a secret (Andrew, on the Mac)

Copy the three values from Render → militaryvoices-clipper → Environment. Paste the whole block into Terminal;
it asks for each one, and nothing shows on screen. It checks each one works and then starts the worker. To change
a single secret later, run it again and press Return at the ones that stay the same.

```bash
(
  read -rs "A?AGENT_TOKEN: " </dev/tty; echo
  read -rs "B?ANTHROPIC_API_KEY: " </dev/tty; echo
  read -rs "C?ELEVENLABS_API_KEY: " </dev/tty; echo
  { [ -n "$A" ] && printf 'AGENT_TOKEN=%s\n' "$A"; [ -n "$B" ] && printf 'ANTHROPIC_API_KEY=%s\n' "$B"; [ -n "$C" ] && printf 'ELEVENLABS_API_KEY=%s\n' "$C"; true; } \
    | tr -d ' \r' | ssh vps 'umask 077; cat > /root/.mv-clipper-secrets'
  ssh vps 'set -e; S=/opt/mv-clipper/src; mkdir -p /opt/mv-clipper; [ -d $S/.git ] || git init -q $S
    git -C $S fetch -q --depth 200 https://github.com/Seeksy-app/militaryvoice.git +refs/heads/main:refs/remotes/live/main
    git -C $S checkout -q --detach refs/remotes/live/main; bash $S/agent/vps/install.sh'
)
```

(`read -rs "A?…"` is zsh, the Mac's Terminal shell.) It prints "works: yes" three times, "running mv-clipper:…" and the
worker's first lines.

## Claude sessions: sending an approved reply (no browser)

Andrew, 22 Nov 2026: "you guys can send it without any browser". The send key only does one thing: it sends a reply to one inbound message, as the team from hello@. The key is in `~/.mv-send-key` (mode 600) on the VPS and on the Mac, and in Vercel as `ADMIN_SEND_KEY`. Never print it.

Use it only after Andrew has said yes to the exact text, and quote his go in `approval`:

```bash
jq -n --arg text "$(cat reply.txt)" --arg approval "Andrew, 22 Nov: \"Yes, send it\"" '{text:$text, approval:$approval}' \
  | curl -sS -X POST -H "x-admin-send-key: $(cat ~/.mv-send-key)" -H "content-type: application/json" \
    --data @- https://www.militaryvoices.ai/api/admin/inbound/<id>/reply
```

What it enforces:
- It always sends as the team from hello@, never as Riccoh.
- The recipient is whoever wrote that inbound message, threaded on it. A follow-up Andrew approves is fine. Alex's auto-acknowledgement doesn't block it, and the same text twice to the same message is refused as a retry.
- 20 sends a day.
- `approval` is required.
- Every send is logged in Mail/CRM like any reply, and posts a line to #mv-inbox with the recipient, subject, first lines and Andrew's go.

Find the message id with the read key: `GET /api/admin/inbound`. To revoke the send key, delete `ADMIN_SEND_KEY` in Vercel and redeploy.
