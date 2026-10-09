#!/usr/bin/env bash
# Push the committed code to the server, rebuild, and restart.
#
#   ./deploy.sh ubuntu@<server-ip> [path/to/ssh.key]
#
# Ships only what's committed (git archive), so the database, .env and build
# caches on the server are never touched or overwritten.
set -euo pipefail

TARGET="${1:?usage: ./deploy.sh ubuntu@<server-ip> [ssh-key]}"
KEY="${2:-$HOME/.ssh/oracle-terminal.key}"
SSH=(ssh -i "$KEY" "$TARGET")

if [ -n "$(git status --porcelain)" ]; then
  echo "Uncommitted changes — commit first (only committed code is deployed)." >&2
  exit 1
fi

echo "→ uploading $(git rev-parse --short HEAD)"
git archive --format=tar.gz HEAD | "${SSH[@]}" 'tar -xzf - -C ~/Aero-Fuse'

echo "→ installing + building on the server"
"${SSH[@]}" 'set -e
  cd ~/Aero-Fuse
  .venv/bin/pip install -q -r backend/requirements.txt
  cd frontend && npm ci --no-audit --no-fund --silent && NEXT_TELEMETRY_DISABLED=1 npm run build >/dev/null
  sudo systemctl restart terminal-api terminal-web
  sleep 5
  systemctl is-active terminal-api terminal-web'

echo "✓ deployed"
