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
| Source for builds | `/opt/mv-clipper/src`, fetched from mv's checkout `/home/mv/militaryvoice` (kept current by `mv-pull` every 10 min) |
| Updates | `mv-clipper-update.timer`, every 5 min → `/usr/local/sbin/mv-clipper-update` (this folder's `update.sh`) |

**Deploys.** Push to main. When agent/**, server/textPath.ts, server/assets/** or tsconfig.json change, the VPS has the new build
running within ~15 minutes (mv-pull up to 10, the timer up to 5, then a build of about a minute). It builds while the
old worker works, then waits for the worker's job count (`/var/lib/mv-clipper/tmp/worker-busy`) to reach 0,
for at most 3 hours. A job stopped anyway is handed back on SIGTERM, and clip jobs resume.

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
  ssh vps 'sudo -u mv git -C /home/mv/militaryvoice pull -q --ff-only; bash /home/mv/militaryvoice/agent/vps/install.sh'
)
```

(`read -rs "A?…"` is zsh, the Mac's Terminal shell.) It prints "works: yes" three times, "running mv-clipper:…" and the
worker's first lines.
