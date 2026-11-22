#!/usr/bin/env bash
# One-time setup of the clipper on the Alex VPS (run as root; agent/vps/README.md has the paste-in).
#
# Reads the secrets from /root/.mv-clipper-secrets (KEY=value lines, written by the paste-in on the Mac,
# deleted here), checks each works, writes /etc/mv-clipper.env (root, 600), retires the old
# /opt/clipper systemd worker, installs the update timer and starts the first build.
# Run it again to change a secret: whatever isn't in the secrets file keeps its current value.
set -euo pipefail
cd "$(dirname "$0")"

IN=/root/.mv-clipper-secrets
ENV_FILE=/etc/mv-clipper.env
umask 077

declare -A V=()
load() { [ -f "$1" ] || return 0; while IFS= read -r line || [ -n "$line" ]; do
  line=${line%$'\r'}; [[ "$line" =~ ^([A-Z_]+)=(.*)$ ]] || continue
  val=${BASH_REMATCH[2]}; val=${val#\"}; val=${val%\"}; [ -n "$val" ] && V[${BASH_REMATCH[1]}]=$val
done < "$1"; }
load "$ENV_FILE"
load "$IN"
rm -f "$IN"

ok() { local code; code=$(curl -s -o /dev/null -w '%{http_code}' "$@"); [ "$code" = 200 ] && echo yes || echo "no (HTTP $code)"; }
echo "AGENT_TOKEN works: $(ok -X POST -H "x-agent-token: ${V[AGENT_TOKEN]:-}" https://www.militaryvoices.ai/api/agent/clip-jobs/0/heartbeat)"
echo "ANTHROPIC_API_KEY works: $(ok https://api.anthropic.com/v1/models -H "x-api-key: ${V[ANTHROPIC_API_KEY]:-}" -H 'anthropic-version: 2023-06-01')"
# Render's ElevenLabs key is a restricted one: it may do speech-to-text (all the worker calls) but not read
# models or the account, so ask speech-to-text with no file: a good key gets 400 ("provide a file"), a bad one 401.
el=$(curl -s -o /dev/null -w '%{http_code}' -X POST https://api.elevenlabs.io/v1/speech-to-text -H "xi-api-key: ${V[ELEVENLABS_API_KEY]:-}" -F model_id=scribe_v1)
echo "ELEVENLABS_API_KEY works: $([ "$el" = 400 ] && echo yes || echo "no (HTTP $el)")"
[ "$(ok -X POST -H "x-agent-token: ${V[AGENT_TOKEN]:-}" https://www.militaryvoices.ai/api/agent/clip-jobs/0/heartbeat)" = yes ] \
  || { echo "Stopping: without a working AGENT_TOKEN the worker can't take jobs."; exit 1; }

# What Render set (render.yaml), plus the limits Render forced on us, lifted for this box:
# 3 jobs at a time, 4 ffmpeg at once inside 6 CPUs / 20GB, and 60GB of real disk for sources
# (full-day Radio recordings are ~2.5GB each).
{
  echo "API_BASE=https://www.militaryvoices.ai"
  echo "AGENT_TOKEN=${V[AGENT_TOKEN]}"
  echo "ANTHROPIC_API_KEY=${V[ANTHROPIC_API_KEY]:-}"
  echo "ELEVENLABS_API_KEY=${V[ELEVENLABS_API_KEY]:-}"
  [ -n "${V[DEEPGRAM_API_KEY]:-}" ] && echo "DEEPGRAM_API_KEY=${V[DEEPGRAM_API_KEY]}"
  echo "CLIP_COUNT=${V[CLIP_COUNT]:-4}"
  echo "CLIP_WORKERS=${V[CLIP_WORKERS]:-3}"
  echo "FFMPEG_SLOTS=${V[FFMPEG_SLOTS]:-4}"
  echo "TMP_BUDGET_BYTES=${V[TMP_BUDGET_BYTES]:-60000000000}"
} > "$ENV_FILE.new"
chmod 600 "$ENV_FILE.new"
mv "$ENV_FILE.new" "$ENV_FILE"
echo "wrote $ENV_FILE"

# The old copy (/opt/clipper, Sep code, a stale token): stop it for good. Its files stay where they are.
if systemctl list-unit-files clipper.service >/dev/null 2>&1; then
  systemctl disable --now clipper.service 2>/dev/null || true
  echo "old clipper.service stopped and disabled"
fi

install -m 755 update.sh /usr/local/sbin/mv-clipper-update
install -m 644 mv-clipper-update.service mv-clipper-update.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mv-clipper-update.timer >/dev/null
echo "timer on: checks main every 5 minutes"

/usr/local/sbin/mv-clipper-update --force
sleep 8
docker ps --filter name=^mv-clipper$ --format '{{.Names}} {{.Image}} {{.Status}}'
docker logs --tail 5 mv-clipper 2>&1
