#!/usr/bin/env bash
# Sets up the MilitaryVoices ingest box on a fresh Ubuntu 24.04 server.
# Run as root, from a copy of this ingest/ folder, once DNS for the stream name
# points at this server's IP:
#
#   CERT_EMAIL=you@example.com ./setup.sh stream.militaryvoices.ai
#
# Safe to run again. It never writes a secret: the keys go in
# /etc/mvingest/agent.env by hand (see ingest/README.md). It does NOT touch
# SSH settings, so you can't lock yourself out.
set -euo pipefail

DOMAIN="${1:-stream.militaryvoices.ai}"
CERT_EMAIL="${CERT_EMAIL:?Set CERT_EMAIL (the certificate authority sends expiry notices there)}"
SRC="$(cd "$(dirname "$0")" && pwd)"
APP=/opt/mvingest
[ "$(id -u)" = 0 ] || { echo "Run as root."; exit 1; }

echo "== Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ffmpeg curl ca-certificates ufw fail2ban unattended-upgrades certbot jq
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "== User and folders"
id mvingest >/dev/null 2>&1 || useradd --system --home /var/lib/mvingest --shell /usr/sbin/nologin mvingest
mkdir -p "$APP" /etc/mvingest/tls /var/lib/mvingest/{rec,state,done,work}
chown -R mvingest:mvingest /var/lib/mvingest
chown root:mvingest /etc/mvingest /etc/mvingest/tls
chmod 750 /etc/mvingest /etc/mvingest/tls

echo "== MediaMTX (checksum verified)"
ARCH="$(dpkg --print-architecture)"; case "$ARCH" in amd64) A=amd64;; arm64) A=arm64v8;; *) echo "Unsupported arch $ARCH"; exit 1;; esac
VER="${MEDIAMTX_VERSION:-$(curl -fsSL https://api.github.com/repos/bluenviron/mediamtx/releases/latest | jq -r .tag_name)}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
BASE="https://github.com/bluenviron/mediamtx/releases/download/$VER"
TARBALL="mediamtx_${VER}_linux_${A}.tar.gz"
curl -fsSL -o "$TMP/$TARBALL" "$BASE/$TARBALL"
curl -fsSL -o "$TMP/checksums.sha256" "$BASE/checksums.sha256"
( cd "$TMP" && grep " \*\?$TARBALL\$" checksums.sha256 | sha256sum -c - )
tar -xzf "$TMP/$TARBALL" -C "$TMP" mediamtx
install -m 755 "$TMP/mediamtx" "$APP/mediamtx"
echo "MediaMTX $VER installed"

echo "== Agent and config"
install -m 644 "$SRC/agent.mjs" "$APP/agent.mjs"
install -m 644 "$SRC/package.json" "$APP/package.json"
install -m 644 "$SRC/mediamtx.yml" /etc/mvingest/mediamtx.yml
( cd "$APP" && npm install --omit=dev --no-audit --no-fund )
if [ ! -f /etc/mvingest/agent.env ]; then
  install -m 640 -o root -g mvingest "$SRC/agent.env.example" /etc/mvingest/agent.env
  echo "Created /etc/mvingest/agent.env: fill it in (INGEST_TOKEN and the R2_* values)."
fi

echo "== TLS certificate for $DOMAIN (needs DNS pointing here and port 80 free)"
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  ufw allow 80/tcp >/dev/null 2>&1 || true
  certbot certonly --standalone -d "$DOMAIN" -m "$CERT_EMAIL" --agree-tos --non-interactive
fi
cat > /etc/letsencrypt/renewal-hooks/deploy/mvingest.sh <<HOOK
#!/bin/sh
install -m 640 -o root -g mvingest /etc/letsencrypt/live/$DOMAIN/fullchain.pem /etc/mvingest/tls/fullchain.pem
install -m 640 -o root -g mvingest /etc/letsencrypt/live/$DOMAIN/privkey.pem /etc/mvingest/tls/privkey.pem
systemctl restart mediamtx
HOOK
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/mvingest.sh
RENEWED_LINEAGE="/etc/letsencrypt/live/$DOMAIN" /etc/letsencrypt/renewal-hooks/deploy/mvingest.sh || true

echo "== Services"
cat > /etc/systemd/system/mediamtx.service <<'UNIT'
[Unit]
Description=MediaMTX (MilitaryVoices ingest)
After=network-online.target
Wants=network-online.target
[Service]
User=mvingest
ExecStart=/opt/mvingest/mediamtx /etc/mvingest/mediamtx.yml
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=always
RestartSec=2
LimitNOFILE=65536
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/mv-ingest-agent.service <<'UNIT'
[Unit]
Description=MilitaryVoices ingest agent
After=network-online.target
Wants=network-online.target
[Service]
User=mvingest
EnvironmentFile=/etc/mvingest/agent.env
ExecStart=/usr/bin/node /opt/mvingest/agent.mjs
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable mediamtx mv-ingest-agent >/dev/null

echo "== Firewall, fail2ban, automatic security updates"
ufw allow 22/tcp; ufw allow 80/tcp; ufw allow 443/tcp; ufw allow 1935/tcp
ufw --force enable
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades || true

if grep -Eq '^INGEST_TOKEN=.+' /etc/mvingest/agent.env; then
  systemctl restart mv-ingest-agent mediamtx
  echo "Started. Check: systemctl status mediamtx mv-ingest-agent"
else
  echo
  echo "NOT STARTED YET: edit /etc/mvingest/agent.env, then run:"
  echo "  systemctl start mv-ingest-agent mediamtx"
fi
