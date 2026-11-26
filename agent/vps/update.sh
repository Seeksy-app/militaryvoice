#!/usr/bin/env bash
# The clipper on the Alex VPS: build and (re)start it when the worker's code on main changed.
#
# Runs as root every 5 minutes (mv-clipper-update.timer), and once by install.sh. It:
#   1. fetches main straight from GitHub (the repo is public: no key) into its own root-owned clone.
#      Never from mv's checkout: mv could point that at any commit, and root installs and runs what it fetches.
#   2. does nothing unless agent/**, server/textPath.ts, server/assets/** or tsconfig.json changed
#      since the build that's running (the same paths Render's buildFilter watches),
#   3. builds agent/Dockerfile from just those paths (git archive), while the old worker keeps working,
#   4. waits until the worker has no job in hand (/tmp/worker-busy is 0), at most MAX_WAIT_MIN,
#      then swaps containers. A job cut off anyway is handed back on SIGTERM and resumes.
#
# `update.sh --force` rebuilds and restarts now (no waiting for idle).
# Logs: journalctl -u mv-clipper-update   ·   the worker itself: docker logs -f mv-clipper
set -euo pipefail

REPO_URL=https://github.com/Seeksy-app/militaryvoice.git
BASE=/opt/mv-clipper
SRC=$BASE/src
STATE=/var/lib/mv-clipper
ENV_FILE=/etc/mv-clipper.env
NAME=mv-clipper
MAX_WAIT_MIN=${MAX_WAIT_MIN:-180}
PATHS=(agent server/textPath.ts server/assets tsconfig.json)
FORCE=0; [ "${1:-}" = "--force" ] && FORCE=1

exec 9>/run/mv-clipper-update.lock
flock -n 9 || { echo "another update is running"; exit 0; }

mkdir -p "$BASE" "$STATE/tmp"
[ -f "$ENV_FILE" ] || { echo "no $ENV_FILE: run agent/vps/install.sh first"; exit 1; }

git_() { GIT_TERMINAL_PROMPT=0 git "$@"; }
[ -d "$SRC/.git" ] || git_ init -q "$SRC"
# Shallow: only the recent history the path check needs. If the running build's commit isn't in it, the diff
# below fails and that counts as changed (one extra build, never a missed one).
git_ -C "$SRC" fetch -q --depth 200 "$REPO_URL" +refs/heads/main:refs/remotes/live/main
NEW=$(git_ -C "$SRC" rev-parse refs/remotes/live/main)
CUR=$(cat "$STATE/deployed" 2>/dev/null || true)
RUNNING=$(docker ps -q -f "name=^${NAME}$")

# The conversation starters listener (agent/starters.ts): the same image as the worker, in a small container of its
# own. It holds only API_BASE and AGENT_TOKEN (not the worker's other keys). No jobs to wait for: on SIGTERM it leaves
# its rooms, and the new one is back in them within 15 seconds.
LISTENER=mv-listener
LISTENER_ENV=/etc/mv-listener.env
start_listener() {
  local image=$1
  docker image inspect "$image" >/dev/null 2>&1 || return 0
  (umask 077; grep -E '^(API_BASE|AGENT_TOKEN)=' "$ENV_FILE" > "$LISTENER_ENV")
  docker rm -f "$LISTENER" >/dev/null 2>&1 || true
  docker run -d --name "$LISTENER" --restart unless-stopped \
    --env-file "$LISTENER_ENV" -e WORKER_NAME=vps \
    --cpus 1 --memory 1g --memory-swap 1g \
    --log-opt max-size=20m --log-opt max-file=3 \
    --stop-timeout 20 \
    "$image" node --import tsx agent/starters.ts >/dev/null
  echo "running $LISTENER:${image##*:}"
}
ensure_listener() {
  [ -n "$(docker ps -q -f "name=^${LISTENER}$")" ] && return 0
  start_listener "$(docker inspect -f '{{.Config.Image}}' "$NAME" 2>/dev/null || true)"
}

if [ "$FORCE" = 0 ] && [ -n "$RUNNING" ] && [ -n "$CUR" ]; then
  [ "$CUR" = "$NEW" ] && { ensure_listener; exit 0; }
  if git_ -C "$SRC" diff --quiet "$CUR" "$NEW" -- "${PATHS[@]}" 2>/dev/null; then
    echo "$NEW" > "$STATE/deployed"   # main moved on, but not the worker's code
    ensure_listener
    exit 0
  fi
fi

TAG=${NEW:0:12}
echo "building $NAME:$TAG"
CTX=$(mktemp -d)
trap 'rm -rf "$CTX"' EXIT
git_ -C "$SRC" archive "$NEW" "${PATHS[@]}" | tar -x -C "$CTX"
docker build -q -t "$NAME:$TAG" -f "$CTX/agent/Dockerfile" "$CTX" >/dev/null

if [ -n "$RUNNING" ] && [ "$FORCE" = 0 ]; then
  for ((i = 0; i < MAX_WAIT_MIN * 2; i++)); do
    busy=$(cat "$STATE/tmp/worker-busy" 2>/dev/null || echo 0)
    [ "${busy:-0}" -le 0 ] 2>/dev/null && break
    [ $i = 0 ] && echo "waiting for the worker to finish $busy job(s)"
    sleep 30
  done
fi

# Two CPUs and ~10GB stay free for the rest of the box (RTMP, OpenClaw, admin-backend, mv's Claude
# sessions), and the worker yields CPU to them when the box is busy (cpu-shares).
docker rm -f "${NAME}-old" >/dev/null 2>&1 || true
if docker container inspect "$NAME" >/dev/null 2>&1; then
  # Stopping hands its jobs back (SIGTERM → release), so the new one picks them up and resumes.
  docker rename "$NAME" "${NAME}-old"
  docker stop -t 90 "${NAME}-old" >/dev/null || true
fi
docker run -d --name "$NAME" --restart unless-stopped \
  --env-file "$ENV_FILE" -e WORKER_NAME=vps \
  --cpus 6 --cpu-shares 512 --memory 20g --memory-swap 20g \
  -v "$STATE/tmp:/tmp" \
  --log-opt max-size=50m --log-opt max-file=5 \
  --stop-timeout 90 \
  "$NAME:$TAG" >/dev/null
docker rm -f "${NAME}-old" >/dev/null 2>&1 || true
echo "$NEW" > "$STATE/deployed"
echo "running $NAME:$TAG"
start_listener "$NAME:$TAG"

# This script and its timer update themselves from main (a fresh file, so this run isn't disturbed).
install -m 755 "$CTX/agent/vps/update.sh" /usr/local/sbin/mv-clipper-update
install -m 644 "$CTX/agent/vps/mv-clipper-update.service" "$CTX/agent/vps/mv-clipper-update.timer" /etc/systemd/system/
systemctl daemon-reload

# Keep the last three builds.
docker image ls "$NAME" --format '{{.Tag}}' | tail -n +4 | xargs -r -I{} docker rmi -f "$NAME:{}" >/dev/null 2>&1 || true
