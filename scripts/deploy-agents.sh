#!/usr/bin/env bash
# Ship the agents to the VPS and restart them.
#
#   ./scripts/deploy-agents.sh            # what would change
#   ./scripts/deploy-agents.sh --apply    # send it and restart
#
# /opt/clipper is an rsync'd copy of this repo, not a checkout — uid 501, a
# .DS_Store, the lot. So `git pull` there fails, and until now there was no way
# to get a change in Alex or the clipper onto the machine that runs them. A fix
# sitting in main that never reaches the process is not a fix.
#
# Rsync rather than converting it to a git checkout: the box has no credentials
# for a private repo, node_modules is installed in place and is not ours to
# blow away, and /etc/alex.env lives outside the directory and must stay.
#
# Nothing here touches the environment file or node_modules.
set -euo pipefail

HOST="${AGENT_HOST:-root@187.77.217.123}"
DEST="${AGENT_DIR:-/opt/clipper}"
APPLY=""
[[ "${1:-}" == "--apply" ]] && APPLY="yes"

cd "$(dirname "$0")/.."

# Only what the agents actually run. The client, the media and the recordings
# have no business on that box.
PATHS=(agent scripts shared server package.json tsconfig.json)

RSYNC=(rsync -az --delete-after --itemize-changes
  --exclude=node_modules --exclude='.env*' --exclude='.DS_Store'
  --exclude='*.mp4' --exclude='*.jpg' --exclude='*.jpeg' --exclude='*.png')

if [[ -z "$APPLY" ]]; then
  echo "Dry run against ${HOST}:${DEST}"
  echo
  "${RSYNC[@]}" --dry-run "${PATHS[@]}" "${HOST}:${DEST}/" | grep -v '^\.' || true
  echo
  echo "Add --apply to send it and restart alex.service."
  exit 0
fi

echo "Sending to ${HOST}:${DEST} …"
"${RSYNC[@]}" "${PATHS[@]}" "${HOST}:${DEST}/" | grep -v '^\.' || true

echo
echo "Restarting alex.service …"
# Restarted rather than reloaded: she holds a LiveKit connection and a
# LiveAvatar session, and there is no way to swap the code underneath either.
# She stands down and comes back within fifteen seconds of somebody arriving.
ssh "$HOST" 'systemctl restart alex.service && sleep 3 && systemctl is-active alex.service'

echo
echo "Last few lines:"
ssh "$HOST" 'journalctl -u alex.service -n 12 --no-pager -o cat'
